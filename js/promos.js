// Motor de promociones: decide si una promo aplica a una venta y cuánto descuenta.
// Tipos: percent (%), amount (Q fijo), bundle (N prendas por Q), special (precio especial c/u).
import { state, productById } from './db.js';
import { today, Q, int, fmtDate, sumBy } from './ui.js';

export const PROMO_TYPES = {
  percent: 'Porcentaje',
  amount: 'Monto fijo',
  bundle: 'Precio por cantidad',
  special: 'Precio especial por producto o drop',
};

export function promoSummary(p) {
  switch (p.type) {
    case 'percent':
      return `${Number(p.value) || 0}% de descuento`;
    case 'amount':
      return `${Q(p.value)} menos`;
    case 'bundle':
      return `${int(p.bundle_qty)} x ${Q(p.bundle_price)}`;
    case 'special':
      return `${Q(p.value)} c/u`;
    default:
      return '';
  }
}

export const promoSales = (p) => state.sales.filter((s) => s.promo_id === p.id && s.status !== 'cancelado');

export function promoStatus(p, date = today()) {
  if (p.active === false) return { key: 'pausada', label: 'Pausada', cls: 'muted' };
  if (p.end_date && date > p.end_date) return { key: 'vencida', label: 'Vencida', cls: 'muted' };
  if (p.start_date && date < p.start_date) return { key: 'programada', label: `Desde ${fmtDate(p.start_date)}`, cls: 'info' };
  if (p.max_uses && promoSales(p).length >= p.max_uses) return { key: 'agotada', label: 'Agotada', cls: 'warn' };
  return { key: 'activa', label: 'Activa', cls: 'ok' };
}

// Prendas de la venta a las que aplica (las preventas no llevan promo: ya tienen su precio).
function eligible(p, cart) {
  const pids = p.product_ids || [];
  const dids = p.drop_ids || [];
  return cart.filter((c) => {
    if (c.preorder) return false;
    if (!pids.length && !dids.length) return true;
    return pids.includes(c.product_id) || dids.includes(productById(c.product_id)?.drop_id);
  });
}

/**
 * ctx = { cart, date, channel, eventId, customerId }
 * Regresa { ok, discount, reason }.
 */
export function evaluatePromo(p, ctx) {
  const date = ctx.date || today();
  const st = promoStatus(p, date);
  if (st.key === 'pausada') return { ok: false, reason: 'Esta promoción está pausada.' };
  if (st.key === 'vencida') return { ok: false, reason: `Venció el ${fmtDate(p.end_date)}.` };
  if (st.key === 'programada') return { ok: false, reason: `Empieza el ${fmtDate(p.start_date)}.` };
  if (st.key === 'agotada') return { ok: false, reason: `Ya se usó las ${int(p.max_uses)} veces permitidas.` };
  if (p.channels?.length && !p.channels.includes(ctx.channel)) return { ok: false, reason: `Solo aplica en: ${p.channels.join(', ')}.` };
  if (p.event_id && p.event_id !== ctx.eventId) {
    const ev = state.events.find((e) => e.id === p.event_id);
    return { ok: false, reason: `Solo aplica en el evento ${ev?.name || ''}.` };
  }
  if (p.once_per_customer) {
    if (!ctx.customerId || ctx.customerId === '__new') {
      if (ctx.customerId !== '__new') return { ok: false, reason: 'Elige al cliente: esta promoción es 1 vez por cliente.' };
    } else if (promoSales(p).some((s) => s.customer_id === ctx.customerId)) {
      return { ok: false, reason: 'Este cliente ya usó esta promoción.' };
    }
  }
  const items = eligible(p, ctx.cart);
  const subtotal = sumBy(ctx.cart.filter((c) => !c.preorder), (c) => c.qty * c.unit_price);
  if (p.min_total && subtotal < p.min_total) return { ok: false, reason: `Compra mínima de ${Q(p.min_total)} (va en ${Q(subtotal)}).` };
  const eligSub = sumBy(items, (c) => c.qty * c.unit_price);
  let discount = 0;
  if (p.type === 'percent') discount = (eligSub * (Number(p.value) || 0)) / 100;
  else if (p.type === 'amount') discount = Math.min(Number(p.value) || 0, eligSub);
  else if (p.type === 'special') discount = sumBy(items, (c) => Math.max(0, c.unit_price - (Number(p.value) || 0)) * c.qty);
  else if (p.type === 'bundle') {
    const n = Math.max(1, Number(p.bundle_qty) || 1);
    const prices = items.flatMap((c) => Array.from({ length: c.qty }, () => c.unit_price)).sort((a, b) => b - a);
    for (let g = 0; g + n <= prices.length; g += n) {
      const sum = prices.slice(g, g + n).reduce((a, b) => a + b, 0);
      discount += Math.max(0, sum - (Number(p.bundle_price) || 0));
    }
    if (!discount && prices.length < n) return { ok: false, reason: `Faltan ${n - prices.length} prenda${n - prices.length === 1 ? '' : 's'} para la promo.` };
  }
  discount = Math.round(discount * 100) / 100;
  if (discount <= 0) return { ok: false, reason: items.length ? 'No genera descuento con estas prendas.' : 'Ninguna prenda de la venta entra en esta promoción.' };
  return { ok: true, discount };
}

// Promos automáticas (sin código) que aplican a la venta, de mayor a menor descuento.
export function suggestPromos(ctx) {
  return (state.promos || [])
    .filter((p) => !p.code)
    .map((p) => ({ promo: p, ...evaluatePromo(p, ctx) }))
    .filter((r) => r.ok)
    .sort((a, b) => b.discount - a.discount);
}

export const findByCode = (code) =>
  (state.promos || []).find((p) => p.code && p.code.toUpperCase() === String(code || '').trim().toUpperCase());

// Códigos de influencer: cuánto vendió, comisión ganada, pagada y pendiente.
export function influencerStats(p) {
  const sales = promoSales(p);
  const revenue = sumBy(sales, (s) => (Number(s.subtotal) || 0) - (Number(s.discount) || 0));
  const earned = Math.round(revenue * (Number(p.commission_pct) || 0)) / 100;
  const paid = sumBy(state.expenses.filter((e) => e.promo_id === p.id && e.kind === 'comision'), (e) => e.amount);
  return { sales, revenue, earned, paid, owed: Math.max(0, earned - paid) };
}
