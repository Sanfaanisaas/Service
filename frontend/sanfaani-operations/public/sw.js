const CACHE = 'sanfaani-operations-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  if (['script', 'style', 'image', 'font'].includes(request.destination)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const cacheCopy = response.clone();
        void caches.open(CACHE)
          .then((cache) => cache.put(request, cacheCopy))
          .catch(() => {
            // Caching must not affect the network response.
          });
      }
      return response;
    })));
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'SANFAANI', body: 'You have a new operational update.', url: '/admin/notifications', tag: 'sanfaani-update' };
  try { payload = { ...payload, ...event.data?.json() }; } catch { /* Use privacy-safe defaults. */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: payload.tag, data: { url: payload.url }, renotify: false,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requested = new URL(event.notification.data?.url || '/admin/notifications', self.location.origin);
  const safePath = requested.origin === self.location.origin && requested.pathname.startsWith('/admin/') ? requested.pathname : '/sign-in';
  const target = new URL(safePath, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    return existing ? existing.navigate(target).then(() => existing.focus()) : self.clients.openWindow(target);
  }));
});
