// ════════════════════════════════════════════════
// SERVICE WORKER — Web Push ONLY (Notification Center, Phase F1)
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   This tiny background script lets a closed browser tab / installed PWA
//   receive push notifications (the buzz on a locked iPhone home screen). It
//   does exactly TWO things: show a notification when a push arrives, and open
//   the right screen when the user taps it.
//
// WHY THERE IS NO `fetch` HANDLER (load-bearing — do not add one):
//   The April-2026 blank-page incident was caused by a PREVIOUS service worker
//   that CACHED responses on `fetch`. When Cloudflare's edge briefly served
//   index.html (text/html) under a hashed /assets/*.js URL, that SW cached the
//   poisoned response and served it forever — iOS Safari refuses text/html for
//   <script type="module">, so users got a permanent blank page. A push-only
//   SW with NO fetch handler CANNOT re-create that trap: it never intercepts,
//   caches, or rewrites a single network response. Keep it that way.
//
// Registration is gated by the `feature:web_push` flag in src/main.jsx; when the
// flag is OFF, main.jsx runs the original kill-switch (unregister + cache wipe).
// ════════════════════════════════════════════════

// One reviewed tap-target policy, exercised directly by the static PWA tests.
self.importScripts('/sw-target.js');

// Take control ASAP so a freshly enabled push subscription works without a reload.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Push received → show a notification ───
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON payload — fall back to raw text as the body.
    try { payload = { body: event.data ? event.data.text() : '' }; } catch { payload = {}; }
  }

  const title = payload.title || 'Utah Pros';
  const rawTarget = (payload.data && payload.data.url) || payload.url;
  const target = self.UPRPushTarget.normalizePushTarget(rawTarget, self.location.origin);
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || undefined,          // same tag replaces an existing toast
    // Persist only the normalized navigation value. Raw payload metadata is not
    // needed for a tap and must not become a second URL override.
    data: { url: target },
    requireInteraction: !!payload.requireInteraction,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification tapped → focus an open tab or open the target URL ───
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Re-validate persisted data at the use boundary as defense in depth against
  // old notifications created by an earlier worker version.
  const target = self.UPRPushTarget.normalizePushTarget(
    event.notification.data && event.notification.data.url,
    self.location.origin,
  );

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer an already-open window — navigate + focus it rather than spawning a new one.
    for (const client of clientList) {
      if ('focus' in client) {
        try {
          if ('navigate' in client && target) await client.navigate(target);
        } catch { /* cross-origin or blocked navigate — just focus */ }
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
    return undefined;
  })());
});
