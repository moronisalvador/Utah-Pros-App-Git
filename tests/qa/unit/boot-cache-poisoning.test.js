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
 *   Internal:  public/_redirects, public/_headers, index.html, vite.config.js (read as source)
 *
 * NOTES / GOTCHAS:
 *   - This proves the guards are PRESENT in source. Cloudflare edge behaviour
 *     is NOT provable from here; two _redirects 404 variants were tried and
 *     both were ignored on a real preview. See public/_redirects.
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

describe('the SPA catch-all hazard stays documented, not silently forgotten', () => {
  // There is deliberately NO test asserting that a missing asset 404s. Two
  // _redirects variants were tried and BOTH were ignored by Cloudflare Pages on
  // a real preview deployment (2026-07-27) — a missing asset still returned
  // index.html with HTTP 200. Asserting a rule that does not work would be
  // worse than having none: it manufactures confidence in a dead control.
  // Prevention is not available to us here; recovery is what protects users.
  it('keeps the hazard explained where the next person will edit it', () => {
    expect(redirects).toContain('/* /index.html 200');
    expect(redirects).toMatch(/KNOWN HAZARD/);
    expect(redirects).toMatch(/BOTH FAILED/);
  });

  it('keeps the build output dir and the caching glob in step', () => {
    // If assetsDir and this glob ever drift, every asset silently loses
    // immutable caching — a real perf regression on an LTE field device.
    expect(viteConfig).toContain("assetsDir: 'app-assets'");
    expect(headers).toContain('/app-assets/*');
  });

  it('still marks real assets immutable — the perf budget depends on it', () => {
    expect(headers).toMatch(/\/app-assets\/\*\n\s*Cache-Control: public, max-age=31536000, immutable/);
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


// ─── SECTION: the SECOND 2026-07-27 outage — a poisoned STYLESHEET ────────────
// The guard above exists for a poisoned MODULE, where the app cannot render at
// all. A poisoned stylesheet is the inverse: every script loads, React mounts,
// the page renders — completely unstyled, because a browser refuses text/html
// for a stylesheet under nosniff.
//
// That difference made the original guard blind to it. Its silent-path check
// opens with `if (!root || root.childElementCount > 0) return;` — a rendered
// #root means it bails before looking at anything. So when dev.utahpros.app
// served every page unstyled, the guard never fired and nothing reached the
// console. These pin the stylesheet path so that gap cannot reopen.
describe('boot guard also covers a poisoned stylesheet', () => {
  // slice(indexHtml.indexOf(x)) returns the last character when x is absent,
  // which let two of these assertions pass against an index.html that had no
  // stylesheet path at all. Locate explicitly so a missing section FAILS.
  const cssSection = () => {
    const at = indexHtml.indexOf('link[rel=stylesheet][href]');
    if (at === -1) throw new Error('no stylesheet path in the boot guard');
    return indexHtml.slice(at);
  };

  it('inspects stylesheet links, not only scripts and modulepreloads', () => {
    expect(indexHtml).toMatch(/link\[rel=stylesheet\]\[href\]/);
  });

  it('does NOT gate the stylesheet check on an empty #root', () => {
    // The whole point: with a poisoned stylesheet the app DOES render, so a
    // childElementCount bail would skip the check entirely — which is exactly
    // what happened. The stylesheet pass must run regardless.
    const cssCheck = cssSection();
    expect(cssCheck).not.toMatch(/childElementCount/);
  });

  it('expects css and treats anything else as poisoned', () => {
    const cssCheck = cssSection();
    expect(cssCheck).toMatch(/indexOf\('css'\)\s*===\s*-1/);
  });

  it('repairs only our own hashed output, never a third-party sheet', () => {
    // Google Fonts is cross-origin and not ours to repair; reloading the app
    // because a font CDN hiccuped would be a self-inflicted outage.
    const cssCheck = cssSection();
    expect(cssCheck).toMatch(/isAsset\(/);
  });

  it('does NOT treat a network failure as poisoning on the stylesheet path', () => {
    // Unlike the module path, a dropped request must never cost a field tech a
    // reload when the stylesheet is actually fine — LTE drops are routine.
    const cssCheck = cssSection();
    const cssCatch = cssCheck.slice(cssCheck.indexOf("['catch']"), cssCheck.indexOf("['catch']") + 160);
    expect(cssCatch).not.toMatch(/bad\.push/);
  });

  it('still reuses the one-attempt-per-tab claim, so it cannot loop', () => {
    expect(indexHtml).toContain('upr:boot-recovered');
    expect((indexHtml.match(/repairAndReload\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
