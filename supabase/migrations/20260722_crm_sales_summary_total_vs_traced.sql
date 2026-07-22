-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_sales_summary_total_vs_traced
-- Phase: n/a (standalone CRM display fix — owner ruling 2026-07-22:
--        "Show both, labeled" for the traced-gate question)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds one small read-only function that answers, for a date window, both
--   halves of the sales picture in a single query: how many jobs the COMPANY
--   sold (and for how much), and how many of those trace back to a CRM lead
--   (marketing attribution). The CRM Overview will show them side by side —
--   e.g. "1 of 2 sold · $18.7K of $577K attributed" — because only ~9% of
--   historical jobs predate the CRM and can never be traced; showing the
--   traced number alone read 30× smaller than its label implied.
--
--   Both halves use the ONE canonical sale rule (jobs.is_real_job — the
--   UPR-Web-Context.md ⭐ rule, never reinvented), the canonical sale date
--   (COALESCE(claims.created_at, jobs.created_at), matching get_jobs_closed),
--   and Denver calendar-day windowing (database-standard.md §7, matching
--   20260722_crm_denver_day_bucketing). "Traced" means crm_contact_is_traced()
--   — the same predicate the attribution RPCs already use, so the traced half
--   of this summary reconciles exactly with get_attribution_rollup's totals.
--
-- ADDITIVE-ONLY:
--   One new SECURITY DEFINER read-only function. No table/column/policy
--   change, no data change, no existing function touched.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION public.get_crm_sales_summary(date, date);
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_crm_sales_summary(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'total_won',      COUNT(*),
    'total_revenue',  COALESCE(SUM(j.invoiced_value), 0),
    'traced_won',     COUNT(*) FILTER (WHERE crm_contact_is_traced(j.primary_contact_id)),
    'traced_revenue', COALESCE(SUM(j.invoiced_value) FILTER (WHERE crm_contact_is_traced(j.primary_contact_id)), 0)
  )
  FROM jobs j
  LEFT JOIN claims cl ON cl.id = j.claim_id
  WHERE j.is_real_job = true
    AND j.status IS DISTINCT FROM 'deleted'
    AND (p_start_date IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) >= p_start_date)
    AND (p_end_date   IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) <= p_end_date);
$function$;

-- Managed-Supabase trap (database-standard.md §1): explicit revoke required.
REVOKE EXECUTE ON FUNCTION public.get_crm_sales_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_sales_summary(date, date) TO authenticated, service_role;
