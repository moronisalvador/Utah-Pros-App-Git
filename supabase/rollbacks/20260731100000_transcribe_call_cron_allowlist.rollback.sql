-- ═══════════════════════════════════════════════════════════════════════════════
-- EMERGENCY ROLLBACK: 20260731100000_transcribe_call_cron_allowlist
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Re-points the two transcribe-call safety-net cron jobs back onto the exact
-- original inlined commands from 20260722_crm_calls_classification_cron.sql
-- (same job names, schedules, payloads, headers, and 60s timeout), then drops
-- the two wake functions the forward migration added.
--
-- WARNING: this rollback REOPENS the config-driven arbitrary-URL surface —
-- after running it, a rewritten integration_config row can again point either
-- cron command at any host, carrying the shared cron secret header with it.
-- If the problem is that a legitimate worker URL changed, prefer a reviewed
-- forward migration that updates the allowlist entries instead.
--
-- No table, row, policy, secret, or other cron job is changed by either
-- direction. The integration_config rows are untouched throughout.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Refuse to run unless the forward migration's state is actually present.
DO $transcribe_allowlist_rollback_preflight$
DECLARE
  v_fn record;
  v_oid oid;
  v_job record;
BEGIN
  FOR v_fn IN
    SELECT *
    FROM (
      VALUES
        ('public.wake_transcribe_call_backfill()'),
        ('public.wake_transcribe_call_reclassify()')
    ) AS f(identity)
  LOOP
    v_oid := to_regprocedure(v_fn.identity);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        'transcribe-call allowlist rollback preflight: missing % (forward migration not applied?)',
        v_fn.identity;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc function_record
      WHERE function_record.oid = v_oid
        AND function_record.prosecdef
        AND function_record.proconfig = ARRAY['search_path=public']::text[]
        AND function_record.prosrc LIKE '%NOT IN (%'
        AND function_record.prosrc LIKE '%https://utahpros.app/api/transcribe-call%'
    ) THEN
      RAISE EXCEPTION
        'transcribe-call allowlist rollback preflight: contract drift for %', v_fn.identity;
    END IF;
  END LOOP;

  FOR v_job IN
    SELECT *
    FROM (
      VALUES
        ('upr_calls_backfill_safety_net', 'wake_transcribe_call_backfill'),
        ('upr_calls_reclassify_safety_net', 'wake_transcribe_call_reclassify')
    ) AS j(jobname, expected_function)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = v_job.jobname
        AND command LIKE '%' || v_job.expected_function || '()%'
    ) THEN
      RAISE EXCEPTION
        'transcribe-call allowlist rollback preflight: cron job % does not point at %()',
        v_job.jobname, v_job.expected_function;
    END IF;
  END LOOP;
END;
$transcribe_allowlist_rollback_preflight$;

-- ─── 1. Restore the exact original inlined cron commands ───
-- Byte-for-byte from 20260722_crm_calls_classification_cron.sql.
-- cron.schedule upserts by job name, replacing the wake-function commands.
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

-- ─── 2. Drop the wake functions the forward migration added ───
-- Safe only AFTER the commands above stop referencing them (same transaction).
DROP FUNCTION IF EXISTS public.wake_transcribe_call_backfill();
DROP FUNCTION IF EXISTS public.wake_transcribe_call_reclassify();

-- Postcondition: the pre-migration state is fully restored.
DO $transcribe_allowlist_rollback_postcondition$
DECLARE
  v_job record;
BEGIN
  IF to_regprocedure('public.wake_transcribe_call_backfill()') IS NOT NULL
     OR to_regprocedure('public.wake_transcribe_call_reclassify()') IS NOT NULL THEN
    RAISE EXCEPTION
      'transcribe-call allowlist rollback postcondition: a wake function still exists';
  END IF;

  FOR v_job IN
    SELECT *
    FROM (
      VALUES
        ('upr_calls_backfill_safety_net', '20 */6 * * *', '%''backfill'', true, ''days'', 3%'),
        ('upr_calls_reclassify_safety_net', '40 */6 * * *', '%''reclassify'', true%')
    ) AS j(jobname, expected_schedule, payload_pattern)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = v_job.jobname
        AND schedule = v_job.expected_schedule
        AND active
        AND command LIKE '%net.http_post%'
        AND command LIKE '%transcribe_call_worker_url%'
        AND command LIKE v_job.payload_pattern
        AND command NOT LIKE '%wake_transcribe_call%'
    ) THEN
      RAISE EXCEPTION
        'transcribe-call allowlist rollback postcondition: cron job % not restored to the original inlined command',
        v_job.jobname;
    END IF;
  END LOOP;
END;
$transcribe_allowlist_rollback_postcondition$;

COMMIT;
