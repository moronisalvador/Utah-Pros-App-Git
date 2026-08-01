-- ═══════════════════════════════════════════════════════════════════════════════
-- FILE: conversation_participant_scoping_isolated.sql
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Creates disposable staff, contacts, jobs, appointments, conversations, and
--   messages to prove that participant scoping has one consistent access decision
--   for the inbox, notification fan-out, author names, and scoped conversation
--   creation. Every fixture is discarded by the final ROLLBACK.
--
-- DEPENDS ON:
--   20260731040337_conversation_participant_scoping.sql and its existing
--   messaging/employee identity dependencies.
--
-- RUN ONLY ON AN ISOLATED DATABASE:
--   UPR_ISOLATED_DB=1 psql ... -f supabase/tests/conversation_participant_scoping_isolated.sql
--   This script refuses a database without the isolated-test sentinel. It has not
--   been run against qa-staging or the shared production project.
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
    WHERE migration.name = 'conversation_participant_scoping'
  )
     OR NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'conversation_participant_policy_enforcement'
  ) THEN
    RAISE EXCEPTION 'apply both conversation participant migrations to the disposable clone first';
  END IF;

  IF to_regprocedure('public.get_tech_conversations(integer,timestamp with time zone,uuid,text,text,uuid)') IS NULL
     OR to_regprocedure('public.find_or_create_scoped_conversation(uuid,uuid)') IS NULL
     OR to_regprocedure('public.search_scoped_conversation_contacts(uuid,text,integer)') IS NULL
     OR to_regprocedure('public.get_conversation_notification_recipients(uuid)') IS NULL
     OR to_regprocedure('public.get_message_author_directory(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'conversation participant scoping RPC dependency is absent';
  END IF;
END;
$guard$;

CREATE FUNCTION pg_temp.set_identity_actor(p_user_id uuid, p_role text DEFAULT 'authenticated')
RETURNS void
LANGUAGE sql
AS $function$
  SELECT set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
$function$;

CREATE FUNCTION pg_temp.expect_sqlstate(
  p_label text,
  p_sql text,
  p_expected_state text DEFAULT '42501'
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_actual_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_state = RETURNED_SQLSTATE;
    IF v_actual_state = p_expected_state THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'expected SQLSTATE % for %, got %', p_expected_state, p_label, v_actual_state;
  END;

  RAISE EXCEPTION 'expected SQLSTATE % but statement succeeded: %', p_expected_state, p_label;
END;
$function$;

DO $fixture_ids$
BEGIN
  PERFORM set_config('upr.cps.auth_admin', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.auth_appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.auth_default', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.auth_removed', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.auth_unassigned', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.auth_no_cap', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_admin', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_default', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_removed', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_unassigned', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_no_cap', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.contact_visible', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.contact_private', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.contact_new', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.conversation_visible', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.conversation_private', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.job_visible', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.job_removed', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.job_new', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.appointment_visible', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.appointment_removed', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.appointment_new', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.private_message', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.visible_message', gen_random_uuid()::text, true);
END;
$fixture_ids$;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT
  '00000000-0000-0000-0000-000000000000',
  current_setting(setting_key)::uuid,
  'authenticated',
  'authenticated',
  setting_key || '@example.invalid',
  '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM unnest(ARRAY[
  'upr.cps.auth_admin',
  'upr.cps.auth_appointment',
  'upr.cps.auth_default',
  'upr.cps.auth_removed',
  'upr.cps.auth_unassigned',
  'upr.cps.auth_no_cap'
]) setting_key;

INSERT INTO public.employees (id, full_name, display_name, email, auth_user_id, role, is_active, is_external)
VALUES
  (current_setting('upr.cps.employee_admin')::uuid, '[CPS isolated] Admin', 'CPS Admin', 'cps-admin@example.invalid', current_setting('upr.cps.auth_admin')::uuid, 'admin', true, false),
  (current_setting('upr.cps.employee_appointment')::uuid, '[CPS isolated] Appointment', 'CPS Appointment', 'cps-appointment@example.invalid', current_setting('upr.cps.auth_appointment')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_default')::uuid, '[CPS isolated] Default', 'CPS Default', 'cps-default@example.invalid', current_setting('upr.cps.auth_default')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_removed')::uuid, '[CPS isolated] Removed', 'CPS Removed', 'cps-removed@example.invalid', current_setting('upr.cps.auth_removed')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_unassigned')::uuid, '[CPS isolated] Unassigned', 'CPS Unassigned', 'cps-unassigned@example.invalid', current_setting('upr.cps.auth_unassigned')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_no_cap')::uuid, '[CPS isolated] No capability', 'CPS No capability', 'cps-no-cap@example.invalid', current_setting('upr.cps.auth_no_cap')::uuid, 'field_tech', true, false);

-- A per-employee Conversations grant distinguishes notification eligibility from
-- mere membership. Admin capability is role-derived; the field technicians below
-- need an explicit value to make this fixture independent of nav-permission rows.
INSERT INTO public.employee_page_access (employee_id, nav_key, can_view)
VALUES
  (current_setting('upr.cps.employee_appointment')::uuid, 'conversations', true),
  (current_setting('upr.cps.employee_default')::uuid, 'conversations', true),
  (current_setting('upr.cps.employee_removed')::uuid, 'conversations', true),
  (current_setting('upr.cps.employee_unassigned')::uuid, 'conversations', true),
  (current_setting('upr.cps.employee_no_cap')::uuid, 'conversations', false)
ON CONFLICT (employee_id, nav_key)
DO UPDATE SET can_view = EXCLUDED.can_view;

UPDATE public.feature_flags
SET force_disabled = false
WHERE key = 'page:conversations';

INSERT INTO public.contacts (id, phone, name)
VALUES
  (current_setting('upr.cps.contact_visible')::uuid, '+15550001001', '[CPS isolated] Visible customer'),
  (current_setting('upr.cps.contact_private')::uuid, '+15550001002', '[CPS isolated] Private customer'),
  (current_setting('upr.cps.contact_new')::uuid, '+15550001003', '[CPS isolated] New assigned customer');

INSERT INTO public.conversations (id, type, title, status)
VALUES
  (current_setting('upr.cps.conversation_visible')::uuid, 'direct', '[CPS isolated] Visible conversation', 'needs_response'),
  (current_setting('upr.cps.conversation_private')::uuid, 'direct', '[CPS isolated] Private conversation', 'needs_response');

INSERT INTO public.conversation_participants (conversation_id, contact_id, phone, role, is_active)
VALUES
  (current_setting('upr.cps.conversation_visible')::uuid, current_setting('upr.cps.contact_visible')::uuid, '+15550001001', 'primary', true),
  (current_setting('upr.cps.conversation_private')::uuid, current_setting('upr.cps.contact_private')::uuid, '+15550001002', 'primary', true);

-- Appointment-derived access is intentionally historical: neither appointment
-- status nor date participates in the production predicate.
INSERT INTO public.jobs (id, primary_contact_id, insured_name)
VALUES
  (current_setting('upr.cps.job_visible')::uuid, current_setting('upr.cps.contact_visible')::uuid, '[CPS isolated] Visible job'),
  (current_setting('upr.cps.job_removed')::uuid, current_setting('upr.cps.contact_visible')::uuid, '[CPS isolated] Removed job'),
  (current_setting('upr.cps.job_new')::uuid, current_setting('upr.cps.contact_new')::uuid, '[CPS isolated] New assigned job');

INSERT INTO public.appointments (id, job_id, title, date)
VALUES
  (current_setting('upr.cps.appointment_visible')::uuid, current_setting('upr.cps.job_visible')::uuid, '[CPS isolated] Visible appointment', CURRENT_DATE),
  (current_setting('upr.cps.appointment_removed')::uuid, current_setting('upr.cps.job_removed')::uuid, '[CPS isolated] Removed appointment', CURRENT_DATE),
  (current_setting('upr.cps.appointment_new')::uuid, current_setting('upr.cps.job_new')::uuid, '[CPS isolated] New assigned appointment', CURRENT_DATE);

INSERT INTO public.appointment_crew (appointment_id, employee_id, role)
VALUES
  (current_setting('upr.cps.appointment_visible')::uuid, current_setting('upr.cps.employee_appointment')::uuid, 'tech'),
  (current_setting('upr.cps.appointment_removed')::uuid, current_setting('upr.cps.employee_removed')::uuid, 'tech'),
  (current_setting('upr.cps.appointment_new')::uuid, current_setting('upr.cps.employee_appointment')::uuid, 'tech');

INSERT INTO public.conversation_default_members (employee_id, added_by)
VALUES
  (current_setting('upr.cps.employee_default')::uuid, current_setting('upr.cps.employee_admin')::uuid),
  (current_setting('upr.cps.employee_removed')::uuid, current_setting('upr.cps.employee_admin')::uuid),
  (current_setting('upr.cps.employee_no_cap')::uuid, current_setting('upr.cps.employee_admin')::uuid);

-- Manual false is the highest non-privileged precedence and must defeat both the
-- default row and appointment history for this employee.
INSERT INTO public.conversation_member_overrides (conversation_id, employee_id, included, updated_by)
VALUES (
  current_setting('upr.cps.conversation_visible')::uuid,
  current_setting('upr.cps.employee_removed')::uuid,
  false,
  current_setting('upr.cps.employee_admin')::uuid
);

INSERT INTO public.messages (id, conversation_id, type, body, status, sent_by, direction)
VALUES
  (
    current_setting('upr.cps.private_message')::uuid,
    current_setting('upr.cps.conversation_private')::uuid,
    'sms_outbound',
    '[CPS isolated] inaccessible author',
    'sent',
    current_setting('upr.cps.employee_admin')::uuid,
    'outbound'
  ),
  (
    current_setting('upr.cps.visible_message')::uuid,
    current_setting('upr.cps.conversation_visible')::uuid,
    'sms_outbound',
    '[CPS isolated] accessible author',
    'sent',
    current_setting('upr.cps.employee_admin')::uuid,
    'outbound'
  );

SET LOCAL ROLE service_role;
SELECT pg_temp.set_identity_actor(NULL, 'service_role');

DO $service_precedence_and_notification_parity$
DECLARE
  v_visible uuid := current_setting('upr.cps.conversation_visible')::uuid;
  v_private uuid := current_setting('upr.cps.conversation_private')::uuid;
  v_expected uuid[] := ARRAY[
    current_setting('upr.cps.employee_admin')::uuid,
    current_setting('upr.cps.employee_appointment')::uuid,
    current_setting('upr.cps.employee_default')::uuid
  ];
  v_actual uuid[];
  v_created jsonb;
BEGIN
  IF NOT public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_admin')::uuid, v_private
     )
     OR NOT public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_appointment')::uuid, v_visible
     )
     OR NOT public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_default')::uuid, v_visible
     ) THEN
    RAISE EXCEPTION 'privileged, appointment, or default participant access drifted';
  END IF;

  IF public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_removed')::uuid, v_visible
     ) THEN
    RAISE EXCEPTION 'manual removal did not override appointment/default membership';
  END IF;

  SELECT array_agg(recipient.employee_id ORDER BY recipient.employee_id)
    INTO v_actual
  FROM public.get_conversation_notification_recipients(v_visible) recipient;

  IF v_actual IS DISTINCT FROM (
    SELECT array_agg(expected.id ORDER BY expected.id)
    FROM unnest(v_expected) AS expected(id)
  ) THEN
    RAISE EXCEPTION 'notification recipients must equal capability ∩ membership: %', v_actual;
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.search_scoped_conversation_contacts(
         current_setting('upr.cps.employee_appointment')::uuid,
         'Visible customer',
         25
       ) contact
       WHERE contact.id = current_setting('upr.cps.contact_visible')::uuid
     )
     OR EXISTS (
       SELECT 1
       FROM public.search_scoped_conversation_contacts(
         current_setting('upr.cps.employee_unassigned')::uuid,
         'Private customer',
         25
       )
     ) THEN
    RAISE EXCEPTION 'scoped contact search leaked or hid an assigned customer';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'service scoped create rejects an unassigned employee',
    format(
      'SELECT public.find_or_create_scoped_conversation(%L::uuid, %L::uuid)',
      current_setting('upr.cps.contact_private'),
      current_setting('upr.cps.employee_unassigned')
    )
  );

  v_created := public.find_or_create_scoped_conversation(
    current_setting('upr.cps.contact_new')::uuid,
    current_setting('upr.cps.employee_appointment')::uuid
  );
  IF NULLIF(v_created ->> 'id', '') IS NULL
     OR v_created ->> 'type' IS DISTINCT FROM 'direct'
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversation_participants participant
       WHERE participant.conversation_id = (v_created ->> 'id')::uuid
         AND participant.contact_id = current_setting('upr.cps.contact_new')::uuid
     ) THEN
    RAISE EXCEPTION 'assigned employee scoped creation lost its atomic return/participant shape';
  END IF;
END;
$service_precedence_and_notification_parity$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_appointment')::uuid);

DO $appointment_tech_inbox_and_author_isolation$
DECLARE
  v_inbox jsonb;
  v_visible uuid := current_setting('upr.cps.conversation_visible')::uuid;
  v_private uuid := current_setting('upr.cps.conversation_private')::uuid;
  v_private_message uuid := current_setting('upr.cps.private_message')::uuid;
  v_visible_message uuid := current_setting('upr.cps.visible_message')::uuid;
BEGIN
  -- Exact no-argument legacy call still has the established composite shape.
  v_inbox := public.get_tech_conversations();
  IF jsonb_typeof(v_inbox -> 'conversations') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_inbox -> 'status_counts') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_inbox -> 'unread_total') IS DISTINCT FROM 'number'
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_inbox -> 'conversations') conversation
       WHERE (conversation ->> 'id')::uuid = v_visible
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_inbox -> 'conversations') conversation
       WHERE (conversation ->> 'id')::uuid = v_private
     ) THEN
    RAISE EXCEPTION 'get_tech_conversations legacy default call lost scoped composite behavior';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM public.get_message_author_directory(ARRAY[v_private_message]) author
     ) THEN
    RAISE EXCEPTION 'message author directory leaked an inaccessible conversation author';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.get_message_author_directory(ARRAY[v_visible_message]) author
       WHERE author.id = current_setting('upr.cps.employee_admin')::uuid
     ) THEN
    RAISE EXCEPTION 'message author directory hid an authorized conversation author';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'authenticated cannot call scoped create directly',
    format(
      'SELECT public.find_or_create_scoped_conversation(%L::uuid, %L::uuid)',
      current_setting('upr.cps.contact_new'),
      current_setting('upr.cps.employee_appointment')
    )
  );
  PERFORM pg_temp.expect_sqlstate(
    'authenticated cannot read internal member overrides',
    'SELECT * FROM public.conversation_member_overrides LIMIT 1'
  );
  PERFORM pg_temp.expect_sqlstate(
    'authenticated cannot directly insert conversations',
    format(
      'INSERT INTO public.conversations (id, type, title, status) VALUES (%L::uuid, %L, %L, %L)',
      gen_random_uuid(),
      'direct',
      '[CPS isolated] forbidden direct insert',
      'needs_response'
    )
  );
END;
$appointment_tech_inbox_and_author_isolation$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_removed')::uuid);

DO $manual_remove_browser_parity$
BEGIN
  IF public.messaging_can_access_conversation(
       current_setting('upr.cps.conversation_visible')::uuid
     ) THEN
    RAISE EXCEPTION 'browser participant gate ignored a durable manual removal';
  END IF;
END;
$manual_remove_browser_parity$;

ROLLBACK;
