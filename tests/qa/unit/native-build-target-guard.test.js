/**
 * ════════════════════════════════════════════════
 * FILE: native-build-target-guard.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the check that stops the wrong build being copied into the iPhone
 *   app actually works. It builds fake output folders — one that looks like the
 *   website build, one that looks like the app build — and confirms the check
 *   rejects the first and accepts the second.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:os, node:path
 *   Internal:  scripts/assert-native-dist.mjs, scripts/build-native.mjs, package.json
 *   Data:      reads  → temp fixture directories
 *              writes → temp fixture directories (removed afterwards)
 *
 * NOTES / GOTCHAS:
 *   - Deliberately BEHAVIOURAL: it runs the guard rather than grepping it, so a
 *     rewrite that keeps the strings but breaks the logic still fails here.
 *   - 2026-08-04: a web bundle was hand-synced into the native shell. It looked
 *     correct, but IS_NATIVE_BUILD was false, so deep links were silently dead
 *     and the office/CRM/admin surface shipped inside the app shell. Nothing
 *     reported anything at runtime, which is why this gate exists at build time.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNativeDist } from '../../../scripts/assert-native-dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const temporaryRoots = [];

function fixtureRoot(distContents) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'upr-native-guard-'));
  temporaryRoots.push(root);
  if (distContents) {
    const distDir = path.join(root, 'dist');
    mkdirSync(distDir, { recursive: true });
    for (const [name, body] of Object.entries(distContents)) {
      writeFileSync(path.join(distDir, name), body);
    }
  }
  return root;
}

afterEach(() => {
  while (temporaryRoots.length) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe('native build-target guard', () => {
  it('accepts a dist produced by the native build', () => {
    const root = fixtureRoot({
      'index.html': '<!doctype html>',
      'upr-native-build.json': JSON.stringify({ target: 'native' }),
    });
    expect(assertNativeDist(root)).toBe(true);
  });

  // The exact 2026-08-04 mistake: `npm run build` then `cap sync ios`.
  it('rejects a WEB dist, which is the failure that shipped office screens', () => {
    const root = fixtureRoot({
      'index.html': '<!doctype html>',
      'manifest.json': '{}',
      'sw.js': '',
    });
    expect(() => assertNativeDist(root)).toThrow(/NOT produced by the native build target/);
  });

  it('rejects a dist that declares some other target', () => {
    const root = fixtureRoot({
      'index.html': '<!doctype html>',
      'upr-native-build.json': JSON.stringify({ target: 'web' }),
    });
    expect(() => assertNativeDist(root)).toThrow(/declares build target "web"/);
  });

  it('rejects an unreadable marker rather than assuming native', () => {
    const root = fixtureRoot({
      'index.html': '<!doctype html>',
      'upr-native-build.json': 'not json{',
    });
    expect(() => assertNativeDist(root)).toThrow(/unreadable/);
  });

  it('rejects a missing dist instead of passing vacuously', () => {
    const root = fixtureRoot(null);
    expect(() => assertNativeDist(root)).toThrow(/No dist\/ directory/);
  });

  it('is wired into sync:ios, so every build:ios path is covered', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['sync:ios']).toContain('assert-native-dist');
    // build:ios and the capgo variant both reach cap sync through a guarded script.
    expect(pkg.scripts['build:ios']).toContain('sync:ios');
    expect(pkg.scripts['sync:ios:dev:capgo']).toContain('sync:ios');
  });

  it('is fed by build-native, which writes the marker it reads', () => {
    const buildNative = readFileSync(path.join(ROOT, 'scripts/build-native.mjs'), 'utf8');
    expect(buildNative).toContain('upr-native-build.json');
    expect(buildNative).toContain("target: 'native'");
    // No timestamp: the release workflow rejects Capacitor project drift, so
    // rebuilding the same commit must produce the same bytes.
    expect(buildNative).not.toMatch(/upr-native-build[\s\S]{0,400}Date\.now\(\)/);
  });
});
