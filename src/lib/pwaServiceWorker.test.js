/**
 * ════════════════════════════════════════════════
 * FILE: pwaServiceWorker.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves service-worker feature changes converge without an unbounded ready,
 *   registration, unregister, or cache-cleanup wait.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  pwaServiceWorker
 *   Data:      none (browser API fakes only)
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createPushServiceWorkerPolicyCoordinator,
  getPushServiceWorkerRegistration,
  getReadyPushServiceWorkerRegistration,
  isPushServiceWorkerRegistration,
  lookupPushServiceWorkerRegistration,
  PUSH_SERVICE_WORKER_POLICY_KEY,
  reconcilePushServiceWorker,
} from './pwaServiceWorker.js';

const ORIGIN = 'https://app.example.test';
const registration = (path = '/sw.js', active = true) => ({
  active: active ? { scriptURL: `${ORIGIN}${path}` } : null,
  installing: active ? null : { scriptURL: `${ORIGIN}${path}` },
  unregister: vi.fn(async () => true),
  pushManager: {},
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sharedPolicyEnvironment() {
  const values = new Map();
  const contexts = [];

  const createContext = () => {
    const listeners = new Set();
    const eventTarget = {
      addEventListener: vi.fn((type, listener) => {
        if (type === 'storage') listeners.add(listener);
      }),
      removeEventListener: vi.fn((type, listener) => {
        if (type === 'storage') listeners.delete(listener);
      }),
    };
    const context = { eventTarget, listeners, storage: null };
    const storage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => {
        const oldValue = values.get(key) ?? null;
        values.set(key, value);
        for (const peer of contexts) {
          if (peer === context) continue;
          for (const listener of peer.listeners) {
            listener({
              key,
              oldValue,
              newValue: value,
              storageArea: peer.storage,
            });
          }
        }
      }),
      removeItem: vi.fn((key) => values.delete(key)),
    };
    context.storage = storage;
    contexts.push(context);
    return context;
  };

  return { createContext, values };
}

function sharedWorkerContainers({
  installedInitially = false,
  firstLookupGate = null,
  firstListingGate = null,
} = {}) {
  let installed = installedInitially;
  const worker = registration();
  worker.unregister.mockImplementation(async () => {
    installed = false;
    return true;
  });
  const makeContainer = ({ gateLookup = false, gateListing = false } = {}) => ({
    getRegistration: vi.fn(async () => {
      if (gateLookup) await firstLookupGate?.promise;
      return installed ? worker : null;
    }),
    getRegistrations: vi.fn(async () => {
      if (gateListing) await firstListingGate?.promise;
      return installed ? [worker] : [];
    }),
    register: vi.fn(async () => {
      installed = true;
      return worker;
    }),
  });
  return {
    first: makeContainer({
      gateLookup: !!firstLookupGate,
      gateListing: !!firstListingGate,
    }),
    second: makeContainer(),
    isInstalled: () => installed,
  };
}

describe('service-worker registration identity', () => {
  it('accepts only the reviewed same-origin /sw.js worker', () => {
    expect(isPushServiceWorkerRegistration(registration(), ORIGIN)).toBe(true);
    expect(isPushServiceWorkerRegistration(registration('/legacy-sw.js'), ORIGIN)).toBe(false);
    expect(isPushServiceWorkerRegistration({
      active: { scriptURL: 'https://evil.example/sw.js' },
    }, ORIGIN)).toBe(false);
  });
});

describe('reconcilePushServiceWorker', () => {
  it('reuses an existing reviewed registration', async () => {
    const existing = registration();
    const container = {
      getRegistration: vi.fn(async () => existing),
      register: vi.fn(),
    };
    const result = await reconcilePushServiceWorker(true, {
      serviceWorker: container,
      origin: ORIGIN,
    });
    expect(result).toMatchObject({ ok: true, enabled: true, changed: false });
    expect(container.register).not.toHaveBeenCalled();
  });

  it('registers immediately when authenticated policy turns on', async () => {
    const created = registration();
    const container = {
      getRegistration: vi.fn(async () => null),
      register: vi.fn(async () => created),
    };
    const result = await reconcilePushServiceWorker(true, {
      serviceWorker: container,
      origin: ORIGIN,
    });
    expect(result).toMatchObject({ ok: true, enabled: true, changed: true });
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('removes all legacy registrations and Cache API entries when policy turns off', async () => {
    const first = registration('/legacy-a.js');
    const second = registration('/legacy-b.js');
    const cacheStorage = {
      keys: vi.fn(async () => ['old-shell', 'old-assets']),
      delete: vi.fn(async () => true),
    };
    const result = await reconcilePushServiceWorker(false, {
      serviceWorker: { getRegistrations: vi.fn(async () => [first, second]) },
      cacheStorage,
      origin: ORIGIN,
    });
    expect(result).toMatchObject({
      ok: true,
      enabled: false,
      removedCount: 2,
      clearedCaches: 2,
      reloadRequired: true,
    });
    expect(cacheStorage.delete).toHaveBeenCalledTimes(2);
  });

  it('returns timeout instead of hanging on browser API failure', async () => {
    const result = await reconcilePushServiceWorker(true, {
      serviceWorker: {
        getRegistration: () => new Promise(() => {}),
        register: vi.fn(),
      },
      timeoutMs: 5,
      origin: ORIGIN,
    });
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('makes a newer disable win after an overlapping boot-time enable', async () => {
    const lookupRelease = deferred();
    let installed = false;
    const events = [];
    const created = registration();
    created.unregister.mockImplementation(async () => {
      events.push('unregister');
      installed = false;
      return true;
    });
    const container = {
      getRegistration: vi.fn(async () => {
        events.push('enable-lookup');
        await lookupRelease.promise;
        return installed ? created : null;
      }),
      register: vi.fn(async () => {
        events.push('register');
        installed = true;
        return created;
      }),
      getRegistrations: vi.fn(async () => {
        events.push('disable-list');
        return installed ? [created] : [];
      }),
    };

    const staleEnable = reconcilePushServiceWorker(true, {
      serviceWorker: container,
      cacheStorage: null,
      origin: ORIGIN,
      timeoutMs: 100,
    });
    await vi.waitFor(() => expect(container.getRegistration).toHaveBeenCalledOnce());
    const latestDisable = reconcilePushServiceWorker(false, {
      serviceWorker: container,
      cacheStorage: null,
      origin: ORIGIN,
      timeoutMs: 100,
    });

    lookupRelease.resolve();
    await expect(staleEnable).resolves.toMatchObject({
      ok: true,
      superseded: true,
      reloadRequired: false,
    });
    await expect(latestDisable).resolves.toMatchObject({
      ok: true,
      enabled: false,
      superseded: false,
    });
    expect(installed).toBe(false);
    expect(events).toEqual([
      'enable-lookup',
      'register',
      'disable-list',
      'unregister',
    ]);
  });

  it('makes a newer enable win after an overlapping desktop disable', async () => {
    const listingRelease = deferred();
    let installed = true;
    const events = [];
    const existing = registration('/legacy-worker.js');
    existing.unregister.mockImplementation(async () => {
      events.push('unregister');
      installed = false;
      return true;
    });
    const created = registration();
    const container = {
      getRegistrations: vi.fn(async () => {
        events.push('disable-list');
        await listingRelease.promise;
        return installed ? [existing] : [];
      }),
      getRegistration: vi.fn(async () => {
        events.push('enable-lookup');
        return installed ? existing : null;
      }),
      register: vi.fn(async () => {
        events.push('register');
        installed = true;
        return created;
      }),
    };

    // No standalone/mobile globals are involved: normal desktop browsers use
    // the same latest-policy-wins reconciler.
    const staleDisable = reconcilePushServiceWorker(false, {
      serviceWorker: container,
      cacheStorage: null,
      origin: ORIGIN,
      timeoutMs: 100,
    });
    await vi.waitFor(() => expect(container.getRegistrations).toHaveBeenCalledOnce());
    const latestEnable = reconcilePushServiceWorker(true, {
      serviceWorker: container,
      cacheStorage: null,
      origin: ORIGIN,
      timeoutMs: 100,
    });

    listingRelease.resolve();
    await expect(staleDisable).resolves.toMatchObject({
      ok: true,
      superseded: true,
      reloadRequired: false,
    });
    await expect(latestEnable).resolves.toMatchObject({
      ok: true,
      enabled: true,
      superseded: false,
    });
    expect(installed).toBe(true);
    expect(events).toEqual([
      'disable-list',
      'unregister',
      'enable-lookup',
      'register',
    ]);
  });
});

describe('cross-tab service-worker policy intent', () => {
  it('converges a stale in-flight enable to a newer disable from another context', async () => {
    const policy = sharedPolicyEnvironment();
    const firstContext = policy.createContext();
    const secondContext = policy.createContext();
    const lookupGate = deferred();
    const workers = sharedWorkerContainers({
      installedInitially: false,
      firstLookupGate: lookupGate,
    });
    let firstToken = 0;
    let secondToken = 0;
    const first = createPushServiceWorkerPolicyCoordinator({
      storage: firstContext.storage,
      eventTarget: firstContext.eventTarget,
      defaultOptions: {
        serviceWorker: workers.first,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 100,
      },
      makeToken: () => `first-${++firstToken}`,
    });
    const second = createPushServiceWorkerPolicyCoordinator({
      storage: secondContext.storage,
      eventTarget: secondContext.eventTarget,
      defaultOptions: {
        serviceWorker: workers.second,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 100,
      },
      makeToken: () => `second-${++secondToken}`,
    });
    first.start();
    second.start();

    const staleEnable = first.reconcile(true);
    await vi.waitFor(() => {
      expect(workers.first.getRegistration).toHaveBeenCalledOnce();
    });
    const latestDisable = second.reconcile(false);
    lookupGate.resolve();

    await Promise.all([staleEnable, latestDisable]);
    await Promise.all([first.whenIdle(), second.whenIdle()]);

    const stored = JSON.parse(
      policy.values.get(PUSH_SERVICE_WORKER_POLICY_KEY),
    );
    expect(stored).toMatchObject({ schema: 1, enabled: false });
    expect(first.readStoredIntent()).toEqual(second.readStoredIntent());
    expect(workers.isInstalled()).toBe(false);
  });

  it('converges a stale in-flight disable to a newer enable from another context', async () => {
    const policy = sharedPolicyEnvironment();
    const firstContext = policy.createContext();
    const secondContext = policy.createContext();
    const listingGate = deferred();
    const workers = sharedWorkerContainers({
      installedInitially: true,
      firstListingGate: listingGate,
    });
    let firstToken = 0;
    let secondToken = 0;
    const first = createPushServiceWorkerPolicyCoordinator({
      storage: firstContext.storage,
      eventTarget: firstContext.eventTarget,
      defaultOptions: {
        serviceWorker: workers.first,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 100,
      },
      makeToken: () => `first-${++firstToken}`,
    });
    const second = createPushServiceWorkerPolicyCoordinator({
      storage: secondContext.storage,
      eventTarget: secondContext.eventTarget,
      defaultOptions: {
        serviceWorker: workers.second,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 100,
      },
      makeToken: () => `second-${++secondToken}`,
    });
    first.start();
    second.start();

    const staleDisable = first.reconcile(false);
    await vi.waitFor(() => {
      expect(workers.first.getRegistrations).toHaveBeenCalledOnce();
    });
    const latestEnable = second.reconcile(true);
    listingGate.resolve();

    await Promise.all([staleDisable, latestEnable]);
    await Promise.all([first.whenIdle(), second.whenIdle()]);

    const stored = JSON.parse(
      policy.values.get(PUSH_SERVICE_WORKER_POLICY_KEY),
    );
    expect(stored).toMatchObject({ schema: 1, enabled: true });
    expect(first.readStoredIntent()).toEqual(second.readStoredIntent());
    expect(workers.isInstalled()).toBe(true);
  });

  it('repairs a stale registration that completes after its deadline', async () => {
    const policy = sharedPolicyEnvironment();
    const firstContext = policy.createContext();
    const secondContext = policy.createContext();
    const registerGate = deferred();
    let installed = false;
    const worker = registration();
    worker.unregister.mockImplementation(async () => {
      installed = false;
      return true;
    });
    const firstContainer = {
      getRegistration: vi.fn(async () => (installed ? worker : null)),
      getRegistrations: vi.fn(async () => (installed ? [worker] : [])),
      register: vi.fn(async () => {
        await registerGate.promise;
        installed = true;
        return worker;
      }),
    };
    const secondContainer = {
      getRegistration: vi.fn(async () => (installed ? worker : null)),
      getRegistrations: vi.fn(async () => (installed ? [worker] : [])),
      register: vi.fn(async () => {
        installed = true;
        return worker;
      }),
    };
    const first = createPushServiceWorkerPolicyCoordinator({
      storage: firstContext.storage,
      eventTarget: firstContext.eventTarget,
      defaultOptions: {
        serviceWorker: firstContainer,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 5,
      },
      makeToken: () => 'late-register-first',
    });
    const second = createPushServiceWorkerPolicyCoordinator({
      storage: secondContext.storage,
      eventTarget: secondContext.eventTarget,
      defaultOptions: {
        serviceWorker: secondContainer,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 50,
      },
      makeToken: () => 'late-register-second',
    });
    first.start();
    second.start();

    const staleEnable = first.reconcile(true);
    await vi.waitFor(() => expect(firstContainer.register).toHaveBeenCalledOnce());
    const latestDisable = second.reconcile(false);

    await Promise.all([staleEnable, latestDisable]);
    await Promise.all([first.whenIdle(), second.whenIdle()]);
    expect(installed).toBe(false);

    const removalsBeforeLateRegistration = worker.unregister.mock.calls.length;
    registerGate.resolve();
    await vi.waitFor(() => {
      expect(worker.unregister.mock.calls.length)
        .toBeGreaterThan(removalsBeforeLateRegistration);
    });
    await Promise.all([first.whenIdle(), second.whenIdle()]);

    expect(installed).toBe(false);
    expect(first.readStoredIntent()).toMatchObject({ enabled: false });
  });

  it('repairs a stale removal that completes after its deadline', async () => {
    const policy = sharedPolicyEnvironment();
    const firstContext = policy.createContext();
    const secondContext = policy.createContext();
    const unregisterGate = deferred();
    let installed = true;
    const worker = registration();
    worker.unregister.mockImplementation(async () => {
      await unregisterGate.promise;
      installed = false;
      return true;
    });
    const firstContainer = {
      getRegistration: vi.fn(async () => (installed ? worker : null)),
      getRegistrations: vi.fn(async () => (installed ? [worker] : [])),
      register: vi.fn(async () => {
        installed = true;
        return worker;
      }),
    };
    const secondContainer = {
      getRegistration: vi.fn(async () => (installed ? worker : null)),
      getRegistrations: vi.fn(async () => (installed ? [worker] : [])),
      register: vi.fn(async () => {
        installed = true;
        return worker;
      }),
    };
    const first = createPushServiceWorkerPolicyCoordinator({
      storage: firstContext.storage,
      eventTarget: firstContext.eventTarget,
      defaultOptions: {
        serviceWorker: firstContainer,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 5,
      },
      makeToken: () => 'late-remove-first',
    });
    const second = createPushServiceWorkerPolicyCoordinator({
      storage: secondContext.storage,
      eventTarget: secondContext.eventTarget,
      defaultOptions: {
        serviceWorker: secondContainer,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 50,
      },
      makeToken: () => 'late-remove-second',
    });
    first.start();
    second.start();

    const staleDisable = first.reconcile(false);
    await vi.waitFor(() => expect(worker.unregister).toHaveBeenCalled());
    const latestEnable = second.reconcile(true);

    await Promise.all([staleDisable, latestEnable]);
    await Promise.all([first.whenIdle(), second.whenIdle()]);
    expect(installed).toBe(true);

    const registrationsBeforeLateRemoval = firstContainer.register.mock.calls.length;
    unregisterGate.resolve();
    await vi.waitFor(() => {
      expect(firstContainer.register.mock.calls.length)
        .toBeGreaterThan(registrationsBeforeLateRemoval);
    });
    await Promise.all([first.whenIdle(), second.whenIdle()]);

    expect(installed).toBe(true);
    expect(first.readStoredIntent()).toMatchObject({ enabled: true });
  });

  it('installs and removes one storage listener idempotently', () => {
    const policy = sharedPolicyEnvironment();
    const context = policy.createContext();
    const coordinator = createPushServiceWorkerPolicyCoordinator({
      storage: context.storage,
      eventTarget: context.eventTarget,
      makeToken: () => 'listener-test',
    });

    const firstCleanup = coordinator.start();
    const secondCleanup = coordinator.start();
    expect(firstCleanup).toBe(secondCleanup);
    expect(context.eventTarget.addEventListener).toHaveBeenCalledOnce();

    firstCleanup();
    secondCleanup();
    expect(context.eventTarget.removeEventListener).toHaveBeenCalledOnce();

    coordinator.start();
    coordinator.stop();
    expect(context.eventTarget.addEventListener).toHaveBeenCalledTimes(2);
    expect(context.eventTarget.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('applies the final stored intent when a later context starts listening', async () => {
    const policy = sharedPolicyEnvironment();
    const context = policy.createContext();
    policy.values.set(PUSH_SERVICE_WORKER_POLICY_KEY, JSON.stringify({
      schema: 1,
      version: 7,
      enabled: true,
      token: 'already-final',
    }));
    const created = registration();
    const container = {
      getRegistration: vi.fn(async () => null),
      register: vi.fn(async () => created),
    };
    const coordinator = createPushServiceWorkerPolicyCoordinator({
      storage: context.storage,
      eventTarget: context.eventTarget,
      defaultOptions: {
        serviceWorker: container,
        cacheStorage: null,
        origin: ORIGIN,
      },
    });

    coordinator.start();
    await coordinator.whenIdle();

    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(coordinator.readStoredIntent()).toMatchObject({
      version: 7,
      enabled: true,
      token: 'already-final',
    });
  });

  it('retains latest-call-wins behavior when storage and events are blocked', async () => {
    const lookupGate = deferred();
    const workers = sharedWorkerContainers({
      installedInitially: false,
      firstLookupGate: lookupGate,
    });
    const coordinator = createPushServiceWorkerPolicyCoordinator({
      storage: {
        getItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => {
          throw new Error('storage blocked');
        },
      },
      eventTarget: null,
      defaultOptions: {
        serviceWorker: workers.first,
        cacheStorage: null,
        origin: ORIGIN,
        timeoutMs: 100,
      },
      makeToken: (() => {
        let token = 0;
        return () => `blocked-${++token}`;
      })(),
    });

    const staleEnable = coordinator.reconcile(true);
    await vi.waitFor(() => {
      expect(workers.first.getRegistration).toHaveBeenCalledOnce();
    });
    const latestDisable = coordinator.reconcile(false);
    lookupGate.resolve();

    await Promise.all([staleEnable, latestDisable]);
    await coordinator.whenIdle();
    expect(workers.isInstalled()).toBe(false);
  });
});

describe('bounded subscription registration lookup', () => {
  it('returns null for a missing registration without touching ready', async () => {
    const container = {
      getRegistration: vi.fn(async () => null),
      ready: new Promise(() => {}),
    };
    await expect(getPushServiceWorkerRegistration({
      serviceWorker: container,
      origin: ORIGIN,
      timeoutMs: 5,
    })).resolves.toBe(null);
  });

  it('bounds activation readiness after registration', async () => {
    const installing = registration('/sw.js', false);
    const container = {
      getRegistration: vi.fn(async () => installing),
      register: vi.fn(),
      ready: new Promise(() => {}),
    };
    await expect(getReadyPushServiceWorkerRegistration({
      serviceWorker: container,
      origin: ORIGIN,
      timeoutMs: 5,
    })).resolves.toBe(null);
  });

  it('distinguishes a failed registration lookup from known absence', async () => {
    const missing = await lookupPushServiceWorkerRegistration({
      serviceWorker: { getRegistration: vi.fn(async () => null) },
      origin: ORIGIN,
      timeoutMs: 5,
    });
    const unknown = await lookupPushServiceWorkerRegistration({
      serviceWorker: { getRegistration: () => new Promise(() => {}) },
      origin: ORIGIN,
      timeoutMs: 5,
    });

    expect(missing).toEqual({ status: 'missing', registration: null });
    expect(unknown).toMatchObject({
      status: 'unknown',
      registration: null,
      reason: 'timeout',
    });
  });
});
