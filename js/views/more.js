import { state, isOwner, isPending, CLOUD } from '../db.js';
import { esc } from '../ui.js';
import { icons } from '../icons.js';

export function render(page) {
  const owner = isOwner();
  const inProd = state.production.filter((b) => b.status !== 'recibido').length;
  const tile = (href, icon, title, sub, wide = false) =>
    `<a class="menu-tile ${wide ? 'wide' : ''}" href="#/${href}">${icon}<b>${esc(title)}</b><span>${esc(sub)}</span></a>`;
  page.innerHTML = `
    <div class="menu-grid">
      ${tile('reportes', icons.chart, 'Reportes', 'Qué se vende más, cuándo, tallas, canales y ganancias', true)}
      ${tile('clientes', icons.users, 'Clientes', `${state.customers.length} registrados`)}
      ${tile('produccion', icons.factory, 'Producción', inProd ? `${inProd} lotes en camino` : 'Lotes con proveedor')}
      ${tile('drops', icons.fire, 'Drops', `${state.drops.length} colecciones`)}
      ${owner ? tile('gastos', icons.wallet, 'Gastos', 'Publicidad, envíos, empaque…') : ''}
      ${tile('ventas', icons.receipt, 'Pedidos', `${state.sales.filter(isPending).length} pendientes`)}
      ${tile('ajustes', icons.gear, 'Ajustes', owner ? 'Equipo, catálogos, respaldo' : 'Cuenta')}
    </div>
    <p class="muted small" style="text-align:center;margin-top:28px">
      ${esc(state.profile?.name || '')} · ${owner ? 'Dueño' : 'Equipo'}${CLOUD ? '' : ' · Modo demo'}<br>TRCO App v1
    </p>`;
}
