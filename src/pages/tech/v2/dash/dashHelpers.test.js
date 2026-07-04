/**
 * ════════════════════════════════════════════════
 * FILE: dashHelpers.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the small pure helpers behind the v2 tech dashboard so the "mission
 *   control" screen shows the right thing. It proves three things the dashboard
 *   leans on: (1) the shared pickNowNext helper picks the correct hero
 *   appointment in the tricky cases (a job the tech is actively on, nothing left
 *   today, everything already done); (2) hours read out as a labeled
 *   travel + on-site + total breakdown and never a bare number; and (3) a
 *   cancelled appointment never shows up as the hero or anywhere in the day's
 *   groups (Finding 6 regression).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./dashHelpers, @/components/tech/NowNextTile (frozen pickNowNext)
 *   Data:      none (pure unit test — no network, no creds)
 *
 * NOTES / GOTCHAS:
 *   - Unit test: runs without Supabase creds (unlike the DB-level
 *     supabase/tests/tech_v2_dashboard.test.js which self-skips). This covers the
 *     CLIENT layer Session D owns; the RPC's own cancelled-exclusion is proven
 *     server-side in that integration file.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { pickNowNext } from '@/components/tech/NowNextTile';
import { fmtHours, hoursBreakdown, toPickShape, selectHero, splitToday } from './dashHelpers.js';

const ME = 'emp-1';

// A UTC date string (YYYY-MM-DD) offset from today, matching the basis
// pickNowNext uses (`new Date().toISOString().split('T')[0]`). Keeps the
// "soonest upcoming" fixtures below in the future on every calendar day
// instead of hardcoding dates that eventually become "today"/past.
function daysFromToday(n) {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

// A get_tech_dashboard-shaped appointment (appointment_crew, jobs nested).
function appt(over = {}) {
  return {
    id: over.id || 'a1',
    job_id: over.job_id || 'j1',
    title: over.title || 'Water mitigation',
    date: over.date || '2026-07-03',
    time_start: over.time_start || '09:00:00',
    status: over.status || 'scheduled',
    type: over.type || 'inspection',
    jobs: over.jobs || { id: 'j1', job_number: 'WL-100', insured_name: 'Jane Doe' },
    appointment_crew: over.appointment_crew || [
      { employee_id: ME, employees: { full_name: 'Bob Tech', display_name: 'Bob' } },
    ],
    ...over,
  };
}

describe('fmtHours — decimal hours → human string', () => {
  it('shows 0h for zero', () => expect(fmtHours(0)).toBe('0h'));
  it('shows whole hours cleanly', () => expect(fmtHours(1)).toBe('1h'));
  it('shows h + m', () => expect(fmtHours(2.5)).toBe('2h 30m'));
  it('shows minutes only when under an hour', () => expect(fmtHours(0.5)).toBe('30m'));
  it('rounds minutes to the nearest whole', () => expect(fmtHours(8.26)).toBe('8h 16m'));
  it('is safe on null/NaN', () => {
    expect(fmtHours(null)).toBe('0h');
    expect(fmtHours(undefined)).toBe('0h');
  });
});

describe('hoursBreakdown — labeled travel + on-site + total', () => {
  it('labels each part and keeps total = travel + on-site', () => {
    const b = hoursBreakdown({ travel: 0.5, on_site: 2, total: 2.5 });
    expect(b).toEqual([
      { label: 'Travel', value: '30m' },
      { label: 'On-site', value: '2h' },
      { label: 'Total', value: '2h 30m' },
    ]);
  });
  it('is safe on a missing bucket', () => {
    const b = hoursBreakdown(null);
    expect(b.map(x => x.value)).toEqual(['0h', '0h', '0h']);
  });
});

describe('toPickShape — payload appt → pickNowNext shape', () => {
  it('flattens appointment_crew to crew[] and lifts job_number', () => {
    const s = toPickShape(appt());
    expect(s.crew).toEqual([{ employee_id: ME, full_name: 'Bob' }]);
    expect(s.job_number).toBe('WL-100');
    // retains fields the hero needs to render TimeTracker
    expect(s.jobs).toBeTruthy();
    expect(s.id).toBe('a1');
  });
});

describe('pickNowNext — hero selection edge cases (frozen contract)', () => {
  it('prefers a live appointment the tech is on (paused counts)', () => {
    const list = [
      appt({ id: 'done', status: 'completed' }),
      appt({ id: 'paused', status: 'paused' }),
    ].map(toPickShape);
    const r = pickNowNext(list, ME);
    expect(r).toEqual({ ctxType: 'now_active', appt: expect.objectContaining({ id: 'paused' }) });
  });

  it('returns null when every appointment today is completed and nothing upcoming', () => {
    const list = [
      appt({ id: 'd1', status: 'completed' }),
      appt({ id: 'd2', status: 'completed' }),
    ].map(toPickShape);
    expect(pickNowNext(list, ME)).toBeNull();
  });

  it('returns null when there are no appointments at all (none today)', () => {
    expect(pickNowNext([], ME)).toBeNull();
    expect(pickNowNext(null, ME)).toBeNull();
  });
});

describe('selectHero — combines today + upcoming, returns the raw appt', () => {
  it('picks the active appointment and hands back the full payload row', () => {
    const payload = {
      appointments: [appt({ id: 'live', status: 'in_progress' })],
      upcoming: [appt({ id: 'tmrw', date: '2026-07-04', status: 'scheduled' })],
    };
    const r = selectHero(payload, ME);
    expect(r.ctxType).toBe('now_active');
    expect(r.appt.id).toBe('live');
    // raw payload shape preserved (jobs + appointment_crew) so the hero can mount TimeTracker
    expect(r.appt.appointment_crew).toBeTruthy();
    expect(r.appt.jobs).toBeTruthy();
  });

  it('falls through to the soonest upcoming when nothing is left today', () => {
    const payload = {
      appointments: [appt({ id: 'done', status: 'completed' })],
      upcoming: [
        appt({ id: 'far', date: daysFromToday(4), time_start: '08:00:00', status: 'scheduled' }),
        appt({ id: 'soon', date: daysFromToday(2), time_start: '08:00:00', status: 'scheduled' }),
      ],
    };
    const r = selectHero(payload, ME);
    expect(r.ctxType).toBe('next');
    expect(r.appt.id).toBe('soon');
  });
});

describe('splitToday + cancelled regression (Finding 6)', () => {
  it('buckets active / scheduled / completed and NEVER surfaces cancelled', () => {
    const rows = [
      appt({ id: 'a', status: 'in_progress' }),
      appt({ id: 's', status: 'scheduled' }),
      appt({ id: 'c', status: 'completed' }),
      appt({ id: 'x', status: 'cancelled' }),
    ];
    const { active, scheduled, completed } = splitToday(rows);
    expect(active.map(a => a.id)).toEqual(['a']);
    expect(scheduled.map(a => a.id)).toEqual(['s']);
    expect(completed.map(a => a.id)).toEqual(['c']);
    // the cancelled row appears in no bucket
    const allIds = [...active, ...scheduled, ...completed].map(a => a.id);
    expect(allIds).not.toContain('x');
  });

  it('never chooses a cancelled appointment as the hero even if one slips into the payload', () => {
    const payload = {
      appointments: [appt({ id: 'x', status: 'cancelled' })],
      upcoming: [appt({ id: 'x2', date: '2026-07-05', status: 'cancelled' })],
    };
    expect(selectHero(payload, ME)).toBeNull();
  });
});
