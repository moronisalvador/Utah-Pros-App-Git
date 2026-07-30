/**
 * ════════════════════════════════════════════════
 * FILE: verify-notifications-settings-ui.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens the real Notifications Settings component at 390px with synthetic
 *   device/database modules, proves loading and failure UI, then waits 30
 *   seconds and proves silent resume preserves input, scroll, route, and state.
 *
 * DEPENDS ON:
 *   Packages:  @playwright/test, @vitejs/plugin-react, vite
 *   Internal:  tests/qa/fixtures/notifications-settings.{html,jsx}
 *   Data:      synthetic in-memory state only; all non-local requests are blocked
 *
 * NOTES / GOTCHAS:
 *   - Run through run-owned-subprocess.mjs so browser/server children are
 *     bounded and cleaned as one process group.
 *   - This is Chromium behavior/regression evidence, not true WKWebView feel or
 *     a signed-device Push proof.
 * ════════════════════════════════════════════════
 */
import { chromium } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installBrowserGuard } from '../../tests/qa/lib/browser-guard.mjs';

const HOST = '127.0.0.1';
const PORT = 4173;
const ORIGIN = `http://${HOST}:${PORT}`;
const MAC_CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO_SRC = fileURLToPath(new URL('../../src', import.meta.url));
const MOCKS = fileURLToPath(
  new URL(
    '../../tests/qa/fixtures/notifications-settings-mocks/',
    import.meta.url,
  ),
);
const mock = (name) => `${MOCKS}${name}`;

async function assertViewportAndTargets(page, state) {
  const snapshot = await page.evaluate(() => {
    const scroller = document.querySelector('.tech-content');
    const visibleActions = [...document.querySelectorAll(
      '.tech-settings-card button, .tech-settings-card a',
    )].filter(element => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && box.width > 0 && box.height > 0;
    });
    return {
      clipped: [...document.querySelectorAll('.tech-settings-card')].some(card => (
        card.scrollWidth > card.clientWidth
        || card.getBoundingClientRect().left < 0
        || card.getBoundingClientRect().right > window.innerWidth
      )),
      horizontalOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth - window.innerWidth,
        (scroller?.scrollWidth || 0) - (scroller?.clientWidth || 0),
      ),
      minimumActionHeightPx: visibleActions.length
        ? Math.min(...visibleActions.map(element => (
          element.getBoundingClientRect().height
        )))
        : null,
    };
  });
  if (snapshot.horizontalOverflowPx > 0) {
    throw new Error(
      `${state} has ${snapshot.horizontalOverflowPx}px horizontal overflow`,
    );
  }
  if (snapshot.clipped) {
    throw new Error(`${state} has horizontally clipped Settings content`);
  }
  if (
    snapshot.minimumActionHeightPx !== null
    && snapshot.minimumActionHeightPx < 48
  ) {
    throw new Error(
      `${state} action is below 48px: ${snapshot.minimumActionHeightPx}`,
    );
  }
  return snapshot;
}

let server;
let browser;
try {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    logLevel: 'error',
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: '@/contexts/AuthContext',
          replacement: mock('AuthContext.js'),
        },
        {
          find: '@/components/settings/NotificationPrefsMatrix',
          replacement: mock('NotificationPrefsMatrix.jsx'),
        },
        {
          find: '@/lib/nativeHaptics',
          replacement: mock('nativeHaptics.js'),
        },
        {
          find: '@/lib/toast',
          replacement: mock('toast.js'),
        },
        {
          find: '@/lib/webPushClient',
          replacement: mock('webPushClient.js'),
        },
        {
          find: '@/lib/pushNotifications',
          replacement: mock('pushNotifications.js'),
        },
        { find: '@', replacement: REPO_SRC },
      ],
    },
    server: {
      host: HOST,
      port: PORT,
      strictPort: true,
    },
  });
  await server.listen();

  browser = await chromium.launch({
    ...(existsSync(MAC_CHROME) ? { executablePath: MAC_CHROME } : {}),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    locale: 'en-US',
    timezoneId: 'America/Denver',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const guardDecisions = [];
  await installBrowserGuard(context, decision => {
    guardDecisions.push(decision);
  });
  const page = await context.newPage();
  const fixturePath = '/tests/qa/fixtures/notifications-settings.html';

  await page.goto(`${ORIGIN}${fixturePath}?mode=loading`);
  await page.locator('.tech-settings-row-value').first()
    .waitFor({ state: 'visible' });
  await page.getByText('Checking…', { exact: true }).waitFor();
  const loadingViewport = await assertViewportAndTargets(page, 'loading');

  await page.goto(`${ORIGIN}${fixturePath}?mode=error`);
  await page.getByText(
    'Couldn’t check notification status. Your current setting was not changed.',
    { exact: true },
  ).waitFor();
  await page.getByRole('button', { name: 'Try again' }).waitFor();
  const errorViewport = await assertViewportAndTargets(page, 'error');

  await page.goto(`${ORIGIN}${fixturePath}?mode=ready`);
  const status = page.locator('.tech-settings-row-value').first();
  await status.getByText('On — this phone will get push alerts.', {
    exact: true,
  }).waitFor();
  const readyViewport = await assertViewportAndTargets(page, 'ready');
  const pushButton = page.getByRole('button', { name: 'Turn off' });
  const pushButtonBox = await pushButton.boundingBox();
  if (!pushButtonBox) throw new Error('Push button has no rendered box');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(
    pushButtonBox.x + (pushButtonBox.width / 2),
    pushButtonBox.y + (pushButtonBox.height / 2),
  );
  await page.mouse.down();
  await page.waitForTimeout(150);
  const pressTransform = await pushButton.evaluate(
    element => getComputedStyle(element).transform,
  );
  await page.mouse.move(0, 0);
  await page.mouse.up();
  if (pressTransform === 'none') {
    throw new Error('Push button has no visual press transform');
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(150);
  const reducedMotionActive = await page.evaluate(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  if (!reducedMotionActive) {
    throw new Error('Browser did not activate reduced-motion media state');
  }
  await page.mouse.move(
    pushButtonBox.x + (pushButtonBox.width / 2),
    pushButtonBox.y + (pushButtonBox.height / 2),
  );
  await page.mouse.down();
  await page.waitForTimeout(20);
  const reducedPressTransform = await pushButton.evaluate(
    element => getComputedStyle(element).transform,
  );
  await page.mouse.move(0, 0);
  await page.mouse.up();
  if (reducedPressTransform !== 'none') {
    throw new Error('Reduced motion did not remove Push press transform');
  }

  const localPostDenied = await page.evaluate(async () => {
    try {
      await fetch('/__qa_write_denied__', { method: 'POST' });
      return false;
    } catch {
      return true;
    }
  });
  if (!localPostDenied) throw new Error('browser guard allowed local POST');
  const externalWebSocketDenied = await page.evaluate(() => new Promise(resolve => {
    const socket = new WebSocket('wss://example.invalid/qa-egress-denied');
    const finish = () => resolve(true);
    socket.addEventListener('error', finish, { once: true });
    socket.addEventListener('close', finish, { once: true });
    setTimeout(() => resolve(false), 2_000);
  }));
  if (!externalWebSocketDenied) {
    throw new Error('browser guard did not deny external WebSocket');
  }
  const deniedReasons = guardDecisions
    .filter(({ kind }) => kind === 'deny')
    .map(({ reason }) => reason);
  if (!deniedReasons.includes('method') || !deniedReasons.includes('websocket')) {
    throw new Error('browser guard denial evidence is incomplete');
  }

  await page.getByLabel('Synthetic draft').fill('half-finished');
  await page.getByLabel('Synthetic draft').blur();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
  await page.evaluate(() => {
    document.querySelector('.tech-content').scrollTop = 420;
    window.__statusMutations = [];
    const target = document.querySelector('.tech-settings-row-value');
    window.__statusObserver = new MutationObserver(() => {
      window.__statusMutations.push(target?.textContent || '');
    });
    window.__statusObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await page.waitForFunction(
    () => document.querySelector('.tech-content').scrollTop === 420,
  );
  const routeBefore = page.url();
  const scrollBefore = await page.evaluate(
    () => document.querySelector('.tech-content').scrollTop,
  );
  const callsBefore = await page.evaluate(() => window.__nativeStatusCalls);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(31_000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(
    (previous) => window.__nativeStatusCalls > previous,
    callsBefore,
  );

  if (page.url() !== routeBefore) throw new Error('resume changed route');
  await page.getByLabel('Synthetic draft').waitFor();
  const draft = await page.getByLabel('Synthetic draft').inputValue();
  if (draft !== 'half-finished') throw new Error('resume lost input');
  const resumeState = await page.evaluate(() => ({
    mutations: window.__statusMutations,
    scrollY: document.querySelector('.tech-content').scrollTop,
  }));
  const resumeScrollDriftPx = Math.abs(resumeState.scrollY - scrollBefore);
  if (resumeScrollDriftPx > 2) {
    throw new Error(
      `resume changed scroll: ${scrollBefore} -> ${resumeState.scrollY}`,
    );
  }
  if (resumeState.mutations.some((value) => value.includes('Checking'))) {
    throw new Error('silent resume flashed loading state');
  }
  await status.getByText('On — this phone will get push alerts.', {
    exact: true,
  }).waitFor();
  const externalRequestsAllowed = guardDecisions.filter((decision) => (
    decision.kind === 'allow' && decision.origin !== ORIGIN
  )).length;
  if (externalRequestsAllowed !== 0) {
    throw new Error('browser guard allowed an external request');
  }

  process.stdout.write(`${JSON.stringify({
    externalWebSocketDenied,
    errorState: 'passed',
    errorViewport,
    loadingState: 'passed',
    loadingViewport,
    localPostDenied,
    minimumActionHeightPx: Math.min(
      errorViewport.minimumActionHeightPx,
      readyViewport.minimumActionHeightPx,
    ),
    noClippedSettingsCards: true,
    pressTransformVisible: true,
    readyViewport,
    realResumeHook: true,
    reducedMotionActive,
    reducedMotionPressTransform: reducedPressTransform,
    resumeSeconds: 31,
    resumeScrollDriftPx,
    resumeState: 'passed',
    visibilityTransition: 'controlled-hidden-to-visible',
    viewport: '390x844',
    horizontalOverflowPx: Math.max(
      loadingViewport.horizontalOverflowPx,
      errorViewport.horizontalOverflowPx,
      readyViewport.horizontalOverflowPx,
    ),
    externalRequestsAllowed,
  })}\n`);
  await context.close();
} finally {
  await browser?.close();
  await server?.close();
}
