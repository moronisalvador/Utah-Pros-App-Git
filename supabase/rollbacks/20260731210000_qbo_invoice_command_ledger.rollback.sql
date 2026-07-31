-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260731210000_qbo_invoice_command_ledger
--
-- EMERGENCY / HIGH-RISK DATA LOSS: dropping qbo_invoice_commands permanently
-- destroys command, ambiguity, provider-result, and reconciliation evidence.
-- Export and reconcile every nonterminal row before an owner-authorized rollback.
-- This rollback restores only migration 1's exact CAS behavior and does not
-- alter estimate-conversion functions or the invoice lifecycle trigger.
-- ═════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_qbo_invoice_command(uuid);
DROP FUNCTION IF EXISTS public.set_qbo_invoice_command_state(
  uuid, text, jsonb, integer, jsonb, text, text
);
DROP FUNCTION IF EXISTS public.advance_qbo_invoice_command_attempt(
  uuid, text, text, text, text, text, jsonb, text
);
DROP FUNCTION IF EXISTS public.start_qbo_invoice_command_attempt(
  uuid, text, text, text, text, jsonb, text
);
DROP FUNCTION IF EXISTS public.prepare_qbo_invoice_command(
  uuid, uuid, text, uuid, uuid, text, text, text, text, text, jsonb
);
DROP POLICY IF EXISTS qbo_invoice_commands_service_role_only
  ON public.qbo_invoice_commands;
DROP INDEX IF EXISTS public.qbo_invoice_commands_one_active_per_invoice;
DROP TABLE IF EXISTS public.qbo_invoice_commands;

-- Exact CAS body from 20260731180000_qbo_estimate_conversion_concurrency.sql.
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

REVOKE EXECUTE ON FUNCTION public.cas_qbo_invoice_link(
  uuid, text, text, text, timestamptz, text, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cas_qbo_invoice_link(
  uuid, text, text, text, timestamptz, text, text, boolean
) TO service_role;

NOTIFY pgrst, 'reload schema';
