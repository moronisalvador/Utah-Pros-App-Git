-- ─────────────────────────────────────────────────────────────────────────────
-- Reconcile sales/commissions onto the canonical is_real_job flag.
--
-- Two efforts independently built "what's a real/sold job": main's
-- `jobs.is_real_job` (20260627_real_job_classification.sql — flag + triggers +
-- manual override, also used by billing) and this branch's `job_sales` view.
-- To avoid two competing definitions (and the confusion that causes), we keep
-- ONE source of truth — `is_real_job` — and rebuild the "New Jobs Closed" card
-- and commissions on top of it. The `job_sales` view is retired here.
--
-- DATING: a sold job is dated by `jobs.created_at`, NOT `real_job_marked_at`.
-- main's backfill stamped real_job_marked_at = now() for every pre-existing real
-- job, so dating by it would (a) bunch all history onto the backfill date and
-- (b) dump every old job into the first commission payroll. created_at is stable,
-- and in the estimate→job flow the job row is created at the moment of sale, so
-- created_at ≈ the sale date going forward.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. get_jobs_closed — one row per REAL (sold) job since a floor date ──────────
CREATE OR REPLACE FUNCTION public.get_jobs_closed(p_floor date DEFAULT NULL)
RETURNS TABLE (job_id uuid, sale_date timestamptz, sale_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.id,
         j.created_at        AS sale_date,
         j.real_job_source   AS sale_source
  FROM public.jobs j
  WHERE j.is_real_job = true
    AND j.status IS DISTINCT FROM 'deleted'
    AND (p_floor IS NULL OR j.created_at >= p_floor::timestamptz)
  ORDER BY j.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_jobs_closed(date) TO anon, authenticated;

-- 2. get_commissions — per-real-job commission for a month ─────────────────────
-- Salesperson is DERIVED per job: the signed work-auth/recon sender, else the
-- approved estimate's creator. Unattributed sales (no person, or no rate) are
-- returned with is_attributed=false so they're visible, not silently dropped.
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
    FROM public.invoices i
    GROUP BY i.job_id
  ),
  sold AS (
    SELECT j.id AS job_id,
           COALESCE(
             (SELECT sr.sent_by FROM public.sign_requests sr
               WHERE sr.job_id = j.id AND sr.status = 'signed'
                 AND sr.doc_type IN ('work_auth','recon_agreement') AND sr.sent_by IS NOT NULL
               ORDER BY sr.signed_at NULLS LAST LIMIT 1),
             (SELECT e.created_by FROM public.estimates e
               WHERE e.job_id = j.id AND e.created_by IS NOT NULL
                 AND lower(COALESCE(e.status,'')) IN ('approved','accepted','converted','signed')
               ORDER BY e.approved_at NULLS LAST LIMIT 1)
           ) AS sold_by
    FROM public.jobs j
    WHERE j.is_real_job = true AND j.status IS DISTINCT FROM 'deleted'
  )
  SELECT
    sd.sold_by                                            AS employee_id,
    emp.full_name                                         AS employee_name,
    j.id                                                  AS job_id,
    j.job_number,
    j.division::text                                      AS division,
    j.created_at                                          AS sale_date,
    j.real_job_source                                     AS sale_source,
    COALESCE(iv.base, 0)                                  AS base,
    CASE
      WHEN emp.commission_flat    IS NOT NULL THEN emp.commission_flat
      WHEN emp.commission_percent IS NOT NULL THEN round(COALESCE(iv.base, 0) * emp.commission_percent / 100.0, 2)
      ELSE 0
    END                                                   AS commission,
    date_trunc('month', j.created_at)::date               AS commission_period,
    (sd.sold_by IS NOT NULL
       AND (emp.commission_percent IS NOT NULL OR emp.commission_flat IS NOT NULL)) AS is_attributed
  FROM public.jobs j
  JOIN sold sd              ON sd.job_id = j.id
  LEFT JOIN public.employees emp ON emp.id = sd.sold_by
  LEFT JOIN inv iv          ON iv.job_id = j.id
  WHERE j.is_real_job = true AND j.status IS DISTINCT FROM 'deleted'
    AND (p_month IS NULL
         OR date_trunc('month', j.created_at) = date_trunc('month', p_month::timestamptz))
  ORDER BY j.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_commissions(date) TO authenticated;

-- 3. Retire the duplicate sale definition ─────────────────────────────────────
DROP VIEW IF EXISTS public.job_sales;

NOTIFY pgrst, 'reload schema';
