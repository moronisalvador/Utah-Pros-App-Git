-- ════════════════════════════════════════════════
-- ROLLBACK: 20260802040935_preserve_notify_emit_event_id
-- ════════════════════════════════════════════════
--
-- Restores the byte-exact notify_emit predecessor selected by catalog state:
-- the guarded producer body when its occurrence ledger exists, otherwise the
-- live URL-allowlist baseline. Reminders remain disabled and unscheduled.
-- ════════════════════════════════════════════════

DO $rollback$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_expected_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'preserve notify event id rollback: function missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = 'notify_emit'
  ) IS DISTINCT FROM 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid = v_oid
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) = 'ea3a9b3b6cca96722c008d7e9b23f6bc'
  ) THEN
    RAISE EXCEPTION 'preserve notify event id rollback: forward drift';
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
    RAISE EXCEPTION 'preserve notify event id rollback: execute-grant drift';
  END IF;

  IF to_regclass('public.notification_producer_occurrences') IS NOT NULL THEN
    v_expected_hash := '72d1973cff37b95c7149700a7c5bb5b7';
    EXECUTE $guarded$
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
  v_notification_event_id uuid;
BEGIN
  IF p_type_key IS NULL THEN
    RETURN;
  END IF;

  SELECT enabled
    INTO v_enabled
  FROM public.notification_types
  WHERE type_key = p_type_key;

  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  IF p_type_key IN (
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ) THEN
    BEGIN
      v_notification_event_id :=
        NULLIF(p_body ->> 'notification_event_id', '')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN;
    END;

    IF v_notification_event_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.notification_producer_occurrences occurrence
         WHERE occurrence.id = v_notification_event_id
           AND occurrence.type_key = p_type_key
       ) THEN
      RETURN;
    END IF;
  ELSE
    v_notification_event_id := gen_random_uuid();
  END IF;

  SELECT value
    INTO v_url
  FROM public.integration_config
  WHERE key = 'notify_worker_url';
  SELECT value
    INTO v_secret
  FROM public.integration_config
  WHERE key = 'notify_webhook_secret';

  IF v_url IS NULL
     OR v_url NOT IN (
       'https://dev.utahpros.app/api/notify',
       'https://utahpros.app/api/notify'
     )
     OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := COALESCE(p_body, '{}'::jsonb) || jsonb_build_object(
      'notification_event_id',
      v_notification_event_id,
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
$guarded$;
  ELSE
    v_expected_hash := 'c72e0f7fd40a4abec42cce1cd912a45b';
    EXECUTE $baseline$
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
$baseline$;
  END IF;

  ALTER FUNCTION public.notify_emit(text, jsonb)
    OWNER TO postgres;
  REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
    TO service_role;

  v_oid := to_regprocedure('public.notify_emit(text,jsonb)');
  IF (
    SELECT count(*)
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = 'notify_emit'
  ) IS DISTINCT FROM 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid = v_oid
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) = v_expected_hash
  ) THEN
    RAISE EXCEPTION 'preserve notify event id rollback: predecessor drift';
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
    RAISE EXCEPTION 'preserve notify event id rollback: postflight grant drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'upr_appointment_reminders'
  ) OR EXISTS (
    SELECT 1
    FROM public.notification_types
    WHERE type_key = 'appointment.reminder'
      AND enabled
  ) THEN
    RAISE EXCEPTION 'preserve notify event id rollback: containment drift';
  END IF;
END;
$rollback$;
