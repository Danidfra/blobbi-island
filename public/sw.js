const CACHE_NAME = 'blobbi-island-v2'; // bump version when changing cache strategy
const urlsToCache = [
  '/',
  '/assets/blobbi-island.png',
  '/manifest.webmanifest'
];

// Install event - cache critical resources
self.addEventListener('install', event => {
  self.skipWaiting(); // activate this service worker immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Fetch event - only intercept GET requests from the same origin
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Allow non-GET requests (e.g., POST uploads) and cross-origin requests
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return; // do not intercept, let the browser handle it
  }

  // Cache-first strategy for same-origin GET requests
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone()); // cache the fetched response
      return res;
    } catch (err) {
      // Optional: offline fallback
      return caches.match('/');
    }
  })());
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.map(n => (n !== CACHE_NAME ? caches.delete(n) : undefined))
    );
    await self.clients.claim(); // take control of existing pages immediately
  })());
});