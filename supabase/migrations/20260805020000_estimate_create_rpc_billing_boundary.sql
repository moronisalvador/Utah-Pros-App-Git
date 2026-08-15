-- ════════════════════════════════════════════════
-- MIGRATION: 20260805020000_estimate_create_rpc_billing_boundary
-- Phase: n/a (standalone money-path authorization correction)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Closes the last way to create an estimate without permission. Two helper
--   routines that make a new blank estimate were written to run with the
--   database owner's own powers, and they never checked who was asking — they
--   only checked that the customer or job existed. Because they run as the
--   owner, the normal permission rules on the estimates table did not apply to
--   them, so any signed-in employee could quietly create draft estimates even
--   though every other estimate action refuses them. Both routines now ask the
--   same question the rest of billing asks: are you an active internal member of
--   staff allowed to edit billing? If not, the call is refused.
--
-- ADDITIVE-ONLY / attribute-only:
--   No table DROP/RENAME/ALTER COLUMN and no data change. This is an
--   authorization-only change: it replaces two function bodies in place. No
--   policy, grant, table, column, index or constraint is touched. The signatures,
--   parameter defaults, return types, language, volatility, SECURITY DEFINER
--   posture and search_path of both functions are preserved exactly, so the
--   deployed frontend contract does not move (database-standard.md §3).
--
-- WHY THIS IS SAFE FOR CALLERS (verified live 2026-08-05, read-only):
--   - public.billing_edit_access() is ALREADY LIVE and widened — production
--     ledger 20260805014242_billing_editor_role_boundary — and reads
--     ('admin','office','project_manager'). This migration consumes that
--     predicate; it does not redefine it and must never inline a second copy of
--     the role list (that duplication is the defect the boundary migration
--     exists to prevent).
--   - public.estimates already enforces exactly this predicate on writes via the
--     oop_estimates_billing_write policy (USING + WITH CHECK
--     billing_edit_access()). These two SECURITY DEFINER routines were the only
--     path around it. This migration aligns them with the boundary that is
--     already live; it does not invent a new restriction.
--   - Every browser caller of create_estimate_for_contact already sits behind
--     canEditBilling — Estimates.jsx, Collections.jsx, CustomerPage.jsx — except
--     the desktop "+ New" menu, which is gated in the same commit as this
--     migration (src/components/NewMenu.jsx). Admin Mobile's estimate builder is
--     admin-only via AdminMobileRoute.
--   - create_estimate_for_job has NO application caller at all (repo-wide grep
--     of src/ and functions/); it is reachable only over PostgREST.
--   - No other database function calls either routine (catalog scan of every
--     public.* function body, 0 hits), so no internal caller regresses.
--   - Live creator audit: every estimate with a resolvable creator was created by
--     an 'admin' (19 rows); the remaining 37 predate created_by attribution and
--     are all older than 2026-07-06. No estimator, supervisor, field_tech or
--     crm_partner has ever created one, so no live workflow is interrupted. The
--     boundary is in fact WIDER than the effective status quo: office and
--     project_manager gain a capability the UI gate previously denied them.
--
-- WHY THE service_role SHORT-CIRCUIT IS PART OF THE GUARD:
--   billing_edit_access() resolves an employee from auth.uid() and is granted to
--   'authenticated' only. A worker using the service-role client has no auth.uid()
--   and would fail closed. The short-circuit preserves worker access exactly as
--   the live 20260804120100 boundary does for create_invoice_for_job and
--   convert_estimate_to_invoice, and the SQLSTATE and message are identical to
--   those so the client handles all of them the same way.
--
--   IS DISTINCT FROM, NOT <> — a deliberate one-token divergence from the live
--   precedent, in the fail-closed direction. auth.role() reads a request GUC and
--   returns NULL outside a PostgREST request (a direct psql session, pg_cron, a
--   future internal caller). With `<>`, NULL <> 'service_role' is NULL, and
--   `NULL AND true` is NULL, which PL/pgSQL's IF treats as FALSE — so the guard
--   would be SKIPPED and the INSERT would proceed unchecked. Verified on the live
--   database 2026-08-05: `(NULL <> 'service_role') AND TRUE` returns NULL.
--   IS DISTINCT FROM is NULL-safe and yields exactly the intended three cases:
--     'service_role'  → false → short-circuit, worker passes (unchanged)
--     'authenticated' → true  → billing_edit_access() decides (unchanged)
--     NULL            → true  → billing_edit_access() decides, and outside a
--                               request it is false, so the call is REFUSED.
--   The reachable exposure today is small — no internal caller exists and any
--   direct-session caller is already privileged enough to write the table — but
--   the correct form costs one token. The two functions the live 20260804120100
--   guards still carry the `<>` form; correcting those belongs to that applied
--   migration's owner as a separate change, not to this one.
--
-- NOT CHANGED:
--   - search_path stays 'public' on both functions, matching the live definition.
--     Tightening it to '' would require schema-qualifying every reference inside
--     the bodies, which is a behavioural edit to money-adjacent code and belongs
--     in its own reviewed change, not smuggled into an authorization fix.
--   - p_created_by remains caller-supplied on both functions. It is a spoofable
--     attribution input (it feeds the sale's salesperson for commissions) and is
--     worth deriving from auth.uid() — but changing it alters the deployed
--     contract, so it is deliberately left for a separate reviewed change.
--   - Estimate line items, amounts and conversion to an invoice are untouched;
--     they were already held to the billing boundary.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260805020000_estimate_create_rpc_billing_boundary.rollback.sql.
--   It restores both bodies to the exact pre-migration definitions — same
--   signatures, same grants, no caller check — which re-opens draft-estimate
--   creation to every authenticated employee. That prior state is the defect this
--   migration closes, so prefer rolling FORWARD with a corrected predicate over
--   rolling back. Rolling back does not lose data: no row is written or altered
--   by either direction.
-- ════════════════════════════════════════════════

-- ── 1. create_estimate_for_contact ────────────────────────────────────────────
-- The live body, with ONLY the authorization block added. The contact-existence
-- check, the generated estimate number, the column list, the COALESCE defaults
-- and the RETURNING shape are preserved verbatim.
CREATE OR REPLACE FUNCTION public.create_estimate_for_contact(
  p_contact_id        uuid,
  p_intended_division text DEFAULT 'water',
  p_estimate_type     text DEFAULT 'initial',
  p_property_address  text DEFAULT NULL,
  p_property_city     text DEFAULT NULL,
  p_property_state    text DEFAULT NULL,
  p_property_zip      text DEFAULT NULL,
  p_created_by        uuid DEFAULT NULL
)
RETURNS estimates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row estimates;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'not_authorized: active internal billing editor required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id) THEN
    RAISE EXCEPTION 'Contact % not found', p_contact_id;
  END IF;
  INSERT INTO estimates (contact_id, estimate_number, estimate_type, status, amount, subtotal,
                         intended_division, property_address, property_city, property_state, property_zip, created_by)
  VALUES (p_contact_id, generate_estimate_number(), COALESCE(p_estimate_type, 'initial'), 'draft', 0, 0,
          COALESCE(p_intended_division, 'water'), p_property_address, p_property_city, p_property_state, p_property_zip, p_created_by)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_estimate_for_contact(uuid, text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_estimate_for_contact(uuid, text, text, text, text, text, text, uuid) TO authenticated, service_role;

-- ── 2. create_estimate_for_job ────────────────────────────────────────────────
-- Same treatment. This one always inserts a NEW draft (a job may carry several
-- estimates), which is why it has no idempotent re-entry to preserve.
CREATE OR REPLACE FUNCTION public.create_estimate_for_job(
  p_job_id        uuid,
  p_estimate_type text DEFAULT 'initial',
  p_created_by    uuid DEFAULT NULL
)
RETURNS estimates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estimates;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'not_authorized: active internal billing editor required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO estimates (job_id, contact_id, estimate_number, estimate_type, status, amount, subtotal, created_by)
  SELECT j.id, j.primary_contact_id, generate_estimate_number(),
         COALESCE(p_estimate_type, 'initial'), 'draft', 0, 0, p_created_by
  FROM jobs j WHERE j.id = p_job_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Job % not found', p_job_id; END IF;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_estimate_for_job(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_estimate_for_job(uuid, text, uuid) TO authenticated, service_role;
