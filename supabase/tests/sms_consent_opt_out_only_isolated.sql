-- Isolated behavioral test for 20260728000000_sms_consent_opt_out_only.sql.
-- Run only against a disposable local Supabase database after the migration.

BEGIN;

INSERT INTO public.contacts (
  id,
  name,
  phone,
  dnd,
  opt_in_status,
  opt_in_source,
  opt_out_at
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Existing Client',
    '+18015550101',
    false,
    false,
    null,
    null
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Duplicate DND',
    '+1 (801) 555-0102',
    false,
    false,
    null,
    null
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'Duplicate DND Shadow',
    '801-555-0102',
    true,
    false,
    null,
    null
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'Explicit Opt Out',
    '+18015550103',
    false,
    true,
    'legacy',
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'Global Opt In',
    '+18015550104',
    false,
    true,
    'web_form',
    null
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    'Pending Stop',
    '+18015550105',
    false,
    false,
    null,
    null
  );

INSERT INTO public.message_provider_events (
  direction,
  message_type,
  processing_state,
  sender_address,
  content,
  occurred_at
)
VALUES (
  'inbound',
  'sms',
  'received',
  '+18015550105',
  'STOP',
  now()
);

SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_service_sms_consent_status(
    '10000000-0000-4000-8000-000000000001',
    '+18015550101'
  );
  IF v_result ->> 'code' <> 'IMPLIED_CONSENT'
     OR v_result ->> 'source' <> 'no_recorded_objection'
     OR (v_result ->> 'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'existing-client implied decision failed: %', v_result;
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_service_sms_consent_status(
    '10000000-0000-4000-8000-000000000002',
    '+18015550102'
  );
  IF v_result ->> 'code' <> 'DND_ACTIVE'
     OR (v_result ->> 'allowed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'duplicate-phone DND did not win: %', v_result;
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_service_sms_consent_status(
    '10000000-0000-4000-8000-000000000004',
    '+18015550103'
  );
  IF v_result ->> 'code' <> 'NO_CONSENT'
     OR v_result ->> 'source' <> 'explicit_opt_out'
     OR (v_result ->> 'allowed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'explicit opt-out did not win: %', v_result;
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_service_sms_consent_status(
    '10000000-0000-4000-8000-000000000006',
    '+18015550105'
  );
  IF v_result ->> 'code' <> 'NO_CONSENT'
     OR v_result ->> 'source' <> 'pending_stop'
     OR (v_result ->> 'allowed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'pending STOP did not win: %', v_result;
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_service_sms_consent_status(
    '10000000-0000-4000-8000-000000000005',
    '+18015550104'
  );
  IF v_result ->> 'code' <> 'GLOBAL_OPT_IN'
     OR (v_result ->> 'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'recorded global opt-in regressed: %', v_result;
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_service_sms_consent_status(
    '10000000-0000-4000-8000-000000000001',
    '+18015559999'
  );
  IF v_result ->> 'code' <> 'CONTACT_PHONE_MISMATCH'
     OR (v_result ->> 'allowed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'destination mismatch did not fail closed: %', v_result;
  END IF;
END;
$test$;

RESET ROLE;

DO $test$
BEGIN
  IF has_function_privilege(
       'authenticated',
       'public.get_service_sms_consent_status(uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.get_service_sms_consent_status(uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.get_service_sms_consent_status(uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'consent decision ACL drifted';
  END IF;
END;
$test$;

ROLLBACK;
