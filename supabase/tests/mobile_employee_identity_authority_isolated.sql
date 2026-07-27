-- ═══════════════════════════════════════════════════════════════════════════════
-- Mobile employee identity authority + containment — ISOLATED DATABASE ONLY
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- NEVER run this behavior script against the shared UPR Supabase project.
-- It creates only synthetic auth/employee/access fixtures inside one transaction
-- and always ends with ROLLBACK.
--
-- Run only after applying BOTH reviewed steps to a disposable clone:
--   20260726180000_mobile_employee_identity_authority.sql
--   20260726182000_mobile_employee_identity_containment.sql
-- ═══════════════════════════════════════════════════════════════════════════════

\if :{?UPR_ISOLATED_DB}
\else
\echo 'Set UPR_ISOLATED_DB=1 only for a disposable local clone.'
\quit 2
\endif

BEGIN;

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true)
       IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_authority'
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_containment'
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'apply both employee identity migrations to the disposable clone first';
  END IF;

  IF to_regprocedure(
       'public.get_message_author_directory(uuid[])'
     ) IS NULL THEN
    RAISE EXCEPTION
      'historical message-author compatibility RPC is absent';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
         AND policyname = 'employees_self_identity_read'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'SELECT'
         AND qual = '(auth_user_id = auth.uid())'
         AND with_check IS NULL
     )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'SELECT'
        )
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR NOT has_column_privilege(
          'authenticated',
          'public.employees',
          'id',
          'SELECT'
        )
     OR NOT has_column_privilege(
          'authenticated',
          'public.employees',
          'auth_user_id',
          'SELECT'
        )
     OR NOT has_column_privilege(
          'authenticated',
          'public.employees',
          'role',
          'SELECT'
        )
     OR NOT has_column_privilege(
          'authenticated',
          'public.employees',
          'is_active',
          'SELECT'
        )
     OR has_column_privilege(
          'authenticated',
          'public.employees',
          'full_name',
          'SELECT'
        ) THEN
    RAISE EXCEPTION
      'employee identity containment policy or column ACL is absent';
  END IF;
END;
$guard$;

CREATE FUNCTION pg_temp.expect_sqlstate(
  p_label text,
  p_sql text,
  p_expected_state text DEFAULT '42501'
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_actual_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_actual_state = RETURNED_SQLSTATE;
      IF v_actual_state = p_expected_state THEN
        RETURN;
      END IF;

      RAISE EXCEPTION
        'expected SQLSTATE % for %, got %',
        p_expected_state,
        p_label,
        v_actual_state;
  END;

  RAISE EXCEPTION
    'expected SQLSTATE % but statement succeeded: %',
    p_expected_state,
    p_label;
END;
$function$;

CREATE FUNCTION pg_temp.set_identity_actor(
  p_user_id uuid,
  p_role text DEFAULT 'authenticated'
)
RETURNS void
LANGUAGE sql
AS $function$
  SELECT set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      p_user_id,
      'role',
      p_role
    )::text,
    true
  );
$function$;

DO $fixture_ids$
BEGIN
  PERFORM set_config('upr.identity.employee_a', gen_random_uuid()::text, true);
  PERFORM set_config('upr.identity.employee_b', gen_random_uuid()::text, true);
  PERFORM set_config(
    'upr.identity.employee_admin',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.employee_inactive',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.employee_external',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.employee_service',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config('upr.identity.auth_a', gen_random_uuid()::text, true);
  PERFORM set_config('upr.identity.auth_b', gen_random_uuid()::text, true);
  PERFORM set_config(
    'upr.identity.auth_admin',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.auth_inactive',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.auth_external',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.auth_unmapped',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.auth_service_fixture',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.conversation',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.message_note',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.identity.message_outbound',
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
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.identity.auth_a')::uuid,
    'authenticated',
    'authenticated',
    'identity-a@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.identity.auth_b')::uuid,
    'authenticated',
    'authenticated',
    'identity-b@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.identity.auth_admin')::uuid,
    'authenticated',
    'authenticated',
    'identity-admin@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.identity.auth_inactive')::uuid,
    'authenticated',
    'authenticated',
    'identity-inactive@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.identity.auth_external')::uuid,
    'authenticated',
    'authenticated',
    'identity-external@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.identity.auth_unmapped')::uuid,
    'authenticated',
    'authenticated',
    'identity-unmapped@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.identity.auth_service_fixture')::uuid,
    'authenticated',
    'authenticated',
    'identity-service-fixture@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

INSERT INTO public.employees (
  id,
  full_name,
  display_name,
  email,
  phone,
  auth_user_id,
  role,
  is_active,
  is_external,
  hourly_rate,
  overtime_rate,
  commission_percent,
  commission_flat
)
VALUES
  (
    current_setting('upr.identity.employee_a')::uuid,
    '[Identity isolated] Employee A',
    'Identity A',
    'identity-a@example.invalid',
    '+15555550101',
    current_setting('upr.identity.auth_a')::uuid,
    'field_tech',
    true,
    false,
    25,
    37.5,
    NULL,
    NULL
  ),
  (
    current_setting('upr.identity.employee_b')::uuid,
    '[Identity isolated] Employee B',
    'Identity B',
    'identity-b@example.invalid',
    '+15555550102',
    current_setting('upr.identity.auth_b')::uuid,
    'project_manager',
    true,
    false,
    30,
    45,
    NULL,
    NULL
  ),
  (
    current_setting('upr.identity.employee_admin')::uuid,
    '[Identity isolated] Admin',
    'Identity Admin',
    'identity-admin@example.invalid',
    '+15555550103',
    current_setting('upr.identity.auth_admin')::uuid,
    'admin',
    true,
    false,
    40,
    60,
    NULL,
    NULL
  ),
  (
    current_setting('upr.identity.employee_inactive')::uuid,
    '[Identity isolated] Inactive',
    'Identity Inactive',
    'identity-inactive@example.invalid',
    '+15555550104',
    current_setting('upr.identity.auth_inactive')::uuid,
    'office',
    false,
    false,
    20,
    30,
    NULL,
    NULL
  ),
  (
    current_setting('upr.identity.employee_external')::uuid,
    '[Identity isolated] External',
    'Identity External',
    'identity-external@example.invalid',
    '+15555550105',
    current_setting('upr.identity.auth_external')::uuid,
    'crm_partner',
    true,
    true,
    15,
    22.5,
    NULL,
    NULL
  );

INSERT INTO public.conversations (
  id,
  type,
  title,
  status
)
VALUES (
  current_setting('upr.identity.conversation')::uuid,
  'direct',
  '[Identity isolated] Historical author',
  'resolved'
);

INSERT INTO public.messages (
  id,
  conversation_id,
  type,
  body,
  status,
  sent_by,
  direction
)
VALUES
  (
    current_setting('upr.identity.message_note')::uuid,
    current_setting('upr.identity.conversation')::uuid,
    'internal_note',
    '[Identity isolated] Former employee note',
    'sent',
    current_setting('upr.identity.employee_inactive')::uuid,
    'note'
  ),
  (
    current_setting('upr.identity.message_outbound')::uuid,
    current_setting('upr.identity.conversation')::uuid,
    'sms_outbound',
    '[Identity isolated] Non-note author control',
    'sent',
    current_setting('upr.identity.employee_external')::uuid,
    'outbound'
  );

-- Make the Settings and Conversations capability matrices deterministic. The
-- transaction restores clone configuration at ROLLBACK.
UPDATE public.feature_flags
SET force_disabled = false
WHERE key IN ('page:settings', 'page:conversations');

INSERT INTO public.employee_page_access (
  employee_id,
  nav_key,
  can_view
)
VALUES
  (
    current_setting('upr.identity.employee_a')::uuid,
    'settings',
    false
  ),
  (
    current_setting('upr.identity.employee_b')::uuid,
    'settings',
    true
  ),
  (
    current_setting('upr.identity.employee_a')::uuid,
    'conversations',
    true
  )
ON CONFLICT (employee_id, nav_key)
DO UPDATE SET can_view = EXCLUDED.can_view;

SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(
  current_setting('upr.identity.auth_a')::uuid
);

DO $active_profile_and_directory$
DECLARE
  v_profile record;
BEGIN
  IF (
    SELECT count(*)
    FROM public.get_my_employee_profile()
  ) <> 1 THEN
    RAISE EXCEPTION 'active caller did not receive exactly one profile';
  END IF;

  SELECT *
    INTO v_profile
  FROM public.get_my_employee_profile();

  IF v_profile.id IS DISTINCT FROM
       current_setting('upr.identity.employee_a')::uuid
     OR v_profile.full_name IS DISTINCT FROM
       '[Identity isolated] Employee A'
     OR v_profile.email IS DISTINCT FROM 'identity-a@example.invalid'
     OR v_profile.role IS DISTINCT FROM 'field_tech'
     OR NOT v_profile.is_active
     OR v_profile.is_external THEN
    RAISE EXCEPTION 'selector-safe employee profile shape/value drift';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.get_employee_directory(false) employee
       WHERE employee.id =
         current_setting('upr.identity.employee_a')::uuid
         AND employee.full_name = '[Identity isolated] Employee A'
         AND employee.role = 'field_tech'
         AND employee.is_active
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_employee_directory(false) employee
       WHERE employee.id =
         current_setting('upr.identity.employee_b')::uuid
         AND employee.full_name = '[Identity isolated] Employee B'
         AND employee.role = 'project_manager'
         AND employee.is_active
     )
     OR EXISTS (
       SELECT 1
       FROM public.get_employee_directory(false) employee
       WHERE employee.id =
         current_setting('upr.identity.employee_inactive')::uuid
     ) THEN
    RAISE EXCEPTION 'safe active employee directory behavior drift';
  END IF;
END;
$active_profile_and_directory$;

DO $historical_message_author$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM public.get_message_author_directory(
         ARRAY[
           current_setting('upr.identity.message_note')::uuid,
           current_setting('upr.identity.message_note')::uuid,
           current_setting('upr.identity.message_outbound')::uuid
         ]
       ) author
       WHERE author.id =
               current_setting('upr.identity.employee_inactive')::uuid
         AND author.full_name = '[Identity isolated] Inactive'
         AND author.display_name = 'Identity Inactive'
     )
     OR EXISTS (
       SELECT 1
       FROM public.get_message_author_directory(
         ARRAY[
           current_setting('upr.identity.message_outbound')::uuid
         ]
       )
     ) THEN
    RAISE EXCEPTION
      'historical internal-note author attribution compatibility failed';
  END IF;
END;
$historical_message_author$;

SELECT pg_temp.expect_sqlstate(
  'message-author null selector',
  'SELECT * FROM public.get_message_author_directory(NULL::uuid[])',
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'message-author null array element',
  format(
    'SELECT * FROM public.get_message_author_directory(ARRAY[%L::uuid, NULL::uuid])',
    current_setting('upr.identity.message_note')
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'message-author oversized selector',
  'SELECT * FROM public.get_message_author_directory(array_fill(gen_random_uuid(), ARRAY[201]))',
  '22023'
);

DO $self_only_direct_identity_read$
BEGIN
  IF (
       SELECT count(*)
       FROM public.employees employee
       WHERE employee.id =
         current_setting('upr.identity.employee_a')::uuid
         AND employee.auth_user_id =
           current_setting('upr.identity.auth_a')::uuid
         AND employee.role::text = 'field_tech'
         AND employee.is_active
     ) <> 1 THEN
    RAISE EXCEPTION
      'authenticated self identity-column read failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id =
      current_setting('upr.identity.employee_b')::uuid
  ) THEN
    RAISE EXCEPTION
      'foreign employee identity row leaked through direct SELECT';
  END IF;
END;
$self_only_direct_identity_read$;

SELECT pg_temp.expect_sqlstate(
  'authenticated full-name column read',
  format(
    'SELECT full_name FROM public.employees WHERE id = %L::uuid',
    current_setting('upr.identity.employee_a')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated employee select star',
  format(
    'SELECT * FROM public.employees WHERE id = %L::uuid',
    current_setting('upr.identity.employee_a')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated self-binding insert',
  format(
    $sql$
      INSERT INTO public.employees (
        id,
        full_name,
        email,
        auth_user_id,
        role,
        is_active,
        is_external
      )
      VALUES (
        %L::uuid,
        '[Identity isolated] Self bind',
        'identity-self-bind@example.invalid',
        %L::uuid,
        'admin',
        true,
        false
      )
    $sql$,
    gen_random_uuid(),
    current_setting('upr.identity.auth_unmapped')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated own role promotion',
  format(
    'UPDATE public.employees SET role = %L WHERE id = %L::uuid',
    'admin',
    current_setting('upr.identity.employee_a')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated own Auth binding change',
  format(
    'UPDATE public.employees SET auth_user_id = %L::uuid WHERE id = %L::uuid',
    current_setting('upr.identity.auth_unmapped'),
    current_setting('upr.identity.employee_a')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated own active-state change',
  format(
    'UPDATE public.employees SET is_active = false WHERE id = %L::uuid',
    current_setting('upr.identity.employee_a')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated own external-state change',
  format(
    'UPDATE public.employees SET is_external = true WHERE id = %L::uuid',
    current_setting('upr.identity.employee_a')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated foreign-row binding',
  format(
    'UPDATE public.employees SET auth_user_id = %L::uuid WHERE id = %L::uuid',
    current_setting('upr.identity.auth_a'),
    current_setting('upr.identity.employee_b')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated employee delete',
  format(
    'DELETE FROM public.employees WHERE id = %L::uuid',
    current_setting('upr.identity.employee_b')
  )
);

SELECT pg_temp.expect_sqlstate(
  'authenticated employee truncate',
  'TRUNCATE TABLE public.employees'
);

SELECT pg_temp.expect_sqlstate(
  'field employee inactive directory',
  'SELECT * FROM public.get_employee_directory(true)'
);

SELECT pg_temp.expect_sqlstate(
  'non-admin all-employee HR read',
  'SELECT public.get_all_employees()'
);

SELECT pg_temp.expect_sqlstate(
  'settings-denied commission read',
  'SELECT * FROM public.get_employee_commissions()'
);

SELECT pg_temp.expect_sqlstate(
  'settings-denied commission write',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, 5, NULL)',
    current_setting('upr.identity.employee_a')
  )
);

SELECT pg_temp.expect_sqlstate(
  'private Settings capability helper',
  'SELECT public.can_current_employee_access_settings()'
);

SELECT pg_temp.set_identity_actor(
  current_setting('upr.identity.auth_unmapped')::uuid
);

DO $unmapped_identity$
BEGIN
  IF (
       SELECT count(*)
       FROM public.get_my_employee_profile()
     ) <> 0
     OR EXISTS (
       SELECT 1
       FROM public.employees
     ) THEN
    RAISE EXCEPTION
      'unmapped authenticated identity received an employee mapping';
  END IF;
END;
$unmapped_identity$;

SELECT pg_temp.expect_sqlstate(
  'unmapped employee directory',
  'SELECT * FROM public.get_employee_directory(false)'
);

SELECT pg_temp.expect_sqlstate(
  'unmapped historical message author',
  format(
    'SELECT * FROM public.get_message_author_directory(ARRAY[%L::uuid])',
    current_setting('upr.identity.message_note')
  )
);

SELECT pg_temp.set_identity_actor(
  current_setting('upr.identity.auth_inactive')::uuid
);

DO $inactive_identity$
BEGIN
  IF (
    SELECT count(*)
    FROM public.get_my_employee_profile()
  ) <> 0 THEN
    RAISE EXCEPTION 'inactive identity received an active profile';
  END IF;
END;
$inactive_identity$;

SELECT pg_temp.expect_sqlstate(
  'inactive employee directory',
  'SELECT * FROM public.get_employee_directory(false)'
);

SELECT pg_temp.expect_sqlstate(
  'inactive historical message author',
  format(
    'SELECT * FROM public.get_message_author_directory(ARRAY[%L::uuid])',
    current_setting('upr.identity.message_note')
  )
);

SELECT pg_temp.set_identity_actor(
  current_setting('upr.identity.auth_external')::uuid
);

DO $external_profile_and_active_directory$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM public.get_my_employee_profile() employee
       WHERE employee.id =
         current_setting('upr.identity.employee_external')::uuid
         AND employee.role = 'crm_partner'
         AND employee.is_external
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_employee_directory(false) employee
       WHERE employee.id =
         current_setting('upr.identity.employee_a')::uuid
     ) THEN
    RAISE EXCEPTION
      'active external profile or safe active directory compatibility failed';
  END IF;
END;
$external_profile_and_active_directory$;

SELECT pg_temp.expect_sqlstate(
  'external inactive directory',
  'SELECT * FROM public.get_employee_directory(true)'
);

SELECT pg_temp.expect_sqlstate(
  'external all-employee HR read',
  'SELECT public.get_all_employees()'
);

SELECT pg_temp.expect_sqlstate(
  'external historical message author',
  format(
    'SELECT * FROM public.get_message_author_directory(ARRAY[%L::uuid])',
    current_setting('upr.identity.message_note')
  )
);

SELECT pg_temp.set_identity_actor(
  current_setting('upr.identity.auth_b')::uuid
);

DO $time_admin_and_settings_allow$
DECLARE
  v_result public.employees;
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM public.get_employee_directory(true) employee
       WHERE employee.id =
         current_setting('upr.identity.employee_inactive')::uuid
         AND NOT employee.is_active
     ) THEN
    RAISE EXCEPTION
      'time-admin inactive employee directory compatibility failed';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.get_employee_commissions() employee
       WHERE employee.id =
         current_setting('upr.identity.employee_b')::uuid
     ) THEN
    RAISE EXCEPTION
      'Settings-capable commission read compatibility failed';
  END IF;

  SELECT result.*
    INTO v_result
  FROM public.upsert_employee_commission(
    current_setting('upr.identity.employee_b')::uuid,
    12.5,
    NULL
  ) result;

  IF v_result.id IS DISTINCT FROM
       current_setting('upr.identity.employee_b')::uuid
     OR v_result.commission_percent IS DISTINCT FROM 12.5
     OR v_result.commission_flat IS NOT NULL
     OR v_result.auth_user_id IS NOT NULL
     OR v_result.email IS NOT NULL
     OR v_result.phone IS NOT NULL
     OR v_result.hourly_rate IS NOT NULL
     OR v_result.overtime_rate IS NOT NULL THEN
    RAISE EXCEPTION
      'browser commission result compatibility/redaction failed';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.get_employee_commissions() employee
       WHERE employee.id =
         current_setting('upr.identity.employee_b')::uuid
         AND employee.commission_percent = 12.5
         AND employee.commission_flat IS NULL
     ) THEN
    RAISE EXCEPTION
      'valid commission update did not persist inside the transaction';
  END IF;
END;
$time_admin_and_settings_allow$;

SELECT pg_temp.expect_sqlstate(
  'commission percent and flat together',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, 5, 10)',
    current_setting('upr.identity.employee_b')
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'commission percent above 100',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, 100.01, NULL)',
    current_setting('upr.identity.employee_b')
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'commission percent NaN',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, %L::numeric, NULL)',
    current_setting('upr.identity.employee_b'),
    'NaN'
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'commission percent positive infinity',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, %L::numeric, NULL)',
    current_setting('upr.identity.employee_b'),
    'Infinity'
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'commission percent negative infinity',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, %L::numeric, NULL)',
    current_setting('upr.identity.employee_b'),
    '-Infinity'
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'negative flat commission',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, NULL, -0.01)',
    current_setting('upr.identity.employee_b')
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'flat commission NaN',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, NULL, %L::numeric)',
    current_setting('upr.identity.employee_b'),
    'NaN'
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'flat commission positive infinity',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, NULL, %L::numeric)',
    current_setting('upr.identity.employee_b'),
    'Infinity'
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'flat commission negative infinity',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, NULL, %L::numeric)',
    current_setting('upr.identity.employee_b'),
    '-Infinity'
  ),
  '22023'
);

SELECT pg_temp.expect_sqlstate(
  'missing commission employee',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, 5, NULL)',
    gen_random_uuid()
  ),
  '22023'
);

SELECT pg_temp.set_identity_actor(
  current_setting('upr.identity.auth_admin')::uuid
);

DO $admin_sensitive_rpc_compatibility$
DECLARE
  v_all jsonb;
BEGIN
  SELECT public.get_all_employees()
    INTO v_all;

  IF NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_all) employee
       WHERE (employee ->> 'id')::uuid =
               current_setting('upr.identity.employee_a')::uuid
         AND (employee ->> 'auth_user_id')::uuid =
               current_setting('upr.identity.auth_a')::uuid
         AND (employee ->> 'hourly_rate')::numeric = 25
         AND employee ->> 'email' = 'identity-a@example.invalid'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_employee_commissions() employee
       WHERE employee.id =
         current_setting('upr.identity.employee_b')::uuid
         AND employee.commission_percent = 12.5
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_employee_directory(true) employee
       WHERE employee.id =
         current_setting('upr.identity.employee_inactive')::uuid
     ) THEN
    RAISE EXCEPTION
      'admin employee/pay/commission compatibility failed';
  END IF;
END;
$admin_sensitive_rpc_compatibility$;

SET LOCAL ROLE anon;
SELECT pg_temp.set_identity_actor(NULL, 'anon');

SELECT pg_temp.expect_sqlstate(
  'anonymous employee select',
  format(
    'SELECT id FROM public.employees WHERE id = %L::uuid',
    current_setting('upr.identity.employee_a')
  )
);

SELECT pg_temp.expect_sqlstate(
  'anonymous employee insert',
  format(
    $sql$
      INSERT INTO public.employees (
        id,
        full_name,
        email,
        role,
        is_active,
        is_external
      )
      VALUES (
        %L::uuid,
        '[Identity isolated] Anonymous',
        'identity-anon@example.invalid',
        'field_tech',
        true,
        false
      )
    $sql$,
    gen_random_uuid()
  )
);

SELECT pg_temp.expect_sqlstate(
  'anonymous profile RPC',
  'SELECT * FROM public.get_my_employee_profile()'
);

SELECT pg_temp.expect_sqlstate(
  'anonymous directory RPC',
  'SELECT * FROM public.get_employee_directory(false)'
);

SELECT pg_temp.expect_sqlstate(
  'anonymous historical message-author RPC',
  format(
    'SELECT * FROM public.get_message_author_directory(ARRAY[%L::uuid])',
    current_setting('upr.identity.message_note')
  )
);

SELECT pg_temp.expect_sqlstate(
  'anonymous all-employee HR RPC',
  'SELECT public.get_all_employees()'
);

SELECT pg_temp.expect_sqlstate(
  'anonymous commission read RPC',
  'SELECT * FROM public.get_employee_commissions()'
);

SELECT pg_temp.expect_sqlstate(
  'anonymous commission write RPC',
  format(
    'SELECT * FROM public.upsert_employee_commission(%L::uuid, 5, NULL)',
    current_setting('upr.identity.employee_a')
  )
);

SET LOCAL ROLE service_role;
SELECT pg_temp.set_identity_actor(NULL, 'service_role');

INSERT INTO public.employees (
  id,
  full_name,
  display_name,
  email,
  phone,
  auth_user_id,
  role,
  is_active,
  is_external,
  hourly_rate,
  overtime_rate
)
VALUES (
  current_setting('upr.identity.employee_service')::uuid,
  '[Identity isolated] Service fixture',
  'Identity Service',
  'identity-service-fixture@example.invalid',
  '+15555550106',
  current_setting('upr.identity.auth_service_fixture')::uuid,
  'field_tech',
  true,
  false,
  35,
  52.5
);

DO $service_rpc_compatibility$
DECLARE
  v_all jsonb;
  v_result public.employees;
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM public.get_employee_directory(true) employee
       WHERE employee.id =
         current_setting('upr.identity.employee_inactive')::uuid
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_employee_commissions() employee
       WHERE employee.id =
         current_setting('upr.identity.employee_a')::uuid
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_message_author_directory(
         ARRAY[current_setting('upr.identity.message_note')::uuid]
       ) author
       WHERE author.id =
         current_setting('upr.identity.employee_inactive')::uuid
     ) THEN
    RAISE EXCEPTION
      'service-role employee directory/commission/message-author read compatibility failed';
  END IF;

  SELECT public.get_all_employees()
    INTO v_all;
  IF NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_all) employee
       WHERE (employee ->> 'id')::uuid =
         current_setting('upr.identity.employee_service')::uuid
     ) THEN
    RAISE EXCEPTION
      'service-role full employee RPC compatibility failed';
  END IF;

  SELECT result.*
    INTO v_result
  FROM public.upsert_employee_commission(
    current_setting('upr.identity.employee_a')::uuid,
    NULL,
    55
  ) result;

  IF v_result.auth_user_id IS DISTINCT FROM
       current_setting('upr.identity.auth_a')::uuid
     OR v_result.email IS DISTINCT FROM 'identity-a@example.invalid'
     OR v_result.phone IS DISTINCT FROM '+15555550101'
     OR v_result.hourly_rate IS DISTINCT FROM 25
     OR v_result.overtime_rate IS DISTINCT FROM 37.5
     OR v_result.commission_percent IS NOT NULL
     OR v_result.commission_flat IS DISTINCT FROM 55 THEN
    RAISE EXCEPTION
      'service-role full commission result compatibility failed';
  END IF;
END;
$service_rpc_compatibility$;

SELECT pg_temp.set_identity_actor(
  current_setting('upr.identity.auth_service_fixture')::uuid,
  'service_role'
);

DO $service_profile_and_direct_mutation$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM public.get_my_employee_profile() employee
       WHERE employee.id =
         current_setting('upr.identity.employee_service')::uuid
     ) THEN
    RAISE EXCEPTION
      'service-role selector-safe profile compatibility failed';
  END IF;
END;
$service_profile_and_direct_mutation$;

UPDATE public.employees
SET role = 'office',
    is_active = false,
    is_external = true
WHERE id = current_setting('upr.identity.employee_service')::uuid;

DO $service_role_fixture_proof$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.employees
    WHERE id = current_setting('upr.identity.employee_service')::uuid
      AND role::text = 'office'
      AND NOT is_active
      AND is_external
  ) THEN
    RAISE EXCEPTION
      'service-role employee mutation compatibility failed';
  END IF;
END;
$service_role_fixture_proof$;

DELETE FROM public.employees
WHERE id = current_setting('upr.identity.employee_service')::uuid;

DO $service_role_delete_proof$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.employees
    WHERE id = current_setting('upr.identity.employee_service')::uuid
  ) THEN
    RAISE EXCEPTION
      'service-role employee delete compatibility failed';
  END IF;
END;
$service_role_delete_proof$;

RESET ROLE;
ROLLBACK;
