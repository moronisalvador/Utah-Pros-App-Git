-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260731213000_conversation_assignment_authority_containment
-- ═════════════════════════════════════════════════════════════════════════════
--
-- SECURITY POSTURE:
--   The historical appointment/job chain is browser-writable and is therefore
--   never restored as authorization evidence. This recovery rollback pauses the
--   participant editor/contact-opening surfaces, seals raw conversation tables,
--   and limits remaining scoped RPC access to active internal privileged roles
--   until a forward repair is reviewed.
--
-- REQUIRED ORDER:
--   Roll back scheduled delivery and participant-policy enforcement first.
--   Do not expose an application while this privileged-only recovery posture is
--   active.
-- ═════════════════════════════════════════════════════════════════════════════

DO $conversation_assignment_authority_rollback_preflight$
DECLARE
  v_source text;
  v_function text;
  v_legacy_claim_source text;
BEGIN
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
         AND policy.tablename = 'conversations'
         AND policy.policyname = 'allow_authenticated_conversations'
         AND policy.cmd = 'ALL'
         AND policy.roles = ARRAY['authenticated']::name[]
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'conversation_participants'
         AND policy.policyname = 'allow_authenticated_conversation_participants'
         AND policy.cmd = 'ALL'
         AND policy.roles = ARRAY['authenticated']::name[]
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'messages'
         AND policy.policyname = 'messages_authenticated_select'
         AND policy.cmd = 'SELECT'
         AND policy.roles = ARRAY['authenticated']::name[]
     ) THEN
    RAISE EXCEPTION
      'conversation assignment authority rollback: protected policy allowlist drifted';
  END IF;

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
          'conversation assignment authority rollback: scheduled delivery remains executable: %',
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
         regexp_replace(
           btrim(v_legacy_claim_source),
           '[[:space:]]+',
           ' ',
           'g'
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
        'conversation assignment authority rollback: scheduled delivery recovery posture is not sealed';
    END IF;
  END IF;

  SELECT procedure.prosrc
    INTO v_source
  FROM pg_catalog.pg_proc procedure
  WHERE procedure.oid = to_regprocedure(
    'public.messaging_employee_can_access_conversation(uuid,uuid)'
  );

  IF v_source IS NULL
     OR v_source ~
       '(appointment_crew|public\.appointments|public\.jobs|public\.claims)' THEN
    RAISE EXCEPTION
      'conversation assignment authority rollback: trusted-membership baseline drifted';
  END IF;
END;
$conversation_assignment_authority_rollback_preflight$;

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

CREATE OR REPLACE FUNCTION public.messaging_employee_can_access_conversation(
  p_employee_id uuid,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = p_employee_id
      AND employee.is_active
      AND NOT employee.is_external
      AND employee.role::text IN (
        'admin', 'office', 'project_manager', 'supervisor'
      )
  );
$function$;

ALTER FUNCTION public.messaging_employee_can_access_conversation(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.messaging_employee_can_access_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.messaging_employee_can_access_conversation(uuid, uuid)
  TO service_role;
COMMENT ON FUNCTION
  public.messaging_employee_can_access_conversation(uuid, uuid) IS
  'Fail-closed recovery membership decision: active internal privileged roles only.';

-- Pause the three surfaces that have independent participant/new-contact
-- presentation logic. Existing inbox/read/send predicates all flow through the
-- privileged-only helper above.
REVOKE ALL ON FUNCTION
  public.get_conversation_members(uuid),
  public.find_or_create_scoped_conversation(uuid, uuid),
  public.search_scoped_conversation_contacts(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

DO $conversation_assignment_authority_rollback_postcondition$
DECLARE
  v_source text;
  v_table text;
  v_privilege text;
BEGIN
  SELECT procedure.prosrc
    INTO v_source
  FROM pg_catalog.pg_proc procedure
  WHERE procedure.oid = to_regprocedure(
    'public.messaging_employee_can_access_conversation(uuid,uuid)'
  );

  IF v_source IS NULL
     OR v_source ~
       '(appointment_crew|public\.appointments|public\.jobs|public\.claims|conversation_member_overrides|conversation_default_members)'
     OR has_function_privilege(
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
     OR has_function_privilege(
       'authenticated',
       'public.get_conversation_members(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.find_or_create_scoped_conversation(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.search_scoped_conversation_contacts(uuid,text,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'conversation assignment authority rollback: fail-closed postcondition failed';
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
         OR has_table_privilege('authenticated', v_table, v_privilege)
         OR NOT has_table_privilege('service_role', v_table, v_privilege) THEN
        RAISE EXCEPTION
          'conversation assignment authority rollback: fail-closed ACL postcondition failed on %',
          v_table;
      END IF;
    END LOOP;
  END LOOP;
END;
$conversation_assignment_authority_rollback_postcondition$;
