// Navegación secundaria:
// - Panel lateral (☰): Eventos, Clientes, Producción, Drops, Gastos, Usuarios, Catálogos.
//   En pantallas grandes (iPad horizontal / computadora) queda fijo a la izquierda.
// - Menú del usuario (esquina superior derecha): solo Ajustes y Cerrar sesión.
import { state, isOwner, can, signOut, CLOUD } from '../db.js';
import { ROLE_LABEL } from '../permissions.js';
import { $, $$, esc, int } from '../ui.js';
import { icons } from '../icons.js';

export const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Usuario';

function navItems() {
  const inProd = state.production.filter((b) => b.status !== 'recibido').length;
  const openEvents = state.events.filter((e) => e.status !== 'cerrado').length;
  return [
    { href: 'eventos', icon: icons.event, title: 'Eventos', badge: openEvents ? `${int(openEvents)} abierto${openEvents === 1 ? '' : 's'}` : '' },
    can('clientes') && { href: 'clientes', icon: icons.users, title: 'Clientes', badge: '' },
    { href: 'produccion', icon: icons.factory, title: 'Producción', badge: inProd ? `${int(inProd)} en camino` : '' },
    { href: 'drops', icon: icons.fire, title: 'Drops', badge: '' },
    can('gastos') && { href: 'gastos', icon: icons.wallet, title: 'Gastos', badge: '' },
    isOwner() && { section: 'Administración' },
    isOwner() && { href: 'usuarios', icon: icons.key, title: 'Usuarios', badge: '' },
    isOwner() && { href: 'catalogos', icon: icons.tag, title: 'Catálogos', badge: '' },
  ].filter(Boolean);
}

// ── Panel lateral ──
export function sideNavHTML() {
  return `<div class="sidenav-backdrop" id="sidenav-backdrop"></div>
    <aside class="sidenav" id="sidenav" aria-label="Secciones">
      <div class="sidenav-head"><b>TRCO<span>.</span></b><button class="btn-text" type="button" id="sidenav-close" aria-label="Cerrar menú">Cerrar</button></div>
      <nav class="sidenav-list" id="sidenav-list"></nav>
    </aside>`;
}

export function renderSideNav(route) {
  const list = $('#sidenav-list');
  if (!list) return;
  list.innerHTML = navItems()
    .map((it) =>
      it.section
        ? `<div class="sidenav-section">${esc(it.section)}</div>`
        : `<a class="sidenav-item ${route === it.href ? 'active' : ''}" href="#${it.href}" ${route === it.href ? 'aria-current="page"' : ''}>
            ${it.icon}<span>${esc(it.title)}</span>${it.badge ? `<small>${esc(it.badge)}</small>` : ''}</a>`
    )
    .join('');
  $$('.sidenav-item', list).forEach((a) => (a.onclick = closeSideNav));
}

export function openSideNav() {
  document.body.classList.add('nav-open');
  $('#nav-btn')?.setAttribute('aria-expanded', 'true');
}
export function closeSideNav() {
  document.body.classList.remove('nav-open');
  $('#nav-btn')?.setAttribute('aria-expanded', 'false');
}
export function bindSideNav() {
  $('#nav-btn')?.addEventListener('click', () => (document.body.classList.contains('nav-open') ? closeSideNav() : openSideNav()));
  $('#sidenav-backdrop')?.addEventListener('click', closeSideNav);
  $('#sidenav-close')?.addEventListener('click', closeSideNav);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeSideNav());
}

// ── Menú del usuario ──
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
  const wrap = document.createElement('div');
  wrap.className = 'umenu-wrap';
  wrap.innerHTML = `
    <div class="umenu" role="menu" aria-label="Menú de usuario">
      <div class="umenu-head">
        <span class="avatar lg">${esc(initial(p.name))}</span>
        <div><b>${esc(p.name || '')}</b><small>@${esc(p.username || '')} · ${esc(ROLE_LABEL[p.role] || '')}${CLOUD ? '' : ' · Demo'}</small></div>
      </div>
      <div class="umenu-list">
        <a class="umenu-item" role="menuitem" href="#ajustes">${icons.gear}<span><b>Ajustes</b><small>${isOwner() ? 'Etiquetas, respaldo, mi cuenta' : 'Mi cuenta'}</small></span>${icons.chev}</a>
      </div>
      <button class="umenu-logout" type="button" id="menu-logout">${icons.logout} Cerrar sesión</button>
    </div>`;
  document.body.appendChild(wrap);
  $('#user-btn')?.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => wrap.classList.add('open'));
  wrap.addEventListener('click', (e) => e.target === wrap && closeMenu(wrap));
  $('.umenu-item', wrap).onclick = () => closeMenu(wrap);
  $('#menu-logout', wrap).onclick = signOut;
  const onKey = (e) => e.key === 'Escape' && closeMenu(wrap);
  document.addEventListener('keydown', onKey);
  wrap._off = () => document.removeEventListener('keydown', onKey);
}
