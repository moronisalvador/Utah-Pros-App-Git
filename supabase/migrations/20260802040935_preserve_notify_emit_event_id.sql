-- ════════════════════════════════════════════════
-- MIGRATION: 20260802040935_preserve_notify_emit_event_id
-- Phase: MOB-PUSH-01 appointment-reminder incident containment
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Keeps a producer-supplied notification occurrence id intact when the
--   database calls /api/notify. The current function replaces that stable id
--   with a random UUID, which defeats APNs retry deduplication. Producers that
--   do not supply a usable string/number still receive a generated UUID.
--
--   This migration also records the incident containment already performed on
--   the shared project: appointment reminders stay disabled and their cron
--   stays absent until compatible Production Worker code is SHA-verified.
--
-- DEPENDS ON:
--   Tables: public.notification_types, public.integration_config
--   Functions: public.notify_emit(text,jsonb), net.http_post
--   Extensions: pg_cron, pg_net, pgcrypto
--
-- SECURITY / COMPATIBILITY:
--   Backward-compatible same-signature SECURITY DEFINER replacement. The
--   catalog type_key remains authoritative and cannot be overridden by the
--   body. notify_emit remains service-role-only with a pinned search_path and
--   the existing exact Worker URL allowlist. No browser grant is added.
--
-- LOCK / ROLLOUT:
--   CREATE OR REPLACE takes a brief function catalog lock. The bounded catalog
--   UPDATE touches one row. Unscheduling touches only the named reminder job.
--   Apply in a reviewed low-traffic window. Do not activate reminders in this
--   migration; activation is a later code-after-database release gate.
--
-- ROLLBACK:
--   supabase/rollbacks/20260802040935_preserve_notify_emit_event_id.rollback.sql
--   restores the exact prior notify_emit body but deliberately keeps reminders
--   disabled and unscheduled. Activation is never a rollback side effect.
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'preserve notify event id: missing public.notify_emit(text,jsonb)';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = 'notify_emit'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'preserve notify event id: notify_emit overload drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid = v_oid
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) = 'c72e0f7fd40a4abec42cce1cd912a45b'
  ) THEN
    RAISE EXCEPTION
      'preserve notify event id: live function drift (md5 %)',
      (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid);
  END IF;

  IF has_function_privilege('PUBLIC', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'preserve notify event id: execute-grant drift';
  END IF;
END;
$preflight$;

-- Release containment: no new reminder claims or sends are allowed until the
-- exact compatible Production Worker deployment has been verified.
UPDATE public.notification_types
SET enabled = false
WHERE type_key = 'appointment.reminder'
  AND enabled IS DISTINCT FROM false;

DO $unschedule$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'upr_appointment_reminders'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$unschedule$;

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
  v_body jsonb;
  v_event_id jsonb;
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

  v_body := COALESCE(p_body, '{}'::jsonb);
  v_event_id := v_body -> 'notification_event_id';
  IF v_event_id IS NULL
     OR jsonb_typeof(v_event_id) NOT IN ('string', 'number')
     OR NULLIF(btrim(v_body ->> 'notification_event_id'), '') IS NULL THEN
    v_event_id := to_jsonb(gen_random_uuid()::text);
  END IF;

  -- The function argument owns type_key. The service-only producer owns a
  -- stable occurrence id when it supplies one; missing/blank ids get a UUID.
  v_body := (v_body - 'type_key' - 'notification_event_id')
    || jsonb_build_object(
      'notification_event_id', v_event_id,
      'type_key', p_type_key
    );

  PERFORM net.http_post(
    url := v_url,
    body := v_body,
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
  v_source text;
BEGIN
  SELECT prosrc INTO v_source FROM pg_proc WHERE oid = v_oid;
  IF v_source NOT LIKE '%v_event_id := v_body -> ''notification_event_id'';%'
     OR v_source NOT LIKE '%v_body := (v_body - ''type_key'' - ''notification_event_id'')%'
     OR v_source NOT LIKE '%''notification_event_id'', v_event_id%'
     OR v_source LIKE '%''notification_event_id'',%gen_random_uuid(),%''type_key''%' THEN
    RAISE EXCEPTION 'preserve notify event id: replacement body did not land';
  END IF;

  IF has_function_privilege('PUBLIC', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'preserve notify event id: postflight execute-grant drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'upr_appointment_reminders'
  ) OR EXISTS (
    SELECT 1
    FROM public.notification_types
    WHERE type_key = 'appointment.reminder'
      AND enabled
  ) THEN
    RAISE EXCEPTION 'preserve notify event id: reminder containment did not land';
  END IF;
END;
$postflight$;
