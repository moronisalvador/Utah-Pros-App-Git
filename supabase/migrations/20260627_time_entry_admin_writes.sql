-- ════════════════════════════════════════════════
-- MIGRATION: 20260627_time_entry_admin_writes
-- PR-6 (Time-Tracking build plan) — admin edit/clock-out/delete + tech change-requests.
--
-- WHAT THIS DOES (plain language):
--   Gives the office the server-side tools to manage timesheets safely, and gives
--   techs a way to request corrections to their own past entries:
--     • admin_upsert_time_entry  — add/edit an entry (admin-tier only)
--     • admin_clock_out_entry     — close a still-open entry (admin-tier only)
--     • delete_time_entry         — hard-delete with a full-row audit snapshot
--     • submit_time_entry_change_request  — a tech proposes a fix (no mutation)
--     • review_time_entry_change_request  — admin approves (applies) or rejects
--   Plus the two backing tables and an is_time_admin() role helper, and adds
--   has_pending_change to get_timesheet_entries_admin.
--
-- DEPENDS ON:
--   reads/writes → job_time_entries, time_entry_change_requests,
--                  time_entry_deletions, system_events, notifications, employees.
--
-- NOTES / GOTCHAS:
--   - total_cost is a GENERATED column — these RPCs never set it; they set
--     hours/travel_minutes/rate and the column recomputes (travel-inclusive, PR-4).
--   - Single-open-entry invariant (PR-1 index) is pre-checked → OPEN_ENTRY_EXISTS.
--   - Admin tier = {admin, office, project_manager, supervisor} (estimator excluded);
--     techs may only submit change requests for their OWN entries.
--   - Every mutation logs a system_events row. Errors use ERRCODE P0001 with a
--     machine-readable message the client matches on.
-- ════════════════════════════════════════════════

-- ─── Tables ─────────────────────────────────────
create table if not exists time_entry_change_requests (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references job_time_entries(id) on delete cascade,
  requested_by uuid not null references employees(id),
  proposed     jsonb not null,            -- {work_date, hours, clock_in, clock_out, travel_minutes, description, notes}
  tech_note    text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by  uuid references employees(id),
  review_note  text,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
-- one open request per entry
create unique index if not exists uq_change_request_one_pending_per_entry
  on time_entry_change_requests (entry_id) where status = 'pending';

create table if not exists time_entry_deletions (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null,              -- original id (row is gone; no FK)
  snapshot    jsonb not null,             -- full original row
  reason      text,
  deleted_by  uuid references employees(id),
  deleted_at  timestamptz not null default now()
);

alter table time_entry_change_requests enable row level security;
alter table time_entry_deletions       enable row level security;
-- reads open to the app (admin UI + tech own view filtered client-side); writes via RPC only.
drop policy if exists tecr_read on time_entry_change_requests;
create policy tecr_read on time_entry_change_requests for select to anon, authenticated using (true);
drop policy if exists ted_read on time_entry_deletions;
create policy ted_read on time_entry_deletions for select to anon, authenticated using (true);

-- ─── Role helper ────────────────────────────────
create or replace function public.is_time_admin(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from employees
    where id = p_employee_id
      and role in ('admin','office','project_manager','supervisor')
  );
$function$;

-- ─── admin_upsert_time_entry ────────────────────
create or replace function public.admin_upsert_time_entry(
  p_actor_id            uuid,
  p_id                  uuid    default null,
  p_employee_id         uuid    default null,
  p_job_id              uuid    default null,
  p_work_date           date    default null,
  p_hours               numeric default null,
  p_clock_in            timestamptz default null,
  p_clock_out           timestamptz default null,
  p_travel_start        timestamptz default null,
  p_on_site_end         timestamptz default null,
  p_travel_minutes      numeric default null,
  p_total_paused_minutes numeric default null,
  p_work_type           text default null,
  p_description         text default null,
  p_notes               text default null,
  p_override_approved   boolean default false
)
returns job_time_entries
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_old  job_time_entries%ROWTYPE;
  v_new  job_time_entries%ROWTYPE;
  v_emp  uuid;
  v_ts   timestamptz;
  v_ci   timestamptz;
  v_ose  timestamptz;
  v_co   timestamptz;
begin
  if not is_time_admin(p_actor_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_id is not null then
    select * into v_old from job_time_entries where id = p_id;
    if v_old.id is null then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_old.approved and not p_override_approved then
      raise exception 'ENTRY_APPROVED_LOCKED' using errcode = 'P0001';
    end if;
  end if;

  -- Resolve effective values (UPDATE: keep existing when arg is null; INSERT: use args)
  v_emp := coalesce(p_employee_id, v_old.employee_id);
  v_ts  := coalesce(p_travel_start, v_old.travel_start);
  v_ci  := coalesce(p_clock_in, v_old.clock_in);
  v_ose := coalesce(p_on_site_end, v_old.on_site_end);
  v_co  := coalesce(p_clock_out, v_old.clock_out);

  -- Chronology validation (only across the timestamps that are present)
  if v_ts is not null and v_ci is not null and v_ci < v_ts then raise exception 'BAD_ORDER_clock_in_before_travel' using errcode='P0001'; end if;
  if v_ci is not null and v_ose is not null and v_ose < v_ci then raise exception 'BAD_ORDER_on_site_end_before_clock_in' using errcode='P0001'; end if;
  if v_ose is not null and v_co is not null and v_co < v_ose then raise exception 'BAD_ORDER_clock_out_before_on_site_end' using errcode='P0001'; end if;
  if v_ci is not null and v_co is not null and v_co < v_ci then raise exception 'BAD_ORDER_clock_out_before_clock_in' using errcode='P0001'; end if;

  -- Single-open-entry invariant: block creating a 2nd open live row for the employee
  if v_co is null and v_ts is not null then
    if exists (
      select 1 from job_time_entries
      where employee_id = v_emp and clock_out is null and travel_start is not null
        and id <> coalesce(p_id, '00000000-0000-0000-0000-000000000000')
    ) then
      raise exception 'OPEN_ENTRY_EXISTS' using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    if v_emp is null or p_job_id is null or coalesce(p_work_date, (now() at time zone 'America/Denver')::date) is null then
      raise exception 'MISSING_REQUIRED_FIELDS' using errcode='P0001';
    end if;
    insert into job_time_entries (
      employee_id, job_id, work_date, hours, work_type, description, notes,
      travel_start, clock_in, on_site_end, clock_out, travel_minutes, total_paused_minutes,
      entered_by, auto_continued, source
    ) values (
      v_emp, p_job_id, coalesce(p_work_date, (now() at time zone 'America/Denver')::date),
      coalesce(p_hours, 0), coalesce(p_work_type, 'field'), p_description, p_notes,
      v_ts, v_ci, v_ose, v_co, p_travel_minutes, coalesce(p_total_paused_minutes, 0),
      p_actor_id, false, 'admin'
    ) returning * into v_new;
  else
    update job_time_entries set
      employee_id          = v_emp,
      job_id               = coalesce(p_job_id, v_old.job_id),
      work_date            = coalesce(p_work_date, v_old.work_date),
      hours                = coalesce(p_hours, v_old.hours),
      work_type            = coalesce(p_work_type, v_old.work_type),
      description          = coalesce(p_description, v_old.description),
      notes                = coalesce(p_notes, v_old.notes),
      travel_start         = v_ts,
      clock_in             = v_ci,
      on_site_end          = v_ose,
      clock_out            = v_co,
      travel_minutes       = coalesce(p_travel_minutes, v_old.travel_minutes),
      total_paused_minutes = coalesce(p_total_paused_minutes, v_old.total_paused_minutes),
      auto_continued       = false,
      updated_at           = now()
    where id = p_id
    returning * into v_new;
  end if;

  insert into system_events (event_type, entity_type, entity_id, actor_id, job_id, payload)
  values (
    case when p_id is null then 'time_entry.admin_created' else 'time_entry.admin_updated' end,
    'job_time_entry', v_new.id, p_actor_id, v_new.job_id,
    jsonb_build_object('override_approved', p_override_approved)
  );

  return v_new;
end;
$function$;
grant execute on function public.admin_upsert_time_entry(uuid,uuid,uuid,uuid,date,numeric,timestamptz,timestamptz,timestamptz,timestamptz,numeric,numeric,text,text,text,boolean) to anon, authenticated;

-- ─── admin_clock_out_entry ──────────────────────
create or replace function public.admin_clock_out_entry(
  p_id uuid, p_actor_id uuid, p_clock_out timestamptz default now()
)
returns job_time_entries
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_e      job_time_entries%ROWTYPE;
  v_paused numeric;
  v_hours  numeric;
begin
  if not is_time_admin(p_actor_id) then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into v_e from job_time_entries where id = p_id;
  if v_e.id is null then raise exception 'ENTRY_NOT_FOUND' using errcode='P0001'; end if;
  if v_e.clock_out is not null then raise exception 'ALREADY_CLOSED' using errcode='P0001'; end if;

  if v_e.clock_in is not null then
    v_paused := coalesce(v_e.total_paused_minutes, 0);
    if v_e.paused_at is not null then v_paused := v_paused + greatest(0, extract(epoch from (p_clock_out - v_e.paused_at))/60); end if;
    v_hours := least(24, greatest(0, extract(epoch from (p_clock_out - v_e.clock_in))/3600 - v_paused/60));
    update job_time_entries set clock_out=p_clock_out, on_site_end=coalesce(on_site_end,p_clock_out),
      hours=v_hours, paused_at=null, total_paused_minutes=round(v_paused::numeric,2), updated_at=now()
    where id=p_id returning * into v_e;
  else
    update job_time_entries set clock_out=p_clock_out, hours=0,
      travel_minutes=coalesce(travel_minutes, least(1440, greatest(0, round(extract(epoch from (p_clock_out - v_e.travel_start))/60.0,1)))),
      updated_at=now()
    where id=p_id returning * into v_e;
  end if;

  insert into system_events (event_type, entity_type, entity_id, actor_id, job_id, payload)
  values ('time_entry.admin_clocked_out','job_time_entry', v_e.id, p_actor_id, v_e.job_id, jsonb_build_object('clock_out', p_clock_out));
  return v_e;
end;
$function$;
grant execute on function public.admin_clock_out_entry(uuid,uuid,timestamptz) to anon, authenticated;

-- ─── delete_time_entry (hard delete + audit) ────
create or replace function public.delete_time_entry(p_id uuid, p_reason text, p_actor_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_e job_time_entries%ROWTYPE;
begin
  if not is_time_admin(p_actor_id) then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into v_e from job_time_entries where id = p_id;
  if v_e.id is null then raise exception 'ENTRY_NOT_FOUND' using errcode='P0001'; end if;
  if v_e.approved then raise exception 'ENTRY_APPROVED_CANNOT_DELETE' using errcode='P0001'; end if;

  insert into time_entry_deletions (entry_id, snapshot, reason, deleted_by)
  values (v_e.id, to_jsonb(v_e), p_reason, p_actor_id);

  insert into system_events (event_type, entity_type, entity_id, actor_id, job_id, payload)
  values ('time_entry.deleted','job_time_entry', v_e.id, p_actor_id, v_e.job_id,
          jsonb_build_object('reason', p_reason, 'snapshot', to_jsonb(v_e)));

  delete from job_time_entries where id = p_id;
end;
$function$;
grant execute on function public.delete_time_entry(uuid,text,uuid) to anon, authenticated;

-- ─── submit_time_entry_change_request (tech) ────
create or replace function public.submit_time_entry_change_request(
  p_entry_id uuid, p_proposed jsonb, p_tech_note text, p_actor_id uuid
)
returns time_entry_change_requests
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_e job_time_entries%ROWTYPE; v_req time_entry_change_requests%ROWTYPE; v_emp text;
begin
  select * into v_e from job_time_entries where id = p_entry_id;
  if v_e.id is null then raise exception 'ENTRY_NOT_FOUND' using errcode='P0001'; end if;
  if v_e.employee_id <> p_actor_id then raise exception 'NOT_OWNER' using errcode='P0001'; end if;

  insert into time_entry_change_requests (entry_id, requested_by, proposed, tech_note)
  values (p_entry_id, p_actor_id, coalesce(p_proposed,'{}'::jsonb), p_tech_note)
  returning * into v_req;

  select full_name into v_emp from employees where id = p_actor_id;
  perform create_notification(
    'time_entry.change_requested', 'Timesheet change requested',
    coalesce(v_emp,'A tech') || ' requested a correction to a time entry.',
    '/time-tracking', 'time_entry_change_request', v_req.id, v_e.job_id,
    jsonb_build_object('entry_id', p_entry_id, 'proposed', coalesce(p_proposed,'{}'::jsonb))
  );
  return v_req;
end;
$function$;
grant execute on function public.submit_time_entry_change_request(uuid,jsonb,text,uuid) to anon, authenticated;

-- ─── review_time_entry_change_request (admin) ───
create or replace function public.review_time_entry_change_request(
  p_request_id uuid, p_approve boolean, p_actor_id uuid, p_review_note text default null
)
returns time_entry_change_requests
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_req time_entry_change_requests%ROWTYPE; v_e job_time_entries%ROWTYPE; v_p jsonb;
begin
  if not is_time_admin(p_actor_id) then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into v_req from time_entry_change_requests where id = p_request_id;
  if v_req.id is null then raise exception 'REQUEST_NOT_FOUND' using errcode='P0001'; end if;
  if v_req.status <> 'pending' then raise exception 'REQUEST_ALREADY_REVIEWED' using errcode='P0001'; end if;

  if p_approve then
    select * into v_e from job_time_entries where id = v_req.entry_id;
    if v_e.id is null then raise exception 'ENTRY_NOT_FOUND' using errcode='P0001'; end if;
    v_p := v_req.proposed;
    perform admin_upsert_time_entry(
      p_actor_id            => p_actor_id,
      p_id                  => v_e.id,
      p_employee_id         => v_e.employee_id,
      p_job_id              => v_e.job_id,
      p_work_date           => coalesce((v_p->>'work_date')::date, v_e.work_date),
      p_hours               => coalesce((v_p->>'hours')::numeric, v_e.hours),
      p_clock_in            => coalesce((v_p->>'clock_in')::timestamptz, v_e.clock_in),
      p_clock_out           => coalesce((v_p->>'clock_out')::timestamptz, v_e.clock_out),
      p_travel_start        => v_e.travel_start,
      p_on_site_end         => v_e.on_site_end,
      p_travel_minutes      => coalesce((v_p->>'travel_minutes')::numeric, v_e.travel_minutes),
      p_total_paused_minutes => v_e.total_paused_minutes,
      p_work_type           => v_e.work_type,
      p_description         => coalesce(v_p->>'description', v_e.description),
      p_notes               => coalesce(v_p->>'notes', v_e.notes),
      p_override_approved   => true
    );
  end if;

  update time_entry_change_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = p_actor_id, review_note = p_review_note, reviewed_at = now()
  where id = p_request_id
  returning * into v_req;

  perform create_notification(
    case when p_approve then 'time_entry.change_approved' else 'time_entry.change_rejected' end,
    case when p_approve then 'Timesheet change approved' else 'Timesheet change rejected' end,
    coalesce(p_review_note, ''), '/time-tracking', 'time_entry_change_request', v_req.id, null,
    jsonb_build_object('entry_id', v_req.entry_id, 'requested_by', v_req.requested_by)
  );

  insert into system_events (event_type, entity_type, entity_id, actor_id, job_id, payload)
  values ('time_entry.change_reviewed','time_entry_change_request', v_req.id, p_actor_id, null,
          jsonb_build_object('approved', p_approve, 'entry_id', v_req.entry_id));
  return v_req;
end;
$function$;
grant execute on function public.review_time_entry_change_request(uuid,boolean,uuid,text) to anon, authenticated;

-- ─── Add has_pending_change to the admin read (deferred from PR-5) ───
-- DROP first: adding the has_pending_change column changes the return type, which
-- CREATE OR REPLACE cannot do.
drop function if exists public.get_timesheet_entries_admin(date, date, uuid, uuid, text, text);
create or replace function public.get_timesheet_entries_admin(
  p_start_date  date default (date_trunc('week', (current_date)::timestamptz))::date,
  p_end_date    date default ((date_trunc('week', (current_date)::timestamptz) + interval '6 days'))::date,
  p_employee_id uuid default null,
  p_job_id      uuid default null,
  p_status      text default null,
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
  duration_minutes numeric, is_open boolean, is_overlong boolean, has_pending_change boolean
)
language sql stable security definer set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select * from (
    select
      t.id, t.job_id, t.employee_id, e.full_name as employee_name,
      j.job_number, j.insured_name, j.division::text as division,
      t.work_date, t.hours, t.hourly_rate, t.total_cost,
      t.work_type, t.description, t.approved, t.approved_by,
      t.travel_start, t.clock_in, t.on_site_end, t.clock_out,
      t.travel_minutes, t.total_paused_minutes, t.auto_continued,
      t.appointment_id, t.notes, t.created_at,
      round(coalesce(t.travel_minutes, 0) + coalesce(t.hours, 0) * 60, 1) as duration_minutes,
      (t.clock_out is null and t.travel_start is not null) as is_open,
      ((coalesce(t.hours, 0) + coalesce(t.travel_minutes, 0) / 60.0) > 12) as is_overlong,
      exists (select 1 from time_entry_change_requests cr where cr.entry_id = t.id and cr.status = 'pending') as has_pending_change
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
