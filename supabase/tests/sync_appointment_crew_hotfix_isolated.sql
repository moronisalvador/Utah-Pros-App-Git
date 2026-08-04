-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: sync_appointment_crew_hotfix_isolated.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   On a disposable local database only, proves the appointment-crew hotfix
--   writes crew_role values, keeps unchanged row ids, permits assigned staff,
--   and denies unrelated, anonymous, inactive, or external access.
--
-- DEPENDS ON:
--   Packages:  PostgreSQL, Supabase CLI
--   Internal:  20260804000042_sync_appointment_crew_enum_authorization_hotfix
--   Data:      writes disposable employees/jobs/appointments/crew, then ROLLBACK
--
-- NOTES / GOTCHAS:
--   The two isolation guards are mandatory. Never run this against a hosted or
--   shared database.
-- ═══════════════════════════════════════════════════════════════════════════

\if :{?UPR_ISOLATED_DB}
\else
\echo 'Set UPR_ISOLATED_DB=1 only for a disposable local clone.'
\quit 2
\endif

BEGIN;

DO $guard$
DECLARE
  v_body text;
BEGIN
  IF current_setting('upr.isolated_test_database', true)
     IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;

  SELECT procedure.prosrc
    INTO v_body
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'sync_appointment_crew'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      = 'p_appointment_id uuid, p_crew jsonb';

  IF position(
       'sync-crew-hotfix-20260804000042' IN COALESCE(v_body, '')
     ) = 0 THEN
    RAISE EXCEPTION
      'apply the appointment crew hotfix to the disposable clone first';
  END IF;
END;
$guard$;

DO $fixture_ids$
BEGIN
  PERFORM set_config(
    'upr.sch.auth_admin',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.auth_tech',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.auth_office',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.auth_other',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.auth_inactive',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.auth_external',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.employee_admin',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.employee_tech',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.employee_office',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.employee_other',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.employee_inactive',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.employee_external',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config('upr.sch.job', gen_random_uuid()::text, true);
  PERFORM set_config(
    'upr.sch.appointment',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.sch.private_appointment',
    gen_random_uuid()::text,
    true
  );
END;
$fixture_ids$;

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  current_setting(setting_key)::uuid,
  'authenticated',
  'authenticated',
  setting_key || '@example.invalid',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
FROM unnest(ARRAY[
  'upr.sch.auth_admin',
  'upr.sch.auth_tech',
  'upr.sch.auth_office',
  'upr.sch.auth_other',
  'upr.sch.auth_inactive',
  'upr.sch.auth_external'
]) setting_key;

INSERT INTO public.employees (
  id,
  full_name,
  email,
  auth_user_id,
  role,
  is_active,
  is_external
)
VALUES
  (
    current_setting('upr.sch.employee_admin')::uuid,
    '[SCH isolated] Admin',
    'sch-admin@example.invalid',
    current_setting('upr.sch.auth_admin')::uuid,
    'admin',
    true,
    false
  ),
  (
    current_setting('upr.sch.employee_tech')::uuid,
    '[SCH isolated] Assigned tech',
    'sch-tech@example.invalid',
    current_setting('upr.sch.auth_tech')::uuid,
    'field_tech',
    true,
    false
  ),
  (
    current_setting('upr.sch.employee_office')::uuid,
    '[SCH isolated] Office',
    'sch-office@example.invalid',
    current_setting('upr.sch.auth_office')::uuid,
    'office',
    true,
    false
  ),
  (
    current_setting('upr.sch.employee_other')::uuid,
    '[SCH isolated] Other tech',
    'sch-other@example.invalid',
    current_setting('upr.sch.auth_other')::uuid,
    'field_tech',
    true,
    false
  ),
  (
    current_setting('upr.sch.employee_inactive')::uuid,
    '[SCH isolated] Inactive tech',
    'sch-inactive@example.invalid',
    current_setting('upr.sch.auth_inactive')::uuid,
    'field_tech',
    false,
    false
  ),
  (
    current_setting('upr.sch.employee_external')::uuid,
    '[SCH isolated] External',
    'sch-external@example.invalid',
    current_setting('upr.sch.auth_external')::uuid,
    'crm_partner',
    true,
    true
  );

INSERT INTO public.jobs (id, insured_name)
VALUES (
  current_setting('upr.sch.job')::uuid,
  '[SCH isolated] Job'
);

INSERT INTO public.appointments (
  id,
  job_id,
  title,
  date,
  is_private
)
VALUES
  (
    current_setting('upr.sch.appointment')::uuid,
    current_setting('upr.sch.job')::uuid,
    '[SCH isolated] Appointment',
    CURRENT_DATE,
    false
  ),
  (
    current_setting('upr.sch.private_appointment')::uuid,
    current_setting('upr.sch.job')::uuid,
    '[SCH isolated] Private appointment',
    CURRENT_DATE,
    true
  );

INSERT INTO public.appointment_crew (
  appointment_id,
  employee_id,
  role
)
VALUES
  (
    current_setting('upr.sch.appointment')::uuid,
    current_setting('upr.sch.employee_tech')::uuid,
    'tech'
  ),
  (
    current_setting('upr.sch.private_appointment')::uuid,
    current_setting('upr.sch.employee_tech')::uuid,
    'tech'
  );

SELECT set_config(
  'upr.sch.crew_row',
  (
    SELECT crew.id::text
    FROM public.appointment_crew crew
    WHERE crew.appointment_id =
      current_setting('upr.sch.appointment')::uuid
      AND crew.employee_id =
        current_setting('upr.sch.employee_tech')::uuid
  ),
  true
);

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('upr.sch.auth_tech'),
  true
);

SELECT *
FROM public.sync_appointment_crew(
  current_setting('upr.sch.appointment')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'employee_id',
      current_setting('upr.sch.employee_tech'),
      'role',
      'lead'
    )
  )
);

DO $assert_enum_and_identity$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.appointment_crew crew
    WHERE crew.id = current_setting('upr.sch.crew_row')::uuid
      AND crew.appointment_id =
        current_setting('upr.sch.appointment')::uuid
      AND crew.employee_id =
        current_setting('upr.sch.employee_tech')::uuid
      AND crew.role = 'lead'::public.crew_role
  ) THEN
    RAISE EXCEPTION
      'crew row identity changed during role-only sync';
  END IF;
END;
$assert_enum_and_identity$;

DO $assert_anon_acl$
BEGIN
  IF has_function_privilege(
      'anon',
      'public.sync_appointment_crew(uuid,jsonb)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION
      'anonymous role retained sync_appointment_crew execution';
  END IF;
END;
$assert_anon_acl$;

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('upr.sch.auth_other'),
  true
);

DO $deny_unassigned$
BEGIN
  BEGIN
    PERFORM *
    FROM public.sync_appointment_crew(
      current_setting('upr.sch.appointment')::uuid,
      '[]'::jsonb
    );
    RAISE EXCEPTION
      'unassigned employee replaced appointment crew';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$deny_unassigned$;

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('upr.sch.auth_inactive'),
  true
);

DO $deny_inactive$
BEGIN
  BEGIN
    PERFORM *
    FROM public.sync_appointment_crew(
      current_setting('upr.sch.appointment')::uuid,
      '[]'::jsonb
    );
    RAISE EXCEPTION
      'inactive employee replaced appointment crew';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$deny_inactive$;

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('upr.sch.auth_external'),
  true
);

DO $deny_external_caller$
BEGIN
  BEGIN
    PERFORM *
    FROM public.sync_appointment_crew(
      current_setting('upr.sch.appointment')::uuid,
      '[]'::jsonb
    );
    RAISE EXCEPTION
      'external employee replaced appointment crew';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$deny_external_caller$;

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('upr.sch.auth_office'),
  true
);

DO $deny_office_private$
BEGIN
  BEGIN
    PERFORM *
    FROM public.sync_appointment_crew(
      current_setting('upr.sch.private_appointment')::uuid,
      '[]'::jsonb
    );
    RAISE EXCEPTION
      'office employee replaced private appointment crew';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$deny_office_private$;

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('upr.sch.auth_tech'),
  true
);

DO $deny_assigned_tech_private$
BEGIN
  BEGIN
    PERFORM *
    FROM public.sync_appointment_crew(
      current_setting('upr.sch.private_appointment')::uuid,
      '[]'::jsonb
    );
    RAISE EXCEPTION
      'assigned technician replaced private appointment crew';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$deny_assigned_tech_private$;

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('upr.sch.auth_admin'),
  true
);

DO $allow_admin_private$
BEGIN
  PERFORM *
  FROM public.sync_appointment_crew(
    current_setting('upr.sch.private_appointment')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'employee_id',
        current_setting('upr.sch.employee_tech'),
        'role',
        'lead'
      )
    )
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.appointment_crew crew
    WHERE crew.appointment_id =
      current_setting('upr.sch.private_appointment')::uuid
      AND crew.employee_id =
        current_setting('upr.sch.employee_tech')::uuid
      AND crew.role = 'lead'::public.crew_role
  ) THEN
    RAISE EXCEPTION
      'admin could not manage private appointment crew';
  END IF;
END;
$allow_admin_private$;

DO $deny_external_target$
BEGIN
  BEGIN
    PERFORM *
    FROM public.sync_appointment_crew(
      current_setting('upr.sch.appointment')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'employee_id',
          current_setting('upr.sch.employee_external'),
          'role',
          'tech'
        )
      )
    );
    RAISE EXCEPTION
      'external employee accepted as appointment crew';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$deny_external_target$;

SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);

DO $deny_anon$
BEGIN
  BEGIN
    PERFORM *
    FROM public.sync_appointment_crew(
      current_setting('upr.sch.appointment')::uuid,
      '[]'::jsonb
    );
    RAISE EXCEPTION
      'anonymous caller replaced appointment crew';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$deny_anon$;

ROLLBACK;
