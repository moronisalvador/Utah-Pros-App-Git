-- ════════════════════════════════════════════════
-- FILE: oop_quote_to_estimate_isolated.sql
-- ════════════════════════════════════════════════
-- WHAT THIS DOES (plain language): Proves on a disposable database that an
-- admin converts a canonical, job-linked OOP quote into exactly one draft
-- estimate with an identical line total, while non-billing roles are denied.
-- DEPENDS ON: 20260803192344_oop_quote_to_estimate.sql and the OOP builder.
-- NOTES / GOTCHAS: Never run against the shared UPR project; all fixtures roll back.
-- ════════════════════════════════════════════════
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing OOP estimate conversion test: isolated database guard missing';
  END IF;
  IF current_database() IN ('postgres', 'glsmljpabrwonfiltiqm') THEN
    RAISE EXCEPTION 'refusing OOP estimate conversion test on shared database';
  END IF;
END $guard$;

BEGIN;

INSERT INTO public.employees(id, full_name, role, is_active, is_external, auth_user_id) VALUES
  ('11000000-0000-4000-8000-000000000001', 'OOP Estimate Admin', 'admin', true, false, '21000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-000000000002', 'OOP Estimate Office', 'office', true, false, '21000000-0000-4000-8000-000000000002');

INSERT INTO public.contacts(id, name) VALUES
  ('31000000-0000-4000-8000-000000000001', 'OOP Estimate Customer');

INSERT INTO public.jobs(id, job_number, primary_contact_id, address, city, state, zip) VALUES
  ('51000000-0000-4000-8000-000000000001', 'OOP-ESTIMATE-TEST-1', '31000000-0000-4000-8000-000000000001', '123 Test St', 'Provo', 'UT', '84601');

UPDATE public.feature_flags
   SET enabled = true, dev_only_user_id = NULL, force_disabled = false
 WHERE key = 'tool:oop_pricing';

SET LOCAL ROLE authenticated;

DO $conversion$
DECLARE
  v_revision uuid;
  v_quote public.oop_quotes;
  v_unconverted public.oop_quotes;
  v_first jsonb;
  v_replay jsonb;
  v_estimate public.estimates;
  v_quote_before jsonb;
  v_quote_after jsonb;
  v_total numeric;
  v_expected_updated_at timestamptz;
  v_lines jsonb;
  v_correction jsonb;
  v_generic public.estimates;
  v_generic_lines jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000001', true);
  v_revision := (public.get_oop_pricing_config(NULL)->>'id')::uuid;
  v_quote := public.upsert_oop_quote_v2(
    p_job_id => '51000000-0000-4000-8000-000000000001'::uuid,
    p_job_type => 'water',
    p_insured_name => 'OOP Estimate Customer',
    p_address => '123 Test St, Provo, UT 84601',
    p_pricing_revision_id => v_revision,
    p_inputs => '{"labor":{"quantity":2,"rateOverride":125},"air_mover":{"quantity":2,"days":3}}'::jsonb,
    p_request_id => '41000000-0000-4000-8000-000000000001'::uuid
  );
  v_quote_before := public.get_oop_quote_v2(v_quote.id);
  v_unconverted := public.upsert_oop_quote_v2(
    p_job_id => '51000000-0000-4000-8000-000000000001'::uuid,
    p_job_type => 'water',
    p_insured_name => 'Direct-link denial fixture',
    p_pricing_revision_id => v_revision,
    p_inputs => '{"labor":{"quantity":1}}'::jsonb,
    p_request_id => '41000000-0000-4000-8000-000000000002'::uuid
  );

  v_first := public.convert_oop_quote_to_estimate(v_quote.id);
  v_replay := public.convert_oop_quote_to_estimate(v_quote.id);
  IF NOT (v_first->>'created')::boolean OR (v_replay->>'created')::boolean THEN
    RAISE EXCEPTION 'conversion did not preserve create/replay semantics';
  END IF;
  IF v_first->>'estimate_id' IS DISTINCT FROM v_replay->>'estimate_id' THEN
    RAISE EXCEPTION 'retry created or returned a different estimate';
  END IF;

  SELECT e.* INTO v_estimate
    FROM public.estimates e
   WHERE e.id = (v_first->>'estimate_id')::uuid;
  SELECT round(COALESCE(sum(li.line_total), 0), 2) INTO v_total
    FROM public.estimate_line_items li
   WHERE li.estimate_id = v_estimate.id;
  v_quote_after := public.get_oop_quote_v2(v_quote.id);
  IF v_estimate.id IS NULL
    OR v_estimate.job_id <> v_quote.job_id
    OR v_estimate.contact_id <> '31000000-0000-4000-8000-000000000001'::uuid
    OR v_estimate.status <> 'draft'
    OR v_estimate.qbo_estimate_id IS NOT NULL
    OR v_total <> v_quote.quote_total
    OR v_estimate.amount <> v_quote.quote_total THEN
    RAISE EXCEPTION 'draft estimate did not preserve the canonical quote contract';
  END IF;
  IF (v_quote_after - 'converted_estimate_id') IS DISTINCT FROM (v_quote_before - 'converted_estimate_id') THEN
    RAISE EXCEPTION 'conversion changed canonical quote data or cleared its snapshot';
  END IF;

  v_expected_updated_at := v_estimate.updated_at;
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ranked.id,
      'description', ranked.description,
      'quantity', ranked.quantity,
      'unit_price', CASE WHEN ranked.rn = 1 THEN ranked.unit_price + 1 ELSE ranked.unit_price END,
      'sort_order', ranked.sort_order
    )
    ORDER BY ranked.sort_order, ranked.created_at
  )
    INTO v_lines
    FROM (
      SELECT li.*, row_number() OVER (ORDER BY li.sort_order, li.created_at) AS rn
        FROM public.estimate_line_items li
       WHERE li.estimate_id = v_estimate.id
    ) ranked;

  v_correction := public.correct_oop_estimate(
    v_estimate.id,
    v_expected_updated_at,
    '{"property_address":"124 Corrected St","property_city":"Provo","property_state":"UT","property_zip":"84601"}'::jsonb,
    v_lines
  );
  IF NOT (v_correction->>'ok')::boolean OR (v_correction->>'replayed')::boolean THEN
    RAISE EXCEPTION 'first estimate correction did not commit normally';
  END IF;
  SELECT e.* INTO v_estimate FROM public.estimates e WHERE e.id = v_estimate.id;
  SELECT round(sum(li.line_total), 2) INTO v_total
    FROM public.estimate_line_items li
   WHERE li.estimate_id = v_estimate.id;
  IF v_estimate.property_address <> '124 Corrected St'
    OR v_estimate.amount <> v_total
    OR v_total <> (v_correction->>'total')::numeric THEN
    RAISE EXCEPTION 'atomic correction left address or estimate total inconsistent';
  END IF;

  -- Simulate response loss: the same old expected version and same content must
  -- converge to the already-committed result without changing anything again.
  v_correction := public.correct_oop_estimate(
    v_estimate.id,
    v_expected_updated_at,
    '{"property_address":"124 Corrected St","property_city":"Provo","property_state":"UT","property_zip":"84601"}'::jsonb,
    v_lines
  );
  IF NOT (v_correction->>'replayed')::boolean THEN
    RAISE EXCEPTION 'response-loss retry did not return idempotent replay';
  END IF;

  BEGIN
    PERFORM public.correct_oop_estimate(
      v_estimate.id,
      v_expected_updated_at,
      '{"property_address":"125 Stale Writer St","property_city":"Provo","property_state":"UT","property_zip":"84601"}'::jsonb,
      v_lines
    );
    RAISE EXCEPTION 'stale correction unexpectedly overwrote newer content';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;

  BEGIN
    PERFORM public.correct_oop_estimate(
      v_estimate.id,
      v_estimate.updated_at,
      '{"property_address":"124 Corrected St","property_city":"Provo","property_state":"UT","property_zip":"84601"}'::jsonb,
      jsonb_set(v_lines, '{0,quantity}', '-1'::jsonb)
    );
    RAISE EXCEPTION 'invalid correction line unexpectedly committed';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF (SELECT e.property_address FROM public.estimates e WHERE e.id = v_estimate.id)
    <> '124 Corrected St' THEN
    RAISE EXCEPTION 'invalid correction partially changed the estimate';
  END IF;

  BEGIN
    PERFORM public.correct_oop_estimate(
      v_estimate.id,
      v_estimate.updated_at,
      '{"property_address":"124 Corrected St","property_city":"Provo","property_state":"UT","property_zip":"84601"}'::jsonb,
      jsonb_set(v_lines, '{0,id}', '"61000000-0000-4000-8000-000000000099"'::jsonb)
    );
    RAISE EXCEPTION 'foreign correction line unexpectedly committed';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  INSERT INTO public.estimates (
    contact_id, estimate_number, estimate_type, status, amount, subtotal,
    created_by, intended_division
  ) VALUES (
    '31000000-0000-4000-8000-000000000001',
    public.generate_estimate_number(), 'initial', 'draft', 0, 0,
    '11000000-0000-4000-8000-000000000001', 'water'
  ) RETURNING * INTO v_generic;
  INSERT INTO public.estimate_line_items (
    estimate_id, description, quantity, unit_price, sort_order
  ) VALUES (
    v_generic.id, 'Generic estimate line', 1, 100, 0
  );
  SELECT e.* INTO v_generic FROM public.estimates e WHERE e.id = v_generic.id;
  SELECT jsonb_agg(jsonb_build_object(
    'id', li.id,
    'description', li.description,
    'quantity', li.quantity,
    'unit_price', li.unit_price,
    'sort_order', li.sort_order
  )) INTO v_generic_lines
  FROM public.estimate_line_items li
  WHERE li.estimate_id = v_generic.id;
  BEGIN
    PERFORM public.correct_oop_estimate(
      v_generic.id,
      v_generic.updated_at,
      '{}'::jsonb,
      v_generic_lines
    );
    RAISE EXCEPTION 'non-OOP estimate unexpectedly accepted a native correction';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  PERFORM public.convert_estimate_to_invoice(v_estimate.id, true, v_estimate.created_by);
  SELECT e.* INTO v_estimate FROM public.estimates e WHERE e.id = v_estimate.id;
  BEGIN
    PERFORM public.correct_oop_estimate(
      v_estimate.id,
      v_estimate.updated_at,
      '{"property_address":"124 Corrected St","property_city":"Provo","property_state":"UT","property_zip":"84601"}'::jsonb,
      v_lines
    );
    RAISE EXCEPTION 'converted estimate unexpectedly accepted a correction';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  BEGIN
    UPDATE public.oop_quotes
       SET converted_estimate_id = v_estimate.id
     WHERE id = v_unconverted.id;
    RAISE EXCEPTION 'direct converted-estimate link unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.oop_quotes SET notes = 'must remain frozen' WHERE id = v_quote.id;
    RAISE EXCEPTION 'converted quote unexpectedly remained mutable';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END $conversion$;

DO $authorization$
DECLARE
  v_quote_id uuid;
  v_estimate_id uuid;
  v_line_id uuid;
  v_changed integer;
BEGIN
  SELECT q.id INTO v_quote_id
    FROM public.oop_quotes q
   WHERE q.job_id = '51000000-0000-4000-8000-000000000001'::uuid
     AND q.converted_estimate_id IS NOT NULL;
  PERFORM set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM public.convert_oop_quote_to_estimate(v_quote_id);
    RAISE EXCEPTION 'non-billing OOP role unexpectedly converted a quote';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  SELECT q.converted_estimate_id INTO v_estimate_id
    FROM public.oop_quotes q
   WHERE q.id = v_quote_id;
  SELECT li.id INTO v_line_id
    FROM public.estimate_line_items li
   WHERE li.estimate_id = v_estimate_id
   LIMIT 1;
  UPDATE public.estimates
     SET property_city = 'Unauthorized City'
   WHERE id = v_estimate_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'non-billing direct estimate PATCH unexpectedly succeeded';
  END IF;
  UPDATE public.estimate_line_items
     SET unit_price = unit_price + 1
   WHERE id = v_line_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'non-billing direct estimate-line PATCH unexpectedly succeeded';
  END IF;
  BEGIN
    PERFORM public.correct_oop_estimate(
      v_estimate_id,
      (SELECT e.updated_at FROM public.estimates e WHERE e.id = v_estimate_id),
      '{}'::jsonb,
      (SELECT jsonb_agg(jsonb_build_object(
        'id', li.id,
        'description', li.description,
        'quantity', li.quantity,
        'unit_price', li.unit_price,
        'sort_order', li.sort_order
      )) FROM public.estimate_line_items li WHERE li.estimate_id = v_estimate_id)
    );
    RAISE EXCEPTION 'non-admin unexpectedly corrected an OOP estimate';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF has_function_privilege('anon', 'public.convert_oop_quote_to_estimate(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has conversion execute privilege';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.correct_oop_estimate(uuid,timestamp with time zone,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon unexpectedly has correction execute privilege';
  END IF;
END $authorization$;

ROLLBACK;
