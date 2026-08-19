-- ═══════════════════════════════════════════════════════════════════════════════
-- FILE: appointment_reminder_delivery_claims_isolated.sql
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   On a disposable local database only, proves appointment reminders bind one
--   due occurrence to exact current active/internal crew and exact bell, Web
--   Push, email, and iOS targets. It covers replay, release/reclaim, stale
--   assignment/start/status/flag denial, and browser-role denial.
--
-- NOTES / GOTCHAS:
--   The governed wrapper supplies UPR_ISOLATED_DB=1 and
--   upr.isolated_test_database=on. Every fixture rolls back.
-- ═══════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\if :{?UPR_ISOLATED_DB}
\else
DO $refuse$
BEGIN
  RAISE EXCEPTION
    'Set UPR_ISOLATED_DB=1 only for a disposable local clone.';
END;
$refuse$;
\endif

BEGIN;

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;
  IF to_regprocedure(
       'public.claim_appointment_reminder_delivery(uuid,text,uuid,uuid,text,uuid,uuid,text)'
     ) IS NULL
     OR to_regprocedure(
       'public.claim_appointment_reminder_native_delivery(uuid,text,uuid,uuid,uuid,uuid,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'apply appointment_reminder_delivery_claims to the disposable clone first';
  END IF;
END;
$guard$;

DO $fixture_ids$
BEGIN
  PERFORM set_config('upr.reminder.job', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.tech', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.admin', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.office', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.unassigned', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.inactive', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.external', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.subscription', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.device', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.bell_key', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.pwa_key', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.email_key', gen_random_uuid()::text, true);
  PERFORM set_config('upr.reminder.native_key', gen_random_uuid()::text, true);
END;
$fixture_ids$;

INSERT INTO public.jobs (id, insured_name)
VALUES (
  current_setting('upr.reminder.job')::uuid,
  '[Reminder isolated] Job'
);

INSERT INTO public.employees (
  id,
  full_name,
  email,
  role,
  is_active,
  is_external
)
VALUES
  (
    current_setting('upr.reminder.tech')::uuid,
    '[Reminder isolated] Tech',
    'reminder-tech@example.invalid',
    'field_tech',
    true,
    false
  ),
  (
    current_setting('upr.reminder.admin')::uuid,
    '[Reminder isolated] Assigned admin',
    'reminder-admin@example.invalid',
    'admin',
    true,
    false
  ),
  (
    current_setting('upr.reminder.office')::uuid,
    '[Reminder isolated] Assigned office',
    'reminder-office@example.invalid',
    'office',
    true,
    false
  ),
  (
    current_setting('upr.reminder.unassigned')::uuid,
    '[Reminder isolated] Unassigned admin',
    'reminder-unassigned@example.invalid',
    'admin',
    true,
    false
  ),
  (
    current_setting('upr.reminder.inactive')::uuid,
    '[Reminder isolated] Inactive',
    'reminder-inactive@example.invalid',
    'field_tech',
    false,
    false
  ),
  (
    current_setting('upr.reminder.external')::uuid,
    '[Reminder isolated] External',
    'reminder-external@example.invalid',
    'crm_partner',
    true,
    true
  );

INSERT INTO public.appointments (
  id,
  job_id,
  title,
  date,
  time_start,
  status
)
VALUES (
  current_setting('upr.reminder.appointment')::uuid,
  current_setting('upr.reminder.job')::uuid,
  '[Reminder isolated] Due appointment',
  (
    now() AT TIME ZONE 'America/Denver' + interval '60 minutes'
  )::date,
  (
    now() AT TIME ZONE 'America/Denver' + interval '60 minutes'
  )::time,
  'scheduled'
);

INSERT INTO public.appointment_crew (
  appointment_id,
  employee_id,
  role
)
VALUES
  (
    current_setting('upr.reminder.appointment')::uuid,
    current_setting('upr.reminder.tech')::uuid,
    'tech'
  ),
  (
    current_setting('upr.reminder.appointment')::uuid,
    current_setting('upr.reminder.admin')::uuid,
    'lead'
  ),
  (
    current_setting('upr.reminder.appointment')::uuid,
    current_setting('upr.reminder.office')::uuid,
    'helper'
  );

INSERT INTO public.push_subscriptions (
  id,
  employee_id,
  endpoint,
  p256dh,
  auth
)
VALUES (
  current_setting('upr.reminder.subscription')::uuid,
  current_setting('upr.reminder.tech')::uuid,
  'https://push.example.invalid/reminder-current',
  'reminder-local-p256dh',
  'reminder-local-auth'
);

INSERT INTO public.device_tokens (
  id,
  employee_id,
  token,
  platform,
  apns_environment
)
VALUES (
  current_setting('upr.reminder.device')::uuid,
  current_setting('upr.reminder.tech')::uuid,
  'reminder-local-device-token',
  'ios',
  'sandbox'
);

INSERT INTO public.appointment_reminder_claims (
  appointment_id,
  employee_id,
  appointment_starts_at,
  notification_event_id
)
SELECT
  current_setting('upr.reminder.appointment')::uuid,
  employee_id,
  (
    (appointment.date + appointment.time_start)
      AT TIME ZONE 'America/Denver'
  ),
  concat(
    current_setting('upr.reminder.appointment'),
    ':',
    employee_id,
    ':',
    (
      (appointment.date + appointment.time_start)
        AT TIME ZONE 'America/Denver'
    )
  )
FROM public.appointments appointment
CROSS JOIN unnest(ARRAY[
  current_setting('upr.reminder.tech')::uuid,
  current_setting('upr.reminder.admin')::uuid,
  current_setting('upr.reminder.office')::uuid
]) employee_id
WHERE appointment.id = current_setting('upr.reminder.appointment')::uuid;

UPDATE public.notification_types
SET enabled = true
WHERE type_key = 'appointment.reminder';

SELECT set_config(
  'upr.reminder.event',
  (
    SELECT notification_event_id
    FROM public.appointment_reminder_claims
    WHERE employee_id = current_setting('upr.reminder.tech')::uuid
  ),
  true
);

CREATE OR REPLACE FUNCTION pg_temp.expect_sqlstate(
  p_label text,
  p_statement text,
  p_expected text DEFAULT '42501'
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_state text;
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = p_expected THEN
        RETURN;
      END IF;
      RAISE EXCEPTION '% returned %, expected %', p_label, v_state, p_expected;
  END;
  RAISE EXCEPTION '% unexpectedly succeeded', p_label;
END;
$function$;

SET LOCAL ROLE anon;
SELECT pg_temp.expect_sqlstate(
  'anon reminder claim denied',
  format(
    'SELECT public.claim_appointment_reminder_delivery(%L::uuid,%L,%L::uuid,%L::uuid,%L,%L::uuid,NULL,%L)',
    current_setting('upr.reminder.bell_key'),
    current_setting('upr.reminder.event'),
    current_setting('upr.reminder.tech'),
    current_setting('upr.reminder.appointment'),
    'bell',
    gen_random_uuid(),
    current_setting('upr.reminder.tech')
  )
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sqlstate(
  'authenticated reminder validation denied',
  format(
    'SELECT public.validate_appointment_reminder_delivery(%L,%L::uuid,%L::uuid)',
    current_setting('upr.reminder.event'),
    current_setting('upr.reminder.appointment'),
    current_setting('upr.reminder.tech')
  )
);

RESET ROLE;
SET LOCAL ROLE service_role;

DO $behavior$
DECLARE
  v_appointment uuid := current_setting('upr.reminder.appointment')::uuid;
  v_tech uuid := current_setting('upr.reminder.tech')::uuid;
  v_event text;
  v_first boolean;
  v_duplicate boolean;
  v_release boolean;
  v_reclaim boolean;
BEGIN
  SELECT notification_event_id
  INTO v_event
  FROM public.appointment_reminder_claims
  WHERE appointment_id = v_appointment
    AND employee_id = v_tech;

  IF public.validate_appointment_reminder_delivery(
    v_event,
    v_appointment,
    v_tech
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'assigned active internal technician was denied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      current_setting('upr.reminder.admin')::uuid,
      current_setting('upr.reminder.office')::uuid
    ]) assigned_employee
    WHERE public.validate_appointment_reminder_delivery(
      (
        SELECT notification_event_id
        FROM public.appointment_reminder_claims
        WHERE appointment_id = v_appointment
          AND employee_id = assigned_employee
      ),
      v_appointment,
      assigned_employee
    ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'assigned internal admin/office reminder was denied';
  END IF;

  IF public.validate_appointment_reminder_delivery(
       v_event,
       v_appointment,
       current_setting('upr.reminder.unassigned')::uuid
     )
     OR public.validate_appointment_reminder_delivery(
       v_event,
       v_appointment,
       current_setting('upr.reminder.inactive')::uuid
     )
     OR public.validate_appointment_reminder_delivery(
       v_event,
       v_appointment,
       current_setting('upr.reminder.external')::uuid
     ) THEN
    RAISE EXCEPTION 'invalid reminder recipient was accepted';
  END IF;

  v_first := public.claim_appointment_reminder_delivery(
    current_setting('upr.reminder.bell_key')::uuid,
    v_event,
    v_tech,
    v_appointment,
    'bell',
    gen_random_uuid(),
    NULL,
    v_tech::text
  );
  v_duplicate := public.claim_appointment_reminder_delivery(
    current_setting('upr.reminder.bell_key')::uuid,
    v_event,
    v_tech,
    v_appointment,
    'bell',
    gen_random_uuid(),
    NULL,
    v_tech::text
  );
  IF v_first IS NOT TRUE OR v_duplicate IS NOT FALSE THEN
    RAISE EXCEPTION 'bell replay claim drift';
  END IF;

  IF public.claim_appointment_reminder_delivery(
    current_setting('upr.reminder.pwa_key')::uuid,
    v_event,
    v_tech,
    v_appointment,
    'pwa_push',
    gen_random_uuid(),
    current_setting('upr.reminder.subscription')::uuid,
    'https://push.example.invalid/reminder-current'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'current Web Push target was denied';
  END IF;

  IF public.claim_appointment_reminder_delivery(
    current_setting('upr.reminder.email_key')::uuid,
    v_event,
    v_tech,
    v_appointment,
    'email',
    gen_random_uuid(),
    NULL,
    'reminder-tech@example.invalid'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'current email target was denied';
  END IF;

  IF public.claim_appointment_reminder_native_delivery(
    current_setting('upr.reminder.native_key')::uuid,
    v_event,
    v_tech,
    v_appointment,
    current_setting('upr.reminder.device')::uuid,
    gen_random_uuid(),
    'reminder-local-device-token',
    'sandbox'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'current native target was denied';
  END IF;

  IF public.claim_appointment_reminder_delivery(
    gen_random_uuid(),
    v_event,
    v_tech,
    v_appointment,
    'pwa_push',
    gen_random_uuid(),
    current_setting('upr.reminder.subscription')::uuid,
    'https://push.example.invalid/stale'
  ) OR public.claim_appointment_reminder_delivery(
    gen_random_uuid(),
    v_event,
    v_tech,
    v_appointment,
    'email',
    gen_random_uuid(),
    NULL,
    'stale@example.invalid'
  ) OR public.claim_appointment_reminder_native_delivery(
    gen_random_uuid(),
    v_event,
    v_tech,
    v_appointment,
    current_setting('upr.reminder.device')::uuid,
    gen_random_uuid(),
    'stale-device-token',
    'sandbox'
  ) THEN
    RAISE EXCEPTION 'stale reminder target was accepted';
  END IF;

  v_release := public.release_appointment_reminder_delivery_claim(
    current_setting('upr.reminder.bell_key')::uuid
  );
  v_reclaim := public.claim_appointment_reminder_delivery(
    current_setting('upr.reminder.bell_key')::uuid,
    v_event,
    v_tech,
    v_appointment,
    'bell',
    gen_random_uuid(),
    NULL,
    v_tech::text
  );
  IF v_release IS NOT TRUE OR v_reclaim IS NOT TRUE THEN
    RAISE EXCEPTION 'explicit reminder release/reclaim drift';
  END IF;

  UPDATE public.notification_types
  SET enabled = false
  WHERE type_key = 'appointment.reminder';
  IF public.validate_appointment_reminder_delivery(
    v_event,
    v_appointment,
    v_tech
  ) THEN
    RAISE EXCEPTION 'disabled reminder accepted an in-flight claim';
  END IF;
  UPDATE public.notification_types
  SET enabled = true
  WHERE type_key = 'appointment.reminder';

  UPDATE public.appointments
  SET status = 'cancelled'
  WHERE id = v_appointment;
  IF public.validate_appointment_reminder_delivery(
    v_event,
    v_appointment,
    v_tech
  ) THEN
    RAISE EXCEPTION 'cancelled appointment reminder accepted';
  END IF;
  UPDATE public.appointments
  SET status = 'scheduled',
      time_start = time_start + interval '15 minutes'
  WHERE id = v_appointment;
  IF public.validate_appointment_reminder_delivery(
    v_event,
    v_appointment,
    v_tech
  ) THEN
    RAISE EXCEPTION 'changed appointment start reminder accepted';
  END IF;
END;
$behavior$;

RESET ROLE;

SELECT plan(1);
SELECT pass('appointment reminder isolated delivery contracts passed');
SELECT * FROM finish();

ROLLBACK;
