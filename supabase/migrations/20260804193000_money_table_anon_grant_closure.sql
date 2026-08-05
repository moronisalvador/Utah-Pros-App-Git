-- ════════════════════════════════════════════════
-- MIGRATION: 20260804193000_money_table_anon_grant_closure
-- Phase: Anon closure, money tables (follows tranche a/b) — standalone
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Takes away permissions that the logged-out website role was holding on the
--   invoice, invoice-line, and estimate tables. It should never have had them.
--
--   To be honest about what this is: those permissions are NOT currently
--   leaking money data. Each of these tables has row-level security switched
--   on, and none of them has a rule that lets a logged-out visitor see a single
--   row. So the permission is a key with no matching lock — today.
--
--   The reason to take the key away anyway is that it is the dangerous half of
--   a two-part safety catch. If someone ever adds a rule to one of these tables
--   without naming who it is for, or switches row-level security off during a
--   future change, every invoice in the company becomes readable from the
--   public internet in that instant, with no further mistake required. Removing
--   the permission means a single future slip is no longer enough.
--
--   Nothing anyone uses changes. Logged-in staff keep exactly the permissions
--   they have now, and the background services keep theirs.
--
-- ADDITIVE-ONLY:
--   No table, column, index, constraint, policy, or function is created,
--   dropped, renamed, or altered, and no row of business data changes. This is
--   a privilege REVOKE against ONE role (`anon`) plus an idempotent
--   re-assertion that row-level security stays on. It trips none of the
--   `scripts/check-migration-hygiene.mjs` destructive patterns, so it carries
--   no `destructive-approved:` marker.
--
-- EVIDENCE (committed baseline `db/baseline/schema.sql`, pg_dump of the live
-- public schema at 8e1cf9cc, plus every migration authored since):
--   - GRANT ALL ON TABLE ... TO anon exists on all four money tables:
--     estimates (:29682), invoices (:29727), invoice_line_items (:33774),
--     payments (:34006). No table has any grant TO PUBLIC (zero in the dump).
--   - RLS is ENABLED on all four: estimates (:28337), invoice_line_items
--     (:28474), invoices (:28493), payments (:28961).
--   - NO policy on any of the four admits `anon`. The four `allow_anon_*`
--     names are legacy misnomers: 20260708_dbf_p3_anon_policy_closure.sql:134
--     rescoped them to `TO authenticated`, keeping the old policy name. The
--     `TO anon` copies at that file's :401+ are its ROLLBACK section, not
--     forward DDL.
--   - Therefore the reachable exposure through PostgREST — which is all the
--     public anon key in the browser bundle can drive — is NONE. SELECT,
--     INSERT, UPDATE and DELETE are all refused by RLS for want of a policy.
--   - Residual that RLS does NOT cover: TRUNCATE is part of GRANT ALL and is
--     not subject to row-level security. PostgREST exposes no TRUNCATE verb and
--     `exec_read_sql` is service-role-only, so there is no known path to reach
--     it with the anon key. It is recorded as the one privilege whose safety
--     rests on the absence of a SQL path rather than on RLS.
--
--   Caller inventory (why this cannot regress anything):
--   - Exactly two browser surfaces use the unauthenticated anon-key client:
--     src/pages/SignPage.jsx (public e-sign) and src/pages/Status.jsx. Both
--     call SECURITY DEFINER RPCs only — get_sign_request_by_token,
--     get_sign_document_templates, get_crm_build_progress. Neither performs
--     direct table access, and a definer RPC needs no table grant.
--   - Every Cloudflare Worker builds its client in functions/lib/supabase.js
--     (:25) from the privileged service-role environment variable, never from
--     the anon key.
--   - All application-data reads/writes run as `authenticated` through
--     AuthContext's session-bound client (CLAUDE.md Rule 3), whose grants this
--     migration does not touch.
--
-- SCOPE — deliberately narrow:
--   `payments` is included in the REVOKE purely as an idempotent safety net.
--   Its anon grant was already removed by
--   20260731045407_qbo_multi_invoice_payment_receipts.sql:143, applied to
--   production as ledger 20260731225654, so that line is expected to be a
--   no-op. The paired rollback deliberately does NOT re-grant payments — see
--   the note there.
--
-- NOT IN SCOPE (deliberately — reported, not silently fixed):
--   1. The `authenticated` side. GRANT ALL to `authenticated` on these tables
--      is separate pre-existing debt with real live callers; narrowing it is a
--      behavior change that needs its own review and its own proof.
--   2. `allow_anon_read_invoices` (invoices, FOR SELECT TO authenticated USING
--      (true)) is OR'd with `allow_authenticated_invoices` (USING (NOT
--      is_crm_partner(auth.uid()))). Permissive policies union, so the net
--      effect is that a `crm_partner` CAN read invoices despite the second
--      policy's exclusion. That is a genuine authorization gap, but it is on
--      the authenticated path, not the anon path, and closing it changes live
--      behavior for a real role. It needs its own migration, caller inventory
--      and test — not a quiet ride-along on a revoke.
--   3. The database-standard.md §2 public allowlist is untouched.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260804193000_money_table_anon_grant_closure.rollback.sql
--   (re-grants ALL on invoices, invoice_line_items and estimates to anon,
--    restoring the exact pre-migration privilege set; payments is intentionally
--    excluded because its closure belongs to a different applied migration).
-- ════════════════════════════════════════════════

-- ─── 1. Revoke the browser's logged-out role from the money tables ───
-- PUBLIC is named alongside anon defensively. The baseline contains zero
-- `TO PUBLIC` table grants, so this is expected to be a no-op; it costs
-- nothing and closes the inheritance route if one is ever added.
-- `authenticated` and `service_role` are deliberately NOT named.

REVOKE ALL ON TABLE public.invoices           FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.invoice_line_items FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.estimates          FROM PUBLIC, anon;

-- Idempotent safety net; already closed by 20260731045407 (ledger 20260731225654).
REVOKE ALL ON TABLE public.payments           FROM PUBLIC, anon;

-- ─── 2. Keep RLS on rather than relying on the revoke alone ───
-- Defense in depth, matching 20260726200000_anon_closure_tranche_a.sql. These
-- are already enabled in the live catalog; ENABLE is idempotent and asserts the
-- invariant in source so a later table-recreate cannot silently drop it.

ALTER TABLE public.invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimates          ENABLE ROW LEVEL SECURITY;

-- ─── 3. Record why the grant is gone, at the table ───

COMMENT ON TABLE public.invoices IS
  'No browser-role grant for `anon`. The anon key ships inside the public browser '
  'bundle; RLS already refused these rows for want of an anon policy, and the '
  'grant was the dangerous half of that pair. Logged-in access is `authenticated` '
  'via RLS; Workers use the privileged server-side role.';

COMMENT ON TABLE public.invoice_line_items IS
  'No browser-role grant for `anon`. Line items carry the amounts that roll up '
  'into trigger-owned invoice totals (AGENTS.md §15). Access mirrors invoices.';

COMMENT ON TABLE public.estimates IS
  'No browser-role grant for `anon`. The public e-sign flow reads through '
  'token-constrained SECURITY DEFINER RPCs (get_sign_request_by_token), never '
  'through a browser table grant, so this revoke does not touch signing.';
