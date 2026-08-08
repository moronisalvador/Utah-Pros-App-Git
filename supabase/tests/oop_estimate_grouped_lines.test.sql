-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: oop_estimate_grouped_lines.test.sql
-- Phase: n/a — standalone OOP conversion grouping (20260807190000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back behavioural proof that
-- convert_oop_quote_to_estimate writes GROUPED customer lines. Establishes
-- EFFECT; the credential-free source contract in
-- tests/qa/unit/oop-estimate-grouped-lines.test.js establishes INTENT only.
--
-- The fixture is EST-001023 — the real quote from the first field test, the one
-- that printed nine rows of our internal breakdown at the customer. Same eleven
-- evaluated lines, same amounts. If this passes, that exact document would now
-- come out as two lines.
--
-- WHAT IT PROVES
--   1. A nine-item customer-visible quote produces exactly TWO estimate lines.
--   2. The split is $2,016.30 service / $1,740.00 equipment, and the estimate
--      total is still $3,756.30 — the grouping moves no money.
--   3. Both lines are a flat 1 × total with no unit, so no per-day rate or hour
--      count reaches the customer.
--   4. Internal-only items (PRV, Overhead) stay excluded, as before.
--   5. Both lines carry QuickBooks Item + Class; mold picks the mold item and
--      water picks the water item, and BOTH are class Mitigation.
--   6. A quote with no equipment produces ONE line, not an empty $0 second line.
--   7. The project-minimum adjustment lands on the service line.
--   8. The retry contract is unchanged: a second call returns created=false and
--      the same estimate, and creates no second document.
--   9. The billing-role gate still refuses a field_tech with 42501, leaving no
--      estimate and no quote link behind.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  -- Keyed on a session GUC the harness sets explicitly. NOT on current_database():
  -- every Supabase database is named `postgres`, production included, so that
  -- check would pass everywhere and protect nothing.
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing OOP grouping test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
CREATE TEMP TABLE oop_actor (label text PRIMARY KEY, auth_id uuid, employee_id uuid);

DO $seed_actors$
DECLARE
  r record;
  v_auth uuid;
  v_emp uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('admin', 'admin',      true),
      ('tech',  'field_tech', true)
    ) AS t(label, role, is_active)
  LOOP
    v_auth := gen_random_uuid();
    -- full_name, NOT name — public.employees has no `name` column. A sibling
    -- proof carried `name` for days and could never have executed.
    INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
    VALUES (
      v_auth,
      'TEST oop ' || r.label,
      'test-oop-' || r.label || '-' || substr(v_auth::text, 1, 8) || '@example.invalid',
      r.role::public.employee_role,
      r.is_active,
      false
    )
    RETURNING id INTO v_emp;
    INSERT INTO oop_actor VALUES (r.label, v_auth, v_emp);
  END LOOP;
END;
$seed_actors$;

-- oop_pricing_calculator_access() joins feature_flags on key='tool:oop_pricing'.
-- INSERT, never a bare UPDATE: on a clean clone the row does not exist, an UPDATE
-- matches nothing, and the gate then denies even the admin — which reads as a
-- migration failure when it is really a fixture failure.
INSERT INTO public.feature_flags (key, enabled, force_disabled, category, label)
VALUES ('tool:oop_pricing', true, false, 'tool', 'OOP Pricing')
ON CONFLICT (key) DO UPDATE SET enabled = true, force_disabled = false;

-- Both claim forms are set on purpose. Different Supabase releases define
-- auth.uid() differently: some read only the flattened `request.jwt.claim.sub`,
-- some coalesce that with the modern `request.jwt.claims` JSON. This stack's
-- auth.uid() reads the flattened one — with only the JSON form set it returned
-- NULL and every gate refused, which reads as a migration defect when it is a
-- fixture defect. Setting both makes the proof independent of that difference.
-- It is a fixture convenience, NOT a claim about what production sends; nothing
-- under test here reads either GUC directly (the role gate reads public.employees).
CREATE FUNCTION pg_temp.set_claims(p_auth uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_auth::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE FUNCTION pg_temp.clear_claims() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

CREATE FUNCTION pg_temp.become(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM oop_actor WHERE label = p_label;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'unknown test actor %', p_label; END IF;
  PERFORM pg_temp.set_claims(v_auth);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

CREATE FUNCTION pg_temp.unbecome() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.clear_claims();
  PERFORM set_config('role', 'postgres', true);
END;
$$;

-- Identity WITHOUT the role switch. public.oop_quotes carries a write trigger
-- (oop_require_active_internal_quote_write) that calls oop_pricing_active_employee(),
-- so a bare postgres INSERT with no auth.uid() is refused — the fixture cannot
-- seed a quote anonymously. This gives the trigger a real actor while leaving the
-- Postgres role alone, so fixture setup is not also fighting RLS.
CREATE FUNCTION pg_temp.claim_as(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM oop_actor WHERE label = p_label;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'unknown test actor %', p_label; END IF;
  PERFORM pg_temp.set_claims(v_auth);
END;
$$;

CREATE FUNCTION pg_temp.unclaim() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.clear_claims();
END;
$$;

-- The published price list. Sections are the whole point: the migration buckets
-- on `section`, so Equipment must be spelled exactly as the live revision spells it.
CREATE FUNCTION pg_temp.config_snapshot() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schemaVersion', 1, 'name', 'TEST pricing', 'items', jsonb_build_array(
    jsonb_build_object('key','labor',        'label','Labor',              'section','Labor',       'unit','hour',      'formula','quantity'),
    jsonb_build_object('key','air_mover',    'label','Air mover',          'section','Equipment',   'unit','day',       'formula','duration'),
    jsonb_build_object('key','lgr',          'label','LGR dehumidifier',   'section','Equipment',   'unit','day',       'formula','duration'),
    jsonb_build_object('key','air_scrubber', 'label','Air scrubber',       'section','Equipment',   'unit','day',       'formula','duration'),
    jsonb_build_object('key','negative_air', 'label','Negative air setup', 'section','Equipment',   'unit','day',       'formula','duration'),
    jsonb_build_object('key','antimicrobial','label','Antimicrobial',      'section','Materials',   'unit','sqft',      'formula','quantity'),
    jsonb_build_object('key','disposal',     'label','Disposal',           'section','Materials',   'unit','trip',      'formula','quantity'),
    jsonb_build_object('key','containment',  'label','Containment',        'section','Containment', 'unit','linear ft', 'formula','quantity'),
    jsonb_build_object('key','ppe',          'label','PPE',                'section','Containment', 'unit','labor',     'formula','percentage'),
    jsonb_build_object('key','prv',          'label','PRV',                'section','Containment', 'unit','cost',      'formula','pass_through'),
    jsonb_build_object('key','overhead',     'label','Overhead',           'section','Internal',    'unit','revenue',   'formula','percentage')
  ));
$$;

-- EST-001023's exact evaluated lines. PRV and Overhead are customerVisible=false
-- and must never reach the document.
CREATE FUNCTION pg_temp.evaluated_lines() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('key','labor',        'amount',1656.00,'quantity',18,'rate',92,   'customerVisible',true, 'sortOrder',10),
    jsonb_build_object('key','air_mover',    'amount', 450.00,'quantity',6, 'days',3,'rate',25, 'customerVisible',true, 'sortOrder',20),
    jsonb_build_object('key','lgr',          'amount', 480.00,'quantity',2, 'days',3,'rate',80, 'customerVisible',true, 'sortOrder',30),
    jsonb_build_object('key','air_scrubber', 'amount', 150.00,'quantity',2, 'days',1,'rate',75, 'customerVisible',true, 'sortOrder',50),
    jsonb_build_object('key','negative_air', 'amount', 660.00,'quantity',2, 'days',3,'rate',110,'customerVisible',true, 'sortOrder',60),
    jsonb_build_object('key','antimicrobial','amount',  52.50,'quantity',150,'rate',0.35,'customerVisible',true, 'sortOrder',80),
    jsonb_build_object('key','disposal',     'amount', 125.00,'quantity',1, 'rate',125,  'customerVisible',true, 'sortOrder',90),
    jsonb_build_object('key','containment',  'amount', 100.00,'quantity',50,'rate',2,    'customerVisible',true, 'sortOrder',100),
    jsonb_build_object('key','ppe',          'amount',  82.80,'quantity',1, 'rate',82.8, 'customerVisible',true, 'sortOrder',110),
    jsonb_build_object('key','prv',          'amount', 500.00,'quantity',1, 'rate',500,  'customerVisible',false,'sortOrder',120),
    jsonb_build_object('key','overhead',     'amount',1000.00,'quantity',1, 'rate',1000, 'customerVisible',false,'sortOrder',130)
  );
$$;

-- Reuse the revision the oop_pricing_builder migration already seeds. Two reasons
-- not to create one: `oop_pricing_one_current_published` is a partial UNIQUE index
-- on (status) WHERE status='published', so a second published row is impossible;
-- and the conversion reads its config from oop_quote_pricing_snapshots, never from
-- the revision — the revision is only the FK anchor. So the fixture can keep its
-- own section-bearing config snapshot and still point at the real revision.
CREATE TEMP TABLE oop_fixture_revision (id uuid PRIMARY KEY);

INSERT INTO oop_fixture_revision (id)
SELECT id FROM public.oop_pricing_revisions
 ORDER BY (status = 'published') DESC, revision_number DESC
 LIMIT 1;

DO $assert_revision$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM oop_fixture_revision) THEN
    RAISE EXCEPTION 'no oop_pricing_revisions row to anchor the fixture — did the builder predecessor run?';
  END IF;
END;
$assert_revision$;

-- Fixture self-check. Every later failure would otherwise surface as a bare
-- "OOP pricing access required" from deep inside a trigger, which reads like a
-- migration defect when it is really a seeding defect.
DO $assert_actor$
DECLARE
  v_uid uuid;
  v_flag record;
  v_emp record;
BEGIN
  PERFORM pg_temp.claim_as('admin');
  v_uid := auth.uid();
  SELECT enabled, force_disabled, dev_only_user_id INTO v_flag
    FROM public.feature_flags WHERE key = 'tool:oop_pricing';
  SELECT role::text AS role, is_active, is_external, auth_user_id INTO v_emp
    FROM public.employees e JOIN oop_actor a ON a.employee_id = e.id WHERE a.label = 'admin';

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL under claim_as() — the forged claim is not reaching auth.uid()';
  END IF;
  IF v_flag IS NULL THEN
    RAISE EXCEPTION 'feature flag tool:oop_pricing is absent';
  END IF;
  IF v_emp.auth_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'admin employee auth_user_id % does not match auth.uid() %', v_emp.auth_user_id, v_uid;
  END IF;
  IF NOT public.oop_pricing_calculator_access() THEN
    RAISE EXCEPTION
      'calculator access denied for the admin fixture (uid=%, role=%, active=%, external=%, flag_enabled=%, flag_force_disabled=%, flag_dev_only=%)',
      v_uid, v_emp.role, v_emp.is_active, v_emp.is_external,
      v_flag.enabled, v_flag.force_disabled, v_flag.dev_only_user_id;
  END IF;
  PERFORM pg_temp.unclaim();
END;
$assert_actor$;

-- Builds one job-linked, snapshot-backed quote and returns its id.
CREATE FUNCTION pg_temp.make_quote(p_job_type text, p_lines jsonb, p_total numeric)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_contact uuid;
  v_job uuid;
  v_revision uuid;
  v_quote uuid;
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
BEGIN
  SELECT id INTO v_revision FROM oop_fixture_revision;
  IF v_revision IS NULL THEN RAISE EXCEPTION 'fixture revision missing'; END IF;

  -- contacts.phone is NOT NULL.
  INSERT INTO public.contacts (name, phone, email)
  VALUES ('TEST oop customer ' || v_suffix, '+1555' || substr(v_suffix, 1, 7),
          'test-oop-' || v_suffix || '@example.invalid')
  RETURNING id INTO v_contact;

  -- jobs.division is the public.job_division ENUM, not text.
  INSERT INTO public.jobs (job_number, primary_contact_id, division, address, city, state, zip)
  VALUES ('TEST-' || v_suffix, v_contact, p_job_type::public.job_division,
          '789 South 900 East', 'Springville', 'UT', '84663')
  RETURNING id INTO v_job;

  -- The oop_quotes write trigger needs a real actor; the admin is the only one
  -- the fixture has with calculator access.
  PERFORM pg_temp.claim_as('admin');
  -- oop_require_active_internal_quote_write() REPLACES quote_total with the frozen
  -- v1 legacy math unless this marker is set — and the legacy math reads the old
  -- tech_hours/air_mover_count columns, which a v2 quote leaves at zero. Without
  -- this the fixture's 3756.30 silently becomes 0 and the conversion refuses with
  -- oop_quote_positive_total_required. This is exactly what upsert_oop_quote_v2
  -- does for a real v2 save.
  PERFORM set_config('oop_pricing.v2_write', 'on', true);
  INSERT INTO public.oop_quotes (quote_number, job_id, job_type, quote_total)
  VALUES ('TEST-OOP-' || v_suffix, v_job, p_job_type, p_total)
  RETURNING id INTO v_quote;
  PERFORM set_config('oop_pricing.v2_write', 'off', true);

  INSERT INTO public.oop_quote_pricing_snapshots (
    quote_id, pricing_revision_id, pricing_inputs, pricing_config_snapshot,
    pricing_evaluated_lines, pricing_engine_version
  ) VALUES (
    v_quote, v_revision, '{}'::jsonb, pg_temp.config_snapshot(), p_lines, 1
  );
  PERFORM pg_temp.unclaim();

  RETURN v_quote;
END;
$$;

-- ── 1-5. The EST-001023 case: nine customer lines become two ────────────────
DO $grouping$
DECLARE
  v_quote uuid;
  v_result jsonb;
  v_estimate uuid;
  v_count integer;
  v_service public.estimate_line_items;
  v_equipment public.estimate_line_items;
  v_total numeric;
BEGIN
  v_quote := pg_temp.make_quote('mold', pg_temp.evaluated_lines(), 3756.30);
  PERFORM pg_temp.become('admin');
  v_result := public.convert_oop_quote_to_estimate(v_quote);
  PERFORM pg_temp.unbecome();

  IF COALESCE((v_result->>'created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'conversion did not report created=true: %', v_result;
  END IF;
  v_estimate := (v_result->>'estimate_id')::uuid;

  SELECT count(*) INTO v_count FROM public.estimate_line_items WHERE estimate_id = v_estimate;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'expected exactly 2 grouped lines, got % (the nine-row breakdown is still reaching the customer)', v_count;
  END IF;

  SELECT * INTO v_service FROM public.estimate_line_items
   WHERE estimate_id = v_estimate AND sort_order = 0;
  SELECT * INTO v_equipment FROM public.estimate_line_items
   WHERE estimate_id = v_estimate AND sort_order = 1;

  -- 2. The exact split, to the cent.
  IF v_service.unit_price <> 2016.30 THEN
    RAISE EXCEPTION 'service line is %, expected 2016.30', v_service.unit_price;
  END IF;
  IF v_equipment.unit_price <> 1740.00 THEN
    RAISE EXCEPTION 'equipment line is %, expected 1740.00', v_equipment.unit_price;
  END IF;

  SELECT round(sum(line_total), 2) INTO v_total
    FROM public.estimate_line_items WHERE estimate_id = v_estimate;
  IF v_total <> 3756.30 THEN
    RAISE EXCEPTION 'grouping moved money: estimate totals %, quote was 3756.30', v_total;
  END IF;

  -- 3. Flat 1 x total, no unit. A per-day rate or hour count must not survive.
  IF v_service.quantity <> 1 OR v_equipment.quantity <> 1 THEN
    RAISE EXCEPTION 'grouped lines are not flat 1x (service %, equipment %)', v_service.quantity, v_equipment.quantity;
  END IF;
  IF v_service.unit IS NOT NULL OR v_equipment.unit IS NOT NULL THEN
    RAISE EXCEPTION 'grouped lines still carry a unit (service %, equipment %)', v_service.unit, v_equipment.unit;
  END IF;

  -- 4. Internal-only money never reaches the document. PRV (500) + Overhead
  --    (1000) would push the total to 5256.30 if either leaked.
  IF EXISTS (
    SELECT 1 FROM public.estimate_line_items
     WHERE estimate_id = v_estimate
       AND (description ILIKE '%PRV%' OR description ILIKE '%overhead%')
  ) THEN
    RAISE EXCEPTION 'an internal-only item reached the customer document';
  END IF;

  -- The old per-item descriptions must be gone entirely.
  IF EXISTS (
    SELECT 1 FROM public.estimate_line_items
     WHERE estimate_id = v_estimate AND description LIKE '%units ×%'
  ) THEN
    RAISE EXCEPTION 'a per-item "N units x M days" description survived grouping';
  END IF;

  -- The scope of work has to actually say something.
  IF v_service.description NOT ILIKE '%remediation%' THEN
    RAISE EXCEPTION 'mold service line carries no remediation scope: %', v_service.description;
  END IF;
  IF v_equipment.description NOT ILIKE '%air mover%' THEN
    RAISE EXCEPTION 'equipment line does not name the equipment quoted: %', v_equipment.description;
  END IF;

  -- 5. QuickBooks Item + Class on BOTH lines; mold takes the mold item.
  IF v_service.qbo_class_id <> '1000000005' OR v_service.qbo_class_name <> 'Mitigation'
     OR v_equipment.qbo_class_id <> '1000000005' OR v_equipment.qbo_class_name <> 'Mitigation' THEN
    RAISE EXCEPTION 'grouped lines are not classed Mitigation (service %, equipment %)',
      v_service.qbo_class_id, v_equipment.qbo_class_id;
  END IF;
  IF v_service.qbo_item_id <> '1010000131' OR v_equipment.qbo_item_id <> '1010000131' THEN
    RAISE EXCEPTION 'mold quote did not pick the mold QuickBooks item (service %, equipment %)',
      v_service.qbo_item_id, v_equipment.qbo_item_id;
  END IF;

  -- 8. Retry contract: same estimate, created=false, no second document.
  PERFORM pg_temp.become('admin');
  v_result := public.convert_oop_quote_to_estimate(v_quote);
  PERFORM pg_temp.unbecome();
  IF (v_result->>'estimate_id')::uuid <> v_estimate THEN
    RAISE EXCEPTION 'retry returned a different estimate';
  END IF;
  IF COALESCE((v_result->>'created')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'retry reported created=true';
  END IF;
  SELECT count(*) INTO v_count FROM public.estimate_line_items WHERE estimate_id = v_estimate;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'retry duplicated lines (now %)', v_count;
  END IF;
END;
$grouping$;

-- ── 5b. A water quote picks the water item ──────────────────────────────────
DO $water$
DECLARE
  v_quote uuid;
  v_estimate uuid;
  v_item text;
  v_description text;
BEGIN
  v_quote := pg_temp.make_quote('water', pg_temp.evaluated_lines(), 3756.30);
  PERFORM pg_temp.become('admin');
  v_estimate := (public.convert_oop_quote_to_estimate(v_quote)->>'estimate_id')::uuid;
  PERFORM pg_temp.unbecome();

  SELECT qbo_item_id, description INTO v_item, v_description
    FROM public.estimate_line_items WHERE estimate_id = v_estimate AND sort_order = 0;
  IF v_item <> '1010000071' THEN
    RAISE EXCEPTION 'water quote picked item %, expected 1010000071', v_item;
  END IF;
  IF v_description NOT ILIKE '%mitigation%' OR v_description NOT ILIKE '%drying%' THEN
    RAISE EXCEPTION 'water service line carries no mitigation/drying scope: %', v_description;
  END IF;
  -- Water still classes as Mitigation, same as mold.
  IF (SELECT DISTINCT qbo_class_name FROM public.estimate_line_items WHERE estimate_id = v_estimate)
     IS DISTINCT FROM 'Mitigation' THEN
    RAISE EXCEPTION 'water lines are not all classed Mitigation';
  END IF;
END;
$water$;

-- ── 6. No equipment on the quote produces ONE line, not an empty second ─────
DO $no_equipment$
DECLARE
  v_quote uuid;
  v_estimate uuid;
  v_count integer;
  v_price numeric;
BEGIN
  v_quote := pg_temp.make_quote('water', jsonb_build_array(
    jsonb_build_object('key','labor','amount',920.00,'quantity',10,'rate',92,'customerVisible',true,'sortOrder',10),
    jsonb_build_object('key','disposal','amount',125.00,'quantity',1,'rate',125,'customerVisible',true,'sortOrder',90)
  ), 1045.00);
  PERFORM pg_temp.become('admin');
  v_estimate := (public.convert_oop_quote_to_estimate(v_quote)->>'estimate_id')::uuid;
  PERFORM pg_temp.unbecome();

  SELECT count(*), max(unit_price) INTO v_count, v_price
    FROM public.estimate_line_items WHERE estimate_id = v_estimate;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'an equipment-free quote produced % lines, expected 1', v_count;
  END IF;
  IF v_price <> 1045.00 THEN
    RAISE EXCEPTION 'equipment-free service line is %, expected 1045.00', v_price;
  END IF;
END;
$no_equipment$;

-- ── 7. The project minimum adjustment joins the service line ────────────────
DO $minimum$
DECLARE
  v_quote uuid;
  v_estimate uuid;
  v_service numeric;
  v_equipment numeric;
BEGIN
  v_quote := pg_temp.make_quote('water', jsonb_build_array(
    jsonb_build_object('key','labor','amount',500.00,'quantity',5,'rate',100,'customerVisible',true,'sortOrder',10),
    jsonb_build_object('key','air_mover','amount',200.00,'quantity',4,'days',2,'rate',25,'customerVisible',true,'sortOrder',20),
    jsonb_build_object('key','project_minimum_adjustment','amount',300.00,'customerVisible',true,'sortOrder',2147483647)
  ), 1000.00);
  PERFORM pg_temp.become('admin');
  v_estimate := (public.convert_oop_quote_to_estimate(v_quote)->>'estimate_id')::uuid;
  PERFORM pg_temp.unbecome();

  SELECT unit_price INTO v_service FROM public.estimate_line_items
   WHERE estimate_id = v_estimate AND sort_order = 0;
  SELECT unit_price INTO v_equipment FROM public.estimate_line_items
   WHERE estimate_id = v_estimate AND sort_order = 1;

  -- 500 labor + 300 minimum on the service line; equipment untouched at 200.
  IF v_service <> 800.00 THEN
    RAISE EXCEPTION 'project minimum did not land on the service line (service %, expected 800.00)', v_service;
  END IF;
  IF v_equipment <> 200.00 THEN
    RAISE EXCEPTION 'project minimum leaked into equipment (equipment %, expected 200.00)', v_equipment;
  END IF;
END;
$minimum$;

-- ── 9. The billing-role gate still refuses, and leaves nothing behind ───────
DO $denied$
DECLARE
  v_quote uuid;
  v_before integer;
  v_after integer;
  v_state text;
BEGIN
  v_quote := pg_temp.make_quote('water', pg_temp.evaluated_lines(), 3756.30);
  SELECT count(*) INTO v_before FROM public.estimates;

  PERFORM pg_temp.become('tech');
  BEGIN
    PERFORM public.convert_oop_quote_to_estimate(v_quote);
    PERFORM pg_temp.unbecome();
    RAISE EXCEPTION 'field_tech was allowed to convert a quote';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    PERFORM pg_temp.unbecome();
    IF v_state <> '42501' THEN
      RAISE EXCEPTION 'field_tech refusal used SQLSTATE %, expected 42501', v_state;
    END IF;
  END;

  SELECT count(*) INTO v_after FROM public.estimates;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'a refused conversion still created % estimate row(s)', v_after - v_before;
  END IF;
  IF EXISTS (SELECT 1 FROM public.oop_quotes WHERE id = v_quote AND converted_estimate_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a refused conversion still linked the quote';
  END IF;
END;
$denied$;

ROLLBACK;
