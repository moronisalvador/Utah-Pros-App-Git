-- ════════════════════════════════════════════════
-- MIGRATION: 20260726240000_provider_event_resolution
-- Phase: Ops alerting — backlog item 1.3
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Lets a person say "yes, I've seen this one" about a failed message, so the
--   daily alert about it stops.
--
--   Right now a failed message is a dead end. There is no way to mark it dealt
--   with, so the health check finds it again every single day and sends the same
--   alert forever. That is how people learn to ignore alerts — and then miss the
--   one that matters.
--
--   This adds a "resolved" stamp and a small server-side operation to set it.
--   Combined with the code change alongside it, the alert now covers only
--   failures nobody has acknowledged, and it gets LOUDER (not quieter) if an
--   unacknowledged backlog is left sitting for days.
--
-- ADDITIVE-ONLY:
--   Yes. Two nullable columns on an existing table and one new function. No
--   column is dropped, renamed or retyped. No policy or grant on the table
--   changes. No existing row is modified.
--
-- OWNER DECISION (2026-07-26):
--   Asked whether an unresolved data-loss backlog should nag forever (arguably
--   correct) or be human-acknowledged and silenced, the owner chose
--   acknowledge-and-silence WITH escalation. A silent backlog is the failure
--   mode this whole alerting effort exists to prevent, so the escalation is not
--   optional garnish — it is what makes silencing safe.
--
-- SEQUENCING (deliberately made a non-issue):
--   The Worker probe was written to try the unresolved-only query and fall back
--   to the unfiltered one if this column is not there yet, reporting that it ran
--   degraded. So the code and this migration can land in either order without a
--   window where the alert goes quiet. That matters because safeSelect() turns a
--   400 into "probe could not run", which would otherwise read as healthy.
--
-- WHY resolved_by IS NULLABLE AND UNCONSTRAINED:
--   The realistic resolver is a service-role Worker or a manual operation, not
--   always a logged-in employee. A NOT NULL or FK here would block the common
--   case; the audit value is in resolved_at plus the preserved error_code.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726240000_provider_event_resolution.rollback.sql
--   (drops the function and both columns). Dropping the columns discards any
--   acknowledgements recorded so far, which un-silences those alerts — noisy,
--   not destructive. The Worker's fallback path means it keeps working.
-- ════════════════════════════════════════════════

-- ─── 1. The acknowledgement stamp ───

ALTER TABLE public.message_provider_events
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;

COMMENT ON COLUMN public.message_provider_events.resolved_at IS
  'Set when a human or Worker has acknowledged a terminal failure. The ops-health '
  'check ignores resolved rows, which is what stops a permanent failure alerting '
  'every Denver day forever. NULL means still outstanding.';

-- Partial index: the probe asks exactly this question every 15 minutes, and the
-- unresolved set is tiny compared with the table. Index is on a NEW column only,
-- so it cannot conflict with an existing one (database-standard.md §3).
CREATE INDEX IF NOT EXISTS message_provider_events_unresolved_failures_idx
  ON public.message_provider_events (received_at DESC)
  WHERE processing_state = 'failed' AND resolved_at IS NULL;

-- ─── 2. The setter ───
-- Mirrors the shipped claim_callrail_provider_event shape: SECURITY INVOKER
-- (database-standard.md §1 preference), `SET search_path TO ''` with fully
-- qualified names, in-body service-role assertion.

CREATE OR REPLACE FUNCTION public.resolve_provider_event(
  p_event_id uuid,
  p_resolved_by uuid DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS SETOF message_provider_events
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'resolve_provider_event is service-role only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.message_provider_events AS event
  SET
    resolved_at = p_now,
    resolved_by = p_resolved_by,
    updated_at  = p_now
  WHERE event.id = p_event_id
    AND event.processing_state = 'failed'
    AND event.resolved_at IS NULL
  RETURNING event.*;
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): EXECUTE TO PUBLIC is
-- re-applied to every new function, so revoke explicitly before granting.
REVOKE EXECUTE ON FUNCTION public.resolve_provider_event(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_provider_event(uuid, uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.resolve_provider_event(uuid, uuid, timestamptz) IS
  'Service-role only. Marks ONE terminally-failed event acknowledged so ops-health '
  'stops alerting on it. Only touches processing_state=failed rows that are not '
  'already resolved, so it is idempotent and cannot silence an in-flight event. '
  'Returns only the row it changed.';
