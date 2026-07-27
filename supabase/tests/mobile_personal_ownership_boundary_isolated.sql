-- ═══════════════════════════════════════════════════════════════════════════════
-- S1h mobile personal ownership boundary — ISOLATED DATABASE ONLY
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- NEVER run this behavior script against the shared UPR Supabase project.
-- It inserts synthetic auth users, employees, preferences, subscriptions, and
-- device tokens inside one transaction and always ends with ROLLBACK.
--
-- Run only through the governed local runner after applying:
--   20260726220000_permission_write_gates.sql
--   20260726180000_mobile_employee_identity_authority.sql
--   20260726182000_mobile_employee_identity_containment.sql
--   the forward migration named
--     upsert_employee_page_access_provenance_reconciliation
--   20260727022920_mobile_personal_ownership_boundary.sql
-- The permission gate records source replay version 20260726220000 locally;
-- the shared project instead uses its live-assigned version 20260727012825.
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

  IF to_regprocedure(
       'public.is_current_active_internal_employee(uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'apply S1h to the disposable clone first';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations
       WHERE name = 'permission_write_gates'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM supabase_migrations.schema_migrations
       WHERE name = 'permission_write_gates'
         AND version IN ('20260726220000', '20260727012825')
     )
     OR (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations
       WHERE name =
         'upsert_employee_page_access_provenance_reconciliation'
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM pg_proc procedure
       JOIN pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = 'upsert_employee_page_access'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_language language ON language.oid = procedure.prolang
       JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = to_regprocedure(
         'public.upsert_employee_page_access(uuid,text,boolean,uuid)'
       )
         AND language.lanname = 'plpgsql'
         AND owner_role.rolname = 'postgres'
         AND pg_get_function_arguments(procedure.oid) =
               'p_employee_id uuid, p_nav_key text, p_can_view boolean, p_updated_by uuid DEFAULT NULL::uuid'
         AND pg_get_function_result(procedure.oid) =
               'employee_page_access'
         AND procedure.prosecdef
         AND NOT procedure.proisstrict
         AND NOT procedure.proleakproof
         AND procedure.provolatile = 'v'
         AND procedure.proparallel = 'u'
         AND procedure.prokind = 'f'
         AND procedure.proconfig =
               ARRAY['search_path=public, extensions, pg_temp']::text[]
         AND md5(procedure.prosrc) =
               '16e440632831b52155d5a9c6ba7b21a3'
     )
     OR (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations
       WHERE name = 'mobile_employee_identity_containment'
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
         AND policyname = 'employees_self_identity_read'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'SELECT'
         AND qual = '(auth_user_id = auth.uid())'
         AND with_check IS NULL
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
     ) IS DISTINCT FROM 1
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR has_column_privilege(
          'authenticated',
          'public.employees',
          'id',
          'SELECT'
        ) IS DISTINCT FROM true
     OR has_column_privilege(
          'authenticated',
          'public.employees',
          'auth_user_id',
          'SELECT'
        ) IS DISTINCT FROM true
     OR has_column_privilege(
          'authenticated',
          'public.employees',
          'role',
          'SELECT'
        ) IS DISTINCT FROM true
     OR has_column_privilege(
          'authenticated',
          'public.employees',
          'is_active',
          'SELECT'
        ) IS DISTINCT FROM true
     OR has_column_privilege(
          'authenticated',
          'public.employees',
          'full_name',
          'SELECT'
        ) THEN
    RAISE EXCEPTION
      'apply the exact employee identity containment boundary first';
  END IF;
END;
$guard$;

CREATE FUNCTION pg_temp.expect_sqlstate(
  p_sql text,
  p_expected_state text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_actual_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_state = RETURNED_SQLSTATE;
    IF v_actual_state = p_expected_state THEN
      RETURN;
    END IF;

    RAISE EXCEPTION
      'expected SQLSTATE %, got % for %',
      p_expected_state,
      v_actual_state,
      p_sql;
  END;

  RAISE EXCEPTION
    'expected SQLSTATE % but statement succeeded: %',
    p_expected_state,
    p_sql;
END;
$function$;

DO $fixture_ids$
BEGIN
  PERFORM set_config('upr.s1h.employee_a', gen_random_uuid()::text, true);
  PERFORM set_config('upr.s1h.employee_b', gen_random_uuid()::text, true);
  PERFORM set_config(
    'upr.s1h.employee_inactive',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.employee_external',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.employee_crm_partner_marker_mismatch',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.employee_admin',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.employee_project_manager',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config('upr.s1h.auth_a', gen_random_uuid()::text, true);
  PERFORM set_config('upr.s1h.auth_b', gen_random_uuid()::text, true);
  PERFORM set_config(
    'upr.s1h.auth_inactive',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.auth_external',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.auth_crm_partner_marker_mismatch',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.auth_admin',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.auth_project_manager',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1h.auth_unmapped',
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
    current_setting('upr.s1h.auth_a')::uuid,
    'authenticated',
    'authenticated',
    's1h-active-a@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1h.auth_b')::uuid,
    'authenticated',
    'authenticated',
    's1h-active-b@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1h.auth_inactive')::uuid,
    'authenticated',
    'authenticated',
    's1h-inactive@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1h.auth_external')::uuid,
    'authenticated',
    'authenticated',
    's1h-external@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1h.auth_crm_partner_marker_mismatch')::uuid,
    'authenticated',
    'authenticated',
    's1h-crm-partner-marker-mismatch@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1h.auth_admin')::uuid,
    'authenticated',
    'authenticated',
    's1h-admin@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1h.auth_project_manager')::uuid,
    'authenticated',
    'authenticated',
    's1h-project-manager@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1h.auth_unmapped')::uuid,
    'authenticated',
    'authenticated',
    's1h-unmapped@example.invalid',
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
  role,
  auth_user_id,
  is_active,
  is_external
)
VALUES
  (
    current_setting('upr.s1h.employee_a')::uuid,
    '[S1h isolated] active A',
    'field_tech',
    current_setting('upr.s1h.auth_a')::uuid,
    true,
    false
  ),
  (
    current_setting('upr.s1h.employee_b')::uuid,
    '[S1h isolated] active B',
    'office',
    current_setting('upr.s1h.auth_b')::uuid,
    true,
    false
  ),
  (
    current_setting('upr.s1h.employee_inactive')::uuid,
    '[S1h isolated] inactive',
    'admin',
    current_setting('upr.s1h.auth_inactive')::uuid,
    false,
    false
  ),
  (
    current_setting('upr.s1h.employee_external')::uuid,
    '[S1h isolated] external',
    'admin',
    current_setting('upr.s1h.auth_external')::uuid,
    true,
    true
  ),
  (
    current_setting('upr.s1h.employee_crm_partner_marker_mismatch')::uuid,
    '[S1h isolated] CRM partner marker mismatch',
    'crm_partner',
    current_setting('upr.s1h.auth_crm_partner_marker_mismatch')::uuid,
    true,
    false
  ),
  (
    current_setting('upr.s1h.employee_admin')::uuid,
    '[S1h isolated] admin',
    'admin',
    current_setting('upr.s1h.auth_admin')::uuid,
    true,
    false
  ),
  (
    current_setting('upr.s1h.employee_project_manager')::uuid,
    '[S1h isolated] project manager',
    'project_manager',
    current_setting('upr.s1h.auth_project_manager')::uuid,
    true,
    false
  );

INSERT INTO public.notification_types (
  type_key,
  label,
  category,
  enabled,
  bell_default,
  push_default,
  email_default
)
VALUES
  (
    '__s1h_isolated__',
    'S1h isolated',
    'test',
    true,
    true,
    false,
    false
  ),
  (
    '__s1h_disabled__',
    'S1h disabled',
    'test',
    false,
    true,
    true,
    false
  );

INSERT INTO public.employee_page_access (
  employee_id,
  nav_key,
  can_view
)
VALUES
  (
    current_setting('upr.s1h.employee_a')::uuid,
    'jobs',
    true
  ),
  (
    current_setting('upr.s1h.employee_b')::uuid,
    'billing',
    false
  );

INSERT INTO public.notification_role_defaults (
  role,
  type_key,
  channel,
  enabled,
  user_customizable
)
VALUES
  (
    'field_tech',
    '__s1h_isolated__',
    'bell',
    false,
    true
  ),
  (
    'field_tech',
    '__s1h_isolated__',
    'push',
    false,
    true
  ),
  (
    'field_tech',
    '__s1h_isolated__',
    'email',
    false,
    false
  ),
  (
    'field_tech',
    '__s1h_disabled__',
    'email',
    true,
    true
  );

INSERT INTO public.notification_employee_overrides (
  employee_id,
  type_key,
  channel,
  enabled
)
VALUES
  (
    current_setting('upr.s1h.employee_a')::uuid,
    '__s1h_isolated__',
    'push',
    true
  ),
  (
    current_setting('upr.s1h.employee_a')::uuid,
    '__s1h_isolated__',
    'bell',
    false
  );

-- Deliberately opposite the locked role value. The resolver must ignore this
-- existing personal row because user_customizable=false wins.
INSERT INTO public.notification_prefs (
  employee_id,
  type_key,
  channel,
  enabled
)
VALUES (
  current_setting('upr.s1h.employee_a')::uuid,
  '__s1h_isolated__',
  'email',
  true
);

SET LOCAL ROLE authenticated;

DO $actor_a_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_a'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$actor_a_claims$;

DO $actor_a_behavior$
DECLARE
  v_denial_sql text;
  v_pref json;
  v_subscription jsonb;
BEGIN
  IF (
       SELECT count(id)
       FROM public.employees
       WHERE id = current_setting('upr.s1h.employee_a')::uuid
         AND auth_user_id = current_setting('upr.s1h.auth_a')::uuid
         AND role = 'field_tech'
         AND is_active
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'S1h isolated own employee identity read failed';
  END IF;

  IF (
       SELECT count(id)
       FROM public.employees
       WHERE id = current_setting('upr.s1h.employee_b')::uuid
     ) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'S1h isolated foreign employee identity leaked through RLS';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT full_name FROM public.employees WHERE id = %L::uuid',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.employees',
    '42501'
  );

  IF (
       SELECT count(*)
       FROM public.get_employee_page_access(
         current_setting('upr.s1h.employee_a')::uuid
       )
       WHERE nav_key = 'jobs'
         AND can_view
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated own page-access read failed';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_employee_page_access(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_employee_page_access(
          %L::uuid,
          'settings',
          true,
          %L::uuid
        )
      $sql$,
      current_setting('upr.s1h.employee_a'),
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_effective_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );

  SELECT resolved
    INTO v_pref
  FROM public.get_effective_notification_prefs(
    current_setting('upr.s1h.employee_a')::uuid
  ) resolved
  WHERE resolved->>'type_key' = '__s1h_isolated__'
    AND resolved->>'channel' = 'push';

  IF COALESCE((v_pref->>'enabled')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'S1h isolated override precedence failed';
  END IF;

  SELECT resolved
    INTO v_pref
  FROM public.get_effective_notification_prefs(
    current_setting('upr.s1h.employee_a')::uuid
  ) resolved
  WHERE resolved->>'type_key' = '__s1h_isolated__'
    AND resolved->>'channel' = 'bell';

  IF COALESCE((v_pref->>'enabled')::boolean, false) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'S1h isolated role-default precedence failed';
  END IF;

  SELECT resolved
    INTO v_pref
  FROM public.get_effective_notification_prefs(
    current_setting('upr.s1h.employee_a')::uuid
  ) resolved
  WHERE resolved->>'type_key' = '__s1h_isolated__'
    AND resolved->>'channel' = 'email';

  IF COALESCE((v_pref->>'enabled')::boolean, false) IS DISTINCT FROM false
     OR COALESCE(
          (v_pref->>'user_customizable')::boolean,
          true
        ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'S1h isolated role lock did not override personal data';
  END IF;

  IF (
       SELECT count(*)
       FROM public.get_effective_notification_prefs(
         current_setting('upr.s1h.employee_a')::uuid
       ) AS resolved
       WHERE resolved->>'type_key' = '__s1h_disabled__'
     ) IS DISTINCT FROM 3
     OR (
       SELECT count(*)
       FROM public.get_effective_notification_prefs(
         current_setting('upr.s1h.employee_a')::uuid
       ) AS resolved
       WHERE resolved->>'type_key' = '__s1h_disabled__'
         AND resolved->>'channel' IN ('bell', 'push')
         AND (resolved->>'enabled')::boolean
     ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'S1h isolated catalog-default fallback failed';
  END IF;

  IF (
       SELECT count(*)
       FROM public.get_effective_notification_prefs(
         current_setting('upr.s1h.employee_a')::uuid
       ) AS resolved
       WHERE resolved->>'type_key' = '__s1h_disabled__'
         AND resolved->>'channel' = 'email'
         AND (resolved->>'enabled')::boolean
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated role default did not beat catalog';
  END IF;

  IF (
       SELECT count(*)
       FROM public.get_my_notification_prefs(
         current_setting('upr.s1h.employee_a')::uuid
       ) AS preference
       WHERE preference->>'type_key' = '__s1h_isolated__'
     ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'S1h isolated own preference matrix failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.get_my_notification_prefs(
      current_setting('upr.s1h.employee_a')::uuid
    ) AS preference
    WHERE preference->>'type_key' = '__s1h_disabled__'
  ) THEN
    RAISE EXCEPTION 'S1h isolated disabled type leaked into get-my results';
  END IF;

  PERFORM public.set_my_notification_pref(
    current_setting('upr.s1h.employee_a')::uuid,
    '__s1h_isolated__',
    'bell',
    true
  );

  SELECT resolved
    INTO v_pref
  FROM public.get_effective_notification_prefs(
    current_setting('upr.s1h.employee_a')::uuid
  ) resolved
  WHERE resolved->>'type_key' = '__s1h_isolated__'
    AND resolved->>'channel' = 'bell';

  IF COALESCE((v_pref->>'enabled')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'S1h isolated personal preference precedence failed';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'bell',
          false
        )
      $sql$,
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'email',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_a')
    ),
    'P0001'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'fax',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_a')
    ),
    'P0001'
  );

  PERFORM public.upsert_push_subscription(
    'https://push.invalid/s1h-shared',
    's1h-p256-a',
    's1h-auth-a',
    'S1h browser A'
  );
  PERFORM public.upsert_push_subscription(
    'https://push.invalid/s1h-delete-own',
    's1h-p256-delete',
    's1h-auth-delete',
    'S1h delete own'
  );
  PERFORM public.delete_push_subscription(
    'https://push.invalid/s1h-delete-own'
  );

  IF (
       SELECT count(*)
       FROM public.get_my_push_subscriptions(
         current_setting('upr.s1h.employee_a')::uuid
       )
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated own Web Push deletion failed';
  END IF;

  SELECT subscription::jsonb
    INTO v_subscription
  FROM public.get_my_push_subscriptions(
    current_setting('upr.s1h.employee_a')::uuid
  ) subscription;

  IF v_subscription IS NULL
     OR v_subscription ? 'endpoint'
     OR v_subscription ? 'p256dh'
     OR v_subscription ? 'auth'
     OR NOT (
       v_subscription ? 'id'
       AND v_subscription ? 'label'
       AND v_subscription ? 'created_at'
       AND v_subscription ? 'endpoint_hash'
     ) THEN
    RAISE EXCEPTION 'S1h isolated push-list DTO leaked or drifted';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_push_subscriptions(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );

  PERFORM public.upsert_device_token(
    current_setting('upr.s1h.employee_a')::uuid,
    's1h-token-shared',
    'ios'
  );
  PERFORM public.upsert_device_token(
    current_setting('upr.s1h.employee_a')::uuid,
    's1h-token-a-owned',
    'ios'
  );
  PERFORM public.upsert_device_token(
    current_setting('upr.s1h.employee_a')::uuid,
    's1h-token-delete-own',
    'ios'
  );
  PERFORM public.delete_device_token('s1h-token-delete-own');

  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-token-foreign',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );

  FOREACH v_denial_sql IN ARRAY ARRAY[
    'SELECT * FROM public.employee_page_access',
    'SELECT * FROM public.notification_prefs',
    'SELECT * FROM public.push_subscriptions',
    'SELECT * FROM public.device_tokens',
    format(
      $sql$
        INSERT INTO public.notification_prefs(
          employee_id,
          type_key,
          channel,
          enabled
        )
        VALUES (
          %L::uuid,
          '__s1h_isolated__',
          'push',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_a')
    ),
    format(
      $sql$
        INSERT INTO public.device_tokens(employee_id, token, platform)
        VALUES (%L::uuid, 's1h-direct-token', 'ios')
      $sql$,
      current_setting('upr.s1h.employee_a')
    ),
    format(
      'SELECT public.is_current_active_internal_employee(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    )
  ]::text[]
  LOOP
    PERFORM pg_temp.expect_sqlstate(v_denial_sql, '42501');
  END LOOP;

END;
$actor_a_behavior$;

DO $actor_b_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_b'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$actor_b_claims$;

DO $actor_b_takeover_denials$
BEGIN
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.upsert_push_subscription(
        'https://push.invalid/s1h-shared',
        's1h-p256-b',
        's1h-auth-b',
        'S1h browser B'
      )
    $sql$,
    '42501'
  );

  IF (
       SELECT count(*)
       FROM public.get_my_push_subscriptions(
         current_setting('upr.s1h.employee_b')::uuid
       )
     ) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'S1h isolated foreign Web Push takeover changed ownership';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-token-shared',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM public.delete_device_token('s1h-token-missing');
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.delete_push_subscription(
        'https://push.invalid/s1h-shared'
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT public.delete_device_token(''s1h-token-a-owned'')',
    '42501'
  );
END;
$actor_b_takeover_denials$;

DO $actor_a_again_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_a'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$actor_a_again_claims$;

DO $actor_a_ownership_preserved$
BEGIN
  IF (
       SELECT count(*)
       FROM public.get_my_push_subscriptions(
         current_setting('upr.s1h.employee_a')::uuid
       )
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated Web Push ownership was not preserved';
  END IF;
END;
$actor_a_ownership_preserved$;

DO $inactive_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_inactive'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$inactive_claims$;

DO $inactive_denials$
BEGIN
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_employee_page_access(%L::uuid)',
      current_setting('upr.s1h.employee_inactive')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_effective_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_inactive')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_inactive')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'bell',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_inactive')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_push_subscriptions(%L::uuid)',
      current_setting('upr.s1h.employee_inactive')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.upsert_push_subscription(
        'https://push.invalid/s1h-inactive',
        'p',
        'a',
        NULL
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.delete_push_subscription(
        'https://push.invalid/s1h-shared'
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-token-inactive',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_inactive')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT public.delete_device_token(''s1h-token-a-owned'')',
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.device_tokens',
    '42501'
  );
END;
$inactive_denials$;

DO $external_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_external'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$external_claims$;

DO $external_denials$
BEGIN
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_employee_page_access(%L::uuid)',
      current_setting('upr.s1h.employee_external')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_effective_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_external')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_external')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'bell',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_external')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_push_subscriptions(%L::uuid)',
      current_setting('upr.s1h.employee_external')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.upsert_push_subscription(
        'https://push.invalid/s1h-external',
        'p',
        'a',
        NULL
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.delete_push_subscription(
        'https://push.invalid/s1h-shared'
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-token-external',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_external')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT public.delete_device_token(''s1h-token-a-owned'')',
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.device_tokens',
    '42501'
  );
END;
$external_denials$;

DO $crm_partner_marker_mismatch_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_crm_partner_marker_mismatch'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$crm_partner_marker_mismatch_claims$;

DO $crm_partner_marker_mismatch_denials$
BEGIN
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_employee_page_access(%L::uuid)',
      current_setting('upr.s1h.employee_crm_partner_marker_mismatch')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_effective_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_crm_partner_marker_mismatch')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_crm_partner_marker_mismatch')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'bell',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_crm_partner_marker_mismatch')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_push_subscriptions(%L::uuid)',
      current_setting('upr.s1h.employee_crm_partner_marker_mismatch')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.upsert_push_subscription(
        'https://push.invalid/s1h-crm-partner-marker-mismatch',
        'p',
        'a',
        NULL
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.delete_push_subscription(
        'https://push.invalid/s1h-shared'
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-token-crm-partner-marker-mismatch',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_crm_partner_marker_mismatch')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT public.delete_device_token(''s1h-token-a-owned'')',
    '42501'
  );
END;
$crm_partner_marker_mismatch_denials$;

DO $unmapped_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_unmapped'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$unmapped_claims$;

DO $unmapped_denials$
BEGIN
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_employee_page_access(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_effective_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'bell',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_push_subscriptions(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.upsert_push_subscription(
        'https://push.invalid/s1h-unmapped',
        'p',
        'a',
        NULL
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.delete_push_subscription(
        'https://push.invalid/s1h-shared'
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-token-unmapped',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT public.delete_device_token(''s1h-token-a-owned'')',
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.device_tokens',
    '42501'
  );
END;
$unmapped_denials$;

DO $admin_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_admin'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$admin_claims$;

DO $admin_behavior$
DECLARE
  v_updated_by uuid;
BEGIN
  IF (
       SELECT count(*)
       FROM public.get_employee_page_access(
         current_setting('upr.s1h.employee_b')::uuid
       )
       WHERE nav_key = 'billing'
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated admin foreign page read failed';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_effective_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'bell',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_push_subscriptions(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-admin-foreign-token',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT public.delete_device_token(''s1h-token-a-owned'')',
    '42501'
  );
  PERFORM public.delete_push_subscription(
    'https://push.invalid/s1h-shared'
  );

  PERFORM public.upsert_employee_page_access(
    current_setting('upr.s1h.employee_b')::uuid,
    'settings',
    true,
    current_setting('upr.s1h.employee_a')::uuid
  );

  SELECT updated_by
    INTO v_updated_by
  FROM public.get_employee_page_access(
    current_setting('upr.s1h.employee_b')::uuid
  )
  WHERE nav_key = 'settings';

  IF v_updated_by IS DISTINCT FROM
       current_setting('upr.s1h.employee_admin')::uuid THEN
    RAISE EXCEPTION 'S1h isolated spoofed updated_by was trusted';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.device_tokens',
    '42501'
  );
END;
$admin_behavior$;

DO $project_manager_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1h.auth_project_manager'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$project_manager_claims$;

DO $project_manager_behavior$
BEGIN
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.device_tokens',
    '42501'
  );

  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_employee_page_access(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_effective_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'bell',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_push_subscriptions(%L::uuid)',
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-project-manager-foreign-token',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_b')
    ),
    '42501'
  );
END;
$project_manager_behavior$;

SET LOCAL ROLE service_role;
DO $service_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'service_role')::text,
    true
  );
END;
$service_claims$;

DO $service_behavior$
DECLARE
  v_owner uuid;
  v_service_push public.push_subscriptions;
BEGIN
  IF (
       SELECT count(*)
       FROM public.employees
       WHERE id IN (
         current_setting('upr.s1h.employee_a')::uuid,
         current_setting('upr.s1h.employee_b')::uuid
       )
     ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'S1h isolated service employee-read compatibility failed';
  END IF;

  IF (
       SELECT count(*)
       FROM public.get_employee_page_access(
         current_setting('upr.s1h.employee_b')::uuid
       )
       WHERE nav_key = 'billing'
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated service page-read compatibility failed';
  END IF;

  IF (
       SELECT count(*)
       FROM public.get_effective_notification_prefs(
         current_setting('upr.s1h.employee_b')::uuid
       ) AS resolved
       WHERE resolved->>'type_key' = '__s1h_isolated__'
  ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'S1h isolated service resolver compatibility failed';
  END IF;

  IF (
       SELECT count(*)
       FROM public.get_my_notification_prefs(
         current_setting('upr.s1h.employee_b')::uuid
       ) AS preference
       WHERE preference->>'type_key' = '__s1h_isolated__'
     ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'S1h isolated service get-my compatibility failed';
  END IF;

  PERFORM public.set_my_notification_pref(
    current_setting('upr.s1h.employee_b')::uuid,
    '__s1h_isolated__',
    'bell',
    false
  );

  IF (
       SELECT count(*)
       FROM public.get_my_notification_prefs(
         current_setting('upr.s1h.employee_b')::uuid
       ) AS preference
       WHERE preference->>'type_key' = '__s1h_isolated__'
         AND preference->>'channel' = 'bell'
         AND NOT (preference->>'enabled')::boolean
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated service preference mutation failed';
  END IF;

  IF (
       SELECT count(*)
       FROM public.get_my_push_subscriptions(
         current_setting('upr.s1h.employee_a')::uuid
       )
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated service push-list compatibility failed';
  END IF;

  SELECT employee_id
    INTO v_owner
  FROM public.push_subscriptions
  WHERE endpoint = 'https://push.invalid/s1h-shared';

  IF v_owner IS DISTINCT FROM
       current_setting('upr.s1h.employee_a')::uuid THEN
    RAISE EXCEPTION 'S1h isolated Web Push takeover denial was not preserved';
  END IF;

  SELECT employee_id
    INTO v_owner
  FROM public.device_tokens
  WHERE token = 's1h-token-shared';

  IF v_owner IS DISTINCT FROM
       current_setting('upr.s1h.employee_a')::uuid THEN
    RAISE EXCEPTION 'S1h isolated native token takeover denial was not preserved';
  END IF;

  PERFORM public.upsert_device_token(
    current_setting('upr.s1h.employee_b')::uuid,
    's1h-token-shared',
    'ios'
  );

  SELECT employee_id
    INTO v_owner
  FROM public.device_tokens
  WHERE token = 's1h-token-shared';

  IF v_owner IS DISTINCT FROM
       current_setting('upr.s1h.employee_b')::uuid THEN
    RAISE EXCEPTION 'S1h isolated service native token rebind failed';
  END IF;

  PERFORM public.upsert_device_token(
    current_setting('upr.s1h.employee_a')::uuid,
    's1h-token-shared',
    'ios'
  );

  SELECT public.upsert_push_subscription(
    'https://push.invalid/s1h-service-no-user',
    'service-p256',
    'service-auth',
    'S1h service'
  )
    INTO v_service_push;

  IF v_service_push IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.push_subscriptions
       WHERE endpoint = 'https://push.invalid/s1h-service-no-user'
     ) THEN
    RAISE EXCEPTION
      'S1h isolated service no-user Web Push contract drifted';
  END IF;

  PERFORM public.delete_push_subscription(
    'https://push.invalid/s1h-shared'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.push_subscriptions
    WHERE endpoint = 'https://push.invalid/s1h-shared'
  ) THEN
    RAISE EXCEPTION
      'S1h isolated service no-user Web Push delete stopped being a no-op';
  END IF;

  PERFORM public.upsert_device_token(
    current_setting('upr.s1h.employee_inactive')::uuid,
    's1h-service-token',
    'ios'
  );
  PERFORM public.delete_device_token('s1h-service-token');

  IF EXISTS (
    SELECT 1
    FROM public.device_tokens
    WHERE token = 's1h-service-token'
  ) THEN
    RAISE EXCEPTION 'S1h isolated service device mutation failed';
  END IF;

  PERFORM public.upsert_employee_page_access(
    current_setting('upr.s1h.employee_external')::uuid,
    'service-only',
    true,
    current_setting('upr.s1h.employee_admin')::uuid
  );

  IF (
       SELECT count(*)
       FROM public.get_employee_page_access(
         current_setting('upr.s1h.employee_external')::uuid
       )
       WHERE nav_key = 'service-only'
         AND can_view
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1h isolated service page mutation failed';
  END IF;

  IF (
       SELECT count(*)
       FROM public.push_subscriptions
       WHERE endpoint = 'https://push.invalid/s1h-shared'
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM public.device_tokens
       WHERE token IN ('s1h-token-shared', 's1h-token-a-owned')
     ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'S1h isolated service direct-read contract failed';
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE endpoint = 'https://push.invalid/s1h-shared';

  DELETE FROM public.device_tokens
  WHERE token IN ('s1h-token-shared', 's1h-token-a-owned');

  IF EXISTS (
       SELECT 1
       FROM public.push_subscriptions
       WHERE endpoint = 'https://push.invalid/s1h-shared'
     )
     OR EXISTS (
       SELECT 1
       FROM public.device_tokens
       WHERE token IN ('s1h-token-shared', 's1h-token-a-owned')
     ) THEN
    RAISE EXCEPTION 'S1h isolated service direct-prune contract failed';
  END IF;
END;
$service_behavior$;

SET LOCAL ROLE anon;
DO $anonymous_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'anon')::text,
    true
  );
END;
$anonymous_claims$;

DO $anonymous_denials$
BEGIN
  PERFORM pg_temp.expect_sqlstate(
    'SELECT id FROM public.employees',
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.employees',
    '42501'
  );

  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_employee_page_access(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_effective_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_notification_prefs(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      'SELECT * FROM public.get_my_push_subscriptions(%L::uuid)',
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.set_my_notification_pref(
          %L::uuid,
          '__s1h_isolated__',
          'bell',
          true
        )
      $sql$,
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.upsert_push_subscription(
        'https://push.invalid/s1h-anon',
        'p',
        'a',
        NULL
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    $sql$
      SELECT public.delete_push_subscription(
        'https://push.invalid/s1h-shared'
      )
    $sql$,
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    format(
      $sql$
        SELECT public.upsert_device_token(
          %L::uuid,
          's1h-token-anon',
          'ios'
        )
      $sql$,
      current_setting('upr.s1h.employee_a')
    ),
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT public.delete_device_token(''s1h-token-a-owned'')',
    '42501'
  );

  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.employee_page_access',
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.notification_prefs',
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.push_subscriptions',
    '42501'
  );
  PERFORM pg_temp.expect_sqlstate(
    'SELECT * FROM public.device_tokens',
    '42501'
  );
END;
$anonymous_denials$;

RESET ROLE;

ROLLBACK;
