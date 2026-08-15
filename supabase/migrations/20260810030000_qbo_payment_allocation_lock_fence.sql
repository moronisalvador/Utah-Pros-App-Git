-- ════════════════════════════════════════════════
-- MIGRATION: 20260810030000_qbo_payment_allocation_lock_fence
-- Phase: standalone QBO grouped-receipt lock boundary
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Keeps a person from locking an invoice while a submitted payment is still
--   being checked or saved. It also stops a payment from being saved if someone
--   managed to lock the invoice in the small gap before the final local record.
--   A failed or completed payment removes its temporary hold; an uncertain
--   QuickBooks result keeps it until the original request is recovered.
--
-- ADDITIVE-ONLY / attribute-only:
--   Adds one service-only fence table and two triggers; replaces only the
--   existing reservation function without changing its signature or return
--   shape. No table DROP/RENAME/column change and no data rewrite.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260810030000_qbo_payment_allocation_lock_fence.rollback.sql
--   restores the preceding reservation body, then removes the new triggers,
--   helper functions, and empty fence table. It refuses while an active fence
--   remains, so an uncertain provider result is never silently unprotected.
-- ════════════════════════════════════════════════

CREATE TABLE public.qbo_payment_allocation_fences (
  attempt_id uuid NOT NULL REFERENCES public.payment_receipt_attempts(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  qbo_realm_id text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, invoice_id),
  CONSTRAINT qbo_payment_allocation_fences_one_active_attempt UNIQUE (invoice_id)
);

ALTER TABLE public.qbo_payment_allocation_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_payment_allocation_fences FORCE ROW LEVEL SECURITY;
CREATE POLICY qbo_payment_allocation_fences_service_only
  ON public.qbo_payment_allocation_fences
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.qbo_payment_allocation_fences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.qbo_payment_allocation_fences TO service_role;

-- All invoice rows are locked in UUID order before inspecting or inserting a
-- fence. A manual false->true lock takes the same invoice row lock, so either
-- it commits first and this refuses, or this commits first and its trigger
-- refuses the manual lock. The unique invoice key is a second defense against
-- a future caller that misses this helper.
CREATE OR REPLACE FUNCTION public.establish_qbo_payment_allocation_fences(
  p_attempt_id uuid,
  p_realm_id text,
  p_request jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
  v_invoice_ids uuid[] := ARRAY[]::uuid[];
  v_contact_id uuid := NULLIF(p_request->>'contact_id', '')::uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL OR NULLIF(btrim(p_realm_id), '') IS NULL
     OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
     OR jsonb_typeof(p_request->'allocations') <> 'array'
     OR jsonb_array_length(p_request->'allocations') = 0
     OR jsonb_array_length(p_request->'allocations') > 100
     OR v_contact_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    WITH requested AS (
      SELECT
        NULLIF(value->>'invoice_id', '')::uuid AS invoice_id,
        NULLIF(value->>'amount_cents', '')::bigint AS amount_cents
      FROM jsonb_array_elements(p_request->'allocations')
    )
    SELECT i.id, i.locked, r.amount_cents
    FROM requested r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE i.contact_id = v_contact_id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    v_count := v_count + 1;
    IF v_row.amount_cents IS NULL OR v_row.amount_cents <= 0 THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION' USING ERRCODE = '22023';
    END IF;
    IF v_row.id = ANY(v_invoice_ids) THEN
      RAISE EXCEPTION 'DUPLICATE_INVOICE_ALLOCATION' USING ERRCODE = '23505';
    END IF;
    v_invoice_ids := array_append(v_invoice_ids, v_row.id);
    IF v_row.locked IS TRUE THEN
      RAISE EXCEPTION 'INVOICE_LOCKED' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.qbo_payment_allocation_fences f
      WHERE f.invoice_id = v_row.id AND f.attempt_id <> p_attempt_id
    ) THEN
      RAISE EXCEPTION 'PAYMENT_ALLOCATION_BUSY' USING ERRCODE = '55P03';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.payment_receipt_attempts a
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.request_payload->'allocations', '[]'::jsonb)) prior(value)
      WHERE a.id <> p_attempt_id
        AND a.qbo_realm_id = p_realm_id
        AND a.status IN ('submitting', 'qbo_created', 'unknown_outcome')
        AND NULLIF(prior.value->>'invoice_id', '')::uuid = v_row.id
    ) THEN
      RAISE EXCEPTION 'PAYMENT_ALLOCATION_BUSY' USING ERRCODE = '55P03';
    END IF;
    INSERT INTO public.qbo_payment_allocation_fences (attempt_id, invoice_id, qbo_realm_id, amount_cents)
    VALUES (p_attempt_id, v_row.id, btrim(p_realm_id), v_row.amount_cents)
    ON CONFLICT (attempt_id, invoice_id) DO UPDATE
      SET amount_cents = EXCLUDED.amount_cents
      WHERE public.qbo_payment_allocation_fences.qbo_realm_id = EXCLUDED.qbo_realm_id
        AND public.qbo_payment_allocation_fences.amount_cents = EXCLUDED.amount_cents;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAYMENT_ALLOCATION_IDENTITY_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF v_count <> jsonb_array_length(p_request->'allocations') THEN
    RAISE EXCEPTION 'ALLOCATION_INVOICE_MISMATCH' USING ERRCODE = '23514';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_invoice_lock_during_qbo_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.locked IS TRUE AND OLD.locked IS FALSE AND (
    EXISTS (
      SELECT 1
      FROM public.qbo_payment_allocation_fences f
      JOIN public.payment_receipt_attempts a ON a.id = f.attempt_id
      WHERE f.invoice_id = NEW.id
        AND a.status IN ('submitting', 'qbo_created', 'unknown_outcome')
    )
    OR EXISTS (
      SELECT 1
      FROM public.payment_receipt_attempts a
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.request_payload->'allocations', '[]'::jsonb)) allocation(value)
      WHERE a.status IN ('submitting', 'qbo_created', 'unknown_outcome')
        AND NULLIF(allocation.value->>'invoice_id', '')::uuid = NEW.id
    )
  ) THEN
    RAISE EXCEPTION 'INVOICE_PAYMENT_ALLOCATION_IN_FLIGHT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

-- The historical grouped-receipt finalizers acquired FOR SHARE one allocation
-- at a time. payments' receipt trigger upgrades that lock to FOR UPDATE, which
-- creates an upgrade deadlock with another multi-invoice finalizer. Replace
-- both frozen-signature bodies with the same body plus this upfront, ordered
-- lock acquisition. The helper is invoked before either function projects a
-- receipt/payment row; its later validation loops retain their exact legacy
-- error and return contracts.
CREATE OR REPLACE FUNCTION public.lock_qbo_payment_allocation_invoices(
  p_allocations jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM 1
  FROM public.invoices i
  JOIN (
    SELECT DISTINCT NULLIF(item.value->>'invoice_id', '')::uuid AS invoice_id
    FROM jsonb_array_elements(p_allocations) AS item(value)
  ) requested ON requested.invoice_id = i.id
  ORDER BY i.id
  FOR UPDATE OF i;
END;
$function$;

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
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
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

  -- Lock every real allocation invoice in UUID order before any projection.
  PERFORM public.lock_qbo_payment_allocation_invoices(p_allocations);

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
      payment_method, reference_number, recorded_by, source, qbo_payment_id, qbo_realm_id, qbo_synced_at, qbo_sync_error)
    VALUES (v_receipt_id, v_invoice.id, v_invoice.job_id, v_invoice.contact_id,
      ((v_item->>'amount_cents')::numeric / 100), (p_receipt->>'txn_date')::date,
      COALESCE(v_item->>'payer_type', 'homeowner'), v_payment_method, p_receipt->>'reference_number',
      COALESCE(v_actor, v_attempt.actor_employee_id), v_source, v_qbo_payment_id, v_qbo_realm_id, now(), NULL)
    ON CONFLICT (qbo_payment_id, invoice_id) WHERE qbo_payment_id IS NOT NULL DO UPDATE SET
      receipt_id = EXCLUDED.receipt_id, amount = EXCLUDED.amount, payment_date = EXCLUDED.payment_date,
      payer_type = EXCLUDED.payer_type, payment_method = EXCLUDED.payment_method,
      qbo_realm_id = EXCLUDED.qbo_realm_id,
      reference_number = EXCLUDED.reference_number, qbo_synced_at = EXCLUDED.qbo_synced_at, qbo_sync_error = NULL;
  END LOOP;
  UPDATE public.payment_receipt_attempts SET receipt_id = v_receipt_id, status = 'locally_finalized', updated_at = now() WHERE id = p_attempt_id;
  INSERT INTO public.payment_receipt_events (receipt_id, attempt_id, qbo_realm_id, qbo_payment_id, event_type, after_snapshot)
  VALUES (v_receipt_id, p_attempt_id, v_qbo_realm_id, v_qbo_payment_id, 'locally_finalized', p_receipt);
  RETURN jsonb_build_object('receipt_id', v_receipt_id, 'attempt_id', p_attempt_id, 'status', 'locally_finalized', 'replayed', false);
END;
$function$;


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
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
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
  -- Lock every real allocation invoice in UUID order before any projection.
  PERFORM public.lock_qbo_payment_allocation_invoices(p_allocations);

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
      payment_method, reference_number, recorded_by, source, qbo_payment_id, qbo_realm_id, qbo_synced_at, qbo_sync_error)
    VALUES (v_receipt_id, v_invoice.id, v_invoice.job_id, v_invoice.contact_id,
      ((v_item->>'amount_cents')::numeric / 100), (p_receipt->>'txn_date')::date,
      COALESCE(v_item->>'payer_type', 'homeowner'), v_payment_method, p_receipt->>'reference_number', v_actor,
      v_source, v_qbo_payment_id, v_qbo_realm_id, now(), NULL)
    ON CONFLICT (qbo_payment_id, invoice_id) WHERE qbo_payment_id IS NOT NULL DO UPDATE SET
      receipt_id = EXCLUDED.receipt_id, amount = EXCLUDED.amount, payment_date = EXCLUDED.payment_date,
      payer_type = CASE WHEN v_preserve_upr THEN public.payments.payer_type ELSE EXCLUDED.payer_type END,
      payment_method = EXCLUDED.payment_method,
      qbo_realm_id = EXCLUDED.qbo_realm_id,
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


CREATE OR REPLACE FUNCTION public.guard_payment_receipt_invoice_unlocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_locked boolean;
BEGIN
  IF NEW.receipt_id IS NOT NULL THEN
    SELECT i.locked INTO v_locked
    FROM public.invoices i
    WHERE i.id = NEW.invoice_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ALLOCATION_INVOICE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    IF v_locked IS TRUE THEN
      RAISE EXCEPTION 'INVOICE_LOCKED_DURING_PAYMENT_FINALIZATION' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_qbo_payment_allocation_fences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status IN ('rejected', 'conflict', 'locally_finalized', 'reconciled', 'voided', 'deleted')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    DELETE FROM public.qbo_payment_allocation_fences WHERE attempt_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DO $trigger_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE NOT tgisinternal
      AND (tgrelid, tgname) IN (
        ('public.invoices'::regclass, 'trg_invoices_guard_qbo_payment_allocation_lock'),
        ('public.payments'::regclass, 'trg_payments_guard_qbo_payment_allocation_unlocked'),
        ('public.payment_receipt_attempts'::regclass, 'trg_payment_receipt_attempts_release_qbo_payment_fences')
      )
  ) THEN
    RAISE EXCEPTION 'QBO payment allocation fence preflight refused: trigger name already exists';
  END IF;
END;
$trigger_preflight$;

CREATE TRIGGER trg_invoices_guard_qbo_payment_allocation_lock
  BEFORE UPDATE OF locked ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_lock_during_qbo_payment();

CREATE TRIGGER trg_payments_guard_qbo_payment_allocation_unlocked
  BEFORE INSERT OR UPDATE OF receipt_id, invoice_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_receipt_invoice_unlocked();

CREATE TRIGGER trg_payment_receipt_attempts_release_qbo_payment_fences
  AFTER UPDATE OF status ON public.payment_receipt_attempts
  FOR EACH ROW EXECUTE FUNCTION public.release_qbo_payment_allocation_fences();

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
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
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
  ) THEN RAISE EXCEPTION 'INVALID_ACTOR' USING ERRCODE = '42501'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_realm_id || ':' || p_client_request_id, 0));
  SELECT * INTO v_attempt FROM public.payment_receipt_attempts
  WHERE qbo_realm_id = p_realm_id AND client_request_id = p_client_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'CLIENT_REQUEST_ID_CONFLICT' USING ERRCODE = '23505';
    END IF;
    -- Migration-first compatibility: an old deployed worker already calls this
    -- frozen RPC before its provider write. A nonterminal pre-fence attempt is
    -- bound to its original request on replay, never a new allocation shape.
    IF v_attempt.status IN ('submitting', 'qbo_created', 'unknown_outcome') THEN
      PERFORM public.establish_qbo_payment_allocation_fences(v_attempt.id, v_attempt.qbo_realm_id, v_attempt.request_payload);
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
  PERFORM public.establish_qbo_payment_allocation_fences(v_attempt.id, v_attempt.qbo_realm_id, v_attempt.request_payload);
  INSERT INTO public.payment_receipt_events (attempt_id, qbo_realm_id, event_type, after_snapshot)
  VALUES (v_attempt.id, v_attempt.qbo_realm_id, 'reserved', jsonb_build_object('status', v_attempt.status));
  RETURN jsonb_build_object('attempt_id', v_attempt.id, 'status', v_attempt.status, 'replayed', false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.establish_qbo_payment_allocation_fences(uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.lock_qbo_payment_allocation_invoices(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.guard_invoice_lock_during_qbo_payment() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.guard_payment_receipt_invoice_unlocked() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.release_qbo_payment_allocation_fences() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reserve_qbo_payment_receipt(text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_qbo_payment_receipt(text, text, text, text, jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
