-- ════════════════════════════════════════════════
-- FILE: 20260704_notify_timesheet_events.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Routes the two timesheet-correction notifications through the Notification
--   Center so they honor each person's preferences and land in the right
--   person's bell — instead of the old catalog-less org-wide broadcast:
--     • timesheet.change_requested → admins, when a tech asks for a correction
--     • timesheet.change_reviewed  → the requesting tech, when an admin
--       approves or rejects it (the two old approved/rejected rows folded into
--       one catalog event with the decision in the payload).
--
-- WHAT CHANGED:
--   Body-only replace of two live SECURITY DEFINER RPCs — signatures UNCHANGED.
--   The ONLY change in each is swapping the legacy create_notification(...) call
--   for notify_emit(<catalog type>, ...). All validation, the timesheet write
--   (admin_upsert_time_entry), the status update, and the system_events audit
--   row are preserved byte-for-byte.
--
-- DEPENDS ON:
--   Functions: notify_emit(text, jsonb), admin_upsert_time_entry, is_time_admin
--   Data:      reads  → job_time_entries, time_entry_change_requests, employees
--              writes → time_entry_change_requests, system_events (audit)
--
-- NOTES / GOTCHAS:
--   - notify_emit is inert until the catalog type is enabled and is fire-and-
--     forget (net.http_post) — a notify hiccup can never break a payroll write.
--   - timesheet.change_reviewed targets the requester via body.employee_id
--     (resolveAudience special-cases it in functions/api/notify.js).
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_time_entry_change_request(p_entry_id uuid, p_proposed jsonb, p_tech_note text, p_actor_id uuid)
RETURNS time_entry_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_e job_time_entries%ROWTYPE; v_req time_entry_change_requests%ROWTYPE; v_emp text;
begin
  select * into v_e from job_time_entries where id=p_entry_id;
  if v_e.id is null then raise exception 'ENTRY_NOT_FOUND' using errcode='P0001'; end if;
  if v_e.employee_id <> p_actor_id then raise exception 'NOT_OWNER' using errcode='P0001'; end if;
  insert into time_entry_change_requests (entry_id, requested_by, proposed, tech_note) values (p_entry_id, p_actor_id, coalesce(p_proposed,'{}'::jsonb), p_tech_note) returning * into v_req;
  select full_name into v_emp from employees where id=p_actor_id;
  perform notify_emit('timesheet.change_requested', jsonb_build_object(
    'title', 'Timesheet change requested',
    'body', coalesce(v_emp,'A tech')||' requested a correction to a time entry.',
    'link', '/time-tracking',
    'entity_type', 'time_entry_change_request',
    'entity_id', v_req.id,
    'job_id', v_e.job_id,
    'payload', jsonb_build_object('entry_id', p_entry_id, 'proposed', coalesce(p_proposed,'{}'::jsonb))
  ));
  return v_req;
end; $function$;

CREATE OR REPLACE FUNCTION public.review_time_entry_change_request(p_request_id uuid, p_approve boolean, p_actor_id uuid, p_review_note text DEFAULT NULL::text)
RETURNS time_entry_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_req time_entry_change_requests%ROWTYPE; v_e job_time_entries%ROWTYPE; v_p jsonb;
begin
  if not is_time_admin(p_actor_id) then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into v_req from time_entry_change_requests where id=p_request_id;
  if v_req.id is null then raise exception 'REQUEST_NOT_FOUND' using errcode='P0001'; end if;
  if v_req.status <> 'pending' then raise exception 'REQUEST_ALREADY_REVIEWED' using errcode='P0001'; end if;
  if p_approve then
    select * into v_e from job_time_entries where id=v_req.entry_id;
    if v_e.id is null then raise exception 'ENTRY_NOT_FOUND' using errcode='P0001'; end if;
    v_p := v_req.proposed;
    perform admin_upsert_time_entry(p_actor_id=>p_actor_id, p_id=>v_e.id, p_employee_id=>v_e.employee_id, p_job_id=>v_e.job_id,
      p_work_date=>coalesce((v_p->>'work_date')::date, v_e.work_date), p_hours=>coalesce((v_p->>'hours')::numeric, v_e.hours),
      p_clock_in=>coalesce((v_p->>'clock_in')::timestamptz, v_e.clock_in), p_clock_out=>coalesce((v_p->>'clock_out')::timestamptz, v_e.clock_out),
      p_travel_start=>v_e.travel_start, p_on_site_end=>v_e.on_site_end, p_travel_minutes=>coalesce((v_p->>'travel_minutes')::numeric, v_e.travel_minutes),
      p_total_paused_minutes=>v_e.total_paused_minutes, p_work_type=>v_e.work_type, p_description=>coalesce(v_p->>'description', v_e.description),
      p_notes=>coalesce(v_p->>'notes', v_e.notes), p_override_approved=>true);
  end if;
  update time_entry_change_requests set status=case when p_approve then 'approved' else 'rejected' end, reviewed_by=p_actor_id, review_note=p_review_note, reviewed_at=now() where id=p_request_id returning * into v_req;
  perform notify_emit('timesheet.change_reviewed', jsonb_build_object(
    'employee_id', v_req.requested_by,
    'title', case when p_approve then 'Timesheet change approved' else 'Timesheet change rejected' end,
    'body', coalesce(nullif(p_review_note,''), case when p_approve then 'Your requested correction was approved.' else 'Your requested correction was declined.' end),
    'link', '/time-tracking',
    'entity_type', 'time_entry_change_request',
    'entity_id', v_req.id,
    'payload', jsonb_build_object('entry_id', v_req.entry_id, 'approved', p_approve)
  ));
  insert into system_events (event_type, entity_type, entity_id, actor_id, job_id, payload) values ('time_entry.change_reviewed','time_entry_change_request', v_req.id, p_actor_id, null, jsonb_build_object('approved', p_approve, 'entry_id', v_req.entry_id));
  return v_req;
end; $function$;
