const SERVICE_WORKER_CACHE_PREFIXES = ['slop-heroes-', 'voxel-strike-'] as const;

export function unregisterServiceWorkers(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => undefined);
  }

  if ('caches' in window) {
    window.caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => SERVICE_WORKER_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix)))
          .map((cacheName) => window.caches.delete(cacheName))
      ))
      .catch(() => undefined);
  }
}
