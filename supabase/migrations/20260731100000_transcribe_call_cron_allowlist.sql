-- ════════════════════════════════════════════════
-- MIGRATION: 20260731100000_transcribe_call_cron_allowlist
-- Phase: n/a (standalone hardening — closes the DEFERRED item recorded in
--        20260730214500_pg_net_worker_url_allowlists.sql)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Two scheduled database jobs call our transcribe-call web worker every six
--   hours to catch phone calls that were never transcribed or classified.
--   Until now each job's command read the worker's address out of the
--   integration_config settings table and called WHATEVER address that row
--   contained — a rewritten row would redirect the call (and the shared cron
--   secret header) to any host on the internet. This moves each job's command
--   into a database function that refuses to call anything except the two
--   real UPR addresses, and skips the call when the shared secret is missing
--   — the exact same guard every other config-driven worker caller already
--   carries (wake_ops_health_worker et al.).
--
-- ADDITIVE-ONLY / function + cron-command repoint:
--   Two NEW SECURITY DEFINER functions + re-pointing the two EXISTING pg_cron
--   jobs' command strings onto them. No table/column/policy/data change; job
--   names, schedules ('20 */6 * * *', '40 */6 * * *'), payloads
--   ({"backfill":true,"days":3} / {"reclassify":true}) and the 60s timeout
--   are unchanged. cron.schedule upserts by job name; the guarded unschedule
--   is belt-and-braces so the file also applies cleanly on a database where a
--   job is missing (e.g. a fresh branch).
--
-- BEHAVIOR DELTA (the only one):
--   A transcribe_call_worker_url outside the two-entry allowlist, or a
--   missing/blank cron_worker_secret, now results in a silent no-op instead
--   of an outbound pg_net POST. The secret gate is behavior-preserving:
--   functions/api/transcribe-call.js authorizes cron calls via
--   checkCronSecret (functions/lib/auth.js), which returns false for a
--   missing x-webhook-secret — those calls never succeeded.
--
-- APPLY-WINDOW ADVISORY:
--   Run the registry ops check first (read-only;
--   docs/database/integration-config-worker-urls.md): if
--   transcribe_call_worker_url was ever hand-repointed off the two UPR
--   origins, the safety nets fail closed (silently stop posting) until the
--   row is corrected. Expected live value:
--   'https://utahpros.app/api/transcribe-call' (seeded by
--   20260722_crm_calls_classification_cron.sql, upsert). No code-deploy
--   sequencing — the worker is unchanged; apply in any window. The cron
--   catalog swap is transactional, so no run is lost mid-apply.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260731100000_transcribe_call_cron_allowlist.rollback.sql
--   re-points both jobs back onto the exact original inlined commands from
--   20260722_crm_calls_classification_cron.sql, then drops the two wake
--   functions. Rolling back REOPENS the config-driven arbitrary-URL surface —
--   prefer a reviewed forward migration that edits the allowlist entries if a
--   legitimate worker URL ever changes.
-- ════════════════════════════════════════════════

-- ─── 1. Backfill safety net → wake-style function ───
-- Same payload, headers, and timeout the inlined cron command carried, plus
-- the exact two-URL allowlist + fail-closed secret gate copied from
-- wake_ops_health_worker (20260725190000).
CREATE OR REPLACE FUNCTION public.wake_transcribe_call_backfill()
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
  WHERE key = 'transcribe_call_worker_url';

  SELECT value
  INTO v_secret
  FROM public.integration_config
  WHERE key = 'cron_worker_secret';

  -- Exact UPR worker-URL allowlist: a rewritten integration_config row must
  -- never turn this SECURITY DEFINER pg_net caller into an SSRF vector (or
  -- leak the shared cron secret header to a third-party host). A blank
  -- secret is refused here because checkCronSecret 401s it anyway.
  IF v_worker_url IS NULL OR v_worker_url NOT IN (
    'https://dev.utahpros.app/api/transcribe-call',
    'https://utahpros.app/api/transcribe-call'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object('backfill', true, 'days', 3),
    timeout_milliseconds := 60000
  );

  RETURN;
END;
$function$;

-- Managed-Supabase function trap (database-standard.md §1): every function
-- DDL re-grants EXECUTE TO PUBLIC at ddl_command_end, so revoke explicitly.
-- pg_cron runs the job command as the job owner (postgres), which owns this
-- function — ownership implies EXECUTE, so NO role needs a grant. Zero-grant
-- posture matches wake_ops_health_worker / qbo_payments_sync_poll.
REVOKE ALL ON FUNCTION public.wake_transcribe_call_backfill()
  FROM PUBLIC, anon, authenticated, service_role;

-- ─── 2. Reclassify safety net → wake-style function ───
CREATE OR REPLACE FUNCTION public.wake_transcribe_call_reclassify()
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
  WHERE key = 'transcribe_call_worker_url';

  SELECT value
  INTO v_secret
  FROM public.integration_config
  WHERE key = 'cron_worker_secret';

  -- Exact UPR worker-URL allowlist — same gate and rationale as the backfill
  -- function above.
  IF v_worker_url IS NULL OR v_worker_url NOT IN (
    'https://dev.utahpros.app/api/transcribe-call',
    'https://utahpros.app/api/transcribe-call'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object('reclassify', true),
    timeout_milliseconds := 60000
  );

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.wake_transcribe_call_reclassify()
  FROM PUBLIC, anon, authenticated, service_role;

-- ─── 3. Re-point the two cron jobs onto the gated functions ───
-- cron.schedule upserts by job name, so the guarded unschedule is
-- belt-and-braces; it keeps the file clean-applying where a job is absent.
DO $transcribe_cron_repoint$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upr_calls_backfill_safety_net') THEN
    PERFORM cron.unschedule('upr_calls_backfill_safety_net');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upr_calls_reclassify_safety_net') THEN
    PERFORM cron.unschedule('upr_calls_reclassify_safety_net');
  END IF;
END;
$transcribe_cron_repoint$;

SELECT cron.schedule(
  'upr_calls_backfill_safety_net',
  '20 */6 * * *',
  $$SELECT public.wake_transcribe_call_backfill();$$
);

SELECT cron.schedule(
  'upr_calls_reclassify_safety_net',
  '40 */6 * * *',
  $$SELECT public.wake_transcribe_call_reclassify();$$
);

-- ─── 4. Postcondition ───
-- The functions landed gated and unreachable by browser/service roles, and
-- both cron commands now call them — no inlined config-driven post remains.
DO $transcribe_allowlist_postcondition$
DECLARE
  v_fn record;
  v_oid oid;
  v_job record;
BEGIN
  FOR v_fn IN
    SELECT *
    FROM (
      VALUES
        ('public.wake_transcribe_call_backfill()', 'wake_transcribe_call_backfill'),
        ('public.wake_transcribe_call_reclassify()', 'wake_transcribe_call_reclassify')
    ) AS f(identity, function_name)
  LOOP
    v_oid := to_regprocedure(v_fn.identity);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        'transcribe-call allowlist postcondition: missing %', v_fn.identity;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc function_record
      WHERE function_record.oid = v_oid
        AND function_record.prosecdef
        AND function_record.proconfig = ARRAY['search_path=public']::text[]
        AND function_record.prosrc LIKE '%NOT IN (%'
        AND function_record.prosrc LIKE '%https://dev.utahpros.app/api/transcribe-call%'
        AND function_record.prosrc LIKE '%https://utahpros.app/api/transcribe-call%'
        AND function_record.prosrc LIKE '%NULLIF(btrim(v_secret), '''') IS NULL%'
    )
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'transcribe-call allowlist postcondition failed for % (anon=%, authenticated=%, service_role=%)',
        v_fn.identity,
        has_function_privilege('anon', v_oid, 'EXECUTE'),
        has_function_privilege('authenticated', v_oid, 'EXECUTE'),
        has_function_privilege('service_role', v_oid, 'EXECUTE');
    END IF;
  END LOOP;

  FOR v_job IN
    SELECT *
    FROM (
      VALUES
        ('upr_calls_backfill_safety_net', '20 */6 * * *', 'wake_transcribe_call_backfill'),
        ('upr_calls_reclassify_safety_net', '40 */6 * * *', 'wake_transcribe_call_reclassify')
    ) AS j(jobname, expected_schedule, expected_function)
  LOOP
    IF (SELECT count(*) FROM cron.job WHERE jobname = v_job.jobname)
         IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'transcribe-call allowlist postcondition: expected exactly 1 cron job named %',
        v_job.jobname;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = v_job.jobname
        AND schedule = v_job.expected_schedule
        AND active
        AND command LIKE '%' || v_job.expected_function || '()%'
        AND command NOT LIKE '%integration_config%'
        AND command NOT LIKE '%net.http_post%'
    ) THEN
      RAISE EXCEPTION
        'transcribe-call allowlist postcondition: cron job % not repointed (schedule or command drift)',
        v_job.jobname;
    END IF;
  END LOOP;
END;
$transcribe_allowlist_postcondition$;
