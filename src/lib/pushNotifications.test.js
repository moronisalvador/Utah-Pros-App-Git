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
    removeAllDeliveredNotifications: vi.fn(async () => {}),
    unregister: vi.fn(async () => {}),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: native.isNativePlatform },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: native.push,
}));

const appInfo = vi.hoisted(() => ({
  getInstalledAppBundleId: vi.fn(async () => 'com.example.upr.dev'),
}));

vi.mock('./nativeAppInfo.js', () => ({
  getInstalledAppBundleId: appInfo.getInstalledAppBundleId,
}));

import {
  NATIVE_PUSH_BINDING_KEY,
  NATIVE_PUSH_PENDING_DETACH_KEY,
  NATIVE_PUSH_PROVISIONAL_RECONCILE_MS,
  NATIVE_PUSH_USER_ENABLED_KEY,
  detachNativePushDevice,
  disableNativePushForDevice,
  enableNativePushForEmployee,
  getNativePushStatus,
  hasNativePushDeviceBinding,
  isNativePushEnrollmentEnabled,
  isNativePushUserEnabled,
  nativeApnsEnvironment,
  nativePushRecipientBinding,
  registerPushForEmployee,
  resolveNativePushActionTarget,
  retryPendingNativePushDetach,
  startNativePushEventListeners,
} from './pushNotifications.js';

const DEVICE_TOKEN = 'synthetic-native-device-token';
const BUNDLE_ID = 'com.example.upr.dev';
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

function preferenceValue(ownerKey = OWNER_A, enabled = true) {
  return JSON.stringify({
    version: 2,
    ownerKey,
    enabled,
  });
}

function memoryStorage(initial = {}, {
  includePreference = true,
  preferenceOwner = OWNER_A,
} = {}) {
  const values = new Map(Object.entries({
    ...(includePreference
      ? {
        [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(
          preferenceOwner,
          true,
        ),
      }
      : {}),
    ...initial,
  }));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
    values,
  };
}

function readPreference(storage) {
  return JSON.parse(storage.getItem(NATIVE_PUSH_USER_ENABLED_KEY));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', 'true');
  vi.stubEnv('VITE_APNS_ENV', 'sandbox');
  native.listeners.clear();
  native.listenerHandles.length = 0;
  native.isNativePlatform.mockReturnValue(true);
  appInfo.getInstalledAppBundleId.mockResolvedValue(BUNDLE_ID);
  native.push.checkPermissions.mockResolvedValue({ receive: 'granted' });
  native.push.requestPermissions.mockResolvedValue({ receive: 'granted' });
  native.push.removeAllDeliveredNotifications.mockResolvedValue();
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
  it('honors a durable user opt-out before permission, APNs, or database work', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_USER_ENABLED_KEY]: 'false',
    });
    vi.stubGlobal('localStorage', storage);
    const db = { rpc: vi.fn(async () => null) };

    await expect(
      registerPushForEmployee(
        db,
        'employee-fixture-a',
        { storage, ownerKey: OWNER_A },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: 'user_disabled',
    });

    expect(isNativePushUserEnabled(storage, OWNER_A)).toBe(false);
    expect(hasNativePushDeviceBinding(storage)).toBe(false);
    expect(native.push.checkPermissions).not.toHaveBeenCalled();
    expect(native.push.requestPermissions).not.toHaveBeenCalled();
    expect(native.push.register).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('migrates missing intent on only for an already verified local binding', () => {
    const fresh = memoryStorage({}, { includePreference: false });
    const legacyBound = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    }, { includePreference: false });

    expect(isNativePushUserEnabled(fresh, OWNER_A)).toBe(false);
    expect(isNativePushUserEnabled(legacyBound, OWNER_A)).toBe(true);
    expect(readPreference(legacyBound)).toEqual({
      version: 2,
      ownerKey: OWNER_A,
      enabled: true,
    });
  });

  it('fails closed when durable preference storage is unavailable', async () => {
    const throwingStorage = {
      getItem: vi.fn(() => { throw new Error('storage blocked'); }),
      setItem: vi.fn(() => { throw new Error('storage blocked'); }),
      removeItem: vi.fn(() => { throw new Error('storage blocked'); }),
    };
    const db = { rpc: vi.fn(async () => null) };

    expect(isNativePushUserEnabled(null, OWNER_A)).toBe(false);
    expect(isNativePushUserEnabled(throwingStorage, OWNER_A)).toBe(false);
    await expect(registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage: throwingStorage, ownerKey: OWNER_A },
    )).resolves.toEqual({
      ok: false,
      reason: 'user_disabled',
    });
    expect(native.push.checkPermissions).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('defaults enrollment off unless the reviewed native build explicitly enables it', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', '');
    const db = { rpc: vi.fn(async () => null) };

    expect(isNativePushEnrollmentEnabled({})).toBe(false);
    expect(isNativePushEnrollmentEnabled({
      VITE_NATIVE_PUSH_ENABLED: 'TRUE',
      VITE_APNS_ENV: 'sandbox',
    })).toBe(false);
    expect(isNativePushEnrollmentEnabled({
      VITE_NATIVE_PUSH_ENABLED: 'true',
      VITE_APNS_ENV: 'sandbox',
    })).toBe(true);
    expect(isNativePushEnrollmentEnabled({
      VITE_NATIVE_PUSH_ENABLED: 'true',
      VITE_APNS_ENV: 'staging',
    })).toBe(false);
    expect(nativeApnsEnvironment({ VITE_APNS_ENV: 'production' }))
      .toBe('production');
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

    const result = await registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );

    expect(result).toEqual({ ok: true, token: DEVICE_TOKEN });
    expect(db.rpc).toHaveBeenCalledWith('upsert_my_native_device_token', {
      p_token: DEVICE_TOKEN,
      p_apns_environment: 'sandbox',
      p_apns_topic: BUNDLE_ID,
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      NATIVE_PUSH_BINDING_KEY,
      DEVICE_TOKEN,
    );
    expect([...storage.values.keys()]).toEqual([
      NATIVE_PUSH_USER_ENABLED_KEY,
      NATIVE_PUSH_BINDING_KEY,
    ]);
    expect([...storage.values.keys()].join(' ')).not.toContain(
      'employee-fixture-a',
    );
    expect([...storage.values.values()].join(' ')).not.toContain(
      'employee-fixture-a',
    );
  });

  it('still enrolls with a null topic when the installed bundle id is unresolvable', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    appInfo.getInstalledAppBundleId.mockResolvedValue(null);
    const db = { rpc: vi.fn(async () => null) };

    await expect(registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    )).resolves.toEqual({ ok: true, token: DEVICE_TOKEN });

    expect(db.rpc).toHaveBeenCalledWith('upsert_my_native_device_token', {
      p_token: DEVICE_TOKEN,
      p_apns_environment: 'sandbox',
      p_apns_topic: null,
    });
  });

  it('still enrolls with a null topic when the bundle id lookup throws', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    appInfo.getInstalledAppBundleId.mockRejectedValue(
      new Error('App plugin unavailable'),
    );
    const db = { rpc: vi.fn(async () => null) };

    await expect(registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    )).resolves.toEqual({ ok: true, token: DEVICE_TOKEN });

    expect(db.rpc).toHaveBeenCalledWith('upsert_my_native_device_token', {
      p_token: DEVICE_TOKEN,
      p_apns_environment: 'sandbox',
      p_apns_topic: null,
    });
  });

  it('does not touch APNs or the database when the environment is malformed', async () => {
    vi.stubEnv('VITE_APNS_ENV', 'staging');
    const db = { rpc: vi.fn(async () => null) };

    await expect(
      registerPushForEmployee(db, 'employee-fixture-a'),
    ).resolves.toEqual({
      ok: false,
      reason: 'native_push_misconfigured',
    });

    expect(native.push.checkPermissions).not.toHaveBeenCalled();
    expect(native.push.register).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('unregisters and does not persist when the owner binding fails normally', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const db = {
      rpc: vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    };

    const result = await registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );

    expect(result).toMatchObject({ ok: false });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    expect(JSON.parse(
      storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY),
    )).toMatchObject({
      ownerKey: OWNER_A,
      token: DEVICE_TOKEN,
      localDetached: true,
    });
    expect(native.push.unregister).toHaveBeenCalled();
  });

  it('fails closed and unregisters when SQLSTATE 42501 reports foreign ownership', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: 'previous-approved-token',
    }, { preferenceOwner: OWNER_B });
    vi.stubGlobal('localStorage', storage);
    const ownershipError = Object.assign(
      new Error('RPC upsert_my_native_device_token: 403 {"code":"42501"}'),
      {
        status: 403,
        body: JSON.stringify({
          code: '42501',
          message: 'NOT_AUTHORIZED: device token belongs to another employee',
        }),
      },
    );
    const db = { rpc: vi.fn(async () => { throw ownershipError; }) };

    const result = await registerPushForEmployee(
      db,
      'employee-fixture-b',
      { storage, ownerKey: OWNER_B },
    );

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
        if (name === 'upsert_my_native_device_token') {
          await upsertRelease.promise;
        }
      }),
    };

    const enrollment = registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );
    await vi.waitFor(() => {
      expect(db.rpc).toHaveBeenCalledWith('upsert_my_native_device_token', {
        p_token: DEVICE_TOKEN,
        p_apns_environment: 'sandbox',
        p_apns_topic: BUNDLE_ID,
      });
    });

    const detach = await detachNativePushDevice(db, {
      ownerKey: OWNER_A,
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
      'upsert_my_native_device_token',
      'delete_my_native_device_token',
      'delete_my_native_device_token',
    ]);
    expect(calls[1][1]).toEqual({ p_token: DEVICE_TOKEN });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    expect(storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY)).toBe(null);
  });

  it('does not let stale cleanup delete a newer native enrollment', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const firstUpsertRelease = deferred();
    const firstDb = {
      rpc: vi.fn(async (name) => {
        if (name === 'upsert_my_native_device_token') {
          await firstUpsertRelease.promise;
        }
      }),
    };
    const secondDb = { rpc: vi.fn(async () => null) };

    const firstEnrollment = registerPushForEmployee(
      firstDb,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );
    await vi.waitFor(() => {
      expect(firstDb.rpc).toHaveBeenCalledWith(
        'upsert_my_native_device_token',
        expect.any(Object),
      );
    });
    await detachNativePushDevice(firstDb, {
      ownerKey: OWNER_A,
      storage,
      timeoutMs: 50,
    });

    await expect(registerPushForEmployee(
      secondDb,
      'employee-fixture-b',
      { storage, ownerKey: OWNER_B },
    )).resolves.toEqual({
      ok: false,
      reason: 'user_disabled',
    });

    firstUpsertRelease.resolve();
    await expect(firstEnrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });

    await expect(registerPushForEmployee(
      secondDb,
      'employee-fixture-b',
      { storage, ownerKey: OWNER_B },
    )).resolves.toEqual({ ok: false, reason: 'user_disabled' });
    expect(secondDb.rpc).not.toHaveBeenCalled();

    await expect(enableNativePushForEmployee(
      secondDb,
      'employee-fixture-b',
      { storage, ownerKey: OWNER_B },
    )).resolves.toEqual({ ok: true, token: DEVICE_TOKEN });
    expect(secondDb.rpc).toHaveBeenCalledWith('upsert_my_native_device_token', {
      p_token: DEVICE_TOKEN,
      p_apns_environment: 'sandbox',
      p_apns_topic: BUNDLE_ID,
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
        if (name === 'upsert_my_native_device_token') {
          await upsertResponse.promise;
        }
      }),
    };

    const enrollment = registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await detachNativePushDevice(db, {
      ownerKey: OWNER_A,
      storage,
      timeoutMs: 50,
    });

    upsertResponse.reject(new Error('response disconnected after commit'));
    await expect(enrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });

    expect(calls.map(([name]) => name)).toEqual([
      'upsert_my_native_device_token',
      'delete_my_native_device_token',
      'delete_my_native_device_token',
    ]);
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    expect(native.push.unregister).toHaveBeenCalledTimes(3);
  });
});

describe('user-controlled native Push preference', () => {
  it('does not carry one account push opt-in into another account', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(OWNER_A, true),
    });
    const db = { rpc: vi.fn(async () => null) };

    expect(isNativePushUserEnabled(storage, OWNER_A)).toBe(true);
    expect(isNativePushUserEnabled(storage, OWNER_B)).toBe(false);
    await expect(registerPushForEmployee(
      db,
      'employee-fixture-b',
      { storage, ownerKey: OWNER_B },
    )).resolves.toEqual({
      ok: false,
      reason: 'user_disabled',
    });

    expect(native.push.checkPermissions).not.toHaveBeenCalled();
    expect(native.push.requestPermissions).not.toHaveBeenCalled();
    expect(native.push.register).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('reports current iOS permission without exposing the device token', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
      [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(OWNER_A, true),
    });
    native.push.checkPermissions.mockResolvedValue({ receive: 'denied' });

    const status = await getNativePushStatus({
      storage,
      timeoutMs: 50,
      ownerKey: OWNER_A,
    });

    expect(status).toEqual({
      available: true,
      bound: true,
      enabled: false,
      intentEnabled: true,
      native: true,
      pending: false,
      permission: 'denied',
    });
    expect(JSON.stringify(status)).not.toContain(DEVICE_TOKEN);
  });

  it('treats a permission check failure as unknown instead of claiming delivery', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
    });
    native.push.checkPermissions.mockRejectedValue(
      new Error('native bridge unavailable'),
    );

    await expect(getNativePushStatus({
      storage,
      timeoutMs: 50,
      ownerKey: OWNER_A,
    })).resolves.toMatchObject({
      bound: true,
      enabled: false,
      intentEnabled: true,
      permission: 'unknown',
    });
  });

  it('enables by persisting intent and then binding the APNs token', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(OWNER_A, false),
    });
    vi.stubGlobal('localStorage', storage);
    const db = { rpc: vi.fn(async () => null) };

    await expect(enableNativePushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    )).resolves.toEqual({ ok: true, token: DEVICE_TOKEN });

    expect(readPreference(storage)).toEqual({
      version: 2,
      ownerKey: OWNER_A,
      enabled: true,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(DEVICE_TOKEN);
    expect(db.rpc).toHaveBeenCalledWith('upsert_my_native_device_token', {
      p_token: DEVICE_TOKEN,
      p_apns_environment: 'sandbox',
      p_apns_topic: BUNDLE_ID,
    });
  });

  it('joins the same-owner Auth enrollment instead of treating its marker as stale cleanup', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(OWNER_A, true),
    });
    vi.stubGlobal('localStorage', storage);
    const upsertRelease = deferred();
    const db = {
      rpc: vi.fn(async (name) => {
        if (name === 'upsert_my_native_device_token') {
          await upsertRelease.promise;
        }
        return null;
      }),
    };

    const authEnrollment = registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );
    await vi.waitFor(() => {
      expect(JSON.parse(
        storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY),
      )).toMatchObject({
        ownerKey: OWNER_A,
        phase: 'enrolling_provisional',
      });
    });

    const settingsEnrollment = enableNativePushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );
    upsertRelease.resolve();

    await expect(authEnrollment).resolves.toEqual({
      ok: true,
      token: DEVICE_TOKEN,
    });
    await expect(settingsEnrollment).resolves.toEqual({
      ok: true,
      token: DEVICE_TOKEN,
    });
    expect(readPreference(storage)).toEqual({
      version: 2,
      ownerKey: OWNER_A,
      enabled: true,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(DEVICE_TOKEN);
    expect(db.rpc.mock.calls.filter(
      ([name]) => name === 'upsert_my_native_device_token',
    )).toHaveLength(1);
    expect(db.rpc).not.toHaveBeenCalledWith(
      'delete_my_native_device_token',
      expect.anything(),
    );
  });

  it('returns failed explicit enrollment to durable off', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(OWNER_A, false),
    });
    vi.stubGlobal('localStorage', storage);
    native.push.checkPermissions.mockResolvedValue({ receive: 'denied' });
    native.push.requestPermissions.mockResolvedValue({ receive: 'denied' });
    const db = { rpc: vi.fn(async () => null) };

    await expect(enableNativePushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    )).resolves.toEqual({
      ok: false,
      reason: 'permission_denied',
    });

    expect(readPreference(storage)).toEqual({
      version: 2,
      ownerKey: OWNER_A,
      enabled: false,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    expect(native.push.register).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns a response-lost explicit enrollment to off and deletes a possible late commit', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(OWNER_A, false),
    });
    vi.stubGlobal('localStorage', storage);
    const calls = [];
    const db = {
      rpc: vi.fn(async (name, args) => {
        calls.push([name, args]);
        if (name === 'upsert_my_native_device_token') {
          throw new Error('response disconnected after commit');
        }
        return null;
      }),
    };

    await expect(enableNativePushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    )).resolves.toMatchObject({
      ok: false,
      reason: 'response disconnected after commit',
    });

    expect(readPreference(storage)).toEqual({
      version: 2,
      ownerKey: OWNER_A,
      enabled: false,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    const provisional = JSON.parse(
      storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY),
    );
    expect(provisional).toMatchObject({
      ownerKey: OWNER_A,
      token: DEVICE_TOKEN,
      localDetached: true,
      phase: 'enrolling_provisional',
    });
    expect(calls).toEqual([
      [
        'upsert_my_native_device_token',
        {
          p_token: DEVICE_TOKEN,
          p_apns_environment: 'sandbox',
          p_apns_topic: BUNDLE_ID,
        },
      ],
      [
        'delete_my_native_device_token',
        { p_token: DEVICE_TOKEN },
      ],
    ]);
    expect(native.push.unregister).toHaveBeenCalled();

    await expect(retryPendingNativePushDetach(db, {
      storage,
      ownerKey: OWNER_A,
      now: (
        provisional.createdAt
        + NATIVE_PUSH_PROVISIONAL_RECONCILE_MS
        + 1
      ),
    })).resolves.toMatchObject({
      ready: true,
      provisionalMature: true,
    });
    expect(storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY)).toBe(null);
    expect(calls.at(-1)).toEqual([
      'delete_my_native_device_token',
      { p_token: DEVICE_TOKEN },
    ]);
  });

  it('persists off before detaching so a restart cannot auto-enroll', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: DEVICE_TOKEN,
      [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(OWNER_A, true),
    });
    vi.stubGlobal('localStorage', storage);
    const observedPreference = [];
    const db = {
      rpc: vi.fn(async () => {
        observedPreference.push(
          readPreference(storage),
        );
      }),
    };

    await expect(disableNativePushForDevice(db, {
      storage,
      ownerKey: OWNER_A,
    })).resolves.toMatchObject({
      ok: true,
      ready: true,
      preferenceStored: true,
      localDetached: true,
      localStateCleared: true,
    });

    expect(observedPreference).toEqual([{
      version: 2,
      ownerKey: OWNER_A,
      enabled: false,
    }]);
    expect(readPreference(storage)).toEqual({
      version: 2,
      ownerKey: OWNER_A,
      enabled: false,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    await expect(registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    )).resolves.toEqual({
      ok: false,
      reason: 'user_disabled',
    });
    expect(native.push.checkPermissions).not.toHaveBeenCalled();
  });

  it('lets an explicit disable win over an in-flight enrollment', async () => {
    const storage = memoryStorage({
      [NATIVE_PUSH_USER_ENABLED_KEY]: preferenceValue(OWNER_A, true),
    });
    vi.stubGlobal('localStorage', storage);
    const upsertRelease = deferred();
    const db = {
      rpc: vi.fn(async (name) => {
        if (name === 'upsert_my_native_device_token') {
          await upsertRelease.promise;
        }
      }),
    };

    const enrollment = registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );
    await vi.waitFor(() => {
      expect(db.rpc).toHaveBeenCalledWith(
        'upsert_my_native_device_token',
        expect.any(Object),
      );
    });

    await disableNativePushForDevice(db, {
      storage,
      ownerKey: OWNER_A,
    });
    upsertRelease.resolve();

    await expect(enrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });
    expect(readPreference(storage)).toEqual({
      version: 2,
      ownerKey: OWNER_A,
      enabled: false,
    });
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
    expect(db.rpc).toHaveBeenCalledWith(
      'delete_my_native_device_token',
      { p_token: DEVICE_TOKEN },
    );
  });

  it('does not claim off when durable preference storage fails', async () => {
    const values = new Map([
      [NATIVE_PUSH_BINDING_KEY, DEVICE_TOKEN],
      [
        NATIVE_PUSH_USER_ENABLED_KEY,
        preferenceValue(OWNER_A, true),
      ],
    ]);
    const storage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => {
        if (key === NATIVE_PUSH_USER_ENABLED_KEY) {
          throw new Error('storage blocked');
        }
        values.set(key, value);
      }),
      removeItem: vi.fn((key) => values.delete(key)),
    };
    const db = { rpc: vi.fn(async () => null) };

    await expect(disableNativePushForDevice(db, {
      storage,
      ownerKey: OWNER_A,
    })).resolves.toMatchObject({
      ok: false,
      ready: false,
      preferenceStored: false,
      localDetached: true,
      localStateCleared: true,
    });
  });
});

describe('detachNativePushDevice', () => {
  it('clears a crashed provisional marker when 42501 proves the attempted owner never acquired it', async () => {
    const createdAt = Date.now();
    const storage = memoryStorage({
      [NATIVE_PUSH_PENDING_DETACH_KEY]: JSON.stringify({
        version: 2,
        ownerKey: OWNER_B,
        token: DEVICE_TOKEN,
        localDetached: false,
        phase: 'enrolling_provisional',
        createdAt,
      }),
    });
    const db = {
      rpc: vi.fn(async () => {
        throw Object.assign(
          new Error(
            'NOT_AUTHORIZED: device token belongs to another employee',
          ),
          {
            code: '42501',
            body: JSON.stringify({
              code: '42501',
              message: 'NOT_AUTHORIZED: device token belongs to another employee',
            }),
          },
        );
      }),
    };

    await expect(retryPendingNativePushDetach(db, {
      storage,
      ownerKey: OWNER_B,
      now: createdAt + 1,
    })).resolves.toMatchObject({
      ready: true,
      markerCleared: true,
      provisionalMature: false,
      provisionalOwnershipCleared: true,
    });
    expect(storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY)).toBe(null);
    expect(storage.getItem(NATIVE_PUSH_BINDING_KEY)).toBe(null);
  });

  it.each([
    ['malformed body', '{"code":'],
    [
      'nested fields',
      JSON.stringify({
        error: {
          code: '42501',
          message: 'NOT_AUTHORIZED: device token belongs to another employee',
        },
      }),
    ],
    [
      'partial code',
      JSON.stringify({
        code: '142501',
        message: 'NOT_AUTHORIZED: device token belongs to another employee',
      }),
    ],
    [
      'unrelated message',
      JSON.stringify({
        code: '42501',
        message: 'NOT_AUTHORIZED: active internal employee required',
      }),
    ],
  ])('retains a provisional marker for %s despite spoofed error text', async (_label, body) => {
    const createdAt = Date.now();
    const storage = memoryStorage({
      [NATIVE_PUSH_PENDING_DETACH_KEY]: JSON.stringify({
        version: 2,
        ownerKey: OWNER_A,
        token: DEVICE_TOKEN,
        localDetached: false,
        phase: 'enrolling_provisional',
        createdAt,
      }),
    });
    const db = {
      rpc: vi.fn(async () => {
        throw Object.assign(
          new Error(
            '42501 NOT_AUTHORIZED: device token belongs to another employee',
          ),
          { code: '42501', body },
        );
      }),
    };

    await expect(retryPendingNativePushDetach(db, {
      storage,
      ownerKey: OWNER_A,
      now: createdAt + 1,
    })).resolves.toMatchObject({
      ready: false,
      markerCleared: false,
      provisionalOwnershipCleared: false,
      serverDetached: false,
    });
    expect(JSON.parse(
      storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY),
    )).toMatchObject({
      ownerKey: OWNER_A,
      token: DEVICE_TOKEN,
      phase: 'enrolling_provisional',
    });
  });

  it('retains a provisional marker for a non-ownership 42501 denial', async () => {
    const createdAt = Date.now();
    const storage = memoryStorage({
      [NATIVE_PUSH_PENDING_DETACH_KEY]: JSON.stringify({
        version: 2,
        ownerKey: OWNER_A,
        token: DEVICE_TOKEN,
        localDetached: false,
        phase: 'enrolling_provisional',
        createdAt,
      }),
    });
    const db = {
      rpc: vi.fn(async () => {
        throw Object.assign(
          new Error('NOT_AUTHORIZED: active internal employee required'),
          { code: '42501' },
        );
      }),
    };

    await expect(retryPendingNativePushDetach(db, {
      storage,
      ownerKey: OWNER_A,
      now: createdAt + 1,
    })).resolves.toMatchObject({
      ready: false,
      markerCleared: false,
      provisionalOwnershipCleared: false,
      serverDetached: false,
    });
    expect(JSON.parse(
      storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY),
    )).toMatchObject({
      ownerKey: OWNER_A,
      token: DEVICE_TOKEN,
      phase: 'enrolling_provisional',
    });
  });

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

    expect(db.rpc).toHaveBeenCalledWith('delete_my_native_device_token', {
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
      'delete_my_native_device_token',
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
      'delete_my_native_device_token',
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

  it('reports positive same-owner journal evidence when only the server delete fails', async () => {
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
      ownerKey: OWNER_A,
    });

    expect(result).toMatchObject({
      ready: false,
      serverDetached: false,
      localDetached: true,
      localStateCleared: true,
      enrollmentPending: false,
      residualJournaled: true,
    });
    const marker = JSON.parse(
      storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY),
    );
    expect(marker.ownerKey).toBe(OWNER_A);
    expect(marker.token).toBe(DEVICE_TOKEN);
  });

  it('reports no journal evidence when no owner-bound marker could persist', async () => {
    // No owner lease and no supplied ownerKey: the marker write must refuse,
    // so a failed server delete has no durable memory and must never be
    // classified as a journaled residual.
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
      ready: false,
      serverDetached: false,
      residualJournaled: false,
    });
    expect(storage.getItem(NATIVE_PUSH_PENDING_DETACH_KEY)).toBe(null);
  });

  it('surfaces an in-flight enrollment with no marker as unjournaled residual', async () => {
    // The pre-token enrollment window: registration started but APNs has not
    // returned a token, so no provisional marker exists yet. Detach must
    // report enrollmentPending and no journal evidence — this state is never
    // safe to defer because the enrollment may still commit an upsert later.
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    native.push.register.mockImplementation(async () => {});
    const db = { rpc: vi.fn(async () => null) };

    const enrollment = registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );
    await vi.waitFor(() => {
      expect(native.push.register).toHaveBeenCalled();
    });

    const result = await detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
      ownerKey: OWNER_A,
    });

    expect(result).toMatchObject({
      ready: false,
      enrollmentPending: true,
      residualJournaled: false,
    });

    native.listeners.get('registration')?.({ value: DEVICE_TOKEN });
    await expect(enrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });
  });

  it('keeps journal evidence when an ambiguous in-flight upsert is detached', async () => {
    // Mid-upsert the provisional marker is durable, so the residual IS
    // journaled — but enrollmentPending must still be surfaced so callers
    // refuse to defer until the possibly committed upsert settles.
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const upsertRelease = deferred();
    const db = {
      rpc: vi.fn(async (name) => {
        if (name === 'upsert_my_native_device_token') {
          await upsertRelease.promise;
        }
      }),
    };

    const enrollment = registerPushForEmployee(
      db,
      'employee-fixture-a',
      { storage, ownerKey: OWNER_A },
    );
    await vi.waitFor(() => {
      expect(db.rpc).toHaveBeenCalledWith(
        'upsert_my_native_device_token',
        expect.any(Object),
      );
    });

    const result = await detachNativePushDevice(db, {
      storage,
      timeoutMs: 50,
      ownerKey: OWNER_A,
    });

    expect(result).toMatchObject({
      ready: false,
      enrollmentPending: true,
      residualJournaled: true,
    });

    upsertRelease.resolve();
    await expect(enrollment).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
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
    const employeeId = 'employee-fixture-a';
    const recipient = await nativePushRecipientBinding(employeeId);
    const lifecycle = startNativePushEventListeners({
      employeeId,
      onTarget,
    });

    await lifecycle.ready;
    native.listeners.get('pushNotificationActionPerformed')?.({
      actionId: 'tap',
      notification: {
        data: {
          aps: { alert: { title: 'Private title' } },
          data: {
            url: '/tech/conversations?c=conversation-1',
            recipient,
          },
        },
      },
    });
    await vi.waitFor(() => expect(onTarget).toHaveBeenCalledOnce());

    expect(onTarget).toHaveBeenCalledWith(
      '/tech/conversations?c=conversation-1',
      { source: 'native_push_action' },
    );
  });

  it('rejects dismissals, unsafe targets, and conflicting payload locations', async () => {
    const employeeId = 'employee-fixture-a';
    const recipient = await nativePushRecipientBinding(employeeId);
    await expect(resolveNativePushActionTarget({
      actionId: 'dismiss',
      notification: { data: { url: '/tech/tasks', recipient } },
    }, { employeeId })).resolves.toBe(null);
    await expect(resolveNativePushActionTarget({
      actionId: 'tap',
      notification: {
        data: { url: 'https://example.com/tech', recipient },
      },
    }, { employeeId })).resolves.toBe(null);
    await expect(resolveNativePushActionTarget({
      actionId: 'tap',
      notification: {
        data: {
          url: '/tech/tasks',
          recipient,
          data: { url: '/tech/jobs/job-1', recipient },
        },
      },
    }, { employeeId })).resolves.toBe(null);
    await expect(resolveNativePushActionTarget({
      actionId: 'tap',
      notification: {
        data: {
          url: '/tech/admin/users',
          recipient,
        },
      },
    }, { employeeId })).resolves.toBe(null);
  });

  it('drops a notification tap addressed to a different employee', async () => {
    const onTarget = vi.fn();
    const employeeARecipient = await nativePushRecipientBinding(
      'employee-fixture-a',
    );
    const lifecycle = startNativePushEventListeners({
      employeeId: 'employee-fixture-b',
      onTarget,
    });

    await lifecycle.ready;
    await native.listeners.get('pushNotificationActionPerformed')?.({
      actionId: 'tap',
      notification: {
        data: {
          data: {
            url: '/tech/tasks',
            recipient: employeeARecipient,
          },
        },
      },
    });

    expect(onTarget).not.toHaveBeenCalled();
  });

  it('stops both listeners and suppresses callbacks retained by a late native event', async () => {
    const onForeground = vi.fn();
    const onTarget = vi.fn();
    const employeeId = 'employee-fixture-a';
    const recipient = await nativePushRecipientBinding(employeeId);
    const lifecycle = startNativePushEventListeners({
      employeeId,
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
      notification: {
        data: {
          data: { url: '/tech/tasks', recipient },
        },
      },
    });
    await Promise.resolve();

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
