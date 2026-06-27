-- ════════════════════════════════════════════════
-- MIGRATION: 20260627_get_timesheet_entries_admin
-- PR-5 (Time-Tracking build plan) — richer admin timesheet read RPC.
--
-- WHAT THIS DOES (plain language):
--   A read-only report for the office Time Tracking page that returns every detail
--   the admin tools need: the raw clock timestamps, travel + pause figures, the
--   auto-continued flag, plus computed helpers — how long the entry ran, whether
--   it's still open, and whether it's suspiciously long (>12h). Supports filtering
--   by employee, job, division, and status (open / approved / unapproved / overlong).
--
-- DEPENDS ON:
--   reads → job_time_entries, employees, jobs. writes → none.
--
-- NOTES / GOTCHAS:
--   - Additive: get_timesheet_entries is LEFT INTACT (the existing UI keeps working).
--   - is_open = clock_out IS NULL AND travel_start IS NOT NULL (manual desk rows
--     excluded). is_overlong = (hours + travel_minutes/60) > 12 (threshold hardcoded
--     for now; can move to a settings row later).
--   - has_pending_change is intentionally NOT here yet — it needs the
--     time_entry_change_requests table from PR-6; it will be added then.
--   - p_employee_id NULL → all employees.
-- ════════════════════════════════════════════════
create or replace function public.get_timesheet_entries_admin(
  p_start_date  date default (date_trunc('week', (current_date)::timestamptz))::date,
  p_end_date    date default ((date_trunc('week', (current_date)::timestamptz) + interval '6 days'))::date,
  p_employee_id uuid default null,
  p_job_id      uuid default null,
  p_status      text default null,   -- open | approved | unapproved | overlong | null(all)
  p_division    text default null
)
returns table(
  id uuid, job_id uuid, employee_id uuid, employee_name text,
  job_number text, insured_name text, division text,
  work_date date, hours numeric, hourly_rate numeric, total_cost numeric,
  work_type text, description text, approved boolean, approved_by uuid,
  travel_start timestamptz, clock_in timestamptz, on_site_end timestamptz, clock_out timestamptz,
  travel_minutes numeric, total_paused_minutes numeric, auto_continued boolean,
  appointment_id uuid, notes text, created_at timestamptz,
  duration_minutes numeric, is_open boolean, is_overlong boolean
)
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select * from (
    select
      t.id, t.job_id, t.employee_id, e.full_name as employee_name,
      j.job_number, j.insured_name, j.division,
      t.work_date, t.hours, t.hourly_rate, t.total_cost,
      t.work_type, t.description, t.approved, t.approved_by,
      t.travel_start, t.clock_in, t.on_site_end, t.clock_out,
      t.travel_minutes, t.total_paused_minutes, t.auto_continued,
      t.appointment_id, t.notes, t.created_at,
      round(coalesce(t.travel_minutes, 0) + coalesce(t.hours, 0) * 60, 1) as duration_minutes,
      (t.clock_out is null and t.travel_start is not null) as is_open,
      ((coalesce(t.hours, 0) + coalesce(t.travel_minutes, 0) / 60.0) > 12) as is_overlong
    from job_time_entries t
    join employees e on e.id = t.employee_id
    join jobs j on j.id = t.job_id
    where t.work_date between p_start_date and p_end_date
      and (p_employee_id is null or t.employee_id = p_employee_id)
      and (p_job_id is null or t.job_id = p_job_id)
      and (p_division is null or j.division::text = p_division)
  ) q
  where (
    p_status is null
    or (p_status = 'open'       and q.is_open)
    or (p_status = 'approved'   and q.approved)
    or (p_status = 'unapproved' and not coalesce(q.approved, false))
    or (p_status = 'overlong'   and q.is_overlong)
  )
  order by q.work_date desc, q.employee_name, q.clock_in;
$function$;

grant execute on function public.get_timesheet_entries_admin(date, date, uuid, uuid, text, text) to anon, authenticated;
