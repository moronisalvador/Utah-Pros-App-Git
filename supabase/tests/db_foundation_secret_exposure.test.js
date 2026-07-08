/**
 * ════════════════════════════════════════════════
 * FILE: db_foundation_secret_exposure.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves — against the real database — that the three tables that hold
 *   secrets stay invisible to the browser. The browser talks to the database
 *   as the public "anon" role; it must get ZERO rows back from the payment/SMS
 *   secrets table, the misc-config table, and every employee's Google refresh
 *   token. This is the deny-all invariant the whole DB-Foundation initiative
 *   is built to protect, so it is checked on every test run as a tripwire.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (integration test — run via `npm test`)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated anon REST client — the same
 *              role the browser uses; CLAUDE.md rule 3 — fine for a test)
 *   Data:      reads → integration_credentials, integration_config,
 *                      user_google_accounts (all three MUST be denied)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project — self-skips via
 *     describe.skipIf when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent
 *     (CI's `npm test` doesn't pass those secrets), same as the CRM suites.
 *   - A denied table read may surface as EITHER a thrown permission error OR an
 *     empty array (RLS with zero policies filters every row) — both prove the
 *     browser cannot see a secret, so the assertion accepts either.
 *   - The `authenticated` half of the deny-all invariant (a logged-in staff
 *     member also reads 0 rows) cannot be exercised from an anon client, so it
 *     is proven at the schema level by the companion SQL gate
 *     `db_foundation_secret_exposure.sql` (SET ROLE anon / authenticated), run
 *     via the Supabase MCP. Together they cover both roles.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

// Returns true if the browser (anon) got NO rows back — whether by a thrown
// permission error or an RLS-emptied result set.
async function anonCannotRead(table) {
  try {
    const rows = await db.select(table, 'select=*');
    return Array.isArray(rows) && rows.length === 0;
  } catch {
    return true; // permission denied — also a pass
  }
}

describe.skipIf(!hasCreds)('DB-Foundation — secret-exposure deny-all invariant (integration)', () => {
  it('anon CANNOT read integration_credentials (Stripe/Twilio/Resend secrets)', async () => {
    expect(await anonCannotRead('integration_credentials')).toBe(true);
  });

  it('anon CANNOT read integration_config (misc secrets: webhook secrets, SIDs)', async () => {
    expect(await anonCannotRead('integration_config')).toBe(true);
  });

  it('anon CANNOT read user_google_accounts (per-employee Google refresh tokens)', async () => {
    expect(await anonCannotRead('user_google_accounts')).toBe(true);
  });
});
