-- ════════════════════════════════════════════════
-- MIGRATION: 20260724173000_harden_find_or_create_conversation
-- Phase: Messaging mobile inbox follow-up
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Keeps the existing find_or_create_conversation(uuid) signature and return
--   shape, but prevents it from returning an archived, group, or broadcast
--   conversation merely because the selected contact participates in one.
--   Browser roles can no longer invoke this privileged write helper
--   directly; the capability-checked Worker is now the sole caller.
--
-- DATA / CONTRACT IMPACT:
--   No table or column changes. Existing active direct conversations are reused.
--   A new direct conversation is created only when no eligible direct thread
--   exists. The RPC signature and JSON response shape are unchanged.
--
-- AUTHORIZATION:
--   SECURITY INVOKER plus an in-function service_role assertion. EXECUTE is
--   service_role-only; PUBLIC, anon, and authenticated are explicitly revoked.
--
-- ROLLBACK:
--   Restore the prior function body from
--   20260709_tech_msgs_v2_fm_conversation_rpcs.sql and re-grant EXECUTE to
--   authenticated, service_role. This restores the old browser contract and its
--   known group/broadcast selection behavior.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.find_or_create_conversation(p_contact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_conv_id uuid;
  v_contact public.contacts%ROWTYPE;
  v_title   text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'find_or_create_conversation is service-role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'find_or_create_conversation: p_contact_id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('find_or_create_conversation:' || p_contact_id::text));

  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  JOIN public.conversation_participants cp
    ON cp.conversation_id = c.id
   AND cp.contact_id = p_contact_id
   AND cp.is_active = true
   AND cp.removed_at IS NULL
  WHERE c.type = 'direct'
    AND c.status <> 'archived'
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_participants other
      WHERE other.conversation_id = c.id
        AND other.contact_id IS DISTINCT FROM p_contact_id
    )
  ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'find_or_create_conversation: contact % not found', p_contact_id;
    END IF;
    IF v_contact.phone IS NULL OR btrim(v_contact.phone) = '' THEN
      RAISE EXCEPTION 'find_or_create_conversation: contact % has no phone number', p_contact_id;
    END IF;

    v_title := CASE
      WHEN v_contact.company IS NOT NULL AND btrim(v_contact.company) <> ''
        THEN v_contact.name || ' — ' || v_contact.company
      ELSE v_contact.name
    END;

    INSERT INTO public.conversations (type, title, status)
      VALUES ('direct', v_title, 'needs_response')
      RETURNING id INTO v_conv_id;

    INSERT INTO public.conversation_participants (conversation_id, contact_id, phone, role)
      VALUES (v_conv_id, p_contact_id, v_contact.phone, 'primary');
  END IF;

  RETURN (
    SELECT public.get_tech_conversations(p_conversation_id => v_conv_id)
      -> 'conversations' -> 0
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.find_or_create_conversation(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(uuid)
  TO service_role;
