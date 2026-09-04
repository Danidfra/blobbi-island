// Self-destroying service worker.
//
// Between August and October 2025 this site registered a cache-first service
// worker from this same path. Its registration script was dropped later, but a
// browser that installed it keeps running it until a NEWER script at /sw.js
// replaces it, and the old worker served the cached index.html first, so those
// players could stay on a stale build indefinitely.
//
// This file is that replacement. It installs, takes over immediately, deletes
// every cache the old worker created, unregisters itself, and reloads the open
// pages so they fetch the live build. A browser that never installed the old
// worker never requests this file. Nothing registers a worker any more; do not
// add one here. Keep this file until the old registrations can be assumed gone.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.navigate(client.url);
    }
  })());
});
