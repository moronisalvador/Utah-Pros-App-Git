/**
 * ════════════════════════════════════════════════
 * FILE: native-privacy-screen.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the native app-switcher privacy shield wired to the iOS lifecycle
 *   even when no signed-device build is authorized in the current environment.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  ios/App/App/SceneDelegate.swift, ios/App/App/Info.plist
 *   Data:      reads repository source only
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sceneDelegate = readFileSync(
  join(ROOT, 'ios/App/App/SceneDelegate.swift'),
  'utf8',
);
const infoPlist = readFileSync(join(ROOT, 'ios/App/App/Info.plist'), 'utf8');

describe('native app-switcher privacy shield', () => {
  it('uses Apple scene lifecycle and keeps Main as the Capacitor scene storyboard', () => {
    expect(infoPlist).toContain('<key>UIApplicationSceneManifest</key>');
    expect(infoPlist).toContain('<key>UISceneDelegateClassName</key>');
    expect(infoPlist).toContain('$(PRODUCT_MODULE_NAME).SceneDelegate');
    expect(infoPlist).toContain('<key>UISceneStoryboardFile</key>');
    expect(infoPlist).toContain('<string>Main</string>');
    expect(sceneDelegate).toContain('class SceneDelegate: UIResponder, UIWindowSceneDelegate');
  });

  it('installs an opaque native shield before background snapshots', () => {
    expect(sceneDelegate).toContain('private func showPrivacyShield()');
    // RES-01: was pinned to `.systemBackground`, which follows the PHONE's
    // light/dark setting while the app runs its own theme — a dark-themed app on
    // a light-mode phone flashed a white shield over dark content. The shield
    // now uses the appearance last reported by the web layer. Still opaque,
    // which is the property this test actually exists to protect.
    expect(sceneDelegate).toContain('shield.backgroundColor = lastKnownAppearance');
    expect(sceneDelegate).toMatch(/private var lastKnownAppearance: UIColor = \.systemBackground/);
    expect(sceneDelegate).toMatch(
      /func sceneWillResignActive[\s\S]*?showPrivacyShield\(\)/,
    );
    expect(sceneDelegate).toMatch(
      /func sceneDidEnterBackground[\s\S]*?showPrivacyShield\(\)/,
    );
  });

  it('removes the shield only after the app becomes active', () => {
    expect(sceneDelegate).toContain('private func hidePrivacyShield()');
    expect(sceneDelegate).toMatch(
      /func sceneDidBecomeActive[\s\S]*?hidePrivacyShield\(\)/,
    );
    expect(sceneDelegate).toContain(
      'accessibilityIdentifier = "upr-privacy-shield"',
    );
  });

  // RES-01 — the removal is a dissolve now, not a hard cut. These pin the
  // safety properties, not the aesthetics: a privacy shield that can strand is
  // far worse than one that cuts abruptly.
  describe('RES-01 — foreground dissolve', () => {
    it('always removes the shield, even if the animation never completes', () => {
      expect(sceneDelegate).toMatch(/shieldFadeTimeout/);
      expect(sceneDelegate).toMatch(
        /asyncAfter\(deadline: \.now\(\) \+ Self\.shieldFadeTimeout\)[\s\S]{0,80}finish\(\)/,
      );
    });

    it('honours Reduce Motion by removing instantly', () => {
      expect(sceneDelegate).toMatch(
        /guard !UIAccessibility\.isReduceMotionEnabled else \{ finish\(\); return \}/,
      );
    });

    it('clears the shield reference before animating, so hides cannot race', () => {
      expect(sceneDelegate).toMatch(
        /guard let shield = privacyShield else \{ return \}\s*\n\s*privacyShield = nil/,
      );
    });

    it('cancels an in-flight fade if the app backgrounds again mid-dissolve', () => {
      // Otherwise the shield keeps fading while the app sits in the switcher,
      // progressively revealing the content it exists to hide.
      expect(sceneDelegate).toMatch(
        /if let privacyShield \{[\s\S]{0,200}removeAllAnimations\(\)[\s\S]{0,80}alpha = 1/,
      );
    });

    it('refreshes the cached appearance while the WebView is alive', () => {
      expect(sceneDelegate).toMatch(
        /func sceneDidBecomeActive[\s\S]*?captureAppAppearance\(\)/,
      );
      expect(sceneDelegate).toContain("getAttribute('data-theme')");
    });
  });
});
