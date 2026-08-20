-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: contractor_compliance_reviewer_supplied_dates.rollback.test.sql
-- Phase: n/a — paired rollback proof for 20260819010000
-- ═══════════════════════════════════════════════════════════════════════════
-- Runs AFTER the rollback. Asks the fail-closed question the forward proof
-- cannot: did the undo actually re-close what the migration opened, or did it
-- merely drop some objects and leave the relaxation in place?
--
-- WHAT IT PROVES
--   1. RE-TIGHTENED — an undated coverage document is REFUSED again. This is the
--      exact case the migration exists to permit, so it is the only honest test
--      that the undo undid something.
--   2. THE SIX-ARGUMENT OVERLOAD IS GONE, and exactly one function survives, so
--      the deployed Worker cannot call a signature the rolled-back database no
--      longer supports.
--   3. THE FOUR-ARGUMENT CALL WORKS on a fully dated document — the rollback
--      restores a working reviewer, it does not just delete a feature.
--   4. ACL PRESERVED — still service_role only. A rollback that left
--      `authenticated` holding EXECUTE would undo the feature while keeping a
--      privilege the original never granted. That is not an undo.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing contractor reviewer-dates rollback test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

CREATE TEMP TABLE cc_rb (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE v_admin uuid; v_contact uuid; v_profile uuid;
BEGIN
  INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
  VALUES (gen_random_uuid(), 'TEST cc rb admin', 'test-cc-rb-admin@example.invalid', 'admin', true, false)
  RETURNING id INTO v_admin;
  INSERT INTO public.contacts (name, phone)
  VALUES ('TEST Rollback Contractor', '+15555550101') RETURNING id INTO v_contact;
  INSERT INTO public.contractor_compliance_profiles (contact_id, required_w9_year)
  VALUES (v_contact, 2026) RETURNING id INTO v_profile;
  INSERT INTO cc_rb VALUES ('admin', v_admin), ('profile', v_profile);
END;
$seed$;

CREATE FUNCTION pg_temp.rbdoc(p_start date, p_end date) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.contractor_compliance_documents
    (profile_id, document_type, version_number, storage_object_path, original_filename,
     mime_type, byte_size, sha256_hex, coverage_start_date, coverage_end_date)
  VALUES ((SELECT v FROM cc_rb WHERE k='profile'), 'general_liability',
          (SELECT COALESCE(max(version_number),0)+1 FROM public.contractor_compliance_documents
            WHERE profile_id=(SELECT v FROM cc_rb WHERE k='profile')),
          -- A UNIQUE content-dedupe index covers (profile_id, document_type,
          -- sha256_hex), so every fixture document needs its own 64-char digest.
          'test/' || gen_random_uuid()::text || '.pdf', 'test.pdf', 'application/pdf', 1024,
          md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), p_start, p_end)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- ── 1. THE RELAXATION IS GONE ───────────────────────────────────────────────
DO $r1$
BEGIN
  BEGIN
    PERFORM pg_temp.rbdoc(NULL, NULL);
    RAISE EXCEPTION 'ROLLBACK CASE 1 FAILED: an undated document still inserts — the undo did not re-tighten';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ROLLBACK CASE 1 PASS: an undated coverage document is refused again';
  END;
END; $r1$;

-- ── 2. THE SIX-ARGUMENT OVERLOAD IS GONE ────────────────────────────────────
DO $r2$
DECLARE n int; n6 int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='contractor_compliance_review_document';
  SELECT count(*) INTO n6 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='contractor_compliance_review_document'
     AND p.pronargs = 6;
  IF n <> 1 OR n6 <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK CASE 2 FAILED: % functions survive, % of them 6-argument', n, n6;
  END IF;
  RAISE NOTICE 'ROLLBACK CASE 2 PASS: exactly one function, no 6-argument overload';
END; $r2$;

-- ── 3. THE RESTORED REVIEWER ACTUALLY WORKS ─────────────────────────────────
DO $r3$
DECLARE v_doc uuid; v_admin uuid; v_res jsonb;
BEGIN
  SELECT v INTO v_admin FROM cc_rb WHERE k='admin';
  v_doc := pg_temp.rbdoc(DATE '2026-01-01', DATE '2027-01-01');
  v_res := public.contractor_compliance_review_document(
    p_actor_employee_id => v_admin, p_document_id => v_doc,
    p_review_state => 'accepted', p_rejection_reason => NULL);
  IF v_res->>'review_state' <> 'accepted' THEN
    RAISE EXCEPTION 'ROLLBACK CASE 3 FAILED: restored reviewer returned %', v_res;
  END IF;
  RAISE NOTICE 'ROLLBACK CASE 3 PASS: the restored 4-argument reviewer still accepts a dated document';
END; $r3$;

-- ── 4. ACL PRESERVED ────────────────────────────────────────────────────────
DO $r4$
DECLARE v_anon bool; v_auth bool; v_svc bool;
BEGIN
  SELECT has_function_privilege('anon', p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         has_function_privilege('service_role', p.oid, 'EXECUTE')
    INTO v_anon, v_auth, v_svc
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='contractor_compliance_review_document';
  IF v_anon OR v_auth OR NOT v_svc THEN
    RAISE EXCEPTION 'ROLLBACK CASE 4 FAILED: anon=% authenticated=% service_role=%', v_anon, v_auth, v_svc;
  END IF;
  RAISE NOTICE 'ROLLBACK CASE 4 PASS: still service_role only';
END; $r4$;

ROLLBACK;
