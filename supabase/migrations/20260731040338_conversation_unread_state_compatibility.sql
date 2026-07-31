-- ════════════════════════════════════════════════
-- MIGRATION: 20260731040338_conversation_unread_state_compatibility
-- Phase: Messaging participant controls — code-before-enforcement compatibility
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds the narrow browser RPC used to mark an authorized conversation read or
--   unread before direct authenticated UPDATE access is removed. It also makes
--   self-leave safe to retry after a lost response without reopening access and
--   provides a bounded actor-derived access snapshot for client-side participant
--   reconciliation, and completes the standard authenticated + service_role
--   grants without rewriting the already-staged foundation migration.
--
-- COMPATIBILITY:
--   Additive-only for deployed callers. Existing table grants and RLS policies
--   are unchanged in this migration. The leave_conversation(uuid) signature and
--   return shape are preserved; its successful removal becomes idempotent.
--
-- DEPLOYMENT ORDER:
--   1. Apply 20260731040337_conversation_participant_scoping.sql.
--   2. Apply this compatibility migration.
--   3. Deploy callers that use set_my_conversation_unread_state(uuid[], boolean).
--   4. Apply 20260731040339_conversation_participant_policy_enforcement.sql.
--
-- ROLLBACK:
--   First restore callers that do not require the unread RPC, then run
--   supabase/rollbacks/20260731040338_conversation_unread_state_compatibility.rollback.sql.
-- ════════════════════════════════════════════════

DO $conversation_unread_compatibility_preflight$
BEGIN
  IF to_regprocedure(
       'public.messaging_employee_has_conversations_capability(uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.messaging_employee_can_access_conversation(uuid,uuid)'
     ) IS NULL
     OR to_regprocedure('public.leave_conversation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'conversation unread compatibility: foundation RPCs are absent';
  END IF;

  IF to_regprocedure(
       'public.set_my_conversation_unread_state(uuid[],boolean)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.get_my_conversation_access_snapshot(uuid[])'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'conversation unread compatibility: compatibility RPC already exists';
  END IF;
END;
$conversation_unread_compatibility_preflight$;

REVOKE ALL ON FUNCTION public.get_conversation_members(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_members(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_conversation_member_override(uuid, uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_member_override(uuid, uuid, boolean)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_default_conversation_member(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_conversation_member(uuid, boolean)
  TO authenticated, service_role;

CREATE FUNCTION public.get_my_conversation_access_snapshot(
  p_conversation_ids uuid[]
)
RETURNS TABLE(conversation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid;
BEGIN
  IF p_conversation_ids IS NULL
     OR cardinality(p_conversation_ids) > 200
     OR EXISTS (
       SELECT 1
       FROM unnest(p_conversation_ids) requested(conversation_id)
       WHERE requested.conversation_id IS NULL
     ) THEN
    RAISE EXCEPTION 'conversation ids must contain at most 200 non-null values'
      USING ERRCODE = '22023';
  END IF;

  SELECT employee.id
    INTO v_actor_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
  LIMIT 1;

  IF v_actor_id IS NULL
     OR NOT public.messaging_employee_has_conversations_capability(v_actor_id) THEN
    RAISE EXCEPTION 'Messages access is not granted'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT conversation.id
  FROM unnest(p_conversation_ids) requested(conversation_id)
  JOIN public.conversations conversation
    ON conversation.id = requested.conversation_id
  WHERE public.messaging_employee_can_access_conversation(
    v_actor_id,
    conversation.id
  )
  ORDER BY conversation.id;
END;
$function$;

ALTER FUNCTION public.get_my_conversation_access_snapshot(uuid[])
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_conversation_access_snapshot(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_conversation_access_snapshot(uuid[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_my_conversation_access_snapshot(uuid[]) IS
  'Actor-derived bounded access snapshot. Returns only existing conversations the authenticated active internal employee can currently access.';

CREATE FUNCTION public.set_my_conversation_unread_state(
  p_conversation_ids uuid[] DEFAULT NULL,
  p_unread boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid;
  v_conversation_ids uuid[];
  v_updated integer := 0;
BEGIN
  SELECT employee.id
    INTO v_actor_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
  LIMIT 1;

  IF v_actor_id IS NULL
     OR NOT public.messaging_employee_has_conversations_capability(v_actor_id) THEN
    RAISE EXCEPTION 'Messages access is not granted'
      USING ERRCODE = '42501';
  END IF;

  IF p_unread IS NULL THEN
    RAISE EXCEPTION 'unread state is required'
      USING ERRCODE = '22023';
  END IF;

  -- NULL means "mark every currently accessible conversation read". It is
  -- intentionally unavailable for marking everything unread.
  IF p_conversation_ids IS NULL THEN
    IF p_unread THEN
      RAISE EXCEPTION 'conversation ids are required when marking unread'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.conversations conversation
       SET unread_count = 0
     WHERE COALESCE(conversation.unread_count, 0) <> 0
       AND public.messaging_employee_can_access_conversation(
         v_actor_id,
         conversation.id
       );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
  END IF;

  IF cardinality(p_conversation_ids) > 200
     OR EXISTS (
       SELECT 1
       FROM unnest(p_conversation_ids) requested(conversation_id)
       WHERE requested.conversation_id IS NULL
     ) THEN
    RAISE EXCEPTION 'conversation ids must contain at most 200 non-null values'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT requested.conversation_id),
    ARRAY[]::uuid[]
  )
    INTO v_conversation_ids
  FROM unnest(p_conversation_ids) requested(conversation_id);

  IF cardinality(v_conversation_ids) = 0 THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_conversation_ids) requested(conversation_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.conversations conversation
      WHERE conversation.id = requested.conversation_id
    )
       OR NOT public.messaging_employee_can_access_conversation(
         v_actor_id,
         requested.conversation_id
       )
  ) THEN
    RAISE EXCEPTION 'conversation access not found'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversations conversation
     SET unread_count = CASE WHEN p_unread THEN 1 ELSE 0 END
   WHERE conversation.id = ANY(v_conversation_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

ALTER FUNCTION public.set_my_conversation_unread_state(uuid[], boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_my_conversation_unread_state(uuid[], boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_conversation_unread_state(uuid[], boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.set_my_conversation_unread_state(uuid[], boolean) IS
  'Actor-derived read/unread mutation. Updates only unread_count for conversations the authenticated employee can currently access; NULL ids mark all accessible threads read.';

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
  v_already_left boolean;
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

  IF p_conversation_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversations conversation
       WHERE conversation.id = p_conversation_id
     ) THEN
    RAISE EXCEPTION 'conversation not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_member_overrides override_row
    WHERE override_row.conversation_id = p_conversation_id
      AND override_row.employee_id = v_actor.id
      AND NOT override_row.included
  )
    INTO v_already_left;

  IF NOT v_already_left
     AND NOT public.messaging_can_access_conversation(p_conversation_id) THEN
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

ALTER FUNCTION public.leave_conversation(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.leave_conversation(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_conversation(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.leave_conversation(uuid) IS
  'Records a durable self-removal for an eligible current member; an already-successful removal is safe to retry.';
