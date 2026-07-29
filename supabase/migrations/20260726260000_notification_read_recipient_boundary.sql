-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260726260000_notification_read_recipient_boundary
-- Phase: Mobile Production Readiness S1g
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   1. Binds notification list, unread-count, mark-one, and mark-all behavior to
--      the active, non-external employee reconstructed from auth.uid().
--   2. Stops one employee from reading or mutating another employee's targeted
--      notifications.
--   3. Gives each employee independent read state for broadcast notifications.
--   4. Narrows direct notification-table reads (including Realtime payloads) to
--      broadcasts plus the authenticated employee's own targeted rows.
--
-- DEPLOYED CONTRACT PRESERVED:
--   get_notifications(integer DEFAULT 30, uuid DEFAULT NULL) -> SETOF notifications
--   get_unread_notification_count(uuid DEFAULT NULL)         -> integer
--   mark_notification_read(uuid)                             -> void
--   mark_all_notifications_read(uuid DEFAULT NULL)           -> void
--
--   Existing {} and {p_limit} list/count calls remain broadcast-only. For an
--   authenticated employee those broadcasts now project that employee's receipt
--   as notifications.read_at. Existing broadcasts whose shared read_at is already
--   non-null remain read for everyone and are never resurfaced.
--
-- LIVE INPUT CAPTURE (catalog-only, no notification rows read; 2026-07-26 UTC):
--   notifications owner/RLS: postgres; RLS on; not forced
--   columns shape md5:       0170db1f6199da7f23355b35ba343954
--   table ACL shape md5:     f7cafbf463643b5debc08b30a5cba10e
--   policies:                notifications_select USING (true), authenticated;
--                            notifications_delete_testrows sentinel DELETE
--   Realtime:                public.notifications in supabase_realtime
--   direct database callers: none for the four read/mark RPCs
--
-- APPLY:
--   RED shared-database authorization change. Apply only in its own reviewed,
--   owner-approved window after compatible source is reachable from the release
--   branch. Apply 20260726182000_mobile_employee_identity_containment first;
--   this migration pins its self-only policy and exact browser column ACL.
--   Do not batch with S1d, S1e, S1f, private media, or other pending SQL.
--
-- ROLLBACK:
--   supabase/rollbacks/20260726260000_notification_read_recipient_boundary.rollback.sql
--   is deliberately unsafe: it restores cross-recipient access/shared broadcast
--   read state and drops receipt data only after an explicit owner-set guard.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ATOMICITY:
--   The Supabase migration executor owns the transaction that includes both this
--   SQL and its schema_migrations ledger row. Do not add transaction-control
--   statements here.

DO $s1g_preflight$
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
               a.attnum,
               a.attname,
               format_type(a.atttypid, a.atttypmod),
               a.attnotnull
             ),
             E'\n'
             ORDER BY a.attnum
           )
         )
    INTO v_column_shape_md5
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.notifications')
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_column_shape_md5 IS DISTINCT FROM
       '0170db1f6199da7f23355b35ba343954'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class c
       JOIN pg_roles owner_role ON owner_role.oid = c.relowner
       WHERE c.oid = to_regclass('public.notifications')
         AND owner_role.rolname = 'postgres'
         AND c.relrowsecurity
         AND NOT c.relforcerowsecurity
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
      'S1g preflight notifications table metadata drift: columns md5=%',
      v_column_shape_md5;
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
  FROM pg_class c
  CROSS JOIN LATERAL
    aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
  WHERE c.oid = to_regclass('public.notifications');

  IF v_table_acl_shape_md5 IS DISTINCT FROM
       'f7cafbf463643b5debc08b30a5cba10e' THEN
    RAISE EXCEPTION
      'S1g preflight notifications table ACL drift: md5=%',
      v_table_acl_shape_md5;
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
    RAISE EXCEPTION 'S1g preflight notifications policy drift';
  END IF;

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
    RAISE EXCEPTION 'S1g preflight auth/employee dependency drift';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'get_notifications',
          'public.get_notifications(integer,uuid)',
          'SETOF notifications',
          'a66659f2c54bc0b7bdc2b60949fdb883',
          '7e932efdb51db6b3fc48567e533b4461'
        ),
        (
          'get_unread_notification_count',
          'public.get_unread_notification_count(uuid)',
          'integer',
          'b15c8a180f65586d6bd3c4f75d1c6f9e',
          '9caee22bd136f6a0a48641ab7b5b1777'
        ),
        (
          'mark_all_notifications_read',
          'public.mark_all_notifications_read(uuid)',
          'void',
          '4ba9b450a720c65bb2149d45f6ea53f1',
          'a5782492c10f797fb36253cc5ae502a2'
        ),
        (
          'mark_notification_read',
          'public.mark_notification_read(uuid)',
          'void',
          '389254cd40d74bdec30f23c7ebeb498e',
          '68897ae73b531556d11805a906210afc'
        )
    ) AS expected(
      function_name,
      identity,
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

    IF v_oid IS NULL OR v_overload_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'S1g preflight expected one exact % overload; found %',
        v_expected.function_name,
        v_overload_count;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      JOIN pg_language language ON language.oid = procedure.prolang
      JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = v_oid
        AND language.lanname = 'sql'
        AND owner_role.rolname = 'postgres'
        AND pg_get_function_result(procedure.oid) = v_expected.result_type
        AND procedure.prosecdef
        AND NOT procedure.proisstrict
        AND NOT procedure.proleakproof
        AND procedure.provolatile = 'v'
        AND procedure.proparallel = 'u'
        AND procedure.prokind = 'f'
        AND procedure.proconfig = ARRAY['search_path=public']::text[]
        AND md5(procedure.prosrc) = v_expected.body_md5
        AND md5(pg_get_functiondef(procedure.oid)) = v_expected.definition_md5
    ) THEN
      RAISE EXCEPTION
        'S1g preflight % metadata/body drift',
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
        'S1g preflight % ACL drift: grantees=%, grantable=%',
        v_expected.identity,
        v_execute_grantees,
        v_grantable_count;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname NOT IN (
        'get_notifications',
        'get_unread_notification_count',
        'mark_all_notifications_read',
        'mark_notification_read'
      )
      AND (
        procedure.prosrc ~ E'\\mget_notifications\\M'
        OR procedure.prosrc ~ E'\\mget_unread_notification_count\\M'
        OR procedure.prosrc ~ E'\\mmark_all_notifications_read\\M'
        OR procedure.prosrc ~ E'\\mmark_notification_read\\M'
      )
  ) THEN
    RAISE EXCEPTION
      'S1g preflight found an unreviewed direct database caller';
  END IF;
END;
$s1g_preflight$;

-- Private read receipts exist only for broadcast rows. Browser roles never
-- receive direct table privileges; all access is through the four guarded RPCs.
CREATE TABLE public.notification_reads (
  notification_id uuid NOT NULL
    REFERENCES public.notifications(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_reads_pkey
    PRIMARY KEY (notification_id, employee_id)
);

CREATE INDEX notification_reads_employee_id_idx
  ON public.notification_reads (employee_id);

COMMENT ON TABLE public.notification_reads IS
  'Private per-employee read receipts for broadcast notifications. Targeted notifications retain notifications.read_at.';

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.notification_reads
  FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY notification_reads_no_direct_access
  ON public.notification_reads
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Keep the existing policy object (Realtime depends on it), but replace its
-- authentication-only predicate with active internal own-or-broadcast scope.
ALTER POLICY notifications_select
  ON public.notifications
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = (SELECT auth.uid())
        AND employee.is_active = true
        AND employee.is_external = false
        AND (
          notifications.recipient_id IS NULL
          OR notifications.recipient_id = employee.id
        )
    )
  );

-- Keep the live policy object additive-only, but make the obsolete test-row
-- cleanup capability fail closed. Isolated behavior tests roll back instead.
ALTER POLICY notifications_delete_testrows
  ON public.notifications
  TO authenticated
  USING (false);

REVOKE ALL PRIVILEGES ON TABLE public.notifications
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.notifications TO service_role;

CREATE OR REPLACE FUNCTION public.get_notifications(
  p_limit integer DEFAULT 30,
  p_employee_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_is_service_role boolean :=
    COALESCE((SELECT auth.jwt() ->> 'role' = 'service_role'), false);
BEGIN
  IF v_is_service_role THEN
    RETURN QUERY
    SELECT notification.*
    FROM public.notifications notification
    WHERE notification.recipient_id IS NULL
       OR notification.recipient_id = p_employee_id
    ORDER BY notification.created_at DESC
    LIMIT greatest(1, least(p_limit, 100));
    RETURN;
  END IF;

  SELECT employee.id
    INTO v_actor
  FROM public.employees employee
  WHERE employee.auth_user_id = (SELECT auth.uid())
    AND employee.is_active = true
    AND employee.is_external = false;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  IF p_employee_id IS NOT NULL AND p_employee_id <> v_actor THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: notification recipient mismatch'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    notification.id,
    notification.type,
    notification.title,
    notification.body,
    notification.link,
    notification.entity_type,
    notification.entity_id,
    notification.job_id,
    notification.payload,
    CASE
      WHEN notification.recipient_id IS NULL
        THEN COALESCE(notification.read_at, receipt.read_at)
      ELSE notification.read_at
    END AS read_at,
    notification.created_at,
    notification.recipient_id,
    notification.type_key
  FROM public.notifications notification
  LEFT JOIN public.notification_reads receipt
    ON receipt.notification_id = notification.id
   AND receipt.employee_id = v_actor
   AND notification.recipient_id IS NULL
  WHERE notification.recipient_id IS NULL
     OR notification.recipient_id = p_employee_id
  ORDER BY notification.created_at DESC
  LIMIT greatest(1, least(p_limit, 100));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(
  p_employee_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_is_service_role boolean :=
    COALESCE((SELECT auth.jwt() ->> 'role' = 'service_role'), false);
BEGIN
  IF v_is_service_role THEN
    RETURN (
      SELECT count(*)::integer
      FROM public.notifications notification
      WHERE notification.read_at IS NULL
        AND (
          notification.recipient_id IS NULL
          OR notification.recipient_id = p_employee_id
        )
    );
  END IF;

  SELECT employee.id
    INTO v_actor
  FROM public.employees employee
  WHERE employee.auth_user_id = (SELECT auth.uid())
    AND employee.is_active = true
    AND employee.is_external = false;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  IF p_employee_id IS NOT NULL AND p_employee_id <> v_actor THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: notification recipient mismatch'
      USING errcode = '42501';
  END IF;

  RETURN (
    SELECT count(*)::integer
    FROM public.notifications notification
    LEFT JOIN public.notification_reads receipt
      ON receipt.notification_id = notification.id
     AND receipt.employee_id = v_actor
     AND notification.recipient_id IS NULL
    WHERE (
            notification.recipient_id IS NULL
            OR notification.recipient_id = p_employee_id
          )
      AND CASE
            WHEN notification.recipient_id IS NULL
              THEN COALESCE(notification.read_at, receipt.read_at)
            ELSE notification.read_at
          END IS NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_recipient uuid;
  v_existing_read_at timestamptz;
  v_is_service_role boolean :=
    COALESCE((SELECT auth.jwt() ->> 'role' = 'service_role'), false);
BEGIN
  -- Trusted server callers retain the old exact behavior. Browser callers never
  -- reach this branch because a signed service-role JWT cannot be minted by them.
  IF v_is_service_role THEN
    UPDATE public.notifications
       SET read_at = now()
     WHERE id = p_id
       AND read_at IS NULL;
    RETURN;
  END IF;

  SELECT employee.id
    INTO v_actor
  FROM public.employees employee
    WHERE employee.auth_user_id = (SELECT auth.uid())
      AND employee.is_active = true
      AND employee.is_external = false;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  SELECT notification.recipient_id, notification.read_at
    INTO v_recipient, v_existing_read_at
  FROM public.notifications notification
  WHERE notification.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_recipient IS NULL THEN
    IF v_existing_read_at IS NULL THEN
      INSERT INTO public.notification_reads (
        notification_id,
        employee_id,
        read_at
      )
      VALUES (p_id, v_actor, now())
      ON CONFLICT (notification_id, employee_id) DO NOTHING;
    END IF;
  ELSIF v_recipient = v_actor THEN
    UPDATE public.notifications
       SET read_at = now()
     WHERE id = p_id
       AND read_at IS NULL;
  ELSE
    RAISE EXCEPTION
      'NOT_AUTHORIZED: notification recipient mismatch'
      USING errcode = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_employee_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_is_service_role boolean :=
    COALESCE((SELECT auth.jwt() ->> 'role' = 'service_role'), false);
BEGIN
  IF v_is_service_role THEN
    UPDATE public.notifications
       SET read_at = now()
     WHERE read_at IS NULL
       AND (
         recipient_id IS NULL
         OR recipient_id = p_employee_id
       );
    RETURN;
  END IF;

  SELECT employee.id
    INTO v_actor
  FROM public.employees employee
  WHERE employee.auth_user_id = (SELECT auth.uid())
    AND employee.is_active = true
    AND employee.is_external = false;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  IF p_employee_id IS NOT NULL AND p_employee_id <> v_actor THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: notification recipient mismatch'
      USING errcode = '42501';
  END IF;

  INSERT INTO public.notification_reads (
    notification_id,
    employee_id,
    read_at
  )
  SELECT notification.id, v_actor, now()
  FROM public.notifications notification
  WHERE notification.recipient_id IS NULL
    AND notification.read_at IS NULL
  ON CONFLICT (notification_id, employee_id) DO NOTHING;

  IF p_employee_id IS NOT NULL THEN
    UPDATE public.notifications
       SET read_at = now()
     WHERE recipient_id = p_employee_id
       AND read_at IS NULL;
  END IF;
END;
$function$;

-- CREATE OR REPLACE can retain or reintroduce surprising ACL state across
-- environments. Freeze the browser contract explicitly after every replacement.
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

DO $s1g_postcondition$
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
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege('authenticated', 'public.employees', 'SELECT')
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
      'S1g postcondition employee identity containment changed';
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
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notification_reads')
     ) IS DISTINCT FROM ARRAY['notification_reads_no_direct_access']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.notification_reads')
         AND policy.polname = 'notification_reads_no_direct_access'
         AND policy.polcmd = '*'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'false'
         AND pg_get_expr(policy.polwithcheck, policy.polrelid, true) = 'false'
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
    RAISE EXCEPTION 'S1g postcondition notification_reads metadata failed';
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
      'S1g postcondition notification_reads ACL failed: md5=%',
      v_receipt_acl_shape_md5;
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
         AND policy.polwithcheck IS NULL
         AND md5(COALESCE(
               pg_get_expr(policy.polqual, policy.polrelid),
               ''
             )) = 'f6a4b946f6d65eadf3bf4764e734d5b1'
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
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'false'
         AND policy.polwithcheck IS NULL
     ) THEN
    RAISE EXCEPTION 'S1g postcondition notifications policy metadata failed';
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
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.notifications')
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
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
      'S1g postcondition notifications policy/ACL/Realtime failed: policy=%, ACL=%',
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
        'S1g postcondition % definition/metadata failed',
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
        'S1g postcondition % ACL failed: grantees=%, grantable=%',
        v_expected.identity,
        v_execute_grantees,
        v_grantable_count;
    END IF;
  END LOOP;
END;
$s1g_postcondition$;
