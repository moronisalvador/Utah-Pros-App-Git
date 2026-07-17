-- ════════════════════════════════════════════════
-- MIGRATION: crm_reporting_rpcs_spam_filter
-- Phase: n/a (routine fix, post-CRM-wave)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   A handful of CRM report/chart RPCs counted spam-flagged leads
--   (inbound_leads.spam_flag = true) as if they were real leads, inflating
--   the numbers admins see on the CRM Overview funnel, the Attribution
--   page's per-channel/per-campaign lead counts, and the Reports page's
--   speed-to-lead and pipeline-movement charts. The Leads pipeline board
--   itself (CrmLeads.jsx) already excludes spam — this migration brings
--   the reporting RPCs in line with it. The Call Log page (get_inbound_leads)
--   is intentionally left untouched: it is a full call-audit list that shows
--   spam-flagged calls on purpose, with a visible "Spam" badge, so staff can
--   review/reclassify them.
--
--   Four function-body-only replaces, same signatures, same return shapes:
--     1. get_attribution_rollup  — leads_agg CTE now excludes spam.
--     2. get_attribution_by_campaign — the per-campaign lead-count subquery
--        now excludes spam.
--     3. get_speed_to_lead — the gaps CTE (already joins inbound_leads) now
--        excludes spam.
--     4. get_pipeline_movement — previously counted lead_stage_history rows
--        with no reference to the underlying lead at all; now joins
--        inbound_leads by lead_id and excludes spam.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   No table touched. Four function bodies replaced (identical signature,
--   identical return columns) — a WHERE-clause tightening only. One shared
--   Supabase — live in dev + main the moment this applies.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior bodies (drop the `AND COALESCE(il.spam_flag, false)
--   = false` clause from get_attribution_rollup/get_attribution_by_campaign/
--   get_speed_to_lead, and drop the `JOIN inbound_leads il ON il.id =
--   lsh.lead_id` + spam filter from get_pipeline_movement, reverting to a
--   bare `SELECT lsh.stage_id, lsh.from_stage_id FROM lead_stage_history
--   lsh`) — see 20260701_crm_phase3_attribution.sql and
--   20260702_crm_phase9_intelligence_rpcs.sql for the pre-fix bodies.
-- ════════════════════════════════════════════════

-- ═══ 1. get_attribution_rollup — leads_agg CTE excludes spam ═══
REVOKE EXECUTE ON FUNCTION public.get_attribution_rollup(date, date, uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION get_attribution_rollup(
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL,
  p_org_id     uuid DEFAULT NULL
)
RETURNS TABLE (
  channel    text,
  spend      numeric,
  leads      bigint,
  estimates  bigint,
  won_jobs   bigint,
  revenue    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  RETURN QUERY
  WITH channels(channel) AS (
    VALUES ('google_ads'),('meta_ads'),('organic'),('referral'),('insurance'),('other')
  ),
  contact_channel AS (
    -- last-touch channel per contact: an explicit lead_attribution row wins,
    -- else the normalized contacts.referral_source, else 'other'
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
             NULLIF(crm_channel_for_source(il.source), 'other'),  -- lead's own source unless unknown
             cc.channel,                                          -- else the contact's channel
             'other'
           ) AS channel,
           COUNT(*) AS leads
    FROM inbound_leads il
    LEFT JOIN contact_channel cc ON cc.contact_id = il.contact_id
    WHERE il.org_id = v_org
      AND COALESCE(il.spam_flag, false) = false
      AND (p_start_date IS NULL OR il.occurred_at >= p_start_date::timestamptz)
      AND (p_end_date   IS NULL OR il.occurred_at <  (p_end_date + 1)::timestamptz)
    GROUP BY 1
  ),
  est_agg AS (
    SELECT COALESCE(cc.channel, 'other') AS channel, COUNT(DISTINCT e.id) AS estimates
    FROM estimates e
    LEFT JOIN contact_channel cc ON cc.contact_id = e.contact_id
    WHERE e.status IS DISTINCT FROM 'draft'  -- "estimate sent" = anything past draft; IS DISTINCT
                                             -- FROM is null-safe (status is NOT NULL today, but a
                                             -- plain <> would silently drop any future NULL row)
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
    WHERE j.phase <> 'lead' AND j.status <> 'deleted'  -- "won/booked" = left the lead phase
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
$$;

GRANT EXECUTE ON FUNCTION get_attribution_rollup(date, date, uuid) TO anon, authenticated;

-- ═══ 2. get_attribution_by_campaign — per-campaign lead count excludes spam ═══
REVOKE EXECUTE ON FUNCTION public.get_attribution_by_campaign(date, date, uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION get_attribution_by_campaign(
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL,
  p_org_id     uuid DEFAULT NULL
)
RETURNS TABLE (
  channel       text,
  platform      text,
  campaign_id   text,
  campaign_name text,
  spend         numeric,
  leads         bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  RETURN QUERY
  SELECT CASE s.platform WHEN 'google' THEN 'google_ads' WHEN 'meta' THEN 'meta_ads' ELSE 'other' END AS channel,
         s.platform,
         s.campaign_id,
         s.campaign_name,
         SUM(s.spend)::numeric AS spend,
         COALESCE((
           SELECT COUNT(*) FROM inbound_leads il
            WHERE il.org_id = v_org
              AND COALESCE(il.spam_flag, false) = false
              AND il.campaign IS NOT NULL
              AND lower(il.campaign) = lower(s.campaign_name)
              AND (p_start_date IS NULL OR il.occurred_at >= p_start_date::timestamptz)
              AND (p_end_date   IS NULL OR il.occurred_at <  (p_end_date + 1)::timestamptz)
         ), 0)::bigint AS leads
  FROM ad_spend s
  WHERE s.org_id = v_org
    AND (p_start_date IS NULL OR s.date >= p_start_date)
    AND (p_end_date   IS NULL OR s.date <= p_end_date)
  GROUP BY s.platform, s.campaign_id, s.campaign_name
  ORDER BY spend DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_attribution_by_campaign(date, date, uuid) TO anon, authenticated;

-- ═══ 3. get_speed_to_lead — gaps CTE excludes spam (already joins inbound_leads) ═══
REVOKE EXECUTE ON FUNCTION public.get_speed_to_lead(date, date, uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION get_speed_to_lead(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    GROUP BY lsh.lead_id
  ),
  gaps AS (
    SELECT EXTRACT(EPOCH FROM (fm.first_moved_at - COALESCE(il.occurred_at, il.created_at))) / 60.0 AS mins
    FROM first_move fm
    JOIN inbound_leads il ON il.id = fm.lead_id
    WHERE COALESCE(il.spam_flag, false) = false
      AND (p_start IS NULL OR fm.first_moved_at >= p_start::timestamptz)
      AND (p_end   IS NULL OR fm.first_moved_at <  (p_end + 1)::timestamptz)
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
$$;
GRANT EXECUTE ON FUNCTION get_speed_to_lead(date, date, uuid) TO anon, authenticated;

-- ═══ 4. get_pipeline_movement — now joins inbound_leads to exclude spam ═══
REVOKE EXECUTE ON FUNCTION public.get_pipeline_movement(date, date, uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION get_pipeline_movement(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND (p_start IS NULL OR lsh.moved_at >= p_start::timestamptz)
      AND (p_end   IS NULL OR lsh.moved_at <  (p_end + 1)::timestamptz)
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
$$;
GRANT EXECUTE ON FUNCTION get_pipeline_movement(date, date, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
