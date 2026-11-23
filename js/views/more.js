// Menú del usuario (esquina superior derecha): reemplaza a la antigua pestaña "Más".
import { state, isOwner, can, isPending, signOut, CLOUD } from '../db.js';
import { ROLE_LABEL } from '../permissions.js';
import { $, $$, esc, int } from '../ui.js';
import { icons } from '../icons.js';
import { bus } from '../bus.js';
import { setFilter } from './sales.js';

export const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Usuario';

function items() {
  const inProd = state.production.filter((b) => b.status !== 'recibido').length;
  const pending = state.sales.filter(isPending).length;
  return [
    can('reportes') && { href: 'reportes', icon: icons.chart, title: 'Reportes', sub: 'Qué se vende, cuándo y ganancias' },
    { href: 'ventas', icon: icons.receipt, title: 'Pedidos pendientes', sub: pending ? `${int(pending)} por atender` : 'Nada pendiente', go: () => setFilter('pendientes') },
    can('clientes') && { href: 'clientes', icon: icons.users, title: 'Clientes', sub: `${int(state.customers.length)} registrados` },
    { href: 'produccion', icon: icons.factory, title: 'Producción', sub: inProd ? `${int(inProd)} ${inProd === 1 ? "lote" : "lotes"} en camino` : 'Lotes con proveedor' },
    { href: 'drops', icon: icons.fire, title: 'Drops', sub: `${int(state.drops.length)} colecciones` },
    can('gastos') && { href: 'gastos', icon: icons.wallet, title: 'Gastos', sub: 'Publicidad, envíos, empaque…' },
    isOwner() && { href: 'usuarios', icon: icons.key, title: 'Usuarios', sub: 'Permisos y contraseñas' },
    { href: 'ajustes', icon: icons.gear, title: 'Ajustes', sub: isOwner() ? 'Catálogos, respaldo, mi cuenta' : 'Mi cuenta' },
  ].filter(Boolean);
}

export function userButtonHTML() {
  const name = state.profile?.name;
  return `<button class="user-btn" id="user-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Menú de ${esc(name || 'usuario')}">
    <span class="avatar">${esc(initial(name))}</span>
    <span class="uname">${esc(firstName(name))}</span>
    ${icons.chevDown}
  </button>`;
}

function closeMenu(wrap) {
  wrap._off?.();
  wrap.classList.remove('open');
  $('#user-btn')?.setAttribute('aria-expanded', 'false');
  setTimeout(() => wrap.parentNode?.removeChild(wrap), 160);
}

export const closeUserMenu = () => {
  const w = $('.umenu-wrap');
  if (w) closeMenu(w);
};

export function toggleUserMenu() {
  const open = $('.umenu-wrap');
  if (open) return closeMenu(open);
  const p = state.profile || {};
  const list = items();
  const wrap = document.createElement('div');
  wrap.className = 'umenu-wrap';
  wrap.innerHTML = `
    <div class="umenu" role="menu" aria-label="Menú">
      <div class="umenu-head">
        <span class="avatar lg">${esc(initial(p.name))}</span>
        <div><b>${esc(p.name || '')}</b><small>@${esc(p.username || '')} · ${esc(ROLE_LABEL[p.role] || '')}${CLOUD ? '' : ' · Demo'}</small></div>
      </div>
      <div class="umenu-list">${list
        .map(
          (it, i) => `<a class="umenu-item" role="menuitem" href="#${it.href}" data-i="${i}">
            ${it.icon}<span><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>${icons.chev}</a>`
        )
        .join('')}</div>
      <button class="umenu-logout" type="button" id="menu-logout">${icons.logout} Cerrar sesión</button>
    </div>`;
  document.body.appendChild(wrap);
  $('#user-btn')?.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => wrap.classList.add('open'));
  wrap.addEventListener('click', (e) => e.target === wrap && closeMenu(wrap));
  $$('.umenu-item', wrap).forEach(
    (a) =>
      (a.onclick = () => {
        list[Number(a.dataset.i)].go?.();
        closeMenu(wrap);
        if (location.hash === a.getAttribute('href')) bus.rerender();
      })
  );
  $('#menu-logout', wrap).onclick = signOut;
  const onKey = (e) => e.key === 'Escape' && closeMenu(wrap);
  document.addEventListener('keydown', onKey);
  wrap._off = () => document.removeEventListener('keydown', onKey);
}
