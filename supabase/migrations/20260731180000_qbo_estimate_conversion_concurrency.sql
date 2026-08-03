-- ═════════════════════════════════════════════════════════════════════════════
-- 20260731180000_qbo_estimate_conversion_concurrency.sql
-- QBO inbound hardening: make webhook retries reclaimable, serialize one
-- estimate conversion, and keep retries idempotent without changing the
-- canonical combined-billing model.
--
-- ADDITIVE / BACKWARD-COMPATIBLE REPLACEMENT:
--   * no table or column is removed or renamed;
--   * convert_estimate_to_invoice(uuid, boolean, uuid) keeps its signature and
--     jsonb response contract;
--   * create_invoice_for_job(uuid, uuid) keeps its signature and row return;
--   * claim_qbo_event(text, text, text) keeps its boolean signature and lets a
--     later provider delivery atomically reclaim only a row marked retry;
--   * no new uniqueness constraint is added: canonical combined billing permits
--     one QBO Invoice Id across multiple UPR invoices/jobs and multiple invoices
--     for a job.
--
-- REALM / EXTERNAL-ID PRECHECK: invoices and estimates have no realm_id column;
-- QBO realm_id is connection-level in integration_credentials. More importantly,
-- QBO Invoice Id is intentionally many-to-many in UPR's combined-billing model.
-- Live evidence has legitimate duplicate QBO invoice groups and multi-invoice
-- job groups (docs/db-foundation-p4-orphan-report.md §2; UPR-QBO-SYNC-PROTOCOL
-- rule 11). A global or realm-scoped unique index would reject valid accounting
-- data, so this migration creates no external-ID or job uniqueness constraint.
--
-- APPLY WINDOW: function replacement is transactional. Apply in an
-- owner-authorized window. It never chooses or rewrites a financial row.
--
-- ROLLBACK: supabase/rollbacks/20260731180000_qbo_estimate_conversion_concurrency.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- A claimed event that hit a retryable provider/realm failure used to be
-- permanently unclaimable because ON CONFLICT always returned false. Intuit
-- redelivers the same event id after a delay, so allow that delivery to reclaim
-- only an explicit retry row. Processing/processed/error/ignored rows remain
-- deduplicated. This Worker chokepoint is service-role-only.
CREATE OR REPLACE FUNCTION public.claim_qbo_event(
  p_id text,
  p_entity text,
  p_operation text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.qbo_events AS existing (id, entity, operation, status)
  VALUES (p_id, p_entity, p_operation, 'processing')
  ON CONFLICT (id) DO UPDATE
  SET entity = EXCLUDED.entity,
      operation = EXCLUDED.operation,
      status = 'processing',
      error = NULL,
      processed_at = NULL
  WHERE existing.status = 'retry'
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

-- Lock the parent job before the read/create sequence. This preserves the
-- deployed idempotent result without outlawing legitimate combined-billing rows.
CREATE OR REPLACE FUNCTION public.create_invoice_for_job(
  p_job_id uuid,
  p_created_by uuid DEFAULT NULL
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.invoices;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.is_active_internal_admin()
     AND NOT EXISTS (
       SELECT 1
       FROM public.employees e
       WHERE e.auth_user_id = auth.uid()
         AND e.is_active
         AND NOT COALESCE(e.is_external, false)
         AND e.role::text = 'manager'
     ) THEN
    RAISE EXCEPTION 'not_authorized: active internal billing editor required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.jobs WHERE id = p_job_id FOR UPDATE;

  SELECT * INTO v_row
  FROM public.invoices
  WHERE job_id = p_job_id
  ORDER BY created_at
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  INSERT INTO public.invoices (job_id, contact_id, invoice_number, status, invoice_type, created_by)
  SELECT j.id, j.primary_contact_id, public.generate_invoice_number(), 'draft', 'standard', p_created_by
  FROM public.jobs j
  WHERE j.id = p_job_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Estimate-level serialization is deliberately before every state read. A
-- decoupled estimate can therefore materialize at most one claim/job, and a
-- retry after the first successful conversion returns the linked invoice without
-- appending the estimate lines again.
CREATE OR REPLACE FUNCTION public.convert_estimate_to_invoice(
  p_estimate_id uuid,
  p_force boolean DEFAULT false,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_est      public.estimates;
  v_contact  public.contacts;
  v_jobres   jsonb;
  v_job_id   uuid;
  v_invoice  public.invoices;
  v_existing integer;
  v_copied   integer;
  v_max_sort integer;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.is_active_internal_admin()
     AND NOT EXISTS (
       SELECT 1
       FROM public.employees e
       WHERE e.auth_user_id = auth.uid()
         AND e.is_active
         AND NOT COALESCE(e.is_external, false)
         AND e.role::text = 'manager'
     ) THEN
    RAISE EXCEPTION 'not_authorized: active internal billing editor required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_est
  FROM public.estimates
  WHERE id = p_estimate_id
  FOR UPDATE;
  IF v_est.id IS NULL THEN RAISE EXCEPTION 'Estimate % not found', p_estimate_id; END IF;

  IF v_est.converted_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'invoice_id', v_est.converted_invoice_id,
      'lines_copied', 0,
      'appended', false
    );
  END IF;

  v_job_id := v_est.job_id;
  IF v_job_id IS NULL THEN
    IF v_est.contact_id IS NULL THEN
      RAISE EXCEPTION 'Estimate % has no contact to create a job from', p_estimate_id;
    END IF;
    SELECT * INTO v_contact FROM public.contacts WHERE id = v_est.contact_id;
    v_jobres := public.create_job_with_contact(
      p_contact_id     := v_contact.id,
      p_contact_name   := v_contact.name,
      p_contact_phone  := v_contact.phone,
      p_contact_email  := v_contact.email,
      p_contact_role   := COALESCE(v_contact.role, 'homeowner'),
      p_division       := COALESCE(v_est.intended_division, 'water'),
      p_source         := 'insurance',
      p_priority       := 3,
      p_address        := v_est.property_address,
      p_city           := v_est.property_city,
      p_state          := v_est.property_state,
      p_zip            := v_est.property_zip,
      p_internal_notes := 'Auto-created from estimate ' || COALESCE(v_est.estimate_number, v_est.id::text)
    );
    v_job_id := (v_jobres->'job'->>'id')::uuid;
    IF v_job_id IS NULL THEN RAISE EXCEPTION 'Failed to auto-create a job for estimate %', p_estimate_id; END IF;
    UPDATE public.estimates SET job_id = v_job_id WHERE id = p_estimate_id;
  END IF;

  v_invoice := public.create_invoice_for_job(v_job_id, p_created_by);

  SELECT count(*) INTO v_existing
  FROM public.invoice_line_items
  WHERE invoice_id = v_invoice.id;
  IF v_existing > 0 AND NOT p_force THEN
    RETURN jsonb_build_object('needs_confirm', true, 'invoice_id', v_invoice.id, 'existing_line_count', v_existing);
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) INTO v_max_sort
  FROM public.invoice_line_items
  WHERE invoice_id = v_invoice.id;

  INSERT INTO public.invoice_line_items (
    invoice_id, description, xactimate_code, quantity, unit, unit_price,
    qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name, sort_order
  )
  SELECT
    v_invoice.id, eli.description, eli.xactimate_code, eli.quantity, eli.unit, eli.unit_price,
    eli.qbo_item_id, eli.qbo_item_name, eli.qbo_class_id, eli.qbo_class_name,
    v_max_sort + (row_number() OVER (ORDER BY eli.sort_order, eli.created_at))::integer
  FROM public.estimate_line_items eli
  WHERE eli.estimate_id = p_estimate_id;
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  UPDATE public.invoices
  SET estimate_id = p_estimate_id, updated_at = now()
  WHERE id = v_invoice.id;
  UPDATE public.estimates
  SET converted_invoice_id = v_invoice.id,
      status = 'approved',
      approved_at = COALESCE(approved_at, now()),
      approved_amount = COALESCE(approved_amount, amount),
      updated_at = now()
  WHERE id = p_estimate_id;

  RETURN jsonb_build_object('ok', true, 'invoice_id', v_invoice.id, 'lines_copied', v_copied, 'appended', v_existing > 0);
END;
$$;

-- The QBO webhook worker previously had to read an estimate, decide whether it
-- was safe to change, stamp approval metadata, and then invoke conversion as
-- separate statements. Keep that decision under the estimate row lock so a
-- redelivery can never reverse a staff decision observed between those steps.
CREATE OR REPLACE FUNCTION public.apply_qbo_estimate_decision(
  p_estimate_id uuid,
  p_action text,
  p_approved_at timestamptz DEFAULT NULL,
  p_approved_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_est public.estimates;
  v_action text := lower(trim(COALESCE(p_action, '')));
  v_conversion jsonb;
  v_invoice_id uuid;
  v_reason text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;

  IF v_action NOT IN ('accept', 'reject', 'convert', 'approve_only') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-action');
  END IF;

  SELECT * INTO v_est
  FROM public.estimates
  WHERE id = p_estimate_id
  FOR UPDATE;
  IF v_est.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'estimate-not-found');
  END IF;

  IF v_est.converted_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already-converted',
      'status', v_est.status, 'invoice_id', v_est.converted_invoice_id);
  END IF;

  IF v_action = 'reject' THEN
    IF v_est.status = 'denied' THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'already-denied',
        'status', v_est.status);
    END IF;
    IF v_est.status NOT IN ('draft', 'submitted', 'under_review', 'revised') THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'already-decided',
        'status', v_est.status);
    END IF;
    UPDATE public.estimates
    SET status = 'denied',
        denied_reason = 'Declined by customer in QuickBooks',
        updated_at = now()
    WHERE id = v_est.id;
    RETURN jsonb_build_object('ok', true, 'action', 'denied');
  END IF;

  IF v_action = 'accept' AND v_est.status NOT IN ('draft', 'submitted', 'under_review', 'revised') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already-decided',
      'status', v_est.status);
  END IF;
  IF v_action = 'approve_only' AND v_est.status NOT IN ('draft', 'submitted', 'under_review', 'revised') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already-decided',
      'status', v_est.status);
  END IF;
  IF v_action = 'convert' AND v_est.status NOT IN ('draft', 'submitted', 'under_review', 'revised', 'approved') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already-decided',
      'status', v_est.status);
  END IF;

  -- Existing staff/QBO metadata always wins; supplied metadata is used only to
  -- fill a blank value, then the local estimate amount/clock is the fallback.
  UPDATE public.estimates
  SET approved_at = COALESCE(approved_at, p_approved_at, now()),
      approved_amount = COALESCE(approved_amount, p_approved_amount, amount),
      status = CASE WHEN v_action = 'approve_only' THEN 'approved' ELSE status END,
      updated_at = now()
  WHERE id = v_est.id;

  IF v_action = 'approve_only' THEN
    RETURN jsonb_build_object('ok', true, 'action', 'approved-needs-manual-convert');
  END IF;

  -- convert_estimate_to_invoice takes the same row lock re-entrantly and never
  -- forces line appends. A populated invoice is an explicit manual boundary.
  v_conversion := public.convert_estimate_to_invoice(v_est.id, false, NULL);
  v_invoice_id := NULLIF(v_conversion->>'invoice_id', '')::uuid;
  IF COALESCE((v_conversion->>'needs_confirm')::boolean, false) THEN
    UPDATE public.estimates
    SET status = 'approved', updated_at = now()
    WHERE id = v_est.id;
    RETURN jsonb_build_object('ok', true, 'action', 'approved-needs-manual-convert',
      'invoice_id', v_invoice_id, 'lines_copied', 0, 'appended', false);
  END IF;

  RETURN jsonb_build_object('ok', true, 'action', 'approved-and-converted',
    'invoice_id', v_invoice_id, 'lines_copied', COALESCE((v_conversion->>'lines_copied')::integer, 0),
    'appended', COALESCE((v_conversion->>'appended')::boolean, false));
END;
$$;

-- Invoice lifecycle is a money-owned database contract. QBO workers write only
-- link/email metadata; this BEFORE trigger derives the unpaid draft/saved/sent
-- tier without a recursive UPDATE. Payment-derived and exceptional states keep
-- precedence and are never downgraded by a provider metadata refresh.
CREATE OR REPLACE FUNCTION public.derive_invoice_qbo_lifecycle_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.amount_paid, 0) > 0
     OR NEW.status IN ('paid', 'partially_paid', 'voided', 'disputed', 'viewed', 'overdue') THEN
    RETURN NEW;
  END IF;

  IF NEW.qbo_invoice_id IS NULL THEN
    NEW.status := 'draft';
  ELSIF NEW.qbo_emailed_at IS NOT NULL
        AND NEW.qbo_emailed_at IS DISTINCT FROM OLD.qbo_emailed_at THEN
    -- A successful provider send writes a fresh timestamp through the locked
    -- CAS and must win even when the local editor had marked the invoice draft.
    NEW.status := 'sent';
  ELSIF OLD.status = 'draft' THEN
    -- The shipped editor marks a revised synced invoice draft. Saving that
    -- revision makes it current in QBO but does not claim it was re-emailed.
    NEW.status := 'saved';
  ELSIF NEW.qbo_emailed_at IS NOT NULL THEN
    NEW.status := 'sent';
  ELSE
    NEW.status := 'saved';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_invoice_qbo_lifecycle_status
BEFORE UPDATE OF qbo_invoice_id, qbo_emailed_at ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.derive_invoice_qbo_lifecycle_status();

REVOKE EXECUTE ON FUNCTION public.derive_invoice_qbo_lifecycle_status()
  FROM PUBLIC, anon, authenticated, service_role;

-- WORKER/SERVICE-ROLE-ONLY: compare-and-swap prevents two concurrent QBO event
-- paths from each reading an unlinked invoice and then silently choosing
-- different external ids. No browser caller is permitted.
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
    RETURN jsonb_build_object('ok', false, 'reason', 'qbo-invoice-mismatch',
      'current_qbo_invoice_id', v_invoice.qbo_invoice_id);
  END IF;

  UPDATE public.invoices
  SET qbo_invoice_id = p_new_qbo_invoice_id,
      qbo_synced_at = CASE WHEN p_new_qbo_invoice_id IS NULL THEN NULL ELSE now() END,
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

  RETURN jsonb_build_object('ok', true, 'id', v_invoice.id, 'job_id', v_invoice.job_id,
    'contact_id', v_invoice.contact_id, 'invoice_number', v_invoice.invoice_number,
    'qbo_doc_number', v_invoice.qbo_doc_number, 'qbo_invoice_id', v_invoice.qbo_invoice_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_invoice_for_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_for_job(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid, boolean, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_qbo_event(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_qbo_event(text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.apply_qbo_estimate_decision(uuid, text, timestamptz, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_qbo_estimate_decision(uuid, text, timestamptz, numeric) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cas_qbo_invoice_link(uuid, text, text, text, timestamptz, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cas_qbo_invoice_link(uuid, text, text, text, timestamptz, text, text, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
