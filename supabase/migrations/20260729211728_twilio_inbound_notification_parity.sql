-- ════════════════════════════════════════════════
-- MIGRATION: 20260729211728_twilio_inbound_notification_parity
-- Phase: Messaging Transport Phase 6
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds the inactive, service-only atomic projection used by the signed Twilio
--   inbound Worker. One transaction serializes by customer phone, applies
--   STOP/START/HELP consent state, writes at most one canonical SMS/MMS,
--   increments unread at most once, and enqueues at most one notification
--   occurrence in the existing provider-neutral outbox.
--
-- ADDITIVE-ONLY:
--   Adds one service-only function; no table/data/policy/trigger change and no
--   DROP/RENAME/ALTER COLUMN.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run the paired rollback after compatible Worker code is rolled back. It
--   drops only this new function and retains event/message/outbox history.
-- ════════════════════════════════════════════════
--
-- DEPENDS ON:
--   20260723215926_messaging_transport_foundation.sql
--   20260725173000_fix_callrail_keyword_consent_ambiguity.sql
--
-- NOTES / GOTCHAS:
--   - This does not activate Twilio, change provider bindings, or send traffic.
--   - The deployed project_callrail_inbound_event signature/body is untouched.
--   - Twilio MessageSid remains in messages.twilio_sid and also occupies the
--     generic provider/provider_message_id identity.
--   - MMS projection accepts only UPR-owned private Storage references.
--
-- ROLLBACK FILE:
--   supabase/rollbacks/
--   20260729211728_twilio_inbound_notification_parity.rollback.sql
--   drops only this new function. Existing messages/events/outbox history stays.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.project_twilio_inbound_event(
  p_event_id uuid,
  p_consent_only boolean DEFAULT false
)
RETURNS TABLE (
  outcome text,
  message_id uuid,
  conversation_id uuid,
  contact_id uuid,
  inserted boolean,
  requires_staff_reply boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_event public.message_provider_events%ROWTYPE;
  v_contact public.contacts%ROWTYPE;
  v_phone_digits text;
  v_phone_key text;
  v_keyword text;
  v_should_persist boolean;
  v_start_stale boolean := false;
  v_conversation_id uuid;
  v_conversation_contact_id uuid;
  v_assigned_to uuid;
  v_message_id uuid;
  v_inserted boolean := false;
  v_outcome text;
  v_now timestamptz := now();
  v_media_urls jsonb := '[]'::jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'project_twilio_inbound_event is service-role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_event
  FROM public.message_provider_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Twilio provider event % was not found', p_event_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_event.processing_state = 'processed' THEN
    RETURN QUERY
    SELECT
      COALESCE(v_event.outcome, 'inbound_already_processed'),
      v_event.message_id,
      v_event.conversation_id,
      v_event.contact_id,
      false,
      v_event.outcome = 'inbound_help';
    RETURN;
  END IF;

  IF v_event.provider <> 'twilio'
     OR v_event.direction <> 'inbound'
     OR v_event.provider_message_id IS NULL
     OR v_event.sender_address IS NULL
     OR v_event.recipient_address IS NULL
     OR v_event.occurred_at IS NULL
     OR v_event.message_type NOT IN ('sms', 'mms') THEN
    RAISE EXCEPTION 'Stored event is not a complete Twilio inbound text event'
      USING ERRCODE = '22023';
  END IF;

  v_phone_digits := regexp_replace(v_event.sender_address, '[^0-9]', '', 'g');
  v_phone_key := right(v_phone_digits, 10);
  IF length(v_phone_key) <> 10 THEN
    RAISE EXCEPTION 'Twilio inbound sender is not a supported NANP address'
      USING ERRCODE = '22023';
  END IF;

  v_keyword := CASE
    WHEN regexp_replace(lower(trim(COALESCE(v_event.content, ''))), '[^a-z0-9]', '', 'g')
      = ANY (ARRAY['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])
      THEN 'stop'
    WHEN regexp_replace(lower(trim(COALESCE(v_event.content, ''))), '[^a-z0-9]', '', 'g')
      = ANY (ARRAY['start', 'unstop', 'subscribe', 'yes'])
      THEN 'start'
    WHEN regexp_replace(lower(trim(COALESCE(v_event.content, ''))), '[^a-z0-9]', '', 'g')
      = ANY (ARRAY['help', 'info'])
      THEN 'help'
    ELSE NULL
  END;

  -- This is the same advisory-lock namespace used by CallRail inbound and the
  -- service-consent RPCs, so late events from either provider cannot race one
  -- customer into competing contacts/conversations or reordered consent state.
  PERFORM pg_advisory_xact_lock(hashtextextended('messaging-phone:' || v_phone_key, 0));

  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.contacts (
      phone,
      name,
      opt_in_status,
      opt_in_source,
      opt_in_at,
      opt_out_at,
      opt_out_reason,
      dnd,
      dnd_at,
      created_at,
      updated_at
    )
    VALUES (
      v_event.sender_address,
      NULL,
      v_keyword IN ('start') OR v_keyword IS NULL,
      CASE
        WHEN v_keyword = 'start' THEN 'start_keyword'
        WHEN v_keyword IS NULL THEN 'inbound_sms'
        ELSE NULL
      END,
      CASE WHEN v_keyword IN ('start') OR v_keyword IS NULL
        THEN v_event.occurred_at
        ELSE NULL
      END,
      CASE WHEN v_keyword = 'stop' THEN v_event.occurred_at ELSE NULL END,
      CASE WHEN v_keyword = 'stop' THEN 'stop_keyword' ELSE NULL END,
      COALESCE(v_keyword = 'stop', false),
      CASE WHEN v_keyword = 'stop' THEN v_event.occurred_at ELSE NULL END,
      v_now,
      v_now
    )
    RETURNING * INTO v_contact;

    IF v_keyword IS NULL THEN
      INSERT INTO public.sms_consent_log (
        contact_id,
        phone,
        event_type,
        source,
        details,
        provider_event_id
      )
      VALUES (
        v_contact.id,
        v_event.sender_address,
        'opt_in',
        'inbound_sms',
        'Implied consent: contact initiated conversation via SMS.',
        v_event.id
      )
      ON CONFLICT (provider_event_id, contact_id, event_type)
        WHERE provider_event_id IS NOT NULL
        DO NOTHING;
    END IF;
  END IF;

  IF v_keyword = 'stop' THEN
    UPDATE public.contacts c
    SET
      opt_in_status = false,
      opt_out_at = v_event.occurred_at,
      opt_out_reason = 'stop_keyword',
      dnd = true,
      dnd_at = v_event.occurred_at,
      updated_at = v_now
    WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key;
  ELSIF v_keyword = 'start' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.contacts c
      WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
        AND c.opt_out_at IS NOT NULL
        AND c.opt_out_at >= v_event.occurred_at
    ) OR EXISTS (
      SELECT 1
      FROM public.sms_consent_log scl
      JOIN public.message_provider_events stop_event
        ON stop_event.id = scl.provider_event_id
      JOIN public.contacts c
        ON c.id = scl.contact_id
      WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
        AND scl.event_type = 'stop_keyword'
        AND stop_event.occurred_at >= v_event.occurred_at
    )
    INTO v_start_stale;

    IF NOT v_start_stale THEN
      UPDATE public.contacts c
      SET
        opt_in_status = true,
        opt_in_source = 'start_keyword',
        opt_in_at = v_event.occurred_at,
        opt_out_at = NULL,
        opt_out_reason = NULL,
        dnd = false,
        dnd_at = v_event.occurred_at,
        updated_at = v_now
      WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key;
    END IF;
  END IF;

  IF v_keyword IS NOT NULL THEN
    INSERT INTO public.sms_consent_log (
      contact_id,
      phone,
      event_type,
      source,
      details,
      provider_event_id
    )
    SELECT
      c.id,
      COALESCE(c.phone, v_event.sender_address),
      CASE v_keyword
        WHEN 'stop' THEN 'stop_keyword'
        WHEN 'start' THEN 'start_keyword'
        ELSE 'help_request'
      END,
      'keyword',
      CASE
        WHEN v_keyword = 'stop'
          THEN 'Contact texted "' || trim(COALESCE(v_event.content, '')) ||
            '". Opted out and DND enabled.'
        WHEN v_keyword = 'start' AND v_start_stale
          THEN 'Contact texted "' || trim(COALESCE(v_event.content, '')) ||
            '". Re-subscribe suppressed because a newer STOP exists.'
        WHEN v_keyword = 'start'
          THEN 'Contact texted "' || trim(COALESCE(v_event.content, '')) ||
            '". Re-subscribed and DND disabled.'
        ELSE 'Contact texted "' || trim(COALESCE(v_event.content, '')) || '".'
      END,
      v_event.id
    FROM public.contacts c
    WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
      AND (v_keyword <> 'help' OR c.id = v_contact.id)
    ON CONFLICT (provider_event_id, contact_id, event_type)
      WHERE provider_event_id IS NOT NULL
      DO NOTHING;
  END IF;

  IF p_consent_only THEN
    v_outcome := CASE
      WHEN v_keyword = 'stop' THEN 'inbound_stop'
      WHEN v_keyword = 'start' AND v_start_stale THEN 'inbound_start_stale'
      WHEN v_keyword = 'start' THEN 'inbound_start'
      WHEN v_keyword = 'help' THEN 'inbound_help'
      ELSE 'inbound_consent_not_applicable'
    END;
    RETURN QUERY
    SELECT v_outcome, NULL::uuid, NULL::uuid, v_contact.id, false, false;
    RETURN;
  END IF;

  IF v_event.message_type = 'mms' AND (
    jsonb_array_length(v_event.owned_media) = 0
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_event.owned_media) AS media(item)
      WHERE COALESCE(media.item->>'storageRef', '')
        !~ '^upr-storage://message-attachments/twilio/'
    )
  ) THEN
    RAISE EXCEPTION 'Twilio MMS must be copied to UPR-owned storage before projection'
      USING ERRCODE = '22023';
  END IF;

  -- Preserve the hardened shared keyword semantics: STOP and unambiguous START
  -- are consent-only; YES/INFO remain real content; HELP stays visible to staff.
  v_should_persist := v_keyword IS NULL
    OR regexp_replace(lower(trim(COALESCE(v_event.content, ''))), '[^a-z0-9]', '', 'g')
      IN ('yes', 'info')
    OR v_keyword = 'help';

  IF v_should_persist THEN
    SELECT c.id, contact_match.id
    INTO v_conversation_id, v_conversation_contact_id
    FROM public.conversations c
    JOIN public.conversation_participants cp
      ON cp.conversation_id = c.id
    JOIN public.contacts contact_match
      ON contact_match.id = cp.contact_id
    WHERE c.type = 'direct'
      AND cp.is_active = true
      AND right(
        regexp_replace(COALESCE(contact_match.phone, ''), '[^0-9]', '', 'g'),
        10
      ) = v_phone_key
    ORDER BY
      c.created_at ASC,
      c.id ASC,
      contact_match.created_at ASC,
      contact_match.id ASC
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.conversations (
        type,
        title,
        status,
        status_changed_at,
        twilio_number,
        created_at,
        updated_at
      )
      VALUES (
        'direct',
        COALESCE(v_contact.name, v_event.sender_address),
        'needs_response',
        v_now,
        v_event.recipient_address,
        v_now,
        v_now
      )
      RETURNING id INTO v_conversation_id;

      INSERT INTO public.conversation_participants (
        conversation_id,
        contact_id,
        phone,
        role,
        is_active
      )
      VALUES (
        v_conversation_id,
        v_contact.id,
        v_event.sender_address,
        'primary',
        true
      )
      ON CONFLICT (conversation_id, contact_id) DO NOTHING;
    ELSE
      SELECT c.*
      INTO v_contact
      FROM public.contacts c
      WHERE c.id = v_conversation_contact_id;
    END IF;

    IF v_event.message_type = 'mms' THEN
      SELECT COALESCE(jsonb_agg(media.item->>'storageRef'), '[]'::jsonb)
      INTO v_media_urls
      FROM jsonb_array_elements(v_event.owned_media) AS media(item);
    END IF;

    INSERT INTO public.messages (
      conversation_id,
      type,
      channel,
      body,
      status,
      twilio_sid,
      provider,
      provider_message_id,
      provider_conversation_id,
      sender_address,
      recipient_address,
      sender_phone,
      sender_contact_id,
      media_urls,
      direction,
      created_at
    )
    VALUES (
      v_conversation_id,
      'sms_inbound',
      v_event.message_type,
      NULLIF(trim(COALESCE(v_event.content, '')), ''),
      'received',
      v_event.provider_message_id,
      'twilio',
      v_event.provider_message_id,
      NULL,
      v_event.sender_address,
      v_event.recipient_address,
      v_event.sender_address,
      v_contact.id,
      CASE WHEN v_event.message_type = 'mms' THEN v_media_urls ELSE NULL END,
      'inbound',
      v_event.occurred_at
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_message_id;

    v_inserted := v_message_id IS NOT NULL;
    IF NOT v_inserted THEN
      SELECT m.id, m.conversation_id
      INTO v_message_id, v_conversation_id
      FROM public.messages m
      WHERE (
          m.provider = 'twilio'
          AND m.provider_message_id = v_event.provider_message_id
        )
        OR m.twilio_sid = v_event.provider_message_id
      ORDER BY (m.provider = 'twilio') DESC, m.created_at ASC, m.id ASC
      LIMIT 1;
      IF v_message_id IS NULL THEN
        RAISE EXCEPTION
          'Twilio MessageSid conflict did not resolve to a canonical message'
          USING ERRCODE = '23505';
      END IF;
    ELSE
      UPDATE public.conversations c
      SET
        unread_count = c.unread_count + 1,
        status = 'needs_response',
        status_changed_at = v_now,
        last_message_at = CASE
          WHEN c.last_message_at IS NULL OR v_event.occurred_at >= c.last_message_at
            THEN v_event.occurred_at
          ELSE c.last_message_at
        END,
        last_message_preview = CASE
          WHEN c.last_message_at IS NULL OR v_event.occurred_at >= c.last_message_at
            THEN left(COALESCE(NULLIF(trim(v_event.content), ''), '[Media]'), 100)
          ELSE c.last_message_preview
        END,
        updated_at = v_now
      WHERE c.id = v_conversation_id;
    END IF;
  END IF;

  v_outcome := CASE
    WHEN v_keyword = 'stop' THEN 'inbound_stop'
    WHEN v_keyword = 'start' AND v_start_stale THEN 'inbound_start_stale'
    WHEN v_keyword = 'start' THEN 'inbound_start'
    WHEN v_keyword = 'help' THEN 'inbound_help'
    ELSE 'inbound_persisted'
  END;

  IF v_inserted AND v_message_id IS NOT NULL THEN
    SELECT c.assigned_to
    INTO v_assigned_to
    FROM public.conversations c
    WHERE c.id = v_conversation_id;

    INSERT INTO public.message_notification_outbox (
      provider_event_id,
      message_id,
      conversation_id,
      contact_id,
      type_key,
      payload
    )
    VALUES (
      v_event.id,
      v_message_id,
      v_conversation_id,
      v_contact.id,
      'message.inbound',
      jsonb_strip_nulls(jsonb_build_object(
        'title', 'New text from ' || COALESCE(
          NULLIF(trim(v_contact.name), ''),
          v_event.sender_address
        ),
        'body', COALESCE(
          NULLIF(left(trim(COALESCE(v_event.content, '')), 140), ''),
          '[Media]'
        ),
        'link', '/conversations',
        'entity_type', 'conversation',
        'entity_id', v_conversation_id,
        'recipient_ids', CASE WHEN v_assigned_to IS NOT NULL
          THEN jsonb_build_array(v_assigned_to) ELSE NULL END,
        'data', jsonb_build_object(
          'conversation_id', v_conversation_id,
          'route', '/conversations'
        )
      ))
    )
    ON CONFLICT (provider_event_id) DO NOTHING;
  END IF;

  UPDATE public.message_provider_events
  SET
    processing_state = 'processed',
    processed_at = v_now,
    message_id = v_message_id,
    contact_id = v_contact.id,
    conversation_id = v_conversation_id,
    outcome = v_outcome,
    error_code = NULL,
    error_message = NULL,
    next_attempt_at = NULL,
    claimed_at = NULL,
    updated_at = v_now
  WHERE id = v_event.id;

  RETURN QUERY
  SELECT
    v_outcome,
    v_message_id,
    v_conversation_id,
    v_contact.id,
    v_inserted,
    v_keyword = 'help';
END;
$$;

REVOKE ALL ON FUNCTION public.project_twilio_inbound_event(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_twilio_inbound_event(uuid, boolean)
  TO service_role;

COMMENT ON FUNCTION public.project_twilio_inbound_event(uuid, boolean) IS
  'Service-role-only atomic Twilio inbound projection: per-phone consent/conversation serialization, MessageSid idempotency, unread update, and one durable notification-outbox occurrence.';
