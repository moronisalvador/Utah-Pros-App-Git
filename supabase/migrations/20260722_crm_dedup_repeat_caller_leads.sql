-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_dedup_repeat_caller_leads
-- Phase: n/a (standalone CRM fix — owner-directed 2026-07-22: "that Kalsey
--        Blessy should be merged, and we should prevent this from happening
--        in the future")
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops one person from appearing as two cards on the pipeline board, and
--   cleans up the seven repeat-caller duplicates that already exist.
--
--   The owner spotted the same caller twice in the Won column. Investigating
--   found 7 phone numbers with duplicate un-merged lead cards. Two causes:
--   (a) HISTORICAL — the pairs predate the 2026-07-22 ingestion-time merge
--       (repeat call → merge into the existing open lead), so nothing ever
--       collapsed them; and
--   (b) A LIVE GAP — "Missed Calls" is an is_lost stage, and the merge rule
--       only reached lost stages within 3 hours. Now that every missed call
--       AUTO-stages into Missed Calls, any redial after 3 hours created a
--       brand-new duplicate card (verified live: a number redialed today
--       duplicated instead of merging). The 3-hour window was designed for
--       "Lost proper" (a human wrote the lead off), not for the callback
--       work-queue.
--
--   1. PREVENTION — body-only replace of upsert_lead_from_callrail. The
--      repeat-call merge condition becomes four explicit tiers, and when
--      several candidates match, the most-alive one wins (open beats
--      recoverable beats won):
--        • OPEN / stage-less lead ............ merge (unchanged)
--        • RECOVERABLE terminal (Missed Calls) merge, NO time window (a
--          redial of an un-handled caller is the same pending inquiry —
--          and crm_advance_lead_if_forward can revive the canonical)
--        • WON within the last 30 days ....... merge (a post-win call is
--          logistics about the job just sold, not a new lead — this
--          REVERSES the 2026-07-21 "call after Won = new lead" rule
--          (20260721_crm_merge_repeat_call_leads.sql), owner
--          decision after the Won column double-counted repeat callers;
--          after 30 days a call IS genuinely new business → new card)
--        • LOST proper within 3 hours ........ merge (unchanged; a lost
--          lead calling back later deserves a fresh card)
--   2. BACKFILL — for every phone number with >1 un-merged, non-spam lead
--      in an org: the OLDEST lead becomes canonical; the stage that survives
--      on it is the group's latest HUMAN-moved stage (falling back to the
--      latest auto-staged one) — note this can MOVE the canonical's own
--      stage (e.g. an unstaged canonical inherits a duplicate's "Won"), a
--      canonical-side data change the ROLLBACK section covers; every other
--      member gets merged_into_lead_id = canonical and its pipeline row
--      deleted. Each merge is logged to system_events ('crm_lead_merged',
--      reason 'backfill_repeat_caller_dedup') carrying the deleted stage_id
--      + moved_by so the exact board state is reconstructable.
--
--   Telephony metrics are UNTOUCHED: merged rows keep their call data and
--   get_call_volume counts every call; only lead/board counts deduplicate.
--
-- ADDITIVE-ONLY / data backfill:
--   One function-BODY-only CREATE OR REPLACE (signature byte-for-byte
--   unchanged) + a data backfill (UPDATE inbound_leads.merged_into_lead_id,
--   DELETE duplicate lead_pipeline_stage rows — both fully logged). No
--   table/column/policy change, no DROP/RENAME.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   1. Function: re-apply the prior body verbatim from
--      **20260722_crm_auto_stage_missed_calls.sql** (the true immediate
--      predecessor — its CREATE OR REPLACE of this same function). The only
--      diff is this migration's merge-condition tiers + priority ORDER BY;
--      concretely, revert the tier block to:
--        AND (
--          (COALESCE(ps2.is_won,false) = false AND COALESCE(ps2.is_lost,false) = false)
--          OR (COALESCE(ps2.is_lost,false) = true
--              AND il2.occurred_at > p_occurred_at - interval '3 hours')
--        )
--        ORDER BY il2.created_at ASC
--      (i.e. drop the is_recoverable and won-within-30-days arms and the
--      CASE priority), then re-issue the same REVOKE/GRANT pair below.
--   2. Backfill — MEMBER side: for each system_events row with
--      event_type='crm_lead_merged' AND
--      payload->>'reason'='backfill_repeat_caller_dedup':
--        UPDATE inbound_leads SET merged_into_lead_id = NULL
--          WHERE id = (entity_id);
--      and re-create its lead_pipeline_stage row from the payload's
--      deleted_stage_id / deleted_stage_moved_by (org_id from the lead).
--   3. Backfill — CANONICAL side (do not skip): step 2's stage-survivor
--      transfer can have MOVED a canonical lead's own stage. Every such move
--      went through move_lead_to_stage, which independently logged a
--      'crm_lead_stage_changed' system_events row carrying from_stage_id.
--      For each canonical touched at this migration's apply timestamp, call
--      move_lead_to_stage(canonical_id, from_stage_id, <its moved_by>, NULL)
--      to put it back. Canonicals whose stage already equalled the survivor
--      were skipped by the IS DISTINCT FROM guard and need no undo (they
--      have no such event row).
-- ════════════════════════════════════════════════

-- 1. PREVENTION — upsert_lead_from_callrail (body-only; signature FROZEN).
CREATE OR REPLACE FUNCTION public.upsert_lead_from_callrail(p_callrail_id text, p_source_type text, p_tracking_number text DEFAULT NULL::text, p_caller_number text DEFAULT NULL::text, p_duration_sec integer DEFAULT NULL::integer, p_spam_flag boolean DEFAULT false, p_source text DEFAULT NULL::text, p_medium text DEFAULT NULL::text, p_campaign text DEFAULT NULL::text, p_recording_url text DEFAULT NULL::text, p_transcription text DEFAULT NULL::text, p_form_data jsonb DEFAULT NULL::jsonb, p_lead_status text DEFAULT 'new'::text, p_value numeric DEFAULT NULL::numeric, p_direction text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now(), p_raw_payload jsonb DEFAULT '{}'::jsonb, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS inbound_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id          uuid;
  v_contact_id      uuid;
  v_match_count     int;
  v_existed         boolean;
  v_row             inbound_leads;
  v_caller_digits   text;
  v_open_lead_id    uuid;
  v_missed_stage_id uuid;
BEGIN
  IF p_source_type NOT IN ('call', 'form') THEN
    RAISE EXCEPTION 'invalid inbound_leads source_type: %', p_source_type;
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  IF p_caller_number IS NOT NULL THEN
    v_caller_digits := regexp_replace(p_caller_number, '\D', '', 'g');
    IF length(v_caller_digits) >= 10 THEN
      SELECT count(*) INTO v_match_count
      FROM contacts
      WHERE phone IS NOT NULL
        AND length(regexp_replace(phone, '\D', '', 'g')) >= 10
        AND right(regexp_replace(phone, '\D', '', 'g'), 10) = right(v_caller_digits, 10);

      IF v_match_count = 1 THEN
        SELECT id INTO v_contact_id
        FROM contacts
        WHERE phone IS NOT NULL
          AND length(regexp_replace(phone, '\D', '', 'g')) >= 10
          AND right(regexp_replace(phone, '\D', '', 'g'), 10) = right(v_caller_digits, 10);
      END IF;
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM inbound_leads WHERE callrail_id = p_callrail_id) INTO v_existed;

  INSERT INTO inbound_leads (
    org_id, contact_id, source_type, callrail_id, tracking_number, caller_number,
    duration_sec, spam_flag, source, medium, campaign, recording_url, transcription,
    form_data, lead_status, value, direction, occurred_at, raw_payload
  ) VALUES (
    v_org_id, v_contact_id, p_source_type, p_callrail_id, p_tracking_number, p_caller_number,
    p_duration_sec, p_spam_flag, p_source, p_medium, p_campaign, p_recording_url, p_transcription,
    p_form_data, p_lead_status, p_value, p_direction, p_occurred_at, p_raw_payload
  )
  ON CONFLICT (callrail_id) DO UPDATE SET
    contact_id      = COALESCE(inbound_leads.contact_id, EXCLUDED.contact_id),
    tracking_number = COALESCE(EXCLUDED.tracking_number, inbound_leads.tracking_number),
    caller_number   = COALESCE(EXCLUDED.caller_number, inbound_leads.caller_number),
    duration_sec    = COALESCE(EXCLUDED.duration_sec, inbound_leads.duration_sec),
    spam_flag       = EXCLUDED.spam_flag,
    source          = COALESCE(EXCLUDED.source, inbound_leads.source),
    medium          = COALESCE(EXCLUDED.medium, inbound_leads.medium),
    campaign        = COALESCE(EXCLUDED.campaign, inbound_leads.campaign),
    recording_url   = COALESCE(EXCLUDED.recording_url, inbound_leads.recording_url),
    transcription   = COALESCE(EXCLUDED.transcription, inbound_leads.transcription),
    form_data       = COALESCE(EXCLUDED.form_data, inbound_leads.form_data),
    value           = COALESCE(EXCLUDED.value, inbound_leads.value),
    raw_payload     = EXCLUDED.raw_payload,
    updated_at      = now()
  RETURNING * INTO v_row;

  IF NOT v_existed AND p_caller_number IS NOT NULL AND v_caller_digits IS NOT NULL AND length(v_caller_digits) >= 10 THEN
    -- Repeat-caller merge, four explicit tiers (see header). When several
    -- candidates match, the most-alive one wins: open > recoverable-terminal
    -- (Missed Calls) > recently-won > recently-lost; oldest within a tier.
    SELECT il2.id INTO v_open_lead_id
    FROM inbound_leads il2
    LEFT JOIN lead_pipeline_stage lps2 ON lps2.lead_id = il2.id
    LEFT JOIN pipeline_stages ps2 ON ps2.id = lps2.stage_id
    WHERE il2.id <> v_row.id
      AND il2.org_id = v_org_id
      AND il2.merged_into_lead_id IS NULL
      AND COALESCE(il2.spam_flag, false) = false
      AND il2.caller_number IS NOT NULL
      AND length(regexp_replace(il2.caller_number, '\D', '', 'g')) >= 10
      AND right(regexp_replace(il2.caller_number, '\D', '', 'g'), 10) = right(v_caller_digits, 10)
      AND (
        (COALESCE(ps2.is_won, false) = false AND COALESCE(ps2.is_lost, false) = false)
        OR COALESCE(ps2.is_recoverable, false) = true
        OR (COALESCE(ps2.is_won, false) = true AND lps2.updated_at > p_occurred_at - interval '30 days')
        OR (COALESCE(ps2.is_lost, false) = true AND COALESCE(ps2.is_recoverable, false) = false
            AND il2.occurred_at > p_occurred_at - interval '3 hours')
      )
    ORDER BY CASE
               WHEN COALESCE(ps2.is_won, false) = false AND COALESCE(ps2.is_lost, false) = false THEN 0
               WHEN COALESCE(ps2.is_recoverable, false) = true THEN 1
               WHEN COALESCE(ps2.is_won, false) = true THEN 2
               ELSE 3
             END,
             il2.created_at ASC
    LIMIT 1;

    IF v_open_lead_id IS NOT NULL THEN
      UPDATE inbound_leads SET merged_into_lead_id = v_open_lead_id, updated_at = now()
      WHERE id = v_row.id;
      v_row.merged_into_lead_id := v_open_lead_id;
      v_row.updated_at := now();

      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_lead_merged', 'inbound_lead', v_row.id,
              jsonb_build_object('merged_into_lead_id', v_open_lead_id, 'caller_number', p_caller_number));
    END IF;
  END IF;

  IF v_row.source_type = 'call'
     AND v_row.merged_into_lead_id IS NULL
     AND COALESCE(v_row.spam_flag, false) = false
     AND lower(COALESCE(v_row.raw_payload->>'answered', '')) IN ('false', 'f', '0')
     AND NOT EXISTS (SELECT 1 FROM lead_pipeline_stage lps3 WHERE lps3.lead_id = v_row.id)
  THEN
    SELECT id INTO v_missed_stage_id
    FROM pipeline_stages
    WHERE org_id = v_org_id AND name = 'Missed Calls'
    LIMIT 1;
    IF v_missed_stage_id IS NOT NULL THEN
      PERFORM move_lead_to_stage(v_row.id, v_missed_stage_id, NULL, NULL);
    END IF;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES (
    CASE WHEN v_existed THEN 'crm_lead_updated' ELSE 'crm_lead_created' END,
    'inbound_lead',
    v_row.id,
    jsonb_build_object('source_type', v_row.source_type, 'callrail_id', v_row.callrail_id, 'contact_id', v_row.contact_id)
  );

  RETURN v_row;
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): re-assert explicitly.
REVOKE EXECUTE ON FUNCTION public.upsert_lead_from_callrail(text, text, text, text, integer, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamp with time zone, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_lead_from_callrail(text, text, text, text, integer, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamp with time zone, jsonb, uuid) TO authenticated, service_role;

-- 2. BACKFILL — collapse every existing repeat-caller duplicate group.
DO $$
DECLARE
  g            record;
  v_member     uuid;
  v_canonical  uuid;
  v_stage_id   uuid;
  v_moved_by   uuid;
  v_cur_stage  uuid;
BEGIN
  FOR g IN
    SELECT il.org_id,
           right(regexp_replace(il.caller_number, '\D', '', 'g'), 10) AS suffix,
           array_agg(il.id ORDER BY il.created_at) AS ids
    FROM inbound_leads il
    WHERE il.merged_into_lead_id IS NULL
      AND COALESCE(il.spam_flag, false) = false
      AND il.caller_number IS NOT NULL
      AND length(regexp_replace(il.caller_number, '\D', '', 'g')) >= 10
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    v_canonical := g.ids[1];  -- oldest lead in the group (merge-design invariant)

    -- The stage that survives on the canonical: the group's latest
    -- HUMAN-moved stage row (a person's judgment outranks the auto-stager),
    -- falling back to the latest-moved row of any kind.
    SELECT lps.stage_id, lps.moved_by INTO v_stage_id, v_moved_by
    FROM lead_pipeline_stage lps
    WHERE lps.lead_id = ANY (g.ids)
    ORDER BY (lps.moved_by IS NOT NULL) DESC, lps.updated_at DESC
    LIMIT 1;

    SELECT stage_id INTO v_cur_stage FROM lead_pipeline_stage WHERE lead_id = v_canonical;

    IF v_stage_id IS NOT NULL AND v_cur_stage IS DISTINCT FROM v_stage_id THEN
      PERFORM move_lead_to_stage(v_canonical, v_stage_id, v_moved_by, NULL);
    END IF;

    FOR v_member IN
      SELECT t.id FROM unnest(g.ids) WITH ORDINALITY AS t(id, ord) WHERE t.ord > 1
    LOOP
      -- Log first (with the deleted stage row's identity — makes the exact
      -- board state reconstructable per the ROLLBACK note), then merge.
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      SELECT 'crm_lead_merged', 'inbound_lead', v_member,
             jsonb_build_object(
               'merged_into_lead_id', v_canonical,
               'reason', 'backfill_repeat_caller_dedup',
               'deleted_stage_id', lps.stage_id,
               'deleted_stage_moved_by', lps.moved_by)
      FROM (SELECT 1) AS one
      LEFT JOIN lead_pipeline_stage lps ON lps.lead_id = v_member;

      DELETE FROM lead_pipeline_stage WHERE lead_id = v_member;
      UPDATE inbound_leads SET merged_into_lead_id = v_canonical, updated_at = now()
      WHERE id = v_member;
    END LOOP;
  END LOOP;
END $$;
