-- ════════════════════════════════════════════════
-- POST-APPLY CHECK: 20260731100000_transcribe_call_cron_allowlist
-- ════════════════════════════════════════════════
--
-- Read-only, catalog-only verification for the apply window (staging branch
-- first, then production). Independent of the migration's own postcondition:
-- run it in a separate session after the apply commits. It raises on any
-- failure and changes nothing.
--
-- Checks, per wake function:
--   1. exactly one overload exists;
--   2. SECURITY DEFINER with search_path pinned to public;
--   3. the body names both allowlisted UPR URLs and the fail-closed secret gate;
--   4. anon/authenticated/service_role EXECUTE all false (cron runs as the
--      postgres job owner — ownership implies EXECUTE, no grant needed).
-- Checks, per cron job:
--   5. exactly one active job with the preserved schedule;
--   6. the command calls the wake function and no longer inlines the
--      config-driven net.http_post.
-- ════════════════════════════════════════════════

DO $post_apply$
DECLARE
  v_expected record;
  v_oid oid;
  v_overloads integer;
  v_job record;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.wake_transcribe_call_backfill()',
          'wake_transcribe_call_backfill'
        ),
        (
          'public.wake_transcribe_call_reclassify()',
          'wake_transcribe_call_reclassify'
        )
    ) AS expected(identity, function_name)
  LOOP
    SELECT count(*)
    INTO v_overloads
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = v_expected.function_name;
    IF v_overloads IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'post-apply: % overloads of %', v_overloads, v_expected.function_name;
    END IF;

    v_oid := to_regprocedure(v_expected.identity);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'post-apply: missing %', v_expected.identity;
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
    ) THEN
      RAISE EXCEPTION
        'post-apply: % is not the reviewed gated definer body', v_expected.identity;
    END IF;

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'post-apply: privilege drift for % (anon=%, authenticated=%, service_role=%)',
        v_expected.identity,
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
        'post-apply: expected exactly 1 cron job named %', v_job.jobname;
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
        'post-apply: cron job % not on the gated function (schedule or command drift)',
        v_job.jobname;
    END IF;
  END LOOP;

  RAISE NOTICE 'transcribe-call cron allowlist post-apply: PASS';
END;
$post_apply$;
