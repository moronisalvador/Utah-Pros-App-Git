/**
 * ════════════════════════════════════════════════
 * FILE: smoke-deploy.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the post-deploy check can actually spot the problem it was written
 *   for. Running it against a healthy site and seeing "PASS" proves nothing —
 *   a check that always passes looks identical to a working one. So these tests
 *   feed it the exact bad answer the live site gave on 2026-07-27 and require
 *   it to reject that.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  scripts/smoke-deploy.mjs (pure helpers only — no network here)
 * ════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
  extractBootAssets,
  expectedKind,
  contentTypeOk,
  classifyFailure,
} from '../../../scripts/smoke-deploy.mjs';

describe('detects the 2026-07-27 poisoning signature', () => {
  it('REJECTS HTML served under a .js URL', () => {
    // The exact response that took dev down: HTTP 200, text/html, .js path.
    expect(contentTypeOk('/app-assets/AuthContext-abc.js', 'text/html; charset=utf-8')).toBe(false);
  });

  it('accepts real JavaScript', () => {
    expect(contentTypeOk('/app-assets/AuthContext-abc.js', 'application/javascript')).toBe(true);
    expect(contentTypeOk('/app-assets/i.js', 'text/javascript; charset=utf-8')).toBe(true);
  });

  it('REJECTS HTML served under a .css URL', () => {
    expect(contentTypeOk('/app-assets/index-abc.css', 'text/html')).toBe(false);
  });

  it('accepts real CSS', () => {
    expect(contentTypeOk('/app-assets/index-abc.css', 'text/css; charset=utf-8')).toBe(true);
  });

  it('does not police file types it has no expectation for', () => {
    // An icon or manifest is not a boot-blocking module; do not fail a deploy
    // over one and train people to ignore the check.
    expect(expectedKind('/favicon.svg')).toBe(null);
    expect(contentTypeOk('/favicon.svg', 'image/svg+xml')).toBe(true);
  });

  it('treats a missing content-type as a failure for executable assets', () => {
    expect(contentTypeOk('/app-assets/x.js', '')).toBe(false);
    expect(contentTypeOk('/app-assets/x.js', undefined)).toBe(false);
  });
});

describe('finds every asset the page needs to boot', () => {
  const html = `
    <script type="module" crossorigin src="/app-assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/app-assets/AuthContext-def.js">
    <link rel="modulepreload" crossorigin href="/app-assets/suspense-ghi.js">
    <link rel="stylesheet" crossorigin href="/app-assets/index-jkl.css">
    <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js"></script>
    <link rel="icon" href="/favicon.svg" />
  `;

  it('collects the entry, the modulepreloads and the stylesheet', () => {
    const found = extractBootAssets(html);
    expect(found).toContain('/app-assets/index-abc.js');
    expect(found).toContain('/app-assets/AuthContext-def.js');
    expect(found).toContain('/app-assets/suspense-ghi.js');
    expect(found).toContain('/app-assets/index-jkl.css');
  });

  it('includes the modulepreloads, which is where the real poisoning was', () => {
    // The entry chunk was healthy on 2026-07-27. The three poisoned files were
    // AuthContext, suspense and useQuery — all static imports, all listed as
    // modulepreloads. An entry-only check would have reported PASS.
    const found = extractBootAssets(html);
    expect(found.filter((u) => u.includes('AuthContext') || u.includes('suspense')).length).toBe(2);
  });

  it('ignores third-party scripts', () => {
    // A failing analytics beacon is not a reason to block a release.
    expect(extractBootAssets(html).some((u) => u.includes('cloudflareinsights'))).toBe(false);
  });
});


// ─── SECTION: the second 2026-07-27 outage — a poisoned STYLESHEET ────────────
// The first outage hit .js and blanked the app. The second hit .css: every
// script loaded, React mounted, and every page rendered UNSTYLED. The checker
// reported PASS throughout, for two reasons now pinned below.
describe('classifyFailure names the right remedy', () => {
  const html = { status: 200, ok: true, ct: 'text/html; charset=utf-8' };
  const css = { status: 200, ok: true, ct: 'text/css; charset=utf-8' };

  it('edge-poisoned when the cached copy is HTML but the origin serves CSS', () => {
    // Exactly the live state on 2026-07-27: cf-cache HIT returned HTML while a
    // cache-busted request to the same URL returned valid CSS. A purge fixes
    // this; a redeploy is not needed.
    expect(classifyFailure(html, css)).toBe('edge-poisoned');
  });

  it('origin-serving-html when BOTH the cached and origin copies are HTML', () => {
    // A purge would NOT fix this one — the deployment itself is wrong. Telling
    // these two apart is the whole point of the follow-up probe.
    expect(classifyFailure(html, html)).toBe('origin-serving-html');
  });

  it('does not claim edge-poisoning when the origin probe could not run', () => {
    expect(classifyFailure(html, null)).toBe('origin-serving-html');
  });

  it('unservable for a non-200 or dead response', () => {
    expect(classifyFailure({ status: 404, ok: false, ct: '' }, null)).toBe('unservable');
    expect(classifyFailure({ status: 0, ok: false, ct: '' }, null)).toBe('unservable');
  });
});

describe('a stylesheet is held to the same bar as a script', () => {
  it('REJECTS HTML served under a .css URL', () => {
    // The second outage's exact response. The .js case was already covered;
    // this pins the .css one so the same gap cannot reopen.
    expect(contentTypeOk('/app-assets/index-abc.css', 'text/html; charset=utf-8')).toBe(false);
  });

  it('accepts a correctly served stylesheet', () => {
    expect(contentTypeOk('/app-assets/index-abc.css', 'text/css; charset=utf-8')).toBe(true);
  });

  it('knows a .css path must be css', () => {
    expect(expectedKind('/app-assets/index-abc.css')).toBe('css');
  });
});
