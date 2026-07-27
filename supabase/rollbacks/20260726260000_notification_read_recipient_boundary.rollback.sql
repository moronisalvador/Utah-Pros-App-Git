-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260726260000_notification_read_recipient_boundary
-- Phase: Mobile Production Readiness S1g
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- DANGER:
--   This rollback deliberately reopens cross-recipient notification reads,
--   foreign read mutations, broad Realtime payload delivery, authenticated
--   sentinel deletion, and shared broadcast read state. It also drops every
--   per-employee broadcast receipt created after S1g.
--
--   Prefer a forward repair. If the owner explicitly accepts those consequences,
--   run this script in a dedicated session after first setting:
--
--     SET upr.allow_unsafe_s1g_rollback = 'on';
--
--   The guard and exact forward-state checks fail closed otherwise.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $s1g_rollback_preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_overload_count integer;
  v_execute_grantees text[];
  v_grantable_count integer;
  v_receipt_acl_shape_md5 text;
  v_notifications_acl_shape_md5 text;
  v_select_policy_md5 text;
BEGIN
  IF current_setting('upr.allow_unsafe_s1g_rollback', true)
       IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'Unsafe S1g rollback refused; owner must SET upr.allow_unsafe_s1g_rollback = on';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_authority'
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
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.employees')
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
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
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = to_regclass('public.employees')
         AND constraint_record.contype = 'u'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'UNIQUE (auth_user_id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles role_record
       WHERE role_record.rolname = 'service_role'
         AND role_record.rolbypassrls
     )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
     ) IS DISTINCT FROM ARRAY['allow_authenticated_employees']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_authenticated_employees'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
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
     ) IS DISTINCT FROM ARRAY['SELECT']::text[]
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
     ) IS DISTINCT FROM ARRAY[
       'DELETE',
       'INSERT',
       'MAINTAIN',
       'REFERENCES',
       'SELECT',
       'TRIGGER',
       'TRUNCATE',
       'UPDATE'
     ]::text[]
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'anon',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR NOT has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
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
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND cardinality(attribute.attacl) > 0
     ) THEN
    RAISE EXCEPTION
      'S1g rollback preflight employee identity authority is absent or drifted';
  END IF;

  IF to_regclass('public.notification_reads') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.notification_reads')
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND relation.relforcerowsecurity
     )
     OR (
       SELECT count(*)
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.notification_reads')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
     ) IS DISTINCT FROM 3
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       LEFT JOIN pg_attrdef default_record
         ON default_record.adrelid = attribute.attrelid
        AND default_record.adnum = attribute.attnum
       WHERE attribute.attrelid = to_regclass('public.notification_reads')
         AND attribute.attnum = 1
         AND attribute.attname = 'notification_id'
         AND format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
         AND attribute.attnotnull
         AND default_record.oid IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       LEFT JOIN pg_attrdef default_record
         ON default_record.adrelid = attribute.attrelid
        AND default_record.adnum = attribute.attnum
       WHERE attribute.attrelid = to_regclass('public.notification_reads')
         AND attribute.attnum = 2
         AND attribute.attname = 'employee_id'
         AND format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
         AND attribute.attnotnull
         AND default_record.oid IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       JOIN pg_attrdef default_record
         ON default_record.adrelid = attribute.attrelid
        AND default_record.adnum = attribute.attnum
       WHERE attribute.attrelid = to_regclass('public.notification_reads')
         AND attribute.attnum = 3
         AND attribute.attname = 'read_at'
         AND format_type(attribute.atttypid, attribute.atttypmod) =
               'timestamp with time zone'
         AND attribute.attnotnull
         AND pg_get_expr(default_record.adbin, default_record.adrelid) = 'now()'
     )
     OR (
       SELECT count(*)
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid =
               to_regclass('public.notification_reads')
     ) IS DISTINCT FROM 3
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid =
               to_regclass('public.notification_reads')
         AND constraint_record.conname = 'notification_reads_pkey'
         AND constraint_record.contype = 'p'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'PRIMARY KEY (notification_id, employee_id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid =
               to_regclass('public.notification_reads')
         AND constraint_record.conname =
               'notification_reads_notification_id_fkey'
         AND constraint_record.contype = 'f'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid =
               to_regclass('public.notification_reads')
         AND constraint_record.conname =
               'notification_reads_employee_id_fkey'
         AND constraint_record.contype = 'f'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE'
     )
     OR (
       SELECT count(*)
       FROM pg_index index_record
       WHERE index_record.indrelid =
               to_regclass('public.notification_reads')
     ) IS DISTINCT FROM 2
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index index_record
       WHERE index_record.indrelid =
               to_regclass('public.notification_reads')
         AND index_record.indexrelid =
               to_regclass('public.notification_reads_pkey')
         AND index_record.indisprimary
         AND index_record.indisunique
         AND pg_get_indexdef(index_record.indexrelid) =
               'CREATE UNIQUE INDEX notification_reads_pkey ON public.notification_reads USING btree (notification_id, employee_id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index index_record
       WHERE index_record.indrelid =
               to_regclass('public.notification_reads')
         AND index_record.indexrelid =
               to_regclass('public.notification_reads_employee_id_idx')
         AND NOT index_record.indisprimary
         AND NOT index_record.indisunique
         AND pg_get_indexdef(index_record.indexrelid) =
               'CREATE INDEX notification_reads_employee_id_idx ON public.notification_reads USING btree (employee_id)'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notification_reads')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_publication_rel publication_relation
       WHERE publication_relation.prrelid =
               to_regclass('public.notification_reads')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_publication publication
       WHERE publication.puballtables
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid =
             to_regclass('public.notification_reads')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND cardinality(attribute.attacl) > 0
     ) THEN
    RAISE EXCEPTION
      'S1g rollback preflight notification_reads metadata drift';
  END IF;

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
    INTO v_receipt_acl_shape_md5
  FROM pg_class relation
  CROSS JOIN LATERAL
    aclexplode(
      COALESCE(
        relation.relacl,
        acldefault('r', relation.relowner)
      )
    ) acl
  WHERE relation.oid = to_regclass('public.notification_reads');

  IF v_receipt_acl_shape_md5 IS DISTINCT FROM
       '5ae62afd8335deffffb81c9aa98f62be' THEN
    RAISE EXCEPTION
      'S1g rollback preflight notification_reads ACL drift: md5=%',
      v_receipt_acl_shape_md5;
  END IF;

  IF (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notifications')
     ) IS DISTINCT FROM ARRAY['notifications_select']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notifications')
         AND policy.polname = 'notifications_select'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND policy.polwithcheck IS NULL
         AND md5(COALESCE(
               pg_get_expr(policy.polqual, policy.polrelid),
               ''
             )) = 'f6a4b946f6d65eadf3bf4764e734d5b1'
     ) THEN
    RAISE EXCEPTION
      'S1g rollback preflight notifications policy metadata drift';
  END IF;

  SELECT md5(COALESCE(
           pg_get_expr(policy.polqual, policy.polrelid),
           ''
         ))
    INTO v_select_policy_md5
  FROM pg_policy policy
  WHERE policy.polrelid = to_regclass('public.notifications')
    AND policy.polname = 'notifications_select';

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
    INTO v_notifications_acl_shape_md5
  FROM pg_class relation
  CROSS JOIN LATERAL
    aclexplode(
      COALESCE(
        relation.relacl,
        acldefault('r', relation.relowner)
      )
    ) acl
  WHERE relation.oid = to_regclass('public.notifications');

  IF v_select_policy_md5 IS DISTINCT FROM
       'f6a4b946f6d65eadf3bf4764e734d5b1'
     OR v_notifications_acl_shape_md5 IS DISTINCT FROM
       'c821903bc39dd59e6ac6b60d039a731d'
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
     ) THEN
    RAISE EXCEPTION
      'S1g rollback preflight notifications policy/ACL/Realtime drift: policy=%, ACL=%',
      v_select_policy_md5,
      v_notifications_acl_shape_md5;
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
          'fefa4b58a7cf9faaae6d235c98faa1d6',
          'a9d0da79befb2d2cb2a3e5452d3c6269'
        ),
        (
          'get_unread_notification_count',
          'public.get_unread_notification_count(uuid)',
          'p_employee_id uuid DEFAULT NULL::uuid',
          'integer',
          '2b8706a1ff85ab821c44e084f66bc998',
          '8bd9df112ee1a6a7ff9f5c18789142d8'
        ),
        (
          'mark_all_notifications_read',
          'public.mark_all_notifications_read(uuid)',
          'p_employee_id uuid DEFAULT NULL::uuid',
          'void',
          '17535104ecaa23b9eb98c9192921cf05',
          'd954d04ad3e3fe2ead30ec3e9d8bfbf7'
        ),
        (
          'mark_notification_read',
          'public.mark_notification_read(uuid)',
          'p_id uuid',
          'void',
          'cbe82dd0652029a881944527e99b9091',
          '868d6fd6e3a5278d152860318753805f'
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
           AND language.lanname = 'plpgsql'
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
        'S1g rollback preflight % definition/metadata drift',
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
        'S1g rollback preflight % ACL drift: grantees=%, grantable=%',
        v_expected.identity,
        v_execute_grantees,
        v_grantable_count;
    END IF;
  END LOOP;
END;
$s1g_rollback_preflight$;

-- Restore the exact live pre-S1g bodies captured on 2026-07-26.
CREATE OR REPLACE FUNCTION public.get_notifications(
  p_limit integer DEFAULT 30,
  p_employee_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF notifications
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public.notifications
   WHERE recipient_id IS NULL OR recipient_id = p_employee_id
   ORDER BY created_at DESC
   LIMIT greatest(1, least(p_limit, 100));
$function$;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(
  p_employee_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::int FROM public.notifications
   WHERE read_at IS NULL AND (recipient_id IS NULL OR recipient_id = p_employee_id);
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_employee_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.notifications SET read_at = now()
   WHERE read_at IS NULL AND (recipient_id IS NULL OR recipient_id = p_employee_id);
$function$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  update public.notifications set read_at = now() where id = p_id and read_at is null;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_notifications(integer, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_unread_notification_count(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_notifications(integer, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid)
  TO authenticated, service_role;

ALTER POLICY notifications_select
  ON public.notifications
  TO authenticated
  USING (true);

CREATE POLICY notifications_delete_testrows
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (type = '__f2test__'::text);

REVOKE ALL PRIVILEGES ON TABLE public.notifications
  FROM PUBLIC, anon, authenticated, service_role;
-- The historical anon table grant is intentionally not restored. Notifications
-- have no reviewed pre-auth use case or public allowlist entry.
GRANT ALL PRIVILEGES ON TABLE public.notifications
  TO authenticated, service_role;

DROP TABLE public.notification_reads;

DO $s1g_rollback_postcondition$
DECLARE
  v_expected record;
  v_oid oid;
  v_overload_count integer;
  v_execute_grantees text[];
  v_grantable_count integer;
  v_table_acl_shape_md5 text;
BEGIN
  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_authority'
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
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.employees')
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
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
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = to_regclass('public.employees')
         AND constraint_record.contype = 'u'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'UNIQUE (auth_user_id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles role_record
       WHERE role_record.rolname = 'service_role'
         AND role_record.rolbypassrls
     )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
     ) IS DISTINCT FROM ARRAY['allow_authenticated_employees']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_authenticated_employees'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
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
     ) IS DISTINCT FROM ARRAY['SELECT']::text[]
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
     ) IS DISTINCT FROM ARRAY[
       'DELETE',
       'INSERT',
       'MAINTAIN',
       'REFERENCES',
       'SELECT',
       'TRIGGER',
       'TRUNCATE',
       'UPDATE'
     ]::text[]
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'anon',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR NOT has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
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
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND cardinality(attribute.attacl) > 0
     ) THEN
    RAISE EXCEPTION
      'S1g rollback postcondition employee identity authority changed';
  END IF;

  IF to_regclass('public.notification_reads') IS NOT NULL THEN
    RAISE EXCEPTION
      'S1g rollback postcondition notification_reads still exists';
  END IF;

  IF (
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
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND md5(COALESCE(
               pg_get_expr(policy.polqual, policy.polrelid),
               ''
             )) = 'b326b5062b2f0e69046810717534cb09'
         AND policy.polwithcheck IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notifications')
         AND policy.polname = 'notifications_delete_testrows'
         AND policy.polcmd = 'd'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND md5(COALESCE(
               pg_get_expr(policy.polqual, policy.polrelid),
               ''
             )) = 'b60edd5d780221512206b2510a93c3db'
         AND policy.polwithcheck IS NULL
     ) THEN
    RAISE EXCEPTION
      'S1g rollback postcondition notifications policy restore failed';
  END IF;

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

  IF v_table_acl_shape_md5 IS DISTINCT FROM
       '30224ec8c0a49e4f2e7a8e23544660ed'
     OR has_table_privilege('anon', 'public.notifications', 'SELECT')
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
     ) THEN
    RAISE EXCEPTION
      'S1g rollback postcondition secure notifications ACL/Realtime restore failed';
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
        'S1g rollback postcondition % body/metadata restore failed',
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
       OR v_grantable_count IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'S1g rollback postcondition % ACL restore failed: grantees=%, grantable=%',
        v_expected.identity,
        v_execute_grantees,
        v_grantable_count;
    END IF;
  END LOOP;
END;
$s1g_rollback_postcondition$;

COMMIT;
