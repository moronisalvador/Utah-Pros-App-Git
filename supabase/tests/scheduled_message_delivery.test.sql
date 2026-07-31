-- ═══════════════════════════════════════════════════════════════════════════════
-- FILE: scheduled_message_delivery.test.sql
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Proves actor-derived scheduled creation, the one-attempt reservation fence,
--   in-flight reconciliation, exactly-once materialization, and final ACLs.
--
-- DEPENDS ON:
--   20260731220000_scheduled_message_delivery_compatibility.sql,
--   20260731220100_scheduled_message_delivery_enforcement.sql, pgTAP, and the
--   conversation-participant messaging authorization foundation.
--
-- RUN ONLY ON AN ISOLATED DATABASE:
--   npm run test:db:local
--   The governed runner supplies upr.isolated_test_database=on. Every fixture
--   and assertion in this file is enclosed by the final ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

\if :{?UPR_ISOLATED_DB}
\else
\echo 'Set UPR_ISOLATED_DB=1 only for a disposable local clone.'
\quit 2
\endif

BEGIN;
SELECT plan(1);

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name = 'scheduled_message_delivery_compatibility'
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name = 'scheduled_message_delivery_enforcement'
  ) THEN
    RAISE EXCEPTION 'apply both scheduled-message delivery migrations to the disposable clone first';
  END IF;

  IF to_regprocedure('public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.claim_scheduled_message_v2(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.reconcile_scheduled_message_delivery(uuid)') IS NULL THEN
    RAISE EXCEPTION 'scheduled-message delivery RPC dependency is absent';
  END IF;
END;
$guard$;

CREATE FUNCTION pg_temp.expect_sqlstate(p_label text, p_sql text, p_expected text)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE v_actual text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual = RETURNED_SQLSTATE;
    IF v_actual = p_expected THEN RETURN; END IF;
    RAISE EXCEPTION 'expected SQLSTATE % for %, got %', p_expected, p_label, v_actual;
  END;
  RAISE EXCEPTION 'expected SQLSTATE % but statement succeeded: %', p_expected, p_label;
END;
$function$;

INSERT INTO public.employees (id, full_name, display_name, email, auth_user_id, role, is_active, is_external)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  '[scheduled delivery test] actor',
  'Scheduled delivery actor',
  'scheduled-delivery-actor@upr-qa.test',
  'a1000000-0000-4000-8000-000000000002',
  'admin', true, false
);

UPDATE public.feature_flags SET force_disabled = false WHERE key = 'page:conversations';

INSERT INTO public.contacts (id, name, phone)
VALUES ('a1000000-0000-4000-8000-000000000003', '[scheduled delivery test] recipient', '+15550001901');

INSERT INTO public.conversations (id, type, title, status)
VALUES ('a1000000-0000-4000-8000-000000000004', 'direct', '[scheduled delivery test] conversation', 'needs_response');

INSERT INTO public.conversation_participants (conversation_id, contact_id, phone, role, is_active)
VALUES (
  'a1000000-0000-4000-8000-000000000004',
  'a1000000-0000-4000-8000-000000000003',
  '+15550001901', 'primary', true
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

DO $browser_create$
DECLARE
  v_id uuid := 'a1000000-0000-4000-8000-000000000005';
  v_phone_race_id uuid := 'a1000000-0000-4000-8000-000000000007';
  v_send_at timestamptz := now() + interval '2 minutes';
BEGIN
  IF public.create_scheduled_message(
       v_id, 'a1000000-0000-4000-8000-000000000004', '  scheduled delivery body  ', v_send_at
     ) IS DISTINCT FROM v_id
     OR public.create_scheduled_message(
       v_id, 'a1000000-0000-4000-8000-000000000004', '  scheduled delivery body  ', v_send_at
     ) IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION 'actor-derived scheduled create did not return its stable id';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'same client id with changed body',
    format('SELECT public.create_scheduled_message(%L::uuid, %L::uuid, %L, %L::timestamptz)',
      v_id, 'a1000000-0000-4000-8000-000000000004', 'different body', v_send_at),
    '23505'
  );

  IF public.create_scheduled_message(
       v_phone_race_id,
       'a1000000-0000-4000-8000-000000000004',
       'phone change race body',
       v_send_at + interval '1 minute'
     ) IS DISTINCT FROM v_phone_race_id THEN
    RAISE EXCEPTION 'phone-change race fixture was not created';
  END IF;
END;
$browser_create$;

RESET ROLE;

DO $actor_derived_persistence$
BEGIN
  IF (SELECT count(*) FROM public.scheduled_messages
      WHERE id = 'a1000000-0000-4000-8000-000000000005') <> 1
     OR (SELECT created_by FROM public.scheduled_messages
         WHERE id = 'a1000000-0000-4000-8000-000000000005')
          IS DISTINCT FROM 'a1000000-0000-4000-8000-000000000001'::uuid
     OR (SELECT body FROM public.scheduled_messages
         WHERE id = 'a1000000-0000-4000-8000-000000000005') <> 'scheduled delivery body' THEN
    RAISE EXCEPTION 'scheduled create did not derive the actor or stay idempotent';
  END IF;
END;
$actor_derived_persistence$;

SET LOCAL ROLE service_role;

DO $reservation_and_reconciliation$
DECLARE
  v_id uuid := 'a1000000-0000-4000-8000-000000000005';
  v_token uuid := 'a1000000-0000-4000-8000-000000000006';
  v_attempt uuid;
  v_replay uuid;
  v_result jsonb;
BEGIN
  IF NOT public.claim_scheduled_message_v2(v_id, v_token) THEN
    RAISE EXCEPTION 'service v2 claim did not acquire a fresh scheduled row';
  END IF;

  SELECT attempt_id INTO v_attempt
  FROM public.reserve_scheduled_message_delivery(
    v_id, v_token, 'a1000000-0000-4000-8000-000000000003', '+15550001901',
    'scheduled delivery body', 'scheduled delivery body', '[]'::jsonb
  );
  SELECT attempt_id INTO v_replay
  FROM public.reserve_scheduled_message_delivery(
    v_id, v_token, 'a1000000-0000-4000-8000-000000000003', '+15550001901',
    'scheduled delivery body', 'scheduled delivery body', '[]'::jsonb
  );
  IF v_attempt IS NULL OR v_replay IS DISTINCT FROM v_attempt
     OR (SELECT count(*) FROM public.message_send_attempts WHERE client_request_id = v_id) <> 1 THEN
    RAISE EXCEPTION 'scheduled delivery did not keep exactly one durable reservation';
  END IF;

  -- A durable link is an irreversible submission boundary: neither old nor v2
  -- claiming can turn this record back into a provider-send candidate.
  IF public.claim_scheduled_message_v2(v_id, gen_random_uuid()) THEN
    RAISE EXCEPTION 'v2 claim reclaimed a delivery-linked scheduled row';
  END IF;
  PERFORM pg_temp.expect_sqlstate(
    'retired legacy claim cannot reclaim a linked row',
    format('SELECT public.claim_scheduled_message(%L::uuid)', v_id), '42501'
  );

  v_result := public.reconcile_scheduled_message_delivery(v_id);
  IF v_result->>'status' <> 'in_flight'
     OR (v_result->>'delivery_attempt_id')::uuid IS DISTINCT FROM v_attempt
     OR (SELECT status FROM public.scheduled_messages WHERE id = v_id) <> 'pending' THEN
    RAISE EXCEPTION 'fresh in-flight scheduled delivery was not preserved for reconciliation';
  END IF;

  UPDATE public.message_send_attempts
  SET state = 'accepted', provider_message_id = 'SMscheduleddeliverytest', provider_status = 'queued', updated_at = now()
  WHERE id = v_attempt;
  v_result := public.reconcile_scheduled_message_delivery(v_id);
  IF v_result->>'status' <> 'sent'
     OR (SELECT status FROM public.scheduled_messages WHERE id = v_id) <> 'sent'
     OR (SELECT count(*) FROM public.messages WHERE client_request_id = v_id) <> 1 THEN
    RAISE EXCEPTION 'accepted scheduled delivery did not materialize exactly one canonical message';
  END IF;

  v_result := public.reconcile_scheduled_message_delivery(v_id);
  IF (v_result->>'already_terminal')::boolean IS NOT TRUE
     OR (SELECT count(*) FROM public.messages WHERE client_request_id = v_id) <> 1 THEN
    RAISE EXCEPTION 'terminal scheduled reconciliation materialized more than once';
  END IF;
END;
$reservation_and_reconciliation$;

DO $phone_change_race$
DECLARE
  v_id uuid := 'a1000000-0000-4000-8000-000000000007';
  v_token uuid := 'a1000000-0000-4000-8000-000000000008';
BEGIN
  IF NOT public.claim_scheduled_message_v2(v_id, v_token) THEN
    RAISE EXCEPTION 'phone-change race row was not claimed';
  END IF;

  UPDATE public.conversation_participants
  SET phone = '+15550001902'
  WHERE conversation_id = 'a1000000-0000-4000-8000-000000000004'
    AND contact_id = 'a1000000-0000-4000-8000-000000000003';

  PERFORM pg_temp.expect_sqlstate(
    'participant phone changed after the worker read it',
    format(
      'SELECT * FROM public.reserve_scheduled_message_delivery(%L::uuid, %L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      v_id,
      v_token,
      'a1000000-0000-4000-8000-000000000003',
      '+15550001901',
      'phone change race body',
      'phone change race body',
      '[]'
    ),
    '22023'
  );

  IF (SELECT delivery_attempt_id FROM public.scheduled_messages WHERE id = v_id) IS NOT NULL
     OR (SELECT count(*) FROM public.message_send_attempts WHERE client_request_id = v_id) <> 0 THEN
    RAISE EXCEPTION 'phone-change race created a delivery reservation';
  END IF;

  UPDATE public.conversation_participants
  SET phone = '+15550001901'
  WHERE conversation_id = 'a1000000-0000-4000-8000-000000000004'
    AND contact_id = 'a1000000-0000-4000-8000-000000000003';

  IF NOT public.fail_scheduled_message_claim(v_id, v_token, 'phone-change race test cleanup')
     OR (SELECT status FROM public.scheduled_messages WHERE id = v_id) <> 'failed' THEN
    RAISE EXCEPTION 'phone-change race row was not closed without a provider attempt';
  END IF;
END;
$phone_change_race$;

RESET ROLE;

DO $final_grants$
BEGIN
  IF has_table_privilege('authenticated', 'public.scheduled_messages', 'SELECT')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'DELETE')
     OR has_function_privilege('authenticated', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_scheduled_message_v2(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_scheduled_message_v2(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'scheduled-message delivery final grants are not least privilege';
  END IF;
END;
$final_grants$;

SELECT pass(
  'scheduled-message delivery authorization and one-submission behavior passed'
);
SELECT * FROM finish();
ROLLBACK;
