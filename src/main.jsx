import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { buildResetUrl } from './lib/staleChunkReload.js';
import './index.css';

// Bumped to force a new bundle hash when the Cloudflare edge cached a
// broken response (text/html instead of application/javascript) for an
// immutable /assets/*.js URL. Any time you suspect edge poisoning again,
// changing this literal is the cheapest way to invalidate.
const BUILD_ID = '2026-07-01-crm-chunk-loop-fix';
void BUILD_ID;

// Notify Capgo that the app booted successfully so a bad OTA bundle isn't
// auto-rolled-back. Defensive try/catch: a top-level module throw here would
// blank the entire app — if notifyAppReady ever changes its web fallback
// behavior, or the plugin isn't loaded for any reason, we swallow it and
// let React mount anyway. The promise is fire-and-forget (no await) and
// unhandled rejections won't stop rendering, but we guard the synchronous
// call site defensively.
try {
  const p = CapacitorUpdater.notifyAppReady();
  if (p && typeof p.catch === 'function') {
    p.catch((err) => console.warn('CapacitorUpdater.notifyAppReady failed:', err?.message || err));
  }
} catch (err) {
  console.warn('CapacitorUpdater.notifyAppReady threw:', err?.message || err);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Service worker registration is DISABLED (Apr 18 2026) until we redesign
// the caching strategy to avoid the /assets/* MIME-mismatch trap that
// blanked iOS Safari. /sw.js is still served (as a kill-switch no-op) so
// any already-installed client receives it and unregisters itself.
//
// When we re-enable caching, register BELOW a navigator.serviceWorker check
// AND verify the installed SW version before trusting it.
if ('serviceWorker' in navigator) {
  // Proactively unregister any SW clinging on from an older deploy, and wipe its
  // caches so the browser isn't served stale index.html-as-JS. If a registration
  // ACTUALLY existed, bounce ONCE through /reset (Clear-Site-Data: "cache") so this
  // client also drops its poisoned HTTP-cached assets and lands fully fresh — no
  // user action. Guarded by a once-per-session flag so it can't loop.
  const resetOnce = () => {
    if (sessionStorage.getItem('swReset')) return;
    sessionStorage.setItem('swReset', '1');
    window.location.replace(buildResetUrl(window.location.pathname + window.location.search));
  };
  navigator.serviceWorker.getRegistrations()
    .then((regs) => {
      const had = regs.length > 0;
      return Promise.all(regs.map((r) => r.unregister().catch(() => {}))).then(() => had);
    })
    .then((had) => { if (had) resetOnce(); })
    .catch(() => {});
  if (typeof caches !== 'undefined' && caches.keys) {
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k).catch(() => {}))))
      .catch(() => {});
  }
  // Second path: the kill-switch SW postMessages after cleanup, in case navigate()
  // is a no-op in some browsers. Same once-guard.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'upr-reset') resetOnce();
  });
}
