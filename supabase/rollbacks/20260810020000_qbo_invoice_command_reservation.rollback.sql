-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260810020000_qbo_invoice_command_reservation
-- HIGH-RISK: only run after every active QBO command has reached a terminal
-- result. Dropping an ambiguity reservation early permits an unsafe new command.
-- This restores the pre-reservation command behavior and CAS lock semantics.
-- ═════════════════════════════════════════════════════════════════════════════

-- A comment is not a safety boundary. Refuse before changing any object if a
-- pre-ledger customer-self-heal reservation, a normal reservation, or a legacy
-- active command still needs its no-TTL fence.
DO $rollback_preflight$
BEGIN
  -- 20260810182847's generic stage/finalize functions dereference this
  -- reservation table. They must be removed first; otherwise this rollback
  -- would leave callable functions whose first table access fails at runtime.
  IF to_regprocedure('public.stage_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.finalize_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'INVOICE_DOCUMENT_LINE_ROLLBACK_ORDER: rollback 20260810182847 invoice document line operations before removing the invoice reservation boundary';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations) THEN
    RAISE EXCEPTION 'QBO_INVOICE_RESERVATIONS_ACTIVE: resolve every reserved invoice command before rollback'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.qbo_invoice_commands
    WHERE status IN ('prepared', 'provider_started', 'ambiguous', 'provider_succeeded', 'needs_reconciliation')
  ) THEN
    RAISE EXCEPTION 'QBO_INVOICE_COMMANDS_ACTIVE: resolve every legacy active invoice command before rollback'
      USING ERRCODE = '55000';
  END IF;
END;
$rollback_preflight$;

DROP TRIGGER IF EXISTS trg_invoices_guard_qbo_command_lock ON public.invoices;
DROP FUNCTION IF EXISTS public.guard_invoice_lock_during_qbo_command();
DROP TRIGGER IF EXISTS trg_invoice_lines_guard_qbo_command_write ON public.invoice_line_items;
REVOKE EXECUTE ON FUNCTION public.guard_invoice_line_write_during_qbo_command()
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.guard_invoice_line_write_during_qbo_command();
REVOKE EXECUTE ON FUNCTION public.finalize_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.finalize_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric);
REVOKE EXECUTE ON FUNCTION public.stage_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.stage_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric);
DROP FUNCTION IF EXISTS public.release_qbo_invoice_command_reservation(uuid, uuid);
DROP FUNCTION IF EXISTS public.reserve_qbo_invoice_command(uuid, uuid, text, uuid, uuid, text, text);

-- Restore the original service-only CAS signature/body (no manual-lock check).
CREATE OR REPLACE FUNCTION public.cas_qbo_invoice_link(
 p_invoice_id uuid,p_expected_qbo_invoice_id text,p_new_qbo_invoice_id text,p_qbo_doc_number text DEFAULT NULL,p_qbo_emailed_at timestamptz DEFAULT NULL,p_qbo_email_status text DEFAULT NULL,p_sent_to_email text DEFAULT NULL,p_write_email_metadata boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_invoice public.invoices;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
 IF v_invoice.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invoice-not-found'); END IF;
 IF v_invoice.qbo_invoice_id IS DISTINCT FROM p_expected_qbo_invoice_id THEN
  IF v_invoice.qbo_invoice_id IS NOT DISTINCT FROM p_new_qbo_invoice_id THEN RETURN jsonb_build_object('ok',true,'id',v_invoice.id,'job_id',v_invoice.job_id,'contact_id',v_invoice.contact_id,'invoice_number',v_invoice.invoice_number,'qbo_doc_number',v_invoice.qbo_doc_number,'qbo_invoice_id',v_invoice.qbo_invoice_id,'idempotent',true); END IF;
  RETURN jsonb_build_object('ok',false,'reason','qbo-invoice-mismatch','current_qbo_invoice_id',v_invoice.qbo_invoice_id);
 END IF;
 UPDATE public.invoices SET qbo_invoice_id=p_new_qbo_invoice_id,qbo_synced_at=CASE WHEN p_new_qbo_invoice_id IS NULL THEN NULL ELSE now() END,qbo_doc_number=CASE WHEN p_new_qbo_invoice_id IS NULL THEN NULL ELSE COALESCE(p_qbo_doc_number,qbo_doc_number) END,qbo_emailed_at=CASE WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL WHEN p_write_email_metadata THEN p_qbo_emailed_at ELSE qbo_emailed_at END,qbo_email_status=CASE WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL WHEN p_write_email_metadata THEN p_qbo_email_status ELSE qbo_email_status END,sent_to_email=CASE WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL WHEN p_write_email_metadata THEN p_sent_to_email ELSE sent_to_email END,qbo_sync_error=NULL,updated_at=now() WHERE id=v_invoice.id RETURNING * INTO v_invoice;
 RETURN jsonb_build_object('ok',true,'id',v_invoice.id,'job_id',v_invoice.job_id,'contact_id',v_invoice.contact_id,'invoice_number',v_invoice.invoice_number,'qbo_doc_number',v_invoice.qbo_doc_number,'qbo_invoice_id',v_invoice.qbo_invoice_id);
END;
$function$;

-- The remaining replacements merely remove reservation assertions/release. The
-- durable ledger state machine and every deployed RPC signature are retained.
CREATE OR REPLACE FUNCTION public.set_qbo_invoice_command_state(
 p_command_id uuid,p_status text,p_provider_result jsonb DEFAULT NULL,p_response_status integer DEFAULT NULL,p_response_payload jsonb DEFAULT NULL,p_error text DEFAULT NULL,p_intuit_request_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_command public.qbo_invoice_commands; v_allowed boolean:=false;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 v_allowed := (v_command.status='prepared' AND p_status IN ('succeeded','rejected')) OR (v_command.status='provider_started' AND p_status IN ('ambiguous','provider_succeeded','rejected')) OR (v_command.status='ambiguous' AND p_status IN ('provider_succeeded','needs_reconciliation','rejected')) OR (v_command.status='provider_succeeded' AND p_status IN ('succeeded','needs_reconciliation')) OR (v_command.status='needs_reconciliation' AND p_status IN ('provider_started','provider_succeeded','succeeded','rejected'));
 IF NOT v_allowed THEN RETURN jsonb_build_object('ok',false,'reason','invalid-transition','status',v_command.status); END IF;
 IF v_command.status='prepared' AND p_status='succeeded' AND (p_response_status IS NULL OR p_response_payload IS NULL) THEN RETURN jsonb_build_object('ok',false,'reason','terminal-response-required','status',v_command.status); END IF;
 UPDATE public.qbo_invoice_commands SET status=p_status,provider_result=COALESCE(p_provider_result,provider_result),response_status=COALESCE(p_response_status,response_status),response_payload=COALESCE(p_response_payload,response_payload),error=p_error,intuit_request_id=COALESCE(p_intuit_request_id,intuit_request_id),provider_succeeded_at=CASE WHEN p_status='provider_succeeded' THEN now() ELSE provider_succeeded_at END,completed_at=CASE WHEN p_status IN ('succeeded','rejected') THEN now() ELSE completed_at END,updated_at=now() WHERE id=p_command_id RETURNING * INTO v_command;
 RETURN jsonb_build_object('ok',true,'command_id',v_command.id,'status',v_command.status,'provider_stage',v_command.provider_stage,'response_status',v_command.response_status,'response_payload',v_command.response_payload);
END;
$function$;

-- Restore the pre-reservation prepare/attempt bodies. These intentionally keep
-- the original active-command ledger serialization, but no longer require a
-- row from the table dropped above.
CREATE OR REPLACE FUNCTION public.prepare_qbo_invoice_command(
 p_command_id uuid,p_invoice_id uuid,p_action text,p_actor_auth_user_id uuid,p_actor_employee_id uuid,p_initiator text,p_realm_id text,p_expected_qbo_invoice_id text,p_target_qbo_invoice_id text,p_intent_hash text,p_intent_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_command public.qbo_invoice_commands; v_invoice public.invoices; v_active public.qbo_invoice_commands; v_local_target text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('save','send','delete') OR p_initiator NOT IN ('browser','webhook') OR (p_initiator='browser' AND p_actor_auth_user_id IS NULL) OR (p_initiator='webhook' AND (p_actor_auth_user_id IS NOT NULL OR p_actor_employee_id IS NOT NULL)) OR p_intent_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_intent_payload)<>'object' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-command'); END IF;
 SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice_id FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','invoice-not-found'); END IF;
 SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE;
 IF FOUND THEN
  IF v_command.invoice_id IS DISTINCT FROM p_invoice_id OR v_command.action IS DISTINCT FROM p_action OR v_command.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR v_command.actor_employee_id IS DISTINCT FROM p_actor_employee_id OR v_command.initiator IS DISTINCT FROM p_initiator OR v_command.realm_id IS DISTINCT FROM p_realm_id OR v_command.expected_qbo_invoice_id IS DISTINCT FROM p_expected_qbo_invoice_id OR v_command.target_qbo_invoice_id IS DISTINCT FROM p_target_qbo_invoice_id OR v_command.intent_hash IS DISTINCT FROM p_intent_hash OR v_command.intent_payload IS DISTINCT FROM p_intent_payload THEN RETURN jsonb_build_object('ok',false,'reason','idempotency-key-mismatch'); END IF;
  RETURN jsonb_build_object('ok',true,'replay',true,'command_id',v_command.id,'status',v_command.status,'provider_stage',v_command.provider_stage,'response_status',v_command.response_status,'response_payload',v_command.response_payload);
 END IF;
 SELECT * INTO v_active FROM public.qbo_invoice_commands WHERE invoice_id=p_invoice_id AND status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation') FOR UPDATE;
 IF FOUND THEN
  IF v_active.action IS NOT DISTINCT FROM p_action AND v_active.actor_auth_user_id IS NOT DISTINCT FROM p_actor_auth_user_id AND v_active.actor_employee_id IS NOT DISTINCT FROM p_actor_employee_id AND v_active.initiator IS NOT DISTINCT FROM p_initiator AND v_active.realm_id IS NOT DISTINCT FROM p_realm_id AND v_active.expected_qbo_invoice_id IS NOT DISTINCT FROM p_expected_qbo_invoice_id AND v_active.target_qbo_invoice_id IS NOT DISTINCT FROM p_target_qbo_invoice_id AND v_active.intent_hash IS NOT DISTINCT FROM p_intent_hash AND v_active.intent_payload IS NOT DISTINCT FROM p_intent_payload THEN
   IF v_active.provider_result ? 'local_target_qbo_invoice_id' THEN v_local_target:=v_active.provider_result->>'local_target_qbo_invoice_id'; ELSIF v_active.action='delete' THEN v_local_target:=NULL; ELSE v_local_target:=COALESCE(v_active.provider_result->>'qbo_invoice_id',v_active.provider_result->>'id',v_active.target_qbo_invoice_id); END IF;
   IF v_active.status='provider_succeeded' AND v_invoice.qbo_invoice_id IS DISTINCT FROM v_active.expected_qbo_invoice_id AND v_invoice.qbo_invoice_id IS DISTINCT FROM v_local_target THEN RETURN jsonb_build_object('ok',false,'reason','provider-result-link-mismatch','command_id',v_active.id,'status',v_active.status); END IF;
   RETURN jsonb_build_object('ok',true,'resumed',true,'command_id',v_active.id,'status',v_active.status,'provider_stage',v_active.provider_stage,'response_status',v_active.response_status,'response_payload',v_active.response_payload);
  END IF;
  RETURN jsonb_build_object('ok',false,'reason','active-command-conflict','command_id',v_active.id,'status',v_active.status);
 END IF;
 INSERT INTO public.qbo_invoice_commands(id,invoice_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,expected_qbo_invoice_id,target_qbo_invoice_id,intent_hash,intent_payload) VALUES(p_command_id,p_invoice_id,p_action,p_actor_auth_user_id,p_actor_employee_id,p_initiator,p_realm_id,p_expected_qbo_invoice_id,p_target_qbo_invoice_id,p_intent_hash,p_intent_payload);
 RETURN jsonb_build_object('ok',true,'prepared',true,'command_id',p_command_id,'status','prepared');
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'reason','active-command-conflict');
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_qbo_invoice_command_attempt(
 p_command_id uuid,p_provider_stage text,p_provider_action text,p_provider_target_id text,p_provider_request_id text,p_provider_payload jsonb,p_provider_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_command public.qbo_invoice_commands;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 IF p_provider_stage IS NULL OR p_provider_action IS NULL OR p_provider_request_id IS NULL OR (p_provider_target_id IS NULL AND p_provider_action<>'create') OR jsonb_typeof(p_provider_payload)<>'object' OR p_provider_payload_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-attempt'); END IF;
 SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 IF v_command.status IN ('provider_started','ambiguous') THEN
  IF v_command.provider_stage IS DISTINCT FROM p_provider_stage OR v_command.provider_action IS DISTINCT FROM p_provider_action OR v_command.provider_target_id IS DISTINCT FROM p_provider_target_id OR v_command.provider_request_id IS DISTINCT FROM p_provider_request_id OR v_command.provider_payload IS DISTINCT FROM p_provider_payload OR v_command.provider_payload_hash IS DISTINCT FROM p_provider_payload_hash THEN RETURN jsonb_build_object('ok',false,'reason','attempt-mismatch'); END IF;
  RETURN jsonb_build_object('ok',true,'replay',true,'status',v_command.status,'provider_stage',v_command.provider_stage,'provider_action',v_command.provider_action,'provider_target_id',v_command.provider_target_id,'provider_request_id',v_command.provider_request_id,'provider_payload',v_command.provider_payload,'provider_payload_hash',v_command.provider_payload_hash);
 END IF;
 IF v_command.status<>'prepared' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-state','status',v_command.status); END IF;
 UPDATE public.qbo_invoice_commands SET status='provider_started',provider_stage=p_provider_stage,provider_action=p_provider_action,provider_target_id=p_provider_target_id,provider_request_id=p_provider_request_id,provider_payload=p_provider_payload,provider_payload_hash=p_provider_payload_hash,provider_started_at=now(),error=NULL,updated_at=now() WHERE id=p_command_id;
 RETURN jsonb_build_object('ok',true,'started',true,'status','provider_started','provider_stage',p_provider_stage,'provider_action',p_provider_action,'provider_target_id',p_provider_target_id,'provider_request_id',p_provider_request_id,'provider_payload',p_provider_payload,'provider_payload_hash',p_provider_payload_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_qbo_invoice_command_attempt(
 p_command_id uuid,p_expected_provider_stage text,p_provider_stage text,p_provider_action text,p_provider_target_id text,p_provider_request_id text,p_provider_payload jsonb,p_provider_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_command public.qbo_invoice_commands;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 IF p_expected_provider_stage IS NULL OR p_provider_stage IS NULL OR p_provider_action IS NULL OR p_provider_request_id IS NULL OR (p_provider_target_id IS NULL AND p_provider_action<>'create') OR jsonb_typeof(p_provider_payload)<>'object' OR p_provider_payload_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-attempt'); END IF;
 SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 IF v_command.status<>'provider_started' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-state','status',v_command.status); END IF;
 IF v_command.provider_stage=p_provider_stage AND v_command.provider_action IS NOT DISTINCT FROM p_provider_action AND v_command.provider_target_id IS NOT DISTINCT FROM p_provider_target_id AND v_command.provider_request_id IS NOT DISTINCT FROM p_provider_request_id AND v_command.provider_payload IS NOT DISTINCT FROM p_provider_payload AND v_command.provider_payload_hash IS NOT DISTINCT FROM p_provider_payload_hash THEN RETURN jsonb_build_object('ok',true,'replay',true,'status',v_command.status,'provider_stage',v_command.provider_stage,'provider_action',v_command.provider_action,'provider_target_id',v_command.provider_target_id,'provider_request_id',v_command.provider_request_id,'provider_payload',v_command.provider_payload,'provider_payload_hash',v_command.provider_payload_hash); END IF;
 IF v_command.provider_stage IS DISTINCT FROM p_expected_provider_stage THEN RETURN jsonb_build_object('ok',false,'reason','attempt-mismatch','provider_stage',v_command.provider_stage); END IF;
 UPDATE public.qbo_invoice_commands SET provider_stage=p_provider_stage,provider_action=p_provider_action,provider_target_id=p_provider_target_id,provider_request_id=p_provider_request_id,provider_payload=p_provider_payload,provider_payload_hash=p_provider_payload_hash,updated_at=now() WHERE id=p_command_id RETURNING * INTO v_command;
 RETURN jsonb_build_object('ok',true,'advanced',true,'status',v_command.status,'provider_stage',v_command.provider_stage,'provider_action',v_command.provider_action,'provider_target_id',v_command.provider_target_id,'provider_request_id',v_command.provider_request_id,'provider_payload',v_command.provider_payload,'provider_payload_hash',v_command.provider_payload_hash);
END;
$function$;

-- The forward prepare/start/advance/state bodies depend on the reservation
-- table's composite row type. Replace those bodies first, then the table can be
-- removed without CASCADE or an incomplete rollback.
-- Restore the 10000 policy before dropping the reservation table that the
-- forward policy references. This preserves ordinary unlocked desktop drafts.
ALTER POLICY "invoice_lines_billing_write" ON public.invoice_line_items
  TO authenticated
  USING (
    public.billing_edit_access()
    AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.locked IS FALSE)
  )
  WITH CHECK (
    public.billing_edit_access()
    AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.locked IS FALSE)
  );
REVOKE EXECUTE ON FUNCTION public.invoice_line_qbo_write_access(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.invoice_line_qbo_write_access(uuid);
DROP POLICY IF EXISTS qbo_invoice_command_reservations_service_role_only ON public.qbo_invoice_command_reservations;
DROP TABLE IF EXISTS public.qbo_invoice_command_reservations;

REVOKE EXECUTE ON FUNCTION public.set_qbo_invoice_command_state(uuid,text,jsonb,integer,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_qbo_invoice_command_state(uuid,text,jsonb,integer,jsonb,text,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.prepare_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text,text,text,text,jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.start_qbo_invoice_command_attempt(uuid,text,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_qbo_invoice_command_attempt(uuid,text,text,text,text,jsonb,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.advance_qbo_invoice_command_attempt(uuid,text,text,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_qbo_invoice_command_attempt(uuid,text,text,text,text,text,jsonb,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cas_qbo_invoice_link(uuid,text,text,text,timestamptz,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cas_qbo_invoice_link(uuid,text,text,text,timestamptz,text,text,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
