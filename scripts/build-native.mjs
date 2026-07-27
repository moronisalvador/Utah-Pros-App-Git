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
import { existsSync } from 'node:fs';
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
