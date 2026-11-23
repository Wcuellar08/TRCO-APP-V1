import {
  state, can, createSale, updateSale, deleteSale, saveRow, SALE_STATUS, itemsOf, customerById,
  productById, profileName, saleBalance, isPending, sizesOf, stockTotal,
} from '../db.js';
import { $, $$, esc, Q, int, num, today, fmtDate, fmtDateLong, sheet, toast, options, emptyState, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';
import { thumb } from './inventory.js';

let filter = 'todas';
let query = '';
let limit = 60;
export const setFilter = (f) => ((filter = f), (query = ''));

const FILTERS = {
  todas: { label: 'Todas', fn: () => true },
  pendientes: { label: 'Pendientes', fn: isPending },
  por_enviar: { label: 'Por enviar', fn: (s) => s.status === 'por_enviar' },
  apartado: { label: 'Apartados', fn: (s) => s.status === 'apartado' },
  por_cobrar: { label: 'Por cobrar', fn: (s) => s.status !== 'cancelado' && saleBalance(s) > 0.009 },
};

export const statusBadge = (s) => {
  const st = SALE_STATUS[s.status] || SALE_STATUS.entregado;
  return `<span class="badge ${st.cls}">${st.label}</span>`;
};

export function saleSummary(s) {
  const items = itemsOf(s.id);
  const units = sumBy(items, (i) => i.qty);
  const names = items.map((i) => `${i.product_name} ${i.size}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ');
  return { units, names };
}

export function saleRow(s) {
  const c = customerById(s.customer_id);
  const { names } = saleSummary(s);
  const bal = s.status !== 'cancelado' ? saleBalance(s) : 0;
  return `<button class="row" data-sale="${s.id}">
    <div class="row-main">
      <div class="row-title">${esc(c?.name || 'Venta sin cliente')}</div>
      <div class="row-sub">${esc(names || '—')}</div>
      <div class="row-sub">${esc([s.channel, s.payment_method].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="row-end">
      <div><b>${Q(s.total)}</b></div>
      <div style="margin-top:3px">${s.status !== 'entregado' ? statusBadge(s) : ''}${bal > 0 ? ` <span class="badge danger">Debe ${Q(bal)}</span>` : ''}</div>
    </div>
  </button>`;
}

export function bindSaleRows(root) {
  $$('[data-sale]', root).forEach((b) => (b.onclick = () => openSale(b.dataset.sale)));
}

export function render(page) {
  const q = query.toLowerCase();
  const all = state.sales.filter(FILTERS[filter].fn).filter((s) => {
    if (!q) return true;
    const c = customerById(s.customer_id);
    return [c?.name, c?.instagram, s.channel, s.notes, saleSummary(s).names].join(' ').toLowerCase().includes(q);
  });
  const list = all.slice(0, limit);
  const groups = new Map();
  for (const s of list) {
    if (!groups.has(s.date)) groups.set(s.date, []);
    groups.get(s.date).push(s);
  }
  const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, state.sales.filter(f.fn).length]));

  page.innerHTML = `
    <div class="chips" style="margin:0 -16px 10px">
      ${Object.entries(FILTERS)
        .map(([k, f]) => `<button class="chip ${filter === k ? 'active' : ''}" data-f="${k}">${f.label}${k !== 'todas' && counts[k] ? ` · ${counts[k]}` : ''}</button>`)
        .join('')}
    </div>
    <input class="search" type="search" id="q" placeholder="Buscar cliente, prenda, canal…" value="${esc(query)}">
    ${
      list.length
        ? [...groups.entries()]
            .map(([date, rows]) => {
              const day = sumBy(rows.filter((s) => s.status !== 'cancelado'), (s) => s.total);
              return `<div class="date-head"><span>${esc(fmtDateLong(date))}</span><span class="num">${Q(day)}</span></div>
                <div class="list">${rows.map(saleRow).join('')}</div>`;
            })
            .join('')
        : emptyState(state.sales.length ? 'No hay pedidos con este filtro.' : `Aún no hay ventas registradas.${can('vender') ? ' Toca Vender (＋) abajo para registrar la primera.' : ''}`)
    }
    ${all.length > limit ? `<div class="btn-row"><button class="btn" id="more">Ver más (${all.length - limit})</button></div>` : ''}`;

  $$('[data-f]', page).forEach((b) => (b.onclick = () => ((filter = b.dataset.f), (limit = 60), render(page))));
  const qi = $('#q', page);
  qi.oninput = () => {
    query = qi.value;
    render(page);
    const again = $('#q', page);
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  };
  const more = $('#more', page);
  if (more) more.onclick = () => ((limit += 100), render(page));
  bindSaleRows(page);
}

// ───────────────────────── Nueva venta ─────────────────────────
export function openNewSale({ customerId } = {}) {
  if (!can('vender')) return toast('No tienes permiso para registrar ventas', 'error');
  if (!state.products.some((p) => p.active !== false)) {
    toast('Primero agrega productos al inventario');
    bus.go('inventario');
    return;
  }
  const cart = [];
  let pick = { productId: '', size: '', qty: 1, price: '' };
  const products = state.products
    .filter((p) => p.active !== false)
    .sort((a, b) => (stockTotal(b) > 0) - (stockTotal(a) > 0) || a.name.localeCompare(b.name, 'es'));
  const s = state.settings;

  sheet({
    title: 'Nueva venta',
    body: `
      <div class="form">
        <div class="field"><span>Prenda</span>
          <select id="p-product">${options(
            products.map((p) => ({ value: p.id, label: `${p.name}${p.color ? ' · ' + p.color : ''} (${stockTotal(p)})` })),
            '',
            { empty: 'Elige un producto…' }
          )}</select>
        </div>
        <div id="picker"></div>
        <div id="cart"></div>

        <label class="field"><span>Cliente</span>
          <select name="customer_id" id="customer">${options(
            state.customers.map((c) => ({ value: c.id, label: c.name + (c.instagram ? ` (@${c.instagram.replace(/^@/, '')})` : '') })),
            customerId || '',
            { empty: '— Sin cliente —' }
          )}<option value="__new">+ Cliente nuevo…</option></select>
        </label>
        <div id="new-customer" class="hidden form">
          <label class="field"><span>Nombre del cliente</span><input id="nc-name" placeholder="Nombre"></label>
          <div class="grid2">
            <label class="field"><span>Instagram</span><input id="nc-ig" placeholder="@usuario" autocapitalize="none"></label>
            <label class="field"><span>Teléfono</span><input id="nc-phone" inputmode="tel" placeholder="5555 5555"></label>
          </div>
        </div>

        <div class="grid2">
          <label class="field"><span>Canal</span><select id="channel">${options(s.channels, s.channels[0])}</select></label>
          <label class="field"><span>Pago</span><select id="payment">${options(s.payments, s.payments[0])}</select></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Estado</span><select id="status">${options(
            Object.entries(SALE_STATUS).filter(([k]) => k !== 'cancelado').map(([value, v]) => ({ value, label: v.label })),
            'entregado'
          )}</select></label>
          <label class="field"><span>Fecha</span><input type="date" id="date" value="${today()}"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Descuento (Q)</span><input id="discount" inputmode="decimal" placeholder="0"></label>
          <label class="field"><span>Envío cobrado (Q)</span><input id="shipping" inputmode="decimal" placeholder="0"></label>
        </div>
        <label class="check"><input type="checkbox" id="fullpaid" checked> Pagado completo</label>
        <label class="field hidden" id="paid-wrap"><span>Monto pagado / anticipo (Q)</span><input id="paid" inputmode="decimal" placeholder="0"></label>
        <label class="field"><span>Notas</span><textarea id="notes" placeholder="Dirección de envío, detalles…"></textarea></label>
        <div class="card totals" id="totals"></div>
        <button class="btn primary block" id="save" type="button">Registrar venta</button>
      </div>`,
    onMount(root, close) {
      const productSel = $('#p-product', root);

      const renderPicker = () => {
        const p = productById(pick.productId);
        if (!p) return ($('#picker', root).innerHTML = '');
        const sizes = sizesOf(p).filter((sz) => sz in (p.stock || {}));
        const inCart = (sz) => sumBy(cart.filter((c) => c.product_id === p.id && c.size === sz), (c) => c.qty);
        $('#picker', root).innerHTML = `
          <div class="card">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${thumb(p)}<div><b>${esc(p.name)}</b><div class="muted small">${esc([p.type, p.color].filter(Boolean).join(' · '))}</div></div></div>
            <div class="label" style="margin-bottom:6px">Talla</div>
            <div class="size-pick">${
              sizes.length
                ? sizes
                    .map((sz) => {
                      const left = (Number(p.stock[sz]) || 0) - inCart(sz);
                      return `<button type="button" class="size-btn ${pick.size === sz ? 'active' : ''}" data-sz="${esc(sz)}">${esc(sz)}<small>${left} disp.</small></button>`;
                    })
                    .join('')
                : '<span class="muted small">Este producto no tiene tallas registradas. Agrégalas en Inventario.</span>'
            }</div>
            <div class="grid2" style="margin-top:12px;align-items:end">
              <div class="field"><span>Cantidad</span>
                <div class="stepper"><button type="button" data-step="-1">−</button><input id="qty" inputmode="numeric" value="${pick.qty}"><button type="button" data-step="1">+</button></div>
              </div>
              <label class="field"><span>Precio c/u (Q)</span><input id="price" inputmode="decimal" value="${esc(pick.price)}"></label>
            </div>
            <button type="button" class="btn block" id="add" style="margin-top:12px" ${pick.size ? '' : 'disabled'}>Agregar a la venta</button>
          </div>`;
        $$('[data-sz]', root).forEach((b) => (b.onclick = () => ((pick.size = b.dataset.sz), renderPicker())));
        $$('[data-step]', root).forEach(
          (b) => (b.onclick = () => ((pick.qty = Math.max(1, (Number($('#qty', root).value) || 1) + Number(b.dataset.step))), renderPicker()))
        );
        $('#qty', root).oninput = (e) => (pick.qty = Math.max(1, Math.round(num(e.target.value)) || 1));
        $('#price', root).oninput = (e) => (pick.price = e.target.value);
        $('#add', root).onclick = async () => {
          const left = (Number(p.stock[pick.size]) || 0) - inCart(pick.size);
          if (pick.qty > left && !(await confirmAction(`Solo hay ${left} en talla ${pick.size}. ¿Agregar de todos modos?`, { ok: 'Agregar' }))) return;
          cart.push({
            product_id: p.id,
            product_name: p.name,
            type: p.type,
            size: pick.size,
            qty: pick.qty,
            unit_price: num(pick.price),
            unit_cost: Number(p.cost) || 0,
          });
          pick = { productId: '', size: '', qty: 1, price: '' };
          productSel.value = '';
          renderPicker();
          renderCart();
        };
      };

      const subtotal = () => sumBy(cart, (c) => c.qty * c.unit_price);
      const renderTotals = () => {
        const sub = subtotal();
        const disc = num($('#discount', root).value);
        const ship = num($('#shipping', root).value);
        const total = Math.max(0, sub - disc + ship);
        $('#totals', root).innerHTML = `
          <div><span class="muted">Subtotal (${int(sumBy(cart, (c) => c.qty))} prendas)</span><span>${Q(sub)}</span></div>
          ${disc ? `<div><span class="muted">Descuento</span><span>−${Q(disc)}</span></div>` : ''}
          ${ship ? `<div><span class="muted">Envío</span><span>${Q(ship)}</span></div>` : ''}
          <div class="grand"><span>Total</span><span>${Q(total)}</span></div>`;
        return { sub, disc, ship, total };
      };

      const renderCart = () => {
        $('#cart', root).innerHTML = cart.length
          ? `<div class="label" style="margin-bottom:4px">En esta venta</div><div class="card" style="padding:4px 14px">${cart
              .map(
                (c, i) => `<div class="cart-item">
                <div class="row-main"><b>${esc(c.product_name)}</b><div class="muted small">Talla ${esc(c.size)} · ${c.qty} × ${Q(c.unit_price)}</div></div>
                <b class="num">${Q(c.qty * c.unit_price)}</b>
                <button type="button" class="btn-text" data-rm="${i}" aria-label="Quitar" style="color:var(--danger);font-size:22px;padding:0 4px">×</button>
              </div>`
              )
              .join('')}</div>`
          : '';
        $$('[data-rm]', root).forEach((b) => (b.onclick = () => (cart.splice(Number(b.dataset.rm), 1), renderCart())));
        renderTotals();
      };

      productSel.onchange = () => {
        const p = productById(productSel.value);
        pick = { productId: productSel.value, size: '', qty: 1, price: p ? p.price : '' };
        const sizes = p ? sizesOf(p).filter((sz) => (Number(p.stock?.[sz]) || 0) > 0) : [];
        if (sizes.length === 1) pick.size = sizes[0];
        renderPicker();
      };
      $('#customer', root).onchange = (e) => $('#new-customer', root).classList.toggle('hidden', e.target.value !== '__new');
      $('#fullpaid', root).onchange = (e) => $('#paid-wrap', root).classList.toggle('hidden', e.target.checked);
      $('#status', root).onchange = (e) => {
        if (e.target.value === 'apartado') {
          $('#fullpaid', root).checked = false;
          $('#paid-wrap', root).classList.remove('hidden');
        }
      };
      ['#discount', '#shipping'].forEach((sel) => ($(sel, root).oninput = renderTotals));
      renderCart();

      $('#save', root).onclick = async (e) => {
        if (!cart.length) return toast('Agrega al menos una prenda', 'error');
        const btn = e.target;
        btn.disabled = true;
        try {
          let customer_id = $('#customer', root).value || null;
          if (customer_id === '__new') {
            const name = $('#nc-name', root).value.trim();
            if (!name) throw new Error('Escribe el nombre del cliente nuevo');
            const c = await saveRow('customers', {
              name,
              instagram: $('#nc-ig', root).value.trim().replace(/^@/, ''),
              phone: $('#nc-phone', root).value.trim(),
            });
            customer_id = c.id;
          }
          const { sub, disc, ship, total } = renderTotals();
          await createSale(
            {
              date: $('#date', root).value || today(),
              customer_id,
              channel: $('#channel', root).value,
              payment_method: $('#payment', root).value,
              status: $('#status', root).value,
              subtotal: sub,
              discount: disc,
              shipping: ship,
              total,
              paid: $('#fullpaid', root).checked ? total : Math.min(total, num($('#paid', root).value)),
              notes: $('#notes', root).value.trim(),
            },
            cart
          );
          toast(`Venta registrada · ${Q(total)}`);
          close();
          bus.rerender();
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'error');
        }
      };
    },
  });
}

// ───────────────────────── Detalle de venta ─────────────────────────
export function openSale(id) {
  const s = state.sales.find((x) => x.id === id);
  if (!s) return;
  const items = itemsOf(id);
  const c = customerById(s.customer_id);
  const owner = can('costos');
  const canEdit = can('editar_ventas') && s.status !== 'cancelado';
  const canDelete = can('borrar_ventas');
  const bal = saleBalance(s);
  const cost = sumBy(items, (i) => i.qty * (Number(i.unit_cost) || 0));
  const revenue = (Number(s.subtotal) || 0) - (Number(s.discount) || 0);

  sheet({
    title: `Venta · ${fmtDate(s.date)}`,
    body: `
      <div class="card">
        <div class="kv"><span>Cliente</span><span>${esc(c?.name || '—')}${c?.instagram ? `<br><span class="muted small">@${esc(c.instagram)}</span>` : ''}</span></div>
        <div class="kv"><span>Fecha</span><span>${esc(fmtDateLong(s.date))}</span></div>
        <div class="kv"><span>Canal</span><span>${esc(s.channel || '—')}</span></div>
        <div class="kv"><span>Pago</span><span>${esc(s.payment_method || '—')}</span></div>
        ${s.created_by && profileName(s.created_by) ? `<div class="kv"><span>Registró</span><span>${esc(profileName(s.created_by))}</span></div>` : ''}
      </div>
      <div class="section"><h2>Prendas</h2></div>
      <div class="card" style="padding:4px 14px">${items
        .map(
          (i) => `<div class="cart-item"><div class="row-main"><b>${esc(i.product_name)}</b><div class="muted small">${esc(i.type || '')} · Talla ${esc(i.size)} · ${i.qty} × ${Q(i.unit_price)}</div></div><b class="num">${Q(i.qty * i.unit_price)}</b></div>`
        )
        .join('')}</div>
      <div class="card totals" style="margin-top:10px">
        <div><span class="muted">Subtotal</span><span>${Q(s.subtotal)}</span></div>
        ${Number(s.discount) ? `<div><span class="muted">Descuento</span><span>−${Q(s.discount)}</span></div>` : ''}
        ${Number(s.shipping) ? `<div><span class="muted">Envío</span><span>${Q(s.shipping)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${Q(s.total)}</span></div>
        <div><span class="muted">Pagado</span><span>${Q(s.paid)}</span></div>
        ${bal > 0 ? `<div style="color:var(--danger)"><span>Saldo pendiente</span><b>${Q(bal)}</b></div>` : ''}
        ${owner ? `<div><span class="muted">Ganancia (sin envío)</span><span>${Q(revenue - cost)}</span></div>` : ''}
      </div>

      <div class="form" style="margin-top:16px">
        ${bal > 0 && canEdit ? `
        <div class="card">
          <div class="label" style="margin-bottom:8px">Registrar pago</div>
          <div class="grid2" style="align-items:end">
            <label class="field"><span>Monto (Q)</span><input id="pay-amt" inputmode="decimal" value="${bal.toFixed(2)}"></label>
            <button class="btn primary" id="pay" type="button">Registrar</button>
          </div>
        </div>` : ''}
        ${canEdit || canDelete ? `
        <label class="field"><span>Estado</span><select id="status">${options(
          Object.entries(SALE_STATUS)
            .filter(([k]) => canDelete || k !== 'cancelado')
            .map(([value, v]) => ({ value, label: v.label })),
          s.status
        )}</select>${canDelete ? '<span class="hint">Cancelar una venta regresa las prendas al inventario.</span>' : ''}</label>
        <label class="field"><span>Guía / número de envío</span><input id="tracking" value="${esc(s.tracking)}" placeholder="Opcional"></label>
        <label class="field"><span>Notas</span><textarea id="notes">${esc(s.notes)}</textarea></label>
        <button class="btn primary block" id="save" type="button">Guardar cambios</button>` : `
        ${s.tracking ? `<div class="kv"><span>Guía</span><span>${esc(s.tracking)}</span></div>` : ''}
        ${s.notes ? `<div class="card small">${esc(s.notes)}</div>` : ''}`}
        ${canDelete ? '<button class="btn danger block" id="del" type="button">Eliminar venta</button>' : ''}
      </div>`,
    onMount(root, close) {
      const done = (msg) => {
        toast(msg);
        close();
        bus.rerender();
      };
      const pay = $('#pay', root);
      if (pay)
        pay.onclick = async () => {
          const amt = num($('#pay-amt', root).value);
          if (amt <= 0) return toast('Escribe un monto', 'error');
          try {
            await updateSale(id, { paid: Math.min(Number(s.total), (Number(s.paid) || 0) + amt) });
            done('Pago registrado');
          } catch (e) {
            toast(e.message, 'error');
          }
        };
      const save = $('#save', root);
      if (save) save.onclick = async () => {
        const status = $('#status', root).value;
        if (status === 'cancelado' && s.status !== 'cancelado' && !(await confirmAction('¿Cancelar esta venta? Las prendas regresan al inventario.', { ok: 'Cancelar venta', danger: true }))) return;
        try {
          await updateSale(id, { status, tracking: $('#tracking', root).value.trim(), notes: $('#notes', root).value.trim() });
          done('Venta actualizada');
        } catch (e) {
          toast(e.message, 'error');
        }
      };
      const del = $('#del', root);
      if (del) del.onclick = async () => {
        if (!(await confirmAction('¿Eliminar esta venta para siempre? Las prendas regresan al inventario.', { ok: 'Eliminar', danger: true }))) return;
        try {
          await deleteSale(id);
          done('Venta eliminada');
        } catch (e) {
          toast(e.message, 'error');
        }
      };
    },
  });
}
