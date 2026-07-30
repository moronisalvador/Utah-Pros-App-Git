/**
 * ════════════════════════════════════════════════
 * FILE: webPushClient.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves Push settings do not wait forever, transient VAPID failures can heal,
 *   first-login enable registers immediately, and logout detaches locally even
 *   when server cleanup fails.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  webPushClient
 *   Data:      none (browser/database fakes only)
 * ════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_PUSH_PENDING_DETACH_KEY,
  detachWebPushDevice,
  dropLocalWebPushSubscription,
  enablePush,
  getExistingSubscription,
  getVapidPublicKey,
  lookupExistingSubscription,
  resetVapidPublicKeyCache,
  retryPendingWebPushDetach,
} from './webPushClient.js';

const ORIGIN = 'https://app.example.test';
const OWNER_A = 'v1.owner-a-fixture-token';
const OWNER_B = 'v1.owner-b-fixture-token';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function subscription() {
  return {
    endpoint: 'https://push.example.test/device-token',
    toJSON: () => ({ keys: { p256dh: 'public-key', auth: 'auth-secret' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function activeRegistration(sub = null) {
  return {
    active: { scriptURL: `${ORIGIN}/sw.js` },
    scope: `${ORIGIN}/`,
    pushManager: {
      getSubscription: vi.fn(async () => sub),
      subscribe: vi.fn(async () => subscription()),
    },
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
    values,
  };
}

beforeEach(() => {
  resetVapidPublicKeyCache();
  vi.stubGlobal('location', { origin: ORIGIN });
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'granted') });
  vi.stubGlobal('window', {
    PushManager: function PushManager() {},
    Notification: globalThis.Notification,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VAPID configuration request', () => {
  it('does not cache a transient network failure forever', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'vapid-public-key' }),
      });

    await expect(getVapidPublicKey({ fetchImpl, timeoutMs: 20, now: 1 })).resolves.toBe('');
    await expect(getVapidPublicKey({ fetchImpl, timeoutMs: 20, now: 2 })).resolves.toBe('vapid-public-key');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('bounds a fetch implementation that ignores AbortSignal', async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    await expect(getVapidPublicKey({ fetchImpl, timeoutMs: 5, now: 1 })).resolves.toBe('');
  });

  it('caches an explicit successful unconfigured response only for its TTL', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await expect(getVapidPublicKey({ fetchImpl, now: 1 })).resolves.toBe('');
    await expect(getVapidPublicKey({ fetchImpl, now: 2 })).resolves.toBe('');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('bounded registration and subscription lifecycle', () => {
  it('returns null instead of hanging when registration lookup never settles', async () => {
    const serviceWorker = {
      getRegistration: () => new Promise(() => {}),
    };
    vi.stubGlobal('navigator', { serviceWorker });
    await expect(getExistingSubscription({ serviceWorker, timeoutMs: 5 })).resolves.toBe(null);
  });

  it('keeps the legacy read API nullable but exposes timeout as unknown to cleanup', async () => {
    const serviceWorker = {
      getRegistration: () => new Promise(() => {}),
    };
    vi.stubGlobal('navigator', { serviceWorker });

    await expect(lookupExistingSubscription({
      serviceWorker,
      timeoutMs: 5,
    })).resolves.toMatchObject({
      status: 'unknown',
      reason: 'timeout',
      subscription: null,
    });
    await expect(detachWebPushDevice(null, {
      serviceWorker,
      timeoutMs: 5,
    })).resolves.toMatchObject({
      ok: false,
      lookupStatus: 'unknown',
      reason: 'timeout',
      hadSubscription: null,
      serverDetached: false,
      localDetached: false,
    });
  });

  it('does not report local cleanup successful after a registration lookup error', async () => {
    const serviceWorker = {
      getRegistration: vi.fn(async () => {
        throw new Error('browser registration store unavailable');
      }),
    };
    vi.stubGlobal('navigator', { serviceWorker });

    await expect(dropLocalWebPushSubscription({
      serviceWorker,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ok: false,
      lookupStatus: 'unknown',
      reason: 'error',
      localDetached: false,
      hadSubscription: null,
    });
  });

  it('does not report detach successful when subscription lookup itself times out', async () => {
    const registration = activeRegistration();
    registration.pushManager.getSubscription.mockImplementation(
      () => new Promise(() => {}),
    );
    const serviceWorker = {
      getRegistration: vi.fn(async () => registration),
    };
    vi.stubGlobal('navigator', { serviceWorker });

    await expect(detachWebPushDevice(null, {
      serviceWorker,
      timeoutMs: 5,
    })).resolves.toMatchObject({
      ok: false,
      lookupStatus: 'unknown',
      reason: 'timeout',
      hadSubscription: null,
      serverDetached: false,
      localDetached: false,
    });
  });

  it('treats known subscription absence as a successful idempotent detach', async () => {
    const serviceWorker = {
      getRegistration: vi.fn(async () => null),
    };
    vi.stubGlobal('navigator', { serviceWorker });

    await expect(detachWebPushDevice(null, {
      serviceWorker,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ok: true,
      lookupStatus: 'missing',
      hadSubscription: false,
      serverDetached: true,
      localDetached: true,
    });
  });

  it('registers on the same first-login page before subscribing', async () => {
    const registration = activeRegistration();
    const serviceWorker = {
      getRegistration: vi.fn(async () => null),
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    };
    vi.stubGlobal('navigator', {
      serviceWorker,
      userAgent: 'Synthetic Browser',
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ publicKey: 'AQIDBA' }),
    })));
    const db = { rpc: vi.fn(async () => null) };

    const result = await enablePush(db, { serviceWorker, timeoutMs: 50 });

    expect(result.ok).toBe(true);
    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(registration.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(db.rpc).toHaveBeenCalledWith('upsert_push_subscription', expect.objectContaining({
      p_endpoint: 'https://push.example.test/device-token',
      p_user_agent: 'Synthetic Browser',
    }));
  });

  it('revokes local delivery even when authenticated server detach fails', async () => {
    const sub = subscription();
    const registration = activeRegistration(sub);
    const serviceWorker = {
      getRegistration: vi.fn(async () => registration),
    };
    vi.stubGlobal('navigator', { serviceWorker });
    const db = { rpc: vi.fn(async () => { throw new Error('offline'); }) };

    const result = await detachWebPushDevice(db, { serviceWorker, timeoutMs: 50 });

    expect(result).toMatchObject({
      ok: false,
      ready: false,
      hadSubscription: true,
      serverDetached: false,
      serverCallAttempted: true,
      serverCallSucceeded: false,
      localDetached: true,
    });
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
  });

  it('reports positive same-owner journal evidence when only the server delete fails', async () => {
    const storage = memoryStorage();
    const sub = subscription();
    const serviceWorker = {
      getRegistration: vi.fn(async () => activeRegistration(sub)),
    };
    vi.stubGlobal('navigator', { serviceWorker });
    const db = { rpc: vi.fn(async () => { throw new Error('offline'); }) };

    const result = await detachWebPushDevice(db, {
      ownerKey: OWNER_A,
      serviceWorker,
      storage,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({
      ready: false,
      serverDetached: false,
      localDetached: true,
      residualJournaled: true,
    });
    expect(JSON.parse(
      storage.getItem(WEB_PUSH_PENDING_DETACH_KEY),
    )).toMatchObject({ ownerKey: OWNER_A, endpoint: sub.endpoint });
  });

  it('reports no journal evidence when no owner-bound marker could persist', async () => {
    // No owner lease and no supplied ownerKey: the marker write must refuse,
    // so a failed server delete has no durable memory and must never be
    // classified as a journaled residual.
    const storage = memoryStorage();
    const sub = subscription();
    const serviceWorker = {
      getRegistration: vi.fn(async () => activeRegistration(sub)),
    };
    vi.stubGlobal('navigator', { serviceWorker });
    const db = { rpc: vi.fn(async () => { throw new Error('offline'); }) };

    const result = await detachWebPushDevice(db, {
      serviceWorker,
      storage,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({
      ready: false,
      serverDetached: false,
      residualJournaled: false,
    });
    expect(storage.getItem(WEB_PUSH_PENDING_DETACH_KEY)).toBe(null);
  });

  it('keeps journal evidence but flags unknown local state when lookup fails', async () => {
    // An unreachable service worker means nothing was observed about local
    // delivery this session. The marker (with its recorded local proof) still
    // surfaces, and lookupStatus stays 'unknown' so deferral callers refuse.
    const storage = memoryStorage({
      [WEB_PUSH_PENDING_DETACH_KEY]: JSON.stringify({
        version: 1,
        ownerKey: OWNER_A,
        endpoint: 'https://push.example.test/device-token',
        localDetached: true,
      }),
    });
    const serviceWorker = {
      getRegistration: vi.fn(async () => {
        throw new Error('service worker unavailable');
      }),
    };
    vi.stubGlobal('navigator', { serviceWorker });
    const db = { rpc: vi.fn(async () => { throw new Error('offline'); }) };

    const result = await detachWebPushDevice(db, {
      ownerKey: OWNER_A,
      serviceWorker,
      storage,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({
      ready: false,
      lookupStatus: 'unknown',
      residualJournaled: true,
    });
  });

  it('retries the same endpoint after local revoke outlives a denied void delete', async () => {
    const sub = subscription();
    const registration = activeRegistration(sub);
    const serviceWorker = {
      getRegistration: vi.fn()
        .mockResolvedValueOnce(registration)
        .mockResolvedValueOnce(null),
    };
    vi.stubGlobal('navigator', { serviceWorker });
    const denied = Object.assign(new Error('foreign owner'), {
      code: '42501',
    });
    const db = {
      rpc: vi.fn()
        .mockRejectedValueOnce(denied)
        .mockResolvedValueOnce(null),
    };

    await expect(detachWebPushDevice(db, {
      serviceWorker,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: false,
      serverDetached: false,
      localDetached: true,
    });
    expect(sub.unsubscribe).toHaveBeenCalledOnce();

    await expect(detachWebPushDevice(db, {
      serviceWorker,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: true,
      hadSubscription: false,
      serverCallRequired: true,
      serverCallAttempted: true,
      serverCallSucceeded: true,
      serverDetached: true,
      localDetached: true,
    });
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenLastCalledWith(
      'delete_push_subscription',
      { p_endpoint: sub.endpoint },
    );
  });

  it('survives reload, rejects another owner, and retries with the original owner', async () => {
    const storage = memoryStorage();
    const sub = subscription();
    const firstWorker = {
      getRegistration: vi.fn(async () => activeRegistration(sub)),
    };
    const missingWorker = {
      getRegistration: vi.fn(async () => null),
    };
    vi.stubGlobal('navigator', { serviceWorker: firstWorker });
    const firstDb = {
      rpc: vi.fn(async () => {
        throw Object.assign(new Error('delete denied'), { code: '42501' });
      }),
    };

    await expect(detachWebPushDevice(firstDb, {
      ownerKey: OWNER_A,
      serviceWorker: firstWorker,
      storage,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: false,
      localDetached: true,
      markerPersisted: true,
    });
    expect(JSON.parse(
      storage.getItem(WEB_PUSH_PENDING_DETACH_KEY),
    )).toMatchObject({
      ownerKey: OWNER_A,
      endpoint: sub.endpoint,
      localDetached: true,
    });

    const wrongOwnerDb = { rpc: vi.fn(async () => null) };
    await expect(retryPendingWebPushDetach(wrongOwnerDb, {
      ownerKey: OWNER_B,
      serviceWorker: missingWorker,
      storage,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: false,
      pending: true,
      pendingOwnerMismatch: true,
      localDetached: true,
    });
    expect(wrongOwnerDb.rpc).not.toHaveBeenCalled();
    expect(JSON.parse(
      storage.getItem(WEB_PUSH_PENDING_DETACH_KEY),
    )).toMatchObject({ ownerKey: OWNER_A });

    const reloadedOwnerDb = { rpc: vi.fn(async () => null) };
    await expect(retryPendingWebPushDetach(reloadedOwnerDb, {
      ownerKey: OWNER_A,
      serviceWorker: missingWorker,
      storage,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: true,
      pending: true,
      serverCallRequired: true,
      serverCallSucceeded: true,
      markerCleared: true,
    });
    expect(reloadedOwnerDb.rpc).toHaveBeenCalledWith(
      'delete_push_subscription',
      { p_endpoint: sub.endpoint },
    );
    expect(storage.getItem(WEB_PUSH_PENDING_DETACH_KEY)).toBe(null);
  });

  it('keeps a timed-out server detach retryable and fails when local revoke fails', async () => {
    const timedOutSub = subscription();
    const timedOutRegistration = activeRegistration(timedOutSub);
    const timeoutServiceWorker = {
      getRegistration: vi.fn(async () => timedOutRegistration),
    };
    vi.stubGlobal('navigator', {
      serviceWorker: timeoutServiceWorker,
    });
    const hangingDb = {
      rpc: vi.fn(() => new Promise(() => {})),
    };

    await expect(detachWebPushDevice(hangingDb, {
      serviceWorker: timeoutServiceWorker,
      timeoutMs: 5,
    })).resolves.toMatchObject({
      ready: false,
      serverCallAttempted: true,
      serverCallSucceeded: false,
      localDetached: true,
    });

    const localFailureSub = subscription();
    localFailureSub.unsubscribe.mockResolvedValue(false);
    const localFailureRegistration = activeRegistration(localFailureSub);
    const localFailureWorker = {
      getRegistration: vi.fn(async () => localFailureRegistration),
    };
    vi.stubGlobal('navigator', {
      serviceWorker: localFailureWorker,
    });
    const db = { rpc: vi.fn(async () => null) };

    await expect(detachWebPushDevice(db, {
      serviceWorker: localFailureWorker,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: false,
      serverCallSucceeded: true,
      serverDetached: true,
      localDetached: false,
    });
  });

  it('cannot report or retain enrollment after concurrent account detach', async () => {
    const sub = subscription();
    const registration = activeRegistration(sub);
    const serviceWorker = {
      getRegistration: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    };
    vi.stubGlobal('navigator', {
      serviceWorker,
      userAgent: 'Synthetic Browser',
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ publicKey: 'AQIDBA' }),
    })));
    const upsertRelease = deferred();
    const calls = [];
    const db = {
      rpc: vi.fn(async (name, args) => {
        calls.push([name, args]);
        if (name === 'upsert_push_subscription') {
          await upsertRelease.promise;
        }
      }),
    };

    const enrollment = enablePush(db, {
      serviceWorker,
      timeoutMs: 50,
    });
    await vi.waitFor(() => {
      expect(db.rpc).toHaveBeenCalledWith(
        'upsert_push_subscription',
        expect.objectContaining({
          p_endpoint: sub.endpoint,
        }),
      );
    });

    await expect(detachWebPushDevice(db, {
      serviceWorker,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      hadSubscription: true,
      localDetached: true,
    });

    upsertRelease.resolve();
    await expect(enrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });

    expect(calls.map(([name]) => name)).toEqual([
      'upsert_push_subscription',
      'delete_push_subscription',
      'delete_push_subscription',
    ]);
    expect(calls[2][1]).toEqual({ p_endpoint: sub.endpoint });
    expect(sub.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('does not let stale cleanup remove a newer web enrollment', async () => {
    const firstSub = subscription();
    const secondSub = {
      ...subscription(),
      endpoint: 'https://push.example.test/new-account-device-token',
    };
    const registration = activeRegistration();
    registration.pushManager.getSubscription
      .mockResolvedValueOnce(firstSub)
      .mockResolvedValueOnce(firstSub)
      .mockResolvedValueOnce(secondSub);
    const serviceWorker = {
      getRegistration: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    };
    vi.stubGlobal('navigator', {
      serviceWorker,
      userAgent: 'Synthetic Browser',
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ publicKey: 'AQIDBA' }),
    })));
    const firstUpsertRelease = deferred();
    const firstDb = {
      rpc: vi.fn(async (name) => {
        if (name === 'upsert_push_subscription') {
          await firstUpsertRelease.promise;
        }
      }),
    };
    const secondDb = { rpc: vi.fn(async () => null) };

    const firstEnrollment = enablePush(firstDb, {
      serviceWorker,
      timeoutMs: 50,
    });
    await vi.waitFor(() => {
      expect(firstDb.rpc).toHaveBeenCalledWith(
        'upsert_push_subscription',
        expect.objectContaining({ p_endpoint: firstSub.endpoint }),
      );
    });
    await detachWebPushDevice(firstDb, {
      serviceWorker,
      timeoutMs: 50,
    });

    await expect(enablePush(secondDb, {
      serviceWorker,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ok: true,
      subscription: secondSub,
    });

    firstUpsertRelease.resolve();
    await expect(firstEnrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });

    expect(firstDb.rpc).toHaveBeenCalledTimes(2);
    expect(firstDb.rpc.mock.calls[1]).toEqual([
      'delete_push_subscription',
      { p_endpoint: firstSub.endpoint },
    ]);
    expect(secondDb.rpc).toHaveBeenCalledWith(
      'upsert_push_subscription',
      expect.objectContaining({ p_endpoint: secondSub.endpoint }),
    );
    expect(secondSub.unsubscribe).not.toHaveBeenCalled();
  });

  it('cleans a possibly committed web upsert after its response is lost', async () => {
    const sub = subscription();
    const registration = activeRegistration(sub);
    const serviceWorker = {
      getRegistration: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    };
    vi.stubGlobal('navigator', {
      serviceWorker,
      userAgent: 'Synthetic Browser',
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ publicKey: 'AQIDBA' }),
    })));
    const upsertResponse = deferred();
    const calls = [];
    const db = {
      rpc: vi.fn(async (name, args) => {
        calls.push([name, args]);
        if (name === 'upsert_push_subscription') {
          await upsertResponse.promise;
        }
      }),
    };

    const enrollment = enablePush(db, {
      serviceWorker,
      timeoutMs: 50,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await detachWebPushDevice(db, { serviceWorker, timeoutMs: 50 });

    upsertResponse.reject(new Error('response disconnected after commit'));
    await expect(enrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });

    expect(calls.map(([name]) => name)).toEqual([
      'upsert_push_subscription',
      'delete_push_subscription',
      'delete_push_subscription',
    ]);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(2);
  });
});
