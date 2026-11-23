import { state, can, saveRow, deleteRow, receiveProduction, productById, batchQty, unitCostOf, PROD_STATUS, sizesOf, allocatePreorders } from '../db.js';
import { showAllocated } from './preorders.js';
import { $, $$, esc, Q, int, num, today, fmtDate, sheet, toast, options, emptyState, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';
import { openLabels } from '../labels.js';

export function render(page) {
  const owner = can('costos');
  const open = state.production.filter((b) => b.status !== 'recibido');
  const done = state.production.filter((b) => b.status === 'recibido');
  const row = (b) => {
    const p = productById(b.product_id);
    const st = PROD_STATUS[b.status] || PROD_STATUS.en_produccion;
    const late = b.status !== 'recibido' && b.expected_date && b.expected_date < today();
    return `<button class="row" data-id="${b.id}">
      <div class="row-main"><div class="row-title">${esc(p?.name || 'Producto eliminado')}</div>
        <div class="row-sub">${int(batchQty(b))} prendas · ${esc(b.supplier || 'Sin proveedor')}</div>
        <div class="row-sub">${b.status === 'recibido' ? `Recibido ${fmtDate(b.received_date)}` : b.expected_date ? `Llega ${fmtDate(b.expected_date)}` : `Pedido ${fmtDate(b.ordered_date)}`}</div></div>
      <div class="row-end">${owner ? `<div><b>${Q(b.total_cost)}</b></div>` : ''}<div style="margin-top:3px"><span class="badge ${late ? 'danger' : st.cls}">${late ? 'Atrasado' : st.label}</span></div></div>
    </button>`;
  };
  page.innerHTML = `
    <p class="muted small" style="margin-top:0">Registra lo que mandas a hacer (playeras en blanco, estampado, etc.). Cuando llegue, márcalo como recibido y se suma solo al inventario.</p>
    <div class="kpis">
      <div class="kpi"><div class="k">En producción</div><div class="v">${int(sumBy(open, batchQty))}</div><div class="s">${open.length} lotes</div></div>
      ${owner ? `<div class="kpi"><div class="k">Invertido</div><div class="v">${Q(sumBy(open, (b) => b.total_cost))}</div><div class="s">en lotes pendientes</div></div>` : ''}
    </div>
    ${can('produccion') ? '<div class="btn-row"><button class="btn primary" id="new">+ Nuevo lote</button></div>' : ''}
    <div class="section"><h2>Pendientes</h2></div>
    ${open.length ? `<div class="list">${open.map(row).join('')}</div>` : '<div class="card muted small">No hay producción pendiente.</div>'}
    <div class="section"><h2>Recibidos</h2></div>
    ${done.length ? `<div class="list">${done.slice(0, 30).map(row).join('')}</div>` : emptyState('Aún no hay lotes recibidos.')}`;
  const nb = $('#new', page);
  if (nb) nb.onclick = () => openBatch();
  $$('.row[data-id]', page).forEach((b) => (b.onclick = () => openBatch(b.dataset.id)));
}

export function openBatch(id, preset = {}) {
  if (!state.products.length) {
    toast('Primero crea el producto en Inventario');
    return bus.go('inventario');
  }
  const owner = can('costos');
  const editable = can('produccion');
  const b = state.production.find((x) => x.id === id) || { quantities: {}, ordered_date: today(), status: 'en_produccion', ...preset };
  const received = b.status === 'recibido';
  const sizesFor = (pid) => {
    const p = productById(pid);
    return p ? sizesOf(p) : state.settings.sizes;
  };

  sheet({
    title: id ? 'Lote de producción' : 'Nuevo lote',
    body: `
      ${received ? '<div class="alert info" style="margin-bottom:12px">Este lote ya se recibió y se sumó al inventario.</div>' : ''}
      <form class="form" id="bf"><fieldset class="readonly form" ${editable ? '' : 'disabled'}>
        <label class="field"><span>Producto</span><select name="product_id" required ${received ? 'disabled' : ''}>${options(
          state.products.map((p) => ({ value: p.id, label: p.name + (p.color ? ' · ' + p.color : '') })),
          b.product_id,
          { empty: 'Elige producto…' }
        )}</select></label>
        <label class="field"><span>Proveedor / taller</span><input name="supplier" value="${esc(b.supplier)}" placeholder="Ej. Serigrafía López"></label>
        <div class="field"><span>Cantidad por talla</span><div class="size-grid" id="qty-grid"></div></div>
        ${owner ? `<label class="field"><span>Costo total del lote (Q)</span><input name="total_cost" inputmode="decimal" value="${esc(b.total_cost ?? '')}" placeholder="0">
          <span class="hint" id="unit-cost"></span></label>` : ''}
        <div class="grid2">
          <label class="field"><span>Fecha de pedido</span><input type="date" name="ordered_date" value="${esc(b.ordered_date || '')}"></label>
          <label class="field"><span>Fecha de entrega</span><input type="date" name="expected_date" value="${esc(b.expected_date || '')}"></label>
        </div>
        <label class="field"><span>Notas</span><textarea name="notes">${esc(b.notes)}</textarea></label>
        ${editable ? `<button class="btn primary block" type="submit">Guardar</button>
        ${id && !received ? '<button class="btn block" type="button" id="receive">✓ Marcar como recibido</button>' : ''}
        ${id ? '<button class="btn danger block" type="button" id="del">Eliminar lote</button>' : ''}` : '<p class="muted small">Solo lectura. Para gestionar producción necesitas el permiso "Producción".</p>'}
      </fieldset></form>`,
    onMount(root, close) {
      const f = $('#bf', root);
      const drawGrid = () => {
        const sizes = sizesFor(f.product_id.value);
        const current = Object.fromEntries($$('[data-q]', root).map((i) => [i.dataset.q, i.value]));
        $('#qty-grid', root).innerHTML = sizes
          .map(
            (s) => `<label><span>${esc(s)}</span><input data-q="${esc(s)}" inputmode="numeric" placeholder="0" ${received ? 'disabled' : ''}
              value="${esc(current[s] ?? b.quantities?.[s] ?? '')}"></label>`
          )
          .join('');
        $$('[data-q]', root).forEach((i) => (i.oninput = updateUnit));
        updateUnit();
      };
      const qtys = () => {
        const q = {};
        $$('[data-q]', root).forEach((i) => num(i.value) > 0 && (q[i.dataset.q] = Math.round(num(i.value))));
        return q;
      };
      const updateUnit = () => {
        const el = $('#unit-cost', root);
        if (!el) return;
        const total = num(f.total_cost.value);
        const q = batchQty({ quantities: qtys() });
        el.textContent = q && total ? `${int(q)} prendas · ${Q(total / q)} por prenda` : '';
      };
      f.product_id.onchange = drawGrid;
      if (f.total_cost) f.total_cost.oninput = updateUnit;
      drawGrid();

      f.onsubmit = async (e) => {
        e.preventDefault();
        const row = {
          ...(id ? { id } : {}),
          supplier: f.supplier.value.trim(),
          ordered_date: f.ordered_date.value || null,
          expected_date: f.expected_date.value || null,
          notes: f.notes.value.trim(),
        };
        if (!received) {
          row.product_id = f.product_id.value;
          row.quantities = qtys();
          if (!batchQty(row)) return toast('Escribe cuántas prendas por talla', 'error');
        }
        if (owner) row.total_cost = num(f.total_cost.value);
        try {
          await saveRow('production', row);
          toast('Lote guardado');
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      const rec = $('#receive', root);
      if (rec)
        rec.onclick = async () => {
          const p = productById(b.product_id);
          if (!(await confirmAction(`¿Recibiste ${batchQty(b)} prendas de "${p?.name}"? Se sumarán al inventario.`, { ok: 'Sí, recibido' }))) return;
          let updateCost = false;
          if (owner && can('inventario') && Number(b.total_cost) > 0 && p && Number(p.cost) !== unitCostOf(b)) {
            updateCost = await confirmAction(`¿Actualizar el costo por prenda de "${p.name}" a ${Q(unitCostOf(b))}? (Ahora es ${Q(p.cost)})`, { ok: 'Actualizar' });
          }
          try {
            await receiveProduction(id, { updateCost });
            toast('Inventario actualizado');
            close();
            bus.rerender();
            // Si hay preventas de este producto, se apartan primero (por orden de llegada).
            if (state.sales.some((s) => s.status === 'preventa')) {
              try {
                const r = await allocatePreorders(b.product_id);
                if (r.done.length) {
                  bus.rerender();
                  showAllocated(r);
                  return;
                }
              } catch (err) {
                toast('No se pudieron apartar las preventas: ' + err.message, 'error');
              }
            }
            const fresh = productById(b.product_id);
            if (fresh && can('inventario') && (await confirmAction(`¿Imprimir las ${batchQty(b)} etiquetas QR de lo que llegó?`, { ok: 'Imprimir etiquetas' })))
              openLabels(fresh, b.quantities);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      const del = $('#del', root);
      if (del)
        del.onclick = async () => {
          if (!(await confirmAction(received ? '¿Eliminar este registro? (El inventario ya sumado NO se resta.)' : '¿Eliminar este lote?'))) return;
          try {
            await deleteRow('production', id);
            toast('Lote eliminado');
            close();
            bus.rerender();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
    },
  });
}
