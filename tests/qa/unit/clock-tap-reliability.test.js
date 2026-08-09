/**
 * ════════════════════════════════════════════════
 * FILE: clock-tap-reliability.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Field techs reported tapping "On My Way", "Start" or "Finish" and having no
 *   time recorded — sometimes, not always. This test pins the four code shapes
 *   that caused it, so none of them can quietly come back.
 *
 *   The failures left NO trace on the server (the database was measured clean:
 *   no orphaned open entries, no completed visit with an unclosed entry), which
 *   is the signature of a tap that never reached the server at all.
 *
 * DEPENDS ON:
 *   Internal:  src/components/tech/TimeTracker.jsx, src/lib/nativeGeolocation.js,
 *              src/pages/tech/v2/dash/AttentionStrip.jsx,
 *              src/i18n/locales/{en,es,pt}/tracker.json
 *   Data:      reads → none (source text only)
 *
 * NOTES / GOTCHAS:
 *   - This is a SOURCE-CONTRACT test: it proves the code SHAPE, not runtime
 *     behaviour. The repo's unit lane runs on `environment: 'node'` with no
 *     jsdom or testing-library, so a real tap cannot be simulated here. The one
 *     runtime proof that does exist is in src/lib/nativeGeolocation.test.js,
 *     which executes the never-hangs deadline against fake timers.
 *   - The remaining proof is an owner on-device check: tap each control on a
 *     real iPhone with the signal off and confirm the failure banner appears
 *     and persists.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const TRACKER = read('src/components/tech/TimeTracker.jsx');
const GEO = read('src/lib/nativeGeolocation.js');
const STRIP = read('src/pages/tech/v2/dash/AttentionStrip.jsx');

describe('location must never gate the clock write', () => {
  it('TimeTracker passes an explicit, short coord budget', () => {
    // The bug: `await getCurrentCoords()` used the 8s default before the RPC.
    // If iOS suspended the web view in that window — a tech tapping "On my way"
    // and pocketing the phone is the literal use case — the promise never
    // settled and the clock RPC never fired.
    expect(TRACKER).toMatch(/getCurrentCoords\(\{\s*timeoutMs:\s*COORD_BUDGET_MS\s*\}\)/);
    expect(TRACKER).not.toMatch(/await getCurrentCoords\(\)/);
  });

  it('the coord budget is short enough that a tech does not give up', () => {
    const m = TRACKER.match(/const COORD_BUDGET_MS\s*=\s*(\d+)/);
    expect(m, 'COORD_BUDGET_MS must be declared').toBeTruthy();
    expect(Number(m[1])).toBeLessThanOrEqual(3000);
  });

  it('the native geolocation branch is bounded by a hard deadline', () => {
    // checkPermissions/requestPermissions have no timeout of their own, and
    // getCurrentPosition's `timeout` is advisory on iOS.
    expect(GEO).toMatch(/function withDeadline\(/);
    expect(GEO).toMatch(/withDeadline\(\(async \(\) => \{/);
  });
});

describe('a two-tap confirm must not disarm itself', () => {
  it('no Station carries an onBlur disarm', () => {
    // onBlur fired on any incidental focus change (the hub re-renders once a
    // second while the clock runs), so the tech's second tap silently RE-ARMED
    // instead of finishing — "I tapped Finish and it never clocked me out".
    expect(TRACKER).not.toMatch(/onBlur=\{\(\) => setConfirmFinish\(false\)\}/);
    expect(TRACKER).not.toMatch(/<Station[^>]*onBlur/s);
  });

  it('the Finish confirm expires on an explicit timer instead', () => {
    expect(TRACKER).toMatch(/const FINISH_CONFIRM_MS\s*=\s*\d+/);
    expect(TRACKER).toMatch(/confirmFinishTimer\.current = setTimeout/);
    // and is cleaned up so it cannot fire into an unmounted component
    expect(TRACKER).toMatch(/clearTimeout\(confirmFinishTimer\.current\)/);
  });

  it('the away-banner Finish dropped its onBlur disarm too', () => {
    expect(STRIP).not.toMatch(/onBlur=\{\(\) => setAwayConfirmFinish\(false\)\}/);
    // its 3s timer remains the only thing that cancels the confirm
    expect(STRIP).toMatch(/awayConfirmTimer\.current = setTimeout/);
  });

  it('Return-to-Job dropped its onBlur disarm too (same defect class)', () => {
    expect(TRACKER).not.toMatch(/onBlur=\{\(\) => \{ setConfirmReturn\(false\)/);
    expect(TRACKER).toMatch(/confirmReturnTimer\.current = setTimeout/);
  });

  it('the station buttons keep a visible keyboard focus ring', () => {
    // `all: unset` also resets outline to none, and as an INLINE style it beats
    // the global :focus-visible rule — no focus indicator at all.
    expect(TRACKER).not.toMatch(/all: 'unset'/);
  });
});

describe('a failed or stale write must be visible, not silent', () => {
  it('a refresh failure raises loadError instead of being ignored', () => {
    // `catch { /* ignore */ }` left the stations showing a stale state after a
    // successful clock, so the tech re-tapped and overwrote clock_in.
    expect(TRACKER).not.toMatch(/catch \{ \/\* ignore \*\/ \}/);
    expect(TRACKER).toMatch(/setLoadError\(true\)/);
    expect(TRACKER).toMatch(/setLoadError\(false\)/);
  });

  it('a failed clock write persists on screen, not only as a toast', () => {
    // A toast is gone in seconds — long before a tech who pocketed the phone
    // looks again. The banner is the honest answer to "did my tap save?".
    expect(TRACKER).toMatch(/setSaveError\(\{ action, message: e\.message \}\)/);
    expect(TRACKER).toMatch(/role="alert"/);
    expect(TRACKER).toMatch(/saveFailedRetry/);
  });

  it('retry is a manual re-tap — nothing is queued or auto-replayed', () => {
    // tech-mobile-ux.md online-only amendment: the app must not admit or
    // automatically replay field mutations.
    expect(TRACKER).toMatch(/onClick=\{\(\) => performClock\(saveError\.action\)\}/);
    expect(TRACKER).not.toMatch(/localStorage|indexedDB|queueMutation/);
  });

  it('retry does NOT route through the two-tap gate', () => {
    // Caught by three reviewers on 2026-08-07: doAction('finish') is a state
    // machine whose first call only ARMS the confirm, and confirmFinish is
    // already false again by the time a failure lands — so a retry through
    // doAction would re-arm the station and fire nothing, reproducing the exact
    // symptom the banner exists to report.
    expect(TRACKER).not.toMatch(/onClick=\{\(\) => doAction\(saveError\.action\)\}/);
  });

  it('an in-flight write says so, through a persistently-mounted live region', () => {
    // The aria-live node must exist at all times and only swap its text — a
    // freshly-inserted live region is announced inconsistently by screen readers.
    expect(TRACKER).toMatch(/aria-live="polite"/);
    expect(TRACKER).toMatch(/\{acting \? t\('saving'\) : ''\}/);
  });
});

describe('the new copy exists in every shipped language', () => {
  const KEYS = ['saving', 'staleWarning', 'saveFailedTitle', 'saveFailedBody', 'saveFailedRetry', 'dismiss', 'confirm'];
  for (const lang of ['en', 'es', 'pt']) {
    it(`${lang} carries every clock-reliability key`, () => {
      const json = JSON.parse(read(`src/i18n/locales/${lang}/tracker.json`));
      for (const key of KEYS) {
        expect(json[key], `${lang}.${key}`).toBeTruthy();
      }
    });
  }
});
