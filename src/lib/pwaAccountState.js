/**
 * ════════════════════════════════════════════════
 * FILE: pwaAccountState.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Coordinates a safe handoff of on-device PWA state between signed-in
 *   accounts. It stops the old offline sender immediately, blocks stale tabs,
 *   clears the prior account's readable state, and publishes a new opaque owner
 *   only when every required cleanup reports success.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  offlineDb, syncRunnerSingleton, techQuery, techQueryPersister,
 *              resumeRestore
 *   Data:      reads/writes → opaque localStorage owner/epoch markers; clears
 *                        owner-scoped browser state
 *
 * NOTES / GOTCHAS:
 *   - Web Push cleanup is injected by Auth so server detachment can happen
 *     before local unsubscribe. This module never unsubscribes a second time.
 *   - Pending offline work is preserved for its original owner. Successful
 *     all-store ownership inspection is what earns `queueQuarantined: true`.
 * ════════════════════════════════════════════════
 */

import { inspectOfflineOwnership } from './offlineDb.js';
import { suspendSyncRunner } from './syncRunnerSingleton.js';
import { clearTechQueryMemory } from './techQuery.js';
import {
  activateTechQueryPersistence,
  clearPersistedTechQueries,
  suspendTechQueryPersistence,
} from './techQueryPersister.js';
import {
  PWA_ACCOUNT_EPOCH_KEY,
  PWA_ACCOUNT_OWNER_KEY,
  PWA_ACCOUNT_TRANSITION_KEY,
  beginPwaOwnerTransition,
  clearOwnedDrafts,
  clearSavedRoute,
  finishPwaOwnerTransition,
  invalidatePwaOwnerLease,
  isPwaOwnerLeaseCurrent,
  readPwaOwnerLease,
  writePwaOwnerLease,
} from './resumeRestore.js';

export {
  PWA_ACCOUNT_EPOCH_KEY,
  PWA_ACCOUNT_OWNER_KEY,
  PWA_ACCOUNT_TRANSITION_KEY,
};

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function readRawOwner(storage) {
  try {
    return storage?.getItem(PWA_ACCOUNT_OWNER_KEY) || null;
  } catch {
    return null;
  }
}

function ownsTransition(storage, token) {
  try {
    return !!token
      && storage?.getItem(PWA_ACCOUNT_TRANSITION_KEY) === token;
  } catch {
    return false;
  }
}

/**
 * Produce a short opaque comparison token. When Web Crypto is unavailable,
 * return null so the account transition fails closed.
 */
export async function fingerprintPwaPrincipal(
  authUserId,
  employeeId,
  {
    subtle = globalThis.crypto?.subtle,
    TextEncoderImpl = globalThis.TextEncoder,
    encode = bytesToBase64Url,
  } = {},
) {
  if (!authUserId || !employeeId || !subtle || !TextEncoderImpl) return null;
  try {
    const source = new TextEncoderImpl().encode(
      `upr-pwa-owner-v1:${authUserId}:${employeeId}`,
    );
    const digest = new Uint8Array(await subtle.digest('SHA-256', source));
    return `v1.${encode(digest.slice(0, 18))}`;
  } catch {
    return null;
  }
}

/** Create a random login epoch/transition token without retaining identity. */
export function createPwaSessionEpoch({
  cryptoImpl = globalThis.crypto,
  prefix = 'e1',
} = {}) {
  try {
    if (cryptoImpl?.randomUUID) {
      return `${prefix}.${cryptoImpl.randomUUID()}`;
    }
    if (cryptoImpl?.getRandomValues) {
      const bytes = new Uint8Array(18);
      cryptoImpl.getRandomValues(bytes);
      return `${prefix}.${bytesToBase64Url(bytes)}`;
    }
  } catch {
    // Fall through to the fail-closed result.
  }
  return null;
}

function pushCleanupReadiness(result) {
  if (!result || typeof result !== 'object') {
    return {
      ready: false,
      serverDetached: false,
      localDetached: false,
    };
  }
  if (typeof result.ready === 'boolean') {
    return {
      ready: result.ready,
      serverDetached: result.serverDetached !== false && result.ready,
      localDetached: result.localDetached !== false && result.ready,
    };
  }
  const localDetached = result.localDetached === true;
  const serverDetached = result.hadSubscription === false
    || result.serverDetached === true;
  return {
    ready: result.ok !== false && localDetached && serverDetached,
    serverDetached,
    localDetached,
  };
}

async function runPushCleanup(pushCleanup) {
  if (!pushCleanup) return pushCleanupReadiness(null);
  try {
    const result = typeof pushCleanup === 'function'
      ? await pushCleanup()
      : await pushCleanup;
    return {
      ...pushCleanupReadiness(result),
      result,
    };
  } catch (error) {
    return {
      ready: false,
      serverDetached: false,
      localDetached: false,
      error,
    };
  }
}

async function inspectDurableState(inspect, owner) {
  try {
    const result = await inspect(owner);
    return {
      ready: result?.ready === true && result?.quarantined === true,
      result,
    };
  } catch (error) {
    return { ready: false, result: null, error };
  }
}

async function clearOwnedState({
  previousLease,
  nextOwner,
  pushCleanup,
  cleanup = {},
}) {
  const clearMemory = cleanup.clearMemory || clearTechQueryMemory;
  const clearPersisted = cleanup.clearPersisted || clearPersistedTechQueries;
  const clearRoute = cleanup.clearRoute || clearSavedRoute;
  const clearDrafts = cleanup.clearDrafts || clearOwnedDrafts;
  const inspect = cleanup.inspectOffline
    || cleanup.inspectQueue
    || inspectOfflineOwnership;

  let memoryCleared = false;
  try {
    memoryCleared = clearMemory() !== false;
  } catch {
    memoryCleared = false;
  }

  let routeCleared = false;
  try {
    routeCleared = clearRoute(previousLease) !== false;
  } catch {
    routeCleared = false;
  }

  // PRIV-01: drafts are durable business/customer text. They must not survive
  // an account switch, including drafts written under the pre-ownership keys.
  let draftsCleared = false;
  try {
    draftsCleared = clearDrafts(previousLease) !== false;
  } catch {
    draftsCleared = false;
  }

  const [persisted, queue, push] = await Promise.all([
    Promise.resolve()
      .then(() => clearPersisted(previousLease))
      .then((value) => ({ ready: value !== false }))
      .catch((error) => ({ ready: false, error })),
    inspectDurableState(inspect, nextOwner),
    runPushCleanup(pushCleanup || cleanup.pushCleanup),
  ]);

  const ready = (
    memoryCleared
    && routeCleared
    && draftsCleared
    && persisted.ready
    && queue.ready
    && push.ready
  );

  return {
    ready,
    memoryCleared,
    persistedCleared: persisted.ready,
    routeCleared,
    draftsCleared,
    serverPushCleared: push.serverDetached,
    localPushCleared: push.localDetached,
    pushCleanupReady: push.ready,
    // Granular facts for the sign-out deferral decision (decided only in
    // clearPwaAccountState — the bind path never defers). `deferrable` on the
    // raw push result is computed by detachAccountPushDevices from positive
    // journal evidence; the per-channel settled flags let the caller's
    // bounded retry distinguish "was already clean" from "journal vanished".
    pushCleanupDeferrable: push.ready !== true
      && push.result?.deferrable === true,
    pushWebSettled: push.result?.web?.ready === true,
    pushNativeSettled: push.result?.native?.ready === true,
    queueQuarantined: queue.ready,
    queue: queue.result,
  };
}

/**
 * Resolve the immutable lease for the supplied verified Auth/employee pair.
 * A stale tab receives null as soon as another tab begins a transition.
 */
export async function resolveVerifiedPwaOwnerLease({
  authUserId,
  employeeId,
  storage = browserStorage(),
  fingerprint = fingerprintPwaPrincipal,
} = {}) {
  const owner = await fingerprint(authUserId, employeeId).catch(() => null);
  const lease = readPwaOwnerLease(storage);
  if (!owner || !lease || lease.owner !== owner) return null;
  return isPwaOwnerLeaseCurrent(lease, storage) ? lease : null;
}

/**
 * Reconcile account-owned browser state before Auth publishes the employee.
 * `pushCleanup` must perform server detach first and local unsubscribe second,
 * or be the already-resolved result of that operation.
 */
export async function reconcilePwaAccountOwner({
  authUserId,
  employeeId,
  storage = browserStorage(),
  fingerprint = fingerprintPwaPrincipal,
  createEpoch = createPwaSessionEpoch,
  pushCleanup,
  cleanup,
} = {}) {
  // These calls happen before the first await. An old runner cannot start the
  // next item while Web Push/native/auth cleanup is still in progress.
  const runner = suspendSyncRunner();
  suspendTechQueryPersistence();

  const previousLease = readPwaOwnerLease(storage);
  const previousOwner = readRawOwner(storage);
  const transitionToken = createEpoch({ prefix: 't1' });
  const transitionStarted = beginPwaOwnerTransition(
    transitionToken,
    storage,
  );
  if (!transitionStarted) {
    return {
      ready: false,
      changed: true,
      owner: null,
      previousOwner,
      ownerVerified: false,
      legacyState: !previousLease,
      queueQuarantined: false,
      runnerSuspended: runner.suspended,
      reason: 'transition-marker-unavailable',
    };
  }

  let nextOwner = null;
  try {
    nextOwner = await fingerprint(authUserId, employeeId);
  } catch {
    nextOwner = null;
  }

  const ownerVerified = !!nextOwner;
  const sameOwner = !!previousLease
    && ownerVerified
    && previousLease.owner === nextOwner;

  if (!ownsTransition(storage, transitionToken)) {
    return {
      ready: false,
      changed: true,
      owner: null,
      requestedOwner: nextOwner,
      previousOwner,
      ownerVerified,
      legacyState: !previousLease,
      queueQuarantined: false,
      runnerSuspended: runner.suspended,
      reason: 'transition-superseded',
    };
  }

  if (sameOwner) {
    const queue = await inspectDurableState(
      cleanup?.inspectOffline
        || cleanup?.inspectQueue
        || inspectOfflineOwnership,
      nextOwner,
    );
    const transitionFinished = finishPwaOwnerTransition(
      transitionToken,
      storage,
    );
    const leaseCurrent = transitionFinished
      && isPwaOwnerLeaseCurrent(previousLease, storage);
    const persistenceActive = leaseCurrent
      && activateTechQueryPersistence(previousLease);
    const ready = queue.ready && persistenceActive;
    if (!ready && transitionFinished) {
      invalidatePwaOwnerLease(storage);
      suspendTechQueryPersistence();
    }
    return {
      ready,
      changed: false,
      owner: ready ? nextOwner : null,
      previousOwner,
      ownerVerified,
      legacyState: false,
      lease: ready ? previousLease : null,
      queueQuarantined: queue.ready,
      queue: queue.result,
      runnerSuspended: runner.suspended,
    };
  }

  // Invalidate device-wide visibility before any asynchronous cleanup. The
  // transition marker already stopped guarded writers in every open tab.
  invalidatePwaOwnerLease(storage);
  const cleanupResult = await clearOwnedState({
    previousLease,
    nextOwner,
    pushCleanup,
    cleanup,
  });

  if (!ownerVerified || !cleanupResult.ready) {
    if (ownsTransition(storage, transitionToken)) {
      invalidatePwaOwnerLease(storage);
      finishPwaOwnerTransition(transitionToken, storage);
    }
    return {
      ...cleanupResult,
      ready: false,
      // The bind path NEVER defers: a new owner publishes only behind a fully
      // ready cleanup, regardless of how sign-out was allowed to complete.
      deferrable: false,
      changed: true,
      owner: null,
      requestedOwner: nextOwner,
      previousOwner,
      ownerVerified,
      legacyState: !previousLease,
      lease: null,
      runnerSuspended: runner.suspended,
      reason: !ownerVerified ? 'owner-unverified' : 'cleanup-incomplete',
    };
  }

  const nextEpoch = createEpoch({ prefix: 'e1' });
  const nextLease = nextEpoch ? { owner: nextOwner, epoch: nextEpoch } : null;
  const markerWritten = writePwaOwnerLease(
    nextLease,
    storage,
    transitionToken,
  );
  const persistenceActive = markerWritten
    && activateTechQueryPersistence(nextLease);
  const ready = !!persistenceActive;
  if (!ready) {
    if (ownsTransition(storage, transitionToken)) {
      invalidatePwaOwnerLease(storage);
      finishPwaOwnerTransition(transitionToken, storage);
    }
    suspendTechQueryPersistence();
  }

  return {
    ...cleanupResult,
    ready,
    deferrable: false,
    changed: true,
    owner: ready ? nextOwner : null,
    requestedOwner: nextOwner,
    previousOwner,
    ownerVerified,
    legacyState: !previousLease,
    lease: ready ? nextLease : null,
    markerWritten,
    runnerSuspended: runner.suspended,
    reason: ready ? null : 'owner-publication-failed',
  };
}

/**
 * Clear account-owned state during logout/rejection. The marker is invalidated
 * synchronously and never restored, even if an asynchronous cleanup fails.
 */
export async function clearPwaAccountState({
  storage = browserStorage(),
  createEpoch = createPwaSessionEpoch,
  pushCleanup,
  cleanup,
} = {}) {
  const runner = suspendSyncRunner();
  suspendTechQueryPersistence();
  const previousLease = readPwaOwnerLease(storage);
  const previousOwner = readRawOwner(storage);
  const transitionToken = createEpoch({ prefix: 't1' });
  const transitionStarted = beginPwaOwnerTransition(
    transitionToken,
    storage,
  );
  if (!transitionStarted) {
    return {
      ready: false,
      deferrable: false,
      changed: !!previousOwner,
      owner: null,
      previousOwner,
      ownerVerified: false,
      legacyState: !previousLease,
      lease: null,
      queueQuarantined: false,
      runnerSuspended: runner.suspended,
      reason: 'transition-marker-unavailable',
    };
  }
  invalidatePwaOwnerLease(storage);

  const cleanupResult = await clearOwnedState({
    previousLease,
    nextOwner: null,
    pushCleanup,
    cleanup,
  });
  let transitionFinished = false;
  if (ownsTransition(storage, transitionToken)) {
    invalidatePwaOwnerLease(storage);
    transitionFinished = finishPwaOwnerTransition(transitionToken, storage);
  }
  const ready = cleanupResult.ready && transitionFinished;
  // Deferrable (explicit sign-out only): every local leg finished and the
  // sole residual is journaled push server work. Any other failure keeps the
  // caller's blocking behavior.
  const deferrable = !ready
    && transitionFinished
    && cleanupResult.memoryCleared === true
    && cleanupResult.routeCleared === true
    && cleanupResult.draftsCleared === true
    && cleanupResult.persistedCleared === true
    && cleanupResult.queueQuarantined === true
    && cleanupResult.pushCleanupDeferrable === true;

  return {
    ...cleanupResult,
    ready,
    deferrable,
    changed: !!previousOwner,
    owner: null,
    previousOwner,
    ownerVerified: false,
    legacyState: !previousLease,
    lease: null,
    runnerSuspended: runner.suspended,
    reason: ready ? null : 'cleanup-incomplete',
  };
}
