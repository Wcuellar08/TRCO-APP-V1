import { state, isOwner, saveRow, deleteRow, adjustStock, stockTotal, sizesOf, dropById, soldLines } from '../db.js';
import { $, $$, esc, Q, int, num, sheet, toast, options, emptyState, resizeImage, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';

let query = '';
let typeFilter = '';
let showInactive = false;

export function thumb(p, cls = '') {
  return p?.photo
    ? `<div class="thumb ${cls}" style="background-image:url('${p.photo}')"></div>`
    : `<div class="thumb ${cls}">TRCO</div>`;
}

export function sizeChips(p) {
  const min = Number(p.min_stock ?? 2);
  return `<div class="sizes">${sizesOf(p)
    .filter((s) => s in (p.stock || {}))
    .map((s) => {
      const n = Number(p.stock[s]) || 0;
      return `<span class="size ${n <= 0 ? 'out' : n <= min ? 'low' : ''}">${esc(s)} ${n}</span>`;
    })
    .join('')}</div>`;
}

export function render(page) {
  const owner = isOwner();
  const active = state.products.filter((p) => p.active !== false);
  const units = sumBy(active, stockTotal);
  const costValue = sumBy(active, (p) => stockTotal(p) * (Number(p.cost) || 0));
  const retailValue = sumBy(active, (p) => stockTotal(p) * (Number(p.price) || 0));
  const types = [...new Set(state.products.map((p) => p.type).filter(Boolean))];

  const q = query.toLowerCase();
  const list = state.products.filter(
    (p) =>
      (showInactive || p.active !== false) &&
      (!typeFilter || p.type === typeFilter) &&
      (!q || [p.name, p.color, p.type, dropById(p.drop_id)?.name].join(' ').toLowerCase().includes(q))
  );

  page.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k">Prendas en stock</div><div class="v">${int(units)}</div><div class="s">${active.length} productos</div></div>
      <div class="kpi"><div class="k">Valor a precio</div><div class="v">${Q(retailValue)}</div>${owner ? `<div class="s">Costo: ${Q(costValue)}</div>` : ''}</div>
    </div>
    <div class="btn-row"><button class="btn primary" id="new-product">+ Nuevo producto</button></div>
    <div class="section"><h2>Productos</h2>
      <button class="btn-text" id="toggle-inactive">${showInactive ? 'Ocultar inactivos' : 'Ver inactivos'}</button></div>
    <input class="search" type="search" id="q" placeholder="Buscar por nombre, color, drop…" value="${esc(query)}">
    ${types.length > 1 ? `<div class="chips" style="margin-bottom:10px">
      <button class="chip ${!typeFilter ? 'active' : ''}" data-type="">Todos</button>
      ${types.map((t) => `<button class="chip ${typeFilter === t ? 'active' : ''}" data-type="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>` : ''}
    ${
      list.length
        ? `<div class="list">${list
            .map(
              (p) => `<button class="row" data-id="${p.id}">
              ${thumb(p)}
              <div class="row-main">
                <div class="row-title">${esc(p.name)}${p.active === false ? ' <span class="badge muted">Inactivo</span>' : ''}</div>
                <div class="row-sub">${esc([p.type, p.color, dropById(p.drop_id)?.name].filter(Boolean).join(' · '))}</div>
                ${sizeChips(p)}
              </div>
              <div class="row-end"><div><b>${int(stockTotal(p))}</b></div><div class="row-sub">${Q(p.price)}</div></div>
            </button>`
            )
            .join('')}</div>`
        : emptyState(state.products.length ? 'No hay productos con ese filtro.' : 'Aún no tienes productos. Agrega tu primera playera.')
    }`;

  $('#new-product', page).onclick = () => openProduct();
  $('#toggle-inactive', page).onclick = () => {
    showInactive = !showInactive;
    render(page);
  };
  const qi = $('#q', page);
  qi.oninput = () => {
    query = qi.value;
    render(page);
    const again = $('#q', page);
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  };
  $$('[data-type]', page).forEach((b) => (b.onclick = () => ((typeFilter = b.dataset.type), render(page))));
  $$('.row[data-id]', page).forEach((b) => (b.onclick = () => openProduct(b.dataset.id)));
}

export function openProduct(id) {
  const p = state.products.find((x) => x.id === id) || { active: true, min_stock: 2, stock: {}, type: state.settings.types[0] };
  const owner = isOwner();
  const sizes = sizesOf(p);
  let photo = p.photo || '';
  const { lines } = soldLines();
  const sold = sumBy(lines.filter((l) => l.product_id === p.id), (l) => l.qty);

  sheet({
    title: id ? p.name : 'Nuevo producto',
    body: `
      <form class="form" id="pf">
        <label class="photo-pick">
          <div id="photo-prev">${thumb({ photo }, 'lg')}</div>
          <input type="file" accept="image/*" id="photo-in" aria-label="Foto del producto">
          <span class="hint muted small" style="display:block;text-align:center;margin-top:6px">Toca para ${photo ? 'cambiar' : 'agregar'} la foto</span>
        </label>
        <label class="field"><span>Nombre</span><input name="name" required value="${esc(p.name)}" placeholder="Ej. Tee Logo Clásico"></label>
        <div class="grid2">
          <label class="field"><span>Tipo</span><select name="type">${options(state.settings.types, p.type)}</select></label>
          <label class="field"><span>Color</span><input name="color" value="${esc(p.color)}" placeholder="Negro"></label>
        </div>
        <label class="field"><span>Drop / colección</span><select name="drop_id">${options(
          state.drops.map((d) => ({ value: d.id, label: d.name })),
          p.drop_id,
          { empty: '— Sin drop —' }
        )}</select></label>
        <div class="grid2">
          <label class="field"><span>Precio venta (Q)</span><input name="price" inputmode="decimal" required value="${esc(p.price ?? '')}" placeholder="175"></label>
          ${owner ? `<label class="field"><span>Costo unidad (Q)</span><input name="cost" inputmode="decimal" value="${esc(p.cost ?? '')}" placeholder="60"></label>` : ''}
        </div>
        ${owner && p.price ? `<p class="muted small" style="margin:-4px 0 0">Ganancia por prenda: <b>${Q(num(p.price) - num(p.cost))}</b> (${Math.round(((num(p.price) - num(p.cost)) / num(p.price)) * 100)}% margen)</p>` : ''}
        <div class="field"><span>Inventario por talla</span>
          <div class="size-grid">${sizes
            .map(
              (s) => `<label><span>${esc(s)}</span><input data-size="${esc(s)}" inputmode="numeric" value="${s in (p.stock || {}) ? esc(p.stock[s]) : ''}" placeholder="—"></label>`
            )
            .join('')}</div>
          <span class="hint">Deja vacía la talla que no manejas. 0 = agotada.</span>
        </div>
        <label class="field"><span>Alerta de stock bajo</span><input name="min_stock" inputmode="numeric" value="${esc(p.min_stock ?? 2)}">
          <span class="hint">Te avisa cuando una talla tenga esta cantidad o menos.</span></label>
        <label class="field"><span>Notas</span><textarea name="notes" placeholder="Tela, proveedor, detalles del estampado…">${esc(p.notes)}</textarea></label>
        <label class="check"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Producto activo (a la venta)</label>
        ${id ? `<p class="muted small">Vendidas en total: <b>${int(sold)}</b></p>` : ''}
        <button class="btn primary block" type="submit">Guardar</button>
        ${id ? `<button class="btn danger block" type="button" id="del">Eliminar producto</button>` : ''}
      </form>`,
    onMount(root, close) {
      $('#photo-in', root).onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          photo = await resizeImage(f);
          $('#photo-prev', root).innerHTML = thumb({ photo }, 'lg');
        } catch {
          toast('No se pudo leer la imagen', 'error');
        }
      };
      $('#pf', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const btn = f.querySelector('[type=submit]');
        const newStock = {};
        $$('[data-size]', root).forEach((i) => {
          if (i.value.trim() !== '') newStock[i.dataset.size] = Math.round(num(i.value));
        });
        const row = {
          name: f.name.value.trim(),
          type: f.type.value,
          color: f.color.value.trim(),
          drop_id: f.drop_id.value || null,
          price: num(f.price.value),
          min_stock: Math.round(num(f.min_stock.value)),
          notes: f.notes.value.trim(),
          active: f.active.checked,
          photo: photo || null,
        };
        if (owner) row.cost = num(f.cost.value);
        btn.disabled = true;
        try {
          if (!id) {
            await saveRow('products', { ...row, stock: newStock });
          } else {
            const old = p.stock || {};
            const removed = Object.keys(old).some((k) => !(k in newStock));
            if (removed) row.stock = newStock;
            await saveRow('products', { id, ...row });
            if (!removed) {
              for (const [s, n] of Object.entries(newStock)) {
                const d = n - (Number(old[s]) || 0);
                if (d !== 0 || !(s in old)) await adjustStock(id, s, d);
              }
            }
          }
          toast('Producto guardado');
          close();
          bus.rerender();
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'error');
        }
      };
      const del = $('#del', root);
      if (del)
        del.onclick = async () => {
          if (!(await confirmAction(`¿Eliminar "${p.name}"? Las ventas pasadas se conservan. Si solo ya no lo vendes, mejor desmarca "Producto activo".`))) return;
          try {
            await deleteRow('products', id);
            toast('Producto eliminado');
            close();
            bus.rerender();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
    },
  });
}

