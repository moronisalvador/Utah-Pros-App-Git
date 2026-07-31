-- ════════════════════════════════════════════════
-- ROLLBACK: 20260731040337_conversation_participant_scoping
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Restores the earlier company-wide conversation access rules and the earlier
--   inbox response. It then removes the staff-access choices added by the
--   participant-controls migration.
--
-- DATA LOSS WARNING:
--   This permanently discards every per-chat inclusion/removal and every default
--   technician choice made after the migration was applied. Export those choices
--   before running this rollback if they may be needed again.
--
-- REQUIRED ORDER:
--   If present, run the 20260731040339 enforcement rollback first and the
--   20260731040338 unread-compatibility rollback second. Restore compatible
--   deployed callers before removing this foundation.
--
-- FIDELITY:
--   The inbox function and broad authenticated policies below are copied from
--   the migration sources that were live immediately before participant scoping.
-- ════════════════════════════════════════════════

-- ─── SECTION: Restore the pre-scoping inbox function ─────────────────────────

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
  -- Escape LIKE wildcards so a tech's literal "%"/"_" doesn't broaden the search.
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH base AS (
    SELECT c.*, COALESCE(c.last_message_at, c.created_at) AS sort_key
    FROM public.conversations c
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
        ), '[]'::jsonb)
      ) AS row_json
    FROM paged p
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY sort_key DESC, id DESC), '[]'::jsonb)
    INTO v_convs
  FROM page_rows;

  SELECT COALESCE(SUM(unread_count), 0)::int INTO v_unread FROM public.conversations;

  WITH scope AS (
    SELECT c.* FROM public.conversations c
    WHERE
      v_like IS NULL
      OR c.title ILIKE v_like
      OR c.last_message_preview ILIKE v_like
      OR EXISTS (
        SELECT 1
        FROM public.conversation_participants cp
        LEFT JOIN public.contacts ct ON ct.id = cp.contact_id
        WHERE cp.conversation_id = c.id
          AND (cp.phone ILIKE v_like OR ct.name ILIKE v_like OR ct.phone ILIKE v_like)
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

-- ─── SECTION: Restore internal-note-only author lookup ───────────────────────

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
  v_is_service boolean := COALESCE(
    auth.jwt() ->> 'role' = 'service_role',
    false
  );
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
     AND message.type = 'internal_note'
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

ALTER FUNCTION public.get_message_author_directory(uuid[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_message_author_directory(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_message_author_directory(uuid[])
  TO authenticated, service_role;

-- ─── SECTION: Remove participant-control objects ────────────────────────────

DROP FUNCTION IF EXISTS public.get_conversation_notification_recipients(uuid);
DROP FUNCTION IF EXISTS public.search_scoped_conversation_contacts(uuid, text, integer);
DROP FUNCTION IF EXISTS public.find_or_create_scoped_conversation(uuid, uuid);
DROP FUNCTION IF EXISTS public.set_default_conversation_member(uuid, boolean);
DROP FUNCTION IF EXISTS public.set_conversation_member_override(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.leave_conversation(uuid);
DROP FUNCTION IF EXISTS public.get_conversation_members(uuid);
DROP FUNCTION IF EXISTS public.messaging_can_access_conversation(uuid);
DROP FUNCTION IF EXISTS public.messaging_employee_can_access_conversation(uuid, uuid);
DROP FUNCTION IF EXISTS public.messaging_employee_has_conversations_capability(uuid);

DROP TABLE IF EXISTS public.conversation_member_overrides;
DROP TABLE IF EXISTS public.conversation_default_members;
