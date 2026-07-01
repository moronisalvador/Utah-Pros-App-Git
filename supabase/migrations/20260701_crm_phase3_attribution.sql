-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 3 — Attribution + funnel dashboard
--
-- docs/crm-roadmap.md, "Phase 3 — Attribution + funnel dashboard", and the
-- committed design record docs/crm-phase3-attribution-model.md (Opus-High
-- pass). Joins the three sources into one funnel — spend (ad_spend) → leads
-- (inbound_leads / CallRail) → estimates → won jobs → revenue (QBO-synced
-- jobs.invoiced_value) — grouped by a canonical marketing channel.
--
-- Attribution is LAST-TOUCH, single-touch for v1 (every touch is still stored
-- in lead_attribution so first-touch/weighted is a future re-aggregation, not
-- a schema change). CallRail's "converted" flag + ad_spend.platform_conversions
-- are informational only and never enter the money math — UPR's won-job/QBO
-- revenue is the single source of truth for conversions + revenue.
--
-- ALL ADDITIVE: one new table (lead_attribution) + five new functions. No
-- existing table is altered. RLS enabled at creation, per CLAUDE.md Rule 7.
-- org_id carried on the new table from day one (multi-tenancy hedge). NOTE:
-- contacts/jobs/estimates are existing single-tenant UPR tables and are NOT
-- org-scoped — the roadmap explicitly keeps them single-tenant — so p_org_id
-- scopes only the CRM-owned tables (ad_spend, inbound_leads, lead_attribution).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. lead_attribution — one row per attribution TOUCH ─────────────────────────
-- An explicit, enrichable attribution record for a lead and/or contact. The
-- funnel RPCs fall back to the normalized contacts.referral_source when a
-- contact has no explicit row here, so the dashboard works today off existing
-- data and sharpens as CallRail leads + manual entries accumulate. Last-touch
-- is computed at query time by MAX(occurred_at) — position is deliberately NOT
-- stored, so it can never go stale as new touches arrive.
CREATE TABLE IF NOT EXISTS lead_attribution (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES crm_orgs(id),
  lead_id            uuid REFERENCES inbound_leads(id) ON DELETE CASCADE,
  contact_id         uuid REFERENCES contacts(id) ON DELETE CASCADE,
  channel            text NOT NULL CHECK (channel IN
                       ('google_ads','meta_ads','organic','referral','insurance','other')),
  source             text,          -- raw source string (CallRail UTM, referral_sources.name, manual)
  campaign           text,          -- matches ad_spend.campaign_name for paid channels
  referral_source_id uuid REFERENCES referral_sources(id),
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_attribution_contact ON lead_attribution(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_attribution_lead ON lead_attribution(lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_attribution_org ON lead_attribution(org_id);
CREATE INDEX IF NOT EXISTS idx_lead_attribution_channel ON lead_attribution(channel);

ALTER TABLE lead_attribution ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_attribution_all" ON lead_attribution;
CREATE POLICY "lead_attribution_all" ON lead_attribution
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 2. crm_channel_for_source(text) — normalize a raw source string → channel ───
-- Data-driven (resolves against referral_sources.category, not 49 hardcoded
-- names) with keyword refinement for the paid/organic Google split and for
-- CallRail UTM strings ('google','facebook',…). See the design doc's channel
-- table. Deterministic + STABLE so it can be used in aggregate queries.
CREATE OR REPLACE FUNCTION crm_channel_for_source(p_source text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v     text := lower(trim(coalesce(p_source, '')));
  v_cat text;
BEGIN
  IF v = '' THEN RETURN 'other'; END IF;

  -- Direct keyword rules first. Order matters: the organic-Google forms (My
  -- Business, SEO) are checked BEFORE the paid-Google catch, so "Google My
  -- Business" is not mislabeled as ads.
  IF v LIKE '%facebook%' OR v LIKE '%instagram%' OR v LIKE '%meta ads%'
     OR v = 'meta' OR v = 'fb' OR v = 'ig' THEN
    RETURN 'meta_ads';
  END IF;
  IF v LIKE '%my business%' OR v LIKE '%gmb%' OR v LIKE '%seo%' OR v LIKE '%organic%'
     OR v LIKE '%website%' OR v LIKE '%nextdoor%' THEN
    RETURN 'organic';
  END IF;
  IF v LIKE '%google%' OR v LIKE '%adwords%' OR v LIKE '%lsa%' OR v LIKE '%ppc%'
     OR v LIKE '%paid search%' OR v LIKE '%sem%' THEN
    RETURN 'google_ads';
  END IF;
  IF v LIKE '%insurance%' OR v LIKE '%adjuster%' OR v LIKE '%tpa%' OR v LIKE '%carrier%' THEN
    RETURN 'insurance';
  END IF;
  IF v LIKE '%referral%' OR v LIKE '%word of mouth%' OR v LIKE '%repeat%'
     OR v LIKE '%neighbor%' OR v LIKE '%friend%' THEN
    RETURN 'referral';
  END IF;

  -- Fallback: resolve against the referral_sources lookup by name and map its
  -- category. Longest name match wins. Digital that did not hit a paid keyword
  -- above is treated as organic; traditional/other are zero-spend "other".
  SELECT category INTO v_cat
    FROM referral_sources
   WHERE lower(name) = v OR v LIKE '%' || lower(name) || '%'
   ORDER BY length(name) DESC
   LIMIT 1;

  IF v_cat IS NULL THEN RETURN 'other'; END IF;
  RETURN CASE v_cat
    WHEN 'insurance'   THEN 'insurance'
    WHEN 'digital'     THEN 'organic'
    WHEN 'traditional' THEN 'other'
    WHEN 'other'       THEN 'other'
    ELSE 'referral'  -- personal, trade, program, real_estate, emergency
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION crm_channel_for_source(text) TO anon, authenticated;

-- 3. get_attribution_rollup(...) — the per-channel funnel aggregate ───────────
-- Raw counts + sums ONLY; the derived money math (cost-per-lead, ROAS,
-- cost-per-job, rates, the null-for-zero-spend rule) lives in the pure,
-- unit-tested src/lib/attribution.js — never in SQL. Always returns all six
-- channels (VALUES list) so zero-spend Referral/Organic/Insurance rows always
-- render (as "—" via the JS layer), never silently disappear.
--
-- Grain: leads counted per lead (CallRail = truth); estimates/won-jobs/revenue
-- counted per contact's LAST-TOUCH channel with COUNT(DISTINCT job) guarding
-- the one-contact-many-jobs fan-out. Anything with no resolvable channel folds
-- into 'other' (unattributed/direct) so funnel totals stay complete.
-- Date filters are UTC-day on each entity's own timestamp (a first-pass "what
-- happened in this window" view; ad_spend.date is already a plain date).
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
      AND (p_start_date IS NULL OR il.occurred_at >= p_start_date::timestamptz)
      AND (p_end_date   IS NULL OR il.occurred_at <  (p_end_date + 1)::timestamptz)
    GROUP BY 1
  ),
  est_agg AS (
    SELECT COALESCE(cc.channel, 'other') AS channel, COUNT(DISTINCT e.id) AS estimates
    FROM estimates e
    LEFT JOIN contact_channel cc ON cc.contact_id = e.contact_id
    WHERE e.status <> 'draft'  -- "estimate sent" = anything past draft
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

-- 4. get_attribution_by_campaign(...) — paid-campaign detail (Google split by agency) ─
-- One row per (platform, campaign) with spend + leads matched by campaign name.
-- Powers the Attribution page's "Google Ads split by agency" breakdown, where
-- the agency is encoded in campaign_name ("Arturo Campaign", "Michael Campaign").
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

-- 5. get_crm_revenue_by_division(...) — Reports: won revenue by division ──────
-- NB: namespaced get_crm_* to avoid colliding with the pre-existing
-- get_revenue_by_division(date,date)->jsonb (a different, unrelated function).
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

GRANT EXECUTE ON FUNCTION get_crm_revenue_by_division(date, date) TO anon, authenticated;

-- 6. upsert_lead_attribution(...) — RPC write path (manual entry / enrichment) ─
-- Keeps lead_attribution writes going through an RPC (convention: RLS + RPC
-- writes on new CRM tables). Not wired to UI this phase — the dashboards are
-- read-only — but this is the seam a future "set attribution" control uses.
CREATE OR REPLACE FUNCTION upsert_lead_attribution(
  p_channel            text,
  p_source             text        DEFAULT NULL,
  p_campaign           text        DEFAULT NULL,
  p_lead_id            uuid        DEFAULT NULL,
  p_contact_id         uuid        DEFAULT NULL,
  p_referral_source_id uuid        DEFAULT NULL,
  p_occurred_at        timestamptz DEFAULT NULL,
  p_created_by         uuid        DEFAULT NULL,
  p_org_id             uuid        DEFAULT NULL
)
RETURNS lead_attribution
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_row lead_attribution;
BEGIN
  IF p_channel NOT IN ('google_ads','meta_ads','organic','referral','insurance','other') THEN
    RAISE EXCEPTION 'invalid attribution channel: %', p_channel;
  END IF;
  IF p_lead_id IS NULL AND p_contact_id IS NULL THEN
    RAISE EXCEPTION 'lead_attribution needs a lead_id or a contact_id';
  END IF;
  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  INSERT INTO lead_attribution (
    org_id, lead_id, contact_id, channel, source, campaign,
    referral_source_id, occurred_at, created_by
  ) VALUES (
    v_org, p_lead_id, p_contact_id, p_channel, p_source, p_campaign,
    p_referral_source_id, COALESCE(p_occurred_at, now()), p_created_by
  )
  RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_attributed', 'lead_attribution', v_row.id, p_created_by,
          jsonb_build_object('channel', p_channel, 'campaign', p_campaign));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_lead_attribution(
  text, text, text, uuid, uuid, uuid, timestamptz, uuid, uuid
) TO anon, authenticated;

-- 7. Bust PostgREST schema cache ──────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
