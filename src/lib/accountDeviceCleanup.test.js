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
