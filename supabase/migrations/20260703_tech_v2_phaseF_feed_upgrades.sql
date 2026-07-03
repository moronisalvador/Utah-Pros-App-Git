-- ════════════════════════════════════════════════
-- MIGRATION: 20260703_tech_v2_phaseF_feed_upgrades
-- ════════════════════════════════════════════════
-- Tech Mobile v2 — Phase F (Foundation).
--
-- WHAT THIS DOES (plain language):
--   Upgrades the two tech appointment feeds so the v2 calendar/dashboard can
--   render color, event kind, multi-day span, milestone markers, crew avatars,
--   and per-appointment task progress — WITHOUT breaking the shape older screens
--   already read. Every legacy jsonb key is preserved verbatim; the change is
--   purely ADDITIVE keys (Architecture decision #5). It also gives the "today"
--   feed a p_include_cancelled switch (default true = old behavior) so v2 can ask
--   to hide cancelled visits.
--
-- BACKWARD-COMPAT CONTRACT (committed tests: supabase/tests/tech_v2_feed_upgrades.test.js):
--   * get_appointments_range — same signature (date, date); body-only replace.
--     Consumers: legacy TechSchedule.jsx, TechEditAppointment.jsx.
--   * get_my_appointments_today — gains p_include_cancelled boolean DEFAULT true.
--     Adding a defaulted param requires DROP + CREATE (a bare CREATE OR REPLACE
--     with a new arg list would leave the old 1-arg overload in place and make a
--     1-arg call ambiguous). Done atomically in this migration; the 1-arg call
--     legacy TechDash.jsx makes still resolves (default fills the 2nd arg).
-- ════════════════════════════════════════════════

-- ─────────────────────────────────────────── get_appointments_range (body-only)
CREATE OR REPLACE FUNCTION public.get_appointments_range(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth', 'pg_temp'
AS $function$
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
      -- v2 additive keys ↓
      'color', a.color,
      'kind', a.kind,
      'duration_days', a.duration_days,
      'is_milestone', a.is_milestone,
      'task_total', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id),
      'task_completed', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id AND jt.is_completed = true),
      -- legacy keys ↓
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
            'role', e.role,
            'color', e.color,            -- v2 additive
            'avatar_url', e.avatar_url    -- v2 additive
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
$function$;

-- ─────────────────────────────────────────── get_my_appointments_today (+ param)
-- Drop the 1-arg overload first so the new defaulted 2-arg version is the sole
-- resolution target (avoids "function is not unique" on a 1-arg call).
DROP FUNCTION IF EXISTS public.get_my_appointments_today(uuid);

CREATE OR REPLACE FUNCTION public.get_my_appointments_today(p_employee_id uuid, p_include_cancelled boolean DEFAULT true)
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
      -- v2 additive keys ↓
      'color', a.color,
      'kind', a.kind,
      'duration_days', a.duration_days,
      'is_milestone', a.is_milestone,
      'task_total', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id),
      'task_completed', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id AND jt.is_completed = true),
      -- legacy keys ↓
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
            'full_name', e2.full_name,
            'color', e2.color,            -- v2 additive
            'avatar_url', e2.avatar_url    -- v2 additive
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
      AND (p_include_cancelled OR a.status <> 'cancelled')
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_appointments_today(uuid, boolean) TO anon, authenticated;
