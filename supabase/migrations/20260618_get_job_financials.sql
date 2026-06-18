-- ─────────────────────────────────────────────────────────────────────────────
-- get_job_financials — per-job financial rollup sourced from the invoices table.
--
-- This is the read-time source of truth for the Financials/Collections views.
-- The frontend overlays these numbers onto job objects (claimUtils.withJobFinancials),
-- falling back to the legacy jobs.invoiced_value/collected_value when a job has no
-- pushed invoices — so jobs that have never been invoiced render exactly as before.
--
--   "Invoiced" (AR clock starts) = invoice pushed to QuickBooks (qbo_invoice_id NOT NULL).
--                                  Drafts / un-pushed invoices do not count.
--   invoiced  = SUM(COALESCE(adjusted_total, total))   -- what the push worker sends
--   collected = SUM(COALESCE(amount_paid, 0))          -- 0 until QBO payment sync (2c)
--
-- Mirrors the AR-sync trigger's definitions exactly, so read-time and the denormalized
-- jobs.invoiced_value projection always agree. Additive + read-only (SECURITY DEFINER).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_job_financials(p_job_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  job_id                   uuid,
  invoice_count            integer,
  invoiced                 numeric,
  collected                numeric,
  balance_due              numeric,
  deductible               numeric,
  insurance_responsibility numeric,
  homeowner_responsibility numeric,
  depreciation_withheld    numeric,
  depreciation_released    numeric,
  invoiced_date            date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.job_id,
    count(*)::int                                          AS invoice_count,
    COALESCE(sum(COALESCE(i.adjusted_total, i.total)), 0)  AS invoiced,
    COALESCE(sum(COALESCE(i.amount_paid, 0)), 0)           AS collected,
    COALESCE(sum(
      COALESCE(i.balance_due,
               COALESCE(i.adjusted_total, i.total) - COALESCE(i.amount_paid, 0))
    ), 0)                                                  AS balance_due,
    COALESCE(sum(COALESCE(i.deductible_amount, 0)), 0)         AS deductible,
    COALESCE(sum(COALESCE(i.insurance_responsibility, 0)), 0)  AS insurance_responsibility,
    COALESCE(sum(COALESCE(i.homeowner_responsibility, 0)), 0)  AS homeowner_responsibility,
    COALESCE(sum(COALESCE(i.depreciation_withheld, 0)), 0)     AS depreciation_withheld,
    COALESCE(sum(COALESCE(i.depreciation_released, 0)), 0)     AS depreciation_released,
    min(i.qbo_synced_at)::date                                 AS invoiced_date
  FROM invoices i
  WHERE i.qbo_invoice_id IS NOT NULL
    AND i.job_id IS NOT NULL
    AND (p_job_ids IS NULL OR i.job_id = ANY (p_job_ids))
  GROUP BY i.job_id;
$$;

GRANT EXECUTE ON FUNCTION get_job_financials(uuid[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
