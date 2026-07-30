/**
 * ════════════════════════════════════════════════
 * FILE: AuthContext.race.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Exercises the real AuthProvider auth observer with deterministic deferred
 *   requests. It proves an older bootstrap cannot publish or reject over a newer
 *   account and a logout cleanup finishes before the next account is published.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  AuthContext
 *   Data:      none (React hooks, Supabase Auth, browser state, and DB are fakes)
 *
 * NOTES / GOTCHAS:
 *   - The repository's unit lane is plain Node, so the React hooks are a tiny
 *     state harness rather than a DOM renderer. The production AuthProvider
 *     function and its real async auth callback still execute unchanged.
 * ════════════════════════════════════════════════
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const harness = vi.hoisted(() => ({
  authCallback: null,
  sdkAuthCallback: null,
  authCallbackReturns: [],
  effects: [],
  stateCursor: 0,
  states: [],
  profileResponses: [],
  tokenGetter: null,
  db: {
    rpc: vi.fn(),
    select: vi.fn(),
  },
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    refreshSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  },
  unsubscribe: vi.fn(),
  createTokenBoundClient: vi.fn(),
  canRegisterPush: vi.fn(),
  isNativePushEnrollmentEnabled: vi.fn(),
  registerPushForEmployee: vi.fn(),
  cleanupAccountDeviceState: vi.fn(),
  detachAccountPushDevices: vi.fn(),
  retryPendingAccountPushDetaches: vi.fn(),
  fingerprintPwaPrincipal: vi.fn(),
  reconcilePwaAccountOwner: vi.fn(),
  reconcilePushServiceWorker: vi.fn(),
  restorePersistedTechQueries: vi.fn(),
  setHubNav: vi.fn(),
  isStandaloneDisplay: vi.fn(),
  readPwaOwnerLease: vi.fn(),
  providerValue: null,
}));

vi.mock('react', () => ({
  createContext: () => ({ Provider: 'auth-provider' }),
  useCallback: (callback) => callback,
  useContext: () => null,
  useEffect: (effect) => {
    harness.effects.push(effect);
  },
  useRef: (initialValue) => ({ current: initialValue }),
  useState: (initialValue) => {
    const index = harness.stateCursor;
    harness.stateCursor += 1;
    harness.states[index] = typeof initialValue === 'function'
      ? initialValue()
      : initialValue;
    const setState = (nextValue) => {
      harness.states[index] = typeof nextValue === 'function'
        ? nextValue(harness.states[index])
        : nextValue;
    };
    return [harness.states[index], setState];
  },
}));

vi.mock('@/lib/realtime', () => ({
  realtimeClient: { auth: harness.auth },
}));

vi.mock('@/lib/supabase', () => ({
  db: harness.db,
}));

vi.mock('@/lib/stableDb', () => ({
  createTokenBoundClient: harness.createTokenBoundClient,
}));

vi.mock('@/lib/pushNotifications', () => ({
  canRegisterPush: harness.canRegisterPush,
  isNativePushEnrollmentEnabled:
    harness.isNativePushEnrollmentEnabled,
  registerPushForEmployee: harness.registerPushForEmployee,
}));

vi.mock('@/lib/accountDeviceCleanup', () => ({
  cleanupAccountDeviceState: harness.cleanupAccountDeviceState,
  detachAccountPushDevices: harness.detachAccountPushDevices,
  retryPendingAccountPushDetaches:
    harness.retryPendingAccountPushDetaches,
}));

vi.mock('@/lib/registerSW', () => ({
  WEB_PUSH_FLAG_MIRROR_KEY: 'upr:test-web-push-flag',
}));

vi.mock('@/lib/pwaAccountState', () => ({
  fingerprintPwaPrincipal: harness.fingerprintPwaPrincipal,
  reconcilePwaAccountOwner: harness.reconcilePwaAccountOwner,
}));

vi.mock('@/lib/resumeRestore', () => ({
  isStandaloneDisplay: harness.isStandaloneDisplay,
  readPwaOwnerLease: harness.readPwaOwnerLease,
}));

vi.mock('@/lib/pwaServiceWorker', () => ({
  reconcilePushServiceWorker: harness.reconcilePushServiceWorker,
}));

vi.mock('@/lib/techQueryPersister', () => ({
  restorePersistedTechQueries: harness.restorePersistedTechQueries,
}));

vi.mock('@/lib/techQuery', () => ({
  techQueryClient: { clear: vi.fn() },
}));

vi.mock('@/lib/releaseIdentity', () => ({
  RELEASE: { cacheCompatibilityId: 'test-cache-v1' },
}));

vi.mock('@/lib/staleChunkReload', () => ({
  buildResetUrl: (path) => `/reset?return=${encodeURIComponent(path)}`,
}));

vi.mock('@/components/tech/v2/nav', () => ({
  setHubNav: harness.setHubNav,
}));

vi.mock('@/components/SessionExpiredBanner', () => ({
  default: () => null,
}));

import { AuthProvider } from './AuthContext.jsx';

const USER_STATE = 0;
const EMPLOYEE_STATE = 1;
const LOADING_STATE = 5;
const ERROR_STATE = 6;
const EMPLOYEE_IDS = Object.freeze({
  'employee-a': '11111111-1111-4111-8111-111111111111',
  'employee-b': '22222222-2222-4222-8222-222222222222',
  'employee-duplicate': '33333333-3333-4333-8333-333333333333',
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nextMacrotask() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function dispatchAuthEvent(event, session) {
  const callbackResult = harness.sdkAuthCallback(event, session);
  harness.authCallbackReturns.push(callbackResult);
  // First tick runs AuthContext's scheduler. Its resolved fake I/O then drains
  // as microtasks; the second tick observes the resulting React publications.
  await nextMacrotask();
  await nextMacrotask();
  return callbackResult;
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
  };
}

function employee(id, role = 'admin') {
  const canonicalId = EMPLOYEE_IDS[id] || id;
  return {
    id: canonicalId,
    role,
    full_name: `Employee ${id}`,
    display_name: id,
    is_active: true,
    is_external: false,
  };
}

function featureFlag(overrides = {}) {
  return {
    key: 'feature:test',
    enabled: false,
    force_disabled: false,
    dev_only_user_id: null,
    ...overrides,
  };
}

function navPermission(overrides = {}) {
  return {
    nav_key: 'dashboard',
    can_view: true,
    can_edit: false,
    ...overrides,
  };
}

async function mountProvider() {
  const rendered = AuthProvider({ children: null });
  harness.providerValue = rendered.props.value;
  expect(harness.effects).toHaveLength(1);
  const cleanup = harness.effects[0]();
  await vi.waitFor(() => {
    expect(harness.authCallback).toBeTypeOf('function');
    expect(harness.states[LOADING_STATE]).toBe(false);
  });
  return cleanup;
}

function profileCallCount() {
  return harness.db.rpc.mock.calls.filter(
    ([name]) => name === 'get_my_employee_profile',
  ).length;
}

beforeEach(() => {
  vi.resetAllMocks();
  harness.cleanupAccountDeviceState.mockReset();
  harness.retryPendingAccountPushDetaches.mockReset();
  harness.fingerprintPwaPrincipal.mockReset();
  harness.reconcilePwaAccountOwner.mockReset();
  harness.restorePersistedTechQueries.mockReset();
  harness.authCallback = null;
  harness.sdkAuthCallback = null;
  harness.authCallbackReturns = [];
  harness.effects = [];
  harness.stateCursor = 0;
  harness.states = [];
  harness.profileResponses = [];
  harness.tokenGetter = null;
  harness.providerValue = null;

  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', {
    location: {
      hash: '',
      pathname: '/',
      search: '',
      replace: vi.fn(),
    },
  });

  harness.auth.getSession.mockResolvedValue({
    data: { session: null },
  });
  harness.auth.onAuthStateChange.mockImplementation((callback) => {
    harness.sdkAuthCallback = callback;
    harness.authCallback = dispatchAuthEvent;
    return {
      data: {
        subscription: { unsubscribe: harness.unsubscribe },
      },
    };
  });
  harness.auth.refreshSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
  harness.auth.signInWithPassword.mockResolvedValue({
    data: {},
    error: null,
  });
  harness.auth.signOut.mockResolvedValue({ error: null });

  harness.createTokenBoundClient.mockImplementation((getToken) => {
    harness.tokenGetter = getToken;
    return harness.db;
  });
  harness.db.rpc.mockImplementation((name) => {
    if (name === 'get_my_employee_profile') {
      return harness.profileResponses.shift();
    }
    if (
      name === 'get_feature_flags'
      || name === 'get_employee_page_access'
    ) {
      return Promise.resolve([]);
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  harness.db.select.mockResolvedValue([]);

  harness.canRegisterPush.mockReturnValue(false);
  harness.isNativePushEnrollmentEnabled.mockReturnValue(false);
  harness.registerPushForEmployee.mockResolvedValue({ ok: true });
  harness.cleanupAccountDeviceState.mockResolvedValue({
    ready: true,
    reloadRequired: false,
  });
  harness.retryPendingAccountPushDetaches.mockResolvedValue({
    ready: true,
    pending: false,
    ownerMismatch: false,
  });
  harness.fingerprintPwaPrincipal.mockImplementation(
    async (authUserId) => `v1.owner-${authUserId}-fixture`,
  );
  harness.detachAccountPushDevices.mockResolvedValue({
    ready: true,
    serverDetached: true,
    localDetached: true,
  });
  harness.reconcilePwaAccountOwner.mockResolvedValue({
    ready: true,
    changed: false,
    legacyState: false,
    lease: {
      owner: 'v1.test-owner-token',
      epoch: 'e1.test-session-epoch',
    },
  });
  harness.restorePersistedTechQueries.mockResolvedValue(true);
  harness.reconcilePushServiceWorker.mockResolvedValue({
    reloadRequired: false,
  });
  harness.isStandaloneDisplay.mockReturnValue(false);
  harness.readPwaOwnerLease.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AuthProvider latest-account-wins races', () => {
  it('returns before SDK lock reacquisition and completes rejected sign-out', async () => {
    const cleanup = await mountProvider();
    harness.profileResponses.push(Promise.resolve([
      employee('employee-a'),
    ]));
    harness.db.rpc.mockImplementation((name) => {
      if (name === 'get_my_employee_profile') {
        return harness.profileResponses.shift();
      }
      if (name === 'get_feature_flags') return Promise.resolve(null);
      if (name === 'get_employee_page_access') return Promise.resolve([]);
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const signOutCompletion = deferred();
    let signedOutCallbackReturn = Symbol('not-called');
    harness.auth.signOut.mockImplementationOnce(() => {
      // Supabase holds its auth lock here. A Promise-returning callback would
      // keep the lock held, so this fake deliberately resolves signOut only
      // after the callback has returned synchronously.
      signedOutCallbackReturn = harness.sdkAuthCallback('SIGNED_OUT', null);
      if (signedOutCallbackReturn === undefined) {
        // The callback is stronger evidence than this late transport error:
        // without an observed SIGNED_OUT, the same error hard-locks below.
        signOutCompletion.resolve({
          error: new Error('late sign-out transport error'),
        });
      }
      return signOutCompletion.promise;
    });

    const signedInCallbackReturn = harness.sdkAuthCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    expect(signedInCallbackReturn).toBeUndefined();
    expect(profileCallCount()).toBe(0);
    await vi.waitFor(() => {
      expect(harness.auth.signOut).toHaveBeenCalledOnce();
      expect(signedOutCallbackReturn).toBeUndefined();
      expect(harness.states[USER_STATE]).toBe(null);
      expect(harness.states[LOADING_STATE]).toBe(false);
      expect(harness.states[ERROR_STATE]).toMatch(
        /Failed to verify employee access/,
      );
    });
    await nextMacrotask();
    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.tokenGetter()).toBe(null);

    cleanup();
  });

  it('processes auth callbacks in exact order without overlap', async () => {
    const cleanup = await mountProvider();
    const firstProfile = deferred();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(firstProfile.promise);

    const signedInReturn = harness.sdkAuthCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    const refreshedReturn = harness.sdkAuthCallback('TOKEN_REFRESHED', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a-refreshed',
    });

    expect(signedInReturn).toBeUndefined();
    expect(refreshedReturn).toBeUndefined();
    await vi.waitFor(() => expect(profileCallCount()).toBe(1));
    expect(harness.tokenGetter()).toBe('token-a');
    await nextMacrotask();
    expect(harness.tokenGetter()).toBe('token-a');

    firstProfile.resolve([employeeA]);
    await vi.waitFor(() => {
      expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
      expect(harness.tokenGetter()).toBe('token-a-refreshed');
    });

    cleanup();
  });

  it('cancels scheduled auth work when the provider unmounts', async () => {
    const cleanup = await mountProvider();
    harness.profileResponses.push(Promise.resolve([
      employee('employee-a'),
    ]));

    const callbackReturn = harness.sdkAuthCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(callbackReturn).toBeUndefined();
    cleanup();

    await nextMacrotask();
    await nextMacrotask();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(profileCallCount()).toBe(0);
    expect(harness.tokenGetter).toBe(null);

    expect(harness.sdkAuthCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    })).toBeUndefined();
    await nextMacrotask();
    expect(profileCallCount()).toBe(0);
  });

  it('cleans a reloaded recovery session without bootstrapping employee state', async () => {
    window.location.pathname = '/set-password';
    harness.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'auth-recovery',
            email: 'recovery@example.invalid',
          },
          access_token: 'recovery-token',
        },
      },
    });

    const cleanup = await mountProvider();

    expect(profileCallCount()).toBe(0);
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
    expect(harness.tokenGetter()).toBe(null);
    expect(harness.reconcilePwaAccountOwner).not.toHaveBeenCalled();
    expect(harness.restorePersistedTechQueries).not.toHaveBeenCalled();

    cleanup();
  });

  it('hard-locks a reloaded recovery session until cleanup retries ready', async () => {
    window.location.pathname = '/set-password';
    harness.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'auth-recovery',
            email: 'recovery@example.invalid',
          },
          access_token: 'recovery-token',
        },
      },
    });
    harness.cleanupAccountDeviceState
      .mockResolvedValueOnce({
        ready: false,
        reason: 'server-delete-timeout',
      })
      .mockResolvedValueOnce({
        ready: true,
        reloadRequired: false,
      });

    const rendered = AuthProvider({ children: null });
    harness.providerValue = rendered.props.value;
    const cleanup = harness.effects[0]();
    await vi.waitFor(() => {
      expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
      expect(harness.states[ERROR_STATE]).toMatch(
        /could not finish securing the previous account/,
      );
    });

    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.tokenGetter()).toBe('recovery-token');
    expect(harness.auth.signOut).not.toHaveBeenCalled();

    await harness.providerValue.retrySecureAccountCleanup();

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledTimes(2);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.tokenGetter()).toBe(null);
    expect(harness.auth.signOut).not.toHaveBeenCalled();

    cleanup();
  });

  it('redirects only after recovery cleanup while preserving the recovery session', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);

    await harness.authCallback('PASSWORD_RECOVERY', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'recovery-token',
    });

    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
    expect(harness.tokenGetter()).toBe(null);
    expect(window.location.replace).toHaveBeenCalledWith('/set-password');

    cleanup();
  });

  it('hard-locks failed recovery cleanup and retries without signing out', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    harness.cleanupAccountDeviceState
      .mockResolvedValueOnce({
        ready: false,
        reason: 'server-delete-timeout',
      })
      .mockResolvedValueOnce({
        ready: true,
        reloadRequired: false,
      });

    await harness.authCallback('PASSWORD_RECOVERY', {
      user: { id: 'auth-recovery', email: 'recovery@example.invalid' },
      access_token: 'recovery-token',
    });

    expect(harness.auth.signOut).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[ERROR_STATE]).toMatch(
      /could not finish securing the previous account/,
    );
    expect(harness.tokenGetter()).toBe('token-a');

    await harness.providerValue.retrySecureAccountCleanup();

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledTimes(2);
    expect(harness.auth.signOut).not.toHaveBeenCalled();
    expect(window.location.replace).toHaveBeenCalledWith('/set-password');
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.tokenGetter()).toBe(null);

    cleanup();
  });

  it('treats a repeated SIGNED_IN for the ready principal as a token update', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(profileCallCount()).toBe(1);

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a-refreshed',
    });

    expect(harness.tokenGetter()).toBe('token-a-refreshed');
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(profileCallCount()).toBe(1);

    cleanup();
  });

  it('enters loading before clearing a different ready principal', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    const employeeBProfile = deferred();
    harness.profileResponses.push(
      Promise.resolve([employeeA]),
      employeeBProfile.promise,
    );

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);

    const nextAccount = harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    });
    await vi.waitFor(() => expect(profileCallCount()).toBe(2));

    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);

    employeeBProfile.resolve([employee('employee-b')]);
    await nextAccount;
    await vi.waitFor(() => {
      expect(harness.states[LOADING_STATE]).toBe(false);
    });

    cleanup();
  });

  it('uses account A token for cleanup before binding or publishing account B', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    const employeeB = employee('employee-b', 'project_manager');
    harness.profileResponses.push(
      Promise.resolve([employeeA]),
      Promise.resolve([employeeB]),
    );

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);

    // Native enrollment and B's owner/Web Push reconciliation are both eligible
    // for B, making their absence while A cleanup is pending observable.
    harness.canRegisterPush.mockReturnValue(true);
    harness.isNativePushEnrollmentEnabled.mockReturnValue(true);
    harness.registerPushForEmployee.mockClear();
    harness.reconcilePwaAccountOwner.mockClear();
    const cleanupRelease = deferred();
    const cleanupTokens = [];
    harness.cleanupAccountDeviceState.mockImplementationOnce(async () => {
      cleanupTokens.push(harness.tokenGetter());
      return cleanupRelease.promise;
    });
    const switched = harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    });

    await vi.waitFor(() => {
      expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    });
    expect(cleanupTokens).toEqual(['token-a']);
    expect(harness.tokenGetter()).toBe('token-a');
    expect(profileCallCount()).toBe(1);
    expect(harness.reconcilePwaAccountOwner).not.toHaveBeenCalled();
    expect(harness.registerPushForEmployee).not.toHaveBeenCalled();
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(true);

    cleanupRelease.resolve({
      ready: true,
      reloadRequired: false,
    });
    await switched;

    await vi.waitFor(() => {
      expect(harness.tokenGetter()).toBe('token-b');
      expect(profileCallCount()).toBe(2);
      expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-b' });
      expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeB);
      expect(harness.states[LOADING_STATE]).toBe(false);
    });
    expect(harness.reconcilePwaAccountOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        authUserId: 'auth-b',
        employeeId: EMPLOYEE_IDS['employee-b'],
        pushCleanup: expect.any(Function),
      }),
    );
    expect(harness.registerPushForEmployee).toHaveBeenCalledWith(
      harness.db,
      EMPLOYEE_IDS['employee-b'],
      { ownerKey: 'v1.owner-auth-b-fixture' },
    );

    cleanup();
  });

  it('keeps account A hard-locked and retries before a repeated B event can bind', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    const employeeB = employee('employee-b', 'project_manager');
    harness.profileResponses.push(
      Promise.resolve([employeeA]),
      Promise.resolve([employeeB]),
    );

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    harness.canRegisterPush.mockReturnValue(true);
    harness.isNativePushEnrollmentEnabled.mockReturnValue(true);
    harness.registerPushForEmployee.mockClear();
    harness.reconcilePwaAccountOwner.mockClear();
    harness.cleanupAccountDeviceState
      .mockResolvedValueOnce({
        ready: false,
        reason: 'server-or-local-detach-incomplete',
      })
      .mockResolvedValueOnce({
        ready: true,
        reloadRequired: false,
      });

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    });

    // Supabase has emitted B, but the identity-stable client remains bound to A.
    // A's published employee plus loading=true keeps route guards on their lock
    // surface; neither B bootstrap nor native/Web Push ownership can begin.
    expect(harness.tokenGetter()).toBe('token-a');
    expect(profileCallCount()).toBe(1);
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[ERROR_STATE]).toMatch(
      /could not finish securing the previous account/,
    );
    expect(harness.reconcilePwaAccountOwner).not.toHaveBeenCalled();
    expect(harness.registerPushForEmployee).not.toHaveBeenCalled();

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    });

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledTimes(2);
    expect(harness.tokenGetter()).toBe('token-b');
    expect(profileCallCount()).toBe(2);
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-b' });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeB);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.reconcilePwaAccountOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        authUserId: 'auth-b',
        employeeId: EMPLOYEE_IDS['employee-b'],
      }),
    );
    expect(harness.registerPushForEmployee).toHaveBeenCalledWith(
      harness.db,
      EMPLOYEE_IDS['employee-b'],
      { ownerKey: 'v1.owner-auth-b-fixture' },
    );

    cleanup();
  });

  it('fails employee bootstrap closed when feature flags cannot be loaded', async () => {
    const cleanup = await mountProvider();
    harness.profileResponses.push(Promise.resolve([employee('employee-a')]));
    harness.db.rpc.mockImplementation((name) => {
      if (name === 'get_my_employee_profile') {
        return harness.profileResponses.shift();
      }
      if (name === 'get_feature_flags') {
        return Promise.reject(new Error('feature flags denied'));
      }
      if (name === 'get_employee_page_access') {
        return Promise.resolve([]);
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[ERROR_STATE]).toMatch(
      /Failed to verify employee access/,
    );
    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.auth.signOut).toHaveBeenCalledOnce();
    expect(
      harness.cleanupAccountDeviceState.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.auth.signOut.mock.invocationCallOrder[0]);
    expect(harness.tokenGetter()).toBe(null);
    expect(harness.reconcilePwaAccountOwner).not.toHaveBeenCalled();

    cleanup();
  });

  it.each([
    ['a null profile response', { profile: null }],
    ['an empty profile response', { profile: [] }],
    ['multiple mapped profiles', {
      profile: [
        employee('employee-a'),
        employee('employee-duplicate'),
      ],
    }],
    ['a non-object profile row', { profile: ['not-an-object'] }],
    ['a non-UUID profile id', {
      profile: [{ ...employee('employee-a'), id: 'employee-a' }],
    }],
    ['an unsupported profile role', {
      profile: [{ ...employee('employee-a'), role: 'manager' }],
    }],
    ['a string profile active flag', {
      profile: [{ ...employee('employee-a'), is_active: 'false' }],
    }],
    ['a null profile external flag', {
      profile: [{ ...employee('employee-a'), is_external: null }],
    }],
    ['a null feature-flag response', { flags: null }],
    ['a string false feature enabled value', {
      flags: [featureFlag({ enabled: 'false' })],
    }],
    ['a string false force-disabled value', {
      flags: [featureFlag({ force_disabled: 'false' })],
    }],
    ['a malformed feature dev-only id', {
      flags: [featureFlag({ dev_only_user_id: 'not-a-uuid' })],
    }],
    ['duplicate feature keys', {
      flags: [featureFlag(), featureFlag()],
    }],
    ['a malformed feature key', {
      flags: [featureFlag({ key: ' feature:test' })],
    }],
    ['a null page-access response', { pageAccess: null }],
    ['a null nav-permission response', { navPermissions: null }],
    ['duplicate nav-permission keys', {
      navPermissions: [navPermission(), navPermission()],
    }],
    ['a string false nav can-view value', {
      navPermissions: [navPermission({ can_view: 'false' })],
    }],
    ['a null nav can-edit value', {
      navPermissions: [navPermission({ can_edit: null })],
    }],
    ['a malformed nav key', {
      navPermissions: [navPermission({ nav_key: ' dashboard' })],
    }],
  ])('rejects %s instead of publishing fail-open authority', async (
    _label,
    scenario,
  ) => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    const hasScenarioValue = (key) => (
      Object.prototype.hasOwnProperty.call(scenario, key)
    );
    harness.profileResponses.push(
      Promise.resolve(
        hasScenarioValue('profile')
          ? scenario.profile
          : [employeeA],
      ),
    );
    harness.db.rpc.mockImplementation((name) => {
      if (name === 'get_my_employee_profile') {
        return harness.profileResponses.shift();
      }
      if (name === 'get_feature_flags') {
        return Promise.resolve(
          hasScenarioValue('flags') ? scenario.flags : [],
        );
      }
      if (name === 'get_employee_page_access') {
        return Promise.resolve(
          hasScenarioValue('pageAccess') ? scenario.pageAccess : [],
        );
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    harness.db.select.mockResolvedValueOnce(
      hasScenarioValue('navPermissions')
        ? scenario.navPermissions
        : [],
    );

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[ERROR_STATE]).toMatch(
      /No active employee|Failed to verify employee access/,
    );
    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.auth.signOut).toHaveBeenCalledOnce();
    expect(
      harness.cleanupAccountDeviceState.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.auth.signOut.mock.invocationCallOrder[0]);
    expect(harness.tokenGetter()).toBe(null);
    expect(harness.reconcilePwaAccountOwner).not.toHaveBeenCalled();

    cleanup();
  });

  it('publishes only after strictly typed authorization rows succeed', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a', 'estimator');
    harness.profileResponses.push(Promise.resolve([employeeA]));
    harness.db.rpc.mockImplementation((name) => {
      if (name === 'get_my_employee_profile') {
        return harness.profileResponses.shift();
      }
      if (name === 'get_feature_flags') {
        return Promise.resolve([
          featureFlag({ dev_only_user_id: employeeA.id }),
        ]);
      }
      if (name === 'get_employee_page_access') {
        return Promise.resolve([
          { nav_key: 'dashboard', can_view: false },
        ]);
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    harness.db.select.mockResolvedValueOnce([
      navPermission(),
    ]);

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.states[ERROR_STATE]).toBe(null);
    expect(harness.cleanupAccountDeviceState).not.toHaveBeenCalled();
    expect(harness.auth.signOut).not.toHaveBeenCalled();

    cleanup();
  });

  it('keeps rejected bootstrap authenticated behind the lock when cleanup fails', async () => {
    const cleanup = await mountProvider();
    harness.profileResponses.push(Promise.resolve([
      employee('employee-a'),
    ]));
    harness.db.rpc.mockImplementation((name) => {
      if (name === 'get_my_employee_profile') {
        return harness.profileResponses.shift();
      }
      if (name === 'get_feature_flags') {
        return Promise.resolve([
          featureFlag({ enabled: 'false' }),
        ]);
      }
      if (name === 'get_employee_page_access') return Promise.resolve([]);
      throw new Error(`Unexpected RPC: ${name}`);
    });
    harness.cleanupAccountDeviceState.mockResolvedValueOnce({
      ready: false,
      reason: 'server-delete-timeout',
    });

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[ERROR_STATE]).toMatch(
      /could not finish securing the previous account/,
    );
    expect(harness.tokenGetter()).toBe('token-a');

    cleanup();
  });

  it.each([
    ['an explicit error', { error: new Error('local sign out failed') }],
    ['a malformed response', {}],
  ])('retains the rejected principal client when sign-out returns %s', async (
    _label,
    signOutResult,
  ) => {
    const cleanup = await mountProvider();
    harness.profileResponses.push(Promise.resolve([
      employee('employee-a'),
    ]));
    harness.db.select.mockResolvedValueOnce([
      navPermission({ can_view: 'false' }),
    ]);
    harness.auth.signOut.mockResolvedValueOnce(signOutResult);

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.auth.signOut).toHaveBeenCalledOnce();
    expect(
      harness.cleanupAccountDeviceState.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.auth.signOut.mock.invocationCallOrder[0]);
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[ERROR_STATE]).toMatch(
      /could not finish securing the previous account/,
    );
    expect(harness.tokenGetter()).toBe('token-a');

    await harness.providerValue.retrySecureAccountCleanup();

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledTimes(2);
    expect(harness.auth.signOut).toHaveBeenCalledTimes(2);
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.tokenGetter()).toBe(null);

    cleanup();
  });

  it('coordinates rejected-bootstrap sign-out observation without double cleanup', async () => {
    const cleanup = await mountProvider();
    harness.profileResponses.push(Promise.resolve([
      employee('employee-a'),
    ]));
    harness.db.rpc.mockImplementation((name) => {
      if (name === 'get_my_employee_profile') {
        return harness.profileResponses.shift();
      }
      if (name === 'get_feature_flags') return Promise.resolve(null);
      if (name === 'get_employee_page_access') return Promise.resolve([]);
      throw new Error(`Unexpected RPC: ${name}`);
    });
    harness.auth.signOut.mockImplementationOnce(async () => {
      harness.sdkAuthCallback('SIGNED_OUT', null);
      return { error: null };
    });

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    await vi.waitFor(() => {
      expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
      expect(harness.auth.signOut).toHaveBeenCalledOnce();
      expect(harness.states[USER_STATE]).toBe(null);
      expect(harness.states[EMPLOYEE_STATE]).toBe(null);
      expect(harness.states[LOADING_STATE]).toBe(false);
      expect(harness.states[ERROR_STATE]).toMatch(
        /Failed to verify employee access/,
      );
      expect(harness.tokenGetter()).toBe(null);
    });

    cleanup();
  });

  it('recovers a reloaded B session without consuming A pending detach state', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    const employeeB = employee('employee-b', 'project_manager');
    harness.profileResponses.push(
      Promise.resolve([employeeB]),
      Promise.resolve([employeeA]),
    );
    harness.retryPendingAccountPushDetaches.mockResolvedValueOnce({
      ready: false,
      pending: true,
      ownerMismatch: true,
    });

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    });

    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[ERROR_STATE]).toMatch(
      /unfinished notification cleanup from a previous account/,
    );
    expect(harness.reconcilePwaAccountOwner).not.toHaveBeenCalled();
    expect(harness.registerPushForEmployee).not.toHaveBeenCalled();
    expect(harness.cleanupAccountDeviceState).not.toHaveBeenCalled();

    // The recovery action signs out only the mismatched current B session. It
    // does not run A's owner-scoped cleanup with B credentials.
    await harness.providerValue.retrySecureAccountCleanup();
    expect(harness.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(harness.cleanupAccountDeviceState).not.toHaveBeenCalled();
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.tokenGetter()).toBe(null);

    await harness.providerValue.login(
      'a@example.invalid',
      'synthetic-password',
    );
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    expect(harness.retryPendingAccountPushDetaches).toHaveBeenNthCalledWith(
      1,
      harness.db,
      { ownerKey: 'v1.owner-auth-b-fixture' },
    );
    expect(harness.retryPendingAccountPushDetaches).toHaveBeenNthCalledWith(
      2,
      harness.db,
      { ownerKey: 'v1.owner-auth-a-fixture' },
    );
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(false);

    cleanup();
  });

  it.each([
    [
      'device cleanup is incomplete',
      {
        ownerResult: {
          ready: false,
          lease: null,
          reason: 'cleanup-incomplete',
        },
        restoreResult: true,
      },
    ],
    [
      'owner-bound query restore loses its lease',
      {
        ownerResult: {
          ready: true,
          changed: false,
          legacyState: false,
          lease: {
            owner: 'v1.test-owner-token',
            epoch: 'e1.test-session-epoch',
          },
        },
        restoreResult: false,
      },
    ],
  ])('does not publish when %s', async (_label, scenario) => {
    const cleanup = await mountProvider();
    harness.profileResponses.push(Promise.resolve([employee('employee-a')]));
    harness.reconcilePwaAccountOwner.mockResolvedValueOnce(
      scenario.ownerResult,
    );
    harness.restorePersistedTechQueries.mockResolvedValueOnce(
      scenario.restoreResult,
    );

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[ERROR_STATE]).toMatch(/Failed to verify employee access/);
    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();

    cleanup();
  });

  it('serializes a later account behind an earlier rejected bootstrap', async () => {
    const cleanup = await mountProvider();
    const firstProfile = deferred();
    const employeeB = employee('employee-b');
    harness.profileResponses.push(
      firstProfile.promise,
      Promise.resolve([employeeB]),
    );

    const firstTransition = harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    await vi.waitFor(() => expect(profileCallCount()).toBe(1));

    const secondTransition = harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    });
    await nextMacrotask();
    expect(profileCallCount()).toBe(1);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);

    firstProfile.resolve([]);
    await Promise.all([firstTransition, secondTransition]);

    await vi.waitFor(() => {
      expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-b' });
      expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeB);
      expect(harness.states[ERROR_STATE]).toBe(null);
    });
    // A is rejected and secured before the ordered B callback can bootstrap.
    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.detachAccountPushDevices).not.toHaveBeenCalled();

    cleanup();
  });

  it('finishes signed-out cleanup before a following account publishes', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    const employeeB = employee('employee-b', 'project_manager');
    harness.profileResponses.push(Promise.resolve([employeeA]));

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);

    const cleanupRelease = deferred();
    harness.cleanupAccountDeviceState.mockImplementationOnce(
      () => cleanupRelease.promise,
    );
    harness.profileResponses.push(Promise.resolve([employeeB]));

    const signedOut = harness.authCallback('SIGNED_OUT', null);
    await vi.waitFor(() => {
      expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
      expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    });

    const signedIn = harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    });
    await Promise.resolve();
    expect(profileCallCount()).toBe(1);

    cleanupRelease.resolve({
      ready: true,
      queueQuarantined: true,
    });
    await Promise.all([signedOut, signedIn]);

    expect(profileCallCount()).toBe(2);
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-b' });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeB);
    expect(harness.states[ERROR_STATE]).toBe(null);

    cleanup();
  });

  it('recovers observer-only sign-out with a fresh same-account session', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);

    harness.retryPendingAccountPushDetaches.mockClear();
    harness.cleanupAccountDeviceState.mockResolvedValueOnce({
      ready: false,
      reason: 'server-delete-denied',
    });

    await harness.authCallback('SIGNED_OUT', null);

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[ERROR_STATE]).toMatch(
      /unfinished notification cleanup from a previous account/,
    );
    expect(harness.tokenGetter()).toBe('token-a');

    await harness.providerValue.retrySecureAccountCleanup();

    expect(harness.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.states[ERROR_STATE]).toMatch(
      /unfinished notification cleanup from a previous account/,
    );
    expect(harness.tokenGetter()).toBe(null);

    harness.profileResponses.push(Promise.resolve([employeeA]));
    harness.retryPendingAccountPushDetaches.mockImplementationOnce(
      async (_authenticatedDb, { ownerKey }) => {
        expect(ownerKey).toBe('v1.owner-auth-a-fixture');
        expect(harness.tokenGetter()).toBe('token-a-fresh');
        expect(harness.states[EMPLOYEE_STATE]).toBe(null);
        return {
          ready: true,
          pending: false,
          ownerMismatch: false,
        };
      },
    );

    await harness.providerValue.login(
      'a@example.invalid',
      'synthetic-password',
    );
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a-fresh',
    });

    expect(harness.retryPendingAccountPushDetaches).toHaveBeenCalledOnce();
    expect(harness.retryPendingAccountPushDetaches).toHaveBeenCalledWith(
      harness.db,
      { ownerKey: 'v1.owner-auth-a-fixture' },
    );
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(false);

    cleanup();
  });

  it('ignores token refresh while signed-out cleanup has no active principal', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));

    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(harness.tokenGetter()).toBe('token-a');

    const cleanupRelease = deferred();
    harness.cleanupAccountDeviceState.mockImplementationOnce(
      () => cleanupRelease.promise,
    );
    const signedOut = harness.authCallback('SIGNED_OUT', null);
    await vi.waitFor(() => {
      expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
      expect(harness.states[USER_STATE]).toBe(null);
    });

    await harness.authCallback('TOKEN_REFRESHED', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'stale-refreshed-token',
    });
    expect(harness.tokenGetter()).toBe('token-a');

    cleanupRelease.resolve({
      ready: true,
      queueQuarantined: true,
    });
    await signedOut;
    await vi.waitFor(() => {
      expect(harness.tokenGetter()).toBe(null);
    });

    cleanup();
  });

  it('completes sign-out even when cleanup fails, leaving enforcement to the bind gate', async () => {
    // Owner directive 2026-07-29: a sign out button just signs out. The
    // failed cleanup leaves the durable journal; the bind-time gate walls a
    // foreign owner and reconciles the same owner at the next sign-in.
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    harness.cleanupAccountDeviceState.mockResolvedValueOnce({
      ready: false,
      reason: 'server-delete-denied',
    });

    await expect(harness.providerValue.logout()).resolves.toBeUndefined();
    expect(harness.auth.signOut).toHaveBeenCalledOnce();
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.states[ERROR_STATE]).toBe(null);
    expect(harness.tokenGetter()).toBe(null);

    cleanup();
  });

  it('keeps A locked when transition sign-out fails and retries before B sign-in', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    harness.cleanupAccountDeviceState.mockResolvedValueOnce({
      ready: true,
      reloadRequired: false,
    });
    harness.auth.signOut.mockResolvedValueOnce({
      error: new Error('local sign out failed'),
    });

    await expect(harness.providerValue.login(
      'b@example.invalid',
      'synthetic-password',
    )).rejects.toThrow(/could not finish securing/);

    expect(harness.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(harness.tokenGetter()).toBe('token-a');
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[EMPLOYEE_STATE]).toEqual(employeeA);
    expect(harness.states[LOADING_STATE]).toBe(true);

    await expect(harness.providerValue.login(
      'b@example.invalid',
      'synthetic-password',
    )).resolves.toEqual({});

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledTimes(2);
    expect(harness.auth.signOut).toHaveBeenCalledTimes(2);
    expect(harness.auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(
      harness.auth.signOut.mock.invocationCallOrder[1],
    ).toBeLessThan(
      harness.auth.signInWithPassword.mock.invocationCallOrder[0],
    );
    expect(harness.tokenGetter()).toBe(null);

    cleanup();
  });

  it('runs native login verification after prior-account cleanup and before sign-in', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    const beforeSignIn = vi.fn().mockResolvedValue(undefined);
    harness.profileResponses.push(Promise.resolve([employeeA]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    harness.cleanupAccountDeviceState.mockResolvedValueOnce({
      ready: true,
      reloadRequired: false,
    });

    await expect(harness.providerValue.login(
      'b@example.invalid',
      'synthetic-password',
      { beforeSignIn },
    )).resolves.toEqual({});

    expect(beforeSignIn).toHaveBeenCalledOnce();
    expect(
      harness.auth.signOut.mock.invocationCallOrder[0],
    ).toBeLessThan(
      beforeSignIn.mock.invocationCallOrder[0],
    );
    expect(
      beforeSignIn.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.auth.signInWithPassword.mock.invocationCallOrder[0],
    );

    cleanup();
  });

  it('does not publish a new session when native login verification is canceled', async () => {
    const cleanup = await mountProvider();
    const beforeSignIn = vi.fn().mockRejectedValue(
      new Error('Face ID verification was canceled. Try signing in again.'),
    );

    await expect(harness.providerValue.login(
      'b@example.invalid',
      'synthetic-password',
      { beforeSignIn },
    )).rejects.toThrow(/Face ID verification was canceled/);

    expect(beforeSignIn).toHaveBeenCalledOnce();
    expect(harness.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);

    cleanup();
  });

  it('completes an explicit sign-out visually when cleanup leaves a journaled residual', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    harness.cleanupAccountDeviceState.mockResolvedValue({
      ready: false,
      deferrable: true,
      reason: 'cleanup-incomplete',
    });

    await expect(harness.providerValue.logout()).resolves.toBeUndefined();

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.auth.signOut).toHaveBeenCalledOnce();
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.states[ERROR_STATE]).toBe(null);
    expect(harness.tokenGetter()).toBe(null);

    cleanup();
  });

  it('still walls a foreign-owner journal at the next sign-in after a deferred sign-out', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    harness.cleanupAccountDeviceState.mockResolvedValueOnce({
      ready: false,
      deferrable: true,
    });
    await expect(harness.providerValue.logout()).resolves.toBeUndefined();
    expect(harness.states[USER_STATE]).toBe(null);

    // The durable journal now belongs to A's owner. B's bind attempt must be
    // refused before B publishes or enrolls — this gate is the cross-account
    // privacy guarantee the deferred sign-out leans on.
    harness.retryPendingAccountPushDetaches.mockResolvedValue({
      ready: false,
      pending: true,
      ownerMismatch: true,
    });
    harness.profileResponses.push(Promise.resolve([employee('employee-b')]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-b', email: 'b@example.invalid' },
      access_token: 'token-b',
    });

    expect(harness.states[EMPLOYEE_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[ERROR_STATE]).toMatch(
      /unfinished notification cleanup/,
    );
    expect(harness.registerPushForEmployee).not.toHaveBeenCalled();

    cleanup();
  });

  it('never defers an observer-only SIGNED_OUT even when cleanup is deferrable', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    harness.cleanupAccountDeviceState.mockResolvedValue({
      ready: false,
      deferrable: true,
    });
    await harness.authCallback('SIGNED_OUT', null);

    // Signed-out reauth stays a hard wall: only an explicit logout may defer.
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[ERROR_STATE]).toMatch(
      /unfinished notification cleanup/,
    );

    cleanup();
  });

  it('clears the sign-out-failure wall when the retry completes', async () => {
    // The only transient wall left on the explicit path is a failed local
    // Supabase signOut(); its Retry re-runs logout(), which now completes.
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    harness.cleanupAccountDeviceState.mockResolvedValue({
      ready: true,
      reloadRequired: false,
    });
    harness.auth.signOut.mockResolvedValueOnce({
      error: new Error('local sign out failed'),
    });

    await expect(harness.providerValue.logout()).rejects.toThrow(
      /local sign out failed/,
    );
    expect(harness.states[ERROR_STATE]).toMatch(/Sign out failed/);
    expect(harness.states[LOADING_STATE]).toBe(true);
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });

    await harness.providerValue.retrySecureAccountCleanup();

    expect(harness.auth.signOut).toHaveBeenCalledTimes(2);
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);
    expect(harness.states[ERROR_STATE]).toBe(null);

    cleanup();
  });

  it('login never defers even when cleanup reports a deferrable residual', async () => {
    const cleanup = await mountProvider();
    const employeeA = employee('employee-a');
    harness.profileResponses.push(Promise.resolve([employeeA]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: 'auth-a', email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    harness.cleanupAccountDeviceState.mockResolvedValueOnce({
      ready: false,
      deferrable: true,
    });

    await expect(harness.providerValue.login(
      'b@example.invalid',
      'synthetic-password',
    )).rejects.toThrow(/could not finish securing/);
    expect(harness.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(harness.tokenGetter()).toBe('token-a');
    expect(harness.states[USER_STATE]).toMatchObject({ id: 'auth-a' });
    expect(harness.states[LOADING_STATE]).toBe(true);

    cleanup();
  });
});

// Post-sign-out session resurrection (TestFlight defect 2026-07-29): a token
// refresh racing signOut re-persists the session, and without these guards
// the app re-enters the account without ever reaching Login.
describe('AuthProvider signed-out-intent resurrection guards', () => {
  const AUTH_UUID = '44444444-4444-4444-8444-444444444444';
  const INTENT_KEY = 'upr:auth:signed-out-intent:v1';

  function readIntent() {
    const raw = globalThis.localStorage.getItem(INTENT_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  async function signInAsUuidUser() {
    harness.profileResponses.push(Promise.resolve([employee('employee-a')]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: AUTH_UUID, email: 'a@example.invalid' },
      access_token: 'token-a',
    });
  }

  it('logout writes the durable signed-out intent before signing out', async () => {
    const cleanup = await mountProvider();
    await signInAsUuidUser();

    await expect(harness.providerValue.logout()).resolves.toBeUndefined();

    expect(readIntent()).toMatchObject({ principalId: AUTH_UUID });
    expect(harness.auth.signOut).toHaveBeenCalledOnce();

    cleanup();
  });

  it('terminates a resurrected session at boot instead of re-entering the account', async () => {
    globalThis.localStorage.setItem(INTENT_KEY, JSON.stringify({
      version: 1,
      principalId: AUTH_UUID,
      at: 1,
    }));
    harness.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: AUTH_UUID, email: 'a@example.invalid' },
          access_token: 'zombie-token',
        },
      },
    });

    const cleanup = await mountProvider();

    expect(harness.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(profileCallCount()).toBe(0);
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);
    // The marker survives until a real login clears it, so a second
    // resurrection is refused again.
    expect(readIntent()).toMatchObject({ principalId: AUTH_UUID });

    cleanup();
  });

  it('refuses a SIGNED_IN for the signed-out principal instead of bootstrapping', async () => {
    const cleanup = await mountProvider();
    globalThis.localStorage.setItem(INTENT_KEY, JSON.stringify({
      version: 1,
      principalId: AUTH_UUID,
      at: 1,
    }));

    await harness.authCallback('SIGNED_IN', {
      user: { id: AUTH_UUID, email: 'a@example.invalid' },
      access_token: 'zombie-token',
    });

    expect(harness.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(profileCallCount()).toBe(0);
    expect(harness.states[USER_STATE]).toBe(null);

    cleanup();
  });

  it('terminates a zombie TOKEN_REFRESHED for the signed-out principal', async () => {
    const cleanup = await mountProvider();
    globalThis.localStorage.setItem(INTENT_KEY, JSON.stringify({
      version: 1,
      principalId: AUTH_UUID,
      at: 1,
    }));

    await harness.authCallback('TOKEN_REFRESHED', {
      user: { id: AUTH_UUID, email: 'a@example.invalid' },
      access_token: 'zombie-token',
    });

    expect(harness.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(profileCallCount()).toBe(0);

    cleanup();
  });

  it('login clears the intent before signInWithPassword so re-login is never refused', async () => {
    const cleanup = await mountProvider();
    globalThis.localStorage.setItem(INTENT_KEY, JSON.stringify({
      version: 1,
      principalId: AUTH_UUID,
      at: 1,
    }));

    await expect(harness.providerValue.login(
      'a@example.invalid',
      'synthetic-password',
    )).resolves.toEqual({});
    expect(readIntent()).toBe(null);

    harness.profileResponses.push(Promise.resolve([employee('employee-a')]));
    await harness.authCallback('SIGNED_IN', {
      user: { id: AUTH_UUID, email: 'a@example.invalid' },
      access_token: 'token-a',
    });
    expect(profileCallCount()).toBe(1);
    expect(harness.states[USER_STATE]).toMatchObject({ id: AUTH_UUID });

    cleanup();
  });

  it('sweeps a session that a racing refresh re-persisted during sign-out', async () => {
    const cleanup = await mountProvider();
    await signInAsUuidUser();

    // The sweep's getSession finds a session that reappeared after signOut.
    harness.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: AUTH_UUID, email: 'a@example.invalid' },
          access_token: 'resurrected-token',
        },
      },
    });

    await expect(harness.providerValue.logout()).resolves.toBeUndefined();
    // The signed-out UI publishes BEFORE the un-awaited sweep settles.
    expect(harness.states[USER_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);

    await vi.waitFor(() => {
      expect(harness.auth.signOut).toHaveBeenCalledTimes(2);
    });

    cleanup();
  });

  it('never refreshes a session for a signed-out or absent principal', async () => {
    let onAuthError = null;
    harness.createTokenBoundClient.mockImplementation((getToken, opts) => {
      harness.tokenGetter = getToken;
      onAuthError = opts?.onAuthError;
      return harness.db;
    });
    const cleanup = await mountProvider();
    await signInAsUuidUser();

    await expect(harness.providerValue.logout()).resolves.toBeUndefined();

    // A stale page's 401 after sign-out must not refresh (refreshSession
    // re-persists the session as a side effect — the resurrection path).
    await expect(onAuthError()).resolves.toBe(false);
    expect(harness.auth.refreshSession).not.toHaveBeenCalled();

    cleanup();
  });

  it('preserves a recovery session on /set-password despite a matching intent', async () => {
    const cleanup = await mountProvider();
    globalThis.window.location.pathname = '/set-password';
    globalThis.localStorage.setItem(INTENT_KEY, JSON.stringify({
      version: 1,
      principalId: AUTH_UUID,
      at: 1,
    }));

    await harness.authCallback('SIGNED_IN', {
      user: { id: AUTH_UUID, email: 'a@example.invalid' },
      access_token: 'recovery-token',
    });

    expect(harness.auth.signOut).not.toHaveBeenCalled();
    expect(harness.states[USER_STATE]).toMatchObject({ id: AUTH_UUID });

    cleanup();
  });

  it('bootstraps normally after another tab cleared the shared intent', async () => {
    const cleanup = await mountProvider();
    globalThis.localStorage.setItem(INTENT_KEY, JSON.stringify({
      version: 1,
      principalId: AUTH_UUID,
      at: 1,
    }));
    // Another tab's login() clears the SHARED marker without this provider
    // ever seeing a login() call.
    globalThis.localStorage.removeItem(INTENT_KEY);

    await signInAsUuidUser();

    expect(harness.auth.signOut).not.toHaveBeenCalled();
    expect(profileCallCount()).toBe(1);
    expect(harness.states[USER_STATE]).toMatchObject({ id: AUTH_UUID });

    cleanup();
  });

  it('never sweeps a different principal signed in during the sweep window', async () => {
    const cleanup = await mountProvider();
    await signInAsUuidUser();

    harness.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: '55555555-5555-4555-8555-555555555555',
            email: 'b@example.invalid',
          },
          access_token: 'fresh-b-token',
        },
      },
    });

    await expect(harness.providerValue.logout()).resolves.toBeUndefined();
    await nextMacrotask();
    await nextMacrotask();

    expect(harness.auth.signOut).toHaveBeenCalledOnce();

    cleanup();
  });

  it('never re-walls when the sweep sign-out emits its own SIGNED_OUT', async () => {
    const cleanup = await mountProvider();
    await signInAsUuidUser();

    // The dangerous production interleaving: the observer processes the
    // FIRST SIGNED_OUT while the explicit transition is still unfinalized
    // and nulls explicitLogoutRef. Without the pre-finalized resurrection
    // transition, the sweep's own SIGNED_OUT would then take the
    // observer-only branch, re-run the (not-ready) cleanup, and raise the
    // signed-out-reauth wall.
    harness.cleanupAccountDeviceState.mockResolvedValue({
      ready: false,
      deferrable: true,
    });
    harness.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: AUTH_UUID, email: 'a@example.invalid' },
          access_token: 'resurrected-token',
        },
      },
    });
    harness.auth.signOut
      .mockImplementationOnce(async () => {
        harness.sdkAuthCallback('SIGNED_OUT', null);
        // Let the observer process this SIGNED_OUT (and null the ref)
        // BEFORE signOut resolves and logout() finalizes the transition.
        await nextMacrotask();
        await nextMacrotask();
        return { error: null };
      })
      .mockImplementationOnce(() => {
        harness.sdkAuthCallback('SIGNED_OUT', null);
        return Promise.resolve({ error: null });
      });

    await expect(harness.providerValue.logout()).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(harness.auth.signOut).toHaveBeenCalledTimes(2);
    });
    await nextMacrotask();
    await nextMacrotask();

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.states[ERROR_STATE]).toBe(null);
    expect(harness.states[LOADING_STATE]).toBe(false);

    cleanup();
  });

  it('re-arms the switched-out principal when the new credentials fail', async () => {
    const cleanup = await mountProvider();
    await signInAsUuidUser();

    harness.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: new Error('Invalid login credentials'),
    });

    await expect(harness.providerValue.login(
      'b@example.invalid',
      'wrong-password',
    )).rejects.toThrow(/Invalid login credentials/);

    // A's session was signed out by the switch and nothing replaced it —
    // the resurrection guard must stay armed for A.
    expect(harness.auth.signOut).toHaveBeenCalledOnce();
    expect(readIntent()).toMatchObject({ principalId: AUTH_UUID });

    cleanup();
  });

  it('uninstalls the resurrection transition when its sign-out throws', async () => {
    const cleanup = await mountProvider();
    globalThis.localStorage.setItem(INTENT_KEY, JSON.stringify({
      version: 1,
      principalId: AUTH_UUID,
      at: 1,
    }));
    harness.auth.signOut.mockRejectedValueOnce(
      new Error('sign out transport failed'),
    );

    await harness.authCallback('SIGNED_IN', {
      user: { id: AUTH_UUID, email: 'a@example.invalid' },
      access_token: 'zombie-token',
    });
    expect(profileCallCount()).toBe(0);

    // A later genuine SIGNED_OUT must still be processed — a lingering
    // pre-finalized ghost transition would swallow it silently.
    harness.cleanupAccountDeviceState.mockResolvedValue({
      ready: true,
      reloadRequired: false,
    });
    await harness.authCallback('SIGNED_OUT', null);

    expect(harness.cleanupAccountDeviceState).toHaveBeenCalledOnce();
    expect(harness.states[LOADING_STATE]).toBe(false);

    cleanup();
  });

  it('arms the intent when a rejected bootstrap signs the principal out', async () => {
    const cleanup = await mountProvider();
    harness.profileResponses.push(Promise.resolve([employee('employee-a')]));
    harness.db.rpc.mockImplementation((name) => {
      if (name === 'get_my_employee_profile') {
        return harness.profileResponses.shift();
      }
      if (name === 'get_feature_flags') return Promise.resolve(null);
      if (name === 'get_employee_page_access') return Promise.resolve([]);
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await harness.authCallback('SIGNED_IN', {
      user: { id: AUTH_UUID, email: 'a@example.invalid' },
      access_token: 'token-a',
    });

    await vi.waitFor(() => {
      expect(harness.states[ERROR_STATE]).toMatch(
        /Failed to verify employee access/,
      );
    });
    expect(readIntent()).toMatchObject({ principalId: AUTH_UUID });

    cleanup();
  });
});
