-- ════════════════════════════════════════════════
-- FILE: oop_pricing_builder_isolated.sql
-- ════════════════════════════════════════════════
-- WHAT THIS DOES (plain language): Refuses shared databases, executes synthetic
-- authorization, money, idempotency, private-snapshot, and merge-contract checks,
-- and rolls every fixture and temporary grant back.
-- DEPENDS ON: 20260730150000_oop_pricing_builder.sql on an isolated local DB.
-- NOTES / GOTCHAS: Never run against the shared UPR project.
-- ════════════════════════════════════════════════
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing OOP pricing behavior test: isolated database guard missing';
  END IF;
  IF current_database() IN ('postgres', 'glsmljpabrwonfiltiqm') THEN
    RAISE EXCEPTION 'refusing OOP pricing behavior test on shared database';
  END IF;
END $guard$;
BEGIN;

INSERT INTO public.employees(id,full_name,role,is_active,is_external,auth_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001','OOP Admin','admin',true,false,'20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002','OOP Office','office',true,false,'20000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003','OOP Supervisor','supervisor',true,false,'20000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004','OOP Estimator','estimator',true,false,'20000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000005','OOP Project Manager','project_manager',true,false,'20000000-0000-4000-8000-000000000005'),
  ('10000000-0000-4000-8000-000000000006','OOP Field Tech','field_tech',true,false,'20000000-0000-4000-8000-000000000006'),
  ('10000000-0000-4000-8000-000000000007','OOP CRM Partner','crm_partner',true,false,'20000000-0000-4000-8000-000000000007'),
  ('10000000-0000-4000-8000-000000000008','OOP Inactive Office','office',false,false,'20000000-0000-4000-8000-000000000008'),
  ('10000000-0000-4000-8000-000000000009','OOP External Office','office',true,true,'20000000-0000-4000-8000-000000000009');

INSERT INTO public.jobs(id,job_number) VALUES
  ('50000000-0000-4000-8000-000000000001','OOP-TEST-JOB-1'),
  ('50000000-0000-4000-8000-000000000002','OOP-TEST-JOB-2');

DO $setup$
DECLARE v_updated integer;
BEGIN
  UPDATE public.oop_pricing_revisions
    SET config=jsonb_set(config,'{projectMinimums,mold}','200'::jsonb)
    WHERE revision_number=1 AND status='published';
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>1 THEN RAISE EXCEPTION 'published seed missing or duplicated'; END IF;
  UPDATE public.feature_flags
    SET enabled=true,dev_only_user_id=NULL,force_disabled=false
    WHERE key='tool:oop_pricing';
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>1 THEN RAISE EXCEPTION 'tool:oop_pricing seed missing or duplicated'; END IF;
END $setup$;

-- The legacy schema intentionally has an authenticated write policy. This local,
-- transaction-scoped grant makes that deployed direct-update path testable on a
-- disposable PostgreSQL cluster whose default table grants are more restrictive.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oop_quotes TO authenticated;
SET LOCAL ROLE authenticated;

DO $role_matrix$
DECLARE v_auth text;
BEGIN
  FOREACH v_auth IN ARRAY ARRAY[
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000005'
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_auth,true);
    IF public.get_oop_pricing_config(NULL) IS NULL THEN RAISE EXCEPTION 'eligible role did not receive calculator config: %',v_auth; END IF;
    PERFORM public.get_oop_quotes(50,NULL);
  END LOOP;
END $role_matrix$;

DO $authorization$
DECLARE v_auth text;
BEGIN
  FOREACH v_auth IN ARRAY ARRAY[
    '20000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000007',
    '20000000-0000-4000-8000-000000000008',
    '20000000-0000-4000-8000-000000000009',
    ''
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_auth,true);
    BEGIN
      PERFORM public.get_oop_pricing_config(NULL);
      RAISE EXCEPTION 'denied caller unexpectedly received calculator config: %',v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.delete_oop_quote('40000000-0000-4000-8000-000000000001'::uuid);
      RAISE EXCEPTION 'denied caller unexpectedly reached delete RPC: %',v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;
END $authorization$;

DO $legacy$
DECLARE v_quote public.oop_quotes;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
  v_quote:=public.upsert_oop_quote(
    NULL,NULL,'water','Legacy synthetic','Synthetic address',1.2345,100.5678,
    1,1,0,0,0,0,0,0,0,0,10.1234,10.9876,1,0,0,
    1,1,'client totals must be ignored','10000000-0000-4000-8000-000000000003'
  );
  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'legacy upsert did not return its saved row'; END IF;
  IF v_quote.created_by<>'10000000-0000-4000-8000-000000000001'::uuid THEN RAISE EXCEPTION 'legacy created_by was not forced to actor'; END IF;
  IF v_quote.tech_hours<>1.23 OR v_quote.bill_rate<>100.57 OR v_quote.materials_actual_cost<>10.12 OR v_quote.antimicrobial_sqft<>10.99 THEN
    RAISE EXCEPTION 'legacy compatibility shadows were not safely rounded';
  END IF;
  IF v_quote.quote_total<>290.65 OR v_quote.net_margin_pct<>24.09 THEN RAISE EXCEPTION 'legacy full-precision totals were overwritten: %, %',v_quote.quote_total,v_quote.net_margin_pct; END IF;
END $legacy$;

DO $v2$
DECLARE
  v_revision uuid;
  v_first public.oop_quotes;
  v_replay public.oop_quotes;
  v_reactivated public.oop_quotes;
  v_legacy_update public.oop_quotes;
  v_fractional public.oop_quotes;
  v_merged jsonb;
  v_fractional_merged jsonb;
  v_ppe numeric;
  v_adjustment numeric;
  v_air_amount numeric;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
  v_revision:=(public.get_oop_pricing_config(NULL)->>'id')::uuid;

  v_first:=public.upsert_oop_quote_v2(
    p_job_type=>'mold',p_insured_name=>'V2 synthetic',p_pricing_revision_id=>v_revision,
    p_inputs=>' {"labor":{"quantity":1,"rateOverride":100}}'::jsonb,
    p_request_id=>'30000000-0000-4000-8000-000000000001'::uuid
  );
  v_merged:=public.get_oop_quote_v2(v_first.id);
  SELECT (x->>'amount')::numeric INTO v_ppe FROM jsonb_array_elements(v_merged->'pricing_evaluated_lines') x WHERE x->>'key'='ppe';
  SELECT (x->>'amount')::numeric INTO v_adjustment FROM jsonb_array_elements(v_merged->'pricing_evaluated_lines') x WHERE x->>'key'='project_minimum_adjustment';
  IF (v_merged->>'id')::uuid<>v_first.id OR (v_merged->>'pricing_revision_id')::uuid<>v_revision THEN
    RAISE EXCEPTION 'get_oop_quote_v2 did not return the flat quote-plus-snapshot contract';
  END IF;
  IF v_first.created_by<>'10000000-0000-4000-8000-000000000001'::uuid OR v_first.quote_total<>200.00 OR v_first.net_margin_pct<>40.50 OR v_ppe<>5.00 OR v_adjustment<>95.00 THEN
    RAISE EXCEPTION 'v2 canonical math mismatch: quote %, margin %, ppe %, adjustment %',v_first.quote_total,v_first.net_margin_pct,v_ppe,v_adjustment;
  END IF;

  v_replay:=public.upsert_oop_quote_v2(
    p_job_type=>'mold',p_insured_name=>'V2 synthetic',p_pricing_revision_id=>v_revision,
    p_inputs=>' {"labor":{"quantity":1,"rateOverride":100}}'::jsonb,
    p_request_id=>'30000000-0000-4000-8000-000000000001'::uuid
  );
  IF to_jsonb(v_replay) IS DISTINCT FROM to_jsonb(v_first) THEN RAISE EXCEPTION 'idempotent replay did not return stored response'; END IF;

  v_fractional:=public.upsert_oop_quote_v2(
    p_job_type=>'water',p_insured_name=>'V2 fractional shadows',p_pricing_revision_id=>v_revision,
    p_inputs=>' {"air_mover":{"quantity":1.2345,"days":2.3456}}'::jsonb,
    p_request_id=>'30000000-0000-4000-8000-000000000003'::uuid
  );
  v_fractional_merged:=public.get_oop_quote_v2(v_fractional.id);
  SELECT (x->>'amount')::numeric INTO v_air_amount FROM jsonb_array_elements(v_fractional_merged->'pricing_evaluated_lines') x WHERE x->>'key'='air_mover';
  IF v_fractional_merged#>>'{pricing_inputs,air_mover,quantity}'<>'1.2345' OR v_fractional_merged#>>'{pricing_inputs,air_mover,days}'<>'2.3456' THEN RAISE EXCEPTION 'v2 exact inputs were not preserved privately'; END IF;
  IF v_fractional.air_mover_count<>1 OR v_fractional.air_mover_days<>2 THEN RAISE EXCEPTION 'v2 integer shadows were not safely rounded'; END IF;
  IF v_fractional.quote_total<>72.39 OR v_air_amount<>72.39 THEN RAISE EXCEPTION 'v2 four-decimal calculation mismatch: quote %, air mover %',v_fractional.quote_total,v_air_amount; END IF;

  BEGIN
    PERFORM 1 FROM public.oop_quote_pricing_snapshots LIMIT 1;
    RAISE EXCEPTION 'authenticated unexpectedly read private pricing snapshots';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  UPDATE public.oop_quotes SET notes='direct legacy edit clears snapshot' WHERE id=v_first.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'direct compatibility update did not reach quote'; END IF;
  v_merged:=public.get_oop_quote_v2(v_first.id);
  IF v_merged ? 'pricing_revision_id' OR v_merged ? 'pricing_inputs' OR v_merged ? 'pricing_config_snapshot' THEN
    RAISE EXCEPTION 'direct legacy update left an active configurable-pricing snapshot';
  END IF;

  v_reactivated:=public.upsert_oop_quote_v2(
    p_id=>v_first.id,p_job_type=>'mold',p_insured_name=>'V2 synthetic',p_pricing_revision_id=>v_revision,
    p_inputs=>' {"labor":{"quantity":1,"rateOverride":100}}'::jsonb,
    p_expected_updated_at=>(v_merged->>'updated_at')::timestamptz,
    p_request_id=>'30000000-0000-4000-8000-000000000004'::uuid
  );
  v_merged:=public.get_oop_quote_v2(v_reactivated.id);
  IF NOT (v_merged ? 'pricing_revision_id') OR v_merged#>>'{pricing_inputs,labor,quantity}'<>'1' THEN
    RAISE EXCEPTION 'v2 update did not reactivate the private snapshot';
  END IF;

  v_legacy_update:=public.upsert_oop_quote(
    v_first.id,NULL,'mold','Legacy update','Synthetic address',1,100,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    1,1,'legacy RPC clears snapshot','10000000-0000-4000-8000-000000000003'
  );
  v_merged:=public.get_oop_quote_v2(v_legacy_update.id);
  IF v_merged ? 'pricing_revision_id' OR v_merged ? 'pricing_evaluated_lines' THEN
    RAISE EXCEPTION 'legacy RPC update left an active configurable-pricing snapshot';
  END IF;
  PERFORM set_config('oop_pricing.test_cleared_quote',v_legacy_update.id::text,true);
  PERFORM set_config('oop_pricing.test_active_quote',v_fractional.id::text,true);

  BEGIN
    PERFORM public.upsert_oop_quote_v2(
      p_job_type=>'mold',p_insured_name=>'misused request',p_pricing_revision_id=>v_revision,
      p_inputs=>' {"labor":{"quantity":1,"rateOverride":100}}'::jsonb,
      p_request_id=>'30000000-0000-4000-8000-000000000001'::uuid);
    RAISE EXCEPTION 'request-id payload misuse unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'request_id_reused_with_different_payload' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.upsert_oop_quote_v2(
      p_id=>v_fractional.id,p_job_type=>'water',p_insured_name=>'V2 fractional shadows',p_pricing_revision_id=>v_revision,
      p_inputs=>' {"air_mover":{"quantity":1.2345,"days":2.3456}}'::jsonb,
      p_expected_updated_at=>'2000-01-01T00:00:00Z'::timestamptz,
      p_request_id=>'30000000-0000-4000-8000-000000000002'::uuid);
    RAISE EXCEPTION 'stale quote update unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'quote_conflict' THEN RAISE; END IF;
  END;
END $v2$;

-- Cross-tier browser/SQL parity fixture (shared JSON).
RESET ROLE;
INSERT INTO public.oop_pricing_revisions(revision_number,status,config,published_at) SELECT 99,'superseded',payload->'config',now() FROM oop_pricing_cross_tier_fixture;
SELECT set_config('oop_pricing.test_parity_revision',id::text,true)
  FROM public.oop_pricing_revisions
  WHERE revision_number=99;
SET LOCAL ROLE authenticated;
DO $cross_tier_parity$
DECLARE v_fixture jsonb; v_expected jsonb; v_revision uuid; v_quote public.oop_quotes; v_merged jsonb; v_actual jsonb; v_expected_lines jsonb;
BEGIN
 SELECT payload INTO v_fixture FROM oop_pricing_cross_tier_fixture; v_expected:=v_fixture->'expected'; v_revision:=current_setting('oop_pricing.test_parity_revision')::uuid; PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true); v_quote:=public.upsert_oop_quote_v2(p_job_id=>'50000000-0000-4000-8000-000000000001'::uuid,p_job_type=>v_fixture->>'jobType',p_insured_name=>'Cross-tier parity',p_pricing_revision_id=>v_revision,p_inputs=>v_fixture->'inputs',p_request_id=>'30000000-0000-4000-8000-000000000050'::uuid); v_merged:=public.get_oop_quote_v2(v_quote.id); SELECT jsonb_agg(jsonb_build_object('key',x->>'key','customer',(x->>'amount')::numeric,'internal',(x->>'internalCost')::numeric,'customerVisible',(x->>'customerVisible')::boolean) ORDER BY x->>'key') INTO v_actual FROM jsonb_array_elements(v_merged->'pricing_evaluated_lines') x WHERE x->>'key'<>'project_minimum_adjustment'; SELECT jsonb_agg(value ORDER BY value->>'key') INTO v_expected_lines FROM jsonb_array_elements(v_expected->'lines'); IF v_quote.quote_total<>(v_expected->>'quote')::numeric OR v_quote.net_margin_pct<>(v_expected->>'netMarginPct')::numeric OR (v_merged->>'pricing_minimum_adjustment')::numeric<>(v_expected->>'projectMinimumAdjustment')::numeric OR (SELECT coalesce(sum((x->>'internalCost')::numeric),0) FROM jsonb_array_elements(v_merged->'pricing_evaluated_lines') x)<>(v_expected->>'internalTotal')::numeric OR (SELECT (x->>'internalCost')::numeric FROM jsonb_array_elements(v_merged->'pricing_evaluated_lines') x WHERE x->>'key'='overhead')<>(v_expected->>'overhead')::numeric OR v_actual IS DISTINCT FROM v_expected_lines THEN RAISE EXCEPTION 'cross-tier parity mismatch'; END IF;
END $cross_tier_parity$;

DO $companywide_access$
DECLARE
  v_revision uuid;
  v_admin_quote public.oop_quotes;
  v_office_quote public.oop_quotes;
  v_cross_update public.oop_quotes;
  v_direct_quote public.oop_quotes;
  v_read public.oop_quotes;
  v_auth text;
  v_direct_count integer;
  v_direct_changed integer;
  v_invalid_job constant uuid:='50000000-0000-4000-8000-000000000099';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
  v_revision:=(public.get_oop_pricing_config(NULL)->>'id')::uuid;
  v_admin_quote:=public.upsert_oop_quote_v2(
    p_job_id=>'50000000-0000-4000-8000-000000000001'::uuid,
    p_job_type=>'water',p_insured_name=>'Admin job one',p_pricing_revision_id=>v_revision,
    p_inputs=>' {"labor":{"quantity":1}}'::jsonb,
    p_request_id=>'30000000-0000-4000-8000-000000000101'::uuid
  );

  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  v_office_quote:=public.upsert_oop_quote_v2(
    p_job_id=>'50000000-0000-4000-8000-000000000002'::uuid,
    p_job_type=>'water',p_insured_name=>'Office job two',p_pricing_revision_id=>v_revision,
    p_inputs=>' {"labor":{"quantity":2}}'::jsonb,
    p_request_id=>'30000000-0000-4000-8000-000000000102'::uuid
  );

  FOREACH v_auth IN ARRAY ARRAY[
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000005'
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_auth,true);
    SELECT count(*) INTO v_direct_count FROM public.oop_quotes
      WHERE id IN (v_admin_quote.id,v_office_quote.id);
    IF v_direct_count<>2 THEN
      RAISE EXCEPTION 'eligible role could not directly select all company quotes: %',v_auth;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
  INSERT INTO public.oop_quotes(quote_number,job_id,job_type,insured_name,created_by)
    VALUES('OOP-DIRECT-POLICY-001','50000000-0000-4000-8000-000000000001','water','Supervisor direct insert','10000000-0000-4000-8000-000000000001')
    RETURNING * INTO v_direct_quote;
  IF v_direct_quote.created_by<>'10000000-0000-4000-8000-000000000003'::uuid THEN
    RAISE EXCEPTION 'eligible direct INSERT did not enforce actor ownership';
  END IF;
  v_read:=public.get_oop_quote(v_office_quote.id);
  IF v_read.id IS DISTINCT FROM v_office_quote.id THEN RAISE EXCEPTION 'supervisor could not read office-created quote'; END IF;
  IF (public.get_oop_quote_v2(v_admin_quote.id)->>'id')::uuid IS DISTINCT FROM v_admin_quote.id THEN RAISE EXCEPTION 'supervisor could not read admin-created v2 quote'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_oop_quotes(200,NULL) q WHERE q.id=v_admin_quote.id)
    OR NOT EXISTS(SELECT 1 FROM public.get_oop_quotes(200,NULL) q WHERE q.id=v_office_quote.id) THEN
    RAISE EXCEPTION 'company-wide list hid a cross-creator quote';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_oop_quotes(200,'50000000-0000-4000-8000-000000000001') q WHERE q.id=v_admin_quote.id)
    OR NOT EXISTS(SELECT 1 FROM public.get_oop_quotes(200,'50000000-0000-4000-8000-000000000002') q WHERE q.id=v_office_quote.id) THEN
    RAISE EXCEPTION 'valid cross-job filter hid a company quote';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000004',true);
  v_cross_update:=public.upsert_oop_quote_v2(
    p_id=>v_admin_quote.id,p_job_id=>'50000000-0000-4000-8000-000000000002'::uuid,
    p_job_type=>'water',p_insured_name=>'Estimator cross-job update',p_pricing_revision_id=>v_revision,
    p_inputs=>' {"labor":{"quantity":3}}'::jsonb,p_expected_updated_at=>v_admin_quote.updated_at,
    p_request_id=>'30000000-0000-4000-8000-000000000103'::uuid
  );
  IF v_cross_update.job_id<>'50000000-0000-4000-8000-000000000002'::uuid
    OR v_cross_update.created_by<>v_admin_quote.created_by THEN
    RAISE EXCEPTION 'estimator could not manage cross-creator/cross-job quote';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000005',true);
  DELETE FROM public.oop_quotes WHERE id=v_direct_quote.id;
  GET DIAGNOSTICS v_direct_changed=ROW_COUNT;
  IF v_direct_changed<>1 THEN RAISE EXCEPTION 'eligible direct DELETE was blocked by scoped RLS'; END IF;
  IF NOT public.delete_oop_quote(v_office_quote.id) THEN RAISE EXCEPTION 'project manager could not delete office-created quote'; END IF;
  v_read:=public.get_oop_quote(v_cross_update.id);
  IF v_read.id IS DISTINCT FROM v_cross_update.id THEN RAISE EXCEPTION 'project manager could not read estimator-updated quote'; END IF;

  BEGIN
    PERFORM public.get_oop_quotes(50,v_invalid_job);
    RAISE EXCEPTION 'list accepted a nonexistent job id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'oop_job_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.upsert_oop_quote_v2(
      p_job_id=>v_invalid_job,p_job_type=>'water',p_insured_name=>'Invalid v2 job',p_pricing_revision_id=>v_revision,
      p_inputs=>'{}'::jsonb,p_request_id=>'30000000-0000-4000-8000-000000000104'::uuid);
    RAISE EXCEPTION 'v2 upsert accepted a nonexistent job id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'oop_job_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.upsert_oop_quote(
      NULL,v_invalid_job,'water','Invalid legacy job',NULL,
      0,92,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
      0,NULL,NULL,'10000000-0000-4000-8000-000000000005'::uuid);
    RAISE EXCEPTION 'legacy upsert accepted a nonexistent job id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'oop_job_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.oop_quotes SET job_id=v_invalid_job WHERE id=v_cross_update.id;
    RAISE EXCEPTION 'direct update accepted a nonexistent job id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'oop_job_not_found' THEN RAISE; END IF;
  END;
END $companywide_access$;

DO $direct_table_denials$
DECLARE v_auth text; v_direct_count integer; v_updated integer;
BEGIN
  FOREACH v_auth IN ARRAY ARRAY[
    '20000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000007',
    '20000000-0000-4000-8000-000000000008',
    '20000000-0000-4000-8000-000000000009',
    ''
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_auth,true);
    SELECT count(*) INTO v_direct_count FROM public.oop_quotes;
    IF v_direct_count<>0 THEN
      RAISE EXCEPTION 'denied caller bypassed RLS with direct SELECT: %',v_auth;
    END IF;
    BEGIN
      INSERT INTO public.oop_quotes(quote_number,job_type,insured_name)
        VALUES('OOP-DENIED-'||md5(v_auth),'water','Denied direct insert');
      RAISE EXCEPTION 'denied caller bypassed RLS with direct INSERT: %',v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    UPDATE public.oop_quotes SET notes='denied direct update' WHERE true;
    GET DIAGNOSTICS v_updated=ROW_COUNT;
    IF v_updated<>0 THEN
      RAISE EXCEPTION 'denied caller bypassed RLS with direct UPDATE: %',v_auth;
    END IF;
    DELETE FROM public.oop_quotes WHERE true;
    GET DIAGNOSTICS v_updated=ROW_COUNT;
    IF v_updated<>0 THEN
      RAISE EXCEPTION 'denied caller bypassed RLS with direct DELETE: %',v_auth;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000005',true);
END $direct_table_denials$;

DO $catalog_as_authenticated$
BEGIN
  IF (public.get_oop_pricing_config(NULL)->>'revisionNumber')::integer<>1 THEN RAISE EXCEPTION 'published seed missing'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='upsert_oop_quote_v2' AND pg_get_function_identity_arguments(p.oid)='p_id uuid, p_job_id uuid, p_job_type text, p_insured_name text, p_address text, p_notes text, p_pricing_revision_id uuid, p_inputs jsonb, p_expected_updated_at timestamp with time zone, p_request_id uuid' AND pg_get_function_result(p.oid)='oop_quotes')<>1 THEN RAISE EXCEPTION 'exact composite-return v2 signature missing'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_oop_quote_v2' AND pg_get_function_identity_arguments(p.oid)='p_id uuid' AND pg_get_function_result(p.oid)='jsonb')<>1 THEN RAISE EXCEPTION 'exact merged get v2 signature missing'; END IF;
  IF has_table_privilege(current_user,'public.oop_quote_pricing_snapshots','SELECT') OR has_table_privilege(current_user,'public.oop_quote_pricing_snapshots','INSERT') OR has_table_privilege(current_user,'public.oop_quote_pricing_snapshots','UPDATE') OR has_table_privilege(current_user,'public.oop_quote_pricing_snapshots','DELETE') THEN RAISE EXCEPTION 'authenticated unexpectedly has snapshot table rights'; END IF;
  IF has_function_privilege(current_user,'public.generate_oop_quote_number()','EXECUTE') THEN RAISE EXCEPTION 'quote generator must remain private while builder hardening is active'; END IF;
  IF NOT has_function_privilege(current_user,'public.oop_pricing_calculator_access()','EXECUTE')
    OR has_function_privilege('anon','public.oop_pricing_calculator_access()','EXECUTE')
    OR has_function_privilege('service_role','public.oop_pricing_calculator_access()','EXECUTE') THEN
    RAISE EXCEPTION 'calculator RLS helper privilege boundary is incorrect';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='oop_quotes'
        AND policyname IN ('oop_quotes authenticated read','oop_quotes authenticated insert','oop_quotes authenticated update','oop_quotes authenticated delete')
        AND roles=ARRAY['authenticated']::name[])<>4
    OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes' AND policyname='oop_quotes authenticated write') THEN
    RAISE EXCEPTION 'role-and-rollout oop_quotes policy catalog is incorrect';
  END IF;
END $catalog_as_authenticated$;

RESET ROLE;
DELETE FROM public.feature_flags WHERE key='tool:oop_pricing';
SET LOCAL ROLE authenticated;
DO $missing_rollout$
DECLARE v_direct_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
  BEGIN
    PERFORM public.get_oop_pricing_config(NULL);
    RAISE EXCEPTION 'missing rollout row unexpectedly enabled calculator RPCs';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  SELECT count(*) INTO v_direct_count FROM public.oop_quotes;
  IF v_direct_count<>0 THEN RAISE EXCEPTION 'missing rollout row allowed direct SELECT'; END IF;
  IF public.get_oop_pricing_admin_state() IS NULL THEN RAISE EXCEPTION 'admin config was blocked by a missing rollout row'; END IF;
END $missing_rollout$;

RESET ROLE;
INSERT INTO public.feature_flags(key,enabled,dev_only_user_id,category,label,description,force_disabled)
VALUES('tool:oop_pricing',false,'10000000-0000-4000-8000-000000000001','tool','OOP Pricing Calculator','Isolated rollout fixture',false);
SET LOCAL ROLE authenticated;
DO $owner_preview$
DECLARE v_direct_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
  IF public.get_oop_pricing_config(NULL) IS NULL THEN RAISE EXCEPTION 'owner preview did not enable calculator RPCs'; END IF;
  SELECT count(*) INTO v_direct_count FROM public.oop_quotes;
  IF v_direct_count=0 THEN RAISE EXCEPTION 'owner preview could not directly SELECT company quotes'; END IF;
  IF public.get_oop_pricing_admin_state() IS NULL THEN RAISE EXCEPTION 'owner preview could not read admin config'; END IF;
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  SELECT count(*) INTO v_direct_count FROM public.oop_quotes;
  IF v_direct_count<>0 THEN RAISE EXCEPTION 'non-preview eligible employee bypassed disabled rollout with direct SELECT'; END IF;
  BEGIN
    PERFORM public.get_oop_pricing_config(NULL);
    RAISE EXCEPTION 'non-preview eligible employee bypassed disabled rollout';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.get_oop_pricing_admin_state();
    RAISE EXCEPTION 'non-admin employee reached admin pricing state';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $owner_preview$;

RESET ROLE;
UPDATE public.feature_flags
  SET enabled=true,dev_only_user_id='10000000-0000-4000-8000-000000000001',force_disabled=true
  WHERE key='tool:oop_pricing';
SET LOCAL ROLE authenticated;
DO $force_off_admin$
DECLARE v_state jsonb; v_saved jsonb; v_published jsonb; v_direct_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
  BEGIN
    PERFORM public.get_oop_pricing_config(NULL);
    RAISE EXCEPTION 'force-disabled rollout unexpectedly enabled calculator RPCs';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  SELECT count(*) INTO v_direct_count FROM public.oop_quotes;
  IF v_direct_count<>0 THEN RAISE EXCEPTION 'force-disabled rollout allowed direct SELECT'; END IF;
  v_state:=public.get_oop_pricing_admin_state();
  v_saved:=public.save_oop_pricing_draft(
    (v_state#>>'{draft,lockVersion}')::integer,
    v_state#>'{draft,config}',
    '30000000-0000-4000-8000-000000000201'::uuid
  );
  v_published:=public.publish_oop_pricing_draft(
    (v_saved->>'lockVersion')::integer,
    '30000000-0000-4000-8000-000000000202'::uuid
  );
  IF v_saved->>'id' IS NULL OR v_published->>'publishedRevisionId' IS NULL THEN
    RAISE EXCEPTION 'admin draft/publish was blocked while rollout was force-disabled';
  END IF;
END $force_off_admin$;

RESET ROLE;
UPDATE public.feature_flags SET enabled=true,dev_only_user_id=NULL,force_disabled=false WHERE key='tool:oop_pricing';
DO $private_storage$
DECLARE v_cleared uuid:=current_setting('oop_pricing.test_cleared_quote')::uuid; v_active uuid:=current_setting('oop_pricing.test_active_quote')::uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.oop_quote_pricing_snapshots WHERE quote_id=v_cleared AND cleared_at IS NOT NULL AND pricing_inputs IS NOT NULL AND pricing_config_snapshot IS NOT NULL) THEN
    RAISE EXCEPTION 'soft-cleared snapshot data was not retained privately';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.oop_quote_pricing_snapshots WHERE quote_id=v_active AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'active private snapshot missing';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='oop_quotes' AND column_name IN ('pricing_revision_id','pricing_inputs','pricing_config_snapshot','pricing_evaluated_lines','pricing_engine_version','pricing_minimum_adjustment')) THEN
    RAISE EXCEPTION 'snapshot columns leaked onto oop_quotes';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='oop_quote_pricing_snapshots' AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'private snapshot table is not forced-RLS';
  END IF;
END $private_storage$;
ROLLBACK;