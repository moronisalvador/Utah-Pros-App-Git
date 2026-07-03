/**
 * ════════════════════════════════════════════════
 * FILE: scheduleSelectors.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the v2 schedule's pure math by hand: that months and weeks are bucketed
 *   correctly no matter the timezone, that a month maps to the right load range,
 *   that appointments group and sort into the right days, and — most importantly —
 *   that the "my work / crew / division" filters behave EXACTLY like the old
 *   schedule page (parity). Pure unit test, no DB, runs in the normal `npm test`.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./scheduleSelectors
 *   Data:      none — hand-built TEST fixtures only (never live rows)
 *
 * NOTES / GOTCHAS:
 *   - The employee/division filter expectations are re-derived from the legacy
 *     TechSchedule.jsx predicate so this file IS the parity contract.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  pad2,
  parseLocal,
  monthKeyOf,
  addMonths,
  monthKeysAround,
  monthRange,
  addDaysStr,
  startOfWeekStr,
  weekDaysStr,
  sortByTime,
  groupByDate,
  sortedDateKeys,
  apptDateSet,
  matchesEmployeeFilter,
  matchesDivisionFilter,
  filterAppointments,
  searchAppointments,
  MITIGATION_DIVS,
} from './scheduleSelectors.js';

// ─── Month-window key math (timezone-safe) ──────────────
describe('month key math', () => {
  it('monthKeyOf slices a date string without timezone drift', () => {
    // A UTC parse of '2026-01-01' would roll back to Dec 31 in the Americas.
    expect(monthKeyOf('2026-01-01')).toBe('2026-01');
    expect(monthKeyOf('2026-12-31')).toBe('2026-12');
  });

  it('monthKeyOf from a local Date uses the local month', () => {
    expect(monthKeyOf(new Date(2026, 6, 3))).toBe('2026-07'); // July (0-indexed 6)
    expect(monthKeyOf(new Date(2026, 0, 1))).toBe('2026-01');
  });

  it('addMonths crosses year boundaries in both directions', () => {
    expect(addMonths('2026-07', 1)).toBe('2026-08');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', -13)).toBe('2024-12');
    expect(addMonths('2026-06', 12)).toBe('2027-06');
  });

  it('monthKeysAround returns 2·radius+1 keys, oldest first, centered', () => {
    expect(monthKeysAround('2026-07', 1)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(monthKeysAround('2026-01', 1)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(monthKeysAround('2026-07', 2)).toEqual([
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);
  });

  it('monthRange spans the first to the last day of the month', () => {
    expect(monthRange('2026-07')).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' }); // leap
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });
});

// ─── Date & week arithmetic ──────────────
describe('date arithmetic', () => {
  it('parseLocal builds a local-midnight date (no UTC shift)', () => {
    const d = parseLocal('2026-07-03');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(3);
  });

  it('addDaysStr crosses month + year boundaries', () => {
    expect(addDaysStr('2026-07-03', 1)).toBe('2026-07-04');
    expect(addDaysStr('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDaysStr('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysStr('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('startOfWeekStr snaps to Sunday by default and Monday when asked', () => {
    // 2026-07-03 is a Friday.
    expect(startOfWeekStr('2026-07-03', 0)).toBe('2026-06-28'); // Sunday
    expect(startOfWeekStr('2026-07-03', 1)).toBe('2026-06-29'); // Monday
    // A Sunday stays put for Sunday-start weeks.
    expect(startOfWeekStr('2026-06-28', 0)).toBe('2026-06-28');
  });

  it('weekDaysStr returns 7 consecutive days from the start', () => {
    expect(weekDaysStr('2026-06-28')).toEqual([
      '2026-06-28', '2026-06-29', '2026-06-30',
      '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04',
    ]);
  });

  it('pad2 zero-pads single digits', () => {
    expect(pad2(3)).toBe('03');
    expect(pad2(12)).toBe('12');
  });
});

// ─── Grouping & sorting ──────────────
describe('grouping & sorting', () => {
  const appts = [
    { id: 't1', date: '2026-07-03', time_start: '14:00:00' },
    { id: 't2', date: '2026-07-03', time_start: '08:30:00' },
    { id: 't3', date: '2026-07-01', time_start: null },
    { id: 't4', date: '2026-07-01', time_start: '10:00:00' },
    { id: 't5', date: null, time_start: '09:00:00' }, // no date → dropped
  ];

  it('sortByTime orders ascending, null time first, without mutating input', () => {
    const input = [{ time_start: '10:00' }, { time_start: '09:00' }, { time_start: null }];
    const out = sortByTime(input);
    expect(out.map((a) => a.time_start)).toEqual([null, '09:00', '10:00']);
    expect(input[0].time_start).toBe('10:00'); // original untouched
  });

  it('groupByDate buckets by day, sorts within a day, drops dateless rows', () => {
    const g = groupByDate(appts);
    expect(Object.keys(g).sort()).toEqual(['2026-07-01', '2026-07-03']);
    expect(g['2026-07-03'].map((a) => a.id)).toEqual(['t2', 't1']); // 08:30 before 14:00
    expect(g['2026-07-01'].map((a) => a.id)).toEqual(['t3', 't4']); // null time first
  });

  it('sortedDateKeys returns chronological date keys', () => {
    expect(sortedDateKeys(groupByDate(appts))).toEqual(['2026-07-01', '2026-07-03']);
  });

  it('apptDateSet collects only dates present', () => {
    const set = apptDateSet(appts);
    expect(set.has('2026-07-03')).toBe(true);
    expect(set.has('2026-07-01')).toBe(true);
    expect(set.size).toBe(2);
  });
});

// ─── Filter-predicate parity with legacy TechSchedule ──────────────
describe('filter parity (me/all/multi-crew + division)', () => {
  const ME = 'emp-me';
  const A = 'emp-a';
  const B = 'emp-b';

  const mkAppt = (id, crewIds, division) => ({
    id,
    appointment_crew: crewIds.map((eid) => ({ employee_id: eid })),
    jobs: division ? { division } : null,
  });

  const appts = [
    mkAppt('a1', [ME], 'water'),
    mkAppt('a2', [A], 'reconstruction'),
    mkAppt('a3', [ME, B], 'mold'),
    mkAppt('a4', [A, B], 'contents'),
    mkAppt('a5', [B], 'fire'), // fire is NOT mitigation in legacy parity
    mkAppt('a6', [], null), // event with no crew, no job
  ];

  it("'me' keeps only appts where I'm on the crew", () => {
    const out = filterAppointments(appts, { employee: 'me', division: 'all', myId: ME });
    expect(out.map((a) => a.id)).toEqual(['a1', 'a3']);
  });

  it("'all' keeps everything (no employee filter)", () => {
    const out = filterAppointments(appts, { employee: 'all', division: 'all', myId: ME });
    expect(out.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  it('a multi-crew array keeps appts touching ANY selected member', () => {
    const out = filterAppointments(appts, { employee: [ME, A], division: 'all', myId: ME });
    expect(out.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('mitigation = water/mold/contents (fire excluded, legacy parity)', () => {
    const out = filterAppointments(appts, { employee: 'all', division: 'mitigation', myId: ME });
    expect(out.map((a) => a.id)).toEqual(['a1', 'a3', 'a4']);
    expect(MITIGATION_DIVS).toEqual(['water', 'mold', 'contents']);
  });

  it('reconstruction = division exactly reconstruction', () => {
    const out = filterAppointments(appts, { employee: 'all', division: 'reconstruction', myId: ME });
    expect(out.map((a) => a.id)).toEqual(['a2']);
  });

  it('employee + division compose (AND)', () => {
    const out = filterAppointments(appts, { employee: [B], division: 'mitigation', myId: ME });
    expect(out.map((a) => a.id)).toEqual(['a3', 'a4']);
  });

  it('predicate helpers match the composed result', () => {
    expect(matchesEmployeeFilter(appts[0], 'me', ME)).toBe(true);
    expect(matchesEmployeeFilter(appts[1], 'me', ME)).toBe(false);
    expect(matchesDivisionFilter(appts[4], 'mitigation')).toBe(false); // fire
    expect(matchesDivisionFilter(appts[0], 'mitigation')).toBe(true); // water
  });
});

// ─── Search ──────────────
describe('searchAppointments', () => {
  const appts = [
    { id: 's1', title: 'Water Extraction', jobs: { insured_name: 'Jane Doe', address: '12 Oak St', city: 'Provo', job_number: 'J-100' } },
    { id: 's2', title: 'Recon walkthrough', jobs: { insured_name: 'Bob Smith', address: '9 Elm Ave', city: 'Orem', job_number: 'J-200' } },
    { id: 's3', title: 'PTO', jobs: null },
  ];

  it('blank query returns the list unchanged', () => {
    expect(searchAppointments(appts, '   ')).toBe(appts);
  });

  it('matches title, name, address, city, and job number, case-insensitive', () => {
    expect(searchAppointments(appts, 'jane').map((a) => a.id)).toEqual(['s1']);
    expect(searchAppointments(appts, 'orem').map((a) => a.id)).toEqual(['s2']);
    expect(searchAppointments(appts, 'j-100').map((a) => a.id)).toEqual(['s1']);
    expect(searchAppointments(appts, 'pto').map((a) => a.id)).toEqual(['s3']);
    expect(searchAppointments(appts, 'walk').map((a) => a.id)).toEqual(['s2']);
  });

  it('no match returns empty', () => {
    expect(searchAppointments(appts, 'zzz')).toEqual([]);
  });
});
