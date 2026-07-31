-- ════════════════════════════════════════════════
-- ROLLBACK: 20260731040338_conversation_unread_state_compatibility
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the narrow read/unread RPC and restores the foundation version of
--   self-leave that requires current access on every attempt.
--
-- REQUIRED ORDER:
--   Restore deployed callers that do not require set_my_conversation_unread_state
--   before running this rollback. No table policy or grant is changed here.
-- ════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.set_my_conversation_unread_state(uuid[], boolean);

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

ALTER FUNCTION public.leave_conversation(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.leave_conversation(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_conversation(uuid)
  TO authenticated;
