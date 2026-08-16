-- ════════════════════════════════════════════════
-- FILE: supabase/seeds/qa-fixtures.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts a handful of fake people and settings into the LOCAL-ONLY database so
--   the app has something to show when you run it on your own laptop. It runs
--   right after the schema is loaded. Nothing here is real: no real customer,
--   no real phone number, no real key.
--
-- WHERE IT LIVES:
--   Loaded by:  supabase/config.toml → [db.seed].sql_paths, after
--               db/baseline/schema.sql
--
-- DEPENDS ON:
--   Internal:  db/baseline/schema.sql (must load first — it creates these tables)
--   Data:      reads  → none
--              writes → auth.users, public.employees, public.feature_flags
--
-- NOTES / GOTCHAS:
--   - REFUSES TO RUN outside a local stack. The guard below aborts unless the
--     `upr.local_stack` setting is on. `current_database()` is NOT a safe guard:
--     every Supabase database is named `postgres`, production included — the trap
--     recorded in initiative-status.md against two earlier proofs.
--   - Passwords are the fixed local string `qa-local-password`. That is safe ONLY
--     because this database never leaves your laptop and holds no real data.
--   - Emails use `@upr-qa.test`, matching the hosted qa-staging fixture names so a
--     test written against one runs against the other.
-- ════════════════════════════════════════════════

DO $$
BEGIN
  IF current_setting('upr.local_stack', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'REFUSING TO SEED: upr.local_stack is not ''on''. This file writes fixture rows and must never run against a hosted project.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- ─── SECTION: auth users ──────────────
-- Three roles, mirroring the hosted qa-staging fixtures.
-- The empty strings below are NOT decorative. GoTrue is Go, and it scans these
-- varchar columns into plain `string`, which cannot hold NULL: leaving any of
-- them unset makes every sign-in fail with a 500 and
--   `Scan error on column index 3, name "confirmation_token": converting NULL
--    to string is unsupported`
-- which surfaces at the client as the far less helpful "Database error querying
-- schema". The columns are nullable in the schema, so nothing warns you.
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token,
  created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('qa-local-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '',
  '', '', '',
  '', '', '',
  now(), now()
FROM (VALUES
  ('11111111-1111-4111-8111-111111111111'::uuid, 'qa-admin@upr-qa.test'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'qa-office@upr-qa.test'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'qa-tech@upr-qa.test')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

-- Identities — GoTrue needs one per user for password sign-in.
INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
SELECT
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email', now(), now(), now()
FROM auth.users u
WHERE u.email LIKE '%@upr-qa.test'
ON CONFLICT (provider, provider_id) DO NOTHING;

-- ─── SECTION: employees ──────────────
-- Two column traps, both verified against information_schema rather than assumed:
--   - the auth link is `auth_user_id`, NOT `user_id`
--   - `full_name` is NOT NULL (the column that broke the billing-boundary proof
--     on 2026-08-05, which inserted a `name` column that does not exist)
INSERT INTO public.employees (auth_user_id, full_name, display_name, email, role, is_active)
SELECT u.id, e.full_name, e.display_name, u.email, e.role::public.employee_role, true
FROM (VALUES
  ('qa-admin@upr-qa.test',  'QA Admin',  'QA Admin',  'admin'),
  ('qa-office@upr-qa.test', 'QA Office', 'QA Office', 'office'),
  ('qa-tech@upr-qa.test',   'QA Tech',   'QA Tech',   'field_tech')
) AS e(email, full_name, display_name, role)
JOIN auth.users u ON u.email = e.email
ON CONFLICT DO NOTHING;

-- ─── SECTION: feature flags ──────────────
-- `label` is NOT NULL (the trap found by the grouped-lines proof). Seeded with
-- ON CONFLICT rather than a bare UPDATE, which matches nothing on a clean clone.
INSERT INTO public.feature_flags (key, label, enabled)
VALUES
  ('page:crm',            'CRM',                  true),
  ('page:collections',    'Collections',          true),
  ('page:admin_mobile',   'Admin Mobile',         true),
  ('tool:oop_pricing',    'OOP Pricing',          true)
ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled;
