-- ════════════════════════════════════════════════
-- MIGRATION: 20260810182855_estimate_qbo_command_boundary
-- Phase: Admin Mobile P4c
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Records each person-approved QuickBooks estimate action before it leaves
--   UPR, prevents the estimate from changing mid-action, and applies the saved
--   result exactly once. It also makes browser-created estimates record the
--   signed-in employee instead of trusting an employee id from the request.
--
-- ADDITIVE-ONLY / function-and-trigger replacement:
--   Adds two private tables plus new functions/triggers and replaces one existing function body; no live table DROP/RENAME/ALTER COLUMN and no data change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   The paired rollback refuses unresolved work, removes provider/mutation RPCs
--   and guards, and revokes table writes. It security-sticky retains the safer
--   employee attribution and forced-RLS read-only terminal financial audit rows.
-- ════════════════════════════════════════════════

-- Keep the deployed signature and the service-role contract, but a browser may
-- no longer choose the audit actor by sending another employee's id. The live
-- billing predicate and the attribution lookup intentionally use the same
-- active/internal/role conditions.
CREATE OR REPLACE FUNCTION public.create_estimate_for_contact(
  p_contact_id uuid,
  p_intended_division text DEFAULT 'water',
  p_estimate_type text DEFAULT 'initial',
  p_property_address text DEFAULT NULL,
  p_property_city text DEFAULT NULL,
  p_property_state text DEFAULT NULL,
  p_property_zip text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS public.estimates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE
  v_row public.estimates;
  v_created_by uuid;
BEGIN
  IF auth.role() IS NOT DISTINCT FROM 'service_role' THEN
    v_created_by:=p_created_by;
  ELSE
    IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT public.billing_edit_access() THEN
      RAISE EXCEPTION 'not_authorized: active internal billing editor required' USING ERRCODE='42501';
    END IF;
    SELECT e.id INTO v_created_by
      FROM public.employees e
     WHERE e.auth_user_id=auth.uid()
       AND e.is_active IS TRUE
       AND e.is_external IS FALSE
       AND e.role::text IN ('admin','office','project_manager');
    IF v_created_by IS NULL THEN
      RAISE EXCEPTION 'not_authorized: active internal billing editor required' USING ERRCODE='42501';
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=p_contact_id) THEN
    RAISE EXCEPTION 'Contact % not found',p_contact_id;
  END IF;
  INSERT INTO public.estimates(contact_id,estimate_number,estimate_type,status,amount,subtotal,
    intended_division,property_address,property_city,property_state,property_zip,created_by)
  VALUES(p_contact_id,public.generate_estimate_number(),COALESCE(p_estimate_type,'initial'),'draft',0,0,
    COALESCE(p_intended_division,'water'),p_property_address,p_property_city,p_property_state,p_property_zip,v_created_by)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.create_estimate_for_contact(uuid,text,text,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_estimate_for_contact(uuid,text,text,text,text,text,text,uuid) TO authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.qbo_estimate_commands (
 id uuid PRIMARY KEY,
 estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK (action IN ('save','send','delete')),
 actor_auth_user_id uuid NOT NULL,
 actor_employee_id uuid NOT NULL,
 initiator text NOT NULL CHECK (initiator='browser'),
 realm_id text NOT NULL,
 request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 expected_qbo_estimate_id text,
 target_qbo_estimate_id text,
 intent_hash text NOT NULL CHECK (intent_hash ~ '^[0-9a-f]{64}$'),
 intent_payload jsonb NOT NULL CHECK (jsonb_typeof(intent_payload)='object'),
 status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation','succeeded','rejected')),
 provider_stage text, provider_action text, provider_target_id text,
 provider_request_id text, provider_payload jsonb, provider_payload_hash text,
 provider_result jsonb, local_result jsonb,
 response_status integer, response_payload jsonb, error text, intuit_request_id text,
 provider_started_at timestamptz, provider_succeeded_at timestamptz,
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qbo_estimate_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_estimate_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qbo_estimate_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qbo_estimate_commands TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS qbo_estimate_commands_one_active ON public.qbo_estimate_commands(estimate_id) WHERE status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation');

CREATE TABLE IF NOT EXISTS public.qbo_estimate_command_reservations (
 estimate_id uuid PRIMARY KEY REFERENCES public.estimates(id) ON DELETE RESTRICT,
 command_id uuid NOT NULL UNIQUE,
 action text NOT NULL CHECK (action IN ('save','send','delete')),
 actor_auth_user_id uuid NOT NULL, actor_employee_id uuid NOT NULL,
 initiator text NOT NULL CHECK (initiator='browser'), realm_id text NOT NULL,
 request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 prerequisite_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prerequisite_payload)='object'),
 reserved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qbo_estimate_command_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_estimate_command_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qbo_estimate_command_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qbo_estimate_command_reservations TO service_role;

-- Policies are private security boundaries. Do not replace an existing policy
-- with a short unprotected window: create it once, or fail closed when a prior
-- partial apply left a policy whose exact service-only shape is not ours.
DO $estimate_command_service_policies$
DECLARE
  v_target record;
  v_policy pg_catalog.pg_policy%ROWTYPE;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('qbo_estimate_commands', 'qbo_estimate_commands_service_only'),
      ('qbo_estimate_command_reservations', 'qbo_estimate_command_reservations_service_only')
    ) AS t(table_name, policy_name)
  LOOP
    SELECT p.* INTO v_policy
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = v_target.table_name
       AND p.polname = v_target.policy_name;
    IF FOUND THEN
      IF v_policy.polcmd IS DISTINCT FROM '*'
         OR v_policy.polpermissive IS NOT TRUE
         OR v_policy.polroles IS DISTINCT FROM ARRAY['service_role'::pg_catalog.regrole::oid]
         OR COALESCE(pg_catalog.pg_get_expr(v_policy.polqual, v_policy.polrelid), '') IS DISTINCT FROM 'true'
         OR COALESCE(pg_catalog.pg_get_expr(v_policy.polwithcheck, v_policy.polrelid), '') IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'QBO_ESTIMATE_COMMAND_POLICY_SHAPE_UNEXPECTED: %.%', v_target.table_name, v_target.policy_name;
      END IF;
    ELSE
      EXECUTE pg_catalog.format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        v_target.policy_name, v_target.table_name
      );
    END IF;
  END LOOP;
END;
$estimate_command_service_policies$;

CREATE OR REPLACE FUNCTION public.guard_estimate_line_during_qbo_command()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE old_estimate_id uuid; new_estimate_id uuid; finalizer_id text;
BEGIN
 old_estimate_id:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.estimate_id END;
 new_estimate_id:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.estimate_id END;
 finalizer_id:=current_setting('upr.qbo_estimate_finalizer_command_id',true);
 IF auth.role() IS NOT DISTINCT FROM 'service_role'
    AND finalizer_id IS NOT NULL
    AND (old_estimate_id IS NULL OR new_estimate_id IS NULL OR old_estimate_id=new_estimate_id)
    AND EXISTS(SELECT 1 FROM public.qbo_estimate_commands c JOIN public.qbo_estimate_command_reservations r ON r.command_id=c.id AND r.estimate_id=c.estimate_id WHERE c.id::text=finalizer_id AND c.estimate_id=COALESCE(new_estimate_id,old_estimate_id) AND c.status='provider_succeeded') THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END IF;
 -- A line reassignment touches both documents. Lock both parent rows in UUID
 -- order so it cannot move a line out of (or into) an active command fence.
 PERFORM 1 FROM public.estimates
  WHERE id IN (old_estimate_id,new_estimate_id)
  ORDER BY id
  FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.qbo_estimate_command_reservations WHERE estimate_id IN (old_estimate_id,new_estimate_id))
 OR EXISTS(SELECT 1 FROM public.qbo_estimate_commands WHERE estimate_id IN (old_estimate_id,new_estimate_id) AND status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation')) THEN
  RAISE EXCEPTION 'ESTIMATE_QBO_COMMAND_ACTIVE' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;$fn$;
CREATE TRIGGER trg_estimate_lines_guard_qbo_command BEFORE INSERT OR UPDATE OR DELETE ON public.estimate_line_items FOR EACH ROW EXECUTE FUNCTION public.guard_estimate_line_during_qbo_command();

CREATE OR REPLACE FUNCTION public.guard_estimate_transition_during_qbo_command()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE finalizer_id text;
BEGIN
 finalizer_id:=current_setting('upr.qbo_estimate_finalizer_command_id',true);
 IF auth.role() IS NOT DISTINCT FROM 'service_role'
    AND finalizer_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.qbo_estimate_commands c JOIN public.qbo_estimate_command_reservations r ON r.command_id=c.id AND r.estimate_id=c.estimate_id WHERE c.id::text=finalizer_id AND c.estimate_id=NEW.id AND c.status='provider_succeeded') THEN
  RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM public.qbo_estimate_command_reservations WHERE estimate_id=NEW.id)
 OR EXISTS(SELECT 1 FROM public.qbo_estimate_commands WHERE estimate_id=NEW.id AND status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation')) THEN
  RAISE EXCEPTION 'ESTIMATE_QBO_COMMAND_ACTIVE' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;$fn$;
CREATE TRIGGER trg_estimates_guard_qbo_command BEFORE UPDATE ON public.estimates FOR EACH ROW
EXECUTE FUNCTION public.guard_estimate_transition_during_qbo_command();

-- worker-only: these ledger, reservation, attempt, and finalization RPCs are
-- called only by /api/qbo-estimate with the service role. They intentionally
-- have no authenticated browser grant; the Worker supplies the verified actor.
CREATE OR REPLACE FUNCTION public.get_qbo_estimate_command(p_command_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.qbo_estimate_commands;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.qbo_estimate_commands WHERE id=p_command_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 RETURN to_jsonb(c)||jsonb_build_object('ok',true);
END;$fn$;

CREATE OR REPLACE FUNCTION public.reserve_qbo_estimate_command(p_command_id uuid,p_estimate_id uuid,p_action text,p_actor_auth_user_id uuid,p_actor_employee_id uuid,p_initiator text,p_realm_id text,p_request_hash text,p_prerequisite jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE e public.estimates; c public.qbo_estimate_commands; r public.qbo_estimate_command_reservations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF p_command_id IS NULL OR p_estimate_id IS NULL OR p_action NOT IN ('save','send','delete') OR p_initiator IS DISTINCT FROM 'browser' OR p_actor_auth_user_id IS NULL OR p_actor_employee_id IS NULL OR NULLIF(p_realm_id,'') IS NULL OR COALESCE(p_request_hash,'') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_prerequisite) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-command'); END IF;
 IF p_action='save' THEN
  IF p_prerequisite->>'kind' IS DISTINCT FROM 'customer_sync'
     OR COALESCE(p_prerequisite-'kind'-'contact_id'-'primary_request_id','{}'::jsonb)<>'{}'::jsonb
     OR COALESCE(p_prerequisite->>'contact_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR COALESCE(p_prerequisite->>'primary_request_id','') !~ '^[A-Za-z0-9._-]{1,50}$' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-prerequisite'); END IF;
 ELSIF p_prerequisite<>'{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'reason','invalid-prerequisite'); END IF;
 SELECT * INTO e FROM public.estimates WHERE id=p_estimate_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','estimate-not-found'); END IF;
 IF e.converted_invoice_id IS NOT NULL OR e.status IN ('approved','denied','paid') THEN RETURN jsonb_build_object('ok',false,'reason','estimate-terminal'); END IF;
 IF p_action='save' AND COALESCE(e.contact_id,(SELECT j.primary_contact_id FROM public.jobs j WHERE j.id=e.job_id))::text IS DISTINCT FROM p_prerequisite->>'contact_id' THEN RETURN jsonb_build_object('ok',false,'reason','prerequisite-source-mismatch'); END IF;
 SELECT * INTO c FROM public.qbo_estimate_commands WHERE estimate_id=p_estimate_id AND status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation') FOR UPDATE;
 IF FOUND AND (c.id IS DISTINCT FROM p_command_id OR c.action IS DISTINCT FROM p_action OR c.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR c.actor_employee_id IS DISTINCT FROM p_actor_employee_id OR c.realm_id IS DISTINCT FROM p_realm_id OR c.request_hash IS DISTINCT FROM p_request_hash) THEN RETURN jsonb_build_object('ok',false,'reason','active-command-conflict'); END IF;
 SELECT * INTO r FROM public.qbo_estimate_command_reservations WHERE estimate_id=p_estimate_id FOR UPDATE;
 IF FOUND THEN
  IF r.command_id=p_command_id AND r.action=p_action AND r.actor_auth_user_id=p_actor_auth_user_id AND r.actor_employee_id=p_actor_employee_id AND r.realm_id=p_realm_id AND r.request_hash=p_request_hash AND r.prerequisite_payload=p_prerequisite THEN RETURN jsonb_build_object('ok',true,'replay',true); END IF;
  RETURN jsonb_build_object('ok',false,'reason','active-command-conflict');
 END IF;
 INSERT INTO public.qbo_estimate_command_reservations(estimate_id,command_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,request_hash,prerequisite_payload) VALUES(p_estimate_id,p_command_id,p_action,p_actor_auth_user_id,p_actor_employee_id,'browser',p_realm_id,p_request_hash,p_prerequisite);
 RETURN jsonb_build_object('ok',true,'reserved',true);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'reason','active-command-conflict'); END;$fn$;

CREATE OR REPLACE FUNCTION public.release_qbo_estimate_command_reservation(p_command_id uuid,p_estimate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.qbo_estimate_commands; r public.qbo_estimate_command_reservations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.qbo_estimate_commands WHERE id=p_command_id FOR UPDATE;
 IF FOUND AND (c.estimate_id IS DISTINCT FROM p_estimate_id OR c.status NOT IN ('succeeded','rejected')) THEN RETURN jsonb_build_object('ok',false,'reason','command-not-terminal'); END IF;
 SELECT * INTO r FROM public.qbo_estimate_command_reservations WHERE estimate_id=p_estimate_id FOR UPDATE;
 IF FOUND AND r.command_id IS DISTINCT FROM p_command_id THEN RETURN jsonb_build_object('ok',false,'reason','reservation-mismatch'); END IF;
 DELETE FROM public.qbo_estimate_command_reservations WHERE estimate_id=p_estimate_id AND command_id=p_command_id;
 RETURN jsonb_build_object('ok',true,'released',FOUND);
END;$fn$;

CREATE OR REPLACE FUNCTION public.prepare_qbo_estimate_command(p_command_id uuid,p_estimate_id uuid,p_action text,p_actor_auth_user_id uuid,p_actor_employee_id uuid,p_initiator text,p_realm_id text,p_request_hash text,p_expected_qbo_estimate_id text,p_target_qbo_estimate_id text,p_intent_hash text,p_intent_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE e public.estimates; c public.qbo_estimate_commands; r public.qbo_estimate_command_reservations; has_c boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.estimates WHERE id=p_estimate_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','estimate-not-found'); END IF;
 IF e.converted_invoice_id IS NOT NULL OR e.status IN ('approved','denied','paid') THEN RETURN jsonb_build_object('ok',false,'reason','estimate-terminal'); END IF;
 SELECT * INTO c FROM public.qbo_estimate_commands WHERE id=p_command_id FOR UPDATE; has_c:=FOUND;
 SELECT * INTO r FROM public.qbo_estimate_command_reservations WHERE estimate_id=p_estimate_id FOR UPDATE;
 IF NOT FOUND OR r.command_id IS DISTINCT FROM p_command_id OR r.action IS DISTINCT FROM p_action OR r.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR r.actor_employee_id IS DISTINCT FROM p_actor_employee_id OR r.realm_id IS DISTINCT FROM p_realm_id OR r.request_hash IS DISTINCT FROM p_request_hash THEN RETURN jsonb_build_object('ok',false,'reason','reservation-mismatch'); END IF;
 IF COALESCE(p_intent_payload->'customer_prerequisite','{}'::jsonb) IS DISTINCT FROM r.prerequisite_payload THEN RETURN jsonb_build_object('ok',false,'reason','prerequisite-mismatch'); END IF;
 IF jsonb_typeof(p_intent_payload->'provider_source_preimage') IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-provider-source-preimage'); END IF;
 IF jsonb_typeof(p_intent_payload->'document_line_preimage') IS DISTINCT FROM 'array' OR COALESCE(p_intent_payload->>'document_line_preimage_hash','') !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-document-preimage'); END IF;
 IF has_c THEN
  IF c.estimate_id IS DISTINCT FROM p_estimate_id OR c.action IS DISTINCT FROM p_action OR c.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR c.actor_employee_id IS DISTINCT FROM p_actor_employee_id OR c.realm_id IS DISTINCT FROM p_realm_id OR c.request_hash IS DISTINCT FROM p_request_hash OR c.expected_qbo_estimate_id IS DISTINCT FROM p_expected_qbo_estimate_id OR c.target_qbo_estimate_id IS DISTINCT FROM p_target_qbo_estimate_id OR c.intent_hash IS DISTINCT FROM p_intent_hash OR c.intent_payload IS DISTINCT FROM p_intent_payload THEN RETURN jsonb_build_object('ok',false,'reason','idempotency-key-mismatch'); END IF;
  RETURN jsonb_build_object('ok',true,'replay',true,'status',c.status);
 END IF;
 INSERT INTO public.qbo_estimate_commands(id,estimate_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,request_hash,expected_qbo_estimate_id,target_qbo_estimate_id,intent_hash,intent_payload)
 VALUES(p_command_id,p_estimate_id,p_action,p_actor_auth_user_id,p_actor_employee_id,'browser',p_realm_id,p_request_hash,p_expected_qbo_estimate_id,p_target_qbo_estimate_id,p_intent_hash,p_intent_payload);
 RETURN jsonb_build_object('ok',true,'prepared',true,'status','prepared');
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'reason','active-command-conflict'); END;$fn$;

CREATE OR REPLACE FUNCTION public.start_qbo_estimate_command_attempt(p_command_id uuid,p_provider_stage text,p_provider_action text,p_provider_target_id text,p_provider_request_id text,p_provider_payload jsonb,p_provider_payload_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.qbo_estimate_commands; r public.qbo_estimate_command_reservations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.qbo_estimate_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 SELECT * INTO r FROM public.qbo_estimate_command_reservations WHERE estimate_id=c.estimate_id FOR UPDATE;
 IF NOT FOUND OR r.command_id IS DISTINCT FROM p_command_id THEN RETURN jsonb_build_object('ok',false,'reason','reservation-mismatch'); END IF;
 IF c.status IS DISTINCT FROM 'prepared' THEN RETURN jsonb_build_object('ok',false,'reason','attempt-not-fresh','status',c.status); END IF;
 IF NULLIF(p_provider_stage,'') IS NULL OR p_provider_action NOT IN ('create','update','send','delete') OR COALESCE(p_provider_request_id,'') !~ '^[A-Za-z0-9._-]{1,50}$' OR jsonb_typeof(p_provider_payload) IS DISTINCT FROM 'object' OR p_provider_payload_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-attempt'); END IF;
 UPDATE public.qbo_estimate_commands SET status='provider_started',provider_stage=p_provider_stage,provider_action=p_provider_action,provider_target_id=p_provider_target_id,provider_request_id=p_provider_request_id,provider_payload=p_provider_payload,provider_payload_hash=p_provider_payload_hash,provider_started_at=now(),updated_at=now() WHERE id=p_command_id;
 RETURN jsonb_build_object('ok',true,'started',true);
END;$fn$;

CREATE OR REPLACE FUNCTION public.set_qbo_estimate_command_state(p_command_id uuid,p_status text,p_provider_result jsonb DEFAULT NULL,p_response_status integer DEFAULT NULL,p_response_payload jsonb DEFAULT NULL,p_error text DEFAULT NULL,p_intuit_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.qbo_estimate_commands; allowed boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.qbo_estimate_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 allowed:=(c.status='prepared' AND p_status='rejected') OR (c.status='provider_started' AND p_status IN ('ambiguous','provider_succeeded','rejected')) OR (c.status='provider_succeeded' AND p_status='needs_reconciliation');
 IF NOT allowed THEN RETURN jsonb_build_object('ok',false,'reason','invalid-transition','status',c.status); END IF;
 UPDATE public.qbo_estimate_commands SET status=p_status,provider_result=COALESCE(p_provider_result,provider_result),response_status=COALESCE(p_response_status,response_status),response_payload=COALESCE(p_response_payload,response_payload),error=p_error,intuit_request_id=COALESCE(p_intuit_request_id,intuit_request_id),provider_succeeded_at=CASE WHEN p_status='provider_succeeded' THEN now() ELSE provider_succeeded_at END,completed_at=CASE WHEN p_status='rejected' THEN now() ELSE completed_at END,updated_at=now() WHERE id=p_command_id RETURNING * INTO c;
 IF p_status='rejected' THEN DELETE FROM public.qbo_estimate_command_reservations WHERE estimate_id=c.estimate_id AND command_id=c.id; END IF;
 RETURN jsonb_build_object('ok',true,'status',c.status);
END;$fn$;

CREATE OR REPLACE FUNCTION public.finalize_qbo_estimate_command(p_command_id uuid,p_response_status integer,p_response_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE seed public.qbo_estimate_commands; c public.qbo_estimate_commands; e public.estimates; r public.qbo_estimate_command_reservations;
 change jsonb; frozen jsonb; current jsonb; all_current jsonb; provider_current jsonb; line_id uuid; new_id uuid; pos integer:=0; local jsonb:='{}'::jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO seed FROM public.qbo_estimate_commands WHERE id=p_command_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 change:=seed.intent_payload->'line_change';
 -- Global order: every affected line, parent estimate, provider-source rows,
 -- command, reservation. Source-row locks turn this final comparison into a
 -- real CAS: a concurrent job/contact/claim edit either wins before the check
 -- and mismatches, or waits until this command has finished.
 PERFORM 1 FROM public.estimate_line_items WHERE estimate_id=seed.estimate_id ORDER BY id FOR UPDATE;
 SELECT * INTO e FROM public.estimates WHERE id=seed.estimate_id FOR UPDATE;
 PERFORM 1 FROM public.jobs WHERE id=e.job_id FOR UPDATE;
 PERFORM 1 FROM public.contacts WHERE id=COALESCE(e.contact_id,(SELECT j.primary_contact_id FROM public.jobs j WHERE j.id=e.job_id)) FOR UPDATE;
 PERFORM 1 FROM public.claims WHERE id=(SELECT j.claim_id FROM public.jobs j WHERE j.id=e.job_id) FOR UPDATE;
 SELECT * INTO c FROM public.qbo_estimate_commands WHERE id=p_command_id FOR UPDATE;
 SELECT * INTO r FROM public.qbo_estimate_command_reservations WHERE estimate_id=c.estimate_id FOR UPDATE;
 IF c.status='succeeded' THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'result',c.local_result); END IF;
 IF c.status IS DISTINCT FROM 'provider_succeeded' THEN RETURN jsonb_build_object('ok',false,'reason','provider-not-succeeded'); END IF;
 IF NOT FOUND OR r.command_id IS DISTINCT FROM c.id THEN RETURN jsonb_build_object('ok',false,'reason','reservation-mismatch'); END IF;
 IF e.converted_invoice_id IS NOT NULL OR e.status IN ('approved','denied','paid') THEN RETURN jsonb_build_object('ok',false,'reason','estimate-terminal'); END IF;
 IF e.qbo_estimate_id IS DISTINCT FROM c.expected_qbo_estimate_id AND NOT (c.action='save' AND e.qbo_estimate_id IS NOT DISTINCT FROM c.provider_result->>'qbo_estimate_id') THEN RETURN jsonb_build_object('ok',false,'reason','qbo-estimate-mismatch'); END IF;
 -- Validate every provider-driving source before any local projection.
 SELECT jsonb_build_object(
   'estimate',jsonb_build_object(
     'id',est_row.id::text,'job_id',est_row.job_id,'contact_id',est_row.contact_id,
     'status',est_row.status,'converted_invoice_id',est_row.converted_invoice_id,
     'qbo_estimate_id',est_row.qbo_estimate_id,'intended_division',est_row.intended_division,
     'estimate_number',est_row.estimate_number,'expiration_date',est_row.expiration_date,
     'property_address',est_row.property_address,'property_city',est_row.property_city,
     'property_state',est_row.property_state,'property_zip',est_row.property_zip),
   'job',CASE WHEN job_row.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
     'id',job_row.id::text,'division',job_row.division,'job_number',job_row.job_number,
     'claim_id',job_row.claim_id,'address',job_row.address,'city',job_row.city,
     'state',job_row.state,'zip',job_row.zip,'date_of_loss',job_row.date_of_loss,
     'primary_contact_id',job_row.primary_contact_id) END,
   'contact',CASE WHEN contact_row.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
     'id',contact_row.id::text,'qbo_customer_id',contact_row.qbo_customer_id,
     'name',contact_row.name,'email',contact_row.email) END,
   'claim',CASE WHEN claim_row.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
     'id',claim_row.id::text,'claim_number',claim_row.claim_number,
     'date_of_loss',claim_row.date_of_loss,'loss_address',claim_row.loss_address,
     'loss_city',claim_row.loss_city,'loss_state',claim_row.loss_state,
     'loss_zip',claim_row.loss_zip) END
  ) INTO provider_current
  FROM public.estimates est_row
  LEFT JOIN public.jobs job_row ON job_row.id=est_row.job_id
  LEFT JOIN public.contacts contact_row ON contact_row.id=COALESCE(est_row.contact_id,job_row.primary_contact_id)
  LEFT JOIN public.claims claim_row ON claim_row.id=job_row.claim_id
  WHERE est_row.id=e.id;
 IF jsonb_typeof(c.intent_payload->'provider_source_preimage') IS DISTINCT FROM 'object'
    OR provider_current IS DISTINCT FROM c.intent_payload->'provider_source_preimage' THEN
  RETURN jsonb_build_object('ok',false,'reason','provider-source-mismatch');
 END IF;
 -- Validate every line preimage before any projection so failure rolls back cleanly.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',li.id::text,'description',btrim(COALESCE(li.description,'')),'qbo_item_id',li.qbo_item_id,'qbo_item_name',li.qbo_item_name,'qbo_class_id',li.qbo_class_id,'qbo_class_name',li.qbo_class_name,'quantity',li.quantity,'unit_price',li.unit_price,'sort_order',li.sort_order) ORDER BY li.sort_order ASC NULLS LAST,li.created_at ASC,li.id ASC),'[]'::jsonb) INTO all_current FROM public.estimate_line_items li WHERE li.estimate_id=e.id;
 IF jsonb_typeof(c.intent_payload->'document_line_preimage') IS DISTINCT FROM 'array'
    OR COALESCE(c.intent_payload->>'document_line_preimage_hash','') !~ '^[0-9a-f]{64}$'
    OR all_current IS DISTINCT FROM c.intent_payload->'document_line_preimage' THEN
  RETURN jsonb_build_object('ok',false,'reason','document-line-source-mismatch');
 END IF;
 IF change IS NOT NULL AND change<>'null'::jsonb THEN
  IF change->>'kind' IN ('update','delete') THEN
   line_id:=(change->>'line_id')::uuid; frozen:=c.intent_payload->'line_preimage';
   SELECT jsonb_build_object('id',li.id::text,'description',btrim(COALESCE(li.description,'')),'qbo_item_id',li.qbo_item_id,'qbo_item_name',li.qbo_item_name,'qbo_class_id',li.qbo_class_id,'qbo_class_name',li.qbo_class_name,'quantity',li.quantity,'unit_price',li.unit_price,'sort_order',li.sort_order) INTO current FROM public.estimate_line_items li WHERE li.id=line_id AND li.estimate_id=e.id;
   IF current IS NULL OR current IS DISTINCT FROM frozen THEN RETURN jsonb_build_object('ok',false,'reason','line-source-mismatch'); END IF;
  ELSIF change->>'kind'='reorder' THEN
   IF all_current IS DISTINCT FROM c.intent_payload->'line_preimage'
      OR jsonb_typeof(change->'ordered_line_ids') IS DISTINCT FROM 'array'
      OR jsonb_array_length(change->'ordered_line_ids')<>jsonb_array_length(all_current)
      OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(change->'ordered_line_ids'))<>jsonb_array_length(all_current)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(all_current) item WHERE NOT ((change->'ordered_line_ids') ? (item->>'id'))) THEN RETURN jsonb_build_object('ok',false,'reason','line-source-mismatch'); END IF;
  END IF;
 END IF;
 PERFORM set_config('upr.qbo_estimate_finalizer_command_id',c.id::text,true);
 IF c.action='save' THEN
  IF change->>'kind'='create' THEN
   new_id:=gen_random_uuid();
   INSERT INTO public.estimate_line_items(id,estimate_id,description,qbo_item_id,qbo_item_name,qbo_class_id,qbo_class_name,quantity,unit_price,sort_order) VALUES(new_id,e.id,change->'patch'->>'description',change->'patch'->>'qbo_item_id',change->'patch'->>'qbo_item_name',change->'patch'->>'qbo_class_id',change->'patch'->>'qbo_class_name',(change->'patch'->>'quantity')::numeric,(change->'patch'->>'unit_price')::numeric,COALESCE((SELECT max(sort_order)+1 FROM public.estimate_line_items WHERE estimate_id=e.id),0)); local:=jsonb_build_object('line_id',new_id);
  ELSIF change->>'kind'='update' THEN
   UPDATE public.estimate_line_items SET description=change->'patch'->>'description',qbo_item_id=change->'patch'->>'qbo_item_id',qbo_item_name=change->'patch'->>'qbo_item_name',qbo_class_id=change->'patch'->>'qbo_class_id',qbo_class_name=change->'patch'->>'qbo_class_name',quantity=(change->'patch'->>'quantity')::numeric,unit_price=(change->'patch'->>'unit_price')::numeric WHERE id=line_id AND estimate_id=e.id; IF NOT FOUND THEN RAISE EXCEPTION 'line update target disappeared' USING ERRCODE='40001'; END IF;
  ELSIF change->>'kind'='delete' THEN DELETE FROM public.estimate_line_items WHERE id=line_id AND estimate_id=e.id; IF NOT FOUND THEN RAISE EXCEPTION 'line delete target disappeared' USING ERRCODE='40001'; END IF;
  ELSIF change->>'kind'='reorder' THEN
   FOR line_id IN SELECT value::uuid FROM jsonb_array_elements_text(change->'ordered_line_ids') LOOP UPDATE public.estimate_line_items SET sort_order=pos WHERE id=line_id AND estimate_id=e.id; IF NOT FOUND THEN RAISE EXCEPTION 'line reorder target disappeared' USING ERRCODE='40001'; END IF; pos:=pos+1; END LOOP;
  END IF;
  UPDATE public.estimates SET qbo_estimate_id=c.provider_result->>'qbo_estimate_id',qbo_synced_at=now(),qbo_doc_number=COALESCE(c.provider_result->>'doc_number',qbo_doc_number),qbo_sync_error=NULL,status=CASE WHEN status='draft' AND c.expected_qbo_estimate_id IS NULL THEN 'submitted' ELSE status END,submitted_at=CASE WHEN status='draft' AND c.expected_qbo_estimate_id IS NULL AND submitted_at IS NULL THEN now() ELSE submitted_at END WHERE id=e.id;
 ELSIF c.action='send' THEN
  UPDATE public.estimates SET qbo_emailed_at=now(),qbo_email_status=COALESCE(c.provider_result->>'email_status','EmailSent'),sent_to_email=c.provider_result->>'send_to',qbo_sync_error=NULL WHERE id=e.id;
 ELSE
  UPDATE public.estimates SET qbo_estimate_id=NULL,qbo_synced_at=NULL,qbo_doc_number=NULL,qbo_emailed_at=NULL,qbo_email_status=NULL,sent_to_email=NULL,qbo_sync_error=NULL WHERE id=e.id;
 END IF;
 UPDATE public.qbo_estimate_commands SET status='succeeded',local_result=local||jsonb_build_object('finalized',true),response_status=p_response_status,response_payload=p_response_payload,completed_at=now(),updated_at=now() WHERE id=c.id RETURNING * INTO c;
 DELETE FROM public.qbo_estimate_command_reservations WHERE estimate_id=e.id AND command_id=c.id;
 RETURN jsonb_build_object('ok',true,'result',c.local_result);
END;$fn$;

REVOKE EXECUTE ON FUNCTION public.guard_estimate_line_during_qbo_command(),public.guard_estimate_transition_during_qbo_command() FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.get_qbo_estimate_command(uuid),public.reserve_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,jsonb),public.release_qbo_estimate_command_reservation(uuid,uuid),public.prepare_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,text,text,text,jsonb),public.start_qbo_estimate_command_attempt(uuid,text,text,text,text,jsonb,text),public.set_qbo_estimate_command_state(uuid,text,jsonb,integer,jsonb,text,text),public.finalize_qbo_estimate_command(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_qbo_estimate_command(uuid),public.reserve_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,jsonb),public.release_qbo_estimate_command_reservation(uuid,uuid),public.prepare_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,text,text,text,jsonb),public.start_qbo_estimate_command_attempt(uuid,text,text,text,text,jsonb,text),public.set_qbo_estimate_command_state(uuid,text,jsonb,integer,jsonb,text,text),public.finalize_qbo_estimate_command(uuid,integer,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
