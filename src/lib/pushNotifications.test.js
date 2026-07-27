/**
 * ════════════════════════════════════════════════
 * FILE: pushNotifications.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves native notification registration remembers only a database-approved
 *   device token and logout removes it. It also proves ownership conflicts and
 *   server failures cannot leave local native delivery enabled. Notification
 *   receipt and tap tests prove foreground copy stays private and only approved
 *   routes can be opened.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  pushNotifications
 *   Data:      none (Capacitor, storage, and database fakes only)
 * ════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  listeners: new Map(),
  listenerHandles: [],
  push: {
    checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    addListener: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(async () => {}),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: native.isNativePlatform },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: native.push,
}));

import {
  NATIVE_PUSH_BINDING_KEY,
  NATIVE_PUSH_PENDING_DETACH_KEY,
  detachNativePushDevice,
  isNativePushEnrollmentEnabled,
  registerPushForEmployee,
  resolveNativePushActionTarget,
  retryPendingNativePushDetach,
  startNativePushEventListeners,
} from './pushNotifications.js';

const DEVICE_TOKEN = 'synthetic-native-device-token';
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
  vi.clearAllMocks();
  vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', 'true');
  native.listeners.clear();
  native.listenerHandles.length = 0;
  native.isNativePlatform.mockReturnValue(true);
  native.push.checkPermissions.mockResolvedValue({ receive: 'granted' });
  native.push.requestPermissions.mockResolvedValue({ receive: 'granted' });
  native.push.unregister.mockResolvedValue();
  native.push.addListener.mockImplementation(async (event, callback) => {
    native.listeners.set(event, callback);
    const handle = {
      remove: vi.fn(async () => {
        if (native.listeners.get(event) === callback) {
          native.listeners.delete(event);
        }
      }),
    };
    native.listenerHandles.push(handle);
    return handle;
  });
  native.push.register.mockImplementation(async () => {
    native.listeners.get('registration')?.({ value: DEVICE_TOKEN });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerPushForEmployee', () => {
  it('defaults enrollment off unless the reviewed native build explicitly enables it', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', '');
    const db = { rpc: vi.fn(async () => null) };

    expect(isNativePushEnrollmentEnabled({})).toBe(false);
    expect(isNativePushEnrollmentEnabled({
      VITE_NATIVE_PUSH_ENABLED: 'TRUE',
    })).toBe(false);
    expect(isNativePushEnrollmentEnabled({
      VITE_NATIVE_PUSH_ENABLED: 'true',
    })).toBe(true);
    await expect(
      registerPushForEmployee(db, 'employee-fixture-a'),
    ).resolves.toEqual({
      ok: false,
      reason: 'native_push_disabled',
    });

    expect(native.push.checkPermissions).not.toHaveBeenCalled();
    expect(native.push.requestPermissions).not.toHaveBeenCalled();
    expect(native.push.register).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('persists only the token after the authenticated owner binding succeeds', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const db = { rpc: vi.fn(async () => null) };

    const result = await registerPushForEmployee(db, 'employee-fixture-a');

    expect(result).toEqual({ ok: true, token: DEVICE_TOKEN });
    expect(db.rpc).toHaveBeenCalledWith('upsert_device_token', {
      p_employee_id: 'employee-fixture-a',
      p_token: DEVICE_TOKEN,
      p_platform: 'ios',
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      NATIVE_PUSH_BINDING_KEY,
      DEVICE_TOKEN,
    );
    expect([...storage.values.keys()]).toEqual([NATIVE_PUSH_BINDING_KEY]);
    expect([...storage.values.keys()].join(' ')).not.toContain(
      'employee-fixture-a',
    );
    expect([...storage.values.values()].join(' ')).not.toContain(
      'employee-fixture-a',
    );
  });

  it('unregisters and does not persist when the owner binding fails normally', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const db = {
      rpc: vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    };

    const result = await registerPushForEmployee(db, 'employee-fixture-a');

    expect(result).toMatchObject({ ok: false });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(native.push.unregister).toHaveBeenCalledOnce();
  });

  it('fails closed and unregisters when SQLSTATE 42501 reports foreign ownership', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: 'previous-approved-token',
    });
    vi.stubGlobal('localStorage', storage);
    const ownershipError = Object.assign(
      new Error('RPC upsert_device_token: 403 {"code":"42501"}'),
      {
        status: 403,
        body: JSON.stringify({
          code: '42501',
          message: 'device token belongs to another employee',
        }),
      },
    );
    const db = { rpc: vi.fn(async () => { throw ownershipError; }) };

    const result = await registerPushForEmployee(db, 'employee-fixture-b');

    expect(result).toEqual({ ok: false, reason: 'ownership_conflict' });
    expect(native.push.unregister).toHaveBeenCalledOnce();
    expect(storage.removeItem).toHaveBeenCalledWith(
      NATIVE_PUSH_BINDING_KEY,
    );
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
  });

  it('cannot persist a token after concurrent detach invalidates enrollment', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const upsertRelease = deferred();
    const calls = [];
    const db = {
      rpc: vi.fn(async (name, args) => {
        calls.push([name, args]);
        if (name === 'upsert_device_token') {
          await upsertRelease.promise;
        }
      }),
    };

    const enrollment = registerPushForEmployee(
      db,
      'employee-fixture-a',
    );
    await vi.waitFor(() => {
      expect(db.rpc).toHaveBeenCalledWith('upsert_device_token', {
        p_employee_id: 'employee-fixture-a',
        p_token: DEVICE_TOKEN,
        p_platform: 'ios',
      });
    });

    const detach = await detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
    });
    expect(detach).toMatchObject({
      hadBinding: false,
      localDetached: true,
    });

    upsertRelease.resolve();
    await expect(enrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });

    expect(calls.map(([name]) => name)).toEqual([
      'upsert_device_token',
      'delete_device_token',
    ]);
    expect(calls[1][1]).toEqual({ p_token: DEVICE_TOKEN });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
  });

  it('does not let stale cleanup delete a newer native enrollment', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const firstUpsertRelease = deferred();
    const firstDb = {
      rpc: vi.fn(async (name) => {
        if (name === 'upsert_device_token') {
          await firstUpsertRelease.promise;
        }
      }),
    };
    const secondDb = { rpc: vi.fn(async () => null) };

    const firstEnrollment = registerPushForEmployee(
      firstDb,
      'employee-fixture-a',
    );
    await vi.waitFor(() => {
      expect(firstDb.rpc).toHaveBeenCalledWith(
        'upsert_device_token',
        expect.any(Object),
      );
    });
    await detachNativePushDevice(firstDb, {
      storage,
      timeoutMs: 50,
    });

    await expect(registerPushForEmployee(
      secondDb,
      'employee-fixture-b',
    )).resolves.toEqual({ ok: true, token: DEVICE_TOKEN });

    firstUpsertRelease.resolve();
    await expect(firstEnrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });

    expect(firstDb.rpc).toHaveBeenCalledOnce();
    expect(secondDb.rpc).toHaveBeenCalledWith('upsert_device_token', {
      p_employee_id: 'employee-fixture-b',
      p_token: DEVICE_TOKEN,
      p_platform: 'ios',
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(DEVICE_TOKEN);
  });

  it('cleans a possibly committed native upsert after its response is lost', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const upsertResponse = deferred();
    const calls = [];
    const db = {
      rpc: vi.fn(async (name, args) => {
        calls.push([name, args]);
        if (name === 'upsert_device_token') {
          await upsertResponse.promise;
        }
      }),
    };

    const enrollment = registerPushForEmployee(
      db,
      'employee-fixture-a',
    );
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await detachNativePushDevice(db, { storage, timeoutMs: 50 });

    upsertResponse.reject(new Error('response disconnected after commit'));
    await expect(enrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });

    expect(calls.map(([name]) => name)).toEqual([
      'upsert_device_token',
      'delete_device_token',
    ]);
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    expect(native.push.unregister).toHaveBeenCalledTimes(2);
  });
});

describe('detachNativePushDevice', () => {
  it('deletes the owner-scoped server token before unregistering locally', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    });
    const order = [];
    const db = {
      rpc: vi.fn(async () => {
        order.push('server');
      }),
    };
    native.push.unregister.mockImplementation(async () => {
      order.push('local');
    });

    const result = await detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
    });

    expect(db.rpc).toHaveBeenCalledWith('delete_device_token', {
      p_token: DEVICE_TOKEN,
    });
    expect(order).toEqual(['server', 'local']);
    expect(result).toMatchObject({
      ok: true,
      ready: true,
      hadBinding: true,
      hadServerBinding: true,
      serverDetached: true,
      serverCallRequired: true,
      serverCallAttempted: true,
      serverCallSucceeded: true,
      localDetached: true,
      localStateCleared: true,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
  });

  it('always unregisters and clears local state when server cleanup fails', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    });
    const db = {
      rpc: vi.fn(async () => {
        throw new Error('offline');
      }),
    };

    const result = await detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({
      ok: false,
      ready: false,
      hadBinding: true,
      serverDetached: false,
      serverCallAttempted: true,
      serverCallSucceeded: false,
      localDetached: true,
      localStateCleared: true,
    });
    expect(native.push.unregister).toHaveBeenCalledOnce();
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
  });

  it('clears remembered state even when native unregister itself fails', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    });
    const db = { rpc: vi.fn(async () => null) };
    native.push.unregister.mockRejectedValue(new Error('native unavailable'));

    const result = await detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
    });

    expect(native.push.unregister).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: false,
      ready: false,
      serverDetached: true,
      localDetached: false,
      localStateCleared: true,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
  });

  it('bounds a hanging server cleanup before local revocation', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    });
    const db = { rpc: vi.fn(() => new Promise(() => {})) };

    const result = await detachNativePushDevice(db, {
      storage,
      timeoutMs: 5,
    });

    expect(result).toMatchObject({
      ready: false,
      serverDetached: false,
      serverCallAttempted: true,
      serverCallSucceeded: false,
      localDetached: true,
      localStateCleared: true,
    });
    expect(native.push.unregister).toHaveBeenCalledOnce();
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
  });

  it('unregisters even when no remembered server binding exists', async () => {
    const storage = memoryStorage();
    const db = { rpc: vi.fn(async () => null) };

    const result = await detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
    });

    expect(db.rpc).not.toHaveBeenCalled();
    expect(native.push.unregister).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      hadBinding: false,
      hadServerBinding: false,
      ready: true,
      serverDetached: true,
      serverCallRequired: false,
      serverCallAttempted: false,
      localDetached: true,
      localStateCleared: true,
    });
  });

  it('retries a denied server delete after local unregister cleared the stored token', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    });
    const denied = Object.assign(new Error('foreign owner'), {
      code: '42501',
    });
    const db = {
      rpc: vi.fn()
        .mockRejectedValueOnce(denied)
        .mockResolvedValueOnce(null),
    };

    await expect(detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: false,
      hadBinding: true,
      serverDetached: false,
      localDetached: true,
      localStateCleared: true,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);

    await expect(detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: true,
      hadBinding: false,
      hadServerBinding: true,
      serverCallRequired: true,
      serverCallAttempted: true,
      serverCallSucceeded: true,
      serverDetached: true,
      localDetached: true,
      localStateCleared: true,
    });
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenLastCalledWith(
      'delete_device_token',
      { p_token: DEVICE_TOKEN },
    );
    expect(native.push.unregister).toHaveBeenCalledTimes(2);
  });

  it('survives reload without letting another owner consume the pending token', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    });
    const firstDb = {
      rpc: vi.fn(async () => {
        throw Object.assign(new Error('delete denied'), { code: '42501' });
      }),
    };

    await expect(detachNativePushDevice(firstDb, {
      ownerKey: OWNER_A,
      storage,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: false,
      serverDetached: false,
      localDetached: true,
      localStateCleared: true,
      markerPersisted: true,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    expect(JSON.parse(
      storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY),
    )).toMatchObject({
      ownerKey: OWNER_A,
      token: DEVICE_TOKEN,
      localDetached: true,
    });

    const wrongOwnerDb = { rpc: vi.fn(async () => null) };
    await expect(retryPendingNativePushDetach(wrongOwnerDb, {
      ownerKey: OWNER_B,
      storage,
      timeoutMs: 50,
    })).resolves.toMatchObject({
      ready: false,
      pending: true,
      pendingOwnerMismatch: true,
      localDetached: true,
      localStateCleared: true,
    });
    expect(wrongOwnerDb.rpc).not.toHaveBeenCalled();
    expect(JSON.parse(
      storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY),
    )).toMatchObject({ ownerKey: OWNER_A });

    const reloadedOwnerDb = { rpc: vi.fn(async () => null) };
    await expect(retryPendingNativePushDetach(reloadedOwnerDb, {
      ownerKey: OWNER_A,
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
      'delete_device_token',
      { p_token: DEVICE_TOKEN },
    );
    expect(storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY)).toBe(null);
  });

  it('clears stale state without invoking the native plugin on the web', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    });
    native.isNativePlatform.mockReturnValue(false);

    const result = await detachNativePushDevice(null, {
      storage,
      timeoutMs: 50,
    });

    expect(native.push.unregister).not.toHaveBeenCalled();
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    expect(result).toMatchObject({
      hadBinding: true,
      ready: false,
      serverDetached: false,
      localDetached: true,
      localStateCleared: true,
    });
  });
});

describe('native Push event listeners', () => {
  it('emits only a privacy-safe foreground refresh signal and never auto-navigates', async () => {
    const onForeground = vi.fn();
    const onTarget = vi.fn();
    const lifecycle = startNativePushEventListeners({
      onForeground,
      onTarget,
    });

    await expect(lifecycle.ready).resolves.toEqual({ ok: true });
    native.listeners.get('pushNotificationReceived')?.({
      title: 'Private customer name',
      body: 'Private job details',
      data: {
        data: {
          url: '/tech/jobs/private-job-id',
          token: 'private-token',
        },
      },
    });

    expect(onForeground).toHaveBeenCalledOnce();
    expect(onForeground).toHaveBeenCalledWith({
      source: 'native_push_foreground',
    });
    expect(onTarget).not.toHaveBeenCalled();
    expect(JSON.stringify(onForeground.mock.calls)).not.toContain(
      'Private customer name',
    );
    expect(JSON.stringify(onForeground.mock.calls)).not.toContain(
      'private-token',
    );
  });

  it('routes a background notification tap through the canonical native resolver', async () => {
    const onTarget = vi.fn();
    const lifecycle = startNativePushEventListeners({ onTarget });

    await lifecycle.ready;
    native.listeners.get('pushNotificationActionPerformed')?.({
      actionId: 'tap',
      notification: {
        data: {
          aps: { alert: { title: 'Private title' } },
          data: {
            url: '/tech/conversations?c=conversation-1',
          },
        },
      },
    });

    expect(onTarget).toHaveBeenCalledOnce();
    expect(onTarget).toHaveBeenCalledWith(
      '/tech/conversations?c=conversation-1',
      { source: 'native_push_action' },
    );
  });

  it('rejects dismissals, unsafe targets, and conflicting payload locations', () => {
    expect(resolveNativePushActionTarget({
      actionId: 'dismiss',
      notification: { data: { url: '/tech/tasks' } },
    })).toBe(null);
    expect(resolveNativePushActionTarget({
      actionId: 'tap',
      notification: { data: { url: 'https://example.com/tech' } },
    })).toBe(null);
    expect(resolveNativePushActionTarget({
      actionId: 'tap',
      notification: {
        data: {
          url: '/tech/tasks',
          data: { url: '/tech/jobs/job-1' },
        },
      },
    })).toBe(null);
    expect(resolveNativePushActionTarget({
      actionId: 'tap',
      notification: {
        data: {
          url: '/tech/admin/users',
        },
      },
    })).toBe(null);
  });

  it('stops both listeners and suppresses callbacks retained by a late native event', async () => {
    const onForeground = vi.fn();
    const onTarget = vi.fn();
    const lifecycle = startNativePushEventListeners({
      onForeground,
      onTarget,
    });

    await lifecycle.ready;
    const foreground = native.listeners.get('pushNotificationReceived');
    const action = native.listeners.get('pushNotificationActionPerformed');
    await expect(lifecycle.stop()).resolves.toBe(true);

    foreground?.({ body: 'must stay private' });
    action?.({
      actionId: 'tap',
      notification: { data: { data: { url: '/tech/tasks' } } },
    });

    expect(onForeground).not.toHaveBeenCalled();
    expect(onTarget).not.toHaveBeenCalled();
    expect(native.listeners.has('pushNotificationReceived')).toBe(false);
    expect(native.listeners.has('pushNotificationActionPerformed')).toBe(false);
  });

  it('does not enable enrollment while installing navigation listeners', async () => {
    vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', '');
    const lifecycle = startNativePushEventListeners({
      onTarget: vi.fn(),
    });

    await expect(lifecycle.ready).resolves.toEqual({ ok: true });

    expect(native.push.checkPermissions).not.toHaveBeenCalled();
    expect(native.push.requestPermissions).not.toHaveBeenCalled();
    expect(native.push.register).not.toHaveBeenCalled();
  });

  it('removes a partial listener setup and reports the listener unavailable', async () => {
    const remove = vi.fn(async () => {});
    native.push.addListener
      .mockResolvedValueOnce({ remove })
      .mockRejectedValueOnce(new Error('native listener unavailable'));
    const lifecycle = startNativePushEventListeners({
      onForeground: vi.fn(),
      onTarget: vi.fn(),
    });

    await expect(lifecycle.ready).resolves.toEqual({
      ok: false,
      reason: 'listener_unavailable',
    });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('does not install listeners on web', async () => {
    native.isNativePlatform.mockReturnValue(false);
    const lifecycle = startNativePushEventListeners({
      onForeground: vi.fn(),
      onTarget: vi.fn(),
    });

    await expect(lifecycle.ready).resolves.toEqual({
      ok: false,
      reason: 'not_native',
    });
    await expect(lifecycle.stop()).resolves.toBe(true);
    expect(native.push.addListener).not.toHaveBeenCalled();
  });
});
