-- S1e executable behavior suite for a disposable, post-migration local clone.
-- Refuses the shared project and rolls every synthetic fixture back.
\if :{?UPR_ISOLATED_DB}
\else
\echo 'Set UPR_ISOLATED_DB=1 only for a disposable local clone.'
\quit
\endif

BEGIN;

DO $guard$
BEGIN
  ASSERT current_setting('upr.isolated_test_database', true) = 'on',
    'refusing non-isolated database';
  ASSERT to_regclass('public.inbound_lead_recording_sources') IS NOT NULL,
    'apply S1e to the disposable clone first';
END
$guard$;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 's1e-admin@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 's1e-office@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 's1e-denied@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 's1e-inactive@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 's1e-external@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 's1e-no-permission@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 's1e-role-allow@example.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.employees (
  id, auth_user_id, email, full_name, display_name, role, is_active, is_external
) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 's1e-admin@example.invalid', 'S1e Admin', 'S1e Admin', 'admin', true, false),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 's1e-office@example.invalid', 'S1e Office', 'S1e Office', 'office', true, false),
  ('e2000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000003', 's1e-denied@example.invalid', 'S1e Denied', 'S1e Denied', 'office', true, false),
  ('e2000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000004', 's1e-inactive@example.invalid', 'S1e Inactive', 'S1e Inactive', 'office', false, false),
  ('e2000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000005', 's1e-external@example.invalid', 'S1e External', 'S1e External', 'office', true, true),
  ('e2000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000006', 's1e-no-permission@example.invalid', 'S1e No Permission', 'S1e No Permission', 'office', true, false),
  ('e2000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000007', 's1e-role-allow@example.invalid', 'S1e Role Allow', 'S1e Role Allow', 'project_manager', true, false);

INSERT INTO public.employee_page_access (employee_id, nav_key, can_view)
VALUES
  ('e2000000-0000-4000-8000-000000000002', 'crm_call_log', true),
  ('e2000000-0000-4000-8000-000000000003', 'crm_call_log', false);

-- Make the absent-permission case deterministic; the transaction restores the
-- clone's role default at ROLLBACK.
DELETE FROM public.nav_permissions
WHERE role = 'office' AND nav_key = 'crm_call_log';
INSERT INTO public.nav_permissions (role, nav_key, can_view)
VALUES ('project_manager', 'crm_call_log', true)
ON CONFLICT (role, nav_key) DO UPDATE SET can_view = EXCLUDED.can_view;

INSERT INTO public.crm_orgs (id, name, is_test)
VALUES ('e3000000-0000-4000-8000-000000000001', 'S1e isolated fixture', true);

INSERT INTO public.inbound_leads (
  id, org_id, source_type, callrail_id, recording_url, raw_payload
) VALUES (
  'e4000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'call',
  's1e-isolated-call',
  'https://api.callrail.com/v3/a/fake/calls/CALsynthetic/recording.json',
  '{"recording":"synthetic","nested":{"recording_url":"synthetic","answered":true}}'
);

DO $trigger_assertions$
BEGIN
  ASSERT (
    SELECT recording_url = 'upr-recording://available'
    FROM public.inbound_leads
    WHERE id = 'e4000000-0000-4000-8000-000000000001'
  );
  ASSERT (
    SELECT raw_payload = '{"nested":{"answered":true}}'::jsonb
    FROM public.inbound_leads
    WHERE id = 'e4000000-0000-4000-8000-000000000001'
  );
  ASSERT (
    SELECT count(*) = 1
    FROM public.inbound_lead_recording_sources
    WHERE lead_id = 'e4000000-0000-4000-8000-000000000001'
  );
END
$trigger_assertions$;

CREATE FUNCTION pg_temp.set_test_actor(p_user_id uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
$$;

SET LOCAL ROLE authenticated;

SELECT pg_temp.set_test_actor('e1000000-0000-4000-8000-000000000001');
DO $admin_allowed$ BEGIN PERFORM public.get_inbound_leads(1); END $admin_allowed$;

SELECT pg_temp.set_test_actor('e1000000-0000-4000-8000-000000000002');
DO $office_allowed$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM public.inbound_leads
    WHERE id = 'e4000000-0000-4000-8000-000000000001'
  );
  PERFORM public.get_inbound_leads(1);
END
$office_allowed$;

SELECT pg_temp.set_test_actor('e1000000-0000-4000-8000-000000000007');
DO $role_allowed$ BEGIN PERFORM public.get_inbound_leads(1); END $role_allowed$;

CREATE FUNCTION pg_temp.assert_rpc_denied(p_user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.set_test_actor(p_user_id);
  BEGIN
    PERFORM public.get_inbound_leads(1);
    RAISE EXCEPTION 'expected get_inbound_leads denial';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

SELECT pg_temp.assert_rpc_denied('e1000000-0000-4000-8000-000000000003');
SELECT pg_temp.assert_rpc_denied('e1000000-0000-4000-8000-000000000004');
SELECT pg_temp.assert_rpc_denied('e1000000-0000-4000-8000-000000000005');
SELECT pg_temp.assert_rpc_denied('e1000000-0000-4000-8000-000000000006');

SELECT pg_temp.set_test_actor('e1000000-0000-4000-8000-000000000004');
DO $inactive_direct$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.inbound_leads
    WHERE id = 'e4000000-0000-4000-8000-000000000001'
  );
END
$inactive_direct$;

SELECT pg_temp.set_test_actor('e1000000-0000-4000-8000-000000000005');
DO $external_direct$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.inbound_leads
    WHERE id = 'e4000000-0000-4000-8000-000000000001'
  );
END
$external_direct$;

DO $authenticated_dml_denied$
BEGIN
  BEGIN
    DELETE FROM public.inbound_leads
    WHERE id = 'e4000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected direct DML denial';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$authenticated_dml_denied$;

RESET ROLE;
ROLLBACK;
