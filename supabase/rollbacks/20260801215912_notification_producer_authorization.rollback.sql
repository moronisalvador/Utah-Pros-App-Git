-- ════════════════════════════════════════════════
-- ROLLBACK: 20260801215912_notification_producer_authorization
-- ════════════════════════════════════════════════
--
-- Recovery containment for the five notification producers. It deliberately
-- does NOT restore anonymous appointment access, caller-supplied actor trust,
-- destructive crew replacement, or unlocked review races. Those are security
-- defects, not compatibility contracts.
--
-- The five catalog flags are disabled first. Existing occurrence and delivery
-- claims remain as private evidence so rollback cannot make a prior occurrence
-- replayable. The pre-migration notify_emit body is restored for every other
-- notification type, and browser/service RPC signatures remain callable.
-- Caller-bound appointment creator/update/delete/crew authorization is retained;
-- restoring spoofable or object-wide mutation would not be a safe recovery.
-- ════════════════════════════════════════════════

DO $rollback_preflight$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_source_hash text;
BEGIN
  SELECT md5(function_record.prosrc)
    INTO v_source_hash
  FROM pg_proc function_record
  WHERE function_record.oid = v_oid;

  IF v_oid IS NULL
     OR (
       SELECT count(*)
       FROM pg_proc function_record
       JOIN pg_namespace namespace_record
         ON namespace_record.oid = function_record.pronamespace
       WHERE namespace_record.nspname = 'public'
         AND function_record.proname = 'notify_emit'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc function_record
       WHERE function_record.oid = v_oid
         AND pg_get_userbyid(function_record.proowner) = 'postgres'
         AND function_record.prosecdef
         AND function_record.proconfig =
           ARRAY['search_path=public']::text[]
         AND md5(function_record.prosrc) =
           '72d1973cff37b95c7149700a7c5bb5b7'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization rollback forward drift (md5 %)',
      v_source_hash
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_proc function_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           function_record.proacl,
           acldefault('f', function_record.proowner)
         )
       ) acl
       WHERE function_record.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'notification producer authorization rollback execute-grant drift'
      USING ERRCODE = '55000';
  END IF;
END;
$rollback_preflight$;

UPDATE public.notification_types
SET enabled = false
WHERE type_key IN (
  'appointment.assigned',
  'appointment.updated',
  'appointment.canceled',
  'timesheet.change_requested',
  'timesheet.change_reviewed'
);

CREATE OR REPLACE FUNCTION public.notify_emit(
  p_type_key text,
  p_body jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled boolean;
  v_url text;
  v_secret text;
BEGIN
  IF p_type_key IS NULL THEN RETURN; END IF;
  SELECT enabled
  INTO v_enabled
  FROM public.notification_types
  WHERE type_key = p_type_key;
  IF v_enabled IS NOT TRUE THEN RETURN; END IF;

  SELECT value
  INTO v_url
  FROM public.integration_config
  WHERE key = 'notify_worker_url';
  SELECT value
  INTO v_secret
  FROM public.integration_config
  WHERE key = 'notify_webhook_secret';

  -- Exact UPR worker-URL allowlist: a rewritten integration_config row must
  -- never turn this SECURITY DEFINER pg_net caller into an SSRF vector (or
  -- leak the webhook secret to a third-party host). A blank secret is refused
  -- here because authorizeNotifyRequest 401s it anyway.
  IF v_url IS NULL OR v_url NOT IN (
    'https://dev.utahpros.app/api/notify',
    'https://utahpros.app/api/notify'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := COALESCE(p_body, '{}'::jsonb) || jsonb_build_object(
      'notification_event_id',
      gen_random_uuid(),
      'type_key',
      p_type_key
    ),
    headers := jsonb_build_object(
      'Content-Type',
      'application/json',
      'x-webhook-secret',
      v_secret
    )
  );
END;
$function$;

ALTER FUNCTION public.notify_emit(text, jsonb)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  TO service_role;

-- Leave every new private object in place but inert to preserve occurrence
-- history and prevent replay after a recovery action.
REVOKE EXECUTE ON FUNCTION public.claim_notification_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.validate_notification_producer_delivery(
  uuid,
  text,
  text,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_guarded_native_push_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_guarded_notification_target_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.release_notification_delivery_claim(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.emit_notification_producer_event(
  text,
  text,
  text,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;

DO $rollback_postflight$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.notification_types catalog
    WHERE catalog.type_key IN (
      'appointment.assigned',
      'appointment.updated',
      'appointment.canceled',
      'timesheet.change_requested',
      'timesheet.change_reviewed'
    )
      AND catalog.enabled IS TRUE
  ) THEN
    RAISE EXCEPTION
      'notification producer recovery rollback did not contain every flag'
      USING ERRCODE = '55000';
  END IF;

  IF v_oid IS NULL
     OR (
       SELECT count(*)
       FROM pg_proc function_record
       JOIN pg_namespace namespace_record
         ON namespace_record.oid = function_record.pronamespace
       WHERE namespace_record.nspname = 'public'
         AND function_record.proname = 'notify_emit'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc function_record
       WHERE function_record.oid = v_oid
         AND pg_get_userbyid(function_record.proowner) = 'postgres'
         AND function_record.prosecdef
         AND function_record.proconfig =
           ARRAY['search_path=public']::text[]
         AND md5(function_record.prosrc) =
           'c72e0f7fd40a4abec42cce1cd912a45b'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization rollback predecessor drift'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_proc function_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           function_record.proacl,
           acldefault('f', function_record.proowner)
         )
       ) acl
       WHERE function_record.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'notification producer authorization rollback postflight grant drift'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN ('appointments', 'appointment_crew')
      AND 'anon' = ANY (policy.roles)
  ) THEN
    RAISE EXCEPTION
      'notification producer recovery rollback must not restore anonymous appointment policies'
      USING ERRCODE = '55000';
  END IF;
END;
$rollback_postflight$;
