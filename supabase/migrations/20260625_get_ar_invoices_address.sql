-- 20260625_get_ar_invoices_address.sql
-- Surface the job's service address in the A/R dashboard rows so the redesigned
-- Collections "A/R · Outstanding" table can show it under Claim · Job.
--
-- ADDITIVE + backward-compatible: only ADDS two OUT columns (job_address, job_city);
-- every existing consumer (useCollections dashboard hook, InvoicesList) reads by
-- name and ignores the extras. DROP first — adding OUT columns changes the return
-- type, which CREATE OR REPLACE can't do (same pattern as
-- 20260620_invoice_qbo_docnumber.sql). The redesigned frontend already reads
-- job_address/job_city and renders the line only when present, so this is safe to
-- apply with the new code already live.

DROP FUNCTION IF EXISTS public.get_ar_invoices();
CREATE FUNCTION public.get_ar_invoices()
RETURNS TABLE(invoice_id uuid, invoice_number text, qbo_doc_number text, status text, total numeric, amount_paid numeric, balance numeric, sent_at timestamp with time zone, due_date date, invoice_date date, qbo_invoice_id text, qbo_sync_error text, job_id uuid, job_number text, division text, claim_id uuid, claim_number text, contact_id uuid, client_name text, job_address text, job_city text)
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
    i.contact_id, ct.name AS client_name,
    j.address AS job_address, j.city AS job_city
  FROM invoices i
  LEFT JOIN jobs     j  ON j.id  = i.job_id
  LEFT JOIN claims   cl ON cl.id = j.claim_id
  LEFT JOIN contacts ct ON ct.id = i.contact_id
  ORDER BY (COALESCE(i.adjusted_total, i.total, 0) - COALESCE(i.amount_paid, 0)) DESC,
           i.due_date NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ar_invoices() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
