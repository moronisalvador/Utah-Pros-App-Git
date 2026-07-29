-- Isolated behavioral test for
-- 20260728224000_native_push_delivery_guardrails.sql.
-- Run only against a disposable local Supabase database after the ordered
-- native Push migrations.

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
    '31111111-1111-4111-8111-111111111111',
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    true,
    false,
    'field_tech'
  ),
  (
    '32222222-2222-4222-8222-222222222222',
    'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    true,
    false,
    'field_tech'
  );

INSERT INTO public.notification_types (
  type_key,
  label,
  category,
  sort_order,
  enabled,
  bell_default,
  push_default,
  email_default
)
VALUES (
  'local.native.guardrail',
  'Local native guardrail',
  'operations',
  1,
  true,
  true,
  true,
  false
);

INSERT INTO public.notification_role_defaults (
  role,
  type_key,
  channel,
  enabled,
  user_customizable
)
VALUES
  (
    'field_tech',
    'local.native.guardrail',
    'push',
    true,
    true
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',
  true
);

DO $test$
DECLARE
  v_pref public.notification_prefs;
BEGIN
  PERFORM public.get_my_notification_prefs(
    '31111111-1111-4111-8111-111111111111'
  );

  v_pref := public.set_my_notification_pref(
    '31111111-1111-4111-8111-111111111111',
    'local.native.guardrail',
    'push',
    false
  );

  IF v_pref.employee_id <> '31111111-1111-4111-8111-111111111111'
     OR v_pref.enabled IS NOT FALSE THEN
    RAISE EXCEPTION 'employee could not update own notification preference';
  END IF;
END;
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.get_effective_notification_prefs(
      '32222222-2222-4222-8222-222222222222'
    );
    RAISE EXCEPTION 'employee unexpectedly read another employee preferences';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.set_my_notification_pref(
      '32222222-2222-4222-8222-222222222222',
      'local.native.guardrail',
      'push',
      false
    );
    RAISE EXCEPTION 'employee unexpectedly changed another employee preference';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL;
  END;
END;
$test$;

DO $test$
BEGIN
  IF has_table_privilege(
       'authenticated',
       'public.notification_prefs',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.notification_prefs',
       'INSERT'
     )
     OR has_table_privilege(
       'anon',
       'public.notification_prefs',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'notification preference table bypass remains open';
  END IF;
END;
$test$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"service_role"}',
  true
);

DO $test$
BEGIN
  PERFORM public.get_effective_notification_prefs(
    '32222222-2222-4222-8222-222222222222'
  );
END;
$test$;

INSERT INTO public.device_tokens (
  id,
  employee_id,
  token,
  platform,
  apns_environment,
  updated_at
)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  '31111111-1111-4111-8111-111111111111',
  'local-guardrail-token',
  'ios',
  'sandbox',
  '2026-07-28T12:00:00Z'
);

INSERT INTO public.native_push_delivery_claims (
  delivery_key,
  employee_id,
  device_fingerprint,
  claimed_at
)
VALUES (
  '36666666-6666-4666-8666-666666666666',
  '31111111-1111-4111-8111-111111111111',
  '39999999-9999-4999-8999-999999999999',
  '2020-01-01T00:00:00Z'
);

DO $test$
DECLARE
  v_first boolean;
  v_replay boolean;
  v_distinct boolean;
BEGIN
  v_first := public.claim_native_push_delivery(
    '34444444-4444-4444-8444-444444444444',
    '31111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '38888888-8888-4888-8888-888888888888'
  );
  v_replay := public.claim_native_push_delivery(
    '34444444-4444-4444-8444-444444444444',
    '31111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '38888888-8888-4888-8888-888888888888'
  );
  v_distinct := public.claim_native_push_delivery(
    '35555555-5555-4555-8555-555555555555',
    '31111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '38888888-8888-4888-8888-888888888888'
  );

  IF v_first IS NOT TRUE
     OR v_replay IS NOT FALSE
     OR v_distinct IS NOT TRUE THEN
    RAISE EXCEPTION
      'native delivery claim did not enforce one source-event/device send';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.native_push_delivery_claims
    WHERE delivery_key = '36666666-6666-4666-8666-666666666666'
  ) THEN
    RAISE EXCEPTION 'expired native delivery claim was not bounded';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_changed boolean;
  v_too_old boolean;
  v_exact boolean;
  v_replay_after_reregister boolean;
BEGIN
  v_changed := public.prune_stale_native_device_token(
    '33333333-3333-4333-8333-333333333333',
    'local-guardrail-token',
    'sandbox',
    '2026-07-28T11:59:59Z',
    '2026-07-28T12:01:00Z'
  );
  v_too_old := public.prune_stale_native_device_token(
    '33333333-3333-4333-8333-333333333333',
    'local-guardrail-token',
    'sandbox',
    '2026-07-28T12:00:00Z',
    '2026-07-28T11:59:59Z'
  );

  IF v_changed IS NOT FALSE OR v_too_old IS NOT FALSE THEN
    RAISE EXCEPTION 'stale APNs response deleted a newer token registration';
  END IF;

  v_exact := public.prune_stale_native_device_token(
    '33333333-3333-4333-8333-333333333333',
    'local-guardrail-token',
    'sandbox',
    '2026-07-28T12:00:00Z',
    '2026-07-28T12:01:00Z'
  );

  IF v_exact IS NOT TRUE THEN
    RAISE EXCEPTION 'exact stale APNs token version was not pruned';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.native_push_delivery_claims
    WHERE delivery_key = '34444444-4444-4444-8444-444444444444'
  ) THEN
    RAISE EXCEPTION 'token deletion erased native delivery replay history';
  END IF;

  INSERT INTO public.device_tokens (
    id,
    employee_id,
    token,
    platform,
    apns_environment,
    updated_at
  )
  VALUES (
    '37777777-7777-4777-8777-777777777777',
    '31111111-1111-4111-8111-111111111111',
    'local-guardrail-token',
    'ios',
    'sandbox',
    '2026-07-28T12:02:00Z'
  );

  v_replay_after_reregister := public.claim_native_push_delivery(
    '34444444-4444-4444-8444-444444444444',
    '31111111-1111-4111-8111-111111111111',
    '37777777-7777-4777-8777-777777777777',
    '38888888-8888-4888-8888-888888888888'
  );

  IF v_replay_after_reregister IS NOT FALSE THEN
    RAISE EXCEPTION
      'token re-registration reopened a claimed native source event';
  END IF;
END;
$test$;

RESET ROLE;

DO $test$
BEGIN
  IF has_table_privilege(
       'authenticated',
       'public.native_push_delivery_claims',
       'SELECT'
     )
     OR has_table_privilege(
       'anon',
       'public.native_push_delivery_claims',
       'SELECT'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_native_push_delivery(uuid,uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.prune_stale_native_device_token(uuid,text,text,timestamptz,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'native Push service-role boundary is open';
  END IF;

  IF position(
       'notification_event_id' IN (
         SELECT p.prosrc
         FROM pg_proc p
         WHERE p.oid = 'public.notify_emit(text,jsonb)'::regprocedure
       )
     ) = 0 THEN
    RAISE EXCEPTION 'notify_emit did not add a source-event identity';
  END IF;
END;
$test$;

ROLLBACK;
