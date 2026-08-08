-- ════════════════════════════════════════════════
-- MIGRATION: 20260808070000_payments_qbo_realm_scoping
-- Phase: standalone QBO money-path correctness repair
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Records WHICH QuickBooks company a payment came from, on the payment itself.
--   Until now a UPR payment row only stored the QuickBooks payment number, and
--   those numbers are small counters that each company restarts from 1 — so
--   company A's payment #482 and company B's payment #482 look identical to us.
--   When QuickBooks tells us a payment was voided or deleted, the cleanup code
--   finds rows by that number alone and deletes them. If a leftover row from an
--   old QuickBooks connection happened to share a number with a live one, it was
--   deleted silently, with no error and no trace. This adds the company id so
--   the cleanup can tell them apart.
--
-- ADDITIVE-ONLY:
--   One nullable column added to public.payments. No DROP, no RENAME, no
--   ALTER COLUMN, no NOT NULL, no data change, no backfill, no table/index/
--   policy/trigger/grant change. Two SECURITY DEFINER function bodies are
--   replaced (CREATE OR REPLACE, signatures and return shapes unchanged) so the
--   receipt projections they write carry the new column.
--
-- WHY NO BACKFILL (deliberate, and the safer choice):
--   Read-only production inventory, 2026-08-07: 104 payments rows, 101 carrying
--   a qbo_payment_id, 88 matching the unscoped cleanup predicate
--   (qbo_payment_id IS NOT NULL AND source='qbo') — of which 79 are pre-receipt
--   legacy rows and 9 are receipt projections. Exactly ONE realm has ever been
--   observed (9341453160223706) in payment_receipts and in qbo_events.
--
--   That is not proof that every historical row belongs to it. qbo_events only
--   gained its realm column on 2026-07-31, and the oldest qbo payment row dates
--   to 2025-09-05; integration_credentials holds a single upserted row per
--   provider, so it records no realm history at all. A blanket backfill would
--   therefore assert an unverifiable fact — and it would make things WORSE if
--   wrong: an unstamped legacy row is at least visibly unattributed, whereas a
--   wrongly-stamped one is indistinguishable from a genuine in-realm row and
--   would be deleted with apparent authority.
--
--   So the column starts NULL everywhere and the cleanup predicate is
--   NULL-tolerant (`qbo_realm_id IS NULL OR qbo_realm_id = <connected realm>`).
--   Pre-existing rows behave EXACTLY as they do today — removal never silently
--   stops working on historical data, which would break voids and deletes — and
--   every new write is realm-scoped. The historical tail also self-heals: the
--   ON CONFLICT DO UPDATE branches below stamp the realm on any legacy row that
--   is later re-reconciled into a receipt projection.
--
-- WHY THE TWO FUNCTION REPLACES ARE REQUIRED:
--   Receipt projections (payments.receipt_id IS NOT NULL) are already realm-safe
--   *through the RPC path*: remove_qbo_payment_receipt() finds the header by
--   (qbo_realm_id, qbo_payment_id) and deletes only that header's projections.
--   But the legacy cleanup in removeQboPaymentFromUpr() runs in BOTH modes and
--   does not filter on receipt_id, so it can reach a FOREIGN realm's projection
--   and delete it — orphaning a payment_receipts header still marked
--   'reconciled' while its money rows vanish from the invoice. Scoping that
--   cleanup only helps if projections actually carry the realm, hence these two
--   replaces. Without them the NULL-tolerant arm would still match them.
--
-- THE REPLACES ARE MECHANICAL:
--   finalize_qbo_payment_receipt(uuid, jsonb, jsonb) and
--   reconcile_qbo_payment_receipt(jsonb, jsonb, text, text) are reproduced
--   VERBATIM from the applied 20260805010000 source (production ledger
--   20260806034004) with exactly three added tokens each: `qbo_realm_id` in the
--   INSERT INTO public.payments column list, `v_qbo_realm_id` in its VALUES, and
--   `qbo_realm_id = EXCLUDED.qbo_realm_id` in its ON CONFLICT DO UPDATE SET.
--   v_qbo_realm_id is already declared, already validated non-null, and already
--   the value written to payment_receipts in both functions. The
--   `auth.role() <> 'service_role'` gate repaired on 2026-08-06 is preserved
--   byte-for-byte in both.
--
--   The REVOKE/GRANT block re-asserts the existing boundary and is REQUIRED, not
--   cosmetic: this managed project re-applies Postgres's built-in
--   EXECUTE TO PUBLIC to every replaced function at ddl_command_end
--   (.claude/rules/database-standard.md §1).
--
-- NOT CHANGED HERE (deliberate):
--   No CHECK constraint tying qbo_realm_id to qbo_payment_id. The invariant is
--   real but a new failure mode on a money table buys little; it is pinned by
--   tests/qa/unit/payments-qbo-realm-scoping.test.js instead. No index either:
--   the cleanup's leading predicate is qbo_payment_id, which is already indexed
--   and highly selective, so a realm index would add write cost for no read.
--
-- ⚠ DEPLOY ORDER — MIGRATION FIRST, THEN THE WORKERS. NOT THE USUAL DIRECTION.
--   database-standard.md §5 sequences consuming code FIRST for an additive column
--   the frontend will READ. This column is different: the Worker source in the same
--   change WRITES it (qbo-payment-sync legacy insert, qbo-charge, qbo-payment) and
--   FILTERS on it (the removal predicate in removeQboPaymentFromUpr). Against a
--   database without the column, PostgREST rejects both — a write with "column
--   qbo_realm_id does not exist", and the filter with a 400 that is NOT caught
--   (only the snapshot read is wrapped), which would break every void and delete.
--
--   So: apply this migration, confirm the column, THEN deploy. Applying it early is
--   inert — nothing writes the column until the new Worker code is live, and no
--   deployed frontend reads it.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260808070000_payments_qbo_realm_scoping.rollback.sql
--   Restores both function bodies verbatim from 20260805010000 (dropping the
--   three added tokens in each) and re-asserts their REVOKE/GRANT. It
--   deliberately does NOT drop public.payments.qbo_realm_id: dropping a live
--   column is the contract removal database-standard.md §3 forbids, the column
--   is nullable and read by no deployed frontend, and leaving it costs nothing.
--   The DROP is written out, commented, as a separate reviewed decision.
-- ════════════════════════════════════════════════

-- ── 1. The column ──────────────────────────────────────────────────────────
-- Nullable, no default, no backfill. text to match payment_receipts.qbo_realm_id
-- and qbo_events.qbo_realm_id (Intuit realm ids are numeric strings that exceed
-- what an int would hold safely, and every other table already stores them as text).
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS qbo_realm_id text;

COMMENT ON COLUMN public.payments.qbo_realm_id IS
  'QuickBooks company (realm) this payment''s qbo_payment_id belongs to. NULL on rows '
  'written before 20260808070000 — QBO payment ids are per-company counters, so a void/'
  'delete cleanup keyed on qbo_payment_id alone can collide across realms. NULL is '
  'treated as "unknown, still removable" so historical voids keep working.';

-- ── 2. finalize_qbo_payment_receipt — projections carry the realm ───────────
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

-- ── 3. reconcile_qbo_payment_receipt — projections carry the realm ──────────
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

-- ── 4. Re-assert the service-role-only boundary ─────────────────────────────
-- REQUIRED after every CREATE OR REPLACE on this managed project: it re-applies
-- Postgres's built-in EXECUTE TO PUBLIC at ddl_command_end, so the ALTER DEFAULT
-- PRIVILEGES backstop does not cover functions (database-standard.md §1).
REVOKE EXECUTE ON FUNCTION public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text) TO service_role;
