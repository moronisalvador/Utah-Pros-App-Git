-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726230000_rearm_callrail_provider_event
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the retry operation. After this, a failed picture message is once
--   again permanently stuck with no way to try it again.
--
--   Nothing else is affected. Any message already recovered stays recovered —
--   re-processing is idempotent through dedupe_key, so there is no half-finished
--   state to unwind.
--
-- SAFETY:
--   Drops one function that no deployed code path depends on for normal
--   operation. Inbound and outbound messaging do not call it; only a deliberate
--   human-initiated recovery does.
-- ════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.rearm_callrail_provider_event(uuid, text, timestamptz);
