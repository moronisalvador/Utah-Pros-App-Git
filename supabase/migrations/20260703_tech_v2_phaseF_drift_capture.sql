-- ════════════════════════════════════════════════
-- MIGRATION: 20260703_tech_v2_phaseF_drift_capture
-- ════════════════════════════════════════════════
-- Tech Mobile v2 — Phase F (Foundation).
--
-- WHAT THIS DOES (plain language):
--   Captures 13 tech RPCs that exist LIVE in production but had ZERO migration
--   coverage (schema-drift finding #4 in docs/tech-v2-roadmap.md). Every function
--   below is dumped VERBATIM from the live database via pg_get_functiondef — this
--   is a NO-BEHAVIOR-CHANGE migration whose sole purpose is to make migrations the
--   source of truth again before the v2 wave touches the data layer. Nothing here
--   changes what any function does; re-applying it is a no-op.
--
-- PROVENANCE: dumped 2026-07-03 from project glsmljpabrwonfiltiqm, schema public.
-- Precedent: CRM-v3 merge_contacts drift-capture.
-- ════════════════════════════════════════════════

-- 1 ─────────────────────────────────────────────── get_my_appointments_today
CREATE OR REPLACE FUNCTION public.get_my_appointments_today(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  today date := CURRENT_DATE;
BEGIN
  SELECT jsonb_agg(row_data ORDER BY (row_data->>'time_start'))
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'job_id', a.job_id,
      'title', a.title,
      'date', a.date,
      'time_start', a.time_start,
      'time_end', a.time_end,
      'type', a.type,
      'status', a.status,
      'notes', a.notes,
      'jobs', CASE WHEN j.id IS NOT NULL THEN jsonb_build_object(
        'id', j.id,
        'job_number', j.job_number,
        'insured_name', j.insured_name,
        'address', j.address,
        'city', j.city,
        'division', j.division,
        'phase', j.phase,
        'client_phone', j.client_phone
      ) ELSE NULL END,
      'appointment_crew', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ac2.id,
          'employee_id', ac2.employee_id,
          'role', ac2.role,
          'employees', jsonb_build_object(
            'id', e2.id,
            'display_name', e2.display_name,
            'full_name', e2.full_name
          )
        ))
        FROM appointment_crew ac2
        JOIN employees e2 ON e2.id = ac2.employee_id
        WHERE ac2.appointment_id = a.id
      ), '[]'::jsonb)
    ) as row_data
    FROM appointments a
    JOIN appointment_crew ac ON ac.appointment_id = a.id AND ac.employee_id = p_employee_id
    LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.date = today
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;

-- 2 ─────────────────────────────────────────────── get_active_appointment_geo
CREATE OR REPLACE FUNCTION public.get_active_appointment_geo(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'appointment_id', a.id,
    'job_id',         j.id,
    'status',         a.status,
    'title',          a.title,
    'address',        COALESCE(j.address, ''),
    'city',           COALESCE(j.city, ''),
    'clock_in_at',    e.clock_in,
    'clock_in_lat',   e.clock_in_lat,
    'clock_in_lng',   e.clock_in_lng
  )
  INTO v_result
  FROM appointments a
  JOIN appointment_crew c ON c.appointment_id = a.id
  LEFT JOIN jobs j ON j.id = a.job_id
  LEFT JOIN LATERAL (
    SELECT clock_in, clock_in_lat, clock_in_lng
    FROM job_time_entries te
    WHERE te.appointment_id = a.id AND te.employee_id = p_employee_id
    ORDER BY te.created_at DESC
    LIMIT 1
  ) e ON TRUE
  WHERE c.employee_id = p_employee_id
    AND a.status IN ('in_progress', 'paused')
  ORDER BY a.status = 'in_progress' DESC, a.date DESC, a.time_start DESC NULLS LAST
  LIMIT 1;

  RETURN v_result;  -- NULL if no match
END;
$function$;

-- 3 ─────────────────────────────────────────────── get_appointment_tasks
CREATE OR REPLACE FUNCTION public.get_appointment_tasks(p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', jt.id, 'title', jt.title, 'description', jt.description,
    'is_required', jt.is_required, 'is_completed', jt.is_completed,
    'completed_by', jt.completed_by, 'completed_at', jt.completed_at,
    'display_order', jt.display_order, 'template_task_id', jt.template_task_id,
    'completed_by_name', e.display_name
  ) ORDER BY jt.display_order), '[]'::jsonb) INTO result
  FROM job_tasks jt
  LEFT JOIN employees e ON e.id = jt.completed_by
  WHERE jt.appointment_id = p_appointment_id;
  RETURN result;
END; $function$;

-- 4 ─────────────────────────────────────────────── get_assigned_tasks
CREATE OR REPLACE FUNCTION public.get_assigned_tasks(p_employee_id uuid)
 RETURNS TABLE(task_id uuid, task_name text, is_complete boolean, sort_order integer, phase_name text, appointment_id uuid, appointment_date date, appointment_time text, is_today boolean, job_id uuid, job_number text, insured_name text, division text, job_phase text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    jt.id                                              AS task_id,
    jt.title                                           AS task_name,
    COALESCE(jt.is_completed, FALSE)                   AS is_complete,
    COALESCE(jt.display_order, 0)                      AS sort_order,
    jt.phase_name,
    jt.appointment_id,
    a.date                                             AS appointment_date,
    a.time_start::TEXT                                 AS appointment_time,
    (a.date = CURRENT_DATE)                            AS is_today,
    j.id                                               AS job_id,
    j.job_number,
    c.name                                             AS insured_name,
    j.division::TEXT,
    j.phase                                            AS job_phase
  FROM job_tasks jt
  JOIN appointments a        ON a.id = jt.appointment_id
  JOIN appointment_crew acr  ON acr.appointment_id = a.id
                             AND acr.employee_id = p_employee_id
  JOIN jobs j                ON j.id = jt.job_id
  LEFT JOIN contacts c       ON c.id = j.primary_contact_id
  WHERE COALESCE(jt.is_completed, FALSE) = FALSE
    AND a.status NOT IN ('cancelled', 'completed')
  ORDER BY
    (a.date = CURRENT_DATE) DESC,
    a.date ASC,
    a.time_start ASC,
    jt.display_order ASC;
END;
$function$;

-- 5 ─────────────────────────────────────────────── toggle_appointment_task
CREATE OR REPLACE FUNCTION public.toggle_appointment_task(p_task_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_current boolean;
  result jsonb;
BEGIN
  SELECT is_completed INTO v_current FROM job_tasks WHERE id = p_task_id;

  IF v_current THEN
    UPDATE job_tasks SET is_completed = false, completed_by = NULL, completed_at = NULL
    WHERE id = p_task_id;
  ELSE
    UPDATE job_tasks SET is_completed = true, completed_by = p_employee_id, completed_at = now()
    WHERE id = p_task_id;
  END IF;

  SELECT jsonb_build_object(
    'id', jt.id, 'is_completed', jt.is_completed,
    'completed_by', jt.completed_by, 'completed_at', jt.completed_at,
    'completed_by_name', e.display_name
  ) INTO result
  FROM job_tasks jt
  LEFT JOIN employees e ON e.id = jt.completed_by
  WHERE jt.id = p_task_id;

  RETURN result;
END;
$function$;

-- 6 ─────────────────────────────────────────────── update_appointment
CREATE OR REPLACE FUNCTION public.update_appointment(p_appointment_id uuid, p_date date DEFAULT NULL::date, p_time_start time without time zone DEFAULT NULL::time without time zone, p_time_end time without time zone DEFAULT NULL::time without time zone, p_title text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE appointments SET
    date = COALESCE(p_date, date),
    time_start = COALESCE(p_time_start, time_start),
    time_end = COALESCE(p_time_end, time_end),
    title = COALESCE(p_title, title),
    type = COALESCE(p_type::appointment_type, type),
    status = COALESCE(p_status::appointment_status, status),
    notes = COALESCE(p_notes, notes)
  WHERE id = p_appointment_id
  RETURNING jsonb_build_object(
    'id', id, 'date', date, 'time_start', time_start, 'time_end', time_end,
    'title', title, 'status', status
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Appointment not found';
  END IF;

  RETURN v_result;
END;
$function$;

-- 7 ─────────────────────────────────────────────── delete_appointment
CREATE OR REPLACE FUNCTION public.delete_appointment(p_appointment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Unassign all tasks from this appointment
  UPDATE job_tasks SET appointment_id = NULL WHERE appointment_id = p_appointment_id;
  -- Delete crew assignments
  DELETE FROM appointment_crew WHERE appointment_id = p_appointment_id;
  -- Delete the appointment
  DELETE FROM appointments WHERE id = p_appointment_id;
END;
$function$;

-- 8 ─────────────────────────────────────────────── assign_tasks_to_appointment
CREATE OR REPLACE FUNCTION public.assign_tasks_to_appointment(p_appointment_id uuid, p_task_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Unassign any tasks currently on this appointment that aren't in the new list
  UPDATE job_tasks
  SET appointment_id = NULL
  WHERE appointment_id = p_appointment_id
    AND NOT (id = ANY(p_task_ids))
    AND is_completed = false;

  -- Assign the selected tasks
  UPDATE job_tasks
  SET appointment_id = p_appointment_id
  WHERE id = ANY(p_task_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'appointment_id', p_appointment_id,
    'tasks_assigned', v_count
  );
END;
$function$;

-- 9 ─────────────────────────────────────────────── get_unassigned_tasks
CREATE OR REPLACE FUNCTION public.get_unassigned_tasks(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(phase_group ORDER BY phase_group->>'phase_name'), '[]'::jsonb)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'phase_name', jt.phase_name,
      'phase_color', jt.phase_color,
      'tasks', jsonb_agg(
        jsonb_build_object(
          'id', jt.id,
          'title', jt.title,
          'description', jt.description,
          'is_required', jt.is_required,
          'display_order', jt.display_order
        ) ORDER BY jt.display_order
      )
    ) as phase_group
    FROM job_tasks jt
    WHERE jt.job_id = p_job_id
      AND jt.appointment_id IS NULL
      AND jt.is_completed = false
    GROUP BY jt.phase_name, jt.phase_color
  ) sub;

  RETURN result;
END;
$function$;

-- 10 ────────────────────────────────────────────── add_adhoc_job_task
CREATE OR REPLACE FUNCTION public.add_adhoc_job_task(p_job_id uuid, p_title text, p_phase_name text, p_phase_color text DEFAULT '#6b7280'::text, p_appointment_id uuid DEFAULT NULL::uuid, p_target_date date DEFAULT NULL::date, p_job_schedule_phase_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id UUID;
  v_jsp_id UUID;
BEGIN
  -- Auto-lookup job_schedule_phase_id if not provided
  v_jsp_id := p_job_schedule_phase_id;
  IF v_jsp_id IS NULL THEN
    SELECT jsp.id INTO v_jsp_id
    FROM job_schedule_phases jsp
    JOIN job_schedules js ON js.id = jsp.job_schedule_id
    WHERE js.job_id = p_job_id AND jsp.phase_name = p_phase_name
    LIMIT 1;
  END IF;

  INSERT INTO job_tasks (job_id, title, phase_name, phase_color, appointment_id, target_date, job_schedule_phase_id)
  VALUES (p_job_id, p_title, p_phase_name, p_phase_color, p_appointment_id, p_target_date, v_jsp_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- 11 ────────────────────────────────────────────── get_job_task_summary
CREATE OR REPLACE FUNCTION public.get_job_task_summary(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', count(*),
    'assigned', count(*) FILTER (WHERE appointment_id IS NOT NULL),
    'unassigned', count(*) FILTER (WHERE appointment_id IS NULL),
    'completed', count(*) FILTER (WHERE is_completed),
    'required_total', count(*) FILTER (WHERE is_required),
    'required_completed', count(*) FILTER (WHERE is_required AND is_completed),
    'by_phase', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'phase_name', sub.phase_name,
        'phase_color', sub.phase_color,
        'total', sub.total,
        'completed', sub.completed,
        'assigned', sub.assigned
      ) ORDER BY sub.phase_name), '[]'::jsonb)
      FROM (
        SELECT phase_name, phase_color,
          count(*) as total,
          count(*) FILTER (WHERE is_completed) as completed,
          count(*) FILTER (WHERE appointment_id IS NOT NULL) as assigned
        FROM job_tasks WHERE job_id = p_job_id
        GROUP BY phase_name, phase_color
      ) sub
    )
  ) INTO result
  FROM job_tasks WHERE job_id = p_job_id;

  RETURN result;
END;
$function$;

-- 12 ────────────────────────────────────────────── get_active_techs
CREATE OR REPLACE FUNCTION public.get_active_techs()
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, COALESCE(display_name, full_name) AS name
  FROM employees
  WHERE is_active = true
    AND role::text IN ('field_tech','supervisor','project_manager','admin')
  ORDER BY 2;
$function$;

-- 13 ────────────────────────────────────────────── get_claim_appointments
CREATE OR REPLACE FUNCTION public.get_claim_appointments(p_claim_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'date' DESC, row_data->>'time_start' DESC NULLS LAST), '[]'::jsonb)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'job_id', a.job_id,
      'job_number', j.job_number,
      'division', j.division,
      'title', a.title,
      'date', a.date,
      'time_start', a.time_start,
      'time_end', a.time_end,
      'type', a.type,
      'status', a.status,
      'notes', a.notes,
      'duration_days', a.duration_days,
      'is_milestone', a.is_milestone,
      'color', a.color,
      'crew', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'employee_id', ac.employee_id,
          'full_name', e.full_name,
          'role', ac.role
        ))
        FROM appointment_crew ac
        JOIN employees e ON e.id = ac.employee_id
        WHERE ac.appointment_id = a.id
      ), '[]'::jsonb),
      'task_total', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id),
      'task_completed', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id AND jt.is_completed = true)
    ) AS row_data
    FROM appointments a
    JOIN jobs j ON j.id = a.job_id
    WHERE j.claim_id = p_claim_id
  ) sub;

  RETURN result;
END;
$function$;
