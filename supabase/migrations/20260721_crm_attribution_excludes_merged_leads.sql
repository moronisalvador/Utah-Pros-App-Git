-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_attribution_excludes_merged_leads
-- Phase: n/a (standalone production fix — CRM Overview dashboard-gap follow-up)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Fixes the headline "Leads" count so it stops double-counting repeat
--   phone calls. When the same caller phones twice while their first lead is
--   still open, the merge system built earlier today (crm_merge_repeat_call_
--   leads) keeps the second call as its own inbound_leads row for history,
--   but marks it merged_into_lead_id so it never gets a second Kanban card.
--   The Kanban board's own query already excludes these
--   (merged_into_lead_id=is.null), but get_attribution_rollup's leads count
--   did not — so the dashboard's "Leads" number could quietly count a repeat
--   call as a brand-new lead. This adds the same exclusion the board already
--   uses. Live check on 2026-07-21: 1 lead affected today (small now, would
--   compound as more people call back).
--
-- ADDITIVE-ONLY / attribute-only:
--   Function-body-only CREATE OR REPLACE. Signature UNCHANGED
--   (p_start_date date, p_end_date date, p_org_id uuid) →
--   TABLE(channel, spend, leads, estimates, won_jobs, revenue) — every
--   existing caller (CrmOverview.jsx, CrmReports.jsx, CrmAttribution.jsx)
--   keeps working with no code change. Only the leads_agg CTE's WHERE clause
--   gains one additional AND condition. No table DROP/RENAME/ALTER COLUMN,
--   no data change. GRANT/REVOKE unchanged (still TO authenticated,
--   service_role — never anon).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body (no merged_into_lead_id filter) via another
--   CREATE OR REPLACE FUNCTION public.get_attribution_rollup that removes
--   the added `AND il.merged_into_lead_id IS NULL` line from leads_agg's
--   WHERE clause — the exact body live before this migration is in git
--   history at this file's prior commit. Do NOT roll back to
--   20260701_crm_phase3_attribution.sql's original body — that version
--   predates the 2026-07-17 spam-filter fix (20260717_crm_reporting_rpcs_
--   spam_filter.sql) and would silently reintroduce spam-counting.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_attribution_rollup(
  p_start_date date DEFAULT NULL::date,
  p_end_date   date DEFAULT NULL::date,
  p_org_id     uuid DEFAULT NULL::uuid
)
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

-- Managed-Supabase re-applies EXECUTE TO PUBLIC on every function replace
-- (database-standard.md §1) — re-assert least-privilege explicitly.
REVOKE EXECUTE ON FUNCTION public.get_attribution_rollup(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attribution_rollup(date, date, uuid) TO authenticated, service_role;
