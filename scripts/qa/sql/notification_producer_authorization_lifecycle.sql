/*
 * ════════════════════════════════════════════════
 * FILE: notification_producer_authorization_lifecycle.sql
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the exact PR #573 forward migration composition on a disposable
 *   local database: source order, private evidence tables, service-only
 *   execution, disabled producers, reminder containment, and rollback marker.
 *
 * DEPENDS ON:
 *   Packages:  PostgreSQL, pgTAP
 *   Internal:  20260801215912_notification_producer_authorization.sql,
 *              20260802040935_preserve_notify_emit_event_id.sql
 *   Data:      reads  → disposable local catalogs only
 *              writes → none outside this rolled-back proof transaction
 *
 * NOTES / GOTCHAS:
 *   - The governed wrapper supplies upr.isolated_test_database=on.
 *   - This proof refuses every non-isolated target before reading state.
 * ════════════════════════════════════════════════
 */

\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

BEGIN;

DO $forward_lifecycle$
DECLARE
  v_notify_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_signature text;
  v_function_oid oid;
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;

  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations migration_record
    WHERE (migration_record.version, migration_record.name) IN (
      ('20260730214500', 'pg_net_worker_url_allowlists'),
      ('20260731223000', 'notification_unsafe_producer_containment'),
      ('20260801215912', 'notification_producer_authorization'),
      ('20260802040935', 'preserve_notify_emit_event_id')
    )
  ) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'forward lifecycle migration ledger drift';
  END IF;

  IF v_notify_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid = v_notify_oid
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) = 'ea3a9b3b6cca96722c008d7e9b23f6bc'
      AND obj_description(function_record.oid, 'pg_proc') =
        'upr:20260802040935:predecessor=guarded'
  ) THEN
    RAISE EXCEPTION 'forward lifecycle notify_emit contract drift';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_proc function_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           function_record.proacl,
           acldefault('f', function_record.proowner)
         )
       ) acl_record
       WHERE function_record.oid = v_notify_oid
         AND acl_record.grantee = 0
         AND acl_record.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_notify_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_notify_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_notify_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'forward lifecycle notify_emit grant drift';
  END IF;

  IF to_regclass('public.notification_producer_occurrences') IS NULL
     OR to_regclass('public.notification_delivery_claims') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'appointments'
         AND column_record.column_name = 'created_by_employee_id'
     ) THEN
    RAISE EXCEPTION 'forward lifecycle candidate objects missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_class relation_record
    WHERE relation_record.oid IN (
      'public.notification_producer_occurrences'::regclass,
      'public.notification_delivery_claims'::regclass
    )
      AND relation_record.relrowsecurity
      AND relation_record.relforcerowsecurity
  ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'forward lifecycle private table RLS drift';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_class relation_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           relation_record.relacl,
           acldefault('r', relation_record.relowner)
         )
       ) acl_record
       WHERE relation_record.oid IN (
         'public.notification_producer_occurrences'::regclass,
         'public.notification_delivery_claims'::regclass
       )
         AND acl_record.grantee IN (
           0,
           (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
           (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
         )
     )
     OR (
       SELECT array_agg(
         DISTINCT acl_record.privilege_type::text
         ORDER BY acl_record.privilege_type::text
       )
       FROM pg_class relation_record
       CROSS JOIN LATERAL aclexplode(relation_record.relacl) acl_record
       WHERE relation_record.oid =
         'public.notification_producer_occurrences'::regclass
         AND acl_record.grantee = (
           SELECT oid FROM pg_roles WHERE rolname = 'service_role'
         )
     ) IS DISTINCT FROM ARRAY['SELECT']::text[]
     OR (
       SELECT array_agg(
         DISTINCT acl_record.privilege_type::text
         ORDER BY acl_record.privilege_type::text
       )
       FROM pg_class relation_record
       CROSS JOIN LATERAL aclexplode(relation_record.relacl) acl_record
       WHERE relation_record.oid =
         'public.notification_delivery_claims'::regclass
         AND acl_record.grantee = (
           SELECT oid FROM pg_roles WHERE rolname = 'service_role'
         )
     ) IS DISTINCT FROM ARRAY['DELETE', 'INSERT', 'SELECT']::text[] THEN
    RAISE EXCEPTION 'forward lifecycle private table grant drift';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
    'public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)',
    'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
    'public.release_notification_delivery_claim(uuid)'
  ]::text[]
  LOOP
    v_function_oid := to_regprocedure(v_signature);
    IF v_function_oid IS NULL
       OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'forward lifecycle service function drift (%)', v_signature;
    END IF;
  END LOOP;

  v_function_oid := to_regprocedure(
    'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'
  );
  IF v_function_oid IS NULL
     OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'forward lifecycle internal producer function grant drift';
  END IF;

  IF (
    SELECT count(*)
    FROM public.notification_types catalog
    WHERE catalog.type_key IN (
      'appointment.assigned',
      'appointment.updated',
      'appointment.canceled',
      'timesheet.change_requested',
      'timesheet.change_reviewed',
      'appointment.reminder'
    )
      AND catalog.enabled IS FALSE
  ) IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'forward lifecycle disabled catalog drift';
  END IF;

  IF to_regclass('cron.job') IS NULL OR EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'upr_appointment_reminders'
  ) THEN
    RAISE EXCEPTION 'forward lifecycle reminder cron drift';
  END IF;
END;
$forward_lifecycle$;

SELECT plan(1);
SELECT pass('PR #573 forward lifecycle contracts passed');
SELECT * FROM finish();

ROLLBACK;
