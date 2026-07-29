-- ════════════════════════════════════════════════
-- FILE: twilio_inbound_notification_parity_isolated.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Creates temporary contacts and incoming Twilio texts, then proves one
--   message, unread update, and alert job are recorded while retries and consent
--   keywords do not duplicate them. Every fixture is rolled back.
--
-- DEPENDS ON:
--   20260729211728_twilio_inbound_notification_parity.sql and the messaging
--   transport foundation schema.
--
-- NOTES / GOTCHAS:
--   - Run only against a disposable local Supabase database after the migration.
--   - This file has not been run against qa-staging or production.
-- ════════════════════════════════════════════════

BEGIN;

INSERT INTO public.employees (
  id,
  full_name,
  role,
  is_active,
  is_external
)
VALUES (
  '71000000-0000-4000-8000-000000000001',
  'Twilio parity assigned employee',
  'admin',
  true,
  false
);

INSERT INTO public.contacts (
  id,
  phone,
  name,
  opt_in_status,
  dnd
)
VALUES
  (
    '72000000-0000-4000-8000-000000000001',
    '+18015550101',
    'Assigned inbound',
    false,
    false
  ),
  (
    '72000000-0000-4000-8000-000000000009',
    '(801) 555-0101',
    'Assigned inbound shadow',
    false,
    false
  ),
  (
    '72000000-0000-4000-8000-000000000002',
    '+1 (801) 555-0102',
    'STOP primary',
    true,
    false
  ),
  (
    '72000000-0000-4000-8000-000000000003',
    '801-555-0102',
    'STOP shadow',
    true,
    false
  );

INSERT INTO public.conversations (
  id,
  type,
  title,
  status,
  assigned_to,
  unread_count
)
VALUES (
  '73000000-0000-4000-8000-000000000001',
  'direct',
  'Assigned inbound conversation',
  'resolved',
  '71000000-0000-4000-8000-000000000001',
  0
);

INSERT INTO public.conversation_participants (
  conversation_id,
  contact_id,
  phone,
  role,
  is_active
)
VALUES (
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '+18015550101',
  'primary',
  true
);

INSERT INTO public.message_provider_events (
  id,
  provider,
  event_type,
  provider_event_id,
  provider_message_id,
  direction,
  message_type,
  sender_address,
  recipient_address,
  content,
  media_count,
  owned_media,
  raw_body_hash,
  dedupe_key,
  occurred_at,
  processing_state
)
VALUES
  (
    '74000000-0000-4000-8000-000000000001',
    'twilio',
    'message.received',
    'SM11111111111111111111111111111111',
    'SM11111111111111111111111111111111',
    'inbound',
    'sms',
    '+18015550101',
    '+13853360611',
    'Assigned normal SMS',
    0,
    '[]'::jsonb,
    repeat('1', 64),
    'twilio:message.received:SM11111111111111111111111111111111',
    '2026-07-29T12:00:00-06:00',
    'claimed'
  ),
  (
    '74000000-0000-4000-8000-000000000002',
    'twilio',
    'message.received',
    'SM22222222222222222222222222222222',
    'SM22222222222222222222222222222222',
    'inbound',
    'sms',
    '+18015550102',
    '+13853360611',
    'STOP',
    0,
    '[]'::jsonb,
    repeat('2', 64),
    'twilio:message.received:SM22222222222222222222222222222222',
    '2026-07-29T12:05:00-06:00',
    'claimed'
  ),
  (
    '74000000-0000-4000-8000-000000000003',
    'twilio',
    'message.received',
    'SM33333333333333333333333333333333',
    'SM33333333333333333333333333333333',
    'inbound',
    'sms',
    '+18015550102',
    '+13853360611',
    'START',
    0,
    '[]'::jsonb,
    repeat('3', 64),
    'twilio:message.received:SM33333333333333333333333333333333',
    '2026-07-29T12:04:00-06:00',
    'claimed'
  ),
  (
    '74000000-0000-4000-8000-000000000004',
    'twilio',
    'message.received',
    'SM44444444444444444444444444444444',
    'SM44444444444444444444444444444444',
    'inbound',
    'sms',
    '+18015550103',
    '+13853360611',
    'HELP',
    0,
    '[]'::jsonb,
    repeat('4', 64),
    'twilio:message.received:SM44444444444444444444444444444444',
    '2026-07-29T12:10:00-06:00',
    'claimed'
  ),
  (
    '74000000-0000-4000-8000-000000000005',
    'twilio',
    'message.received',
    'MM55555555555555555555555555555555',
    'MM55555555555555555555555555555555',
    'inbound',
    'mms',
    '+18015550104',
    '+13853360611',
    '',
    1,
    jsonb_build_array(jsonb_build_object(
      'storageRef',
      'upr-storage://message-attachments/twilio/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/MM55555555555555555555555555555555/0-MEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-a1b2c3d4e5f60708.jpg'
    )),
    repeat('5', 64),
    'twilio:message.received:MM55555555555555555555555555555555',
    '2026-07-29T12:15:00-06:00',
    'claimed'
  );

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"service_role"}',
  true
);

DO $test$
DECLARE
  v_result record;
BEGIN
  SELECT *
  INTO v_result
  FROM public.project_twilio_inbound_event(
    '74000000-0000-4000-8000-000000000001',
    false
  );

  IF v_result.outcome <> 'inbound_persisted'
     OR v_result.inserted IS NOT TRUE
     OR v_result.conversation_id <> '73000000-0000-4000-8000-000000000001'
     OR v_result.message_id IS NULL THEN
    RAISE EXCEPTION 'assigned SMS projection failed: %', row_to_json(v_result);
  END IF;

  IF (
    SELECT unread_count
    FROM public.conversations
    WHERE id = '73000000-0000-4000-8000-000000000001'
  ) <> 1 THEN
    RAISE EXCEPTION 'assigned SMS unread increment was not exactly one';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.message_notification_outbox
    WHERE provider_event_id = '74000000-0000-4000-8000-000000000001'
      AND message_id = v_result.message_id
      AND conversation_id = v_result.conversation_id
      AND type_key = 'message.inbound'
      AND payload -> 'recipient_ids'
        = '["71000000-0000-4000-8000-000000000001"]'::jsonb
      AND payload ->> 'link' = '/conversations'
      AND payload #>> '{data,route}' = '/conversations'
      AND payload #>> '{data,conversation_id}'
        = '73000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'assigned SMS outbox payload drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.messages
    WHERE id = v_result.message_id
      AND provider = 'twilio'
      AND provider_message_id = 'SM11111111111111111111111111111111'
      AND twilio_sid = 'SM11111111111111111111111111111111'
      AND channel = 'sms'
      AND direction = 'inbound'
      AND sender_contact_id = '72000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'assigned SMS provider/contact identity drifted';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_replay record;
BEGIN
  SELECT *
  INTO v_replay
  FROM public.project_twilio_inbound_event(
    '74000000-0000-4000-8000-000000000001',
    false
  );

  IF v_replay.inserted IS NOT FALSE
     OR (
       SELECT unread_count
       FROM public.conversations
       WHERE id = '73000000-0000-4000-8000-000000000001'
     ) <> 1
     OR (
       SELECT count(*)
       FROM public.messages
       WHERE provider = 'twilio'
         AND provider_message_id = 'SM11111111111111111111111111111111'
     ) <> 1
     OR (
       SELECT count(*)
       FROM public.message_notification_outbox
       WHERE provider_event_id = '74000000-0000-4000-8000-000000000001'
     ) <> 1 THEN
    RAISE EXCEPTION 'MessageSid replay duplicated a durable effect';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_stop record;
  v_stale_start record;
BEGIN
  SELECT *
  INTO v_stop
  FROM public.project_twilio_inbound_event(
    '74000000-0000-4000-8000-000000000002',
    false
  );
  SELECT *
  INTO v_stale_start
  FROM public.project_twilio_inbound_event(
    '74000000-0000-4000-8000-000000000003',
    false
  );

  IF v_stop.outcome <> 'inbound_stop'
     OR v_stop.inserted IS NOT FALSE
     OR v_stale_start.outcome <> 'inbound_start_stale'
     OR v_stale_start.inserted IS NOT FALSE THEN
    RAISE EXCEPTION
      'STOP/START ordering drifted: stop %, start %',
      row_to_json(v_stop),
      row_to_json(v_stale_start);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contacts
    WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = '8015550102'
      AND (dnd IS NOT TRUE OR opt_in_status IS NOT FALSE)
  ) THEN
    RAISE EXCEPTION 'STOP did not win across duplicate phone contacts';
  END IF;

  IF (
    SELECT count(*)
    FROM public.sms_consent_log
    WHERE provider_event_id = '74000000-0000-4000-8000-000000000002'
      AND event_type = 'stop_keyword'
  ) <> 2 THEN
    RAISE EXCEPTION 'STOP did not audit every duplicate phone contact exactly once';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.messages
    WHERE provider_message_id IN (
      'SM22222222222222222222222222222222',
      'SM33333333333333333333333333333333'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.message_notification_outbox
    WHERE provider_event_id IN (
      '74000000-0000-4000-8000-000000000002',
      '74000000-0000-4000-8000-000000000003'
    )
  ) THEN
    RAISE EXCEPTION 'unambiguous STOP/START produced canonical or notify effects';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_help record;
  v_mms record;
BEGIN
  SELECT *
  INTO v_help
  FROM public.project_twilio_inbound_event(
    '74000000-0000-4000-8000-000000000004',
    false
  );
  SELECT *
  INTO v_mms
  FROM public.project_twilio_inbound_event(
    '74000000-0000-4000-8000-000000000005',
    false
  );

  IF v_help.outcome <> 'inbound_help'
     OR v_help.inserted IS NOT TRUE
     OR v_help.requires_staff_reply IS NOT TRUE
     OR v_mms.outcome <> 'inbound_persisted'
     OR v_mms.inserted IS NOT TRUE THEN
    RAISE EXCEPTION
      'HELP/MMS projection drifted: help %, mms %',
      row_to_json(v_help),
      row_to_json(v_mms);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.messages
    WHERE id = v_mms.message_id
      AND channel = 'mms'
      AND media_urls = jsonb_build_array(
        'upr-storage://message-attachments/twilio/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/MM55555555555555555555555555555555/0-MEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-a1b2c3d4e5f60708.jpg'
      )
  ) THEN
    RAISE EXCEPTION 'MMS did not retain only its private owned reference';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.message_notification_outbox
    WHERE provider_event_id IN (
      '74000000-0000-4000-8000-000000000004',
      '74000000-0000-4000-8000-000000000005'
    )
      AND payload ? 'recipient_ids'
  ) THEN
    RAISE EXCEPTION 'unassigned inbound did not retain office/admin fallback';
  END IF;
END;
$test$;

RESET ROLE;

DO $test$
BEGIN
  IF has_function_privilege(
       'authenticated',
       'public.project_twilio_inbound_event(uuid,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.project_twilio_inbound_event(uuid,boolean)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.project_twilio_inbound_event(uuid,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Twilio inbound projection ACL drifted';
  END IF;
END;
$test$;

ROLLBACK;
