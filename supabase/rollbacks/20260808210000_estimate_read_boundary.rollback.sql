-- ════════════════════════════════════════════════
-- ROLLBACK: 20260808210000_estimate_read_boundary
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the customer-quote list back the way it was: readable by anyone who can
--   log in. That includes field technicians and outside CRM partners, who would
--   again be able to pull every estimate — customer name, claim and job number,
--   amount and status — straight from a signed-in session, with no screen needed.
--
--   Run this only if gating the quote list turns out to break something real.
--   Understand what it costs: it re-opens the exact exposure the forward
--   migration closed, for 12 of the 18 active employees measured on 2026-08-08.
--
-- SCOPE:
--   Restores the body of public.get_estimates() to the exact LANGUAGE sql
--   definition that was live before 20260808210000 — md5
--   5062fe1b025b989e82ac827a00411d2e, the same hash the forward migration's drift
--   guard pins. The RETURN SIGNATURE is identical in both directions, so no
--   deployed frontend notices either way.
--
--   It deliberately does NOT touch public.billing_edit_access(), nor the five
--   reports gated by 20260807230000_office_financial_read_boundary (production
--   ledger 20260808050037). Undoing the estimate gate must never re-open those;
--   they have their own paired rollback.
--
-- -- destructive-approved: replaces one function body with its exact prior
-- -- definition. No table, column, policy or grant is dropped; the REVOKE/GRANT
-- -- pair below restates the same posture the function already had.
-- ════════════════════════════════════════════════

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_estimates() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_estimates() TO authenticated;
