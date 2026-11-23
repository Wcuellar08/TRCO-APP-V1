import { state, isOwner, soldLines, lowStock, isPending, saleBalance, productById, batchQty, CLOUD } from '../db.js';
import { $, $$, esc, Q, int, today, startOfMonth, startOfWeek, addDays, fmtDate, sumBy, groupSum, barList, pct } from '../ui.js';
import { saleRow, bindSaleRows, openNewSale, setFilter } from './sales.js';
import { openProduct } from './inventory.js';

function periodStats(from, to) {
  const { sales, lines } = soldLines(from, to);
  const revenue = sumBy(lines, (l) => l.revenue);
  const cost = sumBy(lines, (l) => l.cost);
  return { count: sales.length, units: sumBy(lines, (l) => l.qty), revenue, cost, lines };
}

export function render(page) {
  const owner = isOwner();
  const t = today();
  const day = periodStats(t, t);
  const week = periodStats(startOfWeek(t), t);
  const month = periodStats(startOfMonth(t), t);
  // Mismo número de días del mes pasado, para comparar justo.
  const lmStart = startOfMonth(addDays(startOfMonth(t), -1));
  const dayOfMonth = Number(t.slice(8));
  const lastDayPrev = addDays(startOfMonth(t), -1);
  const lmEnd = addDays(lmStart, dayOfMonth - 1) < lastDayPrev ? addDays(lmStart, dayOfMonth - 1) : lastDayPrev;
  const lastMonth = periodStats(lmStart, lmEnd);
  const change = lastMonth.revenue ? (month.revenue - lastMonth.revenue) / lastMonth.revenue : null;

  const monthExpenses = sumBy(state.expenses.filter((e) => e.date >= startOfMonth(t) && e.date <= t), (e) => e.amount);
  const net = month.revenue - month.cost - monthExpenses;

  const low = lowStock();
  const pending = state.sales.filter(isPending);
  const owed = sumBy(pending.filter((s) => s.status !== 'cancelado'), saleBalance);
  const incoming = state.production.filter((b) => b.status !== 'recibido');

  const top = [...groupSum(month.lines, (l) => l.product_name, (l) => l.qty).entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const hello = state.profile?.name ? `Hola, ${esc(state.profile.name.split(' ')[0])}` : 'Hola';

  page.innerHTML = `
    ${!CLOUD && !state.products.length ? `<div class="alert info" style="margin-bottom:14px">
      Estás en <b>modo demo</b>: los datos se guardan solo en este dispositivo.
      ¿Quieres ver la app con datos de ejemplo? <a href="#ajustes">Cárgalos en Ajustes</a>.</div>` : ''}
    <p class="muted" style="margin:0 0 12px">${hello} 👋</p>
    <div class="kpis">
      <div class="kpi hero accent">
        <div class="k">Ventas de este mes</div>
        <div class="v">${Q(month.revenue)}</div>
        <div class="s">${int(month.units)} prendas · ${int(month.count)} ventas${
          change !== null ? ` · ${change >= 0 ? '▲' : '▼'} ${pct(Math.abs(change))} vs. mes pasado` : ''
        }</div>
      </div>
      <div class="kpi"><div class="k">Hoy</div><div class="v">${Q(day.revenue)}</div><div class="s">${int(day.units)} prendas</div></div>
      <div class="kpi"><div class="k">Esta semana</div><div class="v">${Q(week.revenue)}</div><div class="s">${int(week.units)} prendas</div></div>
      ${owner ? `
      <div class="kpi"><div class="k">Ganancia neta (mes)</div><div class="v ${net < 0 ? 'neg' : ''}">${Q(net)}</div><div class="s">después de costos y gastos</div></div>
      <div class="kpi"><div class="k">Por cobrar</div><div class="v">${Q(owed)}</div><div class="s">${pending.filter((s) => saleBalance(s) > 0.009).length} ventas con saldo</div></div>` : ''}
    </div>

    <div class="quick">
      <button class="btn primary" id="q-sale">+ Venta</button>
      <a class="btn" href="#reportes">Ver reportes</a>
    </div>

    ${pending.length ? `
    <div class="section"><h2>Pendientes (${pending.length})</h2><a href="#ventas" id="see-pending">Ver todos</a></div>
    <div class="list">${pending.slice(0, 5).map(saleRow).join('')}</div>` : ''}

    <div class="section"><h2>Stock bajo${low.length ? ` (${low.length})` : ''}</h2><a href="#inventario">Inventario</a></div>
    ${
      low.length
        ? `<div class="list">${low
            .slice(0, 8)
            .map(
              (l) => `<button class="row" data-prod="${l.product.id}">
              <div class="row-main"><div class="row-title">${esc(l.product.name)}</div><div class="row-sub">${esc(l.product.color || l.product.type || '')} · Talla ${esc(l.size)}</div></div>
              <div class="row-end">${l.qty <= 0 ? '<span class="badge danger">Agotada</span>' : `<span class="badge warn">Quedan ${l.qty}</span>`}</div>
            </button>`
            )
            .join('')}</div>${low.length > 8 ? `<p class="muted small">Y ${low.length - 8} más…</p>` : ''}`
        : '<div class="card muted small">Todo bien: ninguna talla está por agotarse.</div>'
    }

    ${incoming.length ? `
    <div class="section"><h2>Producción en camino</h2><a href="#produccion">Ver</a></div>
    <div class="list">${incoming
      .slice(0, 4)
      .map((b) => {
        const p = productById(b.product_id);
        const late = b.expected_date && b.expected_date < t;
        return `<a class="row" href="#produccion"><div class="row-main"><div class="row-title">${esc(p?.name || 'Producto')}</div>
          <div class="row-sub">${int(batchQty(b))} prendas · ${esc(b.supplier || 'Proveedor')}</div></div>
          <div class="row-end">${b.expected_date ? `<span class="badge ${late ? 'danger' : 'info'}">${late ? 'Atrasado · ' : 'Llega '}${fmtDate(b.expected_date)}</span>` : ''}</div></a>`;
      })
      .join('')}</div>` : ''}

    <div class="section"><h2>Lo más vendido del mes</h2></div>
    <div class="card">${barList(top, { max: 5, fmt: (v) => `${int(v)} pzs` })}</div>

    <div class="section"><h2>Últimas ventas</h2><a href="#ventas">Ver todas</a></div>
    ${state.sales.length ? `<div class="list">${state.sales.slice(0, 5).map(saleRow).join('')}</div>` : '<div class="card muted small">Aún no hay ventas. Toca el botón + para registrar la primera.</div>'}
  `;

  $('#q-sale', page).onclick = () => openNewSale();
  const sp = $('#see-pending', page);
  if (sp) sp.onclick = () => setFilter('pendientes');
  $$('[data-prod]', page).forEach((b) => (b.onclick = () => openProduct(b.dataset.prod)));
  bindSaleRows(page);
}
