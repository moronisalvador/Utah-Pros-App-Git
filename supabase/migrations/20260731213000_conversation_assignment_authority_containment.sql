-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260731213000_conversation_assignment_authority_containment
-- Phase: Messaging participant controls — trusted assignment correction
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops treating appointment/job records as conversation membership evidence.
--   Those records are still directly writable by authenticated clients, so they
--   cannot safely authorize private message reads or a company SMS. Privileged
--   staff, admin-managed manual membership, and admin-managed default technicians
--   remain the trusted participant sources.
--
-- WHY THIS IS SEPARATE:
--   20260731040337 and 20260731040338 are already provenance-verified on the QA
--   branch. This correction preserves those exact applied files and replaces
--   only their affected function bodies in a new ledgered migration.
--   Operational wording inside those immutable sources is historical: this file
--   supersedes their appointment-authority and rollback comments, and 31213100
--   supersedes their deleted 40339 enforcement reference. The current recovery
--   chain is 31220100 -> 31220000 -> 31213100 -> 31213000 -> 40338 -> 40337;
--   every rollback is a fail-closed service pause, not restoration of old access.
--
-- ROLLOUT ORDER:
--   Apply immediately after 40337 + 40338 with no application exposure between
--   them. Verify this correction before deploying participant-aware callers or
--   applying policy enforcement / scheduled-message delivery migrations.
--
-- ROLLBACK:
--   The paired rollback fails closed to privileged-only conversation access. It
--   never restores the known browser-forgeable appointment chain.
-- ═════════════════════════════════════════════════════════════════════════════

DO $conversation_assignment_authority_preflight$
DECLARE
  v_employee_policies text[];
  v_authenticated_columns text[];
  v_expected record;
  v_oid oid;
BEGIN
  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'conversation_participant_scoping'
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'conversation_unread_state_compatibility'
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'conversation assignment authority: participant compatibility ledger is absent';
  END IF;

  -- Employee identity is an authorization input. Accept the exact contained
  -- catalog posture rather than only a ledger name because a Supabase branch
  -- can inherit the production schema without copying every historical ledger row.
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class relation
       JOIN pg_catalog.pg_namespace namespace
         ON namespace.oid = relation.relnamespace
       JOIN pg_catalog.pg_roles owner_role
         ON owner_role.oid = relation.relowner
       WHERE namespace.nspname = 'public'
         AND relation.relname = 'employees'
         AND relation.relkind = 'r'
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
     )
     OR has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR has_table_privilege('authenticated', 'public.employees', 'INSERT')
     OR has_table_privilege('authenticated', 'public.employees', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.employees', 'DELETE')
     OR has_table_privilege('authenticated', 'public.employees', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.employees', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.employees', 'TRIGGER')
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege('anon', 'public.employees', 'INSERT')
     OR has_table_privilege('anon', 'public.employees', 'UPDATE')
     OR has_table_privilege('anon', 'public.employees', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.employees', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.employees', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.employees', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.employees', 'DELETE') THEN
    RAISE EXCEPTION
      'conversation assignment authority: employee identity table is not contained';
  END IF;

  SELECT array_agg(policy.policyname ORDER BY policy.policyname)
    INTO v_employee_policies
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'employees';

  SELECT array_agg(attribute.attname ORDER BY attribute.attname)
    INTO v_authenticated_columns
  FROM pg_catalog.pg_attribute attribute
  WHERE attribute.attrelid = 'public.employees'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND has_column_privilege(
      'authenticated',
      'public.employees',
      attribute.attname,
      'SELECT'
    );

  IF v_employee_policies IS DISTINCT FROM
       ARRAY['employees_self_identity_read']::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'employees'
         AND policy.policyname = 'employees_self_identity_read'
         AND policy.permissive = 'PERMISSIVE'
         AND policy.roles = ARRAY['authenticated']::name[]
         AND policy.cmd = 'SELECT'
         AND regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g')
           = '(auth_user_id=auth.uid())'
         AND policy.with_check IS NULL
     )
     OR v_authenticated_columns IS DISTINCT FROM
       ARRAY['auth_user_id', 'id', 'is_active', 'is_external', 'role']::text[] THEN
    RAISE EXCEPTION
      'conversation assignment authority: employee identity policy/column boundary drifted';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.messaging_employee_can_access_conversation(uuid,uuid)',
          '087f3d3c9237db13a24904bc35297c18',
          false,
          's'
        ),
        (
          'public.get_conversation_members(uuid)',
          '9abc715cfe540545843f0e4739caf553',
          true,
          's'
        ),
        (
          'public.find_or_create_scoped_conversation(uuid,uuid)',
          'd53cefca6abab3120d4692dc310224df',
          false,
          'v'
        ),
        (
          'public.search_scoped_conversation_contacts(uuid,text,integer)',
          '42251697a92098be0b651e416bde7807',
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
       ) THEN
      RAISE EXCEPTION
        'conversation assignment authority: reviewed function drifted: %',
        v_expected.identity;
    END IF;
  END LOOP;
END;
$conversation_assignment_authority_preflight$;

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
  WITH employee_row AS (
    SELECT employee.id, employee.role::text AS role
    FROM public.employees employee
    WHERE employee.id = p_employee_id
      AND employee.is_active
      AND NOT employee.is_external
    LIMIT 1
  ),
  manual_choice AS (
    SELECT override_row.included
    FROM public.conversation_member_overrides override_row
    JOIN employee_row ON true
    WHERE override_row.conversation_id = p_conversation_id
      AND override_row.employee_id = employee_row.id
    LIMIT 1
  )
  SELECT COALESCE((
    SELECT CASE
      WHEN employee_row.role IN ('admin', 'office', 'project_manager', 'supervisor')
        THEN true
      WHEN employee_row.role = 'crm_partner'
        THEN false
      WHEN EXISTS (SELECT 1 FROM manual_choice)
        THEN (SELECT included FROM manual_choice)
      WHEN EXISTS (
        SELECT 1
        FROM public.conversation_default_members default_member
        WHERE default_member.employee_id = employee_row.id
      )
        THEN true
      ELSE false
    END
    FROM employee_row
  ), false);
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
  'Service-only trusted staff membership decision: privileged role, manual override, then default technician. Browser-writable appointment/job records are not authorization evidence.';

CREATE OR REPLACE FUNCTION public.get_conversation_members(
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_members jsonb;
BEGIN
  IF NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'get_conversation_members is admin-only'
      USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.conversations conversation
       WHERE conversation.id = p_conversation_id
     ) THEN
    RAISE EXCEPTION 'conversation not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'employee_id', employee.id,
      'name', COALESCE(NULLIF(employee.display_name, ''), employee.full_name, employee.email),
      'email', employee.email,
      'role', employee.role::text,
      'included', public.messaging_employee_can_access_conversation(
        employee.id,
        p_conversation_id
      ),
      'source', CASE
        WHEN employee.role::text IN ('admin', 'office', 'project_manager', 'supervisor')
          THEN 'privileged'
        WHEN override_row.employee_id IS NOT NULL AND override_row.included
          THEN 'manual_add'
        WHEN override_row.employee_id IS NOT NULL AND NOT override_row.included
          THEN 'manual_remove'
        WHEN default_member.employee_id IS NOT NULL
          THEN 'default'
        ELSE 'none'
      END,
      'is_default', default_member.employee_id IS NOT NULL,
      'has_override', override_row.employee_id IS NOT NULL,
      'can_edit', employee.role::text NOT IN (
        'admin', 'office', 'project_manager', 'supervisor', 'crm_partner'
      ),
      'can_default', employee.role::text = 'field_tech'
    )
    ORDER BY
      CASE employee.role::text
        WHEN 'field_tech' THEN 0
        WHEN 'estimator' THEN 1
        ELSE 2
      END,
      COALESCE(NULLIF(employee.display_name, ''), employee.full_name, employee.email)
  ), '[]'::jsonb)
    INTO v_members
  FROM public.employees employee
  LEFT JOIN public.conversation_member_overrides override_row
    ON override_row.conversation_id = p_conversation_id
   AND override_row.employee_id = employee.id
  LEFT JOIN public.conversation_default_members default_member
    ON default_member.employee_id = employee.id
  WHERE employee.is_active
    AND NOT employee.is_external
    AND employee.role::text <> 'crm_partner';

  RETURN v_members;
END;
$function$;

ALTER FUNCTION public.get_conversation_members(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_conversation_members(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_members(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.find_or_create_scoped_conversation(
  p_contact_id uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_existing_conversation_id uuid;
  v_conversation jsonb;
  v_conversation_id uuid;
  v_can_start boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'find_or_create_scoped_conversation is service-role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_contact_id IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'contact and employee are required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.messaging_employee_has_conversations_capability(p_employee_id) THEN
    RAISE EXCEPTION 'Messages access is not granted'
      USING ERRCODE = '42501';
  END IF;

  SELECT conversation.id
    INTO v_existing_conversation_id
  FROM public.conversations conversation
  JOIN public.conversation_participants participant
    ON participant.conversation_id = conversation.id
   AND participant.contact_id = p_contact_id
   AND participant.is_active
   AND participant.removed_at IS NULL
  WHERE conversation.type = 'direct'
    AND conversation.status <> 'archived'
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_participants other
      WHERE other.conversation_id = conversation.id
        AND other.contact_id IS DISTINCT FROM p_contact_id
    )
  ORDER BY
    COALESCE(conversation.last_message_at, conversation.created_at) DESC,
    conversation.id DESC
  LIMIT 1;

  IF v_existing_conversation_id IS NOT NULL THEN
    IF NOT public.messaging_employee_can_access_conversation(
      p_employee_id,
      v_existing_conversation_id
    ) THEN
      RAISE EXCEPTION 'conversation access not found'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = p_employee_id
        AND employee.is_active
        AND NOT employee.is_external
        AND CASE
          WHEN employee.role::text IN (
            'admin', 'office', 'project_manager', 'supervisor'
          )
            THEN true
          WHEN employee.role::text = 'crm_partner'
            THEN false
          ELSE EXISTS (
            SELECT 1
            FROM public.conversation_default_members default_member
            WHERE default_member.employee_id = employee.id
          )
        END
    )
      INTO v_can_start;

    IF NOT COALESCE(v_can_start, false) THEN
      RAISE EXCEPTION 'conversation access not found'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_conversation := public.find_or_create_conversation(p_contact_id);
  v_conversation_id := NULLIF(v_conversation ->> 'id', '')::uuid;

  IF v_conversation_id IS NULL
     OR NOT public.messaging_employee_can_access_conversation(
       p_employee_id,
       v_conversation_id
     ) THEN
    RAISE EXCEPTION 'conversation access not found'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_conversation;
END;
$function$;

ALTER FUNCTION public.find_or_create_scoped_conversation(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.find_or_create_scoped_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.find_or_create_scoped_conversation(uuid, uuid)
  TO service_role;
COMMENT ON FUNCTION public.find_or_create_scoped_conversation(uuid, uuid) IS
  'Service-only atomic browser boundary: opens an existing direct thread only for a trusted member, or creates one only for privileged/default staff.';

CREATE OR REPLACE FUNCTION public.search_scoped_conversation_contacts(
  p_employee_id uuid,
  p_search text,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  company text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_like text;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 25);
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'search_scoped_conversation_contacts is service-role only'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.messaging_employee_has_conversations_capability(p_employee_id) THEN
    RAISE EXCEPTION 'Messages access is not granted'
      USING ERRCODE = '42501';
  END IF;

  IF v_search IS NULL OR char_length(v_search) < 2 OR char_length(v_search) > 80 THEN
    RAISE EXCEPTION 'search must contain 2 to 80 characters'
      USING ERRCODE = '22023';
  END IF;

  v_like := '%' || replace(
    replace(replace(v_search, '\', '\\'), '%', '\%'),
    '_',
    '\_'
  ) || '%';

  RETURN QUERY
  SELECT contact.id, contact.name, contact.phone, contact.company
  FROM public.contacts contact
  WHERE contact.phone IS NOT NULL
    AND btrim(contact.phone) <> ''
    AND (
      contact.name ILIKE v_like
      OR contact.phone ILIKE v_like
      OR contact.company ILIKE v_like
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.conversations conversation
        JOIN public.conversation_participants participant
          ON participant.conversation_id = conversation.id
         AND participant.contact_id = contact.id
         AND participant.is_active
         AND participant.removed_at IS NULL
        WHERE conversation.type = 'direct'
          AND conversation.status <> 'archived'
          AND public.messaging_employee_can_access_conversation(
            p_employee_id,
            conversation.id
          )
      )
      OR (
        NOT EXISTS (
          SELECT 1
          FROM public.conversations conversation
          JOIN public.conversation_participants participant
            ON participant.conversation_id = conversation.id
           AND participant.contact_id = contact.id
           AND participant.is_active
           AND participant.removed_at IS NULL
          WHERE conversation.type = 'direct'
            AND conversation.status <> 'archived'
        )
        AND EXISTS (
          SELECT 1
          FROM public.employees employee
          WHERE employee.id = p_employee_id
            AND employee.is_active
            AND NOT employee.is_external
            AND CASE
              WHEN employee.role::text IN (
                'admin', 'office', 'project_manager', 'supervisor'
              )
                THEN true
              WHEN employee.role::text = 'crm_partner'
                THEN false
              ELSE EXISTS (
                SELECT 1
                FROM public.conversation_default_members default_member
                WHERE default_member.employee_id = employee.id
              )
            END
        )
      )
    )
  ORDER BY contact.name ASC NULLS LAST, contact.id
  LIMIT v_limit;
END;
$function$;

ALTER FUNCTION public.search_scoped_conversation_contacts(uuid, text, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.search_scoped_conversation_contacts(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.search_scoped_conversation_contacts(uuid, text, integer)
  TO service_role;
COMMENT ON FUNCTION
  public.search_scoped_conversation_contacts(uuid, text, integer) IS
  'Service-only bounded picker: minimal contact fields for an existing trusted thread or a new privileged/default thread.';

DO $conversation_assignment_authority_postcondition$
DECLARE
  v_identity text;
  v_source text;
  v_expected record;
  v_oid oid;
BEGIN
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
       ) THEN
      RAISE EXCEPTION
        'conversation assignment authority: exact function postcondition failed: %',
        v_expected.identity;
    END IF;
  END LOOP;

  FOREACH v_identity IN ARRAY ARRAY[
    'public.messaging_employee_can_access_conversation(uuid,uuid)',
    'public.get_conversation_members(uuid)',
    'public.find_or_create_scoped_conversation(uuid,uuid)',
    'public.search_scoped_conversation_contacts(uuid,text,integer)'
  ]
  LOOP
    SELECT procedure.prosrc
      INTO v_source
    FROM pg_catalog.pg_proc procedure
    WHERE procedure.oid = to_regprocedure(v_identity);

    IF v_source IS NULL
       OR v_source ~
         '(appointment_crew|public\.appointments|public\.jobs|public\.claims)' THEN
      RAISE EXCEPTION
        'conversation assignment authority: browser-writable assignment source remains in %',
        v_identity;
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
      'conversation assignment authority: function ACL postcondition failed';
  END IF;
END;
$conversation_assignment_authority_postcondition$;
