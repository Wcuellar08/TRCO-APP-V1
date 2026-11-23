// ════════════════════════════════════════════════════════════════
//  TRCO · Funciones de servidor (Cloud Functions)
//  Gestión de usuarios: solo un Dueño puede crear, editar, desactivar,
//  eliminar usuarios o asignar contraseñas temporales.
//  Los usuarios entran con "usuario" + contraseña. Internamente Firebase
//  necesita un correo, así que usamos <usuario>@usuarios.trco.app
//  (no es un correo real y nunca se envía nada).
// ════════════════════════════════════════════════════════════════
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { PERMISSIONS } = require('./permissions');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

const db = admin.firestore();
const auth = admin.auth();
const DOMAIN = 'usuarios.trco.app';
const ROLES = ['owner', 'colaborador'];

const fail = (code, msg) => {
  throw new HttpsError(code, msg);
};

function cleanUsername(u) {
  const name = String(u || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(name)) fail('invalid-argument', 'El usuario debe tener de 3 a 30 letras, números, punto, guion o guion bajo (sin espacios ni acentos).');
  return name;
}
function cleanName(n) {
  const name = String(n || '').trim();
  if (!name || name.length > 60) fail('invalid-argument', 'Escribe el nombre de la persona.');
  return name;
}
function cleanPassword(p) {
  const pass = String(p || '');
  if (pass.length < 6) fail('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
  return pass;
}
function cleanRole(r) {
  if (!ROLES.includes(r)) fail('invalid-argument', 'Rol no válido.');
  return r;
}
function cleanPermissions(obj) {
  const out = {};
  for (const p of PERMISSIONS) out[p] = Boolean(obj && obj[p]);
  return out;
}
const emailOf = (username) => `${username}@${DOMAIN}`;

async function requireOwner(req) {
  if (!req.auth) fail('unauthenticated', 'Inicia sesión.');
  const snap = await db.doc(`profiles/${req.auth.uid}`).get();
  const p = snap.data();
  if (!p || p.role !== 'owner' || p.active === false) fail('permission-denied', 'Solo un Dueño puede gestionar usuarios.');
  return p;
}

async function ownerCount() {
  const snap = await db.collection('profiles').where('role', '==', 'owner').where('active', '==', true).get();
  return snap.size;
}

// Primera vez: crea la cuenta del Dueño. Solo funciona si todavía no hay dueño.
exports.bootstrapOwner = onCall(async (req) => {
  const username = cleanUsername(req.data?.username);
  const name = cleanName(req.data?.name);
  const password = cleanPassword(req.data?.password);
  const metaRef = db.doc('meta/owner');
  await db.runTransaction(async (t) => {
    if ((await t.get(metaRef)).exists) fail('failed-precondition', 'La cuenta del Dueño ya fue creada. Inicia sesión.');
    t.set(metaRef, { claimed_at: new Date().toISOString() });
  });
  try {
    const user = await auth.createUser({ email: emailOf(username), password, displayName: name });
    await db.doc(`profiles/${user.uid}`).set({
      username,
      name,
      role: 'owner',
      permissions: cleanPermissions({}),
      active: true,
      must_change_password: false,
      created_at: new Date().toISOString(),
    });
    await metaRef.set({ uid: user.uid }, { merge: true });
    return { uid: user.uid };
  } catch (e) {
    await metaRef.delete();
    if (e instanceof HttpsError) throw e;
    fail('internal', 'No se pudo crear la cuenta: ' + e.message);
  }
});

// El Dueño da de alta a alguien con una contraseña temporal.
exports.createUser = onCall(async (req) => {
  const me = await requireOwner(req);
  const username = cleanUsername(req.data?.username);
  const name = cleanName(req.data?.name);
  const password = cleanPassword(req.data?.password);
  const role = cleanRole(req.data?.role);
  let user;
  try {
    user = await auth.createUser({ email: emailOf(username), password, displayName: name });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') fail('already-exists', `El usuario "${username}" ya existe. Elige otro.`);
    throw e;
  }
  await db.doc(`profiles/${user.uid}`).set({
    username,
    name,
    role,
    permissions: cleanPermissions(req.data?.permissions),
    active: true,
    must_change_password: true,
    created_at: new Date().toISOString(),
    created_by: me.username || req.auth.uid,
  });
  return { uid: user.uid };
});

// El Dueño cambia nombre, rol, permisos o activa/desactiva a alguien.
exports.updateUser = onCall(async (req) => {
  await requireOwner(req);
  const uid = String(req.data?.uid || '');
  const ref = db.doc(`profiles/${uid}`);
  const current = (await ref.get()).data();
  if (!current) fail('not-found', 'Ese usuario no existe.');
  const name = cleanName(req.data?.name ?? current.name);
  const role = cleanRole(req.data?.role ?? current.role);
  const active = req.data?.active === undefined ? current.active !== false : Boolean(req.data.active);
  const losesOwner = current.role === 'owner' && current.active !== false && (role !== 'owner' || !active);
  if (losesOwner && uid === req.auth.uid) fail('failed-precondition', 'No puedes quitarte tu propio rol de Dueño ni desactivarte.');
  if (losesOwner && (await ownerCount()) <= 1) fail('failed-precondition', 'Debe quedar al menos un Dueño activo.');
  await auth.updateUser(uid, { displayName: name, disabled: !active });
  if (!active) await auth.revokeRefreshTokens(uid);
  await ref.update({ name, role, active, permissions: cleanPermissions(req.data?.permissions ?? current.permissions) });
  return { ok: true };
});

// El Dueño asigna una contraseña temporal; la persona la cambia al entrar.
exports.resetPassword = onCall(async (req) => {
  await requireOwner(req);
  const uid = String(req.data?.uid || '');
  const password = cleanPassword(req.data?.password);
  if (uid === req.auth.uid) fail('failed-precondition', 'Para tu propia contraseña usa "Cambiar mi contraseña".');
  const ref = db.doc(`profiles/${uid}`);
  if (!(await ref.get()).exists) fail('not-found', 'Ese usuario no existe.');
  await auth.updateUser(uid, { password });
  await auth.revokeRefreshTokens(uid);
  await ref.update({ must_change_password: true });
  return { ok: true };
});

// El Dueño elimina a alguien (sus ventas registradas se conservan).
exports.deleteUser = onCall(async (req) => {
  await requireOwner(req);
  const uid = String(req.data?.uid || '');
  if (uid === req.auth.uid) fail('failed-precondition', 'No puedes eliminar tu propia cuenta.');
  const ref = db.doc(`profiles/${uid}`);
  const current = (await ref.get()).data();
  if (!current) fail('not-found', 'Ese usuario no existe.');
  if (current.role === 'owner' && current.active !== false && (await ownerCount()) <= 1) fail('failed-precondition', 'Debe quedar al menos un Dueño activo.');
  await auth.deleteUser(uid).catch((e) => {
    if (e.code !== 'auth/user-not-found') throw e;
  });
  await ref.delete();
  return { ok: true };
});
