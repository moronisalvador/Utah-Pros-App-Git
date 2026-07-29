-- Isolated behavioral test for
-- 20260729181049_notification_delivery_diagnostic_claims.sql.
-- Run only against qa-staging or a disposable local Supabase database after
-- applying the exact migration. Every synthetic row is rolled back.

BEGIN;

DO $test$
BEGIN
  IF has_table_privilege(
       'anon',
       'public.notification_delivery_diagnostic_claims',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.notification_delivery_diagnostic_claims',
       'SELECT'
     )
     OR has_function_privilege(
       'anon',
       'public.claim_notification_delivery_diagnostic(uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.complete_notification_delivery_diagnostic(uuid,text,uuid,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'browser notification diagnostic access is open';
  END IF;
END;
$test$;

INSERT INTO public.employees (
  id,
  full_name,
  email,
  role,
  is_active,
  is_external
)
VALUES (
  '71111111-1111-4111-8111-111111111111',
  'Notification Diagnostic QA Owner',
  'notification-diagnostic-owner@upr-qa.test',
  'admin',
  true,
  false
);

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"service_role"}',
  true
);

INSERT INTO public.notification_delivery_diagnostic_claims (
  employee_id,
  channel,
  request_id,
  claimed_at
)
VALUES (
  '71111111-1111-4111-8111-111111111111',
  'bell',
  '72222222-2222-4222-8222-222222222222',
  '2020-01-01T00:00:00Z'
);

DO $test$
DECLARE
  v_first jsonb;
  v_pending_replay jsonb;
  v_complete jsonb;
  v_complete_replay jsonb;
  v_other_channel jsonb;
BEGIN
  v_first := public.claim_notification_delivery_diagnostic(
    '71111111-1111-4111-8111-111111111111',
    'web_push',
    '73333333-3333-4333-8333-333333333333'
  );
  v_pending_replay := public.claim_notification_delivery_diagnostic(
    '71111111-1111-4111-8111-111111111111',
    'web_push',
    '73333333-3333-4333-8333-333333333333'
  );

  IF (v_first->>'claimed')::boolean IS NOT TRUE
     OR (v_pending_replay->>'claimed')::boolean IS NOT FALSE
     OR v_pending_replay->>'state' <> 'pending' THEN
    RAISE EXCEPTION 'notification diagnostic pending claim replay failed';
  END IF;

  v_complete := public.complete_notification_delivery_diagnostic(
    '71111111-1111-4111-8111-111111111111',
    'web_push',
    '73333333-3333-4333-8333-333333333333',
    '{
      "channel":"web_push",
      "ok":true,
      "sent":1,
      "attempted":1,
      "pruned":0
    }'::jsonb
  );
  v_complete_replay := public.claim_notification_delivery_diagnostic(
    '71111111-1111-4111-8111-111111111111',
    'web_push',
    '73333333-3333-4333-8333-333333333333'
  );

  IF (v_complete->>'completed')::boolean IS NOT TRUE
     OR v_complete_replay->>'state' <> 'complete'
     OR v_complete_replay->'result'->>'channel' <> 'web_push'
     OR (v_complete_replay->'result'->>'sent')::integer <> 1 THEN
    RAISE EXCEPTION 'notification diagnostic completed result replay failed';
  END IF;

  v_other_channel := public.claim_notification_delivery_diagnostic(
    '71111111-1111-4111-8111-111111111111',
    'email',
    '73333333-3333-4333-8333-333333333333'
  );
  IF (v_other_channel->>'claimed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'notification diagnostic channel identity collided';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notification_delivery_diagnostic_claims
    WHERE request_id = '72222222-2222-4222-8222-222222222222'
  ) THEN
    RAISE EXCEPTION 'expired notification diagnostic claim was not bounded';
  END IF;
END;
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.claim_notification_delivery_diagnostic(
      '71111111-1111-4111-8111-111111111111',
      'sms',
      '74444444-4444-4444-8444-444444444444'
    );
    RAISE EXCEPTION 'unsupported diagnostic channel was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
END;
$test$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  BEGIN
    PERFORM public.claim_notification_delivery_diagnostic(
      '71111111-1111-4111-8111-111111111111',
      'bell',
      '75555555-5555-4555-8555-555555555555'
    );
    RAISE EXCEPTION 'authenticated caller claimed a notification diagnostic';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$test$;

ROLLBACK;
