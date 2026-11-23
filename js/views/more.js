import { state, isOwner, can, isPending, CLOUD } from '../db.js';
import { ROLE_LABEL } from '../permissions.js';
import { esc } from '../ui.js';
import { icons } from '../icons.js';

export function render(page) {
  const owner = isOwner();
  const inProd = state.production.filter((b) => b.status !== 'recibido').length;
  const tile = (href, icon, title, sub, wide = false) =>
    `<a class="menu-tile ${wide ? 'wide' : ''}" href="#${href}">${icon}<b>${esc(title)}</b><span>${esc(sub)}</span></a>`;
  page.innerHTML = `
    <div class="menu-grid">
      ${can('reportes') ? tile('reportes', icons.chart, 'Reportes', 'Qué se vende más, cuándo, tallas, canales y ganancias', true) : ''}
      ${can('clientes') ? tile('clientes', icons.users, 'Clientes', `${state.customers.length} registrados`) : ''}
      ${tile('produccion', icons.factory, 'Producción', inProd ? `${inProd} lotes en camino` : 'Lotes con proveedor')}
      ${tile('drops', icons.fire, 'Drops', `${state.drops.length} colecciones`)}
      ${can('gastos') ? tile('gastos', icons.wallet, 'Gastos', 'Publicidad, envíos, empaque…') : ''}
      ${owner ? tile('usuarios', icons.users, 'Usuarios', `${state.profiles.length} · permisos y contraseñas`) : ''}
      ${tile('ventas', icons.receipt, 'Pedidos', `${state.sales.filter(isPending).length} pendientes`)}
      ${tile('ajustes', icons.gear, 'Ajustes', owner ? 'Catálogos, respaldo, cuenta' : 'Mi cuenta')}
    </div>
    <p class="muted small" style="text-align:center;margin-top:28px">
      ${esc(state.profile?.name || '')} · ${ROLE_LABEL[state.profile?.role] || ''}${CLOUD ? '' : ' · Modo demo'}<br>TRCO App v1
    </p>`;
}
