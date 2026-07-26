-- Catalog-only S1f preflight. Never invokes create_notification or reads notification rows.
DO $test$
DECLARE
  v_oid oid := to_regprocedure(
    'public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text)'
  );
BEGIN
  ASSERT v_oid IS NOT NULL;
  ASSERT md5((SELECT prosrc FROM pg_proc WHERE oid = v_oid))
    = '939e2f34e6397672fa5a974c4a67d3cd';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = v_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  );
  ASSERT NOT has_function_privilege('anon', v_oid, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', v_oid, 'EXECUTE');
  ASSERT has_function_privilege('service_role', v_oid, 'EXECUTE');
  ASSERT (
    SELECT count(*) = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~ E'\\mcreate_notification[[:space:]]*\\('
  );
END
$test$;
