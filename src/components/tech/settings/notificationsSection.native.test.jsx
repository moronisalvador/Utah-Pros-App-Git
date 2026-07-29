/**
 * ════════════════════════════════════════════════
 * FILE: notificationsSection.native.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves Settings keeps PWA Web Push and native APNs controls separate,
 *   renders truthful native delivery states, and never shows Home-Screen
 *   installation guidance inside the installed app.
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom/server
 *   Internal:  NotificationsSection, nativePushPresentation, i18n
 *   Data:      none (Capacitor, Push, Auth, storage, and matrix are fakes)
 *
 * NOTES / GOTCHAS:
 *   - Static rendering cannot run effects, so async delivery-state decisions
 *     are tested through the pure presentation helper used by the component.
 *   - Capacitor core is mocked, not the push helper, so the real native
 *     detection and build-gate code still run.
 * ════════════════════════════════════════════════
 */
import {
  beforeEach,
  describe,
  it,
  expect,
  afterEach,
  vi,
} from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const isNativePlatform = vi.fn(() => false);
const matrixProps = vi.hoisted(() => []);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
  },
}));

// The matrix hits the database; this test is only about the push card copy.
vi.mock('@/components/settings/NotificationPrefsMatrix', () => ({
  default: (props) => {
    matrixProps.push(props);
    return null;
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: {},
    employee: { id: 'emp-1', role: 'field_tech' },
    isFeatureEnabled: () => true,
    pwaOwnerLease: { owner: 'v1.owner-fixture-token' },
  }),
}));

// Web Push is unavailable inside WKWebView — mirror that exactly.
vi.mock('@/lib/webPushClient', () => ({
  isPushSupported: () => false,
  getExistingSubscription: async () => null,
  getVapidPublicKey: async () => null,
  pushPermission: () => 'default',
  enablePush: async () => ({ ok: false }),
  disablePush: async () => ({ ok: false }),
}));

const { default: i18n, ensureLanguage } = await import('@/i18n');
const {
  NATIVE_PUSH_BINDING_KEY,
  NATIVE_PUSH_USER_ENABLED_KEY,
} = await import('@/lib/pushNotifications');
const { default: NotificationsSection } = await import(
  '@/components/tech/settings/NotificationsSection'
);
const {
  getNativePushPresentation,
  runDevicePushAction,
} = await import(
  '@/components/tech/settings/nativePushPresentation'
);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

beforeEach(() => {
  matrixProps.length = 0;
  vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', '');
  vi.stubEnv('VITE_APNS_ENV', '');
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  i18n.changeLanguage('en');
  isNativePlatform.mockReturnValue(false);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function render(lang = 'en') {
  await ensureLanguage(lang);
  i18n.changeLanguage(lang);
  return renderToStaticMarkup(<NotificationsSection />);
}

describe('SET-01 — native app never shows Web Push / install guidance', () => {
  it('offers the resolved-feedback preference to a field technician', async () => {
    await render('en');

    expect(matrixProps.at(-1)?.typeFilter).toContain('feedback.resolved');
  });

  it('does not tell a native user to add the app to their Home Screen', async () => {
    isNativePlatform.mockReturnValue(true);
    const out = await render('en');
    expect(out).not.toMatch(/Home Screen/i);
    expect(out).not.toMatch(/Add to Home/i);
  });

  it('states the truthful pending status instead of a broken "off" state', async () => {
    isNativePlatform.mockReturnValue(true);
    const out = await render('en');
    expect(out).toContain('coming in an app update');
    expect(out).toContain('nothing to set up here');
  });

  it('keeps controls hidden while the native build activation gate is off', async () => {
    isNativePlatform.mockReturnValue(true);
    const out = await render('en');
    expect(out).not.toContain('Turn on');
    expect(out).not.toContain('Turn off');
  });

  it('offers Turn on for an explicitly disabled native installation', async () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', 'true');
    vi.stubEnv('VITE_APNS_ENV', 'sandbox');
    vi.stubGlobal('localStorage', memoryStorage({
      [NATIVE_PUSH_USER_ENABLED_KEY]: 'false',
    }));

    const out = await render('en');

    expect(out).toContain('Not on yet for this phone.');
    expect(out).toContain('Turn on');
    expect(out).toContain('Turn push on here');
    expect(out).not.toMatch(/Home Screen/i);
  });

  it('offers Turn off for a bound native installation', async () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', 'true');
    vi.stubEnv('VITE_APNS_ENV', 'sandbox');
    vi.stubGlobal('localStorage', memoryStorage({
      [NATIVE_PUSH_BINDING_KEY]: 'synthetic-device-token',
      [NATIVE_PUSH_USER_ENABLED_KEY]: 'true',
    }));

    const out = await render('en');

    expect(out).toContain('On here — checking iPhone notification access.');
    expect(out).toContain('Turn off');
    expect(out).toContain('checking whether iPhone Settings');
    expect(out).not.toContain('Turn on');
  });

  it('keeps the web/PWA card unchanged when not native', async () => {
    isNativePlatform.mockReturnValue(false);
    const out = await render('en');
    // Static render captures the initial pass, where `loading` is still true —
    // so neither button has rendered yet on EITHER path. The guidance branches
    // are not loading-gated, so they are what distinguishes the two: this env
    // is non-iOS with Web Push unsupported, which is the `cantReceive` branch.
    expect(out).toContain('can’t receive push notifications');
    expect(out).not.toContain('coming in an app update');
    expect(out).not.toContain('nothing to set up here');
  });

  it('renders the activation-gated native copy in all three locales', async () => {
    isNativePlatform.mockReturnValue(true);
    expect(await render('en')).toContain('coming in an app update');
    expect(await render('es')).toContain('llegarán en una actualización');
    expect(await render('pt')).toContain('virá em uma atualização do app');
  });
});

describe('native Push presentation fails closed', () => {
  const base = {
    activationReady: true,
    bound: true,
    intentEnabled: true,
    pending: false,
  };

  it('never calls an unknown permission state deliverable', () => {
    expect(getNativePushPresentation({
      ...base,
      effectiveEnabled: false,
      permission: 'unknown',
    })).toEqual({
      hintKey: 'notifications.nativePermissionCheckingHint',
      statusKey: 'notifications.statusNativeChecking',
    });
  });

  it('keeps a denied binding controllable without calling it deliverable', () => {
    expect(getNativePushPresentation({
      ...base,
      effectiveEnabled: false,
      permission: 'denied',
    })).toEqual({
      hintKey: 'notifications.blockedHint',
      statusKey: 'notifications.statusNativeBlocked',
    });
  });

  it('surfaces pending cleanup ahead of a stale binding marker', () => {
    expect(getNativePushPresentation({
      ...base,
      effectiveEnabled: false,
      pending: true,
      permission: 'granted',
    })).toEqual({
      hintKey: 'notifications.nativeCleanupPendingHint',
      statusKey: 'notifications.statusNativeCleanupPending',
    });
  });

  it('calls native Push on only after effective delivery is verified', () => {
    expect(getNativePushPresentation({
      ...base,
      effectiveEnabled: true,
      permission: 'granted',
    })).toEqual({
      hintKey: 'notifications.nativeManagedHint',
      statusKey: 'notifications.statusOn',
    });
  });
});

describe('device Push actions never cross channels', () => {
  it('runs only Web Push actions in the PWA', async () => {
    const nativeAction = vi.fn(async () => ({ ok: true }));
    const webAction = vi.fn(async () => ({ ok: true }));

    await runDevicePushAction({
      isNativeApp: false,
      nativeAction,
      webAction,
    });

    expect(webAction).toHaveBeenCalledOnce();
    expect(nativeAction).not.toHaveBeenCalled();
  });

  it('runs only APNs actions in the native app', async () => {
    const nativeAction = vi.fn(async () => ({ ok: true }));
    const webAction = vi.fn(async () => ({ ok: true }));

    await runDevicePushAction({
      isNativeApp: true,
      nativeAction,
      webAction,
    });

    expect(nativeAction).toHaveBeenCalledOnce();
    expect(webAction).not.toHaveBeenCalled();
  });
});
