// Preventas: productos que se venden antes de tenerlos. Pedidos por talla,
// "Mandar a producir", apartado automático al recibir y aviso por WhatsApp.
import { state, can, saveRow, productById, sizesOf, preorderOpen, preorderSales, preorderCount, allocatePreorders, itemsOf, customerById } from '../db.js';
import { $, $$, esc, Q, int, num, today, addDays, fmtDate, sheet, toast, options, emptyState, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';
import { thumb } from './inventory.js';
import { openBatch } from './production.js';
import { statusBadge } from './sales.js';

const withPreorder = () => state.products.filter((p) => p.preorder);

export function render(page) {
  const list = withPreorder().sort((a, b) => preorderOpen(b) - preorderOpen(a) || a.name.localeCompare(b.name, 'es'));
  const editable = can('inventario');
  page.innerHTML = `
    <p class="muted small" style="margin-top:0">Vende antes de producir. Los pedidos se cobran completos; cuando llega la producción, la app aparta las prendas por orden de llegada.</p>
    ${editable ? '<div class="btn-row" style="margin-top:0"><button class="btn primary" id="new-pre">+ Nueva preventa</button></div>' : ''}
    ${
      list.length
        ? list
            .map((p) => {
              const open = preorderOpen(p);
              const sales = preorderSales(p.id);
              const waiting = sales.filter((s) => s.status === 'preventa').length;
              const sizes = Object.keys(p.preorder.quotas || {});
              return `<section class="pre-card">
                <div class="pre-head">${thumb(p)}
                  <div class="row-main"><b>${esc(p.name)}</b>
                    <div class="row-sub">${Q(p.preorder.price)} en preventa (normal ${Q(p.price)})${p.preorder.end_date ? ` · cierra ${fmtDate(p.preorder.end_date)}` : ''}</div></div>
                  <span class="badge ${open ? 'ok' : 'muted'}">${open ? 'Abierta' : 'Cerrada'}</span>
                </div>
                <div class="pre-sizes">${sizes
                  .map((sz) => {
                    const n = preorderCount(p.id, sz);
                    const q = p.preorder.quotas[sz];
                    return `<div><b>${esc(sz)}</b><span>${int(n)}${q != null ? ` / ${int(q)}` : ''}</span></div>`;
                  })
                  .join('')}</div>
                <p class="muted small" style="margin:8px 0 0">${int(preorderCount(p.id))} prendas pedidas · ${int(sales.length)} pedidos · ${Q(sumBy(sales, (s) => s.total))}${waiting ? ` · <b style="color:var(--warn)">${int(waiting)} por apartar</b>` : ''}</p>
                <div class="pre-actions">
                  <button class="btn sm" data-orders="${p.id}">Pedidos</button>
                  ${editable ? `<button class="btn sm" data-edit="${p.id}">Editar</button>` : ''}
                  ${can('produccion') && preorderCount(p.id) ? `<button class="btn sm" data-produce="${p.id}">Mandar a producir</button>` : ''}
                  ${waiting && can('editar_ventas') ? `<button class="btn sm primary" data-alloc="${p.id}">Apartar con stock</button>` : ''}
                </div>
              </section>`;
            })
            .join('')
        : emptyState('No hay preventas. Pon un producto en preventa antes de mandarlo a producir.')
    }`;
  const nb = $('#new-pre', page);
  if (nb) nb.onclick = pickProduct;
  $$('[data-edit]', page).forEach((b) => (b.onclick = () => openPreorder(productById(b.dataset.edit))));
  $$('[data-orders]', page).forEach((b) => (b.onclick = () => openOrders(productById(b.dataset.orders))));
  $$('[data-produce]', page).forEach((b) => (b.onclick = () => sendToProduction(productById(b.dataset.produce))));
  $$('[data-alloc]', page).forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await allocatePreorders(b.dataset.alloc);
          showAllocated(r);
          bus.rerender();
        } catch (e) {
          b.disabled = false;
          toast(e.message, 'error');
        }
      })
  );
}

function pickProduct() {
  const list = state.products.filter((p) => p.active !== false && !p.preorder?.active);
  sheet({
    title: 'Nueva preventa',
    body: `<p class="muted small" style="margin-top:0">Elige el producto. Si todavía no existe, créalo primero en Inventario (con foto y precio normal).</p>
      <div class="list">${list
        .map((p) => `<button class="row" data-p="${p.id}">${thumb(p)}<div class="row-main"><div class="row-title">${esc(p.name)}</div><div class="row-sub">${esc(p.type || '')} · ${Q(p.price)}</div></div></button>`)
        .join('')}</div>`,
    onMount(root, close) {
      $$('[data-p]', root).forEach((b) => (b.onclick = () => (close(), setTimeout(() => openPreorder(productById(b.dataset.p)), 240))));
    },
  });
}

// Configurar la preventa de un producto (también se abre desde el producto).
export function openPreorder(p) {
  const pre = p.preorder || { active: true, price: Math.round((Number(p.price) || 0) * 0.9), end_date: addDays(today(), 14), quotas: {} };
  const sizes = state.settings.sizes.concat(Object.keys(pre.quotas || {}).filter((s) => !state.settings.sizes.includes(s)));
  const isNew = !p.preorder;
  sheet({
    title: `Preventa · ${p.name}`,
    body: `
      <form class="form" id="pref">
        <div class="grid2">
          <label class="field"><span>Precio de preventa (Q)</span><input name="price" id="pre-price" inputmode="decimal" value="${esc(pre.price)}">
            <span class="hint">Normal: ${Q(p.price)}</span></label>
          <label class="field"><span>Cierra el</span><input type="date" name="end_date" id="pre-end" value="${esc(pre.end_date || '')}"></label>
        </div>
        <div class="field"><span>Tallas y cupo</span>
          <div class="pre-quota">${sizes
            .map((sz) => {
              const on = isNew ? sz in (p.stock || {}) || ['S', 'M', 'L', 'XL'].includes(sz) : sz in (pre.quotas || {});
              const q = pre.quotas?.[sz];
              return `<label class="pq-row"><input type="checkbox" data-sz="${esc(sz)}" ${on ? 'checked' : ''}><b>${esc(sz)}</b>
                <input class="pq-in" data-q="${esc(sz)}" inputmode="numeric" placeholder="Sin límite" value="${q != null ? esc(q) : ''}">
                <small>${int(preorderCount(p.id, sz))} pedidas</small></label>`;
            })
            .join('')}</div>
          <span class="hint">Deja el cupo vacío para no poner límite.</span></div>
        <label class="check"><input type="checkbox" name="active" ${pre.active ? 'checked' : ''}> Preventa abierta</label>
        <button class="btn primary block" type="submit">${isNew ? 'Abrir preventa' : 'Guardar'}</button>
      </form>`,
    onMount(root, close) {
      $('#pref', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const quotas = {};
        $$('[data-sz]', root).forEach((c) => {
          if (!c.checked) return;
          const v = $(`[data-q="${CSS.escape(c.dataset.sz)}"]`, root).value.trim();
          quotas[c.dataset.sz] = v === '' ? null : Math.max(0, Math.round(num(v)));
        });
        if (!Object.keys(quotas).length) return toast('Elige al menos una talla', 'error');
        if (num(f.price.value) <= 0) return toast('Escribe el precio de preventa', 'error');
        try {
          await saveRow('products', {
            id: p.id,
            preorder: { active: f.active.checked, price: num(f.price.value), end_date: f.end_date.value || null, quotas, started_at: pre.started_at || today() },
          });
          toast(isNew ? 'Preventa abierta' : 'Preventa guardada');
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    },
  });
}

const waLink = (customer, text) => {
  const digits = String(customer?.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.length === 8 ? '502' + digits : digits}?text=${encodeURIComponent(text)}`;
};
const readyMessage = (s) => {
  const c = customerById(s.customer_id);
  const items = itemsOf(s.id).map((i) => `${i.product_name} talla ${i.size}${i.qty > 1 ? ` (x${i.qty})` : ''}`).join(', ');
  return `¡Hola${c?.name ? ' ' + c.name.split(' ')[0] : ''}! Tu ${items} de TRCO ya está lista 🔥 ¿Cómo te la hacemos llegar?`;
};

function orderRows(sales) {
  return sales
    .map((s) => {
      const c = customerById(s.customer_id);
      const items = itemsOf(s.id).map((i) => `${i.size}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ');
      const link = s.status !== 'preventa' ? waLink(c, readyMessage(s)) : null;
      return `<div class="row">
        <div class="row-main"><div class="row-title">${esc(c?.name || 'Sin cliente')}</div><div class="row-sub">${esc(items)} · ${fmtDate(s.date)} · ${Q(s.total)}</div></div>
        <div class="row-end">${statusBadge(s)}${link ? `<div style="margin-top:6px"><a class="btn sm wa" href="${link}" target="_blank" rel="noopener">WhatsApp</a></div>` : s.status !== 'preventa' && !c?.phone ? '<div class="row-sub">sin teléfono</div>' : ''}</div>
      </div>`;
    })
    .join('');
}

function openOrders(p) {
  const sales = preorderSales(p.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  sheet({
    title: `Pedidos · ${p.name}`,
    body: sales.length
      ? `<p class="muted small" style="margin-top:0">Por orden de llegada. Cuando un pedido se aparta pasa a "Por enviar" y puedes avisarle al cliente.</p><div class="list">${orderRows(sales)}</div>`
      : emptyState('Aún no hay pedidos. Se registran con Vender (＋) eligiendo este producto.'),
  });
}

export function showAllocated({ done, waiting }) {
  if (!done.length) {
    toast(waiting.length ? `No alcanzó el stock para ${waiting.length} pedido${waiting.length === 1 ? '' : 's'}` : 'No hay preventas por apartar');
    return;
  }
  sheet({
    title: 'Preventas apartadas',
    body: `
      <p class="muted small" style="margin-top:0">${int(done.length)} pedido${done.length === 1 ? '' : 's'} apartado${done.length === 1 ? '' : 's'} y listo${done.length === 1 ? '' : 's'} para entregar.${waiting.length ? ` ${int(waiting.length)} siguen esperando stock.` : ''} Avísale a cada cliente:</p>
      <div class="list">${orderRows(done.map((s) => state.sales.find((x) => x.id === s.id) || s))}</div>`,
  });
}

function sendToProduction(p) {
  const sizes = Object.keys(p.preorder?.quotas || {});
  sheet({
    title: 'Mandar a producir',
    body: `
      <p class="muted small" style="margin-top:0">Pedidos de preventa más un extra para vender después.</p>
      <label class="field"><span>Extra (%)</span><input id="extra" inputmode="numeric" value="20"></label>
      <div class="pre-sizes" id="mp-sizes"></div>
      <button class="btn primary block" type="button" id="mp-go" style="margin-top:12px">Crear lote de producción</button>`,
    onMount(root, close) {
      const calc = () => {
        const ex = Math.max(0, num($('#extra', root).value)) / 100;
        return Object.fromEntries(sizes.map((sz) => [sz, Math.ceil(preorderCount(p.id, sz) * (1 + ex))]).filter(([, n]) => n > 0));
      };
      const draw = () => {
        const q = calc();
        $('#mp-sizes', root).innerHTML = sizes
          .map((sz) => `<div><b>${esc(sz)}</b><span>${int(preorderCount(p.id, sz))} → ${int(q[sz] || 0)}</span></div>`)
          .join('');
      };
      $('#extra', root).oninput = draw;
      draw();
      $('#mp-go', root).onclick = () => {
        const quantities = calc();
        close();
        setTimeout(() => openBatch(null, { product_id: p.id, quantities, notes: 'Lote para preventa' }), 240);
      };
    },
  });
}
