import {
  state, can, createSale, updateSale, deleteSale, saveRow, SALE_STATUS, itemsOf, customerById,
  productById, dropById, profileName, eventQty, preorderOpen, preorderCount, saleBalance, isPending, sizesOf, stockTotal,
} from '../db.js';
import { $, $$, esc, Q, int, num, today, fmtDate, fmtDateLong, sheet, toast, options, emptyState, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';
import { thumb } from './inventory.js';
import { openScanner } from '../scanner.js';
import { activeEvent, eventChannel } from '../eventmode.js';
import { evaluatePromo, suggestPromos, findByCode, promoSummary } from '../promos.js';
import { icons } from '../icons.js';

let filter = 'todas';
let query = '';
let limit = 60;
export const setFilter = (f) => ((filter = f), (query = ''));

const FILTERS = {
  todas: { label: 'Todas', fn: () => true },
  pendientes: { label: 'Pendientes', fn: isPending },
  por_enviar: { label: 'Por enviar', fn: (s) => s.status === 'por_enviar' },
  apartado: { label: 'Apartados', fn: (s) => s.status === 'apartado' },
  preventa: { label: 'Preventas', fn: (s) => s.status === 'preventa' },
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
      <div class="row-sub">${esc([s.event_id ? state.events.find((e) => e.id === s.event_id)?.name : '', s.channel, s.payment_method].filter(Boolean).join(' · '))}</div>
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
// Preferencia de este dispositivo: abrir la cámara al tocar Vender.
const AUTO_SCAN_KEY = 'trco-autoscan';
export function autoScanEnabled() {
  try {
    return localStorage.getItem(AUTO_SCAN_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setAutoScan(on) {
  try {
    localStorage.setItem(AUTO_SCAN_KEY, on ? 'on' : 'off');
  } catch {}
}

export function openNewSale({ customerId, autoScan = false } = {}) {
  if (!can('vender')) return toast('No tienes permiso para registrar ventas', 'error');
  if (!state.products.some((p) => p.active !== false)) {
    toast('Primero agrega productos al inventario');
    bus.go('inventario');
    return;
  }
  const cart = [];
  let pick = { productId: '', size: '', qty: 1, price: '' };
  const ev = activeEvent(); // modo evento en este teléfono
  const evUnits = (p) => Object.values(ev?.items?.[p.id] || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  const products = state.products
    .filter((p) => p.active !== false)
    .sort((a, b) => (ev ? (evUnits(b) > 0) - (evUnits(a) > 0) : 0) || (stockTotal(b) > 0) - (stockTotal(a) > 0) || a.name.localeCompare(b.name, 'es'));
  const s = state.settings;

  sheet({
    title: 'Nueva venta',
    body: `
      <div class="form">
        ${ev ? `<div class="ev-inline"><span class="live-dot"></span>Venta del evento <b>${esc(ev.name)}</b></div>` : ''}
        <button type="button" class="btn primary block scan-btn" id="scan">${icons.scan} Escanear etiquetas</button>
        <div class="field"><span>O elige la prenda</span>
          <select id="p-product">${options(
            products.map((p) => ({ value: p.id, label: `${p.name}${p.color ? ' · ' + p.color : ''} (${ev ? `maleta ${evUnits(p)} · bodega ${stockTotal(p)}` : stockTotal(p)})` })),
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
          <label class="field"><span>Canal</span><select id="channel">${options(s.channels, ev ? eventChannel() : s.channels[0])}</select></label>
          <label class="field"><span>Pago</span><select id="payment">${options(s.payments, s.payments[0])}</select></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Estado</span><select id="status">${options(
            Object.entries(SALE_STATUS).filter(([k]) => k !== 'cancelado').map(([value, v]) => ({ value, label: v.label })),
            'entregado'
          )}</select></label>
          <label class="field"><span>Fecha</span><input type="date" id="date" value="${today()}"></label>
        </div>
        <div id="promo-box"></div>
        <div class="grid2">
          ${can('descuentos') ? '<label class="field"><span>Descuento a mano (Q)</span><input id="discount" inputmode="decimal" placeholder="0"></label>' : ''}
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

      const inCartOf = (pid, sz, fromEvent) =>
        sumBy(cart.filter((c) => c.product_id === pid && c.size === sz && (fromEvent === undefined || Boolean(c.from_event) === fromEvent)), (c) => c.qty);
      // Disponible: en modo evento, lo que queda en la maleta; si no, lo de bodega.
      const availEvent = (p, sz) => eventQty(ev, p.id, sz) - inCartOf(p.id, sz, true);
      const availStock = (p, sz) => (Number(p.stock?.[sz]) || 0) - inCartOf(p.id, sz, false);
      // Agrega al carrito; si ya está la misma prenda, talla, precio y origen, suma la cantidad.
      const addItem = (p, size, qty, price, fromEvent = false, preorder = false) => {
        if (cart.length && cart.some((c) => Boolean(c.preorder) !== preorder)) {
          toast(preorder ? 'Registra la preventa en una venta aparte' : 'Esta venta es de preventa: registra esta prenda aparte', 'error');
          return false;
        }
        const same = cart.find((c) => c.product_id === p.id && c.size === size && c.unit_price === price && Boolean(c.from_event) === fromEvent && Boolean(c.preorder) === preorder);
        if (same) same.qty += qty;
        else
          cart.push({
            product_id: p.id, product_name: p.name, type: p.type, size, qty, unit_price: price, unit_cost: Number(p.cost) || 0,
            ...(ev ? { from_event: fromEvent } : {}),
            ...(preorder ? { preorder: true } : {}),
          });
        renderCart();
        return true;
      };
      const isPreorderSale = () => cart.some((c) => c.preorder);

      const startScan = () =>
        openScanner({
          title: 'Escanear prendas',
          counterLabel: (n) => `${n} agregada${n === 1 ? '' : 's'}`,
          onMatch: ({ product: p, size }) => {
            const inactive = p.active === false;
            const head = `<div class="scan-item">${thumb(p)}
                <div class="row-main"><b>${esc(p.name)}</b><div class="muted small">${esc([p.type, dropById(p.drop_id)?.name].filter(Boolean).join(' · '))}</div>
                  <div class="scan-meta"><span class="scan-size">${esc(size)}</span><b>${Q(p.price)}</b>`;
            const tail = `${inactive ? '<span class="badge muted">Inactivo</span>' : ''}</div></div></div>`;
            if (ev) {
              const inBag = availEvent(p, size);
              if (inBag > 0)
                return {
                  html: `${head}<span class="muted small">Quedan ${inBag} en la maleta</span>${tail}`,
                  actionLabel: 'Agregar',
                  onAction: () => addItem(p, size, 1, Number(p.price) || 0, true),
                };
              const inStock = availStock(p, size);
              return {
                html: `${head}<span class="badge warn">No está en la maleta</span><span class="muted small">Bodega ${Math.max(0, inStock)}</span>${tail}`,
                actionLabel: 'Vender de bodega',
                onAction: () => addItem(p, size, 1, Number(p.price) || 0, false),
              };
            }
            const left = availStock(p, size);
            return {
              html: `${head}${left > 0 ? `<span class="muted small">Quedan ${left}</span>` : '<span class="badge danger">Sin stock en la app</span>'}${tail}`,
              actionLabel: left > 0 ? 'Agregar' : 'Agregar de todos modos',
              onAction: () => addItem(p, size, 1, Number(p.price) || 0),
            };
          },
        });
      $('#scan', root).onclick = startScan;
      // Vender (＋) abre la cámara de una vez; al cerrar queda la venta con lo escaneado.
      if (autoScan) setTimeout(startScan, 60);

      const renderPicker = () => {
        const p = productById(pick.productId);
        if (!p) return ($('#picker', root).innerHTML = '');
        const pre = preorderOpen(p);
        const quotas = p.preorder?.quotas || {};
        const preLeft = (sz) => (quotas[sz] == null ? null : quotas[sz] - preorderCount(p.id, sz) - inCartOf(p.id, sz));
        const sizes = pre
          ? sizesOf(p).filter((sz) => sz in quotas)
          : sizesOf(p).filter((sz) => sz in (p.stock || {}) || (ev && eventQty(ev, p.id, sz)));
        $('#picker', root).innerHTML = `
          <div class="card">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${thumb(p)}<div><b>${esc(p.name)}</b><div class="muted small">${esc([p.type, p.color].filter(Boolean).join(' · '))}</div></div></div>
            ${pre ? `<div class="pre-note">⏳ <b>Preventa</b> · ${Q(p.preorder.price)}${p.preorder.end_date ? ` · cierra ${fmtDate(p.preorder.end_date)}` : ''}<br><span class="muted small">Se cobra completa y se aparta cuando llegue la producción.</span></div>` : ''}
            <div class="label" style="margin-bottom:6px">Talla</div>
            <div class="size-pick">${
              sizes.length
                ? sizes
                    .map((sz) => {
                      if (pre) {
                        const l = preLeft(sz);
                        return `<button type="button" class="size-btn ${pick.size === sz ? 'active' : ''}" data-sz="${esc(sz)}" ${l !== null && l <= 0 ? 'disabled' : ''}>${esc(sz)}<small>${l === null ? 'sin límite' : l > 0 ? `cupo ${l}` : 'cupo lleno'}</small></button>`;
                      }
                      const left = ev ? availEvent(p, sz) : availStock(p, sz);
                      return `<button type="button" class="size-btn ${pick.size === sz ? 'active' : ''}" data-sz="${esc(sz)}">${esc(sz)}<small>${left} ${ev ? 'maleta' : 'disp.'}</small></button>`;
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
        $$('#picker [data-step]', root).forEach(
          (b) => (b.onclick = () => ((pick.qty = Math.max(1, (Number($('#qty', root).value) || 1) + Number(b.dataset.step))), renderPicker()))
        );
        $('#qty', root).oninput = (e) => (pick.qty = Math.max(1, Math.round(num(e.target.value)) || 1));
        $('#price', root).oninput = (e) => (pick.price = e.target.value);
        $('#add', root).onclick = async () => {
          if (pre) {
            const l = preLeft(pick.size);
            if (l !== null && pick.qty > l) return toast(`Solo quedan ${Math.max(0, l)} de cupo en ${pick.size}`, 'error');
            if (!addItem(p, pick.size, pick.qty, num(pick.price), false, true)) return;
          } else if (ev) {
            const inBag = availEvent(p, pick.size);
            if (pick.qty <= inBag) addItem(p, pick.size, pick.qty, num(pick.price), true);
            else if (await confirmAction(`En la maleta ${inBag > 0 ? `solo quedan ${inBag}` : 'no hay'} ${pick.size}. ¿Vender de la bodega?`, { ok: 'Vender de bodega' }))
              addItem(p, pick.size, pick.qty, num(pick.price), false);
            else return;
          } else {
            const left = availStock(p, pick.size);
            if (pick.qty > left && !(await confirmAction(`Solo hay ${left} en talla ${pick.size}. ¿Agregar de todos modos?`, { ok: 'Agregar' }))) return;
            addItem(p, pick.size, pick.qty, num(pick.price));
          }
          pick = { productId: '', size: '', qty: 1, price: '' };
          productSel.value = '';
          renderPicker();
        };
      };

      const subtotal = () => sumBy(cart, (c) => c.qty * c.unit_price);
      // ── Promociones: una sola por venta. La app sugiere; tú decides. ──
      let applied = null; // { promo, discount }
      let showCode = false;
      const promoCtx = () => ({
        cart,
        date: $('#date', root)?.value,
        channel: $('#channel', root)?.value,
        eventId: ev?.id,
        customerId: $('#customer', root)?.value || '',
      });
      const renderPromo = () => {
        const box = $('#promo-box', root);
        const manual = $('#discount', root);
        if (applied) {
          const r = evaluatePromo(applied.promo, promoCtx());
          if (r.ok) applied.discount = r.discount;
          else {
            toast(`Se quitó la promo: ${r.reason}`, 'error');
            applied = null;
          }
        }
        if (manual) {
          manual.disabled = Boolean(applied);
          if (applied) manual.value = '';
        }
        if (!cart.length || isPreorderSale()) return (box.innerHTML = '');
        if (applied) {
          box.innerHTML = `<div class="promo-on"><span>✓ <b>${esc(applied.promo.name)}</b>${applied.promo.code ? ` <span class="muted small">(${esc(applied.promo.code)})</span>` : ''}</span>
            <b class="num">−${Q(applied.discount)}</b><button type="button" class="btn-text" id="promo-off">Quitar</button></div>`;
          $('#promo-off', root).onclick = () => ((applied = null), renderTotals());
          return;
        }
        const best = suggestPromos(promoCtx())[0];
        box.innerHTML = `
          ${best ? `<div class="promo-tip"><span>💡 Aplica <b>${esc(best.promo.name)}</b> <span class="muted small">${esc(promoSummary(best.promo))}</span></span>
            <button type="button" class="btn sm primary" id="promo-use">Aplicar −${Q(best.discount)}</button></div>` : ''}
          ${showCode
            ? `<div class="promo-code"><input id="promo-code" placeholder="Código de descuento" autocapitalize="characters" autocorrect="off" spellcheck="false"><button type="button" class="btn sm" id="promo-code-go">Aplicar</button></div>`
            : '<button type="button" class="btn-text" id="promo-code-open">¿Tiene código de descuento?</button>'}`;
        const use = $('#promo-use', root);
        if (use) use.onclick = () => ((applied = { promo: best.promo, discount: best.discount }), renderTotals());
        const open = $('#promo-code-open', root);
        if (open) open.onclick = () => ((showCode = true), renderPromo(), $('#promo-code', root)?.focus());
        const go = $('#promo-code-go', root);
        if (go) {
          const apply = () => {
            const code = $('#promo-code', root).value.trim();
            if (!code) return;
            const promo = findByCode(code);
            if (!promo) return toast(`El código ${code.toUpperCase()} no existe`, 'error');
            const r = evaluatePromo(promo, promoCtx());
            if (!r.ok) return toast(r.reason, 'error');
            applied = { promo, discount: r.discount };
            toast(`Código aplicado: −${Q(r.discount)}`);
            renderTotals();
          };
          go.onclick = apply;
          $('#promo-code', root).onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), apply());
        }
      };
      const renderTotals = () => {
        renderPromo();
        const sub = subtotal();
        const disc = applied ? applied.discount : num($('#discount', root)?.value);
        const ship = num($('#shipping', root).value);
        const total = Math.max(0, sub - disc + ship);
        $('#totals', root).innerHTML = `
          <div><span class="muted">Subtotal (${int(sumBy(cart, (c) => c.qty))} prendas)</span><span>${Q(sub)}</span></div>
          ${disc ? `<div><span class="muted">${applied ? esc(applied.promo.name) : 'Descuento'}</span><span>−${Q(disc)}</span></div>` : ''}
          ${ship ? `<div><span class="muted">Envío</span><span>${Q(ship)}</span></div>` : ''}
          <div class="grand"><span>Total</span><span>${Q(total)}</span></div>`;
        return { sub, disc, ship, total };
      };

      const renderCart = () => {
        $('#cart', root).innerHTML = cart.length
          ? `<div class="label" style="margin-bottom:4px">En esta venta</div><div class="card" style="padding:4px 14px">${cart
              .map(
                (c, i) => `<div class="cart-item">
                <div class="row-main"><b>${esc(c.product_name)}</b><div class="muted small">Talla ${esc(c.size)} · ${c.qty} × ${Q(c.unit_price)}${ev && !c.from_event ? ' · de bodega' : ''}</div></div>
                <div class="stepper sm"><button type="button" data-cq="${i}" data-d="-1" aria-label="Menos">−</button><span>${c.qty}</span><button type="button" data-cq="${i}" data-d="1" aria-label="Más">+</button></div>
                <b class="num">${Q(c.qty * c.unit_price)}</b>
                <button type="button" class="btn-text" data-rm="${i}" aria-label="Quitar" style="color:var(--danger);font-size:22px;padding:0 4px">×</button>
              </div>`
              )
              .join('')}</div>`
          : '';
        $$('[data-rm]', root).forEach((b) => (b.onclick = () => (cart.splice(Number(b.dataset.rm), 1), renderCart())));
        $$('[data-cq]', root).forEach(
          (b) =>
            (b.onclick = () => {
              const item = cart[Number(b.dataset.cq)];
              item.qty += Number(b.dataset.d);
              if (item.qty <= 0) cart.splice(Number(b.dataset.cq), 1);
              renderCart();
            })
        );
        // Una venta de preventa se cobra completa y queda en estado "Preventa".
        const pre = isPreorderSale();
        const st = $('#status', root);
        if (pre) {
          if (!st.querySelector('option[value=preventa]')) st.insertAdjacentHTML('beforeend', '<option value="preventa">Preventa</option>');
          st.value = 'preventa';
          $('#fullpaid', root).checked = true;
          $('#paid-wrap', root).classList.add('hidden');
        } else if (st.value === 'preventa') st.value = 'entregado';
        st.disabled = pre;
        $('#fullpaid', root).disabled = pre;
        renderTotals();
      };

      productSel.onchange = () => {
        const p = productById(productSel.value);
        pick = { productId: productSel.value, size: '', qty: 1, price: p ? (preorderOpen(p) ? p.preorder.price : p.price) : '' };
        const sizes = p ? sizesOf(p).filter((sz) => (Number(p.stock?.[sz]) || 0) > 0) : [];
        if (sizes.length === 1) pick.size = sizes[0];
        renderPicker();
      };
      $('#customer', root).onchange = (e) => $('#new-customer', root).classList.toggle('hidden', e.target.value !== '__new');
      $('#fullpaid', root).onchange = (e) => $('#paid-wrap', root).classList.toggle('hidden', e.target.checked);
      $('#status', root).querySelector('option[value=preventa]')?.remove();
      $('#status', root).onchange = (e) => {
        if (e.target.value === 'apartado') {
          $('#fullpaid', root).checked = false;
          $('#paid-wrap', root).classList.remove('hidden');
        }
      };
      ['#discount', '#shipping'].forEach((sel) => $(sel, root) && ($(sel, root).oninput = renderTotals));
      ['#channel', '#customer', '#date'].forEach((sel) => $(sel, root).addEventListener('change', renderTotals));
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
              ...(ev ? { event_id: ev.id } : {}),
              payment_method: $('#payment', root).value,
              status: isPreorderSale() ? 'preventa' : $('#status', root).value,
              ...(isPreorderSale() ? { preorder: true } : {}),
              ...(applied ? { promo_id: applied.promo.id, promo_name: applied.promo.name, promo_code: applied.promo.code || null } : {}),
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
        ${Number(s.discount) ? `<div><span class="muted">${s.promo_name ? esc(s.promo_name) + (s.promo_code ? ` (${esc(s.promo_code)})` : '') : 'Descuento'}</span><span>−${Q(s.discount)}</span></div>` : ''}
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
