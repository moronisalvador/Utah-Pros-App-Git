-- Rollback for 20260803233020_conversation_notification_subscription_foundation.
-- Recovery posture: restores the prior membership-derived notification audience,
-- removes the new subscription/view RPCs and triggers, then drops the two new
-- private tables. It does not widen conversation table policies or grants.
--
-- REQUIRED ORDER:
--   Pause scheduled delivery first (31220100 → 31220000), run this rollback,
--   then run containment (31213100 → 31213000 → 40338 → 40337). This rollback
--   restores legacy RPC bodies/grants; 31213100 must run
--   after it so the final recovery posture seals those RPCs fail closed.

DROP TRIGGER IF EXISTS
  messages_subscribe_author_to_conversation_notifications
  ON public.messages;
DROP TRIGGER IF EXISTS
  conversation_notification_employee_capability_version
  ON public.employees;
DROP TRIGGER IF EXISTS
  conversation_notification_page_access_capability_version
  ON public.employee_page_access;
DROP TRIGGER IF EXISTS
  conversation_notification_role_capability_version
  ON public.nav_permissions;
DROP TRIGGER IF EXISTS
  conversation_notification_flag_capability_version
  ON public.feature_flags;

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

ALTER FUNCTION public.messaging_can_access_conversation(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.messaging_can_access_conversation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messaging_can_access_conversation(uuid)
  TO authenticated, service_role;

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

ALTER FUNCTION public.get_conversation_notification_recipients(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_conversation_notification_recipients(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_notification_recipients(uuid)
  TO service_role;

DO $restore_or_remove_message_media_boundary$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'conversation_participant_policy_enforcement'
  ) THEN
    EXECUTE $restore$
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
        IF COALESCE(auth.role(), '') <> 'service_role'
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
    $restore$;
    ALTER FUNCTION public.messaging_get_authorized_message_media(uuid, uuid)
      OWNER TO postgres;
    REVOKE ALL ON FUNCTION
      public.messaging_get_authorized_message_media(uuid, uuid)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION
      public.messaging_get_authorized_message_media(uuid, uuid)
      TO service_role;
  ELSE
    DROP FUNCTION IF EXISTS
      public.messaging_get_authorized_message_media(uuid, uuid);
  END IF;
END;
$restore_or_remove_message_media_boundary$;

CREATE OR REPLACE FUNCTION public.get_my_conversation_access_snapshot(
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
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_conversation_access_snapshot(uuid[])
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_my_conversation_unread_state(
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
REVOKE ALL ON FUNCTION
  public.set_my_conversation_unread_state(uuid[], boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.set_my_conversation_unread_state(uuid[], boolean)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS
  public.subscribe_message_author_to_conversation_notifications();
DROP FUNCTION IF EXISTS
  public.search_viewable_conversation_contacts(uuid, text, integer);
DROP FUNCTION IF EXISTS
  public.find_or_create_viewable_conversation(uuid, uuid);
DROP FUNCTION IF EXISTS
  public.set_conversation_notification_override(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS
  public.get_conversation_notification_members(uuid);
DROP FUNCTION IF EXISTS
  public.set_my_conversation_notification_setting(uuid, boolean);
DROP FUNCTION IF EXISTS
  public.get_my_conversation_notification_setting(uuid);
DROP FUNCTION IF EXISTS
  public.messaging_employee_should_notify_for_conversation(uuid, uuid);
DROP FUNCTION IF EXISTS
  public.ensure_conversation_notification_subscription(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS
  public.bump_conversation_notification_capability_from_flag();
DROP FUNCTION IF EXISTS
  public.bump_conversation_notification_capability_from_role();
DROP FUNCTION IF EXISTS
  public.bump_conversation_notification_capability_from_page_access();
DROP FUNCTION IF EXISTS
  public.bump_conversation_notification_capability_from_employee();
DROP FUNCTION IF EXISTS
  public.bump_conversation_notification_capability_version(uuid);
DROP FUNCTION IF EXISTS public.messaging_can_view_conversation(uuid);
DROP FUNCTION IF EXISTS
  public.messaging_employee_can_view_conversation(uuid, uuid);

DROP TABLE IF EXISTS public.conversation_notification_subscriptions;
DROP TABLE IF EXISTS public.conversation_notification_capability_versions;
