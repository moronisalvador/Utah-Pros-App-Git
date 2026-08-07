-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: oop_convert_estimate_billing_boundary.test.sql
-- Phase: n/a — standalone money-path authorization correction (20260807220000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back role-perspective proof for the OOP
-- quote-to-estimate boundary. Establishes EFFECT; the credential-free source
-- contract in tests/qa/unit/oop-convert-estimate-billing-boundary.test.js
-- establishes INTENT only.
--
-- database-standard.md §5b requires per-role ALLOW **and** per-role DENY cases,
-- "including the roles the change is not about". Proving only who gets in is how
-- the 2026-08-01 conversation scoping shipped while locking out every field
-- technician. So every one of the seven live employee_role values is exercised
-- here by name, in both directions, plus inactive, external, unmapped and
-- claimless callers.
--
-- WHAT IT PROVES
--   1. admin, office and project_manager each convert a quote and get
--      {ok,estimate_id,created:true} back with an estimates row whose line total
--      equals the quote total — the shipped ConfiguredOopPricingCalculator
--      contract, which the guard must not break (database-standard.md §3).
--   2. supervisor and estimator are REFUSED (42501). They reach the calculator
--      (OOP_PRICING_ROLES includes them) but are not billing editors, so they are
--      the roles most at risk of an accidental widening. This is the pair that
--      proves the change did not simply open the door to everyone on the page.
--   3. field_tech and crm_partner are REFUSED (42501) — they fail the unchanged
--      oop_pricing_active_employee() layer first, and this migration must not
--      have disturbed that.
--   4. An INACTIVE admin and an EXTERNAL admin are REFUSED (42501).
--   5. Refusal happens BEFORE any write: the refused calls leave zero new
--      estimates, zero new estimate_line_items, and every attempted quote still
--      unlinked (converted_estimate_id IS NULL).
--   6. An authenticated user with no employee row is REFUSED.
--   7. A claimless session (auth.uid() and auth.role() both NULL) is REFUSED.
--   8. service_role holds NO EXECUTE on this function — it is browser-only by
--      design, which is why the guard deliberately has no service_role
--      short-circuit. anon holds none either.
--
-- ANTI-HOLLOW-HARNESS
--   Actors are established through `request.jwt.claims` ONLY — the modern claim
--   PostgREST actually sends. The test asserts the legacy flattened
--   `request.jwt.claim.sub` / `request.jwt.claim.role` GUCs stay EMPTY
--   throughout. Manufacturing the legacy GUC is precisely what made the QBO
--   receipt db-lane test pass against a gate production could never satisfy
--   (initiative-status.md, 2026-08-05). supabase/tests/oop_quote_to_estimate_isolated.sql
--   still sets `request.jwt.claim.sub`; it is not this file's to fix, but do not
--   copy it.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- The GUC is the REAL isolation boundary, and deliberately the only one.
-- upr.isolated_test_database can only be set by a caller that passes
-- PGOPTIONS=-cupr.isolated_test_database=on, which is exactly what the disposable
-- qualifier does and nothing that touches the shared project does.
--
-- A current_database() name check was tried here and REMOVED: every Supabase
-- database is named `postgres`, including the shared production project, so the
-- name can never distinguish the two. It refused the legitimate disposable stack
-- while providing no protection at all against the case it was meant to stop.
-- (oop_quote_to_estimate_isolated.sql still carries that check; it survives only
-- because its runner happens to use a different database name.)
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing OOP convert boundary test: isolated database guard missing';
  END IF;
END $guard$;

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
CREATE TEMP TABLE oop_actor (
  label       text PRIMARY KEY,
  role        text,
  auth_id     uuid,
  employee_id uuid,
  quote_id    uuid
);

DO $seed$
DECLARE
  r record;
  v_auth uuid;
  v_emp uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- the three that must PASS
      ('admin',          'admin',           true,  false),
      ('office',         'office',          true,  false),
      ('pm',             'project_manager', true,  false),
      -- reach the calculator, must still be REFUSED
      ('supervisor',     'supervisor',      true,  false),
      ('estimator',      'estimator',       true,  false),
      -- never reach the calculator, must still be REFUSED
      ('tech',           'field_tech',      true,  false),
      ('partner',        'crm_partner',     true,  false),
      -- right role, wrong standing
      ('inactive_admin', 'admin',           false, false),
      ('external_admin', 'admin',           true,  true )
    ) AS t(label, role, is_active, is_external)
  LOOP
    v_auth := gen_random_uuid();
    -- full_name, NOT name: public.employees has full_name (NOT NULL) and
    -- display_name. The sibling billing-boundary proof shipped with `name` and
    -- could never execute; it was caught 2026-08-05 the first time it was run.
    INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
    VALUES (
      v_auth,
      'TEST oop convert ' || r.label,
      'test-oop-' || r.label || '-' || substr(v_auth::text, 1, 8) || '@example.invalid',
      r.role::public.employee_role,
      r.is_active,
      r.is_external
    )
    RETURNING id INTO v_emp;
    INSERT INTO oop_actor (label, role, auth_id, employee_id)
    VALUES (r.label, r.role, v_auth, v_emp);
  END LOOP;
END;
$seed$;

CREATE FUNCTION pg_temp.become(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM oop_actor WHERE label = p_label;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'unknown test actor %', p_label; END IF;
  -- Modern claim ONLY. The legacy flattened GUCs are never written here.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

CREATE FUNCTION pg_temp.become_owner() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'none', true);
  RESET role;
  PERFORM set_config('request.jwt.claims', NULL, true);
END;
$$;

CREATE FUNCTION pg_temp.assert_modern_claims_only() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.sub', true), '') <> ''
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') <> '' THEN
    RAISE EXCEPTION 'HOLLOW HARNESS: a legacy flattened request.jwt.claim.* GUC was set; production never sends it';
  END IF;
END;
$$;

-- Job the quotes hang off. Conversion requires a job with a primary contact.
CREATE TEMP TABLE oop_fixture (contact_id uuid, job_id uuid, revision_id uuid);

DO $fx$
DECLARE v_contact uuid; v_job uuid;
BEGIN
  INSERT INTO public.contacts (name, phone)
  VALUES ('TEST oop convert customer', '+1555' || substr(gen_random_uuid()::text, 1, 7))
  RETURNING id INTO v_contact;

  INSERT INTO public.jobs (job_number, primary_contact_id, address, city, state, zip)
  VALUES ('OOP-CONVERT-BOUNDARY-' || substr(gen_random_uuid()::text, 1, 8),
          v_contact, '123 Test St', 'Provo', 'UT', '84601')
  RETURNING id INTO v_job;

  INSERT INTO oop_fixture (contact_id, job_id) VALUES (v_contact, v_job);
END;
$fx$;

-- The calculator is flag-gated; oop_pricing_calculator_access() reads it.
UPDATE public.feature_flags
   SET enabled = true, dev_only_user_id = NULL, force_disabled = false
 WHERE key = 'tool:oop_pricing';

-- One unconverted quote per actor, authored by the admin so that the DENY
-- actors (who cannot create a quote at all) still get a genuinely convertible
-- target — otherwise their refusal would prove nothing about THIS gate.
DO $quotes$
DECLARE
  r record;
  v_job uuid;
  v_revision uuid;
  v_quote public.oop_quotes;
BEGIN
  SELECT job_id INTO v_job FROM oop_fixture;
  PERFORM pg_temp.become('admin');
  v_revision := (public.get_oop_pricing_config(NULL)->>'id')::uuid;
  IF v_revision IS NULL THEN
    PERFORM pg_temp.become_owner();
    RAISE EXCEPTION 'no published OOP pricing revision in this database';
  END IF;

  FOR r IN SELECT label FROM oop_actor ORDER BY label LOOP
    v_quote := public.upsert_oop_quote_v2(
      p_job_id              => v_job,
      p_job_type            => 'water',
      p_insured_name        => 'TEST oop convert ' || r.label,
      p_address             => '123 Test St, Provo, UT 84601',
      p_pricing_revision_id => v_revision,
      p_inputs              => '{"labor":{"quantity":2,"rateOverride":125},"air_mover":{"quantity":2,"days":3}}'::jsonb,
      p_request_id          => gen_random_uuid()
    );
    IF COALESCE(v_quote.quote_total, 0) <= 0 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'fixture quote for % has no positive total', r.label;
    END IF;
    UPDATE oop_actor SET quote_id = v_quote.id WHERE label = r.label;
  END LOOP;

  PERFORM pg_temp.become_owner();
  UPDATE oop_fixture SET revision_id = v_revision;
END;
$quotes$;

-- Two extra targets for the unmapped and claimless cases.
CREATE TEMP TABLE oop_spare (label text PRIMARY KEY, quote_id uuid);

DO $spare$
DECLARE
  v_job uuid; v_revision uuid; v_quote public.oop_quotes; v_label text;
BEGIN
  SELECT job_id, revision_id INTO v_job, v_revision FROM oop_fixture;
  PERFORM pg_temp.become('admin');
  FOREACH v_label IN ARRAY ARRAY['unmapped', 'claimless'] LOOP
    v_quote := public.upsert_oop_quote_v2(
      p_job_id              => v_job,
      p_job_type            => 'water',
      p_insured_name        => 'TEST oop spare ' || v_label,
      p_address             => '123 Test St, Provo, UT 84601',
      p_pricing_revision_id => v_revision,
      p_inputs              => '{"labor":{"quantity":2,"rateOverride":125},"air_mover":{"quantity":2,"days":3}}'::jsonb,
      p_request_id          => gen_random_uuid()
    );
    INSERT INTO oop_spare VALUES (v_label, v_quote.id);
  END LOOP;
  PERFORM pg_temp.become_owner();
END;
$spare$;

-- ── 1. ALLOW: admin, office, project_manager ────────────────────────────────
DO $t1$
DECLARE
  r record;
  v_result jsonb;
  v_estimate public.estimates;
  v_total numeric;
  v_quote_total numeric;
BEGIN
  FOR r IN SELECT label, quote_id FROM oop_actor
            WHERE label IN ('admin', 'office', 'pm') ORDER BY label
  LOOP
    SELECT quote_total INTO v_quote_total FROM public.oop_quotes WHERE id = r.quote_id;

    PERFORM pg_temp.become(r.label);
    PERFORM pg_temp.assert_modern_claims_only();
    v_result := public.convert_oop_quote_to_estimate(r.quote_id);
    PERFORM pg_temp.become_owner();

    IF v_result->>'estimate_id' IS NULL OR NOT (v_result->>'created')::boolean THEN
      RAISE EXCEPTION 'convert_oop_quote_to_estimate did not create an estimate for %', r.label;
    END IF;

    SELECT * INTO v_estimate FROM public.estimates WHERE id = (v_result->>'estimate_id')::uuid;
    IF v_estimate.id IS NULL THEN
      RAISE EXCEPTION 'no estimates row landed for %', r.label;
    END IF;

    -- The money contract: the estimate must total exactly what the quote said.
    SELECT round(COALESCE(sum(line_total), 0), 2) INTO v_total
      FROM public.estimate_line_items WHERE estimate_id = v_estimate.id;
    IF v_total <> round(v_quote_total, 2) THEN
      RAISE EXCEPTION 'estimate total % <> quote total % for %', v_total, v_quote_total, r.label;
    END IF;

    -- Idempotent re-entry must survive the guard change.
    PERFORM pg_temp.become(r.label);
    v_result := public.convert_oop_quote_to_estimate(r.quote_id);
    PERFORM pg_temp.become_owner();
    IF (v_result->>'created')::boolean THEN
      RAISE EXCEPTION 'replay created a SECOND estimate for %', r.label;
    END IF;

    RAISE NOTICE 'ok: % converted a quote and replayed safely', r.label;
  END LOOP;
END;
$t1$;

-- ── 2/3/4/5. DENY: every other role, and no write left behind ────────────────
DO $t2$
DECLARE
  r record;
  v_before_est bigint; v_after_est bigint;
  v_before_li bigint;  v_after_li bigint;
  v_linked bigint;
BEGIN
  SELECT count(*) INTO v_before_est FROM public.estimates;
  SELECT count(*) INTO v_before_li  FROM public.estimate_line_items;

  FOR r IN SELECT label, role, quote_id FROM oop_actor
            WHERE label IN ('supervisor', 'estimator', 'tech', 'partner',
                            'inactive_admin', 'external_admin')
            ORDER BY label
  LOOP
    PERFORM pg_temp.become(r.label);
    PERFORM pg_temp.assert_modern_claims_only();
    BEGIN
      PERFORM public.convert_oop_quote_to_estimate(r.quote_id);
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'REGRESSION: convert_oop_quote_to_estimate allowed % (role %)', r.label, r.role;
    EXCEPTION WHEN insufficient_privilege THEN
      PERFORM pg_temp.become_owner();
      RAISE NOTICE 'ok (42501): refused % (role %)', r.label, r.role;
    END;
  END LOOP;

  -- The guard precedes every INSERT, so six refusals must leave the tables
  -- exactly as they found them — no orphan estimate, no consumed estimate
  -- number, no stray line item.
  SELECT count(*) INTO v_after_est FROM public.estimates;
  SELECT count(*) INTO v_after_li  FROM public.estimate_line_items;
  IF v_after_est <> v_before_est THEN
    RAISE EXCEPTION 'refused calls wrote % estimate row(s)', v_after_est - v_before_est;
  END IF;
  IF v_after_li <> v_before_li THEN
    RAISE EXCEPTION 'refused calls wrote % estimate line item(s)', v_after_li - v_before_li;
  END IF;

  -- ...and must not have linked any of the six quotes.
  SELECT count(*) INTO v_linked
    FROM public.oop_quotes q
    JOIN oop_actor a ON a.quote_id = q.id
   WHERE a.label IN ('supervisor', 'estimator', 'tech', 'partner',
                     'inactive_admin', 'external_admin')
     AND q.converted_estimate_id IS NOT NULL;
  IF v_linked <> 0 THEN
    RAISE EXCEPTION '% refused quote(s) were linked to an estimate anyway', v_linked;
  END IF;

  RAISE NOTICE 'ok: 6 refusals left zero rows and zero links behind';
END;
$t2$;

-- ── 6. An authenticated user with no employee row is refused ────────────────
DO $t3$
DECLARE v_quote uuid;
BEGIN
  SELECT quote_id INTO v_quote FROM oop_spare WHERE label = 'unmapped';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM pg_temp.assert_modern_claims_only();
  BEGIN
    PERFORM public.convert_oop_quote_to_estimate(v_quote);
    PERFORM pg_temp.become_owner();
    RAISE EXCEPTION 'REGRESSION: an unmapped auth user converted a quote';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.become_owner();
    RAISE NOTICE 'ok (42501): refused an unmapped auth user';
  END;
END;
$t3$;

-- ── 7. A claimless session is refused (NULL-safety) ─────────────────────────
DO $t4$
DECLARE v_quote uuid;
BEGIN
  SELECT quote_id INTO v_quote FROM oop_spare WHERE label = 'claimless';
  -- auth.uid() and auth.role() are both NULL here: a direct psql session,
  -- pg_cron, or a future internal caller. billing_edit_access() returns
  -- EXISTS(...) = false rather than NULL, so `NOT billing_edit_access()` is
  -- true and the call must be refused. A guard written as
  -- `auth.role() <> 'service_role' AND NOT ...` would evaluate to NULL here,
  -- which PL/pgSQL's IF treats as false — silently skipping the check.
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM pg_temp.assert_modern_claims_only();
  BEGIN
    PERFORM public.convert_oop_quote_to_estimate(v_quote);
    PERFORM pg_temp.become_owner();
    RAISE EXCEPTION 'REGRESSION: a claimless session converted a quote — the guard is not NULL-safe';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.become_owner();
    RAISE NOTICE 'ok (42501): a claimless session is refused (NULL-safe guard)';
  END;
END;
$t4$;

-- ── 8. Grants: browser-only, no service_role, no anon ───────────────────────
DO $t5$
DECLARE v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'convert_oop_quote_to_estimate'
     AND pg_get_function_identity_arguments(p.oid) = 'p_quote_id uuid';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'convert_oop_quote_to_estimate(uuid) is missing'; END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost EXECUTE — the shipped browser caller would break';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon holds EXECUTE on convert_oop_quote_to_estimate';
  END IF;
  -- This is why the guard has no service_role short-circuit: a worker cannot
  -- call this function at all, so short-circuiting for it would be dead code.
  IF has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role holds EXECUTE — this RPC is browser-only by design';
  END IF;

  RAISE NOTICE 'ok: authenticated only; anon and service_role hold no EXECUTE';
END;
$t5$;

ROLLBACK;
