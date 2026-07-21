-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_activity_actor_names
-- Phase: n/a — standalone CRM lead-panel polish fix
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   The activity timeline shown in a lead/contact's detail panel lists what
--   happened (task added, stage moved, estimate sent, etc.) but never who did
--   it. This adds the acting employee's name to each activity row's `meta`
--   jsonb where one exists: who moved the pipeline stage, who created/was
--   assigned a task, who sent a text/estimate/appointment/invoice/work
--   authorization. A stage move with no `moved_by` (an automated trigger, not
--   a person) surfaces as `moved_by_name: null` — the frontend shows
--   "Automated" for that case rather than a blank.
--
-- ADDITIVE-ONLY / attribute-only:
--   Function-body-only CREATE OR REPLACE of get_lead_activity and
--   get_contact_activity — both keep their exact frozen signature and
--   RETURNS TABLE shape (activity_type, occurred_at, title, body, meta). Only
--   new keys are added inside the existing `meta` jsonb column; every
--   existing key an on-screen caller reads is untouched. No table/column
--   change, no grant change (both already GRANT EXECUTE TO authenticated,
--   service_role only, matching the managed-Supabase re-grant-to-PUBLIC trap
--   this project hits — explicit REVOKE below before each GRANT).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body (identical UNION ALL structure, minus the
--   employees LEFT JOINs and the *_name keys in each branch's jsonb_build_object)
--   via another CREATE OR REPLACE — the two functions immediately preceding
--   this migration in git history (20260721_crm_unlinked_lead_activity.sql /
--   20260721_crm_merge_repeat_call_leads.sql) hold that prior body.
-- ════════════════════════════════════════════════

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
    jsonb_build_object(
      'status', t.status, 'due_at', t.due_at, 'task_id', t.id,
      'created_by_name', COALESCE(ec.display_name, ec.full_name),
      'assignee_name', COALESCE(ea.display_name, ea.full_name)
    )
  FROM crm_tasks t
  LEFT JOIN employees ec ON ec.id = t.created_by
  LEFT JOIN employees ea ON ea.id = t.assignee_id
  WHERE t.lead_id = p_lead_id

  UNION ALL

  SELECT
    'stage_change'::text,
    lsh.moved_at,
    'Moved to ' || ps.name,
    NULL::text,
    jsonb_build_object(
      'from_stage_id', lsh.from_stage_id, 'stage_id', lsh.stage_id, 'lost_reason', lsh.lost_reason,
      'moved_by_name', COALESCE(em.display_name, em.full_name)
    )
  FROM lead_stage_history lsh
  JOIN pipeline_stages ps ON ps.id = lsh.stage_id
  LEFT JOIN employees em ON em.id = lsh.moved_by
  WHERE lsh.lead_id = p_lead_id

  UNION ALL

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
    AND il.merged_into_lead_id IS NULL

  UNION ALL

  SELECT
    'sms'::text,
    m.created_at,
    CASE WHEN m.sender_contact_id = p_contact_id THEN 'Received SMS' ELSE 'Sent SMS' END,
    m.body,
    jsonb_build_object(
      'type', m.type, 'status', m.status,
      'sent_by_name', COALESCE(es.display_name, es.full_name)
    )
  FROM messages m
  LEFT JOIN employees es ON es.id = m.sent_by
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
    jsonb_build_object(
      'status', e.status, 'amount', e.amount, 'estimate_id', e.id,
      'created_by_name', COALESCE(eest.display_name, eest.full_name)
    )
  FROM estimates e
  LEFT JOIN employees eest ON eest.id = e.created_by
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
    jsonb_build_object(
      'status', t.status, 'due_at', t.due_at, 'task_id', t.id,
      'created_by_name', COALESCE(etc.display_name, etc.full_name),
      'assignee_name', COALESCE(eta.display_name, eta.full_name)
    )
  FROM crm_tasks t
  LEFT JOIN employees etc ON etc.id = t.created_by
  LEFT JOIN employees eta ON eta.id = t.assignee_id
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
      'time_end', a.time_end, 'job_id', a.job_id,
      'created_by_name', COALESCE(eap.display_name, eap.full_name)
    )
  FROM appointments a
  LEFT JOIN employees eap ON eap.id = a.created_by
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
      'balance_due', i.balance_due, 'invoice_id', i.id, 'due_date', i.due_date,
      'created_by_name', COALESCE(einv.display_name, einv.full_name)
    )
  FROM invoices i
  LEFT JOIN employees einv ON einv.id = i.created_by
  WHERE i.contact_id = p_contact_id

  UNION ALL

  SELECT
    'work_authorization'::text,
    COALESCE(sr.signed_at, sr.sent_at, sr.created_at),
    COALESCE(initcap(replace(sr.doc_type, '_', ' ')), 'Work Authorization'),
    NULL::text,
    jsonb_build_object(
      'status', sr.status, 'doc_type', sr.doc_type, 'signed_at', sr.signed_at,
      'signed_file_path', sr.signed_file_path, 'job_id', sr.job_id,
      'sent_by_name', COALESCE(esr.display_name, esr.full_name)
    )
  FROM sign_requests sr
  LEFT JOIN employees esr ON esr.id = sr.sent_by
  WHERE sr.contact_id = p_contact_id

  UNION ALL

  SELECT
    'stage_change'::text,
    lsh.moved_at,
    'Moved to ' || ps.name,
    NULL::text,
    jsonb_build_object(
      'from_stage_id', lsh.from_stage_id, 'stage_id', lsh.stage_id, 'lost_reason', lsh.lost_reason,
      'moved_by_name', COALESCE(elsh.display_name, elsh.full_name)
    )
  FROM lead_stage_history lsh
  JOIN pipeline_stages ps ON ps.id = lsh.stage_id
  LEFT JOIN employees elsh ON elsh.id = lsh.moved_by
  WHERE lsh.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)

  UNION ALL

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
