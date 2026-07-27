-- ════════════════════════════════════════════════
-- MIGRATION: 20260727022920_mobile_personal_ownership_boundary
-- Phase: Mobile Production Readiness S1h
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes personal page access, notification settings, browser push devices,
--   and native device tokens belong to the signed-in active employee. Active
--   internal admins retain the one foreign page-access exception used by the
--   Page Access screen. Existing function identities, return types, successful
--   authorized response shapes, and ordering stay compatible; unauthorized
--   behavior intentionally becomes stricter.
--
-- RED AUTHORIZATION / NO STRUCTURAL OR DATA CHANGE:
--   Replaces nine function bodies, adds one private helper, forces row security
--   on four existing tables, and narrows table/function privileges. It creates
--   no table or column and
--   inserts, updates, or deletes no business row.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/
--   20260727022920_mobile_personal_ownership_boundary.rollback.sql only after
--   the owner explicitly accepts its unsafe restoration of anonymous page
--   access, broad browser table grants, foreign personal selectors, and
--   arbitrary token mutation. Prefer a forward repair.
-- ════════════════════════════════════════════════
--
-- REQUIRED EARLIER WINDOW:
--   The live permission_write_gates batch and the reviewed
--   upsert_employee_page_access_provenance_reconciliation plus
--   mobile_employee_identity_containment migration must be applied and
--   verified first. permission_write_gates is explicitly accepted only as its
--   source replay version 20260726220000 or its live-assigned version
--   20260727012825. Supabase assigned the reviewed live version at apply time;
--   the identity and provenance dependencies are pinned by migration name plus
--   exact catalog postconditions rather than by guessed filenames.
--   S1h relies on its active-internal-admin predicate and its two page-access
--   mutator gates. This migration refuses the ungated live input.
--
-- DIRECT TABLE CONTRACT:
--   employee_page_access, notification_prefs, push_subscriptions, and
--   device_tokens become browser-RPC-only with forced RLS and no policies.
--   Direct service_role and owner table access remains unchanged.
--
-- OUT OF SCOPE:
--   Feature-flag public classification, admin notification defaults/overrides,
--   authenticated AuthContext employee bootstrap, native logout cleanup, the
--   complete account-switch lifecycle, APNs fan-out, provider/configuration
--   work, deployment, signing, and device qualification. The retired anonymous
--   employee selector is not an authorization or verification path.
--   Possession of another employee's current web/native token never permits
--   authenticated reassignment.

DO $s1h_preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_actual_acl text[];
  v_grantable_count integer;
  v_policy_names text[];
  v_table_name text;
  v_table_acl_md5 text;
  v_catalog_expected record;
  v_columns_md5 text;
  v_constraints_md5 text;
  v_indexes_md5 text;
  v_employee_anon_privileges text[];
  v_employee_authenticated_privileges text[];
  v_employee_service_privileges text[];
  v_employee_public_privilege_count integer;
  v_employee_unexpected_table_acl_count integer;
  v_employee_authenticated_columns text[];
  v_employee_unexpected_column_acl_count integer;
BEGIN
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
     ) THEN
    RAISE EXCEPTION
      'S1h requires exactly one reviewed permission_write_gates dependency at source version 20260726220000 or live version 20260727012825';
  END IF;

  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations
    WHERE name =
      'upsert_employee_page_access_provenance_reconciliation'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'S1h requires the separately applied upsert_employee_page_access_provenance_reconciliation dependency';
  END IF;

  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations
    WHERE name = 'mobile_employee_identity_containment'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'S1h requires the separately applied mobile_employee_identity_containment dependency';
  END IF;

  IF to_regprocedure('public.is_current_active_internal_employee(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION
      'S1h preflight drift: is_current_active_internal_employee(uuid) already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    JOIN pg_roles owner_role ON owner_role.oid = p.proowner
    WHERE p.oid = to_regprocedure('public.is_active_internal_admin()')
      AND n.nspname = 'public'
      AND l.lanname = 'sql'
      AND owner_role.rolname = 'postgres'
      AND pg_get_function_result(p.oid) = 'boolean'
      AND p.prosecdef
      AND p.provolatile = 's'
      AND p.proconfig = ARRAY['search_path=public']::text[]
      AND md5(p.prosrc) = 'ef9b97f5a64e030b1b1b9dfb779b1db3'
  ) THEN
    RAISE EXCEPTION
      'S1h dependency drift: is_active_internal_admin() is absent or not the reviewed body';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.get_employee_page_access(uuid)',
          'get_employee_page_access',
          'p_employee_id uuid',
          'SETOF employee_page_access',
          'sql',
          'v',
          ARRAY['search_path=public, extensions, pg_temp']::text[],
          '444353933d6424ef80eef8aff55ff00e',
          '534ee514e1cd451eb7443f46cc5b97c4',
          ARRAY['PUBLIC','anon','authenticated','postgres','service_role']::text[]
        ),
        (
          'public.get_effective_notification_prefs(uuid)',
          'get_effective_notification_prefs',
          'p_employee_id uuid',
          'SETOF json',
          'sql',
          's',
          ARRAY['search_path=public']::text[],
          '26265649c566f96b9609665bdcb9b681',
          '58a78cf8e0c6f4fddd6b83c176a6faec',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.get_my_notification_prefs(uuid)',
          'get_my_notification_prefs',
          'p_employee_id uuid',
          'SETOF json',
          'sql',
          's',
          ARRAY['search_path=public']::text[],
          '74a2cde903e4065bf77a5ee7e91136d3',
          '0792021b1cd5aa2bf86a280fd710ede4',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.set_my_notification_pref(uuid,text,text,boolean)',
          'set_my_notification_pref',
          'p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean',
          'notification_prefs',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          'ab61d17bdc3ee21db918ba630c84833d',
          '4e38e85eaf62d0017c2116ae99132928',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.get_my_push_subscriptions(uuid)',
          'get_my_push_subscriptions',
          'p_employee_id uuid',
          'SETOF json',
          'sql',
          's',
          ARRAY['search_path=public']::text[],
          '259b6a2b5ba6d4fb72685af1401b44d1',
          'dc8407414a6b0409b8ca0bd22952d227',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.upsert_push_subscription(text,text,text,text)',
          'upsert_push_subscription',
          'p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text',
          'push_subscriptions',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          'bf001422d95a240b330407c96cc48d62',
          '7bdeb04d8b30e3851c0b2345efcf4cb5',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.delete_push_subscription(text)',
          'delete_push_subscription',
          'p_endpoint text',
          'void',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          'e81203e340b411f246321c47d5d35651',
          '29d5b41ceecc5ee2727becce4231ed67',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.upsert_device_token(uuid,text,text)',
          'upsert_device_token',
          'p_employee_id uuid, p_token text, p_platform text',
          'device_tokens',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          '5d5a405a4f83b0bceeada7c1e68f9759',
          '8b9a354ccfb0c2acbe977fdf032fae12',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.delete_device_token(text)',
          'delete_device_token',
          'p_token text',
          'void',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          '08f895e2f310f23e1ca131a527a0d358',
          '995617e7a443e214f20a4e4cf1d6dc39',
          ARRAY['authenticated','postgres','service_role']::text[]
        )
    ) AS expected(
      identity,
      function_name,
      function_arguments,
      result_type,
      language_name,
      volatility,
      config,
      body_md5,
      definition_md5,
      execute_grantees
    )
  LOOP
    v_oid := to_regprocedure(v_expected.identity);

    IF v_oid IS NULL OR (
      SELECT count(*)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected.function_name
    ) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'S1h preflight expected one exact overload for %',
        v_expected.function_name;
    END IF;

    SELECT
      array_agg(
        COALESCE(grantee_role.rolname, 'PUBLIC')
        ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
      ),
      count(*) FILTER (WHERE acl.is_grantable)
      INTO v_actual_acl, v_grantable_count
    FROM pg_proc p
    CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE p.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF NOT EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_language l ON l.oid = p.prolang
         JOIN pg_roles owner_role ON owner_role.oid = p.proowner
         WHERE p.oid = v_oid
           AND l.lanname = v_expected.language_name
           AND owner_role.rolname = 'postgres'
           AND pg_get_function_arguments(p.oid) =
                 v_expected.function_arguments
           AND pg_get_function_result(p.oid) = v_expected.result_type
           AND p.prosecdef
           AND NOT p.proisstrict
           AND NOT p.proleakproof
           AND p.provolatile = v_expected.volatility
           AND p.proparallel = 'u'
           AND p.prokind = 'f'
           AND p.proconfig = v_expected.config
           AND md5(p.prosrc) = v_expected.body_md5
           AND md5(pg_get_functiondef(p.oid)) =
                 v_expected.definition_md5
       )
       OR v_actual_acl IS DISTINCT FROM v_expected.execute_grantees
       OR v_grantable_count IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'S1h preflight function drift: identity=%, acl=%, grantable=%',
        v_expected.identity,
        v_actual_acl,
        v_grantable_count;
    END IF;
  END LOOP;

  IF (
       SELECT count(*)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'upsert_employee_page_access'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_language l ON l.oid = p.prolang
       JOIN pg_roles owner_role ON owner_role.oid = p.proowner
       WHERE p.oid = to_regprocedure(
         'public.upsert_employee_page_access(uuid,text,boolean,uuid)'
       )
         AND l.lanname = 'plpgsql'
         AND owner_role.rolname = 'postgres'
         AND pg_get_function_arguments(p.oid) =
               'p_employee_id uuid, p_nav_key text, p_can_view boolean, p_updated_by uuid DEFAULT NULL::uuid'
         AND pg_get_function_result(p.oid) = 'employee_page_access'
         AND p.prosecdef
         AND NOT p.proisstrict
         AND NOT p.proleakproof
         AND p.provolatile = 'v'
         AND p.proparallel = 'u'
         AND p.prokind = 'f'
         AND p.proconfig =
               ARRAY['search_path=public, extensions, pg_temp']::text[]
         AND md5(p.prosrc) = '16e440632831b52155d5a9c6ba7b21a3'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(
         'public.delete_employee_page_access(uuid,text)'
       )
         AND l.lanname = 'plpgsql'
         AND p.prosecdef
         AND p.proconfig =
               ARRAY['search_path=public, extensions, pg_temp']::text[]
         AND md5(p.prosrc) = 'b108f96a46006185cf2b6ad4b0a147aa'
     ) THEN
    RAISE EXCEPTION
      'S1h dependency drift: page-access mutators are not the reviewed admin-gated bodies';
  END IF;

  v_oid := to_regprocedure(
    'public.upsert_employee_page_access(uuid,text,boolean,uuid)'
  );

  SELECT
    array_agg(
      COALESCE(grantee_role.rolname, 'PUBLIC')
      ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
    ),
    count(*) FILTER (WHERE acl.is_grantable)
    INTO v_actual_acl, v_grantable_count
  FROM pg_proc p
  CROSS JOIN LATERAL
    aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE p.oid = v_oid
    AND acl.privilege_type = 'EXECUTE';

  IF v_actual_acl IS DISTINCT FROM
       ARRAY['authenticated','postgres','service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'S1h dependency drift: upsert_employee_page_access ACL=%, grantable=%',
      v_actual_acl,
      v_grantable_count;
  END IF;

  IF (
    SELECT count(*)
    FROM pg_roles
    WHERE rolname IN ('postgres', 'service_role')
      AND rolbypassrls
  ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'S1h requires postgres and service_role BYPASSRLS for forced-RLS compatibility';
  END IF;

  IF to_regprocedure('auth.jwt()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attname = 'id'
         AND NOT attribute.attisdropped
         AND format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
         AND attribute.attnotnull
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attname = 'auth_user_id'
         AND NOT attribute.attisdropped
         AND format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attname = 'role'
         AND NOT attribute.attisdropped
         AND format_type(attribute.atttypid, attribute.atttypmod) =
               'employee_role'
         AND attribute.attnotnull
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attname = 'is_active'
         AND NOT attribute.attisdropped
         AND format_type(attribute.atttypid, attribute.atttypmod) = 'boolean'
         AND attribute.attnotnull
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attname = 'is_external'
         AND NOT attribute.attisdropped
         AND format_type(attribute.atttypid, attribute.atttypmod) = 'boolean'
         AND attribute.attnotnull
     )
     OR (
       SELECT count(*)
       FROM pg_enum enum_value
       JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
       JOIN pg_namespace enum_namespace
         ON enum_namespace.oid = enum_type.typnamespace
       WHERE enum_namespace.nspname = 'public'
         AND enum_type.typname = 'employee_role'
         AND enum_value.enumlabel IN (
           'admin',
           'office',
           'project_manager',
           'field_tech',
           'estimator',
           'supervisor',
           'crm_partner'
         )
     ) IS DISTINCT FROM 7
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = to_regclass('public.employees')
         AND constraint_record.contype = 'p'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'PRIMARY KEY (id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = to_regclass('public.employees')
         AND constraint_record.contype = 'u'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'UNIQUE (auth_user_id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.employees')
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
         AND policyname = 'employees_self_identity_read'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'SELECT'
         AND qual = '(auth_user_id = auth.uid())'
         AND with_check IS NULL
     ) THEN
    RAISE EXCEPTION 'S1h preflight auth/employee dependency drift';
  END IF;

  IF (
       SELECT count(*)
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
     ) IS DISTINCT FROM 1
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege('anon', 'public.employees', 'INSERT')
     OR has_table_privilege('anon', 'public.employees', 'UPDATE')
     OR has_table_privilege('anon', 'public.employees', 'DELETE')
     OR has_table_privilege('anon', 'public.employees', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.employees', 'REFERENCES')
     OR has_table_privilege('anon', 'public.employees', 'TRIGGER')
     OR has_table_privilege('anon', 'public.employees', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR has_table_privilege('authenticated', 'public.employees', 'INSERT')
     OR has_table_privilege('authenticated', 'public.employees', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.employees', 'DELETE')
     OR has_table_privilege('authenticated', 'public.employees', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.employees', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.employees', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.employees', 'MAINTAIN')
     THEN
    RAISE EXCEPTION
      'S1h preflight requires the exact self-only employee browser boundary';
  END IF;

  SELECT
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'anon'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'authenticated'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'service_role'),
      ARRAY[]::text[]
    ),
    count(*) FILTER (WHERE acl.grantee = 0),
    count(*) FILTER (
      WHERE acl.grantor <> relation.relowner
         OR acl.grantee = 0
         OR COALESCE(grantee_role.rolname, '') NOT IN (
           'postgres',
           'service_role'
         )
         OR (
           acl.is_grantable
           AND acl.grantee <> relation.relowner
         )
    )
    INTO
      v_employee_anon_privileges,
      v_employee_authenticated_privileges,
      v_employee_service_privileges,
      v_employee_public_privilege_count,
      v_employee_unexpected_table_acl_count
  FROM pg_class relation
  JOIN pg_namespace namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL
    aclexplode(
      COALESCE(
        relation.relacl,
        acldefault('r', relation.relowner)
      )
  ) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'employees';

  SELECT
    array_agg(attribute.attname ORDER BY attribute.attname)
      FILTER (
        WHERE grantee_role.rolname = 'authenticated'
          AND acl.privilege_type = 'SELECT'
      ),
    count(*) FILTER (
      WHERE acl.privilege_type <> 'SELECT'
         OR grantee_role.rolname <> 'authenticated'
         OR attribute.attname NOT IN (
           'id',
           'auth_user_id',
           'role',
           'is_active'
         )
         OR acl.is_grantable
    )
    INTO
      v_employee_authenticated_columns,
      v_employee_unexpected_column_acl_count
  FROM pg_attribute attribute
  CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE attribute.attrelid = 'public.employees'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attacl IS NOT NULL;

  IF v_employee_anon_privileges IS DISTINCT FROM ARRAY[]::text[]
     OR v_employee_authenticated_privileges IS DISTINCT FROM ARRAY[]::text[]
     OR v_employee_service_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_employee_public_privilege_count <> 0
     OR v_employee_unexpected_table_acl_count <> 0
     OR v_employee_authenticated_columns IS DISTINCT FROM
       ARRAY['auth_user_id', 'id', 'is_active', 'role']::text[]
     OR v_employee_unexpected_column_acl_count <> 0
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'SELECT'
        )
     OR has_table_privilege('anon', 'public.employees', 'SELECT') THEN
    RAISE EXCEPTION
      'S1h preflight employee ACL drift: anon=%, authenticated=%, service=%, public=%, unexpected_table=%, columns=%, unexpected_column=%',
      v_employee_anon_privileges,
      v_employee_authenticated_privileges,
      v_employee_service_privileges,
      v_employee_public_privilege_count,
      v_employee_unexpected_table_acl_count,
      v_employee_authenticated_columns,
      v_employee_unexpected_column_acl_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef
      AND (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        OR has_function_privilege(
          'authenticated',
          procedure.oid,
          'EXECUTE'
        )
        OR EXISTS (
          SELECT 1
          FROM aclexplode(
            COALESCE(
              procedure.proacl,
              acldefault('f', procedure.proowner)
            )
          ) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
      )
      AND (
        regexp_replace(
          procedure.prosrc,
          '[[:space:]]+',
          ' ',
          'g'
        ) ~* E'\\mupdate +(public\\.)?employees +set +[^;]*\\m(auth_user_id|role|is_active|is_external)\\M *='
        OR regexp_replace(
          procedure.prosrc,
          '[[:space:]]+',
          ' ',
          'g'
        ) ~* E'\\minsert +into +(public\\.)?employees *\\([^)]*\\m(auth_user_id|role|is_active|is_external)\\M'
        OR regexp_replace(
          procedure.prosrc,
          '[[:space:]]+',
          ' ',
          'g'
        ) ~* E'\\mdelete +from +(public\\.)?employees\\M'
      )
  ) THEN
    RAISE EXCEPTION
      'S1h preflight found a browser-executable employee authority mutator';
  END IF;

  IF (
       SELECT count(*)
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE namespace.nspname = 'public'
         AND relation.relname IN (
           'employee_page_access',
           'notification_prefs',
           'push_subscriptions',
           'device_tokens'
         )
         AND relation.relkind = 'r'
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
     ) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION
      'S1h preflight table owner/RLS drift';
  END IF;

  FOREACH v_table_name IN ARRAY ARRAY[
    'employee_page_access',
    'notification_prefs',
    'push_subscriptions',
    'device_tokens'
  ]::text[]
  LOOP
    SELECT md5(
      string_agg(
        format(
          '%s:%s:%s',
          COALESCE(grantee_role.rolname, 'PUBLIC'),
          acl.privilege_type,
          acl.is_grantable
        ),
        E'\n'
        ORDER BY
          COALESCE(grantee_role.rolname, 'PUBLIC'),
          acl.privilege_type,
          acl.is_grantable
      )
    )
      INTO v_table_acl_md5
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL
      aclexplode(
        COALESCE(
          relation.relacl,
          acldefault('r', relation.relowner)
        )
      ) acl
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relname = v_table_name;

    IF v_table_acl_md5 IS DISTINCT FROM
         '5af89d01800b50292cd05f0582531d89' THEN
      RAISE EXCEPTION
        'S1h preflight relation ACL drift: table=%, acl_md5=%',
        v_table_name,
        v_table_acl_md5;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'employee_page_access',
        'notification_prefs',
        'push_subscriptions',
        'device_tokens'
      )
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
      AND cardinality(attribute.attacl) > 0
  ) THEN
    RAISE EXCEPTION
      'S1h preflight expected zero target-table column ACLs';
  END IF;

  FOR v_catalog_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'device_tokens',
          '436d8e67577c2494d101e3572da0ed72',
          'b404642ee006aac56488662e309e75b4',
          '5bea678ca4a85697e308b8728d6cc344'
        ),
        (
          'employee_page_access',
          '8153d07e9417a0718e71f769cea622ba',
          '83c2d83a6d6ac03dda5a44c8f9d0e1e0',
          '5fbbc307824f65aed80ee6fedadb4c40'
        ),
        (
          'notification_prefs',
          '8dc6b2e929b8fd5d000c97003b786ba4',
          'f7289d520c842200d2960b4f0a5daeed',
          '8984b2ab8e2e155309517c448b08a979'
        ),
        (
          'push_subscriptions',
          'd827ea97e7ee6cf032080729a12e1253',
          '8ee5bdc8ddfa993d319480ab1d1d2d5a',
          'f15c2aa376955f574d81d9bb6cf0c662'
        )
    ) AS expected(
      table_name,
      columns_md5,
      constraints_md5,
      indexes_md5
    )
  LOOP
    SELECT
      md5((
        SELECT jsonb_agg(
          jsonb_build_object(
            'attnum', attribute.attnum,
            'name', attribute.attname,
            'type',
              format_type(attribute.atttypid, attribute.atttypmod),
            'not_null', attribute.attnotnull,
            'identity', attribute.attidentity,
            'generated', attribute.attgenerated,
            'default',
              pg_get_expr(default_value.adbin, default_value.adrelid)
          )
          ORDER BY attribute.attnum
        )::text
        FROM pg_attribute attribute
        LEFT JOIN pg_attrdef default_value
          ON default_value.adrelid = attribute.attrelid
         AND default_value.adnum = attribute.attnum
        WHERE attribute.attrelid = relation.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      )),
      md5((
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', constraint_record.conname,
            'type', constraint_record.contype,
            'definition',
              pg_get_constraintdef(constraint_record.oid, true)
          )
          ORDER BY constraint_record.conname
        )::text
        FROM pg_constraint constraint_record
        WHERE constraint_record.conrelid = relation.oid
      )),
      md5((
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', index_relation.relname,
            'definition', pg_get_indexdef(index_record.indexrelid)
          )
          ORDER BY index_relation.relname
        )::text
        FROM pg_index index_record
        JOIN pg_class index_relation
          ON index_relation.oid = index_record.indexrelid
        WHERE index_record.indrelid = relation.oid
      ))
      INTO v_columns_md5, v_constraints_md5, v_indexes_md5
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = v_catalog_expected.table_name
      AND relation.relkind = 'r';

    IF v_columns_md5 IS DISTINCT FROM v_catalog_expected.columns_md5
       OR v_constraints_md5 IS DISTINCT FROM
            v_catalog_expected.constraints_md5
       OR v_indexes_md5 IS DISTINCT FROM
            v_catalog_expected.indexes_md5 THEN
      RAISE EXCEPTION
        'S1h preflight table catalog drift: table=%, columns=%, constraints=%, indexes=%',
        v_catalog_expected.table_name,
        v_columns_md5,
        v_constraints_md5,
        v_indexes_md5;
    END IF;
  END LOOP;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'employee_page_access';

  IF v_policy_names IS DISTINCT FROM
       ARRAY[
         'anon_read_employee_page_access',
         'employee_page_access_admin_write'
       ]::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employee_page_access'
         AND policyname = 'anon_read_employee_page_access'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['anon','authenticated']::name[]
         AND cmd = 'SELECT'
         AND qual = 'true'
         AND with_check IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employee_page_access'
         AND policyname = 'employee_page_access_admin_write'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'ALL'
         AND qual = 'is_active_internal_admin()'
         AND with_check = 'is_active_internal_admin()'
     ) THEN
    RAISE EXCEPTION
      'S1h preflight employee_page_access policy drift: %',
      v_policy_names;
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'notification_prefs';

  IF v_policy_names IS DISTINCT FROM ARRAY['notification_prefs_all']::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'notification_prefs'
         AND policyname = 'notification_prefs_all'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'ALL'
         AND qual = 'true'
         AND with_check = 'true'
     ) THEN
    RAISE EXCEPTION
      'S1h preflight notification_prefs policy drift: %',
      v_policy_names;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_subscriptions'
  ) THEN
    RAISE EXCEPTION
      'S1h preflight expected zero push_subscriptions policies';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'device_tokens';

  IF v_policy_names IS DISTINCT FROM ARRAY['Own tokens or admin read']::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'device_tokens'
         AND policyname = 'Own tokens or admin read'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'SELECT'
         AND md5(qual) = 'aea87dfe07b22c489c0f8401ae03053b'
         AND with_check IS NULL
     ) THEN
    RAISE EXCEPTION
      'S1h preflight device_tokens policy drift: %',
      v_policy_names;
  END IF;
END;
$s1h_preflight$;

CREATE OR REPLACE FUNCTION public.is_current_active_internal_employee(
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = p_employee_id
      AND employee.auth_user_id = auth.uid()
      AND employee.is_active
      AND NOT employee.is_external
      AND employee.role::text IN (
        'admin',
        'office',
        'project_manager',
        'field_tech',
        'estimator',
        'supervisor'
      )
  );
$function$;

ALTER FUNCTION public.is_current_active_internal_employee(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_current_active_internal_employee(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_employee_page_access(p_employee_id uuid)
RETURNS SETOF public.employee_page_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NOT COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     )
     AND NOT public.is_current_active_internal_employee(p_employee_id)
     AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own page access or admin only'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT access_row.*
  FROM public.employee_page_access access_row
  WHERE access_row.employee_id = p_employee_id
  ORDER BY access_row.nav_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_effective_notification_prefs(
  p_employee_id uuid
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     )
     AND NOT public.is_current_active_internal_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification preferences only'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH employee_scope AS (
    SELECT employee.id, employee.role
    FROM public.employees employee
    WHERE employee.id = p_employee_id
  ),
  channels(channel) AS (
    VALUES ('bell'), ('push'), ('email')
  ),
  matrix AS (
    SELECT
      notification_type.type_key,
      notification_type.label,
      notification_type.category,
      notification_type.sort_order,
      notification_type.enabled AS type_enabled,
      channels.channel,
      CASE channels.channel
        WHEN 'bell' THEN notification_type.bell_default
        WHEN 'push' THEN notification_type.push_default
        ELSE notification_type.email_default
      END AS type_channel_default
    FROM public.notification_types notification_type
    CROSS JOIN channels
  )
  SELECT json_build_object(
    'type_key', matrix.type_key,
    'label', matrix.label,
    'category', matrix.category,
    'channel', matrix.channel,
    'type_enabled', matrix.type_enabled,
    'user_customizable',
      COALESCE(role_default.user_customizable, true),
    'enabled',
      CASE
        WHEN COALESCE(role_default.user_customizable, true)
             AND personal_pref.enabled IS NOT NULL
          THEN personal_pref.enabled
        ELSE COALESCE(
          employee_override.enabled,
          role_default.enabled,
          matrix.type_channel_default
        )
      END
  )
  FROM matrix
  CROSS JOIN employee_scope
  LEFT JOIN public.notification_role_defaults role_default
    ON role_default.role = employee_scope.role::text
   AND role_default.type_key = matrix.type_key
   AND role_default.channel = matrix.channel
  LEFT JOIN public.notification_employee_overrides employee_override
    ON employee_override.employee_id = employee_scope.id
   AND employee_override.type_key = matrix.type_key
   AND employee_override.channel = matrix.channel
  LEFT JOIN public.notification_prefs personal_pref
    ON personal_pref.employee_id = employee_scope.id
   AND personal_pref.type_key = matrix.type_key
   AND personal_pref.channel = matrix.channel
  ORDER BY matrix.sort_order, matrix.type_key, matrix.channel;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_notification_prefs(
  p_employee_id uuid
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     )
     AND NOT public.is_current_active_internal_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification preferences only'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT resolved_pref
  FROM public.get_effective_notification_prefs(p_employee_id) AS resolved_pref
  WHERE COALESCE((resolved_pref->>'type_enabled')::boolean, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_notification_pref(
  p_employee_id uuid,
  p_type_key text,
  p_channel text,
  p_enabled boolean
)
RETURNS public.notification_prefs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_customizable boolean;
  v_row public.notification_prefs;
BEGIN
  IF NOT COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     )
     AND NOT public.is_current_active_internal_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification preferences only'
      USING errcode = '42501';
  END IF;

  IF p_channel NOT IN ('bell', 'push', 'email') THEN
    RAISE EXCEPTION 'invalid channel: %', p_channel;
  END IF;

  SELECT employee.role::text
    INTO v_role
  FROM public.employees employee
  WHERE employee.id = p_employee_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'unknown employee: %', p_employee_id;
  END IF;

  SELECT role_default.user_customizable
    INTO v_customizable
  FROM public.notification_role_defaults role_default
  WHERE role_default.role = v_role
    AND role_default.type_key = p_type_key
    AND role_default.channel = p_channel;

  IF v_customizable IS FALSE THEN
    RAISE EXCEPTION
      'notification preference locked by an administrator (% / %)',
      p_type_key,
      p_channel;
  END IF;

  INSERT INTO public.notification_prefs (
    employee_id,
    type_key,
    channel,
    enabled
  )
  VALUES (
    p_employee_id,
    p_type_key,
    p_channel,
    p_enabled
  )
  ON CONFLICT (employee_id, type_key, channel)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_push_subscriptions(
  p_employee_id uuid
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     )
     AND NOT public.is_current_active_internal_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own push subscriptions only'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT json_build_object(
    'id', subscription.id,
    'label', subscription.user_agent,
    'created_at', subscription.created_at,
    'endpoint_hash',
      substr(
        encode(
          extensions.digest(subscription.endpoint, 'sha256'),
          'hex'
        ),
        1,
        16
      )
  )
  FROM public.push_subscriptions subscription
  WHERE subscription.employee_id = p_employee_id
  ORDER BY subscription.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text DEFAULT NULL::text
)
RETURNS public.push_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
  v_row public.push_subscriptions;
BEGIN
  IF NULLIF(btrim(p_endpoint), '') IS NULL
     OR NULLIF(btrim(p_p256dh), '') IS NULL
     OR NULLIF(btrim(p_auth), '') IS NULL THEN
    RAISE EXCEPTION
      'endpoint, p256dh, and auth are required'
      USING errcode = '22023';
  END IF;

  SELECT employee.id
    INTO v_employee_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
    AND employee.role::text IN (
      'admin',
      'office',
      'project_manager',
      'field_tech',
      'estimator',
      'supervisor'
    );

  IF v_employee_id IS NULL THEN
    IF COALESCE(
         (SELECT auth.jwt() ->> 'role' = 'service_role'),
         false
       ) THEN
      RETURN NULL;
    END IF;

    RAISE EXCEPTION 'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  INSERT INTO public.push_subscriptions (
    employee_id,
    endpoint,
    p256dh,
    auth,
    user_agent
  )
  VALUES (
    v_employee_id,
    p_endpoint,
    p_p256dh,
    p_auth,
    p_user_agent
  )
  ON CONFLICT (endpoint)
  DO UPDATE SET
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    updated_at = now()
  WHERE push_subscriptions.employee_id = EXCLUDED.employee_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: push endpoint belongs to another employee'
      USING errcode = '42501';
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
BEGIN
  IF NULLIF(btrim(p_endpoint), '') IS NULL THEN
    RAISE EXCEPTION 'endpoint is required'
      USING errcode = '22023';
  END IF;

  SELECT employee.id
    INTO v_employee_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
    AND employee.role::text IN (
      'admin',
      'office',
      'project_manager',
      'field_tech',
      'estimator',
      'supervisor'
    );

  IF v_employee_id IS NULL THEN
    IF COALESCE(
         (SELECT auth.jwt() ->> 'role' = 'service_role'),
         false
       ) THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.push_subscriptions subscription
    WHERE subscription.endpoint = p_endpoint
      AND subscription.employee_id <> v_employee_id
  ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: push endpoint belongs to another employee'
      USING errcode = '42501';
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE endpoint = p_endpoint
    AND employee_id = v_employee_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_device_token(
  p_employee_id uuid,
  p_token text,
  p_platform text
)
RETURNS public.device_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.device_tokens;
BEGIN
  IF p_employee_id IS NULL
     OR NULLIF(btrim(p_token), '') IS NULL
     OR p_platform NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION
      'employee, token, and supported platform are required'
      USING errcode = '22023';
  END IF;

  IF COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     ) THEN
    INSERT INTO public.device_tokens (employee_id, token, platform)
    VALUES (p_employee_id, p_token, p_platform)
    ON CONFLICT (token)
    DO UPDATE SET
      employee_id = EXCLUDED.employee_id,
      platform = EXCLUDED.platform,
      updated_at = now()
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  IF NOT public.is_current_active_internal_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own device token only'
      USING errcode = '42501';
  END IF;

  INSERT INTO public.device_tokens (employee_id, token, platform)
  VALUES (p_employee_id, p_token, p_platform)
  ON CONFLICT (token)
  DO UPDATE SET
    platform = EXCLUDED.platform,
    updated_at = now()
  WHERE device_tokens.employee_id = EXCLUDED.employee_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: device token belongs to another employee'
      USING errcode = '42501';
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_device_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
BEGIN
  IF NULLIF(btrim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'token is required'
      USING errcode = '22023';
  END IF;

  IF COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     ) THEN
    DELETE FROM public.device_tokens
    WHERE token = p_token;
    RETURN;
  END IF;

  SELECT employee.id
    INTO v_employee_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
    AND employee.role::text IN (
      'admin',
      'office',
      'project_manager',
      'field_tech',
      'estimator',
      'supervisor'
    );

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.device_tokens token_row
    WHERE token_row.token = p_token
      AND token_row.employee_id <> v_employee_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: device token belongs to another employee'
      USING errcode = '42501';
  END IF;

  DELETE FROM public.device_tokens
  WHERE token = p_token
    AND employee_id = v_employee_id;
END;
$function$;

ALTER FUNCTION public.get_employee_page_access(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_effective_notification_prefs(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_my_notification_prefs(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_my_notification_pref(uuid, text, text, boolean)
  OWNER TO postgres;
ALTER FUNCTION public.get_my_push_subscriptions(uuid) OWNER TO postgres;
ALTER FUNCTION public.upsert_push_subscription(text, text, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.delete_push_subscription(text) OWNER TO postgres;
ALTER FUNCTION public.upsert_device_token(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.delete_device_token(text) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.get_employee_page_access(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_page_access(uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_notification_prefs(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_notification_prefs(uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.set_my_notification_pref(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.set_my_notification_pref(uuid, text, text, boolean)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_push_subscriptions(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_push_subscriptions(uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.upsert_push_subscription(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.upsert_push_subscription(text, text, text, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.delete_push_subscription(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_device_token(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_device_token(uuid, text, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.delete_device_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_device_token(text)
  TO authenticated, service_role;

ALTER TABLE public.employee_page_access FORCE ROW LEVEL SECURITY;
DROP POLICY anon_read_employee_page_access ON public.employee_page_access;
DROP POLICY employee_page_access_admin_write ON public.employee_page_access;
REVOKE ALL PRIVILEGES ON TABLE public.employee_page_access
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.notification_prefs FORCE ROW LEVEL SECURITY;
DROP POLICY notification_prefs_all ON public.notification_prefs;
REVOKE ALL PRIVILEGES ON TABLE public.notification_prefs
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.push_subscriptions
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.device_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY "Own tokens or admin read" ON public.device_tokens;
REVOKE ALL PRIVILEGES ON TABLE public.device_tokens
  FROM PUBLIC, anon, authenticated;

DO $s1h_postcondition$
DECLARE
  v_expected record;
  v_oid oid;
  v_execute_grantees text[];
  v_grantable_count integer;
  v_table_expected record;
  v_table_acl_md5 text;
  v_employee_policy_names text[];
  v_employee_anon_privileges text[];
  v_employee_authenticated_privileges text[];
  v_employee_service_privileges text[];
  v_employee_public_privilege_count integer;
  v_employee_unexpected_table_acl_count integer;
  v_employee_authenticated_columns text[];
  v_employee_unexpected_column_acl_count integer;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.get_employee_page_access(uuid)',
          'get_employee_page_access',
          'p_employee_id uuid',
          'SETOF employee_page_access',
          'plpgsql',
          'v',
          ARRAY['search_path=public, extensions, pg_temp']::text[],
          '322bce8cdec88d162720747946378420',
          'b960beac5110a92a7242acb5d6f1d637'
        ),
        (
          'public.get_effective_notification_prefs(uuid)',
          'get_effective_notification_prefs',
          'p_employee_id uuid',
          'SETOF json',
          'plpgsql',
          's',
          ARRAY['search_path=public']::text[],
          '4225ce3d9a846bc453b9048dcd944bdf',
          '801a88bb22ef698306c35a6fc7482f7b'
        ),
        (
          'public.get_my_notification_prefs(uuid)',
          'get_my_notification_prefs',
          'p_employee_id uuid',
          'SETOF json',
          'plpgsql',
          's',
          ARRAY['search_path=public']::text[],
          'e5566bb6b37fe209cc800198c20021dd',
          'e902db39426544aaf9bb1a73bd664e56'
        ),
        (
          'public.set_my_notification_pref(uuid,text,text,boolean)',
          'set_my_notification_pref',
          'p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean',
          'notification_prefs',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          '5e85d4169bf7174182069c3c05e9f257',
          'e06ecc49305feb75c9dba70763e69b57'
        ),
        (
          'public.get_my_push_subscriptions(uuid)',
          'get_my_push_subscriptions',
          'p_employee_id uuid',
          'SETOF json',
          'plpgsql',
          's',
          ARRAY['search_path=public']::text[],
          'aa2f4c86229dc668a7058d48fb19c4a5',
          '02d9187d640c50b2312a261336cbb14f'
        ),
        (
          'public.upsert_push_subscription(text,text,text,text)',
          'upsert_push_subscription',
          'p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text',
          'push_subscriptions',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          'ed3dac15ddb19396513a646fb29193ca',
          'bf5d76a6459ad0e83fe6032b006c18f7'
        ),
        (
          'public.delete_push_subscription(text)',
          'delete_push_subscription',
          'p_endpoint text',
          'void',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          '045c27bb5197d883db905c48762ae58c',
          'ef5705028ced042542267b96cb8d4d0d'
        ),
        (
          'public.upsert_device_token(uuid,text,text)',
          'upsert_device_token',
          'p_employee_id uuid, p_token text, p_platform text',
          'device_tokens',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          '3cead33c27066c96d87611acc511eadc',
          'afb394c6c24a628afb61b4383ecca4c0'
        ),
        (
          'public.delete_device_token(text)',
          'delete_device_token',
          'p_token text',
          'void',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          'ceab81097149a578608962f8229692c9',
          '9273fd6c8990082cbdac75b9a3e1a0b4'
        )
    ) AS expected(
      identity,
      function_name,
      function_arguments,
      result_type,
      language_name,
      volatility,
      config,
      body_md5,
      definition_md5
    )
  LOOP
    v_oid := to_regprocedure(v_expected.identity);

    IF v_oid IS NULL OR (
      SELECT count(*)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected.function_name
    ) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'S1h postcondition expected one exact overload for %',
        v_expected.function_name;
    END IF;

    SELECT
      array_agg(
        COALESCE(grantee_role.rolname, 'PUBLIC')
        ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
      ),
      count(*) FILTER (WHERE acl.is_grantable)
      INTO v_execute_grantees, v_grantable_count
    FROM pg_proc p
    CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE p.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF v_oid IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_language l ON l.oid = p.prolang
         JOIN pg_roles owner_role ON owner_role.oid = p.proowner
         WHERE p.oid = v_oid
           AND l.lanname = v_expected.language_name
           AND owner_role.rolname = 'postgres'
           AND pg_get_function_arguments(p.oid) =
                 v_expected.function_arguments
           AND pg_get_function_result(p.oid) =
                 v_expected.result_type
           AND p.prosecdef
           AND NOT p.proisstrict
           AND NOT p.proleakproof
           AND p.provolatile = v_expected.volatility
           AND p.proparallel = 'u'
           AND p.prokind = 'f'
           AND p.proconfig = v_expected.config
           AND md5(p.prosrc) = v_expected.body_md5
           AND md5(pg_get_functiondef(p.oid)) =
                 v_expected.definition_md5
       )
       OR v_execute_grantees IS DISTINCT FROM
            ARRAY['authenticated','postgres','service_role']::text[]
       OR v_grantable_count IS DISTINCT FROM 0
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            IS DISTINCT FROM true
       OR has_function_privilege('service_role', v_oid, 'EXECUTE')
            IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'S1h postcondition function ACL failure: identity=%, grantees=%, grantable=%',
        v_expected.identity,
        v_execute_grantees,
        v_grantable_count;
    END IF;
  END LOOP;

  v_oid := to_regprocedure(
    'public.is_current_active_internal_employee(uuid)'
  );

  SELECT
    array_agg(
      COALESCE(grantee_role.rolname, 'PUBLIC')
      ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
    ),
    count(*) FILTER (WHERE acl.is_grantable)
    INTO v_execute_grantees, v_grantable_count
  FROM pg_proc p
  CROSS JOIN LATERAL
    aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE p.oid = v_oid
    AND acl.privilege_type = 'EXECUTE';

  IF v_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_language l ON l.oid = p.prolang
       JOIN pg_roles owner_role ON owner_role.oid = p.proowner
       WHERE p.oid = v_oid
         AND l.lanname = 'sql'
         AND owner_role.rolname = 'postgres'
         AND pg_get_function_arguments(p.oid) = 'p_employee_id uuid'
         AND pg_get_function_result(p.oid) = 'boolean'
         AND p.prosecdef
         AND p.provolatile = 's'
         AND p.proconfig = ARRAY['search_path=public']::text[]
         AND md5(p.prosrc) = 'fa283855321fd2e67af47311ab28b4c1'
         AND md5(pg_get_functiondef(p.oid)) =
               'c763b92de7317c475924ca179ece3ec3'
     )
     OR v_execute_grantees IS DISTINCT FROM ARRAY['postgres']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR has_function_privilege(
       'anon',
       'public.is_current_active_internal_employee(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.is_current_active_internal_employee(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.is_current_active_internal_employee(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'S1h postcondition private helper ACL failure';
  END IF;

  IF (
       SELECT count(*)
       FROM pg_proc procedure
       JOIN pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname IN (
           'is_current_active_internal_employee',
           'upsert_push_subscription',
           'delete_push_subscription',
           'delete_device_token'
         )
         AND regexp_replace(
           procedure.prosrc,
           '[[:space:]]+',
           ' ',
           'g'
         ) LIKE
           '%AND NOT employee.is_external AND employee.role::text IN ( ''admin'', ''office'', ''project_manager'', ''field_tech'', ''estimator'', ''supervisor'' )%'
     ) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION
      'S1h postcondition active-internal role allowlist drift';
  END IF;

  FOR v_table_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'employee_page_access',
          'b8b0e1bc6d2009f5341cd784a3a7d0e7'
        ),
        (
          'notification_prefs',
          'b8b0e1bc6d2009f5341cd784a3a7d0e7'
        ),
        (
          'push_subscriptions',
          'b8b0e1bc6d2009f5341cd784a3a7d0e7'
        ),
        (
          'device_tokens',
          'b8b0e1bc6d2009f5341cd784a3a7d0e7'
        )
    ) AS expected(table_name, acl_md5)
  LOOP
    SELECT md5(
      string_agg(
        format(
          '%s:%s:%s',
          COALESCE(grantee_role.rolname, 'PUBLIC'),
          acl.privilege_type,
          acl.is_grantable
        ),
        E'\n'
        ORDER BY
          COALESCE(grantee_role.rolname, 'PUBLIC'),
          acl.privilege_type,
          acl.is_grantable
      )
    )
      INTO v_table_acl_md5
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL
      aclexplode(
        COALESCE(
          relation.relacl,
          acldefault('r', relation.relowner)
        )
      ) acl
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relname = v_table_expected.table_name;

    IF v_table_acl_md5 IS DISTINCT FROM v_table_expected.acl_md5 THEN
      RAISE EXCEPTION
        'S1h postcondition relation ACL failed: table=%, acl_md5=%',
        v_table_expected.table_name,
        v_table_acl_md5;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'employee_page_access',
        'notification_prefs',
        'push_subscriptions',
        'device_tokens'
      )
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
      AND cardinality(attribute.attacl) > 0
  ) THEN
    RAISE EXCEPTION
      'S1h postcondition unexpected target-table column ACL';
  END IF;

  IF EXISTS (
    WITH expected(
      table_name,
      columns_md5,
      constraints_md5,
      indexes_md5
    ) AS (
      VALUES
        (
          'device_tokens',
          '436d8e67577c2494d101e3572da0ed72',
          'b404642ee006aac56488662e309e75b4',
          '5bea678ca4a85697e308b8728d6cc344'
        ),
        (
          'employee_page_access',
          '8153d07e9417a0718e71f769cea622ba',
          '83c2d83a6d6ac03dda5a44c8f9d0e1e0',
          '5fbbc307824f65aed80ee6fedadb4c40'
        ),
        (
          'notification_prefs',
          '8dc6b2e929b8fd5d000c97003b786ba4',
          'f7289d520c842200d2960b4f0a5daeed',
          '8984b2ab8e2e155309517c448b08a979'
        ),
        (
          'push_subscriptions',
          'd827ea97e7ee6cf032080729a12e1253',
          '8ee5bdc8ddfa993d319480ab1d1d2d5a',
          'f15c2aa376955f574d81d9bb6cf0c662'
        )
    ),
    target_relations AS (
      SELECT relation.oid, relation.relname
      FROM pg_class relation
      JOIN pg_namespace namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind = 'r'
        AND relation.relname IN (
          SELECT expected.table_name
          FROM expected
        )
    ),
    actual AS (
      SELECT
        target.relname AS table_name,
        md5((
          SELECT jsonb_agg(
            jsonb_build_object(
              'attnum', attribute.attnum,
              'name', attribute.attname,
              'type',
                format_type(attribute.atttypid, attribute.atttypmod),
              'not_null', attribute.attnotnull,
              'identity', attribute.attidentity,
              'generated', attribute.attgenerated,
              'default',
                pg_get_expr(default_value.adbin, default_value.adrelid)
            )
            ORDER BY attribute.attnum
          )::text
          FROM pg_attribute attribute
          LEFT JOIN pg_attrdef default_value
            ON default_value.adrelid = attribute.attrelid
           AND default_value.adnum = attribute.attnum
          WHERE attribute.attrelid = target.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )) AS columns_md5,
        md5((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', constraint_record.conname,
              'type', constraint_record.contype,
              'definition',
                pg_get_constraintdef(constraint_record.oid, true)
            )
            ORDER BY constraint_record.conname
          )::text
          FROM pg_constraint constraint_record
          WHERE constraint_record.conrelid = target.oid
        )) AS constraints_md5,
        md5((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', index_relation.relname,
              'definition', pg_get_indexdef(index_record.indexrelid)
            )
            ORDER BY index_relation.relname
          )::text
          FROM pg_index index_record
          JOIN pg_class index_relation
            ON index_relation.oid = index_record.indexrelid
          WHERE index_record.indrelid = target.oid
        )) AS indexes_md5
      FROM target_relations target
    )
    SELECT 1
    FROM expected
    LEFT JOIN actual USING (table_name)
    WHERE actual.table_name IS NULL
       OR actual.columns_md5 IS DISTINCT FROM expected.columns_md5
       OR actual.constraints_md5 IS DISTINCT FROM
            expected.constraints_md5
       OR actual.indexes_md5 IS DISTINCT FROM expected.indexes_md5
  ) THEN
    RAISE EXCEPTION 'S1h postcondition target-table catalog drift';
  END IF;

  IF (
       SELECT count(*)
       FROM pg_roles
       WHERE rolname IN ('postgres', 'service_role')
         AND rolbypassrls
     ) IS DISTINCT FROM 2
     OR (
       SELECT count(*)
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname IN (
           'employee_page_access',
           'notification_prefs',
           'push_subscriptions',
           'device_tokens'
         )
         AND relation.relrowsecurity
         AND relation.relforcerowsecurity
     ) IS DISTINCT FROM 4
     OR EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN (
           'employee_page_access',
           'notification_prefs',
           'push_subscriptions',
           'device_tokens'
         )
     ) THEN
    RAISE EXCEPTION
      'S1h postcondition RPC-only table boundary failure';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_employee_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'employees';

  IF v_employee_policy_names IS DISTINCT FROM
       ARRAY['employees_self_identity_read']::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
         AND policyname = 'employees_self_identity_read'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'SELECT'
         AND qual = '(auth_user_id = auth.uid())'
         AND with_check IS NULL
     ) THEN
    RAISE EXCEPTION
      'S1h postcondition employee policy drift: %',
      v_employee_policy_names;
  END IF;

  SELECT
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'anon'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'authenticated'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'service_role'),
      ARRAY[]::text[]
    ),
    count(*) FILTER (WHERE acl.grantee = 0),
    count(*) FILTER (
      WHERE acl.grantor <> relation.relowner
         OR acl.grantee = 0
         OR COALESCE(grantee_role.rolname, '') NOT IN (
           'postgres',
           'service_role'
         )
         OR (
           acl.is_grantable
           AND acl.grantee <> relation.relowner
         )
    )
    INTO
      v_employee_anon_privileges,
      v_employee_authenticated_privileges,
      v_employee_service_privileges,
      v_employee_public_privilege_count,
      v_employee_unexpected_table_acl_count
  FROM pg_class relation
  JOIN pg_namespace namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(
      relation.relacl,
      acldefault('r', relation.relowner)
    )
  ) acl
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'employees';

  SELECT
    array_agg(attribute.attname ORDER BY attribute.attname)
      FILTER (
        WHERE grantee_role.rolname = 'authenticated'
          AND acl.privilege_type = 'SELECT'
      ),
    count(*) FILTER (
      WHERE acl.privilege_type <> 'SELECT'
         OR grantee_role.rolname <> 'authenticated'
         OR attribute.attname NOT IN (
           'id',
           'auth_user_id',
           'role',
           'is_active'
         )
         OR acl.is_grantable
    )
    INTO
      v_employee_authenticated_columns,
      v_employee_unexpected_column_acl_count
  FROM pg_attribute attribute
  CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE attribute.attrelid = 'public.employees'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attacl IS NOT NULL;

  IF v_employee_anon_privileges IS DISTINCT FROM ARRAY[]::text[]
     OR v_employee_authenticated_privileges IS DISTINCT FROM ARRAY[]::text[]
     OR v_employee_service_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_employee_public_privilege_count <> 0
     OR v_employee_unexpected_table_acl_count <> 0
     OR v_employee_authenticated_columns IS DISTINCT FROM
       ARRAY['auth_user_id', 'id', 'is_active', 'role']::text[]
     OR v_employee_unexpected_column_acl_count <> 0
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'SELECT'
        )
     OR has_table_privilege('anon', 'public.employees', 'SELECT') THEN
    RAISE EXCEPTION
      'S1h postcondition employee ACL drift: anon=%, authenticated=%, service=%, public=%, unexpected_table=%, columns=%, unexpected_column=%',
      v_employee_anon_privileges,
      v_employee_authenticated_privileges,
      v_employee_service_privileges,
      v_employee_public_privilege_count,
      v_employee_unexpected_table_acl_count,
      v_employee_authenticated_columns,
      v_employee_unexpected_column_acl_count;
  END IF;
END;
$s1h_postcondition$;
