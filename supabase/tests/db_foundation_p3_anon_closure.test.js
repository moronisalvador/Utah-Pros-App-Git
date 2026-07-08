/**
 * ════════════════════════════════════════════════
 * FILE: db_foundation_p3_anon_closure.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   DB-Foundation Phase P3 revokes the anonymous (logged-out) browser role's
 *   access to almost everything. These tests are the safety net: they prove the
 *   FIVE surfaces a logged-out visitor is still allowed to use keep working after
 *   the closure — login/session bootstrap, set-password, the e-sign signing page,
 *   the public /status page, and public form submission — and that the new
 *   token-gated template read behaves. A second (opt-in) block verifies the
 *   closure itself once the RED revoke migrations are applied.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (the unauthenticated anon REST client — the
 *              exact client SignPage.jsx / Status.jsx use for public calls)
 *   Data:      reads  → sign_requests + document_templates (via
 *                       get_sign_request_by_token / get_sign_document_templates),
 *                       crm_build_phases/stages (via get_crm_build_progress),
 *                       feature_flags (via get_feature_flags), employees
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project (an anon GRANT
 *     can't be proven as a pure unit test). Needs real VITE_SUPABASE_URL /
 *     VITE_SUPABASE_ANON_KEY; self-skips otherwise so CI (`npm test`, no DB
 *     secrets) stays green.
 *   - login + set-password use Supabase GoTrue (/auth/v1), which is a SEPARATE
 *     surface from PostgREST table/RPC grants and is therefore UNAFFECTED by the
 *     anon closure. We assert the *session-bootstrap reads* those flows depend on
 *     (feature flags, employee lookup) stay anon-reachable per database-standard §2.
 *   - public form submit runs entirely in a service-role worker
 *     (functions/api/form-submit.js) — there is no anon browser call to guard;
 *     we assert the allowlisted upsert_lead_from_form RPC stays anon-callable as a
 *     belt-and-suspenders regression guard for the §2 allowlist.
 *   - The CLOSURE block is opt-in (RUN_P3_CLOSURE=1): the revokes are RED-tier and
 *     apply in the owner's window, so before they land these assertions would fail.
 *     After the owner applies the revokes, run `RUN_P3_CLOSURE=1 npm test` to verify.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const runClosure = hasCreds && (import.meta.env.RUN_P3_CLOSURE === '1' || process.env?.RUN_P3_CLOSURE === '1');

// A random UUID that is not a real signing token — used to prove token-gating.
const BOGUS_TOKEN = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!hasCreds)('P3 — allowlisted unauthenticated surfaces stay reachable', () => {
  // ── Surface: public /status ──
  it('/status: get_crm_build_progress is anon-callable', async () => {
    const progress = await db.rpc('get_crm_build_progress');
    expect(Array.isArray(progress.phases)).toBe(true);
    expect(progress.phases.length).toBeGreaterThan(0);
  });

  // ── Surface: login + set-password (GoTrue /auth/v1 — separate from PostgREST grants) ──
  it('login/set-password: the GoTrue auth endpoint stays reachable with the anon key', async () => {
    // login (signInWithPassword) and set-password (updateUser/recovery) both run
    // against Supabase GoTrue, which authenticates with the anon apikey and is
    // UNAFFECTED by revoking anon's table/RPC grants. This proves the anon key
    // still functions for auth after the closure.
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    });
    expect(res.ok).toBe(true);
  });

  // ── Surface: login / session bootstrap ──
  it('login bootstrap: get_feature_flags is anon-callable', async () => {
    const flags = await db.rpc('get_feature_flags');
    expect(Array.isArray(flags)).toBe(true);
  });

  it('login bootstrap: employees lookup is anon-readable (devLogin path)', async () => {
    // Kept per database-standard §2 ("employee lookup"); dev devLogin reads this
    // via the anon key against the shared project.
    const rows = await db.select('employees', 'select=id,email,role&limit=1');
    expect(Array.isArray(rows)).toBe(true);
  });

  // ── Surface: public form submit (worker path; RPC stays allowlisted) ──
  it('form submit: upsert_lead_from_form is still anon-callable (allowlisted)', async () => {
    // Do NOT actually insert a lead — just prove anon is not 403'd at the grant
    // layer. A validation error from the function body still means "reachable".
    let reachable = true;
    try {
      await db.rpc('upsert_lead_from_form', {
        p_form_id: BOGUS_TOKEN,
        p_submission_token: 'p3-regression-probe',
        p_data: {},
      });
    } catch (e) {
      // A 403 "permission denied for function" means the anon grant was revoked
      // (regression). Any other error (bad form id, validation) means it is reachable.
      if (/permission denied/i.test(String(e.message))) reachable = false;
    }
    expect(reachable).toBe(true);
  });

  // ── Surface: e-sign SignPage ──
  it('e-sign: get_sign_request_by_token is anon-callable', async () => {
    // A non-existent token returns null (no row) rather than erroring — reachable.
    const res = await db.rpc('get_sign_request_by_token', { p_token: BOGUS_TOKEN });
    expect(res === null || typeof res === 'object').toBe(true);
  });

  it('e-sign: get_sign_document_templates is anon-callable and token-gated', async () => {
    // Bogus token → the doc_type subquery is NULL → zero rows (never the whole table).
    const rows = await db.rpc('get_sign_document_templates', { p_token: BOGUS_TOKEN });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});

// ── Closure direction (opt-in; run AFTER the owner applies the RED revokes) ──
describe.skipIf(!runClosure)('P3 — anon closure holds (post-revoke)', () => {
  it('a previously-anon, non-allowlisted RPC is now denied to anon', async () => {
    // get_crm_contacts was anon-executable pre-P3 and is NOT on the §2 allowlist.
    let denied = false;
    try {
      await db.rpc('get_crm_contacts', {});
    } catch (e) {
      denied = /permission denied/i.test(String(e.message)) || /42501/.test(String(e.message));
    }
    expect(denied).toBe(true);
  });

  it('a previously-anon, non-allowlisted table returns no rows to anon', async () => {
    // payments had an anon SELECT policy pre-P3; after recreate-without-anon, RLS
    // yields zero rows for the anon role (deny-by-default with no matching policy).
    let noAccess = true;
    try {
      const rows = await db.select('payments', 'select=id&limit=1');
      noAccess = Array.isArray(rows) && rows.length === 0;
    } catch (e) {
      noAccess = /permission denied/i.test(String(e.message)) || /42501/.test(String(e.message));
    }
    expect(noAccess).toBe(true);
  });

  it('the allowlisted surfaces still work after the revoke', async () => {
    const progress = await db.rpc('get_crm_build_progress');
    expect(Array.isArray(progress.phases)).toBe(true);
    const rows = await db.rpc('get_sign_document_templates', { p_token: BOGUS_TOKEN });
    expect(Array.isArray(rows)).toBe(true);
  });
});
