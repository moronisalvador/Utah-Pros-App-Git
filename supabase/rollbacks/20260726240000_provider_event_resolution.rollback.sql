-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726240000_provider_event_resolution
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the ability to mark a failed message as "seen", and forgets any that
--   were already marked.
--
--   Consequence: alerts for those failures start again, every day, with no way
--   to acknowledge them. Noisy rather than dangerous — no message data is lost,
--   only the acknowledgement stamps.
--
--   The ops-health Worker keeps working either way: its probe falls back to the
--   unfiltered query when this column is absent, and reports that it is running
--   degraded.
--
-- ORDER MATTERS:
--   Function first, then the index, then the columns — the index predicate
--   references resolved_at.
-- ════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.resolve_provider_event(uuid, uuid, timestamptz);

DROP INDEX IF EXISTS public.message_provider_events_unresolved_failures_idx;

ALTER TABLE public.message_provider_events
  DROP COLUMN IF EXISTS resolved_by,
  DROP COLUMN IF EXISTS resolved_at;
