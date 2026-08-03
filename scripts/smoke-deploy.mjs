#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════
 * FILE: scripts/smoke-deploy.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks a deployed site actually works, from outside. It opens the page,
 *   finds every file the page needs to start, and makes sure each one really is
 *   JavaScript or CSS — not the website's HTML page wearing a .js name.
 *
 *   On 2026-07-27 three files came back as HTML with an "OK" status. Browsers
 *   refuse to run HTML as JavaScript, so the app never started: a blank white
 *   screen, no error, on the office site and on an installed iPhone. Every
 *   automated check passed, because they all checked the BUILD. Nothing checked
 *   what the live site was handing to a real browser.
 *
 * USAGE:
 *   node scripts/smoke-deploy.mjs https://dev.utahpros.app
 *   npm run smoke:deploy -- https://dev.utahpros.app
 *
 *   Exits 0 when the deployment is servable, 1 with a report when it is not.
 *
 * DEPENDS ON:
 *   Packages:  none (global fetch, Node 18+)
 *   Internal:  none — deliberately standalone so it can run against any URL,
 *              from CI or a laptop, without the repo being built.
 *
 * NOTES / GOTCHAS:
 *   - This does NOT prove the app renders; it proves the boot graph is
 *     SERVABLE, which is the failure that actually happened and the one no
 *     existing check covered. A render assertion needs a browser — see
 *     tests/qa/browser for that lane.
 *   - Run it AFTER the alias has swapped, not when the build check goes green.
 *     Measured 2026-07-27: Cloudflare's check went green ~9 minutes before
 *     dev.utahpros.app actually served the new bundle. Checking too early
 *     passes against the OLD deployment and tells you nothing.
 *   - Requests each asset EXACTLY AS A BROWSER DOES: no cache-buster, and with
 *     an `Origin` header. Both matter, and getting either wrong makes this
 *     script certify a broken site — which is what happened on 2026-07-27.
 *
 *     ⚠️ This file used to cache-bust every request, reasoning that "a cached
 *     good copy would hide a poisoned one". The intent was right; the code did
 *     the exact opposite. A cache-buster GUARANTEES the request bypasses the
 *     edge and reads the origin, so an edge-cached poison is the one thing it
 *     can never see. On 2026-07-27 this script reported PASS while every page
 *     on dev.utahpros.app rendered unstyled.
 *
 *     The `Origin` header matters because Vite emits `<link rel="stylesheet"
 *     crossorigin>` and `<script type="module" crossorigin>`, so real browsers
 *     send one. Cloudflare caches that as a SEPARATE variant. Measured the same
 *     day, on the same URL, seconds apart:
 *         no Origin  -> text/css    (what the old script saw: PASS)
 *         w/ Origin  -> text/html   (what every browser got: unstyled site)
 *
 *     A failing asset is then re-checked WITH a cache-buster, purely to tell
 *     the two failures apart, because the fixes are different:
 *         edge poisoned  (origin fine)  -> purge the Cloudflare cache
 *         origin broken  (both fail)    -> the deployment itself is bad
 * ════════════════════════════════════════════════
 */

/**
 * Is the deployment still refusing to answer a missing asset with HTML?
 *
 * This is the PREVENTION check, and it is the one that would have caught both
 * 2026-07-27 outages before a user did. `public/404.html` is what stops
 * Cloudflare Pages handing out the app's HTML at 200 OK for a file it does not
 * have; `public/_redirects` must contain no rule matching /app-assets/. Either
 * one silently regressing puts the year-long cache poisoning back, and nothing
 * else here would notice — every other check in this file only looks at assets
 * that DO exist.
 *
 * A 404 is the pass. A 200 is the failure mode, whatever the body says.
 */
export function assetMissMustNot200(view) {
  if (view.status === 404) return null;
  if (view.status === 200 && (view.ct || '').includes('html')) {
    return 'a MISSING asset returned 200 + HTML — this is the outage vector itself. '
      + 'Check public/404.html still exists in the deployment and that no rule in '
      + 'public/_redirects matches /app-assets/.';
  }
  return `a missing asset returned ${view.status} "${view.ct}" — expected 404`;
}

/** Pull every asset the page needs in order to boot. */
export function extractBootAssets(html) {
  const urls = new Set();
  const patterns = [
    /<script[^>]+src="([^"]+)"/g,
    /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
    /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      // Same-origin only. A third-party analytics beacon failing is not a
      // reason to fail a deploy.
      if (m[1].startsWith('/')) urls.add(m[1]);
    }
  }
  return [...urls];
}

/** What content-type must this path have to be executable by a browser? */
export function expectedKind(path) {
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  return null;
}

/** True when a served content-type satisfies what the path requires. */
export function contentTypeOk(path, contentType) {
  const kind = expectedKind(path);
  if (!kind) return true;
  return (contentType || '').toLowerCase().includes(kind);
}

const bust = (url) => url + (url.includes('?') ? '&' : '?') + 'smoke=' + Date.now();

/**
 * Fetch a deployed URL the way a browser would.
 *
 * `origin` sends the CORS `Origin` header that a `crossorigin` tag produces —
 * Cloudflare caches that as its own variant, so omitting it checks a copy no
 * browser ever receives. `cacheBust` is for the follow-up probe ONLY; it must
 * stay off for the real check or the edge cache is bypassed entirely.
 */
export async function fetchAsBrowser(url, { origin, cacheBust = false } = {}) {
  const r = await fetch(cacheBust ? bust(url) : url, {
    redirect: 'follow',
    headers: origin ? { Origin: origin } : {},
  });
  return {
    status: r.status,
    ok: r.ok,
    ct: r.headers.get('content-type') || '',
    cache: r.headers.get('cf-cache-status') || '',
    age: r.headers.get('age') || '',
  };
}

/**
 * Classify a failing asset so the report names the actual remedy.
 * edge-poisoned = the origin is healthy and only the cached copy is wrong.
 */
export function classifyFailure(browserView, originView) {
  const isHtml = (v) => v && v.status === 200 && (v.ct || '').includes('html');
  if (isHtml(browserView) && originView && !isHtml(originView) && originView.ok) {
    return 'edge-poisoned';
  }
  if (isHtml(browserView)) return 'origin-serving-html';
  return 'unservable';
}

async function main() {
  const base = (process.argv[2] || '').replace(/\/$/, '');
  if (!base) {
    console.error('usage: node scripts/smoke-deploy.mjs <https://host>');
    process.exit(2);
  }

  const failures = [];
  const note = (m) => console.log('  ' + m);
  console.log(`\nsmoke: ${base}`);

  const rootRes = await fetch(bust(base + '/'), { redirect: 'follow' });
  const rootType = rootRes.headers.get('content-type') || '';
  if (!rootRes.ok) failures.push(`/ returned ${rootRes.status}`);
  if (!rootType.includes('html')) failures.push(`/ served as "${rootType}", expected HTML`);

  // index.html MUST NOT be cacheable. It is the only file that can hand a
  // client corrected asset URLs, so a stale copy pins them to dead ones.
  const rootCache = (rootRes.headers.get('cache-control') || '').toLowerCase();
  if (!rootCache.includes('no-store') && !rootCache.includes('no-cache')) {
    failures.push(`/ is cacheable ("${rootCache || 'no cache-control'}") — must be no-store`);
  }

  const html = await rootRes.text();
  const assets = extractBootAssets(html);
  if (!assets.length) failures.push('no boot assets found in / — did the HTML render at all?');
  note(`${assets.length} boot assets referenced`);

  const results = await Promise.all(assets.map(async (path) => {
    try {
      // The real check: no cache-buster, with Origin — byte-for-byte the
      // request a browser makes for a `crossorigin` tag.
      const view = await fetchAsBrowser(base + path, { origin: base });
      if (view.ok && contentTypeOk(path, view.ct)) return { path, ok: true };

      // Failed. Re-probe past the edge ONLY to name the right remedy.
      let originView = null;
      try {
        originView = await fetchAsBrowser(base + path, { origin: base, cacheBust: true });
      } catch { /* origin probe is diagnostic; its absence just means we cannot classify */ }
      return { path, ok: false, view, originView, kind: classifyFailure(view, originView) };
    } catch (e) {
      return { path, ok: false, view: { status: 0, ct: '', err: e.message }, kind: 'unservable' };
    }
  }));

  // Prevention, checked the same way a browser would ask: no cache-buster, with
  // Origin. The filename cannot collide with a real build output — it has no
  // content hash — so this is safe to run against production.
  try {
    const missPath = '/app-assets/smoke-deliberately-missing.css';
    const missView = await fetchAsBrowser(base + missPath, { origin: base });
    const missProblem = assetMissMustNot200(missView);
    if (missProblem) failures.push(`${missPath} -> ${missProblem}`);
    else note('missing assets 404 correctly (cache-poisoning prevention intact)');
  } catch (e) {
    failures.push(`could not probe the missing-asset guard: ${e.message}`);
  }

  const REMEDY = {
    'edge-poisoned': 'EDGE POISONED — origin is healthy, the CACHED copy is HTML. Purge the Cloudflare cache.',
    'origin-serving-html': 'ORIGIN SERVING HTML — the deployment itself is wrong, a purge will NOT fix it.',
    unservable: 'UNSERVABLE — no usable response.',
  };

  for (const r of results.filter((x) => !x.ok)) {
    const v = r.view || {};
    failures.push(
      `${r.path} -> ${v.status || 0} "${v.ct || v.err || 'no response'}"` +
      (v.cache ? ` [cf-cache:${v.cache}${v.age ? ` age:${v.age}s` : ''}]` : '') +
      `\n      ${REMEDY[r.kind] || ''}`
    );
  }

  if (failures.length) {
    console.error(`\nFAIL (${failures.length})`);
    for (const f of failures) console.error('  ✗ ' + f);
    if (results.some((r) => r.kind === 'edge-poisoned')) {
      console.error('\nPurge the Cloudflare cache, then re-run this check.');
      console.error('Devices may still hold poisoned copies; the boot guard in');
      console.error('index.html repairs those on next load.');
    }
    console.error('');
    process.exit(1);
  }

  note('all boot assets servable with correct content types (checked as a browser: no cache-bust, with Origin)');
  console.log('PASS\n');
}

// Only run when invoked directly, so the pure helpers stay unit-testable.
if (process.argv[1] && process.argv[1].endsWith('smoke-deploy.mjs')) {
  main().catch((e) => {
    console.error('smoke: ' + e.message);
    process.exit(1);
  });
}
