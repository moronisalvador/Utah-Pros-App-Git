const CACHE = 'upr-v3';

// Static assets that rarely change — cache-first
const CACHE_FIRST_PATTERNS = [
  /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
  /\.(woff2?|ttf|otf|eot)(\?|$)/,
  /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/,
];

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // API/REST calls — network-only (never cache)
  if (url.includes('/rest/v1/') || url.includes('/api/') || url.includes('/storage/v1/')) return;

  // Fonts, images, icons — cache-first
  if (CACHE_FIRST_PATTERNS.some(p => p.test(url))) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML, JS, CSS — network-first, cache fallback
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
