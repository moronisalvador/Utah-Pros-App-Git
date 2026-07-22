-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_contact_activity_payment_document_events
-- Phase: n/a (standalone production fix — see crm-wave-ownership.md §1 AMENDED note,
--        2026-07-21 precedent: function-body-only CREATE OR REPLACE of get_contact_activity)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds four more history entries to a contact's activity timeline: payments received,
--   documents uploaded to their jobs, and two CRM audit events (owner changed, lifecycle
--   status changed). This is a function-BODY-only change to the existing
--   get_contact_activity(uuid) RPC — the function's name, arguments, and return columns
--   stay exactly the same, so nothing that already calls it breaks. It also re-applies the
--   least-privilege grant on this function per database-standard.md §1 (Postgres silently
--   re-opens EXECUTE to PUBLIC on every CREATE OR REPLACE on this managed project).
--
--   Verified live before shipping (workflow wf_7385df6a-34d): every new arm was run inside
--   a rolled-back transaction against real rows (7 payments, 8 job_documents, 1
--   crm_contact_owner_set event, 1 crm_contact_lifecycle_set event) — no column/type
--   mismatches, no query errors. The 14 pre-existing arms were diffed byte-for-byte
--   (modulo comments) against the prior live function body and are unchanged.
--
--   Known caveat, disclosed rather than silently accepted: `payments.recorded_by` and
--   `job_documents.uploaded_by` are both real, populated actor columns, but sparsely — most
--   `payments` rows are QBO-mirrored and never set `recorded_by` (4/85 populated), and
--   `job_documents.uploaded_by` depends on the uploading worker/caller supplying it. Both
--   arms render correctly with `actor_name: null` when unset (COALESCE + LEFT JOIN, no
--   error) — this is a data-completeness gap in the source tables, not a bug in this RPC.
--
-- ADDITIVE-ONLY / attribute-only:
--   Function-body-only CREATE OR REPLACE of a live RPC. Signature and return shape
--   (activity_type text, occurred_at timestamptz, title text, body text, meta jsonb) are
--   UNCHANGED — only four new UNION ALL arms are appended before the existing final
--   `ORDER BY 2 DESC`. No table DROP/RENAME/ALTER COLUMN. No data change. Grants are
--   re-asserted to the same authenticated+service_role posture the function already had
--   (never anon — this RPC is not on the database-standard.md §2 public allowlist).
--
--   NOT included in this migration (deferred, needs a human decision — see the roadmap/PR
--   discussion, not silently dropped): `merge_contacts(p_keep_id, p_merge_id)` writes a
--   `contact.merged` system_events row with `actor_id` always NULL, because the function has
--   no actor parameter at all. Fixing that means widening its signature
--   (`p_actor_id uuid DEFAULT NULL`, additive/backward-compatible) — a separate, reviewed
--   change, not a body-only replace, and per crm-wave-ownership.md sits adjacent to CRM-wave
--   Phase 6a merge tooling (MergeTool.jsx / get_duplicate_contacts) so needs the right
--   reviewer. Likewise `set_contact_owner`/`set_contact_lifecycle` are NOT touched here even
--   though the two new arms in this migration read the system_events rows those RPCs write —
--   today `actor_id` is NULL on every such event; whether to start populating it is the same
--   kind of signature-widening follow-up, deferred for the same reason.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-run this CREATE OR REPLACE with the prior 14-arm body (verbatim, below) — this
--   removes the four new arms (payment, document, contact_owner_set, contact_lifecycle_set)
--   and restores exactly what was live before this migration. The REVOKE/GRANT lines are
--   idempotent and need no separate undo.
--
--   CREATE OR REPLACE FUNCTION public.get_contact_activity(p_contact_id uuid)
--    RETURNS TABLE(activity_type text, occurred_at timestamp with time zone, title text, body text, meta jsonb)
--    LANGUAGE sql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--     SELECT 'lead'::text, COALESCE(il.occurred_at, il.created_at),
--       CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END,
--       COALESCE(il.transcription, il.notes),
--       jsonb_build_object('source_type', il.source_type, 'duration_sec', il.duration_sec,
--         'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
--         'recording_url', il.recording_url, 'transcript_analysis', il.transcript_analysis)
--     FROM inbound_leads il WHERE il.contact_id = p_contact_id AND il.merged_into_lead_id IS NULL
--     UNION ALL
--     SELECT 'sms'::text, m.created_at,
--       CASE WHEN m.sender_contact_id = p_contact_id THEN 'Received SMS' ELSE 'Sent SMS' END, m.body,
--       jsonb_build_object('type', m.type, 'status', m.status, 'sent_by_name', COALESCE(es.display_name, es.full_name))
--     FROM messages m LEFT JOIN employees es ON es.id = m.sent_by
--     WHERE m.conversation_id IN (SELECT cp.conversation_id FROM conversation_participants cp WHERE cp.contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'note'::text, jn.created_at, 'Note'::text, jn.body,
--       jsonb_build_object('job_id', jn.job_id, 'author_name', jn.author_name)
--     FROM job_notes jn WHERE jn.job_id IN (SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'estimate'::text, e.created_at, 'Estimate ' || COALESCE(e.estimate_number, e.id::text), NULL::text,
--       jsonb_build_object('status', e.status, 'amount', e.amount, 'estimate_id', e.id,
--         'created_by_name', COALESCE(eest.display_name, eest.full_name))
--     FROM estimates e LEFT JOIN employees eest ON eest.id = e.created_by WHERE e.contact_id = p_contact_id
--     UNION ALL
--     SELECT 'email'::text, COALESCE(r.sent_at, r.created_at), 'Campaign email'::text, ec.subject,
--       jsonb_build_object('status', r.status, 'campaign', ec.name, 'campaign_id', ec.id)
--     FROM email_campaign_recipients r JOIN email_campaigns ec ON ec.id = r.campaign_id WHERE r.contact_id = p_contact_id
--     UNION ALL
--     SELECT 'job'::text, j.created_at, 'Job ' || COALESCE(j.job_number, j.id::text), j.address,
--       jsonb_build_object('status', j.status, 'job_id', j.id)
--     FROM jobs j WHERE j.id IN (SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'task'::text, COALESCE(t.due_at, t.created_at), t.title, t.notes,
--       jsonb_build_object('status', t.status, 'due_at', t.due_at, 'task_id', t.id,
--         'created_by_name', COALESCE(etc.display_name, etc.full_name), 'assignee_name', COALESCE(eta.display_name, eta.full_name))
--     FROM crm_tasks t LEFT JOIN employees etc ON etc.id = t.created_by LEFT JOIN employees eta ON eta.id = t.assignee_id
--     WHERE t.contact_id = p_contact_id OR t.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'appointment'::text, (a.date + COALESCE(a.time_start, '00:00'::time))::timestamptz,
--       COALESCE(a.title, 'Appointment'), a.notes,
--       jsonb_build_object('status', a.status, 'type', a.type, 'time_start', a.time_start,
--         'time_end', a.time_end, 'job_id', a.job_id, 'created_by_name', COALESCE(eap.display_name, eap.full_name))
--     FROM appointments a LEFT JOIN employees eap ON eap.id = a.created_by
--     WHERE a.job_id IN (SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'invoice'::text, COALESCE(i.invoice_date::timestamptz, i.created_at),
--       'Invoice ' || COALESCE(i.invoice_number, i.id::text), NULL::text,
--       jsonb_build_object('status', i.status, 'total', i.total, 'amount_paid', i.amount_paid,
--         'balance_due', i.balance_due, 'invoice_id', i.id, 'due_date', i.due_date,
--         'created_by_name', COALESCE(einv.display_name, einv.full_name))
--     FROM invoices i LEFT JOIN employees einv ON einv.id = i.created_by WHERE i.contact_id = p_contact_id
--     UNION ALL
--     SELECT 'work_authorization'::text, COALESCE(sr.signed_at, sr.sent_at, sr.created_at),
--       COALESCE(initcap(replace(sr.doc_type, '_', ' ')), 'Work Authorization'), NULL::text,
--       jsonb_build_object('status', sr.status, 'doc_type', sr.doc_type, 'signed_at', sr.signed_at,
--         'signed_file_path', sr.signed_file_path, 'job_id', sr.job_id, 'sent_by_name', COALESCE(esr.display_name, esr.full_name))
--     FROM sign_requests sr LEFT JOIN employees esr ON esr.id = sr.sent_by WHERE sr.contact_id = p_contact_id
--     UNION ALL
--     SELECT 'stage_change'::text, lsh.moved_at, 'Moved to ' || ps.name, NULL::text,
--       jsonb_build_object('from_stage_id', lsh.from_stage_id, 'stage_id', lsh.stage_id, 'lost_reason', lsh.lost_reason,
--         'moved_by_name', COALESCE(elsh.display_name, elsh.full_name))
--     FROM lead_stage_history lsh JOIN pipeline_stages ps ON ps.id = lsh.stage_id LEFT JOIN employees elsh ON elsh.id = lsh.moved_by
--     WHERE lsh.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'follow_up_call'::text, COALESCE(fu.occurred_at, fu.created_at),
--       CASE WHEN fu.source_type = 'call' THEN 'Follow-up call' ELSE 'Follow-up web form' END,
--       COALESCE(fu.transcription, fu.notes),
--       jsonb_build_object('source_type', fu.source_type, 'duration_sec', fu.duration_sec,
--         'caller_number', fu.caller_number, 'recording_url', fu.recording_url,
--         'transcript_analysis', fu.transcript_analysis, 'merged_lead_id', fu.id)
--     FROM inbound_leads fu WHERE fu.merged_into_lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)
--     UNION ALL
--     SELECT 'claim'::text, cl.created_at, 'Claim ' || COALESCE(cl.claim_number, cl.id::text),
--       NULLIF(TRIM(BOTH ' ' FROM COALESCE(cl.loss_type, '') || CASE WHEN cl.insurance_carrier IS NOT NULL THEN ' — ' || cl.insurance_carrier ELSE '' END), ''),
--       jsonb_build_object('status', cl.status, 'claim_id', cl.id, 'insurance_carrier', cl.insurance_carrier,
--         'date_of_loss', cl.date_of_loss, 'created_by_name', COALESCE(ecl.display_name, ecl.full_name))
--     FROM claims cl LEFT JOIN employees ecl ON ecl.id = cl.created_by WHERE cl.contact_id = p_contact_id
--     UNION ALL
--     SELECT 'phase_change'::text, h.changed_at,
--       'Phase: ' || COALESCE(pf.label, h.from_phase) || ' → ' || COALESCE(pt.label, h.to_phase), NULL::text,
--       jsonb_build_object('job_id', h.job_id, 'from_phase', h.from_phase, 'to_phase', h.to_phase,
--         'changed_by_name', COALESCE(eph.display_name, eph.full_name))
--     FROM job_phase_history h LEFT JOIN employees eph ON eph.id = h.changed_by
--       LEFT JOIN job_phases pf ON pf.key = h.from_phase LEFT JOIN job_phases pt ON pt.key = h.to_phase
--     WHERE h.job_id IN (SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id)
--     ORDER BY 2 DESC;
--   $function$;
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

  -- NEW: payment received (payments.contact_id is a direct FK, no invoice join needed).
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

  -- NEW: document/file uploaded to one of this contact's jobs (photos, reports, scope-sheet PDFs, etc).
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

  -- NEW: CRM contact owner reassigned (system_events, written by set_contact_owner).
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

  -- NEW: CRM lifecycle status changed (system_events, written by set_contact_lifecycle).
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

  ORDER BY 2 DESC;
$function$;

-- Managed-Supabase EXECUTE-TO-PUBLIC trap (database-standard.md §1): every CREATE OR
-- REPLACE re-applies Postgres's built-in PUBLIC grant on the function. Re-close it and
-- re-assert the existing least-privilege posture (never anon — not on the §2 allowlist).
REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;
