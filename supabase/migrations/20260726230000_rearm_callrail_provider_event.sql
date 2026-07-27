-- ════════════════════════════════════════════════
-- MIGRATION: 20260726230000_rearm_callrail_provider_event
-- Phase: Messaging recovery — backlog item 1.2
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Gives us a way to retry a picture message that failed to download.
--
--   Today, when the system cannot fetch the image from a text message, the
--   record is marked "failed" and that is the end of it — permanently. Nothing
--   in the entire codebase can put it back in the queue. If a real customer
--   sends a photo of water damage and the fetch hiccups, that photo is gone and
--   nobody can do anything about it.
--
--   This adds one narrowly-scoped operation that can move a single failed
--   record back to "waiting to be processed", so the existing recovery worker
--   picks it up and tries again.
--
-- WHAT IT IS *NOT*:
--   It is not a "reset everything" button. Each call must name one exact record
--   AND the exact error it is expected to be sitting in. If either does not
--   match, nothing happens and the caller is told nothing happened. It cannot
--   touch a record that is mid-flight, belongs to another provider, or is not a
--   text/picture message.
--
-- ADDITIVE-ONLY:
--   Yes. One new function. No table, column, index, policy or existing function
--   is changed. No data is modified by this migration itself — the recovery runs
--   are separate, deliberate calls made one at a time after review.
--
-- WHY 'received' AND NOT 'retryable':
--   The deployed scheduler wakes the recovery worker when an event is received,
--   due for retry, or stale-claimed. 'received' puts the row in the plain
--   front-of-queue state with a clean attempt count, which is what a human-
--   initiated retry means. 'retryable' would depend on next_attempt_at timing.
--
-- WHY error_code AND error_message ARE PRESERVED:
--   They are the audit trail of why it failed the first time. A retry that
--   erased its own history would make a repeat failure impossible to diagnose.
--
-- PRECEDENT FOLLOWED (verified live, not invented):
--   claim_callrail_provider_event — SECURITY INVOKER (not definer, per
--   database-standard.md §1's preference), `SET search_path TO ''` with fully
--   qualified names, and an in-body auth.role() service-role assertion. This
--   function mirrors that shape exactly.
--
-- CONTEXT ON THE FIVE ROWS THIS UNBLOCKS (verified live, 2026-07-26):
--   All five failed events are from 2026-07-24 between 385-314-5700 (the owner's
--   own contact record) and 385-360-4121 (the UPR CallRail number) — i.e. the
--   owner's own test messages from building the MMS integration, which the owner
--   confirmed on 2026-07-26 are validated-and-working test failures, not customer
--   data. That makes them an ideal rehearsal: the capability being added here is
--   the real deliverable, and a mistake during the drain costs nothing.
--   The media may already be gone from the provider's storage; a failed recovery
--   returns a clean error rather than corrupting anything.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726230000_rearm_callrail_provider_event.rollback.sql
--   (drops the function). Re-processing is idempotent via dedupe_key, so any
--   recovery already performed needs no data undo.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rearm_callrail_provider_event(
  p_event_id uuid,
  p_expect_error_code text,
  p_now timestamptz DEFAULT now()
)
RETURNS SETOF message_provider_events
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'rearm_callrail_provider_event is service-role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_expect_error_code IS NULL OR btrim(p_expect_error_code) = '' THEN
    RAISE EXCEPTION 'rearm_callrail_provider_event requires the expected error_code'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.message_provider_events AS event
  SET
    processing_state    = 'received',
    processing_attempts = 0,
    next_attempt_at     = NULL,
    claimed_at          = NULL,
    updated_at          = p_now
  WHERE event.id = p_event_id
    AND event.provider = 'callrail'
    AND event.message_type IN ('sms', 'mms')
    AND event.processing_state = 'failed'
    AND event.error_code = p_expect_error_code
  RETURNING event.*;
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): EXECUTE TO PUBLIC is
-- re-applied to every new function, so revoke explicitly before granting.
-- No browser role is granted: this is a Worker-side recovery operation.
REVOKE EXECUTE ON FUNCTION public.rearm_callrail_provider_event(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rearm_callrail_provider_event(uuid, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.rearm_callrail_provider_event(uuid, text, timestamptz) IS
  'Service-role only. Moves ONE terminally-failed CallRail sms/mms event back to '
  'received so the recovery worker retries it. Requires the exact event id AND its '
  'current error_code, so it cannot be used to bulk-reset failures. Preserves '
  'error_code/error_message as the audit trail. Returns only the row it changed.';
