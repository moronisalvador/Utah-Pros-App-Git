-- ════════════════════════════════════════════════
-- MIGRATION: 20260802040935_preserve_notify_emit_event_id
-- Phase: MOB-PUSH-01 appointment-reminder incident containment
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES:
--   Preserves a usable service-producer notification occurrence id instead of
--   replacing it with a random UUID. This is required for reminder APNs retry
--   deduplication. Missing/blank ids on ordinary notification types still get
--   a generated UUID.
--
--   The earlier producer-authorization migration may or may not already be
--   present when this file is qualified. Its exact five guarded types retain
--   UUID + occurrence-ledger validation in either order; appointment.reminder
--   remains outside that private-producer authorization set.
--
--   The migration also codifies the live incident containment: the reminder
--   type stays disabled and the named cron stays absent. Durable bell/PWA/email
--   replay fencing remains a required activation prerequisite.
--
-- DEPENDS ON:
--   Tables: public.notification_types, public.integration_config
--   Optional predecessor: public.notification_producer_occurrences
--   Functions: public.notify_emit(text,jsonb), net.http_post
--   Extensions: pg_cron, pg_net, pgcrypto
--
-- SECURITY / COMPATIBILITY:
--   Same signature and return type. SECURITY DEFINER, postgres owner, pinned
--   search_path, exact Worker URL allowlist, authoritative p_type_key, and
--   service-role-only execution are preserved.
--
-- LOCK / ROLLOUT:
--   Brief function-catalog lock, one bounded catalog UPDATE, and removal of
--   only the named reminder cron. Apply in a reviewed low-traffic window.
--
-- ROLLBACK:
--   supabase/rollbacks/20260802040935_preserve_notify_emit_event_id.rollback.sql
--   restores the byte-exact predecessor body selected by the predecessor
--   marker recorded only after the exact source/ACL preflight succeeds, and
--   deliberately keeps reminders disabled/unscheduled.
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_source_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'preserve notify event id: function missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = 'notify_emit'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'preserve notify event id: overload drift';
  END IF;

  SELECT md5(function_record.prosrc)
    INTO v_source_hash
  FROM pg_proc function_record
  WHERE function_record.oid = v_oid;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid = v_oid
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND obj_description(function_record.oid, 'pg_proc') IS NULL
      AND md5(function_record.prosrc) IN (
        'c72e0f7fd40a4abec42cce1cd912a45b',
        '72d1973cff37b95c7149700a7c5bb5b7'
      )
  ) THEN
    RAISE EXCEPTION
      'preserve notify event id: predecessor drift (md5 %)',
      v_source_hash;
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
    RAISE EXCEPTION 'preserve notify event id: execute-grant drift';
  END IF;

  IF v_source_hash = '72d1973cff37b95c7149700a7c5bb5b7' THEN
    EXECUTE $comment$
      COMMENT ON FUNCTION public.notify_emit(text, jsonb)
      IS 'upr:20260802040935:predecessor=guarded'
    $comment$;
  ELSE
    EXECUTE $comment$
      COMMENT ON FUNCTION public.notify_emit(text, jsonb)
      IS 'upr:20260802040935:predecessor=baseline'
    $comment$;
  END IF;
END;
$preflight$;

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
  v_guarded_event_id uuid;
  v_occurrence_valid boolean := false;
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

  IF p_type_key IN (
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ) THEN
    BEGIN
      v_guarded_event_id :=
        NULLIF(btrim(v_body ->> 'notification_event_id'), '')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN;
    END;

    IF v_guarded_event_id IS NULL
       OR to_regclass('public.notification_producer_occurrences') IS NULL THEN
      RETURN;
    END IF;

    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1
        FROM public.notification_producer_occurrences occurrence
        WHERE occurrence.id = $1
          AND occurrence.type_key = $2
      )
    $query$
      INTO v_occurrence_valid
      USING v_guarded_event_id, p_type_key;

    IF v_occurrence_valid IS NOT TRUE THEN
      RETURN;
    END IF;

    v_event_id := to_jsonb(v_guarded_event_id::text);
  ELSIF v_event_id IS NULL
        OR jsonb_typeof(v_event_id) NOT IN ('string', 'number')
        OR NULLIF(btrim(v_body ->> 'notification_event_id'), '') IS NULL THEN
    v_event_id := to_jsonb(gen_random_uuid()::text);
  END IF;

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

ALTER FUNCTION public.notify_emit(text, jsonb)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  TO service_role;

DO $postflight$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
BEGIN
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
      AND obj_description(function_record.oid, 'pg_proc') IN (
        'upr:20260802040935:predecessor=baseline',
        'upr:20260802040935:predecessor=guarded'
      )
  ) THEN
    RAISE EXCEPTION 'preserve notify event id: replacement drift';
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
    RAISE EXCEPTION 'preserve notify event id: postflight grant drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'upr_appointment_reminders'
  ) OR EXISTS (
    SELECT 1
    FROM public.notification_types
    WHERE type_key = 'appointment.reminder'
      AND enabled
  ) THEN
    RAISE EXCEPTION 'preserve notify event id: reminder containment drift';
  END IF;
END;
$postflight$;
