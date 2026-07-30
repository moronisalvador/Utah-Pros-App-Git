/**
 * ════════════════════════════════════════════════
 * FILE: webPushClient.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The browser side of push notifications. When someone taps "Enable push on
 *   this device", this asks the browser for permission, registers the device
 *   with the browser's push service, and saves the resulting subscription (the
 *   secret address the server pushes to) into our database. It also handles
 *   turning push OFF again. It only reports what actually happened — it never
 *   pretends success.
 *
 * IMPORTED BY:
 *   the Settings "Notifications" panel (and, later, the tech notifications screen).
 *
 * DEPENDS ON:
 *   Packages:  none (browser Push API + Notification API)
 *   Internal:  pwaServiceWorker; the caller passes in `db` (useAuth().db)
 *   Data:      writes → push_subscriptions (via upsert_push_subscription /
 *              delete_push_subscription RPCs)
 *
 * NOTES / GOTCHAS:
 *   - iOS only exposes the Push API in an INSTALLED PWA (Add to Home Screen).
 *     In mobile Safari (not installed) `PushManager`/`Notification` are absent —
 *     isPushSupported() returns false and the UI must show install guidance.
 *   - applicationServerKey must be the RAW VAPID public key as a Uint8Array. The
 *     key is fetched at RUNTIME from GET /api/vapid-public-key (which reads it
 *     from Cloudflare env OR Supabase) — no build-time env var needed, so the
 *     owner can configure VAPID entirely in the database.
 *   - Service-worker lookup/activation and the VAPID request are bounded. A
 *     missing registration returns quickly; a user-initiated enable reconciles
 *     the worker immediately instead of waiting for the next page load.
 *   - Detach writes an owner-bound endpoint journal before any server or local
 *     cleanup. It survives reload/crash and only the matching account may
 *     consume it after both cleanup sides are proven.
 * ════════════════════════════════════════════════
 */
import {
  lookupPushServiceWorkerRegistration,
  getReadyPushServiceWorkerRegistration,
  SERVICE_WORKER_TIMEOUT_MS,
  withDeadline,
} from './pwaServiceWorker.js';
import { readPwaOwnerLease } from './resumeRestore.js';

export const VAPID_FETCH_TIMEOUT_MS = 5_000;
export const VAPID_CACHE_TTL_MS = 5 * 60_000;
export const WEB_PUSH_PENDING_DETACH_KEY = 'upr:web-push-pending-detach:v1';

// Successful and explicitly-unconfigured responses are cached briefly. Network
// and HTTP failures are never cached, so a transient outage can heal on retry.
let _vapidCache = null;
let webPushEnrollmentGeneration = 0;
let webPushEnrollmentSequence = 0;
let latestWebPushEnrollment = 0;
// The WeakMap covers same-document retries. The owner-bound local journal below
// also survives a reload/crash after local unsubscribe but before the server
// delete succeeds; a different account may revoke local delivery but may never
// consume or relabel the prior owner's pending endpoint.
const pendingWebPushServerDetaches = new WeakMap();

function isWebEnrollmentCurrent(generation) {
  return generation === webPushEnrollmentGeneration;
}

function canRememberServerDetach(db) {
  return (
    (typeof db === 'object' && db !== null)
    || typeof db === 'function'
  );
}

function pendingWebPushEndpoint(db) {
  return canRememberServerDetach(db)
    ? pendingWebPushServerDetaches.get(db) || null
    : null;
}

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function validDetachOwner(ownerKey) {
  return typeof ownerKey === 'string'
    && /^v1\.[A-Za-z0-9_-]{12,}$/.test(ownerKey);
}

function readPendingWebPushDetach(storage = browserStorage()) {
  let raw;
  try {
    raw = storage?.getItem(WEB_PUSH_PENDING_DETACH_KEY);
  } catch {
    return { invalid: true };
  }
  if (!raw) return null;
  try {
    const marker = JSON.parse(raw);
    if (
      marker?.version !== 1
      || !validDetachOwner(marker.ownerKey)
      || typeof marker.endpoint !== 'string'
      || !marker.endpoint.startsWith('https://')
      || marker.endpoint.length > 4_096
      || typeof marker.localDetached !== 'boolean'
    ) {
      return { invalid: true };
    }
    return marker;
  } catch {
    return { invalid: true };
  }
}

function writePendingWebPushDetach(
  storage,
  {
    ownerKey,
    endpoint,
    localDetached = false,
  },
) {
  if (
    !storage
    || !validDetachOwner(ownerKey)
    || typeof endpoint !== 'string'
    || !endpoint.startsWith('https://')
    || endpoint.length > 4_096
  ) {
    return false;
  }
  try {
    const serialized = JSON.stringify({
      version: 1,
      ownerKey,
      endpoint,
      localDetached: localDetached === true,
    });
    storage.setItem(WEB_PUSH_PENDING_DETACH_KEY, serialized);
    return storage.getItem(WEB_PUSH_PENDING_DETACH_KEY) === serialized;
  } catch {
    return false;
  }
}

function clearPendingWebPushDetach(storage) {
  try {
    storage?.removeItem(WEB_PUSH_PENDING_DETACH_KEY);
    return !storage?.getItem(WEB_PUSH_PENDING_DETACH_KEY);
  } catch {
    return false;
  }
}

async function detachWebPushServer(db, endpoint, timeoutMs, label) {
  if (!endpoint) {
    return {
      required: false,
      attempted: false,
      succeeded: true,
    };
  }

  if (canRememberServerDetach(db)) {
    pendingWebPushServerDetaches.set(db, endpoint);
  }
  if (typeof db?.rpc !== 'function') {
    return {
      required: true,
      attempted: false,
      succeeded: false,
    };
  }

  try {
    // Both the deployed and authored S1h functions return void. Resolution is
    // the proof: an absent row is already detached, while denial/foreign
    // ownership/timeout rejects and must remain retryable.
    await withDeadline(
      db.rpc('delete_push_subscription', {
        p_endpoint: endpoint,
      }),
      timeoutMs,
      label,
    );
    if (canRememberServerDetach(db)) {
      pendingWebPushServerDetaches.delete(db);
    }
    return {
      required: true,
      attempted: true,
      succeeded: true,
    };
  } catch (error) {
    return {
      required: true,
      attempted: true,
      succeeded: false,
      error,
    };
  }
}

function timeoutSignal(timeoutMs) {
  if (!globalThis.AbortController) return { signal: undefined, clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Fetch (and memoize) the VAPID public key from the server. Returns '' when push
 * isn't configured yet. Never throws — a network hiccup reads as unconfigured.
 */
export async function getVapidPublicKey({
  fetchImpl = globalThis.fetch,
  timeoutMs = VAPID_FETCH_TIMEOUT_MS,
  now = Date.now(),
} = {}) {
  if (_vapidCache && _vapidCache.expiresAt > now) return _vapidCache.key;
  const deadline = timeoutSignal(timeoutMs);
  try {
    const res = await withDeadline(
      fetchImpl('/api/vapid-public-key', { signal: deadline.signal }),
      timeoutMs,
      'VAPID configuration request',
    );
    if (!res?.ok) return '';
    const data = await res.json().catch(() => ({}));
    const key = data && typeof data.publicKey === 'string' ? data.publicKey : '';
    _vapidCache = { key, expiresAt: now + VAPID_CACHE_TTL_MS };
    return key;
  } catch {
    return '';
  } finally {
    deadline.clear();
  }
}

export function resetVapidPublicKeyCache() {
  _vapidCache = null;
}

// ─── SECTION: capability + state ───

/** True only where real Web Push works (SW + PushManager + Notification). */
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** True when the server has a VAPID public key configured (async — fetches once). */
export async function isPushConfigured() {
  return !!(await getVapidPublicKey());
}

/** Current Notification permission ('default' | 'granted' | 'denied' | 'unsupported'). */
export function pushPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

function subscriptionLookupFailure(error, fallbackReason = 'error') {
  return {
    status: 'unknown',
    subscription: null,
    error,
    reason: /timed out/i.test(error?.message || '')
      ? 'timeout'
      : fallbackReason,
  };
}

/**
 * Strict subscription lookup for account cleanup.
 *
 * `missing` is known absence. `unknown` means a browser lookup failed or an
 * unexpected worker owns the scope; callers must never translate it to a
 * successful detach.
 */
export async function lookupExistingSubscription({
  timeoutMs = SERVICE_WORKER_TIMEOUT_MS,
  serviceWorker,
} = {}) {
  if (!isPushSupported()) {
    return { status: 'unsupported', subscription: null };
  }

  const registrationLookup = await lookupPushServiceWorkerRegistration({
    timeoutMs,
    serviceWorker,
  });
  if (registrationLookup.status === 'missing') {
    return { status: 'missing', subscription: null };
  }
  if (registrationLookup.status === 'unsupported') {
    return { status: 'unsupported', subscription: null };
  }
  if (registrationLookup.status === 'unknown') {
    return subscriptionLookupFailure(
      registrationLookup.error,
      registrationLookup.reason,
    );
  }
  if (registrationLookup.status !== 'found') {
    return subscriptionLookupFailure(
      new Error('An unexpected service worker owns the application scope'),
      'unexpected_registration',
    );
  }

  const reg = registrationLookup.registration;
  if (!reg?.pushManager?.getSubscription) {
    return subscriptionLookupFailure(
      new Error('Push subscription lookup is unavailable'),
      'missing_push_manager',
    );
  }
  try {
    const subscription = await withDeadline(
      reg.pushManager.getSubscription(),
      timeoutMs,
      'push subscription lookup',
    );
    return subscription
      ? { status: 'found', subscription }
      : { status: 'missing', subscription: null };
  } catch (error) {
    return subscriptionLookupFailure(error);
  }
}

/** Whether this device already has an active push subscription. */
export async function getExistingSubscription(options = {}) {
  const lookup = await lookupExistingSubscription(options);
  return lookup.status === 'found' ? lookup.subscription : null;
}

// ─── SECTION: helpers ───

// base64url VAPID public key → Uint8Array for applicationServerKey.
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// A PushSubscription's keys are ArrayBuffers — encode them base64url for the RPC.
function subscriptionKeys(sub) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh || '',
    auth: json.keys?.auth || '',
  };
}

async function cleanCancelledWebEnrollment(
  db,
  sub,
  keys,
  timeoutMs,
  { deleteServer = false } = {},
) {
  if (deleteServer && keys?.endpoint) {
    await detachWebPushServer(
      db,
      keys.endpoint,
      timeoutMs,
      'cancelled push server cleanup',
    );
  }

  if (sub?.unsubscribe) {
    try {
      await withDeadline(
        sub.unsubscribe(),
        timeoutMs,
        'cancelled push subscription removal',
      );
    } catch {
      // detachWebPushDevice/dropLocalWebPushSubscription already attempted the
      // authoritative local revoke for this generation.
    }
  }
}

// ─── SECTION: subscribe / unsubscribe ───

/**
 * Subscribe THIS device to push and persist it. Returns
 * { ok, reason?, subscription? }. `reason` is a short machine code the UI maps
 * to a message: 'unsupported' | 'unconfigured' | 'denied' | 'timeout' |
 * 'cancelled' | 'error'.
 */
export async function enablePush(db, {
  timeoutMs = SERVICE_WORKER_TIMEOUT_MS,
  serviceWorker,
} = {}) {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  const enrollmentGeneration = webPushEnrollmentGeneration;
  const enrollmentAttempt = ++webPushEnrollmentSequence;
  latestWebPushEnrollment = enrollmentAttempt;
  const publicKey = await getVapidPublicKey({ timeoutMs });
  if (!isWebEnrollmentCurrent(enrollmentGeneration)) {
    return { ok: false, reason: 'cancelled' };
  }
  if (!publicKey) return { ok: false, reason: 'unconfigured' };

  // Ask for permission (idempotent — a prior grant resolves immediately).
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    if (!isWebEnrollmentCurrent(enrollmentGeneration)) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'error' };
  }
  if (!isWebEnrollmentCurrent(enrollmentGeneration)) {
    return { ok: false, reason: 'cancelled' };
  }
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  let sub = null;
  let keys = null;
  let upsertAttempted = false;
  try {
    const reg = await getReadyPushServiceWorkerRegistration({ timeoutMs, serviceWorker });
    if (!isWebEnrollmentCurrent(enrollmentGeneration)) {
      return { ok: false, reason: 'cancelled' };
    }
    if (!reg?.pushManager) return { ok: false, reason: 'timeout' };
    // Reuse an existing subscription if present, else create one.
    sub = await withDeadline(
      reg.pushManager.getSubscription(),
      timeoutMs,
      'push subscription lookup',
    );
    if (!sub) {
      sub = await withDeadline(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }),
        timeoutMs,
        'push subscription creation',
      );
    }
    keys = subscriptionKeys(sub);
    if (!isWebEnrollmentCurrent(enrollmentGeneration)) {
      if (latestWebPushEnrollment === enrollmentAttempt) {
        await cleanCancelledWebEnrollment(db, sub, keys, timeoutMs);
      }
      return { ok: false, reason: 'cancelled' };
    }
    upsertAttempted = true;
    await db.rpc('upsert_push_subscription', {
      p_endpoint: keys.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_user_agent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
    });
    if (!isWebEnrollmentCurrent(enrollmentGeneration)) {
      if (latestWebPushEnrollment === enrollmentAttempt) {
        await cleanCancelledWebEnrollment(
          db,
          sub,
          keys,
          timeoutMs,
          { deleteServer: true },
        );
      }
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: true, subscription: sub };
  } catch (err) {
    if (!isWebEnrollmentCurrent(enrollmentGeneration)) {
      if (latestWebPushEnrollment === enrollmentAttempt) {
        await cleanCancelledWebEnrollment(
          db,
          sub,
          keys,
          timeoutMs,
          { deleteServer: upsertAttempted },
        );
      }
      return { ok: false, reason: 'cancelled' };
    }
    console.warn('[push] enable failed', err);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Unsubscribe THIS device and remove its stored row. Returns { ok }.
 * Success requires both the owner-scoped server detach and local unsubscribe.
 * Either failure stays visible so account cleanup can remain hard-locked.
 */
export async function disablePush(db) {
  const result = await detachWebPushDevice(db);
  return { ok: result.ready };
}

/**
 * Revoke the browser endpoint without requiring an authenticated database call.
 * Account changes use this fail-closed path even when the old session is gone.
 */
export async function dropLocalWebPushSubscription(options = {}) {
  // Invalidate before lookup/unsubscribe so an earlier enable operation cannot
  // persist or report success after account cleanup has started.
  webPushEnrollmentGeneration += 1;
  const timeoutMs = options.timeoutMs || SERVICE_WORKER_TIMEOUT_MS;
  const lookup = await lookupExistingSubscription(options);
  if (lookup.status === 'unknown') {
    return {
      ok: false,
      reason: lookup.reason || 'subscription_lookup_failed',
      lookupStatus: 'unknown',
      localDetached: false,
      hadSubscription: null,
    };
  }
  if (lookup.status !== 'found') {
    return {
      ok: true,
      lookupStatus: lookup.status,
      localDetached: true,
      hadSubscription: false,
    };
  }

  const sub = lookup.subscription;
  try {
    const localDetached = await withDeadline(
      sub.unsubscribe(),
      timeoutMs,
      'push subscription removal',
    );
    return {
      ok: localDetached !== false,
      lookupStatus: 'found',
      localDetached: localDetached !== false,
      hadSubscription: true,
    };
  } catch (error) {
    console.warn('[push] local detach failed', error);
    return {
      ok: false,
      reason: /timed out/i.test(error?.message || '') ? 'timeout' : 'error',
      lookupStatus: 'found',
      localDetached: false,
      hadSubscription: true,
    };
  }
}

/**
 * Detach server ownership while the authenticated client is still available,
 * then revoke local delivery even if that server cleanup fails.
 */
export async function detachWebPushDevice(db, options = {}) {
  // This happens before the first await. A concurrent enable must observe the
  // new generation even when no subscription exists yet for detach to find.
  webPushEnrollmentGeneration += 1;
  const timeoutMs = options.timeoutMs || SERVICE_WORKER_TIMEOUT_MS;
  const storage = options.storage === undefined
    ? browserStorage()
    : options.storage;
  const ownerKey = options.ownerKey
    || readPwaOwnerLease(storage)?.owner
    || null;
  const durablePending = readPendingWebPushDetach(storage);
  const pendingMarkerInvalid = durablePending?.invalid === true;
  const pendingOwnerMismatch = !!durablePending
    && !pendingMarkerInvalid
    && (
      !validDetachOwner(ownerKey)
      || durablePending.ownerKey !== ownerKey
    );
  const lookup = await lookupExistingSubscription(options);
  const pendingEndpoint = (
    durablePending
    && !pendingMarkerInvalid
    && !pendingOwnerMismatch
    && durablePending.endpoint
  ) || pendingWebPushEndpoint(db);
  const foundEndpoint = lookup.status === 'found'
    ? subscriptionKeys(lookup.subscription).endpoint
    : null;
  const endpoint = pendingEndpoint || foundEndpoint;
  let markerPersisted = !endpoint;
  if (endpoint && !pendingOwnerMismatch && !pendingMarkerInvalid) {
    markerPersisted = writePendingWebPushDetach(storage, {
      ownerKey,
      endpoint,
      localDetached: durablePending?.localDetached === true,
    });
  }

  const durableServerCallRequired = !!durablePending
    && !pendingMarkerInvalid;
  let server = {
    required: !!endpoint || durableServerCallRequired,
    attempted: false,
    succeeded: !endpoint && !durableServerCallRequired,
  };
  if (!pendingOwnerMismatch && !pendingMarkerInvalid) {
    server = await detachWebPushServer(
      db,
      endpoint,
      timeoutMs,
      pendingEndpoint
        ? 'pending push server detach'
        : 'push server detach',
    );
  }

  let localDetached = durablePending?.localDetached === true;
  if (lookup.status === 'found') {
    try {
      localDetached = (await withDeadline(
        lookup.subscription.unsubscribe(),
        timeoutMs,
        'push subscription removal',
      )) !== false;
    } catch {
      localDetached = false;
    }
  } else if (lookup.status !== 'unknown') {
    localDetached = true;
  }

  let markerCleared = !durablePending && !markerPersisted;
  if (server.succeeded && !pendingOwnerMismatch && !pendingMarkerInvalid) {
    markerCleared = clearPendingWebPushDetach(storage);
  } else if (
    endpoint
    && !pendingOwnerMismatch
    && !pendingMarkerInvalid
  ) {
    markerPersisted = writePendingWebPushDetach(storage, {
      ownerKey,
      endpoint,
      localDetached,
    });
  } else if (
    durablePending
    && !pendingMarkerInvalid
    && pendingOwnerMismatch
  ) {
    markerPersisted = writePendingWebPushDetach(storage, {
      ownerKey: durablePending.ownerKey,
      endpoint: durablePending.endpoint,
      localDetached,
    });
  }

  const ready = !pendingMarkerInvalid
    && !pendingOwnerMismatch
    && server.succeeded
    && localDetached
    && markerCleared;
  const serverDetachProven = !pendingOwnerMismatch
    && !pendingMarkerInvalid
    && server.succeeded
    && (server.required || lookup.status !== 'unknown');
  // Positive journal evidence for the caller's sign-out deferral decision:
  // re-read the marker AFTER every write/clear above. `markerPersisted` alone
  // is not proof (it initializes true when there was nothing to mark), so a
  // deferral must key on this field, never on markerPersisted.
  const residualMarker = readPendingWebPushDetach(storage);
  const residualJournaled = !!residualMarker
    && residualMarker.invalid !== true
    && validDetachOwner(ownerKey)
    && residualMarker.ownerKey === ownerKey;
  return {
    ok: ready,
    ready,
    residualJournaled,
    reason: pendingMarkerInvalid
      ? 'pending_detach_marker_invalid'
      : pendingOwnerMismatch
        ? 'pending_detach_owner_mismatch'
        : lookup.status === 'unknown' && !localDetached
          ? lookup.reason || 'subscription_lookup_failed'
          : undefined,
    lookupStatus: lookup.status,
    hadSubscription: lookup.status === 'found'
      ? true
      : lookup.status === 'unknown'
        ? null
        : false,
    serverDetached: serverDetachProven,
    serverCallRequired: server.required,
    serverCallAttempted: server.attempted,
    serverCallSucceeded: server.succeeded,
    localDetached,
    markerPersisted,
    markerCleared,
    pendingOwnerMismatch,
    pendingMarkerInvalid,
  };
}

export async function retryPendingWebPushDetach(db, options = {}) {
  const storage = options.storage === undefined
    ? browserStorage()
    : options.storage;
  const pending = readPendingWebPushDetach(storage);
  if (!pending) {
    return {
      ok: true,
      ready: true,
      pending: false,
      pendingOwnerMismatch: false,
      pendingMarkerInvalid: false,
    };
  }
  const result = await detachWebPushDevice(db, {
    ...options,
    storage,
  });
  return {
    ...result,
    pending: true,
  };
}
