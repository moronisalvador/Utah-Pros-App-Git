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
       'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)'
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
  PERFORM set_config('upr.npa.auth_orphan', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_tech', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_other', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_admin', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_inactive', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.employee_external', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.job', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.owned_appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.service_appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.private_appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.entry', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.occurrence', gen_random_uuid()::text, true);
  PERFORM set_config(
    'upr.npa.requested_occurrence',
    gen_random_uuid()::text,
    true
  );
  PERFORM set_config(
    'upr.npa.reviewed_occurrence',
    gen_random_uuid()::text,
    true
  );
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
  'upr.npa.auth_external',
  'upr.npa.auth_orphan'
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
VALUES
  (
    current_setting('upr.npa.appointment')::uuid,
    current_setting('upr.npa.job')::uuid,
    '[NPA isolated] Appointment',
    CURRENT_DATE
  ),
  (
    current_setting('upr.npa.service_appointment')::uuid,
    current_setting('upr.npa.job')::uuid,
    '[NPA isolated] Service appointment',
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

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_other'),
    'role',
    'authenticated'
  )::text,
  true
);
DO $unassigned_public_update$
BEGIN
  UPDATE public.appointments
  SET notes = '[NPA isolated] unassigned public write'
  WHERE id = current_setting('upr.npa.appointment')::uuid;

  IF FOUND THEN
    RAISE EXCEPTION 'unassigned tech mutated a public appointment';
  END IF;
END;
$unassigned_public_update$;

SELECT pg_temp.expect_sqlstate(
  'unassigned tech cannot update a public appointment through RPC',
  format(
    'SELECT public.update_appointment(%L::uuid,NULL,NULL,NULL,%L,NULL,NULL,NULL,NULL)',
    current_setting('upr.npa.appointment'),
    '[NPA isolated] unassigned RPC write'
  )
);

DO $unassigned_public_delete$
BEGIN
  DELETE FROM public.appointments
  WHERE id = current_setting('upr.npa.appointment')::uuid;

  IF FOUND THEN
    RAISE EXCEPTION 'unassigned tech directly deleted a public appointment';
  END IF;
END;
$unassigned_public_delete$;

SELECT pg_temp.expect_sqlstate(
  'unassigned tech cannot delete a public appointment through RPC',
  format(
    'SELECT public.delete_appointment(%L::uuid,NULL,NULL)',
    current_setting('upr.npa.appointment')
  )
);

SELECT pg_temp.expect_sqlstate(
  'unassigned tech cannot directly join a public appointment crew',
  format(
    'INSERT INTO public.appointment_crew (appointment_id,employee_id,role) VALUES (%L::uuid,%L::uuid,%L)',
    current_setting('upr.npa.appointment'),
    current_setting('upr.npa.employee_other'),
    'helper'
  )
);

SELECT pg_temp.expect_sqlstate(
  'unassigned tech cannot sync a public appointment crew',
  format(
    'SELECT * FROM public.sync_appointment_crew(%L::uuid,%L::jsonb)',
    current_setting('upr.npa.appointment'),
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
    )::text
  )
);

SELECT pg_temp.expect_sqlstate(
  'browser cannot forge a new appointment creator',
  format(
    'INSERT INTO public.appointments (id,job_id,title,date,created_by_employee_id) VALUES (%L::uuid,%L::uuid,%L,CURRENT_DATE,%L::uuid)',
    current_setting('upr.npa.owned_appointment'),
    current_setting('upr.npa.job'),
    '[NPA isolated] Forged owner',
    current_setting('upr.npa.employee_tech')
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
INSERT INTO public.appointments (
  id,
  job_id,
  title,
  date
)
VALUES (
  current_setting('upr.npa.owned_appointment')::uuid,
  current_setting('upr.npa.job')::uuid,
  '[NPA isolated] Caller-owned appointment',
  CURRENT_DATE
);
INSERT INTO public.appointment_crew (
  appointment_id,
  employee_id,
  role
)
VALUES (
  current_setting('upr.npa.owned_appointment')::uuid,
  current_setting('upr.npa.employee_tech')::uuid,
  'lead'
);
DO $creator_binding_compatibility$
BEGIN
  IF (
    SELECT appointment.created_by_employee_id
    FROM public.appointments appointment
    WHERE appointment.id = current_setting('upr.npa.owned_appointment')::uuid
  ) IS DISTINCT FROM current_setting('upr.npa.employee_tech')::uuid THEN
    RAISE EXCEPTION 'direct appointment creation did not bind its caller';
  END IF;

  PERFORM public.delete_appointment(
    current_setting('upr.npa.owned_appointment')::uuid,
    NULL,
    '[NPA isolated] creator compatibility'
  );
  IF EXISTS (
    SELECT 1
    FROM public.appointments appointment
    WHERE appointment.id = current_setting('upr.npa.owned_appointment')::uuid
  ) THEN
    RAISE EXCEPTION 'appointment creator could not use the compatible delete RPC';
  END IF;
END;
$creator_binding_compatibility$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SELECT public.update_appointment(
  p_appointment_id => current_setting('upr.npa.appointment')::uuid,
  p_date => CURRENT_DATE + 1,
  p_actor_id => current_setting('upr.npa.employee_admin')::uuid
);
SELECT public.delete_appointment(
  p_appointment_id => current_setting('upr.npa.service_appointment')::uuid,
  p_actor_id => current_setting('upr.npa.employee_admin')::uuid,
  p_reason => '[NPA isolated] trusted caller compatibility'
);
DO $trusted_actor_history$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.appointment_status_history history
    WHERE history.appointment_id = current_setting('upr.npa.appointment')::uuid
      AND history.event_type = 'rescheduled'
      AND history.actor_id = current_setting('upr.npa.employee_admin')::uuid
  )
     OR NOT EXISTS (
       SELECT 1
       FROM public.appointment_status_history history
       WHERE history.appointment_id =
         current_setting('upr.npa.service_appointment')::uuid
         AND history.event_type = 'deleted'
         AND history.actor_id = current_setting('upr.npa.employee_admin')::uuid
     ) THEN
    RAISE EXCEPTION 'trusted caller actor was not retained in appointment history';
  END IF;
END;
$trusted_actor_history$;

RESET ROLE;
SET LOCAL ROLE authenticated;
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
DO $compatible_update$
DECLARE
  v_updated jsonb;
BEGIN
  v_updated := public.update_appointment(
    p_appointment_id => current_setting('upr.npa.appointment')::uuid,
    p_title => '[NPA isolated] Compatible RPC update',
    p_actor_id => NULL
  );
  IF v_updated ->> 'title' <> '[NPA isolated] Compatible RPC update' THEN
    RAISE EXCEPTION 'compatible update_appointment call shape failed';
  END IF;

  UPDATE public.appointments
  SET notes = '[NPA isolated] compatible direct patch'
  WHERE id = current_setting('upr.npa.appointment')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'compatible direct appointment patch failed';
  END IF;
END;
$compatible_update$;

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

UPDATE public.appointment_crew
SET role = 'lead'
WHERE appointment_id = current_setting('upr.npa.appointment')::uuid
  AND employee_id = current_setting('upr.npa.employee_tech')::uuid;

SELECT pg_temp.expect_sqlstate(
  'browser cannot relabel an existing crew occurrence to another employee',
  format(
    'UPDATE public.appointment_crew SET employee_id=%L::uuid WHERE appointment_id=%L::uuid AND employee_id=%L::uuid',
    current_setting('upr.npa.employee_admin'),
    current_setting('upr.npa.appointment'),
    current_setting('upr.npa.employee_tech')
  )
);

SELECT pg_temp.expect_sqlstate(
  'browser cannot directly assign an external employee',
  format(
    'INSERT INTO public.appointment_crew (appointment_id,employee_id,role) VALUES (%L::uuid,%L::uuid,%L)',
    current_setting('upr.npa.appointment'),
    current_setting('upr.npa.employee_external'),
    'helper'
  )
);

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
INSERT INTO public.appointments (
  id,
  job_id,
  title,
  date,
  is_private
)
VALUES (
  current_setting('upr.npa.private_appointment')::uuid,
  current_setting('upr.npa.job')::uuid,
  '[NPA isolated] Private appointment',
  CURRENT_DATE,
  true
);
INSERT INTO public.appointment_crew (
  appointment_id,
  employee_id,
  role
)
VALUES (
  current_setting('upr.npa.private_appointment')::uuid,
  current_setting('upr.npa.employee_tech')::uuid,
  'tech'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_other'),
    'role',
    'authenticated'
  )::text,
  true
);
DO $private_row_hidden$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.appointments appointment
    WHERE appointment.id = current_setting('upr.npa.private_appointment')::uuid
  ) THEN
    RAISE EXCEPTION 'unassigned employee could read a private appointment';
  END IF;
END;
$private_row_hidden$;
SELECT pg_temp.expect_sqlstate(
  'unassigned employee cannot mutate private appointment through RPC',
  format(
    'SELECT public.update_appointment(%L::uuid,NULL,NULL,NULL,%L,NULL,NULL,NULL,NULL)',
    current_setting('upr.npa.private_appointment'),
    '[NPA isolated] private forged update'
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
DO $assigned_private_access$
DECLARE
  v_updated jsonb;
BEGIN
  v_updated := public.update_appointment(
    p_appointment_id => current_setting('upr.npa.private_appointment')::uuid,
    p_notes => '[NPA isolated] assigned private update',
    p_actor_id => NULL
  );
  IF v_updated ->> 'id' <> current_setting('upr.npa.private_appointment') THEN
    RAISE EXCEPTION 'assigned employee lost private appointment access';
  END IF;
END;
$assigned_private_access$;

SELECT pg_temp.expect_sqlstate(
  'assigned tech cannot make a private appointment public',
  format(
    'UPDATE public.appointments SET is_private=false WHERE id=%L::uuid',
    current_setting('upr.npa.private_appointment')
  )
);

DO $private_stays_private$
BEGIN
  IF NOT (
    SELECT appointment.is_private
    FROM public.appointments appointment
    WHERE appointment.id = current_setting('upr.npa.private_appointment')::uuid
  ) THEN
    RAISE EXCEPTION 'failed privacy downgrade exposed the private appointment';
  END IF;
END;
$private_stays_private$;

SELECT pg_temp.expect_sqlstate(
  'assigned tech cannot delegate private appointment access through direct crew insert',
  format(
    'INSERT INTO public.appointment_crew (appointment_id,employee_id,role) VALUES (%L::uuid,%L::uuid,%L)',
    current_setting('upr.npa.private_appointment'),
    current_setting('upr.npa.employee_other'),
    'helper'
  )
);

SELECT pg_temp.expect_sqlstate(
  'assigned tech cannot delegate private appointment access through crew sync',
  format(
    'SELECT * FROM public.sync_appointment_crew(%L::uuid,%L::jsonb)',
    current_setting('upr.npa.private_appointment'),
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
    )::text
  )
);

SELECT pg_temp.expect_sqlstate(
  'tech cannot turn a public appointment private',
  format(
    'UPDATE public.appointments SET is_private=true WHERE id=%L::uuid',
    current_setting('upr.npa.appointment')
  )
);

DO $public_stays_public$
BEGIN
  IF (
    SELECT appointment.is_private
    FROM public.appointments appointment
    WHERE appointment.id = current_setting('upr.npa.appointment')::uuid
  ) IS TRUE THEN
    RAISE EXCEPTION 'failed privacy escalation changed the public appointment';
  END IF;
END;
$public_stays_public$;

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

DO $requester_read_compatibility$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.time_entry_change_requests request
    WHERE request.id = current_setting('upr.npa.request')::uuid
      AND request.requested_by =
        current_setting('upr.npa.employee_tech')::uuid
  ) THEN
    RAISE EXCEPTION 'requester could not read their own change request';
  END IF;
END;
$requester_read_compatibility$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_other'),
    'role',
    'authenticated'
  )::text,
  true
);
DO $unrelated_request_hidden$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.time_entry_change_requests request
    WHERE request.id = current_setting('upr.npa.request')::uuid
  ) THEN
    RAISE EXCEPTION 'unrelated employee read another timesheet request';
  END IF;
END;
$unrelated_request_hidden$;

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
DO $inactive_request_hidden$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.time_entry_change_requests request
    WHERE request.id = current_setting('upr.npa.request')::uuid
  ) THEN
    RAISE EXCEPTION 'inactive employee read a timesheet request';
  END IF;
END;
$inactive_request_hidden$;

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
DO $external_request_hidden$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.time_entry_change_requests request
    WHERE request.id = current_setting('upr.npa.request')::uuid
  ) THEN
    RAISE EXCEPTION 'external employee read a timesheet request';
  END IF;
END;
$external_request_hidden$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('upr.npa.auth_orphan'),
    'role',
    'authenticated'
  )::text,
  true
);
DO $orphan_request_hidden$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.time_entry_change_requests request
    WHERE request.id = current_setting('upr.npa.request')::uuid
  ) THEN
    RAISE EXCEPTION 'orphan account read a timesheet request';
  END IF;
END;
$orphan_request_hidden$;

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
DO $admin_request_read_compatibility$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.time_entry_change_requests request
    WHERE request.id = current_setting('upr.npa.request')::uuid
  ) THEN
    RAISE EXCEPTION 'admin RequestsView lost timesheet request access';
  END IF;
END;
$admin_request_read_compatibility$;

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
VALUES
  (
    current_setting('upr.npa.occurrence')::uuid,
    'appointment.updated',
    'notification-producer-authorization-isolated',
    'appointment',
    current_setting('upr.npa.appointment')::uuid
  ),
  (
    current_setting('upr.npa.requested_occurrence')::uuid,
    'timesheet.change_requested',
    'notification-producer-authorization-isolated-timesheet-request',
    'time_entry_change_request',
    current_setting('upr.npa.request')::uuid
  ),
  (
    current_setting('upr.npa.reviewed_occurrence')::uuid,
    'timesheet.change_reviewed',
    'notification-producer-authorization-isolated-timesheet-review',
    'time_entry_change_request',
    current_setting('upr.npa.request')::uuid
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
    'SELECT public.claim_notification_delivery(%L::uuid,%L::uuid,%L::uuid,%L,%L,%L::uuid,%L,%L::uuid)',
    gen_random_uuid(),
    current_setting('upr.npa.occurrence'),
    current_setting('upr.npa.employee_tech'),
    'appointment.updated',
    'bell',
    gen_random_uuid(),
    'appointment',
    current_setting('upr.npa.appointment')
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
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'bell',
       v_target,
       'appointment',
       current_setting('upr.npa.appointment')::uuid
     ) IS NOT TRUE
     OR public.claim_notification_delivery(
       v_delivery_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'bell',
       v_target,
       'appointment',
       current_setting('upr.npa.appointment')::uuid
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'delivery occurrence was not claimed exactly once';
  END IF;

  IF public.validate_notification_producer_delivery(
       current_setting('upr.npa.occurrence')::uuid,
       'appointment.updated',
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.employee_admin')::uuid
     ) IS NOT FALSE
     OR public.validate_notification_producer_delivery(
       current_setting('upr.npa.requested_occurrence')::uuid,
       'timesheet.change_requested',
       'time_entry_change_request',
       current_setting('upr.npa.request')::uuid,
       current_setting('upr.npa.employee_admin')::uuid
     ) IS NOT TRUE
     OR public.validate_notification_producer_delivery(
       current_setting('upr.npa.requested_occurrence')::uuid,
       'timesheet.change_requested',
       'time_entry_change_request',
       current_setting('upr.npa.request')::uuid,
       current_setting('upr.npa.employee_tech')::uuid
     ) IS NOT FALSE
     OR public.validate_notification_producer_delivery(
       current_setting('upr.npa.reviewed_occurrence')::uuid,
       'timesheet.change_reviewed',
       'time_entry_change_request',
       current_setting('upr.npa.request')::uuid,
       current_setting('upr.npa.employee_tech')::uuid
     ) IS NOT TRUE
     OR public.validate_notification_producer_delivery(
       current_setting('upr.npa.reviewed_occurrence')::uuid,
       'timesheet.change_reviewed',
       'time_entry_change_request',
       current_setting('upr.npa.request')::uuid,
       current_setting('upr.npa.employee_admin')::uuid
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'delivery audience was not bound to its producer entity';
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
