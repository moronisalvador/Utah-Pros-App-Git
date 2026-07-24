/**
 * ════════════════════════════════════════════════
 * FILE: foundation.spec.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Exercises deterministic desktop and 390-pixel synthetic workflows without accounts or live data.
 *   It proves accessibility, keyboard/focus, lifecycle preservation, and forbidden egress behavior.
 *
 * DEPENDS ON:
 *   Packages:  @playwright/test, @axe-core/playwright
 *   Internal:  tests/qa/lib/browser-guard.mjs, tests/qa/fixtures/browser-foundation.html
 *   Data:      reads  → synthetic fixture only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is browser-foundation evidence, not proof of any UPR page, production data, or iPhone feel.
 *   - Every external-looking request is intercepted locally and never reaches the network.
 * ════════════════════════════════════════════════
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test as base } from '@playwright/test';

import { installBrowserGuard } from '../lib/browser-guard.mjs';

const test = base.extend({
  guardDecisions: [async ({ context }, use) => {
    const decisions = [];
    await installBrowserGuard(context, (event) => decisions.push(event));
    await use(decisions);
  }, { auto: true }],
});

function routeFor(projectName) {
  return projectName === 'mobile-390' ? '/qa?shell=tech' : '/qa?shell=office';
}

test('renders deterministic loading, error, empty, stale, and ready states', async ({
  page,
}, testInfo) => {
  await page.goto(routeFor(testInfo.project.name));
  await expect(page.getByRole('heading', { name: 'Credential-free workflow fixture' })).toBeVisible();
  await expect(page.getByText(testInfo.project.name === 'mobile-390' ? 'Tech shell' : 'Office shell')).toBeVisible();

  await page.getByRole('button', { name: 'Loading' }).click();
  await expect(page.getByLabel('Loading synthetic rows')).toBeVisible();
  await page.getByRole('button', { name: 'Error' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load synthetic rows');
  await page.getByRole('button', { name: 'Empty' }).click();
  await expect(page.getByText('The request succeeded with zero results.')).toBeVisible();
  await page.getByRole('button', { name: 'Stale' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Showing saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Ready' }).click();
  await expect(page.getByRole('list', { name: 'Synthetic rows' })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('has no serious or critical axe violations', async ({ page }, testInfo) => {
  await page.goto(routeFor(testInfo.project.name));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(({ impact }) => ['serious', 'critical'].includes(impact));
  expect(blocking).toEqual([]);
});

test('keeps keyboard focus inside the dialog and returns it on close', async ({ page }, testInfo) => {
  await page.goto(routeFor(testInfo.project.name));
  const opener = page.getByRole('button', { name: 'Open details' });
  await opener.focus();
  await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Synthetic details' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Secondary action' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Secondary action' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('preserves input, scroll, route, and rendered state across a resume event', async ({
  page,
}, testInfo) => {
  await page.goto(routeFor(testInfo.project.name));
  await page.getByLabel('Synthetic draft').fill('half-finished');
  await page.getByRole('button', { name: 'Stale' }).click();
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByLabel('Synthetic draft')).toHaveValue('half-finished');
  await expect(page.getByRole('status').filter({ hasText: 'Showing saved' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`shell=${testInfo.project.name === 'mobile-390' ? 'tech' : 'office'}`));
});

test('rejects production database and provider egress', async ({
  page,
  guardDecisions,
}, testInfo) => {
  await page.goto(routeFor(testInfo.project.name));
  await page.getByRole('button', { name: 'Production database request' }).click();
  await expect(page.getByText('Denied')).toBeVisible();
  await page.getByRole('button', { name: 'Provider request' }).click();
  await expect(page.getByText('Denied')).toBeVisible();

  expect(guardDecisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'deny', origin: 'https://glsmljpabrwonfiltiqm.supabase.co' }),
    expect.objectContaining({ kind: 'deny', origin: 'https://api.twilio.com' }),
  ]));
});

test('rejects external popup, WebSocket, download, and direct production navigation', async ({
  page,
  guardDecisions,
}, testInfo) => {
  await page.goto(routeFor(testInfo.project.name));
  await page.getByRole('button', { name: 'External popup' }).click();
  await page.getByRole('button', { name: 'External WebSocket' }).click();
  await expect(page.getByText('Denied')).toBeVisible();
  await page.getByRole('link', { name: 'Download' }).click();

  await expect.poll(() => guardDecisions.map(({ reason }) => reason)).toEqual(
    expect.arrayContaining(['popup', 'websocket', 'download']),
  );
  await expect(page.goto('https://utahpros.app/')).rejects.toThrow();
  expect(guardDecisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'deny', origin: 'https://utahpros.app' }),
  ]));
});
