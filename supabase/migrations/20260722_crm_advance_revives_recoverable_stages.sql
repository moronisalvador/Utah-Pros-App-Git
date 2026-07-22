-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_advance_revives_recoverable_stages
-- Phase: n/a (standalone CRM fix — owner-directed: "if the second call comes
--        in or we answer, and the AI detects an appointment was scheduled or
--        the call was qualified, it should automatically move in the pipeline")
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Lets a lead climb OUT of "Missed Calls" on its own when real positive
--   evidence arrives — and fixes a live invariant violation on the way.
--
--   Two defects, found by reading crm_advance_lead_if_forward against the
--   owner's scenario (missed call → customer redials → answered → AI detects
--   an appointment):
--   1. The function never resolves merged_into_lead_id. The AI transcript
--      pass runs on the REDIAL row (where the transcript lives), so the
--      advance targeted the merged duplicate — giving it its own pipeline
--      stage row (violating the merge design's "a merged lead never owns a
--      stage row" invariant, asserted by crm_merge_repeat_call_leads.test.js)
--      while the canonical card stayed frozen in Missed Calls.
--   2. "Missed Calls" is is_lost=true, and the function treats every
--      won/lost stage as terminal — so even aimed at the right lead, the
--      AI could never revive it.
--
--   The correct model (no name-matching hacks): terminality is a STAGE
--   property, so recoverability is too. New additive column
--   pipeline_stages.is_recoverable (default false) marks a terminal stage a
--   lead may automatically LEAVE when new forward evidence arrives —
--   seeded true for "Missed Calls" (it is a callback work-queue, not a
--   graveyard; it stays is_lost so funnel/win-rate math is unchanged).
--   "Lost" and "Won" stay strictly terminal: those are human judgments.
--
--   crm_advance_lead_if_forward (body-only replace, signature frozen) now:
--   (a) resolves a merged lead to its canonical root before doing anything
--       (bounded walk; by merge design pointers always aim at an unmerged
--       root, so one hop suffices — the loop is belt-and-suspenders), and
--   (b) blocks leaving a terminal stage ONLY when it is not recoverable.
--   Everything else — spam guard, org-scoped stage lookup by name,
--   never-move-backward sort check, move_lead_to_stage bookkeeping — is
--   byte-identical.
--
--   The companion code change (functions/api/transcribe-call.js) adds the
--   "call was qualified" advance the owner asked for: an in-scope real
--   inquiry (is_customer_inquiry=true AND service_match='in_scope') now
--   best-effort advances to 'Qualified', before the existing
--   inspection_scheduled advance — sort-order-aware, so a call that both
--   qualifies and books an inspection lands on the higher stage.
--
-- ADDITIVE-ONLY:
--   One new nullable-with-default boolean column on pipeline_stages + a
--   two-row seed (is_recoverable=true where name='Missed Calls') + a
--   function-BODY-only CREATE OR REPLACE of crm_advance_lead_if_forward
--   (signature byte-for-byte unchanged). No DROP/RENAME/type change, no
--   other data change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior crm_advance_lead_if_forward body (identical to the
--   body below minus the canonical-root resolution block, with the terminal
--   check reverted to `IF COALESCE(v_current_terminal, false) THEN RETURN;`
--   and (is_won OR is_lost) selected without is_recoverable);
--   UPDATE pipeline_stages SET is_recoverable = false WHERE name = 'Missed Calls';
--   ALTER TABLE pipeline_stages DROP COLUMN is_recoverable;  -- optional; the
--   -- column is inert once the function body is reverted.
-- ════════════════════════════════════════════════

-- 1. Recoverability is a stage property, alongside is_won/is_lost.
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS is_recoverable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pipeline_stages.is_recoverable IS
  'A terminal (is_won/is_lost) stage a lead may automatically LEAVE when new forward evidence arrives (AI-detected qualification/appointment, auto-advance triggers). Missed Calls = true; Won/Lost = false (human judgments stay sticky).';

UPDATE public.pipeline_stages SET is_recoverable = true WHERE name = 'Missed Calls';

-- 2. crm_advance_lead_if_forward — body-only replace (signature FROZEN).
CREATE OR REPLACE FUNCTION public.crm_advance_lead_if_forward(p_lead_id uuid, p_stage_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical_id      uuid;
  v_merged_into       uuid;
  v_hops              integer := 0;
  v_lead              record;
  v_current_sort      integer;
  v_current_terminal  boolean;
  v_current_recover   boolean;
  v_stage_id          uuid;
  v_target_sort       integer;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN;
  END IF;

  -- Resolve a merged duplicate to its canonical root FIRST: the AI pass
  -- runs on the redial row (where the transcript lives), but the pipeline
  -- card is the canonical lead's. By merge design every pointer targets an
  -- unmerged root (merges always converge on the oldest open lead), so one
  -- hop suffices — the bounded loop is belt-and-suspenders.
  v_canonical_id := p_lead_id;
  LOOP
    SELECT merged_into_lead_id INTO v_merged_into
      FROM inbound_leads WHERE id = v_canonical_id;
    EXIT WHEN v_merged_into IS NULL OR NOT FOUND OR v_hops >= 5;
    v_canonical_id := v_merged_into;
    v_hops := v_hops + 1;
  END LOOP;

  SELECT il.id, il.org_id, il.spam_flag, lps.stage_id AS current_stage_id
    INTO v_lead
    FROM inbound_leads il
    LEFT JOIN lead_pipeline_stage lps ON lps.lead_id = il.id
   WHERE il.id = v_canonical_id;

  IF NOT FOUND OR COALESCE(v_lead.spam_flag, false) THEN
    RETURN; -- unknown lead, or spam — never touch
  END IF;

  v_current_sort := -1;
  v_current_terminal := false;
  v_current_recover := false;
  IF v_lead.current_stage_id IS NOT NULL THEN
    SELECT sort_order, (is_won OR is_lost), COALESCE(is_recoverable, false)
      INTO v_current_sort, v_current_terminal, v_current_recover
      FROM pipeline_stages
     WHERE id = v_lead.current_stage_id;
  END IF;

  IF COALESCE(v_current_terminal, false) AND NOT COALESCE(v_current_recover, false) THEN
    RETURN; -- Won/Lost proper is terminal — never move it again.
            -- A RECOVERABLE terminal stage (Missed Calls) may be left when
            -- forward evidence arrives — that is this migration's point.
  END IF;

  SELECT id, sort_order INTO v_stage_id, v_target_sort
    FROM pipeline_stages
   WHERE org_id = v_lead.org_id AND name = p_stage_name
   LIMIT 1;

  IF v_stage_id IS NULL OR v_stage_id = v_lead.current_stage_id THEN
    RETURN; -- no such stage for this org, or already there
  END IF;

  -- Never move BACKWARD — except when climbing out of a recoverable
  -- terminal stage: "Missed Calls" sits early in the sort order, so a
  -- revival to Qualified/Inspection Scheduled is forward anyway; the guard
  -- below still protects ordinary open-stage leads.
  IF v_target_sort <= COALESCE(v_current_sort, -1) THEN
    RETURN;
  END IF;

  PERFORM move_lead_to_stage(v_canonical_id, v_stage_id, NULL, NULL);
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): re-assert explicitly.
REVOKE EXECUTE ON FUNCTION public.crm_advance_lead_if_forward(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_advance_lead_if_forward(uuid, text) TO authenticated, service_role;
