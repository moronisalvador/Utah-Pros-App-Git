-- ════════════════════════════════════════════════
-- MIGRATION: 20260709_sms_f03_core_rpcs
-- Phase: SMS-Experience Wave 0 — F-core (Foundation)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Ships two small, safe database helpers that stop two real race-condition bugs
--   in the texting system:
--     1. claim_scheduled_message(id) — when the "send scheduled texts" job runs, two
--        copies can fire at the same moment and both grab the SAME queued text,
--        sending it twice. This helper lets a worker atomically "claim" a still-
--        pending scheduled message; exactly one caller wins (gets TRUE), the other
--        gets FALSE and backs off. Kills the double-send (finding F-11).
--     2. increment_conversation_unread(id, by) — the unread badge count was being
--        bumped with read-then-write code, so two messages arriving together could
--        lose a count. This helper adds to the counter in ONE atomic statement, so
--        concurrent bumps never clobber each other.
--
--   To back the claim, `scheduled_messages` gets one new optional column,
--   `claimed_at`. A claim stamps it; a still-pending row whose claim went stale
--   (worker crashed mid-send) becomes re-claimable after 10 minutes, so a crash
--   can never strand a message forever.
--
-- ADDITIVE-ONLY:
--   One new nullable column (scheduled_messages.claimed_at, no default/backfill) +
--   two new SECURITY DEFINER functions. No DROP/RENAME/ALTER COLUMN on a live
--   table; no change to the scheduled_messages status CHECK (the compare-and-set
--   uses claimed_at, NOT a new status value). Least-privilege grants: EXECUTE to
--   authenticated + service_role only — never anon (database-standard §1).
--
-- FROZEN CONTRACTS (sms-experience-wave-ownership §3 — consumers import, never redefine):
--   claim_scheduled_message(p_id uuid) → boolean
--   increment_conversation_unread(p_conversation_id uuid, p_by integer DEFAULT 1) → integer
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.increment_conversation_unread(uuid, integer);
--   DROP FUNCTION IF EXISTS public.claim_scheduled_message(uuid);
--   ALTER TABLE public.scheduled_messages DROP COLUMN IF EXISTS claimed_at;
-- ════════════════════════════════════════════════

-- Compare-and-set marker for the claim (additive, nullable).
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
COMMENT ON COLUMN public.scheduled_messages.claimed_at IS 'When a worker atomically claimed this pending row via claim_scheduled_message(). NULL = unclaimed. A still-pending row is re-claimable 10 min after a stale claim (crash recovery).';

-- ─── claim_scheduled_message ──────────────────────────────────────────────────
-- Atomic compare-and-set. Returns TRUE only to the single caller that flips an
-- unclaimed (or stale-claimed) still-pending row; every concurrent caller gets
-- FALSE. Correctness: the guard lives entirely in ONE UPDATE ... WHERE, so Postgres
-- row-locking serializes contenders and only the first re-evaluates the predicate
-- as true — no read-modify-write window.
CREATE OR REPLACE FUNCTION public.claim_scheduled_message(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claimed boolean;
BEGIN
  UPDATE public.scheduled_messages
     SET claimed_at = now()
   WHERE id = p_id
     AND status = 'pending'
     AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_scheduled_message(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_scheduled_message(uuid) TO authenticated, service_role;

-- ─── increment_conversation_unread ────────────────────────────────────────────
-- Atomic unread-badge counter. One UPDATE, so concurrent inbound messages never
-- lose a count. Clamped at 0 (a negative p_by can decrement without underflow).
-- Returns the new unread_count, or NULL if the conversation does not exist.
CREATE OR REPLACE FUNCTION public.increment_conversation_unread(p_conversation_id uuid, p_by integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new integer;
BEGIN
  UPDATE public.conversations
     SET unread_count = GREATEST(0, unread_count + COALESCE(p_by, 1))
   WHERE id = p_conversation_id
  RETURNING unread_count INTO v_new;
  RETURN v_new;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.increment_conversation_unread(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.increment_conversation_unread(uuid, integer) TO authenticated, service_role;
