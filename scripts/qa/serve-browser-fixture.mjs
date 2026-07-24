/**
 * ════════════════════════════════════════════════
 * FILE: serve-browser-fixture.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Serves one deterministic synthetic QA page on the exact governed loopback address. It rejects
 *   other hosts, write methods, unknown paths, request bodies, and every external dependency.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  tests/qa/fixtures/browser-foundation.html, tests/qa/lib/target-policy.mjs
 *   Data:      reads  → one synthetic HTML fixture
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is not the UPR application and contains no production data or authentication.
 *   - The browser guard separately enforces navigation and network egress.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LOCAL_BROWSER_ORIGIN } from '../../tests/qa/lib/target-policy.mjs';

const origin = new URL(LOCAL_BROWSER_ORIGIN);
const expectedHost = `${origin.hostname}:${origin.port}`;
const fixture = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/qa/fixtures/browser-foundation.html'),
  'utf8',
);

export function createFixtureServer() {
  const server = http.createServer((request, response) => {
    const host = request.headers.host;
    const requestUrl = new URL(request.url || '/', LOCAL_BROWSER_ORIGIN);
    const safeMethod = request.method === 'GET' || request.method === 'HEAD';
    const safePath = requestUrl.pathname === '/qa' || requestUrl.pathname === '/health';

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src http: https: ws: wss:; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (host !== expectedHost || !safeMethod || !safePath) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Denied');
      return;
    }

    if (requestUrl.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('ready');
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : fixture);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(origin.port), origin.hostname, () => {
      server.off('error', reject);
      resolve({
        close: () => new Promise((closeResolve) => {
          server.close(() => closeResolve());
          server.closeAllConnections?.();
        }),
      });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const running = await createFixtureServer();
  process.stdout.write(`Synthetic QA fixture ready at ${LOCAL_BROWSER_ORIGIN}/qa\n`);
  const close = async () => {
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
