/**
 * ════════════════════════════════════════════════
 * FILE: verify-oop-pricing-ui.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens the real configurable OOP calculator at common field-phone widths
 *   with made-up data. It catches visual crowding, unsafe browser traffic,
 *   inaccessible controls, and dark/reduced-motion regressions.
 *
 * DEPENDS ON:
 *   Packages:  @playwright/test, @axe-core/playwright, @vitejs/plugin-react, vite
 *   Internal:  tests/qa/fixtures/oop-pricing*, tests/qa/lib/browser-guard.mjs
 *   Data:      reads  → synthetic in-memory fixture state only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is Chromium layout evidence only. Keyboard-inset mode proves page
 *     composition, not actual WKWebView behavior on a signed device.
 *   - Dirty in-app links and browser/native Back are exercised in Chromium
 *     against the real BrowserRouter history stack.
 *   - The try/finally closes the browser and Vite server on every outcome.
 * ════════════════════════════════════════════════
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBrowserGuard } from '../../tests/qa/lib/browser-guard.mjs';

const HOST = '127.0.0.1';
// browser-guard.mjs admits only this existing loopback QA origin.
const PORT = 4173;
const ORIGIN = `http://${HOST}:${PORT}`;
const REPO_SRC = fileURLToPath(new URL('../../src', import.meta.url));
const MOCKS = fileURLToPath(new URL('../../tests/qa/fixtures/oop-pricing-mocks/', import.meta.url));
const mock = (name) => `${MOCKS}${name}`;
const TECH_WIDTHS = [320, 360, 375, 390, 412, 430, 768];
const FIXTURE_HTML = fileURLToPath(new URL('../../tests/qa/fixtures/oop-pricing.html', import.meta.url));
const MIME_TYPES = Object.freeze({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' });
function contentType(file) { return MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'; }
async function findBuiltFixture(root) {
  const entries = await fs.readdir(root, { recursive: true });
  const fixture = entries.find((entry) => entry.endsWith('.html'));
  if (!fixture) throw new Error('Static fixture build emitted no HTML entry');
  return path.resolve(root, fixture);
}
async function createStaticFixtureServer(outputDir) {
  const expectedHost = `${HOST}:${PORT}`;
  const root = path.resolve(outputDir);
  const fixture = await findBuiltFixture(root);
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', ORIGIN);
    const safeMethod = request.method === 'GET' || request.method === 'HEAD';
    const requested = requestUrl.pathname === '/' ? '/oop-pricing.html' : requestUrl.pathname;
    const file = requested === '/oop-pricing.html' ? fixture : path.resolve(root, '.' + requested);
    const relative = path.relative(root, file);
    const insideRoot = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; worker-src 'none'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.headers.host !== expectedHost || !safeMethod || !insideRoot) { response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Denied'); return; }
    try { const body = await fs.readFile(file); response.writeHead(200, { 'Content-Type': contentType(file) }); response.end(request.method === 'HEAD' ? undefined : body); } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, HOST, () => { server.off('error', reject); resolve(); }); });
  return { close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }) };
}

async function snapshot(page, label) {
  return page.evaluate((label) => {
    const tech = document.querySelector('.oop-page--tech');
    const cards = [...document.querySelectorAll('.oop-section')];
    const actions = [...document.querySelectorAll('.oop-page--tech .oop-tech-action, .oop-page--tech .ui-seg-btn')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      });
    const rects = [...document.querySelectorAll('.oop-page--tech *')].map((element) => element.getBoundingClientRect());
    return {
      label,
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth, (tech?.scrollWidth || 0) - (tech?.clientWidth || 0)),
      clipped: cards.some((card) => card.scrollWidth > card.clientWidth)
        || rects.some((rect) => rect.left < -0.5 || rect.right > window.innerWidth + 0.5),
      minAction: actions.length ? Math.min(...actions.map((element) => element.getBoundingClientRect().height)) : null,
      indicator: Boolean(document.querySelector('.oop-job-type-seg .ui-seg-indicator')),
    };
  }, label);
}

function assertSnapshot(state) {
  if (state.overflow > 0) throw new Error(`${state.label}: ${state.overflow}px horizontal overflow`);
  if (state.clipped) throw new Error(`${state.label}: clipped OOP content`);
  if (state.minAction === null || state.minAction < 48) throw new Error(`${state.label}: OOP action below 48px (${state.minAction})`);
  if (!state.indicator) throw new Error(`${state.label}: missing job-type segment indicator`);
}

async function bounded(label, promise, timeoutMs = 20_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function open(context, path) {
  const page = await context.newPage();
  const pageErrors = [];
  const requests = [];
  const requestFailures = [];
  const consoleErrors = [];
  page.on('dialog', (dialog) => { void dialog.accept(); });
  page.on('request', (request) => {
    if (requests.length < 100) requests.push(`${request.resourceType()} ${new URL(request.url()).pathname}`);
  });
  page.on('requestfailed', (request) => {
    if (requestFailures.length < 5) requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText || 'failed'}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && consoleErrors.length < 5) consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (pageErrors.length < 3) pageErrors.push(error.stack || error.message);
  });
  try {
    await page.goto(`${ORIGIN}/oop-pricing.html?${path}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.getByRole('heading', { name: 'OOP Pricing Calculator' }).waitFor({ timeout: 30_000 });
  } catch (error) {
    const bodyText = await page.locator('body').innerText().catch(() => 'unavailable');
    const html = await page.content().catch(() => 'unavailable');
    throw new Error(`${error.message}; requests: ${requests.join(' | ') || 'none'}; page errors: ${pageErrors.join(' | ') || 'none'}; request failures: ${requestFailures.join(' | ') || 'none'}; console errors: ${consoleErrors.join(' | ') || 'none'}; body: ${bodyText.slice(0, 500) || '(empty)'}; html: ${html.slice(0, 700)}`);
  }
  return page;
}

function phase(label) { process.stderr.write(`[oop-ui-qa] ${label}\n`); }

let server;
let browser;
let outputDir;
try {
  phase('build:start');
  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upr-oop-pricing-ui-'));
  await bounded('Static fixture build', build({
    configFile: false,
    root: process.cwd(),
    logLevel: 'error',
    publicDir: false,
    plugins: [react()],
    resolve: { alias: [
      { find: '@/contexts/AuthContext', replacement: mock('AuthContext.js') },
      { find: '@/lib/nativeHaptics', replacement: mock('nativeHaptics.js') },
      { find: '@/lib/useNativeKeyboardInset', replacement: mock('useNativeKeyboardInset.js') },
      { find: '@', replacement: REPO_SRC },
    ] },
    build: {
      outDir: outputDir,
      emptyOutDir: true,
      sourcemap: false,
      assetsDir: 'assets',
      rollupOptions: { input: { 'oop-pricing': FIXTURE_HTML } },
    },
  }), 120_000);
  phase('build:done');
  server = await createStaticFixtureServer(outputDir);
  phase('server:ready');

  browser = await chromium.launch({ headless: true });
  phase('browser:ready');
  const decisions = [];
  const makeContext = async (width, colorScheme = 'light') => {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, deviceScaleFactor: 1, hasTouch: width <= 768,
      isMobile: width <= 430, locale: 'en-US', timezoneId: 'America/Denver',
      colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block',
    });
    await installBrowserGuard(context, (entry) => decisions.push(entry));
    return context;
  };

  const results = [];
  for (const width of TECH_WIDTHS) {
    phase(`tech-${width}:start`);
    const context = await makeContext(width);
    const page = await open(context, 'variant=tech');
    const state = await snapshot(page, `tech-${width}-light`);
    assertSnapshot(state);
    results.push(state);
    await context.close();
    phase(`tech-${width}:done`);
  }
  phase('tech-matrix:done');

  phase('dark:start');
  const darkContext = await makeContext(390, 'dark');
  phase('dark:context');
  const darkPage = await open(darkContext, 'variant=tech');
  phase('dark:open');
  await darkPage.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const darkState = await snapshot(darkPage, 'tech-390-dark');
  assertSnapshot(darkState);
  results.push(darkState);
  const reduced = await darkPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!reduced) throw new Error('reduced-motion media state was not active');
  phase('dark:media');

  const scopeField = darkPage.getByLabel('Scope and special conditions');
  await scopeField.scrollIntoViewIfNeeded({ timeout: 10_000 });
  const scopeRect = await scopeField.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  if (scopeRect.width <= 0 || scopeRect.height <= 0) throw new Error('scope field is not visibly rendered');
  const axe = await bounded('Axe analysis', new AxeBuilder({ page: darkPage }).include('.oop-page--tech').analyze());
  phase('dark:axe');
  const serious = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  if (serious.length) {
    const details = serious.flatMap((violation) => violation.nodes.slice(0, 5).map((node) => (
      `${violation.id} ${node.target.join(' ')} ${node.html}: ${node.failureSummary}`
    )));
    throw new Error(`Axe serious/critical violations: ${details.join(' | ')}`);
  }
  await darkContext.close();
  phase('dark:done');

  const insetContext = await makeContext(390);
  const insetPage = await open(insetContext, 'variant=tech&keyboardInset=1');
  const insetPadding = await insetPage.locator('.oop-tech-refresh-body').evaluate((element) => getComputedStyle(element).paddingBottom);
  if (Number.parseFloat(insetPadding) < 312) throw new Error(`keyboard inset did not create scroll room (${insetPadding})`);
  results.push(await snapshot(insetPage, 'tech-390-keyboard-inset'));
  await insetContext.close();
  phase('keyboard-inset:done');

  const desktopContext = await makeContext(1440);
  const desktopPage = await open(desktopContext, 'variant=desktop');
  const desktopOverflow = await desktopPage.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  if (desktopOverflow > 0) throw new Error(`desktop has ${desktopOverflow}px horizontal overflow`);
  await desktopContext.close();
  phase('desktop:done');

  const historyGuard = await (async () => {
    const context = await makeContext(1440);
    const page = await open(context, 'variant=desktop');
    const previousUrl = page.url();
    const calculatorUrl = `${previousUrl}&guardDirty=1`;
    await page.goto(calculatorUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'OOP Pricing Calculator' }).waitFor();
    phase('history-guard:calculator-ready');
    await page.waitForFunction(() => Boolean(window.history.state?.uprUnsavedNavigationGuard));
    phase('history-guard:dirty');

    await page.evaluate(() => window.history.back());
    const historyAlert = page.getByRole('alert').filter({ hasText: 'Synthetic unsaved navigation' });
    await historyAlert.waitFor();
    await page.waitForFunction(() => Boolean(window.history.state?.uprUnsavedNavigationGuard));
    phase('history-guard:blocked');
    if (page.url() !== calculatorUrl) throw new Error(`Back guard left the calculator before confirmation (${page.url()})`);
    await historyAlert.getByRole('button', { name: 'Stay' }).click();
    phase('history-guard:stayed');
    if (page.url() !== calculatorUrl) throw new Error('Stay did not preserve the calculator URL');

    await page.evaluate(() => window.history.back());
    await historyAlert.waitFor();
    phase('history-guard:blocked-again');
    await historyAlert.getByRole('button', { name: 'Confirm discard' }).click();
    phase('history-guard:confirmed');
    await page.waitForURL(previousUrl);
    await context.close();
    return true;
  })();
  phase('history-guard:done');

  const linkGuard = await (async () => {
    const context = await makeContext(1440);
    const page = await open(context, 'variant=desktop&guardDirty=1');
    const calculatorUrl = page.url();
    await page.waitForFunction(() => Boolean(window.history.state?.uprUnsavedNavigationGuard));
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/synthetic-destination';
      link.textContent = 'Synthetic destination';
      link.id = 'synthetic-destination-link';
      document.body.append(link);
    });

    await page.locator('#synthetic-destination-link').click();
    const linkAlert = page.getByRole('alert').filter({ hasText: 'Synthetic unsaved navigation' });
    await linkAlert.waitFor();
    if (page.url() !== calculatorUrl) throw new Error(`Dirty link left before confirmation (${page.url()})`);
    await linkAlert.getByRole('button', { name: 'Confirm discard' }).click();
    await page.waitForURL(`${ORIGIN}/synthetic-destination`);
    await page.evaluate(() => window.history.back());
    await page.waitForURL(calculatorUrl);
    await context.close();
    return true;
  })();
  phase('link-guard:done');

  const localWriteDenied = await (async () => {
    const context = await makeContext(390);
    const page = await open(context, 'variant=tech');
    const denied = await page.evaluate(async () => {
      try { await fetch('/__synthetic_write_denied__', { method: 'POST' }); return false; } catch { return true; }
    });
    await context.close();
    return denied;
  })();
  phase('write-guard:done');
  if (!localWriteDenied) throw new Error('browser guard allowed a local write');
  const deniedReasons = decisions.filter((entry) => entry.kind === 'deny').map((entry) => entry.reason);
  if (!deniedReasons.includes('method')) throw new Error('browser guard did not record write denial');
  if (decisions.some((entry) => entry.kind === 'allow' && entry.origin !== ORIGIN)) throw new Error('browser guard allowed non-loopback traffic');

  phase('checks:complete');
  process.stdout.write(`${JSON.stringify({
    axeSeriousCritical: 0,
    desktopHorizontalOverflowPx: desktopOverflow,
    keyboardInsetMode: 'layout composition only; not WKWebView evidence',
    localWriteDenied,
    unsavedNavigation: { browserBack: historyGuard, inAppLink: linkGuard },
    reducedMotion: reduced,
    techWidths: TECH_WIDTHS,
    variants: { desktop: 'passed', tech: 'passed' },
    viewportChecks: results,
  })}\n`);
} finally {
  phase('cleanup:start');
  await browser?.close();
  phase('cleanup:browser');
  await server?.close();
  phase('cleanup:server');
  if (outputDir) await fs.rm(outputDir, { recursive: true, force: true });
  phase('cleanup:files');
}
