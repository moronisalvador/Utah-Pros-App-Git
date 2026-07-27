/**
 * ════════════════════════════════════════════════
 * FILE: main.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The app's entry point — the very first file the browser runs. It draws the
 *   whole React app onto the page, wraps it so the tech screens can remember their
 *   loaded data on the device (instant cold-open), and cleans up any leftover
 *   service worker from older builds.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (bootstrap)
 *   Rendered by:  n/a — this is the root; it renders <App/>
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, @tanstack/react-query-persist-client
 *   Internal:  App.jsx, components/ErrorBoundary, lib/techQuery (shared
 *              QueryClient), lib/techQueryPersister (idb cache),
 *              lib/releaseIdentity, lib/pwaDiagnostics, lib/pwaServiceWorker,
 *              lib/staleChunkReload, index.css
 *   Data:      none directly (the QueryClient's cache persists to IndexedDB, not Supabase)
 *
 * NOTES / GOTCHAS:
 *   - PersistQueryClientProvider sits ABOVE the router/auth (both inside <App/>), so
 *     the whole tech tree shares one QueryClient + its on-device cache.
 *   - Service worker registration is flag-gated by feature:web_push (read from a
 *     localStorage mirror pre-auth): ON registers the push-only /sw.js; OFF runs
 *     the original kill-switch (unregister + cache wipe + /reset bounce) verbatim.
 *   - Cache compatibility is an explicit generated release contract. It is not a
 *     dated literal that relies on a maintainer remembering to edit this file.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { buildResetUrl } from './lib/staleChunkReload.js';
import { techQueryClient } from './lib/techQuery.js';
import { techQueryPersister } from './lib/techQueryPersister.js';
import { isWebPushEnabled } from './lib/registerSW.js';
import { RELEASE } from './lib/releaseIdentity.js';
import { installPwaDiagnostics, recordPwaDiagnostic } from './lib/pwaDiagnostics.js';
import { reconcilePushServiceWorker } from './lib/pwaServiceWorker.js';
import { configureNativeKeyboard } from './lib/nativeKeyboard.js';
import './index.css';

installPwaDiagnostics();

// One-time native keyboard config (no-op on web): hides the iOS accessory bar so
// the tech Messages composer sits flush on the keyboard like iMessage. See
// lib/nativeKeyboard.js. Fire-and-forget; internally guarded + error-swallowing.
configureNativeKeyboard();

// PersistQueryClientProvider sits ABOVE the router/auth (both live inside <App/>)
// so the whole tech tree shares one QueryClient and its on-device cache. The
// persister restores asynchronously; react-query gates dependent renders until
// restore resolves. The compatibility ID is deliberately separate from release
// identity: bump it only for an incompatible persisted-query shape.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary section="UPR application">
      <PersistQueryClientProvider
        client={techQueryClient}
        persistOptions={{
          persister: techQueryPersister,
          maxAge: 24 * 60 * 60 * 1000,
          buster: RELEASE.cacheCompatibilityId,
        }}
      >
        <App />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Reconcile the mirrored pre-auth policy at boot. AuthContext must call the same
// helper immediately after the authenticated flag resolves, removing the former
// one-page-load lag. Every browser operation is bounded inside the helper.
if ('serviceWorker' in navigator) {
  const resetOnce = () => {
    try {
      if (sessionStorage.getItem('swReset')) return;
      sessionStorage.setItem('swReset', '1');
      window.location.replace(buildResetUrl(window.location.pathname + window.location.search));
    } catch {
      // Blocked sessionStorage cannot prevent recovery.
      window.location.replace(buildResetUrl(window.location.pathname + window.location.search));
    }
  };
  reconcilePushServiceWorker(isWebPushEnabled())
    .then((result) => {
      if (!result.ok) {
        recordPwaDiagnostic('service-worker', {
          section: result.reason || 'reconcile',
        });
      }
      if (result.reloadRequired) resetOnce();
    })
    .catch(() => {
      recordPwaDiagnostic('service-worker', { section: 'reconcile-error' });
    });
  // Legacy kill-switch workers may request recovery after their own cleanup.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event?.data?.type === 'upr-reset') resetOnce();
  });
}
