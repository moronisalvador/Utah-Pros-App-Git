-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_contact_link_and_activity
-- Phase: n/a — standalone production fix
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Fixes two related problems found while reclassifying the CRM leads pipeline.
--   First: when a call or form comes in, the system tries to match the caller's
--   phone number to an existing customer record — but it was comparing the two
--   phone numbers as exact text, so a number stored with different punctuation
--   or without the leading "1" never matched, even when it was obviously the
--   same person. That left many leads permanently unlinked from their customer
--   record, so the CRM only showed a bare phone number instead of a name. This
--   fixes the comparison to ignore formatting, and re-links every lead that was
--   already stuck this way. Second: the "contact activity" timeline (the one
--   shown when you click a lead) already pulls in CRM history like calls, texts,
--   and notes, but it was missing appointments, invoices, and signed work
--   authorizations — the actual job-management/invoicing side of the business.
--   This adds those three so the full picture shows up automatically.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. Two functions get their BODY replaced (signatures and return
--   shapes are unchanged — every existing caller keeps working); one plain
--   UPDATE fills previously-NULL inbound_leads.contact_id values (never
--   overwrites an existing link, never touches any other column). No table
--   is created, dropped, or altered; no column is renamed or removed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Function bodies — CREATE OR REPLACE back to the prior body:
--
--   upsert_lead_from_callrail: restore the single line
--     `SELECT id INTO v_contact_id FROM contacts WHERE phone = p_caller_number LIMIT 1;`
--   in place of the normalized-match block below (full prior body preserved in
--   git history at the commit before this migration).
--
--   get_contact_activity: drop the three new UNION ALL branches (appointment,
--   invoice, work_authorization) and restore the plain `ORDER BY 2 DESC` right
--   after the 'task' branch (full prior body preserved in git history at the
--   commit before this migration).
--
--   Backfill UPDATE — not a bulk-reversible operation by design: it only fills
--   previously-NULL contact_id values with the single unambiguous matching
--   contact (never overwrites an existing link, so no data is destroyed or
--   replaced). If one specific link later proves wrong, correct that one row
--   directly (`UPDATE inbound_leads SET contact_id = NULL WHERE id = '<id>'`);
--   there is no reason to want a bulk undo of a correctness fix.
-- ════════════════════════════════════════════════

-- ─── Fix 1: normalize the phone match in upsert_lead_from_callrail ──────────
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
BEGIN
  IF p_source_type NOT IN ('call', 'form') THEN
    RAISE EXCEPTION 'invalid inbound_leads source_type: %', p_source_type;
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  -- Normalized (digits-only, last-10) phone match. The prior bare
  -- `phone = p_caller_number` string comparison silently missed any contact
  -- whose phone wasn't stored in the exact same format as CallRail's E.164
  -- caller_number — verified live 2026-07-21: several real customers' repeat
  -- calls never linked despite a matching contact existing the whole time.
  -- An AMBIGUOUS match (two+ contacts share the same last-10 digits) is
  -- skipped rather than guessed — same conservative rule the backfill below
  -- uses, so the live-ingest path and the one-time backfill agree.
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

-- ─── Fix 2: extend get_contact_activity with appointments/invoices/work-auth ─
CREATE OR REPLACE FUNCTION public.get_contact_activity(p_contact_id uuid)
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
  WHERE il.contact_id = p_contact_id

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

  UNION ALL

  -- NEW (2026-07-21) — appointments. No direct contact_id column; joined
  -- through contact_jobs, the same pattern the 'job'/'note' branches above use.
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

  -- NEW (2026-07-21) — invoices (direct contact_id).
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

  -- NEW (2026-07-21) — signed work-authorization / e-sign documents (direct contact_id).
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

  ORDER BY 2 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;

-- ─── Fix 3: one-time backfill — link already-ingested leads that were missed ─
-- Only fills NULL contact_id values, and only when exactly one contact matches
-- by normalized phone (an ambiguous multi-contact match is skipped, not guessed).
WITH candidate_matches AS (
  SELECT il.id AS lead_id, c.id AS contact_id
  FROM inbound_leads il
  JOIN contacts c
    ON c.phone IS NOT NULL
   AND length(regexp_replace(c.phone, '\D', '', 'g')) >= 10
   AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = right(regexp_replace(il.caller_number, '\D', '', 'g'), 10)
  WHERE il.contact_id IS NULL
    AND il.caller_number IS NOT NULL
    AND length(regexp_replace(il.caller_number, '\D', '', 'g')) >= 10
),
unambiguous AS (
  SELECT lead_id, (array_agg(DISTINCT contact_id))[1] AS contact_id
  FROM candidate_matches
  GROUP BY lead_id
  HAVING COUNT(DISTINCT contact_id) = 1
)
UPDATE inbound_leads il
SET contact_id = u.contact_id
FROM unambiguous u
WHERE il.id = u.lead_id;
