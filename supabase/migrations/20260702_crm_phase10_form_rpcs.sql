-- ════════════════════════════════════════════════
-- CRM Phase 10 — CRM Forms: fill the three frozen RPC bodies.
-- ════════════════════════════════════════════════
-- Foundation (Phase F) shipped these as signature-frozen stubs that raise
-- 'not implemented (phase 10)'. This migration is FUNCTION-BODY-ONLY: the
-- CREATE OR REPLACE statements below keep every argument list, return type,
-- SECURITY DEFINER flag and GRANT exactly as Foundation declared them — only
-- the body changes (migration-safety-checker enforces the signature freeze).
--
-- No schema is touched here: form_definitions / form_definition_versions /
-- form_submissions and all columns already exist (Phase F wave schema).
--   • upsert_form            — create/edit a form; draft→publish versioning
--   • get_forms              — list forms with published/draft schema + submissions
--   • upsert_lead_from_form  — a submission → contact + inbound_lead + attribution
--                              + (on consent) an sms_consent_log opt-in + events
-- ════════════════════════════════════════════════

-- ═══ 1. upsert_form ═══
-- Editing always writes to a working DRAFT version; publishing flips that draft
-- to published and repoints form_definitions.published_version_id. A published
-- version row is never mutated afterward — the next edit starts a fresh draft
-- one version above it, so every published snapshot stays immutable/revertable.
CREATE OR REPLACE FUNCTION upsert_form(
  p_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_schema jsonb DEFAULT '{}'::jsonb,
  p_theme jsonb DEFAULT '{}'::jsonb,
  p_status text DEFAULT NULL,
  p_publish boolean DEFAULT false,
  p_turnstile_enabled boolean DEFAULT false,
  p_org_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS form_definitions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org        uuid;
  v_form       form_definitions;
  v_public_id  text;
  v_latest     form_definition_versions;
  v_draft      form_definition_versions;
  v_has_schema boolean := (p_schema IS NOT NULL AND p_schema <> '{}'::jsonb);
BEGIN
  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  IF p_id IS NULL THEN
    -- New form: generate a short, URL-safe, unique public_id.
    LOOP
      v_public_id := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM form_definitions WHERE public_id = v_public_id);
    END LOOP;

    INSERT INTO form_definitions (org_id, public_id, name, status, theme, turnstile_enabled, created_by)
    VALUES (v_org, v_public_id,
            COALESCE(nullif(btrim(p_name), ''), 'Untitled form'),
            'draft',
            CASE WHEN p_theme IS NULL OR p_theme = '{}'::jsonb THEN '{}'::jsonb ELSE p_theme END,
            COALESCE(p_turnstile_enabled, false), p_created_by)
    RETURNING * INTO v_form;

    INSERT INTO form_definition_versions (form_id, org_id, version, schema, is_published, created_by)
    VALUES (v_form.id, v_org, 1, COALESCE(p_schema, '{}'::jsonb), false, p_created_by)
    RETURNING * INTO v_draft;
  ELSE
    SELECT * INTO v_form FROM form_definitions WHERE id = p_id;
    IF v_form.id IS NULL THEN RAISE EXCEPTION 'form % not found', p_id; END IF;

    UPDATE form_definitions SET
      name  = COALESCE(nullif(btrim(p_name), ''), name),
      theme = CASE WHEN p_theme IS NULL OR p_theme = '{}'::jsonb THEN theme ELSE p_theme END,
      -- only touch turnstile on a genuine save/publish, never on a read-only call
      turnstile_enabled = CASE WHEN v_has_schema OR p_publish THEN COALESCE(p_turnstile_enabled, turnstile_enabled) ELSE turnstile_enabled END,
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_form;

    SELECT * INTO v_latest FROM form_definition_versions
      WHERE form_id = p_id ORDER BY version DESC LIMIT 1;

    IF v_has_schema THEN
      IF v_latest.id IS NULL THEN
        INSERT INTO form_definition_versions (form_id, org_id, version, schema, is_published, created_by)
        VALUES (p_id, v_form.org_id, 1, p_schema, false, p_created_by)
        RETURNING * INTO v_draft;
      ELSIF v_latest.is_published THEN
        -- published rows are immutable — open a fresh draft above them
        INSERT INTO form_definition_versions (form_id, org_id, version, schema, is_published, created_by)
        VALUES (p_id, v_form.org_id, v_latest.version + 1, p_schema, false, p_created_by)
        RETURNING * INTO v_draft;
      ELSE
        UPDATE form_definition_versions SET schema = p_schema WHERE id = v_latest.id
        RETURNING * INTO v_draft;
      END IF;
    ELSE
      v_draft := v_latest; -- no schema change; publish target (if any) is the latest version
    END IF;
  END IF;

  IF p_publish AND v_draft.id IS NOT NULL THEN
    UPDATE form_definition_versions SET is_published = true, published_at = now()
    WHERE id = v_draft.id
    RETURNING * INTO v_draft;

    UPDATE form_definitions SET
      published_version_id = v_draft.id, status = 'published', updated_at = now()
    WHERE id = v_form.id
    RETURNING * INTO v_form;
  ELSIF p_status IS NOT NULL AND p_status IN ('draft', 'published', 'archived') THEN
    UPDATE form_definitions SET status = p_status, updated_at = now()
    WHERE id = v_form.id
    RETURNING * INTO v_form;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES (CASE WHEN p_publish THEN 'crm_form_published' ELSE 'crm_form_saved' END,
          'form_definition', v_form.id, p_created_by,
          jsonb_build_object('status', v_form.status, 'version', COALESCE(v_draft.version, 1),
                             'public_id', v_form.public_id));

  RETURN v_form;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_form(uuid, text, jsonb, jsonb, text, boolean, boolean, uuid, uuid) TO anon, authenticated;

-- ═══ 2. get_forms ═══
-- One json object per form: its published + draft schema, submission count, and
-- the most recent submissions (bounded) so the builder's submissions view needs
-- no extra RPC. Archived forms are hidden.
CREATE OR REPLACE FUNCTION get_forms(p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  RETURN QUERY
  SELECT json_build_object(
    'id', f.id,
    'public_id', f.public_id,
    'name', f.name,
    'status', f.status,
    'theme', f.theme,
    'turnstile_enabled', f.turnstile_enabled,
    'published_version_id', f.published_version_id,
    'created_at', f.created_at,
    'updated_at', f.updated_at,
    'published_schema', (SELECT v.schema  FROM form_definition_versions v WHERE v.id = f.published_version_id),
    'published_version', (SELECT v.version FROM form_definition_versions v WHERE v.id = f.published_version_id),
    'draft_schema',  (SELECT v.schema  FROM form_definition_versions v WHERE v.form_id = f.id ORDER BY v.version DESC LIMIT 1),
    'draft_version', (SELECT v.version FROM form_definition_versions v WHERE v.form_id = f.id ORDER BY v.version DESC LIMIT 1),
    'submission_count', (SELECT count(*) FROM form_submissions s WHERE s.form_id = f.id),
    'submissions', COALESCE((
      SELECT json_agg(sub ORDER BY sub.created_at DESC)
      FROM (
        SELECT s.id, s.submission_token, s.data, s.utm, s.lead_id, s.contact_id, s.is_spam, s.created_at
        FROM form_submissions s
        WHERE s.form_id = f.id
        ORDER BY s.created_at DESC
        LIMIT 200
      ) sub
    ), '[]'::json)
  )
  FROM form_definitions f
  WHERE f.org_id = v_org AND f.status <> 'archived'
  ORDER BY f.updated_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_forms(uuid) TO anon, authenticated;

-- ═══ 3. upsert_lead_from_form ═══
-- Idempotent on callrail_id = 'form:' || submission_token (the create_manual_lead
-- 'manual:' precedent). Find-or-create the contact by normalized phone; log the
-- inbound_lead; attribute via upsert_lead_attribution + crm_channel_for_source;
-- on consent write an sms_consent_log opt-in (IP + consent-text version); fire
-- crm_lead_created (so speed-to-lead triggers on form leads) + crm_form_submitted.
CREATE OR REPLACE FUNCTION upsert_lead_from_form(
  p_form_id uuid,
  p_submission_token text,
  p_data jsonb,
  p_utm jsonb DEFAULT '{}'::jsonb,
  p_consent boolean DEFAULT false,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL
) RETURNS inbound_leads
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_form        form_definitions;
  v_version     form_definition_versions;
  v_schema      jsonb;
  v_org         uuid;
  v_callrail_id text := 'form:' || COALESCE(p_submission_token, '');
  v_field       jsonb;
  v_phone_key   text;
  v_email_key   text;
  v_name_key    text;
  v_consent_lbl text := 'SMS consent';
  v_raw_phone   text;
  v_phone       text;
  v_digits      text;
  v_name        text;
  v_email       text;
  v_contact_id  uuid;
  v_source      text;
  v_medium      text;
  v_campaign    text;
  v_channel     text;
  v_row         inbound_leads;
BEGIN
  IF p_submission_token IS NULL OR btrim(p_submission_token) = '' THEN
    RAISE EXCEPTION 'submission_token is required';
  END IF;

  SELECT * INTO v_form FROM form_definitions WHERE id = p_form_id;
  IF v_form.id IS NULL THEN RAISE EXCEPTION 'form % not found', p_form_id; END IF;
  IF v_form.published_version_id IS NULL THEN RAISE EXCEPTION 'form % is not published', p_form_id; END IF;

  SELECT * INTO v_version FROM form_definition_versions WHERE id = v_form.published_version_id;
  v_schema := COALESCE(v_version.schema, '{}'::jsonb);
  v_org := COALESCE(p_org_id, v_form.org_id);

  -- ── idempotency: this submission token was already processed ──
  SELECT * INTO v_row FROM inbound_leads WHERE callrail_id = v_callrail_id;
  IF v_row.id IS NOT NULL THEN
    RETURN v_row; -- no duplicate lead, no repeated contact/consent/attribution/events
  END IF;

  -- ── locate the phone / email / name fields by their type in the published schema ──
  FOR v_field IN SELECT * FROM jsonb_array_elements(COALESCE(v_schema->'fields', '[]'::jsonb)) LOOP
    IF v_field->>'type' = 'phone' AND v_phone_key IS NULL THEN v_phone_key := v_field->>'key'; END IF;
    IF v_field->>'type' = 'email' AND v_email_key IS NULL THEN v_email_key := v_field->>'key'; END IF;
    IF v_field->>'type' = 'consent' THEN v_consent_lbl := COALESCE(nullif(btrim(v_field->>'label'), ''), v_consent_lbl); END IF;
    IF v_field->>'type' = 'text' AND v_name_key IS NULL
       AND ((v_field->>'key') = 'name' OR lower(COALESCE(v_field->>'label', '')) LIKE '%name%')
    THEN v_name_key := v_field->>'key'; END IF;
  END LOOP;

  v_raw_phone := CASE WHEN v_phone_key IS NOT NULL THEN p_data->>v_phone_key ELSE NULL END;
  v_email     := CASE WHEN v_email_key IS NOT NULL THEN p_data->>v_email_key ELSE NULL END;
  v_name      := CASE WHEN v_name_key  IS NOT NULL THEN p_data->>v_name_key  ELSE NULL END;

  -- normalize the phone to E.164, mirroring src/lib/phone.js normalizePhone
  v_digits := regexp_replace(COALESCE(v_raw_phone, ''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_digits := '1' || v_digits; END IF;
  IF length(v_digits) >= 10 THEN v_phone := '+' || v_digits; ELSE v_phone := NULL; END IF;

  -- find-or-create the contact by normalized phone
  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_contact_id FROM contacts WHERE phone = v_phone LIMIT 1;
    IF v_contact_id IS NULL THEN
      INSERT INTO contacts (phone, name, email, opt_in_status)
      VALUES (v_phone, nullif(btrim(v_name), ''), nullif(btrim(v_email), ''), false)
      RETURNING id INTO v_contact_id;
    ELSE
      UPDATE contacts SET
        name  = COALESCE(name, nullif(btrim(v_name), '')),
        email = COALESCE(email, nullif(btrim(v_email), '')),
        updated_at = now()
      WHERE id = v_contact_id;
    END IF;
  END IF;

  -- attribution inputs from the forwarded UTM
  v_source   := COALESCE(p_utm->>'utm_source', p_utm->>'source');
  v_medium   := COALESCE(p_utm->>'utm_medium', p_utm->>'medium');
  v_campaign := COALESCE(p_utm->>'utm_campaign', p_utm->>'campaign');
  v_channel  := crm_channel_for_source(v_source);

  -- ── the lead (insert-once; ON CONFLICT guards a race on the token) ──
  INSERT INTO inbound_leads (
    org_id, contact_id, source_type, callrail_id, caller_number,
    spam_flag, source, medium, campaign, form_data, lead_status,
    direction, occurred_at, raw_payload
  ) VALUES (
    v_org, v_contact_id, 'form', v_callrail_id, v_phone,
    false, COALESCE(nullif(btrim(v_source), ''), v_form.name), v_medium, v_campaign, p_data, 'new',
    'inbound', now(),
    jsonb_build_object('form_id', v_form.id, 'public_id', v_form.public_id,
                       'utm', COALESCE(p_utm, '{}'::jsonb), 'user_agent', p_user_agent, 'ip', p_ip)
  )
  ON CONFLICT (callrail_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM inbound_leads WHERE callrail_id = v_callrail_id;
    RETURN v_row; -- lost a race; treat as idempotent
  END IF;

  -- record the raw submission (unique on token)
  INSERT INTO form_submissions (
    form_id, version_id, org_id, submission_token, data, utm,
    lead_id, contact_id, ip_address, user_agent, is_spam
  ) VALUES (
    v_form.id, v_form.published_version_id, v_org, p_submission_token, p_data, COALESCE(p_utm, '{}'::jsonb),
    v_row.id, v_contact_id, p_ip, p_user_agent, false
  )
  ON CONFLICT (submission_token) DO NOTHING;

  -- attribution (channel always resolves; 'other' worst case)
  PERFORM upsert_lead_attribution(v_channel, v_source, v_campaign, v_row.id, v_contact_id, NULL, now(), NULL, v_org);

  -- consent → a real SMS opt-in with IP + consent-text version (TCPA audit trail)
  IF p_consent AND v_contact_id IS NOT NULL AND v_phone IS NOT NULL THEN
    UPDATE contacts SET
      opt_in_status = true, opt_in_source = 'web_form', opt_in_at = now(),
      opt_out_at = NULL, opt_out_reason = NULL, updated_at = now()
    WHERE id = v_contact_id;

    INSERT INTO sms_consent_log (contact_id, phone, event_type, source, details, ip_address)
    VALUES (v_contact_id, v_phone, 'opt_in', 'web_form',
            'Web-form consent (form ' || v_form.public_id || ' v' || COALESCE(v_version.version, 1) || '): ' || v_consent_lbl,
            p_ip);
  END IF;

  -- events: lead created (drives speed-to-lead) + form submitted
  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_lead_created', 'inbound_lead', v_row.id,
          jsonb_build_object('source_type', 'form', 'form_id', v_form.id, 'contact_id', v_contact_id));

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_form_submitted', 'form_definition', v_form.id,
          jsonb_build_object('submission_token', p_submission_token, 'lead_id', v_row.id,
                             'contact_id', v_contact_id, 'public_id', v_form.public_id));

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_lead_from_form(uuid, text, jsonb, jsonb, boolean, text, text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
