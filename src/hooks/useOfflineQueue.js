/**
 * ════════════════════════════════════════════════
 * FILE: useOfflineQueue.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Exposes one signed-in field user's historical offline-state status and
 *   recovery controls. Automatic command admission/replay is disabled; login
 *   changes, logout, and another tab changing the account immediately
 *   disconnect the old runner and event listeners.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  AuthContext, offlineDb, pwaAccountState, resumeRestore,
 *              syncRunnerSingleton
 *   Data:      reads/writes → owner-scoped browser IndexedDB queue
 *
 * NOTES / GOTCHAS:
 *   - Auth's immutable `pwaOwnerLease` is authoritative after account cleanup.
 *     A fingerprint fallback exists only for an older provider with no field.
 *   - Event subscriptions are rewired whenever the singleton runner changes.
 * ════════════════════════════════════════════════
 */

import {
  useCallback,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  OFFLINE_DATA_DISCARD_CONFIRMATION,
  clearDone as clearDoneDb,
  discardAllOfflineData,
  getOfflineDbOpenState,
  inspectOfflineOwnership,
  listBlockedQueueItems,
  queueCounts,
  resolveBlockedQueueItem,
  retryOfflineDbOpen,
  subscribeOfflineDbOpenState,
} from '@/lib/offlineDb';
import { resolveVerifiedPwaOwnerLease } from '@/lib/pwaAccountState';
import {
  PWA_ACCOUNT_EPOCH_KEY,
  PWA_ACCOUNT_OWNER_KEY,
  PWA_ACCOUNT_TRANSITION_KEY,
  isPwaOwnerLeaseCurrent,
} from '@/lib/resumeRestore';
import {
  initSyncRunner,
  suspendSyncRunner,
} from '@/lib/syncRunnerSingleton';

const state = {
  pendingCount: 0,
  syncingCount: 0,
  errorCount: 0,
  blockedCount: 0,
  quarantinedCount: 0,
  rolloutReady: true,
  legacyRecoveryRequired: false,
  unsupportedRecoveryRequired: false,
  inspectionUnavailable: false,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  owner: null,
  epoch: null,
  principalKey: null,
};

const subscribers = new Set();
let lastSnapshot = { ...state };
let wiredRunner = null;
let wiredUnsubscribers = [];
let refreshGeneration = 0;

function notify() {
  subscribers.forEach((callback) => {
    try {
      callback();
    } catch {
      // One broken consumer must not block every queue status subscriber.
    }
  });
}

function stateSnapshot() {
  if (
    lastSnapshot.pendingCount !== state.pendingCount
    || lastSnapshot.syncingCount !== state.syncingCount
    || lastSnapshot.errorCount !== state.errorCount
    || lastSnapshot.blockedCount !== state.blockedCount
    || lastSnapshot.quarantinedCount !== state.quarantinedCount
    || lastSnapshot.rolloutReady !== state.rolloutReady
    || lastSnapshot.legacyRecoveryRequired !== state.legacyRecoveryRequired
    || lastSnapshot.unsupportedRecoveryRequired
      !== state.unsupportedRecoveryRequired
    || lastSnapshot.inspectionUnavailable !== state.inspectionUnavailable
    || lastSnapshot.isOnline !== state.isOnline
    || lastSnapshot.owner !== state.owner
    || lastSnapshot.epoch !== state.epoch
    || lastSnapshot.principalKey !== state.principalKey
  ) {
    lastSnapshot = { ...state };
  }
  return lastSnapshot;
}

export function setOfflineQueueOwner(owner, principalKey, epoch = null) {
  const changed = state.owner !== owner
    || state.epoch !== epoch
    || state.principalKey !== principalKey;
  state.owner = owner;
  state.epoch = epoch;
  state.principalKey = principalKey;
  if (changed) {
    state.pendingCount = 0;
    state.syncingCount = 0;
    state.errorCount = 0;
    state.blockedCount = 0;
    state.quarantinedCount = 0;
    state.rolloutReady = true;
    state.legacyRecoveryRequired = false;
    state.unsupportedRecoveryRequired = false;
    state.inspectionUnavailable = false;
    refreshGeneration += 1;
    notify();
  }
}

export async function refreshOfflineQueueCounts(
  owner,
  principalKey,
  epoch,
  {
    count = queueCounts,
    inspect = inspectOfflineOwnership,
  } = {},
) {
  if (!owner || !principalKey || !epoch) return false;
  const generation = ++refreshGeneration;
  try {
    const counts = await count({ owner, epoch });
    const ownership = await Promise.resolve(inspect(owner));
    if (
      generation !== refreshGeneration
      || state.owner !== owner
      || state.epoch !== epoch
      || state.principalKey !== principalKey
    ) {
      return false;
    }
    state.pendingCount = counts.pending + counts.syncing;
    state.syncingCount = counts.syncing;
    state.errorCount = counts.error;
    state.blockedCount = counts.blocked || 0;
    state.quarantinedCount = ownership?.quarantinedTotal
      ?? (
        (ownership?.otherOwner || 0)
        + (ownership?.legacy || 0)
        + (ownership?.unsupportedOwned || 0)
      );
    state.rolloutReady = ownership?.rolloutReady !== false;
    state.legacyRecoveryRequired =
      ownership?.legacyRecoveryRequired === true;
    state.unsupportedRecoveryRequired =
      ownership?.unsupportedRecoveryRequired === true;
    state.inspectionUnavailable = false;
    notify();
    return true;
  } catch (error) {
    console.error('[useOfflineQueue] refresh failed', error);
    if (
      generation === refreshGeneration
      && state.owner === owner
      && state.epoch === epoch
      && state.principalKey === principalKey
    ) {
      state.rolloutReady = false;
      state.inspectionUnavailable = true;
      notify();
    }
    return false;
  }
}

export function unwireOfflineQueueRunner() {
  wiredUnsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch {
      // Runner disposal remains authoritative.
    }
  });
  wiredUnsubscribers = [];
  wiredRunner = null;
}

/** Rewire the event bridge when login/account replacement creates a new runner. */
export function wireOfflineQueueRunner(
  runner,
  { owner, principalKey, epoch },
) {
  if (!runner || !owner || !principalKey || !epoch) {
    unwireOfflineQueueRunner();
    return false;
  }
  if (wiredRunner === runner) return true;
  unwireOfflineQueueRunner();
  wiredRunner = runner;
  const refresh = () => {
    void refreshOfflineQueueCounts(owner, principalKey, epoch);
  };
  wiredUnsubscribers = [
    runner.on('queue:changed', refresh),
    runner.on('sync:item-done', refresh),
    runner.on('sync:item-error', refresh),
    runner.on('sync:idle', refresh),
    runner.on('runner:stopped', () => {
      if (wiredRunner !== runner) return;
      unwireOfflineQueueRunner();
      setOfflineQueueOwner(null, null, null);
    }),
  ];
  refresh();
  return true;
}

function updateOnline() {
  const next = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (next !== state.isOnline) {
    state.isOnline = next;
    notify();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
}

function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function getSnapshot() {
  return stateSnapshot();
}

export function getOfflineQueueSnapshot() {
  return stateSnapshot();
}

function principalIdentity(user, employee) {
  return user?.id && employee?.id ? `${user.id}:${employee.id}` : null;
}

async function resolveLease({
  user,
  employee,
  pwaOwnerLease,
}) {
  // Once Auth exposes the field (including its pre-verification null state),
  // that immutable tab lease is authoritative. Never let an older same-account
  // tab adopt a newer epoch merely by rereading the device-global markers.
  if (pwaOwnerLease !== undefined) {
    return pwaOwnerLease && isPwaOwnerLeaseCurrent(pwaOwnerLease)
      ? pwaOwnerLease
      : null;
  }
  // Temporary compatibility for an Auth provider that predates the field.
  return resolveVerifiedPwaOwnerLease({
    authUserId: user?.id,
    employeeId: employee?.id,
  });
}

/**
 * Reconcile storage-marker changes without ever adopting another tab's epoch.
 * A transition suspends once; clearing/aborting it may re-enable the immutable
 * expected lease exactly once when that same lease is current again.
 */
export function createOfflineStorageReconciler({
  getExpectedLease,
  isLeaseCurrent,
  onCurrent,
  onSuspend,
}) {
  let generation = 0;
  let activeLeaseKey = null;
  let suspended = true;
  let hasReconciled = false;
  let disposed = false;

  const suspendOnce = async () => {
    activeLeaseKey = null;
    if (!hasReconciled || !suspended) {
      suspended = true;
      hasReconciled = true;
      await onSuspend();
    }
  };

  const reconcile = async () => {
    const run = ++generation;
    const lease = await getExpectedLease();
    if (disposed || run !== generation) return false;
    let current = false;
    try {
      current = !!lease && isLeaseCurrent(lease) === true;
    } catch {
      current = false;
    }
    if (!current) {
      await suspendOnce();
      return false;
    }

    const leaseKey = `${lease.owner}:${lease.epoch}`;
    if (!suspended && activeLeaseKey === leaseKey) return true;
    activeLeaseKey = leaseKey;
    suspended = false;
    hasReconciled = true;
    try {
      await onCurrent(lease);
    } catch (error) {
      if (!disposed && run === generation) await suspendOnce();
      throw error;
    }
    if (disposed) return false;
    if (run !== generation) {
      return !suspended && activeLeaseKey === leaseKey;
    }
    return true;
  };

  const onStorage = (event) => {
    if (
      event?.key
      && ![
        PWA_ACCOUNT_OWNER_KEY,
        PWA_ACCOUNT_EPOCH_KEY,
        PWA_ACCOUNT_TRANSITION_KEY,
      ].includes(event.key)
    ) {
      return false;
    }
    void reconcile();
    return true;
  };

  return {
    reconcile,
    onStorage,
    dispose() {
      disposed = true;
      generation += 1;
    },
  };
}

/**
 * Subscribe to the current account's offline queue and get owner-safe actions.
 */
export function useOfflineQueue() {
  const {
    db,
    employee,
    user,
    pwaOwnerLease,
  } = useAuth();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const storageState = useSyncExternalStore(
    subscribeOfflineDbOpenState,
    getOfflineDbOpenState,
    getOfflineDbOpenState,
  );
  const principalKey = principalIdentity(user, employee);

  useEffect(() => {
    if (!db || !employee?.id || !user?.id) {
      suspendSyncRunner();
      unwireOfflineQueueRunner();
      setOfflineQueueOwner(null, null, null);
      return undefined;
    }

    const reconciler = createOfflineStorageReconciler({
      getExpectedLease: () => resolveLease({
        user,
        employee,
        pwaOwnerLease,
      }),
      isLeaseCurrent: isPwaOwnerLeaseCurrent,
      onSuspend: () => {
        suspendSyncRunner();
        unwireOfflineQueueRunner();
        setOfflineQueueOwner(null, null, null);
      },
      onCurrent: (lease) => {
        setOfflineQueueOwner(lease.owner, principalKey, lease.epoch);
        const runner = initSyncRunner({
          db,
          employee,
          owner: lease.owner,
          ownerLease: lease,
          isOwnerCurrent: isPwaOwnerLeaseCurrent,
        });
        wireOfflineQueueRunner(runner, {
          owner: lease.owner,
          principalKey,
          epoch: lease.epoch,
        });
      },
    });
    void reconciler.reconcile();
    globalThis.window?.addEventListener?.('storage', reconciler.onStorage);

    return () => {
      reconciler.dispose();
      globalThis.window?.removeEventListener?.(
        'storage',
        reconciler.onStorage,
      );
    };
  }, [
    db,
    employee,
    principalKey,
    pwaOwnerLease,
    user,
  ]);

  const getActionLease = useCallback(async () => {
    const lease = await resolveLease({
      user,
      employee,
      pwaOwnerLease,
    });
    if (!lease) {
      suspendSyncRunner();
      throw new Error('Offline work is unavailable until account verification completes');
    }
    return lease;
  }, [employee, pwaOwnerLease, user]);

  const clearDone = useCallback(async () => {
    const lease = await getActionLease();
    await clearDoneDb(lease);
    setOfflineQueueOwner(lease.owner, principalKey, lease.epoch);
    await refreshOfflineQueueCounts(
      lease.owner,
      principalKey,
      lease.epoch,
    );
  }, [getActionLease, principalKey]);

  const loadBlocked = useCallback(async () => {
    const lease = await getActionLease();
    const [items, ownership] = await Promise.all([
      listBlockedQueueItems(lease),
      inspectOfflineOwnership(lease.owner),
    ]);
    return {
      items,
      quarantined: {
        foreign: ownership.otherOwner,
        legacy: ownership.legacy,
        unsupported: ownership.unsupportedOwned || 0,
        orphanPhotos: ownership.orphanPhotoOwned || 0,
        total: ownership.quarantinedTotal
          ?? (
            ownership.otherOwner
            + ownership.legacy
            + (ownership.unsupportedOwned || 0)
          ),
      },
      rollout: {
        ready: ownership.rolloutReady !== false,
        legacyRecoveryRequired:
          ownership.legacyRecoveryRequired === true,
        unsupportedRecoveryRequired:
          ownership.unsupportedRecoveryRequired === true,
        gate: ownership.rolloutGate || null,
      },
    };
  }, [getActionLease]);

  const retryOfflineStorage = useCallback(async () => {
    const lease = await getActionLease();
    await retryOfflineDbOpen();
    setOfflineQueueOwner(lease.owner, principalKey, lease.epoch);
    await refreshOfflineQueueCounts(
      lease.owner,
      principalKey,
      lease.epoch,
    );
    return true;
  }, [getActionLease, principalKey]);

  const discardLegacyOfflineData = useCallback(async () => {
    const lease = await getActionLease();
    suspendSyncRunner();
    unwireOfflineQueueRunner();
    try {
      const result = await discardAllOfflineData(lease, {
        confirmation: OFFLINE_DATA_DISCARD_CONFIRMATION,
      });
      setOfflineQueueOwner(lease.owner, principalKey, lease.epoch);
      await refreshOfflineQueueCounts(
        lease.owner,
        principalKey,
        lease.epoch,
      );
      return result;
    } finally {
      if (
        db
        && employee?.id
        && isPwaOwnerLeaseCurrent(lease)
      ) {
        const runner = initSyncRunner({
          db,
          employee,
          owner: lease.owner,
          ownerLease: lease,
          isOwnerCurrent: isPwaOwnerLeaseCurrent,
        });
        wireOfflineQueueRunner(runner, {
          owner: lease.owner,
          principalKey,
          epoch: lease.epoch,
        });
      }
    }
  }, [db, employee, getActionLease, principalKey]);

  const resolveBlocked = useCallback(async (
    operationId,
    resolution,
    { confirmedVisibleOnServer = false } = {},
  ) => {
    const lease = await getActionLease();
    const result = await resolveBlockedQueueItem(
      operationId,
      lease,
      {
        resolution,
        evidence: confirmedVisibleOnServer
          ? 'confirmed-visible-on-server'
          : null,
      },
    );
    setOfflineQueueOwner(lease.owner, principalKey, lease.epoch);
    await refreshOfflineQueueCounts(
      lease.owner,
      principalKey,
      lease.epoch,
    );
    return result;
  }, [getActionLease, principalKey]);

  const expectedLease = pwaOwnerLease === undefined
    ? { owner: snapshot.owner, epoch: snapshot.epoch }
    : pwaOwnerLease;
  const ownsSnapshot = state.principalKey === principalKey
    && !!expectedLease
    && snapshot.owner === expectedLease.owner
    && snapshot.epoch === expectedLease.epoch;

  return {
    pendingCount: ownsSnapshot ? snapshot.pendingCount : 0,
    syncingCount: ownsSnapshot ? snapshot.syncingCount : 0,
    errorCount: ownsSnapshot ? snapshot.errorCount : 0,
    blockedCount: ownsSnapshot ? snapshot.blockedCount : 0,
    quarantinedCount: ownsSnapshot ? snapshot.quarantinedCount : 0,
    rolloutReady: ownsSnapshot ? snapshot.rolloutReady : true,
    legacyRecoveryRequired: ownsSnapshot
      ? snapshot.legacyRecoveryRequired
      : false,
    unsupportedRecoveryRequired: ownsSnapshot
      ? snapshot.unsupportedRecoveryRequired
      : false,
    inspectionUnavailable: ownsSnapshot
      ? snapshot.inspectionUnavailable
      : false,
    isOnline: snapshot.isOnline,
    storageState,
    clearDone,
    loadBlocked,
    resolveBlocked,
    retryOfflineStorage,
    discardLegacyOfflineData,
  };
}
