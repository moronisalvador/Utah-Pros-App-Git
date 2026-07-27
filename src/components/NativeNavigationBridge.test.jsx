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
  isNativePlatform: vi.fn(),
  navigate: vi.fn(),
  startAppLinks: vi.fn(),
  startPushEvents: vi.fn(),
  stopAppLinks: vi.fn(),
  stopPushEvents: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('react', () => ({
  useEffect: (effect) => {
    harness.cleanup = effect();
  },
  useLayoutEffect: (effect) => {
    effect();
  },
  useState: (initialValue) => [
    typeof initialValue === 'function' ? initialValue() : initialValue,
    vi.fn(),
  ],
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  harness.auth = {
    employee: null,
    pwaOwnerLease: null,
  };
  harness.cleanup = null;
  harness.isNativePlatform.mockReturnValue(true);
  harness.startAppLinks.mockReturnValue({
    ready: Promise.resolve({ ok: true }),
    stop: harness.stopAppLinks,
  });
  harness.startPushEvents.mockReturnValue({
    ready: Promise.resolve({ ok: true }),
    stop: harness.stopPushEvents,
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
    NativeNavigationBridge({ enabled: false });
    expect(harness.startAppLinks).not.toHaveBeenCalled();
    expect(harness.startPushEvents).not.toHaveBeenCalled();

    harness.isNativePlatform.mockReturnValue(false);
    NativeNavigationBridge({ enabled: true });
    expect(harness.startAppLinks).not.toHaveBeenCalled();
    expect(harness.startPushEvents).not.toHaveBeenCalled();
  });

  it('installs both listeners, emits only the generic foreground toast, and cleans up', async () => {
    harness.auth = {
      employee: { id: 'employee-a' },
      pwaOwnerLease: {
        epoch: 'epoch-a',
        owner: 'owner-employee-a',
      },
    };
    NativeNavigationBridge({ enabled: true });

    expect(harness.startAppLinks).toHaveBeenCalledOnce();
    expect(harness.startPushEvents).toHaveBeenCalledOnce();

    const pushCallbacks = harness.startPushEvents.mock.calls[0][0];
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
});
