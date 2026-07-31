-- Isolated behavioral test for 20260730170000_device_token_apns_topic.sql.
-- Run only against a disposable local Supabase database after the migration.
-- Proves the two load-bearing claims the static contract test cannot: the
-- exact deployed two-argument call still succeeds, and a NULL re-upsert from
-- an older client never erases a recorded topic (the COALESCE guarantee).

BEGIN;

INSERT INTO public.employees (
  id,
  auth_user_id,
  is_active,
  is_external,
  role
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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

-- 1. The exact deployed two-argument call still resolves, succeeds, and
--    records no topic.
DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.upsert_my_native_device_token(
    'local-topic-compat-token',
    'sandbox'
  );
  IF v_result ->> 'apns_environment' <> 'sandbox'
     OR (v_result ->> 'apns_topic') IS NOT NULL
     OR v_result ? 'token' THEN
    RAISE EXCEPTION
      'two-argument enrollment did not succeed with a null topic';
  END IF;
END;
$test$;

-- 2. A topic-carrying call stores and returns the bundle id.
DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.upsert_my_native_device_token(
    'local-topic-compat-token',
    'sandbox',
    'com.example.upr.dev'
  );
  IF v_result ->> 'apns_topic' <> 'com.example.upr.dev' THEN
    RAISE EXCEPTION
      'topic-carrying enrollment did not record the bundle id';
  END IF;
END;
$test$;

-- 3. An older client's two-argument re-upsert of the SAME token must not
--    erase the recorded topic.
DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.upsert_my_native_device_token(
    'local-topic-compat-token',
    'sandbox'
  );
  IF v_result ->> 'apns_topic' IS DISTINCT FROM 'com.example.upr.dev' THEN
    RAISE EXCEPTION
      'NULL re-upsert erased the recorded topic (COALESCE guarantee broken)';
  END IF;
END;
$test$;

-- 4. A malformed topic is refused loudly, not stored or degraded.
DO $test$
BEGIN
  BEGIN
    PERFORM public.upsert_my_native_device_token(
      'local-topic-malformed-token',
      'sandbox',
      'bad topic with spaces'
    );
    RAISE EXCEPTION 'malformed topic unexpectedly accepted';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
END;
$test$;

RESET ROLE;

-- Row-level proof of the stored value (the RPC result alone could lie), and
-- proof the malformed attempt left no row behind.
DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.device_tokens
    WHERE token = 'local-topic-compat-token'
      AND apns_topic = 'com.example.upr.dev'
  ) THEN
    RAISE EXCEPTION 'stored row does not carry the recorded topic';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.device_tokens
    WHERE token = 'local-topic-malformed-token'
  ) THEN
    RAISE EXCEPTION 'refused malformed-topic call still inserted a row';
  END IF;
END;
$test$;

-- Single function, least-privilege boundary intact on the new signature.
DO $test$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = 'upsert_my_native_device_token'
  ) <> 1 THEN
    RAISE EXCEPTION 'unexpected upsert_my_native_device_token overload';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.upsert_my_native_device_token(text,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.upsert_my_native_device_token(text,text,text)',
       'EXECUTE'
     )
     OR has_table_privilege('authenticated', 'public.device_tokens', 'SELECT')
     OR has_table_privilege('anon', 'public.device_tokens', 'SELECT')
     OR EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'device_tokens'
     ) THEN
    RAISE EXCEPTION 'per-token topic least-privilege boundary is open';
  END IF;
END;
$test$;

ROLLBACK;
