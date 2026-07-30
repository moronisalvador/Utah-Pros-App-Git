/**
 * ════════════════════════════════════════════════
 * FILE: pwa-source-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins install identity/assets, push-only service-worker safety, tap-route
 *   authorization, cache/security headers, online-first copy, release identity,
 *   and local error-containment wiring without opening a browser or provider.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  public PWA assets and assigned client source
 *   Data:      reads → repository files only
 * ════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function loadTargetPolicy() {
  const context = {
    self: {},
    URL,
    Set,
    Map,
    RegExp,
    Object,
  };
  vm.runInNewContext(read('public/sw-target.js'), context, {
    filename: 'public/sw-target.js',
  });
  return context.self.UPRPushTarget;
}

function pngDimensions(relative) {
  const bytes = fs.readFileSync(path.join(ROOT, relative));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('notification target authorization', () => {
  const origin = 'https://app.example.test';
  const normalize = (value) => loadTargetPolicy().normalizePushTarget(value, origin);

  it('allows only current same-origin authenticated route shapes', () => {
    expect(normalize('/tech')).toBe('/tech');
    expect(normalize('/tech/appointment/appt_123')).toBe('/tech/appointment/appt_123');
    expect(normalize('/tech/conversations?c=conversation_1')).toBe('/tech/conversations?c=conversation_1');
    expect(normalize('/conversations?c=conversation_1')).toBe('/conversations?c=conversation_1');
    expect(normalize('/crm/leads?lead=lead_1')).toBe('/crm/leads?lead=lead_1');
    expect(normalize('/estimates/estimate_1')).toBe('/estimates/estimate_1');
    expect(normalize('/invoices/invoice_1')).toBe('/invoices/invoice_1');
    expect(normalize('/jobs/job_1')).toBe('/jobs/job_1');
    expect(normalize('/collections')).toBe('/collections');
    // PUSH-01: notification rows written before that fix carry the office
    // appointment path with no data.url. Without this entry they normalized to
    // the '/tech' fallback and the appointment was unreachable from its push.
    expect(normalize('/schedule/appointment/appt_123')).toBe('/schedule/appointment/appt_123');
  });

  // PUSH-01 durable guard. The regression that broke appointment push was a
  // writer moving to a path the service-worker allowlist did not carry, with
  // nothing asserting the two agree. Every appointment destination the server
  // can emit must survive normalization rather than silently degrading to the
  // '/tech' fallback.
  it('accepts every appointment destination notify.js can emit', () => {
    const notify = read('functions/api/notify.js');
    const emitted = [...notify.matchAll(/`(\/(?:tech|schedule)\/appointment\/\$\{[^}]+\})`/g)]
      .map(([, tpl]) => tpl.replace(/\$\{[^}]+\}/, 'appt_123'));
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    for (const path of new Set(emitted)) {
      expect(normalize(path), `${path} must not degrade to the fallback`).toBe(path);
    }
  });

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    'javascript:alert(1)',
    '/login',
    '/reset',
    '/set-password',
    '/sign/public-token',
    '/api/notify',
    '/tech/../login',
    '/tech/%2e%2e/login',
    '/jobs/job_1?redirect=https://evil.example',
    '/conversations?c=one&c=two',
    '/conversations?unexpected=value',
    ' /tech',
  ])('fails closed for %s', (unsafe) => {
    expect(normalize(unsafe)).toBe('/tech');
  });

  it('the worker validates at receipt and click without adding fetch interception', () => {
    const worker = read('public/sw.js');
    expect(worker).toContain("self.importScripts('/sw-target.js')");
    expect(worker.match(/normalizePushTarget/g)).toHaveLength(2);
    expect(worker).toContain("icon: '/icon-192.png'");
    expect(worker).toContain('data: { url: target }');
    expect(worker).toContain(
      'const rawTarget = payload.url || (payload.data && payload.data.url)',
    );
    expect(worker).not.toMatch(/addEventListener\(['"]fetch['"]/);
    expect(worker).not.toContain('...(payload.data');
  });
});

describe('install identity and static assets', () => {
  const manifest = JSON.parse(read('public/manifest.json'));

  it('pins stable identity/scope and separates any from maskable PNG assets', () => {
    expect(manifest).toMatchObject({
      id: '/tech',
      start_url: '/tech',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.icons.map((icon) => icon.purpose)).toEqual([
      'any',
      'any',
      'maskable',
      'maskable',
    ]);
    expect(manifest.icons.every((icon) => icon.type === 'image/png')).toBe(true);
  });

  it.each([
    ['public/icon-192.png', 192],
    ['public/icon-512.png', 512],
    ['public/icon-maskable-192.png', 192],
    ['public/icon-maskable-512.png', 512],
    ['public/apple-touch-icon.png', 180],
  ])('%s is the declared square PNG size', (relative, size) => {
    expect(pngDimensions(relative)).toEqual([size, size]);
  });
});

describe('headers, release identity, containment, and truthful install copy', () => {
  it('has one canonical headers source with SW/reset/asset and baseline security rules', () => {
    expect(fs.existsSync(path.join(ROOT, '_headers'))).toBe(false);
    const headers = read('public/_headers');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(headers).toContain('Permissions-Policy: camera=(self), geolocation=(self), microphone=()');
    expect(headers).toMatch(/\/sw\.js\s+Cache-Control: no-cache, no-store, must-revalidate/);
    expect(headers).toMatch(/\/sw-target\.js\s+Cache-Control: no-cache, no-store, must-revalidate/);
    expect(headers).toMatch(/\/reset\s+Clear-Site-Data: "cache"\s+Cache-Control: no-store/);
    expect(headers).toMatch(/\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  });

  it('uses generated release/cache identity and root plus primary-pane containment', () => {
    const main = read('src/main.jsx');
    const layout = read('src/components/TechLayout.jsx');
    const index = read('index.html');
    const viteConfig = read('vite.config.js');
    expect(main).not.toContain('2026-07-03-web-push-f1');
    expect(main).toContain('RELEASE.cacheCompatibilityId');
    expect(main).toContain('<ErrorBoundary section="UPR application">');
    expect(layout).toContain('<ErrorBoundary section="Technician dashboard">');
    expect(layout).toContain('<ErrorBoundary section="Technician schedule">');
    expect(layout).toContain('<ErrorBoundary section="Technician messages"');
    expect(index).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    );
    expect(viteConfig).toContain('process.env.VITE_RELEASE_SHA');
    expect(viteConfig).toContain('process.env.CF_PAGES_COMMIT_SHA');
    expect(viteConfig).toContain('process.env.GITHUB_SHA');
    expect(viteConfig).toContain(
      "'import.meta.env.VITE_RELEASE_SHA': JSON.stringify(releaseSha)",
    );
    expect(viteConfig).toContain('Governed release build refused');
  });

  it('clears account-owned state before publish/logout and reconciles push policy immediately', () => {
    const auth = read('src/contexts/AuthContext.jsx');
    const app = read('src/App.jsx');
    const rejected = auth.match(
      /const clearRejectedPrincipalState = useCallback\(async[\s\S]*?\n {2}\}, \[\]\);/,
    )?.[0];
    const bootstrap = auth.match(
      /const handleAuthUser = async[\s\S]*?\n {2}\};/,
    )?.[0];
    const logout = auth.match(
      /const logout = useCallback\(async[\s\S]*?\n {2}\]\);/,
    )?.[0];

    expect(rejected).toBeTruthy();
    expect(rejected).toContain('cleanupAccountDeviceState(dbClient');

    expect(bootstrap).toBeTruthy();
    expect(bootstrap).toContain(
      'authLifecycle.commit(generation, () => {',
    );
    expect(bootstrap).toContain("authenticatedDb.rpc(\n        'get_my_employee_profile'");
    expect(bootstrap).toContain(
      'const cleanupResult = await requireAccountCleanup(',
    );
    expect(bootstrap.match(
      /const cleanupResult = await requireAccountCleanup\(/g,
    )).toHaveLength(2);
    expect(
      bootstrap.match(/dbClient: authenticatedDb/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(bootstrap).toContain(
      'authLifecycle.enqueueAccountState(',
    );
    expect(bootstrap).toContain('await reconcilePwaAccountOwner({');
    expect(bootstrap).toContain(
      'pushCleanup: () => detachAccountPushDevices(',
    );
    expect(bootstrap).toContain(
      '{ ownerKey: authenticatedOwnerKey }',
    );
    expect(bootstrap).toContain('!pwaOwner.ready || !pwaOwner.lease');
    expect(bootstrap).toContain('await restorePersistedTechQueries(');
    expect(bootstrap.indexOf('await reconcilePwaAccountOwner({')).toBeLessThan(
      bootstrap.indexOf('setEmployee(emp);'),
    );
    expect(bootstrap.indexOf('await restorePersistedTechQueries(')).toBeLessThan(
      bootstrap.indexOf('setEmployee(emp);'),
    );
    expect(bootstrap).toContain(
      'setPwaOwnerLease(accountState.pwaOwner.lease)',
    );
    expect(bootstrap).toContain('!accountState.pwaOwner.legacyState');
    expect(bootstrap).toContain(
      'const landingPath = getAccountLandingPath(emp.role)',
    );
    expect(bootstrap).toContain('window.location.replace(landingPath)');

    expect(auth).toContain(
      'const workerResult = await reconcilePushServiceWorker(',
    );
    expect(auth).toContain('accountState.workerResult.reloadRequired');

    expect(logout).toBeTruthy();
    expect(logout.indexOf('clearRejectedPrincipalState(priorDb, {'))
      .toBeLessThan(
      logout.indexOf('await signOutLocalSession(transition)'),
    );
    expect(logout.indexOf('if (cleanupResult.cancelled) return;')).toBeLessThan(
      logout.indexOf('await signOutLocalSession(transition)'),
    );
    expect(logout.indexOf('if (!cleanupResult.ready)')).toBeLessThan(
      logout.indexOf('await signOutLocalSession(transition)'),
    );
    // The ONE local sign-out path (post-sign-out revival guard): it captures
    // the ended session id BEFORE signOut and tombstones it only after a
    // CONFIRMED sign-out, so a hard-wall retry never tombstones a live
    // session and a late refresh re-persist can be refused later.
    const signOutHelper = auth.match(
      /const signOutLocalSession = useCallback\([\s\S]*?\n {2}\}, \[\]\);/,
    )?.[0];
    expect(signOutHelper).toBeTruthy();
    expect(signOutHelper).toContain('realtimeClient.auth.signOut({');
    expect(signOutHelper).toContain("scope: 'local'");
    expect(signOutHelper.indexOf('sessionIdFromAccessToken(tokenRef.current)'))
      .toBeLessThan(
        signOutHelper.indexOf('realtimeClient.auth.signOut({'),
      );
    expect(signOutHelper).toMatch(
      /if \(!signOutError \|\| transition\?\.signedOutObserved === true\) \{\s*recordEndedSessionId\(endedSessionId\);/,
    );
    expect(auth).toMatch(
      /event === 'SIGNED_OUT'[\s\S]*?clearRejectedPrincipalState\(priorDb, \{/,
    );
    expect(auth).toContain(
      'const cleanupBlocked = cleanupBlockRef.current !== null;',
    );
    expect(auth).toMatch(
      /\{cleanupBlocked \? \([\s\S]*?onClick=\{retryBlockedCleanup\}[\s\S]*?Retry secure sign out[\s\S]*?\) : children\}/,
    );
    expect(app).not.toContain('<RouteRestorer />');
    expect(app).toContain('function AuthenticatedRouteRestorer()');
    expect(app).toContain('ownerLease={pwaOwnerLease}');
    expect(app).toContain(
      "import { getAccountLandingPath } from '@/contexts/authBootstrap'",
    );
    expect(app).toContain(
      'const landingPath = getAccountLandingPath(employee?.role)',
    );
  });

  it('discloses online-first startup and has accessible install controls in every locale', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const nav = JSON.parse(read(`src/i18n/locales/${locale}/nav.json`));
      expect(nav.installOnlineRequired).toBeTruthy();
      expect(nav.installRegionLabel).toBeTruthy();
      expect(nav.dismissInstall).toBeTruthy();
    }
    const layout = read('src/components/TechLayout.jsx');
    expect(layout).toContain("aria-label={t('dismissInstall')}");
    expect(layout).toContain('minHeight: 48');
    expect(layout).toContain('minWidth: 44');
    expect(layout).toContain("'appinstalled'");
  });

  // MSG-01 — the installed native app must never advertise installing the app.
  describe('MSG-01 — install banner is web-only', () => {
    const layout = read('src/components/TechLayout.jsx');

    it('gates the banner on the native build flag', () => {
      expect(layout).toContain('{!nativeBuild && <InstallBanner />}');
      // An unguarded render is the defect.
      expect(layout).not.toMatch(/^\s*<InstallBanner \/>\s*$/m);
    });

    it('keeps the banner itself intact for the real PWA', () => {
      // A guard, not a deletion — the assertions above still have to pass, and
      // home-screen PWA users still need the install prompt.
      expect(layout).toContain('function InstallBanner()');
      expect(layout).toContain("aria-label={t('dismissInstall')}");
    });

    it('does not rely on isStandaloneDisplay to detect native', () => {
      // That is precisely what failed: it checks display-mode:standalone and
      // navigator.standalone, neither of which is true in a Capacitor
      // WKWebView, while the userAgent still matches /iPhone|iPad/.
      const resume = read('src/lib/resumeRestore.js');
      expect(resume).toContain('isStandaloneDisplay');
      expect(resume).not.toContain('Capacitor');
    });

    it('still receives nativeBuild from the route tree', () => {
      const app = read('src/App.jsx');
      expect(app).toContain('<TechLayout nativeBuild={IS_NATIVE} />');
      expect(layout).toMatch(/function TechLayout\(\{ nativeBuild = false \}\)/);
    });
  });
});
