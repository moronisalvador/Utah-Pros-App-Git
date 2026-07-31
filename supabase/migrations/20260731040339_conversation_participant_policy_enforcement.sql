-- ════════════════════════════════════════════════
-- MIGRATION: 20260731040339_conversation_participant_policy_enforcement
-- Phase: Messaging participant controls — post-deploy enforcement
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Activates the participant-aware database read boundary after the compatible
--   tables/RPC foundation and its Worker/UI callers are deployed. Existing policy
--   objects are narrowed in place without dropping them, and direct browser creation is
--   removed; creation now goes through /api/message-conversations atomically.
--
-- DEPLOYMENT ORDER:
--   1. Apply 20260731040337_conversation_participant_scoping.sql.
--   2. Apply 20260731040338_conversation_unread_state_compatibility.sql.
--   3. Deploy and verify the Worker/UI source that uses the scoped RPCs.
--   4. Apply this enforcement migration in a separate reviewed window.
--
-- CONTRACT:
--   No table/column/function signature changes. Existing policy objects are
--   altered only after an exact baseline preflight. Authenticated browsers keep
--   SELECT access through participant-aware RLS and lose every direct table write;
--   read/unread mutations use the actor-derived compatibility RPC instead.
--
-- ROLLBACK:
--   Run
--   supabase/rollbacks/20260731040339_conversation_participant_policy_enforcement.rollback.sql.
--   It restores the exact broad policy predicates and authenticated table grants.
-- ════════════════════════════════════════════════

DO $conversation_policy_preflight$
DECLARE
  v_conversation_qual text;
  v_conversation_check text;
  v_participant_qual text;
  v_participant_check text;
  v_message_qual text;
BEGIN
  IF to_regprocedure('public.messaging_can_access_conversation(uuid)') IS NULL
     OR to_regprocedure(
       'public.find_or_create_scoped_conversation(uuid,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.search_scoped_conversation_contacts(uuid,text,integer)'
     ) IS NULL
     OR to_regprocedure(
       'public.set_my_conversation_unread_state(uuid[],boolean)'
     ) IS NULL THEN
    RAISE EXCEPTION 'conversation policy enforcement: foundation RPCs are absent';
  END IF;

  SELECT
    regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g'),
    regexp_replace(COALESCE(policy.with_check, ''), '\s+', '', 'g')
    INTO v_conversation_qual, v_conversation_check
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'conversations'
    AND policy.policyname = 'allow_authenticated_conversations'
    AND policy.permissive = 'PERMISSIVE'
    AND policy.cmd = 'ALL'
    AND policy.roles = ARRAY['authenticated']::name[];

  SELECT
    regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g'),
    regexp_replace(COALESCE(policy.with_check, ''), '\s+', '', 'g')
    INTO v_participant_qual, v_participant_check
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'conversation_participants'
    AND policy.policyname = 'allow_authenticated_conversation_participants'
    AND policy.permissive = 'PERMISSIVE'
    AND policy.cmd = 'ALL'
    AND policy.roles = ARRAY['authenticated']::name[];

  SELECT regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g')
    INTO v_message_qual
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'messages'
    AND policy.policyname = 'messages_authenticated_select'
    AND policy.permissive = 'PERMISSIVE'
    AND policy.cmd = 'SELECT'
    AND policy.roles = ARRAY['authenticated']::name[]
    AND policy.with_check IS NULL;

  IF v_conversation_qual IS DISTINCT FROM 'true'
     OR v_conversation_check IS DISTINCT FROM 'true'
     OR v_participant_qual IS DISTINCT FROM 'true'
     OR v_participant_check IS DISTINCT FROM 'true'
     OR replace(v_message_qual, 'public.', '')
        IS DISTINCT FROM 'messaging_can_access_conversations()'
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversations',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversations',
       'UPDATE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversations',
       'DELETE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'UPDATE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'DELETE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversations',
       'TRUNCATE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversations',
       'REFERENCES'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversations',
       'TRIGGER'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'TRUNCATE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'REFERENCES'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'TRIGGER'
     ) THEN
    RAISE EXCEPTION 'conversation policy enforcement: deployed policy/ACL baseline drifted';
  END IF;
END;
$conversation_policy_preflight$;

ALTER POLICY allow_authenticated_conversations
  ON public.conversations
  TO authenticated
  USING (public.messaging_can_access_conversation(id))
  WITH CHECK (false);

ALTER POLICY allow_authenticated_conversation_participants
  ON public.conversation_participants
  TO authenticated
  USING (public.messaging_can_access_conversation(conversation_id))
  WITH CHECK (false);

ALTER POLICY messages_authenticated_select
  ON public.messages
  TO authenticated
  USING (
    public.messaging_can_access_conversations()
    AND public.messaging_can_access_conversation(conversation_id)
  );

REVOKE ALL ON TABLE public.conversations, public.conversation_participants
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.conversations, public.conversation_participants
  TO authenticated;
GRANT ALL ON TABLE public.conversations, public.conversation_participants
  TO service_role;

DO $conversation_policy_postcondition$
DECLARE
  v_table text;
  v_privilege text;
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'conversations'
         AND policy.policyname = 'allow_authenticated_conversations'
         AND policy.permissive = 'PERMISSIVE'
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
         AND policy.permissive = 'PERMISSIVE'
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
    RAISE EXCEPTION 'conversation policy enforcement: policy postcondition failed';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'public.conversations',
    'public.conversation_participants'
  ]
  LOOP
    IF NOT has_table_privilege('authenticated', v_table, 'SELECT')
       OR NOT has_table_privilege('service_role', v_table, 'SELECT') THEN
      RAISE EXCEPTION 'conversation policy enforcement: required SELECT is missing on %',
        v_table;
    END IF;

    FOREACH v_privilege IN ARRAY ARRAY[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF has_table_privilege('authenticated', v_table, v_privilege)
         OR has_table_privilege('anon', v_table, v_privilege)
         OR NOT has_table_privilege('service_role', v_table, v_privilege) THEN
        RAISE EXCEPTION
          'conversation policy enforcement: % ACL postcondition failed on %',
          v_privilege,
          v_table;
      END IF;
    END LOOP;

    IF has_table_privilege('anon', v_table, 'SELECT') THEN
      RAISE EXCEPTION 'conversation policy enforcement: anon SELECT remains on %',
        v_table;
    END IF;
  END LOOP;
END;
$conversation_policy_postcondition$;
