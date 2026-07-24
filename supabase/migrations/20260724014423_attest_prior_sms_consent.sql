-- ════════════════════════════════════════════════
-- MIGRATION: 20260724014423_attest_prior_sms_consent
-- Phase: standalone messaging consent remediation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a service-only consent record for verified one-to-one customer-project
--   texts. It deliberately does not change the contact's general SMS opt-in, so
--   this evidence cannot authorize campaigns or automated marketing. A second
--   service-only operation gives the staff-message Worker one authoritative,
--   fail-closed decision before a send.
--
-- SECURITY:
--   Browser roles cannot read or write the evidence table and cannot execute
--   either function. Both functions use invoker privileges and independently
--   reject every database caller except service_role.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   REVOKE ALL ON FUNCTION public.get_service_sms_consent_status(uuid, text)
--     FROM PUBLIC, anon, authenticated, service_role;
--   REVOKE ALL ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
--     FROM PUBLIC, anon, authenticated, service_role;
--   Roll back consuming Worker/UI code while retaining the additive table,
--   functions, locked-down current/history tables, and redacted sms_consent_log evidence. Destructive schema
--   removal, if ever required, must be a separate reviewed cleanup migration.
-- ════════════════════════════════════════════════

CREATE TABLE public.service_sms_consents (
  contact_id uuid PRIMARY KEY
    REFERENCES public.contacts(id) ON DELETE RESTRICT,
  phone text NOT NULL,
  consent_scope text NOT NULL
    DEFAULT 'service_related_customer_project_messages',
  consent_method text NOT NULL,
  consent_obtained_on date NOT NULL,
  evidence_note text NOT NULL,
  attestation_version text NOT NULL
    DEFAULT 'prior_sms_consent_v1',
  sender_identity text NOT NULL
    DEFAULT 'Utah Pros Restoration',
  recorded_by uuid NOT NULL
    REFERENCES public.employees(id),
  request_ip text,
  attested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_sms_consents_scope_check
    CHECK (consent_scope = 'service_related_customer_project_messages'),
  CONSTRAINT service_sms_consents_method_check
    CHECK (consent_method IN (
      'verbal_permission',
      'signed_work_authorization',
      'other_written_permission',
      'customer_requested_texts',
      'other_verified_permission'
    )),
  CONSTRAINT service_sms_consents_evidence_check
    CHECK (char_length(btrim(evidence_note)) BETWEEN 10 AND 500),
  CONSTRAINT service_sms_consents_version_check
    CHECK (attestation_version = 'prior_sms_consent_v1'),
  CONSTRAINT service_sms_consents_sender_check
    CHECK (sender_identity = 'Utah Pros Restoration'),
  CONSTRAINT service_sms_consents_request_ip_check
    CHECK (
      request_ip IS NULL
      OR (
        char_length(request_ip) BETWEEN 3 AND 64
        AND request_ip ~ '^[0-9A-Fa-f:.]+$'
      )
  )
);

CREATE TABLE public.service_sms_consent_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL
    REFERENCES public.contacts(id) ON DELETE RESTRICT,
  phone text NOT NULL,
  consent_scope text NOT NULL,
  consent_method text NOT NULL,
  consent_obtained_on date NOT NULL,
  evidence_note text NOT NULL,
  attestation_version text NOT NULL,
  sender_identity text NOT NULL,
  recorded_by uuid NOT NULL
    REFERENCES public.employees(id),
  request_ip text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_sms_consent_attestations_scope_check
    CHECK (consent_scope = 'service_related_customer_project_messages'),
  CONSTRAINT service_sms_consent_attestations_method_check
    CHECK (consent_method IN (
      'verbal_permission',
      'signed_work_authorization',
      'other_written_permission',
      'customer_requested_texts',
      'other_verified_permission'
    )),
  CONSTRAINT service_sms_consent_attestations_evidence_check
    CHECK (char_length(btrim(evidence_note)) BETWEEN 10 AND 500),
  CONSTRAINT service_sms_consent_attestations_version_check
    CHECK (attestation_version = 'prior_sms_consent_v1'),
  CONSTRAINT service_sms_consent_attestations_sender_check
    CHECK (sender_identity = 'Utah Pros Restoration'),
  CONSTRAINT service_sms_consent_attestations_request_ip_check
    CHECK (
      request_ip IS NULL
      OR (
        char_length(request_ip) BETWEEN 3 AND 64
        AND request_ip ~ '^[0-9A-Fa-f:.]+$'
      )
    )
);

COMMENT ON TABLE public.service_sms_consents IS
  'Authoritative service-only evidence for one-to-one customer-project SMS. Never authorizes automated or marketing sends.';
COMMENT ON COLUMN public.service_sms_consents.phone IS
  'Phone at attestation time; the send gate requires it to match the current contact and destination.';
COMMENT ON COLUMN public.service_sms_consents.request_ip IS
  'Trusted Cloudflare connection IP supplied by the server; never accepted from browser JSON.';
COMMENT ON TABLE public.service_sms_consent_attestations IS
  'Append-only service-role evidence history for each verified prior SMS attestation.';

ALTER TABLE public.service_sms_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_sms_consents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_sms_consent_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_sms_consent_attestations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.service_sms_consents
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_sms_consents
  TO service_role;

REVOKE ALL ON TABLE public.service_sms_consent_attestations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.service_sms_consent_attestations
  TO service_role;

CREATE POLICY service_sms_consents_service_role_manage
  ON public.service_sms_consents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY service_sms_consent_attestations_service_role_select
  ON public.service_sms_consent_attestations
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY service_sms_consent_attestations_service_role_insert
  ON public.service_sms_consent_attestations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_service_sms_consent_status(
  p_contact_id uuid,
  p_destination_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_contact public.contacts%ROWTYPE;
  v_service_consent public.service_sms_consents%ROWTYPE;
  v_phone_digits text;
  v_phone_key text;
  v_locked_phone_digits text;
  v_locked_phone_key text;
  v_destination_digits text;
  v_destination_key text;
BEGIN
  IF current_user <> 'service_role' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'CONSENT_STATUS_NOT_AUTHORIZED'
    );
  END IF;

  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'CONTACT_NOT_FOUND');
  END IF;

  SELECT *
  INTO v_contact
  FROM public.contacts
  WHERE id = p_contact_id;

  IF v_contact.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'CONTACT_NOT_FOUND');
  END IF;

  v_phone_digits := regexp_replace(COALESCE(v_contact.phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone_digits) = 10 THEN
    v_phone_key := v_phone_digits;
  ELSIF length(v_phone_digits) = 11 AND left(v_phone_digits, 1) = '1' THEN
    v_phone_key := right(v_phone_digits, 10);
  ELSE
    RETURN jsonb_build_object('allowed', false, 'code', 'CONTACT_HAS_NO_PHONE');
  END IF;

  v_destination_digits := regexp_replace(
    COALESCE(p_destination_phone, v_contact.phone, ''),
    '[^0-9]',
    '',
    'g'
  );
  IF length(v_destination_digits) = 10 THEN
    v_destination_key := v_destination_digits;
  ELSIF length(v_destination_digits) = 11 AND left(v_destination_digits, 1) = '1' THEN
    v_destination_key := right(v_destination_digits, 10);
  END IF;

  IF v_destination_key IS NULL OR v_destination_key <> v_phone_key THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'CONTACT_PHONE_MISMATCH',
      'contact_id', v_contact.id
    );
  END IF;

  -- Match the CallRail inbound projector's serialization boundary. This makes a
  -- durable STOP that is waiting for projection visible before consent is used.
  PERFORM pg_advisory_xact_lock(hashtextextended('messaging-phone:' || v_phone_key, 0));

  -- Pin the target row after entering the phone serialization boundary. A phone
  -- change committed while the advisory lock was being acquired must never let
  -- suppression checks for the old number authorize the new number.
  SELECT *
  INTO v_contact
  FROM public.contacts
  WHERE id = p_contact_id
  FOR SHARE;

  v_locked_phone_digits := regexp_replace(COALESCE(v_contact.phone, ''), '[^0-9]', '', 'g');
  IF length(v_locked_phone_digits) = 10 THEN
    v_locked_phone_key := v_locked_phone_digits;
  ELSIF length(v_locked_phone_digits) = 11 AND left(v_locked_phone_digits, 1) = '1' THEN
    v_locked_phone_key := right(v_locked_phone_digits, 10);
  END IF;

  IF v_contact.id IS NULL
     OR v_locked_phone_key IS NULL
     OR v_locked_phone_key <> v_phone_key THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'CONTACT_PHONE_CHANGED',
      'contact_id', p_contact_id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
      AND c.dnd IS TRUE
  ) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'DND_ACTIVE',
      'contact_id', v_contact.id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
      AND c.opt_out_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'CONTACT_OPTED_OUT',
      'contact_id', v_contact.id,
      'source', 'explicit_opt_out'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.message_provider_events e
    WHERE e.direction = 'inbound'
      AND e.message_type IN ('sms', 'mms')
      AND e.processing_state IN ('received', 'claimed', 'retryable', 'failed')
      AND right(regexp_replace(COALESCE(e.sender_address, ''), '[^0-9]', '', 'g'), 10)
        = v_phone_key
      AND regexp_replace(lower(trim(COALESCE(e.content, ''))), '[^a-z0-9]', '', 'g')
        = ANY (ARRAY['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])
      AND NOT EXISTS (
        SELECT 1
        FROM public.message_provider_events later_event
        WHERE later_event.direction = 'inbound'
          AND later_event.message_type IN ('sms', 'mms')
          AND later_event.processing_state = 'processed'
          AND right(
            regexp_replace(COALESCE(later_event.sender_address, ''), '[^0-9]', '', 'g'),
            10
          ) = v_phone_key
          AND later_event.occurred_at > e.occurred_at
          AND regexp_replace(
            lower(trim(COALESCE(later_event.content, ''))),
            '[^a-z0-9]',
            '',
            'g'
          ) = ANY (ARRAY['start', 'unstop', 'subscribe', 'yes'])
      )
  ) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'CONTACT_PENDING_STOP',
      'contact_id', v_contact.id,
      'source', 'pending_stop'
    );
  END IF;

  IF v_contact.opt_in_status IS TRUE THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'code', 'GLOBAL_OPT_IN',
      'contact_id', v_contact.id,
      'consent_source', v_contact.opt_in_source
    );
  END IF;

  SELECT *
  INTO v_service_consent
  FROM public.service_sms_consents s
  WHERE s.contact_id = v_contact.id
    AND s.consent_scope = 'service_related_customer_project_messages'
    AND s.attestation_version = 'prior_sms_consent_v1';

  IF v_service_consent.contact_id IS NULL
     OR right(
       regexp_replace(COALESCE(v_service_consent.phone, ''), '[^0-9]', '', 'g'),
       10
     ) <> v_phone_key THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'NO_CONSENT',
      'contact_id', v_contact.id
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'code', 'SERVICE_CONSENT',
    'contact_id', v_contact.id,
    'consent_scope', v_service_consent.consent_scope,
    'attested_at', v_service_consent.attested_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.attest_prior_sms_consent(
  p_contact_id uuid,
  p_actor_id uuid,
  p_consent_method text,
  p_consent_obtained_on date,
  p_evidence_note text,
  p_request_ip text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_actor public.employees%ROWTYPE;
  v_contact public.contacts%ROWTYPE;
  v_existing public.service_sms_consents%ROWTYPE;
  v_method text := lower(btrim(COALESCE(p_consent_method, '')));
  v_note text := btrim(COALESCE(p_evidence_note, ''));
  v_request_ip text := NULLIF(btrim(COALESCE(p_request_ip, '')), '');
  v_phone_digits text;
  v_phone_key text;
  v_locked_phone_digits text;
  v_locked_phone_key text;
  v_recorded_at timestamptz := now();
  v_already_recorded boolean := false;
  v_attestation_id uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'CONSENT_ATTESTATION_NOT_AUTHORIZED'
    );
  END IF;

  IF p_contact_id IS NULL OR p_actor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ATTESTATION');
  END IF;

  IF v_method <> ALL (ARRAY[
    'verbal_permission',
    'signed_work_authorization',
    'other_written_permission',
    'customer_requested_texts',
    'other_verified_permission'
  ]) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CONSENT_METHOD');
  END IF;

  IF char_length(v_note) < 10 OR char_length(v_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVIDENCE_NOTE');
  END IF;

  IF p_consent_obtained_on IS NULL
     OR p_consent_obtained_on > (v_recorded_at AT TIME ZONE 'America/Denver')::date THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CONSENT_DATE');
  END IF;

  IF v_request_ip IS NOT NULL
     AND (
       char_length(v_request_ip) < 3
       OR char_length(v_request_ip) > 64
       OR v_request_ip !~ '^[0-9A-Fa-f:.]+$'
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST_IP');
  END IF;

  SELECT *
  INTO v_actor
  FROM public.employees
  WHERE id = p_actor_id
  LIMIT 1
  FOR SHARE;

  IF v_actor.id IS NULL
     OR v_actor.is_active IS DISTINCT FROM true
     OR v_actor.is_external IS DISTINCT FROM false
     OR v_actor.role::text NOT IN ('admin', 'office') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'CONSENT_ATTESTATION_NOT_AUTHORIZED'
    );
  END IF;

  SELECT *
  INTO v_contact
  FROM public.contacts
  WHERE id = p_contact_id;

  IF v_contact.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_NOT_FOUND');
  END IF;

  v_phone_digits := regexp_replace(COALESCE(v_contact.phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone_digits) = 10 THEN
    v_phone_key := v_phone_digits;
  ELSIF length(v_phone_digits) = 11 AND left(v_phone_digits, 1) = '1' THEN
    v_phone_key := right(v_phone_digits, 10);
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_HAS_NO_PHONE');
  END IF;

  -- Serialize with the CallRail inbound projector, then lock every duplicate
  -- contact using this normalized number before checking suppression.
  PERFORM pg_advisory_xact_lock(hashtextextended('messaging-phone:' || v_phone_key, 0));

  PERFORM c.id
  FROM public.contacts c
  WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
  ORDER BY c.id
  FOR UPDATE;

  SELECT *
  INTO v_contact
  FROM public.contacts
  WHERE id = p_contact_id
  FOR UPDATE;

  v_locked_phone_digits := regexp_replace(COALESCE(v_contact.phone, ''), '[^0-9]', '', 'g');
  IF length(v_locked_phone_digits) = 10 THEN
    v_locked_phone_key := v_locked_phone_digits;
  ELSIF length(v_locked_phone_digits) = 11 AND left(v_locked_phone_digits, 1) = '1' THEN
    v_locked_phone_key := right(v_locked_phone_digits, 10);
  END IF;

  IF v_contact.id IS NULL
     OR v_locked_phone_key IS NULL
     OR v_locked_phone_key <> v_phone_key THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_PHONE_CHANGED');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
      AND c.dnd IS TRUE
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_DND_ACTIVE');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_key
      AND c.opt_out_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_OPTED_OUT');
  END IF;

  -- The provider-event insert commits before the CallRail projection RPC. If a
  -- STOP is durable but not yet projected onto contacts, refuse attestation.
  IF EXISTS (
    SELECT 1
    FROM public.message_provider_events e
    WHERE e.direction = 'inbound'
      AND e.message_type IN ('sms', 'mms')
      AND e.processing_state IN ('received', 'claimed', 'retryable', 'failed')
      AND right(regexp_replace(COALESCE(e.sender_address, ''), '[^0-9]', '', 'g'), 10)
        = v_phone_key
      AND regexp_replace(lower(trim(COALESCE(e.content, ''))), '[^a-z0-9]', '', 'g')
        = ANY (ARRAY['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])
      AND NOT EXISTS (
        SELECT 1
        FROM public.message_provider_events later_event
        WHERE later_event.direction = 'inbound'
          AND later_event.message_type IN ('sms', 'mms')
          AND later_event.processing_state = 'processed'
          AND right(
            regexp_replace(COALESCE(later_event.sender_address, ''), '[^0-9]', '', 'g'),
            10
          ) = v_phone_key
          AND later_event.occurred_at > e.occurred_at
          AND regexp_replace(
            lower(trim(COALESCE(later_event.content, ''))),
            '[^a-z0-9]',
            '',
            'g'
          ) = ANY (ARRAY['start', 'unstop', 'subscribe', 'yes'])
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_PENDING_STOP');
  END IF;

  SELECT *
  INTO v_existing
  FROM public.service_sms_consents
  WHERE contact_id = v_contact.id
  FOR UPDATE;
  v_already_recorded := v_existing.contact_id IS NOT NULL;

  -- Raw evidence is append-only and browser-inaccessible. The legacy
  -- sms_consent_log receives only a redacted reference to this row.
  INSERT INTO public.service_sms_consent_attestations (
    contact_id,
    phone,
    consent_scope,
    consent_method,
    consent_obtained_on,
    evidence_note,
    attestation_version,
    sender_identity,
    recorded_by,
    request_ip,
    recorded_at
  )
  VALUES (
    v_contact.id,
    v_contact.phone,
    'service_related_customer_project_messages',
    v_method,
    p_consent_obtained_on,
    v_note,
    'prior_sms_consent_v1',
    'Utah Pros Restoration',
    v_actor.id,
    v_request_ip,
    v_recorded_at
  )
  RETURNING id INTO v_attestation_id;

  INSERT INTO public.service_sms_consents (
    contact_id,
    phone,
    consent_scope,
    consent_method,
    consent_obtained_on,
    evidence_note,
    attestation_version,
    sender_identity,
    recorded_by,
    request_ip,
    attested_at,
    updated_at
  )
  VALUES (
    v_contact.id,
    v_contact.phone,
    'service_related_customer_project_messages',
    v_method,
    p_consent_obtained_on,
    v_note,
    'prior_sms_consent_v1',
    'Utah Pros Restoration',
    v_actor.id,
    v_request_ip,
    v_recorded_at,
    v_recorded_at
  )
  ON CONFLICT (contact_id) DO UPDATE
  SET
    phone = EXCLUDED.phone,
    consent_scope = EXCLUDED.consent_scope,
    consent_method = EXCLUDED.consent_method,
    consent_obtained_on = EXCLUDED.consent_obtained_on,
    evidence_note = EXCLUDED.evidence_note,
    attestation_version = EXCLUDED.attestation_version,
    sender_identity = EXCLUDED.sender_identity,
    recorded_by = EXCLUDED.recorded_by,
    request_ip = EXCLUDED.request_ip,
    attested_at = EXCLUDED.attested_at,
    updated_at = EXCLUDED.updated_at;

  -- Every successful submission appends evidence, including a re-attestation.
  INSERT INTO public.sms_consent_log (
    contact_id,
    phone,
    event_type,
    source,
    details,
    ip_address,
    performed_by,
    created_at
  )
  VALUES (
    v_contact.id,
    v_contact.phone,
    'prior_consent_attested',
    v_method,
    jsonb_build_object(
      'attestation', 'verified_prior_sms_consent',
      'attestation_id', v_attestation_id,
      'attestation_version', 'prior_sms_consent_v1',
      'consent_scope', 'service_related_customer_project_messages',
      'sender_identity', 'Utah Pros Restoration',
      'recorded_at', v_recorded_at
    )::text,
    NULL,
    v_actor.id,
    v_recorded_at
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_recorded', v_already_recorded,
    'contact_id', v_contact.id,
    'service_sms_consent', true,
    'consent_scope', 'service_related_customer_project_messages',
    'consent_method', v_method,
    'consent_obtained_on', p_consent_obtained_on,
    'recorded_by', v_actor.id,
    'attested_at', v_recorded_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
  TO service_role;
