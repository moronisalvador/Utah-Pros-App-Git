-- READ-ONLY POST-APPLY CHECK — 20260723235900_public_form_rpc_boundary.sql
--
-- Run only after the exact reviewed migration is applied in an owner-authorized shared-production
-- window. This script checks catalog privileges only; it creates no lead and changes no data.

DO $$
DECLARE
  v_oid oid := to_regprocedure(
    'public.upsert_lead_from_form(uuid,text,jsonb,jsonb,boolean,text,text,uuid)'
  );
  v_public_execute boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'public form boundary verification failed: function is missing';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = v_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
    INTO v_public_execute;

  IF v_public_execute
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'public form boundary verification failed: a browser role can still execute the function';
  END IF;

  IF has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'public form boundary verification failed: service_role cannot execute the function';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    LEFT JOIN pg_roles role_grantee ON role_grantee.oid = acl.grantee
    WHERE p.oid = v_oid
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> p.proowner
      AND COALESCE(role_grantee.rolname, 'PUBLIC') <> 'service_role'
  ) THEN
    RAISE EXCEPTION
      'public form boundary verification failed: unexpected non-owner EXECUTE grantee remains';
  END IF;
END;
$$;
