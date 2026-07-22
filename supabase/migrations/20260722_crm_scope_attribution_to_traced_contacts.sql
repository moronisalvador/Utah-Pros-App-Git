-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_scope_attribution_to_traced_contacts
-- Phase: n/a (standalone production fix — CRM funnel consistency, owner-directed)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Scopes every CRM "attribution" number (estimates, won jobs, revenue) to
--   business that can actually be traced back to a CRM lead — instead of
--   counting every estimate/job/dollar in the whole company. Live check on
--   2026-07-21 found only 30 of 127 won jobs (24%), $18,752 of $314,983 in
--   revenue (6%), and 10 of 43 estimates (23%) trace to a CRM lead touch at
--   all — the rest is real business (direct insurance assignment, phone
--   referrals a staffer handled without logging the call, jobs entered
--   straight into Jobs/Estimates) that never goes through the CRM. Counting
--   it anyway made the funnel look broken (more "won jobs" than "leads") and
--   made the whole CRM dashboard read as unreliable. The owner's explicit
--   call: scope everything to CRM-traceable business only, so leads →
--   estimates → won → revenue are always the SAME population, nested
--   correctly. (Two related metrics are DELIBERATELY NOT touched here —
--   get_contact_ltv and get_estimate_aging answer a genuinely different
--   question — see the NOTES below.)
--
--   New helper: crm_contact_is_traced(p_contact_id) — true only when that
--   contact has an actual, legitimate CRM touch: a lead_attribution row, or
--   a NON-SPAM inbound_leads.contact_id link (a spam-flagged call is not a
--   real channel touch, so it alone doesn't count). A null contact_id (a
--   job/estimate with no linked contact at all) is never traced.
--
--   Rescoped (added "AND crm_contact_is_traced(...)" to the existing WHERE):
--     get_attribution_rollup   — est_agg + job_agg (leads_agg is untouched;
--                                 it already only counts inbound_leads rows).
--     get_crm_revenue_by_division — its jobs query.
--     get_conversion_trend     — est_c + job_c (lead_c is untouched, same
--                                 reason as leads_agg above).
--     get_estimator_leaderboard — its whole WHERE clause (both total_jobs AND
--                                 won_jobs must share the SAME population, or
--                                 an estimator's win rate would be distorted
--                                 by a denominator that includes untraced
--                                 jobs while the numerator excludes them).
--
--   NOT rescoped (a deliberate, disclosed decision, not an oversight):
--     get_contact_ltv    — lifetime value is about a customer we ALREADY
--                           know, not attribution. A repeat customer who
--                           found us via a tracked ad but booked job #2/#3
--                           directly is still the same valuable customer;
--                           cutting their LTV to only the traced job would
--                           defeat the point of the metric.
--     get_estimate_aging — an operational "these estimates are going stale,
--                           follow up" tool. Staff need to see ALL open
--                           estimates at risk, not just CRM-sourced ones —
--                           narrowing this would hide 77% of the real
--                           follow-up work from the people who act on it.
--
-- ADDITIVE-ONLY / attribute-only:
--   One NEW function (crm_contact_is_traced) + four function-body-only
--   CREATE OR REPLACE statements. Every replaced function's SIGNATURE and
--   RETURN SHAPE are UNCHANGED — only which rows count changed (an added
--   WHERE condition). Every existing caller (CrmOverview.jsx, CrmAttribution.
--   jsx, CrmReports.jsx) keeps working with no code change. No table DROP/
--   RENAME/ALTER COLUMN, no data change. GRANT/REVOKE on the four replaced
--   functions is unchanged (still TO authenticated, service_role — never
--   anon); the new helper follows the identical least-privilege pattern.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   1. Re-apply each of the four functions' prior body via its own
--      CREATE OR REPLACE FUNCTION (removing the added
--      "AND crm_contact_is_traced(...)" condition) — the exact prior bodies
--      are preserved in git history at this file's prior commit:
--        get_attribution_rollup      → 20260721_crm_attribution_excludes_merged_leads.sql
--        get_crm_revenue_by_division → 20260701_crm_phase3_attribution.sql
--        get_conversion_trend        → 20260708_dbf_p6_timezone_rpc_bodies.sql (NOT
--                                        20260702_crm_phase9_intelligence_rpcs.sql — P6
--                                        already replaced this function's date bucketing
--                                        to use mt_today()/America-Denver in place of
--                                        UTC/CURRENT_DATE; this migration's own body
--                                        builds on that P6 version, and rolling back to
--                                        the pre-P6 body would silently reintroduce the
--                                        UTC-bucketing bug)
--        get_estimator_leaderboard   → 20260702_crm_phase9_intelligence_rpcs.sql
--   2. DROP FUNCTION public.crm_contact_is_traced(uuid); — safe only after
--      step 1, since the four functions above call it.
-- ════════════════════════════════════════════════

-- ─── New helper: is this contact traceable to an actual CRM lead? ──────────
CREATE OR REPLACE FUNCTION public.crm_contact_is_traced(p_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_contact_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM lead_attribution la WHERE la.contact_id = p_contact_id)
    OR EXISTS (
      SELECT 1 FROM inbound_leads il
      WHERE il.contact_id = p_contact_id AND COALESCE(il.spam_flag, false) = false
    )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_contact_is_traced(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_contact_is_traced(uuid) TO authenticated, service_role;

-- ─── get_attribution_rollup — est_agg + job_agg scoped to traced contacts ──
CREATE OR REPLACE FUNCTION public.get_attribution_rollup(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(channel text, spend numeric, leads bigint, estimates bigint, won_jobs bigint, revenue numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  RETURN QUERY
  WITH channels(channel) AS (
    VALUES ('google_ads'),('meta_ads'),('organic'),('referral'),('insurance'),('other')
  ),
  contact_channel AS (
    SELECT c.id AS contact_id,
           COALESCE(
             (SELECT la.channel FROM lead_attribution la
               WHERE la.contact_id = c.id
               ORDER BY la.occurred_at DESC LIMIT 1),
             crm_channel_for_source(c.referral_source)
           ) AS channel
    FROM contacts c
  ),
  spend_agg AS (
    SELECT CASE s.platform WHEN 'google' THEN 'google_ads' WHEN 'meta' THEN 'meta_ads' ELSE 'other' END AS channel,
           SUM(s.spend) AS spend
    FROM ad_spend s
    WHERE s.org_id = v_org
      AND (p_start_date IS NULL OR s.date >= p_start_date)
      AND (p_end_date   IS NULL OR s.date <= p_end_date)
    GROUP BY 1
  ),
  leads_agg AS (
    SELECT COALESCE(
             (SELECT la.channel FROM lead_attribution la
               WHERE la.lead_id = il.id ORDER BY la.occurred_at DESC LIMIT 1),
             NULLIF(crm_channel_for_source(il.source), 'other'),
             cc.channel,
             'other'
           ) AS channel,
           COUNT(*) AS leads
    FROM inbound_leads il
    LEFT JOIN contact_channel cc ON cc.contact_id = il.contact_id
    WHERE il.org_id = v_org
      AND COALESCE(il.spam_flag, false) = false
      AND il.merged_into_lead_id IS NULL
      AND (p_start_date IS NULL OR il.occurred_at >= p_start_date::timestamptz)
      AND (p_end_date   IS NULL OR il.occurred_at <  (p_end_date + 1)::timestamptz)
    GROUP BY 1
  ),
  est_agg AS (
    SELECT COALESCE(cc.channel, 'other') AS channel, COUNT(DISTINCT e.id) AS estimates
    FROM estimates e
    LEFT JOIN contact_channel cc ON cc.contact_id = e.contact_id
    WHERE e.status IS DISTINCT FROM 'draft'
      AND crm_contact_is_traced(e.contact_id)
      AND (p_start_date IS NULL OR e.created_at >= p_start_date::timestamptz)
      AND (p_end_date   IS NULL OR e.created_at <  (p_end_date + 1)::timestamptz)
    GROUP BY 1
  ),
  job_agg AS (
    SELECT COALESCE(cc.channel, 'other') AS channel,
           COUNT(DISTINCT j.id) AS won_jobs,
           COALESCE(SUM(j.invoiced_value), 0) AS revenue
    FROM jobs j
    LEFT JOIN contact_channel cc ON cc.contact_id = j.primary_contact_id
    WHERE j.phase <> 'lead' AND j.status <> 'deleted'
      AND crm_contact_is_traced(j.primary_contact_id)
      AND (p_start_date IS NULL OR j.created_at >= p_start_date::timestamptz)
      AND (p_end_date   IS NULL OR j.created_at <  (p_end_date + 1)::timestamptz)
    GROUP BY 1
  )
  SELECT ch.channel,
         COALESCE(sp.spend, 0)::numeric,
         COALESCE(l.leads, 0)::bigint,
         COALESCE(e.estimates, 0)::bigint,
         COALESCE(j.won_jobs, 0)::bigint,
         COALESCE(j.revenue, 0)::numeric
  FROM channels ch
  LEFT JOIN spend_agg sp ON sp.channel = ch.channel
  LEFT JOIN leads_agg l  ON l.channel  = ch.channel
  LEFT JOIN est_agg   e  ON e.channel  = ch.channel
  LEFT JOIN job_agg   j  ON j.channel  = ch.channel
  ORDER BY COALESCE(sp.spend,0) DESC, COALESCE(j.revenue,0) DESC, ch.channel;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_attribution_rollup(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attribution_rollup(date, date, uuid) TO authenticated, service_role;

-- ─── get_crm_revenue_by_division — scoped to traced contacts ──────────────
CREATE OR REPLACE FUNCTION public.get_crm_revenue_by_division(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
RETURNS TABLE(division text, won_jobs bigint, revenue numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT j.division::text,
         COUNT(*)::bigint,
         COALESCE(SUM(j.invoiced_value), 0)::numeric
  FROM jobs j
  WHERE j.phase <> 'lead' AND j.status <> 'deleted'
    AND crm_contact_is_traced(j.primary_contact_id)
    AND (p_start_date IS NULL OR j.created_at >= p_start_date::timestamptz)
    AND (p_end_date   IS NULL OR j.created_at <  (p_end_date + 1)::timestamptz)
  GROUP BY j.division
  ORDER BY 3 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_crm_revenue_by_division(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_revenue_by_division(date, date) TO authenticated, service_role;

-- ─── get_conversion_trend — est_c + job_c scoped to traced contacts ────────
CREATE OR REPLACE FUNCTION public.get_conversion_trend(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_start date;
  v_end   date;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_end   := COALESCE(p_end, public.mt_today());
  v_start := COALESCE(p_start, (date_trunc('month', v_end::timestamptz) - interval '11 months')::date);

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(date_trunc('month', v_start::timestamptz),
                           date_trunc('month', v_end::timestamptz),
                           interval '1 month') AS m
  ),
  lead_c AS (
    SELECT date_trunc('month', COALESCE(il.occurred_at, il.created_at)) AS m, COUNT(*) AS c
    FROM inbound_leads il
    WHERE il.org_id = v_org AND COALESCE(il.spam_flag, false) = false
      AND COALESCE(il.occurred_at, il.created_at) >= v_start::timestamptz
      AND COALESCE(il.occurred_at, il.created_at) <  (v_end + 1)::timestamptz
    GROUP BY 1
  ),
  est_c AS (
    SELECT date_trunc('month', e.created_at) AS m, COUNT(*) AS c
    FROM estimates e
    WHERE e.status IS DISTINCT FROM 'draft'
      AND crm_contact_is_traced(e.contact_id)
      AND e.created_at >= v_start::timestamptz AND e.created_at < (v_end + 1)::timestamptz
    GROUP BY 1
  ),
  job_c AS (
    SELECT date_trunc('month', j.created_at) AS m, COUNT(*) AS c, COALESCE(SUM(j.invoiced_value), 0) AS rev
    FROM jobs j
    WHERE j.phase <> 'lead' AND j.status <> 'deleted'
      AND crm_contact_is_traced(j.primary_contact_id)
      AND j.created_at >= v_start::timestamptz AND j.created_at < (v_end + 1)::timestamptz
    GROUP BY 1
  )
  SELECT json_build_object(
    'period',       to_char(months.m, 'YYYY-MM'),
    'period_start', months.m::date,
    'leads',        COALESCE(lead_c.c, 0),
    'estimates',    COALESCE(est_c.c, 0),
    'won_jobs',     COALESCE(job_c.c, 0),
    'revenue',      COALESCE(job_c.rev, 0)
  )
  FROM months
  LEFT JOIN lead_c ON lead_c.m = months.m
  LEFT JOIN est_c  ON est_c.m  = months.m
  LEFT JOIN job_c  ON job_c.m  = months.m
  ORDER BY months.m;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conversion_trend(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversion_trend(date, date, uuid) TO authenticated, service_role;

-- ─── get_estimator_leaderboard — whole WHERE clause scoped (see WHAT above) ─
CREATE OR REPLACE FUNCTION public.get_estimator_leaderboard(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT json_build_object(
    'estimator',  j.estimator,
    'total_jobs', COUNT(*),
    'won_jobs',   COUNT(*) FILTER (WHERE j.phase <> 'lead'),
    'revenue',    COALESCE(SUM(j.invoiced_value) FILTER (WHERE j.phase <> 'lead'), 0)
  )
  FROM jobs j
  WHERE j.estimator IS NOT NULL AND btrim(j.estimator) <> '' AND j.status <> 'deleted'
    AND crm_contact_is_traced(j.primary_contact_id)
    AND (p_start IS NULL OR j.created_at >= p_start::timestamptz)
    AND (p_end   IS NULL OR j.created_at <  (p_end + 1)::timestamptz)
  GROUP BY j.estimator
  ORDER BY COALESCE(SUM(j.invoiced_value) FILTER (WHERE j.phase <> 'lead'), 0) DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_estimator_leaderboard(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_estimator_leaderboard(date, date, uuid) TO authenticated, service_role;
