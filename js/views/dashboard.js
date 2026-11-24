// Inicio minimalista: ¿cómo voy hoy y qué tengo que hacer?
// 1) Ventas de hoy (un número grande) + semana y mes.  2) Pendientes.  3) Últimas 3 ventas.
// El análisis (periodos, donas, comparaciones) vive en Reportes.
import { state, can, soldLines, lowStock, saleBalance, batchQty, CLOUD } from '../db.js';
import { $, $$, esc, Q, Qs, int, pct, today, addDays, startOfMonth, startOfWeek, WEEKDAYS, MONTHS_LONG, parseYmd, sumBy, sheet } from '../ui.js';
import { bus } from '../bus.js';
import { saleRow, bindSaleRows, setFilter } from './sales.js';
import { openProduct } from './inventory.js';

const revenueOf = (from, to) => {
  const { sales, lines } = soldLines(from, to);
  return { revenue: sumBy(lines, (l) => l.revenue), units: sumBy(lines, (l) => l.qty), count: sales.length };
};

// Mismos días del mes pasado, para comparar justo.
function lastMonthRange() {
  const t = today();
  const lastDayPrev = addDays(startOfMonth(t), -1);
  const from = startOfMonth(lastDayPrev);
  const to = addDays(from, Number(t.slice(8)) - 1);
  return [from, to < lastDayPrev ? to : lastDayPrev];
}

// ── Pendientes (solo lo que hay que atender) ──
function pending() {
  const t = today();
  const items = [];
  const active = state.sales.filter((s) => s.status !== 'cancelado');
  const toShip = active.filter((s) => s.status === 'por_enviar').length;
  if (toShip) items.push({ n: toShip, sev: 'warn', text: toShip === 1 ? 'pedido por enviar' : 'pedidos por enviar', go: () => (setFilter('por_enviar'), bus.go('ventas')) });
  const held = active.filter((s) => s.status === 'apartado').length;
  if (held) items.push({ n: held, sev: 'info', text: held === 1 ? 'apartado' : 'apartados', go: () => (setFilter('apartado'), bus.go('ventas')) });
  const pre = active.filter((s) => s.status === 'preventa').length;
  if (pre) items.push({ n: pre, sev: 'info', text: pre === 1 ? 'preventa por entregar' : 'preventas por entregar', go: () => bus.go('preventas') });
  if (can('editar_ventas') || can('clientes')) {
    const owing = active.filter((s) => s.status !== 'apartado' && s.status !== 'preventa' && saleBalance(s) > 0.009);
    if (owing.length) items.push({ n: Qs(sumBy(owing, saleBalance)), sev: 'danger', text: 'por cobrar', go: () => (setFilter('por_cobrar'), bus.go('ventas')) });
  }
  const low = lowStock();
  const out = low.filter((l) => l.qty <= 0);
  if (out.length) items.push({ n: out.length, sev: 'danger', text: out.length === 1 ? 'talla agotada' : 'tallas agotadas', go: () => openLowStock(out, 'Tallas agotadas') });
  const almost = low.filter((l) => l.qty > 0);
  if (almost.length) items.push({ n: almost.length, sev: 'warn', text: 'por agotarse', go: () => openLowStock(almost, 'Por agotarse') });
  const late = state.production.filter((b) => b.status !== 'recibido' && b.expected_date && b.expected_date < t).length;
  if (late) items.push({ n: late, sev: 'danger', text: late === 1 ? 'lote atrasado' : 'lotes atrasados', go: () => bus.go('produccion') });
  const arriving = state.production.filter((b) => b.status !== 'recibido' && b.expected_date && b.expected_date >= t && b.expected_date <= addDays(t, 3));
  if (arriving.length) items.push({ n: int(sumBy(arriving, batchQty)), sev: 'info', text: 'prendas llegan esta semana', go: () => bus.go('produccion') });
  return items;
}

function openLowStock(list, title) {
  sheet({
    title,
    body: `<div class="list">${list
      .map(
        (l) => `<button class="row" data-prod="${l.product.id}">
          <div class="row-main"><div class="row-title">${esc(l.product.name)}</div><div class="row-sub">${esc(l.product.color || l.product.type || '')} · Talla ${esc(l.size)}</div></div>
          <div class="row-end">${l.qty <= 0 ? '<span class="badge danger">Agotada</span>' : `<span class="badge warn">Quedan ${l.qty}</span>`}</div>
        </button>`
      )
      .join('')}</div>`,
    onMount(root, close) {
      $$('[data-prod]', root).forEach((b) => (b.onclick = () => (close(), openProduct(b.dataset.prod))));
    },
  });
}

export function render(page) {
  const t = today();
  const d = parseYmd(t);
  const dateText = `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}`;
  const name = state.profile?.name ? esc(state.profile.name.split(' ')[0]) : '';
  const seeMoney = can('reportes');
  const todayS = revenueOf(t, t);
  const week = revenueOf(startOfWeek(t), t);
  const month = revenueOf(startOfMonth(t), t);
  const [lf, lt] = lastMonthRange();
  const last = revenueOf(lf, lt);
  const ch = last.revenue ? (month.revenue - last.revenue) / last.revenue : null;
  const items = pending();
  const recent = state.sales.slice(0, 3);

  page.innerHTML = `
    <div class="home">
      ${!CLOUD && !state.products.length ? `<div class="alert info" style="margin-bottom:18px">Estás en <b>modo demo</b>. ¿Quieres verla con datos de ejemplo? <a href="#ajustes">Cárgalos en Ajustes</a>.</div>` : ''}
      <header class="home-hello">
        <h2>Hola${name ? `, ${name}` : ''}</h2>
        <p>${esc(dateText)}</p>
      </header>

      ${seeMoney ? `
      <section class="home-today">
        <div class="home-label">Hoy</div>
        <div class="home-big">${Q(todayS.revenue)}</div>
        <div class="home-sub">${todayS.count ? `${int(todayS.units)} prenda${todayS.units === 1 ? '' : 's'} · ${int(todayS.count)} venta${todayS.count === 1 ? '' : 's'}` : 'Aún no hay ventas hoy'}</div>
        <div class="home-periods">
          <a href="#reportes"><span>Semana</span><b>${Qs(week.revenue)}</b></a>
          <a href="#reportes"><span>Mes</span><b>${Qs(month.revenue)}</b>${ch !== null ? `<em class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'} ${pct(Math.abs(ch))}</em>` : ''}</a>
        </div>
      </section>` : ''}

      <section class="home-block">
        <div class="home-label">Pendiente</div>
        ${
          items.length
            ? `<div class="home-list">${items
                .map((it, i) => `<button class="home-item" data-i="${i}"><span class="dot ${it.sev}"></span><b>${esc(it.n)}</b><span>${esc(it.text)}</span><span class="chev">›</span></button>`)
                .join('')}</div>`
            : '<p class="home-ok">✓ Todo al día</p>'
        }
      </section>

      <section class="home-block">
        <div class="home-label">Últimas ventas ${state.sales.length ? '<a href="#ventas">Ver todas</a>' : ''}</div>
        ${recent.length ? `<div class="list">${recent.map(saleRow).join('')}</div>` : `<p class="muted small">Aún no hay ventas.${can('vender') ? ' Toca Vender (＋) para registrar la primera.' : ''}</p>`}
      </section>
    </div>`;

  $$('.home-item', page).forEach((b) => (b.onclick = () => items[Number(b.dataset.i)].go()));
  bindSaleRows(page);
}
