-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_merge_repeat_call_leads
-- Phase: n/a — standalone production fix, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Fixes a duplicate-card bug on the Leads Kanban board. When the same phone
--   number calls a second time while their FIRST call's lead is still open in
--   the pipeline (not yet Won or Lost), the second call was creating a brand
--   new Kanban card instead of being recognized as a follow-up on the same
--   conversation — confirmed live 2026-07-21: phone +16267717702 ("Jake
--   Nelson" / "Jake") produced two separate cards sitting side-by-side in the
--   same "Estimate Sent" column. Owner-approved fix: a repeat call still gets
--   its own `inbound_leads` row (the call/transcript record itself is needed
--   for history/compliance), but it no longer gets its own Kanban presence —
--   it's marked as merged into the original open lead, and shows up on that
--   original lead's activity timeline as a "Follow-up call" entry instead.
--   Merge is based on pipeline stage (open vs. Won/Lost), never a time
--   window — a past customer calling back about a NEW problem after their
--   old job closed (Won or Lost) correctly gets a fresh, independent lead.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. One nullable column added to `inbound_leads` (+ a partial
--   index). Three functions get their BODY replaced only (signatures and
--   return shapes unchanged, every existing caller keeps working):
--   `upsert_lead_from_callrail`, `crm_auto_advance_leads`,
--   `crm_disqualify_lead_if_open`. One new function, `get_lead_activity`, and
--   the shared `get_contact_activity` get body-only replaces adding one new
--   UNION ALL arm each. One plain UPDATE (+ one DELETE on the sibling
--   `lead_pipeline_stage` table) does the one-time backfill for the single
--   known duplicate pair. No table is created, dropped, or altered beyond
--   the one additive column; no column is renamed or removed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Column — drop it (also drops the index):
--     ALTER TABLE public.inbound_leads DROP COLUMN merged_into_lead_id;
--
--   Function bodies — CREATE OR REPLACE back to the prior body (each prior
--   body is preserved in git history at the commit before this migration):
--     - upsert_lead_from_callrail: drop the merge-check block added after the
--       `RETURNING * INTO v_row` insert (the block guarded by `IF NOT
--       v_existed AND p_caller_number IS NOT NULL THEN ...`).
--     - crm_auto_advance_leads: drop the `AND il.merged_into_lead_id IS NULL`
--       clause from the loop's WHERE.
--     - crm_disqualify_lead_if_open: drop the `v_lead.merged_into_lead_id IS
--       NOT NULL` arm of the early-return guard.
--     - get_lead_activity / get_contact_activity: drop the new
--       'follow_up_call' UNION ALL arm from each (and restore
--       get_contact_activity's 'lead' arm to unconditional
--       `WHERE il.contact_id = p_contact_id`, dropping the
--       `AND il.merged_into_lead_id IS NULL` guard).
--
--   Backfill — not bulk-reversible by design (a correctness fix, same
--   posture as the 2026-07-21 contact-link backfill): to undo the ONE known
--   merge, run
--     `UPDATE inbound_leads SET merged_into_lead_id = NULL
--      WHERE id = '3ddd94aa-0212-46b2-9391-c10da87ce66a';`
--   Its `lead_pipeline_stage` row was deleted, not preserved — re-move that
--   lead to a stage by hand if this is ever rolled back.
-- ════════════════════════════════════════════════

-- ─── 1. inbound_leads.merged_into_lead_id — points a duplicate at its original ─
ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS merged_into_lead_id uuid REFERENCES public.inbound_leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_leads_merged_into
  ON public.inbound_leads (merged_into_lead_id)
  WHERE merged_into_lead_id IS NOT NULL;

-- ─── 2. upsert_lead_from_callrail — merge a repeat call into the open original ─
-- Runs ONLY on a genuinely new call (v_existed = false — a redelivered webhook
-- for the SAME callrail_id, e.g. "recording ready" after "call completed",
-- must never re-run the merge check). Matches the SAME normalized
-- (digits-only, last-10) phone comparison this function already uses for
-- contact linking. "Open" = no lead_pipeline_stage row yet (the board's own
-- fallback treats that as sitting in the first/"New" stage — see
-- src/lib/crmPipeline.js groupLeadsByStage) OR a row whose stage is neither
-- is_won nor is_lost. A spam-flagged or already-merged candidate is never a
-- merge target (spam has its stage cleared by set_lead_spam_flag and drops
-- off the board on its own; chaining merges through an already-merged lead
-- would build a linked list instead of always pointing at the true root).
-- Picks the OLDEST matching open lead so every later repeat call always
-- converges on the same original, never a mid-chain duplicate.
CREATE OR REPLACE FUNCTION public.upsert_lead_from_callrail(
  p_callrail_id text,
  p_source_type text,
  p_tracking_number text DEFAULT NULL::text,
  p_caller_number text DEFAULT NULL::text,
  p_duration_sec integer DEFAULT NULL::integer,
  p_spam_flag boolean DEFAULT false,
  p_source text DEFAULT NULL::text,
  p_medium text DEFAULT NULL::text,
  p_campaign text DEFAULT NULL::text,
  p_recording_url text DEFAULT NULL::text,
  p_transcription text DEFAULT NULL::text,
  p_form_data jsonb DEFAULT NULL::jsonb,
  p_lead_status text DEFAULT 'new'::text,
  p_value numeric DEFAULT NULL::numeric,
  p_direction text DEFAULT NULL::text,
  p_occurred_at timestamp with time zone DEFAULT now(),
  p_raw_payload jsonb DEFAULT '{}'::jsonb,
  p_org_id uuid DEFAULT NULL::uuid
)
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

  -- Normalized (digits-only, last-10) phone match against contacts.
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

  -- Merge check — a genuinely NEW lead only, never a redelivered webhook.
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
      AND COALESCE(ps2.is_won, false) = false
      AND COALESCE(ps2.is_lost, false) = false
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

REVOKE EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamp with time zone, jsonb, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text, jsonb, text, numeric, text, timestamp with time zone, jsonb, uuid
) TO authenticated, service_role;

-- ─── 3. crm_auto_advance_leads — never independently advance a merged lead ───
-- A merged duplicate has no Kanban presence of its own (CrmLeads.jsx excludes
-- it from the board query); it must also never be pulled through Won/Estimate
-- Sent by this contact-wide auto-advance loop — that would resurrect a stage
-- assignment for a lead the board is deliberately hiding.
CREATE OR REPLACE FUNCTION public.crm_auto_advance_leads(
  p_contact_id uuid,
  p_stage_name text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead   record;
  v_is_won boolean;
  v_stage_id uuid;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_lead IN
    SELECT il.id, il.org_id, lps.stage_id AS current_stage_id
    FROM inbound_leads il
    LEFT JOIN lead_pipeline_stage lps ON lps.lead_id = il.id
    WHERE il.contact_id = p_contact_id
      AND il.spam_flag = false
      AND il.merged_into_lead_id IS NULL
  LOOP
    v_is_won := false;
    IF v_lead.current_stage_id IS NOT NULL THEN
      SELECT is_won INTO v_is_won FROM pipeline_stages WHERE id = v_lead.current_stage_id;
    END IF;
    IF COALESCE(v_is_won, false) THEN
      CONTINUE; -- already Won — never move it again
    END IF;

    SELECT id INTO v_stage_id
    FROM pipeline_stages
    WHERE org_id = v_lead.org_id AND name = p_stage_name
    LIMIT 1;
    IF v_stage_id IS NULL OR v_stage_id = v_lead.current_stage_id THEN
      CONTINUE; -- no such stage for this org, or already there
    END IF;

    PERFORM move_lead_to_stage(v_lead.id, v_stage_id, NULL, NULL);
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_auto_advance_leads(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_auto_advance_leads(uuid, text) TO authenticated, service_role;

-- ─── 4. crm_disqualify_lead_if_open — defense-in-depth: never touch a merged lead ─
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

  SELECT il.id, il.org_id, il.spam_flag, il.merged_into_lead_id, lps.stage_id AS current_stage_id
    INTO v_lead
    FROM inbound_leads il
    LEFT JOIN lead_pipeline_stage lps ON lps.lead_id = il.id
   WHERE il.id = p_lead_id;

  IF NOT FOUND OR COALESCE(v_lead.spam_flag, false) OR v_lead.merged_into_lead_id IS NOT NULL THEN
    RETURN; -- unknown lead, spam, or a merged duplicate — never touch
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

-- ─── 5. get_lead_activity — surface merged-in follow-up calls on the original ─
CREATE OR REPLACE FUNCTION public.get_lead_activity(p_lead_id uuid)
 RETURNS TABLE(activity_type text, occurred_at timestamp with time zone, title text, body text, meta jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    'lead'::text,
    COALESCE(il.occurred_at, il.created_at),
    CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END,
    COALESCE(il.transcription, il.notes),
    jsonb_build_object(
      'source_type', il.source_type, 'duration_sec', il.duration_sec,
      'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
      'recording_url', il.recording_url, 'transcript_analysis', il.transcript_analysis
    )
  FROM inbound_leads il
  WHERE il.id = p_lead_id

  UNION ALL

  SELECT
    'task'::text,
    COALESCE(t.due_at, t.created_at),
    t.title,
    t.notes,
    jsonb_build_object('status', t.status, 'due_at', t.due_at, 'task_id', t.id)
  FROM crm_tasks t
  WHERE t.lead_id = p_lead_id

  UNION ALL

  SELECT
    'stage_change'::text,
    lsh.moved_at,
    'Moved to ' || ps.name,
    NULL::text,
    jsonb_build_object(
      'from_stage_id', lsh.from_stage_id, 'stage_id', lsh.stage_id, 'lost_reason', lsh.lost_reason
    )
  FROM lead_stage_history lsh
  JOIN pipeline_stages ps ON ps.id = lsh.stage_id
  WHERE lsh.lead_id = p_lead_id

  UNION ALL

  -- NEW (2026-07-21) — a repeat call that came in while THIS lead was still
  -- open got merged into it (see upsert_lead_from_callrail) rather than
  -- becoming its own Kanban card. Surface it here so the follow-up call is
  -- never invisible — same shape as the 'lead' arm above, with a link back
  -- to the merged call's own transcript/recording via meta.merged_lead_id.
  SELECT
    'follow_up_call'::text,
    COALESCE(fu.occurred_at, fu.created_at),
    CASE WHEN fu.source_type = 'call' THEN 'Follow-up call' ELSE 'Follow-up web form' END,
    COALESCE(fu.transcription, fu.notes),
    jsonb_build_object(
      'source_type', fu.source_type, 'duration_sec', fu.duration_sec,
      'caller_number', fu.caller_number, 'recording_url', fu.recording_url,
      'transcript_analysis', fu.transcript_analysis, 'merged_lead_id', fu.id
    )
  FROM inbound_leads fu
  WHERE fu.merged_into_lead_id = p_lead_id

  ORDER BY 2 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_lead_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_activity(uuid) TO authenticated, service_role;

-- ─── 6. get_contact_activity — same follow-up-call arm; hide merged dupes from 'lead' ─
CREATE OR REPLACE FUNCTION public.get_contact_activity(p_contact_id uuid)
 RETURNS TABLE(activity_type text, occurred_at timestamp with time zone, title text, body text, meta jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Widened (2026-07-21): a merged duplicate lead must not also render as its
  -- own plain 'lead' entry — it surfaces below as a 'follow_up_call' on
  -- whichever of the contact's leads it was merged into instead.
  SELECT
    'lead'::text,
    COALESCE(il.occurred_at, il.created_at),
    CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END,
    COALESCE(il.transcription, il.notes),
    jsonb_build_object(
      'source_type', il.source_type, 'duration_sec', il.duration_sec,
      'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
      'recording_url', il.recording_url, 'transcript_analysis', il.transcript_analysis
    )
  FROM inbound_leads il
  WHERE il.contact_id = p_contact_id
    AND il.merged_into_lead_id IS NULL

  UNION ALL

  SELECT
    'sms'::text,
    m.created_at,
    CASE WHEN m.sender_contact_id = p_contact_id THEN 'Received SMS' ELSE 'Sent SMS' END,
    m.body,
    jsonb_build_object('type', m.type, 'status', m.status)
  FROM messages m
  WHERE m.conversation_id IN (
    SELECT cp.conversation_id FROM conversation_participants cp WHERE cp.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'note'::text,
    jn.created_at,
    'Note'::text,
    jn.body,
    jsonb_build_object('job_id', jn.job_id, 'author_name', jn.author_name)
  FROM job_notes jn
  WHERE jn.job_id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'estimate'::text,
    e.created_at,
    'Estimate ' || COALESCE(e.estimate_number, e.id::text),
    NULL::text,
    jsonb_build_object('status', e.status, 'amount', e.amount, 'estimate_id', e.id)
  FROM estimates e
  WHERE e.contact_id = p_contact_id

  UNION ALL

  SELECT
    'email'::text,
    COALESCE(r.sent_at, r.created_at),
    'Campaign email'::text,
    ec.subject,
    jsonb_build_object('status', r.status, 'campaign', ec.name, 'campaign_id', ec.id)
  FROM email_campaign_recipients r
  JOIN email_campaigns ec ON ec.id = r.campaign_id
  WHERE r.contact_id = p_contact_id

  UNION ALL

  SELECT
    'job'::text,
    j.created_at,
    'Job ' || COALESCE(j.job_number, j.id::text),
    j.address,
    jsonb_build_object('status', j.status, 'job_id', j.id)
  FROM jobs j
  WHERE j.id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'task'::text,
    COALESCE(t.due_at, t.created_at),
    t.title,
    t.notes,
    jsonb_build_object('status', t.status, 'due_at', t.due_at, 'task_id', t.id)
  FROM crm_tasks t
  WHERE t.contact_id = p_contact_id
     OR t.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)

  UNION ALL

  SELECT
    'appointment'::text,
    (a.date + COALESCE(a.time_start, '00:00'::time))::timestamptz,
    COALESCE(a.title, 'Appointment'),
    a.notes,
    jsonb_build_object(
      'status', a.status, 'type', a.type, 'time_start', a.time_start,
      'time_end', a.time_end, 'job_id', a.job_id
    )
  FROM appointments a
  WHERE a.job_id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'invoice'::text,
    COALESCE(i.invoice_date::timestamptz, i.created_at),
    'Invoice ' || COALESCE(i.invoice_number, i.id::text),
    NULL::text,
    jsonb_build_object(
      'status', i.status, 'total', i.total, 'amount_paid', i.amount_paid,
      'balance_due', i.balance_due, 'invoice_id', i.id, 'due_date', i.due_date
    )
  FROM invoices i
  WHERE i.contact_id = p_contact_id

  UNION ALL

  SELECT
    'work_authorization'::text,
    COALESCE(sr.signed_at, sr.sent_at, sr.created_at),
    COALESCE(initcap(replace(sr.doc_type, '_', ' ')), 'Work Authorization'),
    NULL::text,
    jsonb_build_object(
      'status', sr.status, 'doc_type', sr.doc_type, 'signed_at', sr.signed_at,
      'signed_file_path', sr.signed_file_path, 'job_id', sr.job_id
    )
  FROM sign_requests sr
  WHERE sr.contact_id = p_contact_id

  UNION ALL

  SELECT
    'stage_change'::text,
    lsh.moved_at,
    'Moved to ' || ps.name,
    NULL::text,
    jsonb_build_object(
      'from_stage_id', lsh.from_stage_id, 'stage_id', lsh.stage_id, 'lost_reason', lsh.lost_reason
    )
  FROM lead_stage_history lsh
  JOIN pipeline_stages ps ON ps.id = lsh.stage_id
  WHERE lsh.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)

  UNION ALL

  -- NEW (2026-07-21) — follow-up calls merged into any of this contact's leads.
  SELECT
    'follow_up_call'::text,
    COALESCE(fu.occurred_at, fu.created_at),
    CASE WHEN fu.source_type = 'call' THEN 'Follow-up call' ELSE 'Follow-up web form' END,
    COALESCE(fu.transcription, fu.notes),
    jsonb_build_object(
      'source_type', fu.source_type, 'duration_sec', fu.duration_sec,
      'caller_number', fu.caller_number, 'recording_url', fu.recording_url,
      'transcript_analysis', fu.transcript_analysis, 'merged_lead_id', fu.id
    )
  FROM inbound_leads fu
  WHERE fu.merged_into_lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)

  ORDER BY 2 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;

-- ─── 7. One-time backfill — the single known live duplicate pair ────────────
-- "Jake" (3ddd94aa-0212-46b2-9391-c10da87ce66a, created 62ms after the
-- original) merges into "Jake Nelson" (6587d3de-b581-4d0b-b5bc-df100cac35f6,
-- the first-created of the two), phone +16267717702. Only ever touches these
-- two specific rows — not a bulk sweep (verified live 2026-07-21: this is the
-- only phone number in the dataset with two simultaneously-open leads).
UPDATE inbound_leads
SET merged_into_lead_id = '6587d3de-b581-4d0b-b5bc-df100cac35f6', updated_at = now()
WHERE id = '3ddd94aa-0212-46b2-9391-c10da87ce66a'
  AND merged_into_lead_id IS NULL;

DELETE FROM lead_pipeline_stage
WHERE lead_id = '3ddd94aa-0212-46b2-9391-c10da87ce66a';

-- ─── 8. Bust PostgREST schema cache ───────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
