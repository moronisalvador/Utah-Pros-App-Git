-- ════════════════════════════════════════════════
-- MIGRATION: 20260627_travel_inclusive_cost
-- PR-4 (Time-Tracking build plan) — include drive time in labor cost.
--
-- WHAT THIS DOES (plain language):
--   Until now a time entry's cost (total_cost) only counted on-site hours; the
--   tech's drive time (travel_minutes) was free. This makes total_cost =
--   round((travel_minutes/60 + hours) × rate, 2) so job-labor reports reflect the
--   real cost of getting to the job.
--
-- IMPORTANT — total_cost is a GENERATED column, not trigger-written:
--   On this DB total_cost was `GENERATED ALWAYS AS (hours * COALESCE(hourly_rate,0))
--   STORED`. The calc_time_entry_cost trigger *looked* like it set the cost, but a
--   trigger's assignment to a generated column is ignored — the generation
--   expression always wins. So the real fix is ALTER COLUMN ... SET EXPRESSION
--   (Postgres 15+/17), which recomputes every existing row immediately AND applies
--   to all future rows automatically — no trigger and no manual backfill needed.
--
-- DEPENDS ON:
--   writes → job_time_entries.total_cost (generated). reads employees.hourly_rate
--   (via the trigger's rate-fill).
--
-- NOTES / GOTCHAS:
--   - get_payroll_summary is UNAFFECTED — it recomputes pay from hours×rate and
--     never reads stored total_cost. get_job_labor_summary / get_timesheet_entries
--     DO sum stored total_cost, so they now include drive time (intended).
--   - The trigger is reduced to its real remaining jobs: fill hourly_rate from the
--     employee when missing (so the generated column has a rate), and stamp
--     updated_at. It no longer assigns total_cost.
--   - Verified on a faithful preview branch (generated column reproduced):
--     existing rows recompute, fresh inserts + travel edits auto-include drive,
--     null-rate rows get filled then costed. On prod all 148 rated rows recomputed.
-- ════════════════════════════════════════════════
alter table job_time_entries
  alter column total_cost
  set expression as (round((coalesce(travel_minutes, 0) / 60.0 + coalesce(hours, 0)) * coalesce(hourly_rate, 0), 2));

create or replace function public.calc_time_entry_cost()
returns trigger language plpgsql as $function$
declare
  v_rate numeric;
begin
  -- Fill the entry's hourly_rate from the employee when not set, so the generated
  -- total_cost column has a rate to use. total_cost itself is generated (see above).
  if NEW.hourly_rate is null or NEW.hourly_rate = 0 then
    select hourly_rate into v_rate from employees where id = NEW.employee_id;
    if v_rate is not null then NEW.hourly_rate := v_rate; end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$function$;

drop trigger if exists trg_calc_time_entry_cost on job_time_entries;
create trigger trg_calc_time_entry_cost
  before insert or update of hours, hourly_rate, employee_id
  on job_time_entries
  for each row execute function calc_time_entry_cost();
