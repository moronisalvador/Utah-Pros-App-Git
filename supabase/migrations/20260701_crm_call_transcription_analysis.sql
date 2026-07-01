-- ════════════════════════════════════════════════
-- Migration: CRM call transcription — structured analysis (v2)
-- ════════════════════════════════════════════════
-- WHY: We now pull more than plain text from Deepgram — speaker-attributed turns
--   (Agent/Customer from the stereo recording), a call summary, sentiment, topics,
--   and detected entities. Store that structured result as JSONB alongside the
--   flat `transcription` text (which stays for search / a future LLM to read).
--
-- Additive-only: one new JSONB column (mirrors the existing raw_payload/form_data
-- JSONB pattern on inbound_leads). The RPC is replaced to accept the analysis —
-- replacing a function is fine; the additive-only rule guards live TABLES, and no
-- table data is altered/dropped here.
-- ════════════════════════════════════════════════

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS transcript_analysis jsonb;

-- Replace the 3-arg writer with a 4-arg version that also stores the analysis.
DROP FUNCTION IF EXISTS public.set_lead_transcription(uuid, text, text);

CREATE OR REPLACE FUNCTION public.set_lead_transcription(
  p_lead_id       uuid,
  p_transcription text,
  p_source        text  DEFAULT 'deepgram',
  p_analysis      jsonb DEFAULT NULL
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
         transcript_analysis  = COALESCE(p_analysis, transcript_analysis),
         transcribed_at       = now(),
         updated_at           = now()
   WHERE id = p_lead_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_call_transcribed', 'inbound_lead', v_row.id, NULL,
          jsonb_build_object(
            'source', p_source,
            'chars', length(COALESCE(p_transcription, '')),
            'has_analysis', (p_analysis IS NOT NULL)
          ));

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_lead_transcription(uuid, text, text, jsonb) TO anon, authenticated;
