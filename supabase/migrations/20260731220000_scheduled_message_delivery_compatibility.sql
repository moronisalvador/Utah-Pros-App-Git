-- ════════════════════════════════════════════════
-- MIGRATION: 20260731220000_scheduled_message_delivery_compatibility
-- Phase: Conversation participant safety — scheduled-message hardening
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Lets the browser schedule and cancel a text without editing the queue
--   directly. It also gives the sending job one durable delivery reservation
--   so a crash or retry cannot submit the same scheduled text twice. It closes
--   legacy raw browser queue access, but refuses to apply while any pending row
--   still predates the actor-derived scheduling RPC.
--
-- ADDITIVE-ONLY:
--   Adds two nullable columns, a partial unique index, a private provenance
--   ledger, and new functions; compatibly replaces the existing queue and
--   legacy-claim function bodies. It never edits existing queue rows. The
--   pending-row gate requires owner-led resolution before this source can apply.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   First restore callers that do not need these RPCs, then run
--   supabase/rollbacks/20260731220000_scheduled_message_delivery_compatibility.rollback.sql.
--   Recovery pauses creation and every delivery lifecycle RPC; it never
--   restores raw browser writes or a functional legacy claim. The durable
--   provenance and reservation evidence remain intentionally, because erasing
--   either boundary could authorize a duplicate send.
-- ════════════════════════════════════════════════
--
-- ROLLOUT ORDER: deploy the hardened web/Worker callers first; they fail closed
-- while these RPCs are absent. Then apply and verify this compatibility source
-- and apply 20260731220100 enforcement in the same serialized release window.
-- 20260731213100 participant policy enforcement must already be applied and
-- catalog-verified; otherwise browser-mutable recipient rows are not trusted.
-- If this migration lands before a stale Worker is replaced, the preserved
-- legacy claim signature below also fails closed, so delivery pauses safely.

DO $scheduled_delivery_compat_preflight$
DECLARE
  v_employee_policies text[];
  v_conversation_qual text;
  v_conversation_check text;
  v_participant_qual text;
  v_participant_check text;
  v_message_qual text;
  v_policy_count integer;
  v_table text;
  v_privilege text;
BEGIN
  IF to_regclass('public.scheduled_messages') IS NULL
     OR to_regclass('public.message_send_attempts') IS NULL
     OR to_regprocedure('public.materialize_message_send_attempt(uuid)') IS NULL
     OR to_regprocedure('public.messaging_employee_has_conversations_capability(uuid)') IS NULL
     OR to_regprocedure('public.messaging_employee_can_access_conversation(uuid,uuid)') IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'scheduled delivery compatibility: required messaging foundation is absent';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'conversation_assignment_authority_containment'
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'scheduled delivery compatibility: trusted assignment correction is absent';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'conversation_participant_policy_enforcement'
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'scheduled delivery compatibility: participant write enforcement is absent';
  END IF;

  SELECT
    regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g'),
    regexp_replace(COALESCE(policy.with_check, ''), '\s+', '', 'g')
    INTO v_conversation_qual, v_conversation_check
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'conversations'
    AND policy.policyname = 'allow_authenticated_conversations'
    AND policy.permissive = 'PERMISSIVE'
    AND policy.cmd = 'ALL'
    AND policy.roles = ARRAY['authenticated']::name[];

  SELECT
    regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g'),
    regexp_replace(COALESCE(policy.with_check, ''), '\s+', '', 'g')
    INTO v_participant_qual, v_participant_check
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'conversation_participants'
    AND policy.policyname = 'allow_authenticated_conversation_participants'
    AND policy.permissive = 'PERMISSIVE'
    AND policy.cmd = 'ALL'
    AND policy.roles = ARRAY['authenticated']::name[];

  SELECT regexp_replace(COALESCE(policy.qual, ''), '\s+', '', 'g')
    INTO v_message_qual
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'messages'
    AND policy.policyname = 'messages_authenticated_select'
    AND policy.permissive = 'PERMISSIVE'
    AND policy.cmd = 'SELECT'
    AND policy.roles = ARRAY['authenticated']::name[]
    AND policy.with_check IS NULL;

  SELECT count(*)
    INTO v_policy_count
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename IN (
      'conversations', 'conversation_participants', 'messages'
    );

  IF v_policy_count <> 3
     OR replace(v_conversation_qual, 'public.', '')
       IS DISTINCT FROM 'messaging_can_access_conversation(id)'
     OR replace(v_participant_qual, 'public.', '')
       IS DISTINCT FROM 'messaging_can_access_conversation(conversation_id)'
     OR v_conversation_check IS DISTINCT FROM 'false'
     OR v_participant_check IS DISTINCT FROM 'false'
     OR replace(v_message_qual, 'public.', '')
       IS DISTINCT FROM '(messaging_can_access_conversations()ANDmessaging_can_access_conversation(conversation_id))'
     THEN
    RAISE EXCEPTION
      'scheduled delivery compatibility: participant policy enforcement drifted';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'public.conversations',
    'public.conversation_participants',
    'public.messages'
  ]
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF has_table_privilege('anon', v_table, v_privilege)
         OR NOT has_table_privilege('service_role', v_table, v_privilege)
         OR (
           (v_privilege = 'SELECT')
           IS DISTINCT FROM has_table_privilege(
             'authenticated',
             v_table,
             v_privilege
           )
         ) THEN
        RAISE EXCEPTION
          'scheduled delivery compatibility: participant ACL enforcement drifted on %',
          v_table;
      END IF;
    END LOOP;
  END LOOP;

  SELECT array_agg(policy.policyname ORDER BY policy.policyname)
    INTO v_employee_policies
  FROM pg_catalog.pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'employees';

  IF v_employee_policies IS DISTINCT FROM
       ARRAY['employees_self_identity_read']::text[]
     OR has_table_privilege('authenticated', 'public.employees', 'INSERT')
     OR has_table_privilege('authenticated', 'public.employees', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.employees', 'DELETE')
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege('anon', 'public.employees', 'INSERT')
     OR has_table_privilege('anon', 'public.employees', 'UPDATE')
     OR has_table_privilege('anon', 'public.employees', 'DELETE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc procedure
       JOIN pg_catalog.pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = to_regprocedure(
         'public.messaging_employee_can_access_conversation(uuid,uuid)'
       )
         AND owner_role.rolname = 'postgres'
         AND NOT procedure.prosecdef
         AND procedure.provolatile = 's'
         AND procedure.proconfig =
           ARRAY['search_path=pg_catalog, public']::text[]
         AND md5(replace(procedure.prosrc, chr(13), '')) =
           'd10e6fa5fd127ed02aa39f8f926b413f'
         AND procedure.prosrc !~
           '(appointment_crew|public\.appointments|public\.jobs|public\.claims)'
     )
     OR has_function_privilege(
       'authenticated',
       'public.messaging_employee_can_access_conversation(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.messaging_employee_can_access_conversation(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.messaging_employee_can_access_conversation(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'scheduled delivery compatibility: trusted actor catalog drifted';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc procedure
       JOIN pg_catalog.pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid =
         to_regprocedure('public.materialize_message_send_attempt(uuid)')
         AND owner_role.rolname = 'postgres'
         AND NOT procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.proconfig =
           ARRAY['search_path=pg_catalog, public']::text[]
         AND md5(replace(procedure.prosrc, chr(13), '')) =
           '58512aead8770fc0e7feec8547781c63'
     )
     OR has_function_privilege(
       'authenticated',
       'public.materialize_message_send_attempt(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.materialize_message_send_attempt(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.materialize_message_send_attempt(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'scheduled delivery compatibility: materialization boundary drifted';
  END IF;
END;
$scheduled_delivery_compat_preflight$;

ALTER TABLE public.scheduled_messages
  ADD COLUMN claim_token uuid,
  ADD COLUMN delivery_attempt_id uuid
    REFERENCES public.message_send_attempts(id) ON DELETE RESTRICT;

-- ALTER TABLE holds an ACCESS EXCLUSIVE lock until this migration transaction
-- commits or aborts. Checking after that lock closes the race where a stale
-- browser could create a raw pending row between a preflight count and the ACL
-- revoke below. A nonzero aggregate count aborts the whole transaction without
-- editing queue data or exposing message/customer content.
DO $scheduled_delivery_legacy_pending_gate$
DECLARE
  v_legacy_pending bigint;
BEGIN
  SELECT count(*)
    INTO v_legacy_pending
  FROM public.scheduled_messages
  WHERE status = 'pending';

  IF v_legacy_pending <> 0 THEN
    RAISE EXCEPTION
      'scheduled delivery compatibility: % legacy pending rows require owner-led resolution before apply',
      v_legacy_pending
      USING ERRCODE = '55000';
  END IF;
END;
$scheduled_delivery_legacy_pending_gate$;

COMMENT ON COLUMN public.scheduled_messages.claim_token IS
  'Random worker fencing token; only the current token may reserve, release, or fail an unreserved scheduled row.';
COMMENT ON COLUMN public.scheduled_messages.delivery_attempt_id IS
  'Irreversible link to the single durable provider-attempt reservation for this scheduled text.';

CREATE UNIQUE INDEX scheduled_messages_delivery_attempt_id_key
  ON public.scheduled_messages (delivery_attempt_id)
  WHERE delivery_attempt_id IS NOT NULL;

-- This ledger is deliberately separate from scheduled_messages. The aggregate
-- gate above requires a zero-pending baseline, while this migration's same
-- transaction closes raw browser queue access. The v2 claim checks every
-- delivery-relevant value below before a Worker can reserve an attempt, so any
-- non-pending legacy row can never be revived into the trusted delivery path.
CREATE TABLE public.scheduled_message_creation_provenance (
  scheduled_message_id uuid PRIMARY KEY
    REFERENCES public.scheduled_messages(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  recipient_contact_id uuid NOT NULL
    REFERENCES public.contacts(id) ON DELETE RESTRICT,
  recipient_address text NOT NULL,
  send_at timestamptz NOT NULL,
  body_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scheduled_message_creation_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_message_creation_provenance FORCE ROW LEVEL SECURITY;
-- The actor-derived SECURITY DEFINER function runs as postgres. FORCE RLS
-- keeps even that owner constrained to this explicit internal-only policy.
CREATE POLICY scheduled_message_creation_provenance_definer_access
  ON public.scheduled_message_creation_provenance
  FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY scheduled_message_creation_provenance_service_read
  ON public.scheduled_message_creation_provenance
  FOR SELECT TO service_role USING (true);
REVOKE ALL ON TABLE public.scheduled_message_creation_provenance
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.scheduled_message_creation_provenance TO service_role;

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
  v_inserted_id uuid;
  v_existing public.scheduled_messages%ROWTYPE;
  v_provenance public.scheduled_message_creation_provenance%ROWTYPE;
  v_recipients integer;
  v_recipient_contact_id uuid;
  v_recipient_address text;
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
  SELECT
    count(*),
    (array_agg(participant.contact_id))[1],
    (array_agg(btrim(participant.phone)))[1]
    INTO v_recipients, v_recipient_contact_id, v_recipient_address
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
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    INSERT INTO public.scheduled_message_creation_provenance (
      scheduled_message_id,
      created_by,
      conversation_id,
      recipient_contact_id,
      recipient_address,
      send_at,
      body_fingerprint
    ) VALUES (
      p_id,
      v_actor_id,
      p_conversation_id,
      v_recipient_contact_id,
      v_recipient_address,
      p_send_at,
      encode(extensions.digest(convert_to(btrim(p_body), 'UTF8'), 'sha256'), 'hex')
    );
    RETURN v_inserted_id;
  END IF;
  SELECT * INTO v_existing FROM public.scheduled_messages WHERE id = p_id FOR UPDATE;
  SELECT * INTO v_provenance
  FROM public.scheduled_message_creation_provenance
  WHERE scheduled_message_id = p_id;
  IF v_provenance.scheduled_message_id IS NULL THEN
    RAISE EXCEPTION 'scheduled message id was not created through the actor-derived RPC'
      USING ERRCODE = '42501';
  END IF;
  IF v_existing.conversation_id IS DISTINCT FROM p_conversation_id
     OR v_existing.body IS DISTINCT FROM btrim(p_body)
     OR v_existing.send_at IS DISTINCT FROM p_send_at
     OR v_existing.created_by IS DISTINCT FROM v_actor_id
     OR v_provenance.created_by IS DISTINCT FROM v_actor_id
     OR v_provenance.conversation_id IS DISTINCT FROM p_conversation_id
     OR v_provenance.recipient_contact_id
       IS DISTINCT FROM v_recipient_contact_id
     OR v_provenance.recipient_address IS DISTINCT FROM v_recipient_address
     OR v_provenance.send_at IS DISTINCT FROM p_send_at
     OR v_provenance.body_fingerprint IS DISTINCT FROM encode(extensions.digest(convert_to(btrim(p_body), 'UTF8'), 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'scheduled message idempotency key conflicts' USING ERRCODE = '23505';
  END IF;
  RETURN v_existing.id;
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
    COALESCE(contact.name, provenance.recipient_address),
    provenance.recipient_address,
    mt.title
  FROM public.scheduled_messages sm
  LEFT JOIN public.scheduled_message_creation_provenance provenance
    ON provenance.scheduled_message_id = sm.id
  LEFT JOIN public.contacts contact
    ON contact.id = provenance.recipient_contact_id
  LEFT JOIN public.message_templates mt ON mt.id = sm.template_id
  ORDER BY sm.send_at ASC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$function$;

-- Keep the deployed signature present during the compatibility window, but
-- make every stale worker stop before provider submission. Only the v2 fenced
-- workflow may claim a scheduled row after this migration.
CREATE OR REPLACE FUNCTION public.claim_scheduled_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'claim_scheduled_message is disabled; deploy the fenced scheduled worker'
    USING ERRCODE = '42501';
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
  UPDATE public.scheduled_messages message SET claimed_at = now(), claim_token = p_claim_token
  WHERE message.id = p_id AND message.status = 'pending' AND message.delivery_attempt_id IS NULL
    AND (message.claimed_at IS NULL OR message.claimed_at < now() - interval '10 minutes')
    AND EXISTS (
      SELECT 1
      FROM public.scheduled_message_creation_provenance provenance
      WHERE provenance.scheduled_message_id = message.id
        AND provenance.created_by = message.created_by
        AND provenance.conversation_id = message.conversation_id
        AND provenance.send_at = message.send_at
        AND provenance.body_fingerprint = encode(
          extensions.digest(convert_to(btrim(message.body), 'UTF8'), 'sha256'),
          'hex'
        )
    );
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
DECLARE
  v_scheduled public.scheduled_messages%ROWTYPE;
  v_provenance public.scheduled_message_creation_provenance%ROWTYPE;
  v_recipient record;
  v_attempt_id uuid;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'scheduled reservation is service-role only' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_claim_token IS NULL
     OR p_recipient_contact_id IS NULL
     OR NULLIF(btrim(p_recipient_address), '') IS NULL
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
  SELECT *
    INTO v_provenance
  FROM public.scheduled_message_creation_provenance provenance
  WHERE provenance.scheduled_message_id = v_scheduled.id;
  IF NOT FOUND
     OR v_provenance.created_by IS DISTINCT FROM v_scheduled.created_by
     OR v_provenance.conversation_id IS DISTINCT FROM v_scheduled.conversation_id
     OR v_provenance.send_at IS DISTINCT FROM v_scheduled.send_at
     OR v_provenance.body_fingerprint IS DISTINCT FROM encode(
       extensions.digest(
         convert_to(btrim(v_scheduled.body), 'UTF8'),
         'sha256'
       ),
       'hex'
     ) THEN
    RAISE EXCEPTION 'scheduled message lacks actor-derived creation provenance'
      USING ERRCODE = '42501';
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
  SELECT participant.contact_id, btrim(participant.phone) AS phone
    INTO v_recipient
  FROM public.conversation_participants participant
  WHERE participant.conversation_id = v_scheduled.conversation_id
    AND participant.is_active
    AND participant.removed_at IS NULL
    AND participant.contact_id IS NOT NULL
    AND NULLIF(btrim(participant.phone), '') IS NOT NULL;
  IF NOT FOUND OR v_recipient.contact_id IS DISTINCT FROM p_recipient_contact_id
     OR v_recipient.phone IS DISTINCT FROM btrim(p_recipient_address)
     OR v_provenance.recipient_contact_id
       IS DISTINCT FROM p_recipient_contact_id
     OR v_provenance.recipient_address
       IS DISTINCT FROM btrim(p_recipient_address)
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

-- Close the legacy browser table seam in this same transaction. The permissive
-- historical policies remain only as dormant catalog objects after 31220100;
-- without table privileges they cannot authorize a raw browser
-- INSERT/UPDATE that could reopen or alter a provenance-backed scheduled row.
REVOKE ALL ON TABLE public.scheduled_messages FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_messages TO service_role;
