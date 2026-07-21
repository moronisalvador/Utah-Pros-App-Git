-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_unlinked_lead_activity
-- Phase: n/a — standalone production fix
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Fixes two gaps in the Leads pipeline's activity timeline, found while
--   auditing get_contact_activity (the function that decides what shows up
--   in that timeline). First: a lead's own stage moves (new stage, lost
--   reason, etc.) never appeared in the timeline for ANYONE, linked or not —
--   the lead_stage_history table was simply missing from the list of things
--   the timeline pulls from. Second: a raw, not-yet-linked lead (the normal
--   state until someone matches it to a customer record) showed a totally
--   empty timeline even though it already has real activity — its own call,
--   any note, and any task added from its card. That's because the only
--   function available (get_contact_activity) requires a linked contact on
--   every single thing it looks up, so an unlinked lead has nothing to match
--   against. This adds a second function that looks up a lead's own activity
--   directly (no contact link required), and widens the existing function so
--   a task added while a lead was still unlinked doesn't stay invisible
--   forever even after that lead later gets matched to a contact.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. One new function (get_lead_activity) is created. One existing
--   function (get_contact_activity) gets its BODY replaced only — signature
--   and return shape unchanged, every existing caller keeps working. No
--   table is created, dropped, or altered; no column is renamed or removed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   New function — drop it:
--     DROP FUNCTION IF EXISTS public.get_lead_activity(uuid);
--
--   get_contact_activity — CREATE OR REPLACE back to the prior body (the one
--   shipped by 20260721_crm_contact_link_and_activity.sql): drop the new
--   'stage_change' UNION ALL branch, and narrow the 'task' branch back to
--   `WHERE t.contact_id = p_contact_id` (full prior body preserved in git
--   history at the commit before this migration).
-- ════════════════════════════════════════════════

-- ─── Fix 1: get_lead_activity — activity for a lead with no contact link yet ─
-- Same return shape as get_contact_activity so ActivityTimeline.jsx (already
-- generic over activity_type) needs no rendering changes — only the caller
-- picks which RPC to call.
CREATE OR REPLACE FUNCTION public.get_lead_activity(p_lead_id uuid)
 RETURNS TABLE(activity_type text, occurred_at timestamp with time zone, title text, body text, meta jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The lead's own call/form event — mirrors get_contact_activity's 'lead'
  -- arm exactly (same COALESCE(transcription, notes) body, same meta keys).
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

  -- Tasks added directly against this lead (crm_tasks.lead_id — independently
  -- nullable from contact_id, so a task on an unlinked lead has no other way
  -- to surface here).
  SELECT
    'task'::text,
    COALESCE(t.due_at, t.created_at),
    t.title,
    t.notes,
    jsonb_build_object('status', t.status, 'due_at', t.due_at, 'task_id', t.id)
  FROM crm_tasks t
  WHERE t.lead_id = p_lead_id

  UNION ALL

  -- Stage moves (lead_stage_history has only lead_id — no contact_id column
  -- exists on this table at all).
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

  ORDER BY 2 DESC;
$function$;

-- Same grant level as get_contact_activity's CURRENT (post-anon-closure)
-- grant — see the REVOKE/GRANT immediately below it in this same file for
-- the live state this matches. Not a public/allowlisted endpoint (no entry
-- in database-standard.md §2), so no anon grant.
REVOKE EXECUTE ON FUNCTION public.get_lead_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_activity(uuid) TO authenticated, service_role;

-- ─── Fix 2: get_contact_activity — add stage history + widen the task arm ───
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

  -- Widened (2026-07-21): a task can belong to this contact directly OR be
  -- scoped to one of the contact's leads via lead_id only (crm_tasks.contact_id
  -- and .lead_id are independently nullable — a task added from a lead card
  -- while that lead was still unlinked never got contact_id backfilled onto
  -- it when the lead later linked, so contact_id-only left it permanently
  -- invisible here).
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

  -- NEW (2026-07-21) — stage moves. lead_stage_history has no contact_id
  -- column at all (only lead_id), so it's joined through inbound_leads —
  -- the same pattern the 'lead' arm above and the widened 'task' arm use.
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

  ORDER BY 2 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;
