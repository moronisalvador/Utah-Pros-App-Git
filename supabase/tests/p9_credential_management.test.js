/**
 * ════════════════════════════════════════════════
 * FILE: p9_credential_management.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves — against the real database — that the payment/SMS/email secrets moved
 *   into the app in Phase P9 stay locked down. The browser (which talks to the DB
 *   as the public "anon" role) must NOT be able to read the secrets table, the
 *   connection-status function must NEVER hand back a token, and a non-admin must
 *   NOT be able to write a key. These are P9's three security acceptance criteria.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (integration test — run via `npm test`)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated anon REST client — the same
 *              role the browser uses; see CLAUDE.md rule 3 — fine for a test)
 *   Data:      reads → integration_credentials, integration_config (must be denied),
 *                      get_managed_credentials_status() (booleans only)
 *              writes → none (the write attempt MUST be rejected)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project — self-skips via
 *     describe.skipIf when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent
 *     (CI's `npm test` doesn't pass those secrets), same as the CRM suites.
 *   - A denied table read may surface as EITHER a thrown permission error OR an
 *     empty array (RLS with zero policies filters every row) — both prove the
 *     browser cannot see a secret, so the assertion accepts either.
 *   - Writes nothing that persists: the set-secret attempt is expected to be
 *     rejected, so there is no cleanup.
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

describe.skipIf(!hasCreds)('P9 credential management — security posture (integration)', () => {
  it('the browser (anon) CANNOT read the secrets table', async () => {
    expect(await anonCannotRead('integration_credentials')).toBe(true);
  });

  it('the browser (anon) CANNOT read the integration_config table', async () => {
    expect(await anonCannotRead('integration_config')).toBe(true);
  });

  it('the browser (anon) CANNOT even call the status RPC — no token, no enumeration', async () => {
    // get_managed_credentials_status is granted to `authenticated` only, so an
    // unauthenticated caller is rejected outright — the strongest never-echo
    // guarantee for the browser-as-anon. The authenticated path's shape (booleans
    // only, never a token — the SELECT list has no token by construction) is
    // guaranteed structurally and verified live via the admin round-trip in MCP.
    await expect(db.rpc('get_managed_credentials_status')).rejects.toThrow();
  });

  it('a non-admin (anon) CANNOT write a secret', async () => {
    // set_integration_secret is granted to `authenticated` and re-checks admin via
    // auth.uid() inside — an anon call must be rejected, not silently accepted.
    await expect(
      db.rpc('set_integration_secret', { p_provider: 'stripe', p_secret: 'sk_should_be_rejected' }),
    ).rejects.toThrow();
  });
});
