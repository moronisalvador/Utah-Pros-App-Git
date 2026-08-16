-- Rollback: remove only the additive generic document-line operation RPCs.
-- The established legacy line-update and invoice command contracts remain.
-- This rollback must run before the reservation migration is removed and only
-- after every reservation and generic line-change command is terminal. Dropping
-- these finalizers early would strand a provider-successful change with no safe
-- way to reconcile it.
DO $preflight$
BEGIN
  IF to_regclass('public.qbo_invoice_command_reservations') IS NULL
     OR to_regclass('public.qbo_invoice_commands') IS NULL THEN
    RAISE EXCEPTION 'INVOICE_DOCUMENT_LINE_ROLLBACK_ORDER: qbo invoice command reservation ledger must remain installed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations) THEN
    RAISE EXCEPTION 'INVOICE_DOCUMENT_LINE_ROLLBACK_RESERVATIONS_ACTIVE: release every qbo invoice command reservation before rollback';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.qbo_invoice_commands c
    WHERE jsonb_typeof(c.intent_payload->'line_change') = 'object'
      AND c.status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation')
  ) THEN
    RAISE EXCEPTION 'INVOICE_DOCUMENT_LINE_ROLLBACK_LINE_CHANGE_ACTIVE: reconcile every active generic line change before rollback';
  END IF;
END;
$preflight$;

REVOKE EXECUTE ON FUNCTION public.stage_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.stage_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb);
DROP FUNCTION IF EXISTS public.finalize_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb);

-- Keep the predecessor signature/grants while preserving the two security
-- corrections. A rollback must not revive the claimless NULL bypass or allow
-- an authenticated browser to spoof another employee through p_created_by.
CREATE OR REPLACE FUNCTION public.create_invoice_for_job(p_job_id uuid, p_created_by uuid DEFAULT NULL)
RETURNS public.invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_row public.invoices; v_created_by uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.billing_edit_access() THEN RAISE EXCEPTION 'not_authorized: active internal billing editor required' USING ERRCODE='42501'; END IF;
  IF auth.role() = 'service_role' THEN v_created_by := p_created_by;
  ELSE
    SELECT e.id INTO v_created_by FROM public.employees e WHERE e.auth_user_id=auth.uid() AND e.is_active AND NOT COALESCE(e.is_external,false) LIMIT 1;
    IF v_created_by IS NULL THEN RAISE EXCEPTION 'not_authorized: active internal employee required' USING ERRCODE='42501'; END IF;
  END IF;
  PERFORM 1 FROM public.jobs WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO v_row FROM public.invoices WHERE job_id=p_job_id ORDER BY created_at LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;
  INSERT INTO public.invoices (job_id,contact_id,invoice_number,status,invoice_type,created_by)
  SELECT j.id,j.primary_contact_id,public.generate_invoice_number(),'draft','standard',v_created_by FROM public.jobs j WHERE j.id=p_job_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_invoice_for_job(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_for_job(uuid,uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
