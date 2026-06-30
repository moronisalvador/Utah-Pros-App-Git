-- ════════════════════════════════════════════════
-- Status Board — "pin" specific employees (always show)
-- ════════════════════════════════════════════════
-- Adds employees.show_on_status_board so owners/admins who occasionally do field
-- work can be pinned on the Status Board / Employee Status widget even when they are
-- not field_tech/supervisor, not clocked in, and not scheduled today. This avoids a
-- blanket "include all admins" (which would clutter the board with office staff).
--
-- get_tech_status_board() gains `OR e.show_on_status_board` in its WHERE. Pinned
-- employees read as 'idle' until they clock in / are scheduled, then follow the normal
-- omw/on_site/paused/scheduled logic.
--
-- Seeds the flag for the owner login (Moroni Salvador, email moroni@utah-pros.com).
-- NOTE: a separate loginless test record "Moroni Tech" carries moroni.s@utah-pros.com —
-- the pin is intentionally keyed to the real login account's email, not that one.
-- Rollback: drop the column + remove the OR clause (CREATE OR REPLACE prior body).

alter table public.employees
  add column if not exists show_on_status_board boolean not null default false;
comment on column public.employees.show_on_status_board is
  'Pin this employee on the Status Board / Employee Status widget regardless of role/clock/schedule (e.g. owners who occasionally do field work). Used by get_tech_status_board().';

update public.employees set show_on_status_board = true
  where lower(email) = 'moroni@utah-pros.com';

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
