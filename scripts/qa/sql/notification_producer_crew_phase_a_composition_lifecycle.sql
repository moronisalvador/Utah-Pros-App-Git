/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * FILE: notification_producer_crew_phase_a_composition_lifecycle.sql
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the composed notification-producer contracts are present without
 *   replacing the already-authoritative Crew Phase-A RPCs. This is disposable
 *   local-database evidence only.
 *
 * DEPENDS ON:
 *   Internal:  20260804153859_notification_producer_crew_phase_a_composition.sql
 *   Data:      reads disposable catalogs; rolls back its proof transaction
 * ═══════════════════════════════════════════════════════════════════════════════
 */

\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

BEGIN;

DO $forward_composition$
DECLARE
  v_signature text;
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations migration_record
    WHERE migration_record.name = 'notification_producer_crew_phase_a_composition'
  ) THEN
    RAISE EXCEPTION 'composition migration ledger entry missing';
  END IF;

  IF to_regclass('public.notification_producer_occurrences') IS NULL
     OR to_regclass('public.notification_delivery_claims') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'appointments'
         AND column_record.column_name = 'created_by_employee_id'
     ) THEN
    RAISE EXCEPTION 'composition notification evidence contracts missing';
  END IF;

  IF (SELECT count(*) FROM pg_class relation_record
      WHERE relation_record.oid IN (
        'public.notification_producer_occurrences'::regclass,
        'public.notification_delivery_claims'::regclass
      ) AND relation_record.relrowsecurity AND relation_record.relforcerowsecurity) <> 2 THEN
    RAISE EXCEPTION 'composition private evidence RLS drift';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
    'public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)',
    'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
    'public.release_notification_delivery_claim(uuid)',
    'public.notify_emit(text,jsonb)'
  ]::text[] LOOP
    IF to_regprocedure(v_signature) IS NULL
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       OR NOT has_function_privilege('service_role', to_regprocedure(v_signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'composition notification function grant drift (%)', v_signature;
    END IF;
  END LOOP;

  IF to_regprocedure('public.emit_notification_producer_event(text,text,text,uuid,jsonb)') IS NULL
     OR has_function_privilege('anon', 'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('service_role', 'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'composition emit must remain trigger/RPC-internal';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.sync_appointment_crew(uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.sync_appointment_crew(uuid,jsonb,uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.sync_appointment_crew(uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'composition regressed Phase-A crew RPC grants';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notification_types notification_type
    WHERE notification_type.type_key IN (
      'appointment.assigned', 'appointment.updated', 'appointment.canceled',
      'timesheet.change_requested', 'timesheet.change_reviewed',
      'appointment.reminder'
    ) AND notification_type.enabled
  ) THEN
    RAISE EXCEPTION 'composition enabled a producer flag';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upr_appointment_reminders') THEN
    RAISE EXCEPTION 'composition enabled a reminder cron';
  END IF;
END;
$forward_composition$;

SELECT plan(1);
SELECT pass('notification-producer + Crew Phase-A composition forward lifecycle contracts passed');
SELECT * FROM finish();
ROLLBACK;
