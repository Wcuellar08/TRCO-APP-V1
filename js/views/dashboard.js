// Inicio: un solo panel para todos. Cada quien ve lo que sus permisos le dejan.
// Orden: periodo → lo que necesita atención → números de dinero → donas → últimas ventas.
import {
  state, can, soldLines, lowStock, saleBalance, dropById, batchQty, CLOUD,
} from '../db.js';
import {
  $, $$, esc, Q, Qs, int, pct, today, addDays, parseYmd, startOfMonth, startOfWeek, fmtDate, sumBy, groupSum, sheet,
} from '../ui.js';
import { bus } from '../bus.js';
import { saleRow, bindSaleRows, openNewSale, setFilter } from './sales.js';
import { openProduct } from './inventory.js';

// ── Periodo ──
let preset = 'mes';
let custom = { from: startOfMonth(), to: today() };
let metric = 'revenue'; // revenue | units

const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const shiftYear = (s, n) => `${Number(s.slice(0, 4)) + n}${s.slice(4)}`;
const lastMonthSameDay = (s) => {
  const d = parseYmd(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PRESETS = {
  hoy: { label: 'Hoy', vs: 'ayer', range: () => [today(), today()], prev: ([f]) => [addDays(f, -1), addDays(f, -1)] },
  semana: { label: 'Semana', vs: 'la semana pasada', range: () => [startOfWeek(), today()], prev: ([f, t]) => [addDays(f, -7), addDays(t, -7)] },
  mes: { label: 'Mes', vs: 'el mes pasado', range: () => [startOfMonth(), today()], prev: ([f, t]) => [lastMonthSameDay(f), lastMonthSameDay(t)] },
  anio: { label: 'Año', vs: 'el año pasado', range: () => [today().slice(0, 4) + '-01-01', today()], prev: ([f, t]) => [shiftYear(f, -1), shiftYear(t, -1)] },
  todo: {
    label: 'Todo',
    vs: '',
    range: () => [state.sales.reduce((m, s) => (s.date < m ? s.date : m), today()), today()],
    prev: () => null,
  },
  custom: {
    label: 'Elegir fechas',
    vs: 'el periodo anterior',
    range: () => [custom.from, custom.to],
    prev: ([f, t]) => {
      const n = daysBetween(f, t) + 1;
      return [addDays(f, -n), addDays(f, -1)];
    },
  },
};

function stats(range) {
  if (!range) return null;
  const [from, to] = range;
  const { sales, lines } = soldLines(from, to);
  const revenue = sumBy(lines, (l) => l.revenue);
  const cost = sumBy(lines, (l) => l.cost);
  const expenses = can('gastos') ? sumBy(state.expenses.filter((e) => e.date >= from && e.date <= to), (e) => e.amount) : 0;
  return { sales, lines, revenue, units: sumBy(lines, (l) => l.qty), count: sales.length, gross: revenue - cost, net: revenue - cost - expenses };
}

function delta(now, before, vs) {
  if (before === null || before === undefined || !vs) return '';
  if (!before && !now) return `<div class="delta flat">= igual que ${vs}</div>`;
  if (!before) return `<div class="delta up">▲ nuevo vs. ${vs}</div>`;
  const ch = (now - before) / Math.abs(before);
  if (Math.abs(ch) < 0.005) return `<div class="delta flat">= igual que ${vs}</div>`;
  return `<div class="delta ${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${pct(Math.abs(ch))} vs. ${vs}</div>`;
}

// ── Lo que necesita atención (no depende del periodo) ──
function attention() {
  const t = today();
  const items = [];
  const active = state.sales.filter((s) => s.status !== 'cancelado');
  const toShip = active.filter((s) => s.status === 'por_enviar');
  if (toShip.length)
    items.push({ n: toShip.length, sev: 'warn', title: 'Por enviar', sub: 'pedidos pendientes de envío', go: () => (setFilter('por_enviar'), bus.go('ventas')) });
  const held = active.filter((s) => s.status === 'apartado');
  if (held.length)
    items.push({ n: held.length, sev: 'info', title: 'Apartados', sub: `${Q(sumBy(held, saleBalance))} por completar`, go: () => (setFilter('apartado'), bus.go('ventas')) });
  const low = lowStock();
  const out = low.filter((l) => l.qty <= 0);
  if (out.length) items.push({ n: out.length, sev: 'danger', title: 'Tallas agotadas', sub: 'tócalo para ver cuáles', go: () => openLowStock(out, 'Tallas agotadas') });
  const almost = low.filter((l) => l.qty > 0);
  if (almost.length) items.push({ n: almost.length, sev: 'warn', title: 'Por agotarse', sub: 'tallas con pocas piezas', go: () => openLowStock(almost, 'Por agotarse') });
  if (can('editar_ventas') || can('clientes')) {
    const owing = active.filter((s) => s.status !== 'apartado' && saleBalance(s) > 0.009);
    if (owing.length)
      items.push({ n: owing.length, sev: 'danger', title: 'Te deben', sub: `${Q(sumBy(owing, saleBalance))} por cobrar`, go: () => (setFilter('por_cobrar'), bus.go('ventas')) });
  }
  const late = state.production.filter((b) => b.status !== 'recibido' && b.expected_date && b.expected_date < t);
  if (late.length) items.push({ n: late.length, sev: 'danger', title: 'Producción atrasada', sub: 'lotes que ya debían llegar', go: () => bus.go('produccion') });
  const arriving = state.production.filter((b) => b.status !== 'recibido' && b.expected_date && b.expected_date >= t && b.expected_date <= addDays(t, 3));
  if (arriving.length) items.push({ n: arriving.length, sev: 'info', title: 'Llega producción', sub: `${int(sumBy(arriving, batchQty))} prendas en 3 días`, go: () => bus.go('produccion') });
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

// ── Donas ──
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const OTHER = 'var(--chart-other)';
const MAX_SLICES = 5; // + "Otros"

function slices(lines, keyFn) {
  const rev = groupSum(lines, keyFn, (l) => l.revenue);
  const units = groupSum(lines, keyFn, (l) => l.qty);
  const val = metric === 'revenue' ? rev : units;
  const rows = [...val.entries()]
    .map(([label, value]) => ({ label: label || 'Sin dato', value, revenue: rev.get(label) || 0, units: units.get(label) || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = rows.slice(0, MAX_SLICES).map((r, i) => ({ ...r, color: COLORS[i] }));
  const rest = rows.slice(MAX_SLICES);
  if (rest.length)
    top.push({
      label: `Otros (${rest.length})`,
      value: sumBy(rest, (r) => r.value),
      revenue: sumBy(rest, (r) => r.revenue),
      units: sumBy(rest, (r) => r.units),
      color: OTHER,
    });
  return top;
}

function donut(id, title, rows) {
  const total = sumBy(rows, (r) => r.value);
  const totalLabel = metric === 'revenue' ? Qs(total) : `${int(total)} pzs`;
  if (!total)
    return `<section class="donut-card"><h3>${esc(title)}</h3><p class="muted small" style="margin:0">Sin ventas en este periodo.</p></section>`;
  const r = 50;
  const C = 2 * Math.PI * r;
  const gap = rows.length > 1 ? 2.2 : 0; // separación entre partes, del color del fondo
  let offset = 0;
  const segs = rows
    .map((row, i) => {
      const len = (row.value / total) * C;
      const seg = `<circle class="seg" data-i="${i}" r="${r}" cx="60" cy="60" stroke="${row.color}"
        stroke-dasharray="${Math.max(0.5, len - gap)} ${C}" stroke-dashoffset="${-offset}"><title>${esc(row.label)}</title></circle>`;
      offset += len;
      return seg;
    })
    .join('');
  return `<section class="donut-card" data-donut="${id}">
    <h3>${esc(title)}</h3>
    <div class="donut-body">
      <div class="donut" role="img" aria-label="${esc(title)}: ${rows.map((x) => `${x.label} ${pct(x.value / total)}`).join(', ')}">
        <svg viewBox="0 0 120 120">${segs}</svg>
        <div class="donut-center"><div class="dv">${esc(totalLabel)}</div><div class="dl">Total</div></div>
      </div>
      <ul class="legend">${rows
        .map(
          (x, i) => `<li><button type="button" data-i="${i}">
            <span class="sw" style="background:${x.color}"></span>
            <span class="ln">${esc(x.label)}</span>
            <span class="lp">${pct(x.value / total)}</span>
          </button></li>`
        )
        .join('')}</ul>
    </div>
    <p class="donut-detail">Toca una parte para ver el detalle.</p>
  </section>`;
}

function bindDonuts(root, data) {
  $$('[data-donut]', root).forEach((card) => {
    const rows = data[card.dataset.donut];
    const total = sumBy(rows, (r) => r.value);
    const box = $('.donut', card);
    const center = $('.donut-center', card);
    const detail = $('.donut-detail', card);
    const reset = () => {
      box.classList.remove('has-active');
      $$('.active', card).forEach((e) => e.classList.remove('active'));
      center.innerHTML = `<div class="dv">${esc(metric === 'revenue' ? Qs(total) : `${int(total)} pzs`)}</div><div class="dl">Total</div>`;
      detail.textContent = 'Toca una parte para ver el detalle.';
    };
    let current = -1;
    const select = (i) => {
      if (i === current) {
        current = -1;
        return reset();
      }
      current = i;
      const x = rows[i];
      box.classList.add('has-active');
      $$('.active', card).forEach((e) => e.classList.remove('active'));
      $$(`[data-i="${i}"]`, card).forEach((e) => e.classList.add('active'));
      center.innerHTML = `<div class="dv">${pct(x.value / total)}</div><div class="dl">${esc(x.label)}</div>`;
      detail.innerHTML = `<b style="color:var(--text)">${esc(x.label)}</b> · ${Q(x.revenue)} · ${int(x.units)} prendas`;
    };
    $$('[data-i]', card).forEach((el) => el.addEventListener('click', () => select(Number(el.dataset.i))));
  });
}

// ── Página ──
export function render(page) {
  const P = PRESETS[preset];
  const range = P.range();
  const now = stats(range);
  const before = stats(P.prev(range));
  const seeReports = can('reportes');
  const seeCosts = can('costos');
  const attn = attention();
  const hello = state.profile?.name ? `Hola, ${esc(state.profile.name.split(' ')[0])}` : 'Hola';

  const lines = now.lines;
  const data = seeReports
    ? {
        canal: slices(lines, (l) => l.sale.channel),
        talla: slices(lines, (l) => l.size),
        tipo: slices(lines, (l) => l.type || l.product?.type),
        drop: slices(lines, (l) => dropById(l.product?.drop_id)?.name || 'Sin drop'),
        color: slices(lines, (l) => l.product?.color),
      }
    : {};

  page.innerHTML = `
    ${!CLOUD && !state.products.length ? `<div class="alert info" style="margin-bottom:14px">
      Estás en <b>modo demo</b>: los datos se guardan solo en este dispositivo.
      ¿Quieres ver la app con datos de ejemplo? <a href="#ajustes">Cárgalos en Ajustes</a>.</div>` : ''}
    <p class="muted" style="margin:0 0 12px">${hello} 👋</p>

    ${seeReports ? `
    <div class="period">
      <div class="chips">
        ${Object.entries(PRESETS).map(([k, p]) => `<button class="chip ${preset === k ? 'active' : ''}" data-p="${k}">${p.label}</button>`).join('')}
      </div>
      ${preset === 'custom' ? `<div class="grid2">
        <label class="field"><span>Desde</span><input type="date" id="from" value="${range[0]}"></label>
        <label class="field"><span>Hasta</span><input type="date" id="to" value="${range[1]}"></label></div>` : ''}
      <p class="period-range">${range[0] === range[1] ? fmtDate(range[0]) : `${fmtDate(range[0])} – ${fmtDate(range[1])}`}</p>
    </div>` : ''}

    <div class="section" style="margin-top:${seeReports ? 14 : 0}px"><h2>Necesita tu atención</h2></div>
    ${
      attn.length
        ? `<div class="attn">${attn
            .map(
              (a, i) => `<button class="attn-item ${a.sev}" data-attn="${i}">
              <span class="n">${int(a.n)}</span><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></button>`
            )
            .join('')}</div>`
        : '<div class="attn-ok"><b>✓</b> Todo al día: nada pendiente por ahora.</div>'
    }

    ${seeReports ? `
    <div class="section"><h2>Números del periodo</h2></div>
    <div class="kpis4">
      <div class="kpi"><div class="k">Ventas</div><div class="v">${Q(now.revenue)}</div>${delta(now.revenue, before?.revenue, P.vs)}</div>
      ${seeCosts ? `<div class="kpi"><div class="k">${can('gastos') ? 'Ganancia neta' : 'Ganancia bruta'}</div>
        <div class="v ${(can('gastos') ? now.net : now.gross) < 0 ? 'neg' : ''}">${Q(can('gastos') ? now.net : now.gross)}</div>
        ${delta(can('gastos') ? now.net : now.gross, before ? (can('gastos') ? before.net : before.gross) : null, P.vs)}</div>` : ''}
      <div class="kpi"><div class="k">Prendas vendidas</div><div class="v">${int(now.units)}</div>${delta(now.units, before?.units, P.vs)}</div>
      <div class="kpi"><div class="k">Ticket promedio</div><div class="v">${Q(now.count ? now.revenue / now.count : 0)}</div>
        ${delta(now.count ? now.revenue / now.count : 0, before ? (before.count ? before.revenue / before.count : 0) : null, P.vs)}</div>
    </div>

    <div class="section"><h2>¿Qué se vende?</h2></div>
    <div class="chips" style="margin-bottom:10px">
      <button class="chip ${metric === 'revenue' ? 'active' : ''}" data-m="revenue">En dinero (Q)</button>
      <button class="chip ${metric === 'units' ? 'active' : ''}" data-m="units">En prendas</button>
    </div>
    <div class="donuts">
      ${donut('canal', 'Por canal', data.canal)}
      ${donut('talla', 'Por talla', data.talla)}
      ${donut('tipo', 'Por tipo de prenda', data.tipo)}
      ${donut('drop', 'Por drop', data.drop)}
      ${donut('color', 'Por color', data.color)}
    </div>` : ''}

    ${can('vender') ? '<div class="btn-row"><button class="btn primary" id="q-sale">+ Nueva venta</button></div>' : ''}

    <div class="section"><h2>Últimas ventas</h2><a href="#ventas">Ver todas</a></div>
    ${state.sales.length ? `<div class="list">${state.sales.slice(0, 5).map(saleRow).join('')}</div>` : '<div class="card muted small">Aún no hay ventas. Toca el botón + para registrar la primera.</div>'}
  `;

  $$('[data-p]', page).forEach((b) => (b.onclick = () => ((preset = b.dataset.p), render(page))));
  $$('[data-m]', page).forEach((b) => (b.onclick = () => ((metric = b.dataset.m), render(page))));
  const from = $('#from', page);
  if (from) {
    from.onchange = () => ((custom.from = from.value || custom.from), render(page));
    $('#to', page).onchange = (e) => ((custom.to = e.target.value || custom.to), render(page));
  }
  $$('[data-attn]', page).forEach((b) => (b.onclick = () => attn[Number(b.dataset.attn)].go()));
  const qs = $('#q-sale', page);
  if (qs) qs.onclick = () => openNewSale();
  bindDonuts(page, data);
  bindSaleRows(page);
}

