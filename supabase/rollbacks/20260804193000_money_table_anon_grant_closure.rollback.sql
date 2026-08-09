-- ════════════════════════════════════════════════
-- ROLLBACK: 20260804193000_money_table_anon_grant_closure
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Gives the logged-out website role its permissions back on the invoice,
--   invoice-line and estimate tables, exactly as they were before the closure.
--
--   Be clear about what you are restoring. On its own it does not expose data:
--   row-level security is still on and still has no rule admitting a logged-out
--   visitor, so rows stay refused. What it restores is the standing risk — the
--   permission that turns any future missing-role policy, or any future
--   disabling of row-level security on these tables, into an immediate public
--   leak of every invoice, line item and estimate in the company.
--
--   Because of that, this rollback should be a genuine last resort. The closure
--   removes privileges from ONE role that has no verified caller anywhere in
--   the codebase, so a break traced to it would be surprising. Prefer diagnosing
--   the real caller and fixing forward over restoring a company-wide standing
--   exposure.
--
-- VERIFIED-BEFORE STATE (committed baseline `db/baseline/schema.sql`, pg_dump
-- of the live public schema at 8e1cf9cc):
--   GRANT ALL ON TABLE public.estimates          TO anon;  -- :29682
--   GRANT ALL ON TABLE public.invoices           TO anon;  -- :29727
--   GRANT ALL ON TABLE public.invoice_line_items TO anon;  -- :33774
--   No `TO PUBLIC` grant existed on any of these tables (zero in the dump), so
--   nothing is re-granted to PUBLIC here — doing so would ADD privilege that
--   the forward migration never removed.
--
-- WHY `payments` IS NOT RESTORED HERE (deliberate asymmetry — read before
-- editing):
--   The forward migration revokes payments too, but only as an idempotent
--   safety net. The real closure of payments' anon grant belongs to
--   20260731045407_qbo_multi_invoice_payment_receipts.sql:143, applied to
--   production as ledger 20260731225654. Re-granting payments here would not
--   undo this migration — it would silently UNDO A DIFFERENT, ALREADY-APPLIED
--   SECURITY MIGRATION and re-open a table this repository closed a week
--   earlier. A rollback must restore the state its own forward step changed and
--   nothing more.
--
-- NOT RESTORED (because the forward migration never changed them):
--   - `authenticated` and `service_role` grants — untouched in both directions.
--   - Every policy on all four tables — untouched in both directions.
--   - Row-level security stays ENABLED. The forward migration only re-asserted
--     an already-true invariant, so there is nothing to reverse, and disabling
--     RLS here would be strictly worse than the state that preceded the
--     migration.
--   - The table COMMENTs are cleared below, since the forward migration set
--     them.
-- ════════════════════════════════════════════════

-- ─── 1. Restore the MINIMUM anon privilege that could unbreak a caller ───
-- Deliberately NOT the seven privileges the baseline recorded. The forward
-- migration's own caller inventory found no legitimate anon caller of these
-- tables at all, so an operator reaching for this rollback has evidence that
-- SOMETHING broke, but no evidence of which verb it needs. Handing back all
-- seven -- including TRUNCATE, the one privilege the forward migration names as
-- resting on the absence of a SQL path rather than on RLS -- would restore a
-- table-wipe capability to the logged-out role in order to fix an unknown read.
--
-- Restore SELECT only. If a diagnosed caller genuinely needs more, add that ONE
-- verb here deliberately, with the caller named in the commit message. Never
-- re-grant TRUNCATE, REFERENCES or TRIGGER to anon without explicit owner
-- sign-off recorded at the time.

GRANT SELECT ON TABLE public.invoices           TO anon;
GRANT SELECT ON TABLE public.invoice_line_items TO anon;
GRANT SELECT ON TABLE public.estimates          TO anon;

-- public.payments is deliberately absent — see the header note above.

-- ─── 2. Clear the table comments the forward migration wrote ───

COMMENT ON TABLE public.invoices           IS NULL;
COMMENT ON TABLE public.invoice_line_items IS NULL;
COMMENT ON TABLE public.estimates          IS NULL;
