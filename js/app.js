import { CLOUD, state, currentUser, loadAll, signIn, signUp, signOut } from './db.js';
import { $, esc, toast } from './ui.js';
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
import * as more from './views/more.js';

const routes = {
  inicio: { view: dashboard, title: 'Inicio', tab: 'inicio' },
  inventario: { view: inventory, title: 'Inventario', tab: 'inventario' },
  ventas: { view: sales, title: 'Ventas', tab: 'ventas' },
  mas: { view: more, title: 'Más', tab: 'mas' },
  reportes: { view: reports, title: 'Reportes', tab: 'mas', back: 'mas' },
  clientes: { view: customers, title: 'Clientes', tab: 'mas', back: 'mas' },
  produccion: { view: production, title: 'Producción', tab: 'mas', back: 'mas' },
  gastos: { view: expenses, title: 'Gastos', tab: 'mas', back: 'mas', owner: true },
  drops: { view: drops, title: 'Drops', tab: 'mas', back: 'mas' },
  ajustes: { view: settings, title: 'Ajustes', tab: 'mas', back: 'mas' },
};

const app = $('#app');

function currentRoute() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const r = routes[name] ? name : 'inicio';
  return { name: r, params: rest, ...routes[r] };
}

function shell() {
  app.innerHTML = `
    <header class="topbar">
      <a class="back hidden btn-text" id="back" href="#/mas">‹ Más</a>
      <h1 id="title"></h1>
      ${CLOUD ? '' : '<span class="demo-pill" title="Los datos se guardan solo en este dispositivo">Demo</span>'}
      <span class="brand-mark">TRCO</span>
    </header>
    <main class="page" id="page"></main>
    <nav class="tabbar" aria-label="Navegación">
      <a class="tab" data-tab="inicio" href="#/inicio">${icons.home}<span>Inicio</span></a>
      <a class="tab" data-tab="inventario" href="#/inventario">${icons.shirt}<span>Inventario</span></a>
      <a class="tab tab-sell" id="tab-sell" href="#" aria-label="Nueva venta"><span class="plus">${icons.plus}</span></a>
      <a class="tab" data-tab="ventas" href="#/ventas">${icons.receipt}<span>Ventas</span></a>
      <a class="tab" data-tab="mas" href="#/mas">${icons.grid}<span>Más</span></a>
    </nav>`;
  $('#tab-sell').addEventListener('click', (e) => {
    e.preventDefault();
    sales.openNewSale();
  });
}

let lastRoute = '';
function render() {
  const r = currentRoute();
  if (r.owner && state.profile?.role !== 'owner') {
    location.hash = '#/inicio';
    return;
  }
  document.title = `${r.title} · TRCO`;
  $('#title').textContent = r.title;
  const back = $('#back');
  back.classList.toggle('hidden', !r.back);
  document.querySelectorAll('.tab[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === r.tab));
  const page = $('#page');
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

// ───────────── Pantallas de acceso ─────────────
function authScreen(mode = 'login', msg = '') {
  app.innerHTML = `
    <div class="auth"><div class="auth-box">
      <div class="logo">TRCO<span>.</span></div>
      <p>${mode === 'login' ? 'Entra para controlar tu negocio.' : 'Crea tu cuenta. La primera cuenta será la del dueño.'}</p>
      ${msg ? `<div class="alert info" style="margin-bottom:16px">${esc(msg)}</div>` : ''}
      <form class="form" id="auth-form">
        ${mode === 'signup' ? '<label class="field"><span>Nombre</span><input name="name" required autocomplete="name"></label>' : ''}
        <label class="field"><span>Correo</span><input name="email" type="email" required autocomplete="email" inputmode="email"></label>
        <label class="field"><span>Contraseña</span><input name="password" type="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
        <button class="btn primary block" type="submit">${mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
      </form>
      <p style="margin-top:18px;text-align:center">
        <button class="btn-text" id="auth-toggle">${mode === 'login' ? '¿No tienes cuenta? Crear una' : 'Ya tengo cuenta'}</button>
      </p>
    </div></div>`;
  $('#auth-toggle').onclick = () => authScreen(mode === 'login' ? 'signup' : 'login');
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      if (mode === 'login') {
        await signIn(f.email.trim(), f.password);
        await boot();
      } else {
        const { needsConfirm } = await signUp(f.email.trim(), f.password, f.name.trim());
        if (needsConfirm) authScreen('login', 'Te enviamos un correo para confirmar tu cuenta. Confírmala y luego entra.');
        else await boot();
      }
    } catch (err) {
      btn.disabled = false;
      toast(traducirError(err.message), 'error');
    }
  };
}

function traducirError(m = '') {
  if (/Invalid login/i.test(m)) return 'Correo o contraseña incorrectos';
  if (/Email not confirmed/i.test(m)) return 'Primero confirma tu correo';
  if (/already registered/i.test(m)) return 'Ese correo ya tiene cuenta';
  if (/Password should be/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres';
  return m || 'Ocurrió un error';
}

function pendingScreen() {
  app.innerHTML = `
    <div class="auth"><div class="auth-box">
      <div class="logo">TRCO<span>.</span></div>
      <p>Hola ${esc(state.profile?.name || '')}. Tu cuenta está <b>pendiente de aprobación</b>. Pídele al dueño que te active desde <i>Más → Ajustes → Equipo</i>.</p>
      <div class="btn-row">
        <button class="btn" id="retry">Revisar de nuevo</button>
        <button class="btn" id="logout">Salir</button>
      </div>
    </div></div>`;
  $('#retry').onclick = boot;
  $('#logout').onclick = signOut;
}

async function boot() {
  try {
    const user = await currentUser();
    if (!user) return authScreen();
    const ok = await loadAll(user);
    if (!ok) return pendingScreen();
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

window.addEventListener('hashchange', () => $('#page') && render());
boot();
