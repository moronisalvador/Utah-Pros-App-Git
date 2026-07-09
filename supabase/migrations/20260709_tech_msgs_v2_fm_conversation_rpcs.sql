-- ════════════════════════════════════════════════
-- MIGRATION: 20260709_tech_msgs_v2_fm_conversation_rpcs
-- Phase: Tech Messages v2 — F-M (Foundation)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds two database helpers that power the new field-tech messaging pane:
--     1. get_tech_conversations(...) — returns ONE page of the conversation
--        inbox (newest first) plus two summary numbers: how many unread
--        messages there are in total (the little red dot on the Messages tab),
--        and how many conversations fall into each status (so the filter pills
--        can show counts). It can also search by name/phone/text and fetch a
--        single conversation by id (for opening a link straight to a thread).
--        Each conversation comes back with the same people/contact details the
--        existing inbox already loads, so the new screen and the old one read
--        the same shape.
--     2. find_or_create_conversation(contact_id) — given a person, either finds
--        the conversation that already exists with them or starts a new one, and
--        returns it. This stops the app from accidentally creating a second,
--        split thread with the same person when the list is paginated.
--
--   Neither helper changes any table or column. They only READ, except
--   find_or_create_conversation, which inserts a new conversation + its one
--   participant when none exists yet (the same two inserts the old screen did
--   client-side, moved server-side so they can't race into a duplicate).
--
-- ADDITIVE-ONLY:
--   Two new SECURITY DEFINER functions. No table DROP/RENAME/ALTER COLUMN, no
--   new column, no data change to existing rows. Least-privilege grants: EXECUTE
--   to authenticated + service_role only, with an explicit REVOKE FROM PUBLIC,
--   anon FIRST (this managed-Supabase project re-applies EXECUTE TO PUBLIC to
--   every new function at ddl_command_end — the REVOKE line is load-bearing;
--   database-standard.md §1). No anon grant — not in the public allowlist (§2).
--
-- FROZEN CONTRACTS (tech-messages-v2-wave-ownership §2/§3 — B1/B2 import, never redefine):
--   get_tech_conversations(p_limit int DEFAULT 50, p_before timestamptz DEFAULT NULL,
--     p_before_id uuid DEFAULT NULL, p_search text DEFAULT NULL, p_status text DEFAULT NULL,
--     p_conversation_id uuid DEFAULT NULL) → jsonb
--   find_or_create_conversation(p_contact_id uuid) → jsonb
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.find_or_create_conversation(uuid);
--   DROP FUNCTION IF EXISTS public.get_tech_conversations(int, timestamptz, uuid, text, text, uuid);
--   (Both are brand-new; dropping them fully reverts this migration. No table or
--    data change to undo.)
-- ════════════════════════════════════════════════

-- ─── get_tech_conversations ────────────────────────────────────────────────────
-- Composite, keyset-paginated conversation feed for the tech pane.
--
-- Ordering / cursor (challenge-fixed): sort_key = COALESCE(last_message_at,
-- created_at) is NEVER null (created_at is NOT NULL), so there is no unreachable
-- "NULL tail" — the naive `last_message_at NULLS LAST` cursor was broken. The
-- keyset is (sort_key DESC, id DESC); a page's cursor is the LAST row's
-- (sort_key, id), passed back as (p_before, p_before_id). The id tiebreaker makes
-- the cursor total even when two rows share the exact sort_key.
--
-- unread_total  = SUM(unread_count) over ALL conversations (global, never narrowed
--                 by search/status) — it drives the Messages-tab badge, which must
--                 be correct no matter what filter the tech has open.
-- status_counts = per-status CONVERSATION counts over the p_search-matched set
--                 (but NOT narrowed by p_status), so each filter pill shows how
--                 many match the current search in that status.
-- p_conversation_id = single-row mode: returns exactly that conversation
--                 (ignores paging/filters), for a ?c= deep-link cache miss.
-- p_status='unread' → unread_count > 0; 'all'/NULL → no status filter; any other
--                 value → status = p_status.
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

  -- ── page of conversations (keyset) + embedded participants/contacts ──────────
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

  -- ── unread_total: global (badge) ────────────────────────────────────────────
  SELECT COALESCE(SUM(unread_count), 0)::int INTO v_unread FROM public.conversations;

  -- ── status_counts: over the search-matched set, ignoring p_status ────────────
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

REVOKE EXECUTE ON FUNCTION public.get_tech_conversations(int, timestamptz, uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_tech_conversations(int, timestamptz, uuid, text, text, uuid) TO authenticated, service_role;

-- ─── find_or_create_conversation ───────────────────────────────────────────────
-- Given a contact, return the existing thread with them (most-recent if several)
-- or start a new one, in the SAME embed shape as one get_tech_conversations row.
-- Serialized per contact via a transaction-scoped advisory lock so two concurrent
-- callers can't both create a thread → the split-thread hazard that a paginated,
-- client-side dedupe list would otherwise reopen.
CREATE OR REPLACE FUNCTION public.find_or_create_conversation(p_contact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conv_id uuid;
  v_contact public.contacts%ROWTYPE;
  v_title   text;
BEGIN
  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'find_or_create_conversation: p_contact_id is required';
  END IF;

  -- Serialize concurrent callers for the same contact (idempotency guard).
  PERFORM pg_advisory_xact_lock(hashtext('find_or_create_conversation:' || p_contact_id::text));

  -- Existing thread? (most-recent wins if the contact somehow has more than one)
  SELECT cp.conversation_id INTO v_conv_id
  FROM public.conversation_participants cp
  JOIN public.conversations c ON c.id = cp.conversation_id
  WHERE cp.contact_id = p_contact_id
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

  -- Reuse get_tech_conversations' single-row mode so the embed shape is identical.
  RETURN (SELECT public.get_tech_conversations(p_conversation_id => v_conv_id) -> 'conversations' -> 0);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.find_or_create_conversation(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.find_or_create_conversation(uuid) TO authenticated, service_role;
