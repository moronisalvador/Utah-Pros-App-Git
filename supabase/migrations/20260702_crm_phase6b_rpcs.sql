-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 6b — Ownership, CSV import, staff roles & audit hardening (RPC bodies)
--
-- docs/crm-roadmap.md "Phase 6b" + .claude/rules/crm-wave-ownership.md (§3, §4).
-- FUNCTION-BODY-ONLY replaces — every signature below is unchanged from Phase F's
-- frozen stubs / the live Phase 4c email-campaign RPCs. Zero schema changes: no
-- new table, column, constraint, policy or index (Foundation owns 100% of schema
-- for the wave). This migration only fills bodies:
--
--   1. import_contacts        — was RAISE 'not implemented (phase 6b)'
--   2. set_contact_owner      — was RAISE 'not implemented (phase 6b)'
--   3. set_contact_lifecycle  — was RAISE 'not implemented (phase 6b)'
--   4. set_campaign_exclusions   ┐ audit-hardening: add system_events writes;
--   5. upsert_email_campaign     │ signatures + behavior unchanged, so every
--   6. delete_email_campaign     │ existing caller still succeeds. Proof:
--   7. record_email_campaign_send┘ supabase/tests/crm_phase6b_audit_hardening.test.js
--
-- One shared Supabase for dev + main — every REPLACE below is live in both the
-- moment it applies. The four email-campaign replaces are backward-compatible
-- (new INSERTs into the append-only system_events log only), so Marketing.jsx
-- and functions/api/send-email-campaign.js keep working with no code change.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. import_contacts — CSV import with dedupe-on-import + batch audit row ═══
-- Dedupes each incoming row against existing contacts on a NORMALIZED phone
-- (last 10 digits, matching get_duplicate_contacts) OR normalized email
-- (lower(btrim(...))). A match → fill-blanks UPDATE (never overwrites a non-null
-- existing value); no match → INSERT. Because the lookup re-queries contacts on
-- every row (including ones inserted earlier in this same batch), duplicates
-- WITHIN one file collapse too — a phone/email appearing twice creates exactly
-- one contact. contacts has no org_id column (verified live) — only the
-- crm_import_batches audit row is org-scoped. Errors never abort the batch: a
-- row that throws is counted + recorded in the errors array and the loop
-- continues, so one bad row can't lose the rest of the file.
CREATE OR REPLACE FUNCTION import_contacts(
  p_rows jsonb, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL, p_filename text DEFAULT NULL)
RETURNS crm_import_batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id       uuid;
  v_batch        crm_import_batches;
  v_row          jsonb;
  v_idx          int  := 0;
  v_total        int  := 0;
  v_created      int  := 0;
  v_updated      int  := 0;
  v_skipped      int  := 0;
  v_errored      int  := 0;
  v_errors       jsonb := '[]'::jsonb;
  v_phone_digits text;
  v_phone_key    text;
  v_email_raw    text;
  v_email_key    text;
  v_existing     uuid;
  v_owner        uuid;
  v_tags         jsonb;
BEGIN
  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'import_contacts: p_rows must be a JSON array';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx   := v_idx + 1;
    v_total := v_total + 1;
    BEGIN
      v_phone_digits := regexp_replace(COALESCE(v_row->>'phone', ''), '[^0-9]', '', 'g');
      v_phone_key    := CASE WHEN length(v_phone_digits) >= 10 THEN right(v_phone_digits, 10) ELSE NULL END;
      v_email_raw    := NULLIF(btrim(COALESCE(v_row->>'email', '')), '');
      v_email_key    := lower(v_email_raw);

      -- A row with no phone AND no email has nothing to match or create on.
      IF v_phone_key IS NULL AND v_email_key IS NULL THEN
        v_skipped := v_skipped + 1;
        v_errors  := v_errors || jsonb_build_object('row', v_idx, 'reason', 'no phone or email');
        CONTINUE;
      END IF;

      v_owner := NULL;
      IF NULLIF(btrim(COALESCE(v_row->>'owner_id', '')), '') IS NOT NULL THEN
        BEGIN v_owner := (v_row->>'owner_id')::uuid; EXCEPTION WHEN others THEN v_owner := NULL; END;
      END IF;
      v_tags := CASE WHEN jsonb_typeof(v_row->'tags') = 'array' THEN v_row->'tags' ELSE NULL END;

      SELECT id INTO v_existing FROM contacts
      WHERE (v_phone_key IS NOT NULL
              AND length(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) >= 10
              AND right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key)
         OR (v_email_key IS NOT NULL AND lower(btrim(COALESCE(email, ''))) = v_email_key)
      ORDER BY created_at
      LIMIT 1;

      IF v_existing IS NOT NULL THEN
        -- Fill blanks only — COALESCE(existing, incoming) keeps every value the
        -- contact already has; import never clobbers curated data.
        UPDATE contacts SET
          name             = COALESCE(name, NULLIF(btrim(COALESCE(v_row->>'name', '')), '')),
          email            = COALESCE(NULLIF(btrim(COALESCE(email, '')), ''), v_email_raw),
          phone            = COALESCE(NULLIF(btrim(COALESCE(phone, '')), ''), NULLIF(btrim(COALESCE(v_row->>'phone', '')), '')),
          company          = COALESCE(company, NULLIF(btrim(COALESCE(v_row->>'company', '')), '')),
          role             = COALESCE(role, NULLIF(btrim(COALESCE(v_row->>'role', '')), '')),
          referral_source  = COALESCE(referral_source, NULLIF(btrim(COALESCE(v_row->>'referral_source', '')), '')),
          notes            = COALESCE(notes, NULLIF(btrim(COALESCE(v_row->>'notes', '')), '')),
          billing_address  = COALESCE(billing_address, NULLIF(btrim(COALESCE(v_row->>'billing_address', '')), '')),
          billing_city     = COALESCE(billing_city, NULLIF(btrim(COALESCE(v_row->>'billing_city', '')), '')),
          billing_state    = COALESCE(billing_state, NULLIF(btrim(COALESCE(v_row->>'billing_state', '')), '')),
          billing_zip      = COALESCE(billing_zip, NULLIF(btrim(COALESCE(v_row->>'billing_zip', '')), '')),
          phone_secondary  = COALESCE(phone_secondary, NULLIF(btrim(COALESCE(v_row->>'phone_secondary', '')), '')),
          lifecycle_status = COALESCE(lifecycle_status, NULLIF(btrim(COALESCE(v_row->>'lifecycle_status', '')), '')),
          owner_id         = COALESCE(owner_id, v_owner),
          tags             = COALESCE(tags, v_tags),
          updated_at       = now()
        WHERE id = v_existing;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO contacts (
          name, email, phone, company, role, referral_source, notes,
          billing_address, billing_city, billing_state, billing_zip, phone_secondary,
          lifecycle_status, owner_id, tags)
        VALUES (
          NULLIF(btrim(COALESCE(v_row->>'name', '')), ''),
          v_email_raw,
          NULLIF(btrim(COALESCE(v_row->>'phone', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'company', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'role', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'referral_source', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'notes', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'billing_address', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'billing_city', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'billing_state', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'billing_zip', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'phone_secondary', '')), ''),
          NULLIF(btrim(COALESCE(v_row->>'lifecycle_status', '')), ''),
          v_owner,
          v_tags);
        v_created := v_created + 1;
      END IF;
    EXCEPTION WHEN others THEN
      v_errored := v_errored + 1;
      v_errors  := v_errors || jsonb_build_object('row', v_idx, 'reason', SQLERRM);
    END;
  END LOOP;

  INSERT INTO crm_import_batches (
    org_id, filename, status, total_rows, created_count, updated_count,
    skipped_count, error_count, errors, created_by, completed_at)
  VALUES (
    v_org_id, p_filename, 'complete', v_total, v_created, v_updated,
    v_skipped, v_errored, v_errors, p_created_by, now())
  RETURNING * INTO v_batch;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_contacts_imported', 'crm_import_batch', v_batch.id, p_created_by,
    jsonb_build_object(
      'total', v_total, 'created', v_created, 'updated', v_updated,
      'skipped', v_skipped, 'errors', v_errored, 'filename', p_filename));

  RETURN v_batch;
END;
$$;
GRANT EXECUTE ON FUNCTION import_contacts(jsonb, uuid, uuid, text) TO anon, authenticated;

-- ═══ 2. set_contact_owner — assign/clear the owning employee + audit event ═══
CREATE OR REPLACE FUNCTION set_contact_owner(p_contact_id uuid, p_owner_id uuid, p_actor_id uuid DEFAULT NULL)
RETURNS contacts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prev uuid; v_row contacts;
BEGIN
  SELECT owner_id INTO v_prev FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found'; END IF;

  -- NULL clears ownership; a non-null owner must be a real employee.
  IF p_owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employees WHERE id = p_owner_id) THEN
    RAISE EXCEPTION 'Owner (employee) not found: %', p_owner_id;
  END IF;

  UPDATE contacts SET owner_id = p_owner_id, updated_at = now()
    WHERE id = p_contact_id RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_contact_owner_set', 'contact', p_contact_id, p_actor_id,
    jsonb_build_object('owner_id', p_owner_id, 'previous_owner_id', v_prev));

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION set_contact_owner(uuid, uuid, uuid) TO anon, authenticated;

-- ═══ 3. set_contact_lifecycle — set/clear lifecycle stage + audit event ═══
-- contacts.lifecycle_status is a free-text column (no CHECK); this RPC is the
-- gate that keeps it to a known vocabulary. NULL/'' clears it.
CREATE OR REPLACE FUNCTION set_contact_lifecycle(p_contact_id uuid, p_lifecycle_status text, p_actor_id uuid DEFAULT NULL)
RETURNS contacts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prev text; v_row contacts; v_status text;
BEGIN
  v_status := NULLIF(btrim(COALESCE(p_lifecycle_status, '')), '');
  IF v_status IS NOT NULL AND v_status NOT IN ('lead', 'prospect', 'customer', 'past_customer', 'archived') THEN
    RAISE EXCEPTION 'Invalid lifecycle_status: %', v_status;
  END IF;

  SELECT lifecycle_status INTO v_prev FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found'; END IF;

  UPDATE contacts SET lifecycle_status = v_status, updated_at = now()
    WHERE id = p_contact_id RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_contact_lifecycle_set', 'contact', p_contact_id, p_actor_id,
    jsonb_build_object('lifecycle_status', v_status, 'previous_status', v_prev));

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION set_contact_lifecycle(uuid, text, uuid) TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT HARDENING — backward-compatible body replaces of the Phase 4c email-
-- campaign RPCs. Each adds a system_events write to close an audit gap noted in
-- docs/crm-roadmap.md ("Audit trail (system_events)" PARTIAL row). Signatures
-- and existing behavior are unchanged.
-- ═════════════════════════════════════════════════════════════════════════════

-- ═══ 4. set_campaign_exclusions — now logs the exclusion change ═══
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

  -- Audit hardening (Phase 6b): record who narrowed the audience and to what.
  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_email_campaign_exclusions_set', 'email_campaign', p_campaign_id,
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'excluded_count', COALESCE(array_length(p_contact_ids, 1), 0),
      'audience_count', v_count));

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION set_campaign_exclusions(uuid, uuid[]) TO anon, authenticated;

-- ═══ 5. upsert_email_campaign — now logs create vs edit ═══
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

    -- Audit hardening (Phase 6b): a new campaign was drafted.
    INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
    VALUES ('crm_email_campaign_created', 'email_campaign', v_row.id, p_created_by,
      jsonb_build_object('campaign_id', v_row.id, 'name', v_row.name, 'audience_count', v_row.audience_count));
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

    -- Audit hardening (Phase 6b): an existing draft was edited.
    INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
    VALUES ('crm_email_campaign_updated', 'email_campaign', v_row.id, p_created_by,
      jsonb_build_object('campaign_id', v_row.id, 'name', v_row.name, 'audience_count', v_row.audience_count));
  END IF;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_email_campaign(uuid, text, text, uuid, text, jsonb, uuid, uuid) TO anon, authenticated;

-- ═══ 6. delete_email_campaign — now logs the deletion ═══
CREATE OR REPLACE FUNCTION delete_email_campaign(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_name   text;
BEGIN
  SELECT status, name INTO v_status, v_name FROM email_campaigns WHERE id = p_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;
  IF v_status NOT IN ('draft', 'failed') THEN
    RAISE EXCEPTION 'Cannot delete a campaign that is % — only draft/failed campaigns can be deleted', v_status;
  END IF;
  DELETE FROM email_campaigns WHERE id = p_id;

  -- Audit hardening (Phase 6b): record the deletion (entity is gone, so the
  -- name/status live in the payload).
  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_email_campaign_deleted', 'email_campaign', p_id,
    jsonb_build_object('campaign_id', p_id, 'name', v_name, 'status', v_status));
END;
$$;
GRANT EXECUTE ON FUNCTION delete_email_campaign(uuid) TO anon, authenticated;

-- ═══ 7. record_email_campaign_send — sent event fires exactly once + counts ═══
-- BUG FIXED: the pre-6b body emitted crm_email_campaign_sent whenever no pending
-- recipients remained, WITHOUT checking that this call actually flipped the
-- campaign sending→sent. A retried/duplicate send on an already-'sent' campaign
-- (v_pending still 0) fired a second, duplicate event with an empty payload.
-- Now the event is INSERTed only inside the same transition (guarded by FOUND
-- after the status='sending'→'sent' UPDATE), and carries the sent/suppressed/
-- failed/total counts instead of an empty object.
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
  v_sent        int;
  v_suppressed  int;
  v_failed      int;
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
    UPDATE email_campaigns SET status = 'sent', sent_at = now(), updated_at = now()
     WHERE id = v_campaign_id AND status = 'sending'
     RETURNING total_sent, total_suppressed, total_failed INTO v_sent, v_suppressed, v_failed;

    -- FOUND is true only when THIS call performed the sending→sent transition,
    -- so the campaign-sent event fires exactly once even under retries.
    IF FOUND THEN
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_email_campaign_sent', 'email_campaign', v_campaign_id,
        jsonb_build_object(
          'sent', v_sent, 'suppressed', v_suppressed, 'failed', v_failed,
          'total', COALESCE(v_sent, 0) + COALESCE(v_suppressed, 0) + COALESCE(v_failed, 0)));
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION record_email_campaign_send(uuid, text, text, text) TO anon, authenticated;
