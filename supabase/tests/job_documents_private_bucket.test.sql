-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: job_documents_private_bucket.test.sql
-- Phase: job-files Privacy Phase 1
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES (plain language): On an isolated local database only, proves
-- protected signed documents are visible to an active internal employee, while
-- anonymous, unmapped, inactive, and external identities fail. Storage's own
-- deletion guard prevents direct SQL DELETE tests; the matching DELETE policy
-- is exercised over the Storage API in the qa-staging R1 role receipt.
-- DEPENDS ON: 20260809010000_job_documents_private_bucket.sql
-- NOTES / GOTCHAS: Never run against qa-staging or the shared UPR project.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing job document privacy test: isolated database guard missing';
  END IF;
  IF current_database() = 'glsmljpabrwonfiltiqm' THEN
    RAISE EXCEPTION 'refusing job document privacy test on shared database';
  END IF;
END;
$guard$;

BEGIN;

INSERT INTO public.employees (
  id, full_name, role, is_active, is_external, auth_user_id
) VALUES
  ('81000000-0000-4000-8000-000000000001', 'Private Docs Active', 'field_tech', true, false, '82000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002', 'Private Docs Inactive', 'office', false, false, '82000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-000000000003', 'Private Docs External', 'office', true, true, '82000000-0000-4000-8000-000000000003');

INSERT INTO storage.objects (id, bucket_id, name, owner)
VALUES
  ('83000000-0000-4000-8000-000000000001', 'job-documents-private', 'synthetic/active.pdf', '82000000-0000-4000-8000-000000000001'),
  ('83000000-0000-4000-8000-000000000002', 'job-documents-private', 'synthetic/denied.pdf', '82000000-0000-4000-8000-000000000001');

SET LOCAL ROLE anon;
DO $anon_denied$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'job-documents-private') THEN
    RAISE EXCEPTION 'anonymous role read a protected job document';
  END IF;
END;
$anon_denied$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"82000000-0000-4000-8000-000000000099"}', true);
DO $unmapped_denied$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'job-documents-private') THEN
    RAISE EXCEPTION 'unmapped authenticated identity read a protected job document';
  END IF;
END;
$unmapped_denied$;

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"82000000-0000-4000-8000-000000000002"}', true);
DO $inactive_denied$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'job-documents-private') THEN
    RAISE EXCEPTION 'inactive employee read a protected job document';
  END IF;
END;
$inactive_denied$;

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"82000000-0000-4000-8000-000000000003"}', true);
DO $external_denied$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'job-documents-private') THEN
    RAISE EXCEPTION 'external employee read a protected job document';
  END IF;
END;
$external_denied$;

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"82000000-0000-4000-8000-000000000001"}', true);
DO $active_allowed$
BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'job-documents-private') <> 2 THEN
    RAISE EXCEPTION 'active internal employee could not read protected job documents';
  END IF;
END;
$active_allowed$;

ROLLBACK;
