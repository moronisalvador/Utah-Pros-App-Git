/**
 * ════════════════════════════════════════════════
 * FILE: registerSW.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Small helper that decides whether to turn ON the push-notification service
 *   worker. Push is behind a feature switch ("web_push") that only loads AFTER a
 *   user signs in — but the browser needs to know at page-load, before sign-in,
 *   whether to register the worker. So we keep a tiny copy of the switch's value
 *   in the browser's localStorage (written by AuthContext the moment the real
 *   flags load) and read that copy here. One page-load of lag is accepted and
 *   safe: a stale-OFF just delays push by one refresh; a stale-ON registers a
 *   push-only worker that does nothing until a subscription exists.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (bootstrap helper)
 *   Rendered by:  n/a — imported by main.jsx; the mirror is written by
 *                 contexts/AuthContext.jsx when feature flags load.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (public/sw.js is the worker file it registers)
 *   Data:      reads → localStorage[WEB_PUSH_FLAG_MIRROR_KEY]
 *
 * NOTES / GOTCHAS:
 *   - The worker at /sw.js is PUSH-ONLY (no fetch caching) — registering it can
 *     never re-create the April-2026 MIME/blank-page trap.
 *   - When the flag is OFF, main.jsx does NOT call this — it runs the original
 *     kill-switch (unregister + cache wipe + /reset bounce) instead.
 * ════════════════════════════════════════════════
 */

// localStorage key holding a mirror of the `feature:web_push` flag for the
// signed-in user. AuthContext writes '1' (enabled) / '0' (disabled) when flags
// load; absent = never loaded = treat as OFF (preserve the kill-switch).
export const WEB_PUSH_FLAG_MIRROR_KEY = 'upr:web_push_enabled';

/** True only when the flag mirror explicitly says web push is enabled. */
export function isWebPushEnabled() {
  try {
    return localStorage.getItem(WEB_PUSH_FLAG_MIRROR_KEY) === '1';
  } catch {
    return false; // storage blocked (private mode / iframe) → default OFF
  }
}

/**
 * Register the push-only service worker at the root scope. Safe anywhere:
 * no-ops where service workers are unsupported (older browsers, some WKWebView
 * contexts, the Capacitor native shell).
 */
export async function registerPushServiceWorker() {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) {
    console.info('[sw] service workers not supported in this environment');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.info('[sw] push worker registered', reg.scope);
    return reg;
  } catch (err) {
    console.warn('[sw] push registration failed', err);
    return null;
  }
}
