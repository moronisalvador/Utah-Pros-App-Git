-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260731040337_conversation_participant_scoping
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Places Conversations in a service-only recovery posture. Browser table
--   access and every participant-facing RPC are paused, while the participant
--   choices, provenance, functions, and tables remain available for a reviewed
--   forward repair.
--
-- SECURITY POSTURE:
--   The pre-scoping database exposed every conversation and participant to any
--   authenticated session. Recreating that state would disclose customer PII
--   and reopen raw browser writes, so this rollback intentionally fails closed.
--   It never restores the historical unscoped SECURITY DEFINER inbox.
--
-- REQUIRED ORDER:
--   Roll back scheduled delivery, then 20260731213100 participant enforcement,
--   then 20260731213000 assignment-authority containment, and then 20260731040338
--   unread compatibility. Deploy a maintenance posture before this final
--   containment step. Recovery is forward-only after this file runs.
-- ═════════════════════════════════════════════════════════════════════════════

DO $conversation_foundation_rollback_preflight$
DECLARE
  v_policy_count integer;
  v_function text;
  v_legacy_claim_source text;
BEGIN
  IF to_regclass('public.conversation_member_overrides') IS NULL
     OR to_regclass('public.conversation_default_members') IS NULL
     OR to_regprocedure(
       'public.messaging_employee_has_conversations_capability(uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.messaging_employee_can_access_conversation(uuid,uuid)'
     ) IS NULL
     OR to_regprocedure('public.messaging_can_access_conversation(uuid)') IS NULL
     OR to_regprocedure(
       'public.get_tech_conversations(integer,timestamp with time zone,uuid,text,text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'conversation foundation rollback: participant foundation is absent';
  END IF;

  IF to_regprocedure(
       'public.get_my_conversation_access_snapshot(uuid[])'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.set_my_conversation_unread_state(uuid[],boolean)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'conversation foundation rollback: unread compatibility must roll back first';
  END IF;

  SELECT count(*)
    INTO v_policy_count
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename IN (
      'conversations', 'conversation_participants', 'messages'
    )
    AND (
      (
        policy.tablename = 'conversations'
        AND policy.policyname = 'allow_authenticated_conversations'
        AND policy.cmd = 'ALL'
      )
      OR (
        policy.tablename = 'conversation_participants'
        AND policy.policyname = 'allow_authenticated_conversation_participants'
        AND policy.cmd = 'ALL'
      )
      OR (
        policy.tablename = 'messages'
        AND policy.policyname = 'messages_authenticated_select'
        AND policy.cmd = 'SELECT'
      )
    )
    AND policy.permissive = 'PERMISSIVE'
    AND policy.roles = ARRAY['authenticated']::name[];

  IF v_policy_count <> 3
     OR (
       SELECT count(*)
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename IN (
           'conversations', 'conversation_participants', 'messages'
         )
     ) <> 3 THEN
    RAISE EXCEPTION
      'conversation foundation rollback: protected policy allowlist drifted';
  END IF;

  -- If scheduled compatibility ever existed, its rollback deliberately keeps
  -- provenance and function signatures. Require the service execution surface
  -- to be paused and every linked provider reservation reconciled first.
  IF to_regclass('public.scheduled_message_creation_provenance') IS NOT NULL THEN
    FOREACH v_function IN ARRAY ARRAY[
      'public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)',
      'public.claim_scheduled_message_v2(uuid,uuid)',
      'public.release_scheduled_message_claim(uuid,uuid,text)',
      'public.fail_scheduled_message_claim(uuid,uuid,text)',
      'public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb)',
      'public.reconcile_scheduled_message_delivery(uuid)'
    ]
    LOOP
      IF has_function_privilege('service_role', v_function, 'EXECUTE')
         OR has_function_privilege('authenticated', v_function, 'EXECUTE')
         OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
        RAISE EXCEPTION
          'conversation foundation rollback: scheduled delivery remains executable: %',
          v_function;
      END IF;
    END LOOP;

    SELECT procedure.prosrc
      INTO v_legacy_claim_source
    FROM pg_catalog.pg_proc procedure
    WHERE procedure.oid = to_regprocedure(
      'public.claim_scheduled_message(uuid)'
    )
      AND procedure.prolang = (
        SELECT language.oid
        FROM pg_catalog.pg_language language
        WHERE language.lanname = 'plpgsql'
      )
      AND procedure.proowner = 'postgres'::regrole
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND NOT procedure.prosecdef
      AND procedure.proconfig =
        ARRAY['search_path=pg_catalog, public']::text[];

    IF has_table_privilege('authenticated', 'public.scheduled_messages', 'SELECT')
       OR has_table_privilege('authenticated', 'public.scheduled_messages', 'INSERT')
       OR has_table_privilege('authenticated', 'public.scheduled_messages', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.scheduled_messages', 'DELETE')
       OR has_table_privilege('anon', 'public.scheduled_messages', 'SELECT')
       OR has_table_privilege('anon', 'public.scheduled_messages', 'INSERT')
       OR has_table_privilege('anon', 'public.scheduled_messages', 'UPDATE')
       OR has_table_privilege('anon', 'public.scheduled_messages', 'DELETE')
       OR has_table_privilege(
         'authenticated',
         'public.scheduled_message_creation_provenance',
         'SELECT'
       )
       OR has_table_privilege(
         'authenticated',
         'public.scheduled_message_creation_provenance',
         'INSERT'
       )
       OR has_table_privilege(
         'authenticated',
         'public.scheduled_message_creation_provenance',
         'UPDATE'
       )
       OR has_table_privilege(
         'authenticated',
         'public.scheduled_message_creation_provenance',
         'DELETE'
       )
       OR has_table_privilege(
         'anon',
         'public.scheduled_message_creation_provenance',
         'SELECT'
       )
       OR has_table_privilege(
         'anon',
         'public.scheduled_message_creation_provenance',
         'INSERT'
       )
       OR has_table_privilege(
         'anon',
         'public.scheduled_message_creation_provenance',
         'UPDATE'
       )
       OR has_table_privilege(
         'anon',
         'public.scheduled_message_creation_provenance',
         'DELETE'
       )
       OR v_legacy_claim_source IS NULL
       OR lower(
         btrim(
           regexp_replace(
             v_legacy_claim_source,
             '[[:space:]]+',
             ' ',
             'g'
           )
         )
       ) <> 'begin return false; end;'
       OR NOT has_function_privilege(
         'authenticated',
         'public.claim_scheduled_message(uuid)',
         'EXECUTE'
       )
       OR has_function_privilege(
         'anon',
         'public.claim_scheduled_message(uuid)',
         'EXECUTE'
       )
       OR NOT has_function_privilege(
         'service_role',
         'public.claim_scheduled_message(uuid)',
         'EXECUTE'
       )
       OR EXISTS (
      SELECT 1
      FROM public.scheduled_messages
      WHERE status = 'pending'
        AND delivery_attempt_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION
        'conversation foundation rollback: scheduled delivery recovery posture is not sealed';
    END IF;
  END IF;
END;
$conversation_foundation_rollback_preflight$;

ALTER POLICY allow_authenticated_conversations
  ON public.conversations
  TO authenticated
  USING (false)
  WITH CHECK (false);

ALTER POLICY allow_authenticated_conversation_participants
  ON public.conversation_participants
  TO authenticated
  USING (false)
  WITH CHECK (false);

ALTER POLICY messages_authenticated_select
  ON public.messages
  TO authenticated
  USING (false);

REVOKE ALL ON TABLE
  public.conversations,
  public.conversation_participants,
  public.messages
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE
  public.conversations,
  public.conversation_participants,
  public.messages
  TO service_role;

-- Pause every browser, admin-editor, inbox, contact-opening, notification, and
-- author-directory surface. Keep only the two internal decision helpers
-- callable by service_role for explicit recovery diagnostics.
REVOKE ALL ON FUNCTION
  public.messaging_employee_has_conversations_capability(uuid),
  public.messaging_employee_can_access_conversation(uuid, uuid),
  public.messaging_can_access_conversation(uuid),
  public.get_conversation_members(uuid),
  public.set_conversation_member_override(uuid, uuid, boolean),
  public.set_default_conversation_member(uuid, boolean),
  public.leave_conversation(uuid),
  public.find_or_create_scoped_conversation(uuid, uuid),
  public.search_scoped_conversation_contacts(uuid, text, integer),
  public.get_conversation_notification_recipients(uuid),
  public.get_message_author_directory(uuid[]),
  public.get_tech_conversations(
    integer,
    timestamp with time zone,
    uuid,
    text,
    text,
    uuid
  )
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.messaging_employee_has_conversations_capability(uuid),
  public.messaging_employee_can_access_conversation(uuid, uuid)
  TO service_role;

DO $conversation_foundation_rollback_postcondition$
DECLARE
  v_policy record;
  v_table text;
  v_privilege text;
  v_function text;
BEGIN
  FOR v_policy IN
    SELECT *
    FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN (
        'conversations', 'conversation_participants', 'messages'
      )
  LOOP
    IF v_policy.roles <> ARRAY['authenticated']::name[]
       OR regexp_replace(
         COALESCE(v_policy.qual, ''),
         '\s+',
         '',
         'g'
       ) <> 'false'
       OR (
         v_policy.cmd = 'ALL'
         AND regexp_replace(
           COALESCE(v_policy.with_check, ''),
           '\s+',
           '',
           'g'
         ) <> 'false'
       )
       OR (
         v_policy.cmd = 'SELECT'
         AND v_policy.with_check IS NOT NULL
       ) THEN
      RAISE EXCEPTION
        'conversation foundation rollback: fail-closed policy postcondition failed';
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'public.conversations',
    'public.conversation_participants',
    'public.messages'
  ]
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF has_table_privilege('anon', v_table, v_privilege)
         OR has_table_privilege('authenticated', v_table, v_privilege)
         OR NOT has_table_privilege('service_role', v_table, v_privilege) THEN
        RAISE EXCEPTION
          'conversation foundation rollback: fail-closed ACL postcondition failed on %',
          v_table;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'public.messaging_can_access_conversation(uuid)',
    'public.get_conversation_members(uuid)',
    'public.set_conversation_member_override(uuid,uuid,boolean)',
    'public.set_default_conversation_member(uuid,boolean)',
    'public.leave_conversation(uuid)',
    'public.find_or_create_scoped_conversation(uuid,uuid)',
    'public.search_scoped_conversation_contacts(uuid,text,integer)',
    'public.get_conversation_notification_recipients(uuid)',
    'public.get_message_author_directory(uuid[])',
    'public.get_tech_conversations(integer,timestamp with time zone,uuid,text,text,uuid)'
  ]
  LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION
        'conversation foundation rollback: recovery RPC remains executable: %',
        v_function;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
       'service_role',
       'public.messaging_employee_has_conversations_capability(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.messaging_employee_can_access_conversation(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'conversation foundation rollback: internal recovery helper unavailable';
  END IF;
END;
$conversation_foundation_rollback_postcondition$;
