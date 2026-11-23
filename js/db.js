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
    if (!this.data.profiles.length)
      this.data.profiles = [{ id: 'demo', email: 'demo@trco', name: 'Dueño (demo)', role: 'owner' }];
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
    return { id: 'demo', email: 'demo@trco' };
  },
  async all(t) {
    return structuredClone(this.read()[t]);
  },
  async getOne(t, id) {
    const row = this.read()[t].find((r) => String(r.id) === String(id));
    return row ? structuredClone(row) : null;
  },
  async insert(t, rows) {
    const d = this.read();
    const now = new Date().toISOString();
    const out = rows.map((r) => ({ id: uuid(), created_at: now, ...(t === 'sales' ? { created_by: 'demo' } : {}), ...r }));
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
    this.data = data;
    this.read();
    this.save();
  },
  reset() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    this.data = null;
  },
};

// ───────────────────────── Adaptador Firebase (nube) ─────────────────────────
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
let fb = null;
async function firebase() {
  if (fb) return fb;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(FIREBASE_CONFIG);
  fb = { ...authMod, ...fsMod, auth: authMod.getAuth(app), fs: fsMod.getFirestore(app) };
  if (window.TRCO_EMULATOR) {
    // Solo para pruebas locales con el emulador de Firebase.
    authMod.connectAuthEmulator(fb.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fsMod.connectFirestoreEmulator(fb.fs, '127.0.0.1', 8080);
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
  // Crea el perfil la primera vez que alguien entra. La primera cuenta es la del dueño.
  async ensureProfile(user, name) {
    const f = await firebase();
    const ref = f.doc(f.fs, 'profiles', user.id);
    const existing = await f.getDoc(ref);
    if (existing.exists()) return { ...existing.data(), id: user.id };
    const base = { email: user.email, name: name || user.name || user.email.split('@')[0], created_at: new Date().toISOString() };
    const ownerRef = f.doc(f.fs, 'meta', 'owner');
    const hasOwner = (await f.getDoc(ownerRef)).exists();
    if (!hasOwner) {
      try {
        const batch = f.writeBatch(f.fs);
        batch.set(ownerRef, { uid: user.id });
        batch.set(ref, { ...base, role: 'owner' });
        await batch.commit();
        return { ...base, role: 'owner', id: user.id };
      } catch {
        /* alguien más ya es dueño: queda pendiente */
      }
    }
    await f.setDoc(ref, { ...base, role: 'pending' });
    return { ...base, role: 'pending', id: user.id };
  },
};

const db = CLOUD ? cloud : local;

// ───────────────────────── Sesión ─────────────────────────
export async function currentUser() {
  return db.session();
}

const authError = (e) => {
  const map = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos',
    'auth/wrong-password': 'Correo o contraseña incorrectos',
    'auth/user-not-found': 'Correo o contraseña incorrectos',
    'auth/invalid-email': 'Ese correo no es válido',
    'auth/email-already-in-use': 'Ese correo ya tiene cuenta. Toca "Ya tengo cuenta".',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión a internet',
    'auth/operation-not-allowed': 'Activa "Correo/contraseña" en Firebase → Authentication',
  };
  return new Error(map[e?.code] || e?.message || 'Ocurrió un error');
};

export async function signIn(email, password) {
  const f = await firebase();
  try {
    await f.signInWithEmailAndPassword(f.auth, email, password);
  } catch (e) {
    throw authError(e);
  }
}

export async function signUp(email, password, name) {
  const f = await firebase();
  try {
    const cred = await f.createUserWithEmailAndPassword(f.auth, email, password);
    await f.updateProfile(cred.user, { displayName: name });
    await cloud.ensureProfile({ id: cred.user.uid, email: cred.user.email, name }, name);
  } catch (e) {
    throw authError(e);
  }
}

export async function sendReset(email) {
  const f = await firebase();
  try {
    await f.sendPasswordResetEmail(f.auth, email);
  } catch (e) {
    throw authError(e);
  }
}

export async function signOut() {
  if (CLOUD) {
    const f = await firebase();
    await f.signOut(f.auth);
  }
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
  // El equipo no tiene permiso de leer gastos.
  tables = tables.filter((t) => t !== 'expenses' || isOwner());
  const results = await Promise.all(tables.map((t) => db.all(t)));
  tables.forEach((t, i) => {
    if (t === 'settings') state._settingsRow = results[i][0] || null;
    else state[t] = results[i];
  });
  applySettings();
  sortState();
}

export async function loadAll(user) {
  state.user = user;
  state.profile = CLOUD ? await cloud.ensureProfile(user) : await local.getOne('profiles', 'demo');
  if (!state.profile || state.profile.role === 'pending') return false;
  await refresh(TABLES);
  return true;
}

export const isOwner = () => state.profile?.role === 'owner';

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
