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
 *   Internal:  nativeNavigationTarget.js; callers pass the authenticated database client
 *   Data:      writes → device_tokens through upsert_my_native_device_token
 *                       and delete_my_native_device_token
 *
 * NOTES / GOTCHAS:
 *   - Enrollment is fail-closed. VITE_NATIVE_PUSH_ENABLED must be exactly
 *     "true" and VITE_APNS_ENV must be exactly "sandbox" or "production" in
 *     the reviewed native build; missing or malformed values stay off.
 *   - The user preference is bound to the verified local owner lease. A
 *     different account on the same phone always defaults off. A legacy
 *     boolean migrates on only when the current owner also has a local binding.
 *   - The binding key stores only the APNs token. A pending-detach journal adds
 *     only an opaque PWA-owner fingerprint and local-cleanup proof so a crash
 *     cannot let another account relabel or consume the prior owner's token.
 *   - Detach is bounded and reports ready only after both the owner-scoped
 *     server delete and local unregister/cleanup succeed. Local cleanup is
 *     still attempted when the database is offline or denies the request.
 *   - Foreground delivery never auto-navigates or forwards notification copy.
 *     A user tap/action must match the current employee's opaque recipient
 *     binding and pass the canonical native-route resolver.
 * ════════════════════════════════════════════════
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { resolveNativeNavigationTarget } from './nativeNavigationTarget.js';
import { readPwaOwnerLease } from './resumeRestore.js';

export const NATIVE_PUSH_BINDING_KEY = 'upr:native-push-binding:v1';
export const NATIVE_PUSH_USER_ENABLED_KEY =
  'upr:native-push-user-enabled:v1';
export const NATIVE_PUSH_PENDING_DETACH_KEY =
  'upr:native-push-pending-detach:v1';
export const NATIVE_PUSH_DETACH_TIMEOUT_MS = 5_000;
export const NATIVE_PUSH_PROVISIONAL_RECONCILE_MS = 60_000;

const NATIVE_PUSH_REGISTRATION_TIMEOUT_MS = 15_000;
const NATIVE_PUSH_MARKER_PROVISIONAL = 'enrolling_provisional';
const NATIVE_PUSH_MARKER_CONFIRMED = 'bound_cleanup';
const NATIVE_PUSH_PREFERENCE_VERSION = 2;
const NATIVE_PUSH_FOREIGN_OWNER_MESSAGE =
  'NOT_AUTHORIZED: device token belongs to another employee';
let nativePushEnrollmentGeneration = 0;
let nativePushEnrollmentSequence = 0;
let latestNativePushEnrollment = 0;
let nativePushEnrollmentInFlight = null;
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
    const legacy = marker?.version === 1;
    const phase = legacy
      ? NATIVE_PUSH_MARKER_CONFIRMED
      : marker?.phase;
    const createdAt = legacy ? 0 : marker?.createdAt;
    if (
      (!legacy && marker?.version !== 2)
      || !validDetachOwner(marker.ownerKey)
      || typeof marker.token !== 'string'
      || !marker.token.trim()
      || marker.token.length > 4_096
      || typeof marker.localDetached !== 'boolean'
      || (
        phase !== NATIVE_PUSH_MARKER_PROVISIONAL
        && phase !== NATIVE_PUSH_MARKER_CONFIRMED
      )
      || !Number.isFinite(createdAt)
      || createdAt < 0
    ) {
      return { invalid: true };
    }
    return {
      ...marker,
      createdAt,
      phase,
    };
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
    phase = NATIVE_PUSH_MARKER_CONFIRMED,
    createdAt = Date.now(),
  },
) {
  if (
    !storage
    || !validDetachOwner(ownerKey)
    || typeof token !== 'string'
    || !token.trim()
    || token.length > 4_096
    || (
      phase !== NATIVE_PUSH_MARKER_PROVISIONAL
      && phase !== NATIVE_PUSH_MARKER_CONFIRMED
    )
    || !Number.isFinite(createdAt)
    || createdAt < 0
  ) {
    return false;
  }
  try {
    const serialized = JSON.stringify({
      version: 2,
      ownerKey,
      token,
      localDetached: localDetached === true,
      phase,
      createdAt,
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

export function isNativePushUserEnabled(
  storage = nativePushStorage(),
  ownerKey = null,
) {
  if (!storage || !validDetachOwner(ownerKey)) return false;
  try {
    const value = storage.getItem(NATIVE_PUSH_USER_ENABLED_KEY);
    if (value && value !== 'true' && value !== 'false') {
      const record = JSON.parse(value);
      return (
        record?.version === NATIVE_PUSH_PREFERENCE_VERSION
        && record.ownerKey === ownerKey
        && record.enabled === true
      );
    }
    if (value === 'false') return false;
    // Migration-safe default: a legacy true/missing value migrates only when
    // the current verified owner also has a local approved binding. A shared
    // device can therefore never carry another account's true value forward.
    if (!hasNativePushDeviceBinding(storage)) return false;
    return setNativePushUserEnabled(true, storage, ownerKey);
  } catch {
    // If storage cannot prove the user's preference, automatic enrollment must
    // not silently override a prior opt-out.
    return false;
  }
}

export function setNativePushUserEnabled(
  enabled,
  storage = nativePushStorage(),
  ownerKey = null,
) {
  if (!storage || !validDetachOwner(ownerKey)) return false;
  const value = JSON.stringify({
    version: NATIVE_PUSH_PREFERENCE_VERSION,
    ownerKey,
    enabled: enabled === true,
  });
  try {
    storage.setItem(NATIVE_PUSH_USER_ENABLED_KEY, value);
    return storage.getItem(NATIVE_PUSH_USER_ENABLED_KEY) === value;
  } catch {
    return false;
  }
}

export function hasNativePushDeviceBinding(storage = nativePushStorage()) {
  return !!readBoundToken(storage);
}

/**
 * Sanitized device status for Settings. Never returns the APNs token or reads
 * server rows; it combines build capability, durable user intent, the local
 * verified-binding marker, pending cleanup, and current iOS permission.
 */
export async function getNativePushStatus({
  storage = nativePushStorage(),
  timeoutMs = NATIVE_PUSH_DETACH_TIMEOUT_MS,
  ownerKey = null,
} = {}) {
  const native = canRegisterPush();
  const available = native && isNativePushEnrollmentEnabled();
  const intentEnabled = isNativePushUserEnabled(storage, ownerKey);
  const bound = hasNativePushDeviceBinding(storage);
  const pending = !!readPendingNativePushDetach(storage);
  let permission = native ? 'unknown' : 'unavailable';
  if (native) {
    try {
      const result = await withDeadline(
        PushNotifications.checkPermissions(),
        timeoutMs,
        'native push permission check',
      );
      permission = typeof result?.receive === 'string'
        ? result.receive
        : 'unknown';
    } catch {
      permission = 'unknown';
    }
  }
  return {
    available,
    bound,
    enabled: (
      available
      && intentEnabled
      && bound
      && !pending
      && permission === 'granted'
    ),
    intentEnabled,
    native,
    pending,
    permission,
  };
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

function isForeignTokenOwnershipConflict(error) {
  let body = error?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return body.code === '42501'
    && body.message === NATIVE_PUSH_FOREIGN_OWNER_MESSAGE;
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
    try {
      await withDeadline(
        PushNotifications.removeAllDeliveredNotifications?.(),
        timeoutMs,
        'native push delivered notification cleanup',
      );
    } catch {
      // Removing already-delivered banners is defense in depth. The binding
      // remains detached even if iOS refuses this optional cleanup.
    }
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
  {
    deleteServer = false,
    storage = nativePushStorage(),
  } = {},
) {
  if (deleteServer) {
    await cleanLateNativeServerBinding(db, token);
  }
  await unregisterAndClear({ storage });
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

function nativePushRecipientCandidates(action) {
  const data = action?.notification?.data;
  const candidates = [
    data?.recipient,
    data?.data?.recipient,
  ].filter((value) => typeof value === 'string');
  return [...new Set(candidates)];
}

export async function nativePushRecipientBinding(employeeId) {
  if (typeof employeeId !== 'string' || !employeeId.trim()) return null;
  try {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`native-recipient:${employeeId}`),
    ));
    const bytes = digest.slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  } catch {
    return null;
  }
}

/**
 * Extract one reviewed route from a notification tap/action only when its
 * opaque server-derived recipient binding matches the current employee.
 */
export async function resolveNativePushActionTarget(action, {
  employeeId = null,
} = {}) {
  if (
    typeof action?.actionId !== 'string'
    || !action.actionId
    || action.actionId === 'dismiss'
  ) {
    return null;
  }

  const candidates = nativePushActionCandidates(action);
  if (candidates.length !== 1) return null;
  const recipientCandidates = nativePushRecipientCandidates(action);
  if (recipientCandidates.length !== 1) return null;
  const expectedRecipient = await nativePushRecipientBinding(employeeId);
  if (
    !expectedRecipient
    || recipientCandidates[0] !== expectedRecipient
  ) return null;
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
  employeeId = null,
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
        async (action) => {
          if (!active) return;
          const target = await resolveNativePushActionTarget(action, {
            employeeId,
          });
          if (!active || !target) return;
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
export async function registerPushForEmployee(db, employeeId, {
  storage = nativePushStorage(),
  ownerKey: suppliedOwnerKey = null,
} = {}) {
  if (!canRegisterPush()) return { ok: false, reason: 'not_native' };
  if (import.meta.env?.VITE_NATIVE_PUSH_ENABLED !== 'true') {
    return { ok: false, reason: 'native_push_disabled' };
  }
  const apnsEnvironment = nativeApnsEnvironment();
  if (!apnsEnvironment) {
    return { ok: false, reason: 'native_push_misconfigured' };
  }
  if (!employeeId) return { ok: false, reason: 'no_employee' };
  const ownerKey = suppliedOwnerKey
    || readPwaOwnerLease(storage)?.owner
    || null;
  if (!validDetachOwner(ownerKey)) {
    return { ok: false, reason: 'owner_unavailable' };
  }
  if (!isNativePushUserEnabled(storage, ownerKey)) {
    return { ok: false, reason: 'user_disabled' };
  }

  if (nativePushEnrollmentInFlight) {
    if (nativePushEnrollmentInFlight.ownerKey === ownerKey) {
      return nativePushEnrollmentInFlight.promise;
    }
    return { ok: false, reason: 'enrollment_in_progress' };
  }
  if (readPendingNativePushDetach(storage)) {
    return { ok: false, reason: 'cleanup_pending' };
  }

  const enrollmentPromise = performNativePushRegistration(
    db,
    { storage, ownerKey, apnsEnvironment },
  );
  nativePushEnrollmentInFlight = {
    ownerKey,
    promise: enrollmentPromise,
  };
  try {
    return await enrollmentPromise;
  } finally {
    if (nativePushEnrollmentInFlight?.promise === enrollmentPromise) {
      nativePushEnrollmentInFlight = null;
      const pending = readPendingNativePushDetach(storage);
      if (
        pending
        && pending.invalid !== true
        && pending.ownerKey === ownerKey
      ) {
        await detachNativePushDevice(db, { storage, ownerKey });
      }
    }
  }
}

async function performNativePushRegistration(
  db,
  { storage, ownerKey, apnsEnvironment },
) {
  const enrollmentGeneration = nativePushEnrollmentGeneration;
  const enrollmentAttempt = ++nativePushEnrollmentSequence;
  latestNativePushEnrollment = enrollmentAttempt;
  let token = null;
  let upsertAttempted = false;
  const markerCreatedAt = Date.now();

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
        await cleanCancelledNativeEnrollment(db, token, { storage });
      }
      return { ok: false, reason: 'cancelled' };
    }
    if (!token) return { ok: false, reason: 'no_token' };

    if (!writePendingNativePushDetach(storage, {
      ownerKey,
      token,
      localDetached: false,
      phase: NATIVE_PUSH_MARKER_PROVISIONAL,
      createdAt: markerCreatedAt,
    })) {
      await unregisterAndClear({ storage });
      return { ok: false, reason: 'storage_unavailable' };
    }

    upsertAttempted = true;
    await db.rpc('upsert_my_native_device_token', {
      p_token: token,
      p_apns_environment: apnsEnvironment,
    });
    if (!writePendingNativePushDetach(storage, {
      ownerKey,
      token,
      localDetached: false,
      phase: NATIVE_PUSH_MARKER_CONFIRMED,
      createdAt: markerCreatedAt,
    })) {
      await unregisterAndClear({ storage });
      return { ok: false, reason: 'storage_unavailable' };
    }
    if (!isNativeEnrollmentCurrent(enrollmentGeneration)) {
      // The durable marker must survive until the possibly committed upsert
      // settles. registerPushForEmployee's outer finally performs the one
      // post-settlement owner-scoped delete before it clears that marker.
      return { ok: false, reason: 'cancelled' };
    }

    if (!persistBoundToken(token, storage)) {
      await unregisterAndClear({ storage });
      return { ok: false, reason: 'storage_unavailable' };
    }
    if (!clearPendingNativePushDetach(storage)) {
      await unregisterAndClear({ storage });
      return { ok: false, reason: 'storage_unavailable' };
    }

    return { ok: true, token };
  } catch (error) {
    if (!isNativeEnrollmentCurrent(enrollmentGeneration)) {
      if (latestNativePushEnrollment === enrollmentAttempt) {
        if (upsertAttempted) {
          // Leave the owner-bound marker intact until the outer finally can
          // issue a post-settlement delete. Local APNs delivery is still
          // revoked immediately.
          await unregisterAndClear({ storage });
        } else {
          await cleanCancelledNativeEnrollment(db, token, { storage });
        }
      }
      return { ok: false, reason: 'cancelled' };
    }
    // A token registered with APNs but not verified as bound to this employee
    // must never remain locally deliverable. This also covers an offline
    // response while an older owner binding may still exist server-side.
    const ownershipConflict = isForeignTokenOwnershipConflict(error);
    if (ownershipConflict) {
      // The database proved this token belongs to somebody else, so the
      // provisional current-owner marker must not relabel it into a cleanup
      // journal that the true owner can no longer consume.
      clearPendingNativePushDetach(storage);
      await unregisterAndClear({ storage });
    } else if (upsertAttempted && token) {
      // The upsert may have committed even if its response failed. Preserve
      // the marker and let the outer finally perform the definitive delete
      // after this request has settled.
      await unregisterAndClear({ storage });
    } else {
      await unregisterAndClear({ storage });
    }
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
  now = Date.now(),
} = {}) {
  // Invalidate first, before any server/native await. An enrollment that began
  // under the prior generation may finish its request, but it can no longer
  // persist local token state and will attempt to delete a late server row.
  nativePushEnrollmentGeneration += 1;
  const enrollmentPending = !!nativePushEnrollmentInFlight;
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
  const markerPhase = (
    durablePending
    && !pendingMarkerInvalid
    && durablePending.phase
  ) || NATIVE_PUSH_MARKER_CONFIRMED;
  const markerCreatedAt = (
    durablePending
    && !pendingMarkerInvalid
    && durablePending.createdAt
  ) || now;
  const provisionalMarker = (
    markerPhase === NATIVE_PUSH_MARKER_PROVISIONAL
  );
  const provisionalMature = !provisionalMarker || (
    now >= markerCreatedAt + NATIVE_PUSH_PROVISIONAL_RECONCILE_MS
  );
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
  let provisionalOwnershipCleared = false;
  let serverDetached = !serverCallRequired
    && !pendingMarkerInvalid
    && !pendingOwnerMismatch;
  let markerPersisted = !token;
  if (token && !pendingOwnerMismatch && !pendingMarkerInvalid) {
    markerPersisted = writePendingNativePushDetach(storage, {
      ownerKey,
      token,
      localDetached: durablePending?.localDetached === true,
      phase: markerPhase,
      createdAt: markerCreatedAt,
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
    } catch (error) {
      if (
        provisionalMarker
        && isForeignTokenOwnershipConflict(error)
      ) {
        // The provisional owner never acquired this token. A definitive
        // ownership refusal may clear this provisional journal without
        // relabeling or deleting the true owner's row.
        serverDetached = true;
        provisionalOwnershipCleared = true;
        if (canRememberServerDetach(db)) {
          pendingNativePushServerDetaches.delete(db);
        }
      } else {
        serverDetached = false;
      }
    }
  }

  const local = await unregisterAndClear({ storage, timeoutMs });
  const localDetached = local.localDetached
    && local.localStateCleared;
  let markerCleared = !durablePending && !markerPersisted;
  if (
    serverDetached
    && (
      provisionalOwnershipCleared
      || (!enrollmentPending && provisionalMature)
    )
    && !pendingOwnerMismatch
    && !pendingMarkerInvalid
  ) {
    markerCleared = clearPendingNativePushDetach(storage);
  } else if (token && !pendingOwnerMismatch && !pendingMarkerInvalid) {
    markerPersisted = writePendingNativePushDetach(storage, {
      ownerKey,
      token,
      localDetached,
      phase: markerPhase,
      createdAt: markerCreatedAt,
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
      phase: durablePending.phase,
      createdAt: durablePending.createdAt,
    });
  }

  const ready = !pendingMarkerInvalid
    && !pendingOwnerMismatch
    && !enrollmentPending
    && serverDetached
    && local.localDetached
    && local.localStateCleared
    && markerCleared;
  // Positive journal evidence for the caller's sign-out deferral decision:
  // re-read the marker AFTER every write/clear above. `markerPersisted` alone
  // is not proof (it initializes true when there was nothing to mark), so a
  // deferral must key on this field, never on markerPersisted.
  const residualMarker = readPendingNativePushDetach(storage);
  const residualJournaled = !!residualMarker
    && residualMarker.invalid !== true
    && validDetachOwner(ownerKey)
    && residualMarker.ownerKey === ownerKey;
  return {
    ok: ready,
    ready,
    enrollmentPending,
    residualJournaled,
    hadBinding,
    hadServerBinding: serverCallRequired,
    serverDetached,
    serverCallRequired,
    serverCallAttempted,
    serverCallSucceeded: serverDetached,
    provisionalMature,
    provisionalOwnershipCleared,
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

/**
 * User-initiated native enrollment. A pending owner-bound detach must finish
 * before a new token can be registered, and a failed attempt returns the
 * durable preference to off so a restart cannot silently retry against the
 * user's observed state.
 */
export async function enableNativePushForEmployee(db, employeeId, {
  storage = nativePushStorage(),
  ownerKey,
} = {}) {
  if (!setNativePushUserEnabled(true, storage, ownerKey)) {
    return { ok: false, reason: 'storage_unavailable' };
  }
  let result = await registerPushForEmployee(
    db,
    employeeId,
    { storage, ownerKey },
  );
  if (result.reason === 'cleanup_pending') {
    const cleanup = await retryPendingNativePushDetach(db, {
      storage,
      ownerKey,
    });
    if (cleanup.ready) {
      result = await registerPushForEmployee(
        db,
        employeeId,
        { storage, ownerKey },
      );
    }
  }
  if (!result.ok) {
    setNativePushUserEnabled(false, storage, ownerKey);
  }
  return result;
}

/**
 * User-initiated native opt-out. Preference is persisted before any await so
 * Auth bootstrap cannot re-enroll during a concurrent detach. Server and local
 * cleanup retain the existing bounded owner-scoped journal contract.
 */
export async function disableNativePushForDevice(db, {
  storage = nativePushStorage(),
  ownerKey,
} = {}) {
  const preferenceStored = setNativePushUserEnabled(
    false,
    storage,
    ownerKey,
  );
  const result = await detachNativePushDevice(db, {
    storage,
    ownerKey,
  });
  return {
    ...result,
    ok: preferenceStored && result.ready,
    ready: preferenceStored && result.ready,
    preferenceStored,
  };
}
