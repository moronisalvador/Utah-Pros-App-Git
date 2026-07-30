/**
 * JOB-01 — the page gate is cold-start only.
 *
 * Reproduced in the audit: saving a job note replaced the rendered page with an
 * almost-white spinner for ~0.6s, then returned near the hero rather than the
 * editor. Cause: load() set the page-level loading gate on EVERY call, and
 * every mutation plus pull-to-refresh called it.
 *
 * The scroll clamp is structural, which is why the flash also loses position:
 * `.tech-content` (the shell) owns the scroll and `.tech-page` declares no
 * overflow, so collapsing this child to a short spinner resets the shell's
 * scrollTop.
 *
 * page-lifecycle.md §1 (gate is cold-start only; `loading` starts true and is
 * only ever set false), §3 (mutations patch in place), and
 * loading-error-states.md §6 (PTR is always the silent load).
 *
 * `load()` later grew a SECOND, independent flag (`quiet`, LES-01) covering a
 * different question — whether a failure is reported, not whether the page
 * re-gates. The assertions below therefore match on `silent: true` being
 * PRESENT rather than on an exact argument literal: JOB-01 owns the gate, and a
 * pin on the literal would fail every time an orthogonal flag is added, which
 * teaches the next author to loosen the guard instead of the pin.
 *
 * Source contract rather than a render test: this lane is DOM-free
 * (vitest.config.js environment 'node', no jsdom in the repo), and the property
 * that matters — which call sites re-gate — is structural.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const source = readFileSync(join(ROOT, 'src/pages/tech/TechJobDetail.jsx'), 'utf8');

describe('JOB-01 — TechJobDetail loading gate', () => {
  it('only gates when the caller did not ask for a silent load', () => {
    expect(source).toMatch(/const load = useCallback\(async \(\{ silent = false[^}]*\} = \{\}\) =>/);
    expect(source).toMatch(/if \(!silent\) setLoading\(true\);/);
    // A bare setLoading(true) anywhere in load() would re-gate unconditionally.
    const loadBody = source.slice(
      source.indexOf('const load = useCallback'),
      source.indexOf('useEffect(() => { load(); }'),
    );
    const bareGate = loadBody.match(/^\s*setLoading\(true\);/m);
    expect(bareGate, 'setLoading(true) must stay behind the !silent guard').toBeNull();
  });

  it('keeps the cold mount gated, so first paint is not an empty page', () => {
    // The gate is not the bug — gating a REFETCH is.
    expect(source).toMatch(/useEffect\(\(\) => \{ load\(\); \}, \[load\]\)/);
    expect(source).toContain('if (loading) {');
  });

  it('saves a note without re-gating the page', () => {
    const saveNote = source.slice(
      source.indexOf('const saveNote = async'),
      source.indexOf('const saveNote = async') + 1400,
    );
    expect(saveNote).toMatch(/load\(\{ silent: true[^)]*\}\)/);
    expect(saveNote).not.toMatch(/\bload\(\);/);
  });

  it('uploads a photo without re-gating the page', () => {
    const upload = source.slice(
      source.indexOf('const uploadPhoto'),
      source.indexOf('const saveNote = async'),
    );
    expect(upload).toMatch(/load\(\{ silent: true[^)]*\}\)/);
    expect(upload).not.toMatch(/\bload\(\);/);
  });

  it('makes pull-to-refresh silent', () => {
    // Gating it unmounted the page mid-gesture.
    expect(source).toContain('onRefresh={() => load({ silent: true })}');
    expect(source).not.toContain('onRefresh={load}');
  });

  it('leaves the draft and the open editor alone when a save fails', () => {
    // setNoteText('')/setNoteOpen(false) must stay AFTER the await inside try,
    // so a rejection skips them and the tech keeps what they typed. The app is
    // online-only for field writes (tech-mobile-ux.md, amended 2026-07-27), so
    // a failed save has to fail visibly with the text intact.
    const saveNote = source.slice(
      source.indexOf('const saveNote = async'),
      source.indexOf('const saveNote = async') + 1400,
    );
    const awaitAt = saveNote.indexOf('await db.rpc');
    const clearAt = saveNote.indexOf("setNoteText('')");
    const catchAt = saveNote.indexOf('} catch');
    expect(awaitAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(awaitAt);
    expect(clearAt).toBeLessThan(catchAt);
  });
});
