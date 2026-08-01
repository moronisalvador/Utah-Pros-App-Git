-- ═══════════════════════════════════════════════════════════════════════════════
-- FILE: notification_producer_authorization_isolated.sql
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   On a disposable local database only, proves the five contained notification
--   producers bind browser actors to auth.uid(), deny inactive/external/cross-
--   account writes, preserve crew row identity through a locked diff, serialize
--   timesheet submit/review decisions, and claim each delivery occurrence once.
--
-- DEPENDS ON:
--   20260801215912_notification_producer_authorization.sql and its existing
--   appointment, employee, time-entry, notification, and auth dependencies.
--
-- RUN ONLY ON AN ISOLATED DATABASE:
--   The governed npm run test:db:local runner supplies both UPR_ISOLATED_DB=1
--   and upr.isolated_test_database=on. This file refuses every other target.
-- ═══════════════════════════════════════════════════════════════════════════════

\if :{?UPR_ISOLATED_DB}
\else
\echo 'Set UPR_ISOLATED_DB=1 only for a disposable local clone.'
\quit 2
\endif

BEGIN;

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'notification_producer_authorization'
  )
     OR to_regprocedure(
       'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'apply notification_producer_authorization to the disposable clone first';
  END IF;
END;
$guard$;

DO $fixture_ids$
BEGIN
  PERFORM set_config('upr.npa.auth_tech', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.auth_other', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.auth_admin', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.auth_inactive', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.auth_external', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_tech', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_other', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_admin', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_inactive', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_external', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.job', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.entry', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.occurrence', gen_random_uuid()::text, true);
END;
$fixture_ids$;

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  current_setting(setting_key)::uuid,
  'authenticated',
  'authenticated',
  setting_key || '@example.invalid',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
FROM unnest(ARRAY[
  'upr.npa.auth_tech',
  'upr.npa.auth_other',
  'upr.npa.auth_admin',
  'upr.npa.auth_inactive',
  'upr.npa.auth_external'
]) setting_key;

INSERT INTO public.employees (
  id,
  full_name,
  auth_user_id,
  role,
  is_active,
  is_external
)
VALUES
  (
    current_setting('upr.npa.employee_tech')::uuid,
    '[NPA isolated] Tech',
    current_setting('upr.npa.auth_tech')::uuid,
    'field_tech',
    true,
    false
  ),
  (
    current_setting('upr.npa.employee_other')::uuid,
    '[NPA isolated] Other tech',
    current_setting('upr.npa.auth_other')::uuid,
    'field_tech',
    true,
    false
  ),
  (
    current_setting('upr.npa.employee_admin')::uuid,
    '[NPA isolated] Admin',
    current_setting('upr.npa.auth_admin')::uuid,
    'admin',
    true,
    false
  ),
  (
    current_setting('upr.npa.employee_inactive')::uuid,
    '[NPA isolated] Inactive',
    current_setting('upr.npa.auth_inactive')::uuid,
    'field_tech',
    false,
    false
  ),
  (
    current_setting('upr.npa.employee_external')::uuid,
    '[NPA isolated] External',
    current_setting('upr.npa.auth_external')::uuid,
    'crm_partner',
    true,
    true
  );

INSERT INTO public.jobs (id, insured_name)
VALUES (
  current_setting('upr.npa.job')::uuid,
  '[NPA isolated] Job'
);

INSERT INTO public.appointments (id, job_id, title, date)
VALUES (
  current_setting('upr.npa.appointment')::uuid,
  current_setting('upr.npa.job')::uuid,
  '[NPA isolated] Appointment',
  CURRENT_DATE
);

INSERT INTO public.appointment_crew (
  appointment_id,
  employee_id,
  role
)
VALUES (
  current_setting('upr.npa.appointment')::uuid,
  current_setting('upr.npa.employee_tech')::uuid,
  'tech'
);

INSERT INTO public.job_time_entries (
  id,
  job_id,
  employee_id,
  work_date,
  hours,
  work_type
)
VALUES (
  current_setting('upr.npa.entry')::uuid,
  current_setting('upr.npa.job')::uuid,
  current_setting('upr.npa.employee_tech')::uuid,
  CURRENT_DATE,
  2,
  'field'
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
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.expect_sqlstate(
  'anon cannot create an appointment',
  format(
    'INSERT INTO public.appointments (job_id,title,date) VALUES (%L::uuid,%L,CURRENT_DATE)',
    current_setting('upr.npa.job'),
    '[NPA isolated] forged appointment'
  )
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_external'),
    'role',
    'authenticated'
  )::text,
  true
);
SELECT pg_temp.expect_sqlstate(
  'external employee cannot update appointment',
  format(
    'UPDATE public.appointments SET title=%L WHERE id=%L::uuid',
    '[NPA isolated] external write',
    current_setting('upr.npa.appointment')
  )
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_inactive'),
    'role',
    'authenticated'
  )::text,
  true
);
SELECT pg_temp.expect_sqlstate(
  'inactive employee cannot update appointment',
  format(
    'UPDATE public.appointments SET title=%L WHERE id=%L::uuid',
    '[NPA isolated] inactive write',
    current_setting('upr.npa.appointment')
  )
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_tech'),
    'role',
    'authenticated'
  )::text,
  true
);
SELECT pg_temp.expect_sqlstate(
  'browser cannot forge another appointment actor',
  format(
    'SELECT public.update_appointment(%L::uuid,NULL,NULL,NULL,%L,NULL,NULL,NULL,%L::uuid)',
    current_setting('upr.npa.appointment'),
    '[NPA isolated] forged actor',
    current_setting('upr.npa.employee_other')
  )
);

DO $crew_diff$
DECLARE
  v_original_id uuid;
  v_after_id uuid;
BEGIN
  SELECT id
    INTO v_original_id
  FROM public.appointment_crew
  WHERE appointment_id = current_setting('upr.npa.appointment')::uuid
    AND employee_id = current_setting('upr.npa.employee_tech')::uuid;

  PERFORM public.sync_appointment_crew(
    current_setting('upr.npa.appointment')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'employee_id',
        current_setting('upr.npa.employee_tech'),
        'role',
        'tech'
      ),
      jsonb_build_object(
        'employee_id',
        current_setting('upr.npa.employee_other'),
        'role',
        'helper'
      )
    )
  );

  SELECT id
    INTO v_after_id
  FROM public.appointment_crew
  WHERE appointment_id = current_setting('upr.npa.appointment')::uuid
    AND employee_id = current_setting('upr.npa.employee_tech')::uuid;

  IF v_after_id IS DISTINCT FROM v_original_id
     OR (
       SELECT count(*)
       FROM public.appointment_crew
       WHERE appointment_id = current_setting('upr.npa.appointment')::uuid
     ) <> 2 THEN
    RAISE EXCEPTION 'crew diff replaced an unchanged row or returned wrong set';
  END IF;
END;
$crew_diff$;

SELECT pg_temp.expect_sqlstate(
  'crew sync rejects an external employee',
  format(
    'SELECT * FROM public.sync_appointment_crew(%L::uuid,%L::jsonb)',
    current_setting('upr.npa.appointment'),
    jsonb_build_array(
      jsonb_build_object(
        'employee_id',
        current_setting('upr.npa.employee_external'),
        'role',
        'tech'
      )
    )::text
  )
);

SELECT pg_temp.expect_sqlstate(
  'tech cannot submit for another employee actor',
  format(
    'SELECT public.submit_time_entry_change_request(%L::uuid,%L::jsonb,%L,%L::uuid)',
    current_setting('upr.npa.entry'),
    '{"hours":3}',
    'forged actor',
    current_setting('upr.npa.employee_other')
  )
);

DO $submit_idempotency$
DECLARE
  v_first public.time_entry_change_requests;
  v_retry public.time_entry_change_requests;
BEGIN
  v_first := public.submit_time_entry_change_request(
    current_setting('upr.npa.entry')::uuid,
    '{"hours":3}'::jsonb,
    'same correction',
    current_setting('upr.npa.employee_tech')::uuid
  );
  v_retry := public.submit_time_entry_change_request(
    current_setting('upr.npa.entry')::uuid,
    '{"hours":3}'::jsonb,
    'same correction',
    current_setting('upr.npa.employee_tech')::uuid
  );

  IF v_first.id IS DISTINCT FROM v_retry.id
     OR (
       SELECT count(*)
       FROM public.time_entry_change_requests request
       WHERE request.entry_id = current_setting('upr.npa.entry')::uuid
     ) <> 1 THEN
    RAISE EXCEPTION 'exact timesheet retry was not idempotent';
  END IF;

  PERFORM set_config('upr.npa.request', v_first.id::text, true);
END;
$submit_idempotency$;

SELECT pg_temp.expect_sqlstate(
  'different pending correction conflicts',
  format(
    'SELECT public.submit_time_entry_change_request(%L::uuid,%L::jsonb,%L,%L::uuid)',
    current_setting('upr.npa.entry'),
    '{"hours":4}',
    'different correction',
    current_setting('upr.npa.employee_tech')
  ),
  'P0001'
);

SELECT pg_temp.expect_sqlstate(
  'tech cannot review a timesheet request',
  format(
    'SELECT public.review_time_entry_change_request(%L::uuid,false,%L::uuid,NULL)',
    current_setting('upr.npa.request'),
    current_setting('upr.npa.employee_tech')
  )
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_admin'),
    'role',
    'authenticated'
  )::text,
  true
);
SELECT public.review_time_entry_change_request(
  current_setting('upr.npa.request')::uuid,
  false,
  current_setting('upr.npa.employee_admin')::uuid,
  'declined in isolated proof'
);
SELECT pg_temp.expect_sqlstate(
  'review retry is serialized and refused',
  format(
    'SELECT public.review_time_entry_change_request(%L::uuid,false,%L::uuid,NULL)',
    current_setting('upr.npa.request'),
    current_setting('upr.npa.employee_admin')
  ),
  'P0001'
);

RESET ROLE;
INSERT INTO public.notification_producer_occurrences (
  id,
  type_key,
  occurrence_key,
  entity_type,
  entity_id
)
VALUES (
  current_setting('upr.npa.occurrence')::uuid,
  'appointment.updated',
  'notification-producer-authorization-isolated',
  'appointment',
  current_setting('upr.npa.appointment')::uuid
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_admin'),
    'role',
    'authenticated'
  )::text,
  true
);
SELECT pg_temp.expect_sqlstate(
  'browser cannot claim worker delivery',
  format(
    'SELECT public.claim_notification_delivery(%L::uuid,%L::uuid,%L::uuid,%L,%L,%L::uuid)',
    gen_random_uuid(),
    current_setting('upr.npa.occurrence'),
    current_setting('upr.npa.employee_admin'),
    'appointment.updated',
    'bell',
    gen_random_uuid()
  )
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $delivery_claim$
DECLARE
  v_delivery_key uuid := gen_random_uuid();
  v_target uuid := gen_random_uuid();
BEGIN
  IF public.claim_notification_delivery(
       v_delivery_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_admin')::uuid,
       'appointment.updated',
       'bell',
       v_target
     ) IS NOT TRUE
     OR public.claim_notification_delivery(
       v_delivery_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_admin')::uuid,
       'appointment.updated',
       'bell',
       v_target
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'delivery occurrence was not claimed exactly once';
  END IF;
END;
$delivery_claim$;

RESET ROLE;

DO $containment$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.notification_types catalog
    WHERE catalog.type_key IN (
      'appointment.assigned',
      'appointment.updated',
      'appointment.canceled',
      'timesheet.change_requested',
      'timesheet.change_reviewed'
    )
      AND catalog.enabled IS TRUE
  )
     OR EXISTS (
       SELECT 1
       FROM public.notification_producer_occurrences occurrence
       WHERE occurrence.occurrence_key LIKE 'timesheet.%'
          OR occurrence.occurrence_key LIKE 'appointment.%'
     ) THEN
    RAISE EXCEPTION 'disabled producer emitted or a catalog flag changed';
  END IF;
END;
$containment$;

ROLLBACK;
