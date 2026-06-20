-- 20260619_get_ar_invoices.sql
-- Global A/R: one row per invoice with client/claim/job context + computed balance,
-- for the invoice-centric Collections dashboard (aging, overdue worklist). Read-only.

CREATE OR REPLACE FUNCTION get_ar_invoices()
RETURNS TABLE (
  invoice_id uuid, invoice_number text, status text,
  total numeric, amount_paid numeric, balance numeric,
  sent_at timestamptz, due_date date, invoice_date date,
  qbo_invoice_id text, qbo_sync_error text,
  job_id uuid, job_number text, division text,
  claim_id uuid, claim_number text,
  contact_id uuid, client_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    i.id,
    i.invoice_number,
    i.status,
    COALESCE(i.adjusted_total, i.total, 0)                                   AS total,
    COALESCE(i.amount_paid, 0)                                               AS amount_paid,
    COALESCE(i.adjusted_total, i.total, 0) - COALESCE(i.amount_paid, 0)      AS balance,
    i.sent_at,
    i.due_date,
    i.invoice_date,
    i.qbo_invoice_id,
    i.qbo_sync_error,
    i.job_id,
    j.job_number,
    j.division,
    j.claim_id,
    cl.claim_number,
    i.contact_id,
    ct.name AS client_name
  FROM invoices i
  LEFT JOIN jobs     j  ON j.id  = i.job_id
  LEFT JOIN claims   cl ON cl.id = j.claim_id
  LEFT JOIN contacts ct ON ct.id = i.contact_id
  ORDER BY (COALESCE(i.adjusted_total, i.total, 0) - COALESCE(i.amount_paid, 0)) DESC,
           i.due_date NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_ar_invoices() TO anon, authenticated;
