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
--   20260731040337_conversation_participant_scoping.sql,
--   20260731040338_conversation_unread_state_compatibility.sql,
--   20260731040339_conversation_participant_policy_enforcement.sql, and their
--   existing messaging/employee identity dependencies.
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
    WHERE migration.name = 'conversation_unread_state_compatibility'
  )
     OR NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'conversation_participant_policy_enforcement'
  ) THEN
    RAISE EXCEPTION 'apply all three conversation participant migrations to the disposable clone first';
  END IF;

  IF to_regprocedure('public.get_tech_conversations(integer,timestamp with time zone,uuid,text,text,uuid)') IS NULL
     OR to_regprocedure('public.find_or_create_scoped_conversation(uuid,uuid)') IS NULL
     OR to_regprocedure('public.search_scoped_conversation_contacts(uuid,text,integer)') IS NULL
     OR to_regprocedure('public.get_conversation_notification_recipients(uuid)') IS NULL
     OR to_regprocedure('public.get_message_author_directory(uuid[])') IS NULL
     OR to_regprocedure(
       'public.set_my_conversation_unread_state(uuid[],boolean)'
     ) IS NULL THEN
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
  PERFORM set_config('upr.cps.auth_inactive', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.auth_external', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_admin', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_appointment', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_default', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_removed', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_unassigned', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_no_cap', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_inactive', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.employee_external', gen_random_uuid()::text, true);
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
  'upr.cps.auth_no_cap',
  'upr.cps.auth_inactive',
  'upr.cps.auth_external'
]) setting_key;

INSERT INTO public.employees (id, full_name, display_name, email, auth_user_id, role, is_active, is_external)
VALUES
  (current_setting('upr.cps.employee_admin')::uuid, '[CPS isolated] Admin', 'CPS Admin', 'cps-admin@example.invalid', current_setting('upr.cps.auth_admin')::uuid, 'admin', true, false),
  (current_setting('upr.cps.employee_appointment')::uuid, '[CPS isolated] Appointment', 'CPS Appointment', 'cps-appointment@example.invalid', current_setting('upr.cps.auth_appointment')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_default')::uuid, '[CPS isolated] Default', 'CPS Default', 'cps-default@example.invalid', current_setting('upr.cps.auth_default')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_removed')::uuid, '[CPS isolated] Removed', 'CPS Removed', 'cps-removed@example.invalid', current_setting('upr.cps.auth_removed')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_unassigned')::uuid, '[CPS isolated] Unassigned', 'CPS Unassigned', 'cps-unassigned@example.invalid', current_setting('upr.cps.auth_unassigned')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_no_cap')::uuid, '[CPS isolated] No capability', 'CPS No capability', 'cps-no-cap@example.invalid', current_setting('upr.cps.auth_no_cap')::uuid, 'field_tech', true, false),
  (current_setting('upr.cps.employee_inactive')::uuid, '[CPS isolated] Inactive', 'CPS Inactive', 'cps-inactive@example.invalid', current_setting('upr.cps.auth_inactive')::uuid, 'field_tech', false, false),
  (current_setting('upr.cps.employee_external')::uuid, '[CPS isolated] External', 'CPS External', 'cps-external@example.invalid', current_setting('upr.cps.auth_external')::uuid, 'field_tech', true, true);

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
  (current_setting('upr.cps.employee_no_cap')::uuid, current_setting('upr.cps.employee_admin')::uuid),
  (current_setting('upr.cps.employee_inactive')::uuid, current_setting('upr.cps.employee_admin')::uuid),
  (current_setting('upr.cps.employee_external')::uuid, current_setting('upr.cps.employee_admin')::uuid);

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

DO $acl_postcondition$
DECLARE
  v_table text;
  v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.conversations',
    'public.conversation_participants'
  ]
  LOOP
    IF NOT has_table_privilege('authenticated', v_table, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated SELECT is missing for %', v_table;
    END IF;

    FOREACH v_privilege IN ARRAY ARRAY[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF has_table_privilege('authenticated', v_table, v_privilege) THEN
        RAISE EXCEPTION 'authenticated % unexpectedly remains on %', v_privilege, v_table;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'conversations'
         AND policy.policyname = 'allow_authenticated_conversations'
         AND policy.cmd = 'SELECT'
         AND policy.roles = ARRAY['authenticated']::name[]
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'conversation_participants'
         AND policy.policyname = 'allow_authenticated_conversation_participants'
         AND policy.cmd = 'SELECT'
         AND policy.roles = ARRAY['authenticated']::name[]
     ) THEN
    RAISE EXCEPTION 'participant enforcement policies are not SELECT-only';
  END IF;
END;
$acl_postcondition$;

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

  IF public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_inactive')::uuid, v_visible
     )
     OR public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_external')::uuid, v_visible
     )
     OR public.messaging_employee_has_conversations_capability(
       current_setting('upr.cps.employee_inactive')::uuid
     )
     OR public.messaging_employee_has_conversations_capability(
       current_setting('upr.cps.employee_external')::uuid
     ) THEN
    RAISE EXCEPTION 'inactive or external default rows crossed an authorization boundary';
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
  v_visible_contact uuid := current_setting('upr.cps.contact_visible')::uuid;
  v_private_message uuid := current_setting('upr.cps.private_message')::uuid;
  v_visible_message uuid := current_setting('upr.cps.visible_message')::uuid;
  v_unread integer;
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

  PERFORM pg_temp.expect_sqlstate(
    'authenticated cannot update trusted conversation fields',
    format(
      'UPDATE public.conversations SET title = %L, status = %L WHERE id = %L::uuid',
      '[CPS isolated] forbidden title',
      'archived',
      v_visible
    )
  );
  PERFORM pg_temp.expect_sqlstate(
    'authenticated cannot delete a conversation',
    format(
      'DELETE FROM public.conversations WHERE id = %L::uuid',
      v_visible
    )
  );
  PERFORM pg_temp.expect_sqlstate(
    'authenticated cannot update a customer participant',
    format(
      'UPDATE public.conversation_participants SET role = %L WHERE conversation_id = %L::uuid AND contact_id = %L::uuid',
      'secondary',
      v_visible,
      v_visible_contact
    )
  );
  PERFORM pg_temp.expect_sqlstate(
    'authenticated cannot delete a customer participant',
    format(
      'DELETE FROM public.conversation_participants WHERE conversation_id = %L::uuid AND contact_id = %L::uuid',
      v_visible,
      v_visible_contact
    )
  );
  PERFORM pg_temp.expect_sqlstate(
    'non-admin cannot list internal conversation members',
    format(
      'SELECT public.get_conversation_members(%L::uuid)',
      v_visible
    )
  );
  PERFORM pg_temp.expect_sqlstate(
    'non-admin cannot override another conversation member',
    format(
      'SELECT public.set_conversation_member_override(%L::uuid, %L::uuid, true)',
      v_visible,
      current_setting('upr.cps.employee_unassigned')
    )
  );

  IF public.set_my_conversation_unread_state(ARRAY[v_visible], true) <> 1 THEN
    RAISE EXCEPTION 'authorized unread RPC did not update exactly one conversation';
  END IF;

  SELECT conversation.unread_count
    INTO v_unread
  FROM public.conversations conversation
  WHERE conversation.id = v_visible;

  IF v_unread IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'authorized unread RPC did not set unread_count to one';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'unread RPC rejects an inaccessible conversation',
    format(
      'SELECT public.set_my_conversation_unread_state(ARRAY[%L::uuid], false)',
      v_private
    )
  );

  IF public.set_my_conversation_unread_state(NULL, false) < 1 THEN
    RAISE EXCEPTION 'mark-all RPC did not clear the accessible unread conversation';
  END IF;

  SELECT conversation.unread_count
    INTO v_unread
  FROM public.conversations conversation
  WHERE conversation.id = v_visible;

  IF v_unread IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'mark-all RPC did not clear unread_count';
  END IF;

  PERFORM public.leave_conversation(v_visible);
  PERFORM public.leave_conversation(v_visible);

  IF public.messaging_can_access_conversation(v_visible) THEN
    RAISE EXCEPTION 'self-leave did not create an effective manual removal';
  END IF;
END;
$appointment_tech_inbox_and_author_isolation$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_admin')::uuid);

DO $admin_member_control_denials_and_restore$
DECLARE
  v_visible uuid := current_setting('upr.cps.conversation_visible')::uuid;
  v_members jsonb;
BEGIN
  PERFORM pg_temp.expect_sqlstate(
    'privileged admin cannot leave a conversation',
    format('SELECT public.leave_conversation(%L::uuid)', v_visible)
  );
  PERFORM pg_temp.expect_sqlstate(
    'privileged target cannot be removed',
    format(
      'SELECT public.set_conversation_member_override(%L::uuid, %L::uuid, false)',
      v_visible,
      current_setting('upr.cps.employee_admin')
    ),
    '22023'
  );
  PERFORM pg_temp.expect_sqlstate(
    'inactive target cannot be added',
    format(
      'SELECT public.set_conversation_member_override(%L::uuid, %L::uuid, true)',
      v_visible,
      current_setting('upr.cps.employee_inactive')
    ),
    'P0002'
  );
  PERFORM pg_temp.expect_sqlstate(
    'external target cannot be added',
    format(
      'SELECT public.set_conversation_member_override(%L::uuid, %L::uuid, true)',
      v_visible,
      current_setting('upr.cps.employee_external')
    ),
    'P0002'
  );
  PERFORM pg_temp.expect_sqlstate(
    'inactive target cannot become a default',
    format(
      'SELECT public.set_default_conversation_member(%L::uuid, true)',
      current_setting('upr.cps.employee_inactive')
    ),
    '22023'
  );

  v_members := public.set_conversation_member_override(
    v_visible,
    current_setting('upr.cps.employee_appointment')::uuid,
    true
  );

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_members) member
    WHERE (member ->> 'employee_id')::uuid
          = current_setting('upr.cps.employee_appointment')::uuid
      AND (member ->> 'included')::boolean
      AND member ->> 'source' = 'manual_add'
  ) THEN
    RAISE EXCEPTION 'admin manual add did not restore the self-left member';
  END IF;
END;
$admin_member_control_denials_and_restore$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_inactive')::uuid);

SELECT pg_temp.expect_sqlstate(
  'inactive employee cannot mutate unread state',
  format(
    'SELECT public.set_my_conversation_unread_state(ARRAY[%L::uuid], false)',
    current_setting('upr.cps.conversation_visible')
  )
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_external')::uuid);

SELECT pg_temp.expect_sqlstate(
  'external employee cannot mutate unread state',
  format(
    'SELECT public.set_my_conversation_unread_state(ARRAY[%L::uuid], false)',
    current_setting('upr.cps.conversation_visible')
  )
);

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
