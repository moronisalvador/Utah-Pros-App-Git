-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_inspection_scheduled_stage
-- Phase: n/a — standalone production feature, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a new "Inspection Scheduled" column to the Leads pipeline board, sitting
--   between "Qualified" and "Estimate Sent" for both orgs. Also adds a helper
--   function the transcription worker uses to move a lead into that stage the
--   moment the AI call-summary step detects a real inspection was agreed to on
--   the call — but only ever forward (never pulls an already-further-along or
--   Won/Lost lead backward), and never for a spam-flagged lead.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. One new pipeline_stages row per org (data, not schema — the table
--   already exists) + a sort_order renumber of the stages after it (Estimate
--   Sent/Won/Lost each +1; no lead's stage ASSIGNMENT changes, only the column's
--   display position). One new SECURITY DEFINER function. No table
--   created/dropped/altered, no column added/renamed/removed, no existing
--   function's signature or body changed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION public.crm_advance_lead_if_forward(uuid, text);
--   DELETE FROM pipeline_stages WHERE name = 'Inspection Scheduled'
--     AND org_id IN ('b1be7519-209b-493b-bb5b-b578b91db567', 'da326003-e2d9-4200-a15f-a834e398f64c');
--   -- then restore the prior sort_order (real org): Estimate Sent=4, Won=5, Lost=6
--   -- and (test org): Estimate Sent=3, Won=4, Lost=5.
--   Any lead already moved to "Inspection Scheduled" by the new function keeps
--   its lead_pipeline_stage row pointing at a now-deleted stage id — re-run the
--   reclassification pass used to seed the pipeline, or move those leads by hand,
--   before deleting the stage row if this is ever rolled back.
-- ════════════════════════════════════════════════

-- ─── Seed the new stage + renumber what comes after it ───────────────────────
-- Each UPDATE is itself guarded by the same NOT EXISTS check as its paired
-- INSERT, so a re-run (outside normal migration-history tracking) can't
-- double-shift sort_order while the INSERT correctly no-ops.
-- Real org.
UPDATE pipeline_stages SET sort_order = sort_order + 1
WHERE org_id = 'b1be7519-209b-493b-bb5b-b578b91db567' AND sort_order >= 4
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages
    WHERE org_id = 'b1be7519-209b-493b-bb5b-b578b91db567' AND name = 'Inspection Scheduled'
  );

INSERT INTO pipeline_stages (org_id, name, color, sort_order, is_won, is_lost)
SELECT 'b1be7519-209b-493b-bb5b-b578b91db567', 'Inspection Scheduled', '#14b8a6', 4, false, false
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stages
  WHERE org_id = 'b1be7519-209b-493b-bb5b-b578b91db567' AND name = 'Inspection Scheduled'
);

-- Test org (mirrors the same relative position: right after Qualified).
UPDATE pipeline_stages SET sort_order = sort_order + 1
WHERE org_id = 'da326003-e2d9-4200-a15f-a834e398f64c' AND sort_order >= 3
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages
    WHERE org_id = 'da326003-e2d9-4200-a15f-a834e398f64c' AND name = 'Inspection Scheduled'
  );

INSERT INTO pipeline_stages (org_id, name, color, sort_order, is_won, is_lost)
SELECT 'da326003-e2d9-4200-a15f-a834e398f64c', 'Inspection Scheduled', '#14b8a6', 3, false, false
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stages
  WHERE org_id = 'da326003-e2d9-4200-a15f-a834e398f64c' AND name = 'Inspection Scheduled'
);

-- ─── Lead-scoped, sort-order-aware auto-advance ───────────────────────────────
-- Unlike crm_auto_advance_leads (contact-wide, used for real business-document
-- events — signed contract, invoice, payment), this signal comes from the AI
-- reading ONE call's transcript, so it only ever acts on THAT call's lead row,
-- never sibling leads for the same contact. Guards: unknown lead, spam-flagged
-- lead, a stage that doesn't exist for this org, already on/past that stage, or
-- currently on a terminal (Won/Lost) stage all silently no-op.
CREATE OR REPLACE FUNCTION public.crm_advance_lead_if_forward(
  p_lead_id uuid,
  p_stage_name text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead             record;
  v_current_sort     integer;
  v_current_terminal boolean;
  v_stage_id         uuid;
  v_target_sort      integer;
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

  v_current_sort := -1;
  v_current_terminal := false;
  IF v_lead.current_stage_id IS NOT NULL THEN
    SELECT sort_order, (is_won OR is_lost)
      INTO v_current_sort, v_current_terminal
      FROM pipeline_stages
     WHERE id = v_lead.current_stage_id;
  END IF;

  IF COALESCE(v_current_terminal, false) THEN
    RETURN; -- Won/Lost is terminal — never move it again
  END IF;

  SELECT id, sort_order INTO v_stage_id, v_target_sort
    FROM pipeline_stages
   WHERE org_id = v_lead.org_id AND name = p_stage_name
   LIMIT 1;

  IF v_stage_id IS NULL OR v_stage_id = v_lead.current_stage_id THEN
    RETURN; -- no such stage for this org, or already there
  END IF;

  IF v_target_sort <= COALESCE(v_current_sort, -1) THEN
    RETURN; -- never move a lead BACKWARD in the pipeline
  END IF;

  PERFORM move_lead_to_stage(p_lead_id, v_stage_id, NULL, NULL);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_advance_lead_if_forward(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_advance_lead_if_forward(uuid, text) TO authenticated, service_role;
