-- ════════════════════════════════════════════════
-- MIGRATION: 20260725190000_ops_health_alerting
-- Phase: n/a (standalone additive ops-alerting foundation)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Turns on the "watchman". Two additive pieces: (1) a new entry in the
--   notification catalog called "ops.health", so the system is allowed to put an
--   operational alert in the admins' in-app bell; and (2) a scheduled job that
--   pokes the already-written /api/ops-health worker every 15 minutes so it can
--   look for trouble. Without this, the worker exists but is never called and
--   the alert type does not exist, so every alert would be silently dropped.
--
--   It exists because nothing in this system reported its own failures: 121
--   worker errors in a week went unnoticed, and an inbound STOP failed every
--   five minutes for 45 minutes with nobody alerted.
--
-- ADDITIVE-ONLY:
--   Yes. One INSERT into notification_types, one INSERT into integration_config,
--   one new function, one new cron entry. No table DROP/RENAME/ALTER COLUMN, no
--   change to any existing row, no policy or grant widening. Idempotent.
--
-- SAFETY:
--   - stores only a non-secret exact worker URL; reuses the existing server-only
--     cron secret (no new secret is created or seeded here);
--   - exact dev/production URL allowlist prevents configuration-driven SSRF;
--   - missing URL or secret is a fail-closed no-op;
--   - the wake is UNCONDITIONAL by design. The sibling schedulers guard on "is
--     there due work", but this worker's whole job is to notice that something
--     stopped happening — a guard duplicating its threshold logic in SQL could
--     drift and silently stop alerting, which is the exact failure being fixed;
--   - the worker is read-only over what it monitors and cannot send a customer
--     message: it emits only through the internal notify.js staff path.
--
-- APPLY ORDER:
--   /api/ops-health must already be deployed (it is scheduler-secret-protected,
--   so an early apply is inert-but-noisy, not harmful). The notification type is
--   safe to seed at any time.
--
-- ROLLBACK:
--   Run supabase/rollbacks/20260725190000_ops_health_alerting.rollback.sql
--   (unschedules the cron entry, drops the wake function, removes the
--    integration_config URL row, and deletes the notification type).
-- ════════════════════════════════════════════════

-- ─── 1. Notification catalog entry ───
-- Bell-only by default: this is an internal operational signal, and the owner's
-- default channel for it is the in-app bell (push/email remain per-employee
-- opt-ins through the existing preference matrix).
INSERT INTO public.notification_types
  (type_key, label, description, category, audience,
   bell_default, push_default, email_default, enabled, sort_order)
VALUES
  ('ops.health',
   'System health alert',
   'An automated check found failed message events, stuck retries, worker errors, or an unfinished automation claim.',
   'operations',
   'Admins',
   true, false, false, true, 110)
ON CONFLICT (type_key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  category    = EXCLUDED.category,
  audience    = EXCLUDED.audience,
  enabled     = EXCLUDED.enabled;

-- ─── 2. Worker URL (non-secret) ───
INSERT INTO public.integration_config (key, value)
VALUES (
  'ops_health_worker_url',
  'https://dev.utahpros.app/api/ops-health'
)
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Scheduler wake ───
CREATE OR REPLACE FUNCTION public.wake_ops_health_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_worker_url text;
  v_secret text;
BEGIN
  SELECT value
  INTO v_worker_url
  FROM public.integration_config
  WHERE key = 'ops_health_worker_url';

  SELECT value
  INTO v_secret
  FROM public.integration_config
  WHERE key = 'cron_worker_secret';

  IF v_worker_url IS NULL OR v_worker_url NOT IN (
    'https://dev.utahpros.app/api/ops-health',
    'https://utahpros.app/api/ops-health'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
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

REVOKE ALL ON FUNCTION public.wake_ops_health_worker()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule(
  'upr_ops_health',
  '*/15 * * * *',
  $$SELECT public.wake_ops_health_worker();$$
);
