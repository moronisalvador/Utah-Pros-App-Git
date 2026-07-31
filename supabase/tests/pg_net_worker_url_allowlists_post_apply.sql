-- ════════════════════════════════════════════════
-- POST-APPLY CHECK: 20260730214500_pg_net_worker_url_allowlists
-- ════════════════════════════════════════════════
--
-- Read-only, catalog-only verification for the apply window (staging branch
-- first, then production). Independent of the migration's own postflight:
-- run it in a separate session after the apply commits. It raises on any
-- failure and changes nothing.
--
-- Checks, per function:
--   1. exactly one overload exists;
--   2. owner postgres, SECURITY DEFINER, search_path pinned to public;
--   3. the live body is byte-exact to the reviewed allowlisted body (md5);
--   4. the body names both allowlisted UPR URLs and the fail-closed secret gate;
--   5. anon/authenticated EXECUTE false; service_role true.
-- ════════════════════════════════════════════════

DO $post_apply$
DECLARE
  v_expected record;
  v_oid oid;
  v_overloads integer;
  v_src text;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.notify_google_calendar_sync(uuid,text,jsonb)',
          'notify_google_calendar_sync',
          '07ee1574e28447ddae2c868a841eb2d8',
          'https://utahpros.app/api/google-calendar-sync',
          'https://dev.utahpros.app/api/google-calendar-sync',
          false
        ),
        (
          'public.notify_emit(text,jsonb)',
          'notify_emit',
          'c72e0f7fd40a4abec42cce1cd912a45b',
          'https://utahpros.app/api/notify',
          'https://dev.utahpros.app/api/notify',
          false
        )
    ) AS expected(
      identity, function_name, body_md5, prod_url, dev_url, authenticated_execute
    )
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

    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc function_record
      WHERE function_record.oid = v_oid
        AND pg_get_userbyid(function_record.proowner) = 'postgres'
        AND function_record.prosecdef
        AND function_record.proconfig = ARRAY['search_path=public']::text[]
        AND md5(function_record.prosrc) = v_expected.body_md5
    ) THEN
      RAISE EXCEPTION
        'post-apply: contract mismatch for % (live body md5 %)',
        v_expected.identity, md5(v_src);
    END IF;

    IF position(v_expected.prod_url IN v_src) = 0
       OR position(v_expected.dev_url IN v_src) = 0
       OR position('NOT IN (' IN v_src) = 0
       OR position($marker$NULLIF(btrim(v_secret), '') IS NULL$marker$ IN v_src) = 0 THEN
      RAISE EXCEPTION 'post-apply: allowlist/secret gate not present in %', v_expected.identity;
    END IF;

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            IS DISTINCT FROM v_expected.authenticated_execute
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'post-apply: privilege drift for % (anon=%, authenticated=%, service_role=%)',
        v_expected.identity,
        has_function_privilege('anon', v_oid, 'EXECUTE'),
        has_function_privilege('authenticated', v_oid, 'EXECUTE'),
        has_function_privilege('service_role', v_oid, 'EXECUTE');
    END IF;
  END LOOP;

  RAISE NOTICE 'pg_net worker-URL allowlists post-apply: all checks passed';
END;
$post_apply$;
