/**
 * PICK-02 (half one) — the Today button commits the real today.
 *
 * `goToday` called `setViewDate(new Date())`, which only QUEUES state, and the
 * click handler then called `handleSelect(today.getDate())` immediately — so
 * handleSelect built its date from the STALE `viewDate` closure. Browsing to
 * March and tapping Today on 27 July committed 2026-03-27.
 *
 * Two further failures rode on that same path, neither reported by the audit:
 *   - short-month rollover: stale February + day 30 -> new Date(y,1,30) = Mar 2;
 *   - a min/max violation made Today a silent no-op while the view still jumped.
 *
 * Structural contract: this lane is DOM-free (vitest.config.js environment
 * 'node', no jsdom in the repo), and the defect IS the wiring — a Today handler
 * that reaches handleSelect is the bug, regardless of what it computes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PICKERS = [
  ['src/components/DatePicker.jsx', 'onClick={goToday}'],
  ['src/components/crm/CrmDatePicker.jsx', 'onClick={goToday}'],
];

/**
 * The two pickers declare goToday differently — a plain arrow ending `};` and a
 * useCallback ending `}, [deps]);` — so slice a bounded window rather than
 * hunting for a terminator. An unbounded slice ran past the function into the
 * calendar-grid code below and matched `viewDate.get` there.
 */
function goTodayBody(source) {
  const at = source.indexOf('const goToday');
  expect(at, 'goToday not found').toBeGreaterThan(-1);
  const rest = source.slice(at);
  // Close on whichever terminator comes first: `};` (plain arrow) or `}, [`
  // (useCallback). A fixed-size window overran into the calendar-grid code and
  // matched viewDate.getFullYear() there.
  const ends = [rest.indexOf('\n  };'), rest.indexOf('\n  }, [')]
    .filter((i) => i > -1);
  expect(ends.length, 'goToday terminator not found').toBeGreaterThan(0);
  return rest.slice(0, Math.min(...ends));
}

describe('PICK-02 — Today commits the real current date', () => {
  it.each(PICKERS)('%s wires Today straight to goToday', (file, wiring) => {
    expect(read(file)).toContain(wiring);
  });

  it.each(PICKERS)('%s never routes Today through handleSelect', (file) => {
    const source = read(file);
    // The precise historical bug, in both copies.
    expect(source).not.toMatch(/goToday\(\);\s*handleSelect\(/);
    expect(source).not.toMatch(/setViewDate\(new Date\(\)\);\s*handleSelect\(/);
  });

  it.each(PICKERS)('%s computes Today from a fresh Date, not viewDate', (file) => {
    const source = read(file);
    const body = goTodayBody(source);
    expect(body).toContain('const now = new Date()');
    expect(body).toContain('fmt(now)');
    // viewDate inside goToday would reintroduce the stale-month bug.
    expect(body).not.toMatch(/viewDate\.get/);
  });

  it.each(PICKERS)('%s still honours min/max when committing Today', (file) => {
    const source = read(file);
    const body = goTodayBody(source);
    expect(body).toContain('if (min && str < min) return;');
    expect(body).toContain('if (max && str > max) return;');
    // The bounds must be checked against the REAL date. Previously the early
    // return happened inside handleSelect after the view had already moved,
    // leaving the calendar on a month the user never chose.
    const minAt = body.indexOf('if (min &&');
    const strAt = body.indexOf('const str = fmt(now)');
    expect(strAt).toBeGreaterThan(-1);
    expect(minAt).toBeGreaterThan(strAt);
  });

  it('keeps the two pickers in agreement, since the bug shipped twice', () => {
    // A fix applied to only one copy is how this half-regresses.
    for (const [file] of PICKERS) {
      const source = read(file);
      expect(source, `${file} missing goToday`).toMatch(/goToday/);
      expect(source, `${file} missing onChange(str)`).toMatch(/onChange\(str\)/);
    }
  });
});
