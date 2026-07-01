-- ════════════════════════════════════════════════
-- Migration: CRM lead caller name (from call transcript)
-- ════════════════════════════════════════════════
-- WHY: A Claude pass over the transcript identifies the caller's name (see
--   functions/api/transcribe-call.js). Store it on the lead so the Call Log shows
--   a real name instead of a bare phone number, and — only when the lead already
--   has a linked contact whose name is blank — backfill that contact's name.
--   NEVER create a contact here: raw inbound calls (much of it spam) must not
--   pollute the contacts table (consistent with the ingestion design where
--   upsert_lead_from_callrail links-if-exists but never creates).
--
-- Additive-only: one new column + one new RPC.
-- ════════════════════════════════════════════════

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS caller_name text;

CREATE OR REPLACE FUNCTION public.set_lead_caller_name(
  p_lead_id uuid,
  p_name    text
)
RETURNS inbound_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row  inbound_leads;
  v_name text := NULLIF(btrim(p_name), '');
BEGIN
  -- Nothing usable → return the row unchanged (no-op, not an error).
  IF v_name IS NULL THEN
    SELECT * INTO v_row FROM inbound_leads WHERE id = p_lead_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
    END IF;
    RETURN v_row;
  END IF;

  -- Only fill caller_name if blank — a re-run (or a real name already there) wins.
  UPDATE inbound_leads
     SET caller_name = COALESCE(NULLIF(btrim(caller_name), ''), v_name),
         updated_at  = now()
   WHERE id = p_lead_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  -- Backfill the linked contact's name ONLY if it is currently blank. Never
  -- create a contact (see WHY above).
  IF v_row.contact_id IS NOT NULL THEN
    UPDATE contacts
       SET name = v_name
     WHERE id = v_row.contact_id
       AND COALESCE(NULLIF(btrim(name), ''), '') = '';
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_caller_named', 'inbound_lead', v_row.id, NULL,
          jsonb_build_object('name', v_name, 'contact_id', v_row.contact_id));

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_lead_caller_name(uuid, text) TO anon, authenticated;
