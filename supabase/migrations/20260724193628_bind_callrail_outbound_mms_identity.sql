-- ════════════════════════════════════════════════
-- MIGRATION: 20260724193628_bind_callrail_outbound_mms_identity
-- Phase: CallRail production-readiness remediation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Keeps the existing CallRail sent-event confirmation contract, but refuses
--   to confirm a text as an image message or an image message without its
--   already-stored private UPR attachment. This prevents a provider event from
--   being attached to the wrong kind of send attempt.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Function-body replacement only; no table, column, policy, grant, or data change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260724193628_bind_callrail_outbound_mms_identity.rollback.sql
--   to restore the exact prior phone-normalizing function body and grants.
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
  v_existing_message public.messages%ROWTYPE;
  v_materialized record;
  v_message_id uuid;
  v_now timestamptz := now();
  v_attempt_digits text;
  v_event_digits text;
  v_recipient_matches boolean;
  v_media_prefix constant text := 'upr-storage://message-attachments/outbound/';
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
     OR v_event.provider_message_id IS NULL
     OR v_event.message_type NOT IN ('sms', 'mms') THEN
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
    SELECT m.*
    INTO v_existing_message
    FROM public.messages m
    WHERE m.provider = 'callrail'
      AND m.provider_message_id = v_event.provider_message_id
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'outbound_unmatched'::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;

    IF v_existing_message.channel IS DISTINCT FROM v_event.message_type THEN
      RETURN QUERY SELECT
        'outbound_unmatched'::text,
        v_existing_message.id,
        NULL::uuid;
      RETURN;
    END IF;

    IF v_event.message_type = 'mms'
       AND (
         jsonb_typeof(COALESCE(v_existing_message.media_urls, '[]'::jsonb)) <> 'array'
         OR jsonb_array_length(COALESCE(v_existing_message.media_urls, '[]'::jsonb)) = 0
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             COALESCE(v_existing_message.media_urls, '[]'::jsonb)
           ) AS media(item)
           WHERE jsonb_typeof(media.item) <> 'string'
              OR (media.item #>> '{}') NOT LIKE v_media_prefix || '%'
              OR (media.item #>> '{}') = v_media_prefix
              OR substring((media.item #>> '{}') FROM length(v_media_prefix) + 1) LIKE '%..%'
              OR position(E'\\' IN (media.item #>> '{}')) > 0
         )
      ) THEN
      RETURN QUERY SELECT
        'outbound_unmatched'::text,
        v_existing_message.id,
        NULL::uuid;
      RETURN;
    END IF;

    v_message_id := v_existing_message.id;
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

    IF v_attempt.requested_channel IS DISTINCT FROM v_event.message_type THEN
      RETURN QUERY SELECT
        'outbound_unmatched'::text,
        v_attempt.message_id,
        v_attempt.id;
      RETURN;
    END IF;

    IF v_event.message_type = 'mms'
       AND (
         jsonb_typeof(COALESCE(v_attempt.media_urls, '[]'::jsonb)) <> 'array'
         OR jsonb_array_length(COALESCE(v_attempt.media_urls, '[]'::jsonb)) = 0
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(COALESCE(v_attempt.media_urls, '[]'::jsonb))
             AS media(item)
           WHERE jsonb_typeof(media.item) <> 'string'
              OR (media.item #>> '{}') NOT LIKE v_media_prefix || '%'
              OR (media.item #>> '{}') = v_media_prefix
              OR substring((media.item #>> '{}') FROM length(v_media_prefix) + 1) LIKE '%..%'
              OR position(E'\\' IN (media.item #>> '{}')) > 0
         )
      ) THEN
      RETURN QUERY SELECT
        'outbound_unmatched'::text,
        v_attempt.message_id,
        v_attempt.id;
      RETURN;
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
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.project_callrail_outbound_event(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.project_callrail_outbound_event(uuid, uuid) IS
  'Service-role-only projection of one CallRail message.sent event; channel identity and private outbound MMS ownership must match before confirmation.';
