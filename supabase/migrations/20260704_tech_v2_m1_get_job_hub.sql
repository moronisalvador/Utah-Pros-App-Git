-- ════════════════════════════════════════════════
-- Tech Mobile v2 — Phase M1 (Job Hub)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds one new database function, get_job_hub(job_id), that returns
--   everything the merged "Job Hub" screen needs to frame a job in a single
--   round trip: the full job row, its parent claim (number), whether a signed
--   Work Authorization exists, and the job's appointments (the visit picker).
--
-- WHY A NEW RPC (not a reuse of get_claim_appointments):
--   get_claim_appointments is CLAIM-scoped — a job with no claim (e.g. an
--   out-of-pocket job) returns no appointments. The Job Hub is JOB-rooted and
--   must list a job's visits whether or not the job hangs off a claim, so this
--   function scopes the appointment list by a.job_id directly. The per-row
--   appointment shape is byte-identical to get_claim_appointments so the shared
--   visit-picker/AppointmentCard rendering is unchanged.
--
-- SAFETY (CLAUDE.md Rule 7 / tech-v2 migration rule):
--   - ADDITIVE ONLY: creates one new function; touches no live function, table,
--     column, or policy (no drift-dump needed — nothing live is replaced).
--   - SECURITY DEFINER + GRANT EXECUTE TO anon, authenticated (same pattern as
--     get_claim_appointments / get_tech_dashboard).
--   - Reads only: jobs, claims, sign_requests, appointments, appointment_crew,
--     employees, job_tasks. No writes.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_job_hub(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'job', to_jsonb(j.*),
    'claim', CASE WHEN c.id IS NOT NULL
      THEN jsonb_build_object('id', c.id, 'claim_number', c.claim_number)
      ELSE NULL END,
    'work_auth_signed', EXISTS (
      SELECT 1 FROM sign_requests sr
      WHERE sr.job_id = j.id
        AND sr.doc_type = 'work_auth'
        AND sr.status = 'signed'
    ),
    'appointments', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY row_data->>'date' DESC, row_data->>'time_start' DESC NULLS LAST)
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
        WHERE a.job_id = j.id
      ) sub
    ), '[]'::jsonb)
  )
  INTO result
  FROM jobs j
  LEFT JOIN claims c ON c.id = j.claim_id
  WHERE j.id = p_job_id;

  RETURN result; -- NULL when the job id does not exist
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_job_hub(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
