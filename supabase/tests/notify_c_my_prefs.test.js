/**
 * ════════════════════════════════════════════════
 * FILE: notify_c_my_prefs.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the three Session C "my notification preferences" database functions
 *   behave correctly. Three things: (1) when someone turns a preference on or off
 *   it round-trips — saving it and then reading it back shows the new value;
 *   (2) if an administrator has LOCKED a preference (marked it not-customizable),
 *   the save is refused with an error instead of silently changing it; and
 *   (3) the list of a person's registered push devices never exposes the secret
 *   send keys (endpoint / p256dh / auth) — only a friendly label, when it was
 *   added, and a short non-reversible hash. Everything uses a throwaway sentinel
 *   notification type and cleans up after itself.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (integration test, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      notification_types / notification_role_defaults / notification_prefs
 *              (sentinel type '__c_test_type__', cascade-deleted on cleanup);
 *              push_subscriptions (read attempt only, via get_my_push_subscriptions).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds
 *     like the other notify/CRM suites. Isolated by a sentinel type key; never
 *     asserts live counts.
 *   - set_my_notification_pref resolves the customizable-lock from the caller's
 *     ROLE default, so the test seeds a role default for the fixture employee's
 *     own role, then flips its user_customizable to prove the write is rejected.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const TEST_TYPE = '__c_test_type__';
const CH = 'push';

describe.skipIf(!hasCreds)('Notify C — my-prefs stub fills (integration)', () => {
  let empId, empRole;

  beforeAll(async () => {
    const emps = await db.select('employees', 'select=id,role&limit=1');
    empId = emps[0]?.id;
    empRole = emps[0]?.role;
    // Sentinel type, enabled so it surfaces in get_my_notification_prefs.
    await db.insert('notification_types', {
      type_key: TEST_TYPE, label: 'C test type', category: 'admin',
      bell_default: false, push_default: false, email_default: false,
      enabled: true, sort_order: 998,
    });
  });

  afterAll(async () => {
    // Cascade-cleans role_defaults / prefs on the sentinel type.
    try { await db.delete('notification_types', `type_key=eq.${TEST_TYPE}`); } catch { /* best-effort */ }
  });

  // ─── 1. my-pref upsert round-trips through the resolver ───
  it('set_my_notification_pref saves and get_my_notification_prefs reads it back', async () => {
    if (!empId) return;
    const row = await db.rpc('set_my_notification_pref', {
      p_employee_id: empId, p_type_key: TEST_TYPE, p_channel: CH, p_enabled: true,
    });
    expect(row).toBeTruthy();
    expect(row.enabled).toBe(true);

    const prefs = await db.rpc('get_my_notification_prefs', { p_employee_id: empId });
    const cell = prefs.find(r => r.type_key === TEST_TYPE && r.channel === CH);
    expect(cell).toBeTruthy();
    expect(cell.enabled).toBe(true);
    expect(cell.user_customizable).toBe(true);

    // Toggle back off — the upsert path (ON CONFLICT) also round-trips.
    const off = await db.rpc('set_my_notification_pref', {
      p_employee_id: empId, p_type_key: TEST_TYPE, p_channel: CH, p_enabled: false,
    });
    expect(off.enabled).toBe(false);
  });

  // ─── 2. a locked (user_customizable=false) row rejects the write ───
  it('set_my_notification_pref throws when the role default locks the cell', async () => {
    if (!empId || !empRole) return;
    // Seed a locked role default for this employee's own role.
    await db.insert('notification_role_defaults', {
      role: empRole, type_key: TEST_TYPE, channel: CH,
      enabled: false, user_customizable: false,
    });
    await expect(db.rpc('set_my_notification_pref', {
      p_employee_id: empId, p_type_key: TEST_TYPE, p_channel: CH, p_enabled: true,
    })).rejects.toBeTruthy();

    // Un-lock → the write succeeds again (proves the lock, not a blanket failure).
    await db.update('notification_role_defaults',
      `role=eq.${empRole}&type_key=eq.${TEST_TYPE}&channel=eq.${CH}`,
      { user_customizable: true });
    const row = await db.rpc('set_my_notification_pref', {
      p_employee_id: empId, p_type_key: TEST_TYPE, p_channel: CH, p_enabled: true,
    });
    expect(row.enabled).toBe(true);
  });

  // ─── 3. get_my_push_subscriptions never leaks the send-capability secrets ───
  it('get_my_push_subscriptions returns no endpoint / p256dh / auth', async () => {
    if (!empId) return;
    const subs = await db.rpc('get_my_push_subscriptions', { p_employee_id: empId });
    expect(Array.isArray(subs)).toBe(true);
    for (const s of subs) {
      const keys = Object.keys(s);
      expect(keys).not.toContain('endpoint');
      expect(keys).not.toContain('p256dh');
      expect(keys).not.toContain('auth');
      // The hash is present, short, and not the raw endpoint.
      expect(typeof s.endpoint_hash).toBe('string');
      expect(s.endpoint_hash.length).toBeLessThanOrEqual(32);
      expect(s.endpoint_hash.startsWith('http')).toBe(false);
    }
  });
});
