-- ════════════════════════════════════════════════
-- MIGRATION: 20260724014423_attest_prior_sms_consent
-- Phase: standalone messaging consent remediation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds one server-only operation for authorized office staff to record verified
--   SMS permission that the business obtained before UPR tracked consent. The
--   operation refuses a Do Not Disturb or opted-out contact, updates the contact,
--   and writes the matching consent-history entry together in one transaction.
--
-- ADDITIVE-ONLY:
--   Adds three purpose-scoped contact columns plus one function and its
--   service-only function ACL. Existing global SMS consent is not broadened.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   REVOKE ALL ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
--     FROM PUBLIC, anon, authenticated, service_role;
--   DROP FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text);
--   Consent records created while the function was available are retained because
--   deleting audit history or guessing which customer permissions to reverse is unsafe.
--   The three inert contact columns are also retained so rollback does not erase
--   evidence or silently change the meaning of historical sends.
-- ════════════════════════════════════════════════

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS p2p_sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS p2p_sms_consent_source text,
  ADD COLUMN IF NOT EXISTS p2p_sms_consent_phone text;

COMMENT ON COLUMN public.contacts.p2p_sms_consent_at IS
  'When verified prior consent for staff-to-customer person-to-person SMS was recorded.';
COMMENT ON COLUMN public.contacts.p2p_sms_consent_source IS
  'Evidence method for purpose-scoped person-to-person SMS consent.';
COMMENT ON COLUMN public.contacts.p2p_sms_consent_phone IS
  'Phone snapshot bound to the purpose-scoped person-to-person SMS consent.';

CREATE OR REPLACE FUNCTION public.attest_prior_sms_consent(
  p_contact_id uuid,
  p_actor_id uuid,
  p_consent_method text,
  p_consent_obtained_on date,
  p_evidence_note text,
  p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_actor public.employees%ROWTYPE;
  v_contact public.contacts%ROWTYPE;
  v_method text := lower(btrim(COALESCE(p_consent_method, '')));
  v_note text := btrim(COALESCE(p_evidence_note, ''));
  v_ip_address text := NULLIF(btrim(COALESCE(p_ip_address, '')), '');
  v_recorded_at timestamptz := now();
  v_evidence_key text;
  v_details jsonb;
  v_audit_recorded boolean := false;
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

  IF v_ip_address IS NOT NULL AND char_length(v_ip_address) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_IP_ADDRESS');
  END IF;

  IF p_consent_obtained_on IS NULL
     OR p_consent_obtained_on > (v_recorded_at AT TIME ZONE 'America/Denver')::date THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CONSENT_DATE');
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
  WHERE id = p_contact_id
  FOR UPDATE;

  IF v_contact.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_NOT_FOUND');
  END IF;

  IF btrim(COALESCE(v_contact.phone, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_HAS_NO_PHONE');
  END IF;

  -- A prior consent attestation is never a re-subscribe mechanism. STOP, a
  -- delivery-provider opt-out, or manual DND must be resolved through the
  -- established customer re-consent path, not overwritten by staff.
  IF v_contact.dnd IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_DND_ACTIVE');
  END IF;

  IF v_contact.opt_out_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_OPTED_OUT');
  END IF;

  UPDATE public.contacts
  SET p2p_sms_consent_at = v_recorded_at,
      p2p_sms_consent_source = v_method,
      p2p_sms_consent_phone = v_contact.phone,
      updated_at = v_recorded_at
  WHERE id = v_contact.id
    AND dnd IS DISTINCT FROM true
    AND opt_out_at IS NULL
  RETURNING *
  INTO v_contact;

  IF v_contact.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_SUPPRESSION_CHANGED');
  END IF;

  v_evidence_key := md5(concat_ws(
    '|',
    v_contact.id::text,
    regexp_replace(v_contact.phone, '\D', '', 'g'),
    v_actor.id::text,
    v_method,
    p_consent_obtained_on::text,
    v_note
  ));
  v_details := jsonb_build_object(
    'attestation', 'verified_prior_p2p_sms_consent',
    'scope', 'staff_person_to_person',
    'consent_obtained_on', p_consent_obtained_on,
    'evidence_note', v_note,
    'evidence_key', v_evidence_key,
    'recorded_at', v_recorded_at
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.sms_consent_log
    WHERE contact_id = v_contact.id
      AND event_type = 'prior_p2p_consent_attested'
      AND performed_by = v_actor.id
      AND details::jsonb ->> 'evidence_key' = v_evidence_key
  ) THEN
    INSERT INTO public.sms_consent_log (
      contact_id,
      phone,
      event_type,
      source,
      details,
      performed_by,
      ip_address,
      created_at
    )
    VALUES (
      v_contact.id,
      v_contact.phone,
      'prior_p2p_consent_attested',
      v_method,
      v_details::text,
      v_actor.id,
      v_ip_address,
      v_recorded_at
    );
    v_audit_recorded := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_recorded', NOT v_audit_recorded,
    'audit_recorded', v_audit_recorded,
    'contact_id', v_contact.id,
    'p2p_sms_consent_at', v_contact.p2p_sms_consent_at,
    'p2p_sms_consent_source', v_contact.p2p_sms_consent_source,
    'p2p_sms_consent_phone', v_contact.p2p_sms_consent_phone,
    'consent_method', v_method,
    'consent_obtained_on', p_consent_obtained_on,
    'recorded_by', v_actor.id,
    'recorded_at', v_recorded_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
  TO service_role;
