-- ════════════════════════════════════════════════
-- MIGRATION: 20260805010000_qbo_receipt_service_role_check_repair
-- Phase: standalone QBO grouped-receipt repair
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   The grouped "receive payment" feature has never worked. Every one of its
--   database routines asked "is the caller the service account?" using an old
--   setting name that this project's API layer no longer fills in, so the
--   answer was always "no" and every attempt was refused. This migration asks
--   the same question the way the rest of this project already asks it — the
--   one that is proven to work on the live QuickBooks invoice routines — and
--   changes nothing else about what those routines do.
--
-- ADDITIVE-ONLY / attribute-only:
--   Function-body-only. No table, column, index, constraint, policy, trigger,
--   grant, or data change. Eight CREATE OR REPLACE statements alter exactly one
--   line each: the caller check. Signatures, parameter defaults, return shapes,
--   advisory-lock order, fingerprint conflict detection, replay handling, the
--   INVALID_ACTOR check, and every event write are preserved verbatim. The
--   REVOKE/GRANT block after the replaces is a re-assertion of the existing
--   boundary, required because this managed project re-applies Postgres's
--   built-in EXECUTE TO PUBLIC to every replaced function
--   (.claude/rules/database-standard.md §1).
--
-- MEASURED EVIDENCE (2026-08-05, isolated disposable local Supabase stack,
-- Postgres 17 + real PostgREST, service-role JWT over HTTP; stack destroyed
-- afterwards). Inside a SECURITY DEFINER function a real service-role call sees:
--     request.jwt.claims      -> a populated JSON object whose role member is
--                                the service role
--     request.jwt.claim.role  -> NULL      (the legacy name, never populated)
--     current_user            -> postgres  (the OWNER, not the caller)
--     session_user            -> authenticator
--     auth.role()             -> the service role
-- Three equivalent gates in a SECURITY DEFINER shell, called over PostgREST:
--     COALESCE(current_setting('request.jwt.claim.role',true),'') check -> HTTP 403 42501
--     auth.role() check                                                -> HTTP 200 PASSED
--     current_user check                                               -> HTTP 403 42501
-- The first reproduces the exact production failure signature. The third is the
-- trap: it fails a second, different way while looking correct. Supabase defines
-- auth.role() as COALESCE(legacy GUC, the modern claims JSON role member), so it
-- reads the claim the legacy name no longer carries.
--
-- WHY THIS EXACT CHECK (corroborating live evidence):
--   The seven receipt RPCs are SECURITY DEFINER, so current_user resolves to the
--   function OWNER, not the caller — a current_user test would fail a second
--   way while looking correct. The eighth object here,
--   guard_payment_receipt_link_write(), is SECURITY INVOKER but fires inside
--   those definer functions, where current_user is likewise the owner. GUCs are
--   session-scoped and unaffected by SECURITY DEFINER, so auth.role() reads the
--   real caller in both cases. auth.role() is the idiom already carrying
--   prepare_qbo_invoice_command / get_qbo_invoice_command / cas_qbo_invoice_link
--   (20260731210000, production ledger 20260731205942) — SECURITY DEFINER
--   functions called by the same functions/lib/supabase.js service-role client,
--   over the same PostgREST, which demonstrably succeed in production while
--   these legacy-GUC functions return 42501.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260805010000_qbo_receipt_service_role_check_repair.rollback.sql
--   restores the exact prior body of all eight functions (the legacy
--   request.jwt.claim.role check) and re-asserts the same REVOKE/GRANT boundary.
--   Running it deliberately returns the grouped receive-payment feature to its
--   non-functional state; it is a correctness revert, not a recovery path, and
--   it leaves every receipt/attempt/event row untouched.
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_definer_count integer;
  v_guard oid;
  v_stale_count integer;
  v_trigger_count integer;
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'QBO receipt role-check repair prerequisite missing: auth.role()';
  END IF;

  -- The seven service-only receipt RPCs must still be SECURITY DEFINER with the
  -- pinned search_path and the service-role-only EXECUTE boundary this repair
  -- preserves. This mirrors the 20260731231000 containment preflight exactly.
  SELECT count(*)
  INTO v_definer_count
  FROM pg_proc proc
  JOIN pg_namespace ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.proname IN (
      'claim_qbo_receipt_event',
      'reserve_qbo_payment_receipt',
      'mark_qbo_payment_receipt_created',
      'finalize_qbo_payment_receipt',
      'reconcile_qbo_payment_receipt',
      'remove_qbo_payment_receipt',
      'fail_qbo_payment_receipt_attempt'
    )
    AND proc.prosecdef
    AND proc.proconfig @> ARRAY['search_path=pg_catalog, public']
    AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE');

  IF v_definer_count <> 7 THEN
    RAISE EXCEPTION 'QBO receipt service RPC prerequisite drifted (expected 7 definer RPCs, found %)', v_definer_count;
  END IF;

  -- The eighth object is the payments receipt-link trigger function. It is
  -- SECURITY INVOKER by design and must stay that way.
  SELECT proc.oid
  INTO v_guard
  FROM pg_proc proc
  JOIN pg_namespace ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.proname = 'guard_payment_receipt_link_write'
    AND NOT proc.prosecdef
    AND proc.proconfig @> ARRAY['search_path=pg_catalog, public'];

  IF v_guard IS NULL THEN
    RAISE EXCEPTION 'QBO receipt link guard prerequisite drifted or is no longer SECURITY INVOKER';
  END IF;

  -- Drift guard: refuse unless all eight live bodies still carry the exact
  -- broken check this migration is replacing. If any body has already been
  -- changed by another session, stop rather than overwrite it.
  SELECT count(*)
  INTO v_stale_count
  FROM pg_proc proc
  JOIN pg_namespace ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.proname IN (
      'guard_payment_receipt_link_write',
      'claim_qbo_receipt_event',
      'reserve_qbo_payment_receipt',
      'mark_qbo_payment_receipt_created',
      'finalize_qbo_payment_receipt',
      'reconcile_qbo_payment_receipt',
      'remove_qbo_payment_receipt',
      'fail_qbo_payment_receipt_attempt'
    )
    AND proc.prosrc LIKE '%request.jwt.claim.role%';

  IF v_stale_count <> 8 THEN
    RAISE EXCEPTION 'QBO receipt role-check repair drift guard failed (expected 8 legacy bodies, found %)', v_stale_count;
  END IF;

  SELECT count(*)
  INTO v_trigger_count
  FROM pg_trigger trg
  WHERE trg.tgrelid = 'public.payments'::regclass
    AND NOT trg.tgisinternal
    AND trg.tgname IN ('guard_payment_receipt_link_insert', 'guard_payment_receipt_link_update');

  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'QBO receipt link triggers drifted (expected 2, found %)', v_trigger_count;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.guard_payment_receipt_link_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.receipt_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id) THEN
    IF auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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
  IF auth.role() <> 'service_role' THEN
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
  IF auth.role() <> 'service_role' THEN
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
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
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
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
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
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
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
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
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
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
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

-- This managed project re-applies Postgres's built-in EXECUTE TO PUBLIC to every
-- replaced function at ddl_command_end, so the boundary must be re-asserted
-- after each CREATE OR REPLACE (.claude/rules/database-standard.md §1). These
-- statements restore the identical grants the receipt foundation established;
-- no role gains access it did not already have.
REVOKE EXECUTE ON FUNCTION public.guard_payment_receipt_link_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_payment_receipt_link_write() TO service_role;
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

DO $postcondition$
DECLARE
  v_repaired integer;
  v_legacy integer;
  v_definer_count integer;
  v_guard_ok boolean;
  v_trigger_count integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE proc.prosrc LIKE '%auth.role() <> ''service_role''%'),
    count(*) FILTER (WHERE proc.prosrc LIKE '%request.jwt.claim.role%')
  INTO v_repaired, v_legacy
  FROM pg_proc proc
  JOIN pg_namespace ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.proname IN (
      'guard_payment_receipt_link_write',
      'claim_qbo_receipt_event',
      'reserve_qbo_payment_receipt',
      'mark_qbo_payment_receipt_created',
      'finalize_qbo_payment_receipt',
      'reconcile_qbo_payment_receipt',
      'remove_qbo_payment_receipt',
      'fail_qbo_payment_receipt_attempt'
    );

  IF v_repaired <> 8 OR v_legacy <> 0 THEN
    RAISE EXCEPTION 'QBO receipt role-check repair incomplete (repaired=%, legacy remaining=%)', v_repaired, v_legacy;
  END IF;

  -- The authorization boundary must be byte-for-byte what it was before.
  SELECT count(*)
  INTO v_definer_count
  FROM pg_proc proc
  JOIN pg_namespace ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.proname IN (
      'claim_qbo_receipt_event',
      'reserve_qbo_payment_receipt',
      'mark_qbo_payment_receipt_created',
      'finalize_qbo_payment_receipt',
      'reconcile_qbo_payment_receipt',
      'remove_qbo_payment_receipt',
      'fail_qbo_payment_receipt_attempt'
    )
    AND proc.prosecdef
    AND proc.proconfig @> ARRAY['search_path=pg_catalog, public']
    AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('public', proc.oid, 'EXECUTE');

  IF v_definer_count <> 7 THEN
    RAISE EXCEPTION 'QBO receipt RPC boundary changed during repair (expected 7, found %)', v_definer_count;
  END IF;

  SELECT
    NOT proc.prosecdef
    AND proc.proconfig @> ARRAY['search_path=pg_catalog, public']
    AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('public', proc.oid, 'EXECUTE')
  INTO v_guard_ok
  FROM pg_proc proc
  JOIN pg_namespace ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public' AND proc.proname = 'guard_payment_receipt_link_write';

  IF v_guard_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'QBO receipt link guard boundary changed during repair';
  END IF;

  SELECT count(*)
  INTO v_trigger_count
  FROM pg_trigger trg
  WHERE trg.tgrelid = 'public.payments'::regclass
    AND NOT trg.tgisinternal
    AND trg.tgname IN ('guard_payment_receipt_link_insert', 'guard_payment_receipt_link_update');

  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'QBO receipt link triggers changed during repair (expected 2, found %)', v_trigger_count;
  END IF;

  -- This migration writes no feature_flags row, so it cannot flip a rollout gate.
  -- Read that narrowly: it does NOT mean applying this is inconsequential. Both
  -- gates (Cloudflare QBO_RECEIVE_PAYMENT_ENABLED and this database flag) are
  -- already open on the dev/Preview deployment -- the 2026-08-05 failed attempt
  -- reached reserve_qbo_payment_receipt rather than being refused at the gate,
  -- which is direct proof of that. The broken role check is currently the ONLY
  -- thing preventing a real QuickBooks Payment. Applying this repair therefore
  -- makes the money path live on dev.utahpros.app with no further deploy or flag
  -- change. That consequence must be named in the apply authorization.
  --
  -- The check below refuses only under an ACTIVE KILL SWITCH; it deliberately
  -- does not refuse on enabled = true, because forcing a flag flip before a
  -- correctness fix would block the owner's own intended retest.
  IF EXISTS (
    SELECT 1 FROM public.feature_flags
    WHERE key = 'feature:qbo_receive_payment' AND force_disabled
  ) THEN
    RAISE EXCEPTION 'QBO receive-payment flag is force-disabled; repair must not be applied under a kill switch';
  END IF;
END
$postcondition$;

NOTIFY pgrst, 'reload schema';
