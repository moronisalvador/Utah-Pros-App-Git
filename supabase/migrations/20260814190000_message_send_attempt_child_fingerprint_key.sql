-- ════════════════════════════════════════════════
-- MIGRATION: 20260814190000_message_send_attempt_child_fingerprint_key
-- Phase: n/a — standalone defense-in-depth follow-up to PR #644 (multi-photo MMS split)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   When a technician sends several photos at once through CallRail, we have to
--   break them into one text message per photo. We write down a row for each
--   photo before we send it, so that if the same request somehow runs twice we
--   notice and don't text the customer the same photo again.
--
--   Right now that "have we already done this one?" check is done by looking
--   first and writing second. That works today only because the whole batch is
--   funnelled through a single earlier lock. This adds a real rule in the
--   database itself: under one batch, the same photo-part can only ever be
--   written down once. Nothing changes about what customers receive — this is a
--   seatbelt for a road we are not currently driving off.
--
-- WHY NOW:
--   functions/lib/messaging-attempts.js `claimChildMessageAttempt` claims each
--   split part with a check-then-insert on (parent_attempt_id,
--   request_fingerprint) and has NO database-level compare-and-swap covering it.
--   Today two executions of the split loop cannot coexist, because:
--     1. the parent claim takes the unique `message_send_attempts_client_request_id_key`
--        index, and
--     2. functions/api/send-message.js refuses a multi-photo send that omits
--        client_request_id (400 CLIENT_REQUEST_ID_REQUIRED) — a NULL does not
--        collide in a unique index, so an optional id would let two concurrent
--        POSTs each run the whole loop.
--   Those two facts are the ONLY guard. A future refactor that decouples the
--   split from the parent claim, or relaxes the client_request_id requirement,
--   silently removes it and the failure is duplicate real MMS to a customer.
--   This migration makes the invariant the database's own.
--
-- ⚠ THE PREDICATE IS NARROWER THAN THE OBVIOUS ONE — ON PURPOSE:
--   The naive index would be
--     (parent_attempt_id, request_fingerprint) WHERE parent_attempt_id IS NOT NULL.
--   That is WRONG and would break a live path. Two children under one parent CAN
--   legitimately share a fingerprint, in the group/broadcast loop
--   (send-message.js:1164). Traced 2026-08-14:
--     · `orderedRequest` hashes conversationId, actorEmployeeId, recipientAddress,
--       body, mediaUrls, provider, requestedChannel, partIndex.
--     · In the group loop every one of those is loop-invariant EXCEPT
--       recipientAddress; partIndex is undefined there and JSON.stringify drops
--       the key entirely.
--     · So a group child's fingerprint varies ONLY by participant.phone.
--     · public.conversation_participants is UNIQUE (conversation_id, contact_id)
--       but has NO uniqueness on `phone` — only the plain idx_participants_phone.
--       Two DISTINCT contacts in one conversation may carry the same number, and
--       a CRM with duplicate contact records is the normal way that happens.
--     · Their two children would then hash identically.
--   And the failure would not be graceful: `claimChildMessageAttempt`'s
--   catch-path re-select for the group branch filters on
--   recipient_contact_id=eq.<B>, which never matches contact A's winning row, so
--   `winner` is undefined and it rethrows — 500 on the whole POST. A
--   duplicate-phone group send would go from "delivers (twice to one number)" to
--   "hard failure". That is a regression, not a hardening.
--
--   So the predicate here adds `AND recipient_contact_id IS NULL`, making this
--   index EXACTLY COMPLEMENTARY to the existing
--   message_send_attempts_parent_recipient_key, which covers
--   `... AND recipient_contact_id IS NOT NULL`. Together the two partial indexes
--   cover every child row exactly once — no overlap, no gap:
--     · split children  → recipient_contact_id NULL by design
--       (send-message.js:968, and the code comment there requires it) → this index.
--     · group children  → recipient_contact_id = participant.contact_id, which is
--       NOT NULL in conversation_participants → the existing index.
--   `claimChildMessageAttempt` is the ONLY producer of child rows. Verified by
--   grep across supabase/, functions/, src/ and tests/: the sole other INSERT
--   into this table (20260731220000 line 1079, scheduled delivery) sets no
--   parent_attempt_id and is a root reservation, not a child.
--
-- ADDITIVE-ONLY:
--   Creates ONE partial unique index. No table, column, policy, trigger, grant,
--   function or row is created, altered or dropped. No data changes. Every
--   existing index — including message_send_attempts_parent_recipient_key — is
--   left exactly as it is. No frontend contract is touched (this table is
--   service-role-only; REVOKE ALL ... FROM PUBLIC, anon, authenticated has been
--   in force since the 20260723215926 foundation).
--
-- WHY NOT CONCURRENTLY / NOT VALID (database-standard.md §5):
--   Neither is available here, and pretending otherwise would be the bug:
--     · CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and
--       §5 requires governed migration files to rely on the Supabase executor's
--       transaction (which wraps the SQL and its schema_migrations ledger write).
--       Adding top-level BEGIN/COMMIT to opt out is explicitly forbidden.
--     · ALTER TABLE ... ADD CONSTRAINT ... UNIQUE ... NOT VALID does not exist in
--       Postgres — NOT VALID applies to CHECK and FOREIGN KEY constraints only.
--   So this is a plain partial CREATE UNIQUE INDEX, and the lock cost must be
--   stated precisely rather than waved past:
--     · It takes a table-level SHARE lock on ALL of message_send_attempts for the
--       build. That blocks every writer to the table — group children and root
--       scheduled-delivery reservations included — NOT just the split children
--       the predicate covers. Partiality bounds how long the build takes; it does
--       not narrow what the lock blocks.
--     · `SET LOCAL lock_timeout` below bounds how long this migration WAITS to
--       acquire that lock (failing closed and rolling back cleanly if it cannot).
--       It does NOT bound how long the lock is HELD once acquired.
--   The window is expected to be very short — the qualifying set has only existed
--   since PR #644 landed days ago, and the writers here are short service-role
--   worker transactions — but that is reasoning, not measurement: this session had
--   no live catalog access. APPLY-WINDOW PREREQUISITE: read the actual
--   message_send_attempts row count read-only before scheduling, and apply in a
--   low-traffic window per §5, rather than trusting the estimate above.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.message_send_attempts_parent_fingerprint_key;
--   Shipped as supabase/rollbacks/20260814190000_message_send_attempt_child_fingerprint_key.rollback.sql
--   (database-standard.md §6). Dropping it restores exactly today's posture: the
--   split loop falls back to being guarded solely by the parent claim's unique
--   client_request_id index plus the CLIENT_REQUEST_ID_REQUIRED refusal.
-- ════════════════════════════════════════════════

-- Fail fast instead of queueing behind a long-running transaction. If this
-- fires, the whole migration (and its ledger row) rolls back untouched and the
-- apply can simply be retried in a quieter window.
SET LOCAL lock_timeout = '5s';

-- ─── PREFLIGHT ───────────────────────────────────────────────────────────────
-- This session could not query the shared project (no read-only catalog access
-- was available while authoring), so the "no existing row violates this" check
-- is NOT a claim made here — it is enforced mechanically, at apply time, by the
-- guard below. If any duplicate already exists the migration aborts with
-- SQLSTATE 55000, changes nothing, and names what it found.
--
-- A duplicate here is not a schema nuisance: it would mean one split part was
-- already written down twice under one parent, i.e. the exact double-send this
-- index exists to prevent may already have happened. Investigate the offending
-- parent before retrying; do not "fix" it by widening or dropping the predicate.
DO $guard$
DECLARE
  v_groups bigint := 0;
  v_rows   bigint := 0;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO v_groups, v_rows
  FROM (
    SELECT count(*) AS n
    FROM public.message_send_attempts
    WHERE parent_attempt_id IS NOT NULL
      AND recipient_contact_id IS NULL
    GROUP BY parent_attempt_id, request_fingerprint
    HAVING count(*) > 1
  ) d;

  IF v_groups > 0 THEN
    RAISE EXCEPTION
      'message_send_attempts already holds % duplicate (parent_attempt_id, request_fingerprint) group(s) across % child row(s); refusing to create message_send_attempts_parent_fingerprint_key. Each duplicate means one split part was claimed twice under one parent — investigate whether a customer received a repeated MMS before retrying.',
      v_groups, v_rows
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

-- ─── FORWARD ─────────────────────────────────────────────────────────────────
-- The atomic compare-and-swap `claimChildMessageAttempt` currently lacks for a
-- split part. Complementary to message_send_attempts_parent_recipient_key: that
-- one owns children WITH a contact, this one owns children WITHOUT.
CREATE UNIQUE INDEX message_send_attempts_parent_fingerprint_key
  ON public.message_send_attempts (parent_attempt_id, request_fingerprint)
  WHERE parent_attempt_id IS NOT NULL AND recipient_contact_id IS NULL;

COMMENT ON INDEX public.message_send_attempts_parent_fingerprint_key IS
  'Atomic per-part claim for contact-less child attempts (the multi-photo MMS split). Complements message_send_attempts_parent_recipient_key, which covers children carrying a recipient_contact_id; between them every child row under a parent has exactly one database-level uniqueness guard. Deliberately excludes contact-bearing children: group/broadcast fingerprints vary only by recipient phone, and two distinct contacts in one conversation may share a number.';

-- ─── POSTCONDITIONS ──────────────────────────────────────────────────────────
-- Assert what was actually created, in the same transaction, so a silent
-- partial apply cannot be reported as success.
DO $post$
DECLARE
  v_is_unique  boolean;
  v_predicate  text;
  v_cols       text;
  v_sibling    boolean;
BEGIN
  SELECT i.indisunique,
         pg_get_expr(i.indpred, i.indrelid),
         pg_get_indexdef(i.indexrelid)
    INTO v_is_unique, v_predicate, v_cols
  FROM pg_index i
  WHERE i.indexrelid = 'public.message_send_attempts_parent_fingerprint_key'::regclass;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'postcondition failed: index was not created' USING ERRCODE = '55000';
  END IF;
  IF NOT v_is_unique THEN
    RAISE EXCEPTION 'postcondition failed: index is not UNIQUE' USING ERRCODE = '55000';
  END IF;
  IF v_predicate IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: index is not partial — it would wrongly cover group children' USING ERRCODE = '55000';
  END IF;
  IF v_predicate !~ 'recipient_contact_id IS NULL' THEN
    RAISE EXCEPTION
      'postcondition failed: predicate does not exclude contact-bearing children (got: %)', v_predicate
      USING ERRCODE = '55000';
  END IF;
  IF v_cols !~ 'parent_attempt_id' OR v_cols !~ 'request_fingerprint' THEN
    RAISE EXCEPTION 'postcondition failed: unexpected index columns (got: %)', v_cols USING ERRCODE = '55000';
  END IF;

  -- The pre-existing per-contact index must survive untouched; this migration
  -- complements it and must never be mistaken for a replacement.
  SELECT true INTO v_sibling
  FROM pg_index i
  WHERE i.indexrelid = 'public.message_send_attempts_parent_recipient_key'::regclass
    AND i.indisunique;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'postcondition failed: message_send_attempts_parent_recipient_key is missing or no longer unique'
      USING ERRCODE = '55000';
  END IF;
END;
$post$;
