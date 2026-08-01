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
VALUES
  (
    'a1000000-0000-4000-8000-000000000001',
    '[scheduled delivery test] actor',
    'Scheduled delivery actor',
    'scheduled-delivery-actor@upr-qa.test',
    'a1000000-0000-4000-8000-000000000002',
    'admin', true, false
  ),
  (
    'a1000000-0000-4000-8000-000000000011',
    '[scheduled delivery test] forged assignment actor',
    'Forged assignment actor',
    'scheduled-delivery-forged@upr-qa.test',
    'a1000000-0000-4000-8000-000000000012',
    'field_tech', true, false
  );

INSERT INTO public.employee_page_access (employee_id, nav_key, can_view)
VALUES (
  'a1000000-0000-4000-8000-000000000011',
  'conversations',
  true
)
ON CONFLICT (employee_id, nav_key)
DO UPDATE SET can_view = EXCLUDED.can_view;

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

-- Exercise the actual live threat shape: authenticated clients may still write
-- appointment/job assignment records. Even a complete forged chain must not
-- authorize actor-derived schedule creation or provenance.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000012","role":"authenticated"}',
  true
);

INSERT INTO public.jobs (id, primary_contact_id, insured_name)
VALUES (
  'a1000000-0000-4000-8000-000000000013',
  'a1000000-0000-4000-8000-000000000003',
  '[scheduled delivery test] forged job'
);

INSERT INTO public.appointments (id, job_id, title, date)
VALUES (
  'a1000000-0000-4000-8000-000000000014',
  'a1000000-0000-4000-8000-000000000013',
  '[scheduled delivery test] forged appointment',
  CURRENT_DATE
);

INSERT INTO public.appointment_crew (appointment_id, employee_id, role)
VALUES (
  'a1000000-0000-4000-8000-000000000014',
  'a1000000-0000-4000-8000-000000000011',
  'tech'
);

SELECT pg_temp.expect_sqlstate(
  'browser-forged appointment assignment cannot create scheduled provenance',
  format(
    'SELECT public.create_scheduled_message(%L::uuid, %L::uuid, %L, %L::timestamptz)',
    'a1000000-0000-4000-8000-000000000015',
    'a1000000-0000-4000-8000-000000000004',
    'forged assignment body',
    now() + interval '5 minutes'
  ),
  '42501'
);

RESET ROLE;

DO $forged_assignment_left_no_provenance$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.scheduled_messages
       WHERE id = 'a1000000-0000-4000-8000-000000000015'
     )
     OR EXISTS (
       SELECT 1
       FROM public.scheduled_message_creation_provenance
       WHERE scheduled_message_id =
         'a1000000-0000-4000-8000-000000000015'
     ) THEN
    RAISE EXCEPTION
      'browser-forged assignment created a scheduled row or provenance';
  END IF;
END;
$forged_assignment_left_no_provenance$;

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

SELECT pg_temp.expect_sqlstate(
  'authenticated browser cannot rewrite a scheduled recipient',
  format(
    'UPDATE public.conversation_participants SET phone = %L WHERE conversation_id = %L::uuid AND contact_id = %L::uuid',
    '+15550001999',
    'a1000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000003'
  ),
  '42501'
);

RESET ROLE;

DO $actor_derived_persistence$
BEGIN
  IF (SELECT count(*) FROM public.scheduled_messages
      WHERE id = 'a1000000-0000-4000-8000-000000000005') <> 1
     OR (SELECT created_by FROM public.scheduled_messages
         WHERE id = 'a1000000-0000-4000-8000-000000000005')
          IS DISTINCT FROM 'a1000000-0000-4000-8000-000000000001'::uuid
     OR (SELECT body FROM public.scheduled_messages
         WHERE id = 'a1000000-0000-4000-8000-000000000005') <> 'scheduled delivery body'
     OR (SELECT recipient_contact_id
         FROM public.scheduled_message_creation_provenance
         WHERE scheduled_message_id = 'a1000000-0000-4000-8000-000000000005')
          IS DISTINCT FROM 'a1000000-0000-4000-8000-000000000003'::uuid
     OR (SELECT recipient_address
         FROM public.scheduled_message_creation_provenance
         WHERE scheduled_message_id = 'a1000000-0000-4000-8000-000000000005')
          IS DISTINCT FROM '+15550001901' THEN
    RAISE EXCEPTION
      'scheduled create did not derive the actor, bind the recipient, or stay idempotent';
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
  PERFORM pg_temp.expect_sqlstate(
    'reservation requires a current non-null claim token',
    format(
      'SELECT * FROM public.reserve_scheduled_message_delivery(%L::uuid, NULL::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      v_id,
      'a1000000-0000-4000-8000-000000000003',
      '+15550001901',
      'scheduled delivery body',
      'scheduled delivery body',
      '[]'
    ),
    '22023'
  );
  IF (SELECT delivery_attempt_id FROM public.scheduled_messages WHERE id = v_id)
       IS NOT NULL
     OR (SELECT count(*) FROM public.message_send_attempts
         WHERE client_request_id = v_id) <> 0 THEN
    RAISE EXCEPTION
      'null-token reservation crossed the provider-attempt boundary';
  END IF;

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
  v_failed boolean;
BEGIN
  IF NOT public.claim_scheduled_message_v2(v_id, v_token) THEN
    RAISE EXCEPTION 'phone-change race row was not claimed';
  END IF;

  UPDATE public.conversation_participants
  SET phone = '+15550001902'
  WHERE conversation_id = 'a1000000-0000-4000-8000-000000000004'
    AND contact_id = 'a1000000-0000-4000-8000-000000000003';

  PERFORM pg_temp.expect_sqlstate(
    'participant phone changed after scheduled creation',
    format(
      'SELECT * FROM public.reserve_scheduled_message_delivery(%L::uuid, %L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      v_id,
      v_token,
      'a1000000-0000-4000-8000-000000000003',
      '+15550001902',
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

  -- Evaluate the state-changing RPC before reading its result. SQL does not
  -- guarantee operand order for the former combined OR expression.
  v_failed := public.fail_scheduled_message_claim(
    v_id, v_token, 'phone-change race test cleanup'
  );
  IF NOT v_failed THEN
    RAISE EXCEPTION 'phone-change race claim was not closed';
  END IF;
  IF (SELECT status FROM public.scheduled_messages WHERE id = v_id) <> 'failed' THEN
    RAISE EXCEPTION 'phone-change race row was not closed without a provider attempt';
  END IF;
END;
$phone_change_race$;

RESET ROLE;

-- This models a row written through the old broad table contract before
-- enforcement. Even if it forges a real employee as created_by, it has no
-- SECURITY DEFINER provenance ledger entry and cannot become a send attempt.
SET LOCAL ROLE service_role;

DO $legacy_forgery_cannot_claim$
DECLARE
  v_id uuid := 'a1000000-0000-4000-8000-000000000009';
  v_token uuid := 'a1000000-0000-4000-8000-000000000010';
BEGIN
  INSERT INTO public.scheduled_messages (id, conversation_id, body, send_at, created_by, status)
  VALUES (
    v_id,
    'a1000000-0000-4000-8000-000000000004',
    'forged legacy scheduled body',
    now() + interval '3 minutes',
    'a1000000-0000-4000-8000-000000000001',
    'pending'
  );

  IF public.claim_scheduled_message_v2(v_id, v_token) THEN
    RAISE EXCEPTION 'legacy forged row acquired a v2 delivery claim';
  END IF;
  IF (SELECT claim_token FROM public.scheduled_messages WHERE id = v_id) IS NOT NULL
     OR (SELECT count(*) FROM public.message_send_attempts WHERE client_request_id = v_id) <> 0 THEN
    RAISE EXCEPTION 'legacy forged row crossed the provider-attempt boundary';
  END IF;
END;
$legacy_forgery_cannot_claim$;

RESET ROLE;

DO $final_grants$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'scheduled_message_creation_provenance'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'scheduled-message provenance ledger must force row-level security';
  END IF;
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
  IF has_table_privilege('authenticated', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('authenticated', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR has_table_privilege('anon', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('anon', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('service_role', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR has_table_privilege('service_role', 'public.scheduled_message_creation_provenance', 'UPDATE')
     OR has_table_privilege('service_role', 'public.scheduled_message_creation_provenance', 'DELETE') THEN
    RAISE EXCEPTION 'scheduled-message provenance ledger grants are not least privilege';
  END IF;

  IF (
       SELECT count(*)
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'scheduled_messages'
     ) <> 3
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'scheduled_messages'
         AND (
           policy.policyname NOT IN (
             'allow_anon_read_scheduled_messages',
             'allow_anon_insert_scheduled_messages',
             'allow_authenticated_scheduled_messages'
           )
           OR policy.roles <> ARRAY['authenticated']::name[]
         )
     ) THEN
    RAISE EXCEPTION
      'scheduled-message inert legacy policy catalog drifted';
  END IF;
END;
$final_grants$;

-- Exercise the complete reverse release chain in a savepoint. Every rollback is
-- a recovery containment step: durable scheduled evidence remains, browser
-- conversation/queue access stays sealed, and no SECURITY DEFINER reader or
-- scheduling RPC becomes callable. The savepoint restores the forward state for
-- the final pgTAP result.
SAVEPOINT scheduled_full_rollback_chain;
\ir ../rollbacks/20260731220100_scheduled_message_delivery_enforcement.rollback.sql
\ir ../rollbacks/20260731220000_scheduled_message_delivery_compatibility.rollback.sql
\ir ../rollbacks/20260731213100_conversation_participant_policy_enforcement.rollback.sql
\ir ../rollbacks/20260731213000_conversation_assignment_authority_containment.rollback.sql
\ir ../rollbacks/20260731040338_conversation_unread_state_compatibility.rollback.sql
\ir ../rollbacks/20260731040337_conversation_participant_scoping.rollback.sql

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT pg_temp.expect_sqlstate(
  'full rollback chain blocks raw conversation reads',
  'SELECT count(*) FROM public.conversations',
  '42501'
);
SELECT pg_temp.expect_sqlstate(
  'full rollback chain blocks unscoped inbox execution',
  'SELECT public.get_tech_conversations()',
  '42501'
);
SELECT pg_temp.expect_sqlstate(
  'full rollback chain blocks scheduled creation',
  format(
    'SELECT public.create_scheduled_message(%L::uuid, %L::uuid, %L, %L::timestamptz)',
    'a1000000-0000-4000-8000-000000000016',
    'a1000000-0000-4000-8000-000000000004',
    'rollback chain must not schedule',
    now() + interval '5 minutes'
  ),
  '42501'
);
RESET ROLE;

ROLLBACK TO SAVEPOINT scheduled_full_rollback_chain;

SELECT pass(
  'scheduled-message delivery authorization and one-submission behavior passed'
);
SELECT * FROM finish();
ROLLBACK;
