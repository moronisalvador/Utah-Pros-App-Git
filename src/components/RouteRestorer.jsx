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
 *   - Restore runs once only after authentication has verified an immutable
 *     owner lease. Callers must key/remount this helper for an account change.
 *   - Restoration remains standalone-only — a normal browser tab keeps its URL
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

export default function RouteRestorer({
  authVerified = false,
  ownerLease = null,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const bootHandledRef = useRef(false);
  const tabOwnerRef = useRef(null);

  // One-shot restore after auth verification and before this gated subtree paints.
  useLayoutEffect(() => {
    if (bootHandledRef.current) return;
    // Capture once. A stale tab must never "follow" a device-global owner
    // marker and relabel its writes after another account authenticates.
    if (
      authVerified
      && !tabOwnerRef.current
      && ownerLease?.owner
      && ownerLease?.epoch
    ) {
      tabOwnerRef.current = {
        owner: ownerLease.owner,
        epoch: ownerLease.epoch,
      };
    }
    const tabOwner = tabOwnerRef.current;
    if (!authVerified || !tabOwner) return;
    bootHandledRef.current = true;
    if (!isStandaloneDisplay()) return;
    const target = pickRestoreUrl(
      location.pathname,
      readSavedRoute(tabOwner),
      Date.now(),
    );
    if (target) navigate(target, { replace: true });
  }, [authVerified, location.pathname, navigate, ownerLease]);

  // Remember where the tech is working (rules filter what qualifies). Also
  // re-stamp the timestamp the moment the app is backgrounded — that's when
  // the eviction clock starts, and a tech parked >30 min on ONE screen (a
  // long scope sheet) must still restore after a calculator detour.
  useEffect(() => {
    const tabOwner = tabOwnerRef.current;
    if (!authVerified || !tabOwner) return undefined;
    const url = location.pathname + location.search;
    saveRoute(url, tabOwner);
    const onVis = () => {
      if (document.visibilityState === 'hidden') saveRoute(url, tabOwner);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [authVerified, location.pathname, location.search]);

  return null;
}
