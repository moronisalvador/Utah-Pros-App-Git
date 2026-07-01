-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 4c — Email campaigns
--
-- docs/crm-roadmap.md, "Phase 4c — Email campaigns". Adds segmented bulk email
-- campaigns sent via Resend (functions/lib/email.js + automated-send.js), with
-- a real unsubscribe-suppression list — the compliance gate every send routes
-- through (functions/lib/email-consent.js's emailAllows(), wired into
-- functions/lib/automated-send.js's sendGatedEmail so it's structurally
-- impossible to bypass).
--
-- Built BEFORE Phase 4b (text blasts) per an explicit reprioritization: 4b is
-- blocked on Twilio A2P 10DLC carrier approval (external, days-to-weeks lead
-- time); email runs on Resend, already integrated, with no such dependency.
-- The roadmap's own hard prerequisite for 4c is the CRM shell + Phases 3/4a
-- merged into dev (confirmed live at build time), not 4b — 4b's mention in
-- the roadmap's prerequisite line is the linear-chain default, not a real
-- data/code dependency (4c introduces its own tables and does not touch
-- anything Phase 4b would have added).
--
-- WHY NEW TABLES INSTEAD OF THE EXISTING `campaigns`/`campaign_recipients`:
-- those two tables already exist live (pre-existing — Marketing.jsx already
-- queries `campaigns`; not part of this migration, not touched here) but are
-- hard-wired for SMS: `campaigns.campaign_type` has a CHECK constraint whose
-- allowed values are sms_blast/review_request/follow_up/seasonal/
-- reactivation/custom (no 'email_blast'), and `campaign_recipients.phone` is
-- NOT NULL with no email column. Adding an email campaign type/column to
-- either would mean ALTERing a live table, which this phase's rules forbid
-- (additive-only — see CLAUDE.md "CRM Phase Workflow"). So email campaigns
-- get their own fully-additive tables below; the legacy SMS tables are left
-- exactly as they are for Phase 4b to use unchanged.
--
-- ALL ADDITIVE: three new tables, six new functions, one feature_flags DATA
-- update (page:marketing gains a dev_only_user_id so Moroni can preview the
-- new Email tab the same way page:crm gates the rest of the CRM build — no
-- schema change, just the same UPDATE-not-ALTER a flag flip already is). No
-- existing table altered. RLS enabled at creation, per CLAUDE.md Rule 7.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. email_suppressions — the compliance-critical unsubscribe/bounce list ────
CREATE TABLE IF NOT EXISTS email_suppressions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES crm_orgs(id),
  email         text NOT NULL,
  reason        text NOT NULL DEFAULT 'unsubscribed' CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual')),
  source        text,
  suppressed_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive: an address is suppressed regardless of casing on a later send.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_suppressions_email ON email_suppressions (lower(email));
CREATE INDEX IF NOT EXISTS idx_email_suppressions_org ON email_suppressions(org_id);

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_suppressions_all" ON email_suppressions;
CREATE POLICY "email_suppressions_all" ON email_suppressions
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 2. email_campaigns — one row per bulk send ──────────────────────────────────
CREATE TABLE IF NOT EXISTS email_campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES crm_orgs(id),
  name              text NOT NULL,
  subject           text NOT NULL,
  template_id       uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  body_html         text NOT NULL DEFAULT '',
  audience_filter   jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  audience_count    int NOT NULL DEFAULT 0,
  total_sent        int NOT NULL DEFAULT 0,
  total_suppressed  int NOT NULL DEFAULT 0,
  total_failed      int NOT NULL DEFAULT 0,
  scheduled_at      timestamptz,
  sent_at           timestamptz,
  created_by        uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_org ON email_campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_created ON email_campaigns(created_at DESC);

ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_campaigns_all" ON email_campaigns;
CREATE POLICY "email_campaigns_all" ON email_campaigns
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 3. email_campaign_recipients — the snapshotted audience for one campaign ────
CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email         text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'suppressed', 'failed')),
  resend_id     text,
  error_message text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_campaign ON email_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_status ON email_campaign_recipients(campaign_id, status);

ALTER TABLE email_campaign_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_campaign_recipients_all" ON email_campaign_recipients;
CREATE POLICY "email_campaign_recipients_all" ON email_campaign_recipients
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 4. preview_email_audience(...) — resolves an audience_filter to contact rows ─
-- Segmentation is off contacts/referral_sources per the roadmap: referral_source
-- (matches contacts.referral_source, a free-text column also populated from the
-- referral_sources picklist), role, and a tags-jsonb containment check. Always
-- excludes contacts with no email, DND contacts, and any suppressed address —
-- these three exclusions are non-negotiable regardless of the filter passed in.
--
-- NOTE: unlike SMS (TCPA — opt-in required, see contacts.opt_in_status used by
-- send-message.js), marketing email in the US is governed by CAN-SPAM, which is
-- opt-OUT based — a prior opt-in is not legally required. So this deliberately
-- does NOT filter on opt_in_status; only DND + suppression are hard excludes.
CREATE OR REPLACE FUNCTION preview_email_audience(
  p_filter jsonb DEFAULT '{}'::jsonb,
  p_org_id uuid DEFAULT NULL
)
RETURNS TABLE(contact_id uuid, name text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.name, c.email
  FROM contacts c
  WHERE c.email IS NOT NULL AND c.email <> ''
    AND NOT c.dnd
    AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE lower(es.email) = lower(c.email))
    AND (p_filter->>'referral_source' IS NULL OR c.referral_source = p_filter->>'referral_source')
    AND (p_filter->>'role' IS NULL OR c.role = p_filter->>'role')
    AND (p_filter->>'tag' IS NULL OR c.tags @> to_jsonb(ARRAY[p_filter->>'tag']))
  ORDER BY c.name;
$$;

GRANT EXECUTE ON FUNCTION preview_email_audience(jsonb, uuid) TO anon, authenticated;

-- 5. get_email_campaigns(...) — read helper for the Marketing.jsx Email tab ───
CREATE OR REPLACE FUNCTION get_email_campaigns(p_org_id uuid DEFAULT NULL)
RETURNS SETOF email_campaigns
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM email_campaigns
  WHERE org_id = COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1))
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_email_campaigns(uuid) TO anon, authenticated;

-- 6. upsert_email_campaign(...) — create (p_id NULL) or edit a draft campaign ──
CREATE OR REPLACE FUNCTION upsert_email_campaign(
  p_id              uuid DEFAULT NULL,
  p_name            text DEFAULT NULL,
  p_subject         text DEFAULT NULL,
  p_template_id     uuid DEFAULT NULL,
  p_body_html       text DEFAULT '',
  p_audience_filter jsonb DEFAULT '{}'::jsonb,
  p_org_id          uuid DEFAULT NULL,
  p_created_by      uuid DEFAULT NULL
)
RETURNS email_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_count  int;
  v_row    email_campaigns;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Campaign name is required';
  END IF;
  IF p_subject IS NULL OR btrim(p_subject) = '' THEN
    RAISE EXCEPTION 'Subject line is required';
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  SELECT count(*) INTO v_count FROM preview_email_audience(p_audience_filter, v_org_id);

  IF p_id IS NULL THEN
    INSERT INTO email_campaigns (org_id, name, subject, template_id, body_html, audience_filter, audience_count, created_by)
    VALUES (v_org_id, btrim(p_name), btrim(p_subject), p_template_id, COALESCE(p_body_html, ''), COALESCE(p_audience_filter, '{}'::jsonb), v_count, p_created_by)
    RETURNING * INTO v_row;
  ELSE
    UPDATE email_campaigns
       SET name = btrim(p_name),
           subject = btrim(p_subject),
           template_id = p_template_id,
           body_html = COALESCE(p_body_html, ''),
           audience_filter = COALESCE(p_audience_filter, '{}'::jsonb),
           audience_count = v_count,
           updated_at = now()
     WHERE id = p_id AND status = 'draft'
     RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Campaign not found or is no longer a draft';
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_email_campaign(uuid, text, text, uuid, text, jsonb, uuid, uuid) TO anon, authenticated;

-- 7. delete_email_campaign(...) — refuses on an in-flight/sent campaign ───────
CREATE OR REPLACE FUNCTION delete_email_campaign(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM email_campaigns WHERE id = p_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;
  IF v_status NOT IN ('draft', 'failed') THEN
    RAISE EXCEPTION 'Cannot delete a campaign that is % — only draft/failed campaigns can be deleted', v_status;
  END IF;
  DELETE FROM email_campaigns WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_email_campaign(uuid) TO anon, authenticated;

-- 8. queue_email_campaign(...) — snapshot the audience, flip to 'sending' ─────
-- Called by functions/api/send-email-campaign.js right before it loops the
-- recipients through sendGatedEmail. Idempotent: safe to call again on a
-- campaign that's still 'sending' (e.g. a retried worker invocation) — it
-- only (re)snapshots recipients that don't already have a row.
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
  ON CONFLICT (campaign_id, contact_id) DO NOTHING;

  SELECT count(*) INTO v_count FROM email_campaign_recipients WHERE campaign_id = p_campaign_id;

  UPDATE email_campaigns SET status = 'sending', audience_count = v_count, updated_at = now() WHERE id = p_campaign_id;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_email_campaign_queued', 'email_campaign', p_campaign_id, jsonb_build_object('recipient_count', v_count));

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION queue_email_campaign(uuid) TO anon, authenticated;

-- 9. record_email_campaign_send(...) — per-recipient result + campaign rollup ──
-- Called once per recipient by the send worker after sendGatedEmail resolves.
-- Auto-flips the campaign to 'sent' once no 'pending' recipients remain, so
-- there is no separate "finalize" call the worker has to remember to make.
CREATE OR REPLACE FUNCTION record_email_campaign_send(
  p_recipient_id  uuid,
  p_status        text,
  p_resend_id     text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_pending     int;
BEGIN
  IF p_status NOT IN ('sent', 'suppressed', 'failed') THEN
    RAISE EXCEPTION 'invalid recipient status: %', p_status;
  END IF;

  UPDATE email_campaign_recipients
     SET status = p_status,
         resend_id = p_resend_id,
         error_message = p_error_message,
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END
   WHERE id = p_recipient_id
   RETURNING campaign_id INTO v_campaign_id;

  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Recipient row not found';
  END IF;

  UPDATE email_campaigns SET
    total_sent       = (SELECT count(*) FROM email_campaign_recipients WHERE campaign_id = v_campaign_id AND status = 'sent'),
    total_suppressed = (SELECT count(*) FROM email_campaign_recipients WHERE campaign_id = v_campaign_id AND status = 'suppressed'),
    total_failed      = (SELECT count(*) FROM email_campaign_recipients WHERE campaign_id = v_campaign_id AND status = 'failed'),
    updated_at = now()
  WHERE id = v_campaign_id;

  SELECT count(*) INTO v_pending FROM email_campaign_recipients WHERE campaign_id = v_campaign_id AND status = 'pending';

  IF v_pending = 0 THEN
    UPDATE email_campaigns SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = v_campaign_id AND status = 'sending';

    INSERT INTO system_events (event_type, entity_type, entity_id, payload)
    VALUES ('crm_email_campaign_sent', 'email_campaign', v_campaign_id, jsonb_build_object());
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION record_email_campaign_send(uuid, text, text, text) TO anon, authenticated;

-- 10. email_unsubscribe(...) — the public unsubscribe-link write path ─────────
-- Called by functions/api/email-unsubscribe.js with EITHER a recipient id
-- (from a campaign send's footer link — resolves the email/campaign from
-- email_campaign_recipients) OR a bare email (from a future non-campaign
-- automated send, Phase 4d). Upserts into email_suppressions so a repeat
-- click never errors or duplicates.
CREATE OR REPLACE FUNCTION email_unsubscribe(
  p_email        text DEFAULT NULL,
  p_recipient_id uuid DEFAULT NULL,
  p_org_id       uuid DEFAULT NULL
)
RETURNS email_suppressions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email       text;
  v_campaign_id uuid;
  v_org_id      uuid;
  v_row         email_suppressions;
BEGIN
  v_email := p_email;

  IF p_recipient_id IS NOT NULL THEN
    SELECT email, campaign_id INTO v_email, v_campaign_id
    FROM email_campaign_recipients WHERE id = p_recipient_id;

    IF v_campaign_id IS NOT NULL THEN
      UPDATE email_campaign_recipients SET status = 'suppressed' WHERE id = p_recipient_id AND status != 'sent';
    END IF;
  END IF;

  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'No email address to unsubscribe';
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  INSERT INTO email_suppressions (org_id, email, reason, source)
  VALUES (v_org_id, btrim(v_email), 'unsubscribed', 'email_unsubscribe_link')
  ON CONFLICT (lower(email)) DO UPDATE SET suppressed_at = now()
  RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_email_unsubscribed', 'email_suppression', v_row.id, jsonb_build_object('email', v_row.email, 'campaign_id', v_campaign_id));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION email_unsubscribe(text, uuid, uuid) TO anon, authenticated;

-- 11. page:marketing gains a dev_only_user_id — DATA update, not a schema
-- change (same mechanism page:crm already uses). Lets Moroni preview the new
-- Email tab in Marketing.jsx; `enabled` stays false so every other employee
-- still sees nothing, unchanged from today. Only sets it if not already set,
-- so this is idempotent and never clobbers a value an admin already chose.
UPDATE feature_flags
   SET dev_only_user_id = 'd1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da'
 WHERE key = 'page:marketing' AND dev_only_user_id IS NULL;
