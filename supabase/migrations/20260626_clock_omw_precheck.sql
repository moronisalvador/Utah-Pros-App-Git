-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_clock_omw_precheck
-- PR-2 (Time-Tracking build plan) — read-only precheck for the On-My-Way supersede UX.
--
-- WHAT THIS DOES (plain language):
--   Before a tech taps "On My Way" on a new appointment, the app calls this to ask:
--   "is this tech still clocked in somewhere else?" It returns whether to show a
--   confirmation sheet (auto-close mode) or a hard-block message (enforce mode),
--   plus details of the other open job so the sheet can say which one.
--
-- DEPENDS ON:
--   reads → job_time_entries, appointments, jobs, feature_flags. writes → none.
--
-- NOTES / GOTCHAS:
--   - Read-only (no mutation). Looks only at an open LIVE entry on a DIFFERENT
--     appointment (clock_out IS NULL AND travel_start IS NOT NULL AND appointment_id
--     IS DISTINCT FROM the one being started). A re-OMW on the same appointment is fine.
--   - requires_confirmation = open exists AND flag OFF; enforce_explicit = open exists
--     AND flag ON. Both false when there is no other open entry.
-- ════════════════════════════════════════════════
create or replace function public.clock_omw_precheck(p_appointment_id uuid, p_employee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_open      job_time_entries%ROWTYPE;
  v_enforce   boolean := false;
  v_title     text;
  v_job_number text;
  v_insured   text;
  v_status    text;
  v_open_json jsonb;
begin
  select coalesce(enabled, false) into v_enforce
  from feature_flags where key = 'clock_enforce_explicit_clockout';
  v_enforce := coalesce(v_enforce, false);

  -- Most-recent open LIVE entry on a DIFFERENT appointment for this employee.
  select * into v_open
  from job_time_entries
  where employee_id = p_employee_id
    and clock_out is null
    and travel_start is not null
    and appointment_id is distinct from p_appointment_id
  order by created_at desc
  limit 1;

  if v_open.id is null then
    return jsonb_build_object(
      'requires_confirmation', false,
      'enforce_explicit', false,
      'open_entry', null
    );
  end if;

  select a.title, j.job_number, j.insured_name
    into v_title, v_job_number, v_insured
  from appointments a
  left join jobs j on j.id = a.job_id
  where a.id = v_open.appointment_id;

  v_status := case
    when v_open.paused_at is not null then 'paused'
    when v_open.clock_in  is not null then 'on_site'
    else 'omw'
  end;

  v_open_json := jsonb_build_object(
    'entry_id',        v_open.id,
    'appointment_id',  v_open.appointment_id,
    'title',           v_title,
    'job_id',          v_open.job_id,
    'job_number',      v_job_number,
    'insured_name',    v_insured,
    'travel_start',    v_open.travel_start,
    'clock_in',        v_open.clock_in,
    'status',          v_status,
    'elapsed_minutes', round(extract(epoch from (now() - v_open.travel_start)) / 60.0)
  );

  return jsonb_build_object(
    'requires_confirmation', not v_enforce,
    'enforce_explicit',      v_enforce,
    'open_entry',            v_open_json
  );
end;
$function$;

grant execute on function public.clock_omw_precheck(uuid, uuid) to anon, authenticated;
