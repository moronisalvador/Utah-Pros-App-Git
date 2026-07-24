/**
 * ════════════════════════════════════════════════
 * FILE: launch-ephemeral-browser.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens a fresh headless test browser through a private pipe and immediately verifies it works.
 *   It uses a new temporary profile, never a person's browser, then removes that profile on exit.
 *
 * DEPENDS ON:
 *   Packages:  @playwright/test, Node.js built-ins
 *   Internal:  tests/qa/lib/target-policy.mjs
 *   Data:      reads  → none
 *              writes → one temporary browser profile outside the repository
 *
 * NOTES / GOTCHAS:
 *   - TCP debugging is intentionally not implemented; requesting it fails before browser launch.
 *   - This proves the browser runtime only, not application, account, provider, or device behavior.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { assertCdpLaunchPolicy } from '../../tests/qa/lib/target-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const transportArg = process.argv.find((arg) => arg.startsWith('--transport='));
const transport = transportArg?.slice('--transport='.length) || 'pipe';
const profileRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'upr-qa-browser-'));

try {
  assertCdpLaunchPolicy({ transport, userDataDir: profileRoot, repositoryRoot: root });
  const context = await chromium.launchPersistentContext(profileRoot, {
    headless: true,
    serviceWorkers: 'block',
  });
  const page = context.pages()[0] || await context.newPage();
  await page.setContent('<title>UPR QA browser runtime</title>');
  if ((await page.title()) !== 'UPR QA browser runtime') {
    throw new Error('browser runtime title verification failed');
  }
  await context.close();
  process.stdout.write('Ephemeral Playwright browser: pipe transport verified; TCP socket not requested.\n');
} finally {
  const resolved = path.resolve(profileRoot);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('upr-qa-browser-')) {
    throw new Error('Refusing to remove an unverified browser profile path');
  }
  await fs.rm(resolved, { recursive: true, force: true });
}
