-- ════════════════════════════════════════════════
-- MIGRATION: 20260713_uxq_fb_get_jobs_list
-- Phase: UX-Quality F-B (backend foundation)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds one database helper that returns the jobs list for the Jobs and
--   Production screens with three improvements over today's query: it returns a
--   trimmed set of columns (only what the list cards show, ~31 instead of ~52),
--   it searches on the server (name / job # / address / claim # / insurer) instead
--   of pulling every job to the browser, and it pages the results (limit + offset)
--   with a total count so the list can grow without loading everything at once.
--
-- ADDITIVE-ONLY:
--   New read-only SECURITY DEFINER function only. No table change, no data change,
--   no writes. Least-privilege grants (authenticated + service_role; never anon).
--   Named columns only — no SELECT *.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_jobs_list(text, integer, integer);
--   (Jobs.jsx / Production.jsx keep working on their existing db.select('jobs',…)
--    query until swapped to this RPC, so dropping it is safe pre-cutover.)
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_jobs_list(
  p_search text    DEFAULT NULL,
  p_limit  integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS SETOF json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT to_json(t) FROM (
    SELECT
      j.id, j.job_number, j.insured_name, j.phase, j.division, j.source, j.status,
      j.address, j.city, j.state, j.zip, j.claim_number, j.insurance_company,
      j.date_of_loss, j.received_date, j.target_completion,
      j.project_manager, j.project_manager_id, j.lead_tech_id,
      j.estimated_value, j.approved_value, j.invoiced_value, j.collected_value,
      j.priority, j.tags, j.is_cat_loss, j.has_asbestos, j.has_lead,
      j.phase_entered_at, j.created_at, j.updated_at,
      -- Total matching rows (pre-LIMIT) for pagination; window runs before LIMIT.
      count(*) OVER() AS total_count
    FROM public.jobs j
    WHERE j.status <> 'deleted'
      AND (
        p_search IS NULL OR btrim(p_search) = '' OR
        j.insured_name      ILIKE '%' || btrim(p_search) || '%' OR
        j.job_number        ILIKE '%' || btrim(p_search) || '%' OR
        j.address           ILIKE '%' || btrim(p_search) || '%' OR
        j.claim_number      ILIKE '%' || btrim(p_search) || '%' OR
        j.insurance_company ILIKE '%' || btrim(p_search) || '%'
      )
    ORDER BY j.created_at DESC
    LIMIT  GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_jobs_list(text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_jobs_list(text, integer, integer) TO authenticated, service_role;
