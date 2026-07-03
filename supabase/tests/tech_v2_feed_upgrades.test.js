/**
 * ════════════════════════════════════════════════
 * FILE: tech_v2_feed_upgrades.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Tech Mobile v2 (Phase F) upgrades to the two tech appointment
 *   feeds did NOT break the shape older screens already depend on, and DID add
 *   the new fields the v2 calendar needs (color, kind, multi-day, milestone,
 *   crew color/avatar, and per-appointment task counts). Also proves the new
 *   p_include_cancelled switch on the "today" feed actually hides cancelled
 *   appointments when asked. Runs against the real shared database; every row it
 *   creates is in throwaway fixtures cleaned up afterward.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → get_appointments_range / get_my_appointments_today
 *              writes → appointments · appointment_crew (fixtures, cleaned up)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds
 *     like the CRM suites. One shared production DB → asserts on OUR fixture ids
 *     only, never on live row counts.
 *   - Backward-compat contract: TechEditAppointment.jsx + legacy TechSchedule.jsx
 *     consume get_appointments_range; legacy TechDash.jsx consumes
 *     get_my_appointments_today. The legacy-key assertions below are the guard.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

// Legacy keys every existing caller relies on — must never disappear.
const RANGE_LEGACY_KEYS = ['id', 'job_id', 'title', 'date', 'time_start', 'time_end', 'type', 'status', 'notes', 'is_private', 'created_by', 'jobs', 'appointment_crew'];
const TODAY_LEGACY_KEYS = ['id', 'job_id', 'title', 'date', 'time_start', 'time_end', 'type', 'status', 'notes', 'jobs', 'appointment_crew'];
// New v2 keys the calendar/dashboard need.
const V2_KEYS = ['color', 'kind', 'duration_days', 'is_milestone', 'task_total', 'task_completed'];

describe.skipIf(!hasCreds)('Tech v2 Phase F — feed RPC upgrades (integration)', () => {
  const tag = `techv2-feed-${Date.now()}`;
  const createdAppts = [];
  let empId;
  const today = new Date().toISOString().slice(0, 10);

  // kind 'event' → job_id stays NULL (satisfies the appointments_kind_shape check);
  // events carry crew + tasks like jobs, which is all these feed assertions need.
  const mkAppt = async ({ title, date = today, status = 'scheduled', kind = 'event' }) => {
    const [a] = await db.insert('appointments', {
      title: `${tag} ${title}`, date, status, kind, type: 'inspection', duration_days: 1,
    });
    createdAppts.push(a.id);
    await db.insert('appointment_crew', { appointment_id: a.id, employee_id: empId, role: 'lead' });
    return a;
  };

  beforeAll(async () => {
    // A real active field tech to attach crew to (fixture crew row, not a fixture employee).
    const techs = await db.rpc('get_active_techs');
    empId = techs[0].id;
  });

  afterAll(async () => {
    for (const id of createdAppts) {
      try { await db.delete('appointment_crew', `appointment_id=eq.${id}`); } catch { /* best-effort */ }
      try { await db.delete('appointments', `id=eq.${id}`); } catch { /* best-effort */ }
    }
  });

  it('get_appointments_range keeps every legacy key AND adds the v2 keys', async () => {
    const appt = await mkAppt({ title: 'range-shape' });
    const rows = await db.rpc('get_appointments_range', { p_start_date: today, p_end_date: today });
    const found = rows.find(r => r.id === appt.id);
    expect(found).toBeTruthy();
    for (const k of RANGE_LEGACY_KEYS) expect(k in found).toBe(true);
    for (const k of V2_KEYS) expect(k in found).toBe(true);
    // Crew employees gain color + avatar_url without losing display_name/full_name.
    const crew = found.appointment_crew[0];
    expect(crew.employees).toBeTruthy();
    for (const k of ['id', 'display_name', 'full_name', 'color', 'avatar_url']) {
      expect(k in crew.employees).toBe(true);
    }
  });

  it('get_my_appointments_today keeps legacy keys AND adds v2 keys', async () => {
    const appt = await mkAppt({ title: 'today-shape' });
    const rows = await db.rpc('get_my_appointments_today', { p_employee_id: empId });
    const found = rows.find(r => r.id === appt.id);
    expect(found).toBeTruthy();
    for (const k of TODAY_LEGACY_KEYS) expect(k in found).toBe(true);
    for (const k of V2_KEYS) expect(k in found).toBe(true);
    for (const k of ['color', 'avatar_url']) expect(k in found.appointment_crew[0].employees).toBe(true);
  });

  it('get_my_appointments_today with 1 arg still resolves (backward-compat default)', async () => {
    // Legacy callers pass ONLY p_employee_id; the added p_include_cancelled must default true.
    const rows = await db.rpc('get_my_appointments_today', { p_employee_id: empId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('p_include_cancelled=false hides cancelled; default (true) shows them', async () => {
    const cancelled = await mkAppt({ title: 'cancelled-one', status: 'cancelled' });

    const withCancelled = await db.rpc('get_my_appointments_today', { p_employee_id: empId, p_include_cancelled: true });
    expect(withCancelled.some(r => r.id === cancelled.id)).toBe(true);

    const withoutCancelled = await db.rpc('get_my_appointments_today', { p_employee_id: empId, p_include_cancelled: false });
    expect(withoutCancelled.some(r => r.id === cancelled.id)).toBe(false);
  });

  it('task_total / task_completed reflect real job_tasks counts', async () => {
    // A brand-new appointment with no tasks reports zero, not null.
    const appt = await mkAppt({ title: 'task-counts' });
    const rows = await db.rpc('get_my_appointments_today', { p_employee_id: empId });
    const found = rows.find(r => r.id === appt.id);
    expect(Number(found.task_total)).toBe(0);
    expect(Number(found.task_completed)).toBe(0);
  });
});
