/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * FILE: notification_producer_crew_phase_a_composition_rollback_lifecycle.sql
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the composition rollback turns notification mutation paths inert
 *   while intentionally retaining the independently deployed Crew Phase-A
 *   RPCs and their authorization boundary.
 *
 * DEPENDS ON:
 *   Internal: composition migration rollback; disposable local runner only
 *   Data:      reads disposable catalogs; rolls back its proof transaction
 * ═══════════════════════════════════════════════════════════════════════════════
 */

\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

BEGIN;

DO $rollback_composition$
DECLARE v_signature text;
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
    'public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)',
    'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
    'public.release_notification_delivery_claim(uuid)',
    'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'
  ]::text[] LOOP
    IF to_regprocedure(v_signature) IS NULL
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('service_role', to_regprocedure(v_signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'composition rollback notification containment drift (%)', v_signature;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.sync_appointment_crew(uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.sync_appointment_crew(uuid,jsonb,uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.sync_appointment_crew(uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'composition rollback regressed Phase-A crew boundary';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notification_types notification_type
    WHERE notification_type.type_key IN (
      'appointment.assigned', 'appointment.updated', 'appointment.canceled',
      'timesheet.change_requested', 'timesheet.change_reviewed'
    ) AND notification_type.enabled
  ) THEN
    RAISE EXCEPTION 'composition rollback enabled a producer flag';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upr_appointment_reminders') THEN
    RAISE EXCEPTION 'composition rollback enabled a reminder cron';
  END IF;
END;
$rollback_composition$;

SELECT plan(1);
SELECT pass('notification-producer + Crew Phase-A composition rollback containment passed');
SELECT * FROM finish();
ROLLBACK;
