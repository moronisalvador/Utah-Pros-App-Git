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
 *   Internal:  ios/App/App/AppDelegate.swift
 *   Data:      reads repository source only
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const appDelegate = readFileSync(
  join(ROOT, 'ios/App/App/AppDelegate.swift'),
  'utf8',
);

describe('native app-switcher privacy shield', () => {
  it('installs an opaque native shield before background snapshots', () => {
    expect(appDelegate).toContain('private func showPrivacyShield()');
    // RES-01: was pinned to `.systemBackground`, which follows the PHONE's
    // light/dark setting while the app runs its own theme — a dark-themed app on
    // a light-mode phone flashed a white shield over dark content. The shield
    // now uses the appearance last reported by the web layer. Still opaque,
    // which is the property this test actually exists to protect.
    expect(appDelegate).toContain('shield.backgroundColor = lastKnownAppearance');
    expect(appDelegate).toMatch(/private var lastKnownAppearance: UIColor = \.systemBackground/);
    expect(appDelegate).toMatch(
      /func applicationWillResignActive[\s\S]*?showPrivacyShield\(\)/,
    );
    expect(appDelegate).toMatch(
      /func applicationDidEnterBackground[\s\S]*?showPrivacyShield\(\)/,
    );
  });

  it('removes the shield only after the app becomes active', () => {
    expect(appDelegate).toContain('private func hidePrivacyShield()');
    expect(appDelegate).toMatch(
      /func applicationDidBecomeActive[\s\S]*?hidePrivacyShield\(\)/,
    );
    expect(appDelegate).toContain(
      'accessibilityIdentifier = "upr-privacy-shield"',
    );
  });

  // RES-01 — the removal is a dissolve now, not a hard cut. These pin the
  // safety properties, not the aesthetics: a privacy shield that can strand is
  // far worse than one that cuts abruptly.
  describe('RES-01 — foreground dissolve', () => {
    it('always removes the shield, even if the animation never completes', () => {
      expect(appDelegate).toMatch(/shieldFadeTimeout/);
      expect(appDelegate).toMatch(
        /asyncAfter\(deadline: \.now\(\) \+ Self\.shieldFadeTimeout\)[\s\S]{0,80}finish\(\)/,
      );
    });

    it('honours Reduce Motion by removing instantly', () => {
      expect(appDelegate).toMatch(
        /guard !UIAccessibility\.isReduceMotionEnabled else \{ finish\(\); return \}/,
      );
    });

    it('clears the shield reference before animating, so hides cannot race', () => {
      expect(appDelegate).toMatch(
        /guard let shield = privacyShield else \{ return \}\s*\n\s*privacyShield = nil/,
      );
    });

    it('cancels an in-flight fade if the app backgrounds again mid-dissolve', () => {
      // Otherwise the shield keeps fading while the app sits in the switcher,
      // progressively revealing the content it exists to hide.
      expect(appDelegate).toMatch(
        /if let privacyShield \{[\s\S]{0,200}removeAllAnimations\(\)[\s\S]{0,80}alpha = 1/,
      );
    });

    it('refreshes the cached appearance while the WebView is alive', () => {
      expect(appDelegate).toMatch(
        /func applicationDidBecomeActive[\s\S]*?captureAppAppearance\(\)/,
      );
      expect(appDelegate).toContain("getAttribute('data-theme')");
    });
  });
});
