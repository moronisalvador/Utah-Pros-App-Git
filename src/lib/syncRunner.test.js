/**
 * ════════════════════════════════════════════════
 * FILE: syncRunner.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the initial online-first release never claims or dispatches stored
 *   historical commands while retaining bounded local cleanup and lifecycle
 *   handling.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  syncRunner
 *   Data:      none (in-memory fakes only)
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import { createSyncRunner } from './syncRunner.js';

const OWNER_A = 'v1.aaaaaaaaaaaa';
const OWNER_B = 'v1.bbbbbbbbbbbb';
const LEASE_A = { owner: OWNER_A, epoch: 'e1.session-a' };
const operationIds = new Map();

function operationId(label) {
  if (!operationIds.has(label)) {
    const suffix = String(operationIds.size + 1).padStart(12, '0');
    operationIds.set(label, `00000000-0000-4000-8000-${suffix}`);
  }
  return operationIds.get(label);
}

function queueRow(clientId, type = 'reading.insert', owner = OWNER_A) {
  const stableId = operationId(clientId);
  return {
    clientId: stableId,
    operationId: stableId,
    testLabel: clientId,
    owner,
    status: 'pending',
    type,
    retryCount: 0,
    retryAt: 0,
  };
}

function makeQueue(initial) {
  const rows = new Map(initial.map((row) => [row.clientId, { ...row }]));
  const api = {
    // Deliberately return every matching-status row. The runner's own defense
    // must reject legacy/foreign rows even if storage regresses.
    listQueue: vi.fn(async (status) => (
      [...rows.values()].filter((row) => row.status === status)
    )),
    recoverStaleQueueClaims: vi.fn(async () => []),
    retryFailedPhotoCleanup: vi.fn(async () => ({
      attempted: 0,
      cleaned: 0,
      failed: 0,
      exhausted: 0,
    })),
    pruneCompletedQueue: vi.fn(async () => 0),
    markQueueCleanupComplete: vi.fn(async (clientId) => {
      const row = rows.get(clientId);
      if (!row || row.status !== 'done') return null;
      const next = { ...row, cleanupCompletedAt: 1_000 };
      rows.set(clientId, next);
      return next;
    }),
    claimQueueItem: vi.fn(async (
      clientId,
      lease,
      claimToken,
      { now },
    ) => {
      const row = rows.get(clientId);
      if (
        !row
        || row.owner !== lease.owner
        || row.status !== 'pending'
      ) return null;
      const next = {
        ...row,
        status: 'syncing',
        claimToken,
        claimEpoch: lease.epoch,
        claimExpiresAt: now + 120_000,
      };
      rows.set(clientId, next);
      return next;
    }),
    settleQueueClaim: vi.fn(async (
      clientId,
      lease,
      claimToken,
      status,
      extra = {},
    ) => {
      const row = rows.get(clientId);
      if (
        !row
        || row.owner !== lease.owner
        || row.status !== 'syncing'
        || row.claimEpoch !== lease.epoch
        || row.claimToken !== claimToken
      ) return null;
      const next = {
        ...row,
        ...extra,
        status,
        lastError: extra.error !== undefined
          ? extra.error
          : row.lastError,
        claimToken: null,
        claimEpoch: null,
        claimExpiresAt: 0,
      };
      rows.set(clientId, next);
      return next;
    }),
    queueCounts: vi.fn(async (lease) => {
      const counts = { pending: 0, syncing: 0, error: 0, done: 0 };
      for (const row of rows.values()) {
        if (row.owner === lease.owner && Object.hasOwn(counts, row.status)) {
          counts[row.status] += 1;
        }
      }
      return counts;
    }),
  };
  return { rows, api };
}

function runnerFor(
  queue,
  dispatchItem,
  isOwnerCurrent = () => true,
  options = {},
) {
  let token = 0;
  return createSyncRunner(
    {
      db: {},
      employee: { id: 'employee-a' },
      owner: OWNER_A,
      ownerLease: LEASE_A,
      isOwnerCurrent,
    },
    {
      queueApi: queue.api,
      dispatchItem,
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {},
      windowTarget: null,
      documentTarget: null,
      createClaimToken: () => `c1.test-claim-${++token}`,
      now: () => 1_000,
      ...options,
    },
  );
}

async function startAndWaitForIdle(runner) {
  const idle = new Promise((resolve) => runner.on('sync:idle', resolve));
  expect(runner.start()).toBe(true);
  await idle;
}

describe('owner-bound sync runner', () => {
  it('cannot be constructed without an immutable owner-current guard', () => {
    expect(() => createSyncRunner({
      db: {},
      employee: { id: 'employee-a' },
      owner: OWNER_A,
    })).toThrow(/immutable owner lease/i);
  });

  it('never claims or dispatches any historical command type', async () => {
    const queue = makeQueue([
      queueRow('owned'),
      queueRow('place', 'equipment.place'),
      queueRow('foreign', 'photo.upload', OWNER_B),
      {
        clientId: 'legacy',
        owner: OWNER_A,
        status: 'pending',
        type: 'photo.upload',
      },
    ]);
    const dispatchItem = vi.fn(async () => ({ serverId: 'server-owned' }));
    const runner = runnerFor(queue, dispatchItem);

    await startAndWaitForIdle(runner);

    expect(dispatchItem).not.toHaveBeenCalled();
    expect(queue.api.claimQueueItem).not.toHaveBeenCalled();
    expect(queue.rows.get(operationId('owned'))).toMatchObject({
      status: 'pending',
    });
    expect(queue.rows.get(operationId('place'))?.status).toBe('pending');
    expect(queue.rows.get(operationId('foreign'))?.status).toBe('pending');
    expect(queue.rows.get('legacy')?.status).toBe('pending');
    runner.stop();
  });

  it('never claims or dispatches an earlier equipment-removal row', async () => {
    const queue = makeQueue([queueRow('remove', 'equipment.remove')]);
    const dispatchItem = vi.fn(async () => {
      throw new Error('response lost');
    });
    const runner = runnerFor(queue, dispatchItem);

    await startAndWaitForIdle(runner);

    expect(queue.rows.get(operationId('remove'))).toMatchObject({
      status: 'pending',
      type: 'equipment.remove',
    });
    expect(queue.api.claimQueueItem).not.toHaveBeenCalled();
    expect(dispatchItem).not.toHaveBeenCalled();
    await runner.drainOnce();
    expect(dispatchItem).not.toHaveBeenCalled();
    runner.stop();
  });

  it('runs bounded prior-photo cleanup without dispatch before pruning', async () => {
    const queue = makeQueue([]);
    queue.api.retryFailedPhotoCleanup.mockResolvedValue({
      attempted: 1,
      cleaned: 1,
      failed: 0,
      exhausted: 0,
    });
    const dispatchItem = vi.fn();
    const runner = runnerFor(queue, dispatchItem);

    await startAndWaitForIdle(runner);

    expect(queue.api.retryFailedPhotoCleanup).toHaveBeenCalledWith(
      LEASE_A,
      { now: 1_000 },
    );
    expect(queue.api.pruneCompletedQueue).toHaveBeenCalled();
    expect(dispatchItem).not.toHaveBeenCalled();
    runner.stop();
  });

  it('contains a failed prior-photo cleanup without dispatching it', async () => {
    const queue = makeQueue([]);
    queue.api.retryFailedPhotoCleanup.mockRejectedValue(
      new Error('IndexedDB photo delete failed'),
    );
    const dispatchItem = vi.fn();
    const runner = runnerFor(queue, dispatchItem);

    await startAndWaitForIdle(runner);

    expect(queue.api.retryFailedPhotoCleanup).toHaveBeenCalledTimes(1);
    expect(dispatchItem).not.toHaveBeenCalled();
    expect(queue.api.markQueueCleanupComplete).not.toHaveBeenCalled();
    runner.stop();
  });

  it('does not poll or drain while the document is hidden', async () => {
    const queue = makeQueue([queueRow('hidden-reading', 'reading.insert')]);
    const dispatchItem = vi.fn(async () => ({ serverId: 'reading-1' }));
    const documentHandlers = new Map();
    const windowHandlers = new Map();
    let visibilityState = 'hidden';
    let intervalTick = null;
    const documentTarget = {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: (event, callback) => {
        documentHandlers.set(event, callback);
      },
      removeEventListener: vi.fn(),
    };
    const windowTarget = {
      addEventListener: (event, callback) => {
        windowHandlers.set(event, callback);
      },
      removeEventListener: vi.fn(),
    };
    const runner = runnerFor(
      queue,
      dispatchItem,
      () => true,
      {
        documentTarget,
        windowTarget,
        setIntervalImpl: (callback) => {
          intervalTick = callback;
          return 1;
        },
      },
    );

    expect(runner.start()).toBe(true);
    expect(await runner.drainOnce()).toBe(false);
    await intervalTick();
    windowHandlers.get('online')();
    await Promise.resolve();
    expect(queue.api.recoverStaleQueueClaims).not.toHaveBeenCalled();
    expect(dispatchItem).not.toHaveBeenCalled();

    visibilityState = 'visible';
    documentHandlers.get('visibilitychange')();
    await vi.waitFor(() => {
      expect(queue.api.listQueue).toHaveBeenCalled();
    });
    expect(dispatchItem).not.toHaveBeenCalled();
    runner.stop();
  });

  it('refuses to start or drain after the immutable lease becomes stale', async () => {
    const queue = makeQueue([queueRow('owned')]);
    let current = false;
    const dispatchItem = vi.fn();
    const runner = runnerFor(queue, dispatchItem, () => current);

    expect(runner.start()).toBe(false);
    current = true;
    expect(await runner.drainOnce()).toBe(false);
    expect(dispatchItem).not.toHaveBeenCalled();
  });
});
