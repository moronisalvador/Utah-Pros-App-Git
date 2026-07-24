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
--   Adds one function and its service-only function ACL; no table, column, policy,
--   existing-object grant, or existing data is changed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   REVOKE ALL ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text)
--     FROM PUBLIC, anon, authenticated, service_role;
--   DROP FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text);
--   Consent records created while the function was available are retained because
--   deleting audit history or guessing which customer permissions to reverse is unsafe.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.attest_prior_sms_consent(
  p_contact_id uuid,
  p_actor_id uuid,
  p_consent_method text,
  p_consent_obtained_on date,
  p_evidence_note text
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
  v_recorded_at timestamptz := now();
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

  SELECT *
  INTO v_actor
  FROM public.employees
  WHERE id = p_actor_id
  LIMIT 1;

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

  IF v_contact.opt_in_status IS TRUE THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_recorded', true,
      'contact_id', v_contact.id,
      'opt_in_status', true,
      'opt_in_source', v_contact.opt_in_source,
      'opt_in_at', v_contact.opt_in_at
    );
  END IF;

  UPDATE public.contacts
  SET opt_in_status = true,
      opt_in_source = 'prior_consent_attestation',
      opt_in_at = v_recorded_at,
      updated_at = v_recorded_at
  WHERE id = v_contact.id
    AND dnd IS DISTINCT FROM true
    AND opt_out_at IS NULL
  RETURNING *
  INTO v_contact;

  IF v_contact.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTACT_SUPPRESSION_CHANGED');
  END IF;

  INSERT INTO public.sms_consent_log (
    contact_id,
    phone,
    event_type,
    source,
    details,
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
      'consent_obtained_on', p_consent_obtained_on,
      'evidence_note', v_note,
      'recorded_at', v_recorded_at
    )::text,
    v_actor.id,
    v_recorded_at
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_recorded', false,
    'contact_id', v_contact.id,
    'opt_in_status', true,
    'opt_in_source', v_contact.opt_in_source,
    'opt_in_at', v_contact.opt_in_at,
    'consent_method', v_method,
    'consent_obtained_on', p_consent_obtained_on,
    'recorded_by', v_actor.id,
    'recorded_at', v_recorded_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text)
  TO service_role;
