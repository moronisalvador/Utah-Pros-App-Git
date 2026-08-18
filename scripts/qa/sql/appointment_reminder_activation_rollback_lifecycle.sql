/*
 * ═══════════════════════════════════════════════════════════════════════════
 * FILE: appointment_reminder_activation_rollback_lifecycle.sql
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the QA predecessor remains producer-hardened after reversing only
 *   the two appointment-reminder activation migrations. The inert reminder
 *   foundation is intentionally retained, while its delivery claims and event
 *   identity are removed and every reminder remains disabled and unscheduled.
 *
 * DEPENDS ON:
 *   Packages: PostgreSQL, pgTAP
 *   Internal: 20260803221500 and 20260803223000 paired rollbacks
 *   Data: reads → disposable local catalogs only
 *         writes → none outside this proof transaction
 *
 * NOTES / GOTCHAS:
 *   The governed wrapper supplies upr.isolated_test_database=on.
 *   This is the QA rollback shape, not the deeper Production recovery path.
 * ═══════════════════════════════════════════════════════════════════════════
 */

\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

BEGIN;

DO $qa_rollback_lifecycle$
DECLARE
  v_notify_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_function_oid oid;
  v_table text;
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
      AND md5(function_record.prosrc) = 'ea3a9b3b6cca96722c008d7e9b23f6bc'
      AND obj_description(function_record.oid, 'pg_proc') =
        'upr:20260802040935:predecessor=guarded'
  ) THEN
    RAISE EXCEPTION 'QA rollback changed the producer dispatcher';
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
    RAISE EXCEPTION 'QA rollback widened dispatcher execution';
  END IF;

  IF to_regclass('public.notification_producer_occurrences') IS NULL
     OR to_regclass('public.notification_delivery_claims') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'appointments'
         AND column_record.column_name = 'created_by_employee_id'
     )
     OR (
       SELECT count(*)
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgname IN (
         'trg_appointments_notification_producer_authority',
         'trg_appointment_crew_notification_producer_authority',
         'trg_appointments_bind_creator'
       )
         AND NOT trigger_record.tgisinternal
     ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'QA rollback weakened producer or crew authorization';
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
    RAISE EXCEPTION 'QA rollback weakened producer evidence RLS';
  END IF;

  v_function_oid := to_regprocedure(
    'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)'
  );
  IF v_function_oid IS NULL
     OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'QA rollback weakened producer delivery claims';
  END IF;

  IF to_regclass('public.notification_quiet_time_preferences') IS NULL
     OR to_regclass('public.appointment_reminder_claims') IS NULL
     OR to_regprocedure('public.dispatch_due_appointment_reminders()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.notification_types catalog
       WHERE catalog.type_key = 'appointment.reminder'
         AND catalog.enabled IS FALSE
     )
     OR EXISTS (
       SELECT 1
       FROM cron.job
       WHERE jobname = 'upr_appointment_reminders'
     ) THEN
    RAISE EXCEPTION 'QA rollback did not retain the inert reminder foundation';
  END IF;

  IF to_regclass('public.appointment_reminder_delivery_claims') IS NOT NULL
     OR to_regprocedure(
       'public.validate_appointment_reminder_delivery(text,uuid,uuid)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.claim_appointment_reminder_delivery(uuid,text,uuid,uuid,text,uuid,uuid,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.release_appointment_reminder_delivery_claim(uuid)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.claim_appointment_reminder_native_delivery(uuid,text,uuid,uuid,uuid,uuid,text,text)'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'appointment_reminder_claims'
         AND column_record.column_name = 'notification_event_id'
     ) THEN
    RAISE EXCEPTION 'QA rollback retained reminder delivery activation state';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid =
      to_regprocedure('public.dispatch_due_appointment_reminders()')
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) =
        'c010eb4a4cab2f0d00ede467a47e4148'
  ) THEN
    RAISE EXCEPTION 'QA rollback dispatcher restoration drift';
  END IF;

  IF to_regclass(
       'public.notification_producer_occurrences_type_key_idx'
     ) IS NOT NULL
     OR to_regclass(
       'public.notification_delivery_claims_event_idx'
     ) IS NOT NULL
     OR to_regclass(
       'public.notification_delivery_claims_employee_idx'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'QA rollback retained activation-only indexes';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'billing_2fa_codes',
    'integration_config',
    'user_google_accounts'
  ]
  LOOP
    IF has_table_privilege(
         'anon',
         to_regclass('public.' || v_table),
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
       OR has_table_privilege(
         'authenticated',
         to_regclass('public.' || v_table),
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       ) THEN
      RAISE EXCEPTION 'QA rollback widened secret table %', v_table;
    END IF;
  END LOOP;
END;
$qa_rollback_lifecycle$;

SELECT plan(1);
SELECT pass('QA appointment-reminder activation rollback contracts passed');
SELECT * FROM finish();

ROLLBACK;
