/**
 * ════════════════════════════════════════════════
 * FILE: notify_d_admin_defaults.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the admin "Notifications" defaults tools against the real shared
 *   database. Three things: (1) an admin can set a role-wide default for a
 *   notification (and asking for it back shows the new value), and leaving the
 *   "lock" unspecified keeps whatever lock was there before; (2) an admin can
 *   set and then clear a single employee's override; and (3) flipping the lock
 *   on a role default actually changes what the shared preference resolver
 *   returns for an employee in that role. Everything uses throwaway sentinel
 *   rows and deletes them afterward.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      notification_types (sentinel type '__dtest_type__', cascade-deleted
 *              on cleanup), notification_role_defaults / _employee_overrides /
 *              _prefs (written via the Session D RPCs; cascade-cleaned with the
 *              sentinel type). Reads through get_effective_notification_prefs
 *              (F2-owned resolver — asserted THROUGH, never re-implemented).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds
 *     like the other notify suites. Isolated by a sentinel type key, never asserts
 *     live counts.
 *   - The role-default rows are written against a REAL employee's role for the
 *     sentinel type only (enabled=false catalog default, cleaned up), so no real
 *     notification behavior changes.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const TEST_TYPE = '__dtest_type__';

describe.skipIf(!hasCreds)('Notify D admin defaults — role defaults + employee overrides + lock (integration)', () => {
  let empA, empRole;

  beforeAll(async () => {
    const emps = await db.select('employees', 'select=id,role&limit=1');
    empA = emps[0]?.id;
    empRole = emps[0]?.role;
    // Sentinel catalog type: every channel default OFF, master-switch off.
    await db.insert('notification_types', {
      type_key: TEST_TYPE, label: 'D test type', category: 'admin',
      bell_default: false, push_default: false, email_default: false, enabled: false, sort_order: 999,
    });
  });

  afterAll(async () => {
    // Cascade-cleans role_defaults / overrides / prefs on the sentinel type.
    try { await db.delete('notification_types', `type_key=eq.${TEST_TYPE}`); } catch { /* best-effort */ }
  });

  // ─── 1. Role-default upsert round-trip (+ NULL lock = leave unchanged) ───
  it('set_notification_default upserts a role default and get_notification_defaults reflects it', async () => {
    if (!empRole) return;
    await db.rpc('set_notification_default', {
      p_role: empRole, p_type_key: TEST_TYPE, p_channel: 'push', p_enabled: true,
    });

    const find = async () => {
      const rows = await db.rpc('get_notification_defaults');
      return rows.find(r => r.role === empRole && r.type_key === TEST_TYPE && r.channel === 'push');
    };

    let row = await find();
    expect(row).toBeTruthy();
    expect(row.enabled).toBe(true);
    expect(row.user_customizable).toBe(true); // new row defaults to customizable
    expect(row.has_default).toBe(true);

    // Re-set enabled=false with p_user_customizable NULL → lock stays as it was.
    await db.rpc('set_notification_default', {
      p_role: empRole, p_type_key: TEST_TYPE, p_channel: 'push', p_enabled: false,
      p_user_customizable: null,
    });
    row = await find();
    expect(row.enabled).toBe(false);
    expect(row.user_customizable).toBe(true); // unchanged by the NULL

    // Explicitly lock it.
    await db.rpc('set_notification_default', {
      p_role: empRole, p_type_key: TEST_TYPE, p_channel: 'push', p_enabled: false,
      p_user_customizable: false,
    });
    row = await find();
    expect(row.user_customizable).toBe(false);
  });

  // ─── 2. Per-employee override set / delete round-trip ───
  it('set_employee_notification_override then delete round-trips', async () => {
    if (!empA) return;
    await db.rpc('set_employee_notification_override', {
      p_employee_id: empA, p_type_key: TEST_TYPE, p_channel: 'bell', p_enabled: true,
    });

    const findOv = async () => {
      const rows = await db.rpc('get_employee_notification_overrides', { p_employee_id: empA });
      return rows.find(r => r.type_key === TEST_TYPE && r.channel === 'bell');
    };

    let row = await findOv();
    expect(row.has_override).toBe(true);
    expect(row.override_enabled).toBe(true);
    expect(row.effective).toBe(true); // override drives the effective value

    await db.rpc('delete_employee_notification_override', {
      p_employee_id: empA, p_type_key: TEST_TYPE, p_channel: 'bell',
    });
    row = await findOv();
    expect(row.has_override).toBe(false);
  });

  // ─── 3. Lock flip changes what the F2 resolver returns ───
  it('a user_customizable lock flip changes get_effective_notification_prefs for an affected employee', async () => {
    if (!empA || !empRole) return;
    const CH = 'email';

    const eff = async () => {
      const rows = await db.rpc('get_effective_notification_prefs', { p_employee_id: empA });
      return rows.find(r => r.type_key === TEST_TYPE && r.channel === CH);
    };

    // Role default OFF, customizable; the employee's own pref ON → resolver = ON.
    await db.rpc('set_notification_default', {
      p_role: empRole, p_type_key: TEST_TYPE, p_channel: CH, p_enabled: false,
      p_user_customizable: true,
    });
    await db.insert('notification_prefs', {
      employee_id: empA, type_key: TEST_TYPE, channel: CH, enabled: true,
    });
    let r = await eff();
    expect(r.enabled).toBe(true);
    expect(r.user_customizable).toBe(true);

    // Lock the role default → the my-pref is ignored, role default (OFF) wins.
    await db.rpc('set_notification_default', {
      p_role: empRole, p_type_key: TEST_TYPE, p_channel: CH, p_enabled: false,
      p_user_customizable: false,
    });
    r = await eff();
    expect(r.enabled).toBe(false);
    expect(r.user_customizable).toBe(false);
  });
});
