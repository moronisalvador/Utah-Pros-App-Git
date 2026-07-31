-- ════════════════════════════════════════════════
-- MIGRATION: 20260731220000_scheduled_message_delivery_compatibility
-- Phase: Conversation participant safety — scheduled-message hardening
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Lets the browser schedule and cancel a text without editing the queue
--   directly. It also gives the sending job one durable delivery reservation
--   so a crash or retry cannot submit the same scheduled text twice.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Adds two nullable columns, one partial unique index, and new functions;
--   compatibly replaces the existing queue and legacy-claim function bodies.
--   No table/column drop, rename, tightening, or existing-row rewrite.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   First restore callers that do not need these RPCs, then run
--   supabase/rollbacks/20260731220000_scheduled_message_delivery_compatibility.rollback.sql.
--   The durable reservation columns/index remain intentionally, because erasing
--   provider evidence could authorize a duplicate send.
-- ════════════════════════════════════════════════
--
-- ROLLOUT ORDER: apply this compatibility migration first; deploy and verify all
-- web/native/Worker callers; only then apply 20260731220100 enforcement.

DO $scheduled_delivery_compat_preflight$
BEGIN
  IF to_regclass('public.scheduled_messages') IS NULL
     OR to_regclass('public.message_send_attempts') IS NULL
     OR to_regprocedure('public.materialize_message_send_attempt(uuid)') IS NULL
     OR to_regprocedure('public.messaging_employee_has_conversations_capability(uuid)') IS NULL
     OR to_regprocedure('public.messaging_employee_can_access_conversation(uuid,uuid)') IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'scheduled delivery compatibility: required messaging foundation is absent';
  END IF;
END;
$scheduled_delivery_compat_preflight$;

ALTER TABLE public.scheduled_messages
  ADD COLUMN claim_token uuid,
  ADD COLUMN delivery_attempt_id uuid
    REFERENCES public.message_send_attempts(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.scheduled_messages.claim_token IS
  'Random worker fencing token; only the current token may reserve, release, or fail an unreserved scheduled row.';
COMMENT ON COLUMN public.scheduled_messages.delivery_attempt_id IS
  'Irreversible link to the single durable provider-attempt reservation for this scheduled text.';

CREATE UNIQUE INDEX scheduled_messages_delivery_attempt_id_key
  ON public.scheduled_messages (delivery_attempt_id)
  WHERE delivery_attempt_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_scheduled_message(
  p_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_send_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid;
  v_existing public.scheduled_messages%ROWTYPE;
  v_recipients integer;
BEGIN
  SELECT employee.id INTO v_actor_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active AND NOT employee.is_external
  LIMIT 1;
  IF v_actor_id IS NULL
     OR NOT public.messaging_employee_has_conversations_capability(v_actor_id)
     OR NOT public.messaging_employee_can_access_conversation(v_actor_id, p_conversation_id) THEN
    RAISE EXCEPTION 'Messages access is not granted' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_conversation_id IS NULL OR NULLIF(btrim(p_body), '') IS NULL
     OR char_length(btrim(p_body)) > 1600 OR p_send_at IS NULL
     OR p_send_at <= now() + interval '30 seconds' OR p_send_at > now() + interval '365 days' THEN
    RAISE EXCEPTION 'scheduled message arguments are invalid' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_recipients
  FROM public.conversation_participants participant
  WHERE participant.conversation_id = p_conversation_id
    AND participant.is_active AND participant.removed_at IS NULL
    AND participant.contact_id IS NOT NULL
    AND NULLIF(btrim(participant.phone), '') IS NOT NULL;
  IF v_recipients <> 1 THEN
    RAISE EXCEPTION 'scheduled message requires exactly one active customer recipient'
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.scheduled_messages (id, conversation_id, body, send_at, created_by)
  VALUES (p_id, p_conversation_id, btrim(p_body), p_send_at, v_actor_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_existing FROM public.scheduled_messages WHERE id = p_id FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.conversation_id IS DISTINCT FROM p_conversation_id
       OR v_existing.body IS DISTINCT FROM btrim(p_body)
       OR v_existing.send_at IS DISTINCT FROM p_send_at
       OR v_existing.created_by IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'scheduled message idempotency key conflicts' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  RETURN p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_scheduled_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_actor_id uuid; v_cancelled boolean;
BEGIN
  SELECT employee.id INTO v_actor_id FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid() AND employee.is_active AND NOT employee.is_external
    AND lower(employee.email) = 'moroni@utah-pros.com' LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Messages access is not granted' USING ERRCODE = '42501'; END IF;
  UPDATE public.scheduled_messages message
     SET status = 'cancelled', claim_token = NULL, claimed_at = NULL
   WHERE message.id = p_id AND message.status = 'pending'
     AND message.delivery_attempt_id IS NULL
     AND (message.claimed_at IS NULL OR message.claimed_at < now() - interval '10 minutes')
  RETURNING true INTO v_cancelled;
  RETURN COALESCE(v_cancelled, false);
END;
$function$;

-- Signature/shape remain frozen for deployed DevTools callers; the DevTools
-- owner sees the whole queue while every other authenticated caller is denied.
CREATE OR REPLACE FUNCTION public.get_scheduled_queue(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, body text, send_at timestamptz, status text, contact_name text, contact_phone text, template_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees employee WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active AND NOT employee.is_external AND lower(employee.email) = 'moroni@utah-pros.com') THEN
    RAISE EXCEPTION 'scheduled queue is DevTools-owner only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    sm.id,
    sm.body,
    sm.send_at,
    sm.status,
    recipient.contact_name,
    recipient.contact_phone,
    mt.title
  FROM public.scheduled_messages sm
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN count(*) = 1 THEN max(COALESCE(contact.name, participant.phone))
        WHEN count(*) > 1 THEN count(*)::text || ' recipients'
        ELSE NULL
      END AS contact_name,
      CASE WHEN count(*) = 1 THEN max(participant.phone) ELSE NULL END AS contact_phone
    FROM public.conversation_participants participant
    LEFT JOIN public.contacts contact ON contact.id = participant.contact_id
    WHERE participant.conversation_id = sm.conversation_id
      AND participant.is_active
      AND participant.removed_at IS NULL
      AND participant.contact_id IS NOT NULL
      AND NULLIF(btrim(participant.phone), '') IS NOT NULL
  ) recipient ON true
  LEFT JOIN public.message_templates mt ON mt.id = sm.template_id
  ORDER BY sm.send_at ASC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$function$;

-- Keep the deployed signature callable during the compatibility window, but
-- teach every stale worker about the irreversible reservation boundary. A
-- linked row can never be reclaimed for another provider submission.
CREATE OR REPLACE FUNCTION public.claim_scheduled_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_claimed boolean;
BEGIN
  UPDATE public.scheduled_messages
  SET claimed_at = now()
  WHERE id = p_id
    AND status = 'pending'
    AND delivery_attempt_id IS NULL
    AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_scheduled_message(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_message(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_scheduled_message_v2(p_id uuid, p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF current_user <> 'service_role' OR p_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'scheduled claim is service-role only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.scheduled_messages SET claimed_at = now(), claim_token = p_claim_token
  WHERE id = p_id AND status = 'pending' AND delivery_attempt_id IS NULL
    AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes');
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_scheduled_message_claim(p_id uuid, p_claim_token uuid, p_error_message text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'scheduled release is service-role only' USING ERRCODE = '42501'; END IF;
  UPDATE public.scheduled_messages SET claimed_at = NULL, claim_token = NULL,
    error_message = left(NULLIF(btrim(p_error_message), ''), 500)
  WHERE id = p_id AND status = 'pending' AND delivery_attempt_id IS NULL AND claim_token = p_claim_token;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_scheduled_message_claim(p_id uuid, p_claim_token uuid, p_error_message text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'scheduled failure is service-role only' USING ERRCODE = '42501'; END IF;
  UPDATE public.scheduled_messages SET status = 'failed', claimed_at = NULL, claim_token = NULL,
    error_message = left(COALESCE(NULLIF(btrim(p_error_message), ''), 'Scheduled delivery failed'), 500)
  WHERE id = p_id AND status = 'pending' AND delivery_attempt_id IS NULL AND claim_token = p_claim_token;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_scheduled_message_delivery(
  p_id uuid,
  p_claim_token uuid,
  p_recipient_contact_id uuid,
  p_recipient_address text,
  p_submitted_body text,
  p_canonical_body text,
  p_media_urls jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(outcome text, attempt_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
DECLARE v_scheduled public.scheduled_messages%ROWTYPE; v_recipient record; v_attempt_id uuid;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'scheduled reservation is service-role only' USING ERRCODE = '42501'; END IF;
  IF p_recipient_contact_id IS NULL OR NULLIF(btrim(p_recipient_address), '') IS NULL
     OR NULLIF(btrim(p_submitted_body), '') IS NULL OR NULLIF(btrim(p_canonical_body), '') IS NULL
     OR p_media_urls IS NULL OR jsonb_typeof(p_media_urls) <> 'array' THEN
    RAISE EXCEPTION 'scheduled reservation arguments are invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_scheduled FROM public.scheduled_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_scheduled.status <> 'pending' OR v_scheduled.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'scheduled claim is not current' USING ERRCODE = '40900';
  END IF;
  IF v_scheduled.delivery_attempt_id IS NOT NULL THEN
    RETURN QUERY SELECT 'already_reserved'::text, v_scheduled.delivery_attempt_id;
    RETURN;
  END IF;
  IF v_scheduled.created_by IS NULL
     OR NOT COALESCE(
       public.messaging_employee_has_conversations_capability(v_scheduled.created_by),
       false
     )
     OR NOT COALESCE(
       public.messaging_employee_can_access_conversation(
         v_scheduled.created_by,
         v_scheduled.conversation_id
       ),
       false
     ) THEN
    RAISE EXCEPTION 'scheduled creator no longer has conversation access' USING ERRCODE = '42501';
  END IF;
  IF btrim(p_canonical_body) IS DISTINCT FROM btrim(v_scheduled.body) THEN
    RAISE EXCEPTION 'scheduled message body changed after creation' USING ERRCODE = '23505';
  END IF;
  SELECT participant.contact_id, participant.phone INTO v_recipient FROM public.conversation_participants participant
  WHERE participant.conversation_id = v_scheduled.conversation_id AND participant.is_active AND participant.removed_at IS NULL
    AND participant.contact_id IS NOT NULL AND NULLIF(btrim(participant.phone), '') IS NOT NULL;
  IF NOT FOUND OR v_recipient.contact_id IS DISTINCT FROM p_recipient_contact_id
     OR v_recipient.phone IS DISTINCT FROM btrim(p_recipient_address)
     OR (SELECT count(*) FROM public.conversation_participants participant
    WHERE participant.conversation_id = v_scheduled.conversation_id AND participant.is_active AND participant.removed_at IS NULL
      AND participant.contact_id IS NOT NULL AND NULLIF(btrim(participant.phone), '') IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'scheduled message requires exactly one active customer recipient' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.message_send_attempts (conversation_id, actor_employee_id, recipient_contact_id, client_request_id,
    provider, request_fingerprint, recipient_address, submitted_body, canonical_body, media_urls, requested_channel, state)
  VALUES (v_scheduled.conversation_id, v_scheduled.created_by, v_recipient.contact_id, v_scheduled.id,
    'twilio', encode(extensions.digest(convert_to(v_scheduled.id::text || ':' || btrim(p_canonical_body), 'UTF8'), 'sha256'), 'hex'), v_recipient.phone,
    btrim(p_submitted_body), btrim(p_canonical_body), p_media_urls,
    CASE WHEN jsonb_array_length(p_media_urls) > 0 THEN 'mms' ELSE 'sms' END, 'prepared') RETURNING id INTO v_attempt_id;
  UPDATE public.scheduled_messages SET delivery_attempt_id = v_attempt_id WHERE id = v_scheduled.id;
  RETURN QUERY SELECT 'reserved'::text, v_attempt_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_scheduled_message_delivery(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_scheduled public.scheduled_messages%ROWTYPE;
  v_attempt public.message_send_attempts%ROWTYPE;
  v_materialized record;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'scheduled reconciliation is service-role only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scheduled FROM public.scheduled_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_scheduled.delivery_attempt_id IS NULL THEN RAISE EXCEPTION 'scheduled delivery is not reserved' USING ERRCODE = '40900'; END IF;
  IF v_scheduled.status <> 'pending' THEN RETURN jsonb_build_object('ok', true, 'status', v_scheduled.status, 'already_terminal', true); END IF;
  SELECT * INTO v_attempt
  FROM public.message_send_attempts attempt
  WHERE attempt.id = v_scheduled.delivery_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduled delivery attempt is missing' USING ERRCODE = '23503';
  END IF;
  IF v_attempt.state IN ('accepted', 'confirmed')
     OR (v_attempt.state = 'ambiguous' AND v_attempt.provider_message_id IS NOT NULL) THEN
    SELECT * INTO v_materialized FROM public.materialize_message_send_attempt(v_scheduled.delivery_attempt_id);
    UPDATE public.scheduled_messages SET status = 'sent', sent_message_id = v_materialized.message_id, claimed_at = NULL, claim_token = NULL WHERE id = p_id;
    UPDATE public.conversations SET last_message_at = now(), last_message_preview = left(v_scheduled.body, 100),
      status = 'waiting_on_client', status_changed_at = now(), updated_at = now()
    WHERE id = v_scheduled.conversation_id;
    RETURN jsonb_build_object('ok', true, 'status', 'sent', 'message_id', v_materialized.message_id);
  END IF;
  IF v_attempt.state IN ('prepared', 'submitting', 'ambiguous')
     AND v_scheduled.claim_token IS NOT NULL
     AND v_scheduled.claimed_at >= now() - interval '10 minutes' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'in_flight',
      'delivery_attempt_id', v_scheduled.delivery_attempt_id
    );
  END IF;
  UPDATE public.message_send_attempts
  SET state = CASE
      WHEN v_attempt.state IN ('prepared', 'submitting') THEN 'ambiguous'
      ELSE v_attempt.state
    END,
    error_code = COALESCE(
      v_attempt.error_code,
      CASE WHEN v_attempt.state IN ('prepared', 'submitting', 'ambiguous')
        THEN 'SCHEDULED_OUTCOME_UNKNOWN' END
    ),
    error_message = COALESCE(
      v_attempt.error_message,
      'Scheduled delivery requires owner review; automatic resubmission is disabled'
    ),
    reconcile_after = NULL,
    updated_at = now()
  WHERE id = v_attempt.id;
  UPDATE public.scheduled_messages SET status = 'failed', claimed_at = NULL, claim_token = NULL,
    error_message = 'Scheduled delivery requires owner review; automatic resubmission is disabled'
  WHERE id = p_id;
  RETURN jsonb_build_object(
    'ok', true,
    'status', 'failed',
    'error', 'Scheduled delivery requires owner review; automatic resubmission is disabled',
    'delivery_attempt_id', v_scheduled.delivery_attempt_id
  );
END;
$function$;

ALTER FUNCTION public.create_scheduled_message(uuid,uuid,text,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.cancel_scheduled_message(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_scheduled_queue(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_scheduled_message(uuid,uuid,text,timestamptz), public.cancel_scheduled_message(uuid), public.get_scheduled_queue(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_scheduled_message(uuid,uuid,text,timestamptz), public.cancel_scheduled_message(uuid), public.get_scheduled_queue(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_scheduled_message_v2(uuid,uuid), public.release_scheduled_message_claim(uuid,uuid,text), public.fail_scheduled_message_claim(uuid,uuid,text), public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb), public.reconcile_scheduled_message_delivery(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_message_v2(uuid,uuid), public.release_scheduled_message_claim(uuid,uuid,text), public.fail_scheduled_message_claim(uuid,uuid,text), public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb), public.reconcile_scheduled_message_delivery(uuid) TO service_role;
