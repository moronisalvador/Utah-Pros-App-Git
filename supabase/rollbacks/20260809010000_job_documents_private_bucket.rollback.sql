-- ════════════════════════════════════════════════
-- ROLLBACK: 20260809010000_job_documents_private_bucket
-- Phase: job-files Privacy Phase 1
-- ════════════════════════════════════════════════
-- Ordered rollback: first move every protected object back to job-files and
-- reset each affected row to NULL; next deploy the pre-Phase-1 worker and both
-- pre-Phase-1 document readers and verify they no longer select/write this
-- column; only then apply this SQL. Finally remove the confirmed-empty bucket
-- through the Storage management API. Direct SQL bucket deletion is rejected
-- by Supabase Storage's ownership guard.

DROP FUNCTION IF EXISTS public.complete_sign_request_with_private_storage(
  uuid, text, text, text, boolean, boolean, boolean, boolean, text, text
);

DROP POLICY IF EXISTS job_documents_private_authenticated_read ON storage.objects;
DROP POLICY IF EXISTS job_documents_private_authenticated_delete ON storage.objects;

ALTER TABLE public.job_documents
  DROP COLUMN IF EXISTS storage_bucket;
