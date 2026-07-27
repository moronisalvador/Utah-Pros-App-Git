/**
 * ════════════════════════════════════════════════
 * FILE: useOfflineQueue.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves queue status listeners move from account A's sender to account B's
 *   sender and that a late A count cannot overwrite B's visible status.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  useOfflineQueue
 *   Data:      none (in-memory fakes only)
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  queueCounts: vi.fn(async () => ({
    pending: 0,
    syncing: 0,
    error: 0,
    done: 0,
  })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: null,
    employee: null,
    user: null,
    pwaOwnerLease: null,
  }),
}));
vi.mock('@/lib/offlineDb', () => ({
  OFFLINE_DATA_DISCARD_CONFIRMATION: 'discard-all-unsynced-offline-data',
  clearDone: vi.fn(),
  discardAllOfflineData: vi.fn(),
  getOfflineDbOpenState: vi.fn(() => ({
    status: 'idle',
    code: null,
    message: null,
    guidance: null,
  })),
  inspectOfflineOwnership: vi.fn(),
  listBlockedQueueItems: vi.fn(),
  queueCounts: fakes.queueCounts,
  resolveBlockedQueueItem: vi.fn(),
  retryOfflineDbOpen: vi.fn(),
  subscribeOfflineDbOpenState: vi.fn(() => () => {}),
}));
vi.mock('@/lib/pwaAccountState', () => ({
  resolveVerifiedPwaOwnerLease: vi.fn(async () => null),
}));
vi.mock('@/lib/syncRunnerSingleton', () => ({
  getSyncRunner: vi.fn(),
  initSyncRunner: vi.fn(),
  suspendSyncRunner: vi.fn(),
}));

import {
  createOfflineStorageReconciler,
  getOfflineQueueSnapshot,
  refreshOfflineQueueCounts,
  setOfflineQueueOwner,
  unwireOfflineQueueRunner,
  wireOfflineQueueRunner,
} from './useOfflineQueue.js';

const OWNER_A = 'v1.aaaaaaaaaaaa';
const OWNER_B = 'v1.bbbbbbbbbbbb';
const EPOCH_A = 'e1.session-a';
const EPOCH_B = 'e1.session-b';
const LEASE_A = { owner: OWNER_A, epoch: EPOCH_A };
const LEASE_B = { owner: OWNER_B, epoch: EPOCH_B };

function fakeRunner() {
  const handlers = new Map();
  return {
    on: vi.fn((event, callback) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(callback);
      return () => handlers.get(event)?.delete(callback);
    }),
    emit(event, detail) {
      for (const callback of handlers.get(event) || []) callback(detail);
    },
    listenerCount() {
      return [...handlers.values()]
        .reduce((count, callbacks) => count + callbacks.size, 0);
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('offline queue runner event bridge', () => {
  beforeEach(() => {
    unwireOfflineQueueRunner();
    setOfflineQueueOwner(null, null, null);
    fakes.queueCounts.mockClear();
  });

  it('unsubscribes A and rewires all events to B', async () => {
    const runnerA = fakeRunner();
    const runnerB = fakeRunner();
    setOfflineQueueOwner(OWNER_A, 'principal-a', EPOCH_A);
    wireOfflineQueueRunner(runnerA, {
      owner: OWNER_A,
      principalKey: 'principal-a',
      epoch: EPOCH_A,
    });
    await vi.waitFor(() => expect(fakes.queueCounts).toHaveBeenCalled());
    expect(fakes.queueCounts).toHaveBeenCalledWith({
      owner: OWNER_A,
      epoch: EPOCH_A,
    });

    setOfflineQueueOwner(OWNER_B, 'principal-b', EPOCH_B);
    wireOfflineQueueRunner(runnerB, {
      owner: OWNER_B,
      principalKey: 'principal-b',
      epoch: EPOCH_B,
    });
    expect(runnerA.listenerCount()).toBe(0);
    expect(runnerB.listenerCount()).toBe(5);

    const before = fakes.queueCounts.mock.calls.length;
    runnerA.emit('queue:changed');
    expect(fakes.queueCounts.mock.calls.length).toBe(before);
    runnerB.emit('queue:changed');
    await vi.waitFor(() => {
      expect(fakes.queueCounts.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('discards a late A count after visible ownership changes to B', async () => {
    const slowA = deferred();
    setOfflineQueueOwner(OWNER_A, 'principal-a', EPOCH_A);
    const pendingA = refreshOfflineQueueCounts(
      OWNER_A,
      'principal-a',
      EPOCH_A,
      { count: () => slowA.promise },
    );

    setOfflineQueueOwner(OWNER_B, 'principal-b', EPOCH_B);
    await refreshOfflineQueueCounts(
      OWNER_B,
      'principal-b',
      EPOCH_B,
      {
        count: async () => ({
          pending: 2,
          syncing: 1,
          error: 1,
          done: 0,
        }),
      },
    );
    slowA.resolve({
      pending: 99,
      syncing: 0,
      error: 99,
      done: 0,
    });

    expect(await pendingA).toBe(false);
    expect(getOfflineQueueSnapshot()).toMatchObject({
      owner: OWNER_B,
      epoch: EPOCH_B,
      principalKey: 'principal-b',
      pendingCount: 3,
      syncingCount: 1,
      errorCount: 1,
    });
  });

  it('discards a late count from an older epoch of the same account', async () => {
    const slowOldEpoch = deferred();
    setOfflineQueueOwner(OWNER_A, 'principal-a', EPOCH_A);
    const pendingOldEpoch = refreshOfflineQueueCounts(
      OWNER_A,
      'principal-a',
      EPOCH_A,
      { count: () => slowOldEpoch.promise },
    );

    setOfflineQueueOwner(OWNER_A, 'principal-a', 'e1.session-a-new');
    await refreshOfflineQueueCounts(
      OWNER_A,
      'principal-a',
      'e1.session-a-new',
      {
        count: async () => ({
          pending: 1,
          syncing: 0,
          error: 0,
          done: 0,
        }),
      },
    );
    slowOldEpoch.resolve({
      pending: 99,
      syncing: 0,
      error: 99,
      done: 0,
    });

    expect(await pendingOldEpoch).toBe(false);
    expect(getOfflineQueueSnapshot()).toMatchObject({
      owner: OWNER_A,
      epoch: 'e1.session-a-new',
      pendingCount: 1,
      errorCount: 0,
    });
  });

  it('publishes foreign, legacy, and unsupported quarantine counts', async () => {
    setOfflineQueueOwner(OWNER_A, 'principal-a', EPOCH_A);
    await refreshOfflineQueueCounts(
      OWNER_A,
      'principal-a',
      EPOCH_A,
      {
        count: async () => ({
          pending: 0,
          syncing: 0,
          error: 0,
          done: 0,
        }),
        inspect: async () => ({
          otherOwner: 2,
          legacy: 1,
          unsupportedOwned: 1,
          quarantinedTotal: 4,
          rolloutReady: false,
          unsupportedRecoveryRequired: true,
        }),
      },
    );
    expect(getOfflineQueueSnapshot())
      .toMatchObject({
        quarantinedCount: 4,
        rolloutReady: false,
        unsupportedRecoveryRequired: true,
        inspectionUnavailable: false,
      });
  });

  it('fails rollout closed when ownership inspection is unavailable', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    setOfflineQueueOwner(OWNER_A, 'principal-a', EPOCH_A);

    const refreshed = await refreshOfflineQueueCounts(
      OWNER_A,
      'principal-a',
      EPOCH_A,
      {
        count: async () => ({
          pending: 0,
          syncing: 0,
          error: 0,
          done: 0,
        }),
        inspect: async () => {
          throw new Error('IndexedDB inspection failed');
        },
      },
    );

    expect(refreshed).toBe(false);
    expect(getOfflineQueueSnapshot()).toMatchObject({
      rolloutReady: false,
      inspectionUnavailable: true,
    });
    consoleError.mockRestore();
  });

  it('publishes the typed legacy rollout gate without adopting payloads', async () => {
    setOfflineQueueOwner(OWNER_A, 'principal-a', EPOCH_A);
    await refreshOfflineQueueCounts(
      OWNER_A,
      'principal-a',
      EPOCH_A,
      {
        count: async () => ({
          pending: 0,
          syncing: 0,
          error: 0,
          done: 0,
        }),
        inspect: async () => ({
          otherOwner: 0,
          legacy: 2,
          unsupportedOwned: 1,
          quarantinedTotal: 3,
          rolloutReady: false,
          legacyRecoveryRequired: true,
          unsupportedRecoveryRequired: true,
        }),
      },
    );
    expect(getOfflineQueueSnapshot()).toMatchObject({
      rolloutReady: false,
      legacyRecoveryRequired: true,
      unsupportedRecoveryRequired: true,
      quarantinedCount: 3,
    });
  });

  it('suspends for a transition and resumes the same immutable lease once', async () => {
    let currentLease = LEASE_A;
    const onCurrent = vi.fn();
    const onSuspend = vi.fn();
    const reconciler = createOfflineStorageReconciler({
      getExpectedLease: async () => LEASE_A,
      isLeaseCurrent: (lease) => (
        lease.owner === currentLease?.owner
        && lease.epoch === currentLease?.epoch
      ),
      onCurrent,
      onSuspend,
    });

    await expect(reconciler.reconcile()).resolves.toBe(true);
    expect(onCurrent).toHaveBeenCalledTimes(1);

    // Another tab begins a transition, then closes/aborts before replacing A.
    currentLease = null;
    expect(reconciler.onStorage({ key: 'upr:pwa-account-transition:v1' }))
      .toBe(true);
    await vi.waitFor(() => expect(onSuspend).toHaveBeenCalledTimes(1));

    currentLease = LEASE_A;
    reconciler.onStorage({ key: 'upr:pwa-account-transition:v1' });
    reconciler.onStorage({ key: 'upr:pwa-account-owner:v1' });
    reconciler.onStorage({ key: 'upr:pwa-account-epoch:v1' });
    await vi.waitFor(() => expect(onCurrent).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(onCurrent).toHaveBeenCalledTimes(2);
    reconciler.dispose();
  });

  it('never resumes the old owner after another tab wins the switch', async () => {
    let currentLease = LEASE_A;
    const onCurrentA = vi.fn();
    const onSuspendA = vi.fn();
    const reconcilerA = createOfflineStorageReconciler({
      getExpectedLease: async () => LEASE_A,
      isLeaseCurrent: (lease) => (
        lease.owner === currentLease?.owner
        && lease.epoch === currentLease?.epoch
      ),
      onCurrent: onCurrentA,
      onSuspend: onSuspendA,
    });
    const onCurrentB = vi.fn();
    const reconcilerB = createOfflineStorageReconciler({
      getExpectedLease: async () => LEASE_B,
      isLeaseCurrent: (lease) => (
        lease.owner === currentLease?.owner
        && lease.epoch === currentLease?.epoch
      ),
      onCurrent: onCurrentB,
      onSuspend: vi.fn(),
    });

    await reconcilerA.reconcile();
    await reconcilerB.reconcile();
    expect(onCurrentA).toHaveBeenCalledTimes(1);
    expect(onCurrentB).not.toHaveBeenCalled();

    currentLease = null;
    await reconcilerA.reconcile();
    currentLease = LEASE_B;
    await reconcilerA.reconcile();
    await reconcilerB.reconcile();
    expect(onSuspendA).toHaveBeenCalledTimes(1);
    expect(onCurrentA).toHaveBeenCalledTimes(1);
    expect(onCurrentB).toHaveBeenCalledTimes(1);

    // Closing the winning tab does not authorize A to adopt or resume B's epoch.
    reconcilerB.dispose();
    await reconcilerA.reconcile();
    expect(onCurrentA).toHaveBeenCalledTimes(1);
    reconcilerA.dispose();
  });

  it('deduplicates a storage event during same-lease initialization', async () => {
    const initialization = deferred();
    const onCurrent = vi.fn(() => initialization.promise);
    const onSuspend = vi.fn();
    const reconciler = createOfflineStorageReconciler({
      getExpectedLease: async () => LEASE_A,
      isLeaseCurrent: () => true,
      onCurrent,
      onSuspend,
    });

    const first = reconciler.reconcile();
    await vi.waitFor(() => expect(onCurrent).toHaveBeenCalledTimes(1));
    await expect(reconciler.reconcile()).resolves.toBe(true);
    initialization.resolve();
    await expect(first).resolves.toBe(true);
    expect(onCurrent).toHaveBeenCalledTimes(1);
    expect(onSuspend).not.toHaveBeenCalled();
    reconciler.dispose();
  });

  it('ignores unrelated storage keys', () => {
    const reconciler = createOfflineStorageReconciler({
      getExpectedLease: async () => LEASE_A,
      isLeaseCurrent: () => true,
      onCurrent: vi.fn(),
      onSuspend: vi.fn(),
    });
    expect(reconciler.onStorage({ key: 'unrelated' })).toBe(false);
    reconciler.dispose();
  });
});
