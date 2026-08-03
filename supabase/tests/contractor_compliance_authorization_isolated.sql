-- ════════════════════════════════════════════════
-- FILE: contractor_compliance_authorization_isolated.sql
-- ════════════════════════════════════════════════
-- WHAT THIS DOES (plain language): On an isolated local database only, proves
-- PM W-9 metadata redaction, insurance-only audit history, W-9 checklist role
-- denial, and the accepted-W-9 provider-handoff gate with synthetic records.
-- DEPENDS ON: the four contractor migrations through read-auth hardening.
-- NOTES / GOTCHAS: Never run against the shared UPR project.
-- ════════════════════════════════════════════════
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing contractor compliance behavior test: isolated database guard missing';
  END IF;
  IF current_database() IN ('postgres', 'glsmljpabrwonfiltiqm') THEN
    RAISE EXCEPTION 'refusing contractor compliance behavior test on shared database';
  END IF;
END $guard$;

BEGIN;

INSERT INTO public.employees (
  id, full_name, role, is_active, is_external, auth_user_id
) VALUES
  ('91000000-0000-4000-8000-000000000001', 'Compliance Admin', 'admin', true, false, '92000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002', 'Compliance Office', 'office', true, false, '92000000-0000-4000-8000-000000000002'),
  ('91000000-0000-4000-8000-000000000003', 'Compliance PM', 'project_manager', true, false, '92000000-0000-4000-8000-000000000003'),
  ('91000000-0000-4000-8000-000000000004', 'Compliance Field', 'field_tech', true, false, '92000000-0000-4000-8000-000000000004'),
  ('91000000-0000-4000-8000-000000000005', 'Compliance Inactive Office', 'office', false, false, '92000000-0000-4000-8000-000000000005'),
  ('91000000-0000-4000-8000-000000000006', 'Compliance External Office', 'office', true, true, '92000000-0000-4000-8000-000000000006');

INSERT INTO public.contacts (
  id, name, company, email, phone, role, trade_specialty
) VALUES (
  '93000000-0000-4000-8000-000000000001',
  'Synthetic Subcontractor',
  'Synthetic Trade LLC',
  'synthetic-contractor@example.invalid',
  '+15550102026',
  'subcontractor',
  'roofing'
);

DO $fixtures$
DECLARE
  v_profile uuid;
BEGIN
  SELECT id INTO v_profile
  FROM public.contractor_compliance_profiles
  WHERE contact_id = '93000000-0000-4000-8000-000000000001';
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'subcontractor profile trigger did not create the fixture';
  END IF;
  UPDATE public.contractor_compliance_profiles
  SET required_w9_year = 2026, assigned_owner_id = '91000000-0000-4000-8000-000000000002'
  WHERE id = v_profile;

  INSERT INTO public.contractor_compliance_documents (
    profile_id, document_type, version_number, review_state, tax_year,
    received_source, storage_object_path, original_filename, mime_type,
    byte_size, sha256_hex, verified_by, verified_at
  ) VALUES (
    v_profile, 'w9', 1, 'accepted', 2026, 'internal_upload',
    'synthetic/w9.pdf', 'synthetic-w9.pdf', 'application/pdf', 100,
    repeat('a', 64), '91000000-0000-4000-8000-000000000002', now()
  );
  INSERT INTO public.contractor_compliance_documents (
    profile_id, document_type, version_number, review_state,
    coverage_start_date, coverage_end_date, received_source,
    storage_object_path, original_filename, mime_type, byte_size,
    sha256_hex, verified_by, verified_at
  ) VALUES
    (
      v_profile, 'workers_comp_waiver', 1, 'accepted',
      '2026-01-01', '2026-12-31', 'internal_upload',
      'synthetic/wc.pdf', 'synthetic-wc.pdf', 'application/pdf', 100,
      repeat('b', 64), '91000000-0000-4000-8000-000000000002', now()
    ),
    (
      v_profile, 'general_liability', 1, 'accepted',
      '2026-01-01', '2026-12-31', 'internal_upload',
      'synthetic/gl.pdf', 'synthetic-gl.pdf', 'application/pdf', 100,
      repeat('c', 64), '91000000-0000-4000-8000-000000000002', now()
    );

  INSERT INTO public.contractor_compliance_requests (
    profile_id, request_identity, requested_document_types, recipient_email,
    token_digest, expires_at, created_by, source, sent_at
  ) VALUES
    (
      v_profile, 'synthetic:w9', ARRAY['w9'], 'synthetic-contractor@example.invalid',
      repeat('d', 64), now() + interval '30 days',
      '91000000-0000-4000-8000-000000000002', 'manual', '2026-06-02T18:00:00Z'
    ),
    (
      v_profile, 'synthetic:insurance', ARRAY['general_liability'],
      'synthetic-contractor@example.invalid', repeat('e', 64),
      now() + interval '30 days',
      '91000000-0000-4000-8000-000000000002', 'manual', '2026-06-01T18:00:00Z'
    );
END $fixtures$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);

DO $admin_setup$
DECLARE
  v_period uuid;
  v_checklist jsonb;
BEGIN
  v_period := (
    public.contractor_compliance_create_audit_period(
      'Synthetic 2026 audit', '2026-01-01', '2026-12-31', 'current_active_profiles'
    )->>'id'
  )::uuid;
  PERFORM public.contractor_compliance_materialize_audit_period(v_period);
  PERFORM set_config('contractor_compliance.test_audit_period', v_period::text, true);

  v_checklist := public.get_contractor_w9_tax_year_checklist(
    2026, NULL, 'all', 'all', 'all', true, 50, 0
  );
  IF v_checklist#>>'{items,0,w9_status}' <> 'valid' THEN
    RAISE EXCEPTION 'accepted current-year W-9 was not valid';
  END IF;
  PERFORM public.contractor_w9_upsert_provider_handoff(
    '93000000-0000-4000-8000-000000000001',
    2026,
    'quickbooks',
    'QBO-SYNTHETIC-1',
    NULL,
    'ready',
    NULL,
    NULL
  );
END $admin_setup$;

SELECT set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);

DO $project_manager_projection$
DECLARE
  v_detail jsonb;
  v_manifest jsonb;
  v_w9_detail jsonb;
BEGIN
  v_detail := public.get_contractor_compliance_detail(
    '93000000-0000-4000-8000-000000000001', NULL, NULL
  );
  SELECT value->'detail' INTO v_w9_detail
  FROM jsonb_array_elements(v_detail->'requirements')
  WHERE value->>'key' = 'w9';
  IF v_w9_detail IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'PM received the required W-9 tax year';
  END IF;
  IF v_detail#>>'{contractor,last_request_at}' <> '2026-06-01T18:00:00+00:00' THEN
    RAISE EXCEPTION 'PM request timestamp was not insurance-only: %',
      v_detail#>>'{contractor,last_request_at}';
  END IF;
  IF jsonb_array_length(v_detail->'documents') <> 0
     OR jsonb_array_length(v_detail->'requests') <> 0
     OR jsonb_array_length(v_detail->'activity') <> 0 THEN
    RAISE EXCEPTION 'PM received private document/request/activity rows';
  END IF;

  v_manifest := public.get_contractor_compliance_audit_manifest(
    current_setting('contractor_compliance.test_audit_period')::uuid,
    NULL, 'all', 'all', 'all', 50, 0
  );
  IF (v_manifest#>>'{items,0,request_count}')::integer <> 1 THEN
    RAISE EXCEPTION 'insurance audit counted a W-9-only request';
  END IF;
  IF v_manifest#>>'{items,0,paid_in_period}' IS NOT NULL
     OR v_manifest#>>'{items,0,active_in_period}' IS NOT NULL
     OR jsonb_path_exists(
       v_manifest,
       '$.items[*].evidence[*] ? (@.document_id != null)'
     ) THEN
    RAISE EXCEPTION 'PM received redacted audit period facts or document identity';
  END IF;
  BEGIN
    PERFORM public.get_contractor_compliance_audit_manifest(
      current_setting('contractor_compliance.test_audit_period')::uuid,
      NULL, 'all', 'yes', 'all', 50, 0
    );
    RAISE EXCEPTION 'PM unexpectedly filtered a paid-in-period fact';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.get_contractor_w9_tax_year_checklist(
      2026, NULL, 'all', 'all', 'all', true, 50, 0
    );
    RAISE EXCEPTION 'PM unexpectedly received the W-9/provider checklist';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $project_manager_projection$;

DO $denied_roles$
DECLARE
  v_auth text;
BEGIN
  FOREACH v_auth IN ARRAY ARRAY[
    '92000000-0000-4000-8000-000000000004',
    '92000000-0000-4000-8000-000000000005',
    '92000000-0000-4000-8000-000000000006',
    ''
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_auth, true);
    BEGIN
      PERFORM public.get_contractor_compliance_dashboard(
        NULL, NULL, 50, 0, NULL, NULL
      );
      RAISE EXCEPTION 'denied caller received contractor dashboard: %', v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.get_contractor_compliance_detail(
        '93000000-0000-4000-8000-000000000001', NULL, NULL
      );
      RAISE EXCEPTION 'denied caller received contractor detail: %', v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.get_contractor_compliance_audit_periods();
      RAISE EXCEPTION 'denied caller received contractor audit periods: %', v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.get_contractor_compliance_audit_manifest(
        current_setting('contractor_compliance.test_audit_period')::uuid,
        NULL, 'all', 'all', 'all', 50, 0
      );
      RAISE EXCEPTION 'denied caller received contractor audit manifest: %', v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.get_contractor_w9_tax_year_checklist(
        2026, NULL, 'all', 'all', 'all', true, 50, 0
      );
      RAISE EXCEPTION 'denied caller received W-9 checklist: %', v_auth;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;
END $denied_roles$;

RESET ROLE;

DO $anon_acl$
BEGIN
  IF has_function_privilege(
       'anon',
       'public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.get_contractor_compliance_detail(uuid,date,date)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.get_contractor_compliance_audit_periods()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.get_contractor_compliance_audit_manifest(uuid,text,text,text,text,integer,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.get_contractor_w9_tax_year_checklist(integer,text,text,text,text,boolean,integer,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'anon retained contractor compliance read RPC execution';
  END IF;
END $anon_acl$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $service_role_reads$
BEGIN
  PERFORM public.get_contractor_compliance_dashboard(
    NULL, NULL, 50, 0, NULL, NULL
  );
  PERFORM public.get_contractor_compliance_detail(
    '93000000-0000-4000-8000-000000000001', NULL, NULL
  );
  PERFORM public.get_contractor_compliance_audit_periods();
  PERFORM public.get_contractor_compliance_audit_manifest(
    current_setting('contractor_compliance.test_audit_period')::uuid,
    NULL, 'all', 'all', 'all', 50, 0
  );
  PERFORM public.get_contractor_w9_tax_year_checklist(
    2026, NULL, 'all', 'all', 'all', true, 50, 0
  );
END $service_role_reads$;

RESET ROLE;

ROLLBACK;
