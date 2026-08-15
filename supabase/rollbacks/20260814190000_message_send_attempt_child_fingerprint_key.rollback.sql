-- ════════════════════════════════════════════════
-- ROLLBACK: 20260814190000_message_send_attempt_child_fingerprint_key
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the safety rule that stopped the same photo-part from being written
--   down twice inside one multi-photo text batch. Nothing a customer sees changes
--   when you run this, and no saved data is lost — the only thing that goes away
--   is the database's ability to REFUSE a duplicate if the sending code ever
--   tries to make one.
--
-- SCOPE:
--   Drops exactly one index: public.message_send_attempts_parent_fingerprint_key.
--   No table, column, policy, trigger, grant, function or row is touched. The
--   pre-existing message_send_attempts_parent_recipient_key — which covers
--   children that carry a recipient_contact_id — is deliberately NOT dropped;
--   it predates this migration and belongs to the 20260723215926 foundation.
--
-- WHAT IT COSTS — read before running:
--   After this, `claimChildMessageAttempt` (functions/lib/messaging-attempts.js)
--   is back to a check-then-insert on (parent_attempt_id, request_fingerprint)
--   with no database-level compare-and-swap. The multi-photo split loop is then
--   guarded ONLY by:
--     1. the parent claim taking the unique message_send_attempts_client_request_id_key, and
--     2. functions/api/send-message.js refusing a multi-photo send that omits
--        client_request_id (400 CLIENT_REQUEST_ID_REQUIRED).
--   Those two are one mechanism. If either is relaxed while this index is
--   dropped, two concurrent POSTs can each run the whole split loop and dispatch
--   2×N real MMS to a customer. That is the state this migration existed to end.
--
-- WHEN TO RUN IT:
--   Only if the index itself is causing a live failure — i.e. a legitimate send
--   is being refused with a unique-violation on this index name. If that happens,
--   the right response is almost certainly to fix the caller (a split part that
--   is not distinguished by partIndex, or a caller wrongly passing a NULL
--   recipient_contact_id on a group child), NOT to keep this dropped. Re-apply
--   the forward migration once the caller is corrected; it is safely repeatable,
--   because its own preflight guard refuses to recreate the index while any
--   duplicate row exists.
--
-- ════════════════════════════════════════════════

-- destructive-approved: drops only the additive index created by 20260814190000.
-- No data, table, column, policy or grant is removed, and the pre-existing
-- sibling index is explicitly preserved. This is the paired undo required by
-- database-standard.md §6.

SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.message_send_attempts_parent_fingerprint_key;

-- ─── POSTCONDITIONS ──────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'message_send_attempts_parent_fingerprint_key'
  ) THEN
    RAISE EXCEPTION 'rollback postcondition failed: index still present' USING ERRCODE = '55000';
  END IF;

  -- The sibling index this rollback must NOT touch.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.message_send_attempts_parent_recipient_key'::regclass
      AND i.indisunique
  ) THEN
    RAISE EXCEPTION
      'rollback postcondition failed: message_send_attempts_parent_recipient_key was removed or is no longer unique — this rollback must leave it intact'
      USING ERRCODE = '55000';
  END IF;
END;
$post$;
