/**
 * ════════════════════════════════════════════════
 * FILE: syncRunner.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Maintains one signed-in account's historical offline records without
 *   dispatching them. It performs bounded local cleanup and publishes status
 *   while automatic command replay remains disabled.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  offlineDb
 *   Data:      reads/writes → owner-scoped browser IndexedDB queue
 *
 * NOTES / GOTCHAS:
 *   - Dispatch machinery remains fail-closed behind an empty production
 *     allowlist so historical rows cannot become sends.
 *   - Automatic production command dispatch is disabled for the initial
 *     online-first release.
 *   - Earlier completed photo rows are cleanup-only and are never dispatched.
 * ════════════════════════════════════════════════
 */

import {
  claimQueueItem,
  isOpaqueQueueOwner,
  isQueueItemReplaySafe,
  isStableQueueOperationId,
  listQueue,
  markQueueCleanupComplete,
  pruneCompletedQueue,
  queueCounts,
  recoverStaleQueueClaims,
  retryFailedPhotoCleanup,
  settleQueueClaim,
} from './offlineDb';

export const MAX_SYNC_RETRIES = 5;
export const SYNC_POLL_MS = 30_000;
export const SYNC_BACKOFF_MS = [1_000, 4_000, 15_000, 60_000, 300_000];

const DEFAULT_QUEUE_API = {
  claimQueueItem,
  listQueue,
  markQueueCleanupComplete,
  pruneCompletedQueue,
  queueCounts,
  recoverStaleQueueClaims,
  retryFailedPhotoCleanup,
  settleQueueClaim,
};

export function createQueueClaimToken(cryptoImpl = globalThis.crypto) {
  try {
    if (cryptoImpl?.randomUUID) {
      return `c1.${cryptoImpl.randomUUID()}`;
    }
    if (cryptoImpl?.getRandomValues) {
      const bytes = new Uint8Array(18);
      cryptoImpl.getRandomValues(bytes);
      let value = '';
      for (const byte of bytes) {
        value += byte.toString(16).padStart(2, '0');
      }
      return `c1.${value}`;
    }
  } catch {
    // Fall through to the fail-closed result.
  }
  return null;
}

async function dispatchQueueItem(_db, _employee, item) {
  const error = new Error(
    `Automatic offline dispatch is disabled: ${item?.type || 'unknown'}`,
  );
  error.queueFailureKind = 'deterministic';
  throw error;
}

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429]);
const DETERMINISTIC_MESSAGE = /(?:requires|missing|inconsistent|invalid|unsupported|unknown production queue|not enabled|permission denied|unauthorized|forbidden)/i;

export function classifyQueueDispatchError(error) {
  const status = Number(error?.status);
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = String(error?.message || '');
  const deterministic = error?.queueFailureKind === 'deterministic'
    || (
      Number.isFinite(status)
      && status >= 400
      && status < 500
      && !TRANSIENT_HTTP_STATUS.has(status)
    )
    || /^(?:22|23|28|42|PGRST)/.test(code)
    || DETERMINISTIC_MESSAGE.test(message);
  if (deterministic) {
    return {
      ambiguous: false,
      deterministic: true,
      summary: Number.isFinite(status)
        ? `Server rejected queued work (${status})`
        : 'Queued work failed validation or authorization',
    };
  }
  return {
    ambiguous: true,
    deterministic: false,
    summary: 'The server response was not received',
  };
}

/**
 * Build a permanently owner-bound runner.
 *
 * @param {{db:object, employee:object, owner:string, ownerLease:object,
 *   isOwnerCurrent:(lease:object)=>boolean}} deps
 * @param {{queueApi?:object, dispatchItem?:Function, pollMs?:number,
 *   setIntervalImpl?:Function, clearIntervalImpl?:Function,
 *   windowTarget?:object, documentTarget?:object, createClaimToken?:Function,
 *   now?:Function}} options
 */
export function createSyncRunner(
  {
    db,
    employee,
    owner,
    ownerLease,
    isOwnerCurrent,
  },
  {
    queueApi = DEFAULT_QUEUE_API,
    dispatchItem = dispatchQueueItem,
    pollMs = SYNC_POLL_MS,
    setIntervalImpl = globalThis.setInterval,
    clearIntervalImpl = globalThis.clearInterval,
    windowTarget = typeof window !== 'undefined' ? window : null,
    documentTarget = typeof document !== 'undefined' ? document : null,
    createClaimToken = createQueueClaimToken,
    now = Date.now,
  } = {},
) {
  if (
    !db
    || !employee?.id
    || !isOpaqueQueueOwner(owner)
    || ownerLease?.owner !== owner
    || !ownerLease?.epoch
    || typeof isOwnerCurrent !== 'function'
  ) {
    throw new Error(
      'createSyncRunner requires db, employee, and a verified immutable owner lease',
    );
  }

  const listeners = new Map();
  let draining = false;
  let pollTimer = null;
  let onlineHandler = null;
  let visibilityHandler = null;
  let active = false;
  let disposed = false;
  let lifecycle = 0;

  const emit = (event, detail) => {
    const set = listeners.get(event);
    if (!set) return;
    set.forEach((callback) => {
      try {
        callback(detail);
      } catch (error) {
        console.error(`[syncRunner] listener for ${event} threw`, error);
      }
    });
  };

  const on = (event, callback) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(callback);
    return () => listeners.get(event)?.delete(callback);
  };

  const ownerStillCurrent = () => {
    try {
      return isOwnerCurrent(ownerLease) === true;
    } catch {
      return false;
    }
  };

  const runStillCurrent = (runLifecycle) => (
    active
    && !disposed
    && lifecycle === runLifecycle
    && ownerStillCurrent()
  );

  const readCounts = () => queueApi.queueCounts(ownerLease);

  const emitCounts = async () => {
    const counts = await readCounts().catch(() => null);
    if (counts) emit('queue:changed', counts);
    return counts;
  };

  const settleDispatchError = async (claimed, claimToken, error) => {
    if (!ownerStillCurrent()) return null;
    const retryCount = (claimed.retryCount || 0) + 1;
    const replaySafe = isQueueItemReplaySafe(claimed);
    const classification = classifyQueueDispatchError(error);
    const retryable = !classification.deterministic
      && replaySafe
      && retryCount < MAX_SYNC_RETRIES;
    const backoff = SYNC_BACKOFF_MS[
      Math.min(retryCount - 1, SYNC_BACKOFF_MS.length - 1)
    ];
    return queueApi.settleQueueClaim(
      claimed.clientId,
      ownerLease,
      claimToken,
      retryable ? 'pending' : 'error',
      {
        error: classification.summary,
        retryCount,
        retryAt: retryable ? now() + backoff : 0,
        retryBlocked: !retryable,
        ambiguous: classification.ambiguous,
      },
    );
  };

  const documentIsHidden = () => (
    documentTarget?.visibilityState === 'hidden'
  );

  const pruneCompleted = async () => {
    if (
      !ownerStillCurrent()
      || typeof queueApi.pruneCompletedQueue !== 'function'
    ) return 0;
    return queueApi.pruneCompletedQueue(ownerLease, { now: now() });
  };

  const maintainCompleted = async () => {
    if (!ownerStillCurrent()) return false;
    if (typeof queueApi.retryFailedPhotoCleanup === 'function') {
      await queueApi.retryFailedPhotoCleanup(
        ownerLease,
        { now: now() },
      );
    }
    if (!ownerStillCurrent()) return false;
    await pruneCompleted();
    return true;
  };

  const drainOnce = async () => {
    if (!active || disposed || draining || !ownerStillCurrent()) return false;
    if (documentIsHidden()) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

    const runLifecycle = lifecycle;
    draining = true;
    emit('sync:started', { owner });
    try {
      await queueApi.recoverStaleQueueClaims(ownerLease, { now: now() });
      if (!runStillCurrent(runLifecycle)) return false;
      await maintainCompleted().catch((maintenanceError) => {
        console.error('[syncRunner] completed queue maintenance failed', maintenanceError);
      });
      if (!runStillCurrent(runLifecycle)) return false;

      const pending = await queueApi.listQueue('pending', ownerLease);
      if (!runStillCurrent(runLifecycle)) return false;
      const readyAt = now();
      const ready = pending.filter((item) => (
        item?.owner === owner
        && item.operationId === item.clientId
        && isStableQueueOperationId(item.operationId)
        && isQueueItemReplaySafe(item)
        && (!item.retryAt || item.retryAt <= readyAt)
      ));

      for (const item of ready) {
        if (!runStillCurrent(runLifecycle)) break;
        const claimToken = createClaimToken();
        if (!claimToken) {
          emit('sync:claim-error', {
            item,
            error: new Error('Secure queue claim identity is unavailable'),
          });
          break;
        }
        const claimed = await queueApi.claimQueueItem(
          item.clientId,
          ownerLease,
          claimToken,
          { now: now() },
        );
        if (!claimed) continue;

        // Account transition after claim: leave the claim intact. A later,
        // current epoch will recover it after expiry using the replay policy.
        if (!runStillCurrent(runLifecycle)) break;

        await emitCounts();
        if (!runStillCurrent(runLifecycle)) break;
        let result;
        try {
          result = await dispatchItem(db, employee, claimed, ownerLease);
        } catch (error) {
          let settled = null;
          try {
            settled = await settleDispatchError(claimed, claimToken, error);
          } catch (persistenceError) {
            // Do not convert a failed local transition into another server
            // attempt. The durable claim remains the recovery authority.
            console.error(
              '[syncRunner] failed to persist dispatch failure',
              persistenceError,
            );
          }
          if (settled && runStillCurrent(runLifecycle)) {
            if (settled.status === 'error') {
              emit('sync:item-error', { item: claimed, error, settled });
            }
            await emitCounts();
          }
          if (!settled) break;
          continue;
        }

        let completed = null;
        try {
          if (ownerStillCurrent()) {
            completed = await queueApi.settleQueueClaim(
              claimed.clientId,
              ownerLease,
              claimToken,
              'done',
              {
                error: null,
                serverId: result?.serverId,
                retryBlocked: false,
                ambiguous: false,
                cleanupCompleted: typeof result?.cleanup !== 'function',
              },
            );
          }
        } catch (persistenceError) {
          // The server result may already be durable. Never classify this as a
          // dispatch failure or immediately replay it.
          console.error(
            '[syncRunner] server result accepted but local completion failed',
            persistenceError,
          );
          emit('sync:completion-persist-error', {
            item: claimed,
            error: persistenceError,
          });
        }

        if (!completed) break;

        let cleanupCompleted = typeof result?.cleanup !== 'function';
        if (!cleanupCompleted) {
          try {
            await result.cleanup();
            cleanupCompleted = true;
          } catch (cleanupError) {
            // Queue completion remains authoritative. Owned leftovers are
            // quarantined and can be cleared later without replaying the send.
            console.error('[syncRunner] local cleanup failed', cleanupError);
          }
        }
        if (
          cleanupCompleted
          && typeof result?.cleanup === 'function'
          && ownerStillCurrent()
          && typeof queueApi.markQueueCleanupComplete === 'function'
        ) {
          try {
            await queueApi.markQueueCleanupComplete(
              claimed.clientId,
              ownerLease,
              { now: now() },
            );
          } catch (cleanupPersistenceError) {
            console.error(
              '[syncRunner] failed to persist local cleanup completion',
              cleanupPersistenceError,
            );
          }
        }
        if (cleanupCompleted && ownerStillCurrent()) {
          await maintainCompleted().catch((maintenanceError) => {
            console.error('[syncRunner] completed queue maintenance failed', maintenanceError);
          });
        }
        if (runStillCurrent(runLifecycle)) {
          emit('sync:item-done', { item: claimed, result });
          await emitCounts();
        }
      }
      return true;
    } catch (error) {
      console.error('[syncRunner] drain error', error);
      return false;
    } finally {
      draining = false;
      if (runStillCurrent(runLifecycle)) {
        const counts = await readCounts().catch(() => null);
        emit('sync:idle', counts);
      }
    }
  };

  const tick = async () => {
    if (
      !active
      || disposed
      || !ownerStillCurrent()
      || documentIsHidden()
    ) return;
    const counts = await readCounts().catch(() => ({ pending: 0, syncing: 0 }));
    if (counts.pending > 0 || counts.syncing > 0) {
      void drainOnce();
    } else {
      void maintainCompleted().catch(() => {});
    }
  };

  const start = () => {
    if (active || disposed || !ownerStillCurrent()) return false;
    active = true;
    lifecycle += 1;

    onlineHandler = () => {
      if (!documentIsHidden()) void drainOnce();
    };
    visibilityHandler = () => {
      if (documentTarget?.visibilityState === 'visible') void drainOnce();
    };

    windowTarget?.addEventListener?.('online', onlineHandler);
    documentTarget?.addEventListener?.('visibilitychange', visibilityHandler);
    pollTimer = setIntervalImpl(tick, pollMs);
    if (!documentIsHidden()) void drainOnce();
    return true;
  };

  const stop = () => {
    if (disposed) return false;
    active = false;
    disposed = true;
    lifecycle += 1;
    windowTarget?.removeEventListener?.('online', onlineHandler);
    documentTarget?.removeEventListener?.('visibilitychange', visibilityHandler);
    if (pollTimer) clearIntervalImpl(pollTimer);
    pollTimer = null;
    emit('runner:stopped', { owner });
    return true;
  };

  return {
    owner,
    start,
    stop,
    drainOnce,
    on,
    isActive: () => active && !disposed && ownerStillCurrent(),
  };
}
