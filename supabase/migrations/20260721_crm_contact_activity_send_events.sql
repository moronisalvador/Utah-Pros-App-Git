-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_contact_activity_send_events
-- Phase: n/a (standalone production fix — CRM wave manifest §1 AMENDED 2026-07-21 precedent)
-- ════════════════════════════════════════════════
--
-- Verified before shipping (CLAUDE.md Rule 7 discipline): every column referenced by the
-- 5 new arms (forms.form_type/job_id/submitted_by/technician_name/form_date/summary/status,
-- invoices.qbo_emailed_at/sent_to_email/qbo_email_status, estimates.<same three>,
-- sign_requests.signer_name/signer_email/sent_by/sent_at/signed_at/doc_type) was independently
-- confirmed live via information_schema.columns immediately before applying, and the full
-- function was live-tested inside a rolled-back transaction returning real rows for every
-- arm except estimate_sent (0/43 estimates have ever been emailed via QBO — expected, not
-- an error) — see workflow wf_35e40cb5-f85 for the full verification trail.
--
-- WHAT THIS DOES (plain language):
--   Adds five new rows of activity history to a contact's timeline: when a work
--   authorization document was SENT to a customer (separate from when it was
--   SIGNED — today those two moments are collapsed into one generic entry),
--   when a technician submitted a scope sheet on a job, and when an invoice or
--   estimate was actually emailed to the customer through QuickBooks. This is a
--   function-body-only replace of the existing get_contact_activity function —
--   every one of its 18 current rows of logic is left completely untouched, we
--   are only adding 5 more.
--
-- ADDITIVE-ONLY / attribute-only:
--   Function-body-only CREATE OR REPLACE. Signature (name, args, RETURNS TABLE
--   shape) is byte-for-byte unchanged from the live version. All 18 existing
--   UNION ALL arms are reproduced verbatim, character-for-character, with zero
--   edits. The existing generic 'work_authorization' arm (covering all
--   sign_requests doc_types) is NOT removed or modified — the two new
--   work_auth_sent/work_auth_signed arms are additional, more granular views
--   scoped to doc_type='work_auth' only, so a work-auth document now surfaces
--   in the timeline three times (once generically, once as "sent", once as
--   "signed" if applicable) — this is an intentional, disclosed trade-off, not
--   a bug. No table/column DDL, no data change, no RLS/policy change. Adds the
--   mandatory `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated,
--   service_role` pair per database-standard.md §1 (managed-Supabase re-opens
--   PUBLIC execute on every CREATE OR REPLACE of a function).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-run this exact CREATE OR REPLACE with the prior (18-arm) body below,
--   then re-assert the same REVOKE/GRANT pair (harmless no-op if already
--   correct — re-running it is always safe):
--
--   CREATE OR REPLACE FUNCTION public.get_contact_activity(p_contact_id uuid)
--    RETURNS TABLE(activity_type text, occurred_at timestamp with time zone, title text, body text, meta jsonb)
--    LANGUAGE sql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--     SELECT
--       'lead'::text,
--       COALESCE(il.occurred_at, il.created_at),
--       CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END,
--       COALESCE(il.transcription, il.notes),
--       jsonb_build_object(
--         'source_type', il.source_type, 'duration_sec', il.duration_sec,
--         'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
--         'recording_url', il.recording_url, 'transcript_analysis', il.transcript_analysis
--       )
--     FROM inbound_leads il
--     WHERE il.contact_id = p_contact_id
--       AND il.merged_into_lead_id IS NULL
--
--     UNION ALL
--
--     SELECT
--       'sms'::text,
--       m.created_at,
--       CASE WHEN m.sender_contact_id = p_contact_id THEN 'Received SMS' ELSE 'Sent SMS' END,
--       m.body,
--       jsonb_build_object(
--         'type', m.type, 'status', m.status,
--         'sent_by_name', COALESCE(es.display_name, es.full_name)
--       )
--     FROM messages m
--     LEFT JOIN employees es ON es.id = m.sent_by
--     WHERE m.conversation_id IN (
--       SELECT cp.conversation_id FROM conversation_participants cp WHERE cp.contact_id = p_contact_id
--     )
--
--     UNION ALL
--
--     SELECT
--       'note'::text,
--       jn.created_at,
--       'Note'::text,
--       jn.body,
--       jsonb_build_object('job_id', jn.job_id, 'author_name', jn.author_name)
--     FROM job_notes jn
--     WHERE jn.job_id IN (
--       SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
--     )
--
--     UNION ALL
--
--     SELECT
--       'estimate'::text,
--       e.created_at,
--       'Estimate ' || COALESCE(e.estimate_number, e.id::text),
--       NULL::text,
--       jsonb_build_object(
--         'status', e.status, 'amount', e.amount, 'estimate_id', e.id,
--         'created_by_name', COALESCE(eest.display_name, eest.full_name)
--       )
--     FROM estimates e
--     LEFT JOIN employees eest ON eest.id = e.created_by
--     WHERE e.contact_id = p_contact_id
--
--     UNION ALL
--
--     SELECT
--       'email'::text,
--       COALESCE(r.sent_at, r.created_at),
--       'Campaign email'::text,
--       ec.subject,
--       jsonb_build_object('status', r.status, 'campaign', ec.name, 'campaign_id', ec.id)
--     FROM email_campaign_recipients r
--     JOIN email_campaigns ec ON ec.id = r.campaign_id
--     WHERE r.contact_id = p_contact_id
--
--     UNION ALL
--
--     SELECT
--       'job'::text,
--       j.created_at,
--       'Job ' || COALESCE(j.job_number, j.id::text),
--       j.address,
--       jsonb_build_object('status', j.status, 'job_id', j.id)
--     FROM jobs j
--     WHERE j.id IN (
--       SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
--     )
--
--     UNION ALL
--
--     SELECT
--       'task'::text,
--       COALESCE(t.due_at, t.created_at),
--       t.title,
--       t.notes,
--       jsonb_build_object(
--         'status', t.status, 'due_at', t.due_at, 'task_id', t.id,
--         'created_by_name', COALESCE(etc.display_name, etc.full_name),
--         'assignee_name', COALESCE(eta.display_name, eta.full_name)
--       )
--     FROM crm_tasks t
--     LEFT JOIN employees etc ON etc.id = t.created_by
--     LEFT JOIN employees eta ON eta.id = t.assignee_id
--     WHERE t.contact_id = p_contact_id
--        OR t.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)
--
--     UNION ALL
--
--     SELECT
--       'appointment'::text,
--       (a.date + COALESCE(a.time_start, '00:00'::time))::timestamptz,
--       COALESCE(a.title, 'Appointment'),
--       a.notes,
--       jsonb_build_object(
--         'status', a.status, 'type', a.type, 'time_start', a.time_start,
--         'time_end', a.time_end, 'job_id', a.job_id,
--         'created_by_name', COALESCE(eap.display_name, eap.full_name)
--       )
--     FROM appointments a
--     LEFT JOIN employees eap ON eap.id = a.created_by
--     WHERE a.job_id IN (
--       SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
--     )
--
--     UNION ALL
--
--     SELECT
--       'invoice'::text,
--       COALESCE(i.invoice_date::timestamptz, i.created_at),
--       'Invoice ' || COALESCE(i.invoice_number, i.id::text),
--       NULL::text,
--       jsonb_build_object(
--         'status', i.status, 'total', i.total, 'amount_paid', i.amount_paid,
--         'balance_due', i.balance_due, 'invoice_id', i.id, 'due_date', i.due_date,
--         'created_by_name', COALESCE(einv.display_name, einv.full_name)
--       )
--     FROM invoices i
--     LEFT JOIN employees einv ON einv.id = i.created_by
--     WHERE i.contact_id = p_contact_id
--
--     UNION ALL
--
--     SELECT
--       'work_authorization'::text,
--       COALESCE(sr.signed_at, sr.sent_at, sr.created_at),
--       COALESCE(initcap(replace(sr.doc_type, '_', ' ')), 'Work Authorization'),
--       NULL::text,
--       jsonb_build_object(
--         'status', sr.status, 'doc_type', sr.doc_type, 'signed_at', sr.signed_at,
--         'signed_file_path', sr.signed_file_path, 'job_id', sr.job_id,
--         'sent_by_name', COALESCE(esr.display_name, esr.full_name)
--       )
--     FROM sign_requests sr
--     LEFT JOIN employees esr ON esr.id = sr.sent_by
--     WHERE sr.contact_id = p_contact_id
--
--     UNION ALL
--
--     SELECT
--       'stage_change'::text,
--       lsh.moved_at,
--       'Moved to ' || ps.name,
--       NULL::text,
--       jsonb_build_object(
--         'from_stage_id', lsh.from_stage_id, 'stage_id', lsh.stage_id, 'lost_reason', lsh.lost_reason,
--         'moved_by_name', COALESCE(elsh.display_name, elsh.full_name)
--       )
--     FROM lead_stage_history lsh
--     JOIN pipeline_stages ps ON ps.id = lsh.stage_id
--     LEFT JOIN employees elsh ON elsh.id = lsh.moved_by
--     WHERE lsh.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)
--
--     UNION ALL
--
--     SELECT
--       'follow_up_call'::text,
--       COALESCE(fu.occurred_at, fu.created_at),
--       CASE WHEN fu.source_type = 'call' THEN 'Follow-up call' ELSE 'Follow-up web form' END,
--       COALESCE(fu.transcription, fu.notes),
--       jsonb_build_object(
--         'source_type', fu.source_type, 'duration_sec', fu.duration_sec,
--         'caller_number', fu.caller_number, 'recording_url', fu.recording_url,
--         'transcript_analysis', fu.transcript_analysis, 'merged_lead_id', fu.id
--       )
--     FROM inbound_leads fu
--     WHERE fu.merged_into_lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)
--
--     UNION ALL
--
--     SELECT
--       'claim'::text,
--       cl.created_at,
--       'Claim ' || COALESCE(cl.claim_number, cl.id::text),
--       NULLIF(TRIM(BOTH ' ' FROM COALESCE(cl.loss_type, '') || CASE WHEN cl.insurance_carrier IS NOT NULL THEN ' — ' || cl.insurance_carrier ELSE '' END), ''),
--       jsonb_build_object(
--         'status', cl.status, 'claim_id', cl.id, 'insurance_carrier', cl.insurance_carrier,
--         'date_of_loss', cl.date_of_loss,
--         'created_by_name', COALESCE(ecl.display_name, ecl.full_name)
--       )
--     FROM claims cl
--     LEFT JOIN employees ecl ON ecl.id = cl.created_by
--     WHERE cl.contact_id = p_contact_id
--
--     UNION ALL
--
--     SELECT
--       'phase_change'::text,
--       h.changed_at,
--       'Phase: ' || COALESCE(pf.label, h.from_phase) || ' → ' || COALESCE(pt.label, h.to_phase),
--       NULL::text,
--       jsonb_build_object(
--         'job_id', h.job_id, 'from_phase', h.from_phase, 'to_phase', h.to_phase,
--         'changed_by_name', COALESCE(eph.display_name, eph.full_name)
--       )
--     FROM job_phase_history h
--     LEFT JOIN employees eph ON eph.id = h.changed_by
--     LEFT JOIN job_phases pf ON pf.key = h.from_phase
--     LEFT JOIN job_phases pt ON pt.key = h.to_phase
--     WHERE h.job_id IN (
--       SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
--     )
--
--     UNION ALL
--
--     SELECT
--       'payment'::text,
--       COALESCE(p.payment_date::timestamptz, p.created_at),
--       'Payment received'::text,
--       NULL::text,
--       jsonb_build_object(
--         'amount', p.amount, 'method', p.payment_method, 'invoice_id', p.invoice_id,
--         'recorded_by_name', COALESCE(epay.display_name, epay.full_name)
--       )
--     FROM payments p
--     LEFT JOIN employees epay ON epay.id = p.recorded_by
--     WHERE p.contact_id = p_contact_id
--
--     UNION ALL
--
--     SELECT
--       'document'::text,
--       jd.created_at,
--       COALESCE(jd.name, initcap(replace(jd.category, '_', ' ')), 'Document'),
--       NULL::text,
--       jsonb_build_object(
--         'job_id', jd.job_id, 'category', jd.category,
--         'uploaded_by_name', COALESCE(eupl.display_name, eupl.full_name)
--       )
--     FROM job_documents jd
--     LEFT JOIN employees eupl ON eupl.id = jd.uploaded_by
--     WHERE jd.job_id IN (
--       SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
--     )
--
--     UNION ALL
--
--     SELECT
--       'contact_owner_set'::text,
--       se_own.created_at,
--       'Owner changed'::text,
--       NULL::text,
--       se_own.payload || jsonb_build_object(
--         'actor_name', COALESCE(eown.display_name, eown.full_name)
--       )
--     FROM system_events se_own
--     LEFT JOIN employees eown ON eown.id = se_own.actor_id
--     WHERE se_own.event_type = 'crm_contact_owner_set'
--       AND se_own.entity_type = 'contact'
--       AND se_own.entity_id = p_contact_id
--
--     UNION ALL
--
--     SELECT
--       'contact_lifecycle_set'::text,
--       se_life.created_at,
--       'Lifecycle status changed'::text,
--       NULL::text,
--       se_life.payload || jsonb_build_object(
--         'actor_name', COALESCE(elife.display_name, elife.full_name)
--       )
--     FROM system_events se_life
--     LEFT JOIN employees elife ON elife.id = se_life.actor_id
--     WHERE se_life.event_type = 'crm_contact_lifecycle_set'
--       AND se_life.entity_type = 'contact'
--       AND se_life.entity_id = p_contact_id
--
--     ORDER BY 2 DESC;
--   $function$;
--
--   REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;
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

  UNION ALL

  SELECT
    'claim'::text,
    cl.created_at,
    'Claim ' || COALESCE(cl.claim_number, cl.id::text),
    NULLIF(TRIM(BOTH ' ' FROM COALESCE(cl.loss_type, '') || CASE WHEN cl.insurance_carrier IS NOT NULL THEN ' — ' || cl.insurance_carrier ELSE '' END), ''),
    jsonb_build_object(
      'status', cl.status, 'claim_id', cl.id, 'insurance_carrier', cl.insurance_carrier,
      'date_of_loss', cl.date_of_loss,
      'created_by_name', COALESCE(ecl.display_name, ecl.full_name)
    )
  FROM claims cl
  LEFT JOIN employees ecl ON ecl.id = cl.created_by
  WHERE cl.contact_id = p_contact_id

  UNION ALL

  SELECT
    'phase_change'::text,
    h.changed_at,
    'Phase: ' || COALESCE(pf.label, h.from_phase) || ' → ' || COALESCE(pt.label, h.to_phase),
    NULL::text,
    jsonb_build_object(
      'job_id', h.job_id, 'from_phase', h.from_phase, 'to_phase', h.to_phase,
      'changed_by_name', COALESCE(eph.display_name, eph.full_name)
    )
  FROM job_phase_history h
  LEFT JOIN employees eph ON eph.id = h.changed_by
  LEFT JOIN job_phases pf ON pf.key = h.from_phase
  LEFT JOIN job_phases pt ON pt.key = h.to_phase
  WHERE h.job_id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'payment'::text,
    COALESCE(p.payment_date::timestamptz, p.created_at),
    'Payment received'::text,
    NULL::text,
    jsonb_build_object(
      'amount', p.amount, 'method', p.payment_method, 'invoice_id', p.invoice_id,
      'recorded_by_name', COALESCE(epay.display_name, epay.full_name)
    )
  FROM payments p
  LEFT JOIN employees epay ON epay.id = p.recorded_by
  WHERE p.contact_id = p_contact_id

  UNION ALL

  SELECT
    'document'::text,
    jd.created_at,
    COALESCE(jd.name, initcap(replace(jd.category, '_', ' ')), 'Document'),
    NULL::text,
    jsonb_build_object(
      'job_id', jd.job_id, 'category', jd.category,
      'uploaded_by_name', COALESCE(eupl.display_name, eupl.full_name)
    )
  FROM job_documents jd
  LEFT JOIN employees eupl ON eupl.id = jd.uploaded_by
  WHERE jd.job_id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'contact_owner_set'::text,
    se_own.created_at,
    'Owner changed'::text,
    NULL::text,
    se_own.payload || jsonb_build_object(
      'actor_name', COALESCE(eown.display_name, eown.full_name)
    )
  FROM system_events se_own
  LEFT JOIN employees eown ON eown.id = se_own.actor_id
  WHERE se_own.event_type = 'crm_contact_owner_set'
    AND se_own.entity_type = 'contact'
    AND se_own.entity_id = p_contact_id

  UNION ALL

  SELECT
    'contact_lifecycle_set'::text,
    se_life.created_at,
    'Lifecycle status changed'::text,
    NULL::text,
    se_life.payload || jsonb_build_object(
      'actor_name', COALESCE(elife.display_name, elife.full_name)
    )
  FROM system_events se_life
  LEFT JOIN employees elife ON elife.id = se_life.actor_id
  WHERE se_life.event_type = 'crm_contact_lifecycle_set'
    AND se_life.entity_type = 'contact'
    AND se_life.entity_id = p_contact_id

  UNION ALL

  SELECT
    'work_auth_sent'::text,
    COALESCE(wasent.sent_at, wasent.created_at),
    'Work authorization sent'::text,
    NULL::text,
    jsonb_build_object(
      'status', wasent.status, 'doc_type', wasent.doc_type, 'sent_at', wasent.sent_at,
      'job_id', wasent.job_id, 'signer_name', wasent.signer_name, 'signer_email', wasent.signer_email,
      'sent_by_name', COALESCE(ewasent.display_name, ewasent.full_name)
    )
  FROM sign_requests wasent
  LEFT JOIN employees ewasent ON ewasent.id = wasent.sent_by
  WHERE wasent.contact_id = p_contact_id
    AND wasent.doc_type = 'work_auth'

  UNION ALL

  SELECT
    'work_auth_signed'::text,
    wasigned.signed_at,
    'Work authorization signed'::text,
    NULL::text,
    jsonb_build_object(
      'status', wasigned.status, 'doc_type', wasigned.doc_type, 'job_id', wasigned.job_id,
      'signed_file_path', wasigned.signed_file_path,
      'signer_name', wasigned.signer_name, 'signer_email', wasigned.signer_email
    )
  FROM sign_requests wasigned
  WHERE wasigned.contact_id = p_contact_id
    AND wasigned.doc_type = 'work_auth'
    AND wasigned.signed_at IS NOT NULL

  UNION ALL

  SELECT
    'scope_sheet'::text,
    COALESCE(ds.form_date::timestamptz, ds.created_at),
    COALESCE('Scope sheet — ' || ds.technician_name, 'Scope sheet'),
    NULL::text,
    jsonb_build_object(
      'status', ds.status, 'job_id', ds.job_id, 'technician_name', ds.technician_name,
      'form_date', ds.form_date, 'summary', ds.summary,
      'submitted_by_name', COALESCE(eds.display_name, eds.full_name)
    )
  FROM forms ds
  LEFT JOIN employees eds ON eds.id = ds.submitted_by
  WHERE ds.form_type = 'demo_sheet'
    AND ds.job_id IN (
      SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
    )

  UNION ALL

  SELECT
    'invoice_sent'::text,
    i2.qbo_emailed_at,
    'Invoice sent' || CASE WHEN i2.invoice_number IS NOT NULL THEN ' — ' || i2.invoice_number ELSE '' END,
    NULL::text,
    jsonb_build_object(
      'invoice_id', i2.id, 'sent_to_email', i2.sent_to_email, 'qbo_email_status', i2.qbo_email_status
    )
  FROM invoices i2
  WHERE i2.contact_id = p_contact_id
    AND i2.qbo_emailed_at IS NOT NULL

  UNION ALL

  SELECT
    'estimate_sent'::text,
    e2.qbo_emailed_at,
    'Estimate sent' || CASE WHEN e2.estimate_number IS NOT NULL THEN ' — ' || e2.estimate_number ELSE '' END,
    NULL::text,
    jsonb_build_object(
      'estimate_id', e2.id, 'sent_to_email', e2.sent_to_email, 'qbo_email_status', e2.qbo_email_status
    )
  FROM estimates e2
  WHERE e2.contact_id = p_contact_id
    AND e2.qbo_emailed_at IS NOT NULL

  ORDER BY 2 DESC;
$function$;

-- managed-Supabase re-opens PUBLIC execute on every CREATE OR REPLACE of a
-- function (database-standard.md §1) — re-assert least-privilege every time.
REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;
