/**
 * ════════════════════════════════════════════════
 * FILE: scripts/build-native.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds the web bundle with the native-only build flag, without mutating
 *   either Capacitor platform. Synchronizing iOS remains a separate,
 *   deliberate release step.
 *
 * DEPENDS ON:
 *   Packages:  vite
 *   Internal:  vite.config.js, src/
 *   Data:      reads  → source files and VITE_* environment variables
 *              writes → dist/
 *
 * NOTES / GOTCHAS:
 *   - This script never runs `cap sync`.
 *   - VITE_BUILD_TARGET is forced to `native`; a caller cannot accidentally
 *     create a browser-target bundle for the native shell.
 * ════════════════════════════════════════════════
 */
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const viteEntry = path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js');

if (!existsSync(viteEntry)) {
  throw new Error('Vite is not installed. Run npm ci before building the native bundle.');
}

const result = spawnSync(process.execPath, [viteEntry, 'build'], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    VITE_BUILD_TARGET: 'native',
  },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}

// ─── SECTION: Native payload prune (PERF-02) ──────────────
//
// Vite copies all of public/ verbatim, and several of those files exist only
// for the deployed website. A WKWebView cannot register a service worker from
// a local file origin, has no install manifest, and never serves the embed
// script or the marketing documents — yet every one of them shipped inside the
// .app and was parsed or at least paid for on disk.
//
// Deleted from the NATIVE dist only. The web build is untouched: this script
// is the native entry point, and `npm run build` never reaches this code.
const PRUNE = [
  'sw.js',                 // no service worker on a file:// origin
  'sw-target.js',          // its push-target allowlist, same reason
  'manifest.json',         // install manifest — the app is already installed
  'reset.html',            // web cache-recovery page
  '_headers',              // Cloudflare Pages directives
  '_redirects',            // Cloudflare Pages directives
  'embed.js',              // public form embed for third-party sites
  'UPR-Hierarchy-Diagram.html',
  'UPR-Invoicing-Financials-Guide.pdf',
];

const distDir = path.join(repositoryRoot, 'dist');
let removed = 0;
let bytes = 0;
for (const name of PRUNE) {
  const target = path.join(distDir, name);
  if (!existsSync(target)) continue;      // absent is fine, not an error
  try {
    bytes += statSync(target).size;
    rmSync(target, { force: true });
    removed += 1;
  } catch (error) {
    // A prune failure must not fail the build — the app still works with the
    // extra file, it is just heavier than it needs to be.
    console.warn(`build-native: could not prune ${name}:`, error?.message || error);
  }
}
console.log(`build-native: pruned ${removed} web-only asset(s), ${bytes} bytes`);
