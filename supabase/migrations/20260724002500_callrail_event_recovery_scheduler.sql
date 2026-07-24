-- ════════════════════════════════════════════════
-- MIGRATION: 20260724002500_callrail_event_recovery_scheduler
-- Phase: Messaging transport Phase 5 reliability activation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES:
--   Calls the already-deployed, scheduler-secret-protected CallRail event
--   recovery worker every five minutes, but only when a received, due-retryable,
--   or stale-claimed CallRail SMS/MMS event exists.
--
-- SAFETY:
--   - stores only a non-secret exact worker URL;
--   - reuses the existing server-only cron secret;
--   - exact dev/production URL allowlist prevents configuration-driven SSRF;
--   - missing URL, secret, or due work is a fail-closed no-op;
--   - does not send a customer message or mutate canonical message history;
--   - the Worker retains its own fenced event claim and provider/company scope.
--
-- APPLY ORDER:
--   /api/process-callrail-events must already be deployed with
--   MESSAGING_SCHEMA_MODE=foundation and CallRail receive configuration.
--
-- ROLLBACK:
--   Run supabase/rollbacks/
--   20260724002500_callrail_event_recovery_scheduler.rollback.sql.
-- ════════════════════════════════════════════════

INSERT INTO public.integration_config (key, value)
VALUES (
  'callrail_event_recovery_worker_url',
  'https://dev.utahpros.app/api/process-callrail-events'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.wake_callrail_event_recovery_worker()
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
  WHERE key = 'callrail_event_recovery_worker_url';

  SELECT value
  INTO v_secret
  FROM public.integration_config
  WHERE key = 'cron_worker_secret';

  IF v_worker_url IS NULL OR v_worker_url NOT IN (
    'https://dev.utahpros.app/api/process-callrail-events',
    'https://utahpros.app/api/process-callrail-events'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.message_provider_events e
    WHERE e.provider = 'callrail'
      AND e.message_type IN ('sms', 'mms')
      AND (
        e.processing_state = 'received'
        OR (
          e.processing_state = 'retryable'
          AND e.next_attempt_at <= v_now
        )
        OR (
          e.processing_state = 'claimed'
          AND e.claimed_at < v_now - interval '5 minutes'
        )
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

REVOKE ALL ON FUNCTION public.wake_callrail_event_recovery_worker()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule(
  'upr_callrail_event_recovery',
  '*/5 * * * *',
  $$SELECT public.wake_callrail_event_recovery_worker();$$
);
