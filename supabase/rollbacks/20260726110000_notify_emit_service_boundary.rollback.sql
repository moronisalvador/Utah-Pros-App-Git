-- ═══════════════════════════════════════════════════════════════════════════════
-- EMERGENCY ROLLBACK: 20260726110000_notify_emit_service_boundary
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- This restores the exact body and ACL observed at 2026-07-26 16:52:53 UTC. It deliberately
-- re-opens authenticated browser execution and lets an object p_body replace the trusted type_key.
-- Prefer a reviewed forward repair. Use this rollback only after an owner-approved compatibility
-- finding, with the notification path externally constrained and the regression recorded.
--
-- No trigger, caller, schedule, table, row, policy, URL, secret, header or setting is changed.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Refuse to overwrite a function that changed after the reviewed S1d migration.
DO $notify_emit_rollback_preflight$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_body_md5 text;
  v_execute_grantees text[];
  v_grantable_count integer;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'notify_emit rollback preflight failed: target is missing';
  END IF;

  SELECT
    md5(p.prosrc),
    array_agg(COALESCE(grantee_role.rolname, 'PUBLIC') ORDER BY
      COALESCE(grantee_role.rolname, 'PUBLIC'))
      FILTER (WHERE acl.privilege_type = 'EXECUTE'),
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.is_grantable
    )
    INTO v_body_md5, v_execute_grantees, v_grantable_count
  FROM pg_proc p
  CROSS JOIN LATERAL
    aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE p.oid = v_oid
    AND p.prosecdef
    AND p.proconfig = ARRAY['search_path=public']::text[]
    AND pg_get_function_result(p.oid) = 'void'
  GROUP BY p.prosrc;

  IF v_body_md5 IS DISTINCT FROM '27d638e9e2681bf74f17fa255c7eaf04'
     OR v_execute_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'notify_emit rollback preflight drift: body_md5=%, execute_grantees=%, grantable=%, anon=%, authenticated=%, service_role=%',
      v_body_md5,
      v_execute_grantees,
      v_grantable_count,
      has_function_privilege('anon', v_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_oid, 'EXECUTE');
  END IF;
END;
$notify_emit_rollback_preflight$;

CREATE OR REPLACE FUNCTION public.notify_emit(p_type_key text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_enabled boolean; v_url text; v_secret text;
BEGIN
  IF p_type_key IS NULL THEN RETURN; END IF;
  SELECT enabled INTO v_enabled FROM public.notification_types WHERE type_key = p_type_key;
  IF v_enabled IS NOT TRUE THEN RETURN; END IF;
  SELECT value INTO v_url    FROM public.integration_config WHERE key = 'notify_worker_url';
  SELECT value INTO v_secret FROM public.integration_config WHERE key = 'notify_webhook_secret';
  IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('type_key', p_type_key) || COALESCE(p_body, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', COALESCE(v_secret,''))
  );
END; $$;

-- Restore the exact prior non-owner ACL. PUBLIC and anon remain denied; authenticated is the
-- intentionally unsafe capability restored by this emergency rollback.
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb) TO authenticated, service_role;

DO $notify_emit_rollback_postcondition$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_body_md5 text;
  v_execute_grantees text[];
  v_grantable_count integer;
BEGIN
  SELECT
    md5(p.prosrc),
    array_agg(COALESCE(grantee_role.rolname, 'PUBLIC') ORDER BY
      COALESCE(grantee_role.rolname, 'PUBLIC'))
      FILTER (WHERE acl.privilege_type = 'EXECUTE'),
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.is_grantable
    )
    INTO v_body_md5, v_execute_grantees, v_grantable_count
  FROM pg_proc p
  CROSS JOIN LATERAL
    aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE p.oid = v_oid
  GROUP BY p.prosrc;

  IF v_body_md5 IS DISTINCT FROM '5935917b313c772a964b7c02e67c8dd4'
     OR v_execute_grantees IS DISTINCT FROM
       ARRAY['authenticated', 'postgres', 'service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'notify_emit rollback postcondition failed: body_md5=%, execute_grantees=%, grantable=%, anon=%, authenticated=%, service_role=%',
      v_body_md5,
      v_execute_grantees,
      v_grantable_count,
      has_function_privilege('anon', v_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_oid, 'EXECUTE');
  END IF;
END;
$notify_emit_rollback_postcondition$;

COMMIT;
