-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_leads_exclude_unanswered_calls
-- Phase: n/a (standalone CRM reliability fix — owner-caught live)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Every "Leads" number on the CRM Overview/Attribution/Reports pages
--   (the headline card, "Leads by source", "Leads by campaign", "New leads",
--   and the Conversion Trend chart's leads bar) currently counts ANY
--   non-spam-flagged inbound_leads row — but a call that rang and was never
--   picked up has no recording and no transcript, so it can NEVER be run
--   through the AI classifier that would otherwise catch a non-lead and
--   flag it as spam. Verified live 2026-07-22: 13 of 29 leads in a 7-day
--   window (45%) were unanswered calls with zero content — not customer
--   inquiries at all, just uncounted noise inflating every marketing number
--   on the page. This introduces ONE canonical "was this call answered"
--   predicate — reusing the EXACT same rule get_call_volume already applies
--   for its own answered/missed split (raw_payload's own 'answered' flag,
--   falling back to duration_sec > 0 only when that flag is absent) — and
--   adopts it in every RPC that counts raw lead volume, so an unanswered
--   call is excluded from "Leads" everywhere, consistently, from one
--   definition.
--
--   Deliberately UNCHANGED: the actual Kanban board (CrmLeads.jsx) and task
--   picker (CrmTasks.jsx) still show every non-spam lead including
--   unanswered calls — staff still need to see a missed call to actually
--   call the person back, so this is a "Leads" MARKETING-METRIC fix, not a
--   change to what shows up for ops/triage. The sales pipeline's stage
--   grouping is untouched for the same reason.
--
-- ADDITIVE-ONLY:
--   One new pure SQL helper function (crm_call_is_answered) + function-
--   body-only CREATE OR REPLACE of get_call_volume (adopts the helper,
--   behavior-identical — same CASE expression, just centralized),
--   get_attribution_rollup, and get_conversion_trend (both gain one
--   additional WHERE clause excluding unanswered calls from their lead
--   counts). All three signatures are byte-for-byte unchanged. No table/
--   column/policy change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply get_attribution_rollup/get_conversion_trend's prior bodies
--   (drop the `AND (il.source_type <> 'call' OR crm_call_is_answered(...))`
--   line from each), re-apply get_call_volume's prior inline CASE
--   expressions (reproduced by crm_call_is_answered's body one section up —
--   inline that same CASE back into get_call_volume's two COUNT(*) FILTER
--   clauses), then `DROP FUNCTION public.crm_call_is_answered(jsonb, integer);`.
-- ════════════════════════════════════════════════

-- 1. Canonical "was this call answered" predicate — the ONE place this rule
--    lives from now on. Mirrors get_call_volume's existing inline logic
--    exactly: trust CallRail's own 'answered' flag when present, otherwise
--    fall back to duration_sec > 0 (only relevant for legacy rows ingested
--    before CallRail started sending 'answered').
CREATE OR REPLACE FUNCTION public.crm_call_is_answered(p_raw_payload jsonb, p_duration_sec integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_raw_payload ? 'answered' THEN (p_raw_payload->>'answered')::boolean
    ELSE COALESCE(p_duration_sec, 0) > 0
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_call_is_answered(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_call_is_answered(jsonb, integer) TO authenticated, service_role;

-- 2. get_call_volume — adopt the helper (behavior-identical, just DRY now).
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
    SELECT MIN(COALESCE(il.occurred_at, il.created_at))::date INTO v_earliest
    FROM inbound_leads il
    WHERE il.org_id = v_org AND il.source_type = 'call' AND COALESCE(il.spam_flag, false) = false;
  END IF;
  v_start := COALESCE(p_start, v_earliest, (v_end - 29));

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_start::timestamptz, v_end::timestamptz, interval '1 day') AS d
  ),
  calls AS (
    SELECT date_trunc('day', COALESCE(il.occurred_at, il.created_at)) AS d,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE public.crm_call_is_answered(il.raw_payload, il.duration_sec)) AS answered,
           COUNT(*) FILTER (WHERE NOT public.crm_call_is_answered(il.raw_payload, il.duration_sec)) AS missed
    FROM inbound_leads il
    WHERE il.org_id = v_org AND il.source_type = 'call' AND COALESCE(il.spam_flag, false) = false
      AND COALESCE(il.occurred_at, il.created_at) >= v_start::timestamptz
      AND COALESCE(il.occurred_at, il.created_at) <  (v_end + 1)::timestamptz
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
  LEFT JOIN calls ON calls.d = date_trunc('day', days.d)
  ORDER BY days.d;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_call_volume(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_call_volume(date, date, uuid) TO authenticated, service_role;

-- 3. get_attribution_rollup — the "Leads" headline card + "Leads by source"
--    donut. leads_agg gains the unanswered-call exclusion.
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

-- 4. get_conversion_trend — the Conversion Trend chart's "leads" bar.
--    lead_c gains the same unanswered-call exclusion.
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
