-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 7 — task RPC bodies (function-body-only fills of Foundation stubs)
--
-- Fills the five signature-frozen Phase 7 stubs from
-- supabase/migrations/20260702_crm_phase0F_rpc_stubs.sql:
--   get_crm_tasks, upsert_crm_task, set_task_status, delete_crm_task,
--   get_overdue_tasks
--
-- SIGNATURES ARE UNCHANGED (migration-safety-checker enforces). No schema
-- change: crm_tasks + its RLS/policy were created by Phase F. GRANTs re-issued
-- for completeness (no-op if already granted).
--
-- One shared Supabase — these are live in dev + main on apply, but every caller
-- (CrmTasks, OverdueTasksWidget) is behind the page:crm feature flag.
--
-- OVERDUE PREDICATE: a task is overdue when the Mountain-Time calendar date of
-- due_at is strictly before the MT date of p_now — the SQL mirror of
-- functions/lib/date-mt.js's isStale(due, now, 1). UTC storage, MT day boundary.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ get_crm_tasks — filtered task list, newest-actionable first ═══
CREATE OR REPLACE FUNCTION get_crm_tasks(
  p_assignee uuid DEFAULT NULL, p_status text DEFAULT NULL, p_contact_id uuid DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT json_build_object(
    'id', t.id,
    'title', t.title,
    'notes', t.notes,
    'due_at', t.due_at,
    'remind_at', t.remind_at,
    'status', t.status,
    'assignee_id', t.assignee_id,
    'assignee_name', e.full_name,
    'contact_id', t.contact_id,
    'contact_name', c.name,
    'lead_id', t.lead_id,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'completed_at', t.completed_at
  )
  FROM crm_tasks t
  LEFT JOIN employees e ON e.id = t.assignee_id
  LEFT JOIN contacts  c ON c.id = t.contact_id
  WHERE (p_org_id     IS NULL OR t.org_id      = p_org_id)
    AND (p_assignee   IS NULL OR t.assignee_id = p_assignee)
    AND (p_status     IS NULL OR t.status      = p_status)
    AND (p_contact_id IS NULL OR t.contact_id  = p_contact_id)
    AND (p_lead_id    IS NULL OR t.lead_id     = p_lead_id)
  ORDER BY (t.status <> 'open') ASC, t.due_at ASC NULLS LAST, t.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_crm_tasks(uuid, text, uuid, uuid, uuid) TO anon, authenticated;

-- ═══ upsert_crm_task — create (p_id NULL) or edit (p_id set) ═══
-- On EDIT this replaces every editable field with the passed value (so the
-- caller must send the full current form state — the CrmTasks editor does).
CREATE OR REPLACE FUNCTION upsert_crm_task(
  p_id uuid DEFAULT NULL, p_title text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL, p_remind_at timestamptz DEFAULT NULL, p_assignee_id uuid DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS crm_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_title text := nullif(btrim(p_title), '');
  v_row   crm_tasks;
BEGIN
  IF p_id IS NULL THEN
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'a task title is required';
    END IF;
    v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

    INSERT INTO crm_tasks (org_id, title, notes, due_at, remind_at, assignee_id, contact_id, lead_id, created_by)
    VALUES (v_org, v_title, p_notes, p_due_at, p_remind_at, p_assignee_id, p_contact_id, p_lead_id, p_created_by)
    RETURNING * INTO v_row;

    INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
    VALUES ('crm_task_created', 'crm_task', v_row.id, p_created_by,
            jsonb_build_object('title', v_row.title, 'due_at', v_row.due_at, 'assignee_id', v_row.assignee_id));
  ELSE
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'a task title is required';
    END IF;

    UPDATE crm_tasks SET
      title       = v_title,
      notes       = p_notes,
      due_at      = p_due_at,
      remind_at   = p_remind_at,
      assignee_id = p_assignee_id,
      contact_id  = p_contact_id,
      lead_id     = p_lead_id,
      updated_at  = now()
    WHERE id = p_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'unknown crm_tasks id: %', p_id;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_crm_task(uuid, text, text, timestamptz, timestamptz, uuid, uuid, uuid, uuid, uuid) TO anon, authenticated;

-- ═══ set_task_status — complete / reopen ═══
CREATE OR REPLACE FUNCTION set_task_status(p_task_id uuid, p_status text, p_actor_id uuid DEFAULT NULL)
RETURNS crm_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text := lower(btrim(p_status));
  v_row    crm_tasks;
BEGIN
  -- crm_tasks.status CHECK allows only 'open' | 'done' (Phase F schema).
  IF v_status NOT IN ('open', 'done') THEN
    RAISE EXCEPTION 'invalid task status: % (expected open or done)', p_status;
  END IF;

  UPDATE crm_tasks SET
    status       = v_status,
    completed_at = CASE WHEN v_status = 'done' THEN now() ELSE NULL END,
    updated_at   = now()
  WHERE id = p_task_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'unknown crm_tasks id: %', p_task_id;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_task_status_changed', 'crm_task', v_row.id, p_actor_id,
          jsonb_build_object('status', v_status));

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION set_task_status(uuid, text, uuid) TO anon, authenticated;

-- ═══ delete_crm_task ═══
CREATE OR REPLACE FUNCTION delete_crm_task(p_task_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM crm_tasks WHERE id = p_task_id;
END;
$$;
GRANT EXECUTE ON FUNCTION delete_crm_task(uuid) TO anon, authenticated;

-- ═══ get_overdue_tasks — open tasks past their MT due day ═══
CREATE OR REPLACE FUNCTION get_overdue_tasks(
  p_assignee uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT json_build_object(
    'id', t.id,
    'title', t.title,
    'notes', t.notes,
    'due_at', t.due_at,
    'remind_at', t.remind_at,
    'status', t.status,
    'assignee_id', t.assignee_id,
    'assignee_name', e.full_name,
    'contact_id', t.contact_id,
    'contact_name', c.name,
    'lead_id', t.lead_id,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'completed_at', t.completed_at
  )
  FROM crm_tasks t
  LEFT JOIN employees e ON e.id = t.assignee_id
  LEFT JOIN contacts  c ON c.id = t.contact_id
  WHERE t.status = 'open'
    AND t.due_at IS NOT NULL
    -- MT day boundary: overdue only once the due DATE is a prior Denver day.
    AND (t.due_at AT TIME ZONE 'America/Denver')::date < (p_now AT TIME ZONE 'America/Denver')::date
    AND (p_org_id   IS NULL OR t.org_id      = p_org_id)
    AND (p_assignee IS NULL OR t.assignee_id = p_assignee)
  ORDER BY t.due_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_overdue_tasks(uuid, uuid, timestamptz) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
