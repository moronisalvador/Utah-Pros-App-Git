-- ════════════════════════════════════════════════
-- MIGRATION: 20260804230000_conversation_access_default_open
-- Phase: n/a (standalone owner-directed correction)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the technicians back in the customer conversations. Since 2026-08-01 a
--   person could only see a conversation if somebody had explicitly added them
--   to it; everyone else got an empty inbox. That was never the intent. The
--   owner asked for auto-adding people as a CONVENIENCE — "we didn't wanna gate
--   anyone out of the conversations" (2026-08-04) — but it shipped as the only
--   way in, so it silently locked out every field technician.
--
--   Measured live immediately before writing this: all 3 active field techs
--   already held the Conversations page, and all 3 could access exactly 0
--   conversations.
--
--   THREE functions carried that same deny-by-default rule, not one. Replacing
--   only the first would have left a tech able to read every existing thread but
--   still unable to start a new one — or even find the customer in the contact
--   picker — which is exactly the "new lead texts in" case most likely to
--   recreate the original complaint. All three are corrected together:
--     1. messaging_employee_can_access_conversation  — read/reply on a thread
--     2. find_or_create_scoped_conversation          — start a NEW thread
--     3. search_scoped_conversation_contacts         — find the customer at all
--
-- ADDITIVE-ONLY:
--   Attribute-only. Three CREATE OR REPLACE bodies. Every signature, return
--   type, language, volatility, security mode and search_path is preserved
--   exactly, so all deployed callers keep working. No table, column, policy or
--   row is touched and no data is migrated.
--
--   THIS WIDENS ACCESS, deliberately, under a direct owner instruction. Stated
--   plainly so nobody has to infer it:
--
--   * It is NOT read-only. The same predicate authorizes POST /api/send-message
--     (functions/api/send-message.js), so a person who gains access to a thread
--     can also SEND AS UTAH PROS RESTORATION into it and leave internal notes —
--     not merely view it. That is intended: these are the field technicians
--     already trusted with the Conversations page. Consent, DND, opt-out and
--     quiet-hours gates are untouched and still run per recipient.
--   * It also widens the message.inbound notification audience, because
--     get_conversation_notification_recipients gates on the same predicate.
--     That is the correct direction and preserves the owner's invariant:
--     "if I'm receiving the notification, then I should be able to see it."
--     Each person can still mute the type in Settings → Notifications.
--
--   It remains bounded on two independent sides:
--   * CAPABILITY. Every caller separately requires
--     messaging_employee_has_conversations_capability(), which is the existing
--     page-permission system (nav_permissions, the per-employee
--     employee_page_access override, and the page:conversations force-disable
--     flag). Someone without the Conversations page still sees nothing.
--     NOTE: that check lives in the CALLERS, never inside these functions —
--     see the COMMENT below, which says so rather than implying otherwise.
--   * IDENTITY. The employee row must be active AND internal. crm_partner is
--     refused first, ahead of the override branch, so no override can promote a
--     partner. (A crm_partner row may legitimately carry is_external = false —
--     docs/auth-and-authorization.md — so the explicit role check is the real
--     protection, not the is_external filter.)
--
--   WHAT CHANGES, PRECISELY:
--   * the deny fallback becomes allow, in all three functions.
--   * conversation_member_overrides is consulted BEFORE the old privileged-role
--     shortcut, so an explicit removal is honoured for every role. (The write
--     RPC set_conversation_member_override still refuses to create an override
--     for the privileged roles, so this is a predicate-level consistency fix,
--     not a new way to eject an admin.)
--   * conversation_default_members stops being a gate. It is deliberately left
--     in place, still written and still readable: it is a real record of who was
--     auto-added, and dropping a live table would break the deployed contract.
--
--   INTERLOCK, ON PURPOSE: the authored-but-unapplied
--   20260731213100_conversation_participant_policy_enforcement.sql hash-locks
--   the OLD body of function 1. After this applies, that migration will refuse
--   to run until somebody consciously reconciles it. That is the desired
--   behaviour — it must not silently inherit the wider predicate into RLS.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260804230000_conversation_access_default_open.rollback.sql
--   Restores all three byte-exact 2026-08-01 bodies and the original catalog
--   comment. Running it re-locks all 3 field technicians out of every
--   conversation and stops their new-message notifications, so it is a
--   deliberate re-closure, not a no-op.
-- ════════════════════════════════════════════════

-- ─── PREFLIGHT: refuse to overwrite anything but the exact reviewed pre-image ──
-- Sibling migrations for this function family (20260731213000) established this
-- pattern. Without it, unnoticed drift would be silently overwritten and the
-- rollback's "byte-exact" promise would quietly become false.
DO $preflight$
DECLARE
  v_expected constant jsonb := jsonb_build_object(
    'messaging_employee_can_access_conversation', 'd10e6fa5fd127ed02aa39f8f926b413f',
    'find_or_create_scoped_conversation',         '9ef41ca3a8b1f831aa3fc5beda6372d4',
    'search_scoped_conversation_contacts',        '0b3eeb041ebf31c09711451568dd2229'
  );
  v_name text;
  v_actual text;
BEGIN
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_actual
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
    LIMIT 1;

    IF v_actual IS NULL THEN
      RAISE EXCEPTION 'Preflight: public.% is missing', v_name
        USING ERRCODE = '42883';
    END IF;
    IF v_actual <> (v_expected ->> v_name) THEN
      RAISE EXCEPTION
        'Preflight: public.% body drifted (found %, expected %) — re-review before replacing',
        v_name, v_actual, v_expected ->> v_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- All three are service-role-only today; refuse if that ever stopped being true.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'messaging_employee_can_access_conversation',
        'find_or_create_scoped_conversation',
        'search_scoped_conversation_contacts'
      )
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR p.prosecdef
      )
  ) THEN
    RAISE EXCEPTION 'Preflight: unexpected browser-role EXECUTE or SECURITY DEFINER on a target function'
      USING ERRCODE = '42501';
  END IF;
END;
$preflight$;

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
      -- A partner is not staff. No override may promote one.
      WHEN employee_row.role = 'crm_partner'
        THEN false
      -- An explicit add/remove is the human decision and wins for every role.
      WHEN EXISTS (SELECT 1 FROM manual_choice)
        THEN (SELECT included FROM manual_choice)
      -- Default OPEN for active internal staff.
      ELSE true
    END
    FROM employee_row
  ), false);
$function$;

COMMENT ON FUNCTION public.messaging_employee_can_access_conversation(uuid, uuid) IS
  'Service-only per-conversation membership decision ONLY. It does NOT check the Conversations '
  'page capability — every caller must separately call '
  'messaging_employee_has_conversations_capability(employee_id). Default-open for active internal '
  'employees; an explicit conversation_member_overrides row adds or removes one person; '
  'crm_partner, external and inactive employees are always denied. Browser-writable '
  'appointment/job records are not authorization evidence. Corrected 2026-08-04 from '
  'deny-by-default, which had locked every field technician out of every conversation.';

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
    -- Default OPEN, matching function 1. Previously this required a
    -- conversation_default_members row, so a technician could never open a
    -- thread with a customer who did not already have one.
    SELECT EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = p_employee_id
        AND employee.is_active
        AND NOT employee.is_external
        AND employee.role::text <> 'crm_partner'
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
        -- Default OPEN, matching functions 1 and 2. Previously a technician
        -- could not even see a customer who had no existing thread.
        AND EXISTS (
          SELECT 1
          FROM public.employees employee
          WHERE employee.id = p_employee_id
            AND employee.is_active
            AND NOT employee.is_external
            AND employee.role::text <> 'crm_partner'
        )
      )
    )
  ORDER BY contact.name ASC NULLS LAST, contact.id
  LIMIT v_limit;
END;
$function$;

-- ─── Grants ───────────────────────────────────────────────────────────────────
-- database-standard.md §1: this managed project re-applies EXECUTE TO PUBLIC to
-- every new/replaced function at ddl_command_end, and ALTER DEFAULT PRIVILEGES
-- does not cover functions. Re-assert the intended posture explicitly rather
-- than relying on CREATE OR REPLACE preserving the prior ACL.
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

-- ─── POSTCONDITION: prove the perimeter survived ──────────────────────────────
DO $postcheck$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'messaging_employee_can_access_conversation',
        'find_or_create_scoped_conversation',
        'search_scoped_conversation_contacts'
      )
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        OR p.prosecdef
      )
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: target function ACL or security mode is wrong';
  END IF;
END;
$postcheck$;
