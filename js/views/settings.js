import {
  state, CLOUD, isOwner, can, saveSettings, signOut, exportData, demoReplace, demoReset, refresh,
} from '../db.js';
import { $, esc, toast, confirmAction, downloadFile, toCSV, today } from '../ui.js';
import { ROLE_LABEL } from '../permissions.js';
import { autoScanEnabled, setAutoScan } from './sales.js';
import { bus } from '../bus.js';
import { buildDemoData } from '../demo.js';

export function render(page) {
  const owner = isOwner();
  const exportOk = can('exportar');
  const me = state.profile;
  page.innerHTML = `
    <div class="section" style="margin-top:0"><h2>Mi cuenta</h2></div>
    <div class="card">
      <div class="kv"><span>Nombre</span><span>${esc(me?.name)}</span></div>
      <div class="kv"><span>Usuario</span><span>@${esc(me?.username)}</span></div>
      <div class="kv"><span>Rol</span><span>${ROLE_LABEL[me?.role] || ''}</span></div>
      <div class="kv"><span>Datos</span><span>${CLOUD ? 'En la nube (Firebase)' : 'Solo este dispositivo (demo)'}</span></div>
    </div>

    ${owner ? '<div class="btn-row"><a class="btn" href="#usuarios">Gestionar usuarios y permisos</a></div>' : ''}
    ${!owner ? '<p class="muted small">¿Necesitas cambiar tu contraseña? Pídeselo al Dueño.</p>' : ''}

    ${owner ? `
    <div class="section"><h2>Catálogos</h2></div>
    <a class="row card-link" href="#catalogos">
      <div class="row-main"><div class="row-title">Tipos, tallas, canales, pagos y gastos</div>
      <div class="row-sub">Las opciones de los menús de la app</div></div><span class="chev">›</span>
    </a>

    <div class="section"><h2>Etiquetas QR</h2></div>
    <form class="card form" id="label-form">
      <div class="grid2">
        <label class="field"><span>Ancho (mm)</span><input name="label_w" id="label-w" inputmode="numeric" value="${esc(state.settings.label_w || 40)}"></label>
        <label class="field"><span>Alto (mm)</span><input name="label_h" id="label-h" inputmode="numeric" value="${esc(state.settings.label_h || 30)}"></label>
      </div>
      <span class="hint muted small">Usa el tamaño de los stickers de tu impresora (Niimbot B1: 40 × 30 mm recomendado).</span>
      <button class="btn block" type="submit">Guardar tamaño</button>
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

    <div class="section"><h2>Vender</h2></div>
    <div class="card">
      <label class="check"><input type="checkbox" id="autoscan" ${autoScanEnabled() ? 'checked' : ''}> Abrir la cámara al tocar Vender (＋)</label>
      <p class="muted small" style="margin:8px 0 0">Se guarda en este dispositivo. Apágalo si vas a vender prendas sin etiqueta.</p>
    </div>

    <div class="section"><h2>Instalar en iPhone</h2></div>
    <div class="card small muted">
      1. Abre esta página en <b>Safari</b>.<br>
      2. Toca el botón <b>Compartir</b> (cuadro con flecha ↑).<br>
      3. Elige <b>“Agregar a pantalla de inicio”</b> → <b>Agregar</b>.<br>
      La app TRCO aparece como ícono y se abre en pantalla completa.
    </div>

    <div class="btn-row"><button class="btn danger" id="logout">Cerrar sesión</button></div>
  `;


  const labelForm = $('#label-form', page);
  if (labelForm)
    labelForm.onsubmit = async (e) => {
      e.preventDefault();
      const w = Math.round(Number(labelForm.label_w.value));
      const h = Math.round(Number(labelForm.label_h.value));
      if (!(w >= 25 && w <= 100 && h >= 15 && h <= 100)) return toast('Usa un tamaño entre 25 y 100 mm de ancho, y 15 y 100 mm de alto', 'error');
      try {
        await saveSettings({ ...state.settings, label_w: w, label_h: h });
        toast('Tamaño de etiqueta guardado');
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
      if (!(await confirmAction('¿Borrar todos los datos del demo (ventas, inventario, clientes…)? Los usuarios se conservan. No se puede deshacer.', { ok: 'Borrar', danger: true }))) return;
      demoReset();
      await refresh();
      toast('Datos borrados');
      bus.go('inicio');
    };
  $('#autoscan', page).onchange = (e) => {
    setAutoScan(e.target.checked);
    toast(e.target.checked ? 'La cámara se abrirá al vender' : 'Vender abrirá sin cámara');
  };
  const logout = $('#logout', page);
  if (logout) logout.onclick = signOut;
}

