-- S1h mobile personal-ownership boundary — value-free preflight.
--
-- Catalog metadata only. This script never reads application rows, invokes a
-- business RPC, writes data, or changes a function, grant, policy, or table.
-- permission_write_gates may have source replay version 20260726220000 or its
-- live-assigned version 20260727012825; no other version/name multiplicity is
-- accepted.

DO $s1h_catalog_preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_overload_count integer;
  v_execute_grantees text[];
  v_grantable_count integer;
  v_table_expected record;
  v_table_acl_md5 text;
  v_catalog_expected record;
  v_columns_md5 text;
  v_constraints_md5 text;
  v_indexes_md5 text;
  v_policy_names text[];
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
     )
     OR (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations
       WHERE name =
         'upsert_employee_page_access_provenance_reconciliation'
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations
       WHERE name = 'mobile_employee_identity_containment'
     )
       IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'S1h catalog preflight dependency ledger drift';
  END IF;

  IF to_regprocedure(
       'public.is_current_active_internal_employee(uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'S1h catalog preflight expected the private helper to be absent';
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
          ARRAY[
            'PUBLIC',
            'anon',
            'authenticated',
            'postgres',
            'service_role'
          ]::text[]
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
        ),
        (
          'public.is_active_internal_admin()',
          'is_active_internal_admin',
          '',
          'boolean',
          'sql',
          's',
          ARRAY['search_path=public']::text[],
          'ef9b97f5a64e030b1b1b9dfb779b1db3',
          '36280b5dfb5612790480c58083d9ee64',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.upsert_employee_page_access(uuid,text,boolean,uuid)',
          'upsert_employee_page_access',
          'p_employee_id uuid, p_nav_key text, p_can_view boolean, p_updated_by uuid DEFAULT NULL::uuid',
          'employee_page_access',
          'plpgsql',
          'v',
          ARRAY['search_path=public, extensions, pg_temp']::text[],
          '16e440632831b52155d5a9c6ba7b21a3',
          NULL::text,
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.delete_employee_page_access(uuid,text)',
          'delete_employee_page_access',
          'p_employee_id uuid, p_nav_key text',
          'void',
          'plpgsql',
          'v',
          ARRAY['search_path=public, extensions, pg_temp']::text[],
          'b108f96a46006185cf2b6ad4b0a147aa',
          '671c4cdc4a3304634b005b43ac51d53e',
          ARRAY['authenticated','postgres','service_role']::text[]
        )
    ) AS expected(
      identity,
      function_name,
      arguments,
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

    SELECT count(*)
      INTO v_overload_count
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = v_expected.function_name;

    SELECT
      array_agg(
        COALESCE(grantee_role.rolname, 'PUBLIC')
        ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
      ),
      count(*) FILTER (WHERE acl.is_grantable)
      INTO v_execute_grantees, v_grantable_count
    FROM pg_proc procedure
    CROSS JOIN LATERAL
      aclexplode(
        COALESCE(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )
      ) acl
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE procedure.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF v_oid IS NULL
       OR v_overload_count IS DISTINCT FROM 1
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc procedure
         JOIN pg_language language ON language.oid = procedure.prolang
         JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
         WHERE procedure.oid = v_oid
           AND language.lanname = v_expected.language_name
           AND owner_role.rolname = 'postgres'
           AND pg_get_function_arguments(procedure.oid) =
                 v_expected.arguments
           AND pg_get_function_result(procedure.oid) =
                 v_expected.result_type
           AND procedure.prosecdef
           AND NOT procedure.proisstrict
           AND NOT procedure.proleakproof
           AND procedure.provolatile = v_expected.volatility
           AND procedure.proparallel = 'u'
           AND procedure.prokind = 'f'
           AND procedure.proconfig = v_expected.config
           AND md5(procedure.prosrc) = v_expected.body_md5
           AND (
             v_expected.definition_md5 IS NULL
             OR md5(pg_get_functiondef(procedure.oid)) =
                  v_expected.definition_md5
           )
       )
       OR v_execute_grantees IS DISTINCT FROM
            v_expected.execute_grantees
       OR v_grantable_count IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'S1h catalog preflight function drift: identity=%, overloads=%, grantees=%, grantable=%',
        v_expected.identity,
        v_overload_count,
        v_execute_grantees,
        v_grantable_count;
    END IF;
  END LOOP;

  IF (
       SELECT count(*)
       FROM pg_roles
       WHERE rolname IN ('postgres', 'service_role')
         AND rolbypassrls
     ) IS DISTINCT FROM 2
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure('auth.uid()')
         AND pg_get_function_result(procedure.oid) = 'uuid'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure('auth.jwt()')
         AND pg_get_function_result(procedure.oid) = 'jsonb'
     )
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
         AND relation.relkind = 'r'
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
    RAISE EXCEPTION
      'S1h catalog preflight auth/employee dependency drift';
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
      'S1h catalog preflight employee self-only boundary drift';
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
      'S1h catalog preflight employee ACL drift: anon=%, authenticated=%, service=%, public=%, unexpected_table=%, columns=%, unexpected_column=%',
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
      'S1h catalog preflight found a browser-executable employee authority mutator';
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
      'S1h catalog preflight target-table owner/RLS drift';
  END IF;

  FOR v_table_expected IN
    SELECT *
    FROM (
      VALUES
        ('employee_page_access', '5af89d01800b50292cd05f0582531d89'),
        ('notification_prefs', '5af89d01800b50292cd05f0582531d89'),
        ('push_subscriptions', '5af89d01800b50292cd05f0582531d89'),
        ('device_tokens', '5af89d01800b50292cd05f0582531d89')
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
        'S1h catalog preflight table ACL drift: table=%, acl_md5=%',
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
      'S1h catalog preflight expected zero target-table column ACLs';
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
        'S1h catalog preflight table fingerprint drift: table=%, columns=%, constraints=%, indexes=%',
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
      'S1h catalog preflight employee_page_access policy drift: %',
      v_policy_names;
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'notification_prefs';

  IF v_policy_names IS DISTINCT FROM
       ARRAY['notification_prefs_all']::text[]
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
      'S1h catalog preflight notification_prefs policy drift: %',
      v_policy_names;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_subscriptions'
  ) THEN
    RAISE EXCEPTION
      'S1h catalog preflight expected zero push_subscriptions policies';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'device_tokens';

  IF v_policy_names IS DISTINCT FROM
       ARRAY['Own tokens or admin read']::text[]
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
      'S1h catalog preflight device_tokens policy drift: %',
      v_policy_names;
  END IF;
END;
$s1h_catalog_preflight$;
