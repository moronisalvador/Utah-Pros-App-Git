-- ════════════════════════════════════════════════
-- MIGRATION: 20260727005212_upr_work_authorization_sms_consent
-- Phase: n/a (standalone signed Work Authorization consent bridge)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Treats a customer-signed UPR Work Authorization as evidence for the narrow
--   project-service SMS scope already consumed by direct staff conversations.
--   The evidence is linked to the exact sign request, signed PDF, phone snapshot,
--   disclosure version and disclosure SHA-256. It is not a staff attestation and
--   never changes the contact's general opt-in.
--
-- ADDITIVE-ONLY / backward-compatible RPC replacement:
--   Adds one private evidence table and one service-only wrapper, and replaces
--   only the existing status RPC body without changing its signature or response
--   shape. No table DROP/RENAME/ALTER COLUMN, data backfill or existing-row change.
--
-- DEPENDS ON:
--   Tables: sign_requests, contacts, jobs, service_sms_consents
--   RPCs:   complete_sign_request(...), get_service_sms_consent_status(uuid,text)
--   Code:   functions/api/submit-esign.js
--
-- SAFETY:
--   - Additive table + service-role-only wrapper; the status RPC keeps its exact
--     signature and all existing DND, opt-out, pending-STOP and phone-race checks.
--   - Signing and evidence recording happen in one transaction.
--   - A changed/missing disclosure completes the legal signature but records no
--     messaging consent, so messaging remains fail-closed.
--   - No provider call, message row, retry, DND change or global opt-in occurs.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Apply supabase/rollbacks/
--   20260727005212_upr_work_authorization_sms_consent.rollback.sql in a separate
--   owner-approved migration window. It restores the captured pre-change status
--   RPC body before dropping the wrapper and evidence table.
-- ════════════════════════════════════════════════

DO $migration$
DECLARE
  v_status_definition text;
  v_complete_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_service_sms_consent_status(uuid,text)'::regprocedure
  )
  INTO v_status_definition;

  IF md5(v_status_definition) <> '4f28eae483e2a74b1d5504c17b444fd5'
     OR octet_length(v_status_definition) <> 5971 THEN
    RAISE EXCEPTION
      'get_service_sms_consent_status definition drifted after the 2026-07-26 review';
  END IF;

  SELECT pg_get_functiondef(
    'public.complete_sign_request(uuid,text,text,text,boolean,boolean,boolean,boolean)'::regprocedure
  )
  INTO v_complete_definition;

  IF md5(v_complete_definition) <> 'a0cd4e8872aee73a1d425bc92774c06c'
     OR octet_length(v_complete_definition) <> 3669 THEN
    RAISE EXCEPTION
      'complete_sign_request definition drifted after the 2026-07-26 review';
  END IF;
END;
$migration$;

CREATE TABLE public.work_authorization_sms_consents (
  sign_request_id uuid PRIMARY KEY
    REFERENCES public.sign_requests(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL
    REFERENCES public.contacts(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL
    REFERENCES public.jobs(id) ON DELETE RESTRICT,
  phone text NOT NULL,
  signer_ip text NOT NULL
    CHECK (
      char_length(signer_ip) BETWEEN 3 AND 64
      AND signer_ip ~ '^[0-9A-Fa-f:.]+$'
    ),
  consent_scope text NOT NULL
    DEFAULT 'service_related_customer_project_messages'
    CHECK (consent_scope = 'service_related_customer_project_messages'),
  consent_source text NOT NULL
    DEFAULT 'upr_signed_work_authorization'
    CHECK (consent_source = 'upr_signed_work_authorization'),
  disclosure_version text NOT NULL
    CHECK (disclosure_version = 'upr_work_auth_sms_v1'),
  disclosure_sha256 text NOT NULL
    CHECK (
      disclosure_sha256 =
        '22b2a37dc4094f683da6c0fe1d4955da989733a3a799307129b9fa83cae1265e'
    ),
  signed_file_path text NOT NULL CHECK (btrim(signed_file_path) <> ''),
  signed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.work_authorization_sms_consents IS
  'Immutable service-SMS evidence derived from a customer-signed UPR Work Authorization; never global/automated consent.';
COMMENT ON COLUMN public.work_authorization_sms_consents.signer_ip IS
  'Trusted Cloudflare connection IP captured by the signing worker; service-role-only evidence and never copied to the broadly readable legacy consent log.';

CREATE INDEX work_authorization_sms_consents_contact_phone_idx
  ON public.work_authorization_sms_consents (contact_id, phone, signed_at DESC);

ALTER TABLE public.work_authorization_sms_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_authorization_sms_consents FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.work_authorization_sms_consents
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.work_authorization_sms_consents
  TO service_role;

CREATE POLICY work_authorization_sms_consents_service_role_select
  ON public.work_authorization_sms_consents
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY work_authorization_sms_consents_service_role_insert
  ON public.work_authorization_sms_consents
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.complete_sign_request_with_work_authorization_sms_consent(
  p_token uuid,
  p_signer_name text,
  p_signer_ip text,
  p_signed_file_path text,
  p_consent_terms boolean DEFAULT NULL,
  p_consent_commitment boolean DEFAULT NULL,
  p_consent_esign boolean DEFAULT NULL,
  p_consent_authority boolean DEFAULT NULL,
  p_sms_disclosure_version text DEFAULT NULL,
  p_sms_disclosure_sha256 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_req public.sign_requests%ROWTYPE;
  v_contact public.contacts%ROWTYPE;
  v_phone_digits text;
  v_phone_key text;
BEGIN
  IF current_user <> 'service_role' THEN
    RETURN jsonb_build_object(
      'error', 'WORK_AUTH_SMS_CONSENT_NOT_AUTHORIZED'
    );
  END IF;

  -- The existing function owns the legal signature, job document and audit
  -- event. Calling it inside this wrapper keeps that deployed contract intact
  -- and makes the following evidence insert part of the same transaction.
  v_result := public.complete_sign_request(
    p_token,
    p_signer_name,
    p_signer_ip,
    p_signed_file_path,
    p_consent_terms,
    p_consent_commitment,
    p_consent_esign,
    p_consent_authority
  );

  IF v_result IS NULL OR v_result ? 'error' THEN
    RETURN v_result;
  END IF;

  SELECT *
  INTO v_req
  FROM public.sign_requests
  WHERE id = (v_result ->> 'sign_request_id')::uuid
  FOR SHARE;

  IF v_req.id IS NULL OR v_req.doc_type <> 'work_auth' THEN
    RETURN v_result;
  END IF;

  IF p_sms_disclosure_version IS DISTINCT FROM 'upr_work_auth_sms_v1'
     OR p_sms_disclosure_sha256 IS DISTINCT FROM
       '22b2a37dc4094f683da6c0fe1d4955da989733a3a799307129b9fa83cae1265e' THEN
    RETURN v_result || jsonb_build_object(
      'sms_consent_recorded', false,
      'sms_consent_reason', 'disclosure_not_approved'
    );
  END IF;

  IF v_req.status <> 'signed'
     OR v_req.contact_id IS NULL
     OR v_req.job_id IS NULL
     OR v_req.signed_at IS NULL
     OR NULLIF(btrim(COALESCE(v_req.signer_ip, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_req.signed_file_path, '')), '') IS NULL THEN
    RETURN v_result || jsonb_build_object(
      'sms_consent_recorded', false,
      'sms_consent_reason', 'sign_request_not_eligible'
    );
  END IF;

  SELECT *
  INTO v_contact
  FROM public.contacts
  WHERE id = v_req.contact_id
  FOR SHARE;

  v_phone_digits := regexp_replace(
    COALESCE(v_contact.phone, ''),
    '[^0-9]',
    '',
    'g'
  );
  IF length(v_phone_digits) = 10 THEN
    v_phone_key := v_phone_digits;
  ELSIF length(v_phone_digits) = 11 AND left(v_phone_digits, 1) = '1' THEN
    v_phone_key := right(v_phone_digits, 10);
  END IF;

  IF v_contact.id IS NULL OR v_phone_key IS NULL THEN
    RETURN v_result || jsonb_build_object(
      'sms_consent_recorded', false,
      'sms_consent_reason', 'contact_has_no_phone'
    );
  END IF;

  INSERT INTO public.work_authorization_sms_consents (
    sign_request_id,
    contact_id,
    job_id,
    phone,
    signer_ip,
    disclosure_version,
    disclosure_sha256,
    signed_file_path,
    signed_at
  ) VALUES (
    v_req.id,
    v_req.contact_id,
    v_req.job_id,
    v_contact.phone,
    v_req.signer_ip,
    p_sms_disclosure_version,
    p_sms_disclosure_sha256,
    v_req.signed_file_path,
    v_req.signed_at
  )
  ON CONFLICT (sign_request_id) DO NOTHING;

  INSERT INTO public.sms_consent_log (
    contact_id,
    phone,
    event_type,
    source,
    performed_by,
    details
  ) VALUES (
    v_req.contact_id,
    v_contact.phone,
    'service_consent_recorded',
    'upr_signed_work_authorization',
    NULL,
    jsonb_build_object(
      'consent_scope', 'service_related_customer_project_messages',
      'disclosure_version', p_sms_disclosure_version,
      'sign_request_id', v_req.id
    )::text
  );

  RETURN v_result || jsonb_build_object(
    'sms_consent_recorded', true,
    'sms_consent_reason', 'upr_signed_work_authorization'
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.complete_sign_request_with_work_authorization_sms_consent(
    uuid, text, text, text, boolean, boolean, boolean, boolean, text, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.complete_sign_request_with_work_authorization_sms_consent(
    uuid, text, text, text, boolean, boolean, boolean, boolean, text, text
  )
  TO service_role;

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
  v_work_auth_consent public.work_authorization_sms_consents%ROWTYPE;
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

  PERFORM pg_advisory_xact_lock(hashtextextended('messaging-phone:' || v_phone_key, 0));

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
      'code', 'NO_CONSENT',
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
      'code', 'NO_CONSENT',
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

  IF v_service_consent.contact_id IS NOT NULL
     AND right(
       regexp_replace(COALESCE(v_service_consent.phone, ''), '[^0-9]', '', 'g'),
       10
     ) = v_phone_key THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'code', 'SERVICE_CONSENT',
      'contact_id', v_contact.id,
      'consent_scope', v_service_consent.consent_scope,
      'attested_at', v_service_consent.attested_at
    );
  END IF;

  SELECT *
  INTO v_work_auth_consent
  FROM public.work_authorization_sms_consents w
  WHERE w.contact_id = v_contact.id
    AND w.consent_scope = 'service_related_customer_project_messages'
    AND w.disclosure_version = 'upr_work_auth_sms_v1'
    AND right(
      regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'),
      10
    ) = v_phone_key
  ORDER BY w.signed_at DESC
  LIMIT 1;

  IF v_work_auth_consent.sign_request_id IS NULL THEN
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
    'consent_scope', v_work_auth_consent.consent_scope,
    'attested_at', v_work_auth_consent.signed_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  TO service_role;
