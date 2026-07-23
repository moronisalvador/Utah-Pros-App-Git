-- ============================================================================
-- FILE: 20260723183330_messaging_transport_foundation.sql
-- ============================================================================
--
-- WHAT THIS DOES (plain language):
--   Adds provider-neutral identity to existing messages, creates a service-only
--   outbound-attempt ledger and provider-event inbox, and enforces the existing
--   rule that browser roles may read messages but only workers may write them.
--
-- DEPENDS ON:
--   Extensions: gen_random_uuid()
--   Tables: public.messages, public.conversations, public.contacts,
--           public.conversation_participants,
--           public.employees, public.employee_page_access,
--           public.feature_flags, public.nav_permissions,
--           public.sms_consent_log
--   Existing columns used by backfill/projection are enumerated in the
--   owner-run preflight at
--   docs/audit/2026-07/evidence/messaging-transport-2026-07-23.md.
--
-- DATA / SECURITY:
--   - Additive columns and tables only.
--   - New tables are RLS-enabled and service-role-only.
--   - No anon grant or policy is created.
--   - Existing message rows with twilio_sid are backfilled provider-neutrally.
--
-- APPLY GATE:
--   DO NOT APPLY outside the owner-approved shared-production window.
--   Deploy authorization/request-ID compatibility first. Apply and verify this
--   migration before deploying any worker that writes the new objects.
--
-- ROLLBACK:
--   Operational rollback disables provider sending and reverts consuming code.
--   Retain the additive schema, service-only ledgers, and worker-sole-writer
--   grants/policies. Do not restore anonymous/authenticated message writes.
-- ============================================================================

-- Abort instead of waiting behind normal production traffic. The owner apply
-- runbook must preflight row count, duplicate candidates, and active lock waits.
SET lock_timeout = '5s';
SET statement_timeout = '15min';

-- ─── 1. Generic identity on canonical messages ───────────────────────────────

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_conversation_id text,
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS sender_address text,
  ADD COLUMN IF NOT EXISTS recipient_address text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_provider_check'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_provider_check
      CHECK (provider IS NULL OR provider IN ('twilio', 'callrail')) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.messages
  VALIDATE CONSTRAINT messages_provider_check;

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_key
  ON public.messages (provider, provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_client_request_id_key
  ON public.messages (client_request_id)
  WHERE client_request_id IS NOT NULL;

UPDATE public.messages
SET
  provider = COALESCE(provider, 'twilio'),
  provider_message_id = COALESCE(provider_message_id, twilio_sid)
WHERE twilio_sid IS NOT NULL
  AND (provider IS NULL OR provider_message_id IS NULL);

COMMENT ON COLUMN public.messages.provider IS
  'Outbound/inbound transport that owns this message. Provider facts do not control consent or conversation identity.';
COMMENT ON COLUMN public.messages.provider_message_id IS
  'Provider message/resource identity when the provider exposes one. Twilio dual-writes twilio_sid during transition.';
COMMENT ON COLUMN public.messages.provider_conversation_id IS
  'Provider conversation identity; never the UPR conversation primary key.';
COMMENT ON COLUMN public.messages.client_request_id IS
  'Stable browser-generated UUID for one direct staff send action, reused on retry.';
COMMENT ON COLUMN public.messages.sender_address IS
  'Actual provider sender address used for this message.';
COMMENT ON COLUMN public.messages.recipient_address IS
  'Actual provider recipient address used for this message.';

-- ─── 2. Outbound attempt ledger ──────────────────────────────────────────────

CREATE TABLE public.message_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_attempt_id uuid REFERENCES public.message_send_attempts(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  actor_employee_id uuid NOT NULL REFERENCES public.employees(id),
  recipient_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  client_request_id uuid,
  provider text NOT NULL,
  request_fingerprint text NOT NULL,
  recipient_address text NOT NULL,
  submitted_body text,
  canonical_body text,
  media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  sender_address text,
  requested_channel text NOT NULL DEFAULT 'sms',
  actual_channel text,
  channel_fallback_reason text,
  state text NOT NULL DEFAULT 'prepared',
  provider_message_id text,
  provider_conversation_id text,
  provider_http_status integer,
  provider_status text,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  response_at timestamptz,
  reconcile_after timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_send_attempts_attempt_number_check
    CHECK (attempt_number > 0),
  CONSTRAINT message_send_attempts_provider_check
    CHECK (provider IN ('twilio', 'callrail')),
  CONSTRAINT message_send_attempts_requested_channel_check
    CHECK (requested_channel IN ('sms', 'mms', 'rcs')),
  CONSTRAINT message_send_attempts_actual_channel_check
    CHECK (actual_channel IS NULL OR actual_channel IN ('sms', 'mms', 'rcs')),
  CONSTRAINT message_send_attempts_media_urls_check
    CHECK (jsonb_typeof(media_urls) = 'array'),
  CONSTRAINT message_send_attempts_state_check
    CHECK (state IN (
      'prepared', 'submitting', 'accepted', 'ambiguous',
      'confirmed', 'failed', 'cancelled'
    )),
  CONSTRAINT message_send_attempts_message_attempt_key
    UNIQUE (message_id, attempt_number)
);

CREATE UNIQUE INDEX message_send_attempts_client_request_id_key
  ON public.message_send_attempts (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX message_send_attempts_parent_recipient_key
  ON public.message_send_attempts (parent_attempt_id, recipient_contact_id)
  WHERE parent_attempt_id IS NOT NULL AND recipient_contact_id IS NOT NULL;

CREATE INDEX message_send_attempts_parent_idx
  ON public.message_send_attempts (parent_attempt_id)
  WHERE parent_attempt_id IS NOT NULL;

CREATE INDEX message_send_attempts_recipient_contact_idx
  ON public.message_send_attempts (recipient_contact_id)
  WHERE recipient_contact_id IS NOT NULL;

CREATE INDEX message_send_attempts_reconcile_idx
  ON public.message_send_attempts (reconcile_after)
  WHERE state = 'ambiguous' AND reconcile_after IS NOT NULL;

CREATE INDEX message_send_attempts_provider_message_idx
  ON public.message_send_attempts (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX message_send_attempts_conversation_idx
  ON public.message_send_attempts (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX message_send_attempts_actor_employee_idx
  ON public.message_send_attempts (actor_employee_id);

COMMENT ON TABLE public.message_send_attempts IS
  'Service-only reservation and reconciliation ledger for provider submissions. message_id may be null before persistence or after the retained audit outlives a deleted message.';
COMMENT ON COLUMN public.message_send_attempts.submitted_body IS
  'Exact body submitted to the provider, including any staff prefix; canonical messages.body remains the unprefixed customer-visible composition.';
COMMENT ON COLUMN public.message_send_attempts.canonical_body IS
  'Unprefixed canonical message body retained so an accepted provider outcome can be materialized without another provider submission.';
COMMENT ON COLUMN public.message_send_attempts.parent_attempt_id IS
  'Parent request reservation for a multi-recipient action; every provider side effect is represented by one recipient child attempt.';
COMMENT ON COLUMN public.message_send_attempts.requested_channel IS
  'Provider-neutral requested transport channel, such as sms, mms, or rcs.';
COMMENT ON COLUMN public.message_send_attempts.actual_channel IS
  'Provider-confirmed channel used for delivery; may differ only under an explicitly approved fallback policy.';
COMMENT ON COLUMN public.message_send_attempts.channel_fallback_reason IS
  'Auditable provider-neutral reason actual_channel differs from requested_channel; null when no fallback occurred.';

-- ─── 3. Provider webhook/event inbox ─────────────────────────────────────────

CREATE TABLE public.message_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_type text NOT NULL,
  provider_event_id text,
  provider_message_id text,
  provider_conversation_id text,
  direction text,
  message_type text,
  provider_status text,
  sender_address text,
  recipient_address text,
  content text,
  company_resource_id text,
  person_resource_id text,
  agent_name text,
  media_count integer NOT NULL DEFAULT 0,
  owned_media jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_body_hash text NOT NULL,
  dedupe_key text NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_state text NOT NULL DEFAULT 'received',
  processing_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  processed_at timestamptz,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  send_attempt_id uuid REFERENCES public.message_send_attempts(id) ON DELETE SET NULL,
  outcome text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_provider_events_provider_check
    CHECK (provider IN ('twilio', 'callrail')),
  CONSTRAINT message_provider_events_direction_check
    CHECK (direction IS NULL OR direction IN ('inbound', 'outbound')),
  CONSTRAINT message_provider_events_message_type_check
    CHECK (message_type IS NULL OR message_type IN ('sms', 'mms', 'rcs')),
  CONSTRAINT message_provider_events_media_count_check
    CHECK (media_count >= 0),
  CONSTRAINT message_provider_events_processing_attempts_check
    CHECK (processing_attempts >= 0),
  CONSTRAINT message_provider_events_owned_media_check
    CHECK (jsonb_typeof(owned_media) = 'array'),
  CONSTRAINT message_provider_events_state_check
    CHECK (processing_state IN ('received', 'claimed', 'processed', 'retryable', 'failed')),
  CONSTRAINT message_provider_events_dedupe_key_key UNIQUE (dedupe_key)
);

CREATE INDEX message_provider_events_message_idx
  ON public.message_provider_events (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX message_provider_events_attempt_idx
  ON public.message_provider_events (send_attempt_id)
  WHERE send_attempt_id IS NOT NULL;

CREATE INDEX message_provider_events_contact_idx
  ON public.message_provider_events (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX message_provider_events_conversation_idx
  ON public.message_provider_events (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX message_provider_events_retry_idx
  ON public.message_provider_events (next_attempt_at, received_at)
  WHERE processing_state = 'retryable';

COMMENT ON TABLE public.message_provider_events IS
  'Service-only deduplicated provider-event inbox. Stores normalized text facts needed for recovery, not raw provider payloads or short-lived media URLs.';
COMMENT ON COLUMN public.message_provider_events.provider_status IS
  'Provider-native status observed on this event. Domain state is derived only after provider-specific validation.';

-- ─── 3a. Durable notification outbox ────────────────────────────────────────

CREATE TABLE public.message_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id uuid NOT NULL
    REFERENCES public.message_provider_events(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  type_key text NOT NULL DEFAULT 'message.inbound',
  payload jsonb NOT NULL,
  delivery_state text NOT NULL DEFAULT 'pending',
  delivery_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_notification_outbox_event_key UNIQUE (provider_event_id),
  CONSTRAINT message_notification_outbox_state_check
    CHECK (delivery_state IN (
      'pending', 'processing', 'retryable', 'delivered', 'dead_letter'
    )),
  CONSTRAINT message_notification_outbox_attempts_check
    CHECK (delivery_attempts >= 0)
);

CREATE INDEX message_notification_outbox_due_idx
  ON public.message_notification_outbox (next_attempt_at, created_at)
  WHERE delivery_state IN ('pending', 'retryable');

CREATE INDEX message_notification_outbox_message_idx
  ON public.message_notification_outbox (message_id);

-- Consent audit rows are linked to the durable event that caused them. The
-- partial unique index makes replay idempotent without changing legacy rows.
ALTER TABLE public.sms_consent_log
  ADD COLUMN IF NOT EXISTS provider_event_id uuid
    REFERENCES public.message_provider_events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sms_consent_log_provider_event_action_key
  ON public.sms_consent_log (provider_event_id, contact_id, event_type)
  WHERE provider_event_id IS NOT NULL;

COMMENT ON COLUMN public.sms_consent_log.provider_event_id IS
  'Durable provider event that caused this consent transition; null for legacy/manual audit rows.';

-- ─── 4. Least privilege and worker-sole-writer enforcement ───────────────────

ALTER TABLE public.message_send_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_notification_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.message_send_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.message_provider_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.message_notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.message_send_attempts,
    public.message_provider_events,
    public.message_notification_outbox
  TO service_role;

-- Live caller capture on 2026-07-23 found no browser writes to messages. All
-- inserts/updates are performed by service-role workers. Enforce that boundary.
DROP POLICY IF EXISTS allow_anon_read_messages ON public.messages;
DROP POLICY IF EXISTS allow_anon_write_messages ON public.messages;
DROP POLICY IF EXISTS allow_authenticated_messages ON public.messages;
DROP POLICY IF EXISTS messages_authenticated_select ON public.messages;

CREATE OR REPLACE FUNCTION public.messaging_can_access_conversations()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH actor AS (
    SELECT id, role
    FROM public.employees
    WHERE auth_user_id = auth.uid()
      AND is_active = true
      AND COALESCE(is_external, false) = false
    LIMIT 1
  ),
  employee_override AS (
    SELECT epa.can_view
    FROM public.employee_page_access epa
    JOIN actor ON actor.id = epa.employee_id
    WHERE epa.nav_key = 'conversations'
    LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM actor
    WHERE NOT COALESCE((
      SELECT force_disabled
      FROM public.feature_flags
      WHERE key = 'page:conversations'
      LIMIT 1
    ), false)
      AND CASE
        WHEN EXISTS (SELECT 1 FROM employee_override)
          THEN (SELECT can_view FROM employee_override)
        WHEN actor.role = 'admin' THEN true
        ELSE COALESCE((
          SELECT np.can_view
          FROM public.nav_permissions np
          WHERE np.role = actor.role
            AND np.nav_key = 'conversations'
          LIMIT 1
        ), false)
      END
  );
$$;

REVOKE ALL ON FUNCTION public.messaging_can_access_conversations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_can_access_conversations() TO authenticated, service_role;

COMMENT ON FUNCTION public.messaging_can_access_conversations() IS
  'Trusted boolean caller contract for company-wide conversation visibility: active non-external employee plus force-disable/override/admin/role permission precedence.';

CREATE POLICY messages_authenticated_select
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (public.messaging_can_access_conversations());

REVOKE ALL ON TABLE public.messages FROM anon;
REVOKE ALL ON TABLE public.messages FROM authenticated;
GRANT SELECT ON TABLE public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_message_notification_outbox(
  p_limit integer,
  p_now timestamptz,
  p_stale_before timestamptz,
  p_claim_token uuid
)
RETURNS TABLE (
  id uuid,
  type_key text,
  payload jsonb,
  delivery_attempts integer,
  claim_token uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'claim_message_notification_outbox is service-role only'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_now IS NULL OR p_stale_before IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Notification outbox claim arguments are invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT o.id
    FROM public.message_notification_outbox o
    WHERE (
        o.delivery_state = 'pending'
        OR (
          o.delivery_state = 'retryable'
          AND o.next_attempt_at <= p_now
        )
        OR (
          o.delivery_state = 'processing'
          AND o.claimed_at < p_stale_before
        )
      )
    ORDER BY COALESCE(o.next_attempt_at, o.created_at), o.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.message_notification_outbox o
  SET
    delivery_state = 'processing',
    delivery_attempts = o.delivery_attempts + 1,
    claimed_at = p_now,
    claim_token = p_claim_token,
    updated_at = p_now
  FROM due
  WHERE o.id = due.id
  RETURNING o.id, o.type_key, o.payload, o.delivery_attempts, o.claim_token;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_message_notification_outbox(
  integer, timestamptz, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_message_notification_outbox(
  integer, timestamptz, timestamptz, uuid
) TO service_role;

COMMENT ON FUNCTION public.claim_message_notification_outbox(
  integer, timestamptz, timestamptz, uuid
) IS
  'Service-role-only fenced lease claim for due or stale inbound-message notification jobs.';

-- ─── 5. Atomic CallRail inbound projection ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.project_callrail_inbound_event(
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
    RAISE EXCEPTION 'project_callrail_inbound_event is service-role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_event
  FROM public.message_provider_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CallRail provider event % was not found', p_event_id
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

  IF v_event.provider <> 'callrail'
     OR v_event.direction <> 'inbound'
     OR v_event.provider_message_id IS NULL
     OR v_event.provider_conversation_id IS NULL
     OR v_event.sender_address IS NULL
     OR v_event.recipient_address IS NULL
     OR v_event.occurred_at IS NULL
     OR v_event.message_type NOT IN ('sms', 'mms') THEN
    RAISE EXCEPTION 'Stored event is not a complete CallRail inbound text event'
      USING ERRCODE = '22023';
  END IF;

  v_phone_digits := regexp_replace(v_event.sender_address, '[^0-9]', '', 'g');
  v_phone_key := right(v_phone_digits, 10);
  IF length(v_phone_key) <> 10 THEN
    RAISE EXCEPTION 'CallRail inbound sender is not a supported NANP address'
      USING ERRCODE = '22023';
  END IF;

  -- Classify consent keywords before creating an unknown contact. STOP must
  -- never pass through implied opt-in, while HELP/INFO records no global
  -- consent transition. Only an ordinary inbound message implies consent.
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

  -- Serialize all contact/conversation/consent work for one customer number.
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
    -- STOP is deliberately fail-closed even when an older event arrives late.
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
    -- A delayed START/YES must never undo a STOP that happened at or after it.
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
      WHERE COALESCE(media.item->>'storageRef', '') !~ '^upr-storage://'
    )
  ) THEN
    RAISE EXCEPTION 'CallRail MMS must be copied to UPR-owned storage before projection'
      USING ERRCODE = '22023';
  END IF;

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
        created_at,
        updated_at
      )
      VALUES (
        'direct',
        COALESCE(v_contact.name, v_event.sender_address),
        'needs_response',
        v_now,
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
      -- Keep sender/contact identity consistent with the participant that made
      -- this deterministic existing conversation eligible.
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
      'callrail',
      v_event.provider_message_id,
      v_event.provider_conversation_id,
      v_event.sender_address,
      v_event.recipient_address,
      v_event.sender_address,
      v_contact.id,
      CASE WHEN v_event.message_type = 'mms' THEN v_media_urls ELSE NULL END,
      'inbound',
      v_event.occurred_at
    )
    ON CONFLICT (provider, provider_message_id)
      WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL
      DO NOTHING
    RETURNING id INTO v_message_id;

    v_inserted := v_message_id IS NOT NULL;
    IF NOT v_inserted THEN
      SELECT m.id, m.conversation_id
      INTO v_message_id, v_conversation_id
      FROM public.messages m
      WHERE m.provider = 'callrail'
        AND m.provider_message_id = v_event.provider_message_id
      LIMIT 1;
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

  IF v_inserted AND NOT p_consent_only AND v_message_id IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.project_callrail_inbound_event(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_callrail_inbound_event(uuid, boolean)
  TO service_role;

COMMENT ON FUNCTION public.project_callrail_inbound_event(uuid, boolean) IS
  'Service-role-only atomic projection of one durable CallRail inbound SMS or captured MMS event into consent, contact, conversation and message state.';

CREATE OR REPLACE FUNCTION public.materialize_message_send_attempt(
  p_attempt_id uuid
)
RETURNS TABLE (
  outcome text,
  message_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.message_send_attempts%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_message_id uuid;
  v_status text;
  v_inserted boolean := false;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'materialize_message_send_attempt is service-role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.message_send_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_attempt.parent_attempt_id IS NULL AND v_attempt.recipient_contact_id IS NULL
        AND v_attempt.client_request_id IS NULL
     OR v_attempt.provider_message_id IS NULL
     OR v_attempt.conversation_id IS NULL
     OR v_attempt.state NOT IN ('accepted', 'ambiguous', 'confirmed') THEN
    RAISE EXCEPTION 'Message attempt is not materializable'
      USING ERRCODE = '22023';
  END IF;

  IF v_attempt.actual_channel IS NOT NULL
     AND v_attempt.actual_channel <> v_attempt.requested_channel THEN
    RAISE EXCEPTION 'Cross-channel fallback cannot be materialized'
      USING ERRCODE = '22023';
  END IF;

  IF v_attempt.message_id IS NOT NULL THEN
    RETURN QUERY SELECT 'message_already_materialized'::text, v_attempt.message_id;
    RETURN;
  END IF;

  SELECT *
  INTO v_message
  FROM public.messages m
  WHERE (m.provider = v_attempt.provider
      AND m.provider_message_id = v_attempt.provider_message_id)
     OR (v_attempt.client_request_id IS NOT NULL
      AND m.client_request_id = v_attempt.client_request_id)
  ORDER BY
    (m.provider = v_attempt.provider
      AND m.provider_message_id = v_attempt.provider_message_id) DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_message.provider IS DISTINCT FROM v_attempt.provider
       OR v_message.provider_message_id IS DISTINCT FROM v_attempt.provider_message_id
       OR v_message.conversation_id IS DISTINCT FROM v_attempt.conversation_id
       OR v_message.recipient_address IS DISTINCT FROM v_attempt.recipient_address
       OR v_message.body IS DISTINCT FROM v_attempt.canonical_body THEN
      RAISE EXCEPTION 'Existing message conflicts with provider attempt identity'
        USING ERRCODE = '23505';
    END IF;
    v_message_id := v_message.id;
  ELSE
    v_status := CASE
      WHEN v_attempt.state = 'confirmed' THEN 'sent'
      ELSE COALESCE(NULLIF(v_attempt.provider_status, ''), 'queued')
    END;

    INSERT INTO public.messages (
      conversation_id,
      type,
      channel,
      body,
      status,
      twilio_sid,
      sent_by,
      media_urls,
      provider,
      provider_message_id,
      provider_conversation_id,
      client_request_id,
      sender_address,
      recipient_address,
      direction
    )
    VALUES (
      v_attempt.conversation_id,
      'sms_outbound',
      COALESCE(v_attempt.actual_channel, v_attempt.requested_channel),
      v_attempt.canonical_body,
      v_status,
      CASE WHEN v_attempt.provider = 'twilio'
        THEN v_attempt.provider_message_id ELSE NULL END,
      v_attempt.actor_employee_id,
      CASE WHEN jsonb_array_length(v_attempt.media_urls) > 0
        THEN v_attempt.media_urls ELSE NULL END,
      v_attempt.provider,
      v_attempt.provider_message_id,
      v_attempt.provider_conversation_id,
      v_attempt.client_request_id,
      v_attempt.sender_address,
      v_attempt.recipient_address,
      'outbound'
    )
    RETURNING id INTO v_message_id;
    v_inserted := true;
  END IF;

  UPDATE public.message_send_attempts
  SET message_id = v_message_id, updated_at = now()
  WHERE id = v_attempt.id;

  RETURN QUERY
  SELECT
    CASE WHEN v_inserted
      THEN 'message_materialized'::text
      ELSE 'message_already_materialized'::text
    END,
    v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_message_send_attempt(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_message_send_attempt(uuid)
  TO service_role;

COMMENT ON FUNCTION public.materialize_message_send_attempt(uuid) IS
  'Service-role-only, provider-free recovery of one accepted attempt into exactly one canonical outbound message row.';

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

    IF NOT FOUND
       OR v_attempt.provider <> 'callrail'
       OR v_attempt.state NOT IN ('accepted', 'ambiguous', 'confirmed')
       OR v_attempt.recipient_address IS DISTINCT FROM v_event.recipient_address
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
  'Service-role-only atomic, replay-safe projection of a retained CallRail message.sent event into attempt and canonical message state.';

CREATE OR REPLACE FUNCTION public.project_callrail_reconcile_outcome(
  p_attempt_id uuid,
  p_message_id uuid,
  p_provider_message_id text,
  p_provider_conversation_id text,
  p_company_resource_id text,
  p_sender_address text,
  p_recipient_address text,
  p_provider_status text,
  p_occurred_at timestamptz,
  p_raw_body_hash text,
  p_dedupe_key text,
  p_confirmed boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.message_send_attempts%ROWTYPE;
  v_provider_status text;
  v_message_id uuid;
  v_now timestamptz := now();
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'project_callrail_reconcile_outcome is service-role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.message_send_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_attempt.provider <> 'callrail'
     OR v_attempt.message_id IS DISTINCT FROM p_message_id THEN
    RAISE EXCEPTION 'CallRail reconciliation attempt identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_attempt.state NOT IN ('accepted', 'ambiguous') THEN
    RETURN false;
  END IF;

  v_provider_status := lower(trim(COALESCE(p_provider_status, '')));
  IF v_provider_status NOT IN ('sent', 'failed', 'error')
     OR p_confirmed IS DISTINCT FROM (v_provider_status = 'sent') THEN
    RAISE EXCEPTION 'CallRail reconciliation status and confirmation are inconsistent'
      USING ERRCODE = '22023';
  END IF;

  v_message_id := p_message_id;
  IF p_confirmed AND v_message_id IS NULL THEN
    UPDATE public.message_send_attempts
    SET
      provider_message_id = p_provider_message_id,
      provider_conversation_id = p_provider_conversation_id,
      provider_status = v_provider_status,
      actual_channel = requested_channel,
      updated_at = v_now
    WHERE id = p_attempt_id;

    SELECT materialized.message_id
    INTO v_message_id
    FROM public.materialize_message_send_attempt(p_attempt_id) materialized;
  END IF;

  INSERT INTO public.message_provider_events (
    provider,
    event_type,
    provider_event_id,
    provider_message_id,
    provider_conversation_id,
    direction,
    message_type,
    provider_status,
    sender_address,
    recipient_address,
    content,
    company_resource_id,
    media_count,
    raw_body_hash,
    dedupe_key,
    occurred_at,
    processing_state,
    processed_at,
    message_id,
    send_attempt_id,
    outcome
  )
  VALUES (
    'callrail',
    'text_reconciled',
    'reconcile:' || p_provider_message_id,
    p_provider_message_id,
    p_provider_conversation_id,
    'outbound',
    v_attempt.requested_channel,
    v_provider_status,
    p_sender_address,
    p_recipient_address,
    NULL,
    p_company_resource_id,
    0,
    p_raw_body_hash,
    p_dedupe_key,
    p_occurred_at,
    'processed',
    v_now,
    v_message_id,
    p_attempt_id,
    CASE WHEN p_confirmed THEN 'outbound_confirmed' ELSE 'outbound_failed' END
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  UPDATE public.message_send_attempts
  SET
    state = CASE WHEN p_confirmed THEN 'confirmed' ELSE 'failed' END,
    message_id = v_message_id,
    provider_message_id = p_provider_message_id,
    provider_conversation_id = p_provider_conversation_id,
    actual_channel = requested_channel,
    completed_at = p_occurred_at,
    reconcile_after = NULL,
    error_code = CASE WHEN p_confirmed THEN NULL ELSE 'CALLRAIL_PROVIDER_FAILED' END,
    error_message = CASE
      WHEN p_confirmed THEN NULL
      ELSE 'CallRail reports provider status ' || v_provider_status
    END,
    updated_at = v_now
  WHERE id = p_attempt_id;

  UPDATE public.messages
  SET
    status = CASE WHEN p_confirmed THEN 'sent' ELSE 'failed' END,
    provider_message_id = p_provider_message_id,
    provider_conversation_id = p_provider_conversation_id,
    error_code = CASE WHEN p_confirmed THEN NULL ELSE 'CALLRAIL_PROVIDER_FAILED' END,
    error_message = CASE
      WHEN p_confirmed THEN NULL
      ELSE 'CallRail reports provider status ' || v_provider_status
    END
  WHERE id = v_message_id
    AND provider = 'callrail';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical CallRail message was not found for reconciliation'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.project_callrail_reconcile_outcome(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_callrail_reconcile_outcome(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text, text, boolean
) TO service_role;

COMMENT ON FUNCTION public.project_callrail_reconcile_outcome(
  uuid, uuid, text, text, text, text, text, text, timestamptz, text, text, boolean
) IS
  'Service-role-only atomic projection of one exact CallRail history reconciliation into provider event, attempt, and canonical message state.';

RESET statement_timeout;
RESET lock_timeout;

-- ============================================================================
-- OPERATIONAL ROLLBACK (owner-approved; no schema or ACL reversal)
-- ============================================================================
--
-- 1. Set MESSAGING_SEND_MODE=disabled in the owner-approved deployment window.
-- 2. Revert consuming worker/client code to the last reviewed release.
-- 3. Leave the additive columns, ledgers, indexes, RPCs, and consent audit links
--    in place. They are backward-compatible and preserve forensic history.
-- 4. Keep message_send_attempts/message_provider_events service-role-only and
--    keep messages browser-read-only. Never restore anon/authenticated writes.
-- 5. Any later schema removal is a separate reviewed migration after retention,
--    dependency, late-webhook, and provider-drain evidence proves it safe.
