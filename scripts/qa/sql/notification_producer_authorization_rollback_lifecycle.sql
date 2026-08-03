/*
 * ════════════════════════════════════════════════
 * FILE: notification_producer_authorization_rollback_lifecycle.sql
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves reverse rollback of the PR #573 successor and producer migrations
 *   stays fail-closed: occurrence evidence and authorization remain, delivery
 *   functions become inert, flags stay disabled, and notify_emit returns to its
 *   exact service-only allowlisted predecessor.
 *
 * DEPENDS ON:
 *   Packages:  PostgreSQL, pgTAP
 *   Internal:  the two PR #573 rollback files, applied successor first
 *   Data:      reads  → disposable local catalogs only
 *              writes → none outside this rolled-back proof transaction
 *
 * NOTES / GOTCHAS:
 *   - The governed wrapper supplies upr.isolated_test_database=on.
 *   - Retained private evidence is intentional; clean reapply uses a new stack.
 * ════════════════════════════════════════════════
 */

\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

BEGIN;

DO $rollback_lifecycle$
DECLARE
  v_notify_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_signature text;
  v_function_oid oid;
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;

  IF v_notify_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid = v_notify_oid
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) = 'c72e0f7fd40a4abec42cce1cd912a45b'
      AND obj_description(function_record.oid, 'pg_proc') IS NULL
  ) THEN
    RAISE EXCEPTION 'rollback lifecycle notify_emit predecessor drift';
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
    RAISE EXCEPTION 'rollback lifecycle notify_emit grant drift';
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
    RAISE EXCEPTION 'rollback lifecycle retained evidence missing';
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
    RAISE EXCEPTION 'rollback lifecycle retained RLS drift';
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
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           ('public.notification_producer_occurrences'::regclass),
           ('public.notification_delivery_claims'::regclass)
       ) expected(relation_id)
       WHERE (
         SELECT array_agg(
           DISTINCT acl_record.privilege_type::text
           ORDER BY acl_record.privilege_type::text
         )
         FROM pg_class relation_record
         CROSS JOIN LATERAL aclexplode(relation_record.relacl) acl_record
         WHERE relation_record.oid = expected.relation_id
           AND acl_record.grantee = (
             SELECT oid FROM pg_roles WHERE rolname = 'service_role'
           )
       ) IS DISTINCT FROM ARRAY['SELECT']::text[]
     ) THEN
    RAISE EXCEPTION 'rollback lifecycle retained table grant drift';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
    'public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)',
    'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
    'public.release_notification_delivery_claim(uuid)',
    'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'
  ]::text[]
  LOOP
    v_function_oid := to_regprocedure(v_signature);
    IF v_function_oid IS NULL
       OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'rollback lifecycle inert function drift (%)', v_signature;
    END IF;
  END LOOP;

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
    RAISE EXCEPTION 'rollback lifecycle disabled catalog drift';
  END IF;

  IF to_regclass('cron.job') IS NULL OR EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'upr_appointment_reminders'
  ) THEN
    RAISE EXCEPTION 'rollback lifecycle reminder cron drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies policy_record
    WHERE policy_record.schemaname = 'public'
      AND policy_record.tablename IN ('appointments', 'appointment_crew')
      AND 'anon' = ANY (policy_record.roles)
  ) THEN
    RAISE EXCEPTION 'rollback lifecycle anonymous appointment policy restored';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgname IN (
      'trg_appointments_notification_producer_authority',
      'trg_appointment_crew_notification_producer_authority',
      'trg_appointments_bind_creator'
    )
      AND NOT trigger_record.tgisinternal
  ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'rollback lifecycle authorization trigger drift';
  END IF;
END;
$rollback_lifecycle$;

SELECT plan(1);
SELECT pass('PR #573 reverse rollback lifecycle contracts passed');
SELECT * FROM finish();

ROLLBACK;
