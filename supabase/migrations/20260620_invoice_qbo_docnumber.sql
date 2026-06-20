-- 20260620_invoice_qbo_docnumber.sql
-- Make UPR show QuickBooks' own invoice number so the two match (find the same invoice in
-- QBO by the number you see in UPR). We don't send a DocNumber on push — QBO auto-assigns
-- its sequential number — so here we just capture it back and surface it.
--
-- invoices.qbo_doc_number = QBO's human-facing DocNumber (e.g. 1037), distinct from
-- qbo_invoice_id (QBO's internal id). UPR keeps INV-###### as the pre-send draft handle;
-- once sent, the UI displays qbo_doc_number. (Reverse traceability QBO→UPR is already in
-- the QBO invoice PrivateNote: "UPR <inv#> · job <job#> · claim <claim#>".)

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_doc_number text;

-- Surface qbo_doc_number in the A/R dashboard rows. (DROP first — adding an OUT column
-- changes the return type, which CREATE OR REPLACE can't do.)
DROP FUNCTION IF EXISTS public.get_ar_invoices();
CREATE FUNCTION public.get_ar_invoices()
RETURNS TABLE(invoice_id uuid, invoice_number text, qbo_doc_number text, status text, total numeric, amount_paid numeric, balance numeric, sent_at timestamp with time zone, due_date date, invoice_date date, qbo_invoice_id text, qbo_sync_error text, job_id uuid, job_number text, division text, claim_id uuid, claim_number text, contact_id uuid, client_name text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    i.id, i.invoice_number, i.qbo_doc_number, i.status,
    COALESCE(i.adjusted_total, i.total, 0)                              AS total,
    COALESCE(i.amount_paid, 0)                                          AS amount_paid,
    COALESCE(i.adjusted_total, i.total, 0) - COALESCE(i.amount_paid, 0) AS balance,
    i.sent_at, i.due_date, i.invoice_date,
    i.qbo_invoice_id, i.qbo_sync_error,
    i.job_id, j.job_number, j.division,
    j.claim_id, cl.claim_number,
    i.contact_id, ct.name AS client_name
  FROM invoices i
  LEFT JOIN jobs     j  ON j.id  = i.job_id
  LEFT JOIN claims   cl ON cl.id = j.claim_id
  LEFT JOIN contacts ct ON ct.id = i.contact_id
  ORDER BY (COALESCE(i.adjusted_total, i.total, 0) - COALESCE(i.amount_paid, 0)) DESC,
           i.due_date NULLS LAST;
$function$;

-- Surface qbo_doc_number in the payments ledger rows.
DROP FUNCTION IF EXISTS public.get_payments_ledger(integer);
CREATE FUNCTION public.get_payments_ledger(p_limit integer DEFAULT 500)
RETURNS TABLE(payment_id uuid, amount numeric, payment_date date, payment_method text, payer_type text, payer_name text, reference_number text, is_deductible boolean, created_at timestamp with time zone, qbo_payment_id text, qbo_synced_at timestamp with time zone, qbo_sync_error text, invoice_id uuid, invoice_number text, qbo_doc_number text, job_id uuid, job_number text, division text, claim_id uuid, claim_number text, contact_id uuid, client_name text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    p.id, p.amount, p.payment_date, p.payment_method,
    p.payer_type, p.payer_name, p.reference_number,
    p.is_deductible, p.created_at,
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
$function$;

GRANT EXECUTE ON FUNCTION public.get_ar_invoices() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payments_ledger(integer) TO anon, authenticated;
