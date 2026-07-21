-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_disqualify_lead_if_open
-- Phase: n/a — standalone production feature, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a helper function the call-transcription worker uses to automatically
--   move a lead to the "Lost" pipeline stage the moment the AI call-summary
--   step detects the caller has a real service request, just not one Utah
--   Pros offers (e.g. HVAC/dryer-vent cleaning instead of water/fire/mold
--   restoration) — the same kind of call that today gets manually moved to
--   Lost by hand with a reason like "Wanted dryer-vent/HVAC cleaning — not a
--   service we offer". Only ever touches a lead that's still open (not
--   already Won/Lost), and never a lead already flagged as spam.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. One new SECURITY DEFINER function. No table
--   created/dropped/altered, no column added/renamed/removed, no existing
--   function's signature or body changed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION public.crm_disqualify_lead_if_open(uuid, text);
--   Any lead already moved to "Lost" by this function keeps its
--   lead_pipeline_stage row and lost_reason exactly as move_lead_to_stage set
--   them — that's correct data, not something to revert; move those leads by
--   hand afterward if this is ever rolled back.
-- ════════════════════════════════════════════════

-- ─── Lead-scoped, terminal-aware disqualify (move to "Lost") ─────────────────
-- Sibling of crm_advance_lead_if_forward, but unlike that function this is NOT
-- a sort_order-forward-only move — "Lost" is a disqualification, not a
-- pipeline-position check, so a lead can be moved here from ANY non-terminal
-- stage regardless of sort_order. Guards: unknown lead, spam-flagged lead, a
-- currently-terminal (Won/Lost) stage, or an org with no "Lost" stage all
-- silently no-op — same non-destructive contract as crm_advance_lead_if_forward.
CREATE OR REPLACE FUNCTION public.crm_disqualify_lead_if_open(
  p_lead_id uuid,
  p_reason text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead             record;
  v_current_terminal boolean;
  v_lost_stage_id    uuid;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN;
  END IF;

  SELECT il.id, il.org_id, il.spam_flag, lps.stage_id AS current_stage_id
    INTO v_lead
    FROM inbound_leads il
    LEFT JOIN lead_pipeline_stage lps ON lps.lead_id = il.id
   WHERE il.id = p_lead_id;

  IF NOT FOUND OR COALESCE(v_lead.spam_flag, false) THEN
    RETURN; -- unknown lead, or spam — never touch
  END IF;

  v_current_terminal := false;
  IF v_lead.current_stage_id IS NOT NULL THEN
    SELECT (is_won OR is_lost) INTO v_current_terminal
      FROM pipeline_stages
     WHERE id = v_lead.current_stage_id;
  END IF;

  IF COALESCE(v_current_terminal, false) THEN
    RETURN; -- already Won/Lost — terminal, never move it again
  END IF;

  SELECT id INTO v_lost_stage_id
    FROM pipeline_stages
   WHERE org_id = v_lead.org_id AND is_lost = true
   ORDER BY sort_order
   LIMIT 1;

  IF v_lost_stage_id IS NULL OR v_lost_stage_id = v_lead.current_stage_id THEN
    RETURN; -- no "Lost" stage for this org, or already there
  END IF;

  PERFORM move_lead_to_stage(p_lead_id, v_lost_stage_id, NULL, p_reason);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_disqualify_lead_if_open(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_disqualify_lead_if_open(uuid, text) TO authenticated, service_role;
