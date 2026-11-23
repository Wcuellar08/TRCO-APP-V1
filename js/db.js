// Capa de datos: el mismo código funciona con Firebase (nube) o con
// localStorage (modo demo). Toda la app lee de `state` y escribe con
// las funciones de este archivo.

import { FIREBASE_CONFIG } from './config.js';

export const CLOUD = Boolean(FIREBASE_CONFIG?.apiKey && FIREBASE_CONFIG?.projectId);

export const DEFAULT_SETTINGS = {
  types: ['Playera', 'Playera oversize', 'Playera boxy', 'Playera manga larga'],
  sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  channels: ['Instagram', 'WhatsApp', 'TikTok', 'En persona', 'Evento / Pop-up', 'Facebook'],
  payments: ['Efectivo', 'Transferencia', 'Tarjeta', 'Depósito'],
  expense_categories: ['Publicidad', 'Envíos', 'Empaque', 'Eventos', 'Fotografía', 'Herramientas / apps', 'Transporte', 'Otros'],
};

export const SALE_STATUS = {
  entregado: { label: 'Entregado', cls: 'ok' },
  por_enviar: { label: 'Por enviar', cls: 'warn' },
  apartado: { label: 'Apartado', cls: 'info' },
  cancelado: { label: 'Cancelado', cls: 'muted' },
};

export const PROD_STATUS = {
  en_produccion: { label: 'En producción', cls: 'warn' },
  recibido: { label: 'Recibido', cls: 'ok' },
};

const TABLES = ['settings', 'profiles', 'drops', 'products', 'customers', 'sales', 'sale_items', 'production', 'expenses'];

export const state = {
  user: null,
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  profiles: [],
  drops: [],
  products: [],
  customers: [],
  sales: [],
  sale_items: [],
  production: [],
  expenses: [],
};

const uuid = () =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// ───────────────────────── Adaptador local (demo) ─────────────────────────
const LS_KEY = 'trco-demo-v1';
const local = {
  data: null,
  read() {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(localStorage.getItem(LS_KEY)) || {};
    } catch {
      this.data = {};
    }
    for (const t of TABLES) this.data[t] ??= [];
    if (!this.data.settings.length) this.data.settings = [{ id: 1, data: { ...DEFAULT_SETTINGS } }];
    return this.data;
  },
  save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.data));
    } catch (e) {
      // Si el navegador bloquea el almacenamiento, los datos quedan solo en memoria.
      if (e?.name === 'QuotaExceededError') throw new Error('No hay espacio en el dispositivo para guardar (¿demasiadas fotos?).');
    }
  },
  async session() {
    const id = localSession.get();
    return id && this.read().profiles.some((p) => p.id === id) ? { id } : null;
  },
  async all(t) {
    const rows = structuredClone(this.read()[t]);
    if (t === 'profiles') rows.forEach((r) => delete r.pw_hash);
    return rows;
  },
  async getOne(t, id) {
    const row = this.read()[t].find((r) => String(r.id) === String(id));
    if (!row) return null;
    const out = structuredClone(row);
    delete out.pw_hash;
    return out;
  },
  async insert(t, rows) {
    const d = this.read();
    const now = new Date().toISOString();
    const out = rows.map((r) => ({ id: uuid(), created_at: now, ...(t === 'sales' ? { created_by: localSession.get() } : {}), ...r }));
    d[t].push(...out);
    this.save();
    return structuredClone(out);
  },
  async update(t, id, patch) {
    const d = this.read();
    const row = d[t].find((r) => String(r.id) === String(id));
    if (!row) throw new Error('Registro no encontrado');
    Object.assign(row, patch);
    this.save();
    return structuredClone(row);
  },
  async remove(t, id) {
    const d = this.read();
    d[t] = d[t].filter((r) => String(r.id) !== String(id));
    if (t === 'sales') d.sale_items = d.sale_items.filter((i) => i.sale_id !== id);
    if (t === 'drops') d.products.forEach((p) => p.drop_id === id && (p.drop_id = null));
    if (t === 'customers') d.sales.forEach((s) => s.customer_id === id && (s.customer_id = null));
    if (t === 'products') d.sale_items.forEach((i) => i.product_id === id && (i.product_id = null));
    this.save();
  },
  async adjustStock(productId, size, delta) {
    const p = this.read().products.find((r) => r.id === productId);
    if (!p) return;
    p.stock = { ...(p.stock || {}), [size]: (Number(p.stock?.[size]) || 0) + delta };
    this.save();
  },
  replaceAll(data) {
    // Los usuarios del dispositivo se conservan al cargar datos de ejemplo o un respaldo.
    data.profiles = this.read().profiles;
    this.data = data;
    this.read();
    this.save();
  },
  // Borra los datos del negocio pero conserva los usuarios del dispositivo.
  reset() {
    const keep = this.read().profiles;
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    this.data = null;
    this.read().profiles = keep;
    this.save();
  },
};

// ── Usuarios en modo demo (solo este dispositivo) ──
// Mismo flujo que con Firebase, para probarlo antes de conectar la nube.
const SESSION_KEY = 'trco-demo-session';
let memSession = null;
const localSession = {
  get() {
    try {
      return localStorage.getItem(SESSION_KEY) || memSession;
    } catch {
      return memSession;
    }
  },
  set(id) {
    memSession = id;
    try {
      if (id) localStorage.setItem(SESSION_KEY, id);
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  },
};

async function hashPassword(username, password) {
  const text = `trco:${username}:${password}`;
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0;
  for (const c of text) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return 'x' + (h >>> 0).toString(16);
}

const PERMISSION_KEYS = ['vender', 'editar_ventas', 'borrar_ventas', 'inventario', 'produccion', 'clientes', 'reportes', 'costos', 'gastos', 'exportar'];
const bad = (msg) => {
  throw new Error(msg);
};
const validUsername = (u) => {
  const name = cleanUsername(u);
  if (!/^[a-z0-9._-]{3,30}$/.test(name)) bad('El usuario debe tener de 3 a 30 letras, números, punto, guion o guion bajo (sin espacios ni acentos).');
  return name;
};
const validName = (n) => String(n || '').trim() || bad('Escribe el nombre de la persona.');
const validPassword = (p) => (String(p || '').length >= 6 ? String(p) : bad('La contraseña debe tener al menos 6 caracteres.'));
const cleanPerms = (o) => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, Boolean(o?.[k])]));

const localAuth = {
  profiles: () => local.read().profiles,
  find: (id) => local.read().profiles.find((p) => p.id === id),
  activeOwners: () => local.read().profiles.filter((p) => p.role === 'owner' && p.active !== false && p.pw_hash).length,
  requireOwner() {
    const me = this.find(localSession.get());
    if (!me || me.role !== 'owner' || me.active === false) bad('Solo un Dueño puede gestionar usuarios.');
    return me;
  },
  ownerExists() {
    return this.profiles().some((p) => p.role === 'owner' && p.pw_hash);
  },
  async createOwner({ username, name, password }) {
    if (this.ownerExists()) bad('La cuenta del Dueño ya fue creada. Inicia sesión.');
    const u = validUsername(username);
    const row = {
      username: u,
      name: validName(name),
      role: 'owner',
      permissions: cleanPerms({}),
      active: true,
      must_change_password: false,
      pw_hash: await hashPassword(u, validPassword(password)),
    };
    // Si ya había datos del demo anterior, se conservan con este Dueño.
    const old = this.find('demo');
    if (old) Object.assign(old, row);
    else this.profiles().push({ id: uuid(), created_at: new Date().toISOString(), ...row });
    local.save();
    localSession.set(old ? 'demo' : this.profiles().at(-1).id);
  },
  async signIn(username, password) {
    const u = cleanUsername(username);
    const p = this.profiles().find((x) => x.username === u && x.pw_hash);
    if (!p || p.pw_hash !== (await hashPassword(u, password))) bad('Usuario o contraseña incorrectos');
    if (p.active === false) bad('Tu usuario está desactivado. Habla con el Dueño.');
    localSession.set(p.id);
  },
  async changeMyPassword(password) {
    const me = this.find(localSession.get());
    me.pw_hash = await hashPassword(me.username, validPassword(password));
    me.must_change_password = false;
    local.save();
  },
  async create(data) {
    this.requireOwner();
    const u = validUsername(data.username);
    if (this.profiles().some((p) => p.username === u)) bad(`El usuario "${u}" ya existe. Elige otro.`);
    this.profiles().push({
      id: uuid(),
      username: u,
      name: validName(data.name),
      role: data.role === 'owner' ? 'owner' : 'colaborador',
      permissions: cleanPerms(data.permissions),
      active: true,
      must_change_password: true,
      pw_hash: await hashPassword(u, validPassword(data.password)),
      created_at: new Date().toISOString(),
    });
    local.save();
  },
  async update(data) {
    const me = this.requireOwner();
    const p = this.find(data.uid) || bad('Ese usuario no existe.');
    const role = data.role ?? p.role;
    const active = data.active ?? p.active !== false;
    const losesOwner = p.role === 'owner' && p.active !== false && (role !== 'owner' || !active);
    if (losesOwner && p.id === me.id) bad('No puedes quitarte tu propio rol de Dueño ni desactivarte.');
    if (losesOwner && this.activeOwners() <= 1) bad('Debe quedar al menos un Dueño activo.');
    Object.assign(p, { name: validName(data.name ?? p.name), role, active, permissions: cleanPerms(data.permissions ?? p.permissions) });
    local.save();
  },
  async resetPassword(uid, password) {
    const me = this.requireOwner();
    if (uid === me.id) bad('Para tu propia contraseña usa "Cambiar mi contraseña".');
    const p = this.find(uid) || bad('Ese usuario no existe.');
    p.pw_hash = await hashPassword(p.username, validPassword(password));
    p.must_change_password = true;
    local.save();
  },
  async remove(uid) {
    const me = this.requireOwner();
    if (uid === me.id) bad('No puedes eliminar tu propia cuenta.');
    const p = this.find(uid) || bad('Ese usuario no existe.');
    if (p.role === 'owner' && p.active !== false && this.activeOwners() <= 1) bad('Debe quedar al menos un Dueño activo.');
    local.read().profiles = this.profiles().filter((x) => x.id !== uid);
    local.save();
  },
};

// ───────────────────────── Adaptador Firebase (nube) ─────────────────────────
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
let fb = null;
async function firebase() {
  if (fb) return fb;
  const [appMod, authMod, fsMod, fnMod] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
    import(`${FB}/firebase-functions.js`),
  ]);
  const app = appMod.initializeApp(FIREBASE_CONFIG);
  fb = {
    ...authMod,
    ...fsMod,
    httpsCallable: fnMod.httpsCallable,
    auth: authMod.getAuth(app),
    fs: fsMod.getFirestore(app),
    fns: fnMod.getFunctions(app, 'us-central1'),
  };
  if (window.TRCO_EMULATOR) {
    // Solo para pruebas locales con el emulador de Firebase.
    authMod.connectAuthEmulator(fb.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fsMod.connectFirestoreEmulator(fb.fs, '127.0.0.1', 8080);
    fnMod.connectFunctionsEmulator(fb.fns, '127.0.0.1', 5001);
  }
  return fb;
}

const cloud = {
  async session() {
    const f = await firebase();
    return new Promise((resolve) => {
      const stop = f.onAuthStateChanged(f.auth, (u) => {
        stop();
        resolve(u ? { id: u.uid, email: u.email, name: u.displayName } : null);
      });
    });
  },
  async all(t) {
    const f = await firebase();
    const snap = await f.getDocs(f.collection(f.fs, t));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  },
  async getOne(t, id) {
    const f = await firebase();
    const d = await f.getDoc(f.doc(f.fs, t, String(id)));
    return d.exists() ? { ...d.data(), id: d.id } : null;
  },
  async insert(t, rows) {
    const f = await firebase();
    const now = new Date().toISOString();
    const out = [];
    for (const r of rows) {
      const { id, ...data } = r;
      const row = { created_at: now, ...(t === 'sales' ? { created_by: f.auth.currentUser?.uid || null } : {}), ...data };
      if (id !== undefined) {
        await f.setDoc(f.doc(f.fs, t, String(id)), row);
        out.push({ ...row, id: String(id) });
      } else {
        const ref = await f.addDoc(f.collection(f.fs, t), row);
        out.push({ ...row, id: ref.id });
      }
    }
    return out;
  },
  async update(t, id, patch) {
    const f = await firebase();
    await f.updateDoc(f.doc(f.fs, t, String(id)), patch);
    return this.getOne(t, id);
  },
  // Firestore no tiene llaves foráneas: limpiamos referencias a mano.
  async unlink(t, field, id, { remove = false } = {}) {
    const f = await firebase();
    const snap = await f.getDocs(f.query(f.collection(f.fs, t), f.where(field, '==', id)));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = f.writeBatch(f.fs);
      snap.docs.slice(i, i + 400).forEach((d) => (remove ? batch.delete(d.ref) : batch.update(d.ref, { [field]: null })));
      await batch.commit();
    }
  },
  async remove(t, id) {
    const f = await firebase();
    await f.deleteDoc(f.doc(f.fs, t, String(id)));
    if (t === 'sales') await this.unlink('sale_items', 'sale_id', id, { remove: true });
    if (t === 'drops') await this.unlink('products', 'drop_id', id);
    if (t === 'customers') await this.unlink('sales', 'customer_id', id);
    if (t === 'products') {
      await this.unlink('sale_items', 'product_id', id);
      await this.unlink('production', 'product_id', id);
    }
  },
  // Suma/resta atómica: si dos personas venden al mismo tiempo, no se pierde nada.
  async adjustStock(productId, size, delta) {
    const f = await firebase();
    try {
      await f.updateDoc(f.doc(f.fs, 'products', productId), new f.FieldPath('stock', size), f.increment(delta));
    } catch (e) {
      if (e?.code !== 'not-found') throw e;
    }
  },
};

const db = CLOUD ? cloud : local;

// ───────────────────────── Sesión ─────────────────────────
export async function currentUser() {
  return db.session();
}

// Los usuarios entran con "usuario"; Firebase necesita un correo interno.
const USER_DOMAIN = 'usuarios.trco.app';
export const cleanUsername = (u) => String(u || '').trim().toLowerCase();
const emailOf = (u) => `${cleanUsername(u)}@${USER_DOMAIN}`;

const fbError = (e) => {
  const map = {
    'auth/invalid-credential': 'Usuario o contraseña incorrectos',
    'auth/wrong-password': 'Usuario o contraseña incorrectos',
    'auth/user-not-found': 'Usuario o contraseña incorrectos',
    'auth/invalid-email': 'Usuario o contraseña incorrectos',
    'auth/user-disabled': 'Tu usuario está desactivado. Habla con el Dueño.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
    'auth/requires-recent-login': 'Por seguridad, sal y vuelve a entrar para cambiar tu contraseña.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión a internet',
    'functions/unavailable': 'Sin conexión a internet',
    'functions/not-found': 'Falta publicar las funciones de Firebase (ver README).',
    'functions/internal': 'Ocurrió un error en el servidor. Intenta de nuevo.',
  };
  // Los errores de nuestras funciones ya vienen en español.
  if (String(e?.code || '').startsWith('functions/') && !map[e.code]) return new Error(e.message);
  return new Error(map[e?.code] || e?.message || 'Ocurrió un error');
};

async function call(name, data) {
  const f = await firebase();
  try {
    return (await f.httpsCallable(f.fns, name)(data)).data;
  } catch (e) {
    throw fbError(e);
  }
}

export async function signIn(username, password) {
  if (!CLOUD) return localAuth.signIn(username, password);
  const f = await firebase();
  try {
    await f.signInWithEmailAndPassword(f.auth, emailOf(username), password);
  } catch (e) {
    throw fbError(e);
  }
}

// ¿Ya existe la cuenta del Dueño? (Si no, la app muestra la pantalla de primera vez.)
export async function ownerExists() {
  if (!CLOUD) return localAuth.ownerExists();
  const f = await firebase();
  return (await f.getDoc(f.doc(f.fs, 'meta', 'owner'))).exists();
}

export async function createOwner({ username, name, password }) {
  if (!CLOUD) return localAuth.createOwner({ username, name, password });
  await call('bootstrapOwner', { username: cleanUsername(username), name, password });
  await signIn(username, password);
}

// Cambiar mi contraseña (solo cuando el Dueño me asignó una temporal).
export async function changeMyPassword(newPassword) {
  if (!CLOUD) {
    await localAuth.changeMyPassword(newPassword);
    state.profile.must_change_password = false;
    return;
  }
  const f = await firebase();
  try {
    await f.updatePassword(f.auth.currentUser, newPassword);
    await f.updateDoc(f.doc(f.fs, 'profiles', f.auth.currentUser.uid), { must_change_password: false });
  } catch (e) {
    throw fbError(e);
  }
  state.profile.must_change_password = false;
}

// ── Gestión de usuarios (solo Dueño; se ejecuta en Cloud Functions) ──
export const users = CLOUD
  ? {
      create: (data) => call('createUser', { ...data, username: cleanUsername(data.username) }),
      update: (data) => call('updateUser', data),
      resetPassword: (uid, password) => call('resetPassword', { uid, password }),
      remove: (uid) => call('deleteUser', { uid }),
    }
  : {
      create: (data) => localAuth.create(data),
      update: (data) => localAuth.update(data),
      resetPassword: (uid, password) => localAuth.resetPassword(uid, password),
      remove: (uid) => localAuth.remove(uid),
    };

export async function signOut() {
  if (CLOUD) {
    const f = await firebase();
    await f.signOut(f.auth);
  } else localSession.set(null);
  location.hash = '';
  location.reload();
}

// ───────────────────────── Carga ─────────────────────────
function sortState() {
  state.products.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  state.customers.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  state.drops.sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || '')));
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at));
  state.sales.sort(byDate);
  state.expenses.sort(byDate);
  state.production.sort((a, b) => String(b.ordered_date).localeCompare(String(a.ordered_date)));
}

function applySettings() {
  const row = state._settingsRow;
  state.settings = { ...DEFAULT_SETTINGS, ...(row?.data || {}) };
}

export async function refresh(tables = TABLES) {
  // Sin permiso de gastos no se pueden leer.
  tables = tables.filter((t) => t !== 'expenses' || can('gastos'));
  const results = await Promise.all(tables.map((t) => db.all(t)));
  tables.forEach((t, i) => {
    if (t === 'settings') state._settingsRow = results[i][0] || null;
    else state[t] = results[i];
  });
  // Mis permisos pudieron cambiar.
  if (tables.includes('profiles') && state.profile) {
    state.profile = state.profiles.find((p) => p.id === state.profile.id) || { ...state.profile, active: false };
  }
  applySettings();
  sortState();
}

export async function loadAll(user) {
  state.user = user;
  state.profile = await db.getOne('profiles', user.id);
  if (!state.profile) return 'sin_perfil';
  if (state.profile.active === false) return 'inactivo';
  if (state.profile.must_change_password) return 'cambiar_clave';
  await refresh(TABLES);
  return 'ok';
}

export const isOwner = () => state.profile?.role === 'owner';
// ¿El usuario actual puede hacer esto? El Dueño puede todo.
export const can = (perm) => isOwner() || (state.profile?.role === 'colaborador' && state.profile?.permissions?.[perm] === true);

// ───────────────────────── Escritura genérica ─────────────────────────
export async function saveRow(table, row) {
  const { id, ...rest } = row;
  const saved = id ? await db.update(table, id, rest) : (await db.insert(table, [rest]))[0];
  await refresh([table]);
  return saved;
}

export async function deleteRow(table, id) {
  await db.remove(table, id);
  const dependents = { sales: ['sale_items'], drops: ['products'], customers: ['sales'], products: ['sale_items', 'production'] };
  await refresh([table, ...(dependents[table] || [])]);
}

export async function saveSettings(data) {
  if (state._settingsRow) await db.update('settings', 1, { data });
  else await db.insert('settings', [{ id: 1, data }]);
  await refresh(['settings']);
}

// ───────────────────────── Ventas ─────────────────────────
const consumesStock = (status) => status !== 'cancelado';

export async function createSale(sale, items) {
  const [saved] = await db.insert('sales', [sale]);
  await db.insert(
    'sale_items',
    items.map((i) => ({ ...i, sale_id: saved.id }))
  );
  if (consumesStock(sale.status)) {
    for (const i of items) if (i.product_id) await db.adjustStock(i.product_id, i.size, -i.qty);
  }
  await refresh(['sales', 'sale_items', 'products']);
  return saved;
}

export async function updateSale(id, patch) {
  const prev = state.sales.find((s) => s.id === id);
  await db.update('sales', id, patch);
  if (patch.status && prev && consumesStock(prev.status) !== consumesStock(patch.status)) {
    const sign = consumesStock(patch.status) ? -1 : 1;
    for (const i of itemsOf(id)) if (i.product_id) await db.adjustStock(i.product_id, i.size, sign * i.qty);
  }
  await refresh(['sales', 'products']);
}

export async function deleteSale(id) {
  const prev = state.sales.find((s) => s.id === id);
  if (prev && consumesStock(prev.status)) {
    for (const i of itemsOf(id)) if (i.product_id) await db.adjustStock(i.product_id, i.size, i.qty);
  }
  await db.remove('sales', id);
  await refresh(['sales', 'sale_items', 'products']);
}

export async function adjustStock(productId, size, delta) {
  await db.adjustStock(productId, size, delta);
  await refresh(['products']);
}

// ───────────────────────── Producción ─────────────────────────
export async function receiveProduction(id, { updateCost } = {}) {
  const b = state.production.find((x) => x.id === id);
  if (!b || b.status === 'recibido') return;
  for (const [size, qty] of Object.entries(b.quantities || {})) {
    if (qty > 0 && b.product_id) await db.adjustStock(b.product_id, size, Number(qty));
  }
  await db.update('production', id, { status: 'recibido', received_date: new Date().toISOString().slice(0, 10) });
  if (updateCost && b.product_id) await db.update('products', b.product_id, { cost: unitCostOf(b) });
  await refresh(['production', 'products']);
}

export const batchQty = (b) => Object.values(b.quantities || {}).reduce((s, n) => s + (Number(n) || 0), 0);
export const unitCostOf = (b) => {
  const q = batchQty(b);
  return q ? Math.round((Number(b.total_cost) / q) * 100) / 100 : 0;
};

// ───────────────────────── Demo ─────────────────────────
export function demoReplace(data) {
  local.replaceAll(data);
}
export function demoReset() {
  local.reset();
}
export function exportData() {
  const out = { app: 'TRCO', version: 1, exported_at: new Date().toISOString() };
  for (const t of TABLES) out[t] = t === 'settings' ? [{ id: 1, data: state.settings }] : state[t];
  delete out.profiles; // los usuarios no van en el respaldo
  return out;
}

// ───────────────────────── Consultas derivadas ─────────────────────────
export const productById = (id) => state.products.find((p) => p.id === id);
export const customerById = (id) => state.customers.find((c) => c.id === id);
export const dropById = (id) => state.drops.find((d) => d.id === id);
export const profileName = (id) => state.profiles.find((p) => p.id === id)?.name || '';
export const itemsOf = (saleId) => state.sale_items.filter((i) => i.sale_id === saleId);
export const stockTotal = (p) => Object.values(p.stock || {}).reduce((s, n) => s + (Number(n) || 0), 0);
export const sizesOf = (p) => {
  const base = state.settings.sizes;
  const extra = Object.keys(p.stock || {}).filter((s) => !base.includes(s));
  return [...base, ...extra];
};
export const saleBalance = (s) => Math.max(0, (Number(s.total) || 0) - (Number(s.paid) || 0));
export const isPending = (s) => s.status === 'apartado' || s.status === 'por_enviar' || (s.status !== 'cancelado' && saleBalance(s) > 0.009);

// Líneas de venta "planas" para reportes: ingreso con descuento prorrateado.
export function soldLines(from, to) {
  const sales = state.sales.filter((s) => s.status !== 'cancelado' && (!from || s.date >= from) && (!to || s.date <= to));
  const byId = new Map(sales.map((s) => [s.id, s]));
  const lines = [];
  for (const i of state.sale_items) {
    const s = byId.get(i.sale_id);
    if (!s) continue;
    const subtotal = Number(s.subtotal) || 0;
    const factor = subtotal > 0 ? Math.max(0, subtotal - (Number(s.discount) || 0)) / subtotal : 1;
    const gross = i.qty * (Number(i.unit_price) || 0);
    lines.push({
      ...i,
      sale: s,
      revenue: gross * factor,
      cost: i.qty * (Number(i.unit_cost) || 0),
      product: productById(i.product_id),
    });
  }
  return { sales, lines };
}

export function lowStock() {
  const out = [];
  for (const p of state.products) {
    if (p.active === false) continue;
    const min = Number(p.min_stock ?? 2);
    for (const size of sizesOf(p)) {
      if (!(size in (p.stock || {}))) continue;
      const n = Number(p.stock[size]) || 0;
      if (n <= min) out.push({ product: p, size, qty: n });
    }
  }
  return out.sort((a, b) => a.qty - b.qty);
}
