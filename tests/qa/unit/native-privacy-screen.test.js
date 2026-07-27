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
    expect(appDelegate).toContain('shield.backgroundColor = .systemBackground');
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
});
