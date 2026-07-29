-- ════════════════════════════════════════════════
-- ROLLBACK: 20260728000000_sms_consent_opt_out_only
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the texting permission rule back the way it was: a person is only
--   textable if we have a recorded yes for them (a global opt-in, a recorded
--   service attestation, or a signed work authorization). Someone we merely
--   have a phone number for goes back to being refused.
--
-- WHEN YOU DO NOT NEED THIS FILE:
--   To stop the only send path that consumes implied permission (staff-written
--   direct 1:1 service SMS), do NOT run this. Remove 'IMPLIED_CONSENT' from
--   that worker's accepted-code list and redeploy — it is a one-line code
--   change and needs no database window. Use this file only to revert the
--   database decision itself for every caller at once.
--
-- SAFETY:
--   Function body only. No table, column, policy, grant or data change. No
--   consent evidence is written, altered or deleted. Running this while the
--   workers still accept 'IMPLIED_CONSENT' is safe — that code simply stops
--   being returned, and every path falls back to refusing, which is the
--   fail-closed direction.
-- ════════════════════════════════════════════════

BEGIN;

-- Rollback drift guard: only replace the exact forward function reviewed with
-- this migration. If a later migration has legitimately changed the body or
-- ACL, abort instead of silently overwriting that newer production contract.
DO $rollback_preflight$
DECLARE
  v_oid oid;
  v_overload_count integer;
  v_definition text;
  v_execute_grantees text[];
  v_grantable_count integer;
BEGIN
  SELECT count(*)
  INTO v_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_service_sms_consent_status';

  v_oid := to_regprocedure(
    'public.get_service_sms_consent_status(uuid,text)'
  );

  IF v_oid IS NULL OR v_overload_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'get_service_sms_consent_status rollback expected one exact overload; found %',
      v_overload_count;
  END IF;

  SELECT pg_get_functiondef(v_oid)
  INTO v_definition;

  SELECT
    array_agg(
      COALESCE(grantee_role.rolname, 'PUBLIC')
      ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
    ),
    count(*) FILTER (WHERE acl.is_grantable)
  INTO v_execute_grantees, v_grantable_count
  FROM pg_proc p
  CROSS JOIN LATERAL
    aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE p.oid = v_oid
    AND acl.privilege_type = 'EXECUTE';

  IF md5(v_definition) <> '0ce1f01fe13884d0288b29136a9ea8cc'
     OR octet_length(v_definition) <> 7458
     OR v_execute_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role']::text[]
     OR v_grantable_count IS DISTINCT FROM 0
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'get_service_sms_consent_status rollback drift: md5 %, % bytes, grantees %, grantable %, anon %, authenticated %, service_role %',
      md5(v_definition),
      octet_length(v_definition),
      v_execute_grantees,
      v_grantable_count,
      has_function_privilege('anon', v_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_oid, 'EXECUTE');
  END IF;
END;
$rollback_preflight$;

CREATE OR REPLACE FUNCTION public.get_service_sms_consent_status(
  p_contact_id uuid,
  p_destination_phone text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
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
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  TO service_role;

COMMIT;
