-- ════════════════════════════════════════════════
-- MIGRATION: 20260809010000_job_documents_private_bucket
-- Phase: job-files Privacy Phase 1
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a protected home for signed customer documents and records which home
--   each document uses. Existing documents remain unchanged and continue using
--   job-files until each object is moved in a separately approved operation.
--
-- ADDITIVE-ONLY:
--   Adds one nullable column, one private bucket, and two bucket-scoped policies;
--   no table DROP/RENAME, existing-column change, data change, or object move.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Apply supabase/rollbacks/20260809010000_job_documents_private_bucket.rollback.sql.
--   It drops the policies and column. After confirming the bucket is empty, the
--   bucket itself is removed through the Storage management API because direct
--   SQL deletion is blocked by Supabase Storage's ownership guard.
-- ════════════════════════════════════════════════

ALTER TABLE public.job_documents
  ADD COLUMN IF NOT EXISTS storage_bucket text;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('job-documents-private', 'job-documents-private', false, 52428800)
ON CONFLICT (id) DO NOTHING;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'job-documents-private'
      AND name = 'job-documents-private'
      AND public IS FALSE
      AND file_size_limit = 52428800
  ) THEN
    RAISE EXCEPTION 'job-documents-private exists with unexpected settings';
  END IF;
END;
$migration$;

-- Browser URL minting performs a SELECT authorization check. R1 proved this
-- exact authenticated-only policy from a real qa-staging browser session.
CREATE POLICY job_documents_private_authenticated_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'job-documents-private');

-- The signing worker uploads with service_role. Only the existing JobPage
-- browser delete path needs a write policy in this phase.
CREATE POLICY job_documents_private_authenticated_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'job-documents-private');
