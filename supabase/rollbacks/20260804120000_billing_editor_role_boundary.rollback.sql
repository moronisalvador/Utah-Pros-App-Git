-- ════════════════════════════════════════════════
-- ROLLBACK: 20260804120000_billing_editor_role_boundary
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the billing permissions back exactly the way they were before
--   2026-08-04: only admins can record payments or build invoices and estimates,
--   and invoices go back to being writable by any signed-in employee.
--
-- ⚠️ READ THIS BEFORE RUNNING IT:
--   This rollback is faithful to the prior state, and the prior state contained a
--   real defect. Section 3 restores allow_authenticated_invoices /
--   allow_authenticated_invoice_line_items, whose only test is
--   NOT is_crm_partner(...) — meaning every field_tech, estimator and supervisor
--   session can again insert, update or DELETE an invoice straight through
--   PostgREST, and deleting one moves the job's A/R through update_invoice_paid().
--   It also restores allow_anon_read_invoices, which lets a crm_partner read every
--   invoice.
--
--   So: if the forward migration is being reverted because the WIDENING was wrong
--   (office/project_manager should not have billing), prefer rolling FORWARD with
--   a corrected billing_edit_access() role list — sections 1, 2, 4, 5 and 6 of the
--   forward migration all read their role set from that one function. Run this
--   whole file only if you genuinely need the complete prior state back.
--
-- ORDER: reverse of the forward migration. Function bodies below were extracted
-- mechanically from the migrations that defined them (20260803192344 and
-- 20260731180000), not retyped.
-- ════════════════════════════════════════════════

-- ── 1. Restore the admin-effective billing predicate ──────────────────────────
CREATE OR REPLACE FUNCTION public.billing_edit_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.employees e
     WHERE e.auth_user_id = auth.uid()
       AND e.is_active IS TRUE
       AND e.is_external IS FALSE
       AND e.role::text IN ('admin', 'manager')
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.billing_edit_access()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_edit_access() TO authenticated;

-- ── 2. Restore the admin-only payments write policies (20260731045407) ────────
DROP POLICY IF EXISTS payments_billing_insert ON public.payments;
DROP POLICY IF EXISTS payments_billing_update ON public.payments;
DROP POLICY IF EXISTS payments_billing_delete ON public.payments;

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

-- ── 3. Restore the prior invoices / invoice_line_items policies (20260701 + 20260708)
-- destructive-approved: reverting to the documented prior state re-opens invoice
-- writes to every authenticated non-crm_partner employee. That is the defect the
-- forward migration closed; see the warning at the top of this file.
DROP POLICY IF EXISTS "invoices_internal_read" ON public.invoices;
DROP POLICY IF EXISTS "invoices_billing_write" ON public.invoices;
DROP POLICY IF EXISTS "allow_authenticated_invoices" ON public.invoices;
CREATE POLICY "allow_authenticated_invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (NOT public.is_crm_partner(auth.uid()))
  WITH CHECK (NOT public.is_crm_partner(auth.uid()));
DROP POLICY IF EXISTS allow_anon_read_invoices ON public.invoices;
CREATE POLICY allow_anon_read_invoices ON public.invoices
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "invoice_lines_internal_read" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_lines_billing_write" ON public.invoice_line_items;
DROP POLICY IF EXISTS "allow_authenticated_invoice_line_items" ON public.invoice_line_items;
CREATE POLICY "allow_authenticated_invoice_line_items" ON public.invoice_line_items
  FOR ALL TO authenticated
  USING (NOT public.is_crm_partner(auth.uid()))
  WITH CHECK (NOT public.is_crm_partner(auth.uid()));

-- ── 4. Restore the qbo_attachments admin-effective read (20260724180000) ──────
DROP POLICY IF EXISTS qbo_attachments_select ON public.qbo_attachments;
CREATE POLICY qbo_attachments_select ON public.qbo_attachments
  FOR SELECT TO authenticated
  USING (
    NOT is_crm_partner(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.auth_user_id = auth.uid()
        AND e.is_active
        AND e.role::text IN ('admin', 'manager')
    )
  );

-- ── 5. Restore the admin-only invoice-creation RPCs (20260731180000) ──────────
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

REVOKE EXECUTE ON FUNCTION public.create_invoice_for_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_for_job(uuid, uuid) TO authenticated, service_role;


-- ── 6. Restore the admin-only convert_estimate_to_invoice (20260731180000) ────
-- Extracted verbatim from the defining migration, not retyped.
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

REVOKE EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid, boolean, uuid) TO authenticated, service_role;
