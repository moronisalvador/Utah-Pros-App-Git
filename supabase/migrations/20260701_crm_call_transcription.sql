-- ════════════════════════════════════════════════
-- Migration: CRM call transcription (Deepgram)
-- ════════════════════════════════════════════════
-- WHY: Our CallRail plan does not expose transcripts via the API (that needs
--   CallRail's $110/mo Premium Conversation Intelligence add-on). Instead we
--   transcribe the call audio ourselves with Deepgram Nova and store the result
--   in the existing inbound_leads.transcription column. These two additive
--   columns record WHERE a transcript came from and WHEN, so a future source
--   (or CallRail CI, if ever enabled) is distinguishable.
--
-- Additive-only (CRM phase rule): new columns + new RPC. No ALTER of types,
-- no DROP/rename of anything live. inbound_leads already has RLS enabled;
-- writes stay RPC-only via the SECURITY DEFINER function below.
-- ════════════════════════════════════════════════

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS transcription_source text,
  ADD COLUMN IF NOT EXISTS transcribed_at        timestamptz;

-- Store a transcript on a lead. Modeled on update_lead_status (same style:
-- SECURITY DEFINER, search_path pinned, RAISE on unknown id, system_events log).
CREATE OR REPLACE FUNCTION public.set_lead_transcription(
  p_lead_id       uuid,
  p_transcription text,
  p_source        text DEFAULT 'deepgram'
)
RETURNS inbound_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row inbound_leads;
BEGIN
  UPDATE inbound_leads
     SET transcription        = p_transcription,
         transcription_source = p_source,
         transcribed_at       = now(),
         updated_at           = now()
   WHERE id = p_lead_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_call_transcribed', 'inbound_lead', v_row.id, NULL,
          jsonb_build_object('source', p_source, 'chars', length(COALESCE(p_transcription, ''))));

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_lead_transcription(uuid, text, text) TO anon, authenticated;
