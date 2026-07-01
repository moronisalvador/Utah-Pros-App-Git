-- ─────────────────────────────────────────────────────────────────────────────
-- CRM intake — raw calls no longer auto-create contacts
--
-- Most inbound calls are spam / wrong numbers / price shoppers. Auto-creating a
-- contact for each one floods the contacts table (and, via the QBO customer
-- trigger, QuickBooks) with junk. New rule: every call is still LOGGED as an
-- inbound_lead, but a contact is created only when the lead is qualified —
-- either it books (the app's existing find-or-create-by-phone flows) or staff
-- promote it here.
--
-- Two changes, both function-only (no schema change):
--   1. upsert_lead_from_callrail — LINK to an existing contact by phone if one
--      exists, but never CREATE one. (The old spam / <15s contact-creation gate
--      is moot now that nothing is auto-created.)
--   2. promote_lead_to_contact — the "Add as customer" action: find-or-create a
--      contact by the lead's phone, set name/email, and link the lead(s).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Ingestion: link-if-exists, never create ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_lead_from_callrail(
  p_callrail_id text, p_source_type text, p_tracking_number text DEFAULT NULL::text,
  p_caller_number text DEFAULT NULL::text, p_duration_sec integer DEFAULT NULL::integer,
  p_spam_flag boolean DEFAULT false, p_source text DEFAULT NULL::text, p_medium text DEFAULT NULL::text,
  p_campaign text DEFAULT NULL::text, p_recording_url text DEFAULT NULL::text, p_transcription text DEFAULT NULL::text,
  p_form_data jsonb DEFAULT NULL::jsonb, p_lead_status text DEFAULT 'new'::text, p_value numeric DEFAULT NULL::numeric,
  p_direction text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now(),
  p_raw_payload jsonb DEFAULT '{}'::jsonb, p_org_id uuid DEFAULT NULL::uuid
)
RETURNS inbound_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id     uuid;
  v_contact_id uuid;
  v_existed    boolean;
  v_row        inbound_leads;
BEGIN
  IF p_source_type NOT IN ('call', 'form') THEN
    RAISE EXCEPTION 'invalid inbound_leads source_type: %', p_source_type;
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  -- Link to an EXISTING contact by phone (so a known customer's call lands on
  -- their timeline), but NEVER create one. A contact is created only when the
  -- lead is qualified: it books (normal find-or-create flows) or staff promote
  -- it via promote_lead_to_contact().
  IF p_caller_number IS NOT NULL THEN
    SELECT id INTO v_contact_id FROM contacts WHERE phone = p_caller_number LIMIT 1;
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
$function$;

-- 2. Promote a lead to a contact — the "Add as customer" action ───────────────
CREATE OR REPLACE FUNCTION promote_lead_to_contact(
  p_lead_id    uuid,
  p_name       text DEFAULT NULL,
  p_email      text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS inbound_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead       inbound_leads;
  v_phone      text;
  v_name       text := nullif(btrim(p_name), '');
  v_email      text := nullif(btrim(p_email), '');
  v_contact_id uuid;
BEGIN
  SELECT * INTO v_lead FROM inbound_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  v_phone := nullif(btrim(v_lead.caller_number), '');
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'this lead has no phone number to create a contact from';
  END IF;

  -- Find-or-create by phone (the lead's caller_number is already E.164 from
  -- CallRail); backfill name/email only where the contact doesn't have them.
  SELECT id INTO v_contact_id FROM contacts WHERE phone = v_phone LIMIT 1;
  IF v_contact_id IS NULL THEN
    INSERT INTO contacts (phone, name, email) VALUES (v_phone, v_name, v_email)
    RETURNING id INTO v_contact_id;
  ELSE
    UPDATE contacts
       SET name  = COALESCE(NULLIF(btrim(name), ''), v_name),
           email = COALESCE(NULLIF(btrim(email), ''), v_email),
           updated_at = now()
     WHERE id = v_contact_id;
  END IF;

  -- Link this lead and any other still-unlinked leads from the same number.
  UPDATE inbound_leads
     SET contact_id = v_contact_id, updated_at = now()
   WHERE caller_number = v_phone AND contact_id IS NULL;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_promoted', 'inbound_lead', p_lead_id, p_created_by,
          jsonb_build_object('contact_id', v_contact_id));

  SELECT * INTO v_lead FROM inbound_leads WHERE id = p_lead_id;
  RETURN v_lead;
END;
$$;

GRANT EXECUTE ON FUNCTION promote_lead_to_contact(uuid, text, text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
