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
 *   - Cache-busts every request. The edge and the runner both cache, and a
 *     cached good copy would hide a poisoned one.
 * ════════════════════════════════════════════════
 */

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
      const r = await fetch(bust(base + path), { redirect: 'follow' });
      const ct = r.headers.get('content-type') || '';
      return { path, status: r.status, ct, ok: r.ok && contentTypeOk(path, ct) };
    } catch (e) {
      return { path, status: 0, ct: '', ok: false, err: e.message };
    }
  }));

  for (const r of results.filter((x) => !x.ok)) {
    // The signature of the 2026-07-27 outage: HTTP 200, content-type text/html,
    // under a .js URL. Name it explicitly so nobody has to rediscover it.
    const poisoned = r.status === 200 && (r.ct || '').includes('html');
    failures.push(
      `${r.path} -> ${r.status} "${r.ct || r.err || 'no response'}"` +
      (poisoned ? '  ← POISONED: HTML served under an asset URL' : '')
    );
  }

  if (failures.length) {
    console.error(`\nFAIL (${failures.length})`);
    for (const f of failures) console.error('  ✗ ' + f);
    console.error('\nIf assets are poisoned: purge the Cloudflare cache, then re-run.');
    console.error('Devices may still hold poisoned copies; the boot guard in');
    console.error('index.html repairs those on next load.\n');
    process.exit(1);
  }

  note('all boot assets servable with correct content types');
  console.log('PASS\n');
}

// Only run when invoked directly, so the pure helpers stay unit-testable.
if (process.argv[1] && process.argv[1].endsWith('smoke-deploy.mjs')) {
  main().catch((e) => {
    console.error('smoke: ' + e.message);
    process.exit(1);
  });
}
