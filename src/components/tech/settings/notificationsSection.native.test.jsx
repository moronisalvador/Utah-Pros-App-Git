/**
 * SET-01 — the tech Settings notifications card must not show Web Push copy
 * inside the installed native app.
 *
 * Before this guard, WKWebView exposed no PushManager (so `supported` was
 * false) while the iOS userAgent regex still matched, which rendered the
 * Add-to-Home-Screen instructions to a technician already using the installed
 * app, beside a disabled "Turn On" button.
 *
 * `@capacitor/core` is mocked rather than `@/lib/pushNotifications` so the real
 * `canRegisterPush()` runs — that keeps the test honest if the helper's
 * implementation changes. Uses renderToStaticMarkup like its sibling
 * settingsCards.render.test.jsx (no jsdom in this lane).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const isNativePlatform = vi.fn(() => false);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {} }));

// The matrix hits the database; this test is only about the push card copy.
vi.mock('@/components/settings/NotificationPrefsMatrix', () => ({
  default: () => null,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: {},
    employee: { id: 'emp-1', role: 'field_tech' },
    isFeatureEnabled: () => true,
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
const { default: NotificationsSection } = await import(
  '@/components/tech/settings/NotificationsSection'
);

afterEach(() => {
  i18n.changeLanguage('en');
  isNativePlatform.mockReturnValue(false);
});

async function render(lang = 'en') {
  await ensureLanguage(lang);
  i18n.changeLanguage(lang);
  return renderToStaticMarkup(<NotificationsSection />);
}

describe('SET-01 — native app never shows Web Push / install guidance', () => {
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

  it('offers no Turn On / Turn Off control on native', async () => {
    isNativePlatform.mockReturnValue(true);
    const out = await render('en');
    expect(out).not.toContain('Turn On');
    expect(out).not.toContain('Turn Off');
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

  it('renders the native copy in all three locales', async () => {
    isNativePlatform.mockReturnValue(true);
    expect(await render('en')).toContain('coming in an app update');
    expect(await render('es')).toContain('llegarán en una actualización');
    expect(await render('pt')).toContain('virá em uma atualização do app');
  });
});
