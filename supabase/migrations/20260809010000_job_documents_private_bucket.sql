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
--   Adds one nullable column, one private bucket, two employee-scoped policies,
--   and one service-only completion wrapper;
--   no table DROP/RENAME, existing-column change, data change, or object move.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Apply supabase/rollbacks/20260809010000_job_documents_private_bucket.rollback.sql.
--   It drops the completion wrapper, policies and column. After confirming the bucket is empty, the
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

-- Browser URL minting performs a SELECT authorization check. R1 proved the
-- browser mechanism; the employee predicate prevents bare Auth accounts from
-- becoming UPR employees merely by possessing a valid session.
CREATE POLICY job_documents_private_authenticated_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'job-documents-private'
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );

-- The signing worker uploads with service_role. Only the existing JobPage
-- browser delete path needs a write policy in this phase.
CREATE POLICY job_documents_private_authenticated_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'job-documents-private'
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );

-- The deployed completion RPC creates job_documents without knowing about the
-- new bucket column. This new-named wrapper preserves every existing signature
-- and makes completion + bucket assignment one Postgres transaction.
CREATE FUNCTION public.complete_sign_request_with_private_storage(
  p_token uuid,
  p_signer_name text,
  p_signer_ip text,
  p_signed_file_path text,
  p_consent_terms boolean DEFAULT NULL,
  p_consent_commitment boolean DEFAULT NULL,
  p_consent_esign boolean DEFAULT NULL,
  p_consent_authority boolean DEFAULT NULL,
  p_sms_disclosure_version text DEFAULT NULL,
  p_sms_disclosure_sha256 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_updated integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'NOT_AUTHORIZED';
  END IF;

  v_result := public.complete_sign_request_with_work_authorization_sms_consent(
    p_token,
    p_signer_name,
    p_signer_ip,
    p_signed_file_path,
    p_consent_terms,
    p_consent_commitment,
    p_consent_esign,
    p_consent_authority,
    p_sms_disclosure_version,
    p_sms_disclosure_sha256
  );

  IF v_result IS NULL OR v_result ? 'error' THEN
    RETURN v_result;
  END IF;

  UPDATE public.job_documents
  SET storage_bucket = 'job-documents-private'
  WHERE id = (v_result ->> 'job_document_id')::uuid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'SIGNED_DOCUMENT_BUCKET_ASSIGNMENT_FAILED';
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_sign_request_with_private_storage(
  uuid, text, text, text, boolean, boolean, boolean, boolean, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sign_request_with_private_storage(
  uuid, text, text, text, boolean, boolean, boolean, boolean, text, text
) TO service_role;
