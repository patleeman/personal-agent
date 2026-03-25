const SHELL_CACHE = 'pi-companion-shell-v2';
const STATIC_CACHE = 'pi-companion-static-v2';
const PRECACHE_URLS = [
  '/app/index.html',
  '/app/manifest.webmanifest',
  '/app/icon.svg',
  '/app/icon-maskable.svg',
  '/app/icon-192.png',
  '/app/icon-512.png',
  '/app/icon-maskable-512.png',
  '/app/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname === '/app/api' || url.pathname.startsWith('/app/api/')) {
    return;
  }

  if (event.request.mode === 'navigate' && (url.pathname === '/app' || url.pathname.startsWith('/app/'))) {
    event.respondWith(handleCompanionNavigation(event.request));
    return;
  }

  if (url.pathname.startsWith('/app/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(handleStaticAsset(event.request));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(focusNotificationConversation(event.notification.data));
});

async function handleCompanionNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    cache.put('/app/index.html', response.clone());
    return response;
  } catch {
    const cached = await cache.match('/app/index.html');
    if (cached) {
      return cached;
    }

    return Response.error();
  }
}

async function handleStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const networkRequest = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const response = await networkRequest;
  return response ?? Response.error();
}

async function focusNotificationConversation(data) {
  const path = typeof data?.url === 'string' && data.url.startsWith('/app/')
    ? data.url
    : '/app/inbox';
  const targetUrl = new URL(path, self.location.origin).href;
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const client of clientsList) {
    if (!('focus' in client)) {
      continue;
    }

    try {
      if ('navigate' in client && typeof client.url === 'string' && client.url !== targetUrl) {
        await client.navigate(targetUrl);
      }
      await client.focus();
      return;
    } catch {
      // Try the next client or fall back to opening a fresh one.
    }
  }

  if ('openWindow' in self.clients) {
    await self.clients.openWindow(targetUrl);
  }
}
