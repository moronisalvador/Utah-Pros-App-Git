-- ════════════════════════════════════════════════
-- MIGRATION: 20260724180000_crm_lead_notes
-- Phase: n/a — standalone owner-directed CRM lead-notes feature
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Today a lead has ONE notes box that gets overwritten every time you save —
--   so you can only ever keep one note, and there's no record of when it was
--   written or who wrote it. Staff run several follow-ups per lead and need a
--   fresh, dated, attributed note for each one. This adds a real notes LOG: a
--   new table that holds many notes per lead, each stamped with the date/time
--   and the employee who added it. It also copies whatever single note each
--   lead already has into the new log so nothing is lost, and makes every note
--   show up as its own entry on the lead's activity timeline.
--
-- ADDITIVE-ONLY:
--   One new table (crm_lead_notes, RLS-enabled at creation, no anon access),
--   two new RPCs (add_lead_note, get_lead_notes), and a one-time additive
--   backfill INSERT that copies existing inbound_leads.notes into the log.
--   Plus a function-body-only CREATE OR REPLACE of the two frozen activity
--   RPCs (get_lead_activity, get_contact_activity) — signatures and RETURNS
--   TABLE shapes UNCHANGED (backward-compat proven by supabase/tests/
--   crm_lead_notes.test.js + the existing crm_lead_activity/crm_contact_activity
--   suites). get_contact_activity is rebuilt from the CURRENT LIVE 23-arm body
--   (captured via pg_get_functiondef 2026-07-24 per database-standard.md §0 —
--   three migrations added arms after 20260721_crm_activity_actor_names, all
--   reproduced verbatim here), NOT the 12-arm ancestor snapshot; the only body
--   changes are the new note arm + the il.notes/fu.notes COALESCE removals. No
--   table DROP/RENAME/ALTER COLUMN, no data mutation of existing rows
--   (inbound_leads.notes is copied, never cleared). The activity bodies stop
--   surfacing il.notes/fu.notes so a backfilled note isn't shown twice (once as
--   the call body, once as its own note row) — a display value change only.
--
--   AUTHORIZATION NOTE: add_lead_note / get_lead_notes GRANT to
--   authenticated + service_role (never anon) and do not add a per-lead
--   caller-authorization predicate beyond that. This is the deliberate,
--   documented "authenticated == active internal employee" equivalence used by
--   every sibling CRM RPC (upsert_crm_task, move_lead_to_stage, get_*_activity)
--   — CRM lead data is company-wide-staff-visible by design. Not a new gap; if
--   the project later tightens this class, it tightens the whole family at once.
--
-- ════════════════════════════════════════════════
-- ROLLBACK (run IN THIS ORDER — the activity functions reference crm_lead_notes
-- via their new note arm, so the table cannot be dropped until they are restored
-- to a body that no longer references it, or Postgres raises a pg_depend error):
--   1. CREATE OR REPLACE public.get_lead_activity(uuid) with its exact
--      pre-migration 4-arm body — verbatim from
--      20260721_crm_activity_actor_names.sql lines 35-103 (lead/task/stage_change/
--      follow_up_call, COALESCE(transcription, notes), NO crm_lead_notes arm).
--   2. CREATE OR REPLACE public.get_contact_activity(uuid) with its exact
--      pre-migration 23-arm body — verbatim from
--      20260721_crm_contact_activity_send_events.sql lines 341-711 (through
--      estimate_sent, COALESCE(transcription, notes), NO crm_lead_notes arm).
--      Do NOT restore the 12-arm ancestor — that would itself drop 11 shipped arms.
--   3. DROP FUNCTION public.add_lead_note(uuid, text, uuid);
--   4. DROP FUNCTION public.get_lead_notes(uuid);
--   5. DROP TABLE public.crm_lead_notes;   -- backfilled copies live only here;
--         the originals remain untouched in inbound_leads.notes, so no data is lost.
-- ════════════════════════════════════════════════

-- ─── 1. crm_lead_notes — append-only, one row per note ───────────────────────
-- Access is RPC-only (add_lead_note / get_lead_notes, both SECURITY DEFINER),
-- so the table itself grants nothing to browser roles: RLS is enabled with no
-- permissive policy, denying every direct PostgREST read/write. org_id is
-- carried from day one (resolved from the lead), same seam as the sibling CRM
-- tables. contact_id is a convenience denormalization (resolved from the lead
-- at insert time when the lead is already linked) — the note is anchored to the
-- lead; contact_id only helps the contact-level timeline surface it directly.
CREATE TABLE IF NOT EXISTS crm_lead_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES inbound_leads(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES crm_orgs(id),
  contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  body        text NOT NULL,
  created_by  uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_notes_lead ON crm_lead_notes(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_lead_notes_contact ON crm_lead_notes(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_lead_notes_org ON crm_lead_notes(org_id);

ALTER TABLE crm_lead_notes ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: browser roles reach this table only through the two
-- SECURITY DEFINER RPCs below (which run as the owner and bypass RLS). RLS with
-- zero permissive policies IS the enforcement layer; the explicit REVOKE (incl.
-- authenticated) is belt-and-suspenders against the managed-Supabase
-- re-grant-to-PUBLIC trap and the "explicit revoke, never implicit" posture.
REVOKE ALL ON TABLE crm_lead_notes FROM PUBLIC, anon, authenticated;

-- ─── 2. Backfill — copy each lead's single existing note into the log ────────
-- One-time additive INSERT. created_by is unknown for these historical notes
-- (the old direct-update path never recorded an actor), so it's left NULL and
-- the UI shows no author for them. The source inbound_leads.notes value is
-- copied, NOT cleared — the column stays as-is (rollback-safe).
INSERT INTO crm_lead_notes (lead_id, org_id, contact_id, body, created_by, created_at)
SELECT il.id, il.org_id, il.contact_id, btrim(il.notes), NULL,
       COALESCE(il.updated_at, il.occurred_at, il.created_at, now())
FROM inbound_leads il
WHERE il.notes IS NOT NULL
  AND btrim(il.notes) <> ''
  AND NOT EXISTS (SELECT 1 FROM crm_lead_notes ln WHERE ln.lead_id = il.id);

-- ─── 3. add_lead_note(...) — the append-a-note write RPC ─────────────────────
-- Anchored to the lead; resolves org_id + contact_id from the lead so the
-- caller never supplies (or can spoof) them. Returns the inserted note as json
-- already carrying author_name, so the panel can prepend it without a refetch.
CREATE OR REPLACE FUNCTION public.add_lead_note(
  p_lead_id    uuid,
  p_body       text,
  p_created_by uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id     uuid;
  v_contact_id uuid;
  v_row        crm_lead_notes;
BEGIN
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'note body is required';
  END IF;

  SELECT org_id, contact_id INTO v_org_id, v_contact_id
  FROM inbound_leads WHERE id = p_lead_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  INSERT INTO crm_lead_notes (lead_id, org_id, contact_id, body, created_by)
  VALUES (p_lead_id, v_org_id, v_contact_id, btrim(p_body), p_created_by)
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'id', v_row.id,
    'lead_id', v_row.lead_id,
    'body', v_row.body,
    'created_at', v_row.created_at,
    'created_by', v_row.created_by,
    'author_name', (SELECT COALESCE(e.display_name, e.full_name) FROM employees e WHERE e.id = v_row.created_by)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.add_lead_note(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_lead_note(uuid, text, uuid) TO authenticated, service_role;

-- ─── 4. get_lead_notes(...) — the notes list read RPC (newest first) ─────────
CREATE OR REPLACE FUNCTION public.get_lead_notes(p_lead_id uuid)
RETURNS SETOF json
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', ln.id,
    'lead_id', ln.lead_id,
    'body', ln.body,
    'created_at', ln.created_at,
    'created_by', ln.created_by,
    'author_name', COALESCE(e.display_name, e.full_name)
  )
  FROM crm_lead_notes ln
  LEFT JOIN employees e ON e.id = ln.created_by
  WHERE ln.lead_id = p_lead_id
     OR ln.lead_id IN (SELECT id FROM inbound_leads WHERE merged_into_lead_id = p_lead_id)
  ORDER BY ln.created_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_lead_notes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_notes(uuid) TO authenticated, service_role;

-- ─── 5. get_lead_activity — body-only replace: add a note arm ────────────────
-- Same signature + RETURNS TABLE shape as 20260721_crm_activity_actor_names.
-- Change: the lead/follow-up bodies no longer COALESCE in il.notes/fu.notes
-- (those notes now live in crm_lead_notes and render as their own 'note' rows),
-- and a new 'note' arm surfaces every crm_lead_notes row (with author_name).
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
    il.transcription,
    jsonb_build_object(
      'source_type', il.source_type, 'duration_sec', il.duration_sec,
      'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
      'recording_url', il.recording_url, 'transcript_analysis', il.transcript_analysis
    )
  FROM inbound_leads il
  WHERE il.id = p_lead_id

  UNION ALL

  SELECT
    'note'::text,
    ln.created_at,
    'Note'::text,
    ln.body,
    jsonb_build_object('note_id', ln.id, 'author_name', COALESCE(en.display_name, en.full_name))
  FROM crm_lead_notes ln
  LEFT JOIN employees en ON en.id = ln.created_by
  WHERE ln.lead_id = p_lead_id
     OR ln.lead_id IN (SELECT id FROM inbound_leads WHERE merged_into_lead_id = p_lead_id)

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
    fu.transcription,
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

-- ─── 6. get_contact_activity — body-only replace: add a lead-note arm ────────
-- Same signature + RETURNS TABLE shape. Built on the CURRENT LIVE body (23 arms,
-- captured via pg_get_functiondef on 2026-07-24 — three migrations after
-- 20260721_crm_activity_actor_names added claim / phase_change / payment /
-- document / contact_owner_set / contact_lifecycle_set / work_auth_sent /
-- work_auth_signed / scope_sheet / invoice_sent / estimate_sent). ALL of those
-- arms are reproduced verbatim here. The ONLY changes: (a) a new 'note' arm
-- surfacing this contact's lead notes from crm_lead_notes (rendered identically
-- to the existing job_notes 'note' arm), and (b) the lead/follow-up bodies drop
-- il.notes/fu.notes from their COALESCE so a backfilled note isn't shown twice.
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
    il.transcription,
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

  -- NEW: this contact's lead notes (crm_lead_notes), by direct contact_id or via any of its leads.
  SELECT
    'note'::text,
    ln.created_at,
    'Note'::text,
    ln.body,
    jsonb_build_object('note_id', ln.id, 'author_name', COALESCE(eln.display_name, eln.full_name))
  FROM crm_lead_notes ln
  LEFT JOIN employees eln ON eln.id = ln.created_by
  WHERE ln.contact_id = p_contact_id
     OR ln.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)

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
    fu.transcription,
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

REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;

-- ─── 7. Bust the PostgREST schema cache ──────────────────────────────────────
NOTIFY pgrst, 'reload schema';
