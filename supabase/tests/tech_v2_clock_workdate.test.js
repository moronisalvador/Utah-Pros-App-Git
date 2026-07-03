/**
 * ════════════════════════════════════════════════
 * FILE: tech_v2_clock_workdate.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Phase F fix to clock_appointment_action: when a tech taps "On My
 *   Way", the day the time is filed under (work_date) is the Utah calendar day,
 *   not the UTC day. Before the fix, an evening clock-in (6pm+ Mountain) landed on
 *   TOMORROW's work_date because the code used the UTC date — which misdates
 *   payroll. This test creates a throwaway appointment, fires the OMW action, and
 *   asserts the entry's work_date equals the Denver calendar date.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads/writes → appointments, appointment_crew, job_time_entries
 *              (all throwaway fixtures, cleaned up)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds.
 *   - Same-signature body-only REPLACE: v_now::DATE → (v_now AT TIME ZONE
 *     'America/Denver')::DATE at the OMW insert. See
 *     docs/tech-v2-roadmap.md Finding #3.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

const denverToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());

describe.skipIf(!hasCreds)('Tech v2 Phase F — clock_appointment_action work_date Denver stamp (integration)', () => {
  const tag = `techv2-clock-${Date.now()}`;
  let empId, apptId;
  const createdEntries = [];

  beforeAll(async () => {
    const techs = await db.rpc('get_active_techs');
    empId = techs[0].id;
    // OMW writes a job_time_entries row (job_id NOT NULL), so the appointment must
    // be kind 'job' with a real job attached.
    const [job] = await db.select('jobs', 'select=id&limit=1');
    const [a] = await db.insert('appointments', {
      title: `${tag} omw`, date: denverToday(), status: 'scheduled', kind: 'job', job_id: job.id, type: 'inspection', duration_days: 1,
    });
    apptId = a.id;
    await db.insert('appointment_crew', { appointment_id: apptId, employee_id: empId, role: 'lead' });
  });

  afterAll(async () => {
    for (const id of createdEntries) {
      try { await db.delete('job_time_entries', `id=eq.${id}`); } catch { /* best-effort */ }
    }
    try { await db.delete('appointment_crew', `appointment_id=eq.${apptId}`); } catch { /* best-effort */ }
    try { await db.delete('appointments', `id=eq.${apptId}`); } catch { /* best-effort */ }
  });

  it('OMW stamps work_date with the Denver calendar date', async () => {
    const rows = await db.rpc('clock_appointment_action', {
      p_appointment_id: apptId, p_employee_id: empId, p_action: 'omw',
    });
    const entry = Array.isArray(rows) ? rows[0] : rows;
    createdEntries.push(entry.id);
    expect(entry.work_date).toBe(denverToday());
  });
});
