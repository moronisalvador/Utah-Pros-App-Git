-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260731180000_qbo_estimate_conversion_concurrency
-- EMERGENCY / HIGH-RISK ONLY: restores the exact pre-forward function bodies
-- and ACLs. That legacy contract reopens authenticated execution of three
-- SECURITY DEFINER writers without their internal caller checks, and restores
-- the former same-job/repeated-conversion races. It is not routine containment.
-- Run only in an owner-authorized incident window after selecting a safer
-- forward containment option. It deliberately restores the prior deployed
-- contract rather than claiming to preserve the forward authorization hardening.
-- ═════════════════════════════════════════════════════════════════════════════

-- These helpers did not exist before the forward migration. Dropping their
-- exact signatures removes the atomic writer surface before the legacy
-- authenticated writer ACLs below are restored.
DROP TRIGGER IF EXISTS trg_invoice_qbo_lifecycle_status ON public.invoices;
DROP FUNCTION IF EXISTS public.derive_invoice_qbo_lifecycle_status();
DROP FUNCTION IF EXISTS public.apply_qbo_estimate_decision(uuid, text, timestamptz, numeric);
DROP FUNCTION IF EXISTS public.cas_qbo_invoice_link(uuid, text, text, text, timestamptz, text, text, boolean);

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
BEGIN
  INSERT INTO public.qbo_events (id, entity, operation, status)
  VALUES (p_id, p_entity, p_operation, 'processing')
  ON CONFLICT (id) DO NOTHING;
  RETURN FOUND;
END;
$$;

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
  SELECT * INTO v_row FROM public.invoices WHERE job_id = p_job_id ORDER BY created_at LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  INSERT INTO public.invoices (job_id, contact_id, invoice_number, status, invoice_type, created_by)
  SELECT j.id, j.primary_contact_id, public.generate_invoice_number(), 'draft', 'standard', p_created_by
  FROM public.jobs j WHERE j.id = p_job_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

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
  SELECT * INTO v_est FROM public.estimates WHERE id = p_estimate_id;
  IF v_est.id IS NULL THEN RAISE EXCEPTION 'Estimate % not found', p_estimate_id; END IF;

  v_job_id := v_est.job_id;
  IF v_job_id IS NULL THEN
    IF v_est.contact_id IS NULL THEN RAISE EXCEPTION 'Estimate % has no contact to create a job from', p_estimate_id; END IF;
    SELECT * INTO v_contact FROM public.contacts WHERE id = v_est.contact_id;
    v_jobres := public.create_job_with_contact(
      p_contact_id := v_contact.id, p_contact_name := v_contact.name,
      p_contact_phone := v_contact.phone, p_contact_email := v_contact.email,
      p_contact_role := COALESCE(v_contact.role, 'homeowner'),
      p_division := COALESCE(v_est.intended_division, 'water'), p_source := 'insurance', p_priority := 3,
      p_address := v_est.property_address, p_city := v_est.property_city,
      p_state := v_est.property_state, p_zip := v_est.property_zip,
      p_internal_notes := 'Auto-created from estimate ' || COALESCE(v_est.estimate_number, v_est.id::text)
    );
    v_job_id := (v_jobres->'job'->>'id')::uuid;
    IF v_job_id IS NULL THEN RAISE EXCEPTION 'Failed to auto-create a job for estimate %', p_estimate_id; END IF;
    UPDATE public.estimates SET job_id = v_job_id WHERE id = p_estimate_id;
  END IF;

  v_invoice := public.create_invoice_for_job(v_job_id, p_created_by);
  SELECT count(*) INTO v_existing FROM public.invoice_line_items WHERE invoice_id = v_invoice.id;
  IF v_existing > 0 AND NOT p_force THEN
    RETURN jsonb_build_object('needs_confirm', true, 'invoice_id', v_invoice.id, 'existing_line_count', v_existing);
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) INTO v_max_sort FROM public.invoice_line_items WHERE invoice_id = v_invoice.id;
  INSERT INTO public.invoice_line_items (invoice_id, description, xactimate_code, quantity, unit, unit_price,
                                         qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name, sort_order)
  SELECT v_invoice.id, eli.description, eli.xactimate_code, eli.quantity, eli.unit, eli.unit_price,
         eli.qbo_item_id, eli.qbo_item_name, eli.qbo_class_id, eli.qbo_class_name,
         v_max_sort + (row_number() OVER (ORDER BY eli.sort_order, eli.created_at))::integer
  FROM public.estimate_line_items eli WHERE eli.estimate_id = p_estimate_id;
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  UPDATE public.invoices SET estimate_id = p_estimate_id, updated_at = now() WHERE id = v_invoice.id;
  UPDATE public.estimates
  SET converted_invoice_id = v_invoice.id, status = 'approved',
      approved_at = COALESCE(approved_at, now()), approved_amount = COALESCE(approved_amount, amount), updated_at = now()
  WHERE id = p_estimate_id;

  RETURN jsonb_build_object('ok', true, 'invoice_id', v_invoice.id, 'lines_copied', v_copied, 'appended', v_existing > 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_invoice_for_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_for_job(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid, boolean, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_qbo_event(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_qbo_event(text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
