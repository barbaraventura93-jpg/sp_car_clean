/* SP Car Clean — Service Worker (PWA)
 * Estratégia:
 *   - Navegação/HTML  → network-first (nunca prende o app numa versão antiga após deploy)
 *   - Assets estáticos → stale-while-revalidate (rápido offline, atualiza em segundo plano)
 * CACHE_VERSION é trocado pelo build.js a cada deploy (hash de app.js + styles.css),
 * o que invalida os caches antigos.
 */
const CACHE_VERSION = 'spcc-v1';
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_URL   = '/';

// Precache mínimo do shell — o resto entra em runtime sob demanda.
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/admin.webmanifest',
  '/assets/favicon.png',
  '/assets/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(RUNTIME_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Push (Web Push padrão): avisos do admin (notify-booking, admin-alerts) e do
// cliente sobre o próprio agendamento (notify-client, webhook de pagamento).
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || '🔔 SP Car Clean', {
    body: d.body || 'Nova atividade no painel.',
    icon: '/assets/favicon.png',
    badge: '/assets/favicon.png',
    tag: d.tag || 'spcc-admin',
    renotify: true,
    data: { link: d.link || '/?admin' }
  }));
});

// Clique na notificação → foca uma aba aberta do portal ou abre o painel admin.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/?admin';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { if (w.navigate) w.navigate(link); return w.focus(); }
      }
      return self.clients.openWindow(link);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só lida com GET same-origin. Firebase/API (/api e o legado /.netlify)/APIs externas
  // e as fotos/vídeos (/media, cache do próprio navegador) passam direto.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/') || url.pathname.startsWith('/media/')) return;

  // Navegação (documento HTML) → network-first com fallback ao cache offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(OFFLINE_URL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match(OFFLINE_URL)))
    );
    return;
  }

  // Demais GETs same-origin (assets) → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
