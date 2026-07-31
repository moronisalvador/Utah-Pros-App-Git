-- ═════════════════════════════════════════════════════════════════════════════
-- 20260731210000_qbo_invoice_command_ledger.sql
-- Private durable command ledger for QBO invoice save/send/delete operations.
--
-- ADDITIVE / BACKWARD-COMPATIBLE:
--   * adds one forced-RLS service-only table and five service-only RPCs;
--   * replaces cas_qbo_invoice_link with the same signature/defaults and adds
--     idempotent success when the requested link is already applied;
--   * does not constrain QBO external ids or alter estimate conversion.
--
-- APPLY ORDER: after 20260731180000_qbo_estimate_conversion_concurrency.sql.
-- ROLLBACK: supabase/rollbacks/20260731210000_qbo_invoice_command_ledger.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.qbo_invoice_commands (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('save', 'send', 'delete')),
  -- Immutable audit identities deliberately have no SET NULL/cascading FK.
  actor_auth_user_id uuid,
  actor_employee_id uuid,
  initiator text NOT NULL CHECK (initiator IN ('browser', 'webhook')),
  realm_id text NOT NULL,
  expected_qbo_invoice_id text,
  target_qbo_invoice_id text,
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[0-9a-f]{64}$'),
  intent_payload jsonb NOT NULL CHECK (jsonb_typeof(intent_payload) = 'object'),
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN (
      'prepared', 'provider_started', 'ambiguous', 'provider_succeeded',
      'succeeded', 'rejected', 'needs_reconciliation'
    )),
  provider_stage text,
  provider_action text,
  provider_target_id text,
  provider_request_id text,
  provider_payload jsonb,
  provider_payload_hash text
    CHECK (provider_payload_hash IS NULL OR provider_payload_hash ~ '^[0-9a-f]{64}$'),
  provider_result jsonb,
  response_status integer,
  response_payload jsonb,
  error text,
  intuit_request_id text,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  provider_started_at timestamptz,
  provider_succeeded_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (initiator = 'browser' AND actor_auth_user_id IS NOT NULL)
    OR (
      initiator = 'webhook'
      AND actor_auth_user_id IS NULL
      AND actor_employee_id IS NULL
    )
  ),
  CHECK ((provider_payload IS NULL) = (provider_payload_hash IS NULL))
);

ALTER TABLE public.qbo_invoice_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_invoice_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qbo_invoice_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qbo_invoice_commands TO service_role;

CREATE POLICY qbo_invoice_commands_service_role_only
  ON public.qbo_invoice_commands
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- This serializes active command attempts for a UPR invoice. It is not a QBO
-- external-id uniqueness constraint and does not affect combined billing.
CREATE UNIQUE INDEX qbo_invoice_commands_one_active_per_invoice
  ON public.qbo_invoice_commands (invoice_id)
  WHERE status IN (
    'prepared', 'provider_started', 'ambiguous', 'provider_succeeded',
    'needs_reconciliation'
  );

CREATE OR REPLACE FUNCTION public.prepare_qbo_invoice_command(
  p_command_id uuid,
  p_invoice_id uuid,
  p_action text,
  p_actor_auth_user_id uuid,
  p_actor_employee_id uuid,
  p_initiator text,
  p_realm_id text,
  p_expected_qbo_invoice_id text,
  p_target_qbo_invoice_id text,
  p_intent_hash text,
  p_intent_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command public.qbo_invoice_commands;
  v_invoice public.invoices;
  v_active public.qbo_invoice_commands;
  v_local_target text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('save', 'send', 'delete')
     OR p_initiator NOT IN ('browser', 'webhook')
     OR (p_initiator = 'browser' AND p_actor_auth_user_id IS NULL)
     OR (
       p_initiator = 'webhook'
       AND (p_actor_auth_user_id IS NOT NULL OR p_actor_employee_id IS NOT NULL)
     )
     OR p_intent_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_intent_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-command');
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF v_invoice.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice-not-found');
  END IF;

  SELECT * INTO v_command
  FROM public.qbo_invoice_commands
  WHERE id = p_command_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_command.invoice_id IS DISTINCT FROM p_invoice_id
       OR v_command.action IS DISTINCT FROM p_action
       OR v_command.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
       OR v_command.actor_employee_id IS DISTINCT FROM p_actor_employee_id
       OR v_command.initiator IS DISTINCT FROM p_initiator
       OR v_command.realm_id IS DISTINCT FROM p_realm_id
       OR v_command.expected_qbo_invoice_id IS DISTINCT FROM p_expected_qbo_invoice_id
       OR v_command.target_qbo_invoice_id IS DISTINCT FROM p_target_qbo_invoice_id
       OR v_command.intent_hash IS DISTINCT FROM p_intent_hash
       OR v_command.intent_payload IS DISTINCT FROM p_intent_payload THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'idempotency-key-mismatch');
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'replay', true, 'command_id', v_command.id,
      'status', v_command.status, 'provider_stage', v_command.provider_stage,
      'response_status', v_command.response_status,
      'response_payload', v_command.response_payload
    );
  END IF;

  SELECT * INTO v_active
  FROM public.qbo_invoice_commands
  WHERE invoice_id = p_invoice_id
    AND status IN (
      'prepared', 'provider_started', 'ambiguous', 'provider_succeeded',
      'needs_reconciliation'
    )
  FOR UPDATE;

  IF FOUND THEN
    IF v_active.action IS NOT DISTINCT FROM p_action
       AND v_active.actor_auth_user_id IS NOT DISTINCT FROM p_actor_auth_user_id
       AND v_active.actor_employee_id IS NOT DISTINCT FROM p_actor_employee_id
       AND v_active.initiator IS NOT DISTINCT FROM p_initiator
       AND v_active.realm_id IS NOT DISTINCT FROM p_realm_id
       AND v_active.expected_qbo_invoice_id IS NOT DISTINCT FROM p_expected_qbo_invoice_id
       AND v_active.target_qbo_invoice_id IS NOT DISTINCT FROM p_target_qbo_invoice_id
       AND v_active.intent_hash IS NOT DISTINCT FROM p_intent_hash
       AND v_active.intent_payload IS NOT DISTINCT FROM p_intent_payload THEN
      IF v_active.provider_result ? 'local_target_qbo_invoice_id' THEN
        v_local_target := v_active.provider_result->>'local_target_qbo_invoice_id';
      ELSIF v_active.action = 'delete' THEN
        v_local_target := NULL;
      ELSE
        v_local_target := COALESCE(
          v_active.provider_result->>'qbo_invoice_id',
          v_active.provider_result->>'id',
          v_active.target_qbo_invoice_id
        );
      END IF;

      -- Provider result can be persisted immediately before or after local CAS.
      -- Resume is safe in either state, but never across a third link value.
      IF v_active.status = 'provider_succeeded'
         AND v_invoice.qbo_invoice_id IS DISTINCT FROM v_active.expected_qbo_invoice_id
         AND v_invoice.qbo_invoice_id IS DISTINCT FROM v_local_target THEN
        RETURN jsonb_build_object(
          'ok', false, 'reason', 'provider-result-link-mismatch',
          'command_id', v_active.id, 'status', v_active.status
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', true, 'resumed', true, 'command_id', v_active.id,
        'status', v_active.status, 'provider_stage', v_active.provider_stage,
        'response_status', v_active.response_status,
        'response_payload', v_active.response_payload
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false, 'reason', 'active-command-conflict',
      'command_id', v_active.id, 'status', v_active.status
    );
  END IF;

  INSERT INTO public.qbo_invoice_commands (
    id, invoice_id, action, actor_auth_user_id, actor_employee_id, initiator,
    realm_id, expected_qbo_invoice_id, target_qbo_invoice_id, intent_hash,
    intent_payload
  )
  VALUES (
    p_command_id, p_invoice_id, p_action, p_actor_auth_user_id,
    p_actor_employee_id, p_initiator, p_realm_id,
    p_expected_qbo_invoice_id, p_target_qbo_invoice_id, p_intent_hash,
    p_intent_payload
  );

  RETURN jsonb_build_object(
    'ok', true, 'prepared', true, 'command_id', p_command_id,
    'status', 'prepared'
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'active-command-conflict');
END;
$$;

CREATE OR REPLACE FUNCTION public.start_qbo_invoice_command_attempt(
  p_command_id uuid,
  p_provider_stage text,
  p_provider_action text,
  p_provider_target_id text,
  p_provider_request_id text,
  p_provider_payload jsonb,
  p_provider_payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command public.qbo_invoice_commands;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  IF p_provider_stage IS NULL
     OR p_provider_action IS NULL
     OR p_provider_request_id IS NULL
     OR (p_provider_target_id IS NULL AND p_provider_action <> 'create')
     OR jsonb_typeof(p_provider_payload) <> 'object'
     OR p_provider_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-attempt');
  END IF;

  SELECT * INTO v_command
  FROM public.qbo_invoice_commands
  WHERE id = p_command_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'command-not-found');
  END IF;

  IF v_command.status IN ('provider_started', 'ambiguous') THEN
    IF v_command.provider_stage IS DISTINCT FROM p_provider_stage
       OR v_command.provider_action IS DISTINCT FROM p_provider_action
       OR v_command.provider_target_id IS DISTINCT FROM p_provider_target_id
       OR v_command.provider_request_id IS DISTINCT FROM p_provider_request_id
       OR v_command.provider_payload IS DISTINCT FROM p_provider_payload
       OR v_command.provider_payload_hash IS DISTINCT FROM p_provider_payload_hash THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'attempt-mismatch');
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'replay', true, 'status', v_command.status,
      'provider_stage', v_command.provider_stage,
      'provider_action', v_command.provider_action,
      'provider_target_id', v_command.provider_target_id,
      'provider_request_id', v_command.provider_request_id,
      'provider_payload', v_command.provider_payload,
      'provider_payload_hash', v_command.provider_payload_hash
    );
  END IF;

  IF v_command.status <> 'prepared' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'invalid-state', 'status', v_command.status
    );
  END IF;

  UPDATE public.qbo_invoice_commands
  SET status = 'provider_started',
      provider_stage = p_provider_stage,
      provider_action = p_provider_action,
      provider_target_id = p_provider_target_id,
      provider_request_id = p_provider_request_id,
      provider_payload = p_provider_payload,
      provider_payload_hash = p_provider_payload_hash,
      provider_started_at = now(),
      error = NULL,
      updated_at = now()
  WHERE id = p_command_id;

  RETURN jsonb_build_object(
    'ok', true, 'started', true, 'status', 'provider_started',
    'provider_stage', p_provider_stage, 'provider_action', p_provider_action,
    'provider_target_id', p_provider_target_id,
    'provider_request_id', p_provider_request_id,
    'provider_payload', p_provider_payload,
    'provider_payload_hash', p_provider_payload_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_qbo_invoice_command_attempt(
  p_command_id uuid,
  p_expected_provider_stage text,
  p_provider_stage text,
  p_provider_action text,
  p_provider_target_id text,
  p_provider_request_id text,
  p_provider_payload jsonb,
  p_provider_payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command public.qbo_invoice_commands;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_provider_stage IS NULL
     OR p_provider_stage IS NULL
     OR p_provider_action IS NULL
     OR p_provider_request_id IS NULL
     OR (p_provider_target_id IS NULL AND p_provider_action <> 'create')
     OR jsonb_typeof(p_provider_payload) <> 'object'
     OR p_provider_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-attempt');
  END IF;

  SELECT * INTO v_command
  FROM public.qbo_invoice_commands
  WHERE id = p_command_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'command-not-found');
  END IF;
  IF v_command.status <> 'provider_started' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'invalid-state', 'status', v_command.status
    );
  END IF;

  IF v_command.provider_stage = p_provider_stage
     AND v_command.provider_action IS NOT DISTINCT FROM p_provider_action
     AND v_command.provider_target_id IS NOT DISTINCT FROM p_provider_target_id
     AND v_command.provider_request_id IS NOT DISTINCT FROM p_provider_request_id
     AND v_command.provider_payload IS NOT DISTINCT FROM p_provider_payload
     AND v_command.provider_payload_hash IS NOT DISTINCT FROM p_provider_payload_hash THEN
    RETURN jsonb_build_object(
      'ok', true, 'replay', true, 'status', v_command.status,
      'provider_stage', v_command.provider_stage,
      'provider_action', v_command.provider_action,
      'provider_target_id', v_command.provider_target_id,
      'provider_request_id', v_command.provider_request_id,
      'provider_payload', v_command.provider_payload,
      'provider_payload_hash', v_command.provider_payload_hash
    );
  END IF;

  IF v_command.provider_stage IS DISTINCT FROM p_expected_provider_stage THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'attempt-mismatch',
      'provider_stage', v_command.provider_stage
    );
  END IF;

  UPDATE public.qbo_invoice_commands
  SET provider_stage = p_provider_stage,
      provider_action = p_provider_action,
      provider_target_id = p_provider_target_id,
      provider_request_id = p_provider_request_id,
      provider_payload = p_provider_payload,
      provider_payload_hash = p_provider_payload_hash,
      updated_at = now()
  WHERE id = p_command_id
  RETURNING * INTO v_command;

  RETURN jsonb_build_object(
    'ok', true, 'advanced', true, 'status', v_command.status,
    'provider_stage', v_command.provider_stage,
    'provider_action', v_command.provider_action,
    'provider_target_id', v_command.provider_target_id,
    'provider_request_id', v_command.provider_request_id,
    'provider_payload', v_command.provider_payload,
    'provider_payload_hash', v_command.provider_payload_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_qbo_invoice_command_state(
  p_command_id uuid,
  p_status text,
  p_provider_result jsonb DEFAULT NULL,
  p_response_status integer DEFAULT NULL,
  p_response_payload jsonb DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_intuit_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command public.qbo_invoice_commands;
  v_allowed boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_command
  FROM public.qbo_invoice_commands
  WHERE id = p_command_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'command-not-found');
  END IF;

  v_allowed :=
    (v_command.status = 'prepared' AND p_status IN ('succeeded', 'rejected'))
    OR (v_command.status = 'provider_started'
        AND p_status IN ('ambiguous', 'provider_succeeded', 'rejected'))
    OR (v_command.status = 'ambiguous'
        AND p_status IN ('provider_succeeded', 'needs_reconciliation', 'rejected'))
    OR (v_command.status = 'provider_succeeded'
        AND p_status IN ('succeeded', 'needs_reconciliation'))
    OR (v_command.status = 'needs_reconciliation'
        AND p_status IN ('provider_started', 'provider_succeeded', 'succeeded', 'rejected'));

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'invalid-transition', 'status', v_command.status
    );
  END IF;
  IF v_command.status = 'prepared'
     AND p_status = 'succeeded'
     AND (p_response_status IS NULL OR p_response_payload IS NULL) THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'terminal-response-required',
      'status', v_command.status
    );
  END IF;

  UPDATE public.qbo_invoice_commands
  SET status = p_status,
      provider_result = COALESCE(p_provider_result, provider_result),
      response_status = COALESCE(p_response_status, response_status),
      response_payload = COALESCE(p_response_payload, response_payload),
      error = p_error,
      intuit_request_id = COALESCE(p_intuit_request_id, intuit_request_id),
      provider_succeeded_at = CASE
        WHEN p_status = 'provider_succeeded' THEN now()
        ELSE provider_succeeded_at
      END,
      completed_at = CASE
        WHEN p_status IN ('succeeded', 'rejected') THEN now()
        ELSE completed_at
      END,
      updated_at = now()
  WHERE id = p_command_id
  RETURNING * INTO v_command;

  RETURN jsonb_build_object(
    'ok', true, 'command_id', v_command.id, 'status', v_command.status,
    'provider_stage', v_command.provider_stage,
    'response_status', v_command.response_status,
    'response_payload', v_command.response_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_qbo_invoice_command(p_command_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command public.qbo_invoice_commands;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_command
  FROM public.qbo_invoice_commands
  WHERE id = p_command_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'command-not-found');
  END IF;
  RETURN to_jsonb(v_command) || jsonb_build_object('ok', true);
END;
$$;

-- Backward-compatible CAS replacement. If the current link already equals the
-- requested target, the provider result was already applied and retry succeeds
-- without rewriting email/status metadata.
CREATE OR REPLACE FUNCTION public.cas_qbo_invoice_link(
  p_invoice_id uuid,
  p_expected_qbo_invoice_id text,
  p_new_qbo_invoice_id text,
  p_qbo_doc_number text DEFAULT NULL,
  p_qbo_emailed_at timestamptz DEFAULT NULL,
  p_qbo_email_status text DEFAULT NULL,
  p_sent_to_email text DEFAULT NULL,
  p_write_email_metadata boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF v_invoice.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice-not-found');
  END IF;
  IF v_invoice.qbo_invoice_id IS DISTINCT FROM p_expected_qbo_invoice_id THEN
    IF v_invoice.qbo_invoice_id IS NOT DISTINCT FROM p_new_qbo_invoice_id THEN
      RETURN jsonb_build_object(
        'ok', true, 'id', v_invoice.id, 'job_id', v_invoice.job_id,
        'contact_id', v_invoice.contact_id,
        'invoice_number', v_invoice.invoice_number,
        'qbo_doc_number', v_invoice.qbo_doc_number,
        'qbo_invoice_id', v_invoice.qbo_invoice_id,
        'idempotent', true
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'qbo-invoice-mismatch',
      'current_qbo_invoice_id', v_invoice.qbo_invoice_id
    );
  END IF;

  UPDATE public.invoices
  SET qbo_invoice_id = p_new_qbo_invoice_id,
      qbo_synced_at = CASE
        WHEN p_new_qbo_invoice_id IS NULL THEN NULL
        ELSE now()
      END,
      qbo_doc_number = CASE
        WHEN p_new_qbo_invoice_id IS NULL THEN NULL
        ELSE COALESCE(p_qbo_doc_number, qbo_doc_number)
      END,
      qbo_emailed_at = CASE
        WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL
        WHEN p_write_email_metadata THEN p_qbo_emailed_at
        ELSE qbo_emailed_at
      END,
      qbo_email_status = CASE
        WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL
        WHEN p_write_email_metadata THEN p_qbo_email_status
        ELSE qbo_email_status
      END,
      sent_to_email = CASE
        WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL
        WHEN p_write_email_metadata THEN p_sent_to_email
        ELSE sent_to_email
      END,
      qbo_sync_error = NULL,
      updated_at = now()
  WHERE id = v_invoice.id
  RETURNING * INTO v_invoice;

  RETURN jsonb_build_object(
    'ok', true, 'id', v_invoice.id, 'job_id', v_invoice.job_id,
    'contact_id', v_invoice.contact_id,
    'invoice_number', v_invoice.invoice_number,
    'qbo_doc_number', v_invoice.qbo_doc_number,
    'qbo_invoice_id', v_invoice.qbo_invoice_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prepare_qbo_invoice_command(
  uuid, uuid, text, uuid, uuid, text, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_qbo_invoice_command(
  uuid, uuid, text, uuid, uuid, text, text, text, text, text, jsonb
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.start_qbo_invoice_command_attempt(
  uuid, text, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_qbo_invoice_command_attempt(
  uuid, text, text, text, text, jsonb, text
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.advance_qbo_invoice_command_attempt(
  uuid, text, text, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_qbo_invoice_command_attempt(
  uuid, text, text, text, text, text, jsonb, text
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_qbo_invoice_command_state(
  uuid, text, jsonb, integer, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_qbo_invoice_command_state(
  uuid, text, jsonb, integer, jsonb, text, text
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_qbo_invoice_command(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_qbo_invoice_command(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cas_qbo_invoice_link(
  uuid, text, text, text, timestamptz, text, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cas_qbo_invoice_link(
  uuid, text, text, text, timestamptz, text, text, boolean
) TO service_role;

NOTIFY pgrst, 'reload schema';
