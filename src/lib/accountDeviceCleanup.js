/**
 * ════════════════════════════════════════════════
 * FILE: accountDeviceCleanup.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the shared device cleanup used before logout, rejected-account
 *   handling, and native biometric revocation. It stops account-owned offline
 *   work synchronously, detaches Web/APNs delivery while the old session still
 *   exists, clears account-owned browser state, and disables the push worker.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  nativeBiometric, pushNotifications, pwaAccountState,
 *              pwaServiceWorker, registerSW, webPushClient
 *   Data:      deletes only the current device's push bindings through reviewed
 *              RPCs; clears account-owned local browser state
 *
 * NOTES / GOTCHAS:
 *   - This helper never signs out, navigates, reloads, applies migrations, or
 *     contacts a provider. The caller owns sign-out and any post-sign-out reset.
 *   - `clearPwaAccountState()` is invoked before this function's first await;
 *     its synchronous suspension boundary prevents an old offline runner or
 *     query persister from starting more work during cleanup.
 *   - Web/native detach results are not collapsed into best-effort success.
 *     Unknown lookup state or incomplete server/local detach keeps `ready`
 *     false so a new account cannot inherit uncertain device state.
 *   - Owner-bound pending-detach journals survive reload/crash. A mismatched
 *     account may revoke local delivery but cannot consume or relabel the
 *     prior owner's server cleanup proof.
 *   - `deferrable` (owner decision 2026-07-29) marks the one failure shape an
 *     explicit sign-out may complete through visually: every local leg clean
 *     and the only residual is push server work positively covered by a
 *     same-owner journal marker. Foreign-owner, invalid-marker, in-flight
 *     enrollment, unknown local subscription state, or any non-push failure
 *     is never deferrable. The bind-time gate in AuthContext (handleAuthUser →
 *     retryPendingAccountPushDetaches) stays the enforcement point before any
 *     account publishes again.
 *   - Known limit (pre-existing single-slot journal): each channel keeps ONE
 *     pending-detach marker and the detach prefers the marker's stale
 *     token/endpoint identity over the live one, so after a token rotation
 *     the journal may cover the stale row while a live row goes unjournaled.
 *     `residualJournaled` proves a same-owner journal exists, not that it
 *     names every row this session ever bound — the composite ready path has
 *     always had the same limit.
 * ════════════════════════════════════════════════
 */

import { setBiometricEnabled } from './nativeBiometric.js';
import {
  detachNativePushDevice,
  retryPendingNativePushDetach,
} from './pushNotifications.js';
import { clearPwaAccountState } from './pwaAccountState.js';
import { reconcilePushServiceWorker } from './pwaServiceWorker.js';
import { WEB_PUSH_FLAG_MIRROR_KEY } from './registerSW.js';
import {
  detachWebPushDevice,
  retryPendingWebPushDetach,
} from './webPushClient.js';

// Bounded silent auto-retry window for the journaled-transient sign-out case
// (owner decision 2026-07-29): retry the push detach legs with backoff before
// any blocking UI. Each attempt is additionally bounded by the detach RPCs'
// own 5s deadlines, so the worst case is ~13s of ordinary loading state.
export const ACCOUNT_CLEANUP_TRANSIENT_RETRY_WINDOW_MS = 10_000;
export const ACCOUNT_CLEANUP_TRANSIENT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function defaultDelay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function browserIsOnline() {
  try {
    return globalThis.navigator?.onLine !== false;
  } catch {
    return true;
  }
}

export function disableWebPushPolicyMirror(storage = browserStorage()) {
  try {
    storage?.setItem(WEB_PUSH_FLAG_MIRROR_KEY, '0');
    return !!storage;
  } catch {
    return false;
  }
}

function webServerDetached(result) {
  return !!result
    && result.lookupStatus !== 'unknown'
    && result.serverDetached === true;
}

function nativeServerDetached(result) {
  return !!result
    && result.serverDetached === true;
}

// Deferral predicates (fail closed). A channel qualifies only when it is fully
// ready, or when local delivery was revoked in THIS session and the residual
// server work is positively covered by a same-owner journal marker re-read
// from storage (`residualJournaled` — never the weaker markerPersisted).
function webChannelSettledOrJournaled(result) {
  if (result?.ready === true) return true;
  return !!result
    && result.pendingOwnerMismatch !== true
    && result.pendingMarkerInvalid !== true
    && result.lookupStatus !== 'unknown'
    && result.localDetached === true
    && result.residualJournaled === true;
}

function nativeChannelSettledOrJournaled(result) {
  if (result?.ready === true) return true;
  return !!result
    && result.pendingOwnerMismatch !== true
    && result.pendingMarkerInvalid !== true
    && result.enrollmentPending !== true
    && result.localDetached === true
    && result.localStateCleared === true
    && result.residualJournaled === true;
}

/**
 * Invalidate both enrollment generations immediately, then detach their
 * server rows before each implementation revokes local delivery.
 */
export async function detachAccountPushDevices(
  db,
  {
    detachWeb = detachWebPushDevice,
    detachNative = detachNativePushDevice,
    ownerKey = null,
    storage = browserStorage(),
  } = {},
) {
  // Both calls execute synchronously through their generation invalidation
  // before Promise.all begins awaiting either network/native operation.
  const webPromise = detachWeb(db, { ownerKey, storage });
  const nativePromise = detachNative(db, { ownerKey, storage });
  const [webSettled, nativeSettled] = await Promise.allSettled([
    webPromise,
    nativePromise,
  ]);
  const web = webSettled.status === 'fulfilled'
    ? webSettled.value
    : { ok: false, error: webSettled.reason };
  const native = nativeSettled.status === 'fulfilled'
    ? nativeSettled.value
    : { ok: false, error: nativeSettled.reason };
  const serverDetached = webServerDetached(web)
    && nativeServerDetached(native);
  const localDetached = web?.localDetached === true
    && native?.localDetached === true
    && native?.localStateCleared === true;
  const ready = serverDetached && localDetached;
  const deferrable = !ready
    && webChannelSettledOrJournaled(web)
    && nativeChannelSettledOrJournaled(native);

  return {
    ok: ready,
    ready,
    deferrable,
    serverDetached,
    localDetached,
    web,
    native,
  };
}

/**
 * Retry only durable push-detach journals before publishing an authenticated
 * account. A marker owned by another opaque PWA principal remains intact while
 * local delivery is revoked and the caller moves to previous-account recovery.
 */
export async function retryPendingAccountPushDetaches(
  db,
  {
    ownerKey,
    storage = browserStorage(),
    retryWeb = retryPendingWebPushDetach,
    retryNative = retryPendingNativePushDetach,
  } = {},
) {
  const [webSettled, nativeSettled] = await Promise.allSettled([
    retryWeb(db, { ownerKey, storage }),
    retryNative(db, { ownerKey, storage }),
  ]);
  const web = webSettled.status === 'fulfilled'
    ? webSettled.value
    : { ready: false, error: webSettled.reason };
  const native = nativeSettled.status === 'fulfilled'
    ? nativeSettled.value
    : { ready: false, error: nativeSettled.reason };
  const ownerMismatch = web?.pendingOwnerMismatch === true
    || native?.pendingOwnerMismatch === true;
  const markerInvalid = web?.pendingMarkerInvalid === true
    || native?.pendingMarkerInvalid === true;
  const ready = web?.ready === true
    && native?.ready === true
    && !ownerMismatch
    && !markerInvalid;

  return {
    ok: ready,
    ready,
    ownerMismatch,
    markerInvalid,
    pending: web?.pending === true || native?.pending === true,
    web,
    native,
  };
}

/**
 * Clear the current account's device state without signing out or navigating.
 * `reloadRequired` is advisory and must be acted on only after sign-out succeeds.
 */
export async function cleanupAccountDeviceState(
  db,
  {
    disableBiometric = true,
    clearCaches = false,
    ownerKey = null,
    storage = browserStorage(),
    transientPushRetry = false,
    dependencies = {},
  } = {},
) {
  const setBiometric = dependencies.setBiometric || setBiometricEnabled;
  const clearAccountState = dependencies.clearAccountState
    || clearPwaAccountState;
  const reconcileWorker = dependencies.reconcileWorker
    || reconcilePushServiceWorker;
  const detachPush = dependencies.detachPush
    || ((client) => detachAccountPushDevices(client, {
      ...dependencies,
      ownerKey,
      storage,
    }));
  const disableMirror = dependencies.disableMirror
    || disableWebPushPolicyMirror;

  let biometricCleared = !disableBiometric;
  if (disableBiometric) {
    try {
      biometricCleared = setBiometric(false) !== false;
    } catch {
      biometricCleared = false;
    }
  }

  // Clear the pre-auth policy before any async gap. The account-state call
  // synchronously suspends offline/query writers before it begins awaiting.
  const mirrorCleared = disableMirror(storage);
  let accountStatePromise;
  try {
    accountStatePromise = clearAccountState({
      storage,
      pushCleanup: () => detachPush(db),
    });
  } catch (error) {
    accountStatePromise = Promise.reject(error);
  }

  let accountState;
  try {
    accountState = await accountStatePromise;
  } catch (error) {
    accountState = {
      ready: false,
      reason: 'account-state-cleanup-failed',
      error,
    };
  }

  let worker;
  try {
    worker = await reconcileWorker(false, { clearCaches });
  } catch (error) {
    worker = {
      ok: false,
      reason: 'service-worker-cleanup-failed',
      error,
    };
  }

  let ready = biometricCleared
    && accountState?.ready === true
    && worker?.ok === true
    && mirrorCleared;
  // Deferrable only when push server residual is the SOLE failure: every
  // local leg here is clean and the account-state layer classified its own
  // failure as journaled push residual.
  let deferrable = !ready
    && biometricCleared
    && mirrorCleared
    && worker?.ok === true
    && accountState?.deferrable === true;

  let pushRetryAttempts = 0;
  let pushRetryEscalated = false;
  if (!ready && deferrable && transientPushRetry) {
    const retryPush = dependencies.retryPush
      || ((client) => retryPendingAccountPushDetaches(client, {
        ...dependencies,
        ownerKey,
        storage,
      }));
    const wait = dependencies.delay || defaultDelay;
    const isOnline = dependencies.isOnline || browserIsOnline;
    const now = dependencies.now || Date.now;
    const windowMs = dependencies.retryWindowMs
      || ACCOUNT_CLEANUP_TRANSIENT_RETRY_WINDOW_MS;
    const delaysMs = dependencies.retryDelaysMs
      || ACCOUNT_CLEANUP_TRANSIENT_RETRY_DELAYS_MS;
    // A channel that was already fully ready may legitimately report
    // pending:false on retry. A channel that had journaled residual must
    // report pending:true (its journal was found and reprocessed) until a
    // retry we observed settles it — a vanished journal under a residual
    // channel means the durable memory is gone, so escalate to the wall.
    // Accepted consequence: a concurrent same-owner tab that reconciles and
    // clears the journal during this window ALSO escalates (a false wall on
    // a clean device, resolved by its Retry re-running logout with no marker
    // left). Deliberate — never loosen this into laundering a journal that
    // genuinely vanished.
    let webSettled = accountState?.pushWebSettled === true;
    let nativeSettled = accountState?.pushNativeSettled === true;
    const startedAt = now();
    for (const delayMs of delaysMs) {
      if (!isOnline()) break;
      if ((now() - startedAt) + delayMs > windowMs) break;
      await wait(delayMs);
      pushRetryAttempts += 1;
      let retry;
      try {
        retry = await retryPush(db);
      } catch (error) {
        retry = { ready: false, error };
      }
      if (
        retry?.ownerMismatch === true
        || retry?.markerInvalid === true
        || (!webSettled && retry?.web?.pending !== true)
        || (!nativeSettled && retry?.native?.pending !== true)
      ) {
        deferrable = false;
        pushRetryEscalated = true;
        break;
      }
      if (retry?.web?.ready === true) webSettled = true;
      if (retry?.native?.ready === true) nativeSettled = true;
      if (retry?.ready === true) {
        // Deferrable guaranteed push was the only failing leg, so a settled
        // push retry makes the composite state genuinely ready.
        ready = true;
        deferrable = false;
        accountState = {
          ...accountState,
          ready: true,
          serverPushCleared: true,
          localPushCleared: true,
          pushCleanupReady: true,
          deferrable: false,
          reason: null,
        };
        break;
      }
    }
  }

  return {
    ready,
    deferrable,
    pushRetryAttempts,
    pushRetryEscalated,
    biometricCleared,
    mirrorCleared,
    accountState,
    worker,
    reloadRequired: worker?.reloadRequired === true,
  };
}
