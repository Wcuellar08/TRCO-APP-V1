// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN DE TRCO APP
//
//  Si dejas FIREBASE_CONFIG vacío, la app funciona en MODO DEMO:
//  los datos se guardan solo en este dispositivo (navegador).
//
//  Para usar la nube (datos compartidos con tu equipo):
//    Firebase Console → ⚙️ Configuración del proyecto → General →
//    "Tus apps" → app web (</>) → copia aquí el objeto firebaseConfig.
//  (Estas claves son públicas por diseño; la seguridad la dan las
//   reglas de firebase/firestore.rules.)
// ─────────────────────────────────────────────────────────────

export const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
