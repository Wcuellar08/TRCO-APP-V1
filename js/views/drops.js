import { state, saveRow, deleteRow, soldLines, stockTotal } from '../db.js';
import { $, $$, esc, Q, int, today, fmtDate, sheet, toast, emptyState, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';
import { thumb, sizeChips, openProduct } from './inventory.js';

function dropStats(d) {
  const products = state.products.filter((p) => p.drop_id === d.id);
  const ids = new Set(products.map((p) => p.id));
  const { lines } = soldLines();
  const sold = lines.filter((l) => ids.has(l.product_id));
  const units = sumBy(sold, (l) => l.qty);
  const stock = sumBy(products, stockTotal);
  return { products, units, revenue: sumBy(sold, (l) => l.revenue), stock, sellThrough: units + stock ? units / (units + stock) : 0 };
}

export function render(page) {
  page.innerHTML = `
    <p class="muted small" style="margin-top:0">Agrupa tus productos por lanzamiento para ver qué colección vendió mejor y qué tan rápido se agotó.</p>
    <div class="btn-row"><button class="btn primary" id="new">+ Nuevo drop</button></div>
    <div class="section"><h2>Drops</h2></div>
    ${
      state.drops.length
        ? `<div class="list">${state.drops
            .map((d) => {
              const s = dropStats(d);
              return `<button class="row" data-id="${d.id}"><div class="row-main"><div class="row-title">${esc(d.name)}</div>
                <div class="row-sub">${d.release_date ? fmtDate(d.release_date) + ' · ' : ''}${s.products.length} productos · ${int(s.units)} vendidas · ${Math.round(s.sellThrough * 100)}% vendido</div></div>
                <div class="row-end"><b>${Q(s.revenue)}</b></div></button>`;
            })
            .join('')}</div>`
        : emptyState('Aún no tienes drops. Crea uno y asígnalo a tus productos.')
    }`;
  $('#new', page).onclick = () => openDrop();
  $$('.row[data-id]', page).forEach((b) => (b.onclick = () => openDrop(b.dataset.id)));
}

function openDrop(id) {
  const d = state.drops.find((x) => x.id === id) || { release_date: today() };
  const s = id ? dropStats(d) : null;
  sheet({
    title: id ? d.name : 'Nuevo drop',
    body: `
      ${s ? `<div class="kpis" style="margin-bottom:12px">
        <div class="kpi"><div class="k">Vendido</div><div class="v">${Q(s.revenue)}</div><div class="s">${int(s.units)} prendas</div></div>
        <div class="kpi"><div class="k">% Vendido</div><div class="v">${Math.round(s.sellThrough * 100)}%</div><div class="s">quedan ${int(s.stock)}</div></div>
      </div>` : ''}
      <form class="form" id="df">
        <label class="field"><span>Nombre</span><input name="name" required value="${esc(d.name)}" placeholder="Ej. Drop 01 · Verano 2026"></label>
        <label class="field"><span>Fecha de lanzamiento</span><input type="date" name="release_date" value="${esc(d.release_date || '')}"></label>
        <label class="field"><span>Notas</span><textarea name="notes">${esc(d.notes)}</textarea></label>
        <button class="btn primary block" type="submit">Guardar</button>
      </form>
      ${s?.products.length ? `<div class="section"><h2>Productos</h2></div><div class="list">${s.products
        .map((p) => `<button class="row" data-prod="${p.id}">${thumb(p)}<div class="row-main"><div class="row-title">${esc(p.name)}</div>${sizeChips(p)}</div><div class="row-end"><b>${int(stockTotal(p))}</b></div></button>`)
        .join('')}</div>` : id ? '<p class="muted small">Asigna productos a este drop desde Inventario.</p>' : ''}
      ${id ? '<div class="btn-row"><button class="btn danger" type="button" id="del">Eliminar drop</button></div>' : ''}`,
    onMount(root, close) {
      $$('[data-prod]', root).forEach((b) => (b.onclick = () => (close(), openProduct(b.dataset.prod))));
      $('#df', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          await saveRow('drops', { ...(id ? { id } : {}), name: f.name.value.trim(), release_date: f.release_date.value || null, notes: f.notes.value.trim() });
          toast('Drop guardado');
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      const del = $('#del', root);
      if (del)
        del.onclick = async () => {
          if (!(await confirmAction(`¿Eliminar "${d.name}"? Los productos se conservan, solo quedan sin drop.`))) return;
          await deleteRow('drops', id);
          toast('Drop eliminado');
          close();
          bus.rerender();
        };
    },
  });
}
