// Códigos de producto para las etiquetas QR.
// Producto: TRCO-0012 · Etiqueta (producto + talla): TRCO-0012-M
import { state, saveRow, sizesOf } from './db.js';

const PREFIX = 'TRCO-';

// Carga una librería de js/vendor una sola vez (sin internet también).
const loaded = {};
export function loadScript(src) {
  loaded[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => {
      delete loaded[src];
      reject(new Error('No se pudo cargar ' + src));
    };
    document.head.appendChild(s);
  });
  return loaded[src];
}

export function nextProductCode(products = state.products) {
  const max = products.reduce((m, p) => {
    const n = Number(String(p.code || '').replace(PREFIX, ''));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return PREFIX + String(max + 1).padStart(4, '0');
}

// Le asigna código al producto si todavía no tiene (productos creados antes de las etiquetas).
export async function ensureProductCode(p) {
  if (p.code) return p.code;
  const code = nextProductCode();
  await saveRow('products', { id: p.id, code });
  p.code = code;
  return code;
}

export const variantCode = (p, size) => `${p.code}-${String(size).toUpperCase()}`;

// Lee lo que trae el QR (o lo que se escribió a mano) y busca el producto y la talla.
export function parseCode(text) {
  const raw = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = raw.match(/^(TRCO-\d{3,})-(.+)$/);
  if (!m) return { error: 'Este código no es de una etiqueta TRCO.' };
  const product = state.products.find((p) => String(p.code || '').toUpperCase() === m[1]);
  if (!product) return { error: `No hay ningún producto con el código ${m[1]}.` };
  const size = sizesOf(product).find((s) => s.toUpperCase() === m[2]);
  if (!size) return { error: `${product.name} no tiene la talla ${m[2]}.`, product };
  return { product, size, code: raw };
}
