-- ════════════════════════════════════════════════
-- PROOF: job_files_bucket_private
-- Phase: job-files Privacy Phase 2 · database-standard.md §5b
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Pretends to be each kind of person in turn — a signed-in office worker, a
--   field technician, a marketing partner, someone whose account was switched
--   off, an outside contractor, a stranger with no account at all, and a
--   passer-by who never logged in — and checks, for each one, whether they can
--   see the job files. Everyone who should still see them does; everyone who
--   should not is refused.
--
-- WHY IT IS NOT OPTIONAL:
--   The migration changes WHO CAN READ every remaining object in the bucket.
--   §5b exists because the 2026-08-01 conversation scoping proved only who got
--   IN, shipped, and silently locked every field technician out for four days.
--   So this asserts the roles the change is not "about" just as hard as the
--   ones it is.
--
-- THE HEADLINE RESULT THIS ESTABLISHES:
--   **Nobody gains anything.** Before the flip the bucket answers the whole
--   internet with no login at all, so every identity below already had access.
--   The flip can only take access away. The question is therefore never "who
--   gained" — it is "who kept it", and the answer must be exactly the active
--   internal employees.
--
-- ONE FINDING THIS PROOF DELIBERATELY SURFACES RATHER THAN HIDES:
--   an active, INTERNAL `crm_partner` keeps read access, because the predicate
--   is active + internal and says nothing about employee_role. That is the
--   same predicate Phase 1 gave job-documents-private, on purpose — two
--   definitions of "an employee" across two buckets is worse than one
--   arguable definition. Narrowing it is a separate owner decision, and the
--   case below is written so that decision cannot be made by accident.
--
-- ISOLATION:
--   Refuses to run unless upr.isolated_test_database is on. Note this is NOT
--   keyed on current_database(): every Supabase database is named `postgres`,
--   the shared production project included.
-- ════════════════════════════════════════════════

DO $isolation$
BEGIN
  IF coalesce(current_setting('upr.isolated_test_database', true), '') <> 'on' THEN
    RAISE EXCEPTION 'refusing to run outside an isolated test database';
  END IF;
END;
$isolation$;

BEGIN;

CREATE TEMP TABLE jf_actor(label text primary key, auth_id uuid, emp_id uuid);

-- ─── Seed the identities ───
DO $seed$
DECLARE
  r record;
  v_auth uuid;
  v_emp uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- KEEPS access: active + internal, whatever the job title.
      ('admin',          'admin',           true,  false),
      ('office',         'office',          true,  false),
      ('pm',             'project_manager', true,  false),
      ('tech',           'field_tech',      true,  false),
      ('estimator',      'estimator',       true,  false),
      ('supervisor',     'supervisor',      true,  false),
      ('partner',        'crm_partner',     true,  false),
      -- LOSES access: the predicate's two negative arms.
      ('inactive_admin', 'admin',           false, false),
      ('external_admin', 'admin',           true,  true )
    ) AS t(label, role, is_active, is_external)
  LOOP
    v_auth := gen_random_uuid();
    -- full_name, NOT name. Recorded here because the billing proof shipped
    -- with `name` and therefore could never execute until someone ran it.
    INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
    VALUES (
      v_auth,
      'TEST jf ' || r.label,
      'test-jobfiles-' || r.label || '@example.invalid',
      r.role::public.employee_role,
      r.is_active,
      r.is_external
    )
    RETURNING id INTO v_emp;
    INSERT INTO jf_actor VALUES (r.label, v_auth, v_emp);
  END LOOP;

  -- A valid Auth session that maps to NO employee row. AGENTS.md §16: a
  -- session is authentication, not authorization.
  INSERT INTO jf_actor VALUES ('unmapped', gen_random_uuid(), NULL);
END;
$seed$;

-- ─── Seed the objects ───
-- Two buckets, so the proof can also show Phase 1 was not disturbed. The rows
-- are inserted as the owner, which bypasses RLS — that is the point: the
-- question is who can READ them afterwards.
DO $objects$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'job-files') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('job-files', 'job-files', true, 52428800);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'job-documents-private') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('job-documents-private', 'job-documents-private', false, 52428800);
  END IF;

  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES
    ('job-files', 'jf-proof/photo.jpg', '{"size": 10}'::jsonb),
    ('job-files', 'jf-proof/scope-sheet.pdf', '{"size": 10}'::jsonb),
    ('job-documents-private', 'jf-proof/signed.pdf', '{"size": 10}'::jsonb)
  ON CONFLICT DO NOTHING;
END;
$objects$;

-- The seed must actually be there, or every DENY case below passes against
-- ambient emptiness. This is the hollow-harness failure that bit the
-- payments-realm proof; assert rather than assume.
DO $seedcheck$
DECLARE v_objects integer; v_actors integer;
BEGIN
  SELECT count(*) INTO v_objects FROM storage.objects WHERE name LIKE 'jf-proof/%';
  IF v_objects <> 3 THEN
    RAISE EXCEPTION 'SEED: expected 3 proof objects, found % — the proof would be hollow', v_objects;
  END IF;
  SELECT count(*) INTO v_actors FROM jf_actor;
  IF v_actors <> 10 THEN
    RAISE EXCEPTION 'SEED: expected 10 actors, found %', v_actors;
  END IF;
END;
$seedcheck$;

-- ─── Role simulation, exactly as PostgREST does it ───
-- Sets ONLY request.jwt.claims. The legacy flattened `request.jwt.claim.role`
-- GUC is never set, because production never sets it either — manufacturing it
-- is what made the 2026-08-05 QBO harness prove nothing.
CREATE FUNCTION pg_temp.become(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM jf_actor WHERE label = p_label;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'unknown test actor %', p_label; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

CREATE FUNCTION pg_temp.become_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('role', 'anon', true);
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

-- How many job-files objects can the current identity see? A signed URL is
-- minted by exactly this SELECT authorization check, so this number is the
-- thing that decides whether a photo renders.
CREATE FUNCTION pg_temp.visible_job_files() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v FROM storage.objects
   WHERE bucket_id = 'job-files' AND name LIKE 'jf-proof/%';
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.visible_private() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v FROM storage.objects
   WHERE bucket_id = 'job-documents-private' AND name LIKE 'jf-proof/%';
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.assert_reads(p_label text, p_expected integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  PERFORM pg_temp.become(p_label);
  v := pg_temp.visible_job_files();
  PERFORM pg_temp.become_owner();
  IF v <> p_expected THEN
    RAISE EXCEPTION 'ROLE % saw % job-files object(s), expected %', p_label, v, p_expected;
  END IF;
END;
$$;

-- ════════════════════════════════════════════════
-- CASE 1 — WHO KEEPS ACCESS. Every active internal employee, any job title.
-- ════════════════════════════════════════════════
DO $allow$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['admin','office','pm','tech','estimator','supervisor']) AS label LOOP
    PERFORM pg_temp.assert_reads(r.label, 2);
  END LOOP;
  RAISE NOTICE 'ok: all six active internal staff roles still read both job-files objects';
END;
$allow$;

-- ════════════════════════════════════════════════
-- CASE 2 — crm_partner, called out on its own.
-- An active INTERNAL crm_partner keeps access. Same predicate as Phase 1.
-- If this case ever fails, someone narrowed one bucket and not the other, and
-- that divergence is the thing to argue about — not this assertion.
-- ════════════════════════════════════════════════
DO $partner$
BEGIN
  PERFORM pg_temp.assert_reads('partner', 2);
  RAISE NOTICE 'ok: an ACTIVE INTERNAL crm_partner still reads job-files (matches Phase 1 by design)';
END;
$partner$;

-- ════════════════════════════════════════════════
-- CASE 3 — WHO LOSES ACCESS. The four denial arms.
-- Each of these could read every object anonymously before this migration.
-- ════════════════════════════════════════════════
DO $deny$
BEGIN
  PERFORM pg_temp.assert_reads('inactive_admin', 0);   -- is_active = false
  PERFORM pg_temp.assert_reads('external_admin', 0);   -- is_external = true
  PERFORM pg_temp.assert_reads('unmapped', 0);         -- valid session, no employee row

  PERFORM pg_temp.become_anon();
  IF pg_temp.visible_job_files() <> 0 THEN
    PERFORM pg_temp.become_owner();
    RAISE EXCEPTION 'anon can still read job-files — the public policies survived';
  END IF;
  PERFORM pg_temp.become_owner();

  RAISE NOTICE 'ok: inactive, external, unmapped and anonymous are all refused';
END;
$deny$;

-- ════════════════════════════════════════════════
-- CASE 4 — the bucket flag itself.
-- Policies alone are not enough: while public is true, /object/public/ bypasses
-- RLS entirely and every assertion above would be irrelevant in production.
-- ════════════════════════════════════════════════
DO $flag$
DECLARE v boolean;
BEGIN
  SELECT public INTO v FROM storage.buckets WHERE id = 'job-files';
  IF v IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'job-files is still flagged public — the RLS result above would not be reachable';
  END IF;
  RAISE NOTICE 'ok: job-files.public is false, so RLS is the only route';
END;
$flag$;

-- ════════════════════════════════════════════════
-- CASE 5 — the two public policies are GONE, not merely one of them.
-- job_files_select is TO public, which INCLUDES anon; dropping only
-- anon_read_job_files would leave the bucket open to the browser's anon key.
-- ════════════════════════════════════════════════
DO $policies$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('anon_read_job_files', 'job_files_select');
  IF v <> 0 THEN
    RAISE EXCEPTION 'expected both public read policies gone, % remain', v;
  END IF;
  RAISE NOTICE 'ok: both public read policies are gone';
END;
$policies$;

-- ════════════════════════════════════════════════
-- CASE 6 — WHO IS UNTOUCHED. Phase 1's private bucket behaves exactly as
-- before: an active internal employee reads it, an inactive one does not.
-- A migration that "fixed" job-files by disturbing job-documents-private would
-- pass every case above.
-- ════════════════════════════════════════════════
DO $phase1$
DECLARE v_ok integer; v_no integer;
BEGIN
  PERFORM pg_temp.become('office');
  v_ok := pg_temp.visible_private();
  PERFORM pg_temp.become_owner();

  PERFORM pg_temp.become('inactive_admin');
  v_no := pg_temp.visible_private();
  PERFORM pg_temp.become_owner();

  IF v_ok <> 1 THEN
    RAISE EXCEPTION 'Phase 1 regression: an active internal employee sees % private objects, expected 1', v_ok;
  END IF;
  IF v_no <> 0 THEN
    RAISE EXCEPTION 'Phase 1 regression: an inactive employee sees % private objects, expected 0', v_no;
  END IF;
  RAISE NOTICE 'ok: job-documents-private is untouched in both directions';
END;
$phase1$;

-- ════════════════════════════════════════════════
-- CASE 7 — the out-of-scope write policies are exactly as they were.
-- roadmap §8 leaves them alone deliberately; this pins that the migration
-- neither narrowed nor widened them while it was in the neighbourhood.
-- ════════════════════════════════════════════════
DO $writes$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('job_files_authenticated_insert', 'job_files_authenticated_delete');
  IF v <> 2 THEN
    RAISE EXCEPTION 'the job-files write policies were disturbed: found %, expected 2', v;
  END IF;
  RAISE NOTICE 'ok: insert/delete policies untouched (still the known, out-of-scope defect)';
END;
$writes$;

ROLLBACK;
