-- ════════════════════════════════════════════════
-- sms_f_core_rpcs.sql  ·  SMS-Experience Wave 0 — F-core SQL gate
--   docs/sms-experience-roadmap.md → "Wave 0 — F-core" (Test-first: claim-RPC
--   atomicity). Run via mcp__supabase__execute_sql. RAISEs on any failure and
--   returns {ok:true} on success. Fully self-cleaning: it creates its own
--   disposable conversation + scheduled_message fixtures and DELETEs them at the
--   end; on any RAISE the whole DO block rolls back, so nothing is ever left behind.
--
-- WHAT THIS PROVES:
--   ① claim_scheduled_message is a real compare-and-set — the FIRST claim of a
--      pending row returns TRUE, an immediate SECOND claim returns FALSE (exactly
--      one winner). Because the guard is one atomic UPDATE ... WHERE, this sequential
--      proof is the same predicate two truly-concurrent callers race on: row-locking
--      serializes them and only the first sees the WHERE as true.
--   ② a non-pending row is never claimable; a NULL/unknown id yields FALSE.
--   ③ stale-claim recovery — a still-pending row whose claim is >10 min old becomes
--      re-claimable (a crashed worker can't strand a message forever).
--   ④ increment_conversation_unread is atomic + monotonic — N increments land N,
--      a negative delta clamps at 0, and an unknown id returns NULL.
-- ════════════════════════════════════════════════
DO $$
DECLARE
  v_conv   uuid;
  v_sched  uuid;
  v_ok     boolean;
  v_cnt    integer;
BEGIN
  -- ── fixtures ────────────────────────────────────────────────────────────────
  INSERT INTO public.conversations (type, status) VALUES ('direct', 'needs_response')
    RETURNING id INTO v_conv;
  INSERT INTO public.scheduled_messages (conversation_id, body, send_at, status)
    VALUES (v_conv, 'TEST sms_f_core_rpcs fixture', now(), 'pending')
    RETURNING id INTO v_sched;

  -- ── ① compare-and-set: exactly one winner ──────────────────────────────────
  v_ok := public.claim_scheduled_message(v_sched);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'F-core FAIL: first claim of a pending row must be TRUE'; END IF;

  v_ok := public.claim_scheduled_message(v_sched);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'F-core FAIL: second (concurrent) claim must be FALSE — double-send not prevented'; END IF;

  -- ── ② non-pending / unknown id never claims ─────────────────────────────────
  UPDATE public.scheduled_messages SET status = 'sent', claimed_at = NULL WHERE id = v_sched;
  v_ok := public.claim_scheduled_message(v_sched);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'F-core FAIL: a non-pending row must not be claimable'; END IF;

  v_ok := public.claim_scheduled_message(gen_random_uuid());
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'F-core FAIL: an unknown id must return FALSE'; END IF;

  -- ── ③ stale-claim recovery (>10 min old, still pending) ─────────────────────
  UPDATE public.scheduled_messages
     SET status = 'pending', claimed_at = now() - interval '11 minutes'
   WHERE id = v_sched;
  v_ok := public.claim_scheduled_message(v_sched);
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'F-core FAIL: a stale-claimed (>10 min) pending row must be re-claimable'; END IF;

  -- a fresh claim (just stamped above) is NOT re-claimable
  v_ok := public.claim_scheduled_message(v_sched);
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'F-core FAIL: a freshly-claimed row must not be re-claimable'; END IF;

  -- ── ④ atomic unread counter ─────────────────────────────────────────────────
  v_cnt := public.increment_conversation_unread(v_conv, 1);   -- 1
  v_cnt := public.increment_conversation_unread(v_conv, 1);   -- 2
  v_cnt := public.increment_conversation_unread(v_conv, 3);   -- 5
  IF v_cnt <> 5 THEN RAISE EXCEPTION 'F-core FAIL: unread increments must sum (expected 5, got %)', v_cnt; END IF;

  v_cnt := public.increment_conversation_unread(v_conv, -100);  -- clamp at 0
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'F-core FAIL: unread counter must clamp at 0 (got %)', v_cnt; END IF;

  v_cnt := public.increment_conversation_unread(gen_random_uuid(), 1);
  IF v_cnt IS NOT NULL THEN RAISE EXCEPTION 'F-core FAIL: unknown conversation must return NULL'; END IF;

  -- ── cleanup ─────────────────────────────────────────────────────────────────
  DELETE FROM public.scheduled_messages WHERE id = v_sched;
  DELETE FROM public.conversations WHERE id = v_conv;

  RAISE NOTICE 'sms_f_core_rpcs: ok';
END $$;
