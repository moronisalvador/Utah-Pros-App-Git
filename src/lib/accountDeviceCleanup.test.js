/**
 * ════════════════════════════════════════════════
 * FILE: accountDeviceCleanup.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves logout/biometric cleanup stops account state before asynchronous
 *   work, requires honest Web/native detach results, and never performs the
 *   caller-owned sign-out or reset.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  accountDeviceCleanup.js
 *   Data:      dependency-injected fakes only
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import {
  cleanupAccountDeviceState,
  detachAccountPushDevices,
  disableWebPushPolicyMirror,
  retryPendingAccountPushDetaches,
} from './accountDeviceCleanup.js';

describe('detachAccountPushDevices', () => {
  it('starts both invalidations before awaiting and reports exact readiness', async () => {
    const order = [];
    let finishWeb;
    const webPending = new Promise((resolve) => {
      finishWeb = resolve;
    });
    const detachWeb = vi.fn(() => {
      order.push('web-start');
      return webPending;
    });
    const detachNative = vi.fn(async () => {
      order.push('native-start');
      return {
        serverDetached: true,
        localDetached: true,
        localStateCleared: true,
      };
    });

    const pending = detachAccountPushDevices(
      { rpc: vi.fn() },
      { detachWeb, detachNative },
    );
    expect(order).toEqual(['web-start', 'native-start']);

    finishWeb({
      lookupStatus: 'found',
      serverDetached: true,
      localDetached: true,
    });
    await expect(pending).resolves.toMatchObject({
      ready: true,
      serverDetached: true,
      localDetached: true,
    });
  });

  it.each([
    [
      'unknown Web subscription state',
      {
        lookupStatus: 'unknown',
        serverDetached: false,
        localDetached: false,
      },
      {
        serverDetached: true,
        localDetached: true,
        localStateCleared: true,
      },
    ],
    [
      'Web local detach failure',
      {
        lookupStatus: 'found',
        serverDetached: true,
        localDetached: false,
      },
      {
        serverDetached: true,
        localDetached: true,
        localStateCleared: true,
      },
    ],
    [
      'native server detach failure',
      {
        lookupStatus: 'missing',
        serverDetached: true,
        localDetached: true,
      },
      {
        serverDetached: false,
        localDetached: true,
        localStateCleared: true,
      },
    ],
    [
      'native local-state failure',
      {
        lookupStatus: 'missing',
        serverDetached: true,
        localDetached: true,
      },
      {
        serverDetached: true,
        localDetached: true,
        localStateCleared: false,
      },
    ],
  ])('fails closed for %s', async (_label, web, native) => {
    await expect(detachAccountPushDevices(
      {},
      {
        detachWeb: async () => web,
        detachNative: async () => native,
      },
    )).resolves.toMatchObject({
      ready: false,
    });
  });
});

function readyWebLeg(overrides = {}) {
  return {
    ready: true,
    lookupStatus: 'missing',
    serverDetached: true,
    localDetached: true,
    residualJournaled: false,
    pendingOwnerMismatch: false,
    pendingMarkerInvalid: false,
    ...overrides,
  };
}

function journaledWebLeg(overrides = {}) {
  return {
    ready: false,
    lookupStatus: 'found',
    serverDetached: false,
    localDetached: true,
    residualJournaled: true,
    pendingOwnerMismatch: false,
    pendingMarkerInvalid: false,
    ...overrides,
  };
}

function readyNativeLeg(overrides = {}) {
  return {
    ready: true,
    serverDetached: true,
    localDetached: true,
    localStateCleared: true,
    enrollmentPending: false,
    residualJournaled: false,
    pendingOwnerMismatch: false,
    pendingMarkerInvalid: false,
    ...overrides,
  };
}

function journaledNativeLeg(overrides = {}) {
  return {
    ready: false,
    serverDetached: false,
    localDetached: true,
    localStateCleared: true,
    enrollmentPending: false,
    residualJournaled: true,
    pendingOwnerMismatch: false,
    pendingMarkerInvalid: false,
    ...overrides,
  };
}

describe('detachAccountPushDevices deferral classification', () => {
  it('defers a native server residual positively covered by a same-owner journal', async () => {
    await expect(detachAccountPushDevices({}, {
      detachWeb: async () => readyWebLeg(),
      detachNative: async () => journaledNativeLeg(),
    })).resolves.toMatchObject({
      ready: false,
      deferrable: true,
    });
  });

  it('defers a web server residual positively covered by a same-owner journal', async () => {
    await expect(detachAccountPushDevices({}, {
      detachWeb: async () => journaledWebLeg(),
      detachNative: async () => readyNativeLeg(),
    })).resolves.toMatchObject({
      ready: false,
      deferrable: true,
    });
  });

  it('keeps the native provisional window on the existing ready path, not deferral', async () => {
    // Server detach proven + local revoked has always been composite-ready
    // even while the provisional journal is deliberately retained for the
    // 60-second same-owner reconciliation. Deferral must not claim (or
    // change) that pre-existing path.
    await expect(detachAccountPushDevices({}, {
      detachWeb: async () => readyWebLeg(),
      detachNative: async () => journaledNativeLeg({ serverDetached: true }),
    })).resolves.toMatchObject({
      ready: true,
      deferrable: false,
    });
  });

  it.each([
    [
      'a foreign-owner journal (native)',
      readyWebLeg(),
      journaledNativeLeg({ pendingOwnerMismatch: true }),
    ],
    [
      'an invalid journal marker (web)',
      journaledWebLeg({ pendingMarkerInvalid: true }),
      readyNativeLeg(),
    ],
    [
      'an in-flight native enrollment even with a journal',
      readyWebLeg(),
      journaledNativeLeg({ enrollmentPending: true }),
    ],
    [
      'a residual with no positively-read journal (native)',
      readyWebLeg(),
      journaledNativeLeg({ residualJournaled: false }),
    ],
    [
      'a residual with no positively-read journal (web)',
      journaledWebLeg({ residualJournaled: false }),
      readyNativeLeg(),
    ],
    [
      'a failed local revoke (native)',
      readyWebLeg(),
      journaledNativeLeg({ localDetached: false }),
    ],
    [
      'uncleared native local state',
      readyWebLeg(),
      journaledNativeLeg({ localStateCleared: false }),
    ],
    [
      'an unobservable web subscription state',
      journaledWebLeg({ lookupStatus: 'unknown' }),
      readyNativeLeg(),
    ],
    [
      'a failed web local revoke',
      journaledWebLeg({ localDetached: false }),
      readyNativeLeg(),
    ],
  ])('never defers %s', async (_label, web, native) => {
    await expect(detachAccountPushDevices({}, {
      detachWeb: async () => web,
      detachNative: async () => native,
    })).resolves.toMatchObject({
      ready: false,
      deferrable: false,
    });
  });
});

describe('cleanupAccountDeviceState', () => {
  it('suspends account state before awaiting and returns reset advice only', async () => {
    const order = [];
    let finishAccountState;
    const accountStatePending = new Promise((resolve) => {
      finishAccountState = resolve;
    });
    const clearAccountState = vi.fn(({ pushCleanup }) => {
      order.push('account-state-start');
      expect(typeof pushCleanup).toBe('function');
      return accountStatePending;
    });
    const reconcileWorker = vi.fn(async () => {
      order.push('worker');
      return { ok: true, reloadRequired: true };
    });

    const pending = cleanupAccountDeviceState(
      {},
      {
        storage: { setItem: vi.fn() },
        dependencies: {
          setBiometric: () => order.push('biometric'),
          disableMirror: () => {
            order.push('mirror');
            return true;
          },
          clearAccountState,
          reconcileWorker,
          detachPush: vi.fn(),
        },
      },
    );
    expect(order).toEqual(['biometric', 'mirror', 'account-state-start']);
    expect(reconcileWorker).not.toHaveBeenCalled();

    finishAccountState({ ready: true });
    await expect(pending).resolves.toMatchObject({
      ready: true,
      reloadRequired: true,
    });
    expect(order).toEqual([
      'biometric',
      'mirror',
      'account-state-start',
      'worker',
    ]);
  });

  it('does not claim readiness when account or worker cleanup is incomplete', async () => {
    const base = {
      storage: { setItem: vi.fn() },
      dependencies: {
        setBiometric: vi.fn(),
        disableMirror: () => true,
        detachPush: vi.fn(),
      },
    };

    await expect(cleanupAccountDeviceState({}, {
      ...base,
      dependencies: {
        ...base.dependencies,
        clearAccountState: async () => ({ ready: false }),
        reconcileWorker: async () => ({ ok: true }),
      },
    })).resolves.toMatchObject({ ready: false });

    await expect(cleanupAccountDeviceState({}, {
      ...base,
      dependencies: {
        ...base.dependencies,
        clearAccountState: async () => ({ ready: true }),
        reconcileWorker: async () => ({ ok: false }),
      },
    })).resolves.toMatchObject({ ready: false });
  });

  it('does not claim readiness when the local biometric preference cannot be cleared', async () => {
    await expect(cleanupAccountDeviceState({}, {
      storage: { setItem: vi.fn() },
      dependencies: {
        setBiometric: () => false,
        disableMirror: () => true,
        clearAccountState: async () => ({ ready: true }),
        reconcileWorker: async () => ({ ok: true }),
        detachPush: vi.fn(),
      },
    })).resolves.toMatchObject({
      ready: false,
      biometricCleared: false,
    });
  });
});

describe('cleanupAccountDeviceState deferral and bounded push retry', () => {
  function deferrableOptions({
    accountState = {
      ready: false,
      deferrable: true,
      pushWebSettled: true,
      pushNativeSettled: false,
    },
    worker = { ok: true, reloadRequired: false },
    dependencies = {},
  } = {}) {
    return {
      storage: { setItem: vi.fn() },
      dependencies: {
        setBiometric: vi.fn(),
        disableMirror: () => true,
        clearAccountState: async () => accountState,
        reconcileWorker: async () => worker,
        detachPush: vi.fn(),
        delay: async () => {},
        isOnline: () => true,
        ...dependencies,
      },
    };
  }

  it('classifies a journaled push residual as deferrable without retry opt-in', async () => {
    await expect(cleanupAccountDeviceState({}, deferrableOptions()))
      .resolves.toMatchObject({
        ready: false,
        deferrable: true,
        pushRetryAttempts: 0,
      });
  });

  it('never defers when a non-push leg failed alongside the push residual', async () => {
    await expect(cleanupAccountDeviceState({}, deferrableOptions({
      worker: { ok: false },
    }))).resolves.toMatchObject({
      ready: false,
      deferrable: false,
    });

    await expect(cleanupAccountDeviceState({}, {
      ...deferrableOptions(),
      dependencies: {
        ...deferrableOptions().dependencies,
        setBiometric: () => false,
      },
    })).resolves.toMatchObject({
      ready: false,
      deferrable: false,
    });
  });

  it('never defers when the account-state layer did not classify its failure as journaled', async () => {
    await expect(cleanupAccountDeviceState({}, deferrableOptions({
      accountState: { ready: false, deferrable: false },
    }))).resolves.toMatchObject({
      ready: false,
      deferrable: false,
      pushRetryAttempts: 0,
    });
  });

  it('merges a successful bounded retry into full readiness', async () => {
    const retryPush = vi.fn(async () => ({
      ready: true,
      ownerMismatch: false,
      markerInvalid: false,
      web: { ready: true, pending: false },
      native: { ready: true, pending: true },
    }));

    const result = await cleanupAccountDeviceState({}, {
      ...deferrableOptions({ dependencies: { retryPush } }),
      transientPushRetry: true,
    });

    expect(retryPush).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ready: true,
      deferrable: false,
      pushRetryAttempts: 1,
      pushRetryEscalated: false,
    });
    expect(result.accountState).toMatchObject({
      ready: true,
      pushCleanupReady: true,
    });
  });

  it('escalates to the blocking path when a retry discovers a foreign-owner journal', async () => {
    const retryPush = vi.fn(async () => ({
      ready: false,
      ownerMismatch: true,
      web: { ready: true, pending: false },
      native: { ready: false, pending: true },
    }));

    await expect(cleanupAccountDeviceState({}, {
      ...deferrableOptions({ dependencies: { retryPush } }),
      transientPushRetry: true,
    })).resolves.toMatchObject({
      ready: false,
      deferrable: false,
      pushRetryAttempts: 1,
      pushRetryEscalated: true,
    });
  });

  it('escalates when a residual channel reports its journal vanished, even on a ready retry', async () => {
    // pushNativeSettled=false means native had journaled residual. A retry
    // that finds no native journal (pending:false) means the durable memory
    // is gone — never launder that into success or deferral.
    const retryPush = vi.fn(async () => ({
      ready: true,
      web: { ready: true, pending: false },
      native: { ready: true, pending: false },
    }));

    await expect(cleanupAccountDeviceState({}, {
      ...deferrableOptions({ dependencies: { retryPush } }),
      transientPushRetry: true,
    })).resolves.toMatchObject({
      ready: false,
      deferrable: false,
      pushRetryAttempts: 1,
      pushRetryEscalated: true,
    });
  });

  it('accepts a settled channel legitimately reporting no journal on a later attempt', async () => {
    // First retry settles web (its journal processed and cleared); native
    // settles on the second. Web's pending:false on attempt two is expected,
    // not an escalation.
    const retryPush = vi.fn()
      .mockResolvedValueOnce({
        ready: false,
        web: { ready: true, pending: true },
        native: { ready: false, pending: true },
      })
      .mockResolvedValueOnce({
        ready: true,
        web: { ready: true, pending: false },
        native: { ready: true, pending: true },
      });

    await expect(cleanupAccountDeviceState({}, {
      ...deferrableOptions({
        accountState: {
          ready: false,
          deferrable: true,
          pushWebSettled: false,
          pushNativeSettled: false,
        },
        dependencies: { retryPush },
      }),
      transientPushRetry: true,
    })).resolves.toMatchObject({
      ready: true,
      deferrable: false,
      pushRetryAttempts: 2,
      pushRetryEscalated: false,
    });
  });

  it('skips retries while offline and leaves the residual deferrable', async () => {
    const retryPush = vi.fn();

    await expect(cleanupAccountDeviceState({}, {
      ...deferrableOptions({
        dependencies: { retryPush, isOnline: () => false },
      }),
      transientPushRetry: true,
    })).resolves.toMatchObject({
      ready: false,
      deferrable: true,
      pushRetryAttempts: 0,
    });
    expect(retryPush).not.toHaveBeenCalled();
  });

  it('bounds the retry window and stays deferrable when retries never settle', async () => {
    const retryPush = vi.fn(async () => ({
      ready: false,
      web: { ready: true, pending: true },
      native: { ready: false, pending: true },
    }));

    await expect(cleanupAccountDeviceState({}, {
      ...deferrableOptions({ dependencies: { retryPush } }),
      transientPushRetry: true,
    })).resolves.toMatchObject({
      ready: false,
      deferrable: true,
      pushRetryAttempts: 3,
      pushRetryEscalated: false,
    });
    expect(retryPush).toHaveBeenCalledTimes(3);
  });

  it('stops scheduling retries once the window is exhausted', async () => {
    let clock = 0;
    const retryPush = vi.fn(async () => {
      clock += 9_000;
      return {
        ready: false,
        web: { ready: true, pending: true },
        native: { ready: false, pending: true },
      };
    });

    await expect(cleanupAccountDeviceState({}, {
      ...deferrableOptions({
        dependencies: {
          retryPush,
          now: () => clock,
          retryWindowMs: 10_000,
          retryDelaysMs: [1_000, 2_000, 4_000],
        },
      }),
      transientPushRetry: true,
    })).resolves.toMatchObject({
      ready: false,
      deferrable: true,
      pushRetryAttempts: 1,
    });
    expect(retryPush).toHaveBeenCalledOnce();
  });
});

describe('retryPendingAccountPushDetaches', () => {
  it('fails closed when either durable journal belongs to another owner', async () => {
    const retryWeb = vi.fn(async () => ({
      ready: false,
      pending: true,
      pendingOwnerMismatch: true,
      localDetached: true,
    }));
    const retryNative = vi.fn(async () => ({
      ready: true,
      pending: false,
      pendingOwnerMismatch: false,
    }));

    await expect(retryPendingAccountPushDetaches(
      { rpc: vi.fn() },
      {
        ownerKey: 'v1.current-owner-fixture',
        storage: {},
        retryWeb,
        retryNative,
      },
    )).resolves.toMatchObject({
      ready: false,
      ownerMismatch: true,
      pending: true,
    });
    expect(retryWeb).toHaveBeenCalledOnce();
    expect(retryNative).toHaveBeenCalledOnce();
  });
});

describe('disableWebPushPolicyMirror', () => {
  it('writes only the disabled policy value and reports blocked storage', () => {
    const storage = { setItem: vi.fn() };
    expect(disableWebPushPolicyMirror(storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      '0',
    );
    expect(disableWebPushPolicyMirror({
      setItem() {
        throw new Error('blocked');
      },
    })).toBe(false);
  });
});
