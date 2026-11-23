// Service worker: permite abrir la app sin internet y que cargue rápido.
// Cambia VERSION cuando publiques cambios para forzar la actualización.
const VERSION = 'trco-v1.1.0';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/bus.js',
  'js/config.js',
  'js/db.js',
  'js/demo.js',
  'js/icons.js',
  'js/ui.js',
  'js/views/customers.js',
  'js/views/dashboard.js',
  'js/views/drops.js',
  'js/views/expenses.js',
  'js/views/inventory.js',
  'js/views/more.js',
  'js/views/production.js',
  'js/views/reports.js',
  'js/views/sales.js',
  'js/views/settings.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Archivos de la app: responde rápido desde caché y actualiza en segundo plano.
// Datos (Firestore): siempre por red; solo se guardan en caché las librerías de Firebase.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const firebaseLib = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!sameOrigin && !firebaseLib) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: sameOrigin });
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
