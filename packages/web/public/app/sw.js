const SHELL_CACHE = 'pi-companion-shell-v1';
const STATIC_CACHE = 'pi-companion-static-v1';
const PRECACHE_URLS = [
  '/app/index.html',
  '/app/manifest.webmanifest',
  '/app/icon.svg',
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

  if (event.request.mode === 'navigate' && (url.pathname === '/app' || url.pathname.startsWith('/app/'))) {
    event.respondWith(handleCompanionNavigation(event.request));
    return;
  }

  if (url.pathname.startsWith('/app/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(handleStaticAsset(event.request));
  }
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
