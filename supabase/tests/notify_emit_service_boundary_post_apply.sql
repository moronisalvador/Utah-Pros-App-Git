-- READ-ONLY POST-APPLY CHECK — 20260726110000_notify_emit_service_boundary.sql
--
-- Run only after the exact reviewed migration is applied in an owner-authorized shared-production
-- window. This checks catalog, trigger, and schedule metadata only. It never invokes notify_emit,
-- pg_net, a trigger, a provider, or a schedule and reads no notification, customer, configuration,
-- secret, payload, response, or provider contents.

DO $notify_emit_post_apply$
DECLARE
  v_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_overload_count integer;
  v_execute_grantees text[];
  v_grantable_count integer;
  v_unexpected_caller_count integer;
  v_matching_caller_count integer;
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

  IF v_oid IS NULL OR v_overload_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'notify_emit post-apply failed: exact target missing or overload count=%',
      v_overload_count;
  END IF;

  SELECT
    array_agg(COALESCE(grantee_role.rolname, 'PUBLIC') ORDER BY
      COALESCE(grantee_role.rolname, 'PUBLIC')),
    count(*) FILTER (WHERE acl.is_grantable)
    INTO v_execute_grantees, v_grantable_count
  FROM pg_proc p
  CROSS JOIN LATERAL
    aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE p.oid = v_oid
    AND acl.privilege_type = 'EXECUTE';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
    JOIN pg_roles owner_role ON owner_role.oid = p.proowner
    WHERE p.oid = v_oid
      AND l.lanname = 'plpgsql'
      AND owner_role.rolname = 'postgres'
      AND pg_get_function_result(p.oid) = 'void'
      AND p.prosecdef
      AND NOT p.proisstrict
      AND NOT p.proleakproof
      AND p.provolatile = 'v'
      AND p.proparallel = 'u'
      AND p.prokind = 'f'
      AND p.proconfig = ARRAY['search_path=public']::text[]
      AND md5(p.prosrc) = '27d638e9e2681bf74f17fa255c7eaf04'
  ) THEN
    RAISE EXCEPTION 'notify_emit post-apply failed: target metadata/body drifted';
  END IF;

  IF v_execute_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL
         aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'notify_emit post-apply failed: execute_grantees=%, grantable=%, anon=%, authenticated=%, service_role=%',
      v_execute_grantees,
      v_grantable_count,
      has_function_privilege('anon', v_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_oid, 'EXECUTE');
  END IF;

  WITH expected(identity, body_md5, runtime_config) AS (
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
  )
  SELECT count(*)
    INTO v_matching_caller_count
  FROM expected
  JOIN pg_proc p ON p.oid = to_regprocedure(expected.identity)
  JOIN pg_roles owner_role ON owner_role.oid = p.proowner
  WHERE owner_role.rolname = 'postgres'
    AND p.prosecdef
    AND p.proconfig = expected.runtime_config
    AND md5(p.prosrc) = expected.body_md5;

  SELECT count(*)
    INTO v_unexpected_caller_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~ E'\\mnotify_emit[[:space:]]*\\('
    AND p.oid NOT IN (
      to_regprocedure('public.review_time_entry_change_request(uuid,boolean,uuid,text)'),
      to_regprocedure('public.scan_abandoned_clocks(timestamptz,integer)'),
      to_regprocedure('public.submit_time_entry_change_request(uuid,jsonb,text,uuid)'),
      to_regprocedure('public.trg_appt_crew_notify()'),
      to_regprocedure('public.trg_appt_notify()'),
      to_regprocedure('public.trg_estimate_accepted_notify()')
    );

  IF v_matching_caller_count IS DISTINCT FROM 6
     OR v_unexpected_caller_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'notify_emit post-apply failed: matching_callers=%, unexpected_callers=%',
      v_matching_caller_count,
      v_unexpected_caller_count;
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
    AND relation.relname = expected.relation_name;

  IF v_trigger_count IS DISTINCT FROM 3 OR v_matching_trigger_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION
      'notify_emit post-apply failed: trigger_count=%, matching_triggers=%',
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
      'notify_emit post-apply failed: abandoned-clock cron matching_jobs=%',
      v_cron_count;
  END IF;
END;
$notify_emit_post_apply$;
