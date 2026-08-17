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
import { assertNativeDist, assertNoLoopbackHost } from '../../../scripts/assert-native-dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const temporaryRoots = [];

function fixtureRoot(distContents) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'upr-native-guard-'));
  temporaryRoots.push(root);
  if (distContents) {
    const distDir = path.join(root, 'dist');
    mkdirSync(distDir, { recursive: true });
    for (const [name, body] of Object.entries(distContents)) {
      const target = path.join(distDir, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
  }
  return root;
}

// ─── Real bytes from real bundles ──────────────
//
// Both sets are VERBATIM excerpts captured 2026-08-16 by building the same
// commit twice — once with .env.local on the local stack, once on production —
// and grepping the emitted chunks. They are not hand-written approximations:
// the whole point of the loopback guard is which of these it can tell apart,
// and a paraphrased fixture would prove nothing about the real bundle.

// What a CORRECT native bundle contains. Every one of these is vendored library
// code, and every one of them would be failed by a naive `localhost` matcher.
const CLEAN_VENDOR_CHUNKS = {
  // gotrue-js's default GOTRUE_URL constant
  'app-assets/endedSessionGuard-CLEAN.js':
    'Dt=`2.99.3`,Ot=30*1e3,kt=3*Ot,At=`http://localhost:9999`,jt=`supabase.auth.token`',
  // a WebAuthn hostname check, and react-router's base-URL fallback
  'app-assets/chunk-CLEAN.js':
    'function nr(e){return e===`localhost`||/^([a-z0-9]+(-[a-z0-9]+)*\\.)+[a-z]{2,}$/i.test(e)}'
    + 'function h(e,t=!1){let n=`http://localhost`;typeof window<`u`&&(n=window.location.origin)}',
};

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

describe('native loopback-host guard', () => {
  // THE CASE THIS EXISTS FOR. Verbatim from the chunk that shipped to a phone
  // on 2026-08-15 and could not sign anyone in: VITE_SUPABASE_URL was baked in
  // from .env.local, and on a device 127.0.0.1 is the device.
  it('refuses the exact bundle shape that broke the TestFlight build', () => {
    const root = fixtureRoot({
      ...CLEAN_VENDOR_CHUNKS,
      'upr-native-build.json': JSON.stringify({ target: 'native' }),
      'app-assets/AuthContext-BROKEN.js':
        'var O=`http://127.0.0.1:54321`,k=`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`',
    });
    expect(() => assertNoLoopbackHost(root)).toThrow(/loopback reference/);
    expect(() => assertNoLoopbackHost(root)).toThrow(/AuthContext-BROKEN\.js/);
  });

  // The measurement that chose the patterns. If this ever fails, the guard has
  // started failing CORRECT builds — which gets it switched off, and then the
  // 2026-08-15 incident can happen again with no guard at all.
  it('passes a correct bundle, whose vendor code legitimately says localhost', () => {
    const root = fixtureRoot({
      ...CLEAN_VENDOR_CHUNKS,
      'upr-native-build.json': JSON.stringify({ target: 'native' }),
      'app-assets/AuthContext-CLEAN.js':
        'var O=`https://glsmljpabrwonfiltiqm.supabase.co`,k=`eyJhbGciOiJIUzI1NiJ9`',
    });
    expect(assertNoLoopbackHost(root)).toBe(true);
  });

  it('refuses every loopback spelling, not just the one that bit us', () => {
    const cases = [
      ['127.0.0.1', 'fetch(`http://127.0.0.1:54321/auth/v1/token`)'],
      ['127.0.0.2', 'fetch(`http://127.0.0.2:54321/rest/v1/`)'],   // all of 127/8
      ['0.0.0.0', 'var u=`http://0.0.0.0:5173/`'],
      ['[::1]', 'var u=`http://[::1]:54321/rest/v1/`'],
      ['localhost:54321', 'var u=`http://localhost:54321`'],        // Supabase API
      ['localhost:8788', 'var u=`http://localhost:8788/api/`'],     // wrangler pages dev
      ['localhost:5173', 'var u=`http://localhost:5173/`'],         // vite
    ];
    for (const [label, body] of cases) {
      const root = fixtureRoot({
        'upr-native-build.json': JSON.stringify({ target: 'native' }),
        'app-assets/chunk.js': body,
      });
      expect(() => assertNoLoopbackHost(root), label).toThrow(/loopback reference/);
    }
  });

  it('scans nested asset directories, where the real chunks live', () => {
    const root = fixtureRoot({
      'upr-native-build.json': JSON.stringify({ target: 'native' }),
      'index.html': '<!doctype html>',
      'app-assets/deep/nested/chunk.js': 'var u=`http://127.0.0.1:54321`',
    });
    expect(() => assertNoLoopbackHost(root)).toThrow(/deep\/nested\/chunk\.js/);
  });

  it('names every offending file, so one rebuild fixes them all', () => {
    const root = fixtureRoot({
      'upr-native-build.json': JSON.stringify({ target: 'native' }),
      'app-assets/a.js': 'var u=`http://127.0.0.1:54321`',
      'app-assets/b.js': 'var u=`http://127.0.0.1:54321`',
      'app-assets/c.js': 'var u=`http://127.0.0.1:54321`',
    });
    expect(() => assertNoLoopbackHost(root)).toThrow(/3 loopback reference/);
  });

  it('refuses a missing dist instead of passing vacuously', () => {
    const root = fixtureRoot(null);
    expect(() => assertNoLoopbackHost(root)).toThrow(/No dist\/ directory/);
  });

  it('runs as part of the gate, not merely as an available export', () => {
    // A guard nobody calls is documentation. `sync:ios` is the chokepoint every
    // build:ios path goes through, and it runs this file directly.
    const guard = readFileSync(path.join(ROOT, 'scripts/assert-native-dist.mjs'), 'utf8');
    const directRun = guard.slice(guard.indexOf('process.argv[1]'));
    expect(directRun).toContain('assertNativeDist()');
    expect(directRun).toContain('assertNoLoopbackHost()');
  });
});
