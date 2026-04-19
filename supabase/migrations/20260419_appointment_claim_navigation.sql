-- Extend `get_appointment_detail` and `get_dispatch_board` to include the
-- parent job's `claim_id` so the appointment modal / detail pages can offer
-- a "View claim" shortcut without an extra round-trip.
--
-- Also adds `kind` to get_appointment_detail output so the tech detail page
-- can tell events apart from job appointments.

CREATE OR REPLACE FUNCTION public.get_appointment_detail(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
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
  WHERE a.id = p_appointment_id;

  RETURN result;
END;
$$;


CREATE OR REPLACE FUNCTION public.get_dispatch_board(p_start_date date, p_end_date date, p_auto_show boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  v_active_phases TEXT[] := ARRAY[
    'emergency_response', 'mitigation_in_progress', 'drying', 'monitoring',
    'mold_remediation', 'content_packout', 'content_cleaning', 'content_storage',
    'demo_in_progress', 'reconstruction_in_progress', 'reconstruction_punch_list',
    'supplement_in_progress'
  ];
BEGIN
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
        )
      )
  ) sub;

  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
