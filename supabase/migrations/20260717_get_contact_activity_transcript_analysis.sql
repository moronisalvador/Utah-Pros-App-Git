-- ════════════════════════════════════════════════
-- MIGRATION: 20260717_get_contact_activity_transcript_analysis
-- Phase: n/a — standalone (CRM lead-detail-panel fix chain, 2026-07-17)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   A call's row in the shared contact-activity timeline (used by the CRM
--   Leads panel and, in the wave, the Contacts detail screen) already carries
--   a plain transcript ("Speaker 1: ... Speaker 2: ..."). Separately, every
--   transcribed call ALSO gets a richer, already-computed breakdown — which
--   speaker is Utah Pros vs. the customer, an AI summary, sentiment, topics —
--   stored on inbound_leads.transcript_analysis. That richer breakdown was
--   never exposed through this function, so the UI could only show the flat
--   "Speaker 1/2" text, not the correct Utah Pros/Customer labels the backend
--   had already figured out. This adds that structured data into the existing
--   `meta` field so the timeline can use it.
--
-- ADDITIVE-ONLY / attribute-only:
--   Function-body-only CREATE OR REPLACE of get_contact_activity(uuid) — same
--   signature, same 5 returned columns (activity_type, occurred_at, title,
--   body, meta). The only change is one new key added inside the 'lead' arm's
--   `meta` jsonb object ('transcript_analysis'); every existing key/column is
--   untouched. No table/column/policy change. Re-affirms the existing
--   authenticated-only grant (REVOKE ... FROM PUBLIC, anon then GRANT — this
--   project re-applies PUBLIC EXECUTE to every new/replaced function, so the
--   explicit REVOKE is required belt-and-suspenders per database-standard.md
--   §1, not merely defensive).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body (drops the new `transcript_analysis` key,
--   everything else identical) — confirmed live via pg_get_functiondef
--   before this migration was written:
--
--   CREATE OR REPLACE FUNCTION public.get_contact_activity(p_contact_id uuid)
--   RETURNS TABLE(activity_type text, occurred_at timestamp with time zone, title text, body text, meta jsonb)
--   LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
--     SELECT
--       'lead'::text, COALESCE(il.occurred_at, il.created_at),
--       CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END,
--       COALESCE(il.transcription, il.notes),
--       jsonb_build_object(
--         'source_type', il.source_type, 'duration_sec', il.duration_sec,
--         'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
--         'recording_url', il.recording_url
--       )
--     FROM inbound_leads il WHERE il.contact_id = p_contact_id
--     UNION ALL
--     SELECT 'sms'::text, m.created_at,
--       CASE WHEN m.sender_contact_id = p_contact_id THEN 'Received SMS' ELSE 'Sent SMS' END,
--       m.body, jsonb_build_object('type', m.type, 'status', m.status)
--     FROM messages m WHERE m.conversation_id IN (
--       SELECT cp.conversation_id FROM conversation_participants cp WHERE cp.contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'note'::text, jn.created_at, 'Note'::text, jn.body,
--       jsonb_build_object('job_id', jn.job_id, 'author_name', jn.author_name)
--     FROM job_notes jn WHERE jn.job_id IN (
--       SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'estimate'::text, e.created_at, 'Estimate ' || COALESCE(e.estimate_number, e.id::text),
--       NULL::text, jsonb_build_object('status', e.status, 'amount', e.amount, 'estimate_id', e.id)
--     FROM estimates e WHERE e.contact_id = p_contact_id
--     UNION ALL
--     SELECT 'email'::text, COALESCE(r.sent_at, r.created_at), 'Campaign email'::text, ec.subject,
--       jsonb_build_object('status', r.status, 'campaign', ec.name, 'campaign_id', ec.id)
--     FROM email_campaign_recipients r JOIN email_campaigns ec ON ec.id = r.campaign_id
--     WHERE r.contact_id = p_contact_id
--     UNION ALL
--     SELECT 'job'::text, j.created_at, 'Job ' || COALESCE(j.job_number, j.id::text), j.address,
--       jsonb_build_object('status', j.status, 'job_id', j.id)
--     FROM jobs j WHERE j.id IN (
--       SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'task'::text, COALESCE(t.due_at, t.created_at), t.title, t.notes,
--       jsonb_build_object('status', t.status, 'due_at', t.due_at, 'task_id', t.id)
--     FROM crm_tasks t WHERE t.contact_id = p_contact_id
--     ORDER BY 2 DESC;
--   $function$;
--   REVOKE EXECUTE ON FUNCTION get_contact_activity(uuid) FROM PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION get_contact_activity(uuid) TO authenticated, service_role;
--   (re-running the REVOKE is required here too — a fresh CREATE OR REPLACE
--   re-triggers the managed-Supabase PUBLIC-EXECUTE trap per §1 above, so a
--   rollback that skips it would silently reopen PUBLIC/anon execute.)
-- ════════════════════════════════════════════════

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

  ORDER BY 2 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;
