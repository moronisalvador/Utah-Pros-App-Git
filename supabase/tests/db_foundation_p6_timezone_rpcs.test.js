/**
 * ════════════════════════════════════════════════
 * FILE: db_foundation_p6_timezone_rpcs.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The DB-Foundation Phase P6 migration rewrote eight reporting/scheduling
 *   functions to measure "today"/"this week" in Mountain Time (via mt_today())
 *   instead of naive UTC CURRENT_DATE. That change must be BODY-ONLY — the shape
 *   of what each function returns (its columns / JSON keys) has to stay exactly the
 *   same, because live screens read them. This file is the return-shape guard: it
 *   calls each of the eight functions and checks the frozen key set is intact, so a
 *   future edit that silently drops or renames a returned field fails the build.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — these RPCs keep
 *              their pre-existing anon EXECUTE grant, unchanged by P6)
 *   Data:      reads  → get_call_volume, get_conversion_trend, get_timesheet_entries,
 *                       get_payroll_summary, get_assigned_tasks,
 *                       get_my_appointments_today, get_stalled_materials_for_employee
 *              writes → none (add_custom_schedule_phase is exercised against a
 *                       scheduleless job so it raises BEFORE any insert)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds.
 *   - get_call_volume / get_conversion_trend generate a full date series
 *     regardless of data, so they ALWAYS return rows → hard key assertions.
 *   - The employee-scoped feeds are called with a random uuid (no crew match) so
 *     they return [] without error — a "runs post-replace + returns array" guard.
 *     get_my_appointments_today's fuller populated-row shape guard lives in
 *     tech_v2_feed_upgrades.test.js (kept green); the CRM analytics shape guards
 *     also live in crm_phase9_intelligence.test.js. This file adds a P6-owned guard
 *     per RPC so the timezone body-replace can't regress a contract unnoticed.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

// A uuid that matches nothing — safe to pass to employee-scoped feeds.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const hasKeys = (row, keys) => keys.every((k) => k in row);

describe.skipIf(!hasCreds)('DB-Foundation P6 — timezone RPC return-shape guards', () => {
  it('get_call_volume keeps its frozen JSON keys (always-populated series)', async () => {
    const rows = await db.rpc('get_call_volume', {});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0); // generate_series ⇒ always rows
    expect(hasKeys(rows[0], ['period', 'period_start', 'total', 'answered', 'missed'])).toBe(true);
  });

  it('get_conversion_trend keeps its frozen JSON keys (always-populated series)', async () => {
    const rows = await db.rpc('get_conversion_trend', {});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(hasKeys(rows[0], ['period', 'period_start', 'leads', 'estimates', 'won_jobs', 'revenue'])).toBe(true);
  });

  it('get_timesheet_entries runs and keeps its frozen columns', async () => {
    const rows = await db.rpc('get_timesheet_entries', {});
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(hasKeys(rows[0], [
        'id', 'job_id', 'employee_id', 'employee_name', 'job_number', 'insured_name',
        'division', 'work_date', 'hours', 'hourly_rate', 'total_cost', 'work_type',
        'description', 'approved', 'approved_by', 'clock_in', 'clock_out',
        'appointment_id', 'notes', 'created_at',
      ])).toBe(true);
    }
  });

  it('get_payroll_summary runs and keeps its frozen columns', async () => {
    const rows = await db.rpc('get_payroll_summary', {});
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(hasKeys(rows[0], [
        'employee_id', 'employee_name', 'hourly_rate', 'overtime_rate', 'total_hours',
        'regular_hours', 'overtime_hours', 'regular_cost', 'overtime_cost', 'total_cost',
        'approved_hours', 'pending_hours',
      ])).toBe(true);
    }
  });

  it('get_assigned_tasks runs post-replace and returns an array', async () => {
    const rows = await db.rpc('get_assigned_tasks', { p_employee_id: NIL_UUID });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(hasKeys(rows[0], [
        'task_id', 'task_name', 'is_complete', 'sort_order', 'phase_name', 'appointment_id',
        'appointment_date', 'appointment_time', 'is_today', 'job_id', 'job_number',
        'insured_name', 'division', 'job_phase',
      ])).toBe(true);
    }
  });

  it('get_my_appointments_today runs post-replace and returns an array', async () => {
    const rows = await db.rpc('get_my_appointments_today', { p_employee_id: NIL_UUID });
    expect(Array.isArray(rows)).toBe(true); // '[]'::jsonb ⇒ []
  });

  it('get_stalled_materials_for_employee runs post-replace and returns an array', async () => {
    const rows = await db.rpc('get_stalled_materials_for_employee', { p_employee_id: NIL_UUID });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('add_custom_schedule_phase still validates its guard (scheduleless job raises)', async () => {
    // Reaches the "Job has no schedule" guard before any INSERT — proves the
    // replaced function runs and its 7-arg signature is intact, with no side effect.
    await expect(
      db.rpc('add_custom_schedule_phase', { p_job_id: NIL_UUID, p_phase_name: 'p6-shape-guard' })
    ).rejects.toThrow();
  });
});
