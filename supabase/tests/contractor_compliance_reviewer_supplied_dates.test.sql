-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: contractor_compliance_reviewer_supplied_dates.test.sql
-- Phase: n/a — standalone contractor-compliance intake relaxation (20260819010000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back behavioural proof. Establishes EFFECT; the
-- credential-free contract in tests/qa/unit/contractor-compliance-reviewer-supplied-dates.test.js
-- reads SQL text and establishes INTENT only (close-out-standard.md 2b).
--
-- WHY THIS CHANGE EXISTS
--   Gusto carries 13 subcontractors and $163,122 paid YTD 2026; UPR holds
--   insurance certificates for three. Contractors were being refused at intake
--   over two dates they often cannot find on their own certificate, so the
--   certificate never arrived at all. Now the document may arrive undated and a
--   reviewer supplies the dates when accepting it.
--
-- WHAT IT PROVES
--   1. INTAKE RELAXED — a non-W-9 document inserts with BOTH dates NULL. This is
--      impossible under the pre-migration constraint and is the whole feature.
--   2. INTAKE STILL STRICT — one date without the other is refused, in both
--      directions, and end-before-start is refused. A half-filled form is a
--      mistake, not a deliberate omission.
--   3. W-9 UNTOUCHED — still requires a tax year, still refuses coverage dates.
--   4. ACCEPT REFUSES AN UNDATED COVERAGE DOCUMENT with 22023.
--      contractor_compliance_continuous_coverage_end() reads exactly those two
--      columns, so accepting an undated row would mark a contractor compliant on
--      a certificate with no coverage period.
--   5. ACCEPT WITH REVIEWER-SUPPLIED DATES writes them and succeeds. The feature.
--   6. SUPPLIED DATES WIN over dates already on the row (a reviewer correcting a
--      contractor's typo), and OMITTED dates preserve what is already there.
--   7. FE-CONTRACT FREEZE — the deployed Worker's FOUR-named-argument call still
--      resolves and still works. CREATE OR REPLACE does not replace across a
--      changed argument list, so without the paired DROP this call would bind a
--      stale body or fail 42725.
--   8. EXACTLY ONE function of this name survives.
--   9. ACL — service_role only; anon and authenticated hold no EXECUTE. This
--      definer trusts a CALLER-SUPPLIED actor id that is never bound to
--      auth.uid(), and employee ids are readable via get_employee_directory, so
--      granting authenticated would let any signed-in employee accept, reject or
--      re-date compliance documents under a forged actor.
--  10. UNCHANGED SIDE EFFECTS — accepting still supersedes the prior accepted
--      document of the same type and still completes a satisfied request.
--  11. AUTHORIZATION — a field_tech actor is refused 42501, before any write.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  -- Every Supabase database is named 'postgres', production included, so the
  -- database NAME is not a boundary. This GUC is.
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing contractor reviewer-dates test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
CREATE TEMP TABLE cc_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE v_admin uuid; v_tech uuid; v_contact uuid; v_profile uuid; v_request uuid;
BEGIN
  INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
  VALUES (gen_random_uuid(), 'TEST cc admin', 'test-cc-admin@example.invalid', 'admin', true, false)
  RETURNING id INTO v_admin;

  INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
  VALUES (gen_random_uuid(), 'TEST cc tech', 'test-cc-tech@example.invalid', 'field_tech', true, false)
  RETURNING id INTO v_tech;

  -- contacts.phone is NOT NULL — omitting it is the fixture defect that broke
  -- two sibling proofs before they ever ran. And contacts has `name`, while
  -- employees has `full_name` and NO `name`: the two tables are inverses of
  -- each other, and both spellings have cost a proof run.
  INSERT INTO public.contacts (name, phone)
  VALUES ('TEST Contractor', '+15555550100')
  RETURNING id INTO v_contact;

  INSERT INTO public.contractor_compliance_profiles (contact_id, required_w9_year)
  VALUES (v_contact, 2026) RETURNING id INTO v_profile;

  INSERT INTO public.contractor_compliance_requests
    (profile_id, request_identity, requested_document_types, token_digest, expires_at)
  VALUES (v_profile, 'test-cc-identity-2026-12-31', ARRAY['general_liability'],
          repeat('a', 64), now() + interval '30 days')
  RETURNING id INTO v_request;

  INSERT INTO cc_fx VALUES ('admin', v_admin), ('tech', v_tech),
                           ('contact', v_contact), ('profile', v_profile), ('request', v_request);
END;
$seed$;

CREATE FUNCTION pg_temp.newdoc(p_type text, p_start date, p_end date, p_year int DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.contractor_compliance_documents
    (profile_id, document_type, version_number, storage_object_path, original_filename,
     mime_type, byte_size, sha256_hex, coverage_start_date, coverage_end_date, tax_year)
  VALUES ((SELECT v FROM cc_fx WHERE k='profile'), p_type,
          (SELECT COALESCE(max(version_number),0)+1 FROM public.contractor_compliance_documents
            WHERE profile_id=(SELECT v FROM cc_fx WHERE k='profile') AND document_type=p_type),
          -- A UNIQUE content-dedupe index covers (profile_id, document_type,
          -- sha256_hex), so every fixture document needs its own 64-char digest.
          'test/' || gen_random_uuid()::text || '.pdf', 'test.pdf', 'application/pdf', 1024,
          md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), p_start, p_end, p_year)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- ── 1. INTAKE RELAXED — the feature ─────────────────────────────────────────
DO $t1$
DECLARE v_id uuid;
BEGIN
  v_id := pg_temp.newdoc('general_liability', NULL, NULL);
  IF v_id IS NULL THEN RAISE EXCEPTION 'CASE 1 FAILED: undated coverage document was not inserted'; END IF;
  RAISE NOTICE 'CASE 1 PASS: an undated coverage document may now arrive';
END; $t1$;

-- ── 2. INTAKE STILL STRICT ──────────────────────────────────────────────────
DO $t2$
DECLARE v_state text; n int := 0;
BEGIN
  BEGIN v_state := NULL; PERFORM pg_temp.newdoc('general_liability', DATE '2026-01-01', NULL);
    RAISE EXCEPTION 'CASE 2 FAILED: start-without-end was accepted';
  EXCEPTION WHEN check_violation THEN n := n + 1; END;

  BEGIN PERFORM pg_temp.newdoc('general_liability', NULL, DATE '2026-12-31');
    RAISE EXCEPTION 'CASE 2 FAILED: end-without-start was accepted';
  EXCEPTION WHEN check_violation THEN n := n + 1; END;

  BEGIN PERFORM pg_temp.newdoc('general_liability', DATE '2026-12-31', DATE '2026-01-01');
    RAISE EXCEPTION 'CASE 2 FAILED: end-before-start was accepted';
  EXCEPTION WHEN check_violation THEN n := n + 1; END;

  IF n <> 3 THEN RAISE EXCEPTION 'CASE 2 FAILED: expected 3 refusals, got %', n; END IF;
  RAISE NOTICE 'CASE 2 PASS: half-filled and out-of-order dates are still refused (3/3)';
END; $t2$;

-- ── 3. W-9 UNTOUCHED ────────────────────────────────────────────────────────
DO $t3$
DECLARE n int := 0; v_id uuid;
BEGIN
  BEGIN PERFORM pg_temp.newdoc('w9', DATE '2026-01-01', DATE '2026-12-31', 2026);
    RAISE EXCEPTION 'CASE 3 FAILED: a W-9 carrying coverage dates was accepted';
  EXCEPTION WHEN check_violation THEN n := n + 1; END;

  IF pg_temp.newdoc('w9', NULL, NULL, 2026) IS NULL THEN
    RAISE EXCEPTION 'CASE 3 FAILED: a valid W-9 was refused';
  END IF;
  IF n <> 1 THEN RAISE EXCEPTION 'CASE 3 FAILED: expected 1 refusal, got %', n; END IF;

  -- PRE-EXISTING GAP, deliberately pinned rather than fixed here.
  -- A W-9 with a NULL tax_year is ACCEPTED by the constraint, because the w9 arm
  -- evaluates to NULL (NULL >= 2000 is NULL) and the non-w9 arm to FALSE, and a
  -- CHECK rejects only FALSE. The pre-migration constraint has exactly the same
  -- hole — verified by evaluating its expression directly — so this migration
  -- neither introduced nor widened it. It is defended at the application layer:
  -- validateDocumentDates('w9', ...) in functions/lib/contractor-compliance.js
  -- throws unless the year is an integer in [2000, 2200], and it is the only
  -- path to both ingest RPCs. Closing it in the database would be a constraint
  -- TIGHTENING on a live table, which database-standard.md §3 makes a separate
  -- reviewed change. Pinned so that a future reader meets the fact, not a
  -- surprise, and so a tightening migration has something to flip.
  v_id := pg_temp.newdoc('w9', NULL, NULL, NULL);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'CASE 3 FAILED: undated/untaxed W-9 behaviour changed unexpectedly';
  END IF;
  RAISE NOTICE 'CASE 3 PASS: W-9 rules unchanged (incl. the pre-existing NULL tax_year gap)';
END; $t3$;

-- ── 4/5/6. ACCEPT ───────────────────────────────────────────────────────────
DO $t4$
DECLARE v_doc uuid; v_admin uuid; v_s date; v_e date; v_state text;
BEGIN
  SELECT v INTO v_admin FROM cc_fx WHERE k='admin';
  v_doc := pg_temp.newdoc('general_liability', NULL, NULL);

  -- 4. undated + no supplied dates -> refused
  BEGIN
    PERFORM public.contractor_compliance_review_document(v_admin, v_doc, 'accepted', NULL);
    RAISE EXCEPTION 'CASE 4 FAILED: an undated coverage document was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN
    RAISE NOTICE 'CASE 4 PASS: accept refuses an undated coverage document (22023)';
  END;

  -- 5. reviewer supplies them -> accepted, and they are WRITTEN
  PERFORM public.contractor_compliance_review_document(
    v_admin, v_doc, 'accepted', NULL, DATE '2026-03-01', DATE '2027-03-01');
  SELECT review_state, coverage_start_date, coverage_end_date INTO v_state, v_s, v_e
    FROM public.contractor_compliance_documents WHERE id = v_doc;
  IF v_state <> 'accepted' OR v_s <> DATE '2026-03-01' OR v_e <> DATE '2027-03-01' THEN
    RAISE EXCEPTION 'CASE 5 FAILED: state=% start=% end=%', v_state, v_s, v_e;
  END IF;
  RAISE NOTICE 'CASE 5 PASS: reviewer-supplied dates are written and the document is accepted';
END; $t4$;

DO $t6$
DECLARE v_doc uuid; v_admin uuid; v_s date; v_e date;
BEGIN
  SELECT v INTO v_admin FROM cc_fx WHERE k='admin';

  -- 6a. supplied dates WIN over dates already on the row
  v_doc := pg_temp.newdoc('workers_comp', DATE '2026-01-01', DATE '2026-06-30');
  PERFORM public.contractor_compliance_review_document(
    v_admin, v_doc, 'accepted', NULL, DATE '2026-02-02', DATE '2027-02-02');
  SELECT coverage_start_date, coverage_end_date INTO v_s, v_e
    FROM public.contractor_compliance_documents WHERE id = v_doc;
  IF v_s <> DATE '2026-02-02' OR v_e <> DATE '2027-02-02' THEN
    RAISE EXCEPTION 'CASE 6a FAILED: supplied dates did not win (start=% end=%)', v_s, v_e;
  END IF;

  -- 6b. omitting them preserves what the contractor already provided
  v_doc := pg_temp.newdoc('workers_comp_waiver', DATE '2026-04-04', DATE '2027-04-04');
  PERFORM public.contractor_compliance_review_document(v_admin, v_doc, 'accepted', NULL);
  SELECT coverage_start_date, coverage_end_date INTO v_s, v_e
    FROM public.contractor_compliance_documents WHERE id = v_doc;
  IF v_s <> DATE '2026-04-04' OR v_e <> DATE '2027-04-04' THEN
    RAISE EXCEPTION 'CASE 6b FAILED: existing dates were not preserved (start=% end=%)', v_s, v_e;
  END IF;
  RAISE NOTICE 'CASE 6 PASS: supplied dates win; omitted dates preserve the row';
END; $t6$;

-- ── 7. FE-CONTRACT FREEZE — the deployed 4-named-argument call ──────────────
DO $t7$
DECLARE v_doc uuid; v_admin uuid; v_res jsonb;
BEGIN
  SELECT v INTO v_admin FROM cc_fx WHERE k='admin';
  v_doc := pg_temp.newdoc('general_liability', DATE '2026-05-05', DATE '2027-05-05');
  -- EXACTLY the shape functions/api/contractor-compliance-requests.js shipped with.
  v_res := public.contractor_compliance_review_document(
    p_actor_employee_id => v_admin, p_document_id => v_doc,
    p_review_state => 'accepted', p_rejection_reason => NULL);
  IF v_res->>'review_state' <> 'accepted' THEN
    RAISE EXCEPTION 'CASE 7 FAILED: 4-argument call returned %', v_res;
  END IF;
  RAISE NOTICE 'CASE 7 PASS: the deployed 4-named-argument call still resolves and works';
END; $t7$;

-- ── 8/9. IDENTITY AND ACL ───────────────────────────────────────────────────
DO $t8$
DECLARE n int; v_anon bool; v_auth bool; v_svc bool;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='contractor_compliance_review_document';
  IF n <> 1 THEN RAISE EXCEPTION 'CASE 8 FAILED: % functions survive, expected exactly 1', n; END IF;

  SELECT has_function_privilege('anon', p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         has_function_privilege('service_role', p.oid, 'EXECUTE')
    INTO v_anon, v_auth, v_svc
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='contractor_compliance_review_document';
  IF v_anon OR v_auth OR NOT v_svc THEN
    RAISE EXCEPTION 'CASE 9 FAILED: anon=% authenticated=% service_role=%', v_anon, v_auth, v_svc;
  END IF;
  RAISE NOTICE 'CASE 8/9 PASS: exactly one function, service_role only';
END; $t8$;

-- ── 10. UNCHANGED SIDE EFFECTS ──────────────────────────────────────────────
DO $t10$
DECLARE v_admin uuid; v_profile uuid; v_old uuid; v_new uuid; v_superseded text; v_done timestamptz;
BEGIN
  SELECT v INTO v_admin FROM cc_fx WHERE k='admin';
  SELECT v INTO v_profile FROM cc_fx WHERE k='profile';

  v_old := pg_temp.newdoc('general_liability', DATE '2025-01-01', DATE '2026-01-01');
  PERFORM public.contractor_compliance_review_document(v_admin, v_old, 'accepted', NULL);
  v_new := pg_temp.newdoc('general_liability', NULL, NULL);
  PERFORM public.contractor_compliance_review_document(
    v_admin, v_new, 'accepted', NULL, DATE '2026-01-01', DATE '2027-01-01');

  SELECT review_state INTO v_superseded FROM public.contractor_compliance_documents WHERE id = v_old;
  IF v_superseded <> 'superseded' THEN
    RAISE EXCEPTION 'CASE 10 FAILED: prior accepted document is % , expected superseded', v_superseded;
  END IF;

  SELECT completed_at INTO v_done FROM public.contractor_compliance_requests
   WHERE id = (SELECT v FROM cc_fx WHERE k='request');
  IF v_done IS NULL THEN
    RAISE EXCEPTION 'CASE 10 FAILED: a satisfied request was not completed';
  END IF;
  RAISE NOTICE 'CASE 10 PASS: superseding and request completion still work, via a reviewer-dated accept';
END; $t10$;

-- ── 11. AUTHORIZATION ───────────────────────────────────────────────────────
DO $t11$
DECLARE v_doc uuid; v_tech uuid; v_state text;
BEGIN
  SELECT v INTO v_tech FROM cc_fx WHERE k='tech';
  v_doc := pg_temp.newdoc('general_liability', NULL, NULL);
  BEGIN
    PERFORM public.contractor_compliance_review_document(
      v_tech, v_doc, 'accepted', NULL, DATE '2026-01-01', DATE '2027-01-01');
    RAISE EXCEPTION 'CASE 11 FAILED: a field_tech accepted a compliance document';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;
  SELECT review_state INTO v_state FROM public.contractor_compliance_documents WHERE id = v_doc;
  IF v_state <> 'pending_review' THEN
    RAISE EXCEPTION 'CASE 11 FAILED: refusal left the row as % — the guard runs AFTER the write', v_state;
  END IF;
  RAISE NOTICE 'CASE 11 PASS: field_tech refused 42501, row untouched';
END; $t11$;

ROLLBACK;
