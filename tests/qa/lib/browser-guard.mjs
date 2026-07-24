/**
 * ════════════════════════════════════════════════
 * FILE: browser-guard.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks a Playwright browser context to the exact local fixture and read-only requests. It closes
 *   popups and rejects downloads, WebSockets, provider traffic, production traffic, and write methods.
 *
 * DEPENDS ON:
 *   Packages:  @playwright/test
 *   Internal:  tests/qa/lib/target-policy.mjs
 *   Data:      reads  → browser request metadata without headers or query values
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Decision events contain only a kind, method, origin, and reason code.
 *   - Playwright routing is defense in depth; this lane never receives credentials or provider config.
 * ════════════════════════════════════════════════
 */

import { LOCAL_BROWSER_ORIGIN, assertBrowserTarget } from './target-policy.mjs';

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return 'invalid';
  }
}

export async function installBrowserGuard(context, onDecision = () => {}) {
  const decision = (kind, details = {}) => {
    onDecision(Object.freeze({ kind, ...details }));
  };

  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const origin = originOf(request.url());
    try {
      assertBrowserTarget(request.url());
      if (!['GET', 'HEAD'].includes(method)) {
        throw new Error('write-method');
      }
      decision('allow', { method, origin, reason: 'local-read' });
      await route.continue();
    } catch {
      decision('deny', {
        method,
        origin,
        reason: origin === LOCAL_BROWSER_ORIGIN ? 'method' : 'origin',
      });
      await route.abort('blockedbyclient');
    }
  });

  if (typeof context.routeWebSocket === 'function') {
    await context.routeWebSocket(/.*/, async (webSocket) => {
      decision('deny', {
        method: 'WEBSOCKET',
        origin: originOf(webSocket.url()),
        reason: 'websocket',
      });
      await webSocket.close({ code: 1008, reason: 'QA egress denied' });
    });
  }

  context.on('page', async (page) => {
    if (page.opener()) {
      decision('deny', { method: 'POPUP', origin: originOf(page.url()), reason: 'popup' });
      await page.close();
      return;
    }
    page.on('download', async (download) => {
      decision('deny', {
        method: 'DOWNLOAD',
        origin: originOf(download.url()),
        reason: 'download',
      });
      await download.cancel();
    });
  });
}
