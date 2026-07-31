-- ════════════════════════════════════════════════
-- MIGRATION: 20260730150000_oop_pricing_builder
-- Phase: OOP Pricing Builder
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds an editable price list and keeps each configured quote's exact inputs
--   and calculation in private storage. It also makes saved-quote writes check
--   the active employee and calculate money on the server.
--
-- ADDITIVE STORAGE + AUTHORIZATION HARDENING:
--   New private tables; no oop_quotes column or table-grant change. The broad
--   authenticated oop_quotes policies become role-and-rollout-scoped policies.
--   Existing RPC signatures stay callable through backward-compatible bodies.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   The owner-gated paired rollback is a safe containment rollback: it revokes
--   the builder/v2 RPCs while retaining the hardened legacy quote bodies,
--   authorization policies, safety triggers, and private additive data.
-- ════════════════════════════════════════════════
-- ─── SECTION: revision and audit storage ───────────────────────────────────
CREATE TABLE public.oop_pricing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_number integer NOT NULL UNIQUE CHECK (revision_number > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'superseded')),
  config jsonb NOT NULL,
  lock_version integer NOT NULL DEFAULT 1 CHECK (lock_version > 0),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  published_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK ((status IN ('published','superseded') AND published_at IS NOT NULL) OR (status = 'draft' AND published_at IS NULL))
);
CREATE UNIQUE INDEX oop_pricing_one_draft ON public.oop_pricing_revisions ((status)) WHERE status = 'draft';
CREATE UNIQUE INDEX oop_pricing_one_current_published ON public.oop_pricing_revisions ((status)) WHERE status = 'published';

CREATE TABLE public.oop_pricing_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('save_draft', 'publish_draft')),
  revision_id uuid REFERENCES public.oop_pricing_revisions(id) ON DELETE RESTRICT,
  actor_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.oop_quote_save_requests (
  request_id uuid PRIMARY KEY,
  quote_id uuid REFERENCES public.oop_quotes(id) ON DELETE CASCADE,
  actor_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.oop_quote_pricing_snapshots (
  quote_id uuid PRIMARY KEY REFERENCES public.oop_quotes(id) ON DELETE CASCADE,
  pricing_revision_id uuid NOT NULL REFERENCES public.oop_pricing_revisions(id) ON DELETE RESTRICT,
  pricing_inputs jsonb NOT NULL,
  pricing_config_snapshot jsonb NOT NULL,
  pricing_evaluated_lines jsonb NOT NULL,
  pricing_engine_version integer NOT NULL CHECK (pricing_engine_version > 0),
  pricing_minimum_adjustment numeric(12,2) NOT NULL DEFAULT 0 CHECK (pricing_minimum_adjustment >= 0),
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.oop_pricing_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oop_pricing_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.oop_pricing_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oop_pricing_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.oop_quote_save_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oop_quote_save_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.oop_quote_pricing_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oop_quote_pricing_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY oop_pricing_revisions_service_role ON public.oop_pricing_revisions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY oop_pricing_audit_service_role ON public.oop_pricing_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY oop_quote_save_requests_service_role ON public.oop_quote_save_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY oop_quote_pricing_snapshots_service_role ON public.oop_quote_pricing_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.oop_pricing_revisions, public.oop_pricing_audit, public.oop_quote_save_requests, public.oop_quote_pricing_snapshots FROM PUBLIC, anon, authenticated;
-- The lock lives inside the legacy zero-argument generator so every caller,
-- including the frozen legacy upsert RPC, shares the same race-safe sequence.
CREATE OR REPLACE FUNCTION public.generate_oop_quote_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'America/Denver', 'YYMM');
  v_prefix text;
  v_next integer;
BEGIN
  v_prefix := 'OOP-' || v_month || '-';
  PERFORM pg_advisory_xact_lock(hashtext('oop_quote_number:America/Denver:' || v_month));
  SELECT COALESCE(max(NULLIF(substring(quote_number from length(v_prefix)+1), '')::integer),0)+1
    INTO v_next FROM public.oop_quotes WHERE quote_number ~ ('^' || v_prefix || '[0-9]+$');
  RETURN v_prefix || lpad(v_next::text, 3, '0');
END;
$function$;
-- ─── SECTION: validation and authorization helpers ─────────────────────────
CREATE OR REPLACE FUNCTION public.oop_pricing_calculator_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM public.employees e
    JOIN public.feature_flags f ON f.key='tool:oop_pricing'
    WHERE e.auth_user_id=auth.uid()
      AND e.is_active IS TRUE
      AND e.is_external IS FALSE
      AND e.role::text IN ('admin','office','supervisor','estimator','project_manager')
      AND f.force_disabled IS NOT TRUE
      AND (f.enabled IS TRUE OR f.dev_only_user_id=e.id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.oop_pricing_active_employee(p_admin boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_employee_id uuid;
BEGIN
  IF p_admin THEN
    SELECT e.id INTO v_employee_id FROM public.employees e
    WHERE e.auth_user_id=auth.uid()
      AND e.is_active IS TRUE
      AND e.is_external IS FALSE
      AND e.role::text='admin';
    IF v_employee_id IS NULL THEN
      RAISE EXCEPTION 'not_authorized: active internal admin employee required' USING ERRCODE='42501';
    END IF;
  ELSE
    SELECT e.id INTO v_employee_id FROM public.employees e
    WHERE e.auth_user_id=auth.uid();
    IF v_employee_id IS NULL OR NOT public.oop_pricing_calculator_access() THEN
      RAISE EXCEPTION 'not_authorized: OOP pricing access required' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN v_employee_id;
END;
$function$;

-- Replace the deployed USING(true) policies so direct PostgREST table access
-- cannot bypass the same employee-role and rollout gate enforced by the RPCs.
DROP POLICY IF EXISTS "oop_quotes authenticated read" ON public.oop_quotes;
DROP POLICY IF EXISTS "oop_quotes authenticated write" ON public.oop_quotes;
CREATE POLICY "oop_quotes authenticated read" ON public.oop_quotes
  FOR SELECT TO authenticated
  USING (public.oop_pricing_calculator_access());
CREATE POLICY "oop_quotes authenticated insert" ON public.oop_quotes
  FOR INSERT TO authenticated
  WITH CHECK (public.oop_pricing_calculator_access());
CREATE POLICY "oop_quotes authenticated update" ON public.oop_quotes
  FOR UPDATE TO authenticated
  USING (public.oop_pricing_calculator_access())
  WITH CHECK (public.oop_pricing_calculator_access());
CREATE POLICY "oop_quotes authenticated delete" ON public.oop_quotes
  FOR DELETE TO authenticated
  USING (public.oop_pricing_calculator_access());

CREATE OR REPLACE FUNCTION public.oop_pricing_assert_job_exists(p_job_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  IF p_job_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=p_job_id) THEN
    RAISE EXCEPTION 'oop_job_not_found';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.oop_pricing_validate_config(p_config jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_item jsonb; v_key text; v_keys text[]:=ARRAY[]::text[]; v_number numeric; v_field text;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config)<>'object'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_config) k WHERE k NOT IN ('schemaVersion','name','projectMinimums','items'))
    OR jsonb_typeof(p_config->'schemaVersion')<>'number' OR p_config->>'schemaVersion'<>'1'
    OR jsonb_typeof(p_config->'name')<>'string' OR btrim(p_config->>'name')='' OR length(p_config->>'name')>120
    OR jsonb_typeof(p_config->'projectMinimums')<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_config->'projectMinimums'))<>2
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_config->'projectMinimums') k WHERE k NOT IN ('water','mold'))
    OR jsonb_typeof(p_config->'projectMinimums'->'water')<>'number' OR jsonb_typeof(p_config->'projectMinimums'->'mold')<>'number'
    OR jsonb_typeof(p_config->'items')<>'array' OR jsonb_array_length(p_config->'items')>250
    THEN RAISE EXCEPTION 'invalid_pricing_config'; END IF;
  FOREACH v_field IN ARRAY ARRAY['water','mold'] LOOP
    v_number:=(p_config->'projectMinimums'->>v_field)::numeric;
    IF v_number<0 OR v_number>1000000 OR v_number<>round(v_number,4) THEN RAISE EXCEPTION 'invalid_project_minimums'; END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'items') LOOP
    IF jsonb_typeof(v_item)<>'object'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN ('key','label','helpText','section','sortOrder','jobTypes','formula','unit','standardRate','internalRate','internalCostBasis','minimumQuantity','minimumCharge','defaultQuantity','defaultDays','percentageBase','customerVisible','active','priceOverrideAllowed'))
      OR NOT(v_item ?& ARRAY['key','label','helpText','section','sortOrder','jobTypes','formula','unit','standardRate','internalRate','internalCostBasis','minimumQuantity','minimumCharge','defaultQuantity','defaultDays','percentageBase','customerVisible','active','priceOverrideAllowed'])
      OR jsonb_typeof(v_item->'key')<>'string' OR jsonb_typeof(v_item->'label')<>'string' OR jsonb_typeof(v_item->'helpText')<>'string' OR jsonb_typeof(v_item->'section')<>'string' OR jsonb_typeof(v_item->'unit')<>'string'
      OR jsonb_typeof(v_item->'sortOrder')<>'number' OR jsonb_typeof(v_item->'standardRate')<>'number' OR jsonb_typeof(v_item->'internalRate')<>'number' OR jsonb_typeof(v_item->'minimumQuantity')<>'number' OR jsonb_typeof(v_item->'minimumCharge')<>'number' OR jsonb_typeof(v_item->'defaultQuantity')<>'number' OR jsonb_typeof(v_item->'defaultDays')<>'number'
      OR jsonb_typeof(v_item->'customerVisible')<>'boolean' OR jsonb_typeof(v_item->'active')<>'boolean' OR jsonb_typeof(v_item->'priceOverrideAllowed')<>'boolean'
      THEN RAISE EXCEPTION 'invalid_pricing_item_shape'; END IF;
    v_key:=v_item->>'key';
    IF v_key !~ '^[a-z][a-z0-9_]{0,63}$' OR v_key=ANY(v_keys)
      OR jsonb_typeof(v_item->'jobTypes')<>'array' OR jsonb_array_length(v_item->'jobTypes')=0
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_item->'jobTypes') x WHERE x NOT IN ('water','mold'))
      OR (SELECT count(*) FROM jsonb_array_elements_text(v_item->'jobTypes'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(v_item->'jobTypes'))
      OR COALESCE(v_item->>'formula','') NOT IN ('quantity','duration','fixed','cost_plus','percentage','pass_through')
      OR COALESCE(v_item->>'internalCostBasis','') NOT IN ('units','input','percentage_base','final_total','none')
      THEN RAISE EXCEPTION 'invalid_pricing_item'; END IF;
    FOREACH v_field IN ARRAY ARRAY['sortOrder','standardRate','internalRate','minimumQuantity','minimumCharge','defaultQuantity','defaultDays'] LOOP
      v_number:=(v_item->>v_field)::numeric;
      IF v_number<0 OR v_number>(CASE WHEN v_field='sortOrder' THEN 100000 ELSE 1000000 END) OR v_number<>round(v_number,4) OR (v_field='sortOrder' AND v_number<>trunc(v_number)) THEN RAISE EXCEPTION 'invalid_pricing_item_numeric'; END IF;
    END LOOP;
    IF v_item->>'formula'<>'percentage' AND jsonb_typeof(v_item->'percentageBase')<>'null' THEN RAISE EXCEPTION 'non_percent_percentage_base'; END IF;
    IF v_item->>'formula'='percentage' AND COALESCE(v_item->>'percentageBase','')<>'prior_subtotal' AND COALESCE(v_item->>'percentageBase','')<>'final_total' AND COALESCE(v_item->>'percentageBase','') !~ '^item:[a-z][a-z0-9_]{0,63}$' THEN RAISE EXCEPTION 'invalid_percentage_base'; END IF;
    IF v_item->>'formula'='percentage' AND v_item->>'percentageBase'='final_total' AND (v_item->>'customerVisible')::boolean AND (v_item->>'standardRate')::numeric<>0 THEN RAISE EXCEPTION 'final_total_percentage_customer_rate_must_be_zero'; END IF;
    IF v_item->>'internalCostBasis' IN ('percentage_base','final_total') AND v_item->>'formula'<>'percentage' THEN RAISE EXCEPTION 'percentage_internal_basis_requires_percentage_formula'; END IF;
    v_keys:=array_append(v_keys,v_key);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'items') LOOP
    IF v_item->>'formula'='percentage' AND v_item->>'percentageBase' LIKE 'item:%' AND (
      substring(v_item->>'percentageBase' from 6)=v_item->>'key' OR NOT substring(v_item->>'percentageBase' from 6)=ANY(v_keys)
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_config->'items') target
        WHERE target->>'key'=substring(v_item->>'percentageBase' from 6)
          AND ((target->>'sortOrder')::integer, target->>'key') < ((v_item->>'sortOrder')::integer, v_item->>'key'))
    ) THEN RAISE EXCEPTION 'invalid_percentage_base_target'; END IF;
  END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_oop_pricing_config(p_revision_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_id uuid; v_result jsonb;
BEGIN
  PERFORM public.oop_pricing_active_employee(false);
  SELECT r.id INTO v_id FROM public.oop_pricing_revisions r WHERE r.id = p_revision_id AND r.status IN ('published','superseded')
  UNION ALL SELECT r.id FROM public.oop_pricing_revisions r WHERE p_revision_id IS NULL AND r.status = 'published' LIMIT 1;
  SELECT jsonb_build_object('id',id,'revisionNumber',revision_number,'status',status,'lockVersion',lock_version,'config',config,'createdAt',created_at,'publishedAt',published_at,'contentHash',md5(config::text)) INTO v_result FROM public.oop_pricing_revisions WHERE id=v_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'pricing_revision_not_found'; END IF; RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_oop_pricing_admin_state()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.oop_pricing_active_employee(true);
  RETURN jsonb_build_object('published',(SELECT jsonb_build_object('id',r.id,'revisionNumber',r.revision_number,'status',r.status,'lockVersion',r.lock_version,'config',r.config,'createdAt',r.created_at,'publishedAt',r.published_at,'contentHash',md5(r.config::text)) FROM public.oop_pricing_revisions r WHERE status='published'),'draft',(SELECT jsonb_build_object('id',r.id,'revisionNumber',r.revision_number,'status',r.status,'lockVersion',r.lock_version,'config',r.config,'createdAt',r.created_at,'publishedAt',r.published_at,'contentHash',md5(r.config::text)) FROM public.oop_pricing_revisions r WHERE status='draft'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_oop_pricing_draft(p_expected_lock_version integer, p_config jsonb, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_actor uuid; v_draft public.oop_pricing_revisions; v_result jsonb;
BEGIN
  v_actor := public.oop_pricing_active_employee(true);
  IF p_expected_lock_version IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'expected_lock_version_and_request_id_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('oop_pricing_draft'));
  PERFORM pg_advisory_xact_lock(hashtext('oop_pricing_request:' || p_request_id::text));
  SELECT result INTO v_result FROM public.oop_pricing_audit WHERE request_id=p_request_id AND actor_employee_id=v_actor AND action='save_draft' AND request_hash=md5(jsonb_build_object('expectedLockVersion',p_expected_lock_version,'config',p_config)::text); IF FOUND THEN RETURN v_result; END IF; IF EXISTS(SELECT 1 FROM public.oop_pricing_audit WHERE request_id=p_request_id) THEN RAISE EXCEPTION 'request_id_reused_with_different_payload'; END IF;
  PERFORM public.oop_pricing_validate_config(p_config);
  SELECT * INTO v_draft FROM public.oop_pricing_revisions WHERE status='draft' FOR UPDATE;
  IF v_draft.id IS NULL THEN RAISE EXCEPTION 'pricing_draft_missing'; END IF;
  IF v_draft.lock_version <> p_expected_lock_version THEN RAISE EXCEPTION 'pricing_draft_conflict'; END IF;
  UPDATE public.oop_pricing_revisions SET config=p_config, lock_version=lock_version+1 WHERE id=v_draft.id RETURNING * INTO v_draft;
  v_result:=jsonb_build_object('id',v_draft.id,'revisionNumber',v_draft.revision_number,'lockVersion',v_draft.lock_version,'config',v_draft.config,'updatedAt',now(),'publishedAt',v_draft.published_at,'contentHash',md5(v_draft.config::text));
  INSERT INTO public.oop_pricing_audit(request_id,action,revision_id,actor_employee_id,request_hash,result) VALUES(p_request_id,'save_draft',v_draft.id,v_actor,md5(jsonb_build_object('expectedLockVersion',p_expected_lock_version,'config',p_config)::text),v_result); RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_oop_pricing_draft(p_expected_lock_version integer, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_actor uuid; v_draft public.oop_pricing_revisions; v_result jsonb; v_number integer;
BEGIN
  v_actor:=public.oop_pricing_active_employee(true);
  IF p_expected_lock_version IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'expected_lock_version_and_request_id_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('oop_pricing_publish'));
  PERFORM pg_advisory_xact_lock(hashtext('oop_pricing_request:' || p_request_id::text));
  SELECT result INTO v_result FROM public.oop_pricing_audit WHERE request_id=p_request_id AND actor_employee_id=v_actor AND action='publish_draft' AND request_hash=md5(jsonb_build_object('expectedLockVersion',p_expected_lock_version)::text); IF FOUND THEN RETURN v_result; END IF; IF EXISTS(SELECT 1 FROM public.oop_pricing_audit WHERE request_id=p_request_id) THEN RAISE EXCEPTION 'request_id_reused_with_different_payload'; END IF;
  SELECT * INTO v_draft FROM public.oop_pricing_revisions WHERE status='draft' FOR UPDATE;
  IF v_draft.id IS NULL THEN RAISE EXCEPTION 'pricing_draft_missing'; END IF;
  IF v_draft.lock_version <> p_expected_lock_version THEN RAISE EXCEPTION 'pricing_draft_conflict'; END IF;
  UPDATE public.oop_pricing_revisions SET status='superseded' WHERE status='published';
  UPDATE public.oop_pricing_revisions SET status='published', published_at=now(), published_by=v_actor WHERE id=v_draft.id RETURNING * INTO v_draft;
  SELECT max(revision_number)+1 INTO v_number FROM public.oop_pricing_revisions;
  INSERT INTO public.oop_pricing_revisions(revision_number,status,config,created_by) VALUES(v_number,'draft',v_draft.config,v_actor);
  v_result:=jsonb_build_object('publishedRevisionId',v_draft.id,'revisionNumber',v_draft.revision_number,'updatedAt',v_draft.published_at,'publishedAt',v_draft.published_at,'contentHash',md5(v_draft.config::text));
  INSERT INTO public.oop_pricing_audit(request_id,action,revision_id,actor_employee_id,request_hash,result) VALUES(p_request_id,'publish_draft',v_draft.id,v_actor,md5(jsonb_build_object('expectedLockVersion',p_expected_lock_version)::text),v_result); RETURN v_result;
END;
$function$;

-- Deterministic storage-bound validation runs before any oop_quotes DML so
-- numeric typmod failures never leak as driver-dependent errors.
CREATE OR REPLACE FUNCTION public.oop_pricing_assert_storage_bounds(
  p_shadow jsonb, p_quote_total numeric, p_net_margin_pct numeric,
  p_internal_total numeric, p_lines jsonb, p_minimum_adjustment numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_key text; v_value numeric; v_line jsonb;
BEGIN
  IF p_shadow IS NULL OR jsonb_typeof(p_shadow)<>'object' THEN RAISE EXCEPTION 'oop_shadow_values_required'; END IF;
  FOREACH v_key IN ARRAY ARRAY['techHours','billRate'] LOOP
    v_value:=COALESCE((p_shadow->>v_key)::numeric,0);
    IF v_value<0 OR v_value>999999.99 OR v_value<>round(v_value,2) THEN RAISE EXCEPTION 'oop_shadow_numeric_8_2_out_of_range:%',v_key; END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['materialsActualCost','antimicrobialSqft','containmentLinearFt','prvInvoiceCost'] LOOP
    v_value:=COALESCE((p_shadow->>v_key)::numeric,0);
    IF v_value<0 OR v_value>99999999.99 OR v_value<>round(v_value,2) THEN RAISE EXCEPTION 'oop_shadow_numeric_10_2_out_of_range:%',v_key; END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['airMoverCount','airMoverDays','lgrCount','lgrDays','xlgrCount','xlgrDays','airScrubberCount','airScrubberDays','negAirCount','negAirDays','disposalTrips'] LOOP
    v_value:=COALESCE((p_shadow->>v_key)::numeric,0);
    IF v_value<0 OR v_value>2147483647 OR v_value<>trunc(v_value) THEN RAISE EXCEPTION 'oop_shadow_integer_out_of_range:%',v_key; END IF;
  END LOOP;
  IF p_quote_total IS NULL OR abs(p_quote_total)>99999999.99 OR p_quote_total<>round(p_quote_total,2) THEN RAISE EXCEPTION 'oop_quote_total_out_of_range'; END IF;
  IF p_net_margin_pct IS NOT NULL AND (abs(p_net_margin_pct)>9999.99 OR p_net_margin_pct<>round(p_net_margin_pct,2)) THEN RAISE EXCEPTION 'oop_net_margin_pct_out_of_range'; END IF;
  IF p_internal_total IS NULL OR p_internal_total<0 OR p_internal_total>99999999.99 OR p_internal_total<>round(p_internal_total,2) THEN RAISE EXCEPTION 'oop_internal_total_out_of_range'; END IF;
  IF p_minimum_adjustment IS NULL OR p_minimum_adjustment<0 OR p_minimum_adjustment>9999999999.99 OR p_minimum_adjustment<>round(p_minimum_adjustment,2) THEN RAISE EXCEPTION 'oop_minimum_adjustment_out_of_range'; END IF;
  IF p_lines IS NOT NULL THEN
    IF jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION 'oop_evaluated_lines_invalid'; END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      FOREACH v_key IN ARRAY ARRAY['amount','internalCost'] LOOP
        v_value:=COALESCE((v_line->>v_key)::numeric,0);
        IF abs(v_value)>99999999.99 OR v_value<>round(v_value,2) THEN RAISE EXCEPTION 'oop_pricing_line_out_of_range:%:%',COALESCE(v_line->>'key','unknown'),v_key; END IF;
      END LOOP;
    END LOOP;
  END IF;
END;
$function$;
-- Backward-compatible 26-argument write contract for deployed clients. The
-- signature cannot accept an idempotency key; this bounded compatibility path
-- is active-internal-only and recomputes all money before DML.
CREATE OR REPLACE FUNCTION public.upsert_oop_quote(
  p_id uuid,p_job_id uuid,p_job_type text,p_insured_name text,p_address text,
  p_tech_hours numeric,p_bill_rate numeric,p_air_mover_count integer,p_air_mover_days integer,
  p_lgr_count integer,p_lgr_days integer,p_xlgr_count integer,p_xlgr_days integer,
  p_air_scrubber_count integer,p_air_scrubber_days integer,p_neg_air_count integer,p_neg_air_days integer,
  p_materials_actual_cost numeric,p_antimicrobial_sqft numeric,p_disposal_trips integer,
  p_containment_linear_ft numeric,p_prv_invoice_cost numeric,p_quote_total numeric,
  p_net_margin_pct numeric,p_notes text,p_created_by uuid
) RETURNS public.oop_quotes LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_actor uuid; v_row public.oop_quotes; v_labor numeric; v_equipment numeric;
  v_quote_raw numeric; v_quote numeric; v_direct numeric; v_internal_total numeric; v_margin numeric; v_shadow jsonb;
BEGIN
  v_actor:=public.oop_pricing_active_employee(false);
  PERFORM public.oop_pricing_assert_job_exists(p_job_id);
  IF p_job_type IS NULL OR p_job_type NOT IN ('water','mold') THEN RAISE EXCEPTION 'invalid_job_type'; END IF;
  v_labor:=COALESCE(p_tech_hours,0)*COALESCE(p_bill_rate,92);
  v_equipment:=COALESCE(p_air_mover_count,0)*COALESCE(p_air_mover_days,0)*25
    +COALESCE(p_lgr_count,0)*COALESCE(p_lgr_days,0)*80
    +COALESCE(p_xlgr_count,0)*COALESCE(p_xlgr_days,0)*125
    +COALESCE(p_air_scrubber_count,0)*COALESCE(p_air_scrubber_days,0)*75
    +CASE WHEN p_job_type='mold' THEN COALESCE(p_neg_air_count,0)*COALESCE(p_neg_air_days,0)*110 ELSE 0 END;
  v_quote_raw:=v_labor+v_equipment+COALESCE(p_materials_actual_cost,0)*1.25
    +COALESCE(p_antimicrobial_sqft,0)*0.35+COALESCE(p_disposal_trips,0)*125
    +CASE WHEN p_job_type='mold' THEN COALESCE(p_containment_linear_ft,0)*2+v_labor*0.05 ELSE 0 END;
  v_direct:=COALESCE(p_tech_hours,0)*51+COALESCE(p_materials_actual_cost,0)
    +COALESCE(p_antimicrobial_sqft,0)*0.15+COALESCE(p_disposal_trips,0)*50
    +CASE WHEN p_job_type='mold' THEN COALESCE(p_containment_linear_ft,0)*1.2+v_labor*0.02+COALESCE(p_prv_invoice_cost,0) ELSE 0 END;
  v_quote:=round(v_quote_raw,2);
  v_internal_total:=round(v_direct+v_quote_raw*0.33,2);
  v_margin:=CASE WHEN v_quote_raw>0 THEN round((v_quote_raw-v_direct-v_quote_raw*0.33)*100/v_quote_raw,2) END;
  -- Full-precision parameters remain authoritative for the frozen legacy math;
  -- only the pre-existing compatibility columns are rounded to their typmods.
  v_shadow:=jsonb_build_object(
    'techHours',round(COALESCE(p_tech_hours,0),2),'billRate',round(COALESCE(p_bill_rate,92),2),
    'airMoverCount',COALESCE(p_air_mover_count,0),'airMoverDays',COALESCE(p_air_mover_days,0),
    'lgrCount',COALESCE(p_lgr_count,0),'lgrDays',COALESCE(p_lgr_days,0),
    'xlgrCount',COALESCE(p_xlgr_count,0),'xlgrDays',COALESCE(p_xlgr_days,0),
    'airScrubberCount',COALESCE(p_air_scrubber_count,0),'airScrubberDays',COALESCE(p_air_scrubber_days,0),
    'negAirCount',COALESCE(p_neg_air_count,0),'negAirDays',COALESCE(p_neg_air_days,0),
    'materialsActualCost',round(COALESCE(p_materials_actual_cost,0),2),'antimicrobialSqft',round(COALESCE(p_antimicrobial_sqft,0),2),
    'disposalTrips',COALESCE(p_disposal_trips,0),'containmentLinearFt',round(COALESCE(p_containment_linear_ft,0),2),
    'prvInvoiceCost',round(COALESCE(p_prv_invoice_cost,0),2));
  PERFORM public.oop_pricing_assert_storage_bounds(v_shadow,v_quote,v_margin,v_internal_total,NULL,0);
  -- Mark only this transaction-local DML as already canonical so the generic
  -- trigger does not recalculate money from the rounded shadow columns.
  PERFORM set_config('oop_pricing.legacy_canonical_write','on',true);
  IF p_id IS NULL THEN
    INSERT INTO public.oop_quotes(quote_number,job_id,job_type,insured_name,address,tech_hours,bill_rate,
      air_mover_count,air_mover_days,lgr_count,lgr_days,xlgr_count,xlgr_days,air_scrubber_count,air_scrubber_days,
      neg_air_count,neg_air_days,materials_actual_cost,antimicrobial_sqft,disposal_trips,containment_linear_ft,
      prv_invoice_cost,quote_total,net_margin_pct,notes,created_by)
    VALUES(public.generate_oop_quote_number(),p_job_id,p_job_type,p_insured_name,p_address,
      (v_shadow->>'techHours')::numeric,(v_shadow->>'billRate')::numeric,COALESCE(p_air_mover_count,0),COALESCE(p_air_mover_days,0),
      COALESCE(p_lgr_count,0),COALESCE(p_lgr_days,0),COALESCE(p_xlgr_count,0),COALESCE(p_xlgr_days,0),
      COALESCE(p_air_scrubber_count,0),COALESCE(p_air_scrubber_days,0),COALESCE(p_neg_air_count,0),COALESCE(p_neg_air_days,0),
      (v_shadow->>'materialsActualCost')::numeric,(v_shadow->>'antimicrobialSqft')::numeric,COALESCE(p_disposal_trips,0),
      (v_shadow->>'containmentLinearFt')::numeric,(v_shadow->>'prvInvoiceCost')::numeric,v_quote,v_margin,p_notes,v_actor)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.oop_quotes SET job_id=p_job_id,job_type=p_job_type,insured_name=p_insured_name,address=p_address,
      tech_hours=(v_shadow->>'techHours')::numeric,bill_rate=(v_shadow->>'billRate')::numeric,air_mover_count=COALESCE(p_air_mover_count,0),
      air_mover_days=COALESCE(p_air_mover_days,0),lgr_count=COALESCE(p_lgr_count,0),lgr_days=COALESCE(p_lgr_days,0),
      xlgr_count=COALESCE(p_xlgr_count,0),xlgr_days=COALESCE(p_xlgr_days,0),air_scrubber_count=COALESCE(p_air_scrubber_count,0),
      air_scrubber_days=COALESCE(p_air_scrubber_days,0),neg_air_count=COALESCE(p_neg_air_count,0),neg_air_days=COALESCE(p_neg_air_days,0),
      materials_actual_cost=(v_shadow->>'materialsActualCost')::numeric,antimicrobial_sqft=(v_shadow->>'antimicrobialSqft')::numeric,
      disposal_trips=COALESCE(p_disposal_trips,0),containment_linear_ft=(v_shadow->>'containmentLinearFt')::numeric,
      prv_invoice_cost=(v_shadow->>'prvInvoiceCost')::numeric,quote_total=v_quote,net_margin_pct=v_margin,notes=p_notes,updated_at=now()
    WHERE id=p_id RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'oop_quote_not_found'; END IF;
  END IF;
  PERFORM set_config('oop_pricing.legacy_canonical_write','off',true);
  RETURN v_row;
END;
$function$;
-- ─── SECTION: canonical quote calculation and persistence ──────────────────
CREATE OR REPLACE FUNCTION public.upsert_oop_quote_v2(p_id uuid DEFAULT NULL, p_job_id uuid DEFAULT NULL, p_job_type text DEFAULT NULL, p_insured_name text DEFAULT NULL, p_address text DEFAULT NULL, p_notes text DEFAULT NULL, p_pricing_revision_id uuid DEFAULT NULL, p_inputs jsonb DEFAULT '{}'::jsonb, p_expected_updated_at timestamptz DEFAULT NULL, p_request_id uuid DEFAULT NULL)
RETURNS public.oop_quotes LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_actor uuid; v_revision public.oop_pricing_revisions; v_existing public.oop_quotes; v_existing_snapshot public.oop_quote_pricing_snapshots; v_item jsonb; v_input jsonb; v_key text;
  v_raw_qty numeric; v_qty numeric; v_days numeric; v_rate numeric; v_base numeric; v_customer_raw numeric; v_customer numeric; v_internal_raw numeric; v_internal numeric;
  v_subtotal numeric:=0; v_internal_total numeric:=0; v_minimum numeric; v_adjustment numeric:=0;
  v_lines jsonb:='[]'::jsonb; v_deferred jsonb:='[]'::jsonb; v_deferred_item jsonb;
  v_row public.oop_quotes; v_request_hash text; v_saved_actor uuid; v_saved_hash text; v_margin numeric; v_shadow jsonb;
BEGIN
  v_actor:=public.oop_pricing_active_employee(false);
  PERFORM public.oop_pricing_assert_job_exists(p_job_id);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'request_id_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('oop_quote_save_request:' || p_request_id::text));
  IF p_job_type IS NULL OR p_job_type NOT IN ('water','mold') THEN RAISE EXCEPTION 'invalid_job_type'; END IF;
  IF p_inputs IS NULL OR jsonb_typeof(p_inputs)<>'object' THEN RAISE EXCEPTION 'invalid_pricing_inputs'; END IF;
  v_request_hash:=md5(jsonb_build_object('id',p_id,'jobId',p_job_id,'jobType',p_job_type,'insuredName',p_insured_name,'address',p_address,'notes',p_notes,'pricingRevisionId',p_pricing_revision_id,'inputs',p_inputs,'expectedUpdatedAt',p_expected_updated_at)::text);
  SELECT actor_employee_id,request_hash INTO v_saved_actor,v_saved_hash FROM public.oop_quote_save_requests WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_saved_actor IS DISTINCT FROM v_actor OR v_saved_hash<>v_request_hash THEN RAISE EXCEPTION 'request_id_reused_with_different_payload'; END IF;
    SELECT * INTO v_row FROM jsonb_populate_record(NULL::public.oop_quotes, (SELECT response FROM public.oop_quote_save_requests WHERE request_id=p_request_id));
    RETURN v_row;
  END IF;
  SELECT q.* INTO v_existing FROM public.oop_quotes q WHERE q.id=p_id FOR UPDATE;
  IF p_id IS NOT NULL AND v_existing.id IS NULL THEN RAISE EXCEPTION 'oop_quote_not_found'; END IF;
  IF v_existing.id IS NOT NULL AND (p_expected_updated_at IS NULL OR v_existing.updated_at<>p_expected_updated_at) THEN RAISE EXCEPTION 'quote_conflict'; END IF;
  IF v_existing.id IS NOT NULL THEN
    SELECT s.* INTO v_existing_snapshot FROM public.oop_quote_pricing_snapshots s WHERE s.quote_id=v_existing.id;
  END IF;
  IF v_existing_snapshot.quote_id IS NOT NULL AND p_pricing_revision_id IS NOT NULL AND v_existing_snapshot.pricing_revision_id<>p_pricing_revision_id THEN RAISE EXCEPTION 'pricing_revision_immutable'; END IF;
  IF p_pricing_revision_id IS NOT NULL THEN
    SELECT r.* INTO v_revision FROM public.oop_pricing_revisions r WHERE r.id=p_pricing_revision_id AND r.status IN ('published','superseded') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pricing_revision_not_found_or_not_published'; END IF;
  ELSIF v_existing_snapshot.quote_id IS NOT NULL THEN
    SELECT r.* INTO v_revision FROM public.oop_pricing_revisions r WHERE r.id=v_existing_snapshot.pricing_revision_id AND r.status IN ('published','superseded') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pricing_pinned_revision_missing'; END IF;
  ELSIF p_id IS NOT NULL THEN
    SELECT r.* INTO v_revision FROM public.oop_pricing_revisions r WHERE r.revision_number=1 AND r.status IN ('published','superseded') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pricing_legacy_revision_missing'; END IF;
  ELSE
    SELECT r.* INTO v_revision FROM public.oop_pricing_revisions r WHERE r.status='published' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pricing_published_revision_missing'; END IF;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_inputs) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_revision.config->'items') i WHERE i->>'key'=v_key) THEN RAISE EXCEPTION 'unknown_pricing_input'; END IF;
  END LOOP;
  -- One deterministic pass preserves calcPricingQuote's prior-subtotal and
  -- named-item semantics. Inputs are validated before inactive/job-type skips.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_revision.config->'items') ORDER BY (value->>'sortOrder')::integer,value->>'key' LOOP
    v_key:=v_item->>'key'; v_input:=COALESCE(p_inputs->v_key,'{}'::jsonb);
    IF jsonb_typeof(v_input)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(v_input) x WHERE x.key NOT IN ('quantity','days','rateOverride') OR jsonb_typeof(x.value)<>'number') THEN RAISE EXCEPTION 'invalid_pricing_input'; END IF;
    v_raw_qty:=COALESCE((v_input->>'quantity')::numeric,0); v_days:=COALESCE((v_input->>'days')::numeric,0);
    IF v_raw_qty<0 OR v_raw_qty>1000000 OR v_days<0 OR v_days>1000000 OR (v_input?'rateOverride' AND ((v_input->>'rateOverride')::numeric<0 OR (v_input->>'rateOverride')::numeric>1000000)) THEN RAISE EXCEPTION 'invalid_pricing_input_bounds'; END IF;
    IF v_raw_qty<>round(v_raw_qty,4) OR v_days<>round(v_days,4) OR (v_input?'rateOverride' AND (v_input->>'rateOverride')::numeric<>round((v_input->>'rateOverride')::numeric,4)) THEN RAISE EXCEPTION 'invalid_pricing_input_precision'; END IF;
    IF NOT(v_item->'jobTypes'?p_job_type) OR (v_item->>'active')::boolean IS FALSE THEN CONTINUE; END IF;
    v_qty:=CASE WHEN v_raw_qty>0 THEN greatest(v_raw_qty,(v_item->>'minimumQuantity')::numeric) ELSE 0 END;
    v_rate:=COALESCE((v_input->>'rateOverride')::numeric,(v_item->>'standardRate')::numeric);
    IF v_input?'rateOverride' AND (v_item->>'priceOverrideAllowed')::boolean IS FALSE THEN RAISE EXCEPTION 'invalid_pricing_rate'; END IF;
    v_base:=CASE
      WHEN v_item->>'percentageBase'='prior_subtotal' THEN v_subtotal
      WHEN v_item->>'percentageBase'='final_total' THEN NULL
      WHEN v_item->>'percentageBase' LIKE 'item:%' THEN COALESCE((SELECT (x->>'amount')::numeric FROM jsonb_array_elements(v_lines) x WHERE x->>'key'=substring(v_item->>'percentageBase' from 6) AND COALESCE((x->>'customerVisible')::boolean,false)),0)
      ELSE 0 END;
    v_customer_raw:=CASE v_item->>'formula'
      WHEN 'fixed' THEN CASE WHEN v_qty>0 THEN v_rate ELSE 0 END
      WHEN 'duration' THEN v_qty*v_days*v_rate
      WHEN 'percentage' THEN COALESCE(v_base,0)*v_rate
      ELSE v_qty*v_rate END;
    v_internal_raw:=CASE v_item->>'internalCostBasis'
      WHEN 'units' THEN CASE WHEN v_item->>'formula'='duration' THEN v_qty*v_days ELSE v_qty END*(v_item->>'internalRate')::numeric
      WHEN 'input' THEN v_raw_qty*(v_item->>'internalRate')::numeric
      WHEN 'percentage_base' THEN COALESCE(v_base,0)*(v_item->>'internalRate')::numeric
      ELSE 0 END;
    v_customer:=round(v_customer_raw,2);
    IF v_customer_raw>0 THEN v_customer:=round(greatest(v_customer,(v_item->>'minimumCharge')::numeric),2); END IF;
    IF v_item->>'internalCostBasis'='final_total' THEN
      v_internal:=0;
      v_deferred:=v_deferred||jsonb_build_array(jsonb_build_object('key',v_key,'internalRate',(v_item->>'internalRate')::numeric));
    ELSE
      v_internal:=round(v_internal_raw,2);
    END IF;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key',v_key,'sortOrder',(v_item->>'sortOrder')::integer,'quantity',v_qty,'days',v_days,'rate',v_rate,'amount',v_customer,'internalCost',v_internal,'customerVisible',(v_item->>'customerVisible')::boolean));
    IF (v_item->>'customerVisible')::boolean THEN v_subtotal:=round(v_subtotal+v_customer,2); END IF;
    v_internal_total:=round(v_internal_total+v_internal,2);
  END LOOP;
  v_minimum:=COALESCE((v_revision.config->'projectMinimums'->>p_job_type)::numeric,0);
  IF v_subtotal>0 AND v_subtotal<v_minimum THEN
    v_adjustment:=round(v_minimum-v_subtotal,2); v_subtotal:=round(v_subtotal+v_adjustment,2);
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','project_minimum_adjustment','amount',v_adjustment,'internalCost',0,'customerVisible',true));
  END IF;
  -- Only final_total internal costs are deferred, and they use the visible quote
  -- after the project minimum adjustment exactly like calcPricingQuote.
  FOR v_deferred_item IN SELECT value FROM jsonb_array_elements(v_deferred) LOOP
    v_internal:=round(v_subtotal*(v_deferred_item->>'internalRate')::numeric,2);
    v_internal_total:=round(v_internal_total+v_internal,2);
    SELECT jsonb_agg(CASE WHEN x.value->>'key'=v_deferred_item->>'key' THEN jsonb_set(x.value,'{internalCost}',to_jsonb(v_internal)) ELSE x.value END ORDER BY x.ordinality)
      INTO v_lines FROM jsonb_array_elements(v_lines) WITH ORDINALITY x(value,ordinality);
  END LOOP;
  v_margin:=CASE WHEN v_subtotal>0 THEN round((v_subtotal-v_internal_total)*100/v_subtotal,2) END;
  -- Exact four-decimal inputs remain in pricing_inputs and drive calculation.
  -- Only legacy compatibility columns are rounded to their storage shapes.
  v_shadow:=jsonb_build_object(
    'techHours',round(COALESCE((p_inputs->'labor'->>'quantity')::numeric,0),2),
    'billRate',round(COALESCE((SELECT (x->>'rate')::numeric FROM jsonb_array_elements(v_lines) x WHERE x->>'key'='labor'),92),2),
    'airMoverCount',round(COALESCE((p_inputs->'air_mover'->>'quantity')::numeric,0)),'airMoverDays',round(COALESCE((p_inputs->'air_mover'->>'days')::numeric,0)),
    'lgrCount',round(COALESCE((p_inputs->'lgr'->>'quantity')::numeric,0)),'lgrDays',round(COALESCE((p_inputs->'lgr'->>'days')::numeric,0)),
    'xlgrCount',round(COALESCE((p_inputs->'xlgr'->>'quantity')::numeric,0)),'xlgrDays',round(COALESCE((p_inputs->'xlgr'->>'days')::numeric,0)),
    'airScrubberCount',round(COALESCE((p_inputs->'air_scrubber'->>'quantity')::numeric,0)),'airScrubberDays',round(COALESCE((p_inputs->'air_scrubber'->>'days')::numeric,0)),
    'negAirCount',round(COALESCE((p_inputs->'negative_air'->>'quantity')::numeric,0)),'negAirDays',round(COALESCE((p_inputs->'negative_air'->>'days')::numeric,0)),
    'materialsActualCost',round(COALESCE((p_inputs->'materials'->>'quantity')::numeric,0),2),'antimicrobialSqft',round(COALESCE((p_inputs->'antimicrobial'->>'quantity')::numeric,0),2),
    'disposalTrips',round(COALESCE((p_inputs->'disposal'->>'quantity')::numeric,0)),'containmentLinearFt',round(COALESCE((p_inputs->'containment'->>'quantity')::numeric,0),2),
    'prvInvoiceCost',round(COALESCE((p_inputs->'prv'->>'quantity')::numeric,0),2)
  );
  PERFORM public.oop_pricing_assert_storage_bounds(v_shadow,v_subtotal,v_margin,v_internal_total,v_lines,v_adjustment);
  PERFORM set_config('oop_pricing.v2_write','on',true);
  IF p_id IS NULL THEN
    INSERT INTO public.oop_quotes(
      quote_number,job_id,job_type,insured_name,address,tech_hours,bill_rate,
      air_mover_count,air_mover_days,lgr_count,lgr_days,xlgr_count,xlgr_days,
      air_scrubber_count,air_scrubber_days,neg_air_count,neg_air_days,
      materials_actual_cost,antimicrobial_sqft,disposal_trips,
      containment_linear_ft,prv_invoice_cost,quote_total,net_margin_pct,notes,created_by
    ) VALUES(
      public.generate_oop_quote_number(),p_job_id,p_job_type,p_insured_name,p_address,
      (v_shadow->>'techHours')::numeric,(v_shadow->>'billRate')::numeric,
      (v_shadow->>'airMoverCount')::integer,(v_shadow->>'airMoverDays')::integer,
      (v_shadow->>'lgrCount')::integer,(v_shadow->>'lgrDays')::integer,
      (v_shadow->>'xlgrCount')::integer,(v_shadow->>'xlgrDays')::integer,
      (v_shadow->>'airScrubberCount')::integer,(v_shadow->>'airScrubberDays')::integer,
      (v_shadow->>'negAirCount')::integer,(v_shadow->>'negAirDays')::integer,
      (v_shadow->>'materialsActualCost')::numeric,(v_shadow->>'antimicrobialSqft')::numeric,
      (v_shadow->>'disposalTrips')::integer,(v_shadow->>'containmentLinearFt')::numeric,
      (v_shadow->>'prvInvoiceCost')::numeric,v_subtotal,v_margin,p_notes,v_actor
    ) RETURNING * INTO v_row;
  ELSE
    UPDATE public.oop_quotes SET
      job_id=p_job_id,job_type=p_job_type,insured_name=p_insured_name,address=p_address,
      tech_hours=(v_shadow->>'techHours')::numeric,bill_rate=(v_shadow->>'billRate')::numeric,
      air_mover_count=(v_shadow->>'airMoverCount')::integer,air_mover_days=(v_shadow->>'airMoverDays')::integer,
      lgr_count=(v_shadow->>'lgrCount')::integer,lgr_days=(v_shadow->>'lgrDays')::integer,
      xlgr_count=(v_shadow->>'xlgrCount')::integer,xlgr_days=(v_shadow->>'xlgrDays')::integer,
      air_scrubber_count=(v_shadow->>'airScrubberCount')::integer,air_scrubber_days=(v_shadow->>'airScrubberDays')::integer,
      neg_air_count=(v_shadow->>'negAirCount')::integer,neg_air_days=(v_shadow->>'negAirDays')::integer,
      materials_actual_cost=(v_shadow->>'materialsActualCost')::numeric,
      antimicrobial_sqft=(v_shadow->>'antimicrobialSqft')::numeric,
      disposal_trips=(v_shadow->>'disposalTrips')::integer,
      containment_linear_ft=(v_shadow->>'containmentLinearFt')::numeric,
      prv_invoice_cost=(v_shadow->>'prvInvoiceCost')::numeric,
      quote_total=v_subtotal,net_margin_pct=v_margin,notes=p_notes,updated_at=now()
    WHERE id=p_id RETURNING * INTO v_row;
  END IF;
  PERFORM set_config('oop_pricing.v2_write','off',true);
  INSERT INTO public.oop_quote_pricing_snapshots(
    quote_id,pricing_revision_id,pricing_inputs,pricing_config_snapshot,
    pricing_evaluated_lines,pricing_engine_version,pricing_minimum_adjustment
  ) VALUES(v_row.id,v_revision.id,p_inputs,v_revision.config,v_lines,1,v_adjustment)
  ON CONFLICT (quote_id) DO UPDATE SET
    pricing_revision_id=EXCLUDED.pricing_revision_id,
    pricing_inputs=EXCLUDED.pricing_inputs,
    pricing_config_snapshot=EXCLUDED.pricing_config_snapshot,
    pricing_evaluated_lines=EXCLUDED.pricing_evaluated_lines,
    pricing_engine_version=EXCLUDED.pricing_engine_version,
    pricing_minimum_adjustment=EXCLUDED.pricing_minimum_adjustment,
    cleared_at=NULL,
    updated_at=now();
  INSERT INTO public.oop_quote_save_requests(request_id,quote_id,actor_employee_id,request_hash,response)
    VALUES(p_request_id,v_row.id,v_actor,v_request_hash,to_jsonb(v_row));
  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.oop_clear_v2_snapshot_on_legacy_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  IF current_setting('oop_pricing.v2_write',true) IS DISTINCT FROM 'on' THEN
    UPDATE public.oop_quote_pricing_snapshots
      SET cleared_at=now(), updated_at=now()
      WHERE quote_id=NEW.id AND cleared_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER oop_clear_v2_snapshot_on_legacy_update
  AFTER UPDATE ON public.oop_quotes
  FOR EACH ROW EXECUTE FUNCTION public.oop_clear_v2_snapshot_on_legacy_update();
-- Preserve the deployed legacy RPC signatures while putting their writes and
-- reads behind the same active-internal employee boundary as the v2 contract.
CREATE OR REPLACE FUNCTION public.oop_require_active_internal_quote_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_actor uuid; v_labor numeric; v_equipment numeric; v_quote_raw numeric;
  v_direct numeric; v_internal_total numeric; v_margin numeric;
BEGIN
  v_actor:=public.oop_pricing_active_employee(false);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  PERFORM public.oop_pricing_assert_job_exists(NEW.job_id);
  IF NEW.job_type IS NULL OR NEW.job_type NOT IN ('water','mold') THEN RAISE EXCEPTION 'invalid_job_type'; END IF;
  IF TG_OP='INSERT' THEN NEW.created_by:=v_actor; ELSE NEW.created_by:=OLD.created_by; END IF;

  -- Bounded compatibility exception: already-deployed legacy callers have no
  -- request-id parameter, so this path cannot be idempotent without breaking
  -- its frozen 26-argument signature. It is active-internal-only and every
  -- client-supplied total/margin is replaced by the exact frozen v1 math.
  IF current_setting('oop_pricing.v2_write',true) IS DISTINCT FROM 'on'
    AND current_setting('oop_pricing.legacy_canonical_write',true) IS DISTINCT FROM 'on' THEN
    v_labor:=COALESCE(NEW.tech_hours,0)*COALESCE(NEW.bill_rate,92);
    v_equipment:=COALESCE(NEW.air_mover_count,0)*COALESCE(NEW.air_mover_days,0)*25
      +COALESCE(NEW.lgr_count,0)*COALESCE(NEW.lgr_days,0)*80
      +COALESCE(NEW.xlgr_count,0)*COALESCE(NEW.xlgr_days,0)*125
      +COALESCE(NEW.air_scrubber_count,0)*COALESCE(NEW.air_scrubber_days,0)*75
      +CASE WHEN NEW.job_type='mold' THEN COALESCE(NEW.neg_air_count,0)*COALESCE(NEW.neg_air_days,0)*110 ELSE 0 END;
    v_quote_raw:=v_labor+v_equipment+COALESCE(NEW.materials_actual_cost,0)*1.25
      +COALESCE(NEW.antimicrobial_sqft,0)*0.35+COALESCE(NEW.disposal_trips,0)*125
      +CASE WHEN NEW.job_type='mold' THEN COALESCE(NEW.containment_linear_ft,0)*2+v_labor*0.05 ELSE 0 END;
    v_direct:=COALESCE(NEW.tech_hours,0)*51+COALESCE(NEW.materials_actual_cost,0)
      +COALESCE(NEW.antimicrobial_sqft,0)*0.15+COALESCE(NEW.disposal_trips,0)*50
      +CASE WHEN NEW.job_type='mold' THEN COALESCE(NEW.containment_linear_ft,0)*1.2+v_labor*0.02+COALESCE(NEW.prv_invoice_cost,0) ELSE 0 END;
    v_internal_total:=round(v_direct+v_quote_raw*0.33,2);
    NEW.quote_total:=round(v_quote_raw,2);
    v_margin:=CASE WHEN v_quote_raw>0 THEN round((v_quote_raw-v_direct-v_quote_raw*0.33)*100/v_quote_raw,2) END;
    NEW.net_margin_pct:=v_margin;
    PERFORM public.oop_pricing_assert_storage_bounds(
      jsonb_build_object('techHours',COALESCE(NEW.tech_hours,0),'billRate',COALESCE(NEW.bill_rate,92),
        'airMoverCount',COALESCE(NEW.air_mover_count,0),'airMoverDays',COALESCE(NEW.air_mover_days,0),
        'lgrCount',COALESCE(NEW.lgr_count,0),'lgrDays',COALESCE(NEW.lgr_days,0),
        'xlgrCount',COALESCE(NEW.xlgr_count,0),'xlgrDays',COALESCE(NEW.xlgr_days,0),
        'airScrubberCount',COALESCE(NEW.air_scrubber_count,0),'airScrubberDays',COALESCE(NEW.air_scrubber_days,0),
        'negAirCount',COALESCE(NEW.neg_air_count,0),'negAirDays',COALESCE(NEW.neg_air_days,0),
        'materialsActualCost',COALESCE(NEW.materials_actual_cost,0),'antimicrobialSqft',COALESCE(NEW.antimicrobial_sqft,0),
        'disposalTrips',COALESCE(NEW.disposal_trips,0),'containmentLinearFt',COALESCE(NEW.containment_linear_ft,0),
        'prvInvoiceCost',COALESCE(NEW.prv_invoice_cost,0)),NEW.quote_total,NEW.net_margin_pct,v_internal_total,NULL,0);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER oop_require_active_internal_quote_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.oop_quotes
  FOR EACH ROW EXECUTE FUNCTION public.oop_require_active_internal_quote_write();

CREATE OR REPLACE FUNCTION public.get_oop_quote(p_id uuid)
RETURNS public.oop_quotes LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_row public.oop_quotes;
BEGIN
  PERFORM public.oop_pricing_active_employee(false);
  SELECT q.* INTO v_row FROM public.oop_quotes q WHERE q.id=p_id;
  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_oop_quote_v2(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.oop_pricing_active_employee(false);
  SELECT to_jsonb(q)||CASE WHEN s.quote_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'pricing_revision_id',s.pricing_revision_id,
      'pricing_inputs',s.pricing_inputs,
      'pricing_config_snapshot',s.pricing_config_snapshot,
      'pricing_evaluated_lines',s.pricing_evaluated_lines,
      'pricing_engine_version',s.pricing_engine_version,
      'pricing_minimum_adjustment',s.pricing_minimum_adjustment
    ) END
    INTO v_result
    FROM public.oop_quotes q
    LEFT JOIN public.oop_quote_pricing_snapshots s
      ON s.quote_id=q.id AND s.cleared_at IS NULL
    WHERE q.id=p_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_oop_quotes(p_limit integer DEFAULT 50, p_job_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, quote_number text, job_id uuid, job_type text, insured_name text, address text, quote_total numeric, net_margin_pct numeric, created_at timestamptz, created_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.oop_pricing_active_employee(false);
  PERFORM public.oop_pricing_assert_job_exists(p_job_id);
  RETURN QUERY SELECT q.id,q.quote_number,q.job_id,q.job_type,q.insured_name,q.address,q.quote_total,q.net_margin_pct,q.created_at,q.created_by
    FROM public.oop_quotes q WHERE (p_job_id IS NULL OR q.job_id=p_job_id)
    ORDER BY q.created_at DESC LIMIT least(greatest(COALESCE(p_limit,50),1),200);
END;
$function$;
CREATE OR REPLACE FUNCTION public.delete_oop_quote(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.oop_pricing_active_employee(false);
  DELETE FROM public.oop_quotes WHERE id=p_id;
  RETURN FOUND;
END;
$function$;
-- Seed revision 1 is the shipped calculator; revision 2 is the editable clone.
INSERT INTO public.oop_pricing_revisions(revision_number,status,config,published_at) VALUES
(1,'published','{"schemaVersion":1,"name":"Legacy OOP pricing","projectMinimums":{"water":0,"mold":0},"items":[{"key":"labor","label":"Labor","helpText":"","section":"Labor","sortOrder":10,"jobTypes":["mold","water"],"formula":"quantity","unit":"hour","standardRate":92,"internalRate":51,"internalCostBasis":"units","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":true},{"key":"air_mover","label":"Air mover","helpText":"","section":"Equipment","sortOrder":20,"jobTypes":["mold","water"],"formula":"duration","unit":"day","standardRate":25,"internalRate":0,"internalCostBasis":"none","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"lgr","label":"LGR dehumidifier","helpText":"","section":"Equipment","sortOrder":30,"jobTypes":["mold","water"],"formula":"duration","unit":"day","standardRate":80,"internalRate":0,"internalCostBasis":"none","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"xlgr","label":"XLGR dehumidifier","helpText":"","section":"Equipment","sortOrder":40,"jobTypes":["mold","water"],"formula":"duration","unit":"day","standardRate":125,"internalRate":0,"internalCostBasis":"none","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"air_scrubber","label":"Air scrubber","helpText":"","section":"Equipment","sortOrder":50,"jobTypes":["mold","water"],"formula":"duration","unit":"day","standardRate":75,"internalRate":0,"internalCostBasis":"none","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"negative_air","label":"Negative air setup","helpText":"","section":"Equipment","sortOrder":60,"jobTypes":["mold"],"formula":"duration","unit":"day","standardRate":110,"internalRate":0,"internalCostBasis":"none","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"materials","label":"Materials","helpText":"","section":"Materials","sortOrder":70,"jobTypes":["mold","water"],"formula":"cost_plus","unit":"cost","standardRate":1.25,"internalRate":1,"internalCostBasis":"input","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"antimicrobial","label":"Antimicrobial","helpText":"","section":"Materials","sortOrder":80,"jobTypes":["mold","water"],"formula":"quantity","unit":"sqft","standardRate":0.35,"internalRate":0.15,"internalCostBasis":"units","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"disposal","label":"Disposal","helpText":"","section":"Materials","sortOrder":90,"jobTypes":["mold","water"],"formula":"quantity","unit":"trip","standardRate":125,"internalRate":50,"internalCostBasis":"units","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"containment","label":"Containment","helpText":"","section":"Containment","sortOrder":100,"jobTypes":["mold"],"formula":"quantity","unit":"linear ft","standardRate":2,"internalRate":1.2,"internalCostBasis":"units","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"ppe","label":"PPE","helpText":"","section":"Containment","sortOrder":110,"jobTypes":["mold"],"formula":"percentage","unit":"labor","standardRate":0.05,"internalRate":0.02,"internalCostBasis":"percentage_base","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":"item:labor","customerVisible":true,"active":true,"priceOverrideAllowed":false},{"key":"prv","label":"PRV","helpText":"","section":"Containment","sortOrder":120,"jobTypes":["mold"],"formula":"pass_through","unit":"cost","standardRate":0,"internalRate":1,"internalCostBasis":"input","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":null,"customerVisible":false,"active":true,"priceOverrideAllowed":false},{"key":"overhead","label":"Overhead","helpText":"","section":"Internal","sortOrder":130,"jobTypes":["mold","water"],"formula":"percentage","unit":"revenue","standardRate":0,"internalRate":0.33,"internalCostBasis":"final_total","minimumQuantity":0,"minimumCharge":0,"defaultQuantity":0,"defaultDays":0,"percentageBase":"final_total","customerVisible":false,"active":true,"priceOverrideAllowed":false}]}'::jsonb,now()) ON CONFLICT (revision_number) DO NOTHING;
INSERT INTO public.oop_pricing_revisions(revision_number,status,config) SELECT 2,'draft',config FROM public.oop_pricing_revisions WHERE revision_number=1 ON CONFLICT (revision_number) DO NOTHING;

-- The RLS predicate exposes only a caller-scoped boolean to authenticated users.
REVOKE EXECUTE ON FUNCTION public.oop_pricing_calculator_access() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oop_pricing_calculator_access() TO authenticated;
-- All other helpers remain private to the SECURITY DEFINER call chain.
REVOKE EXECUTE ON FUNCTION public.oop_pricing_active_employee(boolean), public.oop_pricing_assert_job_exists(uuid), public.oop_pricing_validate_config(jsonb), public.oop_pricing_assert_storage_bounds(jsonb,numeric,numeric,numeric,jsonb,numeric), public.oop_clear_v2_snapshot_on_legacy_update(), public.oop_require_active_internal_quote_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.generate_oop_quote_number() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_oop_pricing_config(uuid), public.get_oop_pricing_admin_state(), public.save_oop_pricing_draft(integer,jsonb,uuid), public.publish_oop_pricing_draft(integer,uuid), public.upsert_oop_quote_v2(uuid,uuid,text,text,text,text,uuid,jsonb,timestamptz,uuid), public.get_oop_quote_v2(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_oop_quote(uuid), public.get_oop_quotes(integer,uuid), public.delete_oop_quote(uuid), public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_oop_pricing_config(uuid), public.get_oop_pricing_admin_state(), public.save_oop_pricing_draft(integer,jsonb,uuid), public.publish_oop_pricing_draft(integer,uuid), public.upsert_oop_quote_v2(uuid,uuid,text,text,text,text,uuid,jsonb,timestamptz,uuid), public.get_oop_quote_v2(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oop_quote(uuid), public.get_oop_quotes(integer,uuid), public.delete_oop_quote(uuid), public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid) TO authenticated, service_role;
DO $postcondition$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name IN ('oop_pricing_revisions','oop_pricing_audit','oop_quote_save_requests','oop_quote_pricing_snapshots')
      AND grantee IN ('anon','authenticated','PUBLIC')
  ) THEN
    RAISE EXCEPTION 'postcondition: browser-role table grant leaked';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes')<>4
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='oop_quotes'
          AND policyname IN ('oop_quotes authenticated read','oop_quotes authenticated insert','oop_quotes authenticated update','oop_quotes authenticated delete')
          AND roles=ARRAY['authenticated']::name[])<>4 THEN
    RAISE EXCEPTION 'postcondition: oop_quotes role-and-rollout policies incomplete or unexpected';
  END IF;
END $postcondition$;
NOTIFY pgrst, 'reload schema';
