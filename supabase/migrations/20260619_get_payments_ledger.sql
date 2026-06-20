-- 20260619_get_payments_ledger.sql
-- Global payments ledger (cash-in) for the Collections → Payments tab. One row per
-- payment with client/invoice/claim/job context + QBO sync state. Read-only.

CREATE OR REPLACE FUNCTION get_payments_ledger(p_limit int DEFAULT 500)
RETURNS TABLE (
  payment_id uuid, amount numeric, payment_date date, payment_method text,
  payer_type text, payer_name text, reference_number text,
  is_deductible boolean, created_at timestamptz,
  qbo_payment_id text, qbo_synced_at timestamptz, qbo_sync_error text,
  invoice_id uuid, invoice_number text,
  job_id uuid, job_number text, division text,
  claim_id uuid, claim_number text,
  contact_id uuid, client_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id, p.amount, p.payment_date, p.payment_method,
    p.payer_type, p.payer_name, p.reference_number,
    p.is_deductible, p.created_at,
    p.qbo_payment_id, p.qbo_synced_at, p.qbo_sync_error,
    p.invoice_id, i.invoice_number,
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
$$;

GRANT EXECUTE ON FUNCTION get_payments_ledger(int) TO anon, authenticated;
