/**
 * ════════════════════════════════════════════════
 * FILE: qaFixtures.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets database tests sign in as one of the standing QA fixture people on the
 *   qa-staging branch (seeded by scripts/qa/seed-branch-fixtures.sql) and call
 *   database functions as that signed-in person — the way the real app does —
 *   instead of calling anonymously, which the hardened permissions correctly
 *   refuse.
 *
 * DEPENDS ON:
 *   Packages:  none (fetch built-in)
 *   Internal:  scripts/qa/seed-branch-fixtures.sql (the identities this signs in as)
 *   Data:      reads  → auth token endpoint on the target Supabase
 *              writes → none (callers write through their own RPCs)
 *
 * NOTES / GOTCHAS:
 *   - The QA-only password is injected through UPR_QA_FIXTURE_PASSWORD; it is
 *     never committed. If these accounts exist in production, that is an incident.
 *   - Not a *.test.js file, so the vitest db lane does not collect it as a suite.
 *   - Reads the target from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, which the
 *     branch runner injects; suites keep their describe.skipIf(!hasCreds) guard.
 * ════════════════════════════════════════════════
 */

export const QA_FIXTURES = {
  admin: { email: 'qa-admin@upr-qa.test', employeeId: 'aaaaaaaa-0000-4000-8000-000000000101' },
  office: { email: 'qa-office@upr-qa.test', employeeId: 'aaaaaaaa-0000-4000-8000-000000000102' },
  tech: { email: 'qa-tech@upr-qa.test', employeeId: 'aaaaaaaa-0000-4000-8000-000000000103' },
};
export const QA_FIXTURE_PASSWORD = globalThis.process?.env?.UPR_QA_FIXTURE_PASSWORD || '';

const url = () => process.env.VITE_SUPABASE_URL || import.meta.env?.VITE_SUPABASE_URL;
const anonKey = () => process.env.VITE_SUPABASE_ANON_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY;

/**
 * Sign in as a fixture (`'admin' | 'office' | 'tech'`) and get an rpc caller
 * bound to that session. Throws with the auth error body on failure.
 */
export async function signInFixture(who = 'admin') {
  const fixture = QA_FIXTURES[who];
  if (!fixture) throw new Error(`unknown fixture ${who}`);
  if (!QA_FIXTURE_PASSWORD) {
    throw new Error('fixture sign-in refused: UPR_QA_FIXTURE_PASSWORD is not configured');
  }
  const res = await fetch(`${url()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fixture.email, password: QA_FIXTURE_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`fixture sign-in failed (${who}): ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  const token = body.access_token;

  async function rpc(fn, params = {}) {
    const r = await fetch(`${url()}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anonKey(),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const err = new Error(`RPC ${fn}: ${r.status} ${text}`);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  return { token, fixture, rpc };
}
