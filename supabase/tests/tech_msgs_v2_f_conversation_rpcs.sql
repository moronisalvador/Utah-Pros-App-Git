-- ════════════════════════════════════════════════
-- tech_msgs_v2_f_conversation_rpcs.sql  ·  Tech Messages v2 — F-M SQL gate
--   docs/tech-messages-v2-roadmap.md → Phase F-M (Data-layer contracts). Run via
--   mcp__supabase__execute_sql. RAISEs on any failure, RAISE NOTICE 'ok' on success.
--   Self-cleaning: creates its own disposable contacts + conversations + participants
--   (all tagged with a unique marker) and DELETEs them at the end; on any RAISE the
--   whole DO block rolls back, so nothing is ever left behind. Keys every assertion
--   to fixture IDs / a unique search marker — NEVER to live row counts.
--
-- WHAT THIS PROVES:
--   ① Composite shape — get_tech_conversations() returns {conversations, unread_total,
--      status_counts:{all,unread,needs_response,waiting_on_client,resolved}} and each
--      row carries the legacy embed (conversation_participants → contacts incl. dnd/
--      dnd_at) + a computed sort_key.
--   ② Keyset cursor is TOTAL — a full limit=2 walk returns every fixture exactly once
--      (no skip, no duplicate) across page boundaries, INCLUDING a NULL-last_message_at
--      row (COALESCE tail reachable) and two rows sharing an identical sort_key (the id
--      tiebreaker). Order is (sort_key DESC, id DESC): the two tied rows lead, the
--      NULL-last_message_at row is last.
--   ③ Filters — p_status='unread' returns only unread; server search matches a
--      participant contact name; status_counts (search-scoped) are exact.
--   ④ unread_total is global (delta over baseline = the fixtures' unread sum).
--   ⑤ Single-row mode returns exactly the requested conversation, with the embed.
--   ⑥ find_or_create_conversation — returns the existing thread (idempotent: two calls,
--      same id), creates one when none exists (second call returns the SAME id — no
--      split thread), and refuses a phone-less contact.
-- ════════════════════════════════════════════════
DO $$
DECLARE
  v_marker text := 'ZZ_TMV2_FMTEST_7f3';
  v_base   timestamptz := now();
  ct1      uuid;  -- has phone + company, participant on c_a
  ct2      uuid;  -- has phone, no company, participant on c_b
  ct_new   uuid;  -- has phone, NO conversation (find_or_create create path)
  ct_nop   uuid;  -- empty phone, NO conversation (find_or_create raise path)
  c_null   uuid;  -- last_message_at NULL  (sort_key = created_at, oldest)
  c_c      uuid;  -- last_message_at -2h
  c_a      uuid;  -- last_message_at -1h
  c_b      uuid;  -- last_message_at -1h (tie with c_a)
  v_page   jsonb;
  v_arr    jsonb;
  v_row    jsonb;
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_before_ts timestamptz;
  v_before_id uuid;
  v_iter   int := 0;
  v_unread_before int;
  v_unread_after  int;
  v_foc    jsonb;
  v_foc_id uuid;
  v_foc_id2 uuid;
  v_new_conv uuid;
  v_new_conv2 uuid;
  v_raised boolean := false;
  i int;
BEGIN
  -- ── baseline unread_total (global) BEFORE any fixture ─────────────────────────
  v_unread_before := (public.get_tech_conversations() ->> 'unread_total')::int;

  -- ── fixtures ──────────────────────────────────────────────────────────────────
  INSERT INTO public.contacts (name, phone, company)
    VALUES (v_marker || ' Alice AliceX7', '+15550000001', v_marker || ' Co') RETURNING id INTO ct1;
  INSERT INTO public.contacts (name, phone)
    VALUES (v_marker || ' Bob', '+15550000002') RETURNING id INTO ct2;
  INSERT INTO public.contacts (name, phone)
    VALUES (v_marker || ' NewGuy', '+15550000003') RETURNING id INTO ct_new;
  -- all-spaces phone: contacts.phone is NOT NULL + UNIQUE (an empty '' is taken),
  -- so a spaces-only value is both insertable and unique, and still btrims to ''.
  INSERT INTO public.contacts (name, phone)
    VALUES (v_marker || ' NoPhone', repeat(' ', 9)) RETURNING id INTO ct_nop;

  INSERT INTO public.conversations (type, title, status, unread_count, last_message_at, created_at)
    VALUES ('direct', v_marker || ' Null', 'needs_response', 0, NULL, v_base - interval '3 hours') RETURNING id INTO c_null;
  INSERT INTO public.conversations (type, title, status, unread_count, last_message_at)
    VALUES ('direct', v_marker || ' C', 'needs_response', 2, v_base - interval '2 hours') RETURNING id INTO c_c;
  INSERT INTO public.conversations (type, title, status, unread_count, last_message_at)
    VALUES ('direct', v_marker || ' A', 'waiting_on_client', 0, v_base - interval '1 hour') RETURNING id INTO c_a;
  INSERT INTO public.conversations (type, title, status, unread_count, last_message_at)
    VALUES ('direct', v_marker || ' B', 'resolved', 5, v_base - interval '1 hour') RETURNING id INTO c_b;

  INSERT INTO public.conversation_participants (conversation_id, contact_id, phone, role)
    VALUES (c_a, ct1, '+15550000001', 'primary');
  INSERT INTO public.conversation_participants (conversation_id, contact_id, phone, role)
    VALUES (c_b, ct2, '+15550000002', 'primary');

  -- ── ④ unread_total delta = fixtures' unread sum (5 + 2 = 7) ───────────────────
  v_unread_after := (public.get_tech_conversations() ->> 'unread_total')::int;
  IF v_unread_after - v_unread_before <> 7 THEN
    RAISE EXCEPTION 'F-M FAIL: unread_total delta expected 7, got %', v_unread_after - v_unread_before;
  END IF;

  -- ── ① composite shape + embed ────────────────────────────────────────────────
  v_page := public.get_tech_conversations(50, NULL, NULL, v_marker, NULL, NULL);
  IF v_page -> 'conversations' IS NULL OR v_page -> 'status_counts' IS NULL
     OR NOT (v_page ? 'unread_total') THEN
    RAISE EXCEPTION 'F-M FAIL: result must have conversations + unread_total + status_counts';
  END IF;
  -- the c_a row must carry participants → contacts with dnd keys
  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_page -> 'conversations') elem
  WHERE (elem ->> 'id')::uuid = c_a;
  IF v_row IS NULL THEN RAISE EXCEPTION 'F-M FAIL: c_a missing from marker search'; END IF;
  IF NOT (v_row ? 'sort_key') THEN RAISE EXCEPTION 'F-M FAIL: row missing computed sort_key'; END IF;
  IF jsonb_array_length(v_row -> 'conversation_participants') <> 1 THEN
    RAISE EXCEPTION 'F-M FAIL: c_a must embed exactly one participant';
  END IF;
  IF NOT ((v_row -> 'conversation_participants' -> 0 -> 'contacts') ? 'dnd')
     OR NOT ((v_row -> 'conversation_participants' -> 0 -> 'contacts') ? 'dnd_at') THEN
    RAISE EXCEPTION 'F-M FAIL: embedded contact must include dnd + dnd_at';
  END IF;
  -- email_reply_token must NOT leak through the RPC
  IF v_row ? 'email_reply_token' THEN
    RAISE EXCEPTION 'F-M FAIL: email_reply_token must be stripped from the RPC output';
  END IF;

  -- ── ② total keyset walk (limit 2) over the 4 marker fixtures ──────────────────
  v_before_ts := NULL; v_before_id := NULL; v_ids := ARRAY[]::uuid[]; v_iter := 0;
  LOOP
    v_iter := v_iter + 1;
    IF v_iter > 20 THEN RAISE EXCEPTION 'F-M FAIL: cursor walk did not terminate'; END IF;
    v_page := public.get_tech_conversations(2, v_before_ts, v_before_id, v_marker, NULL, NULL);
    v_arr := v_page -> 'conversations';
    IF jsonb_array_length(v_arr) = 0 THEN EXIT; END IF;
    FOR i IN 0 .. jsonb_array_length(v_arr) - 1 LOOP
      v_ids := v_ids || ((v_arr -> i ->> 'id')::uuid);
    END LOOP;
    v_row := v_arr -> (jsonb_array_length(v_arr) - 1);
    v_before_ts := (v_row ->> 'sort_key')::timestamptz;
    v_before_id := (v_row ->> 'id')::uuid;
    IF jsonb_array_length(v_arr) < 2 THEN EXIT; END IF;
  END LOOP;

  IF array_length(v_ids, 1) <> 4 THEN
    RAISE EXCEPTION 'F-M FAIL: cursor walk returned % rows, expected 4 (skip or duplicate)', array_length(v_ids, 1);
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> 4 THEN
    RAISE EXCEPTION 'F-M FAIL: cursor walk produced a duplicate row across a page boundary';
  END IF;
  -- order: the two tied (-1h) rows lead, id DESC; then c_c (-2h); c_null (NULL) last
  IF v_ids[1] <> GREATEST(c_a, c_b) OR v_ids[2] <> LEAST(c_a, c_b) THEN
    RAISE EXCEPTION 'F-M FAIL: tie rows must sort by id DESC';
  END IF;
  IF v_ids[3] <> c_c THEN RAISE EXCEPTION 'F-M FAIL: c_c must follow the tie rows'; END IF;
  IF v_ids[4] <> c_null THEN RAISE EXCEPTION 'F-M FAIL: NULL-last_message_at row must be reachable AND last'; END IF;

  -- ── ③ p_status='unread' returns only the two unread fixtures ──────────────────
  v_page := public.get_tech_conversations(50, NULL, NULL, v_marker, 'unread', NULL);
  IF jsonb_array_length(v_page -> 'conversations') <> 2 THEN
    RAISE EXCEPTION 'F-M FAIL: p_status=unread must return exactly the 2 unread fixtures';
  END IF;

  -- server search matches a participant contact name (AliceX7 only on ct1 → c_a)
  v_page := public.get_tech_conversations(50, NULL, NULL, 'AliceX7', NULL, NULL);
  IF jsonb_array_length(v_page -> 'conversations') <> 1
     OR (v_page -> 'conversations' -> 0 ->> 'id')::uuid <> c_a THEN
    RAISE EXCEPTION 'F-M FAIL: server search over participant name failed';
  END IF;

  -- status_counts (search-scoped to the marker → exactly the 4 fixtures)
  v_page := public.get_tech_conversations(50, NULL, NULL, v_marker, NULL, NULL);
  IF (v_page -> 'status_counts' ->> 'all')::int <> 4
     OR (v_page -> 'status_counts' ->> 'unread')::int <> 2
     OR (v_page -> 'status_counts' ->> 'needs_response')::int <> 2
     OR (v_page -> 'status_counts' ->> 'waiting_on_client')::int <> 1
     OR (v_page -> 'status_counts' ->> 'resolved')::int <> 1 THEN
    RAISE EXCEPTION 'F-M FAIL: status_counts wrong: %', v_page -> 'status_counts';
  END IF;

  -- ── ⑤ single-row mode ─────────────────────────────────────────────────────────
  v_page := public.get_tech_conversations(50, NULL, NULL, NULL, NULL, c_null);
  IF jsonb_array_length(v_page -> 'conversations') <> 1
     OR (v_page -> 'conversations' -> 0 ->> 'id')::uuid <> c_null THEN
    RAISE EXCEPTION 'F-M FAIL: single-row mode must return exactly the requested conversation';
  END IF;

  -- ── ⑥ find_or_create_conversation ─────────────────────────────────────────────
  -- existing thread (ct1 → c_a); idempotent
  v_foc := public.find_or_create_conversation(ct1);
  v_foc_id := (v_foc ->> 'id')::uuid;
  IF v_foc_id <> c_a THEN RAISE EXCEPTION 'F-M FAIL: find_or_create must return the existing thread (c_a)'; END IF;
  v_foc_id2 := (public.find_or_create_conversation(ct1) ->> 'id')::uuid;
  IF v_foc_id2 <> c_a THEN RAISE EXCEPTION 'F-M FAIL: find_or_create must be idempotent for an existing thread'; END IF;
  -- create path (ct_new has no conversation); second call returns the SAME id
  v_new_conv := (public.find_or_create_conversation(ct_new) ->> 'id')::uuid;
  IF v_new_conv IS NULL THEN RAISE EXCEPTION 'F-M FAIL: find_or_create must create a thread for a new contact'; END IF;
  v_new_conv2 := (public.find_or_create_conversation(ct_new) ->> 'id')::uuid;
  IF v_new_conv2 <> v_new_conv THEN RAISE EXCEPTION 'F-M FAIL: find_or_create created a SPLIT thread (not idempotent)'; END IF;
  IF (SELECT count(*) FROM public.conversation_participants WHERE contact_id = ct_new) <> 1 THEN
    RAISE EXCEPTION 'F-M FAIL: find_or_create must leave exactly one thread for a new contact';
  END IF;
  -- phone-less contact must be refused
  BEGIN
    PERFORM public.find_or_create_conversation(ct_nop);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'F-M FAIL: find_or_create must refuse a phone-less contact'; END IF;
  -- unknown contact id must be refused too
  v_raised := false;
  BEGIN
    PERFORM public.find_or_create_conversation(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'F-M FAIL: find_or_create must refuse an unknown contact id'; END IF;

  -- ── cleanup (conversation delete cascades its participants) ───────────────────
  DELETE FROM public.conversations WHERE title LIKE '%' || v_marker || '%';
  DELETE FROM public.contacts      WHERE name  LIKE '%' || v_marker || '%';

  RAISE NOTICE 'tech_msgs_v2_f_conversation_rpcs: ok';
END $$;
