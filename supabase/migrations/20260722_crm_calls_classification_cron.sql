-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_calls_classification_cron
-- Phase: n/a (standalone CRM reliability fix — adversarial-challenge follow-up)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Call transcription/classification already happens automatically the
--   moment a CallRail recording lands (callrail-webhook.js calls
--   transcribeLead in the background) — but that path is best-effort and
--   silently gives up on failure (a Deepgram hiccup, a recording that wasn't
--   ready yet, a transient Anthropic error). Until now the ONLY way to catch
--   and retry those misses was a human manually POSTing to
--   /api/transcribe-call from devtools with their own login — verified live
--   2026-07-22: a batch of 20 calls sat never-transcribed for weeks with
--   nobody noticing. This adds a scheduled safety net: Postgres's own job
--   scheduler (pg_cron) calls the transcribe-call worker every 6 hours using
--   the SAME shared cron secret already used by run-automations /
--   process-crm-automations / process-sequences (no new secret), so any call
--   the real-time path missed gets picked up and classified automatically.
--
-- ADDITIVE-ONLY:
--   One new integration_config row (a worker URL; reuses the EXISTING
--   cron_worker_secret) + two new pg_cron jobs. No table/column/policy
--   change. Companion code change in the same PR: functions/api/
--   transcribe-call.js now also accepts the shared cron secret
--   (functions/lib/auth.js's checkCronSecret) alongside the existing human
--   Supabase-session auth — a logged-in employee's manual trigger still
--   works exactly as before.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   SELECT cron.unschedule('upr_calls_backfill_safety_net');
--   SELECT cron.unschedule('upr_calls_reclassify_safety_net');
--   DELETE FROM integration_config WHERE key = 'transcribe_call_worker_url';
-- ════════════════════════════════════════════════

INSERT INTO integration_config (key, value)
VALUES ('transcribe_call_worker_url', 'https://utahpros.app/api/transcribe-call')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Backfill safety net: catches any call from the last 3 days that still has
-- no transcript (the real-time webhook attempt either never fired or
-- failed). No-op (cheap) when the real-time path already succeeded, since
-- the backfill query only selects calls still missing a transcript. Offset
-- 20 minutes past the hour so it doesn't collide with the other :00/:15/:30
-- automation cron jobs.
SELECT cron.schedule(
  'upr_calls_backfill_safety_net',
  '20 */6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM integration_config WHERE key = 'transcribe_call_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-webhook-secret',(SELECT value FROM integration_config WHERE key='cron_worker_secret')),
    body := jsonb_build_object('backfill', true, 'days', 3),
    timeout_milliseconds := 60000);
  $$
);

-- Reclassify safety net: re-runs the AI classification pass on any already-
-- transcribed call still missing a verdict (Claude only — no Deepgram cost,
-- no re-transcription). Runs 20 minutes after the backfill job so anything
-- it just transcribed gets classified in the same cycle.
SELECT cron.schedule(
  'upr_calls_reclassify_safety_net',
  '40 */6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM integration_config WHERE key = 'transcribe_call_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-webhook-secret',(SELECT value FROM integration_config WHERE key='cron_worker_secret')),
    body := jsonb_build_object('reclassify', true),
    timeout_milliseconds := 60000);
  $$
);
