-- ════════════════════════════════════════════════
-- MIGRATION: 20260808210000_estimate_read_boundary
-- Phase: Native office surfaces — Phase 5 follow-up (the missed sibling)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops everyone in the company from being able to read the full list of
--   customer quotes. Right now anyone who can log in — including a field
--   technician and an outside CRM partner — can ask the database for every
--   estimate we have ever written: the customer's name, their claim and job
--   numbers, the dollar amount, and whether it was sent. They do not need a
--   screen to do it; the request works straight from a signed-in session.
--
--   After this, only the people whose job is billing get an answer: an admin,
--   the office manager, and project managers. Everyone else is refused. Nothing
--   about the quotes themselves changes, and the people who already use this
--   list keep seeing exactly what they see today.
--
-- WHY NOW:
--   20260807230000_office_financial_read_boundary (production ledger
--   20260808050037) closed exactly this hole for FIVE money reports —
--   get_ar_invoices, get_payments_ledger, get_payments_received, get_avg_ticket
--   and get_revenue_by_division. get_estimates is the sibling it missed. Invoices
--   were closed; quotes were left open. Same customers, same dollar figures, same
--   bare SECURITY DEFINER shape: no argument, no caller check of any kind, and
--   EXECUTE granted to `authenticated`.
--
--   Measured on live 2026-08-08 before this migration: 18 active employees could
--   call it — 5 admins, 1 project manager, 5 field technicians, 1 supervisor and
--   6 CRM partners. Twelve of them have no business holding the quote book.
--
-- BLAST RADIUS — one function body, no schema change:
--   Replaces the body of public.get_estimates() and re-states its grants. No
--   table, column, index, policy or trigger is created, altered or dropped. The
--   RETURN SIGNATURE IS UNCHANGED — all 21 columns, same names, same types, same
--   order — so every deployed frontend keeps working (database-standard.md §3,
--   frontend-contract freeze). The SELECT itself is copied verbatim from the live
--   body; only the guard is added in front of it.
--
-- WHO GAINS, WHO LOSES, WHO IS UNTOUCHED (database-standard.md §5b):
--   GAINS:     nobody. This migration only ever refuses.
--   KEEPS:     admin, office, project_manager — via public.billing_edit_access(),
--              which additionally requires the employee be active and internal.
--              Also service_role, which bypasses the guard so the
--              /api/collections-chat worker keeps working (it already gates its
--              own callers to the billing role list).
--   LOSES:     field_tech, crm_partner, supervisor, estimator — and this is the
--              point of the change. Owner decision 2026-08-08, asked and answered
--              explicitly: supervisors do not see quotes.
--   UNTOUCHED: the estimates themselves, every write path, and the four surfaces
--              that read this RPC. Traced 2026-08-08, all four survive:
--                src/pages/Estimates.jsx — nav key `estimates` has ZERO
--                  nav_permissions rows, so only an admin reaches it (canAccess
--                  Layer 3), and admin is inside the predicate.
--                src/components/collections/EstimatesList.jsx — the office
--                  Collections tab, whose AR and Payments siblings are already
--                  gated by 20260808050037; this makes the third tab consistent.
--                src/components/admin-mobile/collections/EstimatesTab.jsx — the
--                  native Collections screen, route-gated to BILLING_EDIT_ROLES.
--                functions/api/collections-chat.js — authorizeQboBrowserRequest,
--                  already the billing role list, and reaches the database as
--                  service_role.
--              public.employee_page_access was checked too: ZERO per-employee
--              overrides exist for `estimates`, so no individual grant is being
--              revoked out from under anyone.
--
-- THE TRAP THIS ONE AVOIDS (recorded because the last one nearly shipped broken):
--   Converting LANGUAGE sql to plpgsql changes the result-type rules. A `sql`
--   function applies an implicit assignment cast at the result boundary; plpgsql's
--   RETURN QUERY requires an EXACT row-type match and will raise
--   "structure of query does not match function result type" for every caller,
--   including admins. On 20260807230000 that defect reached the apply step and was
--   caught only by executing the migration — 17 static assertions passed over it.
--   Every returned column was re-checked against information_schema here:
--   `jobs.division` is enum job_division and is ALREADY cast (`j.division::text`)
--   inside its COALESCE, `estimates.intended_division` is text, and `status`,
--   `estimate_type`, `estimate_number` and both invoice-number columns are all
--   plain text. So no new cast is required — but the behavioural proof executes
--   the function rather than trusting that reading.
--
-- ════════════════════════════════════════════════
-- ROLLBACK: supabase/rollbacks/20260808210000_estimate_read_boundary.rollback.sql
--   Restores get_estimates() to the exact LANGUAGE sql body this replaces, whose
--   md5 is pinned in the drift guard below. After the rollback every authenticated
--   employee can read the estimate book again — that re-opening is what the
--   rollback proof measures, rather than merely describing.
-- ════════════════════════════════════════════════

-- NO TOP-LEVEL TRANSACTION:
--   database-standard.md §5 — the Supabase migration executor owns the
--   transaction, which wraps both this SQL and its schema_migrations ledger write.

-- ── DRIFT GUARD ──────────────────────────────────────────────────────────────
-- Refuse to replace a body that is not the one reviewed. Measured live
-- 2026-08-08 at md5 5062fe1b025b989e82ac827a00411d2e. If another session has
-- since edited get_estimates, this aborts the whole migration instead of
-- silently discarding their change.
DO $guard$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_estimates';

  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'public.get_estimates() does not exist — refusing to create it blind';
  END IF;
  IF v_md5 <> '5062fe1b025b989e82ac827a00411d2e' THEN
    RAISE EXCEPTION
      'get_estimates body drifted: live md5 % does not match the reviewed 5062fe1b025b989e82ac827a00411d2e. '
      'Re-review against the live body before applying.', v_md5;
  END IF;
  RAISE NOTICE 'drift guard passed: live get_estimates body is the reviewed one';
END;
$guard$;

-- ── THE GATE ─────────────────────────────────────────────────────────────────
-- `IS DISTINCT FROM`, never `<>`: auth.role() is NULL outside a PostgREST
-- request, and `NULL <> 'service_role'` is NULL, which PL/pgSQL's IF treats as
-- false — silently skipping the guard. Same idiom as the five reports gated by
-- 20260808050037.
CREATE OR REPLACE FUNCTION public.get_estimates()
RETURNS TABLE(
  estimate_id uuid,
  estimate_number text,
  estimate_type text,
  status text,
  amount numeric,
  created_at timestamp with time zone,
  submitted_at timestamp with time zone,
  expiration_date date,
  qbo_estimate_id text,
  qbo_doc_number text,
  qbo_sync_error text,
  qbo_emailed_at timestamp with time zone,
  job_id uuid,
  job_number text,
  division text,
  claim_id uuid,
  claim_number text,
  contact_id uuid,
  client_name text,
  converted_invoice_id uuid,
  converted_invoice_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    e.id, e.estimate_number, e.estimate_type, e.status,
    COALESCE(e.amount, 0), e.created_at, e.submitted_at, e.expiration_date,
    e.qbo_estimate_id, e.qbo_doc_number, e.qbo_sync_error, e.qbo_emailed_at,
    e.job_id, j.job_number,
    COALESCE(e.intended_division, j.division::text)    AS division,
    j.claim_id, cl.claim_number,
    COALESCE(e.contact_id, j.primary_contact_id)       AS contact_id,
    ct.name                                            AS client_name,
    e.converted_invoice_id,
    COALESCE(iv.qbo_doc_number, iv.invoice_number)     AS converted_invoice_number
  FROM estimates e
  LEFT JOIN jobs     j  ON j.id  = e.job_id
  LEFT JOIN claims   cl ON cl.id = j.claim_id
  LEFT JOIN contacts ct ON ct.id = COALESCE(e.contact_id, j.primary_contact_id)
  LEFT JOIN invoices iv ON iv.id = e.converted_invoice_id
  ORDER BY e.created_at DESC;
END;
$fn$;

-- This managed project re-applies Postgres's built-in EXECUTE TO PUBLIC to every
-- new function at ddl_command_end, so the revoke must be explicit and must come
-- before the grant (database-standard.md §1).
REVOKE EXECUTE ON FUNCTION public.get_estimates() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_estimates() TO authenticated;

-- ── POSTCONDITIONS ───────────────────────────────────────────────────────────
-- Assert the shape rather than a body hash: a hash would break on a whitespace
-- edit while proving nothing extra. These are the properties that actually carry
-- the security guarantee.
DO $post$
DECLARE p pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO p FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
   WHERE n.nspname = 'public' AND pr.proname = 'get_estimates';

  IF p.prosrc NOT LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'postcondition failed: get_estimates does not consume billing_edit_access()';
  END IF;
  IF p.prosrc LIKE '%''admin''%' OR p.prosrc LIKE '%''office''%' OR p.prosrc LIKE '%''project_manager''%' THEN
    RAISE EXCEPTION 'postcondition failed: get_estimates inlines a role literal instead of using the shared predicate';
  END IF;
  IF p.prosrc NOT LIKE '%IS DISTINCT FROM ''service_role''%' THEN
    RAISE EXCEPTION 'postcondition failed: the service_role bypass must use IS DISTINCT FROM, not <>';
  END IF;
  IF NOT p.prosecdef THEN
    RAISE EXCEPTION 'postcondition failed: get_estimates is no longer SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', p.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: anon can execute get_estimates';
  END IF;
  IF NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: authenticated lost EXECUTE — the gate is inside the body, not the grant';
  END IF;
  RAISE NOTICE 'postconditions passed: gated by billing_edit_access(), definer, anon refused, authenticated retained';
END;
$post$;
