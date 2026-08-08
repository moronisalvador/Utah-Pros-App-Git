-- ════════════════════════════════════════════════
-- ROLLBACK: 20260807230000_office_financial_read_boundary
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the six money reports back exactly as they were before the boundary was
--   added: plain SQL functions with no permission check. Running this DELIBERATELY
--   RE-OPENS the gap — every logged-in employee, field technicians included, can
--   again read accounts receivable, the payment ledger, cash received, average
--   ticket, revenue by division and the sales pipeline straight from the database.
--   Only run it if the guard is actively breaking something.
--
--   Each body below is the EXACT pre-migration definition captured from
--   pg_proc.prosrc on 2026-08-07, with these md5s:
--     get_ar_invoices          67f652d7b8159b24c9d4233008f97b2f
--     get_avg_ticket           a7004cec5395335cb1ecdf0526fb5d29
--     get_payments_ledger      ed4b89f59aaa48a80abd3be794d27117
--     get_payments_received    706571ee4ad29f8b95139ea584330af3
--     get_pipeline_summary     56959316aa6902d44dcac8945d00ff9e
--     get_revenue_by_division  cf692bf18799d374a1cd54f6c4c807de
--   Verify with:
--     SELECT proname, md5(prosrc) FROM pg_proc p JOIN pg_namespace n
--       ON n.oid = p.pronamespace WHERE n.nspname = 'public'
--       AND proname IN (...);
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_ar_invoices()
RETURNS TABLE(invoice_id uuid, invoice_number text, qbo_doc_number text, status text,
  total numeric, amount_paid numeric, balance numeric, sent_at timestamp with time zone,
  due_date date, invoice_date date, qbo_invoice_id text, qbo_sync_error text, job_id uuid,
  job_number text, division text, claim_id uuid, claim_number text, contact_id uuid,
  client_name text, job_address text, job_city text, created_at timestamp with time zone)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_ar_invoices() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ar_invoices() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_payments_ledger(p_limit integer DEFAULT 500)
RETURNS TABLE(payment_id uuid, amount numeric, payment_date date, payment_method text,
  payer_type text, payer_name text, reference_number text, is_deductible boolean,
  created_at timestamp with time zone, source text, qbo_payment_id text,
  qbo_synced_at timestamp with time zone, qbo_sync_error text, invoice_id uuid,
  invoice_number text, qbo_doc_number text, job_id uuid, job_number text, division text,
  claim_id uuid, claim_number text, contact_id uuid, client_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_payments_ledger(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_payments_ledger(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_payments_received(p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_payments_received(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_payments_received(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_avg_ticket(p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_avg_ticket(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_avg_ticket(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_revenue_by_division(p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_revenue_by_division(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_revenue_by_division(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_pipeline_summary()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('stages', jsonb_build_array(
    jsonb_build_object('label','New / FNOL','count',
      (SELECT count(*) FROM jobs WHERE phase = 'job_received' AND status IS DISTINCT FROM 'deleted')),
    jsonb_build_object('label','In production','count',
      (SELECT count(*) FROM jobs WHERE phase = 'reconstruction_in_progress' AND status IS DISTINCT FROM 'deleted')),
    jsonb_build_object('label','Invoiced','count',
      (SELECT count(DISTINCT job_id) FROM invoices WHERE qbo_invoice_id IS NOT NULL)),
    jsonb_build_object('label','Paid','count',
      (SELECT count(DISTINCT job_id) FROM invoices WHERE status = 'paid'))
  ));
$$;

REVOKE EXECUTE ON FUNCTION public.get_pipeline_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pipeline_summary() TO authenticated;
