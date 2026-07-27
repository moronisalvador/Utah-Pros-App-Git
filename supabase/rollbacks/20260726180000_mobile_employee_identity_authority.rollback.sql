-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260726180000_mobile_employee_identity_authority
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
--   Removes the three additive employee read RPCs. It changes no employee row,
--   table grant, policy, or pre-existing RPC.
--
-- COMPATIBILITY WARNING:
--   Deployed PWA/Capacitor/browser code may depend on these functions. This
--   rollback refuses while the containment boundary or any downstream identity
--   consumer remains active, and it requires an explicit owner-approved flag:
--
--     SET upr.allow_unsafe_employee_identity_contract_rollback = 'on';
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $employee_identity_contract_rollback_guard$
DECLARE
  v_expected record;
  v_oid oid;
  v_overload_count integer;
  v_acl_entries text[];
BEGIN
  IF current_setting(
       'upr.allow_unsafe_employee_identity_contract_rollback',
       true
     ) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'employee identity contract rollback refused; set upr.allow_unsafe_employee_identity_contract_rollback=on only with explicit owner approval';
  END IF;

  -- Paired rollback scripts intentionally do not rewrite migration history, so
  -- guard the actual downstream catalog state as well as the later source name.
  IF EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
         AND policyname = 'employees_self_identity_read'
     )
     OR to_regclass('public.inbound_lead_recording_sources') IS NOT NULL
     OR to_regclass('public.notification_reads') IS NOT NULL
     OR to_regprocedure(
          'public.is_current_active_internal_employee(uuid)'
        ) IS NOT NULL THEN
    RAISE EXCEPTION
      'employee identity contract rollback refused: containment or a downstream identity consumer is still active';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.get_my_employee_profile()',
          'get_my_employee_profile',
          '',
          'TABLE(id uuid, full_name text, display_name text, email text, role text, is_active boolean, is_external boolean, default_division text)',
          'b0df079edcab6eb4de1d7820663966e1'
        ),
        (
          'public.get_employee_directory(boolean)',
          'get_employee_directory',
          'p_include_inactive boolean DEFAULT false',
          'TABLE(id uuid, full_name text, display_name text, role text, color text, avatar_url text, is_active boolean)',
          '51bdc3ce561c947a55373090f8913446'
        ),
        (
          'public.get_message_author_directory(uuid[])',
          'get_message_author_directory',
          'p_message_ids uuid[]',
          'TABLE(id uuid, full_name text, display_name text)',
          'e2abe76a7795aaa4e084a5e6640918e2'
        )
    ) AS expected(
      identity,
      function_name,
      arguments,
      result_type,
      body_md5
    )
  LOOP
    v_oid := to_regprocedure(v_expected.identity);

    SELECT count(*)
      INTO v_overload_count
    FROM pg_proc procedure
    JOIN pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = v_expected.function_name;

    SELECT array_agg(
             format(
               '%s>%s:%s:%s',
               COALESCE(grantor_role.rolname, '<missing>'),
               CASE
                 WHEN acl.grantee = 0 THEN 'PUBLIC'
                 ELSE COALESCE(grantee_role.rolname, '<missing>')
               END,
               acl.privilege_type,
               CASE
                 WHEN acl.is_grantable THEN 'grantable'
                 ELSE 'not_grantable'
               END
             )
             ORDER BY
               CASE
                 WHEN acl.grantee = 0 THEN 'PUBLIC'
                 ELSE COALESCE(grantee_role.rolname, '<missing>')
               END,
               acl.privilege_type
           )
      INTO v_acl_entries
    FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )
    ) acl
    LEFT JOIN pg_roles grantor_role
      ON grantor_role.oid = acl.grantor
    LEFT JOIN pg_roles grantee_role
      ON grantee_role.oid = acl.grantee
    WHERE procedure.oid = v_oid;

    IF v_oid IS NULL
       OR v_overload_count IS DISTINCT FROM 1
       OR NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      JOIN pg_namespace namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_roles owner_role
        ON owner_role.oid = procedure.proowner
      JOIN pg_language language_record
        ON language_record.oid = procedure.prolang
      WHERE procedure.oid = v_oid
        AND namespace.nspname = 'public'
        AND owner_role.rolname = 'postgres'
        AND language_record.lanname = 'plpgsql'
        AND procedure.prokind = 'f'
        AND procedure.prosecdef
        AND NOT procedure.proisstrict
        AND NOT procedure.proleakproof
        AND procedure.provolatile = 's'
        AND procedure.proparallel = 'u'
        AND procedure.proconfig =
              ARRAY[
                'search_path=public, extensions, pg_temp'
              ]::text[]
        AND pg_get_function_arguments(procedure.oid) =
              v_expected.arguments
        AND pg_get_function_result(procedure.oid) =
              v_expected.result_type
        AND md5(procedure.prosrc) = v_expected.body_md5
      )
       OR v_acl_entries IS DISTINCT FROM
            ARRAY[
              'postgres>authenticated:EXECUTE:not_grantable',
              'postgres>postgres:EXECUTE:not_grantable',
              'postgres>service_role:EXECUTE:not_grantable'
            ]::text[] THEN
      RAISE EXCEPTION
        'employee identity contract rollback preflight: exact function drift: identity=%, overloads=%, ACL=%',
        v_expected.identity,
        v_overload_count,
        v_acl_entries;
    END IF;
  END LOOP;
END;
$employee_identity_contract_rollback_guard$;

DROP FUNCTION public.get_message_author_directory(uuid[]);
DROP FUNCTION public.get_employee_directory(boolean);
DROP FUNCTION public.get_my_employee_profile();

DO $employee_identity_contract_rollback_postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'get_my_employee_profile',
        'get_employee_directory',
        'get_message_author_directory'
      )
  ) THEN
    RAISE EXCEPTION
      'employee identity contract rollback postcondition: function or overload remains';
  END IF;
END;
$employee_identity_contract_rollback_postcondition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
