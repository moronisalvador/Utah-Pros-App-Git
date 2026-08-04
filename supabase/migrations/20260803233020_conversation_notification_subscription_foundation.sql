-- ════════════════════════════════════════════════
-- MIGRATION: 20260803233020_conversation_notification_subscription_foundation
-- Phase: Mobile readiness — conversation access / notification separation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Lets active staff with Messages access help any client in an active direct
--   conversation without also notifying every technician about every thread.
--   Notifications use a separate per-conversation subscription that can be muted.
--
-- ADDITIVE-ONLY:
--   Adds two private tables, new RPCs, and private triggers. It does not change
--   the existing conversation policies or write customer/provider data.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run 20260803233020_conversation_notification_subscription_foundation.rollback.sql.
--   The rollback removes only the objects added here and restores the previous
--   notification-recipient function body.
-- ════════════════════════════════════════════════

DO $conversation_notification_foundation_preflight$
BEGIN
  IF to_regclass('public.conversations') IS NULL
     OR to_regclass('public.messages') IS NULL
     OR to_regclass('public.employees') IS NULL
     OR to_regclass('public.employee_page_access') IS NULL
     OR to_regclass('public.nav_permissions') IS NULL
     OR to_regclass('public.feature_flags') IS NULL
     OR to_regprocedure(
       'public.messaging_employee_has_conversations_capability(uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.messaging_employee_can_access_conversation(uuid,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.get_my_conversation_access_snapshot(uuid[])'
     ) IS NULL
     OR to_regprocedure(
       'public.set_my_conversation_unread_state(uuid[],boolean)'
     ) IS NULL
     OR to_regprocedure(
       'public.get_conversation_notification_recipients(uuid)'
     ) IS NULL
     OR to_regprocedure('public.find_or_create_conversation(uuid)') IS NULL
     OR to_regprocedure('public.is_active_internal_admin()') IS NULL THEN
    RAISE EXCEPTION
      'conversation notification foundation: required messaging authority is absent';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name IN (
         'conversation_participant_scoping',
         'conversation_unread_state_compatibility',
         'conversation_assignment_authority_containment'
       )
     ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION
      'conversation notification foundation: participant/unread authority train is absent';
  END IF;
END;
$conversation_notification_foundation_preflight$;

-- ─── SECTION: Private subscription state ─────────────────────────────────────

CREATE TABLE public.conversation_notification_capability_versions (
  employee_id uuid PRIMARY KEY
    REFERENCES public.employees(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_notification_subscriptions (
  conversation_id uuid NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  subscribed boolean NOT NULL,
  source text NOT NULL CHECK (
    source IN (
      'manual_self',
      'manual_admin',
      'conversation_created',
      'message_persisted'
    )
  ),
  source_event_id uuid,
  eligibility_version bigint NOT NULL DEFAULT 0 CHECK (eligibility_version >= 0),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, employee_id)
);

CREATE INDEX conversation_notification_subscriptions_employee_idx
  ON public.conversation_notification_subscriptions(employee_id, conversation_id);

ALTER TABLE public.conversation_notification_capability_versions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_notification_capability_versions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_notification_subscriptions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_notification_subscriptions
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.conversation_notification_capability_versions,
  public.conversation_notification_subscriptions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.conversation_notification_capability_versions,
  public.conversation_notification_subscriptions
  TO service_role;

CREATE POLICY conversation_notification_capability_versions_service_role_all
  ON public.conversation_notification_capability_versions
  FOR ALL
  TO service_role
  USING (current_user = 'service_role')
  WITH CHECK (current_user = 'service_role');

CREATE POLICY conversation_notification_subscriptions_service_role_all
  ON public.conversation_notification_subscriptions
  FOR ALL
  TO service_role
  USING (current_user = 'service_role')
  WITH CHECK (current_user = 'service_role');

-- ─── SECTION: View authority ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.messaging_employee_can_view_conversation(
  p_employee_id uuid,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    p_employee_id IS NOT NULL
    AND p_conversation_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = p_employee_id
        AND employee.is_active
        AND NOT employee.is_external
        AND employee.role::text <> 'crm_partner'
    )
    AND public.messaging_employee_has_conversations_capability(p_employee_id)
    AND EXISTS (
      SELECT 1
      FROM public.conversations conversation
      WHERE conversation.id = p_conversation_id
        AND CASE
          WHEN conversation.type = 'direct'
               AND conversation.status <> 'archived'
            THEN true
          ELSE public.messaging_employee_can_access_conversation(
            p_employee_id,
            conversation.id
          )
        END
    );
$function$;

ALTER FUNCTION public.messaging_employee_can_view_conversation(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.messaging_employee_can_view_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.messaging_employee_can_view_conversation(uuid, uuid)
  TO service_role;
COMMENT ON FUNCTION
  public.messaging_employee_can_view_conversation(uuid, uuid) IS
  'Service-only view/help authority. Active direct client threads are available to active internal staff with Messages capability; group, broadcast, and archived threads retain the narrower legacy membership boundary.';

CREATE OR REPLACE FUNCTION public.messaging_can_view_conversation(
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

  RETURN public.messaging_employee_can_view_conversation(
    v_employee_id,
    p_conversation_id
  );
END;
$function$;

ALTER FUNCTION public.messaging_can_view_conversation(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.messaging_can_view_conversation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messaging_can_view_conversation(uuid)
  TO authenticated, service_role;
COMMENT ON FUNCTION public.messaging_can_view_conversation(uuid) IS
  'Actor-derived browser view predicate. Subscription state never grants conversation access.';

-- Keep deployed browser/RPC callers compatible while the explicit can-view name
-- rolls out. Notification fanout no longer consumes this wrapper, so broadening
-- direct-thread view here cannot subscribe or notify anyone.
CREATE OR REPLACE FUNCTION public.messaging_can_access_conversation(
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RETURN public.messaging_can_view_conversation(p_conversation_id);
END;
$function$;

ALTER FUNCTION public.messaging_can_access_conversation(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.messaging_can_access_conversation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messaging_can_access_conversation(uuid)
  TO authenticated, service_role;
COMMENT ON FUNCTION public.messaging_can_access_conversation(uuid) IS
  'Compatibility alias for the actor-derived conversation view predicate. It does not represent notification subscription.';

-- This function may already exist in a fresh/local catalog where the older
-- unapplied enforcement source ran first. Replacing it here keeps both catalog
-- orders on the same explicit view authority.
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
    AND public.messaging_employee_can_view_conversation(
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
COMMENT ON FUNCTION
  public.messaging_get_authorized_message_media(uuid, uuid) IS
  'Worker-only media authorization helper. Browser roles have no execution grant.';

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
  WHERE public.messaging_employee_can_view_conversation(
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
       AND public.messaging_employee_can_view_conversation(
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
       OR NOT public.messaging_employee_can_view_conversation(
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

-- ─── SECTION: Capability-revocation generation ───────────────────────────────

CREATE OR REPLACE FUNCTION
  public.bump_conversation_notification_capability_version(
    p_employee_id uuid
  )
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.conversation_notification_capability_versions (
    employee_id,
    version,
    updated_at
  )
  VALUES (p_employee_id, 1, now())
  ON CONFLICT (employee_id)
  DO UPDATE SET
    version = conversation_notification_capability_versions.version + 1,
    updated_at = EXCLUDED.updated_at;
END;
$function$;

ALTER FUNCTION
  public.bump_conversation_notification_capability_version(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.bump_conversation_notification_capability_version(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION
  public.bump_conversation_notification_capability_version(uuid) IS
  'Internal trigger helper only. It is not an RPC and has no browser or service-role execution grant.';

CREATE OR REPLACE FUNCTION
  public.bump_conversation_notification_capability_from_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.is_active IS DISTINCT FROM NEW.is_active
     OR OLD.is_external IS DISTINCT FROM NEW.is_external
     OR OLD.role IS DISTINCT FROM NEW.role
     OR OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id THEN
    PERFORM public.bump_conversation_notification_capability_version(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION
  public.bump_conversation_notification_capability_from_page_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.nav_key = 'conversations' THEN
    PERFORM public.bump_conversation_notification_capability_version(
      OLD.employee_id
    );
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.nav_key = 'conversations'
     AND (
       TG_OP = 'INSERT'
       OR OLD.nav_key IS DISTINCT FROM NEW.nav_key
       OR OLD.employee_id IS DISTINCT FROM NEW.employee_id
     ) THEN
    PERFORM public.bump_conversation_notification_capability_version(
      NEW.employee_id
    );
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION
  public.bump_conversation_notification_capability_from_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.nav_key = 'conversations' THEN
    INSERT INTO public.conversation_notification_capability_versions (
      employee_id,
      version,
      updated_at
    )
    SELECT employee.id, 1, now()
    FROM public.employees employee
    WHERE employee.role::text = OLD.role::text
    ON CONFLICT (employee_id)
    DO UPDATE SET
      version = conversation_notification_capability_versions.version + 1,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.nav_key = 'conversations'
     AND (
       TG_OP = 'INSERT'
       OR OLD.nav_key IS DISTINCT FROM NEW.nav_key
       OR OLD.role IS DISTINCT FROM NEW.role
     ) THEN
    INSERT INTO public.conversation_notification_capability_versions (
      employee_id,
      version,
      updated_at
    )
    SELECT employee.id, 1, now()
    FROM public.employees employee
    WHERE employee.role::text = NEW.role::text
    ON CONFLICT (employee_id)
    DO UPDATE SET
      version = conversation_notification_capability_versions.version + 1,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION
  public.bump_conversation_notification_capability_from_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.key = 'page:conversations' THEN
    INSERT INTO public.conversation_notification_capability_versions (
      employee_id,
      version,
      updated_at
    )
    SELECT employee.id, 1, now()
    FROM public.employees employee
    ON CONFLICT (employee_id)
    DO UPDATE SET
      version = conversation_notification_capability_versions.version + 1,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.key = 'page:conversations'
     AND (
       TG_OP = 'INSERT'
       OR OLD.key IS DISTINCT FROM NEW.key
     ) THEN
    INSERT INTO public.conversation_notification_capability_versions (
      employee_id,
      version,
      updated_at
    )
    SELECT employee.id, 1, now()
    FROM public.employees employee
    ON CONFLICT (employee_id)
    DO UPDATE SET
      version = conversation_notification_capability_versions.version + 1,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN NULL;
END;
$function$;

ALTER FUNCTION
  public.bump_conversation_notification_capability_from_employee()
  OWNER TO postgres;
ALTER FUNCTION
  public.bump_conversation_notification_capability_from_page_access()
  OWNER TO postgres;
ALTER FUNCTION
  public.bump_conversation_notification_capability_from_role()
  OWNER TO postgres;
ALTER FUNCTION
  public.bump_conversation_notification_capability_from_flag()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.bump_conversation_notification_capability_from_employee(),
  public.bump_conversation_notification_capability_from_page_access(),
  public.bump_conversation_notification_capability_from_role(),
  public.bump_conversation_notification_capability_from_flag()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION
  public.bump_conversation_notification_capability_from_employee() IS
  'Trigger-only capability invalidation; not directly executable by browser or service roles.';
COMMENT ON FUNCTION
  public.bump_conversation_notification_capability_from_page_access() IS
  'Trigger-only capability invalidation; not directly executable by browser or service roles.';
COMMENT ON FUNCTION
  public.bump_conversation_notification_capability_from_role() IS
  'Trigger-only capability invalidation; not directly executable by browser or service roles.';
COMMENT ON FUNCTION
  public.bump_conversation_notification_capability_from_flag() IS
  'Trigger-only capability invalidation; not directly executable by browser or service roles.';

CREATE TRIGGER conversation_notification_employee_capability_version
AFTER UPDATE OF is_active, is_external, role, auth_user_id
ON public.employees
FOR EACH ROW
EXECUTE FUNCTION
  public.bump_conversation_notification_capability_from_employee();

CREATE TRIGGER conversation_notification_page_access_capability_version
AFTER INSERT OR UPDATE OR DELETE
ON public.employee_page_access
FOR EACH ROW
EXECUTE FUNCTION
  public.bump_conversation_notification_capability_from_page_access();

CREATE TRIGGER conversation_notification_role_capability_version
AFTER INSERT OR UPDATE OR DELETE
ON public.nav_permissions
FOR EACH ROW
EXECUTE FUNCTION
  public.bump_conversation_notification_capability_from_role();

CREATE TRIGGER conversation_notification_flag_capability_version
AFTER INSERT OR UPDATE OR DELETE
ON public.feature_flags
FOR EACH ROW
EXECUTE FUNCTION
  public.bump_conversation_notification_capability_from_flag();

-- ─── SECTION: Subscription decisions and mutations ───────────────────────────

CREATE OR REPLACE FUNCTION
  public.ensure_conversation_notification_subscription(
    p_employee_id uuid,
    p_conversation_id uuid,
    p_source text,
    p_source_event_id uuid DEFAULT NULL
  )
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_version bigint;
  v_row_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION
      'ensure_conversation_notification_subscription is service-role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_source NOT IN ('conversation_created', 'message_persisted')
     OR NOT public.messaging_employee_can_view_conversation(
       p_employee_id,
       p_conversation_id
     ) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(version, 0)
    INTO v_version
  FROM public.conversation_notification_capability_versions
  WHERE employee_id = p_employee_id;
  v_version := COALESCE(v_version, 0);

  INSERT INTO public.conversation_notification_subscriptions (
    conversation_id,
    employee_id,
    subscribed,
    source,
    source_event_id,
    eligibility_version,
    created_by,
    updated_by
  )
  VALUES (
    p_conversation_id,
    p_employee_id,
    true,
    p_source,
    p_source_event_id,
    v_version,
    p_employee_id,
    p_employee_id
  )
  ON CONFLICT (conversation_id, employee_id)
  DO UPDATE SET
    source = EXCLUDED.source,
    source_event_id = EXCLUDED.source_event_id,
    eligibility_version = EXCLUDED.eligibility_version,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  WHERE conversation_notification_subscriptions.subscribed
    AND conversation_notification_subscriptions.eligibility_version
      < EXCLUDED.eligibility_version;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$function$;

ALTER FUNCTION
  public.ensure_conversation_notification_subscription(uuid, uuid, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.ensure_conversation_notification_subscription(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.ensure_conversation_notification_subscription(uuid, uuid, text, uuid)
  TO service_role;
COMMENT ON FUNCTION
  public.ensure_conversation_notification_subscription(uuid, uuid, text, uuid) IS
  'Worker/trigger-only automatic subscription helper. Browser roles cannot call it.';

CREATE OR REPLACE FUNCTION
  public.messaging_employee_should_notify_for_conversation(
    p_employee_id uuid,
    p_conversation_id uuid
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
      AND public.messaging_employee_can_view_conversation(
        employee.id,
        p_conversation_id
      )
    LIMIT 1
  ),
  current_version AS (
    SELECT COALESCE((
      SELECT version
      FROM public.conversation_notification_capability_versions
      WHERE employee_id = p_employee_id
    ), 0) AS version
  ),
  explicit_choice AS (
    SELECT subscription.subscribed, subscription.eligibility_version
    FROM public.conversation_notification_subscriptions subscription
    JOIN actor ON actor.id = subscription.employee_id
    WHERE subscription.conversation_id = p_conversation_id
    LIMIT 1
  )
  SELECT COALESCE((
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM explicit_choice)
        THEN (
          SELECT CASE
            WHEN NOT choice.subscribed
              THEN false
            WHEN choice.eligibility_version = current_version.version
              THEN true
            WHEN actor.role IN (
              'admin', 'office', 'project_manager', 'supervisor'
            )
              THEN true
            ELSE false
          END
          FROM explicit_choice choice
          CROSS JOIN current_version
        )
      WHEN actor.role IN (
        'admin', 'office', 'project_manager', 'supervisor'
      )
        THEN true
      ELSE false
    END
    FROM actor
  ), false);
$function$;

ALTER FUNCTION
  public.messaging_employee_should_notify_for_conversation(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.messaging_employee_should_notify_for_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.messaging_employee_should_notify_for_conversation(uuid, uuid)
  TO service_role;

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
    AND public.messaging_employee_should_notify_for_conversation(
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

CREATE OR REPLACE FUNCTION
  public.get_my_conversation_notification_setting(
    p_conversation_id uuid
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor public.employees%ROWTYPE;
  v_subscription public.conversation_notification_subscriptions%ROWTYPE;
  v_effective boolean;
  v_has_explicit boolean := false;
BEGIN
  SELECT employee.*
    INTO v_actor
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
  LIMIT 1;

  IF NOT FOUND
     OR NOT public.messaging_employee_can_view_conversation(
       v_actor.id,
       p_conversation_id
     ) THEN
    RAISE EXCEPTION 'conversation access not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT subscription.*
    INTO v_subscription
  FROM public.conversation_notification_subscriptions subscription
  WHERE subscription.conversation_id = p_conversation_id
    AND subscription.employee_id = v_actor.id;
  v_has_explicit := FOUND;

  v_effective := public.messaging_employee_should_notify_for_conversation(
    v_actor.id,
    p_conversation_id
  );

  RETURN jsonb_build_object(
    'conversation_id', p_conversation_id,
    'employee_id', v_actor.id,
    'subscribed', v_effective,
    'has_explicit', v_has_explicit,
    'explicit_value', CASE
      WHEN v_has_explicit THEN v_subscription.subscribed
      ELSE NULL
    END,
    'source', CASE
      WHEN v_has_explicit THEN v_subscription.source
      WHEN v_actor.role::text IN (
        'admin', 'office', 'project_manager', 'supervisor'
      ) THEN 'role_default'
      ELSE 'not_subscribed'
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION
  public.set_my_conversation_notification_setting(
    p_conversation_id uuid,
    p_subscribed boolean
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid;
  v_version bigint;
BEGIN
  IF p_subscribed IS NULL THEN
    RAISE EXCEPTION 'subscribed is required'
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
     OR NOT public.messaging_employee_can_view_conversation(
       v_actor_id,
       p_conversation_id
     ) THEN
    RAISE EXCEPTION 'conversation access not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(version, 0)
    INTO v_version
  FROM public.conversation_notification_capability_versions
  WHERE employee_id = v_actor_id;
  v_version := COALESCE(v_version, 0);

  INSERT INTO public.conversation_notification_subscriptions (
    conversation_id,
    employee_id,
    subscribed,
    source,
    eligibility_version,
    created_by,
    updated_by
  )
  VALUES (
    p_conversation_id,
    v_actor_id,
    p_subscribed,
    'manual_self',
    v_version,
    v_actor_id,
    v_actor_id
  )
  ON CONFLICT (conversation_id, employee_id)
  DO UPDATE SET
    subscribed = EXCLUDED.subscribed,
    source = EXCLUDED.source,
    source_event_id = NULL,
    eligibility_version = EXCLUDED.eligibility_version,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  RETURN public.get_my_conversation_notification_setting(p_conversation_id);
END;
$function$;

ALTER FUNCTION
  public.get_my_conversation_notification_setting(uuid)
  OWNER TO postgres;
ALTER FUNCTION
  public.set_my_conversation_notification_setting(uuid, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.get_my_conversation_notification_setting(uuid),
  public.set_my_conversation_notification_setting(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.get_my_conversation_notification_setting(uuid),
  public.set_my_conversation_notification_setting(uuid, boolean)
  TO authenticated;
COMMENT ON FUNCTION
  public.get_my_conversation_notification_setting(uuid) IS
  'Authenticated self-service read. The employee identity is derived from auth.uid().';
COMMENT ON FUNCTION
  public.set_my_conversation_notification_setting(uuid, boolean) IS
  'Authenticated self-service writer. It changes only the caller notification choice and never conversation access.';

CREATE OR REPLACE FUNCTION
  public.get_conversation_notification_members(
    p_conversation_id uuid
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid;
  v_members jsonb;
BEGIN
  SELECT employee.id
    INTO v_actor_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
  LIMIT 1;

  IF v_actor_id IS NULL
     OR NOT public.is_active_internal_admin()
     OR NOT public.messaging_employee_can_view_conversation(
       v_actor_id,
       p_conversation_id
     ) THEN
    RAISE EXCEPTION
      'conversation notification members require admin Messages access'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations conversation
    WHERE conversation.id = p_conversation_id
  ) THEN
    RAISE EXCEPTION 'conversation not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'employee_id', employee.id,
      'name', COALESCE(
        NULLIF(employee.display_name, ''),
        employee.full_name,
        employee.email
      ),
      'email', employee.email,
      'role', employee.role::text,
      'can_view', public.messaging_employee_can_view_conversation(
        employee.id,
        p_conversation_id
      ),
      'subscribed',
        public.messaging_employee_should_notify_for_conversation(
          employee.id,
          p_conversation_id
        ),
      'has_explicit', subscription.employee_id IS NOT NULL,
      'explicit_value', subscription.subscribed,
      'source', COALESCE(
        subscription.source,
        CASE
          WHEN employee.role::text IN (
            'admin', 'office', 'project_manager', 'supervisor'
          ) THEN 'role_default'
          ELSE 'not_subscribed'
        END
      )
    )
    ORDER BY
      CASE employee.role::text
        WHEN 'field_tech' THEN 0
        WHEN 'estimator' THEN 1
        ELSE 2
      END,
      COALESCE(
        NULLIF(employee.display_name, ''),
        employee.full_name,
        employee.email
      )
  ), '[]'::jsonb)
    INTO v_members
  FROM public.employees employee
  LEFT JOIN public.conversation_notification_subscriptions subscription
    ON subscription.conversation_id = p_conversation_id
   AND subscription.employee_id = employee.id
  WHERE employee.is_active
    AND NOT employee.is_external
    AND employee.role::text <> 'crm_partner';

  RETURN v_members;
END;
$function$;

CREATE OR REPLACE FUNCTION
  public.set_conversation_notification_override(
    p_conversation_id uuid,
    p_employee_id uuid,
    p_subscribed boolean
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid;
  v_version bigint;
BEGIN
  SELECT employee.id
    INTO v_actor_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
  LIMIT 1;

  IF v_actor_id IS NULL
     OR NOT public.is_active_internal_admin()
     OR NOT public.messaging_employee_can_view_conversation(
       v_actor_id,
       p_conversation_id
     ) THEN
    RAISE EXCEPTION
      'conversation notification overrides require admin Messages access'
      USING ERRCODE = '42501';
  END IF;

  IF p_subscribed IS NULL THEN
    DELETE FROM public.conversation_notification_subscriptions subscription
    WHERE subscription.conversation_id = p_conversation_id
      AND subscription.employee_id = p_employee_id;
  ELSE
    IF NOT public.messaging_employee_can_view_conversation(
      p_employee_id,
      p_conversation_id
    ) THEN
      RAISE EXCEPTION 'target employee cannot view this conversation'
        USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(version, 0)
      INTO v_version
    FROM public.conversation_notification_capability_versions
    WHERE employee_id = p_employee_id;
    v_version := COALESCE(v_version, 0);

    INSERT INTO public.conversation_notification_subscriptions (
      conversation_id,
      employee_id,
      subscribed,
      source,
      eligibility_version,
      created_by,
      updated_by
    )
    VALUES (
      p_conversation_id,
      p_employee_id,
      p_subscribed,
      'manual_admin',
      v_version,
      v_actor_id,
      v_actor_id
    )
    ON CONFLICT (conversation_id, employee_id)
    DO UPDATE SET
      subscribed = EXCLUDED.subscribed,
      source = EXCLUDED.source,
      source_event_id = NULL,
      eligibility_version = EXCLUDED.eligibility_version,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();
  END IF;

  RETURN public.get_conversation_notification_members(p_conversation_id);
END;
$function$;

ALTER FUNCTION public.get_conversation_notification_members(uuid)
  OWNER TO postgres;
ALTER FUNCTION
  public.set_conversation_notification_override(uuid, uuid, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.get_conversation_notification_members(uuid),
  public.set_conversation_notification_override(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.get_conversation_notification_members(uuid),
  public.set_conversation_notification_override(uuid, uuid, boolean)
  TO authenticated;
COMMENT ON FUNCTION
  public.get_conversation_notification_members(uuid) IS
  'Authenticated admin-only directory; the definer derives an active internal actor and requires effective Messages access to the conversation.';
COMMENT ON FUNCTION
  public.set_conversation_notification_override(uuid, uuid, boolean) IS
  'Authenticated admin-only notification override; the actor must retain effective Messages access and the override never grants conversation access.';

-- ─── SECTION: Start/open and search boundaries ───────────────────────────────

CREATE OR REPLACE FUNCTION
  public.find_or_create_viewable_conversation(
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
  v_created boolean := false;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION
      'find_or_create_viewable_conversation is service-role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_contact_id IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'contact and employee are required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.employees employee
       WHERE employee.id = p_employee_id
         AND employee.is_active
         AND NOT employee.is_external
         AND employee.role::text <> 'crm_partner'
         AND public.messaging_employee_has_conversations_capability(employee.id)
     ) THEN
    RAISE EXCEPTION 'Messages access is not granted'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('find_or_create_conversation:' || p_contact_id::text)
  );

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

  v_conversation := public.find_or_create_conversation(p_contact_id);
  v_conversation_id := NULLIF(v_conversation ->> 'id', '')::uuid;
  v_created := v_existing_conversation_id IS NULL;

  IF v_conversation_id IS NULL
     OR NOT public.messaging_employee_can_view_conversation(
       p_employee_id,
       v_conversation_id
     ) THEN
    RAISE EXCEPTION 'conversation access not found'
      USING ERRCODE = '42501';
  END IF;

  IF v_created THEN
    PERFORM public.ensure_conversation_notification_subscription(
      p_employee_id,
      v_conversation_id,
      'conversation_created',
      v_conversation_id
    );
  END IF;

  RETURN v_conversation || jsonb_build_object('created', v_created);
END;
$function$;

ALTER FUNCTION
  public.find_or_create_viewable_conversation(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.find_or_create_viewable_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.find_or_create_viewable_conversation(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.search_viewable_conversation_contacts(
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
    RAISE EXCEPTION
      'search_viewable_conversation_contacts is service-role only'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.employees employee
       WHERE employee.id = p_employee_id
         AND employee.is_active
         AND NOT employee.is_external
         AND employee.role::text <> 'crm_partner'
         AND public.messaging_employee_has_conversations_capability(employee.id)
     ) THEN
    RAISE EXCEPTION 'Messages access is not granted'
      USING ERRCODE = '42501';
  END IF;

  IF v_search IS NULL
     OR char_length(v_search) < 2
     OR char_length(v_search) > 80 THEN
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
  ORDER BY contact.name ASC NULLS LAST, contact.id
  LIMIT v_limit;
END;
$function$;

ALTER FUNCTION
  public.search_viewable_conversation_contacts(uuid, text, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.search_viewable_conversation_contacts(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.search_viewable_conversation_contacts(uuid, text, integer)
  TO service_role;

-- ─── SECTION: Durable message subscription ───────────────────────────────────

CREATE OR REPLACE FUNCTION
  public.subscribe_message_author_to_conversation_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.sent_by IS NOT NULL
     AND (
       NEW.type = 'internal_note'
       OR (
         NEW.type = 'sms_outbound'
         AND NEW.status IN ('queued', 'sent', 'delivered', 'read')
       )
     ) THEN
    PERFORM public.ensure_conversation_notification_subscription(
      NEW.sent_by,
      NEW.conversation_id,
      'message_persisted',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION
  public.subscribe_message_author_to_conversation_notifications()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.subscribe_message_author_to_conversation_notifications()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION
  public.subscribe_message_author_to_conversation_notifications() IS
  'Trigger-only durable-message subscription hook; no role may invoke it directly.';

CREATE TRIGGER messages_subscribe_author_to_conversation_notifications
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION
  public.subscribe_message_author_to_conversation_notifications();

-- ─── SECTION: Postconditions ─────────────────────────────────────────────────

DO $conversation_notification_foundation_postcondition$
DECLARE
  v_table text;
  v_function text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.conversation_notification_capability_versions',
    'public.conversation_notification_subscriptions'
  ]
  LOOP
    IF NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace
           ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = split_part(v_table, '.', 2)
           AND relation.relrowsecurity
           AND relation.relforcerowsecurity
       )
       OR has_table_privilege('anon', v_table, 'SELECT')
       OR has_table_privilege('authenticated', v_table, 'SELECT')
       OR NOT has_table_privilege('service_role', v_table, 'SELECT') THEN
      RAISE EXCEPTION
        'conversation notification foundation: private table boundary failed on %',
        v_table;
    END IF;
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'public.messaging_employee_can_view_conversation(uuid,uuid)',
    'public.messaging_employee_should_notify_for_conversation(uuid,uuid)',
    'public.ensure_conversation_notification_subscription(uuid,uuid,text,uuid)',
    'public.find_or_create_viewable_conversation(uuid,uuid)',
    'public.search_viewable_conversation_contacts(uuid,text,integer)',
    'public.messaging_get_authorized_message_media(uuid,uuid)',
    'public.get_conversation_notification_recipients(uuid)'
  ]
  LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION
        'conversation notification foundation: service RPC ACL failed on %',
        v_function;
    END IF;
  END LOOP;

  IF has_function_privilege(
       'anon',
       'public.messaging_can_view_conversation(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.messaging_can_view_conversation(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.get_conversation_notification_members(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.get_conversation_notification_members(uuid)',
       'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger trigger
       WHERE trigger.tgname =
         'messages_subscribe_author_to_conversation_notifications'
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION
      'conversation notification foundation: browser/trigger postcondition failed';
  END IF;
END;
$conversation_notification_foundation_postcondition$;
