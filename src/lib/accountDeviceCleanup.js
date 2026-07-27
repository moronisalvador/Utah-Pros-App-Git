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

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
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

  return {
    ok: ready,
    ready,
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

  const ready = biometricCleared
    && accountState?.ready === true
    && worker?.ok === true
    && mirrorCleared;

  return {
    ready,
    biometricCleared,
    mirrorCleared,
    accountState,
    worker,
    reloadRequired: worker?.reloadRequired === true,
  };
}
