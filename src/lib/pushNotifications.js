/**
 * ════════════════════════════════════════════════
 * FILE: pushNotifications.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Connects this iPhone installation to the signed-in employee for native
 *   notifications. It remembers only the last device token the database
 *   accepted so logout can remove that connection before the session ends.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @capacitor/push-notifications
 *   Internal:  nativeAppLinks.js; callers pass the authenticated database client
 *   Data:      writes → device_tokens through upsert_my_native_device_token
 *                       and delete_my_native_device_token
 *
 * NOTES / GOTCHAS:
 *   - Enrollment is fail-closed. VITE_NATIVE_PUSH_ENABLED must be exactly
 *     "true" and VITE_APNS_ENV must be exactly "sandbox" or "production" in
 *     the reviewed native build; missing or malformed values stay off.
 *   - The binding key stores only the APNs token. A pending-detach journal adds
 *     only an opaque PWA-owner fingerprint and local-cleanup proof so a crash
 *     cannot let another account relabel or consume the prior owner's token.
 *   - Detach is bounded and reports ready only after both the owner-scoped
 *     server delete and local unregister/cleanup succeed. Local cleanup is
 *     still attempted when the database is offline or denies the request.
 *   - Foreground delivery never auto-navigates or forwards notification copy.
 *     A user tap/action must pass the canonical native-route resolver.
 * ════════════════════════════════════════════════
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { resolveNativeNavigationTarget } from './nativeAppLinks.js';
import { readPwaOwnerLease } from './resumeRestore.js';

export const NATIVE_PUSH_BINDING_KEY = 'upr:native-push-binding:v1';
export const NATIVE_PUSH_PENDING_DETACH_KEY =
  'upr:native-push-pending-detach:v1';
export const NATIVE_PUSH_DETACH_TIMEOUT_MS = 5_000;

const NATIVE_PUSH_REGISTRATION_TIMEOUT_MS = 15_000;
let nativePushEnrollmentGeneration = 0;
let nativePushEnrollmentSequence = 0;
let latestNativePushEnrollment = 0;
// Same-document retries use the WeakMap. An owner-bound local journal also
// preserves the minimum token needed after a reload/crash; another account can
// revoke local APNs delivery but cannot consume or relabel that pending token.
const pendingNativePushServerDetaches = new WeakMap();

function isNativeEnrollmentCurrent(generation) {
  return generation === nativePushEnrollmentGeneration;
}

function canRememberServerDetach(db) {
  return (
    (typeof db === 'object' && db !== null)
    || typeof db === 'function'
  );
}

function pendingNativePushToken(db) {
  return canRememberServerDetach(db)
    ? pendingNativePushServerDetaches.get(db) || null
    : null;
}

function nativePushStorage() {
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

function readPendingNativePushDetach(storage = nativePushStorage()) {
  let raw;
  try {
    raw = storage?.getItem(NATIVE_PUSH_PENDING_DETACH_KEY);
  } catch {
    return { invalid: true };
  }
  if (!raw) return null;
  try {
    const marker = JSON.parse(raw);
    if (
      marker?.version !== 1
      || !validDetachOwner(marker.ownerKey)
      || typeof marker.token !== 'string'
      || !marker.token.trim()
      || marker.token.length > 4_096
      || typeof marker.localDetached !== 'boolean'
    ) {
      return { invalid: true };
    }
    return marker;
  } catch {
    return { invalid: true };
  }
}

function writePendingNativePushDetach(
  storage,
  {
    ownerKey,
    token,
    localDetached = false,
  },
) {
  if (
    !storage
    || !validDetachOwner(ownerKey)
    || typeof token !== 'string'
    || !token.trim()
    || token.length > 4_096
  ) {
    return false;
  }
  try {
    const serialized = JSON.stringify({
      version: 1,
      ownerKey,
      token,
      localDetached: localDetached === true,
    });
    storage.setItem(NATIVE_PUSH_PENDING_DETACH_KEY, serialized);
    return storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY) === serialized;
  } catch {
    return false;
  }
}

function clearPendingNativePushDetach(storage) {
  try {
    storage?.removeItem(NATIVE_PUSH_PENDING_DETACH_KEY);
    return !storage?.getItem(NATIVE_PUSH_PENDING_DETACH_KEY);
  } catch {
    return false;
  }
}

function readBoundToken(storage = nativePushStorage()) {
  try {
    const token = storage?.getItem(NATIVE_PUSH_BINDING_KEY);
    return typeof token === 'string' && token.trim() ? token : null;
  } catch {
    return null;
  }
}

function persistBoundToken(token, storage = nativePushStorage()) {
  if (!storage || typeof token !== 'string' || !token.trim()) return false;
  try {
    storage.setItem(NATIVE_PUSH_BINDING_KEY, token);
    return true;
  } catch {
    return false;
  }
}

function clearBoundToken(storage = nativePushStorage()) {
  try {
    storage?.removeItem(NATIVE_PUSH_BINDING_KEY);
    return true;
  } catch {
    return false;
  }
}

function withDeadline(value, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve(value);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
    Promise.resolve(value).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isOwnershipConflict(error) {
  if (error?.code === '42501') return true;
  const details = [error?.body, error?.message];
  return details.some((value) => {
    if (typeof value === 'string') return value.includes('42501');
    try {
      return JSON.stringify(value).includes('42501');
    } catch {
      return false;
    }
  });
}

async function unregisterAndClear({
  storage = nativePushStorage(),
  timeoutMs = NATIVE_PUSH_DETACH_TIMEOUT_MS,
} = {}) {
  if (!canRegisterPush()) {
    return {
      localDetached: true,
      localStateCleared: clearBoundToken(storage),
    };
  }

  let localDetached = false;
  let localStateCleared = false;
  try {
    await withDeadline(
      PushNotifications.unregister(),
      timeoutMs,
      'native push unregister',
    );
    localDetached = true;
  } catch {
    localDetached = false;
  } finally {
    localStateCleared = clearBoundToken(storage);
  }
  return { localDetached, localStateCleared };
}

async function cleanLateNativeServerBinding(db, token) {
  if (!token) return true;
  if (canRememberServerDetach(db)) {
    pendingNativePushServerDetaches.set(db, token);
  }
  if (typeof db?.rpc !== 'function') return false;
  try {
    await withDeadline(
      db.rpc('delete_my_native_device_token', { p_token: token }),
      NATIVE_PUSH_DETACH_TIMEOUT_MS,
      'cancelled native push server cleanup',
    );
    if (canRememberServerDetach(db)) {
      pendingNativePushServerDetaches.delete(db);
    }
    return true;
  } catch {
    // Local delivery is still revoked below, while the in-memory token lets
    // this same authenticated client retry the owner-scoped void RPC.
    return false;
  }
}

async function cleanCancelledNativeEnrollment(
  db,
  token,
  { deleteServer = false } = {},
) {
  if (deleteServer) {
    await cleanLateNativeServerBinding(db, token);
  }
  await unregisterAndClear();
}

async function waitForRegistrationToken() {
  let registrationListener = null;
  let errorListener = null;
  let timer = null;
  let settled = false;
  let settle;

  const tokenPromise = new Promise((resolve, reject) => {
    settle = (token, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      Promise.resolve(registrationListener?.remove?.()).catch(() => {});
      Promise.resolve(errorListener?.remove?.()).catch(() => {});
      if (error) reject(error);
      else resolve(token);
    };
    timer = setTimeout(
      () => settle(null, new Error('APNs registration timed out')),
      NATIVE_PUSH_REGISTRATION_TIMEOUT_MS,
    );
  });

  try {
    registrationListener = await PushNotifications.addListener(
      'registration',
      (token) => settle(token?.value || null),
    );
    errorListener = await PushNotifications.addListener(
      'registrationError',
      (error) => settle(
        null,
        new Error(error?.error || 'APNs registration failed'),
      ),
    );
    await PushNotifications.register();
  } catch (error) {
    settle(null, error);
  }

  return tokenPromise;
}

export function canRegisterPush() {
  return Capacitor.isNativePlatform();
}

export function isNativePushEnrollmentEnabled(env = import.meta.env) {
  return env?.VITE_NATIVE_PUSH_ENABLED === 'true'
    && nativeApnsEnvironment(env) !== null;
}

export function nativeApnsEnvironment(env = import.meta.env) {
  const value = env?.VITE_APNS_ENV;
  return value === 'sandbox' || value === 'production' ? value : null;
}

function nativePushActionCandidates(action) {
  const data = action?.notification?.data;
  const candidates = [
    data?.url,
    data?.data?.url,
  ].filter((value) => typeof value === 'string');
  return [...new Set(candidates)];
}

/**
 * Extract one reviewed route from a notification tap/action. Conflicting,
 * malformed, dismissed, or unsupported payloads are ignored.
 */
export function resolveNativePushActionTarget(action) {
  if (
    typeof action?.actionId !== 'string'
    || !action.actionId
    || action.actionId === 'dismiss'
  ) {
    return null;
  }

  const candidates = nativePushActionCandidates(action);
  if (candidates.length !== 1) return null;
  return resolveNativeNavigationTarget(candidates[0]);
}

function notifyPushCallback(callback, ...args) {
  if (typeof callback !== 'function') return;
  try {
    Promise.resolve(callback(...args)).catch(() => {});
  } catch {
    // A UI callback must not disable subsequent native notification events.
  }
}

/**
 * Listen for foreground notifications and user actions without registering for
 * Push or changing its default-off enrollment policy. Foreground receipt emits
 * only a constant refresh signal; only an explicit action may yield a route.
 */
export function startNativePushEventListeners({
  onForeground,
  onTarget,
  pushPlugin = PushNotifications,
  isNative = () => canRegisterPush(),
} = {}) {
  let active = true;
  let handles = [];
  let handlesRemoved = false;
  let stopPromise = null;
  let supported = false;

  try {
    supported = (
      isNative() === true
      && (
        typeof onForeground === 'function'
        || typeof onTarget === 'function'
      )
    );
  } catch {
    supported = false;
  }

  const registrations = supported
    ? [
      Promise.resolve().then(() => pushPlugin.addListener(
        'pushNotificationReceived',
        () => {
          if (!active) return;
          // Never forward title/body/data while the private app is foregrounded.
          notifyPushCallback(onForeground, {
            source: 'native_push_foreground',
          });
        },
      )),
      Promise.resolve().then(() => pushPlugin.addListener(
        'pushNotificationActionPerformed',
        (action) => {
          if (!active) return;
          const target = resolveNativePushActionTarget(action);
          if (!target) return;
          notifyPushCallback(onTarget, target, {
            source: 'native_push_action',
          });
        },
      )),
    ]
    : [];

  const setupPromise = Promise.allSettled(registrations).then((results) => {
    handles = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter(Boolean);
    return {
      failed: results.some((result) => result.status === 'rejected'),
    };
  });

  const removeHandles = async () => {
    if (handlesRemoved) return true;
    handlesRemoved = true;
    const results = await Promise.allSettled(
      handles.map((handle) => handle?.remove?.()),
    );
    return results.every((result) => result.status === 'fulfilled');
  };

  const ready = (async () => {
    if (!supported) return { ok: false, reason: 'not_native' };
    const setup = await setupPromise;
    if (setup.failed) {
      await removeHandles();
      return { ok: false, reason: 'listener_unavailable' };
    }
    if (!active) {
      await removeHandles();
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: true };
  })();

  return {
    ready,
    stop() {
      active = false;
      if (!stopPromise) {
        stopPromise = setupPromise.then(() => removeHandles());
      }
      return stopPromise;
    },
  };
}

/**
 * Register this native installation and bind its token to the authenticated
 * employee. The public signature and result contract are preserved.
 */
export async function registerPushForEmployee(db, employeeId) {
  if (!canRegisterPush()) return { ok: false, reason: 'not_native' };
  if (import.meta.env?.VITE_NATIVE_PUSH_ENABLED !== 'true') {
    return { ok: false, reason: 'native_push_disabled' };
  }
  const apnsEnvironment = nativeApnsEnvironment();
  if (!apnsEnvironment) {
    return { ok: false, reason: 'native_push_misconfigured' };
  }
  if (!employeeId) return { ok: false, reason: 'no_employee' };
  const enrollmentGeneration = nativePushEnrollmentGeneration;
  const enrollmentAttempt = ++nativePushEnrollmentSequence;
  latestNativePushEnrollment = enrollmentAttempt;
  let token = null;
  let upsertAttempted = false;

  try {
    let permission = await PushNotifications.checkPermissions();
    if (!isNativeEnrollmentCurrent(enrollmentGeneration)) {
      return { ok: false, reason: 'cancelled' };
    }
    if (permission.receive !== 'granted') {
      permission = await PushNotifications.requestPermissions();
      if (!isNativeEnrollmentCurrent(enrollmentGeneration)) {
        return { ok: false, reason: 'cancelled' };
      }
    }
    if (permission.receive !== 'granted') {
      return { ok: false, reason: 'permission_denied' };
    }

    token = await waitForRegistrationToken();
    if (!isNativeEnrollmentCurrent(enrollmentGeneration)) {
      if (latestNativePushEnrollment === enrollmentAttempt) {
        await cleanCancelledNativeEnrollment(db, token);
      }
      return { ok: false, reason: 'cancelled' };
    }
    if (!token) return { ok: false, reason: 'no_token' };

    upsertAttempted = true;
    await db.rpc('upsert_my_native_device_token', {
      p_token: token,
      p_apns_environment: apnsEnvironment,
    });
    if (!isNativeEnrollmentCurrent(enrollmentGeneration)) {
      if (latestNativePushEnrollment === enrollmentAttempt) {
        await cleanCancelledNativeEnrollment(
          db,
          token,
          { deleteServer: true },
        );
      }
      return { ok: false, reason: 'cancelled' };
    }

    if (!persistBoundToken(token)) {
      await cleanLateNativeServerBinding(db, token);
      await unregisterAndClear();
      return { ok: false, reason: 'storage_unavailable' };
    }

    return { ok: true, token };
  } catch (error) {
    if (!isNativeEnrollmentCurrent(enrollmentGeneration)) {
      if (latestNativePushEnrollment === enrollmentAttempt) {
        await cleanCancelledNativeEnrollment(
          db,
          token,
          { deleteServer: upsertAttempted },
        );
      }
      return { ok: false, reason: 'cancelled' };
    }
    // A token registered with APNs but not verified as bound to this employee
    // must never remain locally deliverable. This also covers an offline
    // response while an older owner binding may still exist server-side.
    const ownershipConflict = isOwnershipConflict(error);
    if (upsertAttempted && token && !ownershipConflict) {
      await cleanLateNativeServerBinding(db, token);
    }
    await unregisterAndClear();
    if (ownershipConflict) {
      console.warn('Push registration refused: token ownership conflict');
      return { ok: false, reason: 'ownership_conflict' };
    }

    // Push is additive: login still succeeds when APNs or its database binding
    // is unavailable.
    console.warn('Push registration skipped:', error?.message || error);
    return { ok: false, reason: error?.message || 'unknown' };
  }
}

/**
 * Remove the last successful native binding while the authenticated database
 * client still has the old account's session. Local delivery is revoked and
 * local state is cleared regardless of server cleanup outcome.
 */
export async function detachNativePushDevice(db, {
  storage = nativePushStorage(),
  timeoutMs = NATIVE_PUSH_DETACH_TIMEOUT_MS,
  ownerKey: suppliedOwnerKey = null,
} = {}) {
  // Invalidate first, before any server/native await. An enrollment that began
  // under the prior generation may finish its request, but it can no longer
  // persist local token state and will attempt to delete a late server row.
  nativePushEnrollmentGeneration += 1;
  const ownerKey = suppliedOwnerKey
    || readPwaOwnerLease(storage)?.owner
    || null;
  const durablePending = readPendingNativePushDetach(storage);
  const pendingMarkerInvalid = durablePending?.invalid === true;
  const pendingOwnerMismatch = !!durablePending
    && !pendingMarkerInvalid
    && (
      !validDetachOwner(ownerKey)
      || durablePending.ownerKey !== ownerKey
    );
  const boundToken = readBoundToken(storage);
  const token = (
    durablePending
    && !pendingMarkerInvalid
    && !pendingOwnerMismatch
    && durablePending.token
  ) || boundToken || pendingNativePushToken(db);
  const hadBinding = !!boundToken;
  const serverCallRequired = !!token || (
    !!durablePending
    && !pendingMarkerInvalid
  );
  let serverCallAttempted = false;
  let serverDetached = !serverCallRequired
    && !pendingMarkerInvalid
    && !pendingOwnerMismatch;
  let markerPersisted = !token;
  if (token && !pendingOwnerMismatch && !pendingMarkerInvalid) {
    markerPersisted = writePendingNativePushDetach(storage, {
      ownerKey,
      token,
      localDetached: durablePending?.localDetached === true,
    });
  }

  if (token && canRememberServerDetach(db)) {
    pendingNativePushServerDetaches.set(db, token);
  }
  if (
    token
    && !pendingOwnerMismatch
    && !pendingMarkerInvalid
    && typeof db?.rpc === 'function'
  ) {
    serverCallAttempted = true;
    try {
      // Void resolution is success, including an already-missing row. The
      // authored S1h contract raises for a foreign owner; timeout/denial also
      // reject and retain the token for a same-client retry.
      await withDeadline(
        db.rpc('delete_my_native_device_token', { p_token: token }),
        timeoutMs,
        'native push server detach',
      );
      serverDetached = true;
      if (canRememberServerDetach(db)) {
        pendingNativePushServerDetaches.delete(db);
      }
    } catch {
      serverDetached = false;
    }
  }

  const local = await unregisterAndClear({ storage, timeoutMs });
  const localDetached = local.localDetached
    && local.localStateCleared;
  let markerCleared = !durablePending && !markerPersisted;
  if (
    serverDetached
    && !pendingOwnerMismatch
    && !pendingMarkerInvalid
  ) {
    markerCleared = clearPendingNativePushDetach(storage);
  } else if (token && !pendingOwnerMismatch && !pendingMarkerInvalid) {
    markerPersisted = writePendingNativePushDetach(storage, {
      ownerKey,
      token,
      localDetached,
    });
  } else if (
    durablePending
    && !pendingMarkerInvalid
    && pendingOwnerMismatch
  ) {
    markerPersisted = writePendingNativePushDetach(storage, {
      ownerKey: durablePending.ownerKey,
      token: durablePending.token,
      localDetached,
    });
  }

  const ready = !pendingMarkerInvalid
    && !pendingOwnerMismatch
    && serverDetached
    && local.localDetached
    && local.localStateCleared
    && markerCleared;
  return {
    ok: ready,
    ready,
    hadBinding,
    hadServerBinding: serverCallRequired,
    serverDetached,
    serverCallRequired,
    serverCallAttempted,
    serverCallSucceeded: serverDetached,
    markerPersisted,
    markerCleared,
    pendingOwnerMismatch,
    pendingMarkerInvalid,
    ...local,
  };
}

export async function retryPendingNativePushDetach(db, options = {}) {
  const storage = options.storage === undefined
    ? nativePushStorage()
    : options.storage;
  const pending = readPendingNativePushDetach(storage);
  if (!pending) {
    return {
      ok: true,
      ready: true,
      pending: false,
      pendingOwnerMismatch: false,
      pendingMarkerInvalid: false,
    };
  }
  const result = await detachNativePushDevice(db, {
    ...options,
    storage,
  });
  return {
    ...result,
    pending: true,
  };
}
