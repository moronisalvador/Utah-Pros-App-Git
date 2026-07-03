-- get_tech_status_board: expose raw open-entry timestamps so the UI can show
-- travel time, on-site time, and TOTAL (travel + on-site) live. The timer starts at
-- travel_start (On My Way) — real labor cost — but the single status_since only
-- reflected on-site time, so the Status Board / Employee Status widget were
-- under-reporting. Adds travel_start, clock_in, paused_at, total_paused_minutes to the
-- output; the client computes travel/on-site/total (see src/lib/clockTime.js).
-- Growing the RETURNS TABLE requires DROP + CREATE (CREATE OR REPLACE can't change it).
-- Rollback: DROP + re-create the prior 15-column version.
DROP FUNCTION IF EXISTS public.get_tech_status_board();

CREATE FUNCTION public.get_tech_status_board()
 RETURNS TABLE(employee_id uuid, full_name text, default_division text, status text, status_since timestamp with time zone, entry_id uuid, appointment_id uuid, appointment_title text, job_id uuid, job_number text, client_name text, address text, division text, next_appt_time timestamp with time zone, next_appt_title text, travel_start timestamp with time zone, clock_in timestamp with time zone, paused_at timestamp with time zone, total_paused_minutes numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH open_entry AS (
    SELECT DISTINCT ON (jte.employee_id)
      jte.employee_id, jte.id AS entry_id, jte.appointment_id, jte.job_id,
      jte.travel_start, jte.clock_in, jte.paused_at, jte.total_paused_minutes
    FROM job_time_entries jte
    WHERE jte.clock_out IS NULL
      AND (jte.travel_start IS NOT NULL OR jte.clock_in IS NOT NULL)
    ORDER BY jte.employee_id, jte.created_at DESC
  ),
  today_appt AS (
    SELECT DISTINCT ON (ac.employee_id)
      ac.employee_id,
      a.id          AS appointment_id,
      a.title       AS appointment_title,
      a.job_id,
      ((a.date + a.time_start) AT TIME ZONE 'America/Denver') AS appt_ts
    FROM appointment_crew ac
    JOIN appointments a ON a.id = ac.appointment_id
    WHERE a.date = (NOW() AT TIME ZONE 'America/Denver')::date
    ORDER BY ac.employee_id,
      (((a.date + a.time_start) AT TIME ZONE 'America/Denver') >= NOW()) DESC,
      ((a.date + a.time_start) AT TIME ZONE 'America/Denver') ASC
  )
  SELECT
    e.id                                        AS employee_id,
    e.full_name,
    e.default_division,
    CASE
      WHEN oe.paused_at IS NOT NULL                THEN 'paused'
      WHEN oe.clock_in IS NOT NULL                 THEN 'on_site'
      WHEN oe.travel_start IS NOT NULL             THEN 'omw'
      WHEN ta.appointment_id IS NOT NULL           THEN 'scheduled'
      ELSE 'idle'
    END                                         AS status,
    CASE
      WHEN oe.paused_at IS NOT NULL    THEN oe.paused_at
      WHEN oe.clock_in IS NOT NULL     THEN oe.clock_in
      WHEN oe.travel_start IS NOT NULL THEN oe.travel_start
      ELSE NULL
    END                                         AS status_since,
    oe.entry_id,
    COALESCE(oe.appointment_id, ta.appointment_id)  AS appointment_id,
    COALESCE(a_open.title, ta.appointment_title)    AS appointment_title,
    COALESCE(oe.job_id, ta.job_id)                  AS job_id,
    j.job_number,
    j.insured_name                              AS client_name,
    NULLIF(CONCAT_WS(', ',
      NULLIF(j.address, ''),
      NULLIF(j.city, ''),
      NULLIF(j.state, '') || CASE WHEN j.zip IS NOT NULL AND j.zip <> '' THEN ' ' || j.zip ELSE '' END
    ), '')                                      AS address,
    j.division,
    CASE WHEN oe.entry_id IS NULL AND ta.appt_ts >= NOW() THEN ta.appt_ts ELSE NULL END AS next_appt_time,
    CASE WHEN oe.entry_id IS NULL AND ta.appt_ts >= NOW() THEN ta.appointment_title ELSE NULL END AS next_appt_title,
    oe.travel_start,
    oe.clock_in,
    oe.paused_at,
    oe.total_paused_minutes
  FROM employees e
  LEFT JOIN open_entry oe       ON oe.employee_id = e.id
  LEFT JOIN today_appt ta       ON ta.employee_id = e.id
  LEFT JOIN appointments a_open ON a_open.id = oe.appointment_id
  LEFT JOIN jobs j              ON j.id = COALESCE(oe.job_id, ta.job_id)
  WHERE e.is_active = TRUE
    AND (e.role IN ('field_tech', 'supervisor')
         OR e.show_on_status_board
         OR oe.entry_id IS NOT NULL
         OR ta.appointment_id IS NOT NULL)
  ORDER BY
    CASE
      WHEN oe.paused_at IS NOT NULL    THEN 1
      WHEN oe.clock_in IS NOT NULL     THEN 2
      WHEN oe.travel_start IS NOT NULL THEN 3
      WHEN ta.appointment_id IS NOT NULL THEN 4
      ELSE 5
    END,
    e.full_name;
$function$;
