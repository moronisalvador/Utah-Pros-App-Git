-- ════════════════════════════════════════════════
-- get_tech_status_board — timezone fix + field-working admins
-- ════════════════════════════════════════════════
-- Two fixes to the live "Employee status / Status Board" RPC:
--
-- 1) TIMEZONE: it detected "today" with `a.date = CURRENT_DATE`, but CURRENT_DATE
--    evaluates in UTC. After ~6pm Denver (= UTC midnight) it rolled to tomorrow, so
--    the board matched the WRONG day's appointments every evening — today's scheduled
--    techs dropped off and tomorrow's showed early. Now uses
--    `(now() AT TIME ZONE 'America/Denver')::date`.
--
-- 2) FIELD-WORKING ADMINS: the board only seeded field_tech/supervisor (plus anyone
--    currently clocked in). Admins who run jobs (e.g. owners) never appeared unless
--    actively clocked in. The old `next_appt` CTE (future-only) is replaced by
--    `today_appt` (one appointment per employee for today, nearest-upcoming else
--    earliest), and the WHERE now includes anyone on a crew for an appointment today,
--    regardless of role. Office-only staff with no appointment today still don't show.
--    Such people read as 'scheduled' until they clock in; next_appt_time/title are still
--    only populated for genuinely-upcoming appointments.
--
-- Same RETURNS TABLE signature → CREATE OR REPLACE is safe (validated read-only against
-- prod data before apply). Rollback: re-create the prior body (CURRENT_DATE + next_appt
-- future-only + role IN ('field_tech','supervisor')).

CREATE OR REPLACE FUNCTION public.get_tech_status_board()
 RETURNS TABLE(employee_id uuid, full_name text, default_division text, status text, status_since timestamp with time zone, entry_id uuid, appointment_id uuid, appointment_title text, job_id uuid, job_number text, client_name text, address text, division text, next_appt_time timestamp with time zone, next_appt_title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH open_entry AS (
    SELECT DISTINCT ON (jte.employee_id)
      jte.employee_id, jte.id AS entry_id, jte.appointment_id, jte.job_id,
      jte.travel_start, jte.clock_in, jte.paused_at
    FROM job_time_entries jte
    WHERE jte.clock_out IS NULL
      AND (jte.travel_start IS NOT NULL OR jte.clock_in IS NOT NULL)
    ORDER BY jte.employee_id, jte.created_at DESC
  ),
  today_appt AS (
    -- one appointment per employee for TODAY (Denver): nearest upcoming, else earliest past
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
    CASE WHEN oe.entry_id IS NULL AND ta.appt_ts >= NOW() THEN ta.appointment_title ELSE NULL END AS next_appt_title
  FROM employees e
  LEFT JOIN open_entry oe       ON oe.employee_id = e.id
  LEFT JOIN today_appt ta       ON ta.employee_id = e.id
  LEFT JOIN appointments a_open ON a_open.id = oe.appointment_id
  LEFT JOIN jobs j              ON j.id = COALESCE(oe.job_id, ta.job_id)
  WHERE e.is_active = TRUE
    AND (e.role IN ('field_tech', 'supervisor') OR oe.entry_id IS NOT NULL OR ta.appointment_id IS NOT NULL)
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
