/**
 * ════════════════════════════════════════════════
 * FILE: tech_v2_dashboard.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Exercises get_tech_dashboard — the one-round-trip feed behind the v2 tech
 *   dashboard. Proves it returns the whole payload shape (today's visits, my next
 *   7 days, the open clock entry, hours today/this week split into travel vs
 *   on-site, and photos-today) and, most importantly, that the HOURS MATH is
 *   right: it SUMS the stored hours column plus stored travel minutes (never
 *   recomputes closed entries from timestamps — that would corrupt manual and
 *   admin-edited rows), and adds a live-elapsed term only for the single open
 *   entry. Uses a delta approach (measure, insert known fixtures, re-measure) so
 *   it is immune to other rows on the shared database.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → get_tech_dashboard · writes → job_time_entries (fixtures)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds.
 *   - Hours math contract (docs/tech-v2-roadmap.md, Architecture decision #8):
 *     on_site = SUM(stored hours) + live term; travel = SUM(travel_minutes)/60;
 *     total = travel + on_site. Week = Monday-start in America/Denver (payroll
 *     parity). Never writes total_cost (generated column).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

// Denver calendar day (the day-boundary get_tech_dashboard filters by).
const denverToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());

describe.skipIf(!hasCreds)('Tech v2 Phase F — get_tech_dashboard (integration)', () => {
  const createdEntries = [];
  let empId, jobId;

  const mkEntry = async (fields) => {
    const [row] = await db.insert('job_time_entries', {
      job_id: jobId, employee_id: empId, work_date: denverToday(), work_type: 'field', ...fields,
    });
    createdEntries.push(row.id);
    return row;
  };

  beforeAll(async () => {
    const techs = await db.rpc('get_active_techs');
    empId = techs[0].id;
    const [job] = await db.select('jobs', 'select=id&limit=1');
    jobId = job.id;
  });

  afterAll(async () => {
    for (const id of createdEntries) {
      try { await db.delete('job_time_entries', `id=eq.${id}`); } catch { /* best-effort */ }
    }
  });

  it('returns the full payload shape', async () => {
    const d = await db.rpc('get_tech_dashboard', { p_employee_id: empId });
    for (const k of ['server_now', 'today', 'week_start', 'appointments', 'upcoming', 'open_entry', 'hours_today', 'hours_week', 'photos_today']) {
      expect(k in d).toBe(true);
    }
    for (const k of ['travel', 'on_site', 'total']) {
      expect(k in d.hours_today).toBe(true);
      expect(k in d.hours_week).toBe(true);
    }
    // total is always travel + on_site (labeled breakdown the UI shows).
    expect(Number(d.hours_today.total)).toBeCloseTo(Number(d.hours_today.travel) + Number(d.hours_today.on_site), 5);
    // Today's feed excludes cancelled.
    expect(Array.isArray(d.appointments)).toBe(true);
    expect(d.appointments.every(a => a.status !== 'cancelled')).toBe(true);
  });

  it('sums STORED hours + travel_minutes for closed entries (no timestamp recompute)', async () => {
    const before = await db.rpc('get_tech_dashboard', { p_employee_id: empId });
    // A closed manual row: stored hours=2.5, travel=30min, and DELIBERATELY no
    // clock_in/clock_out — a timestamp recompute would read this as 0.
    await mkEntry({ hours: 2.5, travel_minutes: 30, clock_out: new Date().toISOString() });
    const after = await db.rpc('get_tech_dashboard', { p_employee_id: empId });

    expect(Number(after.hours_today.on_site) - Number(before.hours_today.on_site)).toBeCloseTo(2.5, 2);
    expect(Number(after.hours_today.travel) - Number(before.hours_today.travel)).toBeCloseTo(0.5, 2);
    // Week bucket includes today, so it moves by the same amount.
    expect(Number(after.hours_week.on_site) - Number(before.hours_week.on_site)).toBeCloseTo(2.5, 2);
  });

  it('adds a live-elapsed on-site term for the single OPEN entry (stored hours still 0)', async () => {
    const before = await db.rpc('get_tech_dashboard', { p_employee_id: empId });
    // Open entry: clocked in ~1h ago, not finished → stored hours 0, live term ~1h.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await mkEntry({ hours: 0, clock_in: oneHourAgo }); // clock_out omitted → open
    const after = await db.rpc('get_tech_dashboard', { p_employee_id: empId });

    const delta = Number(after.hours_today.on_site) - Number(before.hours_today.on_site);
    expect(delta).toBeGreaterThan(0.9);
    expect(delta).toBeLessThan(1.2);
    // The open entry is surfaced.
    expect(after.open_entry).toBeTruthy();
  });
});
