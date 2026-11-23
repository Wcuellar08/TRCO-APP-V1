import {
  state, CLOUD, isOwner, can, saveSettings, signOut, exportData, demoReplace, demoReset, refresh,
} from '../db.js';
import { $, esc, toast, confirmAction, downloadFile, toCSV, today } from '../ui.js';
import { ROLE_LABEL } from '../permissions.js';
import { bus } from '../bus.js';
import { buildDemoData } from '../demo.js';

const LISTS = [
  ['types', 'Tipos de prenda', 'Playera, Playera oversize, Hoodie…'],
  ['sizes', 'Tallas', 'XS, S, M, L, XL, XXL'],
  ['channels', 'Canales de venta', 'Instagram, WhatsApp, Evento…'],
  ['payments', 'Métodos de pago', 'Efectivo, Transferencia…'],
  ['expense_categories', 'Categorías de gastos', 'Publicidad, Envíos…'],
];

export function render(page) {
  const owner = isOwner();
  const exportOk = can('exportar');
  const me = state.profile;
  page.innerHTML = `
    <div class="section" style="margin-top:0"><h2>Mi cuenta</h2></div>
    <div class="card">
      <div class="kv"><span>Nombre</span><span>${esc(me?.name)}</span></div>
      ${CLOUD ? `<div class="kv"><span>Usuario</span><span>@${esc(me?.username)}</span></div>` : ''}
      <div class="kv"><span>Rol</span><span>${ROLE_LABEL[me?.role] || ''}</span></div>
      <div class="kv"><span>Datos</span><span>${CLOUD ? 'En la nube (Firebase)' : 'Solo este dispositivo (demo)'}</span></div>
    </div>

    ${owner ? '<div class="btn-row"><a class="btn" href="#usuarios">Gestionar usuarios y permisos</a></div>' : ''}
    ${CLOUD && !owner ? '<p class="muted small">¿Necesitas cambiar tu contraseña? Pídeselo al Dueño.</p>' : ''}

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

    ${exportOk || !CLOUD ? `
    <div class="section"><h2>Respaldo y Excel</h2></div>
    <div class="card form">
      <button class="btn block" id="csv-inv">Descargar inventario (CSV)</button>
      ${can('clientes') ? '<button class="btn block" id="csv-cli">Descargar clientes (CSV)</button>' : ''}
      ${owner ? '<button class="btn block" id="backup">Descargar respaldo completo (JSON)</button>' : ''}
      ${!CLOUD ? `<label class="btn block" style="position:relative">Restaurar respaldo (JSON)<input type="file" id="restore" accept="application/json,.json" style="position:absolute;inset:0;opacity:0"></label>` : ''}
      <span class="hint muted small">Los CSV se abren en Excel, Numbers o Google Sheets.</span>
    </div>` : ''}

    ${!CLOUD ? `
    <div class="section"><h2>Modo demo</h2></div>
    <div class="card form">
      <p class="muted small" style="margin:0">Los datos viven solo en este navegador. Para compartir con tu equipo y no perder nada, conecta Firebase (ver README del proyecto).</p>
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

  const csvInv = $('#csv-inv', page);
  if (csvInv) csvInv.onclick = () => {
    const sizes = state.settings.sizes;
    const cols = [
      { label: 'Producto', get: (p) => p.name },
      { label: 'Tipo', get: (p) => p.type },
      { label: 'Color', get: (p) => p.color },
      { label: 'Precio', get: (p) => p.price },
      ...(can('costos') ? [{ label: 'Costo', get: (p) => p.cost }] : []),
      ...sizes.map((s) => ({ label: s, get: (p) => p.stock?.[s] ?? '' })),
      { label: 'Activo', get: (p) => (p.active === false ? 'No' : 'Sí') },
    ];
    downloadFile(`TRCO-inventario-${today()}.csv`, toCSV(state.products, cols), 'text/csv;charset=utf-8');
  };
  const csvCli = $('#csv-cli', page);
  if (csvCli) csvCli.onclick = () => {
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

