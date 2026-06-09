-- Employee-scoped stalled materials aggregator. Powers the StalledWidget on
-- TechDash so a tech sees every stalled drying pair across every job they've
-- been on in the last 30 days at a glance.
--
-- Internals: gathers jobs via appointment_crew (last 30 days), then
-- cross-joins with get_stalled_materials(p_job_id) per job.

CREATE OR REPLACE FUNCTION get_stalled_materials_for_employee(p_employee_id UUID)
RETURNS TABLE (
  job_id             UUID,
  job_number         TEXT,
  appointment_id     UUID,
  appointment_date   DATE,
  room_id            UUID,
  room_name          TEXT,
  material           material_type,
  latest_mc          NUMERIC,
  latest_reading_at  TIMESTAMPTZ,
  mc_36h_ago         NUMERIC,
  drying_goal_pct    NUMERIC,
  days_stalled       INT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH emp_jobs AS (
    SELECT DISTINCT a.job_id,
                    (array_agg(a.id ORDER BY a.date DESC))[1] AS latest_appt_id,
                    max(a.date) AS latest_appt_date
      FROM appointments a
      JOIN appointment_crew ac ON ac.appointment_id = a.id
     WHERE ac.employee_id = p_employee_id
       AND a.job_id IS NOT NULL
       AND a.date >= (CURRENT_DATE - interval '30 days')
     GROUP BY a.job_id
  )
  SELECT
    ej.job_id,
    j.job_number,
    ej.latest_appt_id AS appointment_id,
    ej.latest_appt_date AS appointment_date,
    sm.room_id,
    sm.room_name,
    sm.material,
    sm.latest_mc,
    sm.latest_reading_at,
    sm.mc_36h_ago,
    sm.drying_goal_pct,
    sm.days_stalled
  FROM emp_jobs ej
  JOIN jobs j ON j.id = ej.job_id
  CROSS JOIN LATERAL get_stalled_materials(ej.job_id) AS sm
  ORDER BY sm.latest_reading_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stalled_materials_for_employee TO anon, authenticated;

SELECT bust_postgrest_cache();
