/**
 * ════════════════════════════════════════════════
 * FILE: pwaAccountState.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves account A cannot leave readable state or a live offline sender for
 *   account B. A new owner is published only after cache, route, push, and
 *   queue-isolation checks all really succeed.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  pwaAccountState
 *   Data:      none (in-memory fakes only)
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  suspendRunner: vi.fn(() => ({
    suspended: true,
    hadRunner: true,
    previousOwner: 'v1.aaaaaaaaaaaa',
  })),
  clearMemoryDefault: vi.fn(),
  activatePersistence: vi.fn(() => true),
  clearPersistedDefault: vi.fn(async () => true),
  suspendPersistence: vi.fn(),
  inspectQueueDefault: vi.fn(async () => ({
    ready: true,
    quarantined: true,
    owned: 0,
    otherOwner: 1,
    legacy: 1,
    rolloutReady: false,
    legacyRecoveryRequired: true,
    rolloutGate: {
      code: 'OFFLINE_LEGACY_BRIDGE_REQUIRED',
      blocking: true,
    },
  })),
}));

vi.mock('./syncRunnerSingleton.js', () => ({
  suspendSyncRunner: fakes.suspendRunner,
}));
vi.mock('./techQuery.js', () => ({
  clearTechQueryMemory: fakes.clearMemoryDefault,
}));
vi.mock('./techQueryPersister.js', () => ({
  activateTechQueryPersistence: fakes.activatePersistence,
  clearPersistedTechQueries: fakes.clearPersistedDefault,
  suspendTechQueryPersistence: fakes.suspendPersistence,
}));
vi.mock('./offlineDb.js', () => ({
  inspectOfflineOwnership: fakes.inspectQueueDefault,
  inspectQueueOwnership: fakes.inspectQueueDefault,
}));

import {
  PWA_ACCOUNT_EPOCH_KEY,
  PWA_ACCOUNT_OWNER_KEY,
  PWA_ACCOUNT_TRANSITION_KEY,
  clearPwaAccountState,
  fingerprintPwaPrincipal,
  reconcilePwaAccountOwner,
  resolveVerifiedPwaOwnerLease,
} from './pwaAccountState.js';

const OWNER_A = 'v1.aaaaaaaaaaaa';
const OWNER_B = 'v1.bbbbbbbbbbbb';

function storage(lease = null) {
  const values = new Map();
  if (lease) {
    values.set(PWA_ACCOUNT_OWNER_KEY, lease.owner);
    values.set(PWA_ACCOUNT_EPOCH_KEY, lease.epoch);
  }
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

function epochs() {
  return ({ prefix }) => (
    prefix === 't1' ? 't1.transition-token' : 'e1.new-session'
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function cleanupSpies(overrides = {}) {
  return {
    clearMemory: vi.fn(() => true),
    clearPersisted: vi.fn(async () => true),
    clearRoute: vi.fn(() => true),
    inspectQueue: vi.fn(async () => ({
      ready: true,
      quarantined: true,
      owned: 0,
      otherOwner: 1,
      legacy: 1,
      rolloutReady: false,
      legacyRecoveryRequired: true,
      rolloutGate: {
        code: 'OFFLINE_LEGACY_BRIDGE_REQUIRED',
        blocking: true,
      },
    })),
    ...overrides,
  };
}

const pushDetached = () => ({
  ok: true,
  hadSubscription: false,
  serverDetached: true,
  localDetached: true,
});

describe('fingerprintPwaPrincipal', () => {
  it('returns an opaque token without retaining either raw identity', async () => {
    const token = await fingerprintPwaPrincipal(
      'auth-user-secret',
      'employee-secret',
      {
        subtle: { digest: async () => new Uint8Array(32).fill(7) },
        TextEncoderImpl: TextEncoder,
        encode: () => 'opaque-digest',
      },
    );
    expect(token).toBe('v1.opaque-digest');
    expect(token).not.toContain('auth-user-secret');
    expect(token).not.toContain('employee-secret');
  });

  it('fails closed when identity or Web Crypto is unavailable', async () => {
    expect(await fingerprintPwaPrincipal(null, 'employee', { subtle: {} }))
      .toBe(null);
    expect(await fingerprintPwaPrincipal('auth', 'employee', { subtle: null }))
      .toBe(null);
  });
});

describe('reconcilePwaAccountOwner', () => {
  beforeEach(() => {
    for (const fake of Object.values(fakes)) {
      if (typeof fake?.mockClear === 'function') fake.mockClear();
    }
    fakes.activatePersistence.mockReturnValue(true);
  });

  it('suspends the old runner synchronously and publishes first owner only after cleanup', async () => {
    const target = storage();
    const cleanup = cleanupSpies();
    const pushCleanup = vi.fn(() => {
      expect(fakes.suspendRunner).toHaveBeenCalledOnce();
      expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(null);
      return pushDetached();
    });

    const pending = reconcilePwaAccountOwner({
      authUserId: 'auth-a',
      employeeId: 'employee-a',
      storage: target,
      fingerprint: async () => OWNER_A,
      createEpoch: epochs(),
      pushCleanup,
      cleanup,
    });
    expect(fakes.suspendRunner).toHaveBeenCalledOnce();
    const result = await pending;

    expect(result).toMatchObject({
      ready: true,
      changed: true,
      owner: OWNER_A,
      previousOwner: null,
      ownerVerified: true,
      legacyState: true,
      queueQuarantined: true,
      pushCleanupReady: true,
      queue: {
        rolloutReady: false,
        legacyRecoveryRequired: true,
        rolloutGate: {
          code: 'OFFLINE_LEGACY_BRIDGE_REQUIRED',
          blocking: true,
        },
      },
    });
    expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(OWNER_A);
    expect(target.getItem(PWA_ACCOUNT_EPOCH_KEY)).toBe('e1.new-session');
    expect(target.getItem(PWA_ACCOUNT_TRANSITION_KEY)).toBe(null);
    expect(pushCleanup).toHaveBeenCalledOnce();
  });

  it('does not record a new owner when required push cleanup is absent', async () => {
    const target = storage();
    const result = await reconcilePwaAccountOwner({
      authUserId: 'auth-a',
      employeeId: 'employee-a',
      storage: target,
      fingerprint: async () => OWNER_A,
      createEpoch: epochs(),
      cleanup: cleanupSpies(),
    });

    expect(result).toMatchObject({
      ready: false,
      owner: null,
      requestedOwner: OWNER_A,
      pushCleanupReady: false,
      reason: 'cleanup-incomplete',
    });
    expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(null);
  });

  it('does not publish B when persisted cleanup or queue quarantine fails', async () => {
    const previous = { owner: OWNER_A, epoch: 'e1.old-a' };
    const target = storage(previous);
    const cleanup = cleanupSpies({
      clearPersisted: vi.fn(async () => false),
      inspectQueue: vi.fn(async () => ({
        ready: false,
        quarantined: false,
      })),
    });
    const result = await reconcilePwaAccountOwner({
      authUserId: 'auth-b',
      employeeId: 'employee-b',
      storage: target,
      fingerprint: async () => OWNER_B,
      createEpoch: epochs(),
      pushCleanup: pushDetached(),
      cleanup,
    });

    expect(result).toMatchObject({
      ready: false,
      owner: null,
      previousOwner: OWNER_A,
      queueQuarantined: false,
      persistedCleared: false,
    });
    expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(null);
    expect(cleanup.clearPersisted).toHaveBeenCalledWith(previous);
  });

  it('keeps the new owner unpublished until every durable store is quarantined', async () => {
    const previous = { owner: OWNER_A, epoch: 'e1.old-a' };
    const target = storage(previous);
    const inspection = deferred();
    const cleanup = cleanupSpies({
      inspectOffline: vi.fn(() => inspection.promise),
    });
    const pending = reconcilePwaAccountOwner({
      authUserId: 'auth-b',
      employeeId: 'employee-b',
      storage: target,
      fingerprint: async () => OWNER_B,
      createEpoch: epochs(),
      pushCleanup: pushDetached(),
      cleanup,
    });

    await vi.waitFor(() => {
      expect(cleanup.inspectOffline).toHaveBeenCalledWith(OWNER_B);
    });
    expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(null);
    expect(target.getItem(PWA_ACCOUNT_EPOCH_KEY)).toBe(null);

    inspection.resolve({
      ready: true,
      quarantined: true,
      rolloutReady: false,
      legacyRecoveryRequired: true,
      rolloutGate: {
        code: 'OFFLINE_LEGACY_BRIDGE_REQUIRED',
        blocking: true,
      },
      stores: {
        queue: { total: 1 },
        photos: { total: 1 },
        rooms: { total: 1 },
        readings: { total: 1 },
        equipment: { total: 1 },
        cacheMeta: { total: 1 },
        idSwaps: { total: 1 },
      },
    });
    await expect(pending).resolves.toMatchObject({
      ready: true,
      owner: OWNER_B,
      queueQuarantined: true,
      queue: {
        rolloutReady: false,
        legacyRecoveryRequired: true,
      },
    });
    expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(OWNER_B);
  });

  it('retains an already verified same-owner lease without clearing or detaching', async () => {
    const previous = { owner: OWNER_A, epoch: 'e1.same-session' };
    const target = storage(previous);
    const cleanup = cleanupSpies();
    const pushCleanup = vi.fn(pushDetached);
    const result = await reconcilePwaAccountOwner({
      authUserId: 'auth-a',
      employeeId: 'employee-a',
      storage: target,
      fingerprint: async () => OWNER_A,
      createEpoch: epochs(),
      pushCleanup,
      cleanup,
    });

    expect(result).toMatchObject({
      ready: true,
      changed: false,
      owner: OWNER_A,
      previousOwner: OWNER_A,
      lease: previous,
      queueQuarantined: true,
    });
    expect(cleanup.clearMemory).not.toHaveBeenCalled();
    expect(cleanup.clearPersisted).not.toHaveBeenCalled();
    expect(pushCleanup).not.toHaveBeenCalled();
  });

  it('cannot overwrite a newer tab after its transition token is superseded', async () => {
    let releaseFingerprint;
    const target = storage({ owner: OWNER_A, epoch: 'e1.old-a' });
    const fingerprint = vi.fn(() => new Promise((resolve) => {
      releaseFingerprint = resolve;
    }));
    const pending = reconcilePwaAccountOwner({
      authUserId: 'auth-b',
      employeeId: 'employee-b',
      storage: target,
      fingerprint,
      createEpoch: epochs(),
      pushCleanup: pushDetached(),
      cleanup: cleanupSpies(),
    });
    expect(target.getItem(PWA_ACCOUNT_TRANSITION_KEY))
      .toBe('t1.transition-token');

    target.setItem(PWA_ACCOUNT_TRANSITION_KEY, 't1.newer-tab');
    target.setItem(PWA_ACCOUNT_OWNER_KEY, OWNER_B);
    target.setItem(PWA_ACCOUNT_EPOCH_KEY, 'e1.newer-session');
    releaseFingerprint(OWNER_B);
    const result = await pending;

    expect(result).toMatchObject({
      ready: false,
      owner: null,
      reason: 'transition-superseded',
    });
    expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(OWNER_B);
    expect(target.getItem(PWA_ACCOUNT_EPOCH_KEY)).toBe('e1.newer-session');
  });
});

describe('clearPwaAccountState', () => {
  it('accepts an already-resolved push result without unsubscribing again', async () => {
    const target = storage({ owner: OWNER_A, epoch: 'e1.old-a' });
    const cleanup = cleanupSpies();
    const result = await clearPwaAccountState({
      storage: target,
      createEpoch: epochs(),
      pushCleanup: pushDetached(),
      cleanup,
    });

    expect(result).toMatchObject({
      ready: true,
      owner: null,
      previousOwner: OWNER_A,
      queueQuarantined: true,
      serverPushCleared: true,
      localPushCleared: true,
      queue: {
        rolloutReady: false,
        legacyRecoveryRequired: true,
      },
    });
    expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(null);
    expect(target.getItem(PWA_ACCOUNT_EPOCH_KEY)).toBe(null);
  });

  it('reports failed cleanup honestly while keeping the owner invalidated', async () => {
    const target = storage({ owner: OWNER_A, epoch: 'e1.old-a' });
    const result = await clearPwaAccountState({
      storage: target,
      createEpoch: epochs(),
      pushCleanup: {
        ok: false,
        hadSubscription: true,
        serverDetached: false,
        localDetached: true,
      },
      cleanup: cleanupSpies(),
    });

    expect(result).toMatchObject({
      ready: false,
      owner: null,
      pushCleanupReady: false,
      reason: 'cleanup-incomplete',
    });
    expect(target.getItem(PWA_ACCOUNT_OWNER_KEY)).toBe(null);
  });
});

describe('resolveVerifiedPwaOwnerLease', () => {
  it('returns only the exact current account lease', async () => {
    const lease = { owner: OWNER_A, epoch: 'e1.current' };
    const target = storage(lease);
    await expect(resolveVerifiedPwaOwnerLease({
      authUserId: 'auth-a',
      employeeId: 'employee-a',
      storage: target,
      fingerprint: async () => OWNER_A,
    })).resolves.toEqual(lease);
    await expect(resolveVerifiedPwaOwnerLease({
      authUserId: 'auth-b',
      employeeId: 'employee-b',
      storage: target,
      fingerprint: async () => OWNER_B,
    })).resolves.toBe(null);
  });
});
