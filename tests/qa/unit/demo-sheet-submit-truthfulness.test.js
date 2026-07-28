/**
 * ENCIRCLE-02 — the Scope Sheet submit screen must not claim work it did not do.
 *
 * The submit fires three independent Workers and reports each on the result
 * screen. Two of them already required a parsed success body. The Encircle branch
 * trusted `r.ok` alone, which is not proof of anything: during the native /api
 * origin bug Capacitor answered every /api path from the app BUNDLE with a 200
 * and an HTML body, so `r.ok` was true and the sheet showed a green
 * "Posted to Encircle" for a note that had never been created.
 *
 * A tech reads that green box and moves on. Nobody goes back to check a success.
 *
 * Source-contract assertions — vitest runs `node` here with no jsdom, so
 * TechDemoSheet cannot be rendered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const sheet = read('src/pages/tech/TechDemoSheet.jsx');

describe('ENCIRCLE-02 — every submit branch verifies a body, not a status', () => {
  it('Encircle requires the worker\'s { ok: true } shape', () => {
    expect(sheet).toContain('encircleOk = r.ok && d?.ok === true;');
    // The bare form is what shipped the false success.
    expect(sheet).not.toContain('encircleOk = r.ok;');
  });

  it('email requires a parsed ok', () => {
    expect(sheet).toContain('emailOk = parsed.ok === true;');
  });

  it('the PDF attach requires a parsed success', () => {
    expect(sheet).toContain('if (r.ok && parsed?.success)');
  });

  it('no submit branch assigns a success flag straight from r.ok', () => {
    // Catches a future branch reintroducing the pattern. `r.ok &&` is fine;
    // `= r.ok;` or `= r.ok }` alone is not.
    const bare = sheet.match(/\b(?:encircleOk|emailOk|pdfAttached|saveOk)\s*=\s*r\.ok\s*[;\n]/g) || [];
    expect(bare).toEqual([]);
  });
});

describe('ENCIRCLE-02 — a failure is recorded rather than swallowed', () => {
  it('logs the worker error instead of failing silently', () => {
    // The branch is best-effort by design — a failed note must not lose the
    // sheet — but the previous empty catch is what let it go unnoticed.
    expect(sheet).toContain("console.error('[demo-sheet] encircle-upload failed:'");
    expect(sheet).toContain("console.error('[demo-sheet] encircle-upload network error:'");
  });

  it('still shows the honest failure copy on the result screen', () => {
    expect(sheet).toContain("result.encircleOk ? 'Posted to Encircle' : 'Encircle skipped'");
    expect(sheet).toContain('Could not post note — sheet saved anyway');
  });
});

describe('ENCIRCLE-02 — the worker contract this relies on', () => {
  const worker = read('functions/api/encircle-upload.js');

  it('returns { ok: true, id } on success', () => {
    expect(worker).toContain('{ ok: true, id: result.id || null }');
  });

  it('returns a non-2xx with an error on every failure path', () => {
    for (const shape of [
      "{ error: 'Encircle not configured' }",
      "{ error: 'Invalid JSON body' }",
      "{ error: 'claim_id required' }",
      "{ error: 'text required' }",
    ]) {
      expect(worker, shape).toContain(shape);
    }
  });
});
