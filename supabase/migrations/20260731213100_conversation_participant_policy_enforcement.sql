-- ════════════════════════════════════════════════
-- MIGRATION: 20260731213100_conversation_participant_policy_enforcement
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
--   3. Apply 20260731213000_conversation_assignment_authority_containment.sql.
--   4. Deploy and verify the Worker/UI source that uses the scoped RPCs.
--   5. Apply this enforcement migration in a separate reviewed window.
--
-- CONTRACT:
--   No table/column/function signature changes. Existing policy objects are
--   altered only after an exact baseline preflight. Authenticated browsers keep
--   SELECT access through participant-aware RLS and lose every direct table write;
--   read/unread mutations use the actor-derived compatibility RPC instead.
--
-- ROLLBACK:
--   Run
--   supabase/rollbacks/20260731213100_conversation_participant_policy_enforcement.rollback.sql.
--   It pauses browser access and preserves service-role recovery access. It
--   never restores the historical company-wide policies or raw browser writes.
-- ════════════════════════════════════════════════

DO $conversation_policy_preflight$
DECLARE
  v_conversation_qual text;
  v_conversation_check text;
  v_participant_qual text;
  v_participant_check text;
  v_message_qual text;
  v_policy_count integer;
  v_table text;
  v_privilege text;
  v_expected record;
  v_oid oid;
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

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'conversation_assignment_authority_containment'
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'conversation policy enforcement: trusted assignment correction is absent';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.messaging_employee_can_access_conversation(uuid,uuid)',
          'd10e6fa5fd127ed02aa39f8f926b413f',
          false,
          's'
        ),
        (
          'public.get_conversation_members(uuid)',
          'aca0b900196f638c3e8d256511c5f337',
          true,
          's'
        ),
        (
          'public.find_or_create_scoped_conversation(uuid,uuid)',
          '9ef41ca3a8b1f831aa3fc5beda6372d4',
          false,
          'v'
        ),
        (
          'public.search_scoped_conversation_contacts(uuid,text,integer)',
          '0b3eeb041ebf31c09711451568dd2229',
          false,
          's'
        )
    ) AS expected(identity, body_md5, security_definer, volatility)
  LOOP
    v_oid := to_regprocedure(v_expected.identity);
    IF v_oid IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc procedure
         JOIN pg_catalog.pg_roles owner_role
           ON owner_role.oid = procedure.proowner
         WHERE procedure.oid = v_oid
           AND owner_role.rolname = 'postgres'
           AND procedure.prosecdef = v_expected.security_definer
           AND procedure.provolatile = v_expected.volatility::"char"
           AND procedure.proconfig =
             ARRAY['search_path=pg_catalog, public']::text[]
           AND md5(replace(procedure.prosrc, chr(13), '')) =
             v_expected.body_md5
           AND procedure.prosrc !~
             '(appointment_crew|public\.appointments|public\.jobs|public\.claims)'
       ) THEN
      RAISE EXCEPTION
        'conversation policy enforcement: trusted assignment function drifted: %',
        v_expected.identity;
    END IF;
  END LOOP;

  IF has_function_privilege(
       'authenticated',
       'public.messaging_employee_can_access_conversation(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.messaging_employee_can_access_conversation(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.messaging_employee_can_access_conversation(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.get_conversation_members(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.get_conversation_members(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.find_or_create_scoped_conversation(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.find_or_create_scoped_conversation(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.search_scoped_conversation_contacts(uuid,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.search_scoped_conversation_contacts(uuid,text,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'conversation policy enforcement: trusted assignment ACL drifted';
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

  -- RLS combines every permissive policy with OR. The named-policy checks below
  -- are therefore insufficient by themselves: an unexpected authenticated policy
  -- with USING (true) would reopen the whole table. The deployed baseline has
  -- exactly these three browser policies, one per protected table.
  SELECT count(*)
    INTO v_policy_count
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename IN (
      'conversations', 'conversation_participants', 'messages'
    );

  IF v_policy_count <> 3
     OR v_conversation_qual IS DISTINCT FROM 'true'
     OR v_conversation_check IS DISTINCT FROM 'true'
     OR v_participant_qual IS DISTINCT FROM 'true'
     OR v_participant_check IS DISTINCT FROM 'true'
     OR replace(v_message_qual, 'public.', '')
        IS DISTINCT FROM 'messaging_can_access_conversations()'
  THEN
    RAISE EXCEPTION 'conversation policy enforcement: deployed policy/ACL baseline drifted';
  END IF;

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
         OR NOT has_table_privilege('service_role', v_table, v_privilege) THEN
        RAISE EXCEPTION
          'conversation policy enforcement: deployed % ACL baseline drifted on %',
          v_privilege,
          v_table;
      END IF;

      IF v_table = 'public.messages' THEN
        IF (v_privilege = 'SELECT') IS DISTINCT FROM has_table_privilege(
          'authenticated', v_table, v_privilege
        ) THEN
          RAISE EXCEPTION
            'conversation policy enforcement: deployed authenticated ACL baseline drifted on %',
            v_table;
        END IF;
      ELSIF NOT has_table_privilege('authenticated', v_table, v_privilege) THEN
        RAISE EXCEPTION
          'conversation policy enforcement: deployed authenticated % ACL baseline drifted on %',
          v_privilege,
          v_table;
      END IF;
    END LOOP;
  END LOOP;
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

REVOKE ALL ON TABLE public.conversations, public.conversation_participants, public.messages
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.conversations, public.conversation_participants, public.messages
  TO authenticated;
GRANT ALL ON TABLE public.conversations, public.conversation_participants, public.messages
  TO service_role;

-- The attachment signer must not read a caller-selected private message with
-- service-role table access before proving that the employee can still access
-- its conversation. Keep that lookup and authorization in one database call.
CREATE OR REPLACE FUNCTION public.messaging_get_authorized_message_media(
  p_employee_id uuid,
  p_message_id uuid
)
RETURNS TABLE(conversation_id uuid, media_urls jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.role() <> 'service_role'
     OR p_employee_id IS NULL
     OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'message media lookup is service-role only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT message.conversation_id, message.media_urls
  FROM public.messages message
  WHERE message.id = p_message_id
    AND public.messaging_employee_can_access_conversation(
      p_employee_id,
      message.conversation_id
    );
END;
$function$;
ALTER FUNCTION public.messaging_get_authorized_message_media(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.messaging_get_authorized_message_media(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.messaging_get_authorized_message_media(uuid, uuid)
  TO service_role;

DO $conversation_policy_postcondition$
DECLARE
  v_table text;
  v_privilege text;
  v_policy_count integer;
BEGIN
  SELECT count(*)
    INTO v_policy_count
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename IN (
      'conversations', 'conversation_participants', 'messages'
    );

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

  IF v_policy_count <> 3
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'messages'
         AND policy.policyname = 'messages_authenticated_select'
         AND policy.permissive = 'PERMISSIVE'
         AND policy.cmd = 'SELECT'
         AND policy.roles = ARRAY['authenticated']::name[]
         AND policy.with_check IS NULL
         AND replace(
           regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g'),
           'public.',
           ''
         ) = '(messaging_can_access_conversations()ANDmessaging_can_access_conversation(conversation_id))'
     ) THEN
    RAISE EXCEPTION 'conversation policy enforcement: exhaustive policy postcondition failed';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'public.conversations',
    'public.conversation_participants',
    'public.messages'
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

  IF has_function_privilege(
       'anon',
       'public.messaging_get_authorized_message_media(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.messaging_get_authorized_message_media(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.messaging_get_authorized_message_media(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc procedure
       JOIN pg_catalog.pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = to_regprocedure(
         'public.messaging_get_authorized_message_media(uuid,uuid)'
       )
         AND owner_role.rolname = 'postgres'
         AND procedure.prosecdef
         AND procedure.provolatile = 's'
         AND procedure.proconfig =
           ARRAY['search_path=pg_catalog, public']::text[]
         AND procedure.prosrc ~
           'messaging_employee_can_access_conversation'
         AND procedure.prosrc ~ 'auth\.role\(\)'
         AND procedure.prosrc ~ 'service_role'
     ) THEN
    RAISE EXCEPTION
      'conversation policy enforcement: message media boundary drifted';
  END IF;
END;
$conversation_policy_postcondition$;
