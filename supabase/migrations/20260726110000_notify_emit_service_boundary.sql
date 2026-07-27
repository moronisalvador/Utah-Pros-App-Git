-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260726110000_notify_emit_service_boundary
-- Mobile Production Readiness S1d — notification dispatcher RPC containment
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT:
--   Remove direct browser execution of public.notify_emit(text,jsonb) and keep only the
--   service_role grant. Preserve its database-trigger/cron call chain and HTTP transport contract.
--   Make the trusted p_type_key win when an object body also contains a top-level type_key.
--
-- WHY:
--   The live SECURITY DEFINER function is executable by authenticated. A browser can therefore
--   make the database load the stored notification Worker URL/secret and submit caller-controlled
--   JSON. The original left-to-right jsonb merge also lets p_body replace the trusted type key.
--
-- VERIFIED LIVE CONTRACT (read-only capture 2026-07-26 16:52:53 UTC):
--   Signature:       public.notify_emit(p_type_key text, p_body jsonb) RETURNS void
--   Owner/security:  postgres; SECURITY DEFINER; search_path=public
--   ACL:             postgres, authenticated, service_role (PUBLIC and anon denied)
--   Body md5:        5935917b313c772a964b7c02e67c8dd4
--   Definition md5:  da6b30d100720605990491d4028560f0
--   Direct callers:  three trigger functions, two timesheet RPCs, abandoned-clock scan/cron;
--                    six functions and seven notify_emit call sites, all owner postgres and
--                    SECURITY DEFINER. Every body argument is jsonb_build_object(...).
--
-- COMPATIBILITY:
--   Signature, return, owner, security mode, search_path, catalog/URL gates, configuration key
--   names, URL, stored secret, headers, net.http_post call and ignored response are unchanged.
--   No trigger, caller, schedule, table, row, policy, setting or secret value is changed.
--
-- APPLY:
--   Shared-production migration. Apply only from a reviewed commit in a serialized,
--   owner-authorized window after running the companion read-only preflight. Run the companion
--   read-only post-apply catalog check before any separately authorized synthetic canary.
--
-- ROLLBACK:
--   supabase/rollbacks/20260726110000_notify_emit_service_boundary.rollback.sql restores the exact
--   prior body and authenticated grant. It deliberately re-opens the confused-deputy browser path
--   and is emergency-only.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ATOMICITY:
--   The Supabase migration executor owns the transaction that includes both this
--   SQL and its schema_migrations ledger row. Do not add transaction-control
--   statements here.

-- Fail closed if the reviewed target, ACL, direct caller, trigger, or cron contract drifts before
-- the owner-authorized apply window. This reads catalog metadata only.
DO $notify_emit_preflight$
DECLARE
  v_target_oid oid;
  v_overload_count integer;
  v_language name;
  v_owner name;
  v_result text;
  v_security_definer boolean;
  v_runtime_config text[];
  v_strict boolean;
  v_leakproof boolean;
  v_volatility "char";
  v_parallel "char";
  v_kind "char";
  v_body_md5 text;
  v_definition_md5 text;
  v_execute_grantees text[];
  v_grantable_count integer;
  v_caller_oid oid;
  v_caller_owner name;
  v_caller_security_definer boolean;
  v_caller_runtime_config text[];
  v_caller_body_md5 text;
  v_caller_count integer;
  v_call_site_count integer;
  v_expected record;
  v_trigger_count integer;
  v_matching_trigger_count integer;
  v_cron_count integer;
BEGIN
  SELECT count(*)
    INTO v_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'notify_emit';

  IF v_overload_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'notify_emit boundary preflight expected one overload; found %',
      v_overload_count;
  END IF;

  v_target_oid := to_regprocedure('public.notify_emit(text,jsonb)');
  IF v_target_oid IS NULL THEN
    RAISE EXCEPTION
      'notify_emit boundary preflight expected public.notify_emit(text,jsonb)';
  END IF;

  SELECT
    l.lanname,
    owner_role.rolname,
    pg_get_function_result(p.oid),
    p.prosecdef,
    p.proconfig,
    p.proisstrict,
    p.proleakproof,
    p.provolatile,
    p.proparallel,
    p.prokind,
    md5(p.prosrc),
    md5(pg_get_functiondef(p.oid))
    INTO
      v_language,
      v_owner,
      v_result,
      v_security_definer,
      v_runtime_config,
      v_strict,
      v_leakproof,
      v_volatility,
      v_parallel,
      v_kind,
      v_body_md5,
      v_definition_md5
  FROM pg_proc p
  JOIN pg_language l ON l.oid = p.prolang
  JOIN pg_roles owner_role ON owner_role.oid = p.proowner
  WHERE p.oid = v_target_oid;

  SELECT
    array_agg(COALESCE(grantee_role.rolname, 'PUBLIC') ORDER BY
      COALESCE(grantee_role.rolname, 'PUBLIC')),
    count(*) FILTER (WHERE acl.is_grantable)
    INTO v_execute_grantees, v_grantable_count
  FROM pg_proc p
  CROSS JOIN LATERAL
    aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE p.oid = v_target_oid
    AND acl.privilege_type = 'EXECUTE';

  IF v_language IS DISTINCT FROM 'plpgsql'
     OR v_owner IS DISTINCT FROM 'postgres'
     OR v_result IS DISTINCT FROM 'void'
     OR v_security_definer IS DISTINCT FROM true
     OR v_runtime_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR v_strict IS DISTINCT FROM false
     OR v_leakproof IS DISTINCT FROM false
     OR v_volatility IS DISTINCT FROM 'v'::"char"
     OR v_parallel IS DISTINCT FROM 'u'::"char"
     OR v_kind IS DISTINCT FROM 'f'::"char"
     OR v_body_md5 IS DISTINCT FROM '5935917b313c772a964b7c02e67c8dd4'
     OR v_definition_md5 IS DISTINCT FROM 'da6b30d100720605990491d4028560f0'
     OR v_execute_grantees IS DISTINCT FROM
       ARRAY['authenticated', 'postgres', 'service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR has_function_privilege('anon', v_target_oid, 'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated', v_target_oid, 'EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role', v_target_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'notify_emit boundary target drift: language=%, owner=%, result=%, definer=%, config=%, strict=%, leakproof=%, volatility=%, parallel=%, kind=%, body_md5=%, definition_md5=%, execute_grantees=%, grantable=%, anon=%, authenticated=%, service_role=%',
      v_language,
      v_owner,
      v_result,
      v_security_definer,
      v_runtime_config,
      v_strict,
      v_leakproof,
      v_volatility,
      v_parallel,
      v_kind,
      v_body_md5,
      v_definition_md5,
      v_execute_grantees,
      v_grantable_count,
      has_function_privilege('anon', v_target_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_target_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_target_oid, 'EXECUTE');
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.review_time_entry_change_request(uuid,boolean,uuid,text)',
          'dfc660aa915c4c8ce8e02592a8faa7a3',
          ARRAY['search_path=public, extensions, pg_temp']::text[]
        ),
        (
          'public.scan_abandoned_clocks(timestamptz,integer)',
          '8977dcbb788d85ade975936820a85f38',
          ARRAY['search_path=public']::text[]
        ),
        (
          'public.submit_time_entry_change_request(uuid,jsonb,text,uuid)',
          'e234c89fb88563c0e1c801cef3976852',
          ARRAY['search_path=public, extensions, pg_temp']::text[]
        ),
        (
          'public.trg_appt_crew_notify()',
          '31f6810a3fac42fae029b6d30ea239e0',
          ARRAY['search_path=public']::text[]
        ),
        (
          'public.trg_appt_notify()',
          '0fe47fea140d0a1f108061a14d45c3b5',
          ARRAY['search_path=public']::text[]
        ),
        (
          'public.trg_estimate_accepted_notify()',
          '7061fe1b9f8a212ed44e7e30492fa206',
          ARRAY['search_path=public']::text[]
        )
    ) AS expected(identity, body_md5, runtime_config)
  LOOP
    v_caller_oid := to_regprocedure(v_expected.identity);
    IF v_caller_oid IS NULL THEN
      RAISE EXCEPTION
        'notify_emit boundary caller is missing: %',
        v_expected.identity;
    END IF;

    SELECT owner_role.rolname, p.prosecdef, p.proconfig, md5(p.prosrc)
      INTO
        v_caller_owner,
        v_caller_security_definer,
        v_caller_runtime_config,
        v_caller_body_md5
    FROM pg_proc p
    JOIN pg_roles owner_role ON owner_role.oid = p.proowner
    WHERE p.oid = v_caller_oid;

    IF v_caller_owner IS DISTINCT FROM 'postgres'
       OR v_caller_security_definer IS DISTINCT FROM true
       OR v_caller_runtime_config IS DISTINCT FROM v_expected.runtime_config
       OR v_caller_body_md5 IS DISTINCT FROM v_expected.body_md5 THEN
      RAISE EXCEPTION
        'notify_emit boundary caller drift: identity=%, owner=%, definer=%, config=%, body_md5=%',
        v_expected.identity,
        v_caller_owner,
        v_caller_security_definer,
        v_caller_runtime_config,
        v_caller_body_md5;
    END IF;
  END LOOP;

  SELECT
    count(*),
    COALESCE(sum(regexp_count(
      p.prosrc,
      E'\\mnotify_emit[[:space:]]*\\('
    )), 0)
    INTO v_caller_count, v_call_site_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~ E'\\mnotify_emit[[:space:]]*\\(';

  IF v_caller_count IS DISTINCT FROM 6 OR v_call_site_count IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION
      'notify_emit boundary caller graph drift: functions=%, call_sites=%',
      v_caller_count,
      v_call_site_count;
  END IF;

  SELECT count(*)
    INTO v_trigger_count
  FROM pg_trigger t
  WHERE NOT t.tgisinternal
    AND t.tgfoid IN (
      to_regprocedure('public.trg_appt_crew_notify()'),
      to_regprocedure('public.trg_appt_notify()'),
      to_regprocedure('public.trg_estimate_accepted_notify()')
    );

  SELECT count(*)
    INTO v_matching_trigger_count
  FROM (
    VALUES
      ('trg_appointment_crew_notify', 'appointment_crew', 'public.trg_appt_crew_notify()', 5),
      ('trg_appointment_notify', 'appointments', 'public.trg_appt_notify()', 17),
      (
        'trg_estimate_accepted_notify',
        'estimates',
        'public.trg_estimate_accepted_notify()',
        21
      )
  ) AS expected(trigger_name, relation_name, function_identity, trigger_type)
  JOIN pg_trigger t
    ON t.tgname = expected.trigger_name
   AND t.tgfoid = to_regprocedure(expected.function_identity)
   AND t.tgtype::integer = expected.trigger_type
   AND t.tgenabled = 'O'
   AND NOT t.tgisinternal
  JOIN pg_class relation ON relation.oid = t.tgrelid
  JOIN pg_namespace relation_namespace ON relation_namespace.oid = relation.relnamespace
  WHERE relation_namespace.nspname = 'public'
    AND relation.relname = expected.relation_name
    AND (
      expected.trigger_name <> 'trg_estimate_accepted_notify'
      OR EXISTS (
        SELECT 1
        FROM unnest(t.tgattr::smallint[]) AS trigger_attribute_number(attnum)
        JOIN pg_attribute attribute
          ON attribute.attrelid = t.tgrelid
         AND attribute.attnum = trigger_attribute_number.attnum
        WHERE attribute.attname = 'status'
      )
    );

  IF v_trigger_count IS DISTINCT FROM 3 OR v_matching_trigger_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION
      'notify_emit boundary trigger graph drift: direct=%, matching=%',
      v_trigger_count,
      v_matching_trigger_count;
  END IF;

  SELECT count(*)
    INTO v_cron_count
  FROM cron.job
  WHERE jobname = 'upr_scan_abandoned_clocks'
    AND active
    AND schedule = '*/30 * * * *'
    AND username = 'postgres'
    AND regexp_replace(command, '[[:space:]]+', '', 'g')
      = 'SELECTpublic.scan_abandoned_clocks();';

  IF v_cron_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'notify_emit boundary cron contract drift: matching_jobs=%',
      v_cron_count;
  END IF;
END;
$notify_emit_preflight$;

CREATE OR REPLACE FUNCTION public.notify_emit(p_type_key text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_enabled boolean; v_url text; v_secret text;
BEGIN
  IF p_type_key IS NULL THEN RETURN; END IF;
  SELECT enabled INTO v_enabled FROM public.notification_types WHERE type_key = p_type_key;
  IF v_enabled IS NOT TRUE THEN RETURN; END IF;
  SELECT value INTO v_url    FROM public.integration_config WHERE key = 'notify_worker_url';
  SELECT value INTO v_secret FROM public.integration_config WHERE key = 'notify_webhook_secret';
  IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url,
    body := COALESCE(p_body, '{}'::jsonb) || jsonb_build_object('type_key', p_type_key),
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', COALESCE(v_secret,''))
  );
END; $$;

-- CREATE OR REPLACE retains prior grants, and managed DDL hooks may add defaults. Revoke after the
-- body replacement so the committed end state is explicit and browser-denied.
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb) TO service_role;

DO $notify_emit_postcondition$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_body_md5 text;
  v_execute_grantees text[];
  v_grantable_count integer;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'notify_emit boundary postcondition failed: target is missing';
  END IF;

  SELECT
    md5(p.prosrc),
    array_agg(COALESCE(grantee_role.rolname, 'PUBLIC') ORDER BY
      COALESCE(grantee_role.rolname, 'PUBLIC'))
      FILTER (WHERE acl.privilege_type = 'EXECUTE'),
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.is_grantable
    )
    INTO v_body_md5, v_execute_grantees, v_grantable_count
  FROM pg_proc p
  CROSS JOIN LATERAL
    aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE p.oid = v_oid
  GROUP BY p.prosrc;

  IF v_body_md5 IS DISTINCT FROM '27d638e9e2681bf74f17fa255c7eaf04'
     OR v_execute_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'notify_emit boundary postcondition failed: body_md5=%, execute_grantees=%, grantable=%, anon=%, authenticated=%, service_role=%',
      v_body_md5,
      v_execute_grantees,
      v_grantable_count,
      has_function_privilege('anon', v_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_oid, 'EXECUTE');
  END IF;
END;
$notify_emit_postcondition$;
