-- ════════════════════════════════════════════════
-- MIGRATION: 20260724180100_qbo_payments_sync_cron
-- Phase: QBO Payments — two-way sync activation (safety-net poller)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Turns on the hourly "did we miss any QuickBooks payments?" poller. The
--   /api/qbo-payments-sync worker already exists and reconciles recent QuickBooks
--   payments into UPR; Cloudflare Pages has no cron UI, so — exactly like the
--   message-notification-outbox and process-scheduled workers — this schedules a
--   Supabase pg_cron job that calls the worker once an hour over pg_net, carrying
--   the existing server-only secret. It is the safety net behind the real-time
--   qbo-webhook (which needs QBO_WEBHOOK_VERIFIER_TOKEN + an Intuit subscription).
--
-- ADDITIVE-ONLY:
--   One config row (a worker URL — NOT a secret), one SECURITY DEFINER function
--   (revoked from every browser/role), and one pg_cron job. No table/column/policy
--   change, no data change. Idempotent (cron.schedule upserts by name).
--
-- SAFETY:
--   - The function only ever calls an exact-match allowlisted UPR worker URL
--     (prevents integration_config from becoming an SSRF lever).
--   - The secret comes from integration_config.qbo_webhook_secret — the same value
--     already set in Cloudflare as QBO_WEBHOOK_SECRET (that's how the customer-sync
--     trigger authenticates today). Missing URL or missing secret = silent no-op.
--   - The poller is idempotent (dedups on qbo_payment_id), so an extra fire is a
--     harmless no-op — it never double-counts a payment.
--
-- APPLY NOTE (shared prod — database-standard.md §0/§5):
--   Applying this schedules live hourly production traffic, so it runs ONLY in an
--   owner-authorized apply window. The /api/qbo-payments-sync worker must already
--   be deployed (it is, on dev + main). QBO_WEBHOOK_SECRET must be set in Cloudflare
--   (it already is — customer sync uses it).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   SELECT cron.unschedule('upr_qbo_payments_sync_hourly');
--   DROP FUNCTION IF EXISTS public.qbo_payments_sync_poll();
--   DELETE FROM public.integration_config WHERE key = 'qbo_payments_sync_worker_url';
-- ════════════════════════════════════════════════

-- pg_cron + pg_net are already enabled on this project (20260626_pr3_enable_pg_cron.sql,
-- 20260618_quickbooks_customer_sync.sql); we rely on cron.schedule + net.http_post below.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Non-secret worker URL (default: production). The function hard-allowlists both
-- the dev and prod URLs below, so changing this row cannot redirect the call.
INSERT INTO public.integration_config (key, value)
VALUES ('qbo_payments_sync_worker_url', 'https://utahpros.app/api/qbo-payments-sync')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.qbo_payments_sync_poll()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_worker_url text;
  v_secret     text;
BEGIN
  SELECT value INTO v_worker_url FROM public.integration_config WHERE key = 'qbo_payments_sync_worker_url';
  SELECT value INTO v_secret     FROM public.integration_config WHERE key = 'qbo_webhook_secret';

  -- Fail closed: only call an exact-match UPR worker URL, only with a real secret.
  IF v_worker_url IS NULL OR v_worker_url NOT IN (
    'https://dev.utahpros.app/api/qbo-payments-sync',
    'https://utahpros.app/api/qbo-payments-sync'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-webhook-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
END;
$function$;

-- Server-only: no browser/role may execute it (it's a pg_cron internal).
REVOKE ALL ON FUNCTION public.qbo_payments_sync_poll() FROM PUBLIC, anon, authenticated, service_role;

-- Hourly at :17 (off the :00 stampede). cron.schedule upserts by name → idempotent.
SELECT cron.schedule('upr_qbo_payments_sync_hourly', '17 * * * *', $$ SELECT public.qbo_payments_sync_poll(); $$);
