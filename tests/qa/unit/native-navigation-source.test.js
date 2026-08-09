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

import {
  DEV_APP_ID,
  PRODUCTION_APP_ID,
  appIdForBranch,
  retargetAssociation,
} from '../../../scripts/aasa-branch-identity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

describe('native URL declarations', () => {
  const info = read('ios/App/App/Info.plist');
  const developmentEntitlements = read('ios/App/App/App.entitlements');
  const releaseEntitlements = read(
    'ios/App/App/App.Release.entitlements',
  );
  const devEntitlements = read('ios/App/App/App.Dev.entitlements');
  const devReleaseEntitlements = read(
    'ios/App/App/App.DevRelease.entitlements',
  );
  const associationSource = read(
    'public/.well-known/apple-app-site-association',
  );
  const association = JSON.parse(associationSource);

  it('registers one reverse-domain custom scheme', () => {
    expect(info).toContain('<key>CFBundleURLTypes</key>');
    expect(info).toContain('<key>CFBundleURLSchemes</key>');
    expect(
      info.match(/<string>com\.utahprosrestoration\.upr<\/string>/g),
    ).toHaveLength(2);
  });

  it('gives each bundle exactly one domain, and never the other one', () => {
    // THE BUG THIS REPLACES, and why the old assertion was the wrong shape:
    // every configuration claimed BOTH domains, so the App Store app was a
    // legitimate handler for dev.utahpros.app. The owner texted themselves a
    // dev signing link on 2026-08-08, iOS handed it to the production app, and
    // that app — pointed at a different origin — showed an error screen.
    //
    // An association needs both halves to agree: the site names the app (the
    // AASA below), and the app claims the site (here). Splitting either half
    // fixes it; splitting both means neither can regress alone.
    const claims = (entitlements) => (entitlements
      .match(/<string>(?:applinks|webcredentials):[^<]+<\/string>/g) || [])
      .map((line) => line.replace(/<\/?string>/g, ''));

    for (const [label, entitlements, host] of [
      ['App.entitlements (Debug · com.utahprosrestoration.upr)',
        developmentEntitlements, 'utahpros.app'],
      ['App.Release.entitlements (Release · com.utahprosrestoration.upr)',
        releaseEntitlements, 'utahpros.app'],
      ['App.Dev.entitlements (Dev · com.utahprosrestoration.upr.dev)',
        devEntitlements, 'dev.utahpros.app'],
      ['App.DevRelease.entitlements (DevRelease · com.utahprosrestoration.upr.dev)',
        devReleaseEntitlements, 'dev.utahpros.app'],
    ]) {
      expect(entitlements, label).toContain(
        '<key>com.apple.developer.associated-domains</key>',
      );
      expect(claims(entitlements), label).toEqual([
        `applinks:${host}`,
        `webcredentials:${host}`,
      ]);
    }
  });

  it('keeps each build configuration pointed at the entitlements for its bundle', () => {
    // The four configurations split on TWO axes — Debug/Release (which decides
    // the APNs environment) and prod/dev (which decides the bundle id and now
    // the domain). Before this, entitlements split on the first axis only, so
    // the dev bundle inherited the production app's domain claims. A config
    // repointed at the wrong file silently restores that.
    const project = read('ios/App/App.xcodeproj/project.pbxproj');
    const blocks = project.match(
      /isa = XCBuildConfiguration;(?:(?!isa = XCBuildConfiguration;)[\s\S])*?name = \w+;/g,
    ) || [];

    const signed = blocks
      .filter((block) => block.includes('CODE_SIGN_ENTITLEMENTS'))
      .map((block) => ({
        name: block.match(/name = (\w+);/)[1],
        bundle: block.match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/)[1],
        entitlements: block.match(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/)[1],
      }));

    expect(signed).toEqual([
      { name: 'Debug', bundle: 'com.utahprosrestoration.upr', entitlements: 'App/App.entitlements' },
      { name: 'Release', bundle: 'com.utahprosrestoration.upr', entitlements: 'App/App.Release.entitlements' },
      { name: 'Dev', bundle: 'com.utahprosrestoration.upr.dev', entitlements: 'App/App.Dev.entitlements' },
      { name: 'DevRelease', bundle: 'com.utahprosrestoration.upr.dev', entitlements: 'App/App.DevRelease.entitlements' },
    ]);
  });

  it('keeps the APNs environment on the Debug/Release axis, not the prod/dev one', () => {
    // Narrowing the domains must not quietly move a build to the wrong push
    // environment: a sandbox token sent to the production APNs host is
    // rejected, and nothing in the app surfaces that.
    const apsEnv = (entitlements) => entitlements
      .match(/<key>aps-environment<\/key>\s*<string>([^<]+)<\/string>/)[1];

    expect(apsEnv(developmentEntitlements)).toBe('development');
    expect(apsEnv(devEntitlements)).toBe('development');
    expect(apsEnv(releaseEntitlements)).toBe('production');
    expect(apsEnv(devReleaseEntitlements)).toBe('production');
  });

  it('publishes the exact Apple team/bundle association and leaves emailed capability links on the web', () => {
    const details = association.applinks?.details;
    expect(association.applinks?.apps).toEqual([]);
    expect(details).toHaveLength(1);
    expect(details[0].appID).toBe(
      'H6ZUT739T9.com.utahprosrestoration.upr',
    );
    expect(details[0].paths.slice(0, 2)).toEqual([
      'NOT /tech/admin',
      'NOT /tech/admin/*',
    ]);
    expect(details[0].paths).toEqual(expect.arrayContaining([
      '/tech',
      '/tech/*',
      '/login',
      '/privacy',
      '/terms',
      '/support',
    ]));
    // A signature token and a password-recovery fragment are emailed
    // browser-capability links. If the app claims either route, an invitee
    // without credentials is stranded at native login and a signer cannot
    // complete their request. Keep them absent from the Universal Link
    // allowlist; the web SPA still serves both routes.
    expect(details[0].paths).not.toEqual(expect.arrayContaining([
      '/set-password',
      '/sign/*',
      '/s/*',
    ]));
    // REL-01: the password-autofill association now names the paid team's real
    // application identifier. The prior value, 'com.utahpros.mobile', was left
    // in place by an earlier lane as a "separately owned" legacy identity, but
    // it is not a valid webcredentials entry — Apple requires TEAMID.bundleid,
    // so that value could never have validated. Revert this pair (here and in
    // public/.well-known/apple-app-site-association) if a genuinely separate
    // app under that identifier turns out to need the association.
    expect(association.webcredentials).toEqual({
      apps: ['H6ZUT739T9.com.utahprosrestoration.upr'],
    });
  });

  it('serves the extensionless association file as JSON', () => {
    const headers = read('public/_headers');
    expect(headers).toMatch(
      /\/\.well-known\/apple-app-site-association\s+Content-Type: application\/json/,
    );
  });

  describe('the deployed association names the app that belongs to its domain', () => {
    // The checked-in file is the production one, and the build rewrites only
    // the identifiers for a non-main branch. Both halves are pinned here: the
    // paths must be identical across domains (one source of truth), and the
    // identity must differ (that is the whole fix).
    it('main keeps the App Store app; dev and previews get the dev app', () => {
      expect(appIdForBranch('main')).toBe(PRODUCTION_APP_ID);
      expect(appIdForBranch('dev')).toBe(DEV_APP_ID);
      expect(appIdForBranch('codex/anything')).toBe(DEV_APP_ID);
      // No branch is a local build, not a deploy — it must reproduce the
      // checked-in file exactly so a local `npm run build` is never a diff.
      expect(appIdForBranch('')).toBe(PRODUCTION_APP_ID);
      expect(appIdForBranch(undefined)).toBe(PRODUCTION_APP_ID);
    });

    it('rewrites every identifier and nothing else', () => {
      const onDev = JSON.parse(retargetAssociation(associationSource, 'dev'));
      const onMain = JSON.parse(retargetAssociation(associationSource, 'main'));

      for (const detail of onDev.applinks.details) {
        expect(detail.appID).toBe(DEV_APP_ID);
      }
      expect(onDev.webcredentials.apps).toEqual([DEV_APP_ID]);

      // Paths are NOT generated — deep-linkable routes stay in the one
      // checked-in file, so dev can never drift to a different route set.
      expect(onDev.applinks.details.map((d) => d.paths))
        .toEqual(association.applinks.details.map((d) => d.paths));
      expect(onDev.applinks.apps).toEqual([]);

      // main round-trips to exactly what is committed.
      expect(onMain).toEqual(association);
    });

    it('refuses to emit a malformed association rather than silently breaking links', () => {
      // A broken association disables universal links across the whole domain
      // with no error anywhere, so this must throw at build time, not deploy.
      expect(() => retargetAssociation('not json', 'dev')).toThrow(/valid JSON/);
      expect(() => retargetAssociation('{"applinks":{"details":[]}}', 'dev'))
        .toThrow(/applinks\.details/);
    });

    it('is wired into the build, not just available to it', () => {
      const config = read('vite.config.js');
      expect(config).toContain("from './scripts/aasa-branch-identity.mjs'");
      expect(config).toContain('associationBranchIdentityPlugin(rootDir)');
      expect(config).toContain('process.env.CF_PAGES_BRANCH');
    });
  });
});

describe('native cold, warm, foreground, and action source wiring', () => {
  const app = read('src/App.jsx');
  const links = read('src/lib/nativeAppLinks.js');
  const targetPolicy = read('src/lib/nativeNavigationTarget.js');
  const push = read('src/lib/pushNotifications.js');
  const apns = read('functions/lib/apns.js');
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
    expect(push).toContain('resolveNativePushActionTarget(action, {');
    // The tap dispatcher resolves against the employee verified at dispatch
    // time (resolvedFor), and re-checks that same identity after the await so
    // an auth change mid-resolve can never navigate a stale target.
    expect(push).toMatch(
      /resolveNativePushActionTarget\(action,\s*\{\s*employeeId:\s*resolvedFor,\s*\}\)/,
    );
    expect(push).toMatch(/currentEmployeeId\s*!==\s*resolvedFor/);
    expect(push).toContain(
      "source: 'native_push_foreground'",
    );
    expect(push).not.toMatch(
      /pushNotificationReceived[\s\S]{0,500}resolveNativeNavigationTarget/,
    );
  });

  it('applies one pure route policy before APNs serialization and tap routing', () => {
    expect(links).toContain(
      "from './nativeNavigationTarget.js'",
    );
    expect(push).toContain(
      "from './nativeNavigationTarget.js'",
    );
    expect(apns).toContain(
      "from '../../src/lib/nativeNavigationTarget.js'",
    );
    expect(apns).toContain('url: resolveNativePushRoute(data?.url)');
    expect(targetPolicy).toContain(
      'export function resolveNativePushRoute(value)',
    );
    expect(targetPolicy).toContain("value.includes('#')");
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
