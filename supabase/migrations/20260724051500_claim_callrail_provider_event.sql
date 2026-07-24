-- ════════════════════════════════════════════════
-- MIGRATION: 20260724051500_claim_callrail_provider_event
-- Phase: Messaging transport Phase 5 recovery correctness
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES:
--   Atomically claims one due CallRail provider event and returns the claimed
--   row to the recovery worker. This replaces a PostgREST PATCH claim whose
--   live response could be empty after the mutation had already succeeded,
--   leaving the event claimed but unprocessed.
--
-- SAFETY:
--   - exact event id and state/time fence;
--   - service-role-only caller and grant;
--   - SECURITY INVOKER with an empty search path;
--   - no provider send and no canonical message mutation.
--
-- ROLLBACK:
--   Revert the worker to its prior PATCH claim, then run
--   supabase/rollbacks/20260724051500_claim_callrail_provider_event.rollback.sql.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.claim_callrail_provider_event(
  p_event_id uuid,
  p_now timestamptz,
  p_stale_before timestamptz
)
RETURNS SETOF public.message_provider_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'claim_callrail_provider_event is service-role only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.message_provider_events AS event
  SET
    processing_state = 'claimed',
    processing_attempts = event.processing_attempts + 1,
    claimed_at = p_now,
    updated_at = p_now
  WHERE event.id = p_event_id
    AND event.provider = 'callrail'
    AND event.message_type IN ('sms', 'mms')
    AND (
      event.processing_state = 'received'
      OR (
        event.processing_state = 'retryable'
        AND event.next_attempt_at <= p_now
      )
      OR (
        event.processing_state = 'claimed'
        AND event.claimed_at < p_stale_before
      )
    )
  RETURNING event.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_callrail_provider_event(
  uuid,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_callrail_provider_event(
  uuid,
  timestamptz,
  timestamptz
) TO service_role;

COMMENT ON FUNCTION public.claim_callrail_provider_event(
  uuid,
  timestamptz,
  timestamptz
) IS
  'Service-only atomic claim fence for one due CallRail provider event.';
