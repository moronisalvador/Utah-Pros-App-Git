-- ════════════════════════════════════════════════
-- ROLLBACK: 20260727005212_upr_work_authorization_sms_consent
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes automatic narrow service-SMS recognition for signed UPR Work
--   Authorizations. It restores the exact status RPC body captured read-only
--   from the shared catalog on 2026-07-26, then removes the wrapper and its
--   immutable evidence table.
--
-- CONSEQUENCE:
--   Any customer whose only permission evidence is a signed UPR Work
--   Authorization becomes blocked for staff SMS again and must use the existing
--   admin/office attestation path. This deletes the dedicated evidence rows, so
--   prefer fixing forward unless the schema itself is causing an incident.
--
-- OWNER GATE:
--   Applying this file is a separate shared-production database change.
-- ════════════════════════════════════════════════

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

REVOKE ALL ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  TO service_role;

DROP FUNCTION IF EXISTS
  public.complete_sign_request_with_work_authorization_sms_consent(
    uuid, text, text, text, boolean, boolean, boolean, boolean, text, text
  );

DROP TABLE IF EXISTS public.work_authorization_sms_consents;
