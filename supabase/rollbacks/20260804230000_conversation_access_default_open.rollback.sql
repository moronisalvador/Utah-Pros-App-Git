-- ════════════════════════════════════════════════
-- ROLLBACK: 20260804230000_conversation_access_default_open
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the conversation lock back on. Restores the 2026-08-01 rule where a
--   person can only see a conversation, start one, or find a customer if
--   somebody explicitly added them.
--
-- READ THIS BEFORE RUNNING IT:
--   This is NOT a harmless undo. Measured 2026-08-04, running this re-locks all
--   3 active field technicians out of EVERY conversation, stops them starting
--   new ones, hides customers from their contact picker, and stops their
--   new-message notifications (get_conversation_notification_recipients gates on
--   the same predicate). That outcome is the exact defect the forward migration
--   was written to correct, so run this only as a deliberate re-closure.
--
--   All three bodies below are byte-exact to the live 2026-08-01 definitions
--   captured from pg_get_functiondef before replacement, including the
--   privileged-role shortcut and the conversation_default_members gate. The
--   original catalog comment is restored rather than erased.
--
--   The forward migration's REVOKE/GRANT posture (service-role-only) is already
--   the correct one and is re-asserted here rather than reverted — reverting it
--   would only risk re-opening a browser role.
-- ════════════════════════════════════════════════

-- ─── 1. Read / reply on an existing thread ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.messaging_employee_can_access_conversation(
  p_employee_id uuid,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
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

COMMENT ON FUNCTION public.messaging_employee_can_access_conversation(uuid, uuid) IS
  'Service-only trusted staff membership decision: privileged role, manual override, then default '
  'technician. Browser-writable appointment/job records are not authorization evidence.';

-- ─── 2. Start a NEW thread with a customer ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_or_create_scoped_conversation(
  p_contact_id uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
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

-- ─── 3. Find the customer in the contact picker ───────────────────────────────
CREATE OR REPLACE FUNCTION public.search_scoped_conversation_contacts(
  p_employee_id uuid,
  p_search text,
  p_limit integer DEFAULT 25
)
RETURNS TABLE(id uuid, name text, phone text, company text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
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

-- ─── Grants (re-asserted, not reverted) ───────────────────────────────────────
REVOKE ALL ON FUNCTION public.messaging_employee_can_access_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messaging_employee_can_access_conversation(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.find_or_create_scoped_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_scoped_conversation(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.search_scoped_conversation_contacts(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_scoped_conversation_contacts(uuid, text, integer)
  TO service_role;
