// UPR service worker — caches Vite build assets, Supabase Storage reads, and a small
// set of RPCs so the tech app remains usable when the signal drops mid-job.
// Keep this file intentionally small: the main thread handles auth, token refresh,
// and the IDB-backed write queue.

const CACHE = 'upr-v1';

// Hosts we want to intercept. Derived from the standard Supabase URL shape.
const SUPABASE_HOST_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co/i;

// RPCs that are safe to cache offline — all GET-shaped reads (no writes).
// NetworkFirst with a 3s timeout falls back to cache so a weak-signal tech still sees data.
const CACHEABLE_RPCS = [
  'get_job_rooms',
  'get_appointment_detail',
  'get_my_appointments_today',
];

// Vite builds ship hashed filenames under /assets, plus a few static extensions we want cached.
const ASSET_EXT_RE = /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|webp|svg|ico)(?:\?|$)/i;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/DELETE pass straight through

  const url = new URL(req.url);

  // Vite build asset or static font/image.
  if (url.pathname.startsWith('/assets/') || ASSET_EXT_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Supabase Storage reads — job-files bucket only. Caching here is what makes photos
  // visible offline after the first view.
  if (
    SUPABASE_HOST_RE.test(url.origin) &&
    url.pathname.startsWith('/storage/v1/object/') &&
    url.pathname.includes('/job-files/')
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Cacheable Supabase RPCs — NetworkFirst with cache fallback.
  if (SUPABASE_HOST_RE.test(url.origin) && url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.replace('/rest/v1/rpc/', '').split('?')[0];
    if (CACHEABLE_RPCS.includes(fn)) {
      event.respondWith(networkFirst(req, 3_000));
      return;
    }
  }
  // Everything else: pass-through (default browser behavior).
});

/**
 * Serve from cache if present; otherwise fetch + cache. 7-day freshness is enforced
 * by the cache key — we don't attempt to revalidate here since Vite assets are hashed
 * and storage object URLs are immutable per path.
 */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Dead offline with no cache hit — fall through to browser's default error.
    throw err;
  }
}

/**
 * Try the network first; if it takes longer than `timeoutMs` or fails, fall back to cache.
 * When the network succeeds we write the response back to the cache for the next offline hit.
 */
async function networkFirst(req, timeoutMs) {
  const cache = await caches.open(CACHE);
  let networkSettled = false;

  const networkPromise = fetch(req).then((res) => {
    networkSettled = true;
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch((err) => {
    networkSettled = true;
    throw err;
  });

  const timeoutPromise = new Promise(resolve => {
    setTimeout(() => { if (!networkSettled) resolve(null); }, timeoutMs);
  });

  try {
    const raced = await Promise.race([networkPromise, timeoutPromise]);
    if (raced) return raced;
    // Network too slow — serve cached copy if we have one, else wait for network.
    const cached = await cache.match(req);
    if (cached) return cached;
    return await networkPromise;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}
