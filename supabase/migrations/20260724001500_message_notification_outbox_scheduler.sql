-- ════════════════════════════════════════════════
-- MIGRATION: 20260724001500_message_notification_outbox_scheduler
-- Phase: Messaging transport Phase 5 reliability activation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Inbound CallRail messages already commit a notification job atomically with
--   the canonical message. This migration makes those jobs run: an AFTER INSERT
--   statement trigger wakes the protected Pages worker immediately, and a
--   five-minute pg_cron safety net retries any due/stale work if that wake-up is
--   missed. Both paths use the existing server-only cron secret.
--
-- SAFETY:
--   - additive configuration, one trigger-only function, one trigger, one cron job;
--   - no browser grant or policy;
--   - exact UPR worker-URL allowlist prevents integration_config from becoming SSRF;
--   - missing URL, missing secret, or no due work is a silent fail-closed no-op;
--   - pg_net dispatch occurs after the surrounding transaction commits;
--   - the existing fenced claim token prevents concurrent dispatch; notifications
--     remain at-least-once if a worker crashes after dispatch but before finalizing.
--
-- APPLY ORDER:
--   The protected /api/process-message-notification-outbox worker must already be
--   deployed with MESSAGING_SCHEMA_MODE=foundation before this migration applies.
--
-- ROLLBACK:
--   Run supabase/rollbacks/
--   20260724001500_message_notification_outbox_scheduler.rollback.sql.
-- ════════════════════════════════════════════════

INSERT INTO public.integration_config (key, value)
VALUES (
  'message_notification_outbox_worker_url',
  'https://dev.utahpros.app/api/process-message-notification-outbox'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.wake_message_notification_outbox_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_worker_url text;
  v_secret text;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT value
  INTO v_worker_url
  FROM public.integration_config
  WHERE key = 'message_notification_outbox_worker_url';

  SELECT value
  INTO v_secret
  FROM public.integration_config
  WHERE key = 'cron_worker_secret';

  IF v_worker_url IS NULL OR v_worker_url NOT IN (
    'https://dev.utahpros.app/api/process-message-notification-outbox',
    'https://utahpros.app/api/process-message-notification-outbox'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.message_notification_outbox o
    WHERE (
      o.delivery_state IN ('pending', 'retryable')
      AND o.next_attempt_at <= v_now
    ) OR (
      o.delivery_state = 'processing'
      AND o.claimed_at < v_now - interval '5 minutes'
    )
  ) THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.wake_message_notification_outbox_worker()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trigger_message_notification_outbox_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  BEGIN
    PERFORM public.wake_message_notification_outbox_worker();
  EXCEPTION WHEN OTHERS THEN
    -- Never roll back the inbound message/outbox insert because a best-effort
    -- pg_net wake-up failed. The five-minute cron safety net retries later.
    RETURN NULL;
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_message_notification_outbox_worker()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS message_notification_outbox_dispatch
  ON public.message_notification_outbox;
CREATE TRIGGER message_notification_outbox_dispatch
  AFTER INSERT ON public.message_notification_outbox
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_message_notification_outbox_worker();

SELECT cron.schedule(
  'upr_message_notification_outbox',
  '*/5 * * * *',
  $$SELECT public.wake_message_notification_outbox_worker();$$
);
