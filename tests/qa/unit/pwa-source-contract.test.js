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
      logout.indexOf('realtimeClient.auth.signOut({'),
    );
    expect(logout.indexOf('if (cleanupResult.cancelled) return;')).toBeLessThan(
      logout.indexOf('realtimeClient.auth.signOut({'),
    );
    expect(logout.indexOf('if (!cleanupResult.ready)')).toBeLessThan(
      logout.indexOf('realtimeClient.auth.signOut({'),
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
});
