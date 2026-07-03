-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Partner — widen access: full CRM except Integrations
--
-- Product decision revision (post-merge follow-up to the initial crm_partner
-- rollout): the marketing-agency partner should see the WHOLE CRM — including
-- pipeline-stage config (Settings) and revenue/margin figures — with the one
-- exception being the Integrations page (shared platform OAuth credentials).
-- The internal build-roadmap tracker (crm_build_phases/crm_build_stages)
-- stays hidden — it's an engineering artifact, not a CRM business feature.
--
-- This migration:
--   1. Reverts the pipeline_stages write-block and the upsert/delete guards —
--      a partner can now fully manage pipeline stages like any internal role.
--   2. Reverts the revenue masking in get_crm_revenue_by_division() and
--      get_attribution_rollup() — partners now see real revenue/ROAS.
--   3. Adds a NEW guard on get_integration_status() so a partner can't read
--      integration connection status even via a direct RPC call (the
--      integration_credentials/integration_config tables themselves already
--      have zero policies — locked to service-role only regardless of role).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pipeline_stages_select" ON pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_write" ON pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_update" ON pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_delete" ON pipeline_stages;

CREATE POLICY "pipeline_stages_all" ON pipeline_stages
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION upsert_pipeline_stage(
  p_id          uuid DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_color       text DEFAULT '#6366f1',
  p_sort_order  int DEFAULT NULL,
  p_is_won      boolean DEFAULT false,
  p_is_lost     boolean DEFAULT false,
  p_org_id      uuid DEFAULT NULL
)
RETURNS pipeline_stages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_row    pipeline_stages;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'pipeline stage name is required';
  END IF;
  IF p_is_won AND p_is_lost THEN
    RAISE EXCEPTION 'a pipeline stage cannot be both is_won and is_lost';
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  IF p_id IS NULL THEN
    INSERT INTO pipeline_stages (org_id, name, color, sort_order, is_won, is_lost)
    VALUES (
      v_org_id, btrim(p_name), COALESCE(p_color, '#6366f1'),
      COALESCE(p_sort_order, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM pipeline_stages WHERE org_id = v_org_id)),
      p_is_won, p_is_lost
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE pipeline_stages
       SET name       = btrim(p_name),
           color      = COALESCE(p_color, color),
           sort_order = COALESCE(p_sort_order, sort_order),
           is_won     = p_is_won,
           is_lost    = p_is_lost,
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown pipeline_stages id: %', p_id;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION delete_pipeline_stage(p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM lead_pipeline_stage WHERE stage_id = p_stage_id) THEN
    RAISE EXCEPTION 'cannot delete a pipeline stage with leads on it — move them first';
  END IF;

  DELETE FROM pipeline_stages WHERE id = p_stage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown pipeline_stages id: %', p_stage_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_crm_revenue_by_division(
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL
)
RETURNS TABLE (
  division  text,
  won_jobs  bigint,
  revenue   numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.division::text,
         COUNT(*)::bigint,
         COALESCE(SUM(j.invoiced_value), 0)::numeric
  FROM jobs j
  WHERE j.phase <> 'lead' AND j.status <> 'deleted'
    AND (p_start_date IS NULL OR j.created_at >= p_start_date::timestamptz)
    AND (p_end_date   IS NULL OR j.created_at <  (p_end_date + 1)::timestamptz)
  GROUP BY j.division
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION get_attribution_rollup(
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL,
  p_org_id     uuid DEFAULT NULL
)
RETURNS TABLE (
  channel   text,
  spend     numeric,
  leads     bigint,
  estimates bigint,
  won_jobs  bigint,
  revenue   numeric
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
$$;

CREATE OR REPLACE FUNCTION get_integration_status(p_provider text DEFAULT 'quickbooks')
RETURNS TABLE(
  provider         text,
  connected        boolean,
  environment      text,
  company_name     text,
  realm_id         text,
  token_expires_at timestamptz,
  connected_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_provider,
    EXISTS (
      SELECT 1 FROM integration_credentials c
      WHERE c.provider = p_provider AND (c.refresh_token IS NOT NULL OR c.access_token IS NOT NULL)
    ),
    c.environment, c.company_name, c.realm_id, c.token_expires_at, c.connected_at
  FROM (SELECT 1) one
  LEFT JOIN integration_credentials c ON c.provider = p_provider
  WHERE NOT is_crm_partner(auth.uid());
$$;
