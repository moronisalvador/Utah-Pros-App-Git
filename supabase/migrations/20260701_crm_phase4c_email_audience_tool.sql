-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Campaigns — real audience selection tool (follow-up to Phase 4c)
--
-- Phase 4c's "Preview audience" only showed a bare count. This adds: the actual
-- list of matching contacts (with phone/role/referral_source for display and
-- {{phone}} substitution), more filter fields (tag exposed, city/company/search
-- added), and a way to manually exclude individual contacts from an otherwise
-- filter-matched audience.
--
-- ADDITIVE: one new table (email_campaign_exclusions), two new functions
-- (set_campaign_exclusions, get_campaign_exclusions). preview_email_audience is
-- DROPped and recreated (its RETURNS TABLE shape changes — Postgres requires a
-- DROP for that, CREATE OR REPLACE only allows unchanged output shape) and
-- queue_email_campaign is CREATE OR REPLACEd (same signature/return type, just
-- one added exclusion clause) — both are function replacements, not table
-- ALTERs, so this stays within the additive-only rule (which governs tables,
-- not functions — see e.g. get_integration_status being "widened" in Phase 1).
-- No existing table (email_campaigns, email_campaign_recipients, contacts) is
-- altered. RLS enabled at creation on the new table, per CLAUDE.md Rule 7.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. email_campaign_exclusions — manually-unchecked contacts for one campaign ─
-- The audience for a send is always `preview_email_audience(filter) MINUS
-- exclusions`, never a frozen snapshot — a filter widened after save picks up
-- new matches for free, and a manually-excluded contact stays excluded even if
-- they temporarily drop out of view under a narrower filter.
CREATE TABLE IF NOT EXISTS email_campaign_exclusions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id)
);

ALTER TABLE email_campaign_exclusions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_campaign_exclusions_all" ON email_campaign_exclusions;
CREATE POLICY "email_campaign_exclusions_all" ON email_campaign_exclusions
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 2. preview_email_audience(...) — widened: phone/role/referral_source in the
-- return shape (for display + {{phone}} substitution), new city/company/search
-- filters, and an optional p_limit for the UI's audience table. p_limit stays
-- NULL for every INTERNAL caller (upsert_email_campaign's count,
-- queue_email_campaign's actual send snapshot) — `LIMIT p_limit` is a Postgres
-- no-op when NULL, so those two keep seeing the full unbounded match set. Only
-- the frontend's "Load audience" table call passes p_limit (e.g. 500) — a
-- baked-in cap here would otherwise silently truncate the real send audience.
DROP FUNCTION IF EXISTS preview_email_audience(jsonb, uuid);

CREATE FUNCTION preview_email_audience(
  p_filter jsonb DEFAULT '{}'::jsonb,
  p_org_id uuid DEFAULT NULL,
  p_limit  int DEFAULT NULL
)
RETURNS TABLE(contact_id uuid, name text, email text, phone text, role text, referral_source text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.name, c.email, c.phone, c.role, c.referral_source
  FROM contacts c
  WHERE c.email IS NOT NULL AND c.email <> ''
    AND NOT c.dnd
    AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE lower(es.email) = lower(c.email))
    AND (p_filter->>'referral_source' IS NULL OR c.referral_source = p_filter->>'referral_source')
    AND (p_filter->>'role' IS NULL OR c.role = p_filter->>'role')
    AND (p_filter->>'tag' IS NULL OR c.tags @> to_jsonb(ARRAY[p_filter->>'tag']))
    AND (p_filter->>'city' IS NULL OR c.billing_city ILIKE '%' || (p_filter->>'city') || '%')
    AND (p_filter->>'company' IS NULL OR c.company ILIKE '%' || (p_filter->>'company') || '%')
    AND (
      p_filter->>'search' IS NULL
      OR c.name ILIKE '%' || (p_filter->>'search') || '%'
      OR c.email ILIKE '%' || (p_filter->>'search') || '%'
      OR c.phone ILIKE '%' || (p_filter->>'search') || '%'
    )
  ORDER BY c.name
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION preview_email_audience(jsonb, uuid, int) TO anon, authenticated;

-- 3. queue_email_campaign(...) — now also excludes manually-unchecked contacts
CREATE OR REPLACE FUNCTION queue_email_campaign(p_campaign_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign email_campaigns;
  v_count    int;
BEGIN
  SELECT * INTO v_campaign FROM email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;
  IF v_campaign.status NOT IN ('draft', 'sending') THEN
    RAISE EXCEPTION 'Campaign already % — cannot (re)queue', v_campaign.status;
  END IF;

  INSERT INTO email_campaign_recipients (campaign_id, contact_id, email)
  SELECT p_campaign_id, a.contact_id, a.email
  FROM preview_email_audience(v_campaign.audience_filter, v_campaign.org_id) a
  WHERE NOT EXISTS (
    SELECT 1 FROM email_campaign_exclusions ex
    WHERE ex.campaign_id = p_campaign_id AND ex.contact_id = a.contact_id
  )
  ON CONFLICT (campaign_id, contact_id) DO NOTHING;

  SELECT count(*) INTO v_count FROM email_campaign_recipients WHERE campaign_id = p_campaign_id;

  UPDATE email_campaigns SET status = 'sending', audience_count = v_count, updated_at = now() WHERE id = p_campaign_id;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_email_campaign_queued', 'email_campaign', p_campaign_id, jsonb_build_object('recipient_count', v_count));

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION queue_email_campaign(uuid) TO anon, authenticated;

-- 4. set_campaign_exclusions(...) — replaces the full exclusion set for a draft
-- campaign and recomputes audience_count to reflect who will ACTUALLY receive
-- the send (post-exclusion). Does not require an excluded contact_id to
-- currently be in the filter's results — every id the frontend ever sends
-- originated from a real preview_email_audience row (this session's load or a
-- restored get_campaign_exclusions call), and keeping it stored regardless is
-- what makes "filter widens later → still unchecked" work.
CREATE OR REPLACE FUNCTION set_campaign_exclusions(
  p_campaign_id uuid,
  p_contact_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS email_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign email_campaigns;
  v_count    int;
  v_row      email_campaigns;
BEGIN
  SELECT * INTO v_campaign FROM email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;
  IF v_campaign.status <> 'draft' THEN
    RAISE EXCEPTION 'Campaign is % — exclusions can only be set on a draft', v_campaign.status;
  END IF;

  DELETE FROM email_campaign_exclusions WHERE campaign_id = p_campaign_id;

  INSERT INTO email_campaign_exclusions (campaign_id, contact_id)
  SELECT p_campaign_id, x FROM unnest(p_contact_ids) x
  ON CONFLICT (campaign_id, contact_id) DO NOTHING;

  SELECT count(*) INTO v_count
  FROM preview_email_audience(v_campaign.audience_filter, v_campaign.org_id) a
  WHERE NOT EXISTS (
    SELECT 1 FROM email_campaign_exclusions ex
    WHERE ex.campaign_id = p_campaign_id AND ex.contact_id = a.contact_id
  );

  UPDATE email_campaigns SET audience_count = v_count, updated_at = now()
    WHERE id = p_campaign_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION set_campaign_exclusions(uuid, uuid[]) TO anon, authenticated;

-- 5. get_campaign_exclusions(...) — restores checkbox state when reopening a draft
CREATE OR REPLACE FUNCTION get_campaign_exclusions(p_campaign_id uuid)
RETURNS TABLE(contact_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT contact_id FROM email_campaign_exclusions WHERE campaign_id = p_campaign_id;
$$;

GRANT EXECUTE ON FUNCTION get_campaign_exclusions(uuid) TO anon, authenticated;
