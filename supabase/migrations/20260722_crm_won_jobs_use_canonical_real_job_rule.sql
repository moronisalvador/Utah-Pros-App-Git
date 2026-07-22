-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_won_jobs_use_canonical_real_job_rule
-- Phase: n/a (standalone CRM correctness fix — owner-caught live)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes the CRM's "won jobs" and "revenue" numbers use the SAME definition
--   of a sale that the rest of the company already uses, instead of the
--   home-grown guess they were built on.
--
--   UPR has ONE canonical rule for what counts as a sale, documented in
--   UPR-Web-Context.md ("⭐ What counts as a SALE / REAL JOB (THE canonical
--   rule — all reporting must use this)"): a job is a real sale when
--   `jobs.is_real_job = true` — auto-set when a work-auth/recon agreement is
--   SIGNED, a QBO invoice is created, or an estimate is APPROVED (migration
--   20260627_real_job_classification.sql). That doc says, verbatim: "Billing,
--   the 'New Jobs Closed' card (get_jobs_closed), and commissions all read
--   is_real_job — NEVER REINVENT IT."
--
--   The CRM analytics layer reinvented it anyway. All five CRM reporting RPCs
--   counted a won job as `jobs.phase <> 'lead'` — i.e. "a job record exists
--   that isn't a lead anymore". But `job_received` (the phase a job enters the
--   moment work is booked, INCLUDING a free inspection) satisfies that. So a
--   booked free inspection was being reported as a won job. Verified live
--   2026-07-22: the CRM Overview showed 12 "won jobs" in a 7-day window, and
--   every one of them was phase='job_received' with null/$0 invoiced value —
--   which is also why "Revenue" read $0 right next to "12 won jobs", the two
--   numbers quietly contradicting each other. Under the canonical rule the
--   honest number for that same window is 1 (a signed work_auth). All-time
--   CRM-traced: 31 → 8.
--
--   Second half of the same bug: these RPCs dated a sale by `jobs.created_at`
--   (when the ROW was created), so the date picker never meant "won in this
--   window" at all. The canonical reporting view (get_jobs_closed) dates a
--   sale by COALESCE(claims.created_at, jobs.created_at) — the claim-created
--   date, owner decision 2026-07-04, so a spring loss back-entered as a June
--   job record doesn't count as a June sale. These now match it exactly.
--   (get_commissions deliberately keeps jobs.created_at — that is a separate,
--   money-sensitive decision documented in UPR-Web-Context.md and is NOT
--   touched here.)
--
--   Also swaps `status <> 'deleted'` for `status IS DISTINCT FROM 'deleted'`
--   in these five, matching get_jobs_closed — the `<>` form evaluates to NULL
--   (excluding the row) for a NULL status. No job currently has a NULL status,
--   so this is a latent-bug fix, not a live behavior change.
--
-- ADDITIVE-ONLY:
--   Function-body-only CREATE OR REPLACE of five CRM reporting RPCs
--   (get_attribution_rollup, get_conversion_trend, get_crm_revenue_by_division,
--   get_estimator_leaderboard, get_contact_ltv). Every signature is
--   byte-for-byte unchanged. No table/column/policy change, no data change.
--   The canonical rule itself (jobs.is_real_job, its triggers, get_jobs_closed,
--   get_commissions) is CONSUMED, never modified — this migration is what
--   brings the CRM into line with it, not a redefinition of it.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply each function's prior body, which differs from the new one ONLY
--   in these three mechanical substitutions (revert each to restore):
--     1. `j.is_real_job = true`            → `j.phase <> 'lead'`
--     2. `j.status IS DISTINCT FROM 'deleted'` → `j.status <> 'deleted'`
--     3. `COALESCE(c.created_at, j.created_at)` → `j.created_at`
--        (and drop the accompanying `LEFT JOIN claims c ON c.id = j.claim_id`)
--   No schema or data is touched, so a rollback is purely these five bodies.
-- ════════════════════════════════════════════════

-- 1. get_attribution_rollup — the Overview headline "Won jobs" + "Revenue".
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
      AND (il.source_type <> 'call' OR public.crm_call_is_answered(il.raw_payload, il.duration_sec))
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
  -- CANONICAL SALE RULE (UPR-Web-Context.md ⭐): is_real_job gates the SET,
  -- COALESCE(claim.created_at, job.created_at) dates it — identical to
  -- get_jobs_closed, the company's "when-sold" reporting view.
  job_agg AS (
    SELECT COALESCE(cc.channel, 'other') AS channel,
           COUNT(DISTINCT j.id) AS won_jobs,
           COALESCE(SUM(j.invoiced_value), 0) AS revenue
    FROM jobs j
    LEFT JOIN claims cl ON cl.id = j.claim_id
    LEFT JOIN contact_channel cc ON cc.contact_id = j.primary_contact_id
    WHERE j.is_real_job = true AND j.status IS DISTINCT FROM 'deleted'
      AND crm_contact_is_traced(j.primary_contact_id)
      AND (p_start_date IS NULL OR COALESCE(cl.created_at, j.created_at) >= p_start_date::timestamptz)
      AND (p_end_date   IS NULL OR COALESCE(cl.created_at, j.created_at) <  (p_end_date + 1)::timestamptz)
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

-- 2. get_conversion_trend — the Overview trend chart's won/revenue bars.
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
      AND (il.source_type <> 'call' OR public.crm_call_is_answered(il.raw_payload, il.duration_sec))
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
  -- CANONICAL SALE RULE (see job_agg note in get_attribution_rollup).
  job_c AS (
    SELECT date_trunc('month', COALESCE(cl.created_at, j.created_at)) AS m,
           COUNT(*) AS c,
           COALESCE(SUM(j.invoiced_value), 0) AS rev
    FROM jobs j
    LEFT JOIN claims cl ON cl.id = j.claim_id
    WHERE j.is_real_job = true AND j.status IS DISTINCT FROM 'deleted'
      AND crm_contact_is_traced(j.primary_contact_id)
      AND COALESCE(cl.created_at, j.created_at) >= v_start::timestamptz
      AND COALESCE(cl.created_at, j.created_at) <  (v_end + 1)::timestamptz
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

-- 3. get_crm_revenue_by_division — the Overview "Won jobs by division" donut.
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
  LEFT JOIN claims cl ON cl.id = j.claim_id
  WHERE j.is_real_job = true AND j.status IS DISTINCT FROM 'deleted'
    AND crm_contact_is_traced(j.primary_contact_id)
    AND (p_start_date IS NULL OR COALESCE(cl.created_at, j.created_at) >= p_start_date::timestamptz)
    AND (p_end_date   IS NULL OR COALESCE(cl.created_at, j.created_at) <  (p_end_date + 1)::timestamptz)
  GROUP BY j.division
  ORDER BY 3 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_crm_revenue_by_division(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_revenue_by_division(date, date) TO authenticated, service_role;

-- 4. get_estimator_leaderboard — Reports. `total_jobs` stays every opportunity
--    the estimator touched (that is the denominator, deliberately not a sale
--    count); only the WON half adopts the canonical rule.
CREATE OR REPLACE FUNCTION public.get_estimator_leaderboard(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  -- `total_jobs` is the DENOMINATOR — every opportunity the estimator touched —
  -- so it stays windowed by `j.created_at` (when the opportunity entered the
  -- system). Only the WON half is a sale, so only it is gated by is_real_job
  -- AND dated by the canonical sale date. Keeping the claim-date substitution
  -- out of the outer WHERE is deliberate: putting it there silently re-windows
  -- the denominator too (caught by migration-safety-checker, 2026-07-22).
  SELECT json_build_object(
    'estimator',  j.estimator,
    'total_jobs', COUNT(*),
    'won_jobs',   COUNT(*) FILTER (
                    WHERE j.is_real_job = true
                      AND (p_start IS NULL OR COALESCE(cl.created_at, j.created_at) >= p_start::timestamptz)
                      AND (p_end   IS NULL OR COALESCE(cl.created_at, j.created_at) <  (p_end + 1)::timestamptz)),
    'revenue',    COALESCE(SUM(j.invoiced_value) FILTER (
                    WHERE j.is_real_job = true
                      AND (p_start IS NULL OR COALESCE(cl.created_at, j.created_at) >= p_start::timestamptz)
                      AND (p_end   IS NULL OR COALESCE(cl.created_at, j.created_at) <  (p_end + 1)::timestamptz)), 0)
  )
  FROM jobs j
  LEFT JOIN claims cl ON cl.id = j.claim_id
  WHERE j.estimator IS NOT NULL AND btrim(j.estimator) <> ''
    AND j.status IS DISTINCT FROM 'deleted'
    AND crm_contact_is_traced(j.primary_contact_id)
    AND (p_start IS NULL OR j.created_at >= p_start::timestamptz)
    AND (p_end   IS NULL OR j.created_at <  (p_end + 1)::timestamptz)
  GROUP BY j.estimator
  ORDER BY COALESCE(SUM(j.invoiced_value) FILTER (
             WHERE j.is_real_job = true
               AND (p_start IS NULL OR COALESCE(cl.created_at, j.created_at) >= p_start::timestamptz)
               AND (p_end   IS NULL OR COALESCE(cl.created_at, j.created_at) <  (p_end + 1)::timestamptz)), 0) DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_estimator_leaderboard(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_estimator_leaderboard(date, date, uuid) TO authenticated, service_role;

-- 5. get_contact_ltv — Reports "top customers by lifetime value". Lifetime
--    value must be built on real sales, not on booked inspections. (This RPC
--    stays intentionally NOT CRM-traced-scoped — a separate, previously
--    documented decision in CrmReports.jsx — only the sale rule changes here.)
CREATE OR REPLACE FUNCTION public.get_contact_ltv(p_contact_id uuid DEFAULT NULL::uuid, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH won AS (
    SELECT j.primary_contact_id AS cid,
           COUNT(*) AS jobs,
           COALESCE(SUM(j.invoiced_value), 0) AS revenue,
           MIN(COALESCE(cl.created_at, j.created_at)) AS first_job_at,
           MAX(COALESCE(cl.created_at, j.created_at)) AS last_job_at
    FROM jobs j
    LEFT JOIN claims cl ON cl.id = j.claim_id
    WHERE j.is_real_job = true AND j.status IS DISTINCT FROM 'deleted'
      AND j.primary_contact_id IS NOT NULL
      AND (p_contact_id IS NULL OR j.primary_contact_id = p_contact_id)
    GROUP BY j.primary_contact_id
  )
  SELECT json_build_object(
    'contact_id',   won.cid,
    'contact_name', c.name,
    'jobs',         won.jobs,
    'revenue',      won.revenue,
    'first_job_at', won.first_job_at,
    'last_job_at',  won.last_job_at,
    'is_repeat',    (won.jobs > 1)
  )
  FROM won
  LEFT JOIN contacts c ON c.id = won.cid
  ORDER BY won.revenue DESC
  LIMIT (CASE WHEN p_contact_id IS NULL THEN 25 ELSE 1 END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_contact_ltv(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_ltv(uuid, uuid) TO authenticated, service_role;
