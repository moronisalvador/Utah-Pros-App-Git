-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 2 — Ad spend ingestion (Google Ads + Meta Ads)
--
-- docs/crm-roadmap.md, "Phase 2 — Ad spend ingestion". Adds the ad_spend
-- table and its upsert/reader RPCs. Google/Meta each track their own
-- conversions, which will not reconcile with CallRail's numbers — CallRail
-- leads + actual won jobs in UPR remain the one source of truth for the
-- funnel, so platform_conversions is deliberately named that (not
-- `conversions`) and is informational only; the Phase 3 dashboard only ever
-- pulls spend dollars from this table.
--
-- ALL ADDITIVE: one new table, two new functions, no existing table altered.
-- RLS enabled at creation, per CLAUDE.md Rule 7. org_id carried from day one
-- per the roadmap's multi-tenancy hedge (crm_orgs seam), same as
-- inbound_leads in the Phase 1 migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. ad_spend — one row per platform/campaign/day, upserted daily ────────────
CREATE TABLE IF NOT EXISTS ad_spend (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES crm_orgs(id),
  platform              text NOT NULL CHECK (platform IN ('google', 'meta')),
  campaign_id           text NOT NULL,
  campaign_name         text,
  date                  date NOT NULL,
  spend                 numeric NOT NULL DEFAULT 0,
  impressions           int,
  clicks                int,
  platform_conversions  numeric,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_org_date ON ad_spend(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_spend_platform_date ON ad_spend(platform, date DESC);

ALTER TABLE ad_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_spend_all" ON ad_spend;
CREATE POLICY "ad_spend_all" ON ad_spend
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 2. upsert_ad_spend(...) — the daily-cron ingestion RPC ─────────────────────
-- Called by functions/api/sync-google-ads.js / sync-meta-ads.js once per
-- campaign per day. Upserts on (platform, campaign_id, date) so a re-run of
-- the same day (safety-net re-pull, or a backfill overlapping the live cron)
-- corrects that day's numbers in place instead of duplicating rows — ad
-- platforms commonly revise a day's reported spend for up to ~72 hours after
-- it happened, so this needs to stay a true upsert, not an insert-once.
CREATE OR REPLACE FUNCTION upsert_ad_spend(
  p_platform              text,
  p_campaign_id           text,
  p_campaign_name         text DEFAULT NULL,
  p_date                  date DEFAULT NULL,
  p_spend                 numeric DEFAULT 0,
  p_impressions           int DEFAULT NULL,
  p_clicks                int DEFAULT NULL,
  p_platform_conversions  numeric DEFAULT NULL,
  p_org_id                uuid DEFAULT NULL
)
RETURNS ad_spend
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_row    ad_spend;
BEGIN
  IF p_platform NOT IN ('google', 'meta') THEN
    RAISE EXCEPTION 'invalid ad_spend platform: %', p_platform;
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'ad_spend date is required';
  END IF;

  -- Defaults to the real Utah Pros org; the dedicated "Utah Pros — TEST" org
  -- (Test-data isolation) is passed explicitly by tests/dev-mode syncs.
  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  INSERT INTO ad_spend (
    org_id, platform, campaign_id, campaign_name, date,
    spend, impressions, clicks, platform_conversions
  ) VALUES (
    v_org_id, p_platform, p_campaign_id, p_campaign_name, p_date,
    p_spend, p_impressions, p_clicks, p_platform_conversions
  )
  ON CONFLICT (platform, campaign_id, date) DO UPDATE SET
    campaign_name        = COALESCE(EXCLUDED.campaign_name, ad_spend.campaign_name),
    spend                = EXCLUDED.spend,
    impressions          = EXCLUDED.impressions,
    clicks               = EXCLUDED.clicks,
    platform_conversions = EXCLUDED.platform_conversions,
    updated_at           = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_ad_spend(
  text, text, text, date, numeric, int, int, numeric, uuid
) TO anon, authenticated;

-- 3. get_ad_spend(...) — read helper for verification + the Phase 3 dashboard ─
CREATE OR REPLACE FUNCTION get_ad_spend(
  p_platform   text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL
)
RETURNS SETOF ad_spend
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM ad_spend
  WHERE (p_platform IS NULL OR platform = p_platform)
    AND (p_start_date IS NULL OR date >= p_start_date)
    AND (p_end_date IS NULL OR date <= p_end_date)
  ORDER BY date DESC, platform, campaign_name;
$$;

GRANT EXECUTE ON FUNCTION get_ad_spend(text, date, date) TO anon, authenticated;

-- 4. Bust PostgREST schema cache ───────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
