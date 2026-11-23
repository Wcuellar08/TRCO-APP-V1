import { state, isOwner, soldLines, dropById, customerById } from '../db.js';
import {
  $, $$, esc, Q, Qs, int, pct, today, addDays, parseYmd, ymd, startOfMonth, endOfMonth, startOfWeek, MONTHS, WEEKDAYS,
  sumBy, groupSum, barList, columnChart, bindColumnTips, downloadFile, toCSV, fmtDate,
} from '../ui.js';

let preset = 'mes';
let custom = { from: startOfMonth(), to: today() };
let metric = 'revenue'; // revenue | units

const PRESETS = {
  mes: { label: 'Este mes', range: () => [startOfMonth(), today()] },
  mes_pasado: {
    label: 'Mes pasado',
    range: () => {
      const s = startOfMonth(addDays(startOfMonth(), -1));
      return [s, endOfMonth(s)];
    },
  },
  d30: { label: '30 días', range: () => [addDays(today(), -29), today()] },
  d90: { label: '90 días', range: () => [addDays(today(), -89), today()] },
  anio: { label: 'Este año', range: () => [today().slice(0, 4) + '-01-01', today()] },
  todo: {
    label: 'Todo',
    range: () => {
      const first = state.sales.reduce((m, s) => (s.date < m ? s.date : m), today());
      return [first, today()];
    },
  },
  custom: { label: 'Elegir fechas', range: () => [custom.from, custom.to] },
};

function buckets(from, to) {
  const days = Math.round((parseYmd(to) - parseYmd(from)) / 864e5) + 1;
  if (days <= 45) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const dt = parseYmd(d);
      out.push({ key: d, label: String(dt.getDate()), tip: fmtDate(d) });
    }
    return { unit: 'día', keyOf: (d) => d, out };
  }
  if (days <= 210) {
    const out = [];
    for (let d = startOfWeek(from); d <= to; d = addDays(d, 7)) out.push({ key: d, label: fmtDate(d), tip: `Semana del ${fmtDate(d)}` });
    return { unit: 'semana', keyOf: (d) => startOfWeek(d), out };
  }
  const out = [];
  const d = parseYmd(startOfMonth(from));
  while (ymd(d) <= to) {
    out.push({ key: ymd(d).slice(0, 7), label: MONTHS[d.getMonth()], tip: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
    d.setMonth(d.getMonth() + 1);
  }
  return { unit: 'mes', keyOf: (d) => d.slice(0, 7), out };
}

const ranked = (map, extra) =>
  [...map.entries()].map(([label, value]) => ({ label: label || 'Sin dato', value, ...(extra ? extra(label) : {}) })).sort((a, b) => b.value - a.value);

export function render(page) {
  const owner = isOwner();
  const [from, to] = PRESETS[preset].range();
  const { sales, lines } = soldLines(from, to);
  const val = metric === 'revenue' ? (l) => l.revenue : (l) => l.qty;
  const fmt = metric === 'revenue' ? Qs : (v) => `${int(v)} pzs`;

  const revenue = sumBy(lines, (l) => l.revenue);
  const units = sumBy(lines, (l) => l.qty);
  const cogs = sumBy(lines, (l) => l.cost);
  const gross = revenue - cogs;
  const expenses = state.expenses.filter((e) => e.date >= from && e.date <= to);
  const expTotal = sumBy(expenses, (e) => e.amount);
  const net = gross - expTotal;
  const shippingCharged = sumBy(sales, (s) => s.shipping);
  const prodInvest = sumBy(
    state.production.filter((b) => b.ordered_date >= from && b.ordered_date <= to),
    (b) => b.total_cost
  );

  // Serie de tiempo
  const b = buckets(from, to);
  const series = groupSum(lines, (l) => b.keyOf(l.sale.date), val);
  const timeRows = b.out.map((x) => ({ label: x.label, tip: x.tip, value: series.get(x.key) || 0 }));

  // Desgloses
  const byProduct = ranked(groupSum(lines, (l) => l.product_name, val));
  const byType = ranked(groupSum(lines, (l) => l.type || l.product?.type, val));
  const bySize = ranked(groupSum(lines, (l) => l.size, val));
  const byColor = ranked(groupSum(lines, (l) => l.product?.color, val));
  const byChannel = ranked(groupSum(lines, (l) => l.sale.channel, val));
  const byDrop = ranked(groupSum(lines, (l) => dropById(l.product?.drop_id)?.name || 'Sin drop', val));
  const byPay = ranked(groupSum(lines, (l) => l.sale.payment_method, val));
  const wd = groupSum(lines, (l) => (parseYmd(l.sale.date).getDay() + 6) % 7, val);
  const byWeekday = WEEKDAYS.map((label, i) => ({ label, value: wd.get(i) || 0 }));
  const byCustomer = ranked(
    groupSum(lines.filter((l) => l.sale.customer_id), (l) => l.sale.customer_id, val)
  ).map((r) => ({ ...r, label: customerById(r.label)?.name || 'Cliente borrado' }));
  const byExpense = ranked(groupSum(expenses, (e) => e.category, (e) => e.amount));
  const marginByProduct = owner
    ? ranked(groupSum(lines, (l) => l.product_name, (l) => l.revenue - l.cost))
    : [];

  const bestDay = [...byWeekday].sort((a, b2) => b2.value - a.value)[0];
  const bestSize = bySize[0];

  page.innerHTML = `
    <div class="chips" style="margin-top:-4px">
      ${Object.entries(PRESETS).map(([k, p]) => `<button class="chip ${preset === k ? 'active' : ''}" data-p="${k}">${p.label}</button>`).join('')}
    </div>
    ${preset === 'custom' ? `<div class="grid2" style="margin-top:10px">
      <label class="field"><span>Desde</span><input type="date" id="from" value="${from}"></label>
      <label class="field"><span>Hasta</span><input type="date" id="to" value="${to}"></label></div>` : ''}
    <p class="muted small" style="margin:8px 0 14px">${fmtDate(from)} – ${fmtDate(to)}</p>

    <div class="kpis">
      <div class="kpi hero accent"><div class="k">Ventas</div><div class="v">${Q(revenue)}</div>
        <div class="s">${int(sales.length)} ventas · ${int(units)} prendas</div></div>
      <div class="kpi"><div class="k">Ticket promedio</div><div class="v">${Q(sales.length ? revenue / sales.length : 0)}</div><div class="s">por venta</div></div>
      <div class="kpi"><div class="k">Prendas por venta</div><div class="v">${sales.length ? (units / sales.length).toFixed(1) : '0'}</div><div class="s">promedio</div></div>
    </div>

    ${owner ? `
    <div class="section"><h2>Ganancias</h2></div>
    <div class="card">
      <div class="kv"><span>Ventas (sin envío)</span><span>${Q(revenue)}</span></div>
      <div class="kv"><span>− Costo de prendas vendidas</span><span>${Q(cogs)}</span></div>
      <div class="kv total"><span>Ganancia bruta</span><span>${Q(gross)} <span class="muted small">(${pct(revenue ? gross / revenue : 0)})</span></span></div>
      <div class="kv"><span>− Gastos del negocio</span><span>${Q(expTotal)}</span></div>
      <div class="kv total"><span>Ganancia neta</span><span style="color:${net < 0 ? 'var(--danger)' : 'var(--accent)'}">${Q(net)} <span class="muted small">(${pct(revenue ? net / revenue : 0)})</span></span></div>
      <p class="muted small" style="margin:10px 0 0">Envíos cobrados a clientes: ${Q(shippingCharged)}. Invertido en producción en este periodo: ${Q(prodInvest)} (es inventario, no gasto: se cuenta como costo cuando la prenda se vende).</p>
    </div>` : ''}

    <div class="section"><h2>Ver por</h2></div>
    <div class="chips">
      <button class="chip ${metric === 'revenue' ? 'active' : ''}" data-m="revenue">Dinero (Q)</button>
      <button class="chip ${metric === 'units' ? 'active' : ''}" data-m="units">Prendas</button>
    </div>

    <div class="section"><h2>Ventas por ${b.unit}</h2></div>
    <div class="card">${columnChart(timeRows, { fmt })}</div>

    ${lines.length ? `<div class="alert info" style="margin-top:14px">
      💡 Tu mejor día es el <b>${esc(bestDay.label.toLowerCase())}</b>${bestSize ? ` y la talla que más sale es la <b>${esc(bestSize.label)}</b>` : ''}${byChannel[0] ? `. Vendes más por <b>${esc(byChannel[0].label)}</b>` : ''}.</div>` : ''}

    <div class="section"><h2>Productos más vendidos</h2></div>
    <div class="card">${barList(byProduct, { fmt, max: 10 })}</div>
    <div class="section"><h2>Por tipo de prenda</h2></div>
    <div class="card">${barList(byType, { fmt })}</div>
    <div class="section"><h2>Por talla</h2></div>
    <div class="card">${barList(bySize, { fmt, max: 10 })}</div>
    <div class="section"><h2>Por color</h2></div>
    <div class="card">${barList(byColor, { fmt })}</div>
    <div class="section"><h2>Por día de la semana</h2></div>
    <div class="card">${barList(byWeekday, { fmt, max: 7 })}</div>
    <div class="section"><h2>Por canal de venta</h2></div>
    <div class="card">${barList(byChannel, { fmt })}</div>
    <div class="section"><h2>Por drop / colección</h2></div>
    <div class="card">${barList(byDrop, { fmt })}</div>
    <div class="section"><h2>Por método de pago</h2></div>
    <div class="card">${barList(byPay, { fmt })}</div>
    <div class="section"><h2>Mejores clientes</h2></div>
    <div class="card">${barList(byCustomer, { fmt, max: 10 })}</div>
    ${owner ? `
    <div class="section"><h2>Ganancia por producto</h2></div>
    <div class="card">${barList(marginByProduct, { fmt: Qs, max: 10 })}</div>
    <div class="section"><h2>Gastos por categoría</h2><a href="#/gastos">Gastos</a></div>
    <div class="card">${barList(byExpense, { fmt: Qs })}</div>` : ''}

    <div class="btn-row"><button class="btn" id="csv">Descargar ventas (Excel / CSV)</button></div>
  `;

  $$('[data-p]', page).forEach((el) => (el.onclick = () => ((preset = el.dataset.p), render(page))));
  $$('[data-m]', page).forEach((el) => (el.onclick = () => ((metric = el.dataset.m), render(page))));
  const f = $('#from', page);
  if (f) {
    f.onchange = () => ((custom.from = f.value || custom.from), render(page));
    $('#to', page).onchange = (e) => ((custom.to = e.target.value || custom.to), render(page));
  }
  bindColumnTips(page);

  $('#csv', page).onclick = () => {
    const cols = [
      { label: 'Fecha', get: (l) => l.sale.date },
      { label: 'Cliente', get: (l) => customerById(l.sale.customer_id)?.name || '' },
      { label: 'Producto', get: (l) => l.product_name },
      { label: 'Tipo', get: (l) => l.type || '' },
      { label: 'Color', get: (l) => l.product?.color || '' },
      { label: 'Talla', get: (l) => l.size },
      { label: 'Cantidad', get: (l) => l.qty },
      { label: 'Precio unitario', get: (l) => l.unit_price },
      { label: 'Ingreso (con descuento)', get: (l) => l.revenue.toFixed(2) },
      ...(owner ? [{ label: 'Costo', get: (l) => l.cost.toFixed(2) }, { label: 'Ganancia', get: (l) => (l.revenue - l.cost).toFixed(2) }] : []),
      { label: 'Canal', get: (l) => l.sale.channel || '' },
      { label: 'Pago', get: (l) => l.sale.payment_method || '' },
      { label: 'Estado', get: (l) => l.sale.status },
      { label: 'Drop', get: (l) => dropById(l.product?.drop_id)?.name || '' },
    ];
    downloadFile(`TRCO-ventas-${from}-a-${to}.csv`, toCSV(lines, cols), 'text/csv;charset=utf-8');
  };
}

