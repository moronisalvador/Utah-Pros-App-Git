-- ════════════════════════════════════════════════
-- FILE: 20260724193628_bind_callrail_outbound_mms_identity.rollback.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Restores the exact prior CallRail sent-event confirmation function.
--   It removes the channel/private-media guard and changes no stored rows.
--
-- DEPENDS ON:
--   Internal: public.project_callrail_outbound_event(uuid, uuid)
--   Data:     reads  → messages, message_send_attempts, message_provider_events
--             writes → messages, message_send_attempts, message_provider_events
--
-- NOTES / GOTCHAS:
--   - Use only if the new guard itself prevents valid event recovery.
--   - The function body below matches migration 20260724174000 exactly.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.project_callrail_outbound_event(
  p_event_id uuid,
  p_attempt_id uuid DEFAULT NULL
)
RETURNS TABLE (
  outcome text,
  message_id uuid,
  send_attempt_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.message_provider_events%ROWTYPE;
  v_attempt public.message_send_attempts%ROWTYPE;
  v_materialized record;
  v_message_id uuid;
  v_now timestamptz := now();
  v_attempt_digits text;
  v_event_digits text;
  v_recipient_matches boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'project_callrail_outbound_event is service-role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_event
  FROM public.message_provider_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_event.provider <> 'callrail'
     OR v_event.direction <> 'outbound'
     OR v_event.event_type <> 'message.sent'
     OR v_event.provider_message_id IS NULL THEN
    RAISE EXCEPTION 'CallRail outbound event identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_event.processing_state = 'processed' THEN
    RETURN QUERY SELECT
      'outbound_already_projected'::text,
      v_event.message_id,
      v_event.send_attempt_id;
    RETURN;
  END IF;

  IF p_attempt_id IS NULL THEN
    SELECT m.id
    INTO v_message_id
    FROM public.messages m
    WHERE m.provider = 'callrail'
      AND m.provider_message_id = v_event.provider_message_id
    LIMIT 1
    FOR UPDATE;

    IF v_message_id IS NULL THEN
      RETURN QUERY SELECT 'outbound_unmatched'::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
  ELSE
    SELECT *
    INTO v_attempt
    FROM public.message_send_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CallRail outbound event conflicts with its send attempt'
        USING ERRCODE = '22023';
    END IF;

    v_attempt_digits := regexp_replace(
      COALESCE(v_attempt.recipient_address, ''),
      '[^0-9]',
      '',
      'g'
    );
    v_event_digits := regexp_replace(
      COALESCE(v_event.recipient_address, ''),
      '[^0-9]',
      '',
      'g'
    );
    v_recipient_matches :=
      v_attempt.recipient_address IS NOT DISTINCT FROM v_event.recipient_address
      OR (
        (
          v_attempt_digits ~ '^[2-9][0-9]{9}$'
          OR v_attempt_digits ~ '^1[2-9][0-9]{9}$'
        )
        AND (
          v_event_digits ~ '^[2-9][0-9]{9}$'
          OR v_event_digits ~ '^1[2-9][0-9]{9}$'
        )
        AND right(v_attempt_digits, 10) = right(v_event_digits, 10)
      );

    IF v_attempt.provider <> 'callrail'
       OR v_attempt.state NOT IN ('accepted', 'ambiguous', 'confirmed')
       OR NOT v_recipient_matches
       OR v_attempt.submitted_body IS DISTINCT FROM v_event.content
       OR (
         v_attempt.provider_message_id IS NOT NULL
         AND v_attempt.provider_message_id <> v_event.provider_message_id
       )
       OR (
         v_attempt.provider_conversation_id IS NOT NULL
         AND v_event.provider_conversation_id IS NOT NULL
         AND v_attempt.provider_conversation_id <> v_event.provider_conversation_id
       ) THEN
      RAISE EXCEPTION 'CallRail outbound event conflicts with its send attempt'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.message_send_attempts
    SET
      state = 'confirmed',
      provider_message_id = v_event.provider_message_id,
      provider_conversation_id = v_event.provider_conversation_id,
      provider_status = 'sent',
      actual_channel = requested_channel,
      completed_at = v_event.occurred_at,
      reconcile_after = NULL,
      error_code = NULL,
      error_message = NULL,
      updated_at = v_now
    WHERE id = v_attempt.id;

    SELECT *
    INTO v_materialized
    FROM public.materialize_message_send_attempt(v_attempt.id);
    v_message_id := v_materialized.message_id;
  END IF;

  UPDATE public.messages
  SET
    status = 'sent',
    provider_message_id = v_event.provider_message_id,
    provider_conversation_id = v_event.provider_conversation_id
  WHERE id = v_message_id
    AND provider = 'callrail';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical CallRail message was not found'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.message_provider_events
  SET
    processing_state = 'processed',
    processed_at = v_now,
    message_id = v_message_id,
    send_attempt_id = p_attempt_id,
    outcome = 'outbound_confirmed',
    error_code = NULL,
    error_message = NULL,
    updated_at = v_now
  WHERE id = v_event.id;

  RETURN QUERY
  SELECT 'outbound_confirmed'::text, v_message_id, p_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.project_callrail_outbound_event(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_callrail_outbound_event(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.project_callrail_outbound_event(uuid, uuid) IS
  'Service-role-only atomic, replay-safe projection of one retained CallRail message.sent event; NANP identity accepts CallRail 10-digit and UPR E.164 +1 forms.';
