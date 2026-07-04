/**
 * ════════════════════════════════════════════════
 * FILE: useVisitClock.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Job Hub's clock-state reader agrees with the TimeTracker it copies
 *   from — the exact ladder scheduled → on-my-way → working → paused → done, the
 *   multi-visit "Visit N" numbering, the live elapsed time (measured from On My
 *   Way), and the amber "still clocked in after 10 hours" hint. Pure unit test on
 *   deriveVisitClock — no database, no React.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./useVisitClock (deriveVisitClock, FORGOT_CLOCKOUT_MIN)
 *   Data:      none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { deriveVisitClock, FORGOT_CLOCKOUT_MIN } from './useVisitClock.js';

// Fixed "now" so every case is deterministic.
const NOW = Date.UTC(2026, 6, 4, 18, 0, 0); // 2026-07-04T18:00:00Z
const min = (n) => n * 60 * 1000;
const iso = (offsetMin) => new Date(NOW + offsetMin * 60 * 1000).toISOString();

describe('deriveVisitClock — the five states', () => {
  it('scheduled: no entries (also the non-crew viewer case)', () => {
    const v = deriveVisitClock([], NOW);
    expect(v.status).toBe('scheduled');
    expect(v.currentEntry).toBeNull();
    expect(v.activeEntry).toBeNull();
    expect(v.visitNumber).toBeNull();
    expect(v.elapsedMs).toBe(0);
    expect(v.isStale).toBe(false);
  });

  it('omw: travel started, not yet on site — elapsed counts from travel_start', () => {
    const v = deriveVisitClock([{ id: 'a', travel_start: iso(-30), clock_in: null, clock_out: null }], NOW);
    expect(v.status).toBe('omw');
    expect(v.running).toBe(true);
    expect(v.elapsedMs).toBe(min(30));
  });

  it('on_site: clocked in — elapsed still counts continuously from travel_start', () => {
    const v = deriveVisitClock([{ id: 'a', travel_start: iso(-60), clock_in: iso(-40), clock_out: null }], NOW);
    expect(v.status).toBe('on_site');
    expect(v.running).toBe(true);
    expect(v.elapsedMs).toBe(min(60));
  });

  it('paused: elapsed freezes at paused_at', () => {
    const v = deriveVisitClock([{ id: 'a', travel_start: iso(-60), clock_in: iso(-40), paused_at: iso(-10), clock_out: null }], NOW);
    expect(v.status).toBe('paused');
    expect(v.running).toBe(false);
    expect(v.elapsedMs).toBe(min(50)); // paused_at(-10) − travel_start(-60)
  });

  it('completed: elapsed is the closed span; travel/on-site minutes exposed', () => {
    const v = deriveVisitClock([{
      id: 'a', travel_start: iso(-120), clock_in: iso(-100), clock_out: iso(-10),
      travel_minutes: 20, hours: 1.5,
    }], NOW);
    expect(v.status).toBe('completed');
    expect(v.running).toBe(false);
    expect(v.elapsedMs).toBe(min(110)); // clock_out(-10) − travel_start(-120)
    expect(v.travelMinutes).toBe(20);
    expect(v.onSiteMinutes).toBe(90);
    expect(v.isStale).toBe(false); // no OPEN entry → never stale
  });
});

describe('deriveVisitClock — multi-entry (Visit N)', () => {
  const first = { id: 'v1', travel_start: iso(-600), clock_in: iso(-580), clock_out: iso(-500), travel_minutes: 20, hours: 1 };

  it('a completed visit + a fresh active one → Visit 2, one prior', () => {
    const second = { id: 'v2', travel_start: iso(-30), clock_in: iso(-15), clock_out: null };
    const v = deriveVisitClock([first, second], NOW);
    expect(v.status).toBe('on_site');
    expect(v.currentEntry.id).toBe('v2');
    expect(v.visitNumber).toBe(2);
    expect(v.priorVisits.map((e) => e.id)).toEqual(['v1']);
  });

  it('all visits completed → current is the last, prior is the rest, numbered by position', () => {
    const second = { id: 'v2', travel_start: iso(-120), clock_in: iso(-100), clock_out: iso(-10), travel_minutes: 20, hours: 1.5 };
    const v = deriveVisitClock([first, second], NOW);
    expect(v.status).toBe('completed');
    expect(v.currentEntry.id).toBe('v2');
    expect(v.visitNumber).toBe(2);
    expect(v.priorVisits.map((e) => e.id)).toEqual(['v1']);
    // totals sum across every entry (breakdown is never a bare number)
    expect(v.totalTravelMinutes).toBe(40);
    expect(v.totalOnSiteMinutes).toBe(150);
    expect(v.totalMinutes).toBe(190);
  });
});

describe('deriveVisitClock — stale-clock hint (FORGOT_CLOCKOUT parity)', () => {
  it('exposes the 10-hour threshold', () => {
    expect(FORGOT_CLOCKOUT_MIN).toBe(10 * 60);
  });

  it('open entry ≥10h old → isStale true', () => {
    const v = deriveVisitClock([{ id: 'a', travel_start: iso(-11 * 60), clock_in: iso(-10 * 60), clock_out: null }], NOW);
    expect(v.isStale).toBe(true);
  });

  it('open entry under 10h old → isStale false', () => {
    const v = deriveVisitClock([{ id: 'a', travel_start: iso(-9 * 60), clock_in: iso(-8 * 60), clock_out: null }], NOW);
    expect(v.isStale).toBe(false);
  });
});
