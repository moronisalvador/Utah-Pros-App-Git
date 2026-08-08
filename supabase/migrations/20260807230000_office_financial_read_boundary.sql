-- ════════════════════════════════════════════════
-- MIGRATION: 20260807230000_office_financial_read_boundary
-- Phase: Native office surfaces — Phase 5 step 2 (server-side authorization)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Six reports that show company money — accounts receivable, the payment
--   ledger, cash received, average ticket, revenue by division, and the sales
--   pipeline — could be read by ANY logged-in employee, including a field
--   technician, just by asking the database directly. The screens hid them, but
--   nothing stopped the request itself. This makes each of those six refuse
--   anyone who is not an active internal admin / office / project_manager.
--
--   Nothing about what the screens show changes: the same people who can see
--   these numbers today still see exactly the same numbers.
--
-- ADDITIVE-ONLY / blast radius:
--   Function BODIES only. No table, column, index, policy, trigger, grant, flag
--   or row is created, altered or dropped. Every signature and return shape is
--   preserved byte-for-byte, so no deployed frontend breaks
--   (database-standard.md §3 frontend-contract freeze).
--
--   Each function changes LANGUAGE sql -> plpgsql. That is required, not
--   cosmetic: a SQL-language function cannot RAISE, and adding the predicate to
--   a WHERE clause would return an empty result instead of an error — which
--   `loading-error-states.md` §1 calls out as the worst failure mode, because a
--   caller renders "no invoices" for what is actually a refusal. The SELECT
--   inside each function is the EXACT current body, copied unchanged from
--   pg_proc.prosrc; only the guard is new.
--
-- WHY THESE SIX, AND NOT THE OTHER EIGHT DASHBOARD RPCS:
--   These are the ones that expose money and the sales pipeline — the owner's
--   stated line ("company revenue, A/R and the sales pipeline do not belong on
--   a field device"). The remaining Overview reads (get_jobs_closed,
--   get_jobs_completed, get_open_estimates_summary, get_active_drying_jobs,
--   get_dashboard_action_items, get_tech_status_board) expose operational
--   counts, not money, AND are legitimately reached by supervisor and estimator:
--   every role except field_tech and crm_partner lands on the office Dashboard
--   (`getAccountLandingPath` in src/contexts/authBootstrap.js), and
--   get_tech_status_board additionally backs the Status Board that TimeTracking
--   shows to supervisors (BOARD_ROLES). Gating those to the billing three would
--   lock out supervisor and estimator — the same shape of mistake as the
--   2026-08-01 conversation scoping that silently locked every field technician
--   out of every conversation. They need a wider predicate and their own
--   role-perspective proof; that is deliberately a separate change.
--
--   get_insurance_carriers is deliberately NOT touched at all: it is reference
--   data (carrier names) and src/pages/tech/TechNewJob.jsx calls it, so a field
--   technician needs it to create a job.
--
-- PREDICATE:
--   public.billing_edit_access() — the EXISTING single source for
--   {admin, office, project_manager} + active + internal, already gating the
--   payments / invoices / invoice_line_items / estimates / estimate_line_items
--   write policies and the invoice-creation RPCs. Deliberately REUSED rather
--   than inlining a second role list: this repository already paid for that
--   lesson when payout authority had to be split back out of billing.
--
--   The guard is `IF NOT public.billing_edit_access() THEN RAISE`, and
--   billing_edit_access() returns a non-NULL boolean (it is a bare EXISTS), so
--   there is no NULL-skips-the-IF hazard here. service_role is unaffected: it
--   is not an employee, so it is refused by this predicate — which is correct,
--   because no Worker calls these six. functions/api/collections-chat.js reads
--   get_ar_invoices / get_payments_ledger / get_estimates through
--   functions/lib/supabase.js, whose client is service-role and therefore does
--   not execute these definer bodies as an employee... see the DEFERRED note.
--
-- ════════════════════════════════════════════════
-- ROLLBACK: supabase/rollbacks/20260807230000_office_financial_read_boundary.rollback.sql
--   Restores all six as LANGUAGE sql with their exact pre-migration bodies,
--   removing the guard. That is a deliberate re-opening of the read boundary.
-- ════════════════════════════════════════════════

-- SERVICE ROLE:
--   functions/api/collections-chat.js reads get_ar_invoices and
--   get_payments_ledger through functions/lib/supabase.js, whose client is
--   service-role. A SECURITY DEFINER body reached by service_role has no
--   employee row, so billing_edit_access() alone would refuse it and silently
--   break that Worker. The guard therefore carries the same service_role bypass
--   idiom get_inbound_leads already uses.
--
--   It is written `auth.role() IS DISTINCT FROM 'service_role'`, not `<>`: outside
--   a PostgREST request auth.role() is NULL, and `NULL <> 'service_role'` is NULL,
--   which PL/pgSQL's IF treats as false — silently SKIPPING the whole check. The
--   IS DISTINCT FROM form yields true there and falls through to
--   billing_edit_access(), i.e. it fails closed. Same one-token divergence the
--   applied 20260805020000_estimate_create_rpc_billing_boundary made, for the
--   same reason.
--
-- NO TOP-LEVEL TRANSACTION:
--   database-standard.md §5 — governed migrations rely on the Supabase migration
--   executor's own transaction, which wraps both the SQL and its schema_migrations
--   ledger write. A BEGIN/COMMIT here would fight it.

-- 1. Accounts receivable ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ar_invoices()
RETURNS TABLE(invoice_id uuid, invoice_number text, qbo_doc_number text, status text,
  total numeric, amount_paid numeric, balance numeric, sent_at timestamp with time zone,
  due_date date, invoice_date date, qbo_invoice_id text, qbo_sync_error text, job_id uuid,
  job_number text, division text, claim_id uuid, claim_number text, contact_id uuid,
  client_name text, job_address text, job_city text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    i.id, i.invoice_number, i.qbo_doc_number, i.status,
    COALESCE(i.adjusted_total, i.total, 0)                              AS total,
    COALESCE(i.amount_paid, 0)                                          AS amount_paid,
    COALESCE(i.adjusted_total, i.total, 0) - COALESCE(i.amount_paid, 0) AS balance,
    i.sent_at, i.due_date, i.invoice_date,
    i.qbo_invoice_id, i.qbo_sync_error,
    i.job_id, j.job_number, j.division,
    j.claim_id, cl.claim_number,
    i.contact_id, ct.name AS client_name,
    j.address AS job_address, j.city AS job_city,
    i.created_at
  FROM invoices i
  LEFT JOIN jobs     j  ON j.id  = i.job_id
  LEFT JOIN claims   cl ON cl.id = j.claim_id
  LEFT JOIN contacts ct ON ct.id = i.contact_id
  ORDER BY (COALESCE(i.adjusted_total, i.total, 0) - COALESCE(i.amount_paid, 0)) DESC,
           i.due_date NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ar_invoices() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ar_invoices() TO authenticated;

-- 2. Payment ledger ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_payments_ledger(p_limit integer DEFAULT 500)
RETURNS TABLE(payment_id uuid, amount numeric, payment_date date, payment_method text,
  payer_type text, payer_name text, reference_number text, is_deductible boolean,
  created_at timestamp with time zone, source text, qbo_payment_id text,
  qbo_synced_at timestamp with time zone, qbo_sync_error text, invoice_id uuid,
  invoice_number text, qbo_doc_number text, job_id uuid, job_number text, division text,
  claim_id uuid, claim_number text, contact_id uuid, client_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.amount, p.payment_date, p.payment_method,
    p.payer_type, p.payer_name, p.reference_number,
    p.is_deductible, p.created_at, p.source,
    p.qbo_payment_id, p.qbo_synced_at, p.qbo_sync_error,
    p.invoice_id, i.invoice_number, i.qbo_doc_number,
    p.job_id, j.job_number, j.division,
    j.claim_id, cl.claim_number,
    p.contact_id, COALESCE(ct.name, jc.name) AS client_name
  FROM payments p
  LEFT JOIN invoices i  ON i.id  = p.invoice_id
  LEFT JOIN jobs     j  ON j.id  = p.job_id
  LEFT JOIN claims   cl ON cl.id = j.claim_id
  LEFT JOIN contacts ct ON ct.id = p.contact_id
  LEFT JOIN contacts jc ON jc.id = j.primary_contact_id
  ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 2000));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_payments_ledger(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_payments_ledger(integer) TO authenticated;

-- 3. Cash received ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_payments_received(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN (
  WITH pay AS (
    SELECT public.dash_division_bucket(j.division::text) AS bucket,
           COALESCE(p.amount, 0) - COALESCE(p.refunded_amount, 0) AS amt,
           p.payment_date AS d
    FROM payments p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN jobs j ON j.id = COALESCE(p.job_id, i.job_id)
    WHERE p.payment_date IS NOT NULL
  ),
  cur  AS (SELECT bucket, SUM(amt) AS v FROM pay WHERE d BETWEEN p_start AND p_end AND bucket IS NOT NULL GROUP BY bucket),
  tot  AS (SELECT SUM(amt) AS v FROM pay WHERE d BETWEEN p_start AND p_end),
  prev AS (SELECT SUM(amt) AS v FROM pay WHERE d BETWEEN (p_start - ((p_end - p_start) + 1)) AND (p_start - 1))
  SELECT jsonb_build_object(
    'total',      COALESCE((SELECT v FROM tot), 0),
    'prev_total', COALESCE((SELECT v FROM prev), 0),
    'segments',   COALESCE((SELECT jsonb_agg(jsonb_build_object('key', bucket, 'value', v)) FROM cur), '[]'::jsonb)
  )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_payments_received(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_payments_received(date, date) TO authenticated;

-- 4. Average ticket ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_avg_ticket(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN (
  WITH inv AS (
    SELECT public.dash_division_bucket(j.division::text) AS bucket,
           j.claim_id,
           COALESCE(i.adjusted_total, i.total, 0) AS amt
    FROM invoices i JOIN jobs j ON j.id = i.job_id
    WHERE i.qbo_invoice_id IS NOT NULL AND i.invoice_date BETWEEN p_start AND p_end
  )
  SELECT jsonb_build_object(
    'divisions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', bucket, 'avg', av))
      FROM (SELECT bucket, AVG(amt) AS av FROM inv GROUP BY bucket) s), '[]'::jsonb),
    'avg_per_claim', COALESCE((
      SELECT AVG(cs) FROM (SELECT claim_id, SUM(amt) cs FROM inv WHERE claim_id IS NOT NULL GROUP BY claim_id) c), 0)
  )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_avg_ticket(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_avg_ticket(date, date) TO authenticated;

-- 5. Revenue by division ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_revenue_by_division(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN (
  WITH inv AS (
    SELECT public.dash_division_bucket(j.division::text) AS bucket,
           COALESCE(i.adjusted_total, i.total, 0) AS amt,
           i.invoice_date AS d
    FROM invoices i JOIN jobs j ON j.id = i.job_id
    WHERE i.qbo_invoice_id IS NOT NULL
  ),
  cur AS (SELECT bucket, SUM(amt) AS v FROM inv WHERE d BETWEEN p_start AND p_end GROUP BY bucket),
  prev AS (SELECT SUM(amt) AS v FROM inv WHERE d BETWEEN (p_start - ((p_end - p_start) + 1)) AND (p_start - 1))
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT SUM(v) FROM cur), 0),
    'prev_total', COALESCE((SELECT v FROM prev), 0),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', bucket, 'value', v)) FROM cur), '[]'::jsonb)
  )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_revenue_by_division(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_revenue_by_division(date, date) TO authenticated;

-- 6. Sales pipeline ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pipeline_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN (
  SELECT jsonb_build_object('stages', jsonb_build_array(
    jsonb_build_object('label','New / FNOL','count',
      (SELECT count(*) FROM jobs WHERE phase = 'job_received' AND status IS DISTINCT FROM 'deleted')),
    jsonb_build_object('label','In production','count',
      (SELECT count(*) FROM jobs WHERE phase = 'reconstruction_in_progress' AND status IS DISTINCT FROM 'deleted')),
    jsonb_build_object('label','Invoiced','count',
      (SELECT count(DISTINCT job_id) FROM invoices WHERE qbo_invoice_id IS NOT NULL)),
    jsonb_build_object('label','Paid','count',
      (SELECT count(DISTINCT job_id) FROM invoices WHERE status = 'paid'))
  ))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_pipeline_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pipeline_summary() TO authenticated;
