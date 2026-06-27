-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_clock_stranded_entry_fix
-- HOTFIX — a deleted appointment must not strand an open clock.
--
-- WHAT THIS DOES (plain language):
--   Two safeguards so a tech can always clock out:
--   1. close_open_clocks_on_appt_delete — when an appointment is deleted, any
--      open clock attached to it is automatically closed FIRST (before the
--      foreign key blanks the link), so it can never be left dangling.
--   2. clock_finish_entry — lets the app finish an open entry by its own id
--      (not by appointment), which recovers a clock whose appointment is already
--      gone. The tech can only finish their own entry.
--
-- WHY:
--   job_time_entries.appointment_id is ON DELETE SET NULL, so deleting an
--   appointment used to null the link on an open entry, leaving it with no
--   appointment screen to clock out from.
--
-- DEPENDS ON:
--   reads/writes → job_time_entries, appointments.
--
-- NOTES / GOTCHAS:
--   - Close logic matches PR-1/PR-3: arrived → on-site hours from clock_in minus
--     pauses (capped 0..24); en-route-only → hours 0 + travel_minutes from
--     travel_start. "Open LIVE" = clock_out IS NULL AND travel_start IS NOT NULL.
--   - clock_finish_entry is owner-checked (employee_id = p_employee_id).
-- ════════════════════════════════════════════════

-- ── Recovery: finish an open entry by id (appointment-independent) ──
create or replace function public.clock_finish_entry(p_entry_id uuid, p_employee_id uuid)
returns job_time_entries
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_e      job_time_entries%ROWTYPE;
  v_now    timestamptz := now();
  v_paused numeric;
  v_hours  numeric;
begin
  select * into v_e
  from job_time_entries
  where id = p_entry_id and employee_id = p_employee_id and clock_out is null;

  if v_e.id is null then
    raise exception 'ENTRY_NOT_FOUND_OR_CLOSED' using errcode = 'P0001';
  end if;

  if v_e.clock_in is not null then
    v_paused := coalesce(v_e.total_paused_minutes, 0);
    if v_e.paused_at is not null then
      v_paused := v_paused + greatest(0, extract(epoch from (v_now - v_e.paused_at)) / 60);
    end if;
    v_hours := least(24, greatest(0, extract(epoch from (v_now - v_e.clock_in)) / 3600 - v_paused / 60));
    update job_time_entries
      set clock_out = v_now, on_site_end = coalesce(on_site_end, v_now), hours = v_hours,
          paused_at = null, total_paused_minutes = round(v_paused::numeric, 2), updated_at = now()
    where id = v_e.id
    returning * into v_e;
  else
    update job_time_entries
      set clock_out = v_now, hours = 0,
          travel_minutes = coalesce(travel_minutes,
            least(1440, greatest(0, round(extract(epoch from (v_now - v_e.travel_start)) / 60.0, 1)))),
          updated_at = now()
    where id = v_e.id
    returning * into v_e;
  end if;

  if v_e.appointment_id is not null then
    update appointments set status = 'completed' where id = v_e.appointment_id;
  end if;

  return v_e;
end;
$function$;

grant execute on function public.clock_finish_entry(uuid, uuid) to anon, authenticated;

-- ── Prevention: auto-close open clocks before an appointment is deleted ──
create or replace function public.close_open_clocks_on_appt_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  update job_time_entries
    set clock_out = now(),
        on_site_end = case when clock_in is not null then coalesce(on_site_end, now()) else on_site_end end,
        hours = case when clock_in is not null
                     then least(24, greatest(0, extract(epoch from (now() - clock_in)) / 3600 - coalesce(total_paused_minutes, 0) / 60))
                     else 0 end,
        travel_minutes = case when clock_in is null
                              then coalesce(travel_minutes, least(1440, greatest(0, round(extract(epoch from (now() - travel_start)) / 60.0, 1))))
                              else travel_minutes end,
        paused_at = null,
        notes = coalesce(notes, '') || ' [auto-closed: appointment deleted]',
        updated_at = now()
  where appointment_id = OLD.id
    and clock_out is null
    and travel_start is not null;
  return OLD;
end;
$function$;

drop trigger if exists trg_close_open_clocks_before_appt_delete on appointments;
create trigger trg_close_open_clocks_before_appt_delete
  before delete on appointments
  for each row execute function close_open_clocks_on_appt_delete();
