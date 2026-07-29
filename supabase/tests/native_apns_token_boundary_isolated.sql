-- Isolated behavioral test for 20260728223000_native_apns_token_boundary.sql.
-- Run only against a disposable local Supabase database after the migration.

BEGIN;

INSERT INTO public.employees (
  id,
  auth_user_id,
  is_active,
  is_external,
  role
)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    true,
    false,
    'field_tech'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    true,
    false,
    'field_tech'
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.upsert_my_native_device_token(
    'local-owner-a-sandbox-token',
    'sandbox'
  );
  IF v_result ->> 'apns_environment' <> 'sandbox'
     OR v_result ? 'token' THEN
    RAISE EXCEPTION 'native enrollment did not return redacted sandbox metadata';
  END IF;
END;
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.upsert_my_native_device_token(
      'local-invalid-environment-token',
      'staging'
    );
    RAISE EXCEPTION 'invalid APNs environment unexpectedly accepted';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
END;
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.upsert_my_native_device_token(
      'local-null-environment-token',
      NULL
    );
    RAISE EXCEPTION 'NULL APNs environment unexpectedly accepted';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
END;
$test$;

DO $test$
BEGIN
  FOR v_position IN 1..6 LOOP
    PERFORM public.upsert_my_native_device_token(
      'local-owner-a-cap-token-' || v_position,
      'sandbox'
    );
  END LOOP;
END;
$test$;

RESET ROLE;

DO $test$
BEGIN
  IF (
    SELECT count(*)
    FROM public.device_tokens
    WHERE employee_id = '11111111-1111-4111-8111-111111111111'
      AND platform = 'ios'
      AND apns_environment = 'sandbox'
  ) <> 5 THEN
    RAISE EXCEPTION 'native enrollment did not cap one environment at five tokens';
  END IF;
END;
$test$;

INSERT INTO public.device_tokens (
  employee_id,
  token,
  platform,
  apns_environment
)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'local-owner-b-production-token',
  'ios',
  'production'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $test$
BEGIN
  BEGIN
    PERFORM public.upsert_my_native_device_token(
      'local-owner-b-production-token',
      'sandbox'
    );
    RAISE EXCEPTION 'foreign token unexpectedly reassigned';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL;
  END;
END;
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.delete_my_native_device_token(
      'local-owner-b-production-token'
    );
    RAISE EXCEPTION 'foreign token unexpectedly deleted';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL;
  END;
END;
$test$;

SELECT public.upsert_my_native_device_token(
  'local-owner-a-delete-proof-token',
  'production'
);

RESET ROLE;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.device_tokens
    WHERE token = 'local-owner-a-delete-proof-token'
      AND employee_id = '11111111-1111-4111-8111-111111111111'
      AND apns_environment = 'production'
  ) THEN
    RAISE EXCEPTION
      'owner delete proof token was not present immediately before deletion';
  END IF;
END;
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT public.delete_my_native_device_token(
  'local-owner-a-delete-proof-token'
);

RESET ROLE;

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.device_tokens
    WHERE token = 'local-owner-a-delete-proof-token'
  ) THEN
    RAISE EXCEPTION 'owner token was not deleted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.device_tokens
    WHERE token = 'local-owner-b-production-token'
      AND apns_environment = 'production'
  ) THEN
    RAISE EXCEPTION 'foreign production token was changed or deleted';
  END IF;
END;
$test$;

DO $test$
BEGIN
  IF has_function_privilege(
       'anon',
       'public.upsert_my_native_device_token(text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.delete_my_native_device_token(text)',
       'EXECUTE'
     )
     OR has_table_privilege('authenticated', 'public.device_tokens', 'SELECT')
     OR has_table_privilege('anon', 'public.device_tokens', 'SELECT') THEN
    RAISE EXCEPTION 'native token least-privilege boundary is open';
  END IF;
END;
$test$;

ROLLBACK;
