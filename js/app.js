import {
  CLOUD, state, currentUser, loadAll, signIn, signOut, ownerExists, createOwner, changeMyPassword, demoReplace, refresh, can, isOwner,
} from './db.js';
import { buildDemoData } from './demo.js';
import { $, esc, toast, Qs } from './ui.js';
import { icons } from './icons.js';
import { bus } from './bus.js';
import * as dashboard from './views/dashboard.js';
import * as inventory from './views/inventory.js';
import * as sales from './views/sales.js';
import * as reports from './views/reports.js';
import * as customers from './views/customers.js';
import * as production from './views/production.js';
import * as expenses from './views/expenses.js';
import * as drops from './views/drops.js';
import * as settings from './views/settings.js';
import { userButtonHTML, toggleUserMenu, closeUserMenu } from './views/more.js';
import * as usersView from './views/users.js';
import * as catalogs from './views/catalogs.js';
import * as eventsView from './views/events.js';
import { activeEvent } from './eventmode.js';

const routes = {
  inicio: { view: dashboard, title: 'Inicio', tab: 'inicio', wide: true },
  inventario: { view: inventory, title: 'Inventario', tab: 'inventario' },
  ventas: { view: sales, title: 'Pedidos', tab: 'ventas' },
  reportes: { view: reports, title: 'Reportes', tab: 'reportes', perm: 'reportes' },
  clientes: { view: customers, title: 'Clientes', tab: 'clientes', perm: 'clientes' },
  produccion: { view: production, title: 'Producción', tab: 'produccion' },
  gastos: { view: expenses, title: 'Gastos', perm: 'gastos' },
  drops: { view: drops, title: 'Drops' },
  usuarios: { view: usersView, title: 'Usuarios', owner: true },
  catalogos: { view: catalogs, title: 'Catálogos', owner: true },
  eventos: { view: eventsView, title: 'Eventos' },
  ajustes: { view: settings, title: 'Ajustes' },
};

const app = $('#app');

function currentRoute() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const r = routes[name] ? name : 'inicio';
  return { name: r, params: rest, ...routes[r] };
}

// Quinta pestaña: Reportes; si no tiene ese permiso, Clientes; si tampoco, Producción.
function fifthTab() {
  if (can('reportes')) return { key: 'reportes', icon: icons.chart, label: 'Reportes' };
  if (can('clientes')) return { key: 'clientes', icon: icons.users, label: 'Clientes' };
  return { key: 'produccion', icon: icons.factory, label: 'Producción' };
}

function shell() {
  const t5 = fifthTab();
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" id="brand" href="#inicio" aria-label="TRCO, ir a Inicio"><h1>TRCO<span>.</span></h1></a>
      <span class="topbar-spacer"></span>
      ${CLOUD ? '' : '<span class="demo-pill" title="Los datos se guardan solo en este dispositivo">Demo</span>'}
      ${userButtonHTML()}
    </header>
    <a class="ev-banner hidden" id="ev-banner" href="#eventos"></a>
    <main class="page" id="page"></main>
    <nav class="tabbar" aria-label="Navegación">
      <a class="tab" data-tab="inicio" href="#inicio">${icons.home}<span>Inicio</span></a>
      <a class="tab" data-tab="inventario" href="#inventario">${icons.shirt}<span>Inventario</span></a>
      ${can('vender') ? `<a class="tab tab-sell" id="tab-sell" href="#" aria-label="Vender: registrar una venta"><span class="plus">${icons.plus}</span><span>Vender</span></a>` : '<span></span>'}
      <a class="tab" data-tab="ventas" href="#ventas">${icons.receipt}<span>Pedidos</span></a>
      <a class="tab" data-tab="${t5.key}" href="#${t5.key}">${t5.icon}<span>${t5.label}</span></a>
    </nav>`;
  $('#user-btn').addEventListener('click', toggleUserMenu);
  $('#brand').addEventListener('click', () => {
    if (location.hash === '#inicio' || location.hash === '') window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#tab-sell')?.addEventListener('click', (e) => {
    e.preventDefault();
    sales.openNewSale({ autoScan: sales.autoScanEnabled() });
  });
}

let lastRoute = '';
function render() {
  const r = currentRoute();
  if ((r.owner && !isOwner()) || (r.perm && !can(r.perm))) {
    location.hash = '#inicio';
    return;
  }
  closeUserMenu();
  // Al cambiar de pantalla se cierran las hojas abiertas.
  if (location.hash !== lastRoute) document.querySelectorAll('.sheet-wrap [data-close]').forEach((b) => b.click());
  document.title = `${r.title} · TRCO`;
  document.querySelectorAll('.tab[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === r.tab));
  const page = $('#page');
  page.classList.toggle('wide', Boolean(r.wide));
  renderEventBanner();
  const key = location.hash;
  try {
    r.view.render(page, r.params);
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="alert">Ocurrió un error mostrando esta pantalla: ${esc(e.message)}</div>`;
  }
  if (key !== lastRoute) window.scrollTo(0, 0);
  lastRoute = key;
}

bus.rerender = render;

// Barra arriba cuando este teléfono está en modo evento: nombre y avance de la meta.
function renderEventBanner() {
  const el = $('#ev-banner');
  if (!el) return;
  const ev = activeEvent();
  el.classList.toggle('hidden', !ev);
  document.body.classList.toggle('event-mode', Boolean(ev));
  if (!ev) return;
  el.href = `#eventos/${ev.id}`;
  const st = eventsView.eventStats(ev);
  const goal = ev.goal ? ` · ${Qs(st.revenue)} de ${Qs(ev.goal)}` : can('reportes') ? ` · ${Qs(st.revenue)}` : '';
  el.innerHTML = `<span class="live-dot"></span><b>Modo evento</b><span class="ev-banner-name">${esc(ev.name)}${goal}</span>`;
  if (ev.goal) el.style.setProperty('--p', `${Math.min(100, (st.revenue / ev.goal) * 100)}%`);
  else el.style.removeProperty('--p');
}

// ───────────── Pantallas de acceso ─────────────
function authFrame(inner) {
  app.innerHTML = `<div class="auth"><div class="auth-box"><div class="logo">TRCO<span>.</span></div>${inner}</div></div>`;
}

function bindForm(onSubmit) {
  const form = $('#auth-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  };
}

const passwordFields = `
  <label class="field"><span>Contraseña nueva</span><input name="password" id="new-password" type="password" required minlength="6" autocomplete="new-password"></label>
  <label class="field"><span>Repite la contraseña</span><input name="password2" id="new-password2" type="password" required minlength="6" autocomplete="new-password">
    <span class="hint">Mínimo 6 caracteres.</span></label>`;

function checkPasswords(f) {
  if (f.password !== f.password2) throw new Error('Las contraseñas no coinciden');
  if (f.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
}

function loginScreen(msg = '') {
  authFrame(`
    <p>Entra con el usuario que te dio el Dueño.</p>
    ${msg ? `<div class="alert info" style="margin-bottom:16px">${esc(msg)}</div>` : ''}
    <form class="form" id="auth-form">
      <label class="field"><span>Usuario</span><input name="username" id="login-user" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
      <label class="field"><span>Contraseña</span><input name="password" id="login-password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary block" type="submit">Entrar</button>
    </form>
    <p class="muted small" style="margin-top:18px;text-align:center">¿Olvidaste tu contraseña? Pídele al Dueño que te asigne una nueva.</p>`);
  bindForm(async (f) => {
    await signIn(f.username, f.password);
    await boot();
  });
}

function setupOwnerScreen() {
  authFrame(`
    <p><b>Bienvenido.</b> Crea la cuenta del Dueño. Después, desde <i>Más → Usuarios</i>, das de alta a tu equipo.</p>
    <form class="form" id="auth-form">
      <label class="field"><span>Tu nombre</span><input name="name" id="setup-name" required autocomplete="name"></label>
      <label class="field"><span>Usuario</span><input name="username" id="setup-user" required autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="ej. will">
        <span class="hint">Con lo que vas a entrar. Sin espacios ni acentos.</span></label>
      ${passwordFields}
      <button class="btn primary block" type="submit">Crear cuenta de Dueño</button>
    </form>`);
  bindForm(async (f) => {
    checkPasswords(f);
    await createOwner({ username: f.username, name: f.name.trim(), password: f.password });
    await boot();
  });
}

function changePasswordScreen() {
  authFrame(`
    <p>Hola <b>${esc(state.profile?.name || '')}</b>. Antes de empezar, crea tu propia contraseña. Solo tú la sabrás.</p>
    <form class="form" id="auth-form">
      ${passwordFields}
      <button class="btn primary block" type="submit">Guardar y entrar</button>
    </form>
    <p style="text-align:center;margin-top:14px"><button class="btn-text" id="logout">Salir</button></p>`);
  $('#logout').onclick = signOut;
  bindForm(async (f) => {
    checkPasswords(f);
    await changeMyPassword(f.password);
    toast('Contraseña guardada');
    await boot();
  });
}

function blockedScreen(text) {
  authFrame(`<p>${text}</p><div class="btn-row"><button class="btn" id="logout">Salir</button></div>`);
  $('#logout').onclick = signOut;
}

// En la vista previa se cargan datos de ejemplo la primera vez.
async function maybeAutoSeed() {
  if (CLOUD || !window.TRCO_AUTOSEED || state.products.length || state.sales.length) return;
  try {
    if (localStorage.getItem('trco-autoseeded')) return;
    localStorage.setItem('trco-autoseeded', '1');
  } catch {}
  demoReplace(buildDemoData());
  await refresh();
}

async function boot() {
  try {
    const user = await currentUser();
    if (!user) return (await ownerExists()) ? loginScreen() : setupOwnerScreen();
    const status = await loadAll(user);
    if (status === 'cambiar_clave') return changePasswordScreen();
    if (status === 'inactivo') return blockedScreen('Tu usuario está desactivado. Habla con el Dueño.');
    if (status === 'sin_perfil') return blockedScreen('Tu usuario ya no existe. Habla con el Dueño.');
    await maybeAutoSeed();
    shell();
    render();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="auth"><div class="auth-box">
      <div class="logo">TRCO<span>.</span></div>
      <div class="alert">No se pudo cargar la información: ${esc(e.message)}.<br>Revisa tu conexión a internet.</div>
      <div class="btn-row"><button class="btn primary" onclick="location.reload()">Reintentar</button></div>
    </div></div>`;
  }
}

// Con la nube, trae lo que registró el resto del equipo: al volver a la app
// o al cambiar de pantalla (máximo cada 30 segundos).
let lastSync = Date.now();
async function syncIfStale(force = false) {
  if (!CLOUD || !$('#page') || (!force && Date.now() - lastSync < 30000)) return;
  lastSync = Date.now();
  try {
    await refresh();
    // Si el Dueño me desactivó o me asignó otra contraseña, salgo.
    if (state.profile?.active === false || state.profile?.must_change_password) return boot();
    if (!document.querySelector('.sheet-wrap')) {
      shell();
      render();
    }
  } catch (e) {
    console.warn('No se pudo actualizar', e);
  }
}

window.addEventListener('hashchange', () => {
  if (!$('#page')) return;
  render();
  syncIfStale();
});
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncIfStale());
bus.sync = () => syncIfStale(true);
boot();
