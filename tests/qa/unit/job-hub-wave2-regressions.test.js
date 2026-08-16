/**
 * ════════════════════════════════════════════════
 * FILE: job-hub-wave2-regressions.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins two defects fixed on 2026-08-16 that were invisible to every check the
 *   project already had — the build passed, CI passed, the reviewers' static
 *   rules passed, and a human verified the screens on a real phone-width
 *   browser. Both only appear when something goes WRONG, which is exactly the
 *   path nobody exercised.
 *
 * WHY THIS EXISTS:
 *   1. A failed save on the tech customer page closed the edit form and threw
 *      away whatever the technician had typed. The parent swallowed the error
 *      and returned normally; the child treats a resolved promise as success,
 *      so it closed the form over a write that never landed. The same rule is
 *      already written down in tech-mobile-ux.md for TechAppointment's reading
 *      handlers — this surface simply did not inherit it.
 *   2. The Job Hub refused to let a technician clock in or tap OMW unless they
 *      were on the visit's crew. The legacy appointment page never gated that
 *      (it renders TimeTracker unconditionally) and nothing server-side does
 *      either, so the gate removed a real ability — covering a shift, picking
 *      up an unscheduled job — while protecting nothing.
 *
 * NOTES / GOTCHAS:
 *   - Source-contract test (credential-free lane). The suite runs in the `node`
 *     environment with no jsdom, so this pins STRUCTURE, not behaviour: it
 *     proves the error path is wired, not that a finger on glass recovers a
 *     half-typed phone number. That remains a device check.
 *   - The save assertions deliberately check BOTH layers. Fixing only one does
 *     not work: if the parent swallows, the child's catch never fires and the
 *     form still closes; if the parent rethrows without a child catch, the
 *     rejection is unhandled.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CUST = 'src/pages/tech/v2/customer';

/** The body of `const <name> = async (...) => { ... }` up to the closing brace. */
function arrowBody(source, name) {
  const start = source.indexOf(`const ${name} = async (`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('customer page — a failed save must not discard typed edits', () => {
  it('both savers rethrow after toasting, so the caller learns it failed', () => {
    const page = read(`${CUST}/TechCustomerPage.jsx`);
    for (const saver of ['saveContact', 'saveJobInsurance']) {
      const body = arrowBody(page, saver);
      expect(body, `${saver} must catch`).toMatch(/catch\s*\(\s*error\s*\)/);
      expect(body, `${saver} must still tell the tech`).toContain('saveFailed');
      expect(body, `${saver} must rethrow — a swallowed error reads as success`)
        .toMatch(/catch\s*\(\s*error\s*\)\s*\{[^}]*throw error;[^}]*\}/s);
    }
  });

  it('both editing sections close the form ONLY on a resolved save', () => {
    for (const file of ['CustomerInfoSection.jsx', 'InsuranceSection.jsx']) {
      const body = arrowBody(read(`${CUST}/${file}`), 'save');
      // setEditing(false) must sit inside the try, before the catch — never in
      // finally, and never after it.
      const tryIdx = body.indexOf('try {');
      const editIdx = body.indexOf('setEditing(false)');
      const catchIdx = body.indexOf('} catch');
      const finallyIdx = body.indexOf('} finally');
      expect(tryIdx, `${file}: no try`).toBeGreaterThan(-1);
      expect(catchIdx, `${file}: no catch — the rethrow would go unhandled`).toBeGreaterThan(-1);
      expect(editIdx, `${file}: setEditing(false) missing`).toBeGreaterThan(tryIdx);
      expect(editIdx, `${file}: setEditing(false) must precede the catch`).toBeLessThan(catchIdx);
      expect(finallyIdx, `${file}: finally must follow the catch`).toBeGreaterThan(catchIdx);
      // The spinner still has to clear on both paths.
      expect(body.slice(finallyIdx)).toContain('setSaving(false)');
    }
  });

  it('AdditionalContactsSection stays the reference implementation', () => {
    // It was already correct and is what the two fixes above were modelled on.
    // If this ever regresses, the pattern loses its in-repo precedent.
    const body = arrowBody(read(`${CUST}/AdditionalContactsSection.jsx`), 'saveCard');
    const closeIdx = body.indexOf('setOpenId(null)');
    const catchIdx = body.indexOf('} catch');
    expect(closeIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeLessThan(catchIdx);
  });
});

describe('Job Hub — a non-crew technician can still clock in', () => {
  const stage = () => read('src/pages/tech/v2/hub/HubStage.jsx');

  it('does not hard-gate the clock on crew membership', () => {
    // The regression was exactly `const canClock = isCrew && !isCancelled;`.
    expect(stage()).not.toMatch(/canClock\s*=\s*isCrew\s*&&/);
  });

  it('lets an acknowledgement open the clock, and still hides it when cancelled', () => {
    const src = stage();
    expect(src).toMatch(/canClock\s*=\s*\(\s*isCrew\s*\|\|\s*crewAck\s*\)\s*&&\s*!isCancelled/);
  });

  it('offers the way through instead of a dead-end notice', () => {
    const src = stage();
    expect(src).toContain('stage.notOnCrew');
    expect(src).toContain('stage.clockInAnyway');
    expect(src).toContain('setCrewAck(true)');
    // The old copy claimed the screen was view-only. It is not, any more.
    expect(src).not.toContain('stage.readOnly');
  });

  it('resets the acknowledgement per visit, during render rather than in an effect', () => {
    // Without the reset, acknowledging one visit silently unlocks the next
    // visit the tech switches to inside the same mounted Hub.
    //
    // It must be a render-phase adjustment: react-hooks/set-state-in-effect is
    // an ERROR in this repo, so the effect form does not build — and an effect
    // would also leave one paint where the previous visit's acknowledgement
    // still applied. Same idiom JobClaimSection used for its open signal.
    const src = stage();
    expect(src).toMatch(/if\s*\(\s*apptId\s*!==\s*ackedAppt\s*\)/);
    expect(src).toMatch(/setAckedAppt\(apptId\);\s*setCrewAck\(false\);/);
    expect(src, 'the effect form is a lint error here')
      .not.toMatch(/useEffect\([^)]*setCrewAck/s);
  });

  it('does NOT write appointment_crew — self-assignment was not the decision', () => {
    // Owner chose "ask first, then clock" over "clock in and join the crew".
    // A crew write appearing here would be a different product decision.
    expect(stage()).not.toMatch(/insert\(\s*['"]appointment_crew/);
  });

  it('carries the copy in all three shipped locales', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const hub = JSON.parse(read(`src/i18n/locales/${locale}/hub.json`));
      expect(hub.stage.notOnCrew, `${locale} notOnCrew`).toBeTruthy();
      expect(hub.stage.clockInAnyway, `${locale} clockInAnyway`).toBeTruthy();
      expect(hub.stage.readOnly, `${locale} readOnly should be retired`).toBeUndefined();
    }
  });
});
