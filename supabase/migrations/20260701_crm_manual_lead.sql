-- ─────────────────────────────────────────────────────────────────────────────
-- CRM — create_manual_lead (Leads board "New lead" button)
--
-- Phase 4a shipped the Leads pipeline board, but leads could only arrive via
-- CallRail ingestion (Phase 1). This adds a manual-entry path so staff can add
-- a lead by hand (walk-in, referral, a number handed over) — the "+ Add
-- opportunity" HighLevel has — and so the board is testable before CallRail is
-- connected.
--
-- ALL ADDITIVE: one new SECURITY DEFINER function, zero schema changes. No new
-- tables/columns needed — a manual lead is just an inbound_leads row:
--   * callrail_id is NOT NULL + UNIQUE, so a manual lead synthesizes a unique
--     'manual:<uuid>' id (it has no CallRail id).
--   * source_type is CHECK-constrained to ('call','form'); an additive-only
--     phase must not ALTER that live constraint, so manual leads use 'form'
--     with the real origin carried in the source column (e.g. 'Referral').
--   * the contact is matched/created by phone, mirroring
--     upsert_lead_from_callrail's contact handling.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_manual_lead(
  p_phone       text,
  p_name        text DEFAULT NULL,
  p_source      text DEFAULT 'Manual entry',
  p_value       numeric DEFAULT NULL,
  p_org_id      uuid DEFAULT NULL,
  p_created_by  uuid DEFAULT NULL
)
RETURNS inbound_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     uuid;
  v_phone      text := nullif(btrim(p_phone), '');
  v_name       text := nullif(btrim(p_name), '');
  v_contact_id uuid;
  v_row        inbound_leads;
BEGIN
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'a phone number is required to add a lead';
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  -- Match an existing contact by phone, else create one. Backfill the name
  -- onto an existing contact only when it doesn't already have one.
  SELECT id INTO v_contact_id FROM contacts WHERE phone = v_phone LIMIT 1;
  IF v_contact_id IS NULL THEN
    INSERT INTO contacts (phone, name) VALUES (v_phone, v_name)
    RETURNING id INTO v_contact_id;
  ELSIF v_name IS NOT NULL THEN
    UPDATE contacts SET name = v_name, updated_at = now()
     WHERE id = v_contact_id AND (name IS NULL OR btrim(name) = '');
  END IF;

  INSERT INTO inbound_leads (
    org_id, contact_id, source_type, callrail_id, caller_number,
    source, lead_status, value, spam_flag, direction, occurred_at, raw_payload
  ) VALUES (
    v_org_id, v_contact_id, 'form', 'manual:' || gen_random_uuid()::text, v_phone,
    COALESCE(nullif(btrim(p_source), ''), 'Manual entry'), 'new', p_value, false,
    'manual', now(), jsonb_build_object('manual', true, 'created_by', p_created_by)
  )
  RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_created_manual', 'inbound_lead', v_row.id, p_created_by,
          jsonb_build_object('source', v_row.source, 'contact_id', v_contact_id));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION create_manual_lead(text, text, text, numeric, uuid, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
