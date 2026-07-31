-- ════════════════════════════════════════════════
-- MIGRATION: 20260731045407_qbo_multi_invoice_payment_receipts
-- Phase: standalone QBO receipt foundation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a private receipt and audit trail for one QuickBooks payment that pays
--   one or more UPR invoices. Existing payment rows remain the source used by
--   the established database trigger to update invoice and job balances.
--
-- ADDITIVE-ONLY + AUTHORIZATION CONTAINMENT:
--   The receipt schema is additive and there is no backfill or direct change
--   to invoice or job financial totals. This migration also closes the
--   inherited anonymous/broad-policy surface on public.payments before adding
--   a private receipt foreign key; that ACL containment is intentional and is
--   never reversed by the paired rollback.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   The paired containment rollback disables the flag, revokes and drops the
--   new service functions, and deliberately retains all financial audit rows.
-- ════════════════════════════════════════════════

CREATE TABLE public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT,
  qbo_realm_id text NOT NULL,
  qbo_customer_id text NOT NULL,
  qbo_payment_id text,
  qbo_sync_token text,
  txn_date date NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  applied_cents bigint NOT NULL CHECK (applied_cents >= 0),
  unapplied_cents bigint NOT NULL DEFAULT 0 CHECK (unapplied_cents >= 0),
  payment_method text,
  qbo_payment_method_id text,
  qbo_payment_method_name text,
  reference_number text,
  deposit_account_id text,
  deposit_account_name text,
  source text NOT NULL DEFAULT 'qbo' CHECK (source IN ('qbo', 'upr', 'manual')),
  status text NOT NULL CHECK (status IN (
    'draft', 'submitting', 'qbo_created', 'locally_finalized', 'reconciled',
    'unknown_outcome', 'rejected', 'conflict', 'voided', 'deleted'
  )),
  actor_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  qbo_created_at timestamptz,
  qbo_updated_at timestamptz,
  normalized_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_receipts_cents_balance CHECK (total_cents = applied_cents + unapplied_cents),
  CONSTRAINT payment_receipts_snapshot_object CHECK (jsonb_typeof(normalized_snapshot) = 'object'),
  CONSTRAINT payment_receipts_qbo_identity CHECK (
    (status IN ('qbo_created', 'locally_finalized', 'reconciled', 'voided', 'deleted')
      AND qbo_payment_id IS NOT NULL)
    OR status IN ('draft', 'submitting', 'unknown_outcome', 'rejected', 'conflict')
  )
);

CREATE UNIQUE INDEX payment_receipts_qbo_payment_uniq
  ON public.payment_receipts (qbo_realm_id, qbo_payment_id)
  WHERE qbo_payment_id IS NOT NULL;
CREATE INDEX payment_receipts_contact_txn_idx
  ON public.payment_receipts (contact_id, txn_date DESC);
CREATE INDEX payment_receipts_actor_employee_idx
  ON public.payment_receipts (actor_employee_id)
  WHERE actor_employee_id IS NOT NULL;

CREATE TABLE public.payment_receipt_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid REFERENCES public.payment_receipts(id) ON DELETE RESTRICT,
  client_request_id text NOT NULL,
  intuit_request_id text NOT NULL,
  qbo_realm_id text NOT NULL,
  request_fingerprint text NOT NULL,
  request_payload jsonb NOT NULL,
  actor_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'submitting' CHECK (status IN (
    'draft', 'submitting', 'qbo_created', 'locally_finalized', 'reconciled',
    'unknown_outcome', 'rejected', 'conflict', 'voided', 'deleted'
  )),
  qbo_payment_id text,
  provider_snapshot jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_receipt_attempts_request_object CHECK (jsonb_typeof(request_payload) = 'object'),
  CONSTRAINT payment_receipt_attempts_provider_object CHECK (
    provider_snapshot IS NULL OR jsonb_typeof(provider_snapshot) = 'object'
  ),
  CONSTRAINT payment_receipt_attempts_request_ids CHECK (
    length(btrim(client_request_id)) BETWEEN 1 AND 128
    AND length(btrim(intuit_request_id)) BETWEEN 1 AND 50
    AND length(btrim(request_fingerprint)) BETWEEN 16 AND 256
  )
);

CREATE UNIQUE INDEX payment_receipt_attempts_client_request_uniq
  ON public.payment_receipt_attempts (qbo_realm_id, client_request_id);
CREATE UNIQUE INDEX payment_receipt_attempts_intuit_request_uniq
  ON public.payment_receipt_attempts (qbo_realm_id, intuit_request_id);
CREATE UNIQUE INDEX payment_receipt_attempts_qbo_payment_uniq
  ON public.payment_receipt_attempts (qbo_realm_id, qbo_payment_id)
  WHERE qbo_payment_id IS NOT NULL;
CREATE INDEX payment_receipt_attempts_receipt_idx
  ON public.payment_receipt_attempts (receipt_id, created_at DESC);
CREATE INDEX payment_receipt_attempts_actor_employee_idx
  ON public.payment_receipt_attempts (actor_employee_id)
  WHERE actor_employee_id IS NOT NULL;

CREATE TABLE public.payment_receipt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid REFERENCES public.payment_receipts(id) ON DELETE RESTRICT,
  attempt_id uuid REFERENCES public.payment_receipt_attempts(id) ON DELETE RESTRICT,
  qbo_realm_id text,
  qbo_payment_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'reserved', 'qbo_created', 'locally_finalized', 'reconciled', 'voided',
    'deleted', 'rejected', 'conflict', 'unknown_outcome'
  )),
  event_key text,
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_receipt_events_before_object CHECK (
    before_snapshot IS NULL OR jsonb_typeof(before_snapshot) = 'object'
  ),
  CONSTRAINT payment_receipt_events_after_object CHECK (jsonb_typeof(after_snapshot) = 'object')
);

CREATE UNIQUE INDEX payment_receipt_events_event_key_uniq
  ON public.payment_receipt_events (event_key) WHERE event_key IS NOT NULL;
CREATE INDEX payment_receipt_events_receipt_created_idx
  ON public.payment_receipt_events (receipt_id, created_at DESC);
CREATE INDEX payment_receipt_events_attempt_idx
  ON public.payment_receipt_events (attempt_id)
  WHERE attempt_id IS NOT NULL;

-- destructive-approved: owner-approved 2026-07-31 QBO receipt release closes
-- legacy broad payment policies before exposing the receipt link on payments.
REVOKE ALL PRIVILEGES ON TABLE public.payments FROM anon;
DROP POLICY IF EXISTS allow_anon_select_payments ON public.payments;
DROP POLICY IF EXISTS allow_anon_insert_payments ON public.payments;
DROP POLICY IF EXISTS allow_anon_update_payments ON public.payments;
DROP POLICY IF EXISTS allow_anon_delete_payments ON public.payments;
DROP POLICY IF EXISTS allow_authenticated_payments ON public.payments;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.payment_receipts(id) ON DELETE RESTRICT;

-- Reading payment history is available to active internal staff. Mutations use
-- the exact effective canEditBilling boundary: admin (the UI's legacy 'manager'
-- literal is not a current employee_role value). Provider-originated and grouped
-- receipt rows remain worker-owned and cannot be edited or deleted in a browser.
CREATE POLICY payments_internal_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active
        AND NOT employee.is_external
        AND employee.role::text IN (
          'admin',
          'office',
          'project_manager',
          'field_tech',
          'estimator',
          'supervisor'
        )
    )
  );

CREATE POLICY payments_billing_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    receipt_id IS NULL
    AND COALESCE(source, 'manual') = 'manual'
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.id = recorded_by
        AND employee.is_active
        AND NOT employee.is_external
        AND employee.role::text = 'admin'
    )
  );

CREATE POLICY payments_billing_update ON public.payments
  FOR UPDATE TO authenticated
  USING (
    receipt_id IS NULL
    AND COALESCE(source, 'manual') = 'manual'
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active
        AND NOT employee.is_external
        AND employee.role::text = 'admin'
    )
  )
  WITH CHECK (
    receipt_id IS NULL
    AND COALESCE(source, 'manual') = 'manual'
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active
        AND NOT employee.is_external
        AND employee.role::text = 'admin'
    )
  );

CREATE POLICY payments_billing_delete ON public.payments
  FOR DELETE TO authenticated
  USING (
    receipt_id IS NULL
    AND COALESCE(source, 'manual') = 'manual'
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active
        AND NOT employee.is_external
        AND employee.role::text = 'admin'
    )
  );

-- worker-only: receipt identity is accounting/audit linkage. Browser payment
-- writes may continue to use their existing path, but may never set or change
-- this service-owned foreign key directly.
CREATE OR REPLACE FUNCTION public.guard_payment_receipt_link_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.receipt_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id) THEN
    IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_payment_receipt_link_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_payment_receipt_link_write() TO service_role;
CREATE TRIGGER guard_payment_receipt_link_insert
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_receipt_link_write();
CREATE TRIGGER guard_payment_receipt_link_update
  BEFORE UPDATE OF receipt_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_receipt_link_write();

-- Keep payments_qbo_payment_invoice_uniq unchanged: it is the deployed per-invoice
-- deduplication contract used by both the legacy importer and these projections.
CREATE UNIQUE INDEX payments_receipt_invoice_uniq
  ON public.payments (receipt_id, invoice_id) WHERE receipt_id IS NOT NULL;
CREATE INDEX payments_receipt_id_idx ON public.payments (receipt_id) WHERE receipt_id IS NOT NULL;

ALTER TABLE public.qbo_events
  ADD COLUMN IF NOT EXISTS qbo_realm_id text,
  ADD COLUMN IF NOT EXISTS qbo_entity_id text,
  ADD COLUMN IF NOT EXISTS provider_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
CREATE INDEX qbo_events_retry_due_idx
  ON public.qbo_events (next_retry_at, created_at)
  WHERE status = 'retry' AND entity = 'Payment';
CREATE INDEX qbo_events_receipt_processing_idx
  ON public.qbo_events (created_at)
  WHERE status = 'processing' AND entity = 'Payment' AND qbo_entity_id IS NOT NULL;

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipt_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipt_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipt_events FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_receipts_service_read ON public.payment_receipts
  FOR SELECT TO service_role USING (true);
CREATE POLICY payment_receipt_attempts_service_read ON public.payment_receipt_attempts
  FOR SELECT TO service_role USING (true);
CREATE POLICY payment_receipt_events_service_read ON public.payment_receipt_events
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.payment_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payment_receipt_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payment_receipt_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_receipts TO service_role;
GRANT SELECT ON TABLE public.payment_receipt_attempts TO service_role;
GRANT SELECT ON TABLE public.payment_receipt_events TO service_role;

INSERT INTO public.feature_flags (key, enabled, force_disabled, category, label, description, updated_at)
VALUES (
  'feature:qbo_receive_payment', false, false, 'integrations',
  'QuickBooks receive payment',
  'Human-confirmed multi-invoice QBO receipt flow. Disabled until its Worker and UI are deployed and verified.',
  now()
)
ON CONFLICT (key) DO NOTHING;

-- worker-only: the signed QBO webhook and CDC recovery worker atomically claim
-- Payment events with their retry identity; browser roles must never call this.
CREATE OR REPLACE FUNCTION public.claim_qbo_receipt_event(
  p_id text,
  p_entity text,
  p_operation text,
  p_realm_id text,
  p_entity_id text,
  p_provider_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_inserted integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_id), '') IS NULL
     OR p_entity <> 'Payment'
     OR NULLIF(btrim(p_operation), '') IS NULL
     OR NULLIF(btrim(p_realm_id), '') IS NULL
     OR NULLIF(btrim(p_entity_id), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.qbo_events (
    id, entity, operation, status, qbo_realm_id, qbo_entity_id, provider_updated_at
  ) VALUES (
    btrim(p_id), 'Payment', btrim(p_operation), 'processing',
    btrim(p_realm_id), btrim(p_entity_id), p_provider_updated_at
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$function$;

-- worker-only: the admin-authorized QBO receipt worker reserves durable
-- idempotency before any provider mutation; browser roles never call this RPC.
CREATE OR REPLACE FUNCTION public.reserve_qbo_payment_receipt(
  p_client_request_id text,
  p_intuit_request_id text,
  p_realm_id text,
  p_request_fingerprint text,
  p_request jsonb,
  p_actor_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_attempt public.payment_receipt_attempts%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_client_request_id), '') IS NULL
     OR NULLIF(btrim(p_intuit_request_id), '') IS NULL
     OR NULLIF(btrim(p_realm_id), '') IS NULL
     OR NULLIF(btrim(p_request_fingerprint), '') IS NULL
     OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;
  IF p_actor_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTOR' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_realm_id || ':' || p_client_request_id, 0)
  );
  SELECT * INTO v_attempt FROM public.payment_receipt_attempts
  WHERE qbo_realm_id = p_realm_id AND client_request_id = p_client_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'CLIENT_REQUEST_ID_CONFLICT' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('attempt_id', v_attempt.id, 'receipt_id', v_attempt.receipt_id,
      'status', v_attempt.status, 'replayed', true, 'qbo_payment_id', v_attempt.qbo_payment_id);
  END IF;

  INSERT INTO public.payment_receipt_attempts (
    client_request_id, intuit_request_id, qbo_realm_id, request_fingerprint,
    request_payload, actor_employee_id, status
  ) VALUES (
    btrim(p_client_request_id), btrim(p_intuit_request_id), btrim(p_realm_id),
    btrim(p_request_fingerprint), p_request, p_actor_employee_id, 'submitting'
  ) RETURNING * INTO v_attempt;
  INSERT INTO public.payment_receipt_events (attempt_id, qbo_realm_id, event_type, after_snapshot)
  VALUES (v_attempt.id, v_attempt.qbo_realm_id, 'reserved', jsonb_build_object('status', v_attempt.status));
  RETURN jsonb_build_object('attempt_id', v_attempt.id, 'status', v_attempt.status, 'replayed', false);
END;
$function$;

-- worker-only: the admin-authorized QBO receipt worker binds a provider Payment
-- identity to its durable attempt after provider readback.
CREATE OR REPLACE FUNCTION public.mark_qbo_payment_receipt_created(
  p_attempt_id uuid,
  p_qbo_payment_id text,
  p_provider_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_attempt public.payment_receipt_attempts%ROWTYPE;
  v_claimed_attempt_id uuid;
  v_tombstone_event_id uuid;
  v_tombstone_status text;
  v_payment_id text;
  v_realm_id text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_attempt_id IS NULL OR NULLIF(btrim(p_qbo_payment_id), '') IS NULL
     OR p_provider_snapshot IS NULL OR jsonb_typeof(p_provider_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;
  SELECT qbo_realm_id INTO v_realm_id
  FROM public.payment_receipt_attempts
  WHERE id = p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_payment_id := btrim(p_qbo_payment_id);
  -- Every receipt RPC that needs both locks takes the realm/payment advisory
  -- lock before an attempt row lock. Webhook-first reconciliation uses the same
  -- order, so a fast provider event cannot deadlock the outbound request.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_realm_id || ':' || v_payment_id, 0)
  );
  SELECT * INTO v_attempt
  FROM public.payment_receipt_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_attempt.qbo_payment_id = v_payment_id
     AND v_attempt.status IN ('qbo_created', 'locally_finalized', 'reconciled') THEN
    RETURN jsonb_build_object('attempt_id', p_attempt_id, 'qbo_payment_id', v_attempt.qbo_payment_id, 'status', v_attempt.status, 'replayed', true);
  END IF;
  IF v_attempt.qbo_payment_id = v_payment_id AND v_attempt.status = 'conflict' THEN
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'qbo_payment_id', v_attempt.qbo_payment_id,
      'status', v_attempt.status,
      'conflict', true,
      'replayed', true
    );
  END IF;
  IF v_attempt.qbo_payment_id = v_payment_id AND v_attempt.status IN ('voided', 'deleted') THEN
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'qbo_payment_id', v_attempt.qbo_payment_id,
      'status', v_attempt.status,
      'ignored_terminal', true,
      'replayed', true
    );
  END IF;
  IF v_attempt.qbo_payment_id IS NOT NULL AND v_attempt.qbo_payment_id <> v_payment_id THEN
    RAISE EXCEPTION 'QBO_PAYMENT_ID_CONFLICT' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_claimed_attempt_id
  FROM public.payment_receipt_attempts
  WHERE qbo_realm_id = v_attempt.qbo_realm_id
    AND qbo_payment_id = v_payment_id
    AND id <> p_attempt_id
  LIMIT 1;
  IF FOUND THEN
    UPDATE public.payment_receipt_attempts
    SET status = 'conflict',
        provider_snapshot = p_provider_snapshot,
        error_code = 'QBO_PAYMENT_ID_CONFLICT',
        error_message = 'QuickBooks Payment identity is already claimed by another receipt attempt',
        updated_at = now()
    WHERE id = p_attempt_id;
    INSERT INTO public.payment_receipt_events (
      attempt_id, qbo_realm_id, qbo_payment_id, event_type, after_snapshot
    ) VALUES (
      p_attempt_id, v_attempt.qbo_realm_id, v_payment_id, 'conflict',
      jsonb_build_object(
        'status', 'conflict',
        'error_code', 'QBO_PAYMENT_ID_CONFLICT',
        'claimed_attempt_id', v_claimed_attempt_id
      )
    );
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'qbo_payment_id', v_payment_id,
      'status', 'conflict',
      'conflict', true,
      'claimed_attempt_id', v_claimed_attempt_id
    );
  END IF;

  SELECT e.id, e.event_type
    INTO v_tombstone_event_id, v_tombstone_status
  FROM public.payment_receipt_events e
  WHERE e.qbo_realm_id = v_attempt.qbo_realm_id
    AND e.qbo_payment_id = v_payment_id
    AND e.event_type IN ('conflict', 'voided', 'deleted')
  ORDER BY CASE e.event_type
      WHEN 'deleted' THEN 3
      WHEN 'voided' THEN 2
      ELSE 1
    END DESC,
    e.created_at DESC,
    e.id DESC
  LIMIT 1;
  IF FOUND THEN
    UPDATE public.payment_receipt_attempts
    SET qbo_payment_id = v_payment_id,
        provider_snapshot = p_provider_snapshot,
        status = v_tombstone_status,
        updated_at = now()
    WHERE id = p_attempt_id;
    INSERT INTO public.payment_receipt_events (
      attempt_id, qbo_realm_id, qbo_payment_id, event_type, after_snapshot
    ) VALUES (
      p_attempt_id, v_attempt.qbo_realm_id, v_payment_id, v_tombstone_status,
      jsonb_build_object(
        'status', v_tombstone_status,
        'absorbed_tombstone', true,
        'tombstone_event_id', v_tombstone_event_id
      )
    );
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'qbo_payment_id', v_payment_id,
      'status', v_tombstone_status,
      'ignored_terminal', true,
      'replayed', true
    );
  END IF;

  UPDATE public.payment_receipt_attempts SET qbo_payment_id = v_payment_id,
    provider_snapshot = p_provider_snapshot, status = 'qbo_created', updated_at = now() WHERE id = p_attempt_id;
  INSERT INTO public.payment_receipt_events (attempt_id, qbo_realm_id, qbo_payment_id, event_type, after_snapshot)
  VALUES (p_attempt_id, v_attempt.qbo_realm_id, v_payment_id, 'qbo_created', p_provider_snapshot);
  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'qbo_payment_id', v_payment_id, 'status', 'qbo_created');
END;
$function$;

-- worker-only: the admin-authorized QBO receipt worker transactionally creates
-- the receipt header and invoice-level payment projections after exact readback.
CREATE OR REPLACE FUNCTION public.finalize_qbo_payment_receipt(
  p_attempt_id uuid,
  p_receipt jsonb,
  p_allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_attempt public.payment_receipt_attempts%ROWTYPE;
  v_receipt public.payment_receipts%ROWTYPE;
  v_item jsonb;
  v_invoice record;
  v_contact_id uuid;
  v_total bigint;
  v_applied bigint;
  v_unapplied bigint;
  v_sum bigint := 0;
  v_payment_method text;
  v_actor uuid;
  v_source text;
  v_qbo_payment_id text;
  v_qbo_realm_id text;
  v_qbo_customer_id text;
  v_receipt_id uuid;
  v_invoice_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_attempt_id IS NULL OR p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object'
     OR p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_array_length(p_allocations) = 0 OR jsonb_array_length(p_allocations) > 100 THEN
    RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;
  v_qbo_realm_id := NULLIF(btrim(p_receipt->>'qbo_realm_id'), '');
  v_qbo_customer_id := NULLIF(btrim(p_receipt->>'qbo_customer_id'), '');
  v_qbo_payment_id := NULLIF(btrim(p_receipt->>'qbo_payment_id'), '');
  v_total := (p_receipt->>'total_cents')::bigint;
  v_applied := (p_receipt->>'applied_cents')::bigint;
  v_unapplied := COALESCE((p_receipt->>'unapplied_cents')::bigint, 0);
  v_payment_method := NULLIF(btrim(p_receipt->>'payment_method'), '');
  v_actor := NULLIF(p_receipt->>'actor_employee_id', '')::uuid;
  v_source := COALESCE(NULLIF(btrim(p_receipt->>'source'), ''), 'qbo');
  IF v_qbo_realm_id IS NULL OR v_qbo_customer_id IS NULL OR v_qbo_payment_id IS NULL
     OR v_total IS NULL OR v_applied IS NULL OR v_total <= 0 OR v_applied <= 0 OR v_unapplied < 0 OR v_total <> v_applied + v_unapplied
     OR v_source NOT IN ('qbo', 'upr', 'manual')
     OR (v_payment_method IS NOT NULL AND v_payment_method NOT IN ('check','ach','eft','credit_card','wire','cash','insurance_direct','other'))
     OR jsonb_typeof(COALESCE(p_receipt->'normalized_snapshot', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_RECEIPT' USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_actor AND e.is_active IS TRUE AND e.is_external IS FALSE) THEN
    RAISE EXCEPTION 'INVALID_ACTOR' USING ERRCODE = '42501';
  END IF;
  -- Match mark/reconcile lock order: payment advisory first, attempt row second.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_qbo_realm_id || ':' || v_qbo_payment_id, 0));
  -- Distinct Payments for one customer can touch the same invoice. Serialize
  -- that customer's projection mutations before taking compatible invoice
  -- validation locks, so the payment rollup trigger never has two sessions
  -- trying to upgrade the same invoice/job locks.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('qbo-receipt-customer:' || v_qbo_realm_id || ':' || v_qbo_customer_id, 0)
  );
  SELECT * INTO v_attempt
  FROM public.payment_receipt_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_attempt.receipt_id IS NOT NULL THEN
    RETURN jsonb_build_object('receipt_id', v_attempt.receipt_id, 'attempt_id', p_attempt_id, 'status', v_attempt.status, 'replayed', true);
  END IF;
  IF v_attempt.qbo_payment_id IS NULL THEN RAISE EXCEPTION 'QBO_PAYMENT_NOT_RECORDED' USING ERRCODE = '23514'; END IF;
  IF v_qbo_realm_id <> v_attempt.qbo_realm_id OR v_qbo_payment_id <> v_attempt.qbo_payment_id THEN
    RAISE EXCEPTION 'ATTEMPT_RECEIPT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_receipt_events e
    WHERE e.qbo_realm_id = v_qbo_realm_id
      AND e.qbo_payment_id = v_qbo_payment_id
      AND e.event_type IN ('voided', 'deleted')
  ) THEN
    RAISE EXCEPTION 'QBO_PAYMENT_TERMINAL' USING ERRCODE = '23514';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR NULLIF(v_item->>'invoice_id', '') IS NULL
       OR NULLIF(v_item->>'qbo_invoice_id', '') IS NULL OR (v_item->>'amount_cents')::bigint <= 0
       OR COALESCE(v_item->>'payer_type', 'homeowner') NOT IN ('insurance','homeowner','other') THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION' USING ERRCODE = '22023';
    END IF;
    SELECT i.id, i.job_id, i.contact_id, i.qbo_invoice_id, c.qbo_customer_id
      INTO v_invoice FROM public.invoices i JOIN public.contacts c ON c.id = i.contact_id
      WHERE i.id = (v_item->>'invoice_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_invoice.qbo_invoice_id IS DISTINCT FROM v_item->>'qbo_invoice_id'
       OR v_invoice.qbo_customer_id IS DISTINCT FROM v_qbo_customer_id THEN
      RAISE EXCEPTION 'ALLOCATION_INVOICE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    IF v_contact_id IS NULL THEN v_contact_id := v_invoice.contact_id;
    ELSIF v_contact_id <> v_invoice.contact_id THEN RAISE EXCEPTION 'CROSS_CONTACT_ALLOCATION' USING ERRCODE = '23514'; END IF;
    IF (v_item->>'invoice_id')::uuid = ANY(v_invoice_ids) THEN RAISE EXCEPTION 'DUPLICATE_INVOICE_ALLOCATION' USING ERRCODE = '23505'; END IF;
    v_invoice_ids := array_append(v_invoice_ids, (v_item->>'invoice_id')::uuid);
    v_sum := v_sum + (v_item->>'amount_cents')::bigint;
  END LOOP;
  IF v_sum <> v_applied THEN RAISE EXCEPTION 'ALLOCATION_SUM_MISMATCH' USING ERRCODE = '23514'; END IF;

  INSERT INTO public.payment_receipts (
    contact_id, qbo_realm_id, qbo_customer_id, qbo_payment_id, qbo_sync_token, txn_date,
    total_cents, applied_cents, unapplied_cents, payment_method, qbo_payment_method_id,
    qbo_payment_method_name, reference_number, deposit_account_id, deposit_account_name,
    source, status, actor_employee_id, qbo_created_at, qbo_updated_at, normalized_snapshot
  ) VALUES (
    v_contact_id, v_qbo_realm_id, v_qbo_customer_id, v_qbo_payment_id, p_receipt->>'qbo_sync_token',
    (p_receipt->>'txn_date')::date, v_total, v_applied, v_unapplied, v_payment_method,
    p_receipt->>'qbo_payment_method_id', p_receipt->>'qbo_payment_method_name', p_receipt->>'reference_number',
    p_receipt->>'deposit_account_id', p_receipt->>'deposit_account_name', v_source, 'locally_finalized',
    COALESCE(v_actor, v_attempt.actor_employee_id), NULLIF(p_receipt->>'qbo_created_at', '')::timestamptz,
    NULLIF(p_receipt->>'qbo_updated_at', '')::timestamptz, COALESCE(p_receipt->'normalized_snapshot', '{}'::jsonb)
  ) ON CONFLICT (qbo_realm_id, qbo_payment_id) WHERE qbo_payment_id IS NOT NULL DO UPDATE SET
    qbo_sync_token = EXCLUDED.qbo_sync_token, txn_date = EXCLUDED.txn_date, total_cents = EXCLUDED.total_cents,
    applied_cents = EXCLUDED.applied_cents, unapplied_cents = EXCLUDED.unapplied_cents,
    payment_method = EXCLUDED.payment_method, qbo_payment_method_id = EXCLUDED.qbo_payment_method_id,
    qbo_payment_method_name = EXCLUDED.qbo_payment_method_name, reference_number = EXCLUDED.reference_number,
    deposit_account_id = EXCLUDED.deposit_account_id, deposit_account_name = EXCLUDED.deposit_account_name,
    source = EXCLUDED.source,
    status = CASE
      WHEN public.payment_receipts.status = 'reconciled' THEN 'reconciled'
      ELSE 'locally_finalized'
    END,
    qbo_updated_at = EXCLUDED.qbo_updated_at,
    normalized_snapshot = EXCLUDED.normalized_snapshot, updated_at = now()
  RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    SELECT i.id, i.job_id, i.contact_id INTO v_invoice FROM public.invoices i WHERE i.id = (v_item->>'invoice_id')::uuid FOR SHARE;
    INSERT INTO public.payments (receipt_id, invoice_id, job_id, contact_id, amount, payment_date, payer_type,
      payment_method, reference_number, recorded_by, source, qbo_payment_id, qbo_synced_at, qbo_sync_error)
    VALUES (v_receipt_id, v_invoice.id, v_invoice.job_id, v_invoice.contact_id,
      ((v_item->>'amount_cents')::numeric / 100), (p_receipt->>'txn_date')::date,
      COALESCE(v_item->>'payer_type', 'homeowner'), v_payment_method, p_receipt->>'reference_number',
      COALESCE(v_actor, v_attempt.actor_employee_id), v_source, v_qbo_payment_id, now(), NULL)
    ON CONFLICT (qbo_payment_id, invoice_id) WHERE qbo_payment_id IS NOT NULL DO UPDATE SET
      receipt_id = EXCLUDED.receipt_id, amount = EXCLUDED.amount, payment_date = EXCLUDED.payment_date,
      payer_type = EXCLUDED.payer_type, payment_method = EXCLUDED.payment_method,
      reference_number = EXCLUDED.reference_number, qbo_synced_at = EXCLUDED.qbo_synced_at, qbo_sync_error = NULL;
  END LOOP;
  UPDATE public.payment_receipt_attempts SET receipt_id = v_receipt_id, status = 'locally_finalized', updated_at = now() WHERE id = p_attempt_id;
  INSERT INTO public.payment_receipt_events (receipt_id, attempt_id, qbo_realm_id, qbo_payment_id, event_type, after_snapshot)
  VALUES (v_receipt_id, p_attempt_id, v_qbo_realm_id, v_qbo_payment_id, 'locally_finalized', p_receipt);
  RETURN jsonb_build_object('receipt_id', v_receipt_id, 'attempt_id', p_attempt_id, 'status', 'locally_finalized', 'replayed', false);
END;
$function$;

-- worker-only: signed webhook and CDC workers replace the complete provider
-- allocation projection; browser roles never reconcile financial state.
CREATE OR REPLACE FUNCTION public.reconcile_qbo_payment_receipt(
  p_receipt jsonb,
  p_allocations jsonb,
  p_event_type text DEFAULT 'reconciled',
  p_event_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_receipt_id uuid;
  v_existing_event uuid;
  v_item jsonb;
  v_invoice record;
  v_qbo_realm_id text := NULLIF(btrim(p_receipt->>'qbo_realm_id'), '');
  v_qbo_customer_id text := NULLIF(btrim(p_receipt->>'qbo_customer_id'), '');
  v_qbo_payment_id text := NULLIF(btrim(p_receipt->>'qbo_payment_id'), '');
  v_contact_id uuid;
  v_invoice_ids uuid[] := ARRAY[]::uuid[];
  v_total bigint := (p_receipt->>'total_cents')::bigint;
  v_applied bigint := (p_receipt->>'applied_cents')::bigint;
  v_unapplied bigint := COALESCE((p_receipt->>'unapplied_cents')::bigint, 0);
  v_payment_method text := NULLIF(btrim(p_receipt->>'payment_method'), '');
  v_actor uuid := NULLIF(p_receipt->>'actor_employee_id', '')::uuid;
  v_source text := COALESCE(NULLIF(btrim(p_receipt->>'source'), ''), 'qbo');
  v_sum bigint := 0;
  v_preserve_upr boolean := false;
  v_attempt_id uuid := NULLIF(p_receipt->>'attempt_id', '')::uuid;
  v_existing_receipt public.payment_receipts%ROWTYPE;
  v_incoming_updated_at timestamptz := NULLIF(p_receipt->>'qbo_updated_at', '')::timestamptz;
  v_incoming_sync_token text := NULLIF(btrim(p_receipt->>'qbo_sync_token'), '');
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object' OR p_allocations IS NULL
     OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0
     OR jsonb_array_length(p_allocations) > 100
     OR v_qbo_realm_id IS NULL OR v_qbo_customer_id IS NULL OR v_qbo_payment_id IS NULL
     OR p_event_type <> 'reconciled' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  IF v_total IS NULL OR v_applied IS NULL OR v_total <= 0 OR v_applied <= 0 OR v_unapplied < 0 OR v_total <> v_applied + v_unapplied
     OR v_source NOT IN ('qbo', 'upr', 'manual')
     OR (v_payment_method IS NOT NULL AND v_payment_method NOT IN ('check','ach','eft','credit_card','wire','cash','insurance_direct','other'))
     OR jsonb_typeof(COALESCE(p_receipt->'normalized_snapshot', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_RECEIPT' USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_actor AND e.is_active IS TRUE AND e.is_external IS FALSE) THEN
    RAISE EXCEPTION 'INVALID_ACTOR' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_qbo_realm_id || ':' || v_qbo_payment_id, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('qbo-receipt-customer:' || v_qbo_realm_id || ':' || v_qbo_customer_id, 0)
  );
  -- Check the event key only after the per-payment lock. Two Workers can receive
  -- the same webhook envelope concurrently; the second must return a replay
  -- instead of colliding on the unique event-key index.
  IF p_event_key IS NOT NULL THEN
    SELECT id INTO v_existing_event FROM public.payment_receipt_events WHERE event_key = p_event_key;
    IF FOUND THEN RETURN jsonb_build_object('event_id', v_existing_event, 'replayed', true); END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_receipt_events e
    WHERE e.qbo_realm_id = v_qbo_realm_id
      AND e.qbo_payment_id = v_qbo_payment_id
      AND e.event_type IN ('voided', 'deleted')
  ) THEN
    RETURN jsonb_build_object('status', 'terminal', 'ignored_terminal', true, 'replayed', true);
  END IF;
  SELECT * INTO v_existing_receipt
  FROM public.payment_receipts r
  WHERE r.qbo_realm_id = v_qbo_realm_id AND r.qbo_payment_id = v_qbo_payment_id
  FOR UPDATE;
  v_preserve_upr := FOUND AND v_existing_receipt.source = 'upr';
  -- Intuit says webhook notifications may arrive out of order. CDC can also
  -- overlap the webhook. Never let an older provider snapshot replace the
  -- newest accepted allocations; retain the stale event as audit evidence.
  IF FOUND AND (
    (v_existing_receipt.qbo_updated_at IS NOT NULL AND (
      v_incoming_updated_at IS NULL
      OR v_incoming_updated_at < v_existing_receipt.qbo_updated_at
    ))
    OR (
      v_existing_receipt.qbo_sync_token ~ '^[0-9]+$'
      AND (
        v_incoming_updated_at IS NULL
        OR v_existing_receipt.qbo_updated_at IS NULL
        OR v_incoming_updated_at = v_existing_receipt.qbo_updated_at
      )
      AND (
        v_incoming_sync_token IS NULL
        OR v_incoming_sync_token !~ '^[0-9]+$'
        OR v_incoming_sync_token::numeric < v_existing_receipt.qbo_sync_token::numeric
      )
    )
  ) THEN
    INSERT INTO public.payment_receipt_events (
      receipt_id, qbo_realm_id, qbo_payment_id, event_type, event_key, after_snapshot
    ) VALUES (
      v_existing_receipt.id, v_qbo_realm_id, v_qbo_payment_id, p_event_type, p_event_key,
      p_receipt || jsonb_build_object('upr_reconciliation_result', 'ignored_stale')
    );
    RETURN jsonb_build_object(
      'receipt_id', v_existing_receipt.id,
      'status', v_existing_receipt.status,
      'ignored_stale', true,
      'replayed', true
    );
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR NULLIF(v_item->>'invoice_id', '') IS NULL
       OR NULLIF(v_item->>'qbo_invoice_id', '') IS NULL OR (v_item->>'amount_cents')::bigint <= 0
       OR COALESCE(v_item->>'payer_type', 'homeowner') NOT IN ('insurance','homeowner','other') THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION' USING ERRCODE = '22023';
    END IF;
    SELECT i.id, i.job_id, i.contact_id, i.qbo_invoice_id, c.qbo_customer_id INTO v_invoice
    FROM public.invoices i JOIN public.contacts c ON c.id = i.contact_id
    WHERE i.id = (v_item->>'invoice_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_invoice.qbo_invoice_id IS DISTINCT FROM v_item->>'qbo_invoice_id'
       OR v_invoice.qbo_customer_id IS DISTINCT FROM v_qbo_customer_id
       OR (v_item->>'invoice_id')::uuid = ANY(v_invoice_ids) THEN
      RAISE EXCEPTION 'ALLOCATION_INVOICE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    IF v_contact_id IS NULL THEN v_contact_id := v_invoice.contact_id;
    ELSIF v_contact_id <> v_invoice.contact_id THEN RAISE EXCEPTION 'CROSS_CONTACT_ALLOCATION' USING ERRCODE = '23514'; END IF;
    v_invoice_ids := array_append(v_invoice_ids, (v_item->>'invoice_id')::uuid);
    v_sum := v_sum + (v_item->>'amount_cents')::bigint;
  END LOOP;
  IF v_sum <> v_applied THEN RAISE EXCEPTION 'ALLOCATION_SUM_MISMATCH' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.payment_receipts (
    contact_id, qbo_realm_id, qbo_customer_id, qbo_payment_id, qbo_sync_token, txn_date,
    total_cents, applied_cents, unapplied_cents, payment_method, qbo_payment_method_id,
    qbo_payment_method_name, reference_number, deposit_account_id, deposit_account_name,
    source, status, actor_employee_id, qbo_created_at, qbo_updated_at, normalized_snapshot
  ) VALUES (
    v_contact_id, v_qbo_realm_id, v_qbo_customer_id, v_qbo_payment_id, p_receipt->>'qbo_sync_token',
    (p_receipt->>'txn_date')::date, v_total, v_applied, v_unapplied, v_payment_method,
    p_receipt->>'qbo_payment_method_id', p_receipt->>'qbo_payment_method_name', p_receipt->>'reference_number',
    p_receipt->>'deposit_account_id', p_receipt->>'deposit_account_name', v_source, 'reconciled', v_actor,
    NULLIF(p_receipt->>'qbo_created_at', '')::timestamptz, NULLIF(p_receipt->>'qbo_updated_at', '')::timestamptz,
    COALESCE(p_receipt->'normalized_snapshot', '{}'::jsonb)
  ) ON CONFLICT (qbo_realm_id, qbo_payment_id) WHERE qbo_payment_id IS NOT NULL DO UPDATE SET
    contact_id = EXCLUDED.contact_id, qbo_customer_id = EXCLUDED.qbo_customer_id,
    qbo_sync_token = EXCLUDED.qbo_sync_token, txn_date = EXCLUDED.txn_date, total_cents = EXCLUDED.total_cents,
    applied_cents = EXCLUDED.applied_cents, unapplied_cents = EXCLUDED.unapplied_cents,
    payment_method = EXCLUDED.payment_method, qbo_payment_method_id = EXCLUDED.qbo_payment_method_id,
    qbo_payment_method_name = EXCLUDED.qbo_payment_method_name, reference_number = EXCLUDED.reference_number,
    deposit_account_id = EXCLUDED.deposit_account_id, deposit_account_name = EXCLUDED.deposit_account_name,
    source = CASE
      WHEN public.payment_receipts.source = 'upr' THEN public.payment_receipts.source
      ELSE EXCLUDED.source
    END,
    status = 'reconciled', qbo_updated_at = EXCLUDED.qbo_updated_at,
    normalized_snapshot = EXCLUDED.normalized_snapshot, updated_at = now()
  RETURNING id INTO v_receipt_id;
  SELECT (r.source = 'upr') INTO v_preserve_upr
  FROM public.payment_receipts r WHERE r.id = v_receipt_id;
  DELETE FROM public.payments p WHERE p.receipt_id = v_receipt_id AND NOT (p.invoice_id = ANY(v_invoice_ids));
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    SELECT i.id, i.job_id, i.contact_id INTO v_invoice FROM public.invoices i WHERE i.id = (v_item->>'invoice_id')::uuid FOR SHARE;
    INSERT INTO public.payments (receipt_id, invoice_id, job_id, contact_id, amount, payment_date, payer_type,
      payment_method, reference_number, recorded_by, source, qbo_payment_id, qbo_synced_at, qbo_sync_error)
    VALUES (v_receipt_id, v_invoice.id, v_invoice.job_id, v_invoice.contact_id,
      ((v_item->>'amount_cents')::numeric / 100), (p_receipt->>'txn_date')::date,
      COALESCE(v_item->>'payer_type', 'homeowner'), v_payment_method, p_receipt->>'reference_number', v_actor,
      v_source, v_qbo_payment_id, now(), NULL)
    ON CONFLICT (qbo_payment_id, invoice_id) WHERE qbo_payment_id IS NOT NULL DO UPDATE SET
      receipt_id = EXCLUDED.receipt_id, amount = EXCLUDED.amount, payment_date = EXCLUDED.payment_date,
      payer_type = CASE WHEN v_preserve_upr THEN public.payments.payer_type ELSE EXCLUDED.payer_type END,
      payment_method = EXCLUDED.payment_method,
      reference_number = EXCLUDED.reference_number, qbo_synced_at = EXCLUDED.qbo_synced_at, qbo_sync_error = NULL;
  END LOOP;
  IF v_attempt_id IS NOT NULL THEN
    UPDATE public.payment_receipt_attempts a
    SET receipt_id = v_receipt_id,
        qbo_payment_id = v_qbo_payment_id,
        provider_snapshot = COALESCE(p_receipt->'normalized_snapshot', '{}'::jsonb),
        status = 'reconciled',
        updated_at = now()
    WHERE a.id = v_attempt_id
      AND a.qbo_realm_id = v_qbo_realm_id
      AND (a.qbo_payment_id IS NULL OR a.qbo_payment_id = v_qbo_payment_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ATTEMPT_RECEIPT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  INSERT INTO public.payment_receipt_events (receipt_id, qbo_realm_id, qbo_payment_id, event_type, event_key, after_snapshot)
  VALUES (v_receipt_id, v_qbo_realm_id, v_qbo_payment_id, p_event_type, p_event_key, p_receipt);
  RETURN jsonb_build_object('receipt_id', v_receipt_id, 'status', 'reconciled', 'replayed', false);
END;
$function$;

-- worker-only: signed webhook and CDC workers apply provider terminal/conflict
-- state while retaining the grouped financial audit record.
CREATE OR REPLACE FUNCTION public.remove_qbo_payment_receipt(
  p_qbo_realm_id text,
  p_qbo_payment_id text,
  p_status text,
  p_event_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_receipt public.payment_receipts%ROWTYPE;
  v_removed integer;
  v_attempt_id uuid;
  v_effective_status text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_qbo_realm_id), '') IS NULL OR NULLIF(btrim(p_qbo_payment_id), '') IS NULL
     OR p_status NOT IN ('conflict', 'voided', 'deleted') THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(btrim(p_qbo_realm_id) || ':' || btrim(p_qbo_payment_id), 0)
  );
  IF p_event_key IS NOT NULL AND EXISTS (SELECT 1 FROM public.payment_receipt_events WHERE event_key = p_event_key) THEN
    RETURN jsonb_build_object('replayed', true);
  END IF;
  SELECT * INTO v_receipt FROM public.payment_receipts
  WHERE qbo_realm_id = btrim(p_qbo_realm_id) AND qbo_payment_id = btrim(p_qbo_payment_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    v_effective_status := p_status;
    UPDATE public.payment_receipt_attempts
    SET status = CASE
          WHEN status = 'deleted' THEN 'deleted'
          WHEN status = 'voided' AND p_status = 'conflict' THEN 'voided'
          ELSE p_status
        END,
        updated_at = now()
    WHERE qbo_realm_id = btrim(p_qbo_realm_id)
      AND qbo_payment_id = btrim(p_qbo_payment_id)
    RETURNING id, status INTO v_attempt_id, v_effective_status;
    IF NOT FOUND THEN v_effective_status := p_status; END IF;
    INSERT INTO public.payment_receipt_events (
      attempt_id, qbo_realm_id, qbo_payment_id, event_type, event_key, after_snapshot
    ) VALUES (
      v_attempt_id, btrim(p_qbo_realm_id), btrim(p_qbo_payment_id), p_status, p_event_key,
      jsonb_build_object('status', v_effective_status, 'tombstone', true)
    );
    RETURN jsonb_build_object('removed', 0, 'missing', true, 'tombstone', true, 'status', v_effective_status);
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'qbo-receipt-customer:' || v_receipt.qbo_realm_id || ':' || v_receipt.qbo_customer_id,
      0
    )
  );
  DELETE FROM public.payments WHERE receipt_id = v_receipt.id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_effective_status := CASE
    WHEN v_receipt.status = 'deleted' THEN 'deleted'
    WHEN v_receipt.status = 'voided' AND p_status = 'conflict' THEN 'voided'
    ELSE p_status
  END;
  UPDATE public.payment_receipts SET status = v_effective_status, updated_at = now() WHERE id = v_receipt.id;
  UPDATE public.payment_receipt_attempts
  SET receipt_id = COALESCE(receipt_id, v_receipt.id),
      status = v_effective_status,
      updated_at = now()
  WHERE receipt_id = v_receipt.id
     OR (
       qbo_realm_id = v_receipt.qbo_realm_id
       AND qbo_payment_id = v_receipt.qbo_payment_id
     );
  INSERT INTO public.payment_receipt_events (receipt_id, qbo_realm_id, qbo_payment_id, event_type, event_key, after_snapshot)
  VALUES (v_receipt.id, v_receipt.qbo_realm_id, v_receipt.qbo_payment_id, p_status, p_event_key, jsonb_build_object('status', v_effective_status));
  RETURN jsonb_build_object('receipt_id', v_receipt.id, 'removed', v_removed, 'status', v_effective_status, 'replayed', false);
END;
$function$;

-- worker-only: the admin-authorized QBO receipt worker records deterministic or
-- unknown provider outcomes without exposing the attempt table to browsers.
CREATE OR REPLACE FUNCTION public.fail_qbo_payment_receipt_attempt(
  p_attempt_id uuid,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_attempt public.payment_receipt_attempts%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_attempt_id IS NULL OR p_status NOT IN ('unknown_outcome', 'rejected', 'conflict') THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_attempt FROM public.payment_receipt_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_attempt.status IN ('conflict', 'locally_finalized', 'reconciled', 'voided', 'deleted') THEN
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'status', v_attempt.status,
      'replayed', true,
      'ignored_downgrade', true
    );
  END IF;
  UPDATE public.payment_receipt_attempts SET status = p_status, error_code = NULLIF(btrim(p_error_code), ''),
    error_message = NULLIF(left(btrim(p_error_message), 1000), ''), updated_at = now() WHERE id = p_attempt_id;
  INSERT INTO public.payment_receipt_events (attempt_id, receipt_id, qbo_realm_id, qbo_payment_id, event_type, after_snapshot)
  VALUES (v_attempt.id, v_attempt.receipt_id, v_attempt.qbo_realm_id, v_attempt.qbo_payment_id, p_status,
    jsonb_build_object('status', p_status, 'error_code', NULLIF(btrim(p_error_code), '')));
  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'status', p_status);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_qbo_receipt_event(text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_qbo_receipt_event(text, text, text, text, text, timestamptz) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reserve_qbo_payment_receipt(text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_qbo_payment_receipt(text, text, text, text, jsonb, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.mark_qbo_payment_receipt_created(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_qbo_payment_receipt_created(uuid, text, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.remove_qbo_payment_receipt(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_qbo_payment_receipt(text, text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fail_qbo_payment_receipt_attempt(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_qbo_payment_receipt_attempt(uuid, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
