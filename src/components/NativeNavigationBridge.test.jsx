/**
 * ════════════════════════════════════════════════
 * FILE: NativeNavigationBridge.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that iPhone links and notification taps cannot open private screens
 *   under the wrong employee. It also checks cleanup, password-recovery
 *   handling, newest-link behavior, and privacy-safe foreground notices.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  components/NativeNavigationBridge
 *   Data:      none (router, account, and native listeners are fakes)
 *
 * NOTES / GOTCHAS:
 *   - The component lifecycle uses a small hook harness because the unit lane
 *     runs in plain Node. Routing/account race behavior is tested through the
 *     exported production coordinator, not a copied test implementation.
 *   - The mocked hooks keep per-slot state and compare dependencies, so a
 *     repeated renderBridge call behaves like a React re-render: state and
 *     refs persist and an effect with unchanged dependencies must not rerun.
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
  auth: {
    employee: null,
    pwaOwnerLease: null,
  },
  cleanup: null,
  hooks: { cursor: 0, slots: [] },
  isNativePlatform: vi.fn(),
  navigate: vi.fn(),
  pushUpdateAuth: vi.fn(),
  startAppLinks: vi.fn(),
  startPushEvents: vi.fn(),
  stopAppLinks: vi.fn(),
  stopPushEvents: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('react', () => {
  const takeSlot = () => {
    const { hooks } = harness;
    const index = hooks.cursor;
    hooks.cursor += 1;
    if (!hooks.slots[index]) hooks.slots[index] = {};
    return hooks.slots[index];
  };
  const depsChanged = (previous, next) => (
    !previous
    || !next
    || previous.length !== next.length
    || next.some((dep, index) => !Object.is(dep, previous[index]))
  );
  const runEffect = (effect, deps, trackCleanup) => {
    const slot = takeSlot();
    if ('deps' in slot && !depsChanged(slot.deps, deps)) return;
    slot.cleanup?.();
    slot.deps = deps;
    slot.cleanup = effect() || null;
    if (trackCleanup) harness.cleanup = slot.cleanup;
  };
  return {
    useEffect: (effect, deps) => runEffect(effect, deps, true),
    useLayoutEffect: (effect, deps) => runEffect(effect, deps, false),
    useRef: (initialValue) => {
      const slot = takeSlot();
      if (!('value' in slot)) slot.value = { current: initialValue };
      return slot.value;
    },
    useState: (initialValue) => {
      const slot = takeSlot();
      if (!('value' in slot)) {
        slot.value = typeof initialValue === 'function'
          ? initialValue()
          : initialValue;
      }
      return [slot.value, vi.fn()];
    },
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: harness.isNativePlatform,
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => harness.navigate,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => harness.auth,
}));

vi.mock('@/lib/nativeAppLinks', () => ({
  startNativeAppLinkListeners: harness.startAppLinks,
}));

vi.mock('@/lib/pushNotifications', () => ({
  startNativePushEventListeners: harness.startPushEvents,
}));

vi.mock('@/lib/toast', () => ({
  toast: harness.toast,
}));

import NativeNavigationBridge from './NativeNavigationBridge.jsx';
import {
  NATIVE_FOREGROUND_PUSH_MESSAGE,
  createNativeNavigationCoordinator,
} from '@/lib/nativeNavigationCoordinator';

function verifiedAuth(employeeId, epoch = 'epoch-a') {
  return {
    employeeId,
    leaseEpoch: epoch,
    leaseOwner: `owner-${employeeId}`,
  };
}

function coordinator() {
  return {
    navigate: vi.fn(),
    notifyForeground: vi.fn(),
    replaceLocation: vi.fn(),
  };
}

function renderBridge(props) {
  harness.hooks.cursor = 0;
  NativeNavigationBridge(props);
}

function signedInAuth(employeeId = 'employee-a') {
  return {
    employee: { id: employeeId },
    pwaOwnerLease: {
      epoch: 'epoch-a',
      owner: `owner-${employeeId}`,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.auth = {
    employee: null,
    pwaOwnerLease: null,
  };
  harness.cleanup = null;
  harness.hooks = { cursor: 0, slots: [] };
  harness.isNativePlatform.mockReturnValue(true);
  harness.startAppLinks.mockReturnValue({
    ready: Promise.resolve({ ok: true }),
    stop: harness.stopAppLinks,
  });
  harness.startPushEvents.mockReturnValue({
    ready: Promise.resolve({ ok: true }),
    stop: harness.stopPushEvents,
    updateAuth: harness.pushUpdateAuth,
  });
  vi.stubGlobal('window', {
    location: {
      replace: vi.fn(),
    },
  });
});

afterEach(async () => {
  harness.cleanup?.();
  await Promise.resolve();
  vi.unstubAllGlobals();
});

describe('createNativeNavigationCoordinator', () => {
  it('sends recovery fragments straight to location.replace without logging or queueing them', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);
    const target = [
      '/set-password#access_token=header.payload.signature',
      '&refresh_token=synthetic-refresh',
      '&token_type=bearer&type=recovery',
    ].join('');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(bridge.receiveAppLink(target)).toBe(true);
    expect(actions.replaceLocation).toHaveBeenCalledWith(target);
    expect(actions.navigate).not.toHaveBeenCalled();

    bridge.updateAuth(verifiedAuth('employee-a'));
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('opens normalized login, legal, and public-signing links without an account', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);

    for (const target of [
      '/login',
      '/privacy',
      '/terms',
      '/support',
      '/sign/sign-token_1',
      '/s/short-code_1',
    ]) {
      expect(bridge.receiveAppLink(target)).toBe(true);
    }

    expect(actions.navigate.mock.calls.map(([target]) => target)).toEqual([
      '/login',
      '/privacy',
      '/terms',
      '/support',
      '/sign/sign-token_1',
      '/s/short-code_1',
    ]);
    expect(actions.replaceLocation).not.toHaveBeenCalled();
  });

  it('holds a protected Universal Link until employee and owner lease are both verified', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);

    expect(bridge.receiveAppLink('/tech/jobs/job-1')).toBe(true);
    bridge.updateAuth({
      employeeId: 'employee-a',
      leaseEpoch: null,
      leaseOwner: null,
    });
    expect(actions.navigate).not.toHaveBeenCalled();

    bridge.updateAuth(verifiedAuth('employee-a'));
    expect(actions.navigate).toHaveBeenCalledOnce();
    expect(actions.navigate).toHaveBeenCalledWith('/tech/jobs/job-1');
  });

  it('keeps only the latest protected link while authentication is pending', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);

    bridge.receiveAppLink('/tech/jobs/older-job');
    bridge.receiveAppLink('/tech/tasks');
    bridge.updateAuth(verifiedAuth('employee-a'));

    expect(actions.navigate).toHaveBeenCalledOnce();
    expect(actions.navigate).toHaveBeenCalledWith('/tech/tasks');
  });

  it('clears a waiting link when its existing employee changes', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);

    bridge.updateAuth({
      employeeId: 'employee-a',
      leaseEpoch: null,
      leaseOwner: null,
    });
    bridge.receiveAppLink('/tech/tasks');
    bridge.updateAuth(verifiedAuth('employee-b'));

    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it('binds a signed-out link to the first employee and refuses a later account transition', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);

    bridge.receiveAppLink('/tech/claims');
    bridge.updateAuth({
      employeeId: 'employee-a',
      leaseEpoch: null,
      leaseOwner: null,
    });
    bridge.updateAuth(verifiedAuth('employee-b'));

    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it('never carries a push action across sign-in or an unverified account state', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);

    expect(bridge.receivePushTarget('/tech/tasks')).toBe(false);
    bridge.updateAuth({
      employeeId: 'employee-a',
      leaseEpoch: null,
      leaseOwner: null,
    });
    expect(bridge.receivePushTarget('/tech/claims')).toBe(false);
    bridge.updateAuth(verifiedAuth('employee-a'));

    expect(actions.navigate).not.toHaveBeenCalled();

    expect(bridge.receivePushTarget('/tech/claims')).toBe(true);
    expect(actions.navigate).toHaveBeenCalledOnce();
    expect(actions.navigate).toHaveBeenCalledWith('/tech/claims');
  });

  it('ignores unknown direct inputs without replacing the valid waiting link', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);

    bridge.receiveAppLink('/tech/tasks');
    expect(bridge.receiveAppLink('/settings')).toBe(false);
    expect(bridge.receiveAppLink('https://example.com/tech')).toBe(false);
    bridge.updateAuth(verifiedAuth('employee-a'));

    expect(actions.navigate).toHaveBeenCalledOnce();
    expect(actions.navigate).toHaveBeenCalledWith('/tech/tasks');
  });

  it('uses a constant foreground notice and never navigates', () => {
    const actions = coordinator();
    const bridge = createNativeNavigationCoordinator(actions);

    bridge.receiveForegroundPush({
      title: 'Private customer name',
      body: 'Private message body',
      url: '/tech/jobs/private-job',
    });

    expect(actions.notifyForeground).toHaveBeenCalledOnce();
    expect(actions.notifyForeground).toHaveBeenCalledWith();
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(actions.replaceLocation).not.toHaveBeenCalled();
  });
});

describe('NativeNavigationBridge lifecycle', () => {
  it('does not install native listeners when disabled or on the web', () => {
    renderBridge({ enabled: false });
    expect(harness.startAppLinks).not.toHaveBeenCalled();
    expect(harness.startPushEvents).not.toHaveBeenCalled();

    harness.isNativePlatform.mockReturnValue(false);
    renderBridge({ enabled: true });
    expect(harness.startAppLinks).not.toHaveBeenCalled();
    expect(harness.startPushEvents).not.toHaveBeenCalled();
  });

  it('installs both listeners, emits only the generic foreground toast, and cleans up', async () => {
    harness.auth = signedInAuth('employee-a');
    renderBridge({ enabled: true });

    expect(harness.startAppLinks).toHaveBeenCalledOnce();
    expect(harness.startPushEvents).toHaveBeenCalledOnce();

    const pushCallbacks = harness.startPushEvents.mock.calls[0][0];
    expect(pushCallbacks.employeeId).toBe('employee-a');
    expect(harness.pushUpdateAuth).toHaveBeenCalledWith({
      employeeId: 'employee-a',
      ready: true,
    });
    pushCallbacks.onForeground({
      title: 'Private title',
      body: 'Private body',
    });
    expect(harness.toast).toHaveBeenCalledWith(
      NATIVE_FOREGROUND_PUSH_MESSAGE,
    );
    expect(harness.navigate).not.toHaveBeenCalled();

    pushCallbacks.onTarget('/tech/tasks');
    expect(harness.navigate).toHaveBeenCalledWith('/tech/tasks');

    harness.cleanup();
    await Promise.resolve();
    expect(harness.stopAppLinks).toHaveBeenCalledOnce();
    expect(harness.stopPushEvents).toHaveBeenCalledOnce();

    pushCallbacks.onTarget('/tech/claims');
    expect(harness.navigate).toHaveBeenCalledOnce();
  });

  it('keeps cold-start push listeners installed across sign-in and forwards verified auth', () => {
    renderBridge({ enabled: true });

    expect(harness.startPushEvents).toHaveBeenCalledOnce();
    expect(harness.startPushEvents.mock.calls[0][0].employeeId).toBe(null);
    expect(harness.pushUpdateAuth).toHaveBeenCalledWith({
      employeeId: null,
      ready: false,
    });

    harness.auth = signedInAuth('employee-a');
    renderBridge({ enabled: true });

    // The listener lifecycle owns the held cold-start tap, so verification
    // must reach it through updateAuth without a restart wiping that state.
    expect(harness.startPushEvents).toHaveBeenCalledOnce();
    expect(harness.stopPushEvents).not.toHaveBeenCalled();
    expect(harness.startAppLinks).toHaveBeenCalledOnce();
    expect(harness.pushUpdateAuth).toHaveBeenLastCalledWith({
      employeeId: 'employee-a',
      ready: true,
    });

    const pushCallbacks = harness.startPushEvents.mock.calls[0][0];
    pushCallbacks.onTarget('/tech/tasks');
    expect(harness.navigate).toHaveBeenCalledWith('/tech/tasks');
  });

  it('reports a partially verified account as not ready and forwards sign-out', () => {
    renderBridge({ enabled: true });

    harness.auth = {
      employee: { id: 'employee-a' },
      pwaOwnerLease: null,
    };
    renderBridge({ enabled: true });
    expect(harness.pushUpdateAuth).toHaveBeenLastCalledWith({
      employeeId: 'employee-a',
      ready: false,
    });

    harness.auth = signedInAuth('employee-a');
    renderBridge({ enabled: true });
    expect(harness.pushUpdateAuth).toHaveBeenLastCalledWith({
      employeeId: 'employee-a',
      ready: true,
    });

    harness.auth = { employee: null, pwaOwnerLease: null };
    renderBridge({ enabled: true });
    expect(harness.pushUpdateAuth).toHaveBeenLastCalledWith({
      employeeId: null,
      ready: false,
    });
    expect(harness.startPushEvents).toHaveBeenCalledOnce();
    expect(harness.stopPushEvents).not.toHaveBeenCalled();
  });
});
