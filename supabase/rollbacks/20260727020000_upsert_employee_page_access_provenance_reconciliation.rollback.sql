-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260727020000_upsert_employee_page_access_provenance_reconciliation
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
--   Restores the comment-bearing permission_write_gates source body. Runtime
--   behavior, signature, grants, and data remain unchanged, but raw pg_proc
--   provenance returns from 16e440... to 79d6b7....
--
-- GUARD:
--   This rollback refuses while S1h catalog state is active and requires:
--
--     SET upr.allow_employee_page_access_provenance_rollback = 'on';
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $page_access_provenance_rollback_guard$
DECLARE
  v_oid oid := to_regprocedure(
    'public.upsert_employee_page_access(uuid,text,boolean,uuid)'
  );
  v_overload_count integer;
  v_acl_entries text[];
BEGIN
  IF current_setting(
       'upr.allow_employee_page_access_provenance_rollback',
       true
     ) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'page-access provenance rollback refused; set upr.allow_employee_page_access_provenance_rollback=on only with explicit owner approval';
  END IF;

  IF to_regprocedure(
       'public.is_current_active_internal_employee(uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'page-access provenance rollback refused: S1h catalog state is active';
  END IF;

  SELECT count(*)
    INTO v_overload_count
  FROM pg_proc procedure
  JOIN pg_namespace namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'upsert_employee_page_access';

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
         AND procedure.provolatile = 'v'
         AND procedure.proparallel = 'u'
         AND procedure.proconfig =
               ARRAY[
                 'search_path=public, extensions, pg_temp'
               ]::text[]
         AND pg_get_function_arguments(procedure.oid) =
               'p_employee_id uuid, p_nav_key text, p_can_view boolean, p_updated_by uuid DEFAULT NULL::uuid'
         AND pg_get_function_result(procedure.oid) =
               'employee_page_access'
         AND md5(procedure.prosrc) =
               '16e440632831b52155d5a9c6ba7b21a3'
     )
     OR v_acl_entries IS DISTINCT FROM
          ARRAY[
            'postgres>authenticated:EXECUTE:not_grantable',
            'postgres>postgres:EXECUTE:not_grantable',
            'postgres>service_role:EXECUTE:not_grantable'
          ]::text[] THEN
    RAISE EXCEPTION
      'page-access provenance rollback preflight: exact forward function drift: overloads=%, ACL=%',
      v_overload_count,
      v_acl_entries;
  END IF;
END;
$page_access_provenance_rollback_guard$;

CREATE OR REPLACE FUNCTION public.upsert_employee_page_access(
  p_employee_id uuid,
  p_nav_key text,
  p_can_view boolean,
  p_updated_by uuid DEFAULT NULL::uuid
)
RETURNS employee_page_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_row employee_page_access;
  v_actor uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

  -- p_updated_by is caller-supplied and therefore spoofable. Prefer the real
  -- authenticated employee; fall back to the parameter for service-role callers.
  SELECT e.id INTO v_actor FROM employees e WHERE e.auth_user_id = auth.uid();

  INSERT INTO employee_page_access (employee_id, nav_key, can_view, updated_by, updated_at)
  VALUES (p_employee_id, p_nav_key, p_can_view, COALESCE(v_actor, p_updated_by), now())
  ON CONFLICT (employee_id, nav_key) DO UPDATE SET
    can_view = EXCLUDED.can_view,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.upsert_employee_page_access(uuid, text, boolean, uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.upsert_employee_page_access(uuid, text, boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.upsert_employee_page_access(uuid, text, boolean, uuid)
  TO authenticated, service_role;

DO $page_access_provenance_rollback_postcondition$
DECLARE
  v_oid oid := to_regprocedure(
    'public.upsert_employee_page_access(uuid,text,boolean,uuid)'
  );
  v_overload_count integer;
  v_acl_entries text[];
BEGIN
  SELECT count(*)
    INTO v_overload_count
  FROM pg_proc procedure
  JOIN pg_namespace namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'upsert_employee_page_access';

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
         AND procedure.provolatile = 'v'
         AND procedure.proparallel = 'u'
         AND procedure.proconfig =
               ARRAY[
                 'search_path=public, extensions, pg_temp'
               ]::text[]
         AND pg_get_function_arguments(procedure.oid) =
               'p_employee_id uuid, p_nav_key text, p_can_view boolean, p_updated_by uuid DEFAULT NULL::uuid'
         AND pg_get_function_result(procedure.oid) =
               'employee_page_access'
         AND md5(procedure.prosrc) =
               '79d6b7e2f231cfa2d0038af1d0464ca0'
     )
     OR v_acl_entries IS DISTINCT FROM
          ARRAY[
            'postgres>authenticated:EXECUTE:not_grantable',
            'postgres>postgres:EXECUTE:not_grantable',
            'postgres>service_role:EXECUTE:not_grantable'
          ]::text[] THEN
    RAISE EXCEPTION
      'page-access provenance rollback postcondition: exact source metadata/ACL was not restored: overloads=%, ACL=%',
      v_overload_count,
      v_acl_entries;
  END IF;
END;
$page_access_provenance_rollback_postcondition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
