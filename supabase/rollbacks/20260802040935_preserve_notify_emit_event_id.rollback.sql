-- ════════════════════════════════════════════════
-- ROLLBACK: 20260802040935_preserve_notify_emit_event_id
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES:
--   Restores the prior notify_emit body that always generates a new event id.
--   This weakens retry deduplication and is only for emergency compatibility.
--
-- SAFETY:
--   Appointment reminders remain disabled and unscheduled. A rollback must not
--   reactivate the incident producer. The signature, URL allowlist, pinned
--   search_path, owner, and service-role-only ACL remain unchanged.
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_source text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'preserve notify event id rollback: function missing';
  END IF;
  SELECT prosrc INTO v_source FROM pg_proc WHERE oid = v_oid;
  IF v_source NOT LIKE '%v_event_id := v_body -> ''notification_event_id'';%'
     OR v_source NOT LIKE '%''notification_event_id'', v_event_id%' THEN
    RAISE EXCEPTION 'preserve notify event id rollback: forward body drift';
  END IF;
END;
$preflight$;

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

REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  TO service_role;

DO $postflight$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid = v_oid
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) = 'c72e0f7fd40a4abec42cce1cd912a45b'
  ) THEN
    RAISE EXCEPTION 'preserve notify event id rollback: prior body did not land';
  END IF;

  IF has_function_privilege('PUBLIC', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'preserve notify event id rollback: execute-grant drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'upr_appointment_reminders'
  ) OR EXISTS (
    SELECT 1
    FROM public.notification_types
    WHERE type_key = 'appointment.reminder'
      AND enabled
  ) THEN
    RAISE EXCEPTION 'preserve notify event id rollback: reminder containment drift';
  END IF;
END;
$postflight$;
