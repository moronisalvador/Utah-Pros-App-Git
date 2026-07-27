/**
 * ════════════════════════════════════════════════
 * FILE: boot-cache-poisoning.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the three things that stop a bad deploy from leaving the app
 *   permanently blank on someone's phone.
 *
 *   What happened on 2026-07-27: during a deployment swap, a Cloudflare edge
 *   node asked for a JavaScript file that had not finished uploading. The
 *   catch-all rule answered with the app's HTML page and said "200 OK", and the
 *   caching rule then told everyone to keep that answer for a year. Browsers
 *   refuse to run HTML as JavaScript, so the app never started — no error
 *   message, no spinner, just a white screen, on the office site and on an
 *   installed iPhone app. Clearing Safari did not help because copies were
 *   stuck in Cloudflare too. It took a dashboard cache purge to clear.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  public/_redirects, public/asset-missing.html, index.html (read as source)
 *
 * NOTES / GOTCHAS:
 *   - This proves the guards are PRESENT, not that Cloudflare behaves as
 *     intended. The edge behaviour of the 404 rule can only be proven on a real
 *     preview deployment — do that before promoting to production.
 *   - The boot guard must stay a CLASSIC script above the module script. If it
 *     is ever converted to type="module" it inherits the exact failure it
 *     exists to catch and becomes decorative.
 * ════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const redirects = read('public/_redirects');
const headers = read('public/_headers');
const indexHtml = read('index.html');
const viteConfig = read('vite.config.js');

describe('a missing asset must 404, never become a poisoned 200', () => {
  it('routes both asset dirs to a 404 before the SPA catch-all', () => {
    const live = redirects.indexOf('/app-assets/* /asset-missing.html 404');
    const legacy = redirects.indexOf('/assets/*     /asset-missing.html 404');
    const catchAll = redirects.indexOf('/* /index.html 200');
    expect(live).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(-1);
    // Order is load-bearing: the catch-all would otherwise swallow both.
    expect(live).toBeLessThan(catchAll);
    expect(legacy).toBeLessThan(catchAll);
  });

  it('keeps the build output dir and the routing/caching globs in step', () => {
    // If assetsDir and these globs ever drift, assets silently lose immutable
    // caching AND fall outside the 404 rule — reopening the exact hole.
    expect(viteConfig).toContain("assetsDir: 'app-assets'");
    expect(headers).toContain('/app-assets/*');
    expect(redirects).toContain('/app-assets/*');
  });

  it('ships the 404 body, and it is NOT the app shell', () => {
    const body = read('public/asset-missing.html');
    expect(body).toContain('Asset not found');
    expect(body).not.toContain('<div id="root">');
    expect(body).not.toContain('type="module"');
  });

  it('still marks real assets immutable — the perf budget depends on it', () => {
    expect(headers).toMatch(/\/assets\/\*\n\s*Cache-Control: public, max-age=31536000, immutable/);
  });
});

describe('boot guard can run when the app cannot', () => {
  const guardStart = indexHtml.indexOf("'upr:boot-recovered'");
  const moduleStart = indexHtml.indexOf('<script type="module"');

  it('is present', () => {
    expect(guardStart).toBeGreaterThan(-1);
  });

  it('sits before the module script in source', () => {
    expect(moduleStart).toBeGreaterThan(-1);
    expect(guardStart).toBeLessThan(moduleStart);
  });

  it('is a classic script, which is what actually guarantees it runs first', () => {
    // Source order is NOT what protects us: `vite build` hoists the module
    // script into <head>, so in dist/index.html the module tag comes FIRST.
    // Execution order still holds because a module script is deferred while a
    // classic inline script in <body> runs during parsing. That only remains
    // true while this stays classic. A type="module" guard would also be
    // deferred AND would fail to instantiate for exactly the same reason the
    // app does — decorative in the only case that matters.
    const before = indexHtml.slice(0, guardStart);
    const openTag = before.lastIndexOf('<script');
    expect(indexHtml.slice(openTag, guardStart)).not.toContain('type="module"');
    expect(indexHtml.slice(openTag, guardStart)).not.toContain('defer');
    expect(indexHtml.slice(openTag, guardStart)).not.toContain('async');
  });

  it('repairs the cache itself and does NOT route recovery through /reset', () => {
    // The single most important property of this guard. /reset relies on
    // Clear-Site-Data, which Safari does not implement — verified on a real
    // iPhone on 2026-07-27, where /reset changed nothing for a poisoned device.
    // Every field technician is on iOS, so a Safari-ineffective recovery is no
    // recovery at all. fetch(url, {cache:'reload'}) rewrites the cache entry
    // and works everywhere; it is what repaired a poisoned browser by hand
    // during the incident.
    expect(indexHtml).toContain("{ cache: 'reload' }");
    expect(indexHtml).toContain('window.location.reload()');
    expect(indexHtml).not.toContain("'/reset?to='");
  });

  it('repairs the specific bad URLs, not just the first one it noticed', () => {
    // Three chunks were poisoned simultaneously in the real incident.
    // Repairing one and reloading would fail on the next.
    expect(indexHtml).toContain('repairAndReload(bad)');
    expect(indexHtml).toContain('bad.push(url)');
  });

  it('fires at most once per tab, so it can never loop', () => {
    expect(indexHtml).toContain("sessionStorage.getItem(ONCE)");
    expect(indexHtml).toContain("sessionStorage.setItem(ONCE, '1')");
  });

  it('only recovers on a real content-type fault, never on a slow connection', () => {
    // The single most important property. A field tech on bad LTE must never be
    // bounced through /reset just for being slow.
    expect(indexHtml).toContain("ct.indexOf('javascript') === -1");
    expect(indexHtml).toContain('root.childElementCount > 0');
  });

  it('checks the modulepreloads, not just the entry chunk', () => {
    // The 2026-07-27 poisoning was in AuthContext/suspense/useQuery — static
    // imports listed as modulepreloads. The entry chunk itself was fine, so an
    // entry-only check would have detected nothing.
    expect(indexHtml).toContain('link[rel=modulepreload][href]');
  });
});
