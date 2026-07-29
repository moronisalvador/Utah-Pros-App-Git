-- ════════════════════════════════════════════════
-- MIGRATION: sms_consent_opt_out_only
-- Phase: n/a (standalone, owner-directed 2026-07-28)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Changes the answer to "is it okay to text this person?" from "only if we
--   have a recorded yes on file" to "yes, unless they told us no." Everything
--   that counts as telling us no is untouched: Do Not Disturb, an explicit
--   opt-out, and an inbound STOP that has not been filed yet all still block
--   the send, exactly as before. What changes is the ending: a customer whose
--   number we have, who has never said no, is now eligible only for a
--   staff-written, one-to-one service message without first recording a consent
--   record. Automated, scheduled, group, broadcast, bulk, campaign and
--   marketing paths remain global-opt-in-only in their worker gates.
--
--   Owner direction, 2026-07-28: "We already have opt out and DND in place,
--   which should be the only thing that matter. If we have their contact info,
--   they gave it to us and requested our service."
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   FUNCTION BODY ONLY. No table, column, constraint, policy, grant or index
--   changes; no data change. The signature
--   get_service_sms_consent_status(uuid, text) -> jsonb is FROZEN and unchanged,
--   as is every existing return key. One NEW `code` value is added to the
--   returned vocabulary: 'IMPLIED_CONSENT'. Existing codes keep their exact
--   current meanings, so a caller that has not been taught the new code simply
--   continues to refuse. Only the direct staff 1:1 path opts in by accepting
--   the new code; every automated or multi-recipient path rejects it.
--
--   RED-TIER NOTE: this is a deliberate relaxation of a compliance gate on a
--   live shared-production database, narrowed after adversarial review to the
--   direct staff 1:1 service path. It is NOT additive in effect even though it
--   is additive in schema — it permits those messages where they were
--   previously refused. Reviewed as such.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260728000000_sms_consent_opt_out_only.rollback.sql
--   restores the exact pre-change terminal branch (returns
--   allowed=false / code='NO_CONSENT' when no opt-in, service attestation or
--   signed work-authorization consent exists). Because only the direct staff
--   worker accepts 'IMPLIED_CONSENT' explicitly rather than accepting anything
--   truthy, the
--   FASTER operational rollback is the code side: drop 'IMPLIED_CONSENT' from
--   the staff 1:1 worker's accepted-code list and redeploy, which restores
--   opt-in-only behaviour without touching the database at all.
--   No consent evidence is written, altered or deleted by either direction.
-- ════════════════════════════════════════════════

-- Drift guard: refuse to apply if the live body is not the reviewed 2026-07-28
-- definition. Same posture as 20260724043000 / 20260727005212 — a silent apply
-- over a drifted consent function is exactly the failure this repo already
-- learned to prevent.
DO $migration$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_service_sms_consent_status(uuid,text)'::regprocedure
  )
  INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'get_service_sms_consent_status(uuid,text) is missing';
  END IF;

  IF md5(v_definition) <> '8128167c5086f3111ea22ddcab161440'
     OR octet_length(v_definition) <> 6718 THEN
    RAISE EXCEPTION
      'get_service_sms_consent_status drifted after the 2026-07-28 review (live md5 %, % bytes)',
      md5(v_definition), octet_length(v_definition);
  END IF;
END;
$migration$;

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

  IF v_work_auth_consent.sign_request_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'code', 'SERVICE_CONSENT',
      'contact_id', v_contact.id,
      'consent_scope', v_work_auth_consent.consent_scope,
      'attested_at', v_work_auth_consent.signed_at
    );
  END IF;

  -- ── THE 2026-07-28 CHANGE ───────────────────────────────────────────────
  -- Previously: allowed=false / 'NO_CONSENT'. Reaching here means we hold a
  -- phone number for this contact and NONE of the refusals above fired — no
  -- DND, no opt-out, no unfiled STOP, no phone mismatch or mid-flight phone
  -- change. Under the owner's 2026-07-28 direction that is now a yes.
  --
  -- The distinct code matters: callers accept 'IMPLIED_CONSENT' by name, so a
  -- send path can be returned to opt-in-only by removing one string from its
  -- accepted list, with no database change. `source` records WHY this was
  -- allowed so sms_consent_log and any later audit can tell an implied
  -- permission apart from a recorded one.
  RETURN jsonb_build_object(
    'allowed', true,
    'code', 'IMPLIED_CONSENT',
    'contact_id', v_contact.id,
    'source', 'no_recorded_objection',
    'consent_scope', 'service_related_customer_project_messages'
  );
END;
$function$;

-- Managed-Supabase re-applies EXECUTE TO PUBLIC on every new/replaced function
-- (database-standard.md §1). Re-assert the reviewed ACL, revoke before grant.
REVOKE ALL ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  TO service_role;
