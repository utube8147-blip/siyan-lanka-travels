/* Siyan Lanka Travels service worker
 * - Pages: network first, fall back to the last copy seen, then /offline.
 * - Build files, fonts, icons and photos: cache first (they never change
 *   under the same URL).
 * Bump VERSION to force every phone to refresh its cache.
 */
const VERSION = 'v4';
// Registered as /sw.js?dev=1 during `npm run dev`: no caching, so you never
// see stale files while developing (install + notifications still work).
const DEV = new URL(self.location.href).searchParams.has('dev');
const STATIC_CACHE = `sl-static-${VERSION}`;
const PAGE_CACHE = `sl-pages-${VERSION}`;
const PRECACHE = ['/offline.html', '/logo.png', '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil((DEV ? Promise.resolve() : caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC_CACHE, PAGE_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/icons/') ||
  url.pathname.startsWith('/brand/') ||
  /\.(?:png|jpg|jpeg|webp|svg|woff2?|css|js)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (DEV || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/offline.html')) || Response.error()),
    );
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});

/* ---------------------------------------------------------------- push ----
 * Server push (for reminders when the app is closed). Your backend sends a
 * JSON payload like {"title":"...","body":"...","url":"/my-bookings"} to the
 * subscription saved by lib/pwa.ts → subscribeToPush().
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Siyan Lanka Travels', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-48.png',
      tag: data.tag,
      data: { url: data.url || '/my-bookings' },
    }),
  );
});

// Tapping a notification opens (or focuses) the right page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin)) {
          w.focus();
          return w.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
