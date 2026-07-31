-- ════════════════════════════════════════════════
-- FILE: oop_pricing_builder_rollback_isolated.sql
-- ════════════════════════════════════════════════
-- WHAT THIS DOES (plain language): On an isolated database only, creates a
-- configured quote, executes the owner-gated rollback, and proves rollback
-- disables the builder while keeping legacy quote access fail-closed, canonical,
-- and available only to the five approved active/internal roles under the exact
-- tool:oop_pricing rollout predicate.
-- DEPENDS ON: forward OOP pricing migration and its paired rollback.
-- NOTES / GOTCHAS: Never run against the shared UPR project.
-- ════════════════════════════════════════════════
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing OOP pricing rollback test: isolated database guard missing';
  END IF;
  IF current_database() IN ('postgres', 'glsmljpabrwonfiltiqm') THEN
    RAISE EXCEPTION 'refusing OOP pricing rollback test on shared database';
  END IF;
END $guard$;
BEGIN;

INSERT INTO public.employees(id,full_name,role,is_active,is_external,auth_user_id) VALUES
  ('11000000-0000-4000-8000-000000000001','OOP Rollback Admin','admin',true,false,'21000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-000000000002','OOP Rollback Office','office',true,false,'21000000-0000-4000-8000-000000000002'),
  ('11000000-0000-4000-8000-000000000003','OOP Rollback Supervisor','supervisor',true,false,'21000000-0000-4000-8000-000000000003'),
  ('11000000-0000-4000-8000-000000000004','OOP Rollback Estimator','estimator',true,false,'21000000-0000-4000-8000-000000000004'),
  ('11000000-0000-4000-8000-000000000005','OOP Rollback Project Manager','project_manager',true,false,'21000000-0000-4000-8000-000000000005'),
  ('11000000-0000-4000-8000-000000000006','OOP Rollback Field Tech','field_tech',true,false,'21000000-0000-4000-8000-000000000006'),
  ('11000000-0000-4000-8000-000000000007','OOP Rollback CRM Partner','crm_partner',true,false,'21000000-0000-4000-8000-000000000007'),
  ('11000000-0000-4000-8000-000000000008','OOP Rollback Inactive Office','office',false,false,'21000000-0000-4000-8000-000000000008'),
  ('11000000-0000-4000-8000-000000000009','OOP Rollback External Office','office',true,true,'21000000-0000-4000-8000-000000000009');
INSERT INTO public.jobs(id,job_number) VALUES
  ('51000000-0000-4000-8000-000000000001','OOP-ROLLBACK-JOB-1'),
  ('51000000-0000-4000-8000-000000000002','OOP-ROLLBACK-JOB-2');
UPDATE public.feature_flags
  SET enabled=true,dev_only_user_id=NULL,force_disabled=false
  WHERE key='tool:oop_pricing';

-- The disposable bootstrap does not carry the managed Data API table grants.
-- Grant them only inside this rolled-back transaction so direct RLS/trigger
-- behavior can be proven for both approved and denied authenticated callers.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oop_quotes TO authenticated;

SET LOCAL ROLE authenticated;
DO $pre_rollback_fixture$
DECLARE v_revision uuid; v_quote public.oop_quotes;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
  v_revision:=(public.get_oop_pricing_config(NULL)->>'id')::uuid;
  v_quote:=public.upsert_oop_quote_v2(
    p_job_id=>'51000000-0000-4000-8000-000000000001'::uuid,
    p_job_type=>'water',p_insured_name=>'Rollback retained snapshot',p_pricing_revision_id=>v_revision,
    p_inputs=>'{"labor":{"quantity":1}}'::jsonb,
    p_request_id=>'31000000-0000-4000-8000-000000000001'::uuid
  );
  PERFORM set_config('oop_pricing.rollback_snapshot_quote',v_quote.id::text,true);
END $pre_rollback_fixture$;
RESET ROLE;

SET LOCAL app.oop_pricing_rollback = 'approved';
\ir ../rollbacks/20260730150000_oop_pricing_builder.rollback.sql

DO $catalog$
DECLARE
  v_generator text:=lower(pg_get_functiondef('public.generate_oop_quote_number()'::regprocedure));
  v_upsert text:=lower(pg_get_functiondef('public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid)'::regprocedure));
  v_quote_id uuid:=current_setting('oop_pricing.rollback_snapshot_quote')::uuid;
BEGIN
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid='public.oop_quotes'::regclass AND NOT tgisinternal
        AND tgname IN ('oop_clear_v2_snapshot_on_legacy_update','oop_require_active_internal_quote_write'))<>2 THEN
    RAISE EXCEPTION 'rollback did not retain both safe quote triggers';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.oop_quote_pricing_snapshots WHERE quote_id=v_quote_id AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'rollback did not retain configured quote snapshot data';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.oop_quote_save_requests WHERE request_id='31000000-0000-4000-8000-000000000001'::uuid AND quote_id=v_quote_id) THEN
    RAISE EXCEPTION 'rollback did not retain the private idempotency record';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'
        AND c.relname IN ('oop_pricing_revisions','oop_pricing_audit','oop_quote_save_requests','oop_quote_pricing_snapshots')
        AND c.relrowsecurity AND c.relforcerowsecurity)<>4 THEN
    RAISE EXCEPTION 'rollback weakened private pricing-table RLS';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema='public'
        AND table_name IN ('oop_pricing_revisions','oop_pricing_audit','oop_quote_save_requests','oop_quote_pricing_snapshots')
        AND grantee IN ('anon','authenticated','PUBLIC')) THEN
    RAISE EXCEPTION 'rollback exposed a private pricing table';
  END IF;

  IF has_function_privilege('authenticated','public.get_oop_quote_v2(uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.get_oop_quote_v2(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.upsert_oop_quote_v2(uuid,uuid,text,text,text,text,uuid,jsonb,timestamp with time zone,uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.upsert_oop_quote_v2(uuid,uuid,text,text,text,text,uuid,jsonb,timestamp with time zone,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.get_oop_pricing_config(uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.get_oop_pricing_admin_state()','EXECUTE') THEN
    RAISE EXCEPTION 'rollback left the configurable builder surface executable';
  END IF;
  IF NOT has_function_privilege('authenticated','public.oop_pricing_calculator_access()','EXECUTE')
    OR has_function_privilege('anon','public.oop_pricing_calculator_access()','EXECUTE')
    OR has_function_privilege('service_role','public.oop_pricing_calculator_access()','EXECUTE')
    OR has_function_privilege('authenticated','public.oop_pricing_active_employee(boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback authorization-helper grants are not least privilege';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes')<>4
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes'
        AND policyname='oop_quotes authenticated read' AND cmd='SELECT'
        AND position('oop_pricing_calculator_access' in coalesce(qual,''))>0)<>1
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes'
        AND policyname='oop_quotes authenticated insert' AND cmd='INSERT'
        AND position('oop_pricing_calculator_access' in coalesce(with_check,''))>0)<>1
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes'
        AND policyname='oop_quotes authenticated update' AND cmd='UPDATE'
        AND position('oop_pricing_calculator_access' in coalesce(qual,''))>0
        AND position('oop_pricing_calculator_access' in coalesce(with_check,''))>0)<>1
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes'
        AND policyname='oop_quotes authenticated delete' AND cmd='DELETE'
        AND position('oop_pricing_calculator_access' in coalesce(qual,''))>0)<>1
    OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes'
        AND (roles<>ARRAY['authenticated']::name[] OR qual='true' OR with_check='true')) THEN
    RAISE EXCEPTION 'rollback did not retain exact fail-closed quote policies';
  END IF;

  IF has_function_privilege('authenticated','public.generate_oop_quote_number()','EXECUTE')
    OR has_function_privilege('service_role','public.generate_oop_quote_number()','EXECUTE')
    OR has_function_privilege('anon','public.generate_oop_quote_number()','EXECUTE') THEN
    RAISE EXCEPTION 'rollback exposed the private quote-number generator';
  END IF;
  IF NOT has_function_privilege('authenticated','public.get_oop_quote(uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.get_oop_quote(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.get_oop_quote(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback guarded legacy RPC grants drifted';
  END IF;
  IF position('pg_advisory_xact_lock' in v_generator)=0 OR position('america/denver' in v_generator)=0 THEN
    RAISE EXCEPTION 'rollback weakened quote-number collision or timezone safety';
  END IF;
  IF position('oop_pricing_active_employee(false)' in v_upsert)=0
    OR position('oop_pricing_assert_job_exists(p_job_id)' in v_upsert)=0
    OR position('v_quote:=round(v_quote_raw,2)' in v_upsert)=0
    OR position('quote_total=p_quote_total' in replace(v_upsert,' ',''))>0 THEN
    RAISE EXCEPTION 'rollback weakened the server-derived legacy money contract';
  END IF;
END $catalog$;

SET LOCAL ROLE authenticated;
DO $approved_role_matrix$
DECLARE v_auth text; v_count integer; v_quote_id uuid:=current_setting('oop_pricing.rollback_snapshot_quote')::uuid;
BEGIN
  FOREACH v_auth IN ARRAY ARRAY[
    '21000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000004',
    '21000000-0000-4000-8000-000000000005'
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_auth,true);
    SELECT count(*) INTO v_count FROM public.oop_quotes q WHERE q.id=v_quote_id;
    IF v_count<>1 THEN RAISE EXCEPTION 'approved rollback role could not directly read the company quote: %',v_auth; END IF;
    IF (public.get_oop_quote(v_quote_id)).id IS DISTINCT FROM v_quote_id THEN
      RAISE EXCEPTION 'approved rollback role could not use legacy get: %',v_auth;
    END IF;
    SELECT count(*) INTO v_count FROM public.get_oop_quotes(50,NULL) q WHERE q.id=v_quote_id;
    IF v_count<>1 THEN RAISE EXCEPTION 'approved rollback role could not use legacy list: %',v_auth; END IF;
  END LOOP;
END $approved_role_matrix$;

DO $legacy_money_and_direct_writes$
DECLARE
  v_quote public.oop_quotes;
  v_direct public.oop_quotes;
  v_changed integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
  v_quote:=public.upsert_oop_quote(
    NULL,'51000000-0000-4000-8000-000000000001'::uuid,'water','Rollback guarded legacy','Synthetic address',1,92,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    999999.99,9999.99,'client totals ignored','11000000-0000-4000-8000-000000000006'::uuid
  );
  IF v_quote.quote_total<>92.00 OR v_quote.net_margin_pct<>11.57
    OR v_quote.created_by<>'11000000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'rollback legacy RPC accepted client money or actor: %, %, %',v_quote.quote_total,v_quote.net_margin_pct,v_quote.created_by;
  END IF;
  PERFORM set_config('oop_pricing.rollback_legacy_quote',v_quote.id::text,true);

  BEGIN
    PERFORM public.upsert_oop_quote(
      NULL,'51000000-0000-4000-8000-000000000099'::uuid,'water','Invalid rollback job','Synthetic address',1,92,
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
      1,1,'invalid job must fail','11000000-0000-4000-8000-000000000002'::uuid
    );
    RAISE EXCEPTION 'rollback legacy upsert accepted a nonexistent job id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'oop_job_not_found' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
  INSERT INTO public.oop_quotes(
    quote_number,job_id,job_type,insured_name,tech_hours,bill_rate,quote_total,net_margin_pct,created_by
  ) VALUES(
    'OOP-ROLLBACK-DIRECT-001','51000000-0000-4000-8000-000000000001','water','Rollback direct insert',1,92,1,99,
    '11000000-0000-4000-8000-000000000006'
  ) RETURNING * INTO v_direct;
  IF v_direct.quote_total<>92.00 OR v_direct.net_margin_pct<>11.57
    OR v_direct.created_by<>'11000000-0000-4000-8000-000000000003'::uuid THEN
    RAISE EXCEPTION 'rollback direct INSERT bypassed canonical money or actor ownership';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
  UPDATE public.oop_quotes
    SET tech_hours=2,quote_total=1,net_margin_pct=99,created_by='11000000-0000-4000-8000-000000000006'
    WHERE id=v_direct.id
    RETURNING * INTO v_direct;
  IF v_direct.quote_total<>184.00 OR v_direct.net_margin_pct<>11.57
    OR v_direct.created_by<>'11000000-0000-4000-8000-000000000003'::uuid THEN
    RAISE EXCEPTION 'rollback direct UPDATE bypassed canonical money or preserved-actor ownership';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000005',true);
  DELETE FROM public.oop_quotes WHERE id=v_direct.id;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed<>1 THEN RAISE EXCEPTION 'approved rollback project manager could not directly delete a quote'; END IF;
END $legacy_money_and_direct_writes$;

DO $denied_identity_matrix$
DECLARE
  v_auth text;
  v_count integer;
  v_changed integer;
  v_quote_id uuid:=current_setting('oop_pricing.rollback_snapshot_quote')::uuid;
BEGIN
  FOREACH v_auth IN ARRAY ARRAY[
    '21000000-0000-4000-8000-000000000006',
    '21000000-0000-4000-8000-000000000007',
    '21000000-0000-4000-8000-000000000008',
    '21000000-0000-4000-8000-000000000009',
    ''
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_auth,true);
    SELECT count(*) INTO v_count FROM public.oop_quotes;
    IF v_count<>0 THEN RAISE EXCEPTION 'denied rollback identity bypassed direct SELECT: %',v_auth; END IF;

    BEGIN
      PERFORM public.get_oop_quote(v_quote_id);
      RAISE EXCEPTION 'denied rollback identity reached legacy get: %',v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.get_oop_quotes(50,NULL);
      RAISE EXCEPTION 'denied rollback identity reached legacy list: %',v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.upsert_oop_quote(
        NULL,NULL,'water','Denied rollback RPC','Synthetic address',1,92,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        999,99,'denied','11000000-0000-4000-8000-000000000006'::uuid
      );
      RAISE EXCEPTION 'denied rollback identity reached legacy upsert: %',v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.delete_oop_quote(v_quote_id);
      RAISE EXCEPTION 'denied rollback identity reached legacy delete: %',v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      INSERT INTO public.oop_quotes(quote_number,job_type,insured_name,tech_hours,bill_rate,quote_total,net_margin_pct)
        VALUES('OOP-ROLLBACK-DENIED','water','Denied direct insert',1,92,999,99);
      RAISE EXCEPTION 'denied rollback identity bypassed direct INSERT: %',v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;

    UPDATE public.oop_quotes SET notes='denied direct update' WHERE id=v_quote_id;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>0 THEN RAISE EXCEPTION 'denied rollback identity bypassed direct UPDATE: %',v_auth; END IF;
    DELETE FROM public.oop_quotes WHERE id=v_quote_id;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>0 THEN RAISE EXCEPTION 'denied rollback identity bypassed direct DELETE: %',v_auth; END IF;
  END LOOP;
END $denied_identity_matrix$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $anonymous_denial$
DECLARE v_quote_id uuid:=current_setting('oop_pricing.rollback_snapshot_quote')::uuid;
BEGIN
  BEGIN
    PERFORM public.get_oop_quote(v_quote_id);
    RAISE EXCEPTION 'anonymous caller reached rollback legacy RPC';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.oop_quotes WHERE id=v_quote_id;
    RAISE EXCEPTION 'anonymous caller directly read rollback quote table';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.oop_quotes(quote_number,job_type) VALUES('OOP-ROLLBACK-ANON','water');
    RAISE EXCEPTION 'anonymous caller directly wrote rollback quote table';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $anonymous_denial$;
RESET ROLE;

UPDATE public.feature_flags
  SET enabled=true,dev_only_user_id=NULL,force_disabled=true
  WHERE key='tool:oop_pricing';
SET LOCAL ROLE authenticated;
DO $force_disabled_denial$
DECLARE v_count integer; v_quote_id uuid:=current_setting('oop_pricing.rollback_snapshot_quote')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
  SELECT count(*) INTO v_count FROM public.oop_quotes;
  IF v_count<>0 THEN RAISE EXCEPTION 'rollback Force Off allowed direct SELECT'; END IF;
  BEGIN
    PERFORM public.get_oop_quote(v_quote_id);
    RAISE EXCEPTION 'rollback Force Off allowed legacy RPC access';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.oop_quotes(quote_number,job_type) VALUES('OOP-ROLLBACK-FORCE-OFF','water');
    RAISE EXCEPTION 'rollback Force Off allowed direct INSERT';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $force_disabled_denial$;
RESET ROLE;

DELETE FROM public.feature_flags WHERE key='tool:oop_pricing';
SET LOCAL ROLE authenticated;
DO $missing_flag_denial$
DECLARE v_count integer; v_quote_id uuid:=current_setting('oop_pricing.rollback_snapshot_quote')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
  SELECT count(*) INTO v_count FROM public.oop_quotes;
  IF v_count<>0 THEN RAISE EXCEPTION 'rollback missing flag allowed direct SELECT'; END IF;
  BEGIN
    PERFORM public.get_oop_quote(v_quote_id);
    RAISE EXCEPTION 'rollback missing flag allowed legacy RPC access';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.oop_quotes(quote_number,job_type) VALUES('OOP-ROLLBACK-MISSING-FLAG','water');
    RAISE EXCEPTION 'rollback missing flag allowed direct INSERT';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $missing_flag_denial$;
RESET ROLE;

INSERT INTO public.feature_flags(key,enabled,dev_only_user_id,category,label,description,force_disabled)
VALUES('tool:oop_pricing',false,'11000000-0000-4000-8000-000000000002','tool','OOP Pricing Calculator','Rollback owner preview',false);
SET LOCAL ROLE authenticated;
DO $owner_preview_contract$
DECLARE v_count integer; v_quote_id uuid:=current_setting('oop_pricing.rollback_snapshot_quote')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
  SELECT count(*) INTO v_count FROM public.oop_quotes q WHERE q.id=v_quote_id;
  IF v_count<>1 OR (public.get_oop_quote(v_quote_id)).id IS DISTINCT FROM v_quote_id THEN
    RAISE EXCEPTION 'rollback owner preview did not enable the selected approved employee';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
  SELECT count(*) INTO v_count FROM public.oop_quotes;
  IF v_count<>0 THEN RAISE EXCEPTION 'rollback owner preview leaked to another approved employee'; END IF;
  BEGIN
    PERFORM public.get_oop_quote(v_quote_id);
    RAISE EXCEPTION 'rollback owner preview allowed another approved employee through RPC';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $owner_preview_contract$;
RESET ROLE;
ROLLBACK;