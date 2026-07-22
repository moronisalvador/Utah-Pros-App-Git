-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_merge_repeat_call_leads_time_window
-- Phase: n/a (standalone CRM reliability fix — adversarial-challenge follow-up)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Fixes a real duplicate-lead bug found via live data review: when a
--   caller's first call lands in a terminal LOST pipeline stage (most
--   commonly "Missed Calls" — nobody picked up), a quick redial minutes later
--   never merges into that original lead, because the existing merge check
--   only considers leads that are still OPEN. Every rapid callback after a
--   missed call became its own brand-new lead, inflating lead counts and
--   splitting one caller's story across multiple Kanban cards. This widens
--   the merge check: a lead that reached a LOST stage now still merges a
--   same-caller redial, but ONLY when that redial happens within 3 hours of
--   the original call — a same-day callback almost certainly is the same
--   inquiry, while a call from the same number weeks later is very likely a
--   genuinely new, unrelated job and should stay its own lead. A WON lead is
--   NEVER merged into, at any recency — a customer calling back after a
--   completed job is a new inquiry, not a duplicate of the old one.
--
-- ADDITIVE-ONLY:
--   Function-body-only CREATE OR REPLACE of upsert_lead_from_callrail — the
--   signature (parameter list, defaults, return type) is byte-for-byte
--   unchanged, so every existing caller (the CallRail webhook, the test
--   suite) keeps working without modification. No table/column/policy
--   change. A committed, extended regression test
--   (supabase/tests/crm_merge_repeat_call_leads.test.js) proves the existing
--   open-lead-merge and Won-never-merges behavior is UNCHANGED, and adds
--   coverage for the new Lost-within-3h (merges) / Lost-beyond-3h (does not
--   merge) split.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body via a follow-up CREATE OR REPLACE, reverting the
--   merge WHERE clause's is_won/is_lost condition to:
--     AND COALESCE(ps2.is_won, false) = false
--     AND COALESCE(ps2.is_lost, false) = false
--   (i.e. drop the time-window OR branch below). The full prior definition
--   is preserved in git history / this repo's migration log.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_lead_from_callrail(p_callrail_id text, p_source_type text, p_tracking_number text DEFAULT NULL::text, p_caller_number text DEFAULT NULL::text, p_duration_sec integer DEFAULT NULL::integer, p_spam_flag boolean DEFAULT false, p_source text DEFAULT NULL::text, p_medium text DEFAULT NULL::text, p_campaign text DEFAULT NULL::text, p_recording_url text DEFAULT NULL::text, p_transcription text DEFAULT NULL::text, p_form_data jsonb DEFAULT NULL::jsonb, p_lead_status text DEFAULT 'new'::text, p_value numeric DEFAULT NULL::numeric, p_direction text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now(), p_raw_payload jsonb DEFAULT '{}'::jsonb, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS inbound_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id        uuid;
  v_contact_id    uuid;
  v_match_count   int;
  v_existed       boolean;
  v_row           inbound_leads;
  v_caller_digits text;
  v_open_lead_id  uuid;
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
        -- Still-open lead: merge regardless of how long ago it was (unchanged
        -- from the prior behavior).
        (COALESCE(ps2.is_won, false) = false AND COALESCE(ps2.is_lost, false) = false)
        -- NEW: a lead that reached a LOST stage (e.g. "Missed Calls") still
        -- merges a redial, but only within a 3-hour window — a same-session
        -- callback, not a genuinely new inquiry weeks/months later. A WON
        -- lead is deliberately excluded from this branch at any recency.
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

-- Belt-and-suspenders (database-standard.md §1 "managed-Supabase function
-- trap"): this platform re-applies EXECUTE TO PUBLIC to a function at
-- ddl_command_end, even on a same-signature CREATE OR REPLACE. Re-assert the
-- lockdown every prior replace of this function has carried
-- (20260721_crm_merge_repeat_call_leads.sql, 20260721_crm_contact_link_and_
-- activity.sql) so a future replace can't silently reopen this to anon.
REVOKE EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamp with time zone, jsonb, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamp with time zone, jsonb, uuid
) TO authenticated, service_role;
