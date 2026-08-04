-- Recovery for 20260803223000_appointment_reminder_delivery_claims.
-- Containment is restored before any claim boundary is removed.

DO $preflight$
DECLARE
  v_dispatcher regprocedure :=
    to_regprocedure('public.dispatch_due_appointment_reminders()');
BEGIN
  IF v_dispatcher IS NULL
     OR (
       SELECT count(*)
       FROM pg_proc function_record
       JOIN pg_namespace function_schema
         ON function_schema.oid = function_record.pronamespace
       WHERE function_schema.nspname = 'public'
         AND function_record.proname =
           'dispatch_due_appointment_reminders'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc function_record
       WHERE function_record.oid = v_dispatcher
         AND pg_get_userbyid(function_record.proowner) = 'postgres'
         AND function_record.prosecdef
         AND function_record.proconfig =
           ARRAY['search_path=public']::text[]
         AND md5(function_record.prosrc) =
           'a0d8bbb5a8e871903330499c7d7e4d3b'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_proc function_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           function_record.proacl,
           acldefault('f', function_record.proowner)
         )
       ) acl
       WHERE function_record.oid = v_dispatcher
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       v_dispatcher,
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       v_dispatcher,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_dispatcher,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'appointment reminder claims rollback: dispatcher drift';
  END IF;
END;
$preflight$;

UPDATE public.notification_types
SET enabled = false
WHERE type_key = 'appointment.reminder'
  AND enabled IS DISTINCT FROM false;

DO $unschedule$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'upr_appointment_reminders'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$unschedule$;

REVOKE EXECUTE ON FUNCTION
  public.validate_appointment_reminder_delivery(text, uuid, uuid),
  public.claim_appointment_reminder_delivery(
    uuid,
    text,
    uuid,
    uuid,
    text,
    uuid,
    uuid,
    text
  ),
  public.release_appointment_reminder_delivery_claim(uuid),
  public.claim_appointment_reminder_native_delivery(
    uuid,
    text,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text
  )
FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.claim_appointment_reminder_native_delivery(
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text
);
DROP FUNCTION public.release_appointment_reminder_delivery_claim(uuid);
DROP FUNCTION public.claim_appointment_reminder_delivery(
  uuid,
  text,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text
);
DROP FUNCTION public.validate_appointment_reminder_delivery(text, uuid, uuid);
DROP TABLE public.appointment_reminder_delivery_claims;

CREATE OR REPLACE FUNCTION public.dispatch_due_appointment_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row record; v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT appointment.id, crew.employee_id,
      ((appointment.date + appointment.time_start) AT TIME ZONE 'America/Denver') AS starts_at
    FROM public.appointments appointment
    JOIN public.appointment_crew crew ON crew.appointment_id = appointment.id
    JOIN public.employees employee ON employee.id = crew.employee_id
    WHERE appointment.status = 'scheduled'
      AND appointment.time_start IS NOT NULL
      AND employee.is_active IS TRUE AND employee.is_external IS FALSE
      AND ((appointment.date + appointment.time_start) AT TIME ZONE 'America/Denver') >= now() + interval '59 minutes'
      AND ((appointment.date + appointment.time_start) AT TIME ZONE 'America/Denver') < now() + interval '61 minutes'
  LOOP
    INSERT INTO public.appointment_reminder_claims (appointment_id, employee_id, appointment_starts_at)
    VALUES (v_row.id, v_row.employee_id, v_row.starts_at)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      PERFORM public.notify_emit('appointment.reminder', jsonb_build_object(
        'appointment_id', v_row.id, 'employee_id', v_row.employee_id,
        'notification_event_id', concat(v_row.id, ':', v_row.employee_id, ':', v_row.starts_at)
      ));
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;

ALTER FUNCTION public.dispatch_due_appointment_reminders()
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.dispatch_due_appointment_reminders()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_due_appointment_reminders()
  TO service_role;

ALTER TABLE public.appointment_reminder_claims
  DROP CONSTRAINT appointment_reminder_claims_event_id_check;
ALTER TABLE public.appointment_reminder_claims
  DROP CONSTRAINT appointment_reminder_claims_event_id_key;
DROP INDEX public.appointment_reminder_claims_employee_idx;
ALTER TABLE public.appointment_reminder_claims
  DROP COLUMN notification_event_id;

DO $postflight$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.notification_types
       WHERE type_key = 'appointment.reminder'
         AND enabled
     )
     OR EXISTS (
       SELECT 1
       FROM cron.job
       WHERE jobname = 'upr_appointment_reminders'
     )
     OR to_regclass('public.appointment_reminder_delivery_claims') IS NOT NULL
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
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'appointment_reminder_claims'
         AND column_name = 'notification_event_id'
     ) THEN
    RAISE EXCEPTION
      'appointment reminder claims rollback: containment postflight failed';
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
    RAISE EXCEPTION
      'appointment reminder claims rollback: dispatcher restore failed';
  END IF;
END;
$postflight$;
