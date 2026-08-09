-- ════════════════════════════════════════════════
-- ROLLBACK: 20260809010000_job_documents_private_bucket
-- Phase: job-files Privacy Phase 1
-- ════════════════════════════════════════════════
-- Run only after every protected object has been moved back to job-files and
-- every affected row has storage_bucket reset to NULL. Removing the bucket is
-- a separate Storage management API action after it is confirmed empty; direct
-- SQL deletion is rejected by Supabase Storage's ownership guard.

DROP POLICY IF EXISTS job_documents_private_authenticated_read ON storage.objects;
DROP POLICY IF EXISTS job_documents_private_authenticated_delete ON storage.objects;

ALTER TABLE public.job_documents
  DROP COLUMN IF EXISTS storage_bucket;
