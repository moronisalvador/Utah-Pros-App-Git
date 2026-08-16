-- ════════════════════════════════════════════════
-- MIGRATION: 20260810182847_invoice_document_line_operations
-- Phase: Admin Mobile P4c
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds the protected invoice-line operations used by the native document
--   editor. A requested add, edit, delete, or reorder reaches the local invoice
--   only after QuickBooks has durably succeeded.
--
-- ADDITIVE-ONLY:
--   Adds two service-only functions and safely replaces the compatible
--   create-invoice function body; no table/column drop, rename, or data change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   The paired rollback refuses unresolved reservations/line commands, removes
--   the two additive functions, and restores the compatible hardened
--   create_invoice_for_job(uuid, uuid DEFAULT NULL) contract.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.stage_qbo_invoice_line_change(
  p_command_id uuid, p_invoice_id uuid,
  p_actor_auth_user_id uuid, p_actor_employee_id uuid, p_initiator text, p_realm_id text,
  p_line_change jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_invoice public.invoices; v_command public.qbo_invoice_commands;
  v_reservation public.qbo_invoice_command_reservations; v_kind text;
  v_existing jsonb; v_frozen jsonb; v_preimage jsonb; v_ids uuid[];
  v_line public.invoice_line_items; v_requested uuid; v_new_id uuid;
  v_count bigint; v_sort integer; v_command_found boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
  IF p_command_id IS NULL OR p_invoice_id IS NULL OR p_initiator <> 'browser' OR p_actor_auth_user_id IS NULL OR p_realm_id IS NULL OR jsonb_typeof(p_line_change) <> 'object' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid-line-change');
  END IF;
  v_kind := p_line_change->>'kind';
  IF v_kind NOT IN ('create','update','delete','reorder') OR (v_kind='reorder' AND jsonb_typeof(p_line_change->'ordered_line_ids') IS DISTINCT FROM 'array') THEN RETURN jsonb_build_object('ok',false,'reason','invalid-line-change'); END IF;
  -- Match the deployed line-trigger order (line(s) then parent) for every
  -- operation that has existing rows. This prevents a desktop line write from
  -- holding a line while waiting on the parent that this command already owns.
  IF v_kind IN ('update','delete') THEN
    BEGIN v_requested := (p_line_change->>'line_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'reason','invalid-line-change'); END;
    SELECT * INTO v_line FROM public.invoice_line_items WHERE id=v_requested AND invoice_id=p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','line-not-found'); END IF;
  ELSIF v_kind='reorder' THEN
    PERFORM 1 FROM public.invoice_line_items WHERE invoice_id=p_invoice_id ORDER BY id FOR UPDATE;
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','invoice-not-found'); END IF;
  IF v_invoice.locked IS TRUE THEN RETURN jsonb_build_object('ok',false,'reason','invoice-locked'); END IF;
  SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE; v_command_found := FOUND;
  SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations WHERE invoice_id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.command_id IS DISTINCT FROM p_command_id OR v_reservation.action IS DISTINCT FROM 'save'
    OR v_reservation.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR v_reservation.actor_employee_id IS DISTINCT FROM p_actor_employee_id
    OR v_reservation.initiator IS DISTINCT FROM p_initiator OR v_reservation.realm_id IS DISTINCT FROM p_realm_id THEN RETURN jsonb_build_object('ok',false,'reason','reservation-mismatch'); END IF;
  IF v_command_found AND (v_command.invoice_id IS DISTINCT FROM p_invoice_id OR v_command.action IS DISTINCT FROM 'save' OR v_command.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR v_command.actor_employee_id IS DISTINCT FROM p_actor_employee_id OR v_command.initiator IS DISTINCT FROM p_initiator OR v_command.realm_id IS DISTINCT FROM p_realm_id) THEN RETURN jsonb_build_object('ok',false,'reason','command-mismatch'); END IF;
  IF v_command_found THEN
    v_existing := v_command.intent_payload->'line_change';
    IF jsonb_typeof(v_existing) IS DISTINCT FROM 'object' OR v_existing->'request' IS DISTINCT FROM p_line_change THEN RETURN jsonb_build_object('ok',false,'reason','change-conflict'); END IF;
    -- Before provider success the original preimage must remain exact. After
    -- success either the old preimage or the applied candidate is legal so a
    -- crash replay can finish exactly once.
    v_frozen := v_existing;
    IF v_command.status NOT IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation','succeeded','rejected') THEN RETURN jsonb_build_object('ok',false,'reason','invalid-state'); END IF;
    RETURN jsonb_build_object('ok',true,'line_change',v_frozen);
  END IF;
  IF v_kind IN ('create','update') AND (jsonb_typeof(p_line_change->'patch') IS DISTINCT FROM 'object' OR coalesce(btrim(p_line_change->'patch'->>'description'),'')='' OR length(p_line_change->'patch'->>'description')>4000 OR (p_line_change->'patch'->>'quantity') IS NULL OR (p_line_change->'patch'->>'unit_price') IS NULL) THEN RETURN jsonb_build_object('ok',false,'reason','invalid-line-change'); END IF;
  IF v_kind='create' THEN
    SELECT count(*) INTO v_count FROM public.invoice_line_items WHERE invoice_id=p_invoice_id;
    IF p_line_change ? 'sort_order' THEN
      IF jsonb_typeof(p_line_change->'sort_order') IS DISTINCT FROM 'number'
         OR (p_line_change->>'sort_order') !~ '^[0-9]+$' THEN
        RETURN jsonb_build_object('ok',false,'reason','invalid-sort-order');
      END IF;
      BEGIN
        IF (p_line_change->>'sort_order')::numeric > 2147483647 THEN
          RETURN jsonb_build_object('ok',false,'reason','invalid-sort-order');
        END IF;
      EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RETURN jsonb_build_object('ok',false,'reason','invalid-sort-order');
      END;
    END IF;
    IF v_count > 2147483647 THEN RETURN jsonb_build_object('ok',false,'reason','invalid-sort-order'); END IF;
    v_new_id := gen_random_uuid(); v_sort := COALESCE((p_line_change->>'sort_order')::integer,v_count::integer);
    v_frozen := jsonb_build_object('request',p_line_change,'kind','create','line_id',v_new_id,'patch',p_line_change->'patch','sort_order',v_sort);
  ELSIF v_kind IN ('update','delete') THEN
    v_preimage := to_jsonb(v_line) - 'line_total' - 'created_at' - 'updated_at';
    v_frozen := jsonb_build_object('request',p_line_change,'kind',v_kind,'line_id',v_requested,'preimage',v_preimage) || CASE WHEN v_kind='update' THEN jsonb_build_object('patch',p_line_change->'patch') ELSE '{}'::jsonb END;
  ELSE
    SELECT array_agg((value #>> '{}')::uuid ORDER BY ordinality) INTO v_ids FROM jsonb_array_elements(p_line_change->'ordered_line_ids') WITH ORDINALITY;
    IF v_ids IS NULL OR cardinality(v_ids) <> (SELECT count(*) FROM public.invoice_line_items WHERE invoice_id=p_invoice_id) OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> cardinality(v_ids) OR EXISTS (SELECT 1 FROM public.invoice_line_items WHERE invoice_id=p_invoice_id AND NOT (id = ANY(v_ids))) THEN RETURN jsonb_build_object('ok',false,'reason','invalid-reorder'); END IF;
    SELECT jsonb_agg(to_jsonb(l) - 'line_total' - 'created_at' - 'updated_at' ORDER BY l.id) INTO v_preimage FROM public.invoice_line_items l WHERE l.invoice_id=p_invoice_id;
    v_frozen := jsonb_build_object('request',p_line_change,'kind','reorder','ordered_line_ids',to_jsonb(v_ids),'preimage',v_preimage);
  END IF;
  RETURN jsonb_build_object('ok',true,'line_change',v_frozen);
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_qbo_invoice_line_change(
  p_command_id uuid, p_invoice_id uuid,
  p_actor_auth_user_id uuid, p_actor_employee_id uuid, p_initiator text, p_realm_id text,
  p_line_change jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_invoice public.invoices; v_command public.qbo_invoice_commands; v_reservation public.qbo_invoice_command_reservations;
  v_frozen jsonb; v_kind text; v_line public.invoice_line_items; v_current jsonb; v_row jsonb; v_id uuid; v_i integer:=0;
  v_current_rows jsonb; v_frozen_rows jsonb; v_current_order jsonb; v_original_order jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
  -- Read the immutable intent without a lock only to determine which source
  -- rows must be locked first. The authoritative command is then re-read FOR
  -- UPDATE after line(s) → invoice, matching desktop trigger lock ordering.
  SELECT intent_payload->'line_change' INTO v_frozen FROM public.qbo_invoice_commands WHERE id=p_command_id;
  IF NOT FOUND OR jsonb_typeof(v_frozen) IS DISTINCT FROM 'object' OR v_frozen->'request' IS DISTINCT FROM p_line_change THEN RETURN jsonb_build_object('ok',false,'reason','change-conflict'); END IF;
  v_kind := v_frozen->>'kind';
  IF v_kind IN ('update','delete') THEN
    v_id := (v_frozen->>'line_id')::uuid;
    SELECT * INTO v_line FROM public.invoice_line_items WHERE id=v_id AND invoice_id=p_invoice_id FOR UPDATE;
    IF NOT FOUND AND v_kind='update' THEN RETURN jsonb_build_object('ok',false,'reason','line-not-found'); END IF;
  ELSIF v_kind='reorder' THEN
    PERFORM 1 FROM public.invoice_line_items WHERE invoice_id=p_invoice_id ORDER BY id FOR UPDATE;
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice_id FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','invoice-not-found'); END IF;
  SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
  SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations WHERE invoice_id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.command_id IS DISTINCT FROM p_command_id OR v_reservation.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR v_reservation.actor_employee_id IS DISTINCT FROM p_actor_employee_id OR v_reservation.realm_id IS DISTINCT FROM p_realm_id OR v_reservation.initiator IS DISTINCT FROM p_initiator THEN RETURN jsonb_build_object('ok',false,'reason','reservation-mismatch'); END IF;
  v_frozen := v_command.intent_payload->'line_change';
  IF v_command.status IS DISTINCT FROM 'provider_succeeded' OR jsonb_typeof(v_frozen) IS DISTINCT FROM 'object' OR v_frozen->'request' IS DISTINCT FROM p_line_change THEN RETURN jsonb_build_object('ok',false,'reason','change-conflict'); END IF;
  v_kind := v_frozen->>'kind';
  IF v_kind='create' THEN
    v_id := (v_frozen->>'line_id')::uuid;
    SELECT * INTO v_line FROM public.invoice_line_items WHERE id=v_id FOR UPDATE;
    IF FOUND THEN
      IF v_line.invoice_id IS DISTINCT FROM p_invoice_id
        OR v_line.description IS DISTINCT FROM v_frozen->'patch'->>'description'
        OR v_line.qbo_item_id IS DISTINCT FROM v_frozen->'patch'->>'qbo_item_id'
        OR v_line.qbo_item_name IS DISTINCT FROM v_frozen->'patch'->>'qbo_item_name'
        OR v_line.qbo_class_id IS DISTINCT FROM v_frozen->'patch'->>'qbo_class_id'
        OR v_line.qbo_class_name IS DISTINCT FROM v_frozen->'patch'->>'qbo_class_name'
        OR v_line.quantity IS DISTINCT FROM (v_frozen->'patch'->>'quantity')::numeric
        OR v_line.unit_price IS DISTINCT FROM (v_frozen->'patch'->>'unit_price')::numeric
        OR v_line.sort_order IS DISTINCT FROM (v_frozen->>'sort_order')::integer THEN RETURN jsonb_build_object('ok',false,'reason','source-mismatch'); END IF;
      RETURN jsonb_build_object('ok',true,'applied',false,'line',to_jsonb(v_line));
    END IF;
    INSERT INTO public.invoice_line_items (id,invoice_id,description,qbo_item_id,qbo_item_name,qbo_class_id,qbo_class_name,quantity,unit_price,sort_order)
    VALUES (v_id,p_invoice_id,v_frozen->'patch'->>'description',v_frozen->'patch'->>'qbo_item_id',v_frozen->'patch'->>'qbo_item_name',v_frozen->'patch'->>'qbo_class_id',v_frozen->'patch'->>'qbo_class_name',(v_frozen->'patch'->>'quantity')::numeric,(v_frozen->'patch'->>'unit_price')::numeric,(v_frozen->>'sort_order')::integer) RETURNING * INTO v_line;
  ELSIF v_kind='update' THEN
    v_id := (v_frozen->>'line_id')::uuid; SELECT * INTO v_line FROM public.invoice_line_items WHERE id=v_id AND invoice_id=p_invoice_id FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','line-not-found'); END IF;
    v_current := to_jsonb(v_line) - 'line_total' - 'created_at' - 'updated_at';
    IF v_current IS DISTINCT FROM v_frozen->'preimage' THEN
      IF v_current IS NOT DISTINCT FROM ((v_frozen->'preimage') || (v_frozen->'patch')) THEN RETURN jsonb_build_object('ok',true,'applied',false); END IF;
      RETURN jsonb_build_object('ok',false,'reason','source-mismatch');
    END IF;
    UPDATE public.invoice_line_items SET description=v_frozen->'patch'->>'description',qbo_item_id=v_frozen->'patch'->>'qbo_item_id',qbo_item_name=v_frozen->'patch'->>'qbo_item_name',qbo_class_id=v_frozen->'patch'->>'qbo_class_id',qbo_class_name=v_frozen->'patch'->>'qbo_class_name',quantity=(v_frozen->'patch'->>'quantity')::numeric,unit_price=(v_frozen->'patch'->>'unit_price')::numeric WHERE id=v_id RETURNING * INTO v_line;
  ELSIF v_kind='delete' THEN
    v_id := (v_frozen->>'line_id')::uuid; SELECT * INTO v_line FROM public.invoice_line_items WHERE id=v_id AND invoice_id=p_invoice_id FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'applied',false); END IF;
    IF (to_jsonb(v_line) - 'line_total' - 'created_at' - 'updated_at') IS DISTINCT FROM v_frozen->'preimage' THEN RETURN jsonb_build_object('ok',false,'reason','source-mismatch'); END IF;
    DELETE FROM public.invoice_line_items WHERE id=v_id;
  ELSIF v_kind='reorder' THEN
    SELECT jsonb_agg((to_jsonb(l) - 'line_total' - 'created_at' - 'updated_at' - 'sort_order') ORDER BY l.id),
           jsonb_agg(to_jsonb(l.id) ORDER BY l.sort_order, l.id)
      INTO v_current_rows, v_current_order FROM public.invoice_line_items l WHERE l.invoice_id=p_invoice_id;
    SELECT jsonb_agg(value - 'sort_order' ORDER BY value->>'id'),
           jsonb_agg(to_jsonb((value->>'id')::uuid) ORDER BY (value->>'sort_order')::integer, value->>'id')
      INTO v_frozen_rows, v_original_order FROM jsonb_array_elements(v_frozen->'preimage') value;
    IF v_current_rows IS DISTINCT FROM v_frozen_rows THEN RETURN jsonb_build_object('ok',false,'reason','source-mismatch'); END IF;
    IF v_current_order IS NOT DISTINCT FROM v_frozen->'ordered_line_ids' THEN RETURN jsonb_build_object('ok',true,'applied',false); END IF;
    IF v_current_order IS DISTINCT FROM v_original_order THEN RETURN jsonb_build_object('ok',false,'reason','source-mismatch'); END IF;
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_frozen->'ordered_line_ids') LOOP v_id := (v_row #>> '{}')::uuid; UPDATE public.invoice_line_items SET sort_order=v_i WHERE id=v_id AND invoice_id=p_invoice_id; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','source-mismatch'); END IF; v_i:=v_i+1; END LOOP;
  ELSE RETURN jsonb_build_object('ok',false,'reason','change-conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'applied',true,'line',CASE WHEN v_line.id IS NULL THEN NULL ELSE to_jsonb(v_line) END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.stage_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb) TO service_role;

-- NULL-safe: an unclaimed execution context must never bypass this browser and
-- service role boundary just because `NULL <> 'service_role'` is NULL.
CREATE OR REPLACE FUNCTION public.create_invoice_for_job(p_job_id uuid, p_created_by uuid DEFAULT NULL)
RETURNS public.invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_row public.invoices; v_created_by uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.billing_edit_access() THEN RAISE EXCEPTION 'not_authorized: active internal billing editor required' USING ERRCODE='42501'; END IF;
  IF auth.role() = 'service_role' THEN
    v_created_by := p_created_by;
  ELSE
    SELECT e.id INTO v_created_by FROM public.employees e
    WHERE e.auth_user_id=auth.uid() AND e.is_active AND NOT COALESCE(e.is_external,false)
    LIMIT 1;
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
