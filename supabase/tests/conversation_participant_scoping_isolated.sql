-- ═══════════════════════════════════════════════════════════════════════════════
-- FILE: conversation_participant_scoping_isolated.sql
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Creates disposable staff, contacts, forgeable job/appointment assignments,
--   conversations, and messages to prove that participant scoping has one
--   trusted access decision for the inbox, notification fan-out, author names,
--   and scoped conversation creation. Every fixture is discarded by the final
--   ROLLBACK.
--
-- DEPENDS ON:
--   20260731040337_conversation_participant_scoping.sql,
--   20260731040338_conversation_unread_state_compatibility.sql,
--   20260731213000_conversation_assignment_authority_containment.sql,
--   20260731213100_conversation_participant_policy_enforcement.sql,
--   20260803233020_conversation_notification_subscription_foundation.sql, and
--   their existing messaging/employee identity dependencies.
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
    WHERE migration.name = 'conversation_assignment_authority_containment'
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
  )
     OR NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'conversation_notification_subscription_foundation'
  ) THEN
    RAISE EXCEPTION 'apply the conversation participant and notification foundation migrations to the disposable clone first';
  END IF;

  IF to_regprocedure('public.get_tech_conversations(integer,timestamp with time zone,uuid,text,text,uuid)') IS NULL
     OR to_regprocedure('public.find_or_create_scoped_conversation(uuid,uuid)') IS NULL
     OR to_regprocedure('public.search_scoped_conversation_contacts(uuid,text,integer)') IS NULL
     OR to_regprocedure('public.get_conversation_notification_recipients(uuid)') IS NULL
     OR to_regprocedure('public.get_message_author_directory(uuid[])') IS NULL
     OR to_regprocedure(
       'public.set_my_conversation_unread_state(uuid[],boolean)'
     ) IS NULL
     OR to_regprocedure(
       'public.get_my_conversation_access_snapshot(uuid[])'
     ) IS NULL
     OR to_regprocedure(
       'public.messaging_get_authorized_message_media(uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'conversation participant scoping RPC dependency is absent';
  END IF;
END;
$guard$;

-- The governed local lane runs against the latest schema, which may already
-- include scheduled-message delivery. Pause that later layer inside this outer
-- transaction so the participant rollback/reapply checks exercise their
-- documented prerequisite state. The final ROLLBACK restores the clone exactly.
SELECT
  to_regprocedure('public.claim_scheduled_message_v2(uuid,uuid)') IS NOT NULL
    AS cps_pause_scheduled_delivery
\gset
\if :cps_pause_scheduled_delivery
\ir ../rollbacks/20260731220100_scheduled_message_delivery_enforcement.rollback.sql
\ir ../rollbacks/20260731220000_scheduled_message_delivery_compatibility.rollback.sql
\endif

-- Preserve the historical participant-scoping proof by returning to its exact
-- pre-foundation catalog. The new access/subscription model is reapplied and
-- exercised later in this same outer transaction.
\ir ../rollbacks/20260803233020_conversation_notification_subscription_foundation.rollback.sql

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
  PERFORM set_config('upr.cps.contact_notification_new', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.conversation_visible', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.conversation_private', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.job_visible', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.job_removed', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.job_new', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.claim_forged', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.appointment_visible', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.appointment_removed', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.appointment_new', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.private_message', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.visible_message', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.failed_message', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.accepted_message', gen_random_uuid()::text, true);
  PERFORM set_config('upr.cps.regrant_message', gen_random_uuid()::text, true);
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
  (current_setting('upr.cps.contact_new')::uuid, '+15550001003', '[CPS isolated] New assigned customer'),
  (current_setting('upr.cps.contact_notification_new')::uuid, '+15550001004', '[CPS isolated] Notification customer');

INSERT INTO public.conversations (id, type, title, status)
VALUES
  (current_setting('upr.cps.conversation_visible')::uuid, 'direct', '[CPS isolated] Visible conversation', 'needs_response'),
  (current_setting('upr.cps.conversation_private')::uuid, 'direct', '[CPS isolated] Private conversation', 'needs_response');

INSERT INTO public.conversation_participants (conversation_id, contact_id, phone, role, is_active)
VALUES
  (current_setting('upr.cps.conversation_visible')::uuid, current_setting('upr.cps.contact_visible')::uuid, '+15550001001', 'primary', true),
  (current_setting('upr.cps.conversation_private')::uuid, current_setting('upr.cps.contact_private')::uuid, '+15550001002', 'primary', true);

-- These rows deliberately model the browser-writable historical assignment
-- chain. The corrected authorization predicate must ignore them completely.
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

-- Manual false is the highest non-privileged precedence and must defeat the
-- default row. The appointment row is independently untrusted.
INSERT INTO public.conversation_member_overrides (conversation_id, employee_id, included, updated_by)
VALUES
  (
    current_setting('upr.cps.conversation_visible')::uuid,
    current_setting('upr.cps.employee_removed')::uuid,
    false,
    current_setting('upr.cps.employee_admin')::uuid
  ),
  (
    current_setting('upr.cps.conversation_private')::uuid,
    current_setting('upr.cps.employee_default')::uuid,
    false,
    current_setting('upr.cps.employee_admin')::uuid
  );

INSERT INTO public.messages (
  id,
  conversation_id,
  type,
  body,
  status,
  sent_by,
  direction,
  media_urls
)
VALUES
  (
    current_setting('upr.cps.private_message')::uuid,
    current_setting('upr.cps.conversation_private')::uuid,
    'sms_outbound',
    '[CPS isolated] inaccessible author',
    'sent',
    current_setting('upr.cps.employee_admin')::uuid,
    'outbound',
    jsonb_build_array(
      'upr-storage://message-attachments/outbound/private/photo.jpg'
    )
  ),
  (
    current_setting('upr.cps.visible_message')::uuid,
    current_setting('upr.cps.conversation_visible')::uuid,
    'sms_outbound',
    '[CPS isolated] accessible author',
    'sent',
    current_setting('upr.cps.employee_admin')::uuid,
    'outbound',
    jsonb_build_array(
      'upr-storage://message-attachments/outbound/visible/photo.jpg'
    )
  );

DO $acl_postcondition$
DECLARE
  v_table text;
  v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.conversations',
    'public.conversation_participants',
    'public.messages'
  ]
  LOOP
    IF NOT has_table_privilege('authenticated', v_table, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated SELECT is missing for %', v_table;
    END IF;

    IF NOT has_table_privilege('service_role', v_table, 'SELECT') THEN
      RAISE EXCEPTION 'service_role SELECT is missing for %', v_table;
    END IF;

    FOREACH v_privilege IN ARRAY ARRAY[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF has_table_privilege('authenticated', v_table, v_privilege) THEN
        RAISE EXCEPTION 'authenticated % unexpectedly remains on %', v_privilege, v_table;
      END IF;

      IF has_table_privilege('anon', v_table, v_privilege)
         OR NOT has_table_privilege('service_role', v_table, v_privilege) THEN
        RAISE EXCEPTION '% ACL postcondition failed for %', v_privilege, v_table;
      END IF;
    END LOOP;

    IF has_table_privilege('anon', v_table, 'SELECT') THEN
      RAISE EXCEPTION 'anon SELECT unexpectedly remains on %', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'conversations'
         AND policy.policyname = 'allow_authenticated_conversations'
         AND policy.cmd = 'ALL'
         AND policy.roles = ARRAY['authenticated']::name[]
         AND replace(
           regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g'),
           'public.',
           ''
         ) = 'messaging_can_access_conversation(id)'
         AND regexp_replace(
           COALESCE(policy.with_check, ''),
           '\s+',
           '',
           'g'
         ) = 'false'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'conversation_participants'
         AND policy.policyname = 'allow_authenticated_conversation_participants'
         AND policy.cmd = 'ALL'
         AND policy.roles = ARRAY['authenticated']::name[]
         AND replace(
           regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g'),
           'public.',
           ''
         ) = 'messaging_can_access_conversation(conversation_id)'
         AND regexp_replace(
           COALESCE(policy.with_check, ''),
           '\s+',
           '',
           'g'
         ) = 'false'
     ) THEN
    RAISE EXCEPTION 'participant enforcement policies are not effectively SELECT-only';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN (
        'conversations', 'conversation_participants', 'messages'
      )
  ) <> 3
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'messages'
         AND policy.policyname = 'messages_authenticated_select'
         AND policy.cmd = 'SELECT'
         AND policy.roles = ARRAY['authenticated']::name[]
         AND policy.with_check IS NULL
         AND replace(
           regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g'),
           'public.',
           ''
         ) = '(messaging_can_access_conversations()ANDmessaging_can_access_conversation(conversation_id))'
     ) THEN
    RAISE EXCEPTION 'participant enforcement policy allowlist is incomplete';
  END IF;
END;
$acl_postcondition$;

-- Exercise the real emergency rollback first. It must pause both raw table
-- access and SECURITY DEFINER readers instead of restoring the historical broad
-- browser contract.
SAVEPOINT cps_before_safe_enforcement_rollback;
\ir ../rollbacks/20260731213100_conversation_participant_policy_enforcement.rollback.sql

SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(
  current_setting('upr.cps.auth_admin')::uuid
);
SELECT pg_temp.expect_sqlstate(
  'participant enforcement rollback blocks raw conversation reads',
  'SELECT count(*) FROM public.conversations'
);
SELECT pg_temp.expect_sqlstate(
  'participant enforcement rollback blocks raw participant writes',
  format(
    'UPDATE public.conversation_participants SET phone = %L WHERE conversation_id = %L::uuid',
    '+15550009999',
    current_setting('upr.cps.conversation_visible')
  )
);
SELECT pg_temp.expect_sqlstate(
  'participant enforcement rollback blocks unscoped inbox execution',
  'SELECT public.get_tech_conversations()'
);
RESET ROLE;

ROLLBACK TO SAVEPOINT cps_before_safe_enforcement_rollback;

-- Exercise the actual enforcement file against policy drift. The outer
-- savepoint temporarily constructs the exact historical pre-enforcement policy
-- and ACL baseline without using a production rollback. The inner savepoint
-- recovers from the intentionally aborted migration.
SAVEPOINT cps_before_unexpected_policy_apply;

ALTER POLICY allow_authenticated_conversations
  ON public.conversations
  TO authenticated
  USING (true)
  WITH CHECK (true);
ALTER POLICY allow_authenticated_conversation_participants
  ON public.conversation_participants
  TO authenticated
  USING (true)
  WITH CHECK (true);
ALTER POLICY messages_authenticated_select
  ON public.messages
  TO authenticated
  USING (public.messaging_can_access_conversations());

REVOKE ALL ON TABLE
  public.conversations,
  public.conversation_participants,
  public.messages
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE
  public.conversations,
  public.conversation_participants
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

CREATE POLICY cps_isolated_unexpected_authenticated_read
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (true);

DO $unexpected_policy_drift$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN (
        'conversations', 'conversation_participants', 'messages'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'unexpected permissive policy fixture was not installed';
  END IF;
END;
$unexpected_policy_drift$;

SAVEPOINT cps_before_expected_enforcement_error;
\set ON_ERROR_STOP off
\ir ../migrations/20260731213100_conversation_participant_policy_enforcement.sql
\set cps_enforcement_apply_failed :ERROR
\set cps_enforcement_apply_sqlstate :SQLSTATE
ROLLBACK TO SAVEPOINT cps_before_expected_enforcement_error;
\set ON_ERROR_STOP on

-- The migration's first DO raises P0001. Since ON_ERROR_STOP is deliberately
-- disabled for the include, later statements observe the aborted transaction
-- and the final client SQLSTATE is 25P02. Either state proves the actual file
-- failed; the CI-visible source contract pins the exact count/preflight message.
SELECT CASE
  WHEN (:cps_enforcement_apply_failed)::boolean
   AND :'cps_enforcement_apply_sqlstate' IN ('P0001', '25P02')
    THEN 1
  ELSE 1 / 0
END AS actual_enforcement_rejected_unexpected_policy;

ROLLBACK TO SAVEPOINT cps_before_unexpected_policy_apply;

-- Prove the threat model using the real broad assignment-table policies. This
-- authenticated technician rewrites every link in the historical
-- crew→appointment→job/claim→contact chain. The corrected participant boundary
-- must still treat the result as untrusted.
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_appointment')::uuid);

DELETE FROM public.appointment_crew
WHERE appointment_id = current_setting('upr.cps.appointment_new')::uuid
  AND employee_id = current_setting('upr.cps.employee_appointment')::uuid;

INSERT INTO public.claims (id, contact_id, status)
VALUES (
  current_setting('upr.cps.claim_forged')::uuid,
  current_setting('upr.cps.contact_new')::uuid,
  'open'
);

UPDATE public.jobs
SET primary_contact_id = NULL,
    claim_id = current_setting('upr.cps.claim_forged')::uuid
WHERE id = current_setting('upr.cps.job_new')::uuid;

UPDATE public.appointments
SET title = '[CPS isolated] Browser-forged assignment'
WHERE id = current_setting('upr.cps.appointment_new')::uuid;

INSERT INTO public.appointment_crew (appointment_id, employee_id, role)
VALUES (
  current_setting('upr.cps.appointment_new')::uuid,
  current_setting('upr.cps.employee_appointment')::uuid,
  'tech'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.set_identity_actor(NULL, 'service_role');

DO $service_precedence_and_notification_parity$
DECLARE
  v_visible uuid := current_setting('upr.cps.conversation_visible')::uuid;
  v_private uuid := current_setting('upr.cps.conversation_private')::uuid;
  v_expected uuid[] := ARRAY[
    current_setting('upr.cps.employee_admin')::uuid,
    current_setting('upr.cps.employee_default')::uuid
  ];
  v_actual uuid[];
  v_created jsonb;
BEGIN
  IF NOT public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_admin')::uuid, v_private
     )
     OR public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_appointment')::uuid, v_visible
     )
     OR NOT public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_default')::uuid, v_visible
     ) THEN
    RAISE EXCEPTION
      'privileged/default membership or forged-assignment denial drifted';
  END IF;

  IF public.messaging_employee_can_access_conversation(
       current_setting('upr.cps.employee_removed')::uuid, v_visible
     ) THEN
    RAISE EXCEPTION
      'manual removal did not override default membership beside an untrusted appointment row';
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

  IF (
       SELECT count(*)
       FROM public.messaging_get_authorized_message_media(
         current_setting('upr.cps.employee_default')::uuid,
         current_setting('upr.cps.visible_message')::uuid
       )
     ) <> 1
     OR (
       SELECT media.media_urls ->> 0
       FROM public.messaging_get_authorized_message_media(
         current_setting('upr.cps.employee_admin')::uuid,
         current_setting('upr.cps.private_message')::uuid
       ) media
     ) IS DISTINCT FROM
       'upr-storage://message-attachments/outbound/private/photo.jpg'
     OR EXISTS (
       SELECT 1
       FROM public.messaging_get_authorized_message_media(
         current_setting('upr.cps.employee_appointment')::uuid,
         current_setting('upr.cps.visible_message')::uuid
       )
     ) THEN
    RAISE EXCEPTION
      'authorized media lookup returned metadata outside strict membership';
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
         current_setting('upr.cps.employee_default')::uuid,
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
    current_setting('upr.cps.employee_default')::uuid
  );
  IF NULLIF(v_created ->> 'id', '') IS NULL
     OR v_created ->> 'type' IS DISTINCT FROM 'direct'
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversation_participants participant
       WHERE participant.conversation_id = (v_created ->> 'id')::uuid
         AND participant.contact_id = current_setting('upr.cps.contact_new')::uuid
     ) THEN
    RAISE EXCEPTION 'default employee scoped creation lost its atomic return/participant shape';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'browser-forged assignment cannot open a new conversation',
    format(
      'SELECT public.find_or_create_scoped_conversation(%L::uuid, %L::uuid)',
      current_setting('upr.cps.contact_new'),
      current_setting('upr.cps.employee_appointment')
    )
  );
END;
$service_precedence_and_notification_parity$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_appointment')::uuid);

DO $forged_assignment_browser_denials$
DECLARE
  v_visible uuid := current_setting('upr.cps.conversation_visible')::uuid;
  v_visible_message uuid := current_setting('upr.cps.visible_message')::uuid;
  v_inbox jsonb;
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.conversations conversation
       WHERE conversation.id = v_visible
     )
     OR EXISTS (
       SELECT 1
       FROM public.get_my_conversation_access_snapshot(ARRAY[v_visible])
     )
     OR EXISTS (
       SELECT 1
       FROM public.get_message_author_directory(ARRAY[v_visible_message])
     ) THEN
    RAISE EXCEPTION
      'browser-forged assignment crossed conversation, snapshot, or author RLS';
  END IF;

  v_inbox := public.get_tech_conversations();
  IF EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_inbox -> 'conversations') conversation
       WHERE (conversation ->> 'id')::uuid = v_visible
     ) THEN
    RAISE EXCEPTION 'browser-forged assignment crossed the scoped inbox';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'browser-forged assignment cannot mutate unread state',
    format(
      'SELECT public.set_my_conversation_unread_state(ARRAY[%L::uuid], true)',
      v_visible
    )
  );
END;
$forged_assignment_browser_denials$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_default')::uuid);

DO $default_tech_inbox_and_author_isolation$
DECLARE
  v_inbox jsonb;
  v_visible uuid := current_setting('upr.cps.conversation_visible')::uuid;
  v_private uuid := current_setting('upr.cps.conversation_private')::uuid;
  v_visible_contact uuid := current_setting('upr.cps.contact_visible')::uuid;
  v_private_message uuid := current_setting('upr.cps.private_message')::uuid;
  v_visible_message uuid := current_setting('upr.cps.visible_message')::uuid;
  v_unread integer;
  v_snapshot uuid[];
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
    RAISE EXCEPTION
      'get_tech_conversations legacy default call lost scoped composite behavior: %',
      v_inbox;
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

  SELECT array_agg(snapshot.conversation_id ORDER BY snapshot.conversation_id)
    INTO v_snapshot
  FROM public.get_my_conversation_access_snapshot(
    ARRAY[v_visible, v_private, v_visible, gen_random_uuid()]
  ) snapshot;

  IF v_snapshot IS DISTINCT FROM ARRAY[v_visible] THEN
    RAISE EXCEPTION 'access snapshot must return only distinct accessible existing conversation ids: %', v_snapshot;
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'access snapshot rejects a null array',
    'SELECT * FROM public.get_my_conversation_access_snapshot(NULL)'
    , '22023'
  );
  PERFORM pg_temp.expect_sqlstate(
    'access snapshot rejects a null array element',
    format(
      'SELECT * FROM public.get_my_conversation_access_snapshot(ARRAY[%L::uuid, NULL::uuid])',
      v_visible
    ),
    '22023'
  );
  PERFORM pg_temp.expect_sqlstate(
    'access snapshot rejects more than 200 ids',
    'SELECT * FROM public.get_my_conversation_access_snapshot(array_fill(gen_random_uuid(), ARRAY[201]))'
    , '22023'
  );

  PERFORM pg_temp.expect_sqlstate(
    'authenticated cannot call scoped create directly',
    format(
      'SELECT public.find_or_create_scoped_conversation(%L::uuid, %L::uuid)',
      current_setting('upr.cps.contact_new'),
      current_setting('upr.cps.employee_default')
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
$default_tech_inbox_and_author_isolation$;

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
    RAISE EXCEPTION
      'admin manual add did not grant the previously appointment-only member';
  END IF;
END;
$admin_member_control_denials_and_restore$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_inactive')::uuid);

SELECT pg_temp.expect_sqlstate(
  'browser cannot call the service-only authorized media lookup',
  format(
    'SELECT * FROM public.messaging_get_authorized_message_media(%L::uuid, %L::uuid)',
    current_setting('upr.cps.employee_admin'),
    current_setting('upr.cps.visible_message')
  )
);

SELECT pg_temp.expect_sqlstate(
  'inactive employee cannot mutate unread state',
  format(
    'SELECT public.set_my_conversation_unread_state(ARRAY[%L::uuid], false)',
    current_setting('upr.cps.conversation_visible')
  )
);

SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_no_cap')::uuid);

SELECT pg_temp.expect_sqlstate(
  'no-capability employee cannot request an access snapshot',
  format(
    'SELECT * FROM public.get_my_conversation_access_snapshot(ARRAY[%L::uuid])',
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

SELECT pg_temp.expect_sqlstate(
  'external employee cannot request an access snapshot',
  format(
    'SELECT * FROM public.get_my_conversation_access_snapshot(ARRAY[%L::uuid])',
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

-- Reapply the new access/subscription foundation after the historical
-- participant proof. This exercises the recommended manual order (foundation
-- before scheduled delivery); the disposable clone's original chronological
-- migration replay already exercised scheduled delivery before foundation.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.set_identity_actor(NULL, 'service_role');
\ir ../migrations/20260803233020_conversation_notification_subscription_foundation.sql

DO $conversation_view_and_notification_defaults$
DECLARE
  v_private uuid := current_setting('upr.cps.conversation_private')::uuid;
  v_unassigned uuid := current_setting('upr.cps.employee_unassigned')::uuid;
  v_admin uuid := current_setting('upr.cps.employee_admin')::uuid;
  v_opened jsonb;
  v_created jsonb;
  v_created_id uuid;
  v_recipients uuid[];
BEGIN
  IF NOT public.messaging_employee_can_view_conversation(v_unassigned, v_private)
     OR public.messaging_employee_can_access_conversation(v_unassigned, v_private) THEN
    RAISE EXCEPTION
      'direct-thread view authority did not separate from legacy membership';
  END IF;

  IF public.messaging_employee_should_notify_for_conversation(
       v_unassigned,
       v_private
     )
     OR NOT public.messaging_employee_should_notify_for_conversation(
       v_admin,
       v_private
     ) THEN
    RAISE EXCEPTION
      'notification defaults did not keep field staff off and office leaders on';
  END IF;

  SELECT array_agg(recipient.employee_id ORDER BY recipient.employee_id)
    INTO v_recipients
  FROM public.get_conversation_notification_recipients(v_private) recipient;

  IF v_recipients IS DISTINCT FROM ARRAY[v_admin] THEN
    RAISE EXCEPTION
      'notification recipients drifted from subscription defaults: %',
      v_recipients;
  END IF;

  v_opened := public.find_or_create_viewable_conversation(
    current_setting('upr.cps.contact_private')::uuid,
    v_unassigned
  );

  IF (v_opened ->> 'id')::uuid IS DISTINCT FROM v_private
     OR (v_opened ->> 'created')::boolean
     OR EXISTS (
       SELECT 1
       FROM public.conversation_notification_subscriptions subscription
       WHERE subscription.conversation_id = v_private
         AND subscription.employee_id = v_unassigned
     ) THEN
    RAISE EXCEPTION
      'opening an existing direct conversation created an implicit subscription';
  END IF;

  v_created := public.find_or_create_viewable_conversation(
    current_setting('upr.cps.contact_notification_new')::uuid,
    v_unassigned
  );
  v_created_id := NULLIF(v_created ->> 'id', '')::uuid;
  PERFORM set_config('upr.cps.conversation_notification_new', v_created_id::text, true);

  IF v_created_id IS NULL
     OR NOT (v_created ->> 'created')::boolean
     OR NOT public.messaging_employee_should_notify_for_conversation(
       v_unassigned,
       v_created_id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversation_notification_subscriptions subscription
       WHERE subscription.conversation_id = v_created_id
         AND subscription.employee_id = v_unassigned
         AND subscription.subscribed
         AND subscription.source = 'conversation_created'
     ) THEN
    RAISE EXCEPTION
      'new direct conversation did not subscribe only its genuine creator';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.search_viewable_conversation_contacts(
      v_unassigned,
      'Private customer',
      25
    ) contact
    WHERE contact.id = current_setting('upr.cps.contact_private')::uuid
  ) THEN
    RAISE EXCEPTION
      'eligible unassigned staff could not search a client to start or help';
  END IF;

  IF (
       SELECT count(*)
       FROM public.messaging_get_authorized_message_media(
         v_unassigned,
         current_setting('upr.cps.private_message')::uuid
       )
     ) <> 1 THEN
    RAISE EXCEPTION
      'view-authorized staff could not resolve private message media metadata';
  END IF;
END;
$conversation_view_and_notification_defaults$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_unassigned')::uuid);

DO $browser_view_unread_and_explicit_mute$
DECLARE
  v_private uuid := current_setting('upr.cps.conversation_private')::uuid;
  v_setting jsonb;
BEGIN
  IF NOT public.messaging_can_access_conversation(v_private)
     OR NOT EXISTS (
       SELECT 1
       FROM public.get_my_conversation_access_snapshot(ARRAY[v_private])
       snapshot
       WHERE snapshot.conversation_id = v_private
     ) THEN
    RAISE EXCEPTION
      'unassigned capable staff lost direct-thread browser or access-snapshot authority';
  END IF;

  IF public.set_my_conversation_unread_state(ARRAY[v_private], true) <> 1 THEN
    RAISE EXCEPTION
      'unassigned capable staff could not update direct-thread unread state';
  END IF;

  v_setting := public.set_my_conversation_notification_setting(v_private, true);
  IF NOT (v_setting ->> 'subscribed')::boolean THEN
    RAISE EXCEPTION 'explicit self-subscribe did not take effect';
  END IF;

  v_setting := public.set_my_conversation_notification_setting(v_private, false);
  IF (v_setting ->> 'subscribed')::boolean
     OR (v_setting ->> 'explicit_value')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'explicit self-mute did not take effect';
  END IF;

  PERFORM pg_temp.expect_sqlstate(
    'authenticated browser cannot read notification subscription rows',
    'SELECT * FROM public.conversation_notification_subscriptions LIMIT 1'
  );
END;
$browser_view_unread_and_explicit_mute$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.set_identity_actor(NULL, 'service_role');

INSERT INTO public.messages (
  id,
  conversation_id,
  type,
  body,
  status,
  sent_by,
  direction,
  media_urls
)
VALUES
  (
    current_setting('upr.cps.failed_message')::uuid,
    current_setting('upr.cps.conversation_private')::uuid,
    'sms_outbound',
    '[CPS isolated] failed send must not subscribe',
    'failed',
    current_setting('upr.cps.employee_appointment')::uuid,
    'outbound',
    '[]'::jsonb
  );

DO $failed_message_did_not_subscribe$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.conversation_notification_subscriptions subscription
    WHERE subscription.conversation_id =
          current_setting('upr.cps.conversation_private')::uuid
      AND subscription.employee_id =
          current_setting('upr.cps.employee_appointment')::uuid
  ) THEN
    RAISE EXCEPTION 'failed outbound message created a notification subscription';
  END IF;
END;
$failed_message_did_not_subscribe$;

INSERT INTO public.messages (
  id,
  conversation_id,
  type,
  body,
  status,
  sent_by,
  direction,
  media_urls
)
VALUES
  (
    current_setting('upr.cps.accepted_message')::uuid,
    current_setting('upr.cps.conversation_private')::uuid,
    'sms_outbound',
    '[CPS isolated] accepted send subscribes',
    'sent',
    current_setting('upr.cps.employee_appointment')::uuid,
    'outbound',
    '[]'::jsonb
  ),
  (
    gen_random_uuid(),
    current_setting('upr.cps.conversation_private')::uuid,
    'sms_outbound',
    '[CPS isolated] mute remains after durable send',
    'sent',
    current_setting('upr.cps.employee_unassigned')::uuid,
    'outbound',
    '[]'::jsonb
  );

DO $accepted_message_and_explicit_mute$
DECLARE
  v_private uuid := current_setting('upr.cps.conversation_private')::uuid;
  v_appointment uuid := current_setting('upr.cps.employee_appointment')::uuid;
  v_unassigned uuid := current_setting('upr.cps.employee_unassigned')::uuid;
BEGIN
  IF NOT public.messaging_employee_should_notify_for_conversation(
       v_appointment,
       v_private
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversation_notification_subscriptions subscription
       WHERE subscription.conversation_id = v_private
         AND subscription.employee_id = v_appointment
         AND subscription.subscribed
         AND subscription.source = 'message_persisted'
         AND subscription.source_event_id IS NOT DISTINCT FROM
             current_setting('upr.cps.accepted_message')::uuid
     ) THEN
    RAISE EXCEPTION
      'durable accepted message did not subscribe its author';
  END IF;

  IF public.messaging_employee_should_notify_for_conversation(
       v_unassigned,
       v_private
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversation_notification_subscriptions subscription
       WHERE subscription.conversation_id = v_private
         AND subscription.employee_id = v_unassigned
         AND NOT subscription.subscribed
     ) THEN
    RAISE EXCEPTION
      'durable message overwrote an explicit mute';
  END IF;
END;
$accepted_message_and_explicit_mute$;

UPDATE public.employee_page_access
SET can_view = false
WHERE employee_id = current_setting('upr.cps.employee_appointment')::uuid
  AND nav_key = 'conversations';

DO $capability_revoke_invalidates_subscription$
BEGIN
  IF public.messaging_employee_can_view_conversation(
       current_setting('upr.cps.employee_appointment')::uuid,
       current_setting('upr.cps.conversation_private')::uuid
     )
     OR public.messaging_employee_should_notify_for_conversation(
       current_setting('upr.cps.employee_appointment')::uuid,
       current_setting('upr.cps.conversation_private')::uuid
     ) THEN
    RAISE EXCEPTION
      'capability revocation did not invalidate view and notification authority';
  END IF;
END;
$capability_revoke_invalidates_subscription$;

UPDATE public.employee_page_access
SET can_view = true
WHERE employee_id = current_setting('upr.cps.employee_appointment')::uuid
  AND nav_key = 'conversations';

DO $capability_regrant_requires_new_durable_action$
BEGIN
  IF NOT public.messaging_employee_can_view_conversation(
       current_setting('upr.cps.employee_appointment')::uuid,
       current_setting('upr.cps.conversation_private')::uuid
     )
     OR public.messaging_employee_should_notify_for_conversation(
       current_setting('upr.cps.employee_appointment')::uuid,
       current_setting('upr.cps.conversation_private')::uuid
     ) THEN
    RAISE EXCEPTION
      'regrant restored stale technician notification authority';
  END IF;
END;
$capability_regrant_requires_new_durable_action$;

INSERT INTO public.messages (
  id,
  conversation_id,
  type,
  body,
  status,
  sent_by,
  direction,
  media_urls
)
VALUES (
  current_setting('upr.cps.regrant_message')::uuid,
  current_setting('upr.cps.conversation_private')::uuid,
  'internal_note',
  '[CPS isolated] new action heals regranted subscription',
  'sent',
  current_setting('upr.cps.employee_appointment')::uuid,
  'outbound',
  '[]'::jsonb
);

DO $new_action_heals_regranted_subscription$
BEGIN
  IF NOT public.messaging_employee_should_notify_for_conversation(
       current_setting('upr.cps.employee_appointment')::uuid,
       current_setting('upr.cps.conversation_private')::uuid
     ) THEN
    RAISE EXCEPTION
      'new durable action did not refresh a regranted technician subscription';
  END IF;

  IF has_table_privilege(
       'anon',
       'public.conversation_notification_subscriptions',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversation_notification_subscriptions',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.conversation_notification_subscriptions',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'notification subscription ACL boundary drifted';
  END IF;
END;
$new_action_heals_regranted_subscription$;

-- Exercise the actual foundation rollback, then restore the savepoint so the
-- caller sees the latest schema. This proves recovery returns browser view,
-- snapshots, unread state, media, and recipients to legacy membership.
SAVEPOINT cps_before_notification_foundation_rollback;
\ir ../rollbacks/20260803233020_conversation_notification_subscription_foundation.rollback.sql

SET LOCAL ROLE authenticated;
SELECT pg_temp.set_identity_actor(current_setting('upr.cps.auth_unassigned')::uuid);

DO $notification_foundation_rollback_restores_membership$
BEGIN
  IF public.messaging_can_access_conversation(
       current_setting('upr.cps.conversation_private')::uuid
     )
     OR EXISTS (
       SELECT 1
       FROM public.get_my_conversation_access_snapshot(
         ARRAY[current_setting('upr.cps.conversation_private')::uuid]
       )
     ) THEN
    RAISE EXCEPTION
      'foundation rollback did not restore membership-derived browser access';
  END IF;
END;
$notification_foundation_rollback_restores_membership$;

RESET ROLE;
ROLLBACK TO SAVEPOINT cps_before_notification_foundation_rollback;

-- Complete the recommended manual apply ordering on the disposable clone.
SET LOCAL ROLE service_role;
SELECT pg_temp.set_identity_actor(NULL, 'service_role');
\ir ../migrations/20260731220000_scheduled_message_delivery_compatibility.sql
\ir ../migrations/20260731220100_scheduled_message_delivery_enforcement.sql

ROLLBACK;
