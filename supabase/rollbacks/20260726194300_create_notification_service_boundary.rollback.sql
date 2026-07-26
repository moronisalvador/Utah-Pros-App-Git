-- EMERGENCY ROLLBACK: 20260726194300_create_notification_service_boundary
--
-- Restores authenticated EXECUTE on the unchanged create_notification function. This deliberately
-- reopens arbitrary bell emission by any signed-in database client. Prefer a forward repair.

BEGIN;

DO $create_notification_rollback_preflight$
DECLARE
  v_oid oid := to_regprocedure(
    'public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)'
  );
BEGIN
  IF v_oid IS NULL
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = v_oid))
        IS DISTINCT FROM '939e2f34e6397672fa5a974c4a67d3cd'
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
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'create_notification rollback preflight drift';
  END IF;
END;
$create_notification_rollback_preflight$;

REVOKE EXECUTE ON FUNCTION
  public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)
  TO authenticated, service_role;

DO $create_notification_rollback_postcondition$
DECLARE
  v_oid oid := to_regprocedure(
    'public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)'
  );
BEGIN
  IF EXISTS (
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
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = v_oid))
        IS DISTINCT FROM '939e2f34e6397672fa5a974c4a67d3cd' THEN
    RAISE EXCEPTION 'create_notification rollback postcondition failed';
  END IF;
END;
$create_notification_rollback_postcondition$;

COMMIT;
