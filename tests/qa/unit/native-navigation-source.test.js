/**
 * ════════════════════════════════════════════════
 * FILE: native-navigation-source.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the checked-in iPhone link and notification-navigation declarations.
 *   It proves both UPR domains, the unique app URL, native listener events, and
 *   the public Apple association file remain connected without signing an app.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  App router, iOS plists/entitlements, native link/Push source,
 *              public AASA/headers
 *   Data:      reads repository source only
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

describe('native URL declarations', () => {
  const info = read('ios/App/App/Info.plist');
  const developmentEntitlements = read('ios/App/App/App.entitlements');
  const releaseEntitlements = read(
    'ios/App/App/App.Release.entitlements',
  );
  const association = JSON.parse(
    read('public/.well-known/apple-app-site-association'),
  );

  it('registers one reverse-domain custom scheme', () => {
    expect(info).toContain('<key>CFBundleURLTypes</key>');
    expect(info).toContain('<key>CFBundleURLSchemes</key>');
    expect(
      info.match(/<string>com\.utahprosrestoration\.upr<\/string>/g),
    ).toHaveLength(2);
  });

  it('adds both exact Associated Domains to development and release signing inputs', () => {
    for (const entitlements of [
      developmentEntitlements,
      releaseEntitlements,
    ]) {
      expect(entitlements).toContain(
        '<key>com.apple.developer.associated-domains</key>',
      );
      expect(entitlements).toContain(
        '<string>applinks:utahpros.app</string>',
      );
      expect(entitlements).toContain(
        '<string>applinks:dev.utahpros.app</string>',
      );
    }
  });

  it('publishes the exact Apple team/bundle association with admin excluded first', () => {
    const details = association.applinks?.details;
    expect(association.applinks?.apps).toEqual([]);
    expect(details).toHaveLength(1);
    expect(details[0].appID).toBe(
      'P93U4Z4DJB.com.utahprosrestoration.upr',
    );
    expect(details[0].paths.slice(0, 2)).toEqual([
      'NOT /tech/admin',
      'NOT /tech/admin/*',
    ]);
    expect(details[0].paths).toEqual(expect.arrayContaining([
      '/tech',
      '/tech/*',
      '/login',
      '/set-password',
      '/sign/*',
      '/s/*',
      '/privacy',
      '/terms',
      '/support',
    ]));
    // This lane adds app links without silently changing the pre-existing
    // password-autofill association, whose legacy identity is separately owned.
    expect(association.webcredentials).toEqual({
      apps: ['com.utahpros.mobile'],
    });
  });

  it('serves the extensionless association file as JSON', () => {
    const headers = read('public/_headers');
    expect(headers).toMatch(
      /\/\.well-known\/apple-app-site-association\s+Content-Type: application\/json/,
    );
  });
});

describe('native cold, warm, foreground, and action source wiring', () => {
  const app = read('src/App.jsx');
  const links = read('src/lib/nativeAppLinks.js');
  const push = read('src/lib/pushNotifications.js');
  const delegate = read('ios/App/App/AppDelegate.swift');

  it('mounts the account-aware bridge after route restoration and preserves both signing routes', () => {
    expect(app).toContain(
      "import NativeNavigationBridge from '@/components/NativeNavigationBridge'",
    );
    const restorer = app.indexOf('<AuthenticatedRouteRestorer />');
    const bridge = app.indexOf(
      '<NativeNavigationBridge enabled={IS_NATIVE} />',
    );
    expect(restorer).toBeGreaterThan(-1);
    expect(bridge).toBeGreaterThan(restorer);
    expect(app.split('path="/sign/:token"')).toHaveLength(3);
    expect(app.split('path="/s/:code"')).toHaveLength(3);
  });

  it('keeps iOS URL forwarding plus App-plugin cold and warm listeners', () => {
    expect(delegate).toContain(
      'ApplicationDelegateProxy.shared.application(app, open: url',
    );
    expect(delegate).toContain(
      'ApplicationDelegateProxy.shared.application(application, continue: userActivity',
    );
    expect(links).toMatch(/app\.addListener\(\s*['"]appUrlOpen['"]/);
    expect(links).toContain('await app.getLaunchUrl()');
    expect(links).toContain('resolveNativeNavigationTarget(value)');
  });

  it('keeps foreground receipt non-navigating and tap actions resolver-gated', () => {
    expect(push).toContain("'pushNotificationReceived'");
    expect(push).toContain("'pushNotificationActionPerformed'");
    expect(push).toContain('resolveNativePushActionTarget(action)');
    expect(push).toContain(
      "source: 'native_push_foreground'",
    );
    expect(push).not.toMatch(
      /pushNotificationReceived[\s\S]{0,500}resolveNativeNavigationTarget/,
    );
  });

  it('does not log raw link or notification payloads', () => {
    expect(links).not.toMatch(/console\.(?:log|warn|error)/);
    const listenerSlice = push.slice(
      push.indexOf('export function startNativePushEventListeners'),
      push.indexOf('/**\n * Register this native installation'),
    );
    expect(listenerSlice).not.toMatch(/console\.(?:log|warn|error)/);
    expect(listenerSlice).not.toContain('notification.title');
    expect(listenerSlice).not.toContain('notification.body');
  });
});
