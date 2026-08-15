-- ════════════════════════════════════════════════
-- ROLLBACK: 20260809000000_crm_lead_read_boundary
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the lead and pipeline permissions back exactly as they were before the
--   boundary migration. Everyone who can log in can once again read every
--   lead's notes and call history and move any lead to any stage. That
--   re-opening IS the rollback — it is not a side effect of it.
--
-- WHAT IT RESTORES:
--   - the five LANGUAGE sql / plpgsql bodies byte-for-byte, so re-applying the
--     forward migration afterwards passes its own drift guard;
--   - the three always-true authenticated policies on lead_pipeline_stage,
--     lead_stage_history and pipeline_stages;
--   - the anon table grants those three carried.
--   Then it drops public.crm_lead_access(), which nothing else consumes.
--
-- WHAT IT DELIBERATELY DOES NOT UNDO:
--   The two project_manager rows in nav_permissions. They are a grant the owner
--   asked for — "Lead Center is for admin, office and PM" — not part of the
--   boundary, and silently revoking them would take Lead Center away from the
--   PM as a side effect of rolling back a security change. Remove them by hand
--   if that is genuinely intended:
--     DELETE FROM public.nav_permissions
--      WHERE role = 'project_manager' AND nav_key IN ('crm_leads','crm_call_log');
--
-- SAFETY: run inside one transaction so a partial restore cannot leave three
--   gated RPCs beside two ungated ones.
-- ════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_pipeline_stages(p_org_id uuid DEFAULT NULL::uuid)
RETURNS SETOF pipeline_stages
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT *
  FROM pipeline_stages
  WHERE org_id = COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1))
  ORDER BY sort_order;
$function$;

CREATE OR REPLACE FUNCTION public.move_lead_to_stage(p_lead_id uuid, p_stage_id uuid, p_moved_by uuid DEFAULT NULL::uuid, p_lost_reason text DEFAULT NULL::text)
RETURNS lead_pipeline_stage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  SELECT stage_id INTO v_from FROM lead_pipeline_stage WHERE lead_id = p_lead_id;

  INSERT INTO lead_pipeline_stage (lead_id, org_id, stage_id, moved_by)
  VALUES (p_lead_id, v_org_id, p_stage_id, p_moved_by)
  ON CONFLICT (lead_id) DO UPDATE SET
    stage_id   = EXCLUDED.stage_id,
    moved_by   = EXCLUDED.moved_by,
    updated_at = now()
  RETURNING * INTO v_row;

  IF p_lost_reason IS NOT NULL THEN
    UPDATE inbound_leads SET lost_reason = p_lost_reason, updated_at = now()
    WHERE id = p_lead_id;
  END IF;

  INSERT INTO lead_stage_history (lead_id, org_id, stage_id, from_stage_id, lost_reason, moved_by)
  VALUES (p_lead_id, v_org_id, p_stage_id, v_from, p_lost_reason, p_moved_by);

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_stage_changed', 'inbound_lead', p_lead_id, p_moved_by,
          jsonb_build_object('stage_id', p_stage_id, 'from_stage_id', v_from, 'lost_reason', p_lost_reason));

  RETURN v_row;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.add_lead_note(p_lead_id uuid, p_body text, p_created_by uuid DEFAULT NULL::uuid)
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

REVOKE EXECUTE ON FUNCTION public.get_pipeline_stages(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pipeline_stages(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.move_lead_to_stage(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.move_lead_to_stage(uuid, uuid, uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_lead_activity(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_lead_activity(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_lead_notes(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_lead_notes(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.add_lead_note(uuid, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.add_lead_note(uuid, text, uuid) TO authenticated, service_role;

-- The three always-true policies, back as they were.
DROP POLICY IF EXISTS lead_pipeline_stage_read ON public.lead_pipeline_stage;
CREATE POLICY lead_pipeline_stage_all ON public.lead_pipeline_stage
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pipeline_stages_read ON public.pipeline_stages;
CREATE POLICY pipeline_stages_all ON public.pipeline_stages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY lead_stage_history_all ON public.lead_stage_history
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.lead_pipeline_stage TO anon;
GRANT ALL ON TABLE public.lead_stage_history  TO anon;
GRANT ALL ON TABLE public.pipeline_stages     TO anon;

DROP FUNCTION IF EXISTS public.crm_lead_access();

COMMIT;
