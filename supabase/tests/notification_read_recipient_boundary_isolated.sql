-- ═══════════════════════════════════════════════════════════════════════════════
-- S1g notification read/recipient boundary — ISOLATED DATABASE ONLY
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- NEVER run this behavior script against the shared UPR Supabase project.
-- It inserts synthetic employees/notifications inside one transaction and ends
-- with ROLLBACK. Run only in an isolated local/branch database after applying
-- 20260726260000_notification_read_recipient_boundary.sql.
--
-- A rolled-back transaction does not publish Postgres Changes. The companion
-- value-free post-apply script proves publication membership and policy shape;
-- an apply window still needs two real synthetic authenticated sessions for the
-- end-to-end Realtime own/broadcast/foreign delivery gate.
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
     ) IS DISTINCT FROM ARRAY['employees_self_identity_read']::name[]
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
               '(auth_user_id = auth.uid())'
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
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'SELECT'
        )
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
       ARRAY['auth_user_id', 'id', 'is_active', 'role']::text[]
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
             'is_active'
           )
           OR acl.is_grantable
         )
     ) THEN
    RAISE EXCEPTION
      'apply the mobile employee identity containment boundary first';
  END IF;

  IF to_regclass('public.notification_reads') IS NULL THEN
    RAISE EXCEPTION 'apply S1g to the disposable clone first';
  END IF;
END
$guard$;

DO $fixture_ids$
BEGIN
  PERFORM set_config('upr.s1g.employee_a', gen_random_uuid()::text, true);
  PERFORM set_config('upr.s1g.employee_b', gen_random_uuid()::text, true);
  PERFORM set_config(
    'upr.s1g.employee_inactive',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.employee_external',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config('upr.s1g.auth_a', gen_random_uuid()::text, true);
  PERFORM set_config('upr.s1g.auth_b', gen_random_uuid()::text, true);
  PERFORM set_config(
    'upr.s1g.auth_inactive',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.auth_external',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.auth_unmapped',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.broadcast_unread',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.broadcast_legacy_read',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config('upr.s1g.target_a', gen_random_uuid()::text, true);
  PERFORM set_config('upr.s1g.target_b', gen_random_uuid()::text, true);
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
    current_setting('upr.s1g.auth_a')::uuid,
    'authenticated',
    'authenticated',
    's1g-active-a@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1g.auth_b')::uuid,
    'authenticated',
    'authenticated',
    's1g-active-b@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1g.auth_inactive')::uuid,
    'authenticated',
    'authenticated',
    's1g-inactive@example.invalid',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    current_setting('upr.s1g.auth_external')::uuid,
    'authenticated',
    'authenticated',
    's1g-external@example.invalid',
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
  auth_user_id,
  is_active,
  is_external
)
VALUES
  (
    current_setting('upr.s1g.employee_a')::uuid,
    '[S1g isolated] active A',
    current_setting('upr.s1g.auth_a')::uuid,
    true,
    false
  ),
  (
    current_setting('upr.s1g.employee_b')::uuid,
    '[S1g isolated] active B',
    current_setting('upr.s1g.auth_b')::uuid,
    true,
    false
  ),
  (
    current_setting('upr.s1g.employee_inactive')::uuid,
    '[S1g isolated] inactive',
    current_setting('upr.s1g.auth_inactive')::uuid,
    false,
    false
  ),
  (
    current_setting('upr.s1g.employee_external')::uuid,
    '[S1g isolated] external',
    current_setting('upr.s1g.auth_external')::uuid,
    true,
    true
  );

INSERT INTO public.notifications (
  id,
  type,
  title,
  read_at,
  recipient_id
)
VALUES
  (
    current_setting('upr.s1g.broadcast_unread')::uuid,
    '__s1g_isolated__',
    'Unread broadcast',
    NULL,
    NULL
  ),
  (
    current_setting('upr.s1g.broadcast_legacy_read')::uuid,
    '__s1g_isolated__',
    'Legacy globally-read broadcast',
    now() - interval '1 minute',
    NULL
  ),
  (
    current_setting('upr.s1g.target_a')::uuid,
    '__s1g_isolated__',
    'Target A',
    NULL,
    current_setting('upr.s1g.employee_a')::uuid
  ),
  (
    current_setting('upr.s1g.target_b')::uuid,
    '__s1g_isolated__',
    'Target B',
    NULL,
    current_setting('upr.s1g.employee_b')::uuid
  );

SET LOCAL ROLE authenticated;
DO $actor_a_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1g.auth_a'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$actor_a_claims$;

DO $actor_a_visibility$
DECLARE
  v_rows public.notifications[];
  v_before integer;
  v_after integer;
  v_default_before integer;
  v_default_after integer;
  v_explicit_null integer;
  v_denied boolean;
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.broadcast_unread')::uuid
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.target_a')::uuid
     )
     OR EXISTS (
       SELECT 1
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.target_b')::uuid
     ) THEN
    RAISE EXCEPTION 'S1g isolated actor A direct-table RLS failed';
  END IF;

  SELECT array_agg(notification)
    INTO v_rows
  FROM public.get_notifications(
    100,
    current_setting('upr.s1g.employee_a')::uuid
  ) notification
  WHERE notification.id IN (
    current_setting('upr.s1g.broadcast_unread')::uuid,
    current_setting('upr.s1g.broadcast_legacy_read')::uuid,
    current_setting('upr.s1g.target_a')::uuid,
    current_setting('upr.s1g.target_b')::uuid
  );

  IF cardinality(v_rows) IS DISTINCT FROM 3
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(v_rows) notification
       WHERE notification.id = current_setting('upr.s1g.broadcast_unread')::uuid
         AND notification.read_at IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(v_rows) notification
       WHERE notification.id =
               current_setting('upr.s1g.broadcast_legacy_read')::uuid
         AND notification.read_at IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(v_rows) notification
       WHERE notification.id = current_setting('upr.s1g.target_a')::uuid
     )
     OR EXISTS (
       SELECT 1
       FROM unnest(v_rows) notification
       WHERE notification.id = current_setting('upr.s1g.target_b')::uuid
     ) THEN
    RAISE EXCEPTION 'S1g isolated actor A RPC visibility/read projection failed';
  END IF;

  -- Historical default and explicit-NULL shapes remain broadcast-only and
  -- positively include both synthetic broadcasts.
  IF NOT EXISTS (
       SELECT 1
       FROM public.get_notifications() notification
       WHERE notification.id =
               current_setting('upr.s1g.broadcast_unread')::uuid
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_notifications() notification
       WHERE notification.id =
               current_setting('upr.s1g.broadcast_legacy_read')::uuid
     )
     OR EXISTS (
       SELECT 1
       FROM public.get_notifications() notification
       WHERE notification.id IN (
         current_setting('upr.s1g.target_a')::uuid,
         current_setting('upr.s1g.target_b')::uuid
       )
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_notifications(NULL, NULL) notification
       WHERE notification.id =
               current_setting('upr.s1g.broadcast_unread')::uuid
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_notifications(NULL, NULL) notification
       WHERE notification.id =
               current_setting('upr.s1g.broadcast_legacy_read')::uuid
     )
     OR EXISTS (
       SELECT 1
       FROM public.get_notifications(NULL, NULL) notification
       WHERE notification.id IN (
         current_setting('upr.s1g.target_a')::uuid,
         current_setting('upr.s1g.target_b')::uuid
       )
     ) THEN
    RAISE EXCEPTION
      'S1g isolated default/explicit-null list scope failed';
  END IF;

  v_default_before := public.get_unread_notification_count();
  v_explicit_null := public.get_unread_notification_count(NULL);
  IF v_default_before IS DISTINCT FROM v_explicit_null THEN
    RAISE EXCEPTION
      'S1g isolated default/explicit-null count mismatch: default=%, explicit=%',
      v_default_before,
      v_explicit_null;
  END IF;

  v_denied := false;
  BEGIN
    PERFORM *
    FROM public.get_notifications(
      30,
      current_setting('upr.s1g.employee_b')::uuid
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'S1g isolated foreign list parameter was accepted';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.get_unread_notification_count(
      current_setting('upr.s1g.employee_b')::uuid
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'S1g isolated foreign count parameter was accepted';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.mark_all_notifications_read(
      current_setting('upr.s1g.employee_b')::uuid
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'S1g isolated foreign mark-all parameter was accepted';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.mark_notification_read(
      current_setting('upr.s1g.target_b')::uuid
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'S1g isolated foreign notification mark was accepted';
  END IF;

  -- Missing/null IDs retain the deployed void no-op contract.
  PERFORM public.mark_notification_read(NULL);
  PERFORM public.mark_notification_read(gen_random_uuid());

  v_before := public.get_unread_notification_count(
    current_setting('upr.s1g.employee_a')::uuid
  );
  PERFORM public.mark_notification_read(
    current_setting('upr.s1g.broadcast_unread')::uuid
  );
  PERFORM public.mark_notification_read(
    current_setting('upr.s1g.broadcast_unread')::uuid
  );
  v_after := public.get_unread_notification_count(
    current_setting('upr.s1g.employee_a')::uuid
  );
  v_default_after := public.get_unread_notification_count();
  v_explicit_null := public.get_unread_notification_count(NULL);

  IF v_before - v_after IS DISTINCT FROM 1
     OR v_default_before - v_default_after IS DISTINCT FROM 1
     OR v_default_after IS DISTINCT FROM v_explicit_null THEN
    RAISE EXCEPTION
      'S1g isolated actor A count delta failed: selected=%→%, default=%→%, explicit=%',
      v_before,
      v_after,
      v_default_before,
      v_default_after,
      v_explicit_null;
  END IF;

  IF (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.broadcast_unread')::uuid
     ) IS NOT NULL
     OR (
       SELECT notification.read_at
       FROM public.get_notifications(
         100,
         current_setting('upr.s1g.employee_a')::uuid
       ) notification
       WHERE notification.id =
               current_setting('upr.s1g.broadcast_unread')::uuid
     ) IS NULL THEN
    RAISE EXCEPTION
      'S1g isolated actor A broadcast receipt/base-row behavior failed';
  END IF;

  -- The historical default/null mark-all call is still accepted, but for an
  -- authenticated actor it must not mark that actor's targeted row.
  PERFORM public.mark_all_notifications_read();
  IF (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.target_a')::uuid
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'S1g isolated authenticated default mark-all changed a target';
  END IF;

  -- Positive own-target mark-one updates the base row, not a receipt.
  PERFORM public.mark_notification_read(
    current_setting('upr.s1g.target_a')::uuid
  );
  IF (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.target_a')::uuid
     ) IS NULL THEN
    RAISE EXCEPTION
      'S1g isolated authenticated own-target mark-one failed';
  END IF;

  v_denied := false;
  BEGIN
    UPDATE public.notifications
       SET title = title
     WHERE id = current_setting('upr.s1g.target_a')::uuid;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'S1g isolated authenticated direct UPDATE was accepted';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM 1
    FROM public.notification_reads
    LIMIT 1;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION
      'S1g isolated authenticated direct receipt read was accepted';
  END IF;
END;
$actor_a_visibility$;

DO $actor_b_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1g.auth_b'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$actor_b_claims$;

DO $actor_b_independence$
BEGIN
  IF (
       SELECT notification.read_at
       FROM public.get_notifications(
         100,
         current_setting('upr.s1g.employee_b')::uuid
       ) notification
       WHERE notification.id =
               current_setting('upr.s1g.broadcast_unread')::uuid
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'S1g isolated actor A receipt leaked into actor B read state';
  END IF;

  PERFORM public.mark_all_notifications_read(
    current_setting('upr.s1g.employee_b')::uuid
  );

  IF (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.target_b')::uuid
     ) IS NULL
     OR (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.broadcast_unread')::uuid
     ) IS NOT NULL
     OR (
       SELECT notification.read_at
       FROM public.get_notifications(
         100,
         current_setting('upr.s1g.employee_b')::uuid
       ) notification
       WHERE notification.id =
               current_setting('upr.s1g.broadcast_unread')::uuid
     ) IS NULL THEN
    RAISE EXCEPTION
      'S1g isolated actor B mark-all isolation failed';
  END IF;
END;
$actor_b_independence$;

DO $inactive_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1g.auth_inactive'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$inactive_claims$;

DO $inactive_denial$
DECLARE
  v_denied boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM public.notifications LIMIT 1) THEN
    RAISE EXCEPTION 'S1g isolated inactive direct-table read was visible';
  END IF;

  BEGIN
    PERFORM public.get_unread_notification_count();
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'S1g isolated inactive RPC caller was accepted';
  END IF;
END;
$inactive_denial$;

DO $external_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1g.auth_external'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$external_claims$;

DO $external_denial$
DECLARE
  v_denied boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM public.notifications LIMIT 1) THEN
    RAISE EXCEPTION 'S1g isolated external direct-table read was visible';
  END IF;

  BEGIN
    PERFORM public.get_notifications();
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'S1g isolated external RPC caller was accepted';
  END IF;
END;
$external_denial$;

DO $unmapped_claims$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('upr.s1g.auth_unmapped'),
      'role',
      'authenticated'
    )::text,
    true
  );
END;
$unmapped_claims$;

DO $unmapped_denial$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.mark_all_notifications_read();
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'S1g isolated unmapped RPC caller was accepted';
  END IF;
END;
$unmapped_denial$;

RESET ROLE;

DO $physical_isolation$
BEGIN
  IF (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.target_a')::uuid
     ) IS NULL
     OR (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.target_b')::uuid
     ) IS NULL
     OR (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.broadcast_unread')::uuid
     ) IS NOT NULL
     OR (
       SELECT count(*)
       FROM public.notification_reads
       WHERE notification_id =
               current_setting('upr.s1g.broadcast_unread')::uuid
         AND employee_id IN (
           current_setting('upr.s1g.employee_a')::uuid,
           current_setting('upr.s1g.employee_b')::uuid
         )
     ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'S1g isolated physical targeted/broadcast isolation failed';
  END IF;
END;
$physical_isolation$;

DO $service_fixture_ids$
BEGIN
  PERFORM set_config(
    'upr.s1g.service_broadcast_one',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.service_broadcast_all',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.service_target_a',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.service_target_b',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.s1g.service_default_broadcast',
    gen_random_uuid()::text,
    true
  );
END;
$service_fixture_ids$;

INSERT INTO public.notifications (
  id,
  type,
  title,
  read_at,
  recipient_id
)
VALUES
  (
    current_setting('upr.s1g.service_broadcast_one')::uuid,
    '__s1g_isolated__',
    'Service mark-one broadcast',
    NULL,
    NULL
  ),
  (
    current_setting('upr.s1g.service_broadcast_all')::uuid,
    '__s1g_isolated__',
    'Service mark-all broadcast',
    NULL,
    NULL
  ),
  (
    current_setting('upr.s1g.service_target_a')::uuid,
    '__s1g_isolated__',
    'Service target A',
    NULL,
    current_setting('upr.s1g.employee_a')::uuid
  ),
  (
    current_setting('upr.s1g.service_target_b')::uuid,
    '__s1g_isolated__',
    'Service target B',
    NULL,
    current_setting('upr.s1g.employee_b')::uuid
  );

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

DO $service_compatibility$
DECLARE
  v_before integer;
  v_after integer;
  v_default_before integer;
  v_default_after integer;
BEGIN
  IF (
       SELECT count(*)
       FROM public.get_notifications(
         100,
         current_setting('upr.s1g.employee_a')::uuid
       ) notification
       WHERE notification.id IN (
         current_setting('upr.s1g.service_broadcast_one')::uuid,
         current_setting('upr.s1g.service_broadcast_all')::uuid,
         current_setting('upr.s1g.service_target_a')::uuid,
         current_setting('upr.s1g.service_target_b')::uuid
       )
     ) IS DISTINCT FROM 3
     OR EXISTS (
       SELECT 1
       FROM public.get_notifications(
         100,
         current_setting('upr.s1g.employee_a')::uuid
       ) notification
       WHERE notification.id =
               current_setting('upr.s1g.service_target_b')::uuid
     )
     OR EXISTS (
       SELECT 1
       FROM public.get_notifications() notification
       WHERE notification.id IN (
         current_setting('upr.s1g.service_target_a')::uuid,
         current_setting('upr.s1g.service_target_b')::uuid
       )
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_notifications() notification
       WHERE notification.id =
               current_setting('upr.s1g.service_broadcast_one')::uuid
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_notifications() notification
       WHERE notification.id =
               current_setting('upr.s1g.service_broadcast_all')::uuid
     ) THEN
    RAISE EXCEPTION 'S1g isolated service list compatibility failed';
  END IF;

  v_before := public.get_unread_notification_count(
    current_setting('upr.s1g.employee_a')::uuid
  );
  v_default_before := public.get_unread_notification_count();
  PERFORM public.mark_notification_read(
    current_setting('upr.s1g.service_broadcast_one')::uuid
  );
  v_after := public.get_unread_notification_count(
    current_setting('upr.s1g.employee_a')::uuid
  );
  v_default_after := public.get_unread_notification_count();

  IF v_before - v_after IS DISTINCT FROM 1
     OR v_default_before - v_default_after IS DISTINCT FROM 1
     OR (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.service_broadcast_one')::uuid
     ) IS NULL THEN
    RAISE EXCEPTION
      'S1g isolated service count/mark-one compatibility failed: selected=%→%, default=%→%',
      v_before,
      v_after,
      v_default_before,
      v_default_after;
  END IF;

  PERFORM public.mark_all_notifications_read(
    current_setting('upr.s1g.employee_a')::uuid
  );
  IF (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.service_broadcast_all')::uuid
     ) IS NULL
     OR (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.service_target_a')::uuid
     ) IS NULL
     OR (
       SELECT read_at
       FROM public.notifications
       WHERE id = current_setting('upr.s1g.service_target_b')::uuid
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'S1g isolated service non-null mark-all compatibility failed';
  END IF;

  INSERT INTO public.notifications (
    id,
    type,
    title,
    read_at,
    recipient_id
  )
  VALUES (
    current_setting('upr.s1g.service_default_broadcast')::uuid,
    '__s1g_isolated__',
    'Service default mark-all broadcast',
    NULL,
    NULL
  );

  PERFORM public.mark_all_notifications_read();
  IF (
       SELECT read_at
       FROM public.notifications
       WHERE id =
               current_setting('upr.s1g.service_default_broadcast')::uuid
     ) IS NULL THEN
    RAISE EXCEPTION
      'S1g isolated service default mark-all compatibility failed';
  END IF;
END;
$service_compatibility$;

-- This is the only permitted terminal statement. No synthetic row can commit.
ROLLBACK;
