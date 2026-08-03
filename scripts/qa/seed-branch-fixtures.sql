-- ════════════════════════════════════════════════
-- FILE: scripts/qa/seed-branch-fixtures.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Creates the standing QA test identities and minimal reference data on the
--   qa-staging Supabase branch, so database tests can sign in as a real
--   employee instead of running as anonymous (which the hardened grants
--   correctly deny). Three fixture people — an admin, an office member and a
--   field tech — each an auth user bound to an active employees row, plus one
--   active Scope Sheet schema version, the minimal public CRM status fixture
--   required by the anonymous /status contract, and the five enabled notification
--   catalog rows needed to exercise the temporary producer-containment migration.
--
-- TARGET (binding):
--   The qa-staging BRANCH ONLY (ref uizgwvkvzyldystqrcsk). NEVER production —
--   these are password-bearing test accounts. Apply via MCP execute_sql
--   against the branch ref, or psql against the branch connection string.
--   Idempotent: fixed UUIDs + ON CONFLICT, safe to re-run after a re-seed.
--
-- CREDENTIALS:
--   qa-admin@upr-qa.test / qa-office@upr-qa.test / qa-tech@upr-qa.test
--   The password is never stored in this repository. Before running this script,
--   the operator must set the session-only `upr.qa_fixture_password_hash` custom
--   setting to a bcrypt hash supplied from owner-controlled secret storage.
--   These identities belong only on the isolated QA branch. If they ever reach
--   production, that is an incident — delete them there.
--
-- ROLLBACK:
--   delete from public.employees where id::text like 'aaaaaaaa-0000-4000-8000-0000000001%';
--   delete from auth.identities where user_id::text like 'aaaaaaaa-0000-4000-8000-0000000000%';
--   delete from auth.users where id::text like 'aaaaaaaa-0000-4000-8000-0000000000%';
--   delete from public.demo_sheet_schemas where id = 'aaaaaaaa-0000-4000-8000-000000000201';
--   delete from public.crm_orgs where id = 'aaaaaaaa-0000-4000-8000-000000000203';
--   delete from public.crm_build_phases where phase_key = '0';
--   delete from public.notification_types where type_key in
--     ('appointment.assigned', 'appointment.updated', 'appointment.canceled',
--      'timesheet.change_requested', 'timesheet.change_reviewed');
-- ════════════════════════════════════════════════

begin;

-- ─── SECTION: auth users (password grant enabled) ──────────────
do $$
declare
  v_password_hash text := current_setting('upr.qa_fixture_password_hash', true);
begin
  if v_password_hash is null or v_password_hash !~ '^\$2[aby]\$[0-9]{2}\$' then
    raise exception
      'qa fixture seed refused: set upr.qa_fixture_password_hash to a bcrypt hash for this session';
  end if;
end;
$$;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'qa-admin@upr-qa.test',
   current_setting('upr.qa_fixture_password_hash'), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'qa-office@upr-qa.test',
   current_setting('upr.qa_fixture_password_hash'), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'qa-tech@upr-qa.test',
   current_setting('upr.qa_fixture_password_hash'), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
on conflict (id) do update
  set encrypted_password = excluded.encrypted_password,
      updated_at = now();

insert into auth.identities
  (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email,
                          'email_verified', true, 'phone_verified', false),
       now(), now(), now()
from auth.users u
where u.email in ('qa-admin@upr-qa.test', 'qa-office@upr-qa.test', 'qa-tech@upr-qa.test')
  and not exists (
    select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
  );

-- ─── SECTION: employees bindings (selector-free identity resolution) ──────────────
insert into public.employees
  (id, full_name, display_name, email, role, is_active, auth_user_id,
   show_on_status_board, is_external)
values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'QA Admin (fixture)', 'QA Admin',
   'qa-admin@upr-qa.test', 'admin', true, 'aaaaaaaa-0000-4000-8000-000000000001', false, false),
  ('aaaaaaaa-0000-4000-8000-000000000102', 'QA Office (fixture)', 'QA Office',
   'qa-office@upr-qa.test', 'office', true, 'aaaaaaaa-0000-4000-8000-000000000002', false, false),
  ('aaaaaaaa-0000-4000-8000-000000000103', 'QA Tech (fixture)', 'QA Tech',
   'qa-tech@upr-qa.test', 'field_tech', true, 'aaaaaaaa-0000-4000-8000-000000000003', false, false)
on conflict (id) do update
  set auth_user_id = excluded.auth_user_id, is_active = true;

-- ─── SECTION: minimal reference data ──────────────
-- The CRM reporting suites use this fixed branch-only org instead of an
-- unscoped `is_test=true&limit=1` selector. Its ID is deliberately stable so
-- fixture writes cannot accidentally land on a different test row.
insert into public.crm_orgs (id, name, is_test)
values ('aaaaaaaa-0000-4000-8000-000000000203', 'Utah Pros — QA branch fixture', true)
on conflict (id) do update
  set name = excluded.name,
      is_test = true;

-- Tests assert an active Scope Sheet schema exists (scope-sheet-rollback runbook).
insert into public.demo_sheet_schemas
  (id, version, name, is_active, definition, notes, published_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000201', 1, 'QA fixture baseline', true,
   '{"sections":[]}'::jsonb, 'qa-staging fixture — branch only', now())
on conflict (id) do nothing;

-- The schema-only branch has no production CRM progress rows. Keep one minimal,
-- non-sensitive phase/stage pair so /status proves both public reachability and
-- its nested response shape without cloning production data.
insert into public.crm_build_phases
  (phase_key, title, status, sort_order)
values
  ('0', 'QA fixture progress tracking', 'planned', 0)
on conflict (phase_key) do update
  set title = excluded.title,
      status = excluded.status,
      sort_order = excluded.sort_order;

insert into public.crm_build_stages
  (id, phase_key, title, status, sort_order)
values
  ('aaaaaaaa-0000-4000-8000-000000000202', '0',
   'QA fixture public status contract', 'todo', 0)
on conflict (id) do update
  set phase_key = excluded.phase_key,
      title = excluded.title,
      status = excluded.status,
      sort_order = excluded.sort_order;

-- The branch currently has a schema-only notification catalog. Mirror only the
-- five production rows used by the containment rehearsal; all are enabled in
-- production at the verified pre-apply state.
insert into public.notification_types
  (type_key, label, description, category, audience, bell_default,
   push_default, email_default, enabled, sort_order)
values
  ('appointment.assigned', 'Appointment assigned',
   'You were added to an appointment''s crew.', 'appointments',
   'The crewed employee', true, true, false, true, 20),
  ('appointment.updated', 'Appointment updated',
   'An appointment you are on changed.', 'appointments',
   'Crew of the appointment', true, true, false, true, 21),
  ('appointment.canceled', 'Appointment canceled',
   'An appointment you are on was canceled.', 'appointments',
   'Crew of the appointment', true, true, false, true, 22),
  ('timesheet.change_requested', 'Timesheet change request',
   'A tech asked to change a timesheet.', 'admin',
   'Admins', true, false, false, true, 80),
  ('timesheet.change_reviewed', 'Timesheet change reviewed',
   'Your timesheet change request was reviewed.', 'admin',
   'The requesting employee', true, false, false, true, 81)
on conflict (type_key) do update
  set label = excluded.label,
      description = excluded.description,
      category = excluded.category,
      audience = excluded.audience,
      bell_default = excluded.bell_default,
      push_default = excluded.push_default,
      email_default = excluded.email_default,
      sort_order = excluded.sort_order;

select set_config('upr.qa_fixture_password_hash', '', false);

commit;
