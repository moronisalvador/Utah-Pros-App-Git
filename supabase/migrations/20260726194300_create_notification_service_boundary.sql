-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260726194300_create_notification_service_boundary
-- Phase: Mobile Production Readiness S1f
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops signed-in browser users from creating bell notifications directly. The trusted
--   notification Worker and the existing owner-run midnight-clock job keep their current access.
--
-- ATTRIBUTE-ONLY:
--   EXECUTE grants only; no function body, signature, table, row, policy, trigger, or data change.
--
-- VERIFIED LIVE CONTRACT (catalog-only capture 2026-07-26 19:43 UTC):
--   Signature:       public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)
--   Owner/security:  postgres; SQL; SECURITY DEFINER; search_path=public
--   Result:          notifications
--   Body md5:        939e2f34e6397672fa5a974c4a67d3cd
--   Definition md5:  29ccd83a067aefbcb27a89e9a9a71bea
--   ACL:             postgres, authenticated, service_role; no grant option
--   Database caller: public.apply_midnight_clock_split(), owner postgres, SECURITY DEFINER
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260726194300_create_notification_service_boundary.rollback.sql
--   restores authenticated EXECUTE. That deliberately reopens arbitrary signed-in bell emission.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $create_notification_preflight$
DECLARE
  v_oid oid;
  v_overload_count integer;
  v_execute_grantees text[];
  v_grantable_count integer;
  v_database_caller_count integer;
BEGIN
  SELECT count(*)
    INTO v_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_notification';

  v_oid := to_regprocedure(
    'public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)'
  );

  IF v_oid IS NULL OR v_overload_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'create_notification preflight expected one exact overload; found %',
      v_overload_count;
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_language language ON language.oid = p.prolang
    JOIN pg_roles owner_role ON owner_role.oid = p.proowner
    WHERE p.oid = v_oid
      AND language.lanname = 'sql'
      AND owner_role.rolname = 'postgres'
      AND pg_get_function_result(p.oid) = 'notifications'
      AND p.prosecdef
      AND NOT p.proisstrict
      AND NOT p.proleakproof
      AND p.provolatile = 'v'
      AND p.proparallel = 'u'
      AND p.prokind = 'f'
      AND p.proconfig = ARRAY['search_path=public']::text[]
      AND md5(p.prosrc) = '939e2f34e6397672fa5a974c4a67d3cd'
      AND md5(pg_get_functiondef(p.oid)) = '29ccd83a067aefbcb27a89e9a9a71bea'
  ) THEN
    RAISE EXCEPTION 'create_notification preflight target metadata/body drifted';
  END IF;

  IF v_execute_grantees IS DISTINCT FROM
       ARRAY['authenticated', 'postgres', 'service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL
         aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'create_notification preflight ACL drift: grantees=%, grantable=%, public=%, anon=%, authenticated=%, service_role=%',
      v_execute_grantees,
      v_grantable_count,
      'see ACL grantee 0 check',
      has_function_privilege('anon', v_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_oid, 'EXECUTE');
  END IF;

  SELECT count(*)
    INTO v_database_caller_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~ E'\\mcreate_notification[[:space:]]*\\(';

  IF v_database_caller_count IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_roles owner_role ON owner_role.oid = p.proowner
       WHERE p.oid = to_regprocedure('public.apply_midnight_clock_split()')
         AND owner_role.rolname = 'postgres'
         AND p.prosecdef
         AND p.proconfig = ARRAY['search_path=public, extensions, pg_temp']::text[]
         AND md5(p.prosrc) = '53b9c36e5deeeb3ded60136a97b079a1'
         AND regexp_count(p.prosrc, E'\\mcreate_notification[[:space:]]*\\(') = 1
     ) THEN
    RAISE EXCEPTION
      'create_notification preflight database caller drift: callers=%',
      v_database_caller_count;
  END IF;
END;
$create_notification_preflight$;

REVOKE EXECUTE ON FUNCTION
  public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)
  TO service_role;

DO $create_notification_postcondition$
DECLARE
  v_oid oid := to_regprocedure(
    'public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)'
  );
  v_execute_grantees text[];
  v_grantable_count integer;
BEGIN
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

  IF v_execute_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL
         aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = v_oid))
        IS DISTINCT FROM '939e2f34e6397672fa5a974c4a67d3cd' THEN
    RAISE EXCEPTION
      'create_notification postcondition failed: grantees=%, grantable=%, public=%, anon=%, authenticated=%, service_role=%',
      v_execute_grantees,
      v_grantable_count,
      'see ACL grantee 0 check',
      has_function_privilege('anon', v_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_oid, 'EXECUTE');
  END IF;
END;
$create_notification_postcondition$;

COMMIT;
