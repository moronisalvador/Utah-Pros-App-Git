-- ─────────────────────────────────────────────────────────────────────────────
-- Commission foundation (lean v1).
--
-- Builds on the canonical sale definition (job_sales, 20260630_job_sales_canonical.sql)
-- so we can pay commissions: first payroll of each month, for everything SOLD the
-- previous month. The mental model is intentionally simple:
--   Each job is sold by ONE person, on a date, for the invoice amount.
--   Each salesperson has a rate (a % of the sale, or a flat $ per sale).
--   Each month = each person's jobs sold last month × their rate.
--
-- Salesperson is DERIVED from the sale event (no manual entry): the estimate's
-- created_by (estimate conversion) or the sign_request's sent_by (signed doc).
-- A rate set on an employee IS the "is a salesperson" flag — no separate flag,
-- no basis enum, no payout-lock table (those are Phase 2, only when needed).
--
-- Additive + read-only-ish (view replace + 2 nullable columns + 1 RPC), inert
-- until rates are set — safe on the shared Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. job_sales += sold_by (the person on the EARLIEST qualifying sale event) ────
CREATE OR REPLACE VIEW public.job_sales AS
WITH s AS (
  SELECT e.job_id,
         COALESCE(e.approved_at, e.updated_at, e.created_at) AS sale_date,
         'estimate_sold'::text                               AS sale_source,
         e.created_by                                        AS sold_by
  FROM estimates e
  WHERE e.converted_invoice_id IS NOT NULL
    AND e.job_id IS NOT NULL
  UNION ALL
  SELECT sr.job_id,
         COALESCE(sr.signed_at, sr.updated_at) AS sale_date,
         'work_auth_signed'::text              AS sale_source,
         sr.sent_by                            AS sold_by
  FROM sign_requests sr
  WHERE sr.status = 'signed'
    AND sr.doc_type IN ('work_auth', 'recon_agreement')
    AND sr.job_id IS NOT NULL
)
SELECT s.job_id,
       MIN(s.sale_date)                                   AS sale_date,
       (array_agg(s.sale_source ORDER BY s.sale_date))[1] AS first_sale_source,
       (array_agg(s.sold_by     ORDER BY s.sale_date))[1] AS sold_by
FROM s
WHERE s.sale_date IS NOT NULL
GROUP BY s.job_id;

GRANT SELECT ON public.job_sales TO authenticated;

-- 2. Per-employee commission rate (a rate set ⇒ earns; null ⇒ doesn't) ─────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS commission_percent numeric,  -- e.g. 8 = 8% of the sale
  ADD COLUMN IF NOT EXISTS commission_flat    numeric;  -- flat $ per sale; wins over percent

-- 3. get_commissions — THE one place a commission is ever computed ─────────────
-- Returns every sold job in the month (attributed or not) so unattributed sales
-- (no recorded salesperson, or salesperson has no rate) are VISIBLE, not dropped.
CREATE OR REPLACE FUNCTION public.get_commissions(p_month date DEFAULT NULL)
RETURNS TABLE (
  employee_id       uuid,
  employee_name     text,
  job_id            uuid,
  job_number        text,
  division          text,
  sale_date         timestamptz,
  sale_source       text,
  base              numeric,
  commission        numeric,
  commission_period date,
  is_attributed     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH inv AS (
    SELECT i.job_id, SUM(COALESCE(i.adjusted_total, i.total, 0)) AS base
    FROM invoices i
    GROUP BY i.job_id
  )
  SELECT
    js.sold_by                                            AS employee_id,
    emp.full_name                                         AS employee_name,
    js.job_id,
    j.job_number,
    j.division::text                                      AS division,
    js.sale_date,
    js.first_sale_source                                  AS sale_source,
    COALESCE(iv.base, 0)                                  AS base,
    CASE
      WHEN emp.commission_flat    IS NOT NULL THEN emp.commission_flat
      WHEN emp.commission_percent IS NOT NULL THEN round(COALESCE(iv.base, 0) * emp.commission_percent / 100.0, 2)
      ELSE 0
    END                                                   AS commission,
    date_trunc('month', js.sale_date)::date               AS commission_period,
    (js.sold_by IS NOT NULL
       AND (emp.commission_percent IS NOT NULL OR emp.commission_flat IS NOT NULL)) AS is_attributed
  FROM public.job_sales js
  JOIN public.jobs j        ON j.id  = js.job_id AND j.status IS DISTINCT FROM 'deleted'
  LEFT JOIN public.employees emp ON emp.id = js.sold_by
  LEFT JOIN inv iv          ON iv.job_id = js.job_id
  WHERE p_month IS NULL
     OR date_trunc('month', js.sale_date) = date_trunc('month', p_month::timestamptz)
  ORDER BY js.sale_date DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_commissions(date) TO authenticated;

-- 4. Bust PostgREST schema cache ──────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
