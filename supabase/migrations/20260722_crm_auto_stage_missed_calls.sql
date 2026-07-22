-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_auto_stage_missed_calls
-- Phase: n/a (standalone CRM fix — owner-reported live: "missed calls not
--        updating on the pipeline")
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes the pipeline's "Missed Calls" column update itself. Verified live
--   2026-07-22: NOTHING has ever moved a lead into "Missed Calls"
--   automatically — every one of the 19 placements in lead_stage_history
--   happened in a single manual session (2026-07-21 15:49:26–15:49:55, human
--   moved_by). The column looked alive for one day because the owner
--   hand-sorted it once; every unanswered call since (4 by the time of this
--   fix) sat stage-less, rendering in the "New" column, and the Missed Calls
--   count froze at yesterday's number.
--
--   Fix: at the ingestion chokepoint (upsert_lead_from_callrail — the same
--   function that owns contact-matching and redial-merge), when a delivery
--   carries CallRail's EXPLICIT answered='false' verdict for a call lead that
--   is not spam, not merged into another lead, and has no pipeline stage yet,
--   the lead is moved into the org's "Missed Calls" stage via
--   move_lead_to_stage (so lead_stage_history + system_events bookkeeping is
--   identical to a human move, with moved_by NULL = system). A one-time
--   backfill applies the same rule to the currently stage-less unanswered
--   calls.
--
--   Guards, deliberately:
--   - Fires only when raw_payload EXPLICITLY says answered is false-ish
--     ('false'/'f'/'0', string-compared — never a ::boolean cast that could
--     throw inside the webhook write path). The call-STARTED delivery has no
--     'answered' key yet, so a ringing call is never prematurely staged; the
--     call-COMPLETED delivery is what stages it. This intentionally does NOT
--     reuse crm_call_is_answered's duration_sec>0 legacy fallback: that
--     predicate is read-time classification (must handle pre-'answered'
--     history); staging is a write-time ACTION and only acts on an explicit
--     verdict.
--   - Never overrides an existing stage row (a human/AI placement wins), and
--     never stages a merged redial (merged leads own no stage rows, by the
--     2026-07-21 merge design).
--   - Missing "Missed Calls" stage for the org → silent no-op (same graceful
--     convention as crm_advance_lead_if_forward; the stage list is
--     admin-editable).
--   Known accepted behavior (documented, not built): if the caller redials
--   within 3h and IS answered, the redial merges into this now-Lost lead and
--   the card stays in Missed Calls until a human moves it — auto-advance
--   correctly refuses to move a lead off a terminal stage. Un-losting on a
--   successful callback is a separate, deliberate semantic change if ever
--   wanted.
--
-- ADDITIVE-ONLY:
--   Function-body-only CREATE OR REPLACE of upsert_lead_from_callrail
--   (signature byte-for-byte unchanged — third precedented body replace, see
--   20260722_crm_merge_repeat_call_leads_time_window.sql) + a one-time
--   backfill that only INSERTs stage rows via move_lead_to_stage for leads
--   that have none. No table/column/policy change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body from
--   20260722_crm_merge_repeat_call_leads_time_window.sql (this migration only
--   ADDS the v_missed_stage_id declaration and the auto-stage block after the
--   merge check — deleting that block restores it exactly). Backfilled stage
--   rows are enumerable via lead_stage_history (moved_by IS NULL, stage =
--   Missed Calls, moved_at = this migration's apply time) and can be deleted
--   from lead_pipeline_stage if ever needed.
-- ════════════════════════════════════════════════

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
        OR (COALESCE(ps2.is_lost, false) = true AND il2.occurred_at > p_occurred_at - interval '3 hours')
      )
    ORDER BY il2.created_at ASC
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

  -- ── Auto-stage a missed call into "Missed Calls" (2026-07-22) ──
  -- Fires on the delivery that carries CallRail's explicit answered=false
  -- (call-completed); the call-started delivery has no 'answered' key and is
  -- never staged. String comparison, never a ::boolean cast — a malformed
  -- value must not throw inside the webhook write path. A human/AI placement
  -- (existing stage row) always wins; merged redials and spam never stage.
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

-- Belt-and-suspenders (database-standard.md §1 managed-Supabase function trap):
REVOKE EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamp with time zone, jsonb, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamp with time zone, jsonb, uuid
) TO authenticated, service_role;

-- ── One-time backfill: stage the currently stage-less unanswered calls ──
-- Same rule as the trigger path; goes through move_lead_to_stage so history/
-- events bookkeeping is identical (moved_by NULL = system).
DO $$
DECLARE
  r RECORD;
  v_stage uuid;
BEGIN
  FOR r IN
    SELECT il.id, il.org_id
    FROM inbound_leads il
    WHERE il.source_type = 'call'
      AND il.merged_into_lead_id IS NULL
      AND COALESCE(il.spam_flag, false) = false
      AND lower(COALESCE(il.raw_payload->>'answered', '')) IN ('false', 'f', '0')
      AND NOT EXISTS (SELECT 1 FROM lead_pipeline_stage lps WHERE lps.lead_id = il.id)
  LOOP
    SELECT id INTO v_stage FROM pipeline_stages
     WHERE org_id = r.org_id AND name = 'Missed Calls' LIMIT 1;
    IF v_stage IS NOT NULL THEN
      PERFORM move_lead_to_stage(r.id, v_stage, NULL, NULL);
    END IF;
  END LOOP;
END $$;
