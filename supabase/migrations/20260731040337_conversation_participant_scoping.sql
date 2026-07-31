-- ════════════════════════════════════════════════
-- MIGRATION: 20260731040337_conversation_participant_scoping
-- Phase: Messaging participant controls
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Gives administrators one place to choose which staff members can open each
--   customer conversation. Technicians can be included automatically from their
--   historical appointments, included in every chat by default, or added and
--   removed from one chat by an administrator.
--
--   The same decision controls the inbox, individual message reads, participant
--   editing, unread totals, and inbound-message notifications. Office leaders
--   keep access to every conversation and external accounts never receive access.
--   Message sender names now follow that same per-conversation rule, including
--   normal outbound and inbound messages rather than internal notes alone.
--
-- ADDITIVE-ONLY:
--   Adds two small staff-membership tables and new RPCs. Existing table columns
--   and RPC signatures stay unchanged. The compatible inbox/author bodies are
--   replaced without changing signatures or return shapes. Browser policy/ACL
--   enforcement is staged separately in 20260731040339 after the Worker/UI deploy.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260731040337_conversation_participant_scoping.rollback.sql.
--   It restores the prior inbox function and internal-note-only author lookup,
--   then drops the new functions and tables. If later migrations were applied,
--   roll back 20260731040339 enforcement first, then 20260731040338 compatibility.
--   Removing the two new tables discards any administrator choices recorded
--   after this migration is applied.
-- ════════════════════════════════════════════════

-- ─── SECTION: Dependency preflight ───────────────────────────────────────────

DO $conversation_participant_preflight$
BEGIN
  IF to_regclass('public.conversations') IS NULL
     OR to_regclass('public.conversation_participants') IS NULL
     OR to_regclass('public.employees') IS NULL
     OR to_regclass('public.appointment_crew') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.jobs') IS NULL
     OR to_regclass('public.claims') IS NULL
     OR to_regclass('public.employee_page_access') IS NULL
     OR to_regclass('public.feature_flags') IS NULL
     OR to_regclass('public.nav_permissions') IS NULL THEN
    RAISE EXCEPTION 'conversation participant scoping: required messaging or scheduling table is absent';
  END IF;

  IF to_regprocedure('public.messaging_can_access_conversations()') IS NULL
     OR to_regprocedure('public.is_active_internal_admin()') IS NULL
     OR to_regprocedure(
       'public.get_tech_conversations(integer,timestamp with time zone,uuid,text,text,uuid)'
     ) IS NULL
     OR to_regprocedure('public.find_or_create_conversation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'conversation participant scoping: required authorization or inbox function is absent';
  END IF;

END;
$conversation_participant_preflight$;

-- ─── SECTION: Staff membership state ─────────────────────────────────────────

CREATE TABLE public.conversation_member_overrides (
  conversation_id uuid NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  included boolean NOT NULL,
  updated_by uuid
    REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, employee_id)
);

CREATE INDEX conversation_member_overrides_employee_idx
  ON public.conversation_member_overrides (employee_id, conversation_id);

COMMENT ON TABLE public.conversation_member_overrides IS
  'Admin-authored per-conversation staff access decisions. A row wins over default and appointment-derived membership.';

CREATE TABLE public.conversation_default_members (
  employee_id uuid PRIMARY KEY
    REFERENCES public.employees(id) ON DELETE CASCADE,
  added_by uuid
    REFERENCES public.employees(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conversation_default_members IS
  'Active internal field technicians automatically included in every customer conversation unless a per-conversation override removes them.';

ALTER TABLE public.conversation_member_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_member_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_default_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_default_members FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.conversation_member_overrides
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.conversation_default_members
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.conversation_member_overrides,
    public.conversation_default_members
  TO service_role;

-- Explicit policies document the sole table caller even though service_role
-- normally bypasses RLS. Browser roles have neither a policy nor table grants.
CREATE POLICY conversation_member_overrides_service_role_all
  ON public.conversation_member_overrides
  FOR ALL
  TO service_role
  USING (current_user = 'service_role')
  WITH CHECK (current_user = 'service_role');

CREATE POLICY conversation_default_members_service_role_all
  ON public.conversation_default_members
  FOR ALL
  TO service_role
  USING (current_user = 'service_role')
  WITH CHECK (current_user = 'service_role');

-- ─── SECTION: One shared access decision ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.messaging_employee_has_conversations_capability(
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  WITH actor AS (
    SELECT employee.id, employee.role::text AS role
    FROM public.employees employee
    WHERE employee.id = p_employee_id
      AND employee.is_active
      AND NOT employee.is_external
    LIMIT 1
  ),
  employee_override AS (
    SELECT page_access.can_view
    FROM public.employee_page_access page_access
    JOIN actor ON actor.id = page_access.employee_id
    WHERE page_access.nav_key = 'conversations'
    LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM actor
    WHERE NOT COALESCE((
      SELECT flag.force_disabled
      FROM public.feature_flags flag
      WHERE flag.key = 'page:conversations'
      LIMIT 1
    ), false)
      AND CASE
        WHEN EXISTS (SELECT 1 FROM employee_override)
          THEN (SELECT can_view FROM employee_override)
        WHEN actor.role = 'admin'
          THEN true
        ELSE COALESCE((
          SELECT permission.can_view
          FROM public.nav_permissions permission
          WHERE permission.role::text = actor.role
            AND permission.nav_key = 'conversations'
          LIMIT 1
        ), false)
      END
  );
$function$;

REVOKE ALL ON FUNCTION public.messaging_employee_has_conversations_capability(uuid)
  FROM PUBLIC, anon, authenticated;
-- service-only/internal helper: browser callers cannot choose another employee.
GRANT EXECUTE ON FUNCTION public.messaging_employee_has_conversations_capability(uuid)
  TO service_role;

COMMENT ON FUNCTION public.messaging_employee_has_conversations_capability(uuid) IS
  'Service-only target-employee Messages capability predicate. Definer wrappers derive their actor from auth.uid().';

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
      ELSE EXISTS (
        SELECT 1
        FROM public.appointment_crew crew
        JOIN public.appointments appointment
          ON appointment.id = crew.appointment_id
        JOIN public.jobs job
          ON job.id = appointment.job_id
        LEFT JOIN public.claims claim
          ON claim.id = job.claim_id
        JOIN public.conversation_participants participant
          ON participant.conversation_id = p_conversation_id
         AND participant.contact_id = COALESCE(job.primary_contact_id, claim.contact_id)
         AND participant.is_active
         AND participant.removed_at IS NULL
        WHERE crew.employee_id = employee_row.id
      )
    END
    FROM employee_row
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.messaging_employee_can_access_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
-- service-only: its employee-id argument is intentionally not browser-selectable;
-- authenticated callers must use wrappers that derive the actor from auth.uid().
GRANT EXECUTE ON FUNCTION public.messaging_employee_can_access_conversation(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.messaging_employee_can_access_conversation(uuid, uuid) IS
  'Service-only/internal canonical staff membership decision: privileged role, manual override, default technician, then historical appointment membership.';

CREATE OR REPLACE FUNCTION public.messaging_can_access_conversation(
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_employee_id uuid;
BEGIN
  IF p_conversation_id IS NULL THEN
    RETURN false;
  END IF;

  -- Trusted Workers keep their existing all-conversations contract. Browser
  -- callers must pass both the page capability and participant membership gates.
  IF auth.role() = 'service_role' THEN
    RETURN true;
  END IF;

  SELECT employee.id
    INTO v_employee_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
  LIMIT 1;

  RETURN public.messaging_employee_has_conversations_capability(v_employee_id)
    AND public.messaging_employee_can_access_conversation(
      v_employee_id,
      p_conversation_id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.messaging_can_access_conversation(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_can_access_conversation(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.messaging_can_access_conversation(uuid) IS
  'Participant-aware browser read predicate. Service-role Workers retain trusted all-conversation access.';

-- ─── SECTION: Admin participant controls ─────────────────────────────────────

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
        WHEN EXISTS (
          SELECT 1
          FROM public.appointment_crew crew
          JOIN public.appointments appointment
            ON appointment.id = crew.appointment_id
          JOIN public.jobs job
            ON job.id = appointment.job_id
          LEFT JOIN public.claims claim
            ON claim.id = job.claim_id
          JOIN public.conversation_participants participant
            ON participant.conversation_id = p_conversation_id
           AND participant.contact_id = COALESCE(job.primary_contact_id, claim.contact_id)
           AND participant.is_active
           AND participant.removed_at IS NULL
          WHERE crew.employee_id = employee.id
        )
          THEN 'appointment'
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

REVOKE ALL ON FUNCTION public.get_conversation_members(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_members(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_conversation_member_override(
  p_conversation_id uuid,
  p_employee_id uuid,
  p_included boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid;
  v_target_role text;
BEGIN
  IF NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'set_conversation_member_override is admin-only'
      USING ERRCODE = '42501';
  END IF;

  SELECT employee.id
    INTO v_actor_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
    AND employee.role::text = 'admin'
  LIMIT 1;

  SELECT employee.role::text
    INTO v_target_role
  FROM public.employees employee
  WHERE employee.id = p_employee_id
    AND employee.is_active
    AND NOT employee.is_external;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'eligible employee not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_target_role IN ('admin', 'office', 'project_manager', 'supervisor', 'crm_partner') THEN
    RAISE EXCEPTION 'this role cannot be overridden'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations conversation
    WHERE conversation.id = p_conversation_id
  ) THEN
    RAISE EXCEPTION 'conversation not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_included IS NULL THEN
    DELETE FROM public.conversation_member_overrides override_row
    WHERE override_row.conversation_id = p_conversation_id
      AND override_row.employee_id = p_employee_id;
  ELSE
    INSERT INTO public.conversation_member_overrides (
      conversation_id,
      employee_id,
      included,
      updated_by,
      updated_at
    )
    VALUES (
      p_conversation_id,
      p_employee_id,
      p_included,
      v_actor_id,
      now()
    )
    ON CONFLICT (conversation_id, employee_id)
    DO UPDATE SET
      included = EXCLUDED.included,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN public.get_conversation_members(p_conversation_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_conversation_member_override(uuid, uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_member_override(uuid, uuid, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_default_conversation_member(
  p_employee_id uuid,
  p_included boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid;
BEGIN
  IF NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'set_default_conversation_member is admin-only'
      USING ERRCODE = '42501';
  END IF;

  SELECT employee.id
    INTO v_actor_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
    AND employee.role::text = 'admin'
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = p_employee_id
      AND employee.is_active
      AND NOT employee.is_external
      AND employee.role::text = 'field_tech'
  ) THEN
    RAISE EXCEPTION 'default chat members must be active internal field technicians'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_included, false) THEN
    INSERT INTO public.conversation_default_members (employee_id, added_by, added_at)
    VALUES (p_employee_id, v_actor_id, now())
    ON CONFLICT (employee_id)
    DO UPDATE SET
      added_by = EXCLUDED.added_by,
      added_at = EXCLUDED.added_at;
  ELSE
    DELETE FROM public.conversation_default_members default_member
    WHERE default_member.employee_id = p_employee_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_default_conversation_member(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_conversation_member(uuid, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_conversation(
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor public.employees%ROWTYPE;
BEGIN
  SELECT employee.*
    INTO v_actor
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
  LIMIT 1;

  IF NOT FOUND
     OR v_actor.role::text IN (
       'admin', 'office', 'project_manager', 'supervisor', 'crm_partner'
     ) THEN
    RAISE EXCEPTION 'this role cannot leave a conversation'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.messaging_can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'conversation access not found'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_member_overrides (
    conversation_id,
    employee_id,
    included,
    updated_by,
    updated_at
  )
  VALUES (
    p_conversation_id,
    v_actor.id,
    false,
    v_actor.id,
    now()
  )
  ON CONFLICT (conversation_id, employee_id)
  DO UPDATE SET
    included = false,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.leave_conversation(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_conversation(uuid)
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
          WHEN EXISTS (
            SELECT 1
            FROM public.conversation_default_members default_member
            WHERE default_member.employee_id = employee.id
          )
            THEN true
          ELSE EXISTS (
            SELECT 1
            FROM public.appointment_crew crew
            JOIN public.appointments appointment
              ON appointment.id = crew.appointment_id
            JOIN public.jobs job
              ON job.id = appointment.job_id
            LEFT JOIN public.claims claim
              ON claim.id = job.claim_id
            WHERE crew.employee_id = employee.id
              AND COALESCE(job.primary_contact_id, claim.contact_id) = p_contact_id
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

REVOKE ALL ON FUNCTION public.find_or_create_scoped_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_scoped_conversation(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.find_or_create_scoped_conversation(uuid, uuid) IS
  'Service-only atomic browser boundary: opens an existing direct thread only for a member, or creates one only for privileged/default/appointment-derived staff.';

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
              WHEN EXISTS (
                SELECT 1
                FROM public.conversation_default_members default_member
                WHERE default_member.employee_id = employee.id
              )
                THEN true
              ELSE EXISTS (
                SELECT 1
                FROM public.appointment_crew crew
                JOIN public.appointments appointment
                  ON appointment.id = crew.appointment_id
                JOIN public.jobs job
                  ON job.id = appointment.job_id
                LEFT JOIN public.claims claim
                  ON claim.id = job.claim_id
                WHERE crew.employee_id = employee.id
                  AND COALESCE(job.primary_contact_id, claim.contact_id) = contact.id
              )
            END
        )
      )
    )
  ORDER BY contact.name ASC NULLS LAST, contact.id
  LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_scoped_conversation_contacts(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_scoped_conversation_contacts(uuid, text, integer)
  TO service_role;

COMMENT ON FUNCTION public.search_scoped_conversation_contacts(uuid, text, integer) IS
  'Service-only bounded contact picker: returns minimal contact fields only when the employee can open the existing thread or start a new assigned/default thread.';

CREATE OR REPLACE FUNCTION public.get_conversation_notification_recipients(
  p_conversation_id uuid
)
RETURNS TABLE (employee_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT employee.id
  FROM public.employees employee
  WHERE current_user = 'service_role'
    AND public.messaging_employee_has_conversations_capability(employee.id)
    AND public.messaging_employee_can_access_conversation(
      employee.id,
      p_conversation_id
    );
$function$;

REVOKE ALL ON FUNCTION public.get_conversation_notification_recipients(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_notification_recipients(uuid)
  TO service_role;

-- ─── SECTION: Participant-aware message author directory ─────────────────────

CREATE OR REPLACE FUNCTION public.get_message_author_directory(
  p_message_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  full_name text,
  display_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_is_service boolean := auth.role() = 'service_role';
BEGIN
  IF NOT v_is_service
     AND NOT public.messaging_can_access_conversations() THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: Conversations access required for message authors'
      USING errcode = '42501';
  END IF;

  IF p_message_ids IS NULL
     OR array_position(p_message_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION
      'INVALID_MESSAGE_AUTHORS: message IDs must be non-null'
      USING errcode = '22023';
  END IF;

  IF cardinality(p_message_ids) > 200 THEN
    RAISE EXCEPTION
      'INVALID_MESSAGE_AUTHORS: at most 200 message IDs are allowed'
      USING errcode = '22023';
  END IF;

  IF cardinality(p_message_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH requested_message AS (
    SELECT DISTINCT requested.message_id
    FROM unnest(p_message_ids) requested(message_id)
  ),
  author AS (
    SELECT DISTINCT
      employee.id,
      employee.full_name,
      employee.display_name
    FROM requested_message requested
    JOIN public.messages message
      ON message.id = requested.message_id
     AND message.sent_by IS NOT NULL
     AND (
       v_is_service
       OR public.messaging_can_access_conversation(message.conversation_id)
     )
    JOIN public.employees employee
      ON employee.id = message.sent_by
  )
  SELECT
    author.id,
    author.full_name,
    author.display_name
  FROM author
  ORDER BY
    COALESCE(author.display_name, author.full_name),
    author.full_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_message_author_directory(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_message_author_directory(uuid[])
  TO authenticated, service_role;

-- Browser policy/ACL narrowing intentionally lives in the sequenced enforcement
-- migration. This foundation can apply first without breaking deployed browser
-- creation; then the Worker/UI deploy removes those direct INSERT callers.

-- ─── SECTION: Participant-aware tech inbox ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tech_conversations(
  p_limit           int         DEFAULT 50,
  p_before          timestamptz DEFAULT NULL,
  p_before_id       uuid        DEFAULT NULL,
  p_search          text        DEFAULT NULL,
  p_status          text        DEFAULT NULL,
  p_conversation_id uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_like   text;
  v_convs  jsonb;
  v_unread int;
  v_counts jsonb;
BEGIN
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH base AS (
    SELECT c.*, COALESCE(c.last_message_at, c.created_at) AS sort_key
    FROM public.conversations c
    WHERE public.messaging_can_access_conversation(c.id)
  ),
  matched AS (
    SELECT b.* FROM base b
    WHERE
      (p_conversation_id IS NOT NULL AND b.id = p_conversation_id)
      OR (
        p_conversation_id IS NULL
        AND (
          p_status IS NULL OR p_status = 'all'
          OR (p_status = 'unread' AND b.unread_count > 0)
          OR (p_status NOT IN ('all', 'unread') AND b.status = p_status)
        )
        AND (
          v_like IS NULL
          OR b.title ILIKE v_like
          OR b.last_message_preview ILIKE v_like
          OR EXISTS (
            SELECT 1
            FROM public.conversation_participants cp
            LEFT JOIN public.contacts ct ON ct.id = cp.contact_id
            WHERE cp.conversation_id = b.id
              AND cp.is_active
              AND cp.removed_at IS NULL
              AND (cp.phone ILIKE v_like OR ct.name ILIKE v_like OR ct.phone ILIKE v_like)
          )
        )
        AND (
          p_before IS NULL
          OR b.sort_key < p_before
          OR (b.sort_key = p_before AND b.id < p_before_id)
        )
      )
  ),
  paged AS (
    SELECT * FROM matched
    ORDER BY sort_key DESC, id DESC
    LIMIT v_limit
  ),
  page_rows AS (
    SELECT
      p.sort_key,
      p.id,
      (to_jsonb(p) - 'email_reply_token') || jsonb_build_object(
        'conversation_participants',
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'contact_id', cp.contact_id,
              'phone',      cp.phone,
              'role',       cp.role,
              'contacts',   CASE WHEN ct.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', ct.id, 'name', ct.name, 'phone', ct.phone, 'email', ct.email,
                'company', ct.company, 'role', ct.role, 'dnd', ct.dnd, 'dnd_at', ct.dnd_at
              ) END
            )
            ORDER BY cp.added_at
          )
          FROM public.conversation_participants cp
          LEFT JOIN public.contacts ct ON ct.id = cp.contact_id
          WHERE cp.conversation_id = p.id
            AND cp.is_active
            AND cp.removed_at IS NULL
        ), '[]'::jsonb)
      ) AS row_json
    FROM paged p
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY sort_key DESC, id DESC), '[]'::jsonb)
    INTO v_convs
  FROM page_rows;

  SELECT COALESCE(SUM(conversation.unread_count), 0)::int
    INTO v_unread
  FROM public.conversations conversation
  WHERE public.messaging_can_access_conversation(conversation.id);

  WITH scope AS (
    SELECT c.* FROM public.conversations c
    WHERE public.messaging_can_access_conversation(c.id)
      AND (
        v_like IS NULL
        OR c.title ILIKE v_like
        OR c.last_message_preview ILIKE v_like
        OR EXISTS (
          SELECT 1
          FROM public.conversation_participants cp
          LEFT JOIN public.contacts ct ON ct.id = cp.contact_id
          WHERE cp.conversation_id = c.id
            AND cp.is_active
            AND cp.removed_at IS NULL
            AND (cp.phone ILIKE v_like OR ct.name ILIKE v_like OR ct.phone ILIKE v_like)
        )
      )
  )
  SELECT jsonb_build_object(
    'all',               count(*),
    'unread',            count(*) FILTER (WHERE unread_count > 0),
    'needs_response',    count(*) FILTER (WHERE status = 'needs_response'),
    'waiting_on_client', count(*) FILTER (WHERE status = 'waiting_on_client'),
    'resolved',          count(*) FILTER (WHERE status = 'resolved')
  ) INTO v_counts
  FROM scope;

  RETURN jsonb_build_object(
    'conversations', COALESCE(v_convs, '[]'::jsonb),
    'unread_total',  COALESCE(v_unread, 0),
    'status_counts', v_counts
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_tech_conversations(int, timestamptz, uuid, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tech_conversations(int, timestamptz, uuid, text, text, uuid)
  TO authenticated, service_role;
