-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260726260000_notification_read_recipient_boundary
-- Phase: Mobile Production Readiness S1g
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes S1g's per-employee broadcast receipt table and restores the legacy
--   service-role notification behavior, while failing the browser/native bell
--   closed. It deliberately preserves the employee identity-containment
--   prerequisite and the recipient-scoped notification policies.
--
-- USER IMPACT:
--   Authenticated PWA/native bell RPCs and direct Realtime table reads stop
--   working until a forward repair is applied. Trusted service-role callers keep
--   the deployed list/count/mark behavior.
--
-- DATA LOSS:
--   Every per-employee broadcast receipt created after S1g is destroyed. The
--   owner must explicitly accept that loss in the dedicated rollback session:
--
--     SET upr.allow_s1g_receipt_loss_rollback = 'on';
--
--   This rollback never restores cross-recipient browser reads/mutations,
--   authenticated USING (true), sentinel deletion, or broad Realtime payloads.
--   Prefer a forward repair.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $s1g_rollback_preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_execute_grantees text[];
  v_receipt_acl_shape_md5 text;
BEGIN
  IF current_setting('upr.allow_s1g_receipt_loss_rollback', true)
       IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'S1g rollback refused; owner must SET upr.allow_s1g_receipt_loss_rollback = on';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_containment'
     ) IS DISTINCT FROM 1
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
               'auth_user_id = auth.uid()'
         AND policy.polwithcheck IS NULL
     )
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR (
       SELECT array_agg(attribute.attname::text ORDER BY attribute.attname)
       FROM pg_attribute attribute
       CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND grantee_role.rolname = 'authenticated'
         AND acl.privilege_type = 'SELECT'
     ) IS DISTINCT FROM
       ARRAY[
         'auth_user_id',
         'id',
         'is_active',
         'is_external',
         'role'
       ]::text[] THEN
    RAISE EXCEPTION
      'S1g rollback requires the exact employee identity-containment contract';
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
       SELECT md5(string_agg(
         format(
           '%s|%s|%s|%s',
           attribute.attnum,
           attribute.attname,
           format_type(attribute.atttypid, attribute.atttypmod),
           attribute.attnotnull
         ),
         E'\n'
         ORDER BY attribute.attnum
       ))
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.notification_reads')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
     ) IS DISTINCT FROM 'b288c11dbb35d86f1f6c07924b27afd4'
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       LEFT JOIN pg_attrdef default_record
         ON default_record.adrelid = attribute.attrelid
        AND default_record.adnum = attribute.attnum
       WHERE attribute.attrelid = to_regclass('public.notification_reads')
         AND attribute.attname IN ('notification_id', 'employee_id')
         AND default_record.oid IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       JOIN pg_attrdef default_record
         ON default_record.adrelid = attribute.attrelid
        AND default_record.adnum = attribute.attnum
       WHERE attribute.attrelid = to_regclass('public.notification_reads')
         AND attribute.attname = 'read_at'
         AND pg_get_expr(default_record.adbin, default_record.adrelid) = 'now()'
     )
     OR (
       SELECT md5(string_agg(
         format(
           '%s|%s',
           constraint_record.conname,
           pg_get_constraintdef(constraint_record.oid, true)
         ),
         E'\n'
         ORDER BY constraint_record.conname
       ))
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid =
             to_regclass('public.notification_reads')
     ) IS DISTINCT FROM '299cbf9155468ef388d57af37dcfd045'
     OR (
       SELECT md5(string_agg(
         format(
           '%s|%s',
           index_relation.relname,
           pg_get_indexdef(index_record.indexrelid)
         ),
         E'\n'
         ORDER BY index_relation.relname
       ))
       FROM pg_index index_record
       JOIN pg_class index_relation
         ON index_relation.oid = index_record.indexrelid
       WHERE index_record.indrelid =
             to_regclass('public.notification_reads')
     ) IS DISTINCT FROM 'f903c472344be23c98ea6a046dffe1dc'
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
     OR has_table_privilege(
          'anon',
          'public.notification_reads',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege(
          'authenticated',
          'public.notification_reads',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege(
          'service_role',
          'public.notification_reads',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR EXISTS (
       SELECT 1
       FROM pg_publication_rel publication_relation
       WHERE publication_relation.prrelid =
             to_regclass('public.notification_reads')
     ) THEN
    RAISE EXCEPTION
      'S1g rollback notification_reads state is absent or drifted';
  END IF;

  SELECT md5(string_agg(
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
         ))
    INTO v_receipt_acl_shape_md5
  FROM pg_class relation
  CROSS JOIN LATERAL
    aclexplode(COALESCE(
      relation.relacl,
      acldefault('r', relation.relowner)
    )) acl
  WHERE relation.oid = to_regclass('public.notification_reads');

  IF v_receipt_acl_shape_md5 IS DISTINCT FROM
       '5ae62afd8335deffffb81c9aa98f62be' THEN
    RAISE EXCEPTION
      'S1g rollback notification_reads ACL drift: %',
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
         AND md5(COALESCE(
               pg_get_expr(policy.polqual, policy.polrelid),
               ''
             )) = 'f6a4b946f6d65eadf3bf4764e734d5b1'
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
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'false'
         AND policy.polwithcheck IS NULL
     )
     OR NOT has_table_privilege(
          'authenticated',
          'public.notifications',
          'SELECT'
        )
     OR has_table_privilege(
          'authenticated',
          'public.notifications',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege('anon', 'public.notifications', 'SELECT')
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
     ) THEN
    RAISE EXCEPTION
      'S1g rollback notification recipient policy/ACL state drifted';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.get_notifications(integer,uuid)',
          'fefa4b58a7cf9faaae6d235c98faa1d6',
          'a9d0da79befb2d2cb2a3e5452d3c6269'
        ),
        (
          'public.get_unread_notification_count(uuid)',
          '2b8706a1ff85ab821c44e084f66bc998',
          '8bd9df112ee1a6a7ff9f5c18789142d8'
        ),
        (
          'public.mark_all_notifications_read(uuid)',
          '17535104ecaa23b9eb98c9192921cf05',
          'd954d04ad3e3fe2ead30ec3e9d8bfbf7'
        ),
        (
          'public.mark_notification_read(uuid)',
          'cbe82dd0652029a881944527e99b9091',
          '868d6fd6e3a5278d152860318753805f'
        )
    ) AS expected(identity, body_md5, definition_md5)
  LOOP
    v_oid := to_regprocedure(v_expected.identity);

    IF v_oid IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      WHERE procedure.oid = v_oid
        AND procedure.prosecdef
        AND procedure.proconfig = ARRAY['search_path=public']::text[]
        AND md5(procedure.prosrc) = v_expected.body_md5
        AND md5(pg_get_functiondef(procedure.oid)) =
              v_expected.definition_md5
    ) THEN
      RAISE EXCEPTION
        'S1g rollback function definition drift: %',
        v_expected.identity;
    END IF;

    SELECT array_agg(
             COALESCE(grantee_role.rolname, 'PUBLIC')
             ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
           )
      INTO v_execute_grantees
    FROM pg_proc procedure
    CROSS JOIN LATERAL
      aclexplode(COALESCE(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) acl
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE procedure.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF v_execute_grantees IS DISTINCT FROM
         ARRAY['authenticated', 'postgres', 'service_role']::text[] THEN
      RAISE EXCEPTION
        'S1g rollback function ACL drift: %',
        v_expected.identity;
    END IF;
  END LOOP;
END;
$s1g_rollback_preflight$;

-- Restore legacy data semantics only for trusted server callers. Authenticated
-- clients are intentionally disabled so rollback cannot reopen the BOLA.
CREATE OR REPLACE FUNCTION public.get_notifications(
  p_limit integer DEFAULT 30,
  p_employee_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(
    (SELECT auth.jwt() ->> 'role' = 'service_role'),
    false
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: service role required'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT notification.*
  FROM public.notifications notification
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
BEGIN
  IF NOT COALESCE(
    (SELECT auth.jwt() ->> 'role' = 'service_role'),
    false
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: service role required'
      USING errcode = '42501';
  END IF;

  RETURN (
    SELECT count(*)::integer
    FROM public.notifications notification
    WHERE notification.read_at IS NULL
      AND (
        notification.recipient_id IS NULL
        OR notification.recipient_id = p_employee_id
      )
  );
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
BEGIN
  IF NOT COALESCE(
    (SELECT auth.jwt() ->> 'role' = 'service_role'),
    false
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: service role required'
      USING errcode = '42501';
  END IF;

  UPDATE public.notifications
     SET read_at = now()
   WHERE read_at IS NULL
     AND (
       recipient_id IS NULL
       OR recipient_id = p_employee_id
     );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(
    (SELECT auth.jwt() ->> 'role' = 'service_role'),
    false
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: service role required'
      USING errcode = '42501';
  END IF;

  UPDATE public.notifications
     SET read_at = now()
   WHERE id = p_id
     AND read_at IS NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_notifications(integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_unread_notification_count(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_notifications(integer, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid)
  TO service_role;

-- Keep both notification policies fail closed. Removing authenticated SELECT
-- also disables Postgres Changes delivery while leaving the publication object
-- stable for a forward repair.
REVOKE ALL PRIVILEGES ON TABLE public.notifications
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.notifications TO service_role;

DROP TABLE public.notification_reads;

DO $s1g_rollback_postcondition$
DECLARE
  v_oid oid;
  v_execute_grantees text[];
  v_identity text;
BEGIN
  IF to_regclass('public.notification_reads') IS NOT NULL THEN
    RAISE EXCEPTION
      'S1g rollback postcondition notification_reads still exists';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_containment'
     ) IS DISTINCT FROM 1
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
     ) IS DISTINCT FROM ARRAY['employees_self_identity_read']::name[]
     OR (
       SELECT array_agg(attribute.attname::text ORDER BY attribute.attname)
       FROM pg_attribute attribute
       CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND grantee_role.rolname = 'authenticated'
         AND acl.privilege_type = 'SELECT'
     ) IS DISTINCT FROM
       ARRAY[
         'auth_user_id',
         'id',
         'is_active',
         'is_external',
         'role'
       ]::text[] THEN
    RAISE EXCEPTION
      'S1g rollback changed employee identity containment';
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
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'false'
     )
     OR has_table_privilege('anon', 'public.notifications', 'SELECT')
     OR has_table_privilege('authenticated', 'public.notifications', 'SELECT')
     OR has_table_privilege(
          'authenticated',
          'public.notifications',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR NOT has_table_privilege(
          'service_role',
          'public.notifications',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
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
     ) THEN
    RAISE EXCEPTION
      'S1g rollback notification fail-closed state failed';
  END IF;

  FOREACH v_identity IN ARRAY ARRAY[
    'public.get_notifications(integer,uuid)',
    'public.get_unread_notification_count(uuid)',
    'public.mark_all_notifications_read(uuid)',
    'public.mark_notification_read(uuid)'
  ]
  LOOP
    v_oid := to_regprocedure(v_identity);

    SELECT array_agg(
             COALESCE(grantee_role.rolname, 'PUBLIC')
             ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
           )
      INTO v_execute_grantees
    FROM pg_proc procedure
    CROSS JOIN LATERAL
      aclexplode(COALESCE(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) acl
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE procedure.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF v_oid IS NULL
       OR v_execute_grantees IS DISTINCT FROM
            ARRAY['postgres', 'service_role']::text[]
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc procedure
         JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
         WHERE procedure.oid = v_oid
           AND owner_role.rolname = 'postgres'
           AND procedure.prosecdef
           AND procedure.proconfig = ARRAY['search_path=public']::text[]
           AND procedure.prosrc LIKE
                 '%NOT_AUTHORIZED: service role required%'
       ) THEN
      RAISE EXCEPTION
        'S1g rollback service-only function contract failed: %',
        v_identity;
    END IF;
  END LOOP;
END;
$s1g_rollback_postcondition$;

COMMIT;
