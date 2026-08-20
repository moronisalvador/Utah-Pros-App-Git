-- ════════════════════════════════════════════════
-- ROLLBACK: 20260820010000_job_files_bucket_private
-- Phase: job-files Privacy Phase 2
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the job-files store back the way it was: readable by anybody with the
--   address, no login required.
--
-- ⚠ THIS RE-OPENS THE EXPOSURE ON PURPOSE. It is not a cleanup script and it
--   is not a state to leave the system in. Its only legitimate use is inside
--   an apply window where the forward migration broke a reader that was
--   supposed to have been migrated — the deployed bundle turned out to be
--   older than believed, say — and staff need their photos back within
--   minutes. The right sequence afterwards is: fix and deploy the reader,
--   verify it, then re-apply the forward migration. Do not run this and stop.
--
--   The rollback restores the two dropped policies byte-for-byte from the live
--   definitions captured on 2026-08-19:
--     anon_read_job_files  SELECT TO anon    USING (bucket_id = 'job-files')
--     job_files_select     SELECT TO public  USING (bucket_id = 'job-files')
--
--   It also removes job_files_authenticated_read. That is deliberate: leaving
--   it would be harmless in effect (it is strictly narrower than the public
--   policies being restored) but it would make a later re-apply fail on
--   "policy already exists" — a re-apply during an incident is exactly when a
--   surprising error costs the most.
--
-- public: restoring the named temporary `public job-file READ` exception from
--   database-standard.md §2 — the same exception the forward migration closes.
--   This marker exists because this file re-grants `anon`; do not read it as
--   an argument that anon SHOULD be granted.
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS job_files_authenticated_read ON storage.objects;

CREATE POLICY anon_read_job_files
  ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'job-files');

CREATE POLICY job_files_select
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'job-files');

UPDATE storage.buckets SET public = true WHERE id = 'job-files';

-- ─── Postconditions: prove the re-opening actually took effect ───
-- An incident rollback that silently half-applied would be worse than none:
-- staff would still see broken images and nobody would know which layer failed.
DO $postcheck$
DECLARE
  v_public boolean;
  v_restored integer;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'job-files';
  IF v_public IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ROLLBACK POSTCHECK: job-files is not public again';
  END IF;

  SELECT count(*) INTO v_restored
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('anon_read_job_files', 'job_files_select');
  IF v_restored <> 2 THEN
    RAISE EXCEPTION 'ROLLBACK POSTCHECK: expected 2 restored read policies, found %', v_restored;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'job_files_authenticated_read'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK POSTCHECK: job_files_authenticated_read survived — a re-apply would fail';
  END IF;

  -- Phase 1 must be unaffected in both directions.
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'job-documents-private' AND public IS FALSE
  ) THEN
    RAISE EXCEPTION 'ROLLBACK POSTCHECK: the Phase 1 private bucket was disturbed';
  END IF;
END;
$postcheck$;
