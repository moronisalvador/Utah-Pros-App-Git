-- Private appointments & events
--
-- Adds an `is_private` flag to `appointments`. When true, the row is visible
-- only to admins, project_managers, and the assigned crew. Other roles
-- (supervisor, field_tech) see nothing at all — the appointment is simply
-- absent from their calendar RPCs.
--
-- Toggling `is_private = true` is restricted at the DB level to admin /
-- project_manager via a BEFORE trigger, so clients can't circumvent by
-- hitting the REST `appointments` table directly.
--
-- The same filter is applied uniformly across every RPC that reads
-- appointments for "calendar-like" surfaces:
--   get_dispatch_board     — desktop Schedule (jobs)
--   get_dispatch_events    — desktop Schedule (events)
--   get_appointments_range — alternate fetch
--   get_appointment_detail — single-appointment fetch (returns NULL if hidden)
--
-- get_my_appointments_today is unchanged because it already JOINs to
-- appointment_crew, so callers only see their own — private or not.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Column + trigger
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_appointments_is_private
  ON public.appointments (date) WHERE is_private;

CREATE OR REPLACE FUNCTION public.enforce_private_appointment_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_role TEXT;
BEGIN
  -- Only check when the row is (becoming) private. Unsetting private, or
  -- editing a non-private appointment, is unrestricted.
  IF NEW.is_private AND (
       TG_OP = 'INSERT'
    OR COALESCE(OLD.is_private, false) IS DISTINCT FROM NEW.is_private
  ) THEN
    SELECT role INTO v_role
    FROM employees
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    IF v_role IS NULL OR v_role NOT IN ('admin', 'project_manager') THEN
      RAISE EXCEPTION 'Only admins or project managers can mark appointments or events as private';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_private_appointment ON public.appointments;
CREATE TRIGGER trg_enforce_private_appointment
BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_private_appointment_role();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RPC updates — apply a uniform privacy filter
-- ─────────────────────────────────────────────────────────────────────────

-- 2a. get_dispatch_board — adds is_private + filter
CREATE OR REPLACE FUNCTION public.get_dispatch_board(p_start_date date, p_end_date date, p_auto_show boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  v_caller_emp_id UUID;
  v_caller_role TEXT;
  v_active_phases TEXT[] := ARRAY[
    'emergency_response', 'mitigation_in_progress', 'drying', 'monitoring',
    'mold_remediation', 'content_packout', 'content_cleaning', 'content_storage',
    'demo_in_progress', 'reconstruction_in_progress', 'reconstruction_punch_list',
    'supplement_in_progress'
  ];
BEGIN
  SELECT id, role INTO v_caller_emp_id, v_caller_role
  FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT COALESCE(jsonb_agg(job_row ORDER BY job_row->>'insured_name'), '[]'::jsonb)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'job_id', j.id,
      'insured_name', j.insured_name,
      'job_number', j.job_number,
      'division', j.division,
      'address', j.address,
      'phase', j.phase,
      'claim_id', j.claim_id,
      'pinned', EXISTS (SELECT 1 FROM dispatch_board_jobs d WHERE d.job_id = j.id),
      'task_summary', (SELECT get_job_task_summary(j.id)),
      'appointments', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'date', a.date,
            'time_start', a.time_start,
            'time_end', a.time_end,
            'type', a.type,
            'status', a.status,
            'notes', a.notes,
            'duration_days', a.duration_days,
            'color', a.color,
            'is_milestone', a.is_milestone,
            'is_private', a.is_private,
            'crew', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', ac.id,
                'employee_id', ac.employee_id,
                'role', ac.role,
                'display_name', e.display_name,
                'full_name', e.full_name,
                'color', e.color,
                'avatar_url', e.avatar_url
              ))
              FROM appointment_crew ac
              JOIN employees e ON e.id = ac.employee_id
              WHERE ac.appointment_id = a.id
            ), '[]'::jsonb),
            'tasks_total', (SELECT count(*) FROM job_tasks jt WHERE jt.appointment_id = a.id),
            'tasks_done', (SELECT count(*) FROM job_tasks jt WHERE jt.appointment_id = a.id AND jt.is_completed),
            'task_names', COALESCE((
              SELECT jsonb_agg(jt.title ORDER BY jt.created_at)
              FROM job_tasks jt
              WHERE jt.appointment_id = a.id
            ), '[]'::jsonb)
          ) ORDER BY a.date, a.time_start NULLS LAST
        )
        FROM appointments a
        WHERE a.job_id = j.id
          AND a.date >= p_start_date
          AND a.date <= p_end_date
          AND (
            NOT a.is_private
            OR v_caller_role IN ('admin', 'project_manager')
            OR EXISTS (
              SELECT 1 FROM appointment_crew ac
              WHERE ac.appointment_id = a.id AND ac.employee_id = v_caller_emp_id
            )
          )
      ), '[]'::jsonb)
    ) as job_row
    FROM jobs j
    WHERE
      j.phase = ANY(v_active_phases)
      OR EXISTS (SELECT 1 FROM dispatch_board_jobs d WHERE d.job_id = j.id)
      OR (
        p_auto_show AND EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.job_id = j.id
            AND a.date >= p_start_date
            AND a.date <= p_end_date
            AND (
              NOT a.is_private
              OR v_caller_role IN ('admin', 'project_manager')
              OR EXISTS (
                SELECT 1 FROM appointment_crew ac
                WHERE ac.appointment_id = a.id AND ac.employee_id = v_caller_emp_id
              )
            )
        )
      )
  ) sub;

  RETURN result;
END;
$$;

-- 2b. get_dispatch_events — adds is_private + filter
CREATE OR REPLACE FUNCTION public.get_dispatch_events(p_start_date date, p_end_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_emp_id UUID;
  v_caller_role TEXT;
BEGIN
  SELECT id, role INTO v_caller_emp_id, v_caller_role
  FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  RETURN COALESCE(
    (SELECT jsonb_agg(
       jsonb_build_object(
         'id',          a.id,
         'kind',        a.kind,
         'title',       a.title,
         'date',        a.date,
         'time_start',  a.time_start,
         'time_end',    a.time_end,
         'type',        a.type,
         'status',      a.status,
         'notes',       a.notes,
         'color',       a.color,
         'is_private',  a.is_private,
         'crew', COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id',           ac.id,
             'employee_id',  ac.employee_id,
             'role',         ac.role,
             'display_name', e.display_name,
             'full_name',    e.full_name,
             'color',        e.color,
             'avatar_url',   e.avatar_url
           ))
           FROM appointment_crew ac
           JOIN employees e ON e.id = ac.employee_id
           WHERE ac.appointment_id = a.id
         ), '[]'::jsonb)
       ) ORDER BY a.date, a.time_start NULLS LAST
     )
     FROM appointments a
     WHERE a.kind = 'event'
       AND a.date >= p_start_date
       AND a.date <= p_end_date
       AND (
         NOT a.is_private
         OR v_caller_role IN ('admin', 'project_manager')
         OR EXISTS (
           SELECT 1 FROM appointment_crew ac
           WHERE ac.appointment_id = a.id AND ac.employee_id = v_caller_emp_id
         )
       )),
    '[]'::jsonb
  );
END;
$$;

-- 2c. get_appointment_detail — returns NULL when the caller can't see it
CREATE OR REPLACE FUNCTION public.get_appointment_detail(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  v_caller_emp_id UUID;
  v_caller_role TEXT;
BEGIN
  SELECT id, role INTO v_caller_emp_id, v_caller_role
  FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT jsonb_build_object(
    'id', a.id,
    'job_id', a.job_id,
    'kind', a.kind,
    'title', a.title,
    'date', a.date,
    'time_start', a.time_start,
    'time_end', a.time_end,
    'type', a.type,
    'status', a.status,
    'notes', a.notes,
    'is_private', a.is_private,
    'created_by', a.created_by,
    'jobs', CASE WHEN j.id IS NOT NULL THEN jsonb_build_object(
      'id', j.id,
      'job_number', j.job_number,
      'insured_name', j.insured_name,
      'address', j.address,
      'city', j.city,
      'division', j.division,
      'phase', j.phase,
      'client_phone', j.client_phone,
      'claim_id', j.claim_id
    ) ELSE NULL END,
    'appointment_crew', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ac.id,
        'employee_id', ac.employee_id,
        'role', ac.role,
        'employees', jsonb_build_object(
          'id', e.id,
          'display_name', e.display_name,
          'full_name', e.full_name,
          'role', e.role
        )
      ))
      FROM appointment_crew ac
      JOIN employees e ON e.id = ac.employee_id
      WHERE ac.appointment_id = a.id
    ), '[]'::jsonb)
  )
  INTO result
  FROM appointments a
  LEFT JOIN jobs j ON j.id = a.job_id
  WHERE a.id = p_appointment_id
    AND (
      NOT a.is_private
      OR v_caller_role IN ('admin', 'project_manager')
      OR EXISTS (
        SELECT 1 FROM appointment_crew ac
        WHERE ac.appointment_id = a.id AND ac.employee_id = v_caller_emp_id
      )
    );

  RETURN result;
END;
$$;

-- 2d. get_appointments_range — adds filter + is_private in payload
CREATE OR REPLACE FUNCTION public.get_appointments_range(p_start_date date, p_end_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  v_caller_emp_id UUID;
  v_caller_role TEXT;
BEGIN
  SELECT id, role INTO v_caller_emp_id, v_caller_role
  FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT jsonb_agg(row_data ORDER BY (row_data->>'date'), (row_data->>'time_start'))
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
      'is_private', a.is_private,
      'created_by', a.created_by,
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
          'id', ac.id,
          'employee_id', ac.employee_id,
          'role', ac.role,
          'employees', jsonb_build_object(
            'id', e.id,
            'display_name', e.display_name,
            'full_name', e.full_name,
            'role', e.role
          )
        ))
        FROM appointment_crew ac
        JOIN employees e ON e.id = ac.employee_id
        WHERE ac.appointment_id = a.id
      ), '[]'::jsonb)
    ) as row_data
    FROM appointments a
    LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.date BETWEEN p_start_date AND p_end_date
      AND (
        NOT a.is_private
        OR v_caller_role IN ('admin', 'project_manager')
        OR EXISTS (
          SELECT 1 FROM appointment_crew ac
          WHERE ac.appointment_id = a.id AND ac.employee_id = v_caller_emp_id
        )
      )
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
