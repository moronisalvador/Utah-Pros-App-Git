-- ════════════════════════════════════════════════
-- ROLLBACK: 20260731040339_conversation_participant_policy_enforcement
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Restores the company-wide authenticated conversation policies and direct
--   browser table grants that existed before participant enforcement.
--
-- SECURITY WARNING:
--   This intentionally reopens the earlier broad internal visibility model.
--   Use it only as the reviewed emergency rollback, then investigate immediately.
-- ════════════════════════════════════════════════

DO $conversation_policy_rollback_preflight$
DECLARE
  v_conversation_qual text;
  v_conversation_check text;
  v_participant_qual text;
  v_participant_check text;
  v_message_qual text;
BEGIN
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

  IF replace(v_conversation_qual, 'public.', '')
       IS DISTINCT FROM 'messaging_can_access_conversation(id)'
     OR replace(v_participant_qual, 'public.', '')
       IS DISTINCT FROM 'messaging_can_access_conversation(conversation_id)'
     OR v_conversation_check IS DISTINCT FROM 'false'
     OR v_participant_check IS DISTINCT FROM 'false'
     OR replace(v_message_qual, 'public.', '')
       IS DISTINCT FROM '(messaging_can_access_conversations()ANDmessaging_can_access_conversation(conversation_id))'
     OR has_table_privilege(
       'authenticated',
       'public.conversations',
       'INSERT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'INSERT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversations',
       'UPDATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversations',
       'DELETE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'UPDATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'DELETE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversations',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversations',
       'REFERENCES'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversations',
       'TRIGGER'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'REFERENCES'
     )
     OR has_table_privilege(
       'authenticated',
       'public.conversation_participants',
       'TRIGGER'
     ) THEN
    RAISE EXCEPTION 'conversation policy rollback: participant-aware policy/ACL baseline drifted';
  END IF;
END;
$conversation_policy_rollback_preflight$;

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

GRANT ALL ON TABLE public.conversations, public.conversation_participants
  TO authenticated, service_role;
