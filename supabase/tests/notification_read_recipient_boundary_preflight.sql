-- S1g notification read/recipient boundary — value-free preflight.
--
-- Catalog metadata only. This script never reads notification rows, invokes an
-- RPC, writes data, changes grants/policies, or emits a Realtime/provider event.

DO $s1g_catalog_preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_overload_count integer;
  v_execute_grantees text[];
  v_grantable_count integer;
  v_column_shape_md5 text;
  v_table_acl_shape_md5 text;
BEGIN
  IF to_regclass('public.notification_reads') IS NOT NULL THEN
    RAISE EXCEPTION
      'S1g preflight expected public.notification_reads to be absent';
  END IF;

  SELECT md5(
           string_agg(
             format(
               '%s|%s|%s|%s',
               attribute.attnum,
               attribute.attname,
               format_type(attribute.atttypid, attribute.atttypmod),
               attribute.attnotnull
             ),
             E'\n'
             ORDER BY attribute.attnum
           )
         )
    INTO v_column_shape_md5
  FROM pg_attribute attribute
  WHERE attribute.attrelid = to_regclass('public.notifications')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  SELECT md5(
           string_agg(
             format(
               '%s|%s|%s|%s',
               acl.grantor::regrole::text,
               CASE
                 WHEN acl.grantee = 0 THEN 'PUBLIC'
                 ELSE acl.grantee::regrole::text
               END,
               acl.privilege_type,
               acl.is_grantable
             ),
             E'\n'
             ORDER BY
               CASE
                 WHEN acl.grantee = 0 THEN 'PUBLIC'
                 ELSE acl.grantee::regrole::text
               END,
               acl.privilege_type
           )
         )
    INTO v_table_acl_shape_md5
  FROM pg_class relation
  CROSS JOIN LATERAL
    aclexplode(
      COALESCE(
        relation.relacl,
        acldefault('r', relation.relowner)
      )
    ) acl
  WHERE relation.oid = to_regclass('public.notifications');

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_containment'
     ) IS DISTINCT FROM 1
     OR to_regprocedure('auth.jwt()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles role_record
       WHERE role_record.rolname = 'postgres'
         AND role_record.rolbypassrls
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles role_record
       WHERE role_record.rolname = 'service_role'
         AND role_record.rolbypassrls
     )
     OR v_column_shape_md5 IS DISTINCT FROM
       '0170db1f6199da7f23355b35ba343954'
     OR v_table_acl_shape_md5 IS DISTINCT FROM
       'f7cafbf463643b5debc08b30a5cba10e'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.notifications')
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
     )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notifications')
     ) IS DISTINCT FROM
       ARRAY['notifications_delete_testrows', 'notifications_select']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notifications')
         AND policy.polname = 'notifications_select'
         AND policy.polcmd = 'r'
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND md5(COALESCE(
               pg_get_expr(policy.polqual, policy.polrelid),
               ''
             )) = 'b326b5062b2f0e69046810717534cb09'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notifications')
         AND policy.polname = 'notifications_delete_testrows'
         AND policy.polcmd = 'd'
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND md5(COALESCE(
               pg_get_expr(policy.polqual, policy.polrelid),
               ''
             )) = 'b60edd5d780221512206b2510a93c3db'
     )
     OR (
       SELECT array_agg(
                publication.pubname::text
                ORDER BY publication.pubname::text
              )
       FROM pg_publication_rel publication_relation
       JOIN pg_publication publication
         ON publication.oid = publication_relation.prpubid
       WHERE publication_relation.prrelid =
             to_regclass('public.notifications')
     ) IS DISTINCT FROM ARRAY['supabase_realtime']::text[]
     OR EXISTS (
       SELECT 1
       FROM pg_publication publication
       WHERE publication.puballtables
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.notifications')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND cardinality(attribute.attacl) > 0
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
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.employees')
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
     )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'SELECT'
        )
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'anon',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
     ) IS DISTINCT FROM
       ARRAY['employees_self_identity_read']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'employees_self_identity_read'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) =
               'auth_user_id = auth.uid()'
         AND policy.polwithcheck IS NULL
     )
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'anon'
     ) IS DISTINCT FROM ARRAY[]::text[]
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'authenticated'
     ) IS DISTINCT FROM ARRAY[]::text[]
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'service_role'
     ) IS DISTINCT FROM
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
     OR EXISTS (
       SELECT 1
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND (
           acl.grantor <> relation.relowner
           OR acl.grantee = 0
           OR (
             acl.grantee <> relation.relowner
             AND COALESCE(grantee_role.rolname, '') NOT IN (
               'authenticated',
               'service_role'
             )
           )
           OR (
             acl.is_grantable
             AND acl.grantee <> relation.relowner
           )
         )
     )
     OR (
       SELECT array_agg(
                attribute.attname::text
                ORDER BY attribute.attname
              )
       FROM pg_attribute attribute
       CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND grantee_role.rolname = 'authenticated'
         AND acl.privilege_type = 'SELECT'
     ) IS DISTINCT FROM
       ARRAY['auth_user_id', 'id', 'is_active', 'is_external', 'role']::text[]
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       JOIN pg_class relation ON relation.oid = attribute.attrelid
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND (
           acl.grantor <> relation.relowner
           OR grantee_role.rolname IS DISTINCT FROM 'authenticated'
           OR acl.privilege_type <> 'SELECT'
           OR attribute.attname NOT IN (
             'id',
             'auth_user_id',
             'role',
             'is_active',
             'is_external'
           )
           OR acl.is_grantable
         )
     ) THEN
    RAISE EXCEPTION
      'S1g catalog preflight table/policy/dependency drift: columns=%, ACL=%',
      v_column_shape_md5,
      v_table_acl_shape_md5;
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'get_notifications',
          'public.get_notifications(integer,uuid)',
          'p_limit integer DEFAULT 30, p_employee_id uuid DEFAULT NULL::uuid',
          'SETOF notifications',
          'a66659f2c54bc0b7bdc2b60949fdb883',
          '7e932efdb51db6b3fc48567e533b4461'
        ),
        (
          'get_unread_notification_count',
          'public.get_unread_notification_count(uuid)',
          'p_employee_id uuid DEFAULT NULL::uuid',
          'integer',
          'b15c8a180f65586d6bd3c4f75d1c6f9e',
          '9caee22bd136f6a0a48641ab7b5b1777'
        ),
        (
          'mark_all_notifications_read',
          'public.mark_all_notifications_read(uuid)',
          'p_employee_id uuid DEFAULT NULL::uuid',
          'void',
          '4ba9b450a720c65bb2149d45f6ea53f1',
          'a5782492c10f797fb36253cc5ae502a2'
        ),
        (
          'mark_notification_read',
          'public.mark_notification_read(uuid)',
          'p_id uuid',
          'void',
          '389254cd40d74bdec30f23c7ebeb498e',
          '68897ae73b531556d11805a906210afc'
        )
    ) AS expected(
      function_name,
      identity,
      arguments,
      result_type,
      body_md5,
      definition_md5
    )
  LOOP
    SELECT count(*)
      INTO v_overload_count
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = v_expected.function_name;

    v_oid := to_regprocedure(v_expected.identity);

    IF v_oid IS NULL
       OR v_overload_count IS DISTINCT FROM 1
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc procedure
         JOIN pg_language language ON language.oid = procedure.prolang
         JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
         WHERE procedure.oid = v_oid
           AND language.lanname = 'sql'
           AND owner_role.rolname = 'postgres'
           AND pg_get_function_arguments(procedure.oid) =
                 v_expected.arguments
           AND pg_get_function_result(procedure.oid) = v_expected.result_type
           AND procedure.prosecdef
           AND NOT procedure.proisstrict
           AND NOT procedure.proleakproof
           AND procedure.provolatile = 'v'
           AND procedure.proparallel = 'u'
           AND procedure.prokind = 'f'
           AND procedure.proconfig = ARRAY['search_path=public']::text[]
           AND md5(procedure.prosrc) = v_expected.body_md5
           AND md5(pg_get_functiondef(procedure.oid)) =
                 v_expected.definition_md5
       ) THEN
      RAISE EXCEPTION
        'S1g catalog preflight % metadata/body drift',
        v_expected.identity;
    END IF;

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

    IF v_execute_grantees IS DISTINCT FROM
         ARRAY['authenticated', 'postgres', 'service_role']::text[]
       OR v_grantable_count IS DISTINCT FROM 0
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            IS DISTINCT FROM true
       OR has_function_privilege('service_role', v_oid, 'EXECUTE')
            IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'S1g catalog preflight % ACL drift: grantees=%, grantable=%',
        v_expected.identity,
        v_execute_grantees,
        v_grantable_count;
    END IF;
  END LOOP;
END;
$s1g_catalog_preflight$;
