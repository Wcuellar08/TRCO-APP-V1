import { state, saveRow, deleteRow, saleBalance } from '../db.js';
import { $, $$, esc, Q, int, fmtDate, sheet, toast, emptyState, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';
import { saleRow, bindSaleRows, openNewSale } from './sales.js';

let query = '';
let sort = 'gasto';

function stats(c) {
  const sales = state.sales.filter((s) => s.customer_id === c.id && s.status !== 'cancelado');
  return {
    sales,
    count: sales.length,
    spent: sumBy(sales, (s) => s.total),
    owed: sumBy(sales, saleBalance),
    last: sales.reduce((m, s) => (s.date > m ? s.date : m), ''),
  };
}

export function render(page) {
  const q = query.toLowerCase();
  const rows = state.customers
    .filter((c) => !q || [c.name, c.instagram, c.phone, c.city].join(' ').toLowerCase().includes(q))
    .map((c) => ({ c, ...stats(c) }));
  if (sort === 'gasto') rows.sort((a, b) => b.spent - a.spent);
  if (sort === 'reciente') rows.sort((a, b) => b.last.localeCompare(a.last));
  if (sort === 'nombre') rows.sort((a, b) => a.c.name.localeCompare(b.c.name, 'es'));
  const repeat = rows.filter((r) => r.count > 1).length;

  page.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k">Clientes</div><div class="v">${int(state.customers.length)}</div></div>
      <div class="kpi"><div class="k">Recompran</div><div class="v">${int(repeat)}</div><div class="s">compraron 2+ veces</div></div>
    </div>
    <div class="btn-row"><button class="btn primary" id="new">+ Nuevo cliente</button></div>
    <div class="section"><h2>Lista</h2></div>
    <input class="search" type="search" id="q" placeholder="Buscar nombre, @instagram, teléfono…" value="${esc(query)}">
    <div class="chips" style="margin-bottom:10px">
      ${[['gasto', 'Más compran'], ['reciente', 'Recientes'], ['nombre', 'A–Z']]
        .map(([k, l]) => `<button class="chip ${sort === k ? 'active' : ''}" data-s="${k}">${l}</button>`)
        .join('')}
    </div>
    ${
      rows.length
        ? `<div class="list">${rows
            .map(
              (r) => `<button class="row" data-id="${r.c.id}">
            <div class="row-main"><div class="row-title">${esc(r.c.name)}</div>
              <div class="row-sub">${esc([r.c.instagram && '@' + r.c.instagram, r.c.phone, r.c.city].filter(Boolean).join(' · ') || '—')}</div></div>
            <div class="row-end"><div><b>${Q(r.spent)}</b></div><div class="row-sub">${r.count} compra${r.count === 1 ? '' : 's'}${r.owed > 0 ? ' · <span style="color:var(--danger)">debe</span>' : ''}</div></div>
          </button>`
            )
            .join('')}</div>`
        : emptyState(state.customers.length ? 'Nadie coincide con la búsqueda.' : 'Aún no tienes clientes. Se agregan aquí o al registrar una venta.')
    }`;
  $('#new', page).onclick = () => openCustomer();
  $$('[data-s]', page).forEach((b) => (b.onclick = () => ((sort = b.dataset.s), render(page))));
  $$('.row[data-id]', page).forEach((b) => (b.onclick = () => openCustomer(b.dataset.id)));
  const qi = $('#q', page);
  qi.oninput = () => {
    query = qi.value;
    render(page);
    const again = $('#q', page);
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  };
}

export function openCustomer(id) {
  const c = state.customers.find((x) => x.id === id) || {};
  const st = id ? stats(c) : null;
  const ig = c.instagram ? c.instagram.replace(/^@/, '') : '';
  const phone = (c.phone || '').replace(/\D/g, '');
  sheet({
    title: id ? c.name : 'Nuevo cliente',
    body: `
      ${id ? `
      <div class="kpis" style="margin-bottom:12px">
        <div class="kpi"><div class="k">Ha gastado</div><div class="v">${Q(st.spent)}</div><div class="s">${st.count} compras</div></div>
        <div class="kpi"><div class="k">Última compra</div><div class="v" style="font-size:20px">${st.last ? fmtDate(st.last) : '—'}</div>${st.owed > 0 ? `<div class="s" style="color:var(--danger)">Debe ${Q(st.owed)}</div>` : ''}</div>
      </div>
      <div class="btn-row" style="margin:0 0 14px">
        ${ig ? `<a class="btn sm" href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener">Instagram</a>` : ''}
        ${phone ? `<a class="btn sm" href="https://wa.me/${phone.length === 8 ? '502' + phone : phone}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button class="btn sm primary" id="sell" type="button">+ Venta</button>
      </div>` : ''}
      <form class="form" id="cf">
        <label class="field"><span>Nombre</span><input name="name" required value="${esc(c.name)}"></label>
        <div class="grid2">
          <label class="field"><span>Instagram</span><input name="instagram" value="${esc(ig)}" placeholder="usuario" autocapitalize="none"></label>
          <label class="field"><span>Teléfono</span><input name="phone" inputmode="tel" value="${esc(c.phone)}"></label>
        </div>
        <label class="field"><span>Ciudad / dirección</span><input name="city" value="${esc(c.city)}"></label>
        <label class="field"><span>Notas</span><textarea name="notes" placeholder="Talla que usa, gustos…">${esc(c.notes)}</textarea></label>
        <button class="btn primary block" type="submit">Guardar</button>
      </form>
      ${id && st.sales.length ? `<div class="section"><h2>Historial de compras</h2></div><div class="list">${st.sales.map(saleRow).join('')}</div>` : ''}
      ${id ? `<div class="btn-row"><button class="btn danger" id="del" type="button">Eliminar cliente</button></div>` : ''}`,
    onMount(root, close) {
      bindSaleRows(root);
      const sell = $('#sell', root);
      if (sell) sell.onclick = () => (close(), openNewSale({ customerId: id }));
      $('#cf', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          await saveRow('customers', {
            ...(id ? { id } : {}),
            name: f.name.value.trim(),
            instagram: f.instagram.value.trim().replace(/^@/, ''),
            phone: f.phone.value.trim(),
            city: f.city.value.trim(),
            notes: f.notes.value.trim(),
          });
          toast('Cliente guardado');
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      const del = $('#del', root);
      if (del)
        del.onclick = async () => {
          if (!(await confirmAction(`¿Eliminar a ${c.name}? Sus ventas se conservan sin cliente.`))) return;
          try {
            await deleteRow('customers', id);
            toast('Cliente eliminado');
            close();
            bus.rerender();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
    },
  });
}
