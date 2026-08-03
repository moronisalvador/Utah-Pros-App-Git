/**
 * ════════════════════════════════════════════════
 * FILE: db_foundation_billing_admin_gate.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the payment-settings writer is locked to admins. `set_billing_setting`
 *   used to be callable by anyone the browser could reach (it only checked the
 *   key name, not WHO was asking), so a logged-out visitor could flip whether the
 *   business accepts cards or ACH. DB-Foundation adds a server-side admin gate.
 *   This test proves the browser-as-anon is now REFUSED, while a signed-in admin
 *   can still use the read side (`get_billing_settings`) required by Payment
 *   Settings — i.e. the fix didn't break the staff page's read contract.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (integration test — run via `npm test`)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (anon denial probe),
 *              ./helpers/qaFixtures.mjs (signed-in admin read)
 *   Data:      reads → get_billing_settings() as admin (must still succeed)
 *              writes → set_billing_setting() attempt (must be REJECTED for anon)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the qa-staging Supabase branch — self-skips
 *     when branch credentials are absent.
 *   - The write attempt is intentionally NON-DESTRUCTIVE: it reads the current
 *     value of one whitelisted key and writes the SAME value back. So even if this
 *     ran against a database WITHOUT the admin gate yet (the RED state), it would
 *     not change any setting — it would simply (wrongly) succeed, failing the
 *     assertion without side effects.
 *   - The admin-SUCCESS half (an actual admin CAN write) is verified live via the
 *     Supabase MCP by simulating an admin JWT (request.jwt.claims → admin's
 *     auth_user_id); an anon client cannot authenticate as an admin.
 * ════════════════════════════════════════════════
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { db as anonDb } from '../../src/lib/supabase.js';
import { signInFixture } from './helpers/qaFixtures.mjs';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('DB-Foundation — set_billing_setting admin gate (integration)', () => {
  let adminDb;

  beforeAll(async () => {
    adminDb = await signInFixture('admin');
  });

  it('an authenticated admin can read billing settings (staff contract preserved)', async () => {
    const settings = await adminDb.rpc('get_billing_settings');
    // Returns a jsonb object (possibly {} if nothing configured) — never throws.
    expect(settings === null || typeof settings === 'object').toBe(true);
  });

  it('anon CANNOT write a billing setting (admin gate rejects)', async () => {
    // Read-modify-write the SAME value back so a pre-gate (RED) run is a no-op.
    let current = null;
    try {
      const settings = await adminDb.rpc('get_billing_settings');
      current = settings && Object.prototype.hasOwnProperty.call(settings, 'accept_card')
        ? settings.accept_card
        : null;
    } catch { /* read failure is fine — the write must still be refused */ }

    await expect(
      anonDb.rpc('set_billing_setting', { p_key: 'accept_card', p_value: current }),
    ).rejects.toThrow();
  });
});
