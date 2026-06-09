// KILL-SWITCH SERVICE WORKER (Apr 18 2026)
//
// The previous SW (upr-v2 and earlier) did CacheFirst on /assets/*.js. When
// Cloudflare's edge cached index.html with Content-Type: text/html under a
// hashed JS URL (SPA fallback race), the SW served that poisoned response
// forever. iOS Safari strictly refuses text/html for <script type="module">,
// so affected users got a blank page with no way out — the old SW kept
// intercepting the request and serving the bad body.
//
// This version replaces the old SW with a no-op that:
//   1. on install: skipWaiting so the browser picks it up immediately
//   2. on activate: deletes every cache, claims all clients, unregisters
//      itself, and forces each open window to navigate(url) to refetch
//      everything fresh from the network (no SW in the path anymore)
//   3. on fetch: passes every request through unchanged (no caching)
//
// Combined with main.jsx no longer registering a SW, this returns the app
// to a plain network-first PWA until we add back a safer caching strategy
// that avoids the hashed-asset/HTML MIME trap.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (err) { /* best-effort */ }
    try { await self.clients.claim(); } catch (err) { /* ignore */ }
    try { await self.registration.unregister(); } catch (err) { /* ignore */ }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) {
        try { await c.navigate(c.url); } catch (err) { /* ignore */ }
      }
    } catch (err) { /* ignore */ }
  })());
});

// Pass-through: do not intercept any request. The browser handles it directly.
self.addEventListener('fetch', () => { /* intentionally no respondWith */ });
