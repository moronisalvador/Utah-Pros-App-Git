/**
 * PERF-02 — the native app does not ship web-only assets.
 *
 * Vite copies public/ verbatim, so the .app carried a service worker (which a
 * file:// origin cannot register), an install manifest (the app is already
 * installed), Cloudflare Pages `_headers`/`_redirects`, a third-party form
 * embed script, a 21K HTML diagram and a 12K PDF. Measured at 50,863 bytes.
 *
 * Source contract rather than a dist inspection: the QA lanes must run without
 * having built, and a test that silently passes when dist/ is absent would be
 * worse than no test. What matters is that the native entry point prunes and
 * the web entry point does not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const buildNative = read('scripts/build-native.mjs');

const WEB_ONLY = [
  'sw.js',
  'sw-target.js',
  'manifest.json',
  'reset.html',
  '_headers',
  '_redirects',
  'embed.js',
  'UPR-Hierarchy-Diagram.html',
  'UPR-Invoicing-Financials-Guide.pdf',
];

describe('PERF-02 — native payload prune', () => {
  it('prunes every web-only asset', () => {
    for (const name of WEB_ONLY) {
      expect(buildNative, `${name} missing from the prune list`).toContain(`'${name}'`);
    }
  });

  it('runs only in the native entry point', () => {
    // The web build must keep all of these — the PWA needs its service worker,
    // its manifest and the Cloudflare directives.
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['build:native']).toContain('build-native.mjs');
    expect(pkg.scripts.build).not.toContain('build-native.mjs');
  });

  it('treats an absent file as fine, not as a build failure', () => {
    // public/ changes over time; a prune list that hard-fails on a renamed
    // file would break the release build for no reason.
    expect(buildNative).toMatch(/if \(!existsSync\(target\)\) continue;/);
  });

  it('never fails the build on a prune error', () => {
    // A heavier app still works. A failed build does not.
    expect(buildNative).toMatch(/catch \(error\) \{[\s\S]{0,200}console\.warn/);
  });

  it('reports what it removed', () => {
    // Silent size changes are how a prune list rots without anyone noticing.
    expect(buildNative).toMatch(/pruned \$\{removed\} web-only asset\(s\), \$\{bytes\} bytes/);
  });
});

describe('PERF-02 — guards that must not be disturbed', () => {
  it('leaves the web index.html untouched', () => {
    // boot-cache-poisoning.test.js pins the boot guard's exact shape in the
    // ROOT index.html, and pwa-source-contract.test.js pins the apple-touch-icon
    // link. A native template belongs BESIDE this file, never instead of it.
    const html = read('index.html');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('/manifest.json');
    expect(html).toMatch(/fonts\.googleapis/);
  });

  it('records that the remote fonts and native template are still open', () => {
    // PERF-02 is only partly closed: the native build still loads Google Fonts
    // and still links a manifest it cannot use, because that needs a separate
    // native index.html. Asserted so the partial state is visible rather than
    // assumed finished.
    const html = read('index.html');
    expect(html.match(/fonts\.googleapis/g).length).toBeGreaterThanOrEqual(1);
  });
});
