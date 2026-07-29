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
--   active Scope Sheet schema version (tests assert one exists).
--
-- TARGET (binding):
--   The qa-staging BRANCH ONLY (ref uizgwvkvzyldystqrcsk). NEVER production —
--   these are password-bearing test accounts. Apply via MCP execute_sql
--   against the branch ref, or psql against the branch connection string.
--   Idempotent: fixed UUIDs + ON CONFLICT, safe to re-run after a re-seed.
--
-- CREDENTIALS (test-only, deliberately committed):
--   qa-admin@upr-qa.test / qa-office@upr-qa.test / qa-tech@upr-qa.test
--   password for all three: UprQaFixture!2026
--   These are fixtures for an isolated test database, not secrets. If they
--   ever reach production, that is an incident — delete them there.
--
-- ROLLBACK:
--   delete from public.employees where id::text like 'aaaaaaaa-0000-4000-8000-0000000001%';
--   delete from auth.identities where user_id::text like 'aaaaaaaa-0000-4000-8000-0000000000%';
--   delete from auth.users where id::text like 'aaaaaaaa-0000-4000-8000-0000000000%';
--   delete from public.demo_sheet_schemas where id = 'aaaaaaaa-0000-4000-8000-000000000201';
-- ════════════════════════════════════════════════

begin;

-- ─── SECTION: auth users (password grant enabled) ──────────────
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'qa-admin@upr-qa.test',
   extensions.crypt('UprQaFixture!2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'qa-office@upr-qa.test',
   extensions.crypt('UprQaFixture!2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'qa-tech@upr-qa.test',
   extensions.crypt('UprQaFixture!2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
on conflict (id) do nothing;

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
-- Tests assert an active Scope Sheet schema exists (scope-sheet-rollback runbook).
insert into public.demo_sheet_schemas
  (id, version, name, is_active, definition, notes, published_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000201', 1, 'QA fixture baseline', true,
   '{"sections":[]}'::jsonb, 'qa-staging fixture — branch only', now())
on conflict (id) do nothing;

commit;
