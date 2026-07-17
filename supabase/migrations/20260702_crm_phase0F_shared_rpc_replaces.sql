-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase F — the two shared live-RPC REPLACEs (done once, here only)
--
-- RENAMED 2026-07-17 (phaseF → phase0F): filename-sort landmine fix, content
-- unchanged — see 20260702_crm_phase0F_rpc_stubs.sql's header for why.
--
-- docs/crm-roadmap.md, "Phase F — Foundation": these are the ONLY two live
-- RPCs the wave touches. Both are backward-compatible so every shipped caller
-- keeps working; downstream wave sessions must NOT re-REPLACE them.
--
-- 1) move_lead_to_stage — gains p_lost_reason (DEFAULT NULL) and now writes an
--    append-only lead_stage_history row on every move (the current-stage-only
--    lead_pipeline_stage keeps no history). CREATE OR REPLACE can't add a
--    parameter, so the 3-arg version is dropped and replaced by a 4-arg one
--    whose extra params default — the shipped Phase-4a caller
--    db.rpc('move_lead_to_stage',{p_lead_id,p_stage_id,p_moved_by}) still
--    resolves and succeeds (proved by crm_shared_rpc_compat.test.js).
--
-- 2) get_contact_activity — gains email / jobs / tasks arms. Same 1-arg
--    signature and same output columns (activity_type, occurred_at, title,
--    body, meta) — purely additive rows in the union, so the shipped Leads
--    timeline renders unchanged (proved by the same compat test).
--
-- ADDITIVE: no table touched. One shared Supabase — live in dev + main on apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. move_lead_to_stage (+ p_lost_reason, + lead_stage_history) ═══
DROP FUNCTION IF EXISTS move_lead_to_stage(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION move_lead_to_stage(
  p_lead_id     uuid,
  p_stage_id    uuid,
  p_moved_by    uuid DEFAULT NULL,
  p_lost_reason text DEFAULT NULL
)
RETURNS lead_pipeline_stage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   uuid;
  v_from     uuid;
  v_row      lead_pipeline_stage;
BEGIN
  SELECT org_id INTO v_org_id FROM inbound_leads WHERE id = p_lead_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE id = p_stage_id) THEN
    RAISE EXCEPTION 'unknown pipeline_stages id: %', p_stage_id;
  END IF;

  -- Capture the stage the lead is leaving (NULL if it was never placed).
  SELECT stage_id INTO v_from FROM lead_pipeline_stage WHERE lead_id = p_lead_id;

  INSERT INTO lead_pipeline_stage (lead_id, org_id, stage_id, moved_by)
  VALUES (p_lead_id, v_org_id, p_stage_id, p_moved_by)
  ON CONFLICT (lead_id) DO UPDATE SET
    stage_id   = EXCLUDED.stage_id,
    moved_by   = EXCLUDED.moved_by,
    updated_at = now()
  RETURNING * INTO v_row;

  -- Persist the win/loss reason on the lead when one is supplied (Phase 7's
  -- required-on-lost prompt) — left untouched otherwise.
  IF p_lost_reason IS NOT NULL THEN
    UPDATE inbound_leads SET lost_reason = p_lost_reason, updated_at = now()
    WHERE id = p_lead_id;
  END IF;

  -- Append-only history — one row per move (backs pipeline-movement /
  -- speed-to-lead reports, which accrue from this replace onward).
  INSERT INTO lead_stage_history (lead_id, org_id, stage_id, from_stage_id, lost_reason, moved_by)
  VALUES (p_lead_id, v_org_id, p_stage_id, v_from, p_lost_reason, p_moved_by);

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_stage_changed', 'inbound_lead', p_lead_id, p_moved_by,
          jsonb_build_object('stage_id', p_stage_id, 'from_stage_id', v_from, 'lost_reason', p_lost_reason));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION move_lead_to_stage(uuid, uuid, uuid, text) TO anon, authenticated;

-- ═══ 2. get_contact_activity (+ email / jobs / tasks arms) ═══
CREATE OR REPLACE FUNCTION get_contact_activity(p_contact_id uuid)
RETURNS TABLE(
  activity_type text,
  occurred_at    timestamptz,
  title          text,
  body           text,
  meta           jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    'lead'::text,
    COALESCE(il.occurred_at, il.created_at),
    CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END,
    COALESCE(il.transcription, il.notes),
    jsonb_build_object(
      'source_type', il.source_type, 'duration_sec', il.duration_sec,
      'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
      'recording_url', il.recording_url
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

  -- ── Phase F additive arms ──

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
$$;

GRANT EXECUTE ON FUNCTION get_contact_activity(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
