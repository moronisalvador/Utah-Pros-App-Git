// Service worker registration. Kept out of `main.jsx` so we don't mutate existing files —
// the bootstrap call will be wired in manually.

/**
 * Register `/sw.js` at the root scope. Safe to call in any environment; silently
 * no-ops where service workers aren't supported (older browsers, iOS WKWebView in
 * some contexts, Capacitor native shell, etc).
 */
export async function registerServiceWorker() {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) {
    console.info('[sw] service workers not supported in this environment');
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.info('[sw] registered', reg.scope);
    return reg;
  } catch (err) {
    console.warn('[sw] registration failed', err);
    return null;
  }
}
