const CACHE_VERSION = 'slop-heroes-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/voxel.svg',
  '/apple-touch-icon.png',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
];
const STATIC_DESTINATIONS = new Set([
  'audio',
  'font',
  'image',
  'manifest',
  'script',
  'style',
  'video',
  'worker',
]);
const STATIC_FILE_PATTERN = /\.(?:avif|css|gif|ico|jpeg|jpg|js|json|mjs|mp3|ogg|png|svg|wasm|wav|webmanifest|webp|woff2?)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const expectedCaches = new Set([APP_SHELL_CACHE, RUNTIME_CACHE]);

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith('slop-heroes-') && !expectedCaches.has(cacheName))
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET' || request.headers.has('range')) {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin || requestUrl.pathname === '/sw.js') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_SHELL_CACHE, '/index.html'));
    return;
  }

  if (isStaticRequest(request, requestUrl)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

function isStaticRequest(request, requestUrl) {
  return (
    STATIC_DESTINATIONS.has(request.destination) ||
    requestUrl.pathname.startsWith('/assets/') ||
    STATIC_FILE_PATTERN.test(requestUrl.pathname)
  );
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);

    if (response.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cachedResponse = await cache.match(request);
    const fallbackResponse = fallbackUrl ? await cache.match(fallbackUrl) : undefined;

    return cachedResponse || fallbackResponse || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const fetchAndCache = async () => {
    const response = await fetch(request);

    if (response.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  };

  if (cachedResponse) {
    fetchAndCache().catch(() => undefined);
    return cachedResponse;
  }

  return fetchAndCache();
}
