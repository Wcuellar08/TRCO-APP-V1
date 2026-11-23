// Catálogos: tipos de prenda, tallas, canales, métodos de pago y categorías de gastos.
// Cada opción es un chip: agregar, quitar (×), renombrar y mover. Se guarda solo.
import { state, saveSettings, saveRow } from '../db.js';
import { $, $$, esc, int, sheet, toast, confirmAction } from '../ui.js';
import { bus } from '../bus.js';

const LISTS = [
  { key: 'types', title: 'Tipos de prenda', hint: 'Aparecen al crear un producto y en la etiqueta.', ph: 'Ej. Hoodie' },
  { key: 'sizes', title: 'Tallas', hint: 'El orden de aquí es el orden en toda la app.', ph: 'Ej. XXXL', upper: true },
  { key: 'channels', title: 'Canales de venta', hint: 'Dónde vendiste: se usa en los reportes.', ph: 'Ej. Tienda en línea' },
  { key: 'payments', title: 'Métodos de pago', hint: 'Cómo te pagaron.', ph: 'Ej. Link de pago' },
  { key: 'expense_categories', title: 'Categorías de gastos', hint: 'Para clasificar tus gastos.', ph: 'Ej. Renta' },
];

// Cuántos registros usan cada opción (para avisar antes de quitar o renombrar).
function usage(key, value) {
  const same = (x) => String(x || '').toLowerCase() === String(value).toLowerCase();
  switch (key) {
    case 'types':
      return { n: state.products.filter((p) => same(p.type)).length, what: 'productos' };
    case 'sizes':
      return { n: state.products.filter((p) => Object.keys(p.stock || {}).some(same)).length, what: 'productos' };
    case 'channels':
      return { n: state.sales.filter((s) => same(s.channel)).length, what: 'ventas' };
    case 'payments':
      return { n: state.sales.filter((s) => same(s.payment_method)).length, what: 'ventas' };
    default:
      return { n: state.expenses.filter((e) => same(e.category)).length, what: 'gastos' };
  }
}

async function save(key, list, msg) {
  try {
    await saveSettings({ ...state.settings, [key]: list });
    if (msg) toast(msg);
    bus.rerender();
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}

export function render(page) {
  page.innerHTML = `
    <p class="muted small" style="margin-top:0">Las opciones que aparecen en los menús de la app. Los cambios se guardan solos.</p>
    ${LISTS.map((l) => {
      const items = state.settings[l.key] || [];
      return `<section class="cat-card" data-key="${l.key}">
        <header><h3>${esc(l.title)} <span class="muted">${int(items.length)}</span></h3><p>${esc(l.hint)}</p></header>
        <div class="chip-list">${items
          .map(
            (v, i) => `<span class="tag-chip">
              <button type="button" class="tag-name" data-edit="${i}" aria-label="Editar ${esc(v)}">${esc(v)}</button>
              <button type="button" class="tag-x" data-del="${i}" aria-label="Quitar ${esc(v)}">×</button>
            </span>`
          )
          .join('')}</div>
        <form class="cat-add" autocomplete="off">
          <input name="v" id="add-${l.key}" placeholder="${esc(l.ph)}" ${l.upper ? 'autocapitalize="characters"' : ''} maxlength="40" aria-label="Agregar a ${esc(l.title)}">
          <button class="btn sm primary" type="submit">Agregar</button>
        </form>
      </section>`;
    }).join('')}`;

  $$('.cat-card', page).forEach((card) => {
    const l = LISTS.find((x) => x.key === card.dataset.key);
    const items = () => [...(state.settings[l.key] || [])];
    const clean = (v) => (l.upper ? v.trim().toUpperCase() : v.trim()).replace(/\s+/g, ' ');

    $('.cat-add', card).onsubmit = async (e) => {
      e.preventDefault();
      const input = e.target.v;
      const v = clean(input.value);
      if (!v) return;
      const list = items();
      if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return toast(`"${v}" ya está en la lista`, 'error');
      list.push(v);
      if (await save(l.key, list, `Agregado: ${v}`)) setTimeout(() => $(`#add-${l.key}`)?.focus(), 50);
    };

    $$('[data-del]', card).forEach(
      (b) =>
        (b.onclick = async () => {
          const list = items();
          const v = list[Number(b.dataset.del)];
          if (list.length <= 1) return toast('Debe quedar al menos una opción', 'error');
          const u = usage(l.key, v);
          const msg = u.n
            ? `¿Quitar "${v}"? Hay ${int(u.n)} ${u.what} que lo usan: se conservan, pero ya no aparecerá como opción.`
            : `¿Quitar "${v}"?`;
          if (!(await confirmAction(msg, { ok: 'Quitar', danger: true }))) return;
          list.splice(Number(b.dataset.del), 1);
          save(l.key, list, `Quitado: ${v}`);
        })
    );

    $$('[data-edit]', card).forEach((b) => (b.onclick = () => editItem(l, Number(b.dataset.edit))));
  });
}

function editItem(l, index) {
  const list = [...(state.settings[l.key] || [])];
  const old = list[index];
  const u = usage(l.key, old);
  sheet({
    title: l.title,
    body: `
      <form class="form" id="ef" autocomplete="off">
        <label class="field"><span>Nombre</span><input name="v" id="edit-v" value="${esc(old)}" maxlength="40" ${l.upper ? 'autocapitalize="characters"' : ''}></label>
        ${u.n ? `<p class="muted small" style="margin:0">Lo usan ${int(u.n)} ${u.what}.</p>` : ''}
        <div class="label">Posición ${index + 1} de ${list.length}</div>
        <div class="grid2">
          <button class="btn" type="button" id="mv-up" ${index === 0 ? 'disabled' : ''}>◀ Mover antes</button>
          <button class="btn" type="button" id="mv-down" ${index === list.length - 1 ? 'disabled' : ''}>Mover después ▶</button>
        </div>
        <button class="btn primary block" type="submit">Guardar nombre</button>
      </form>`,
    onMount(root, close) {
      const move = async (d) => {
        const to = index + d;
        [list[index], list[to]] = [list[to], list[index]];
        if (await save(l.key, list)) {
          close();
          setTimeout(() => editItem(l, to), 240);
        }
      };
      $('#mv-up', root).onclick = () => move(-1);
      $('#mv-down', root).onclick = () => move(1);
      $('#ef', root).onsubmit = async (e) => {
        e.preventDefault();
        let v = e.target.v.value.trim().replace(/\s+/g, ' ');
        if (l.upper) v = v.toUpperCase();
        if (!v || v === old) return close();
        if (list.some((x, i) => i !== index && x.toLowerCase() === v.toLowerCase())) return toast(`"${v}" ya está en la lista`, 'error');
        list[index] = v;
        if (!(await save(l.key, list, 'Nombre actualizado'))) return;
        // Los tipos de prenda viven en los productos: se ofrece cambiarlos también.
        if (l.key === 'types' && u.n && (await confirmAction(`¿Cambiar también el tipo en los ${int(u.n)} productos que dicen "${old}"?`, { ok: 'Sí, cambiar' }))) {
          try {
            for (const p of state.products.filter((x) => x.type === old)) await saveRow('products', { id: p.id, type: v });
            toast(`${int(u.n)} productos actualizados`);
            bus.rerender();
          } catch (err) {
            toast(err.message, 'error');
          }
        }
        close();
      };
    },
  });
}
