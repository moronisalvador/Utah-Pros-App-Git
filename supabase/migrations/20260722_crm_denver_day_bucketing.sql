-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_denver_day_bucketing
-- Phase: n/a (standalone CRM correctness fix — owner ruling 2026-07-22:
--        "Fix CRM + get_jobs_closed" for the UTC day-boundary skew)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes every sale/lead/call date question mean the MOUNTAIN-TIME day, not
--   the UTC day. Before this, "won on July 4" was computed against UTC
--   midnight, which is 6 PM the previous day in Denver — so anything that
--   happened between 6 PM and midnight local time (~24% of sales, measured
--   live 2026-07-22) was reported on the WRONG day, and a "last 7 days"
--   window actually ran 6 PM-to-6 PM.
--
--   The company timezone convention is already law (database-standard.md §7:
--   all day/week bucketing uses America/Denver via the shared mt_today()/
--   mt_date() helpers) — these functions predate it or missed it. This
--   migration brings the seven date-windowed CRM reporting RPCs AND the
--   canonical company-wide sales view get_jobs_closed onto that convention:
--
--     get_attribution_rollup      3 window pairs → mt_date()
--     get_conversion_trend        month buckets + 3 window pairs → Denver
--     get_crm_revenue_by_division 1 window pair → mt_date()
--     get_estimator_leaderboard   denominator + won/revenue FILTER pairs → mt_date()
--     get_pipeline_movement       1 window pair → mt_date()
--     get_speed_to_lead           1 window pair → mt_date()
--     get_call_volume             day buckets + window pairs → Denver
--                                 (it already used mt_today() for its DEFAULT
--                                 end date, but bucketed the actual calls in
--                                 UTC — a 7 PM call landed on tomorrow's bar)
--     get_jobs_closed             p_floor boundary → mt_date()
--
--   get_estimate_aging and get_contact_ltv take no date window — untouched.
--   get_commissions is deliberately NOT touched (money-period stability, a
--   separate documented decision).
--
--   The one idiom, used everywhere: `public.mt_date(ts) >= p_start AND
--   public.mt_date(ts) <= p_end` (inclusive Denver calendar days), and
--   buckets via mt_date()/`AT TIME ZONE`-free naive-timestamp series. These
--   tables are small (hundreds of rows); if they ever grow hot, add an
--   expression index on mt_date(col) — mt_date is IMMUTABLE for exactly that.
--
--   FROZEN-CONTRACT DISCLOSURE: get_call_volume and get_conversion_trend are
--   CRM Phase-9 / DB-Foundation-frozen signatures. This is a function-BODY-only
--   replace; every signature and return shape is byte-for-byte unchanged. The
--   computed date VALUES shift — the explicitly sanctioned change class per
--   db-foundation-wave-ownership.md §5 ("P6's timezone RPCs shift computed
--   date VALUES (same columns)"). Committed test:
--   supabase/tests/crm_denver_day_bucketing.test.js.
--
-- ADDITIVE-ONLY:
--   Function-body-only CREATE OR REPLACE of eight live RPCs. No table/column/
--   policy change, no data change, no signature change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply each function's prior body (in git: this file's predecessors
--   20260722_crm_won_jobs_use_canonical_real_job_rule.sql, the P6/phase-9
--   migrations, and 20260704_get_jobs_closed_claim_date_basis.sql). The diff
--   is purely mechanical — revert each of:
--     1. `public.mt_date(X) >= p_start` → `X >= p_start::timestamptz`
--     2. `public.mt_date(X) <= p_end`   → `X < (p_end + 1)::timestamptz`
--     3. Denver month/day buckets       → `date_trunc('…', X)` in UTC
--     4. get_jobs_closed p_floor        → `>= p_floor::timestamptz`
--   No schema or data is touched, so a rollback is purely these bodies.
-- ════════════════════════════════════════════════

-- 1. get_attribution_rollup — Overview headline cards.
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
      -- Denver calendar days (database-standard.md §7), not UTC midnights.
      AND (p_start_date IS NULL OR public.mt_date(il.occurred_at) >= p_start_date)
      AND (p_end_date   IS NULL OR public.mt_date(il.occurred_at) <= p_end_date)
    GROUP BY 1
  ),
  est_agg AS (
    SELECT COALESCE(cc.channel, 'other') AS channel, COUNT(DISTINCT e.id) AS estimates
    FROM estimates e
    LEFT JOIN contact_channel cc ON cc.contact_id = e.contact_id
    WHERE e.status IS DISTINCT FROM 'draft'
      AND crm_contact_is_traced(e.contact_id)
      AND (p_start_date IS NULL OR public.mt_date(e.created_at) >= p_start_date)
      AND (p_end_date   IS NULL OR public.mt_date(e.created_at) <= p_end_date)
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
      AND (p_start_date IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) >= p_start_date)
      AND (p_end_date   IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) <= p_end_date)
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

-- 2. get_conversion_trend — Overview trend chart. Months are Denver months.
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
  v_start := COALESCE(p_start, (date_trunc('month', v_end::timestamp) - interval '11 months')::date);

  RETURN QUERY
  -- All buckets are Denver calendar months: mt_date() collapses each event to
  -- its Denver day first, then date_trunc months over NAIVE timestamps (no
  -- server-TZ dependence anywhere).
  WITH months AS (
    SELECT generate_series(date_trunc('month', v_start::timestamp),
                           date_trunc('month', v_end::timestamp),
                           interval '1 month') AS m
  ),
  lead_c AS (
    SELECT date_trunc('month', public.mt_date(COALESCE(il.occurred_at, il.created_at))::timestamp) AS m, COUNT(*) AS c
    FROM inbound_leads il
    WHERE il.org_id = v_org AND COALESCE(il.spam_flag, false) = false
      AND (il.source_type <> 'call' OR public.crm_call_is_answered(il.raw_payload, il.duration_sec))
      AND public.mt_date(COALESCE(il.occurred_at, il.created_at)) >= v_start
      AND public.mt_date(COALESCE(il.occurred_at, il.created_at)) <= v_end
    GROUP BY 1
  ),
  est_c AS (
    SELECT date_trunc('month', public.mt_date(e.created_at)::timestamp) AS m, COUNT(*) AS c
    FROM estimates e
    WHERE e.status IS DISTINCT FROM 'draft'
      AND crm_contact_is_traced(e.contact_id)
      AND public.mt_date(e.created_at) >= v_start
      AND public.mt_date(e.created_at) <= v_end
    GROUP BY 1
  ),
  -- CANONICAL SALE RULE (see job_agg note in get_attribution_rollup).
  job_c AS (
    SELECT date_trunc('month', public.mt_date(COALESCE(cl.created_at, j.created_at))::timestamp) AS m,
           COUNT(*) AS c,
           COALESCE(SUM(j.invoiced_value), 0) AS rev
    FROM jobs j
    LEFT JOIN claims cl ON cl.id = j.claim_id
    WHERE j.is_real_job = true AND j.status IS DISTINCT FROM 'deleted'
      AND crm_contact_is_traced(j.primary_contact_id)
      AND public.mt_date(COALESCE(cl.created_at, j.created_at)) >= v_start
      AND public.mt_date(COALESCE(cl.created_at, j.created_at)) <= v_end
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

-- 3. get_crm_revenue_by_division — Overview division donut.
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
    AND (p_start_date IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) >= p_start_date)
    AND (p_end_date   IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) <= p_end_date)
  GROUP BY j.division
  ORDER BY 3 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_crm_revenue_by_division(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_revenue_by_division(date, date) TO authenticated, service_role;

-- 4. get_estimator_leaderboard — Reports. Denominator stays j.created_at-
--    windowed (every opportunity touched); only the WON half uses the sale
--    date. Both windows are now Denver days.
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
                      AND (p_start IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) >= p_start)
                      AND (p_end   IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) <= p_end)),
    'revenue',    COALESCE(SUM(j.invoiced_value) FILTER (
                    WHERE j.is_real_job = true
                      AND (p_start IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) >= p_start)
                      AND (p_end   IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) <= p_end)), 0)
  )
  FROM jobs j
  LEFT JOIN claims cl ON cl.id = j.claim_id
  WHERE j.estimator IS NOT NULL AND btrim(j.estimator) <> ''
    AND j.status IS DISTINCT FROM 'deleted'
    AND crm_contact_is_traced(j.primary_contact_id)
    AND (p_start IS NULL OR public.mt_date(j.created_at) >= p_start)
    AND (p_end   IS NULL OR public.mt_date(j.created_at) <= p_end)
  GROUP BY j.estimator
  ORDER BY COALESCE(SUM(j.invoiced_value) FILTER (
             WHERE j.is_real_job = true
               AND (p_start IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) >= p_start)
               AND (p_end   IS NULL OR public.mt_date(COALESCE(cl.created_at, j.created_at)) <= p_end)), 0) DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_estimator_leaderboard(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_estimator_leaderboard(date, date, uuid) TO authenticated, service_role;

-- 5. get_pipeline_movement — Reports stage-flow card.
CREATE OR REPLACE FUNCTION public.get_pipeline_movement(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_since timestamptz;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_since := (SELECT MIN(moved_at) FROM lead_stage_history WHERE org_id = v_org);

  RETURN QUERY
  WITH moves AS (
    SELECT lsh.stage_id, lsh.from_stage_id
    FROM lead_stage_history lsh
    JOIN inbound_leads il ON il.id = lsh.lead_id
    WHERE lsh.org_id = v_org
      AND COALESCE(il.spam_flag, false) = false
      AND (p_start IS NULL OR public.mt_date(lsh.moved_at) >= p_start)
      AND (p_end   IS NULL OR public.mt_date(lsh.moved_at) <= p_end)
  ),
  in_c  AS (SELECT stage_id AS sid, COUNT(*) AS c FROM moves GROUP BY stage_id),
  out_c AS (SELECT from_stage_id AS sid, COUNT(*) AS c FROM moves WHERE from_stage_id IS NOT NULL GROUP BY from_stage_id)
  SELECT json_build_object(
    'stage_id',   ps.id,
    'stage_name', ps.name,
    'sort_order', ps.sort_order,
    'is_won',     ps.is_won,
    'is_lost',    ps.is_lost,
    'moved_in',   COALESCE(in_c.c, 0),
    'moved_out',  COALESCE(out_c.c, 0),
    'net',        COALESCE(in_c.c, 0) - COALESCE(out_c.c, 0),
    'data_since', v_since
  )
  FROM pipeline_stages ps
  LEFT JOIN in_c  ON in_c.sid  = ps.id
  LEFT JOIN out_c ON out_c.sid = ps.id
  WHERE ps.org_id = v_org
  ORDER BY ps.sort_order;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_pipeline_movement(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_movement(date, date, uuid) TO authenticated, service_role;

-- 6. get_speed_to_lead — Reports SLA card (human moves only, unchanged).
CREATE OR REPLACE FUNCTION public.get_speed_to_lead(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_since timestamptz;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_since := (SELECT MIN(moved_at) FROM lead_stage_history WHERE org_id = v_org);

  RETURN QUERY
  WITH first_move AS (
    SELECT lsh.lead_id, MIN(lsh.moved_at) AS first_moved_at
    FROM lead_stage_history lsh
    WHERE lsh.org_id = v_org
      AND lsh.moved_by IS NOT NULL
    GROUP BY lsh.lead_id
  ),
  gaps AS (
    SELECT EXTRACT(EPOCH FROM (fm.first_moved_at - COALESCE(il.occurred_at, il.created_at))) / 60.0 AS mins
    FROM first_move fm
    JOIN inbound_leads il ON il.id = fm.lead_id
    WHERE COALESCE(il.spam_flag, false) = false
      AND (p_start IS NULL OR public.mt_date(fm.first_moved_at) >= p_start)
      AND (p_end   IS NULL OR public.mt_date(fm.first_moved_at) <= p_end)
  ),
  binned AS (
    SELECT CASE
      WHEN GREATEST(mins, 0) <= 5 THEN 1
      WHEN mins <= 30            THEN 2
      WHEN mins <= 60            THEN 3
      WHEN mins <= 240           THEN 4
      WHEN mins <= 1440          THEN 5
      ELSE 6
    END AS b
    FROM gaps
  ),
  counts AS (SELECT b, COUNT(*) AS c FROM binned GROUP BY b),
  defs(sort_order, label, within_sla) AS (
    VALUES (1, '≤5 min', true), (2, '5–30 min', false), (3, '30–60 min', false),
           (4, '1–4 hr', false), (5, '4–24 hr', false), (6, '>24 hr', false)
  )
  SELECT json_build_object(
    'bucket',     defs.label,
    'sort_order', defs.sort_order,
    'within_sla', defs.within_sla,
    'count',      COALESCE(counts.c, 0),
    'data_since', v_since
  )
  FROM defs
  LEFT JOIN counts ON counts.b = defs.sort_order
  ORDER BY defs.sort_order;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_speed_to_lead(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_speed_to_lead(date, date, uuid) TO authenticated, service_role;

-- 7. get_call_volume — Overview/Reports daily bars. Day = Denver day.
CREATE OR REPLACE FUNCTION public.get_call_volume(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org        uuid;
  v_start      date;
  v_end        date;
  v_earliest   date;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_end   := COALESCE(p_end, public.mt_today());

  IF p_start IS NULL THEN
    SELECT public.mt_date(MIN(COALESCE(il.occurred_at, il.created_at))) INTO v_earliest
    FROM inbound_leads il
    WHERE il.org_id = v_org AND il.source_type = 'call' AND COALESCE(il.spam_flag, false) = false;
  END IF;
  v_start := COALESCE(p_start, v_earliest, (v_end - 29));

  RETURN QUERY
  -- Day series over NAIVE timestamps (dates), calls bucketed to their Denver
  -- day via mt_date() — no server-TZ dependence anywhere.
  WITH days AS (
    SELECT generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') AS d
  ),
  calls AS (
    SELECT public.mt_date(COALESCE(il.occurred_at, il.created_at)) AS d,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE public.crm_call_is_answered(il.raw_payload, il.duration_sec)) AS answered,
           COUNT(*) FILTER (WHERE NOT public.crm_call_is_answered(il.raw_payload, il.duration_sec)) AS missed
    FROM inbound_leads il
    WHERE il.org_id = v_org AND il.source_type = 'call' AND COALESCE(il.spam_flag, false) = false
      AND public.mt_date(COALESCE(il.occurred_at, il.created_at)) >= v_start
      AND public.mt_date(COALESCE(il.occurred_at, il.created_at)) <= v_end
    GROUP BY 1
  )
  SELECT json_build_object(
    'period',       to_char(days.d, 'YYYY-MM-DD'),
    'period_start', days.d::date,
    'total',        COALESCE(calls.total, 0),
    'answered',     COALESCE(calls.answered, 0),
    'missed',       COALESCE(calls.missed, 0)
  )
  FROM days
  LEFT JOIN calls ON calls.d = days.d::date
  ORDER BY days.d;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_call_volume(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_call_volume(date, date, uuid) TO authenticated, service_role;

-- 8. get_jobs_closed — the canonical company-wide sales view (Home dashboard
--    "New Jobs Closed"). p_floor now means a Denver calendar day.
CREATE OR REPLACE FUNCTION public.get_jobs_closed(p_floor date DEFAULT NULL::date)
 RETURNS TABLE(job_id uuid, sale_date timestamp with time zone, sale_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT j.id,
         COALESCE(c.created_at, j.created_at) AS sale_date,
         j.real_job_source                    AS sale_source
  FROM public.jobs j
  LEFT JOIN public.claims c ON c.id = j.claim_id
  WHERE j.is_real_job = true
    AND j.status IS DISTINCT FROM 'deleted'
    AND (p_floor IS NULL OR public.mt_date(COALESCE(c.created_at, j.created_at)) >= p_floor)
  ORDER BY sale_date DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_jobs_closed(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_closed(date) TO authenticated, service_role;
