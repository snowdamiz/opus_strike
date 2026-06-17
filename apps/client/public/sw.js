const CACHE_PREFIX = 'slop-heroes';
const CACHE_VERSION = `${CACHE_PREFIX}-v5`;
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const CACHE_PREFIXES_TO_CLEAN = ['slop-heroes-', 'voxel-strike-'];
const MAX_RUNTIME_CACHE_ENTRIES = 120;
const MAX_RUNTIME_RESPONSE_BYTES = 2 * 1024 * 1024;
const LOCAL_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const IS_LOCAL_DEVELOPMENT = LOCAL_DEVELOPMENT_HOSTS.has(self.location.hostname);
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
  if (IS_LOCAL_DEVELOPMENT) {
    event.waitUntil(self.skipWaiting());
    return;
  }

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
            .filter((cacheName) => CACHE_PREFIXES_TO_CLEAN.some((prefix) => cacheName.startsWith(prefix)) && !expectedCaches.has(cacheName))
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

  if (IS_LOCAL_DEVELOPMENT) {
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
    const response = await fetch(request, { cache: 'no-store' });

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

    if (response.ok && shouldCacheRuntimeResponse(response)) {
      await cache.put(request, response.clone());
      await trimRuntimeCache(cache);
    }

    return response;
  };

  if (cachedResponse) {
    fetchAndCache().catch(() => undefined);
    return cachedResponse;
  }

  return fetchAndCache();
}

function shouldCacheRuntimeResponse(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  return !Number.isFinite(contentLength) ||
    contentLength <= 0 ||
    contentLength <= MAX_RUNTIME_RESPONSE_BYTES;
}

async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_RUNTIME_CACHE_ENTRIES) return;

  await Promise.all(
    keys
      .slice(0, keys.length - MAX_RUNTIME_CACHE_ENTRIES)
      .map((request) => cache.delete(request))
  );
}
