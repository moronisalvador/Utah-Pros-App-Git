/**
 * ════════════════════════════════════════════════
 * FILE: playwright.config.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the credential-free synthetic browser suite at desktop and 390-pixel widths. It starts the
 *   exact local fixture, blocks service workers and retained session artifacts, and never selects a URL.
 *
 * DEPENDS ON:
 *   Packages:  @playwright/test
 *   Internal:  scripts/qa/serve-browser-fixture.mjs, tests/qa/browser/
 *   Data:      reads  → synthetic browser fixture only
 *              writes → privacy-scanned failure screenshots only
 *
 * NOTES / GOTCHAS:
 *   - The target is a code constant, not an environment variable, so production cannot enter this lane.
 *   - Visual baselines wait for the approved pinned Linux image; this config does not fake that evidence.
 * ════════════════════════════════════════════════
 */

import process from 'node:process';

import { defineConfig } from '@playwright/test';

import { LOCAL_BROWSER_ORIGIN } from './tests/qa/lib/target-policy.mjs';

export default defineConfig({
  testDir: './tests/qa/browser',
  testMatch: '**/*.spec.js',
  globalSetup: './tests/qa/browser/global-setup.mjs',
  outputDir: './test-results/qa-browser',
  fullyParallel: true,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [
    ['list'],
    ['./tests/qa/reporters/no-unexpected-skips.mjs'],
  ],
  use: {
    baseURL: LOCAL_BROWSER_ORIGIN,
    locale: 'en-US',
    timezoneId: 'America/Denver',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    acceptDownloads: false,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: {
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
        hasTouch: false,
      },
    },
    {
      name: 'mobile-390',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
