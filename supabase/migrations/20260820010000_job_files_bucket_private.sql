-- ════════════════════════════════════════════════
-- MIGRATION: 20260820010000_job_files_bucket_private
-- Phase: job-files Privacy Phase 2
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Closes the last publicly-readable file store. Until now, anybody who knew
--   or guessed the address of a job photo, scope sheet, Xactimate file or
--   report could open it with no login at all. After this, those files are
--   readable only by an active internal UPR employee who is signed in, and the
--   app asks for a short-lived link each time it needs to show one.
--
--   This is the last of the three steps. Phase 1 moved the signed customer
--   documents to a private bucket; the application code stopped building
--   public addresses before this migration was written. This step removes the
--   permission that made the old addresses work.
--
-- NOT ADDITIVE — and this is the point of the change:
--   destructive-approved: owner-authorized closure of the `public job-file
--   READ` exception in database-standard.md §2. It drops the two SELECT
--   policies that allow anonymous and unauthenticated reads of `job-files`,
--   and flips the bucket's `public` flag to false. No table, column, index,
--   trigger, function, grant or row is touched, and no storage object moves.
--   The INSERT and DELETE policies are deliberately left exactly as they are
--   (see the note on them below).
--
-- ⚠ ACCESS-PREDICATE CHANGE — database-standard.md §5b applies.
--   This changes who can read every remaining object in the bucket, so it
--   requires a behavioural proof with per-role ALLOW **and** DENY cases,
--   including roles the change is not "about". That proof is
--   scripts/qa/qualify-job-files-private-local.mjs and it MUST have been
--   executed on a disposable local stack before this is applied. A static
--   contract test is not a substitute.
--
-- ⚠ DEPLOY ORDER — CODE FIRST, then this. The inverse of the usual rule.
--   Every reader must already be minting signed URLs in the deployed bundle
--   before the public route stops answering. Applying this against an older
--   deployed bundle breaks every job photo, report and Xactimate link at once.
--   Verify the deployed bundle contains no `object/public/job-files` string
--   before entering the window.
--
-- ⚠ PREREQUISITE THIS FILE CANNOT ENFORCE — the R4 soak.
--   functions/lib/message-media.js still has one legacy branch that hands
--   Twilio a PUBLIC job-files URL for outbound MMS, and it logs
--   `JOB_FILES_LEGACY_PUBLIC_MMS` whenever it runs. Do not apply this until a
--   soak window has passed with zero hits. The failure mode is a customer not
--   receiving a picture, which nobody reports.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Apply supabase/rollbacks/20260820010000_job_files_bucket_private.rollback.sql.
--   It restores `anon_read_job_files` and `job_files_select` byte-for-byte and
--   sets the bucket public again — i.e. it deliberately RE-OPENS the exposure.
--   That is the correct undo (it is what makes this reversible in a window),
--   and it is not a state to leave the system in.
-- ════════════════════════════════════════════════

-- ─── Preflight drift guard ───
-- Abort with SQLSTATE 55000 and change nothing unless the live catalog is in
-- exactly the state this migration was reviewed against. Two sessions have
-- already shipped a migration that assumed a body/policy it never verified.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'job-files' AND public IS TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'job-files is not public — already applied, or the catalog drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'anon_read_job_files' AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'anon_read_job_files is missing — the reviewed starting state is gone';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'job_files_select' AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'job_files_select is missing — the reviewed starting state is gone';
  END IF;

  -- The private bucket must already exist and hold the signed documents:
  -- Phase 1 is a hard prerequisite, not a coincidence of ordering.
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'job-documents-private' AND public IS FALSE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'job-documents-private is absent — Phase 1 has not been applied';
  END IF;
END;
$guard$;

-- ─── 1. Open the employee route BEFORE closing the public one ───
-- Created first, on purpose. A signed URL is minted by a SELECT authorization
-- check, so if the old policies were dropped first there would be a window in
-- which no employee could mint anything. The predicate is copied from Phase 1's
-- job_documents_private_authenticated_read so both buckets answer to exactly
-- one definition of "an employee": active, internal, and mapped to a real
-- employees row. A valid Auth session alone is authentication, not
-- authorization (AGENTS.md §16).
CREATE POLICY job_files_authenticated_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'job-files'
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );

-- ─── 2. Close the public route ───
-- `anon_read_job_files` grants SELECT to `anon` outright. `job_files_select`
-- grants it to `public`, which INCLUDES anon — so dropping only one of them
-- leaves the bucket readable by the anon key that ships in the browser bundle.
-- Both must go, and flipping the bucket flag alone would not be enough.
DROP POLICY IF EXISTS anon_read_job_files ON storage.objects;
DROP POLICY IF EXISTS job_files_select ON storage.objects;

-- NOT TOUCHED, deliberately: job_files_authenticated_insert and
-- job_files_authenticated_delete. Both are bucket-wide with no further
-- predicate, so any authenticated identity can still write or delete any
-- object here. That is a real pre-existing defect, it is listed as out of
-- scope in docs/job-files-privacy-roadmap.md §8, and narrowing it is its own
-- reviewed change. Widening the blast radius of a privacy migration to fix an
-- adjacent bug is how a security change ships a security bug.

-- ─── 3. Flip the bucket ───
-- With the flag false, /object/public/job-files/... stops answering (400) and
-- every read goes through /object/sign/... or /object/... where RLS applies.
UPDATE storage.buckets SET public = false WHERE id = 'job-files';

-- ─── Postconditions ───
DO $postcheck$
DECLARE
  v_public boolean;
  v_old integer;
  v_new integer;
  v_write integer;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'job-files';
  IF v_public IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'POSTCHECK: job-files is still public';
  END IF;

  SELECT count(*) INTO v_old
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('anon_read_job_files', 'job_files_select');
  IF v_old <> 0 THEN
    RAISE EXCEPTION 'POSTCHECK: % public-read policy/policies survived', v_old;
  END IF;

  SELECT count(*) INTO v_new
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'job_files_authenticated_read'
    AND cmd = 'SELECT'
    AND roles::text = '{authenticated}'
    AND qual LIKE '%is_active%'
    AND qual LIKE '%is_external%';
  IF v_new <> 1 THEN
    RAISE EXCEPTION 'POSTCHECK: the employee read policy is missing or not employee-scoped';
  END IF;

  -- The out-of-scope write policies must be exactly as they were: this
  -- migration neither narrows nor widens them.
  SELECT count(*) INTO v_write
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('job_files_authenticated_insert', 'job_files_authenticated_delete');
  IF v_write <> 2 THEN
    RAISE EXCEPTION 'POSTCHECK: the job-files write policies were disturbed (found %)', v_write;
  END IF;

  -- Phase 1's private bucket must be untouched by this migration.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'job_documents_private_authenticated_read'
  ) THEN
    RAISE EXCEPTION 'POSTCHECK: the Phase 1 private-read policy is gone';
  END IF;
END;
$postcheck$;
