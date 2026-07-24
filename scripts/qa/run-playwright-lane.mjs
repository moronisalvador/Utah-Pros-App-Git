/**
 * ════════════════════════════════════════════════
 * FILE: run-playwright-lane.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the credential-free browser lane and always scans retained artifacts, including failures.
 *
 * DEPENDS ON:
 *   Packages: @playwright/test
 *   Internal: scripts/qa/safe-child-env.mjs, scripts/qa/scan-test-artifacts.mjs
 *   Data: reads → synthetic local fixture; writes → scanned Playwright failure artifacts
 *
 * NOTES / GOTCHAS:
 *   - The browser result remains failing even when the subsequent artifact scan is clean.
 * ════════════════════════════════════════════════
 */

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { safeChildEnv } from './safe-child-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const childEnv = safeChildEnv(process.env, {
  CI: process.env.CI || '',
  NODE_ENV: 'test',
});
const listOnly = process.argv.slice(2).includes('--list');
const browser = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    ...(listOnly ? ['--list'] : ['--workers=2']),
  ],
  { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true },
);
const scan = listOnly ? { status: 0 } : spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'qa', 'scan-test-artifacts.mjs')],
    { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true },
  );

if (scan.error || scan.status !== 0) process.exit(scan.status || 1);
if (browser.error || browser.status !== 0) process.exit(browser.status || 1);
