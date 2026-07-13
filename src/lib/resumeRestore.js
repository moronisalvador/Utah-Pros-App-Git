/**
 * ════════════════════════════════════════════════
 * FILE: resumeRestore.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When the app is installed on a phone's home screen (a PWA), iOS quietly
 *   kills it in the background when the tech switches to another app for a
 *   while. Reopening it then starts over at the app's front page (/tech)
 *   instead of the screen the tech was working on. This file remembers the
 *   last screen the tech was on and, when the app restarts at the front page
 *   shortly after, sends them straight back — so coming back from the
 *   calculator feels like nothing happened.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (consumed by src/components/RouteRestorer.jsx)
 *   Data:      none (localStorage only)
 *
 * NOTES / GOTCHAS:
 *   - Restoration is gated to STANDALONE display mode (home-screen PWA /
 *     iOS "Add to Home Screen"). In a normal browser tab the URL survives a
 *     reload anyway, so restoring there would only surprise people.
 *   - Only a launch that lands exactly on the manifest start_url (/tech) is
 *     eligible — that is the eviction-relaunch signature. Deep links, normal
 *     navigation, and desktop are never hijacked.
 *   - RESUME_TTL_MS (30 min) separates "came back mid-task" from "opened the
 *     app fresh the next morning" — a stale route is ignored.
 *   - Auth/public routes (/login, /reset, /set-password, /sign/…) are neither
 *     saved nor restored.
 * ════════════════════════════════════════════════
 */

const ROUTE_KEY = 'upr:lastRoute';

// How long a remembered route stays restorable. Long enough for a calculator /
// phone-call / photo detour; short enough that a fresh morning open starts home.
export const RESUME_TTL_MS = 30 * 60 * 1000;

// The manifest start_url — the URL iOS relaunches an evicted home-screen PWA at.
const START_URLS = new Set(['/tech', '/tech/']);

// Routes that must never be saved or restored into.
const EXCLUDED = [/^\/login/, /^\/reset/, /^\/set-password/, /^\/sign\//];

export function isStandaloneDisplay() {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
      window.navigator.standalone === true // iOS Safari legacy signal
    );
  } catch {
    return false;
  }
}

// Should this route be remembered as "where the tech is working"? Pure.
export function shouldSaveRoute(pathname) {
  if (!pathname || typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  return !EXCLUDED.some(rx => rx.test(pathname));
}

// Decide whether a just-launched app should jump back to a remembered route.
// Pure — the caller reads storage/clock and passes everything in.
//   currentPath — location.pathname at boot
//   saved       — { url, ts } | null (from readSavedRoute)
//   now, ttlMs  — recency guard
// Returns the URL to restore, or null to stay put.
export function pickRestoreUrl(currentPath, saved, now, ttlMs = RESUME_TTL_MS) {
  if (!saved || typeof saved.url !== 'string' || !saved.url.startsWith('/')) return null;
  if (saved.url.startsWith('//')) return null; // protocol-relative = cross-origin — never navigate there
  if (!START_URLS.has(currentPath)) return null;         // only the start_url landing is an eviction signature
  if (now - (saved.ts || 0) > ttlMs) return null;        // stale — treat as a fresh open
  const savedPath = saved.url.split('?')[0];
  if (START_URLS.has(savedPath)) return null;            // already home — nothing to do
  if (!shouldSaveRoute(savedPath)) return null;          // never restore into auth/public routes
  return saved.url;
}

export function saveRoute(url) {
  try {
    const pathname = url.split('?')[0];
    if (!shouldSaveRoute(pathname)) return;
    localStorage.setItem(ROUTE_KEY, JSON.stringify({ url, ts: Date.now() }));
  } catch { /* storage unavailable — best-effort */ }
}

export function readSavedRoute() {
  try {
    const s = localStorage.getItem(ROUTE_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
