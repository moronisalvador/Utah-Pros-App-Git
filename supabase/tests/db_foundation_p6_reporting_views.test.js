/**
 * ════════════════════════════════════════════════
 * FILE: db_foundation_p6_reporting_views.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the DB-Foundation Phase P6 reporting views (rv_jobs, rv_invoices,
 *   rv_payments, rv_leads, rv_time_entries) are locked down the way they must be:
 *   an unauthenticated (anon) caller can NOT read any of them. These are internal
 *   staff reporting surfaces — they carry financial and PII columns — so the
 *   REVOKE-anon + security_invoker posture is the security contract this test
 *   guards. Runs against the real shared database with the anon key (exactly what
 *   ships in the browser bundle), so a passing run means the browser-reachable
 *   anon role is genuinely shut out.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated anon REST client)
 *   Data:      reads  → attempts to read rv_* views as anon (must be denied)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds
 *     like the other CRM/DB-foundation suites.
 *   - The anon client canNOT be used to assert the views' column SHAPE (anon is
 *     denied by design). The value/shape guard for the data these views project
 *     lives with the base-table tests; here we assert the ACCESS contract.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

const REPORTING_VIEWS = ['rv_jobs', 'rv_invoices', 'rv_payments', 'rv_leads', 'rv_time_entries'];

describe.skipIf(!hasCreds)('DB-Foundation P6 — reporting views are anon-denied', () => {
  for (const view of REPORTING_VIEWS) {
    it(`${view} rejects an unauthenticated (anon) read`, async () => {
      // db.select throws on any non-OK response (403/permission denied). A view
      // that let anon through would resolve and FAIL this assertion.
      await expect(db.select(view, 'select=*&limit=1')).rejects.toThrow();
    });
  }
});
