-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_spam_flag_clears_pipeline_stage
-- Phase: n/a — standalone production feature, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   A spam-flagged lead (a vendor callback, a solicitor, a wrong number, dead
--   air) is not a lead at all — it should never sit on the Leads pipeline
--   board in any column, including "Lost" (Lost reads as a real, disqualified
--   lead, which spam is not). Every lead gets parked on a "New" stage the
--   moment it's created, before anything has had a chance to classify it as
--   spam — and a lead can separately get manually moved to a stage before
--   the AI (or a person) later flags it as spam. Either way, today the stage
--   assignment is left behind. This teaches set_lead_spam_flag to remove the
--   lead's current pipeline-stage assignment the moment it's flagged spam, so
--   it drops off the board entirely instead of lingering on whatever stage it
--   happened to be on.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Function-body-only CREATE OR REPLACE of the existing set_lead_spam_flag —
--   same signature (uuid, boolean, text), same return type, callers
--   unaffected. No table created/dropped/altered; only removes rows from the
--   existing lead_pipeline_stage table, and only for a lead being flagged
--   spam=true (never touched when un-flagging).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body (the version in
--   20260721_crm_call_ai_enrichment.sql) — drops the
--   "IF p_spam THEN DELETE FROM lead_pipeline_stage ..." block, restoring the
--   old behavior of leaving a spam lead's stage assignment in place. Any
--   lead_pipeline_stage row already deleted by this version stays deleted —
--   re-move those leads to a stage by hand if this is ever rolled back.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_lead_spam_flag(
  p_lead_id uuid,
  p_spam boolean,
  p_reason text DEFAULT NULL
)
 RETURNS inbound_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row  inbound_leads;
  v_prev boolean;
BEGIN
  SELECT spam_flag INTO v_prev FROM inbound_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  UPDATE inbound_leads
     SET spam_flag  = p_spam,
         updated_at = now()
   WHERE id = p_lead_id
   RETURNING * INTO v_row;

  IF COALESCE(v_prev, false) IS DISTINCT FROM p_spam THEN
    INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
    VALUES ('crm_lead_spam_flag_set', 'inbound_lead', v_row.id, NULL,
            jsonb_build_object('spam_flag', p_spam, 'reason', p_reason));
  END IF;

  -- A spam lead is not a lead at all — take it off the pipeline board
  -- entirely rather than leaving it parked on whatever stage it happened to
  -- be on (including "Lost", which reads as a real disqualified lead, not
  -- spam). Unconditional on p_spam (not just on the true→false transition)
  -- so a stage assigned or re-assigned AFTER the spam flag was already set
  -- still gets cleared the next time this runs. Never restores a stage when
  -- un-flagging — that's a deliberate manual decision, not this function's job.
  IF p_spam THEN
    DELETE FROM lead_pipeline_stage WHERE lead_id = p_lead_id;
  END IF;

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_lead_spam_flag(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_spam_flag(uuid, boolean, text) TO authenticated, service_role;
