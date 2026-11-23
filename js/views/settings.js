import {
  state, CLOUD, isOwner, saveSettings, saveRow, signOut, exportData, demoReplace, demoReset, refresh,
} from '../db.js';
import { $, $$, esc, toast, confirmAction, downloadFile, toCSV, options, today } from '../ui.js';
import { bus } from '../bus.js';
import { buildDemoData } from '../demo.js';

const LISTS = [
  ['types', 'Tipos de prenda', 'Playera, Playera oversize, Hoodie…'],
  ['sizes', 'Tallas', 'XS, S, M, L, XL, XXL'],
  ['channels', 'Canales de venta', 'Instagram, WhatsApp, Evento…'],
  ['payments', 'Métodos de pago', 'Efectivo, Transferencia…'],
  ['expense_categories', 'Categorías de gastos', 'Publicidad, Envíos…'],
];

const ROLES = [
  { value: 'owner', label: 'Dueño (ve todo)' },
  { value: 'staff', label: 'Equipo (sin costos ni gastos)' },
  { value: 'pending', label: 'Sin acceso' },
];

export function render(page) {
  const owner = isOwner();
  const me = state.profile;
  page.innerHTML = `
    <div class="section" style="margin-top:0"><h2>Mi cuenta</h2></div>
    <div class="card">
      <div class="kv"><span>Nombre</span><span>${esc(me?.name)}</span></div>
      ${CLOUD ? `<div class="kv"><span>Correo</span><span>${esc(me?.email || state.user?.email)}</span></div>` : ''}
      <div class="kv"><span>Rol</span><span>${owner ? 'Dueño' : 'Equipo'}</span></div>
      <div class="kv"><span>Datos</span><span>${CLOUD ? 'En la nube (Supabase)' : 'Solo este dispositivo (demo)'}</span></div>
    </div>

    ${CLOUD && owner ? `
    <div class="section"><h2>Equipo</h2></div>
    <div class="card">
      <p class="muted small" style="margin-top:0">Pide a tu equipo que abra la app y toque “Crear cuenta”. Aparecerán aquí como “Sin acceso” hasta que les asignes un rol.</p>
      ${state.profiles
        .map(
          (p) => `<div class="kv" style="align-items:center"><span>${esc(p.name)}<br><span class="small">${esc(p.email)}</span></span>
          <span>${p.id === me.id ? 'Tú (dueño)' : `<select data-role="${p.id}" style="min-height:38px;border-radius:10px;background:var(--surface-2);border:1px solid var(--line);padding:4px 8px">${options(ROLES, p.role)}</select>`}</span></div>`
        )
        .join('')}
    </div>` : ''}

    ${owner ? `
    <div class="section"><h2>Catálogos</h2></div>
    <form class="card form" id="lists">
      ${LISTS.map(
        ([k, label, ph]) => `<label class="field"><span>${label}</span><input name="${k}" value="${esc(state.settings[k].join(', '))}" placeholder="${ph}">
        </label>`
      ).join('')}
      <span class="hint muted small">Separa con comas. Cambiar un nombre aquí no cambia ventas pasadas.</span>
      <button class="btn primary block" type="submit">Guardar catálogos</button>
    </form>` : ''}

    <div class="section"><h2>Respaldo y Excel</h2></div>
    <div class="card form">
      <button class="btn block" id="csv-inv">Descargar inventario (CSV)</button>
      <button class="btn block" id="csv-cli">Descargar clientes (CSV)</button>
      ${owner ? '<button class="btn block" id="backup">Descargar respaldo completo (JSON)</button>' : ''}
      ${!CLOUD ? `<label class="btn block" style="position:relative">Restaurar respaldo (JSON)<input type="file" id="restore" accept="application/json,.json" style="position:absolute;inset:0;opacity:0"></label>` : ''}
      <span class="hint muted small">Los CSV se abren en Excel, Numbers o Google Sheets.</span>
    </div>

    ${!CLOUD ? `
    <div class="section"><h2>Modo demo</h2></div>
    <div class="card form">
      <p class="muted small" style="margin:0">Los datos viven solo en este navegador. Para compartir con tu equipo y no perder nada, conecta Supabase (ver README del proyecto).</p>
      <button class="btn block" id="seed">Cargar datos de ejemplo</button>
      <button class="btn danger block" id="wipe">Borrar todos los datos del demo</button>
    </div>` : ''}

    <div class="section"><h2>Instalar en iPhone</h2></div>
    <div class="card small muted">
      1. Abre esta página en <b>Safari</b>.<br>
      2. Toca el botón <b>Compartir</b> (cuadro con flecha ↑).<br>
      3. Elige <b>“Agregar a pantalla de inicio”</b> → <b>Agregar</b>.<br>
      La app TRCO aparece como ícono y se abre en pantalla completa.
    </div>

    ${CLOUD ? '<div class="btn-row"><button class="btn danger" id="logout">Cerrar sesión</button></div>' : ''}
  `;

  $$('[data-role]', page).forEach(
    (sel) =>
      (sel.onchange = async () => {
        try {
          await saveRow('profiles', { id: sel.dataset.role, role: sel.value });
          toast('Rol actualizado');
        } catch (e) {
          toast(e.message, 'error');
        }
      })
  );

  const lists = $('#lists', page);
  if (lists)
    lists.onsubmit = async (e) => {
      e.preventDefault();
      const data = { ...state.settings };
      for (const [k] of LISTS) {
        const vals = [...new Set(lists[k].value.split(',').map((s) => s.trim()).filter(Boolean))];
        if (vals.length) data[k] = vals;
      }
      try {
        await saveSettings(data);
        toast('Catálogos guardados');
        bus.rerender();
      } catch (err) {
        toast(err.message, 'error');
      }
    };

  $('#csv-inv', page).onclick = () => {
    const sizes = state.settings.sizes;
    const cols = [
      { label: 'Producto', get: (p) => p.name },
      { label: 'Tipo', get: (p) => p.type },
      { label: 'Color', get: (p) => p.color },
      { label: 'Precio', get: (p) => p.price },
      ...(owner ? [{ label: 'Costo', get: (p) => p.cost }] : []),
      ...sizes.map((s) => ({ label: s, get: (p) => p.stock?.[s] ?? '' })),
      { label: 'Activo', get: (p) => (p.active === false ? 'No' : 'Sí') },
    ];
    downloadFile(`TRCO-inventario-${today()}.csv`, toCSV(state.products, cols), 'text/csv;charset=utf-8');
  };
  $('#csv-cli', page).onclick = () => {
    const cols = [
      { label: 'Nombre', get: (c) => c.name },
      { label: 'Instagram', get: (c) => c.instagram },
      { label: 'Teléfono', get: (c) => c.phone },
      { label: 'Ciudad', get: (c) => c.city },
      { label: 'Compras', get: (c) => state.sales.filter((s) => s.customer_id === c.id && s.status !== 'cancelado').length },
      { label: 'Notas', get: (c) => c.notes },
    ];
    downloadFile(`TRCO-clientes-${today()}.csv`, toCSV(state.customers, cols), 'text/csv;charset=utf-8');
  };
  const backup = $('#backup', page);
  if (backup) backup.onclick = () => downloadFile(`TRCO-respaldo-${today()}.json`, JSON.stringify(exportData()), 'application/json');

  const restore = $('#restore', page);
  if (restore)
    restore.onchange = async () => {
      const file = restore.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.app !== 'TRCO') throw new Error('Ese archivo no es un respaldo de TRCO');
        if (!(await confirmAction('¿Reemplazar TODOS los datos de este dispositivo con el respaldo?'))) return;
        delete data.app;
        demoReplace(data);
        await refresh();
        toast('Respaldo restaurado');
        bus.go('inicio');
      } catch (e) {
        toast(e.message, 'error');
      }
    };

  const seed = $('#seed', page);
  if (seed)
    seed.onclick = async () => {
      if (state.products.length && !(await confirmAction('Esto reemplaza los datos actuales del demo con datos de ejemplo. ¿Continuar?'))) return;
      demoReplace(buildDemoData());
      await refresh();
      toast('Datos de ejemplo cargados');
      bus.go('inicio');
    };
  const wipe = $('#wipe', page);
  if (wipe)
    wipe.onclick = async () => {
      if (!(await confirmAction('¿Borrar TODOS los datos del demo? No se puede deshacer.', { ok: 'Borrar', danger: true }))) return;
      demoReset();
      await refresh();
      toast('Datos borrados');
      bus.go('inicio');
    };
  const logout = $('#logout', page);
  if (logout) logout.onclick = signOut;
}

