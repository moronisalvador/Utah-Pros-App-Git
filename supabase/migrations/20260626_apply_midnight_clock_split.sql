-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_apply_midnight_clock_split
-- PR-3 (Time-Tracking build plan) — nightly midnight clock split.
--
-- WHAT THIS DOES (plain language):
--   Runs every night just after midnight (America/Denver). For any tech still
--   clocked in from a PRIOR day, it closes that day's entry at 11:59:59 PM and
--   re-opens a fresh "continuation" entry at 12:00 AM the next day, so each
--   day's hours land on the right date. If a continuation is itself left
--   untouched a second night (the tech clearly forgot to clock out), it stops
--   re-opening, flags the row "[abandoned: needs review]", and alerts the office.
--
-- DEPENDS ON:
--   reads  → job_time_entries, employees. writes → job_time_entries,
--            worker_runs, notifications (via create_notification).
--
-- NOTES / GOTCHAS:
--   - Only acts on entries with work_date < today (Denver) → safe to run anytime;
--     today's still-open clocks are never touched. Idempotent across re-runs.
--   - "Open LIVE entry" = clock_out IS NULL AND travel_start IS NOT NULL (manual
--     desk rows excluded). Honors the PR-1 single-open-entry invariant.
--   - Stop-loss: a row that is already auto_continued AND auto_split_seq >= 1 and
--     still untouched (auto_continued never flipped back to false by a human clock
--     action) is closed but NOT re-opened, and an admin notification is created.
--   - Locked down: not callable by anon/authenticated via REST; only the cron job
--     (and admins via SQL) invoke it.
-- ════════════════════════════════════════════════
create or replace function public.apply_midnight_clock_split()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_started timestamptz := now();
  v_count   int := 0;
  v_e       record;
  v_cap     timestamptz;
  v_paused  numeric;
  v_hours   numeric;
  v_emp     text;
begin
  for v_e in
    select * from job_time_entries
    where clock_out is null
      and travel_start is not null
      and work_date < (now() at time zone 'America/Denver')::date
    order by work_date asc, created_at asc
  loop
    -- Cap at 23:59:59 Denver of the entry's own work_date.
    v_cap := ((v_e.work_date::text || ' 23:59:59')::timestamp at time zone 'America/Denver');

    if v_e.clock_in is not null then
      -- Arrived: on-site hours up to the cap (same formula as 'finish').
      v_paused := coalesce(v_e.total_paused_minutes, 0);
      if v_e.paused_at is not null then
        v_paused := v_paused + greatest(0, extract(epoch from (v_cap - v_e.paused_at)) / 60);
      end if;
      v_hours := least(24, greatest(0, extract(epoch from (v_cap - v_e.clock_in)) / 3600 - v_paused / 60));
      update job_time_entries
        set clock_out = v_cap,
            on_site_end = coalesce(on_site_end, v_cap),
            hours = v_hours,
            paused_at = null,
            total_paused_minutes = round(v_paused::numeric, 2),
            updated_at = now()
      where id = v_e.id;
    else
      -- En-route only: no on-site hours; capture the drive as travel_minutes.
      update job_time_entries
        set clock_out = v_cap,
            hours = 0,
            travel_minutes = coalesce(travel_minutes,
              least(1440, greatest(0, round(extract(epoch from (v_cap - v_e.travel_start)) / 60.0, 1)))),
            updated_at = now()
      where id = v_e.id;
    end if;

    if v_e.auto_continued = true and coalesce(v_e.auto_split_seq, 0) >= 1 then
      -- Stop-loss: an untouched continuation rolled a second night → abandoned.
      update job_time_entries
        set notes = coalesce(notes, '') || ' [abandoned: needs review]', updated_at = now()
      where id = v_e.id;

      select full_name into v_emp from employees where id = v_e.employee_id;
      perform create_notification(
        'time_entry.abandoned_clock',
        'Abandoned clock needs review',
        coalesce(v_emp, 'A tech') || ' had an auto-continued clock that was never touched for a second day; it has been stopped. Please review their hours.',
        '/time-tracking',
        'job_time_entry',
        v_e.id,
        v_e.job_id,
        jsonb_build_object('employee_id', v_e.employee_id, 'work_date', v_e.work_date, 'auto_split_seq', v_e.auto_split_seq)
      );
    else
      -- Reopen a continuation for the next day at 00:00 Denver.
      insert into job_time_entries (
        job_id, employee_id, appointment_id, work_date, hours, work_type,
        travel_start, clock_in, entered_by, description,
        auto_continued, continued_from, auto_split_seq, source
      ) values (
        v_e.job_id, v_e.employee_id, v_e.appointment_id, (v_e.work_date + 1), 0, coalesce(v_e.work_type, 'field'),
        (((v_e.work_date + 1)::text || ' 00:00:00')::timestamp at time zone 'America/Denver'),
        (((v_e.work_date + 1)::text || ' 00:00:00')::timestamp at time zone 'America/Denver'),
        v_e.employee_id,
        coalesce(v_e.description, 'Continued overnight'),
        true, v_e.id, coalesce(v_e.auto_split_seq, 0) + 1, 'auto_split'
      );
    end if;

    v_count := v_count + 1;
  end loop;

  insert into worker_runs (worker_name, status, records_processed, started_at, completed_at)
  values ('apply_midnight_clock_split', 'completed', v_count, v_started, now());
end;
$function$;

-- Only the scheduler / admins (SQL) run this — never techs via REST.
revoke all on function public.apply_midnight_clock_split() from public, anon, authenticated;
