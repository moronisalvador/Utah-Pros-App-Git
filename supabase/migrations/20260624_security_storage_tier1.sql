-- UPR security hardening: storage Tier-1. Remove anon/public; scope to authenticated.
-- Buckets stay public=true so existing public-URL photo display keeps working.
-- (Full private+signed-URL lock deferred to a later phase.)

BEGIN;
-- Drop all current job-files / message-attachments policies
DROP POLICY IF EXISTS "Auth insert message-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Public read message-attachments" ON storage.objects;
DROP POLICY IF EXISTS anon_delete_job_files ON storage.objects;
DROP POLICY IF EXISTS anon_read_job_files ON storage.objects;
DROP POLICY IF EXISTS anon_upload_job_files ON storage.objects;
DROP POLICY IF EXISTS job_files_delete ON storage.objects;
DROP POLICY IF EXISTS job_files_insert ON storage.objects;
DROP POLICY IF EXISTS job_files_select ON storage.objects;
DROP POLICY IF EXISTS message_attachments_delete ON storage.objects;
DROP POLICY IF EXISTS message_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS message_attachments_select ON storage.objects;

-- Recreate non-anon policies as authenticated (anon ones intentionally dropped)
CREATE POLICY "Auth insert message-attachments" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'message-attachments'::text));
CREATE POLICY "Public read message-attachments" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'message-attachments'::text));
CREATE POLICY job_files_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = 'job-files'::text));
CREATE POLICY job_files_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'job-files'::text));
CREATE POLICY job_files_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'job-files'::text));
CREATE POLICY message_attachments_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = 'message-attachments'::text));
CREATE POLICY message_attachments_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'message-attachments'::text));
CREATE POLICY message_attachments_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'message-attachments'::text));
COMMIT;
