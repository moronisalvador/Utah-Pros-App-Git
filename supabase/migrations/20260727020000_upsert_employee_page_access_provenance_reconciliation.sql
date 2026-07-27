-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260727020000_upsert_employee_page_access_provenance_reconciliation
-- Phase: Mobile Production Readiness S1h prerequisite — provenance-only replay
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Re-emits the already-live upsert_employee_page_access function body exactly
--   as PostgreSQL currently stores it. The reviewed permission_write_gates source
--   contains two explanatory comments inside the function body; the live apply
--   omitted those comments. The behavior is identical, but raw pg_proc.prosrc
--   hashes differ:
--
--     reviewed source / fresh replay: 79d6b7e2f231cfa2d0038af1d0464ca0
--     captured live body:             16e440632831b52155d5a9c6ba7b21a3
--
--   S1h pins exact live catalog provenance. Without this forward reconciliation,
--   a fresh local replay creates the source hash and then fails S1h even though
--   the authorization behavior is identical.
--
-- DATA / BEHAVIOR:
--   No table, policy, row, signature, return type, grant, authorization decision,
--   or response shape changes. This is catalog provenance normalization only.
--
-- APPLY ORDER:
--   permission_write_gates → this reconciliation → mobile S1h. The preflight
--   accepts only the exact reviewed source or exact captured live input.
--
-- ROLLBACK:
--   supabase/rollbacks/
--   20260727020000_upsert_employee_page_access_provenance_reconciliation.rollback.sql
--   restores the comment-bearing reviewed source body and refuses while S1h is
--   active. Prefer leaving this provenance normalization in place.
-- ═════════════════════════════════════════════════════════════════════════════

-- ATOMICITY:
--   The Supabase migration executor owns the transaction that includes both this
--   SQL and its schema_migrations ledger row. Do not add transaction control.

DO $page_access_provenance_preflight$
DECLARE
  v_oid oid := to_regprocedure(
    'public.upsert_employee_page_access(uuid,text,boolean,uuid)'
  );
  v_acl_grantees text[];
BEGIN
  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'permission_write_gates'
      AND migration.version IN ('20260726220000', '20260727012825')
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'page-access provenance preflight: expected exactly one reviewed source/local or live permission_write_gates ledger row';
  END IF;

  IF v_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       JOIN pg_language language_record
         ON language_record.oid = procedure.prolang
       JOIN pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = v_oid
         AND namespace.nspname = 'public'
         AND language_record.lanname = 'plpgsql'
         AND owner_role.rolname = 'postgres'
         AND procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.proconfig =
               ARRAY[
                 'search_path=public, extensions, pg_temp'
               ]::text[]
         AND pg_get_function_arguments(procedure.oid) =
               'p_employee_id uuid, p_nav_key text, p_can_view boolean, p_updated_by uuid DEFAULT NULL::uuid'
         AND pg_get_function_result(procedure.oid) =
               'employee_page_access'
         AND md5(procedure.prosrc) IN (
               '79d6b7e2f231cfa2d0038af1d0464ca0',
               '16e440632831b52155d5a9c6ba7b21a3'
             )
     ) THEN
    RAISE EXCEPTION
      'page-access provenance preflight: function identity/attributes/body drift';
  END IF;

  SELECT array_agg(
           CASE
             WHEN acl.grantee = 0 THEN 'PUBLIC'
             ELSE grantee_role.rolname
           END
           ORDER BY
             CASE
               WHEN acl.grantee = 0 THEN 'PUBLIC'
               ELSE grantee_role.rolname
             END
         )
    INTO v_acl_grantees
  FROM pg_proc procedure
  CROSS JOIN LATERAL aclexplode(
    COALESCE(
      procedure.proacl,
      acldefault('f', procedure.proowner)
    )
  ) acl
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE procedure.oid = v_oid
    AND acl.privilege_type = 'EXECUTE';

  IF v_acl_grantees IS DISTINCT FROM
       ARRAY['authenticated', 'postgres', 'service_role']::text[]
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           procedure.proacl,
           acldefault('f', procedure.proowner)
         )
       ) acl
       WHERE procedure.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'page-access provenance preflight: function ACL drift: %',
      v_acl_grantees;
  END IF;
END;
$page_access_provenance_preflight$;

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

DO $page_access_provenance_postcondition$
DECLARE
  v_oid oid := to_regprocedure(
    'public.upsert_employee_page_access(uuid,text,boolean,uuid)'
  );
  v_acl_grantees text[];
BEGIN
  SELECT array_agg(
           CASE
             WHEN acl.grantee = 0 THEN 'PUBLIC'
             ELSE grantee_role.rolname
           END
           ORDER BY
             CASE
               WHEN acl.grantee = 0 THEN 'PUBLIC'
               ELSE grantee_role.rolname
             END
         )
    INTO v_acl_grantees
  FROM pg_proc procedure
  CROSS JOIN LATERAL aclexplode(
    COALESCE(
      procedure.proacl,
      acldefault('f', procedure.proowner)
    )
  ) acl
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE procedure.oid = v_oid
    AND acl.privilege_type = 'EXECUTE';

  IF v_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       JOIN pg_language language_record
         ON language_record.oid = procedure.prolang
       JOIN pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = v_oid
         AND namespace.nspname = 'public'
         AND language_record.lanname = 'plpgsql'
         AND owner_role.rolname = 'postgres'
         AND procedure.prosecdef
         AND procedure.provolatile = 'v'
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
     OR v_acl_grantees IS DISTINCT FROM
          ARRAY['authenticated', 'postgres', 'service_role']::text[]
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           procedure.proacl,
           acldefault('f', procedure.proowner)
         )
       ) acl
       WHERE procedure.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'page-access provenance postcondition failed: ACL=%',
      v_acl_grantees;
  END IF;
END;
$page_access_provenance_postcondition$;

NOTIFY pgrst, 'reload schema';
