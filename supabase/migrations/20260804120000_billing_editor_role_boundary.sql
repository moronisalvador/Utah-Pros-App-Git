-- ════════════════════════════════════════════════
-- MIGRATION: 20260804120000_billing_editor_role_boundary
-- Phase: n/a (standalone money-path authorization correction)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Decides, in one place, who is allowed to touch billing: office staff and
--   project managers can now record customer payments and build invoices and
--   estimates, alongside admins. Before this, the screens showed those buttons to
--   office staff but the database refused the save, so the button just failed.
--   At the same time it closes the opposite hole: invoices and invoice line items
--   were writable by ANY signed-in employee — a field tech could have deleted an
--   invoice straight through the API — and they are now held to the same billing
--   list as everything else. Paying money OUT to the company debit card is
--   deliberately NOT part of this and stays admin-only.
--
-- ADDITIVE-ONLY / attribute-only:
--   No table DROP/RENAME/ALTER COLUMN and no data change. This is an
--   authorization-only change: it replaces function bodies and replaces RLS
--   policies in place. Two effects are deliberate TIGHTENINGS rather than
--   additions, and both are reviewed as such below:
--     (a) public.invoices / public.invoice_line_items writes narrow from
--         "any authenticated non-crm_partner" to the billing role set;
--     (b) the redundant always-true SELECT policy allow_anon_read_invoices
--         (live as FOR SELECT TO authenticated USING (true), which let a
--         crm_partner read every invoice) is replaced by a non-crm_partner read.
--   No deployed caller regresses: every browser invoice/estimate write already
--   sits behind canEditBilling (InvoiceEditor, Collections, Estimates,
--   EstimateEditor, ClaimBilling), workers use the service_role client which
--   bypasses RLS, and a repo-wide grep found no CRM surface reading invoices.
--
-- WHY THE ROLE LIST GREW (owner-directed 2026-08-04):
--   'manager' was never a real role — the employee_role enum is
--   (admin, office, project_manager, field_tech, estimator, supervisor,
--   crm_partner) — so the historical ('admin','manager') predicate was
--   admin-effective. The owner directed that office and project_manager be able
--   to record payments and do invoicing. Mirrored in JS by
--   src/lib/claimUtils BILLING_EDIT_ROLES; the two must be changed together.
--
-- WHAT IS DELIBERATELY *NOT* WIDENED:
--   - Stripe Instant Payout (functions/api/stripe-payout.js) and the
--     /settings/payments payout configuration stay admin-only via the separate
--     PAYOUT_MANAGE_ROLES / canManagePayouts capability. Recording money IN and
--     wiring money OUT are different jobs.
--   - public.convert_oop_quote_to_estimate keeps its own admin-only caller check
--     (OOP Pricing is a separate admin-only, web-only feature).
--   - Trigger-owned invoice columns are untouched: update_invoice_paid() still
--     owns amount_paid / insurance_paid / homeowner_paid / status / paid_at.
--   - Provider-originated and grouped receipt payments stay worker-owned:
--     the receipt_id IS NULL + source='manual' guards are preserved verbatim.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260804120000_billing_editor_role_boundary.rollback.sql.
--   It restores billing_edit_access() to ('admin','manager'), restores the
--   admin-only payments write policies, restores the create_invoice_for_job and
--   convert_estimate_to_invoice admin-only caller checks, restores the
--   qbo_attachments_select admin-effective predicate, and restores the prior
--   invoices / invoice_line_items policy pair (allow_authenticated_* +
--   allow_anon_read_invoices). Reverting re-narrows billing to admin-only and
--   re-opens invoice writes to every authenticated non-crm_partner employee —
--   that is the exact prior state, and the second half of it is a known defect,
--   so prefer rolling forward with a corrected predicate over rolling back.
-- ════════════════════════════════════════════════

-- ── 1. The one billing predicate ──────────────────────────────────────────────
-- Policy-only helper, already live from 20260803192344. Body-only replacement:
-- signature, ownership, volatility, search_path and ACL are all preserved, so
-- the estimates / estimate_line_items policies that already call it keep working
-- and simply widen with it.
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
       AND e.role::text IN ('admin', 'office', 'project_manager')
  );
$function$;

-- This managed project re-applies EXECUTE TO PUBLIC at ddl_command_end on every
-- new/replaced function, so the revoke must be restated immediately before the
-- grant (database-standard.md §1).
REVOKE EXECUTE ON FUNCTION public.billing_edit_access()
  FROM PUBLIC, anon, authenticated, service_role;
-- Policy-only browser predicate. service_role bypasses RLS and deliberately does
-- not receive a redundant direct helper capability.
GRANT EXECUTE ON FUNCTION public.billing_edit_access() TO authenticated;

-- ── 2. payments — widen the three write policies ──────────────────────────────
-- Replaces the inline role::text = 'admin' test from 20260731045407 with the
-- shared predicate. Every other guard in those policies is preserved verbatim:
-- receipt_id IS NULL and source='manual' keep provider-originated and grouped
-- receipt rows worker-owned and un-editable from a browser.
DROP POLICY IF EXISTS payments_billing_insert ON public.payments;
DROP POLICY IF EXISTS payments_billing_update ON public.payments;
DROP POLICY IF EXISTS payments_billing_delete ON public.payments;

-- INSERT additionally pins recorded_by to the acting employee, so a billing
-- editor cannot attribute a payment they recorded to somebody else. This is the
-- self-attribution half of the original policy and is intentionally NOT folded
-- into billing_edit_access() — that helper answers "may this caller edit
-- billing", not "is this row attributed to them".
CREATE POLICY payments_billing_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    receipt_id IS NULL
    AND COALESCE(source, 'manual') = 'manual'
    AND public.billing_edit_access()
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.id = recorded_by
    )
  );

CREATE POLICY payments_billing_update ON public.payments
  FOR UPDATE TO authenticated
  USING (
    receipt_id IS NULL
    AND COALESCE(source, 'manual') = 'manual'
    AND public.billing_edit_access()
  )
  WITH CHECK (
    receipt_id IS NULL
    AND COALESCE(source, 'manual') = 'manual'
    AND public.billing_edit_access()
  );

CREATE POLICY payments_billing_delete ON public.payments
  FOR DELETE TO authenticated
  USING (
    receipt_id IS NULL
    AND COALESCE(source, 'manual') = 'manual'
    AND public.billing_edit_access()
  );

-- ── 3. invoices + invoice_line_items — close the unpredicated write ───────────
-- These still carried 20260701's "allow_authenticated_*" FOR ALL policy, whose
-- only test was NOT is_crm_partner(...) — i.e. every field_tech, estimator and
-- supervisor session could insert, update or DELETE an invoice through
-- PostgREST, and deleting one moves the job's A/R via update_invoice_paid().
-- Split into internal read + billing write, mirroring the estimates pattern that
-- 20260803192344 already established and applied.
DROP POLICY IF EXISTS "allow_authenticated_invoices" ON public.invoices;
DROP POLICY IF EXISTS allow_anon_read_invoices ON public.invoices;
DROP POLICY IF EXISTS "invoices_internal_read" ON public.invoices;
DROP POLICY IF EXISTS "invoices_billing_write" ON public.invoices;
CREATE POLICY "invoices_internal_read" ON public.invoices
  FOR SELECT TO authenticated
  USING (NOT public.is_crm_partner(auth.uid()));
CREATE POLICY "invoices_billing_write" ON public.invoices
  FOR ALL TO authenticated
  USING (public.billing_edit_access())
  WITH CHECK (public.billing_edit_access());

DROP POLICY IF EXISTS "allow_authenticated_invoice_line_items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_lines_internal_read" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_lines_billing_write" ON public.invoice_line_items;
CREATE POLICY "invoice_lines_internal_read" ON public.invoice_line_items
  FOR SELECT TO authenticated
  USING (NOT public.is_crm_partner(auth.uid()));
CREATE POLICY "invoice_lines_billing_write" ON public.invoice_line_items
  FOR ALL TO authenticated
  USING (public.billing_edit_access())
  WITH CHECK (public.billing_edit_access());

-- ── 4. Invoice-creation RPCs — widen their definer caller checks ──────────────
-- Both are SECURITY DEFINER and therefore bypass the policies above; their own
-- caller check is the real gate. Bodies below are the live 20260731180000
-- definitions with ONLY the authorization block changed — the estimate-level
-- serialization, idempotent re-entry and return shapes are preserved exactly, so
-- the deployed frontend contract does not move (database-standard.md §3).
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
  IF auth.role() <> 'service_role' AND NOT public.billing_edit_access() THEN
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

-- ── 5. qbo_attachments read — track the same billing boundary ─────────────────
-- Its predicate was written to "mirror BILLING_EDIT_ROLES exactly"; honour that
-- intent now that the list has grown, so a billing editor can see the QuickBooks
-- attachments on an invoice they are allowed to edit.
DROP POLICY IF EXISTS qbo_attachments_select ON public.qbo_attachments;
CREATE POLICY qbo_attachments_select ON public.qbo_attachments
  FOR SELECT TO authenticated
  USING (
    NOT public.is_crm_partner(auth.uid())
    AND public.billing_edit_access()
  );

-- ── 6. convert_estimate_to_invoice — same widened caller check ────────────────
-- Body extracted verbatim from the live 20260731180000 definition with ONLY the
-- authorization block replaced (mechanically, not retyped — a hand-copied money
-- function is how the 2026-07-30 CRM backfill slip happened). Estimate-level
-- FOR UPDATE serialization, the idempotent already-converted return and the jsonb
-- return shape are unchanged, so the deployed caller contract is preserved.
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
  IF auth.role() <> 'service_role' AND NOT public.billing_edit_access() THEN
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
