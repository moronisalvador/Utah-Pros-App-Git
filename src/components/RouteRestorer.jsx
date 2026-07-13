/**
 * ════════════════════════════════════════════════
 * FILE: RouteRestorer.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Invisible helper that lives at the top of the app. It quietly remembers
 *   which screen the tech is on, and if the phone killed the home-screen app
 *   in the background (which restarts it at the front page), it sends them
 *   straight back to the screen they were working on — so returning from the
 *   calculator or another app feels like nothing happened.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (renders nothing)
 *   Rendered by:  src/App.jsx (directly inside <BrowserRouter>)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/lib/resumeRestore (the tested decision rules + storage)
 *   Data:      none (localStorage only)
 *
 * NOTES / GOTCHAS:
 *   - Restore runs ONCE per boot, before first paint (useLayoutEffect), and
 *     only in standalone display mode — a normal browser tab keeps its URL
 *     across reloads, so restoring there would only surprise people.
 *   - Saving runs on every route change; the decision rules in resumeRestore
 *     filter out auth/public routes and stale entries.
 * ════════════════════════════════════════════════
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  isStandaloneDisplay, pickRestoreUrl, readSavedRoute, saveRoute,
} from '@/lib/resumeRestore';

export default function RouteRestorer() {
  const location = useLocation();
  const navigate = useNavigate();
  const bootHandledRef = useRef(false);

  // One-shot restore, decided before the start route paints.
  useLayoutEffect(() => {
    if (bootHandledRef.current) return;
    bootHandledRef.current = true;
    if (!isStandaloneDisplay()) return;
    const target = pickRestoreUrl(location.pathname, readSavedRoute(), Date.now());
    if (target) navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember where the tech is working (rules filter what qualifies). Also
  // re-stamp the timestamp the moment the app is backgrounded — that's when
  // the eviction clock starts, and a tech parked >30 min on ONE screen (a
  // long scope sheet) must still restore after a calculator detour.
  useEffect(() => {
    const url = location.pathname + location.search;
    saveRoute(url);
    const onVis = () => {
      if (document.visibilityState === 'hidden') saveRoute(url);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [location.pathname, location.search]);

  return null;
}
