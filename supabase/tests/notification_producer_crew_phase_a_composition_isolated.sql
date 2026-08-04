-- ═══════════════════════════════════════════════════════════════════════════════
-- FILE: notification_producer_crew_phase_a_composition_isolated.sql
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   On a disposable local database only, proves the five contained notification
--   producers bind browser actors to auth.uid(), deny inactive/external/cross-
--   account writes, serialize
--   timesheet submit/review decisions, and atomically bind each bell/native/
--   Web Push/email delivery claim to the current recipient and target.
--
-- DEPENDS ON:
--   Packages:  PostgreSQL, Supabase CLI
--   Internal:  20260804153859_notification_producer_crew_phase_a_composition.sql
--   Data:      reads  → appointments, appointment_crew, employees,
--                       job_time_entries, device_tokens, push_subscriptions,
--                       notification delivery/occurrence state
--              writes → disposable test rows in those same local tables
--
-- NOTES / GOTCHAS:
--   - Run only through the governed local database runner. It supplies both
--     UPR_ISOLATED_DB=1 and upr.isolated_test_database=on; this file refuses
--     every other target and rolls back its fixture work.
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
    WHERE migration.name = 'notification_producer_crew_phase_a_composition'
  )
     OR to_regprocedure(
       'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'apply notification_producer_crew_phase_a_composition to the disposable clone first';
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
  PERFORM set_config('upr.npa.device_token', gen_random_uuid()::text, true);
  PERFORM set_config('upr.npa.push_subscription', gen_random_uuid()::text, true);
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
  email,
  auth_user_id,
  role,
  is_active,
  is_external
)
VALUES
  (
    current_setting('upr.npa.employee_tech')::uuid,
    '[NPA isolated] Tech',
    'npa-tech@example.invalid',
    current_setting('upr.npa.auth_tech')::uuid,
    'field_tech',
    true,
    false
  ),
  (
    current_setting('upr.npa.employee_other')::uuid,
    '[NPA isolated] Other tech',
    NULL,
    current_setting('upr.npa.auth_other')::uuid,
    'field_tech',
    true,
    false
  ),
  (
    current_setting('upr.npa.employee_admin')::uuid,
    '[NPA isolated] Admin',
    NULL,
    current_setting('upr.npa.auth_admin')::uuid,
    'admin',
    true,
    false
  ),
  (
    current_setting('upr.npa.employee_inactive')::uuid,
    '[NPA isolated] Inactive',
    NULL,
    current_setting('upr.npa.auth_inactive')::uuid,
    'field_tech',
    false,
    false
  ),
  (
    current_setting('upr.npa.employee_external')::uuid,
    '[NPA isolated] External',
    NULL,
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

INSERT INTO public.device_tokens (
  id,
  employee_id,
  token,
  platform,
  apns_environment
)
VALUES (
  current_setting('upr.npa.device_token')::uuid,
  current_setting('upr.npa.employee_tech')::uuid,
  'npa-local-device-token',
  'ios',
  'sandbox'
);

INSERT INTO public.push_subscriptions (
  id,
  employee_id,
  endpoint,
  p256dh,
  auth
)
VALUES (
  current_setting('upr.npa.push_subscription')::uuid,
  current_setting('upr.npa.employee_tech')::uuid,
  'https://push.example.invalid/npa-current',
  'npa-local-p256dh',
  'npa-local-auth'
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
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('upr.npa.auth_tech'), 'role', 'authenticated')::text,
  true
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

DO $guarded_delivery_claims$
DECLARE
  v_native_key uuid := gen_random_uuid();
  v_native_fingerprint uuid := gen_random_uuid();
  v_pwa_key uuid := gen_random_uuid();
  v_pwa_fingerprint uuid := gen_random_uuid();
  v_email_key uuid := gen_random_uuid();
  v_email_fingerprint uuid := gen_random_uuid();
  v_native_recipient_valid boolean;
  v_native_token_valid boolean;
  v_native_first boolean;
  v_native_duplicate boolean;
  v_native_row_valid boolean;
  v_pwa_first boolean;
  v_pwa_duplicate boolean;
  v_email_first boolean;
  v_email_duplicate boolean;
  v_release_first boolean;
  v_release_duplicate boolean;
  v_reclaim boolean;
BEGIN
  v_native_recipient_valid := public.validate_notification_producer_delivery(
    current_setting('upr.npa.occurrence')::uuid,
    'appointment.updated',
    'appointment',
    current_setting('upr.npa.appointment')::uuid,
    current_setting('upr.npa.employee_tech')::uuid
  );
  SELECT EXISTS (
    SELECT 1
    FROM public.device_tokens token
    WHERE token.id = current_setting('upr.npa.device_token')::uuid
      AND token.employee_id = current_setting('upr.npa.employee_tech')::uuid
      AND token.token = 'npa-local-device-token'
      AND token.platform = 'ios'
      AND token.apns_environment = 'sandbox'
  ) INTO v_native_token_valid;
  v_native_first := public.claim_guarded_native_push_delivery(
       v_native_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.device_token')::uuid,
       v_native_fingerprint,
       'npa-local-device-token',
       'sandbox'
     );
  v_native_duplicate := public.claim_guarded_native_push_delivery(
       v_native_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.device_token')::uuid,
       v_native_fingerprint,
       'npa-local-device-token',
       'sandbox'
     );
  SELECT EXISTS (
    SELECT 1
    FROM public.native_push_delivery_claims claim
    WHERE claim.delivery_key = v_native_key
      AND claim.employee_id = current_setting('upr.npa.employee_tech')::uuid
      AND claim.device_fingerprint = v_native_fingerprint
  ) INTO v_native_row_valid;

  IF v_native_first IS NOT TRUE
     OR v_native_duplicate IS NOT FALSE
     OR v_native_row_valid IS NOT TRUE THEN
    RAISE EXCEPTION
      'native delivery did not bind the current device exactly once (recipient=%, token=%, first=%, duplicate=%, row=%)',
      v_native_recipient_valid,
      v_native_token_valid,
      v_native_first,
      v_native_duplicate,
      v_native_row_valid;
  END IF;

  IF public.claim_guarded_native_push_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.device_token')::uuid,
       gen_random_uuid(),
       'npa-stale-device-token',
       'sandbox'
     ) IS NOT FALSE
     OR public.claim_guarded_native_push_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.device_token')::uuid,
       gen_random_uuid(),
       'npa-local-device-token',
       'production'
     ) IS NOT FALSE
     OR public.claim_guarded_native_push_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       gen_random_uuid(),
       gen_random_uuid(),
       'npa-local-device-token',
       'sandbox'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION
      'native delivery accepted a stale token, environment, or source id';
  END IF;

  DELETE FROM public.device_tokens
  WHERE id = current_setting('upr.npa.device_token')::uuid;
  IF public.claim_guarded_native_push_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.device_token')::uuid,
       gen_random_uuid(),
       'npa-local-device-token',
       'sandbox'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'native delivery accepted a deleted token';
  END IF;
  INSERT INTO public.device_tokens (
    id,
    employee_id,
    token,
    platform,
    apns_environment
  )
  VALUES (
    current_setting('upr.npa.device_token')::uuid,
    current_setting('upr.npa.employee_tech')::uuid,
    'npa-local-device-token',
    'ios',
    'sandbox'
  );

  UPDATE public.device_tokens
  SET employee_id = current_setting('upr.npa.employee_other')::uuid
  WHERE id = current_setting('upr.npa.device_token')::uuid;
  IF public.claim_guarded_native_push_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.device_token')::uuid,
       gen_random_uuid(),
       'npa-local-device-token',
       'sandbox'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'native delivery accepted a reassigned token';
  END IF;
  UPDATE public.device_tokens
  SET employee_id = current_setting('upr.npa.employee_tech')::uuid
  WHERE id = current_setting('upr.npa.device_token')::uuid;

  v_pwa_first := public.claim_guarded_notification_target_delivery(
       v_pwa_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'pwa_push',
       v_pwa_fingerprint,
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.push_subscription')::uuid,
       'https://push.example.invalid/npa-current'
     );
  v_pwa_duplicate := public.claim_guarded_notification_target_delivery(
       v_pwa_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'pwa_push',
       v_pwa_fingerprint,
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.push_subscription')::uuid,
       'https://push.example.invalid/npa-current'
     );
  IF v_pwa_first IS NOT TRUE OR v_pwa_duplicate IS NOT FALSE THEN
    RAISE EXCEPTION 'Web Push delivery was not claimed exactly once';
  END IF;

  IF public.claim_guarded_notification_target_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'pwa_push',
       gen_random_uuid(),
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       gen_random_uuid(),
       'https://push.example.invalid/npa-current'
     ) IS NOT FALSE
     OR public.claim_guarded_notification_target_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'pwa_push',
       gen_random_uuid(),
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.push_subscription')::uuid,
       'https://push.example.invalid/npa-stale'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'Web Push delivery accepted a stale source or endpoint';
  END IF;

  UPDATE public.push_subscriptions
  SET employee_id = current_setting('upr.npa.employee_other')::uuid
  WHERE id = current_setting('upr.npa.push_subscription')::uuid;
  IF public.claim_guarded_notification_target_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'pwa_push',
       gen_random_uuid(),
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.push_subscription')::uuid,
       'https://push.example.invalid/npa-current'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'Web Push delivery accepted a reassigned subscription';
  END IF;
  UPDATE public.push_subscriptions
  SET employee_id = current_setting('upr.npa.employee_tech')::uuid
  WHERE id = current_setting('upr.npa.push_subscription')::uuid;

  v_email_first := public.claim_guarded_notification_target_delivery(
       v_email_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'email',
       v_email_fingerprint,
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       NULL,
       ' NPA-TECH@EXAMPLE.INVALID '
     );
  v_email_duplicate := public.claim_guarded_notification_target_delivery(
       v_email_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'email',
       v_email_fingerprint,
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       NULL,
       'npa-tech@example.invalid'
     );
  IF v_email_first IS NOT TRUE
     OR v_email_duplicate IS NOT FALSE
     OR public.claim_guarded_notification_target_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'email',
       gen_random_uuid(),
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       NULL,
       'npa-wrong@example.invalid'
     ) IS NOT FALSE
     OR public.claim_guarded_notification_target_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'email',
       gen_random_uuid(),
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.push_subscription')::uuid,
       'npa-tech@example.invalid'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION
      'email delivery did not bind the normalized current address exactly once';
  END IF;

  UPDATE public.employees
  SET is_active = false
  WHERE id = current_setting('upr.npa.employee_tech')::uuid;
  IF public.claim_guarded_notification_target_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'email',
       gen_random_uuid(),
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       NULL,
       'npa-tech@example.invalid'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'email delivery accepted an inactive employee';
  END IF;
  UPDATE public.employees
  SET is_active = true,
      is_external = true
  WHERE id = current_setting('upr.npa.employee_tech')::uuid;
  IF public.claim_guarded_notification_target_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'email',
       gen_random_uuid(),
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       NULL,
       'npa-tech@example.invalid'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'email delivery accepted an external employee';
  END IF;
  UPDATE public.employees
  SET is_external = false
  WHERE id = current_setting('upr.npa.employee_tech')::uuid;

  PERFORM public.sync_appointment_crew(
    current_setting('upr.npa.appointment')::uuid,
    '[]'::jsonb,
    current_setting('upr.npa.employee_admin')::uuid
  );
  IF public.claim_guarded_notification_target_delivery(
       gen_random_uuid(),
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'email',
       gen_random_uuid(),
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       NULL,
       'npa-tech@example.invalid'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION 'email delivery accepted a removed appointment assignee';
  END IF;
  PERFORM public.sync_appointment_crew(
    current_setting('upr.npa.appointment')::uuid,
    jsonb_build_array(jsonb_build_object(
      'employee_id', current_setting('upr.npa.employee_tech'),
      'role', 'tech'
    )),
    current_setting('upr.npa.employee_admin')::uuid
  );

  v_release_first := public.release_notification_delivery_claim(v_pwa_key);
  v_release_duplicate := public.release_notification_delivery_claim(v_pwa_key);
  v_reclaim := public.claim_guarded_notification_target_delivery(
       v_pwa_key,
       current_setting('upr.npa.occurrence')::uuid,
       current_setting('upr.npa.employee_tech')::uuid,
       'appointment.updated',
       'pwa_push',
       v_pwa_fingerprint,
       'appointment',
       current_setting('upr.npa.appointment')::uuid,
       current_setting('upr.npa.push_subscription')::uuid,
       'https://push.example.invalid/npa-current'
     );
  IF v_release_first IS NOT TRUE
     OR v_release_duplicate IS NOT FALSE
     OR v_reclaim IS NOT TRUE THEN
    RAISE EXCEPTION
      'definitive target release did not permit exactly one safe reclaim';
  END IF;
END;
$guarded_delivery_claims$;

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
