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
 *   - Every saved route is bound to one immutable, verified account lease. A
 *     stale tab cannot follow a later account by rereading and relabeling itself
 *     with the device-global owner marker.
 * ════════════════════════════════════════════════
 */

export const ROUTE_KEY = 'upr:lastRoute';
export const ROUTE_KEY_PREFIX = 'upr:lastRoute:v2:';
export const PWA_ACCOUNT_OWNER_KEY = 'upr:pwa-account-owner:v1';
export const PWA_ACCOUNT_EPOCH_KEY = 'upr:pwa-account-epoch:v1';
export const PWA_ACCOUNT_TRANSITION_KEY = 'upr:pwa-account-transition:v1';

/** Owner-scoped durable drafts (PRIV-01). */
export const OWNED_DRAFT_PREFIX = 'upr:owned-draft:v1:';
/**
 * Pre-PRIV-01 draft prefixes. These were keyed only by conversation/sheet id,
 * so account A's half-typed customer SMS and in-progress Scope Sheet were
 * readable by account B on the same device. New writes are owner-scoped; these
 * remain listed so an account switch or logout sweeps anything already on disk,
 * including drafts written by surfaces this change does not otherwise touch.
 */
export const LEGACY_UNSCOPED_DRAFT_PREFIXES = Object.freeze([
  'upr:conv-draft:',
  'scopesheet:draft:',
]);

const OPAQUE_OWNER_PATTERN = /^v1\.[A-Za-z0-9_-]{12,}$/;
const SESSION_EPOCH_PATTERN = /^e1\.[A-Za-z0-9_-]{5,}$/;

// How long a remembered route stays restorable. Long enough for a calculator /
// phone-call / photo detour; short enough that a fresh morning open starts home.
export const RESUME_TTL_MS = 30 * 60 * 1000;

// The manifest start_url — the URL iOS relaunches an evicted home-screen PWA at.
const START_URLS = new Set(['/tech', '/tech/']);

// Routes that must never be saved or restored into.
const EXCLUDED = [
  /^\/login/,
  /^\/reset/,
  /^\/set-password/,
  /^\/sign\//,
  /^\/s\//,
];

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function normalizePwaOwnerLease(lease) {
  if (
    !lease
    || typeof lease.owner !== 'string'
    || !OPAQUE_OWNER_PATTERN.test(lease.owner)
    || typeof lease.epoch !== 'string'
    || !SESSION_EPOCH_PATTERN.test(lease.epoch)
  ) {
    return null;
  }
  return { owner: lease.owner, epoch: lease.epoch };
}

/** Read the opaque owner + login epoch currently authorized for this device. */
export function readPwaOwnerLease(storage = browserStorage()) {
  try {
    const owner = storage?.getItem(PWA_ACCOUNT_OWNER_KEY) || null;
    const epoch = storage?.getItem(PWA_ACCOUNT_EPOCH_KEY) || null;
    return normalizePwaOwnerLease({ owner, epoch });
  } catch {
    return null;
  }
}

/** True only while the supplied immutable tab lease is still device-current. */
export function isPwaOwnerLeaseCurrent(lease, storage = browserStorage()) {
  const expected = normalizePwaOwnerLease(lease);
  const current = readPwaOwnerLease(storage);
  let transitionActive = true;
  try {
    transitionActive = !!storage?.getItem(PWA_ACCOUNT_TRANSITION_KEY);
  } catch {
    transitionActive = true;
  }
  return !transitionActive
    && !!expected
    && !!current
    && expected.owner === current.owner
    && expected.epoch === current.epoch;
}

/** Block every tab from using the current lease during an account transition. */
export function beginPwaOwnerTransition(token, storage = browserStorage()) {
  if (!token || !storage) return false;
  try {
    storage.setItem(PWA_ACCOUNT_TRANSITION_KEY, token);
    return storage.getItem(PWA_ACCOUNT_TRANSITION_KEY) === token;
  } catch {
    return false;
  }
}

/** Release only the transition this caller started; never clear a newer tab's. */
export function finishPwaOwnerTransition(token, storage = browserStorage()) {
  if (!token || !storage) return false;
  try {
    if (storage.getItem(PWA_ACCOUNT_TRANSITION_KEY) !== token) return false;
    storage.removeItem(PWA_ACCOUNT_TRANSITION_KEY);
    return !storage.getItem(PWA_ACCOUNT_TRANSITION_KEY);
  } catch {
    return false;
  }
}

/**
 * Publish a verified account lease. Epoch is written first so an interrupted
 * write never makes a new owner usable with the prior owner's epoch.
 */
export function writePwaOwnerLease(
  lease,
  storage = browserStorage(),
  transitionToken = null,
) {
  const next = normalizePwaOwnerLease(lease);
  if (!next || !storage) return false;
  try {
    if (
      transitionToken
      && storage.getItem(PWA_ACCOUNT_TRANSITION_KEY) !== transitionToken
    ) {
      return false;
    }
    storage.setItem(PWA_ACCOUNT_EPOCH_KEY, next.epoch);
    storage.setItem(PWA_ACCOUNT_OWNER_KEY, next.owner);
    if (
      storage.getItem(PWA_ACCOUNT_OWNER_KEY) !== next.owner
      || storage.getItem(PWA_ACCOUNT_EPOCH_KEY) !== next.epoch
      || (
        transitionToken
        && storage.getItem(PWA_ACCOUNT_TRANSITION_KEY) !== transitionToken
      )
    ) {
      return false;
    }
    if (transitionToken) {
      storage.removeItem(PWA_ACCOUNT_TRANSITION_KEY);
    }
    if (!isPwaOwnerLeaseCurrent(next, storage)) return false;
    return true;
  } catch {
    // A partial marker is unusable while this transition remains present.
    return false;
  }
}

/** Invalidate every tab before asynchronous account cleanup begins. */
export function invalidatePwaOwnerLease(storage = browserStorage()) {
  try {
    storage?.removeItem(PWA_ACCOUNT_OWNER_KEY);
    storage?.removeItem(PWA_ACCOUNT_EPOCH_KEY);
    return readPwaOwnerLease(storage) === null;
  } catch {
    return false;
  }
}

/** Owner/epoch-specific storage key. Both components are already opaque. */
export function routeStorageKey(lease) {
  const normalized = normalizePwaOwnerLease(lease);
  if (!normalized) return null;
  return `${ROUTE_KEY_PREFIX}${encodeURIComponent(normalized.owner)}:${encodeURIComponent(normalized.epoch)}`;
}

/**
 * Owner/epoch-scoped key for any durable per-account draft (PRIV-01).
 * Returns null when the lease is absent so every caller can fail closed —
 * `pwaOwnerLease` is null until device state is verified, and writing an
 * unowned draft is exactly the leak this prevents. `scope` separates draft
 * families (conversation text, scope-sheet mirrors) so they cannot collide.
 */
export function ownedDraftStorageKey(lease, scope, id) {
  const normalized = normalizePwaOwnerLease(lease);
  if (!normalized || !scope || !id) return null;
  return `${OWNED_DRAFT_PREFIX}${encodeURIComponent(scope)}:`
    + `${encodeURIComponent(normalized.owner)}:${encodeURIComponent(normalized.epoch)}:`
    + `${encodeURIComponent(id)}`;
}

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

export function saveRoute(
  url,
  ownerLease,
  {
    storage = browserStorage(),
    now = Date.now(),
  } = {},
) {
  const lease = normalizePwaOwnerLease(ownerLease);
  const key = routeStorageKey(lease);
  if (!lease || !key || !isPwaOwnerLeaseCurrent(lease, storage)) return false;
  try {
    const pathname = url.split('?')[0];
    if (!shouldSaveRoute(pathname)) return false;
    storage.setItem(key, JSON.stringify({
      url,
      ts: now,
      owner: lease.owner,
      epoch: lease.epoch,
    }));
    if (!isPwaOwnerLeaseCurrent(lease, storage)) {
      storage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function readSavedRoute(
  ownerLease,
  { storage = browserStorage() } = {},
) {
  const lease = normalizePwaOwnerLease(ownerLease);
  const key = routeStorageKey(lease);
  if (!lease || !key || !isPwaOwnerLeaseCurrent(lease, storage)) return null;
  try {
    const s = storage.getItem(key);
    if (!s) return null;
    const saved = JSON.parse(s);
    if (saved?.owner !== lease.owner || saved?.epoch !== lease.epoch) {
      storage.removeItem(key);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

/** Remove the saved standalone route on logout or account change. */
export function clearSavedRoute(
  ownerLease,
  { storage = browserStorage() } = {},
) {
  const key = routeStorageKey(ownerLease);
  try {
    // ROUTE_KEY is the pre-ownership legacy key. It is never restored.
    storage?.removeItem(ROUTE_KEY);
    if (key) storage?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove durable drafts on logout or account change (PRIV-01).
 *
 * Sweeps BOTH the owner-scoped namespace and every legacy unscoped prefix.
 * The legacy sweep is what protects surfaces that still write the old keys —
 * an account switch clears them regardless of which screen created them, so a
 * second account can never read the first account's text. Removal is by prefix
 * rather than by exact key because the ids are not known at logout time.
 */
export function clearOwnedDrafts(
  ownerLease,
  { storage = browserStorage() } = {},
) {
  try {
    if (!storage) return true;
    // Enumeration is required to sweep by prefix. A storage that cannot be
    // enumerated must report failure rather than silently claiming success —
    // otherwise an unsweepable draft reads as "cleared" to the caller.
    if (typeof storage.length !== 'number' || typeof storage.key !== 'function') {
      return false;
    }
    const doomed = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      const legacy = LEGACY_UNSCOPED_DRAFT_PREFIXES.some((p) => key.startsWith(p));
      // The whole owned namespace goes, not just this lease's slice: at logout
      // we cannot prove which owner an orphaned key belonged to, and leaving it
      // is the leak. `ownerLease` is accepted for symmetry with clearSavedRoute
      // and so a future per-owner retention policy has somewhere to live.
      const owned = key.startsWith(OWNED_DRAFT_PREFIX);
      if (legacy || owned) doomed.push(key);
    }
    doomed.forEach((key) => storage.removeItem(key));
    return true;
  } catch {
    return false;
  }
}
