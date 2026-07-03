/**
 * ════════════════════════════════════════════════
 * FILE: notify_foundation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Exercises the Phase F2 notification foundation against the real shared
 *   database. Three things: (1) the OLD notification-bell call shapes still work
 *   after the RPCs were rebuilt to take a recipient (no "ambiguous function"
 *   error); (2) a notification aimed at one employee is invisible to another,
 *   while a broadcast (no recipient) stays visible to everyone; and (3) the
 *   preference resolver applies role default → admin override → the person's own
 *   choice, and a locked setting beats the person's choice. Everything uses
 *   sentinel rows and cleans up after itself.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      notifications (via create_notification / get_notifications; test
 *              rows use type='__f2test__' and are deleted via the narrow
 *              test-row DELETE policy), notification_types / _role_defaults /
 *              _employee_overrides / _prefs (sentinel type '__f2test_type__',
 *              cascade-deleted on cleanup).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds
 *     like the CRM suites. Isolated by sentinel keys, never asserts live counts.
 *   - mark_all is exercised only against a throwaway recipient id (a no-op on real
 *     data) so the suite never clears anyone's real unread bell.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const TEST_TYPE = '__f2test_type__';

describe.skipIf(!hasCreds)('Notify F2 foundation — bell cutover + targeting + resolver (integration)', () => {
  let empA, empB, empRole;

  beforeAll(async () => {
    const emps = await db.select('employees', 'select=id,role&limit=2');
    empA = emps[0]?.id;
    empB = emps[1]?.id;
    empRole = emps[0]?.role;
  });

  afterAll(async () => {
    // Cascade-cleans role_defaults / overrides / prefs on the sentinel type.
    try { await db.delete('notification_types', `type_key=eq.${TEST_TYPE}`); } catch { /* best-effort */ }
    try { await db.delete('notifications', 'type=eq.__f2test__'); } catch { /* best-effort */ }
  });

  // ─── 1. Old bell call shapes still resolve (no overload ambiguity) ───
  it('get_notifications({}) and ({p_limit}) still succeed post-cutover', async () => {
    const a = await db.rpc('get_notifications', {});
    const b = await db.rpc('get_notifications', { p_limit: 30 });
    expect(Array.isArray(a)).toBe(true);
    expect(Array.isArray(b)).toBe(true);
  });

  it('get_unread_notification_count works with the old ({}) and new ({p_employee_id}) shapes', async () => {
    const n0 = await db.rpc('get_unread_notification_count', {});
    const n1 = await db.rpc('get_unread_notification_count', { p_employee_id: empA });
    expect(typeof n0).toBe('number');
    expect(typeof n1).toBe('number');
  });

  it('mark_all_notifications_read accepts p_employee_id (no-op against a throwaway id)', async () => {
    // 00000000-… is a real uuid that matches no recipient → clears nothing real.
    const r = await db.rpc('mark_all_notifications_read', { p_employee_id: '00000000-0000-0000-0000-000000000000' });
    expect(r === null || r === undefined).toBe(true);
  });

  // ─── 2. Per-recipient targeting ───
  it('a targeted row is invisible to other employees; broadcast stays visible to all', async () => {
    if (!empA || !empB) return; // need two employees
    const bcast = await db.rpc('create_notification', { p_type: '__f2test__', p_title: 'bcast' });
    const toA = await db.rpc('create_notification', { p_type: '__f2test__', p_title: 'toA', p_recipient_id: empA });
    const toB = await db.rpc('create_notification', { p_type: '__f2test__', p_title: 'toB', p_recipient_id: empB });

    const listA = await db.rpc('get_notifications', { p_limit: 100, p_employee_id: empA });
    const idsA = listA.map(r => r.id);
    expect(idsA).toContain(bcast.id);   // broadcast visible
    expect(idsA).toContain(toA.id);     // own targeted visible
    expect(idsA).not.toContain(toB.id); // other's targeted hidden

    const listBroadcast = await db.rpc('get_notifications', { p_limit: 100 }); // p_employee_id NULL
    const idsBc = listBroadcast.map(r => r.id);
    expect(idsBc).toContain(bcast.id);
    expect(idsBc).not.toContain(toA.id);
    expect(idsBc).not.toContain(toB.id);
  });

  // ─── 3. Resolver precedence (role default → override → my-pref, lock wins) ───
  it('get_effective_notification_prefs applies the three layers with the lock winning', async () => {
    if (!empA || !empRole) return;
    const CH = 'bell';
    const eff = async () => {
      const rows = await db.rpc('get_effective_notification_prefs', { p_employee_id: empA });
      return rows.find(r => r.type_key === TEST_TYPE && r.channel === CH);
    };

    // Sentinel type, all channel defaults OFF → base effective = false.
    await db.insert('notification_types', {
      type_key: TEST_TYPE, label: 'F2 test type', category: 'admin',
      bell_default: false, push_default: false, email_default: false, enabled: false, sort_order: 999,
    });
    expect((await eff()).enabled).toBe(false);

    // Layer 1 — role default ON, customizable.
    await db.insert('notification_role_defaults', {
      role: empRole, type_key: TEST_TYPE, channel: CH, enabled: true, user_customizable: true,
    });
    expect((await eff()).enabled).toBe(true);

    // Layer 2 — admin per-employee override OFF beats the role default.
    await db.insert('notification_employee_overrides', {
      employee_id: empA, type_key: TEST_TYPE, channel: CH, enabled: false,
    });
    expect((await eff()).enabled).toBe(false);

    // Layer 3 — the employee's own pref ON beats the override (still customizable).
    await db.insert('notification_prefs', {
      employee_id: empA, type_key: TEST_TYPE, channel: CH, enabled: true,
    });
    let r = await eff();
    expect(r.enabled).toBe(true);
    expect(r.user_customizable).toBe(true);

    // Lock it — user_customizable=false → my-pref ignored, override value (false) wins.
    await db.update('notification_role_defaults',
      `role=eq.${empRole}&type_key=eq.${TEST_TYPE}&channel=eq.${CH}`,
      { user_customizable: false });
    r = await eff();
    expect(r.enabled).toBe(false);
    expect(r.user_customizable).toBe(false);
  });
});
