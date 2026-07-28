/**
 * ════════════════════════════════════════════════
 * FILE: spa-route-coverage.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Two jobs, and they pull in opposite directions — which is the point.
 *
 *   1. Every address the app can show has to be listed in public/_redirects.
 *      Since public/404.html exists, Cloudflare no longer hands the app out for
 *      addresses it does not recognise, so an unlisted route returns "not found"
 *      instead of the page. Adding a route to App.jsx without adding a line to
 *      _redirects breaks that page's link, and this test is what catches it.
 *
 *   2. Nothing may be listed for /app-assets/ or /assets/. Those hold the app's
 *      real script and stylesheet files, and a rule matching them rewrites the
 *      REAL files too, not just missing ones — measured on 2026-07-27, where it
 *      turned a working stylesheet into HTML.
 *
 *   Together these keep the fix for the two 2026-07-27 outages honest: missing
 *   files must fail loudly, and real pages must keep working.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/App.jsx, src/lib/settingsRedirects.js, public/_redirects,
 *              public/404.html (all read as source text)
 *
 * NOTES / GOTCHAS:
 *   - This proves the rules are PRESENT and well-formed. It cannot prove
 *     Cloudflare's edge behaviour; that needs a preview deployment plus
 *     `node scripts/smoke-deploy.mjs <url>`, which asserts the live 404.
 *   - The route list is derived as a SUPERSET on purpose (first path segment of
 *     every route, including nested ones). Listing a non-route is harmless — the
 *     app shows its own not-found screen. Missing a real one is not.
 *   - The two forbidden rule SHAPES tested here (a splat rule targeting .html, a
 *     splat rule over /app-assets/) are not style preferences. Cloudflare
 *     silently ignores the first and silently breaks assets with the second.
 * ════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const redirectsSrc = read('public/_redirects');
const appSrc = read('src/App.jsx');
const settingsRedirectsSrc = read('src/lib/settingsRedirects.js');

/** Every rule line, comments and blanks dropped. */
const rules = redirectsSrc
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [from, to, status] = l.split(/\s+/);
    return { from, to, status, line: l };
  });

/**
 * First path segment of every route the app declares.
 *
 * Deliberately naive: it does not resolve JSX nesting, so a child route like
 * `overview` (which really lives at /crm/overview) is treated as its own
 * top-level segment. That over-collects, which is the safe direction — see the
 * header note.
 */
function declaredSegments() {
  const segs = new Set();
  for (const m of appSrc.matchAll(/<Route[^>]*?\spath="([^"]+)"/g)) {
    const p = m[1].replace(/^\//, '');
    if (!p || p === '*') continue;
    const first = p.split('/')[0];
    if (!first || first.startsWith(':') || first === '*') continue;
    segs.add(first);
  }
  // Retired URLs still routed for old bookmarks — they need coverage too.
  for (const m of settingsRedirectsSrc.matchAll(/from:\s*'([^']+)'/g)) {
    segs.add(m[1].split('/')[0]);
  }
  return [...segs].sort();
}

describe('every app route prefix is reachable through _redirects', () => {
  const segments = declaredSegments();

  it('found route declarations to check (guards against a silent parse break)', () => {
    // If App.jsx is ever restructured so the regex matches nothing, this suite
    // would pass vacuously while covering nothing at all.
    expect(segments.length).toBeGreaterThan(20);
  });

  it.each(declaredSegments())('serves /%s', (seg) => {
    expect(rules.some((r) => r.from === `/${seg}` && r.status === '200')).toBe(true);
  });

  it.each(declaredSegments())('serves everything under /%s/', (seg) => {
    expect(rules.some((r) => r.from === `/${seg}/*` && r.status === '200')).toBe(true);
  });
});

describe('the asset directories are never rewritten', () => {
  // The 2026-07-27 measurement that makes this a blocker: adding
  // `/app-assets/* /asset-not-found 200` parsed as VALID and then served HTML
  // for a stylesheet that existed and was perfectly fine. Rewrites are applied
  // before the file lookup, so they cannot be used to catch only the misses.
  it.each(['/app-assets', '/assets'])('has no rule matching %s', (dir) => {
    const offenders = rules.filter((r) => r.from.startsWith(dir));
    expect(offenders.map((r) => r.line)).toEqual([]);
  });
});

describe('rule shapes Cloudflare silently mishandles', () => {
  it('no splat rule targets a .html file', () => {
    // Rejected as an infinite loop and dropped with no error. This is exactly
    // how the old `/* /index.html 200` catch-all came to be inert while looking
    // like the thing protecting the site.
    const offenders = rules.filter((r) => r.from.includes('*') && /\.html$/.test(r.to || ''));
    expect(offenders.map((r) => r.line)).toEqual([]);
  });

  it('no splat-free rule targets /index.html', () => {
    // Accepted, but answered with a 308 redirect to `/` — which discards the
    // address. Measured: /jobs landed the user on the dashboard.
    const offenders = rules.filter((r) => !r.from.includes('*') && r.to === '/index.html');
    expect(offenders.map((r) => r.line)).toEqual([]);
  });

  it('the inert catch-all is gone, not quietly restored', () => {
    expect(rules.some((r) => r.from === '/*')).toBe(false);
  });

  it('only uses statuses _redirects actually supports', () => {
    // 404 is NOT one of them. Two attempts on 2026-07-27 used it; both were
    // ignored, which is the whole reason the outage recurred.
    const allowed = new Set(['200', '301', '302', '303', '307', '308']);
    const offenders = rules.filter((r) => !allowed.has(r.status));
    expect(offenders.map((r) => r.line)).toEqual([]);
  });

  it('stays under the 100 dynamic-rule ceiling Pages enforces', () => {
    // Rules containing a splat or placeholder are "dynamic" and capped at 100.
    // Past the cap they are dropped — silently, like every other failure here.
    const dynamic = rules.filter((r) => r.from.includes('*') || r.from.includes(':'));
    expect(dynamic.length).toBeLessThanOrEqual(100);
  });
});

describe('404.html exists and can survive the failure it reports', () => {
  it('is present — its absence silently restores the outage', () => {
    // Without this file Cloudflare Pages goes back to answering every unknown
    // address with the app's HTML at 200 OK, which is what got cached under a
    // .js and then a .css URL for a year on 2026-07-27.
    expect(existsSync(join(ROOT, 'public/404.html'))).toBe(true);
  });

  it('references no build output, so poisoned assets cannot break it too', () => {
    const html = read('public/404.html');
    expect(html).not.toMatch(/app-assets/);
    expect(html).not.toMatch(/<script\s+src=/);
    expect(html).not.toMatch(/rel="stylesheet"/);
  });
});
