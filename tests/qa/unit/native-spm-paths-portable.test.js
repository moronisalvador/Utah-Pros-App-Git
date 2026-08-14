/**
 * ════════════════════════════════════════════════
 * FILE: native-spm-paths-portable.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Makes sure the iOS project still points at this repository's own copies of
 *   its Capacitor plugins, using short relative paths, rather than at a folder
 *   that only exists on one person's laptop. If it ever points somewhere
 *   machine-specific again, this test fails immediately instead of the iPhone
 *   build failing much later.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — the credential-free `qa` lane, so it runs in CI
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  ios/App/CapApp-SPM/Package.swift, package.json
 *   Data:      reads  → source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - `Package.swift` says "DO NOT MODIFY — managed by Capacitor CLI". True, and
 *     exactly why this guard is needed: nobody edits it on purpose, `cap sync`
 *     rewrites it, and whatever it writes gets committed as build output without
 *     being read.
 *   - This proves PORTABILITY, not that the app compiles. A path can be relative
 *     and still wrong. The compile proof is the release workflow's own build.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGE_SWIFT = join(ROOT, 'ios', 'App', 'CapApp-SPM', 'Package.swift');

/** Every `.package(name: "X", path: "Y")` entry, as [name, path] pairs. */
function localPackageEntries(source) {
  return [...source.matchAll(/\.package\(\s*name:\s*"([^"]+)",\s*path:\s*"([^"]+)"/g)]
    .map((m) => [m[1], m[2]]);
}

describe('the iOS project resolves plugins from THIS checkout', () => {
  const source = readFileSync(PACKAGE_SWIFT, 'utf8');
  const entries = localPackageEntries(source);

  // Regressed twice. a04f1338 (2026-07-27) fixed it; 31c5ade8 (2026-08-12) reintroduced
  // it and shipped to dev, where it sat for a day because the push-triggered
  // "iOS dev TestFlight" workflow only runs tests — it never invokes xcodebuild, so a
  // tree that cannot build reported green. This test runs in that same `npm test`,
  // which is what turns that green into a red.
  it('every local package uses the portable ../../../node_modules path', () => {
    const offenders = entries
      .filter(([name, path]) => path !== `../../../node_modules/${packageDir(name, source)}`)
      .map(([name, path]) => `${name} → ${path}`);
    expect(
      offenders,
      'run `npx cap sync ios` from the repository root and commit the result — a path '
      + 'outside this checkout resolves on one machine and nowhere else',
    ).toEqual([]);
  });

  // The concrete failure: paths like
  //   ../../../../../../../Users/<someone>/.codex/worktrees/a94b/.../node_modules/@capacitor/app
  // are still "relative", so a naive relative-vs-absolute check passes them.
  it('no path escapes the repository or names a home directory', () => {
    const escaping = entries
      .filter(([, path]) => path.startsWith('/') || /(^|\/)Users\//.test(path) || /worktrees/.test(path))
      .map(([name, path]) => `${name} → ${path}`);
    expect(escaping, 'this path exists on one laptop; CI cannot resolve it').toEqual([]);
  });

  it('covers every Capacitor dependency in package.json, so a new plugin cannot slip past', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const nativeDeps = Object.keys(pkg.dependencies || {})
      .filter((d) => d.startsWith('@capacitor/') || d.startsWith('@capgo/') || d.startsWith('@aparajita/'))
      .filter((d) => d !== '@capacitor/core' && d !== '@capacitor/cli' && d !== '@capacitor/ios');
    const declared = new Set(entries.map(([, path]) => path.replace('../../../node_modules/', '')));
    const missing = nativeDeps.filter((d) => !declared.has(d));
    expect(missing, 'a native plugin is installed but not wired into Package.swift').toEqual([]);
  });
});

/** The node_modules directory a Capacitor package name maps to, read from the file itself. */
function packageDir(name, source) {
  const match = source.match(
    new RegExp(`\\.package\\(\\s*name:\\s*"${name}",\\s*path:\\s*"[^"]*node_modules/([^"]+)"`),
  );
  return match ? match[1] : name;
}
