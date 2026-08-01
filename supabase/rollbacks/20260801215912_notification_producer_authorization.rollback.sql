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
-- ════════════════════════════════════════════════

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
  uuid
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
