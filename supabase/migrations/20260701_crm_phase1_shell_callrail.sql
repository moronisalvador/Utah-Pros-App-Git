-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 1 — CRM shell + CallRail lead ingestion (calls + form submissions)
--
-- docs/crm-roadmap.md, "Phase 1 — CRM shell + CallRail lead ingestion". Adds
-- the inbound_leads table (calls + web-form leads from CallRail) and its
-- ingestion/follow-up RPCs. "Lead" is deliberately NOT called `leads` — that
-- name is reserved for a raw call/form touch that may never become anything,
-- distinct from Leads.jsx (jobs in phase='lead') and Phase 4a's own pipeline;
-- see the roadmap's terminology-fix note.
--
-- ALL ADDITIVE: one new table, two new functions, one existing function
-- widened (get_integration_status — see note below), no existing table
-- altered. RLS enabled at creation, per CLAUDE.md Rule 7.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. inbound_leads — a raw call or form touch, upserted from CallRail ─────────
CREATE TABLE IF NOT EXISTS inbound_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES crm_orgs(id),
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  source_type     text NOT NULL CHECK (source_type IN ('call', 'form')),
  callrail_id     text NOT NULL UNIQUE,
  tracking_number text,
  caller_number   text,
  duration_sec    int,
  spam_flag       boolean NOT NULL DEFAULT false,
  source          text,
  medium          text,
  campaign        text,
  recording_url   text,
  transcription   text,
  form_data       jsonb,
  lead_status     text NOT NULL DEFAULT 'new',
  value           numeric,
  direction       text,
  occurred_at     timestamptz,
  raw_payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_leads_contact ON inbound_leads(contact_id);
CREATE INDEX IF NOT EXISTS idx_inbound_leads_org ON inbound_leads(org_id);
CREATE INDEX IF NOT EXISTS idx_inbound_leads_occurred ON inbound_leads(occurred_at DESC);

ALTER TABLE inbound_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_leads_all" ON inbound_leads;
CREATE POLICY "inbound_leads_all" ON inbound_leads
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 2. upsert_lead_from_callrail(...) — the ingestion RPC ───────────────────────
-- Called by functions/api/callrail-webhook.js for every CallRail event (call
-- completed, recording ready, form submitted). CallRail fires more than one
-- webhook per call, so this is a true upsert-and-merge keyed on callrail_id,
-- never an insert-once: fields present in the new payload overwrite, fields
-- absent (null) preserve whatever was already saved.
CREATE OR REPLACE FUNCTION upsert_lead_from_callrail(
  p_callrail_id     text,
  p_source_type     text,
  p_tracking_number text DEFAULT NULL,
  p_caller_number   text DEFAULT NULL,
  p_duration_sec    int DEFAULT NULL,
  p_spam_flag       boolean DEFAULT false,
  p_source          text DEFAULT NULL,
  p_medium          text DEFAULT NULL,
  p_campaign        text DEFAULT NULL,
  p_recording_url   text DEFAULT NULL,
  p_transcription   text DEFAULT NULL,
  p_form_data       jsonb DEFAULT NULL,
  p_lead_status     text DEFAULT 'new',
  p_value           numeric DEFAULT NULL,
  p_direction       text DEFAULT NULL,
  p_occurred_at     timestamptz DEFAULT now(),
  p_raw_payload     jsonb DEFAULT '{}'::jsonb,
  p_org_id          uuid DEFAULT NULL
)
RETURNS inbound_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id         uuid;
  v_contact_id     uuid;
  v_create_contact boolean;
  v_existed        boolean;
  v_row            inbound_leads;
BEGIN
  IF p_source_type NOT IN ('call', 'form') THEN
    RAISE EXCEPTION 'invalid inbound_leads source_type: %', p_source_type;
  END IF;

  -- Defaults to the real Utah Pros org; callers (tests, the dedicated dev
  -- tracking number) pass the "Utah Pros — TEST" org id explicitly.
  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  -- Spam/robocall/wrong-number/hangup filter (mirrored as a pure JS predicate,
  -- shouldCreateContact(), in functions/lib/callrail.js for unit testing —
  -- this is the server-side source of truth the RPC actually enforces).
  v_create_contact := (NOT p_spam_flag) AND (p_duration_sec IS NULL OR p_duration_sec >= 15);

  IF v_create_contact AND p_caller_number IS NOT NULL THEN
    SELECT id INTO v_contact_id FROM contacts WHERE phone = p_caller_number LIMIT 1;
    IF v_contact_id IS NULL THEN
      INSERT INTO contacts (phone, opt_in_status, opt_in_source, opt_in_at)
      VALUES (p_caller_number, false, 'crm_inbound_lead', now())
      RETURNING id INTO v_contact_id;
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM inbound_leads WHERE callrail_id = p_callrail_id) INTO v_existed;

  INSERT INTO inbound_leads (
    org_id, contact_id, source_type, callrail_id, tracking_number, caller_number,
    duration_sec, spam_flag, source, medium, campaign, recording_url, transcription,
    form_data, lead_status, value, direction, occurred_at, raw_payload
  ) VALUES (
    v_org_id, v_contact_id, p_source_type, p_callrail_id, p_tracking_number, p_caller_number,
    p_duration_sec, p_spam_flag, p_source, p_medium, p_campaign, p_recording_url, p_transcription,
    p_form_data, p_lead_status, p_value, p_direction, p_occurred_at, p_raw_payload
  )
  ON CONFLICT (callrail_id) DO UPDATE SET
    contact_id      = COALESCE(inbound_leads.contact_id, EXCLUDED.contact_id),
    tracking_number = COALESCE(EXCLUDED.tracking_number, inbound_leads.tracking_number),
    caller_number   = COALESCE(EXCLUDED.caller_number, inbound_leads.caller_number),
    duration_sec    = COALESCE(EXCLUDED.duration_sec, inbound_leads.duration_sec),
    spam_flag       = EXCLUDED.spam_flag,
    source          = COALESCE(EXCLUDED.source, inbound_leads.source),
    medium          = COALESCE(EXCLUDED.medium, inbound_leads.medium),
    campaign        = COALESCE(EXCLUDED.campaign, inbound_leads.campaign),
    recording_url   = COALESCE(EXCLUDED.recording_url, inbound_leads.recording_url),
    transcription   = COALESCE(EXCLUDED.transcription, inbound_leads.transcription),
    form_data       = COALESCE(EXCLUDED.form_data, inbound_leads.form_data),
    value           = COALESCE(EXCLUDED.value, inbound_leads.value),
    raw_payload     = EXCLUDED.raw_payload,
    updated_at      = now()
  RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES (
    CASE WHEN v_existed THEN 'crm_lead_updated' ELSE 'crm_lead_created' END,
    'inbound_lead',
    v_row.id,
    jsonb_build_object('source_type', v_row.source_type, 'callrail_id', v_row.callrail_id, 'contact_id', v_row.contact_id)
  );

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_lead_from_callrail(
  text, text, text, text, int, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamptz, jsonb, uuid
) TO anon, authenticated;

-- 3. update_lead_status(...) — staff follow-up on a lead ──────────────────────
CREATE OR REPLACE FUNCTION update_lead_status(
  p_lead_id     uuid,
  p_status      text,
  p_notes       text DEFAULT NULL,
  p_updated_by  uuid DEFAULT NULL
)
RETURNS inbound_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row inbound_leads;
BEGIN
  UPDATE inbound_leads
     SET lead_status = p_status,
         notes       = COALESCE(p_notes, notes),
         updated_at  = now()
   WHERE id = p_lead_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_status_updated', 'inbound_lead', v_row.id, p_updated_by, jsonb_build_object('status', p_status));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION update_lead_status(uuid, text, text, uuid) TO anon, authenticated;

-- 4. Widen get_integration_status() for API-key-only providers ───────────────
-- CallRail has no OAuth — its API key lives in integration_credentials.access_token
-- with refresh_token left NULL (there's no refresh flow to run). The existing
-- QBO-authored function only checked refresh_token IS NOT NULL, which would
-- always report CallRail as "not connected" even once a key is saved. This
-- widens the check to also recognize an access_token-only connection; QBO's
-- own behavior is unchanged (it always has both set together once connected),
-- so this is a strict superset, not a behavior change for existing callers.
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
  LEFT JOIN integration_credentials c ON c.provider = p_provider;
$$;

GRANT EXECUTE ON FUNCTION get_integration_status(text) TO anon, authenticated;

-- 5. Seed the phase-1 build stage checklist status is already seeded by Phase 0;
--    nothing to add here — set_crm_phase_status / set_crm_stage_status handle
--    marking phase-1 in_progress/shipped at close-out.

-- 6. Bust PostgREST schema cache ───────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
