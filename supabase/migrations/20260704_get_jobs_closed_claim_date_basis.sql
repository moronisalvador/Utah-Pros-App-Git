-- ─────────────────────────────────────────────────────────────────────────────
-- Re-base the "New Jobs Closed" dashboard card onto the CLAIM-created date.
--
-- WHY: get_jobs_closed previously dated each sold job by jobs.created_at (see
-- 20260630_commission_on_real_jobs.sql). That counts a job in the month its JOB
-- RECORD was entered — so spring losses back-entered in June (e.g. a March mold
-- claim invoiced late) inflated the June count. Owner decision (2026-07-04,
-- June "Jobs Closed" reconciliation): a sale should count in the month the CLAIM
-- was created, not when the job row happened to be created.
--
-- WHAT CHANGES: sale_date = COALESCE(claims.created_at, jobs.created_at). Jobs
-- with a linked claim are dated by the claim; claim-less jobs (e.g. the
-- estimate→job flow) keep jobs.created_at, where the row is created at the moment
-- of sale so created_at ≈ sale date. is_real_job stays the sole "is it sold?"
-- gate — nothing is added to or removed from the sold set; rows are only re-DATED.
-- Verified impact on June 2026: 10 → 7 (the three earlier-claim jobs R-2606-013,
-- M-2606-009, R-2606-016 move to May/March/April, still real).
--
-- SIGNATURE-PRESERVING & BACKWARD-COMPATIBLE: same args, same RETURNS TABLE
-- (job_id, sale_date, sale_source). The only live caller — the Overview card's
-- useJobsClosed.js — reads r.sale_date and buckets by period, so it keeps working
-- unchanged and simply reports the corrected month. Test: jobs_closed_claim_basis.
--
-- DELIBERATELY NOT TOUCHED: get_commissions still dates by jobs.created_at. Its
-- migration chose created_at on purpose (the 2026-06-27 backfill stamped
-- real_job_marked_at = now(), and claim-date dating would drag a sold job's
-- commission into an already-closed prior payroll period). The card is a
-- when-was-it-sold reporting view; commissions follow when the job entered the
-- system. Aligning the two is a separate, money-sensitive owner decision.
--
-- SHARED SUPABASE: one project backs dev + prod; this replace is live on both the
-- moment it applies. Backward-compatible, so no frontend deploy is required.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_jobs_closed(p_floor date DEFAULT NULL)
RETURNS TABLE (job_id uuid, sale_date timestamptz, sale_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.id,
         COALESCE(c.created_at, j.created_at) AS sale_date,
         j.real_job_source                    AS sale_source
  FROM public.jobs j
  LEFT JOIN public.claims c ON c.id = j.claim_id
  WHERE j.is_real_job = true
    AND j.status IS DISTINCT FROM 'deleted'
    AND (p_floor IS NULL OR COALESCE(c.created_at, j.created_at) >= p_floor::timestamptz)
  ORDER BY sale_date DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_jobs_closed(date) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
