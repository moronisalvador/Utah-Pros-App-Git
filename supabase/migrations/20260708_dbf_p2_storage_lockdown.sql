-- ════════════════════════════════════════════════
-- MIGRATION: 20260708_dbf_p2_storage_lockdown.sql
-- DB-Foundation Phase P2 — Storage lockdown stage 1
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops anonymous (not-logged-in) browsers from writing to or deleting from the
--   file-storage buckets. Two things happen:
--     1. The dead `message-attachments` bucket (0 code consumers, 21 orphaned
--        objects) loses all 5 of its access policies — no one can read/write/delete
--        it via the API anymore (service_role, used by workers, is unaffected).
--     2. The live `job-files` bucket keeps working for logged-in techs but loses the
--        anonymous + public WRITE/DELETE policies, which are REPLACED by
--        `authenticated`-scoped WRITE/DELETE policies. Public READ stays (photos/PDFs
--        must keep rendering until P8 moves them behind signed URLs).
--
-- WHY IT IS SAFE (verified, not assumed):
--   Every real browser upload sends the tech's user JWT (role=authenticated) — see
--   src/lib/dispatchers/photoDispatcher.js (`Bearer ${db.apiKey}`) and the 14 write
--   sites the roadmap's R2 challenge confirmed. The old write/delete policies were
--   scoped to PUBLIC + anon (there was NO `authenticated`-only policy), so the PUBLIC
--   policy was what actually carried logged-in techs. Dropping PUBLIC alone would
--   break their uploads — verified LIVE: with only the READ policies left, an
--   authenticated INSERT failed with 42501 (RLS). So this migration RE-GRANTS
--   write/delete to `authenticated` ONLY — the least-privilege floor from
--   database-standard.md §1 — restoring the exact prior authenticated capability
--   (INSERT + DELETE; there was never an UPDATE policy for any role) while removing
--   the anon/public hole. Net effect on a logged-in tech: none. `message-attachments`
--   has ZERO code consumers, so it is fully locked with no replacement policy.
--
-- SCOPE GUARD (hard constraint):
--   This migration touches ONLY policies on `storage.objects`. It NEVER touches any
--   policy in the `public` schema — those anon policies are Phase P3's exclusive
--   domain. Every statement below names `storage.objects` explicitly; the DO block
--   at the end asserts no public-schema policy of these names exists
--   (schemaname='public' is hard-excluded).
--
-- WHAT THIS DOES NOT DO:
--   - Does NOT flip the `job-files` bucket privacy flag (that is P8).
--   - Does NOT flip the `message-attachments` privacy flag or delete its 21 orphaned
--     objects — those are RED-tier and staged separately in
--     supabase/migrations-staged/20260708_dbf_p2_message_attachments_purge.sql
--     (out of the applied set; awaits owner OK).
--   - Does NOT drop the job-files READ policies (`job_files_select`,
--     `anon_read_job_files`) — public READ is preserved (database-standard.md §2).
--
-- ROLLBACK (restore the prior state on storage.objects):
--   -- 1. Drop the authenticated replacements added here:
--   DROP POLICY IF EXISTS "job_files_authenticated_insert" ON storage.objects;
--   DROP POLICY IF EXISTS "job_files_authenticated_delete" ON storage.objects;
--   -- 2. Re-create the dropped anon/public write-delete policies:
--   CREATE POLICY "anon_upload_job_files" ON storage.objects
--     FOR INSERT TO anon WITH CHECK (bucket_id = 'job-files');
--   CREATE POLICY "anon_delete_job_files" ON storage.objects
--     FOR DELETE TO anon USING (bucket_id = 'job-files');
--   CREATE POLICY "job_files_insert" ON storage.objects
--     FOR INSERT WITH CHECK (bucket_id = 'job-files');
--   CREATE POLICY "job_files_delete" ON storage.objects
--     FOR DELETE USING (bucket_id = 'job-files');
--   -- 3. Re-create the message-attachments policies (all PUBLIC role):
--   CREATE POLICY "Auth insert message-attachments" ON storage.objects
--     FOR INSERT WITH CHECK (bucket_id = 'message-attachments');
--   CREATE POLICY "Public read message-attachments" ON storage.objects
--     FOR SELECT USING (bucket_id = 'message-attachments');
--   CREATE POLICY "message_attachments_insert" ON storage.objects
--     FOR INSERT WITH CHECK (bucket_id = 'message-attachments');
--   CREATE POLICY "message_attachments_select" ON storage.objects
--     FOR SELECT USING (bucket_id = 'message-attachments');
--   CREATE POLICY "message_attachments_delete" ON storage.objects
--     FOR DELETE USING (bucket_id = 'message-attachments');
-- ════════════════════════════════════════════════

-- ── message-attachments: drop all 5 bucket-scoped policies (dead bucket) ──
DROP POLICY IF EXISTS "Auth insert message-attachments"  ON storage.objects;
DROP POLICY IF EXISTS "Public read message-attachments"  ON storage.objects;
DROP POLICY IF EXISTS "message_attachments_insert"       ON storage.objects;
DROP POLICY IF EXISTS "message_attachments_select"       ON storage.objects;
DROP POLICY IF EXISTS "message_attachments_delete"       ON storage.objects;

-- ── job-files: revoke anon + public WRITE/DELETE; KEEP the READ policies ──
-- anon_* TO anon pair (write/delete):
DROP POLICY IF EXISTS "anon_upload_job_files" ON storage.objects;
DROP POLICY IF EXISTS "anon_delete_job_files" ON storage.objects;
-- job_files_* TO public pair (write/delete):
DROP POLICY IF EXISTS "job_files_insert"      ON storage.objects;
DROP POLICY IF EXISTS "job_files_delete"      ON storage.objects;
-- KEPT (do not drop): "job_files_select" (public READ), "anon_read_job_files" (anon READ).

-- ── job-files: RE-GRANT write/delete to `authenticated` ONLY ──
-- (Replaces the PUBLIC policies that were silently carrying logged-in techs, so
--  real browser uploads keep working; anon/public can no longer write or delete.)
DROP POLICY IF EXISTS "job_files_authenticated_insert" ON storage.objects;
CREATE POLICY "job_files_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'job-files');

DROP POLICY IF EXISTS "job_files_authenticated_delete" ON storage.objects;
CREATE POLICY "job_files_authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'job-files');

-- ── Scope-guard assertions (fail loudly if the intent was violated) ──
DO $$
DECLARE
  v_public_leak int;
  v_job_read    int;
  v_job_auth_wr int;
BEGIN
  -- Hard-exclude the public schema: this migration must have changed NO public-schema
  -- policy. (Storage policies live in the `storage` schema; a public-schema policy of
  -- any of these names would mean the wrong object was touched — P3's domain.)
  SELECT count(*) INTO v_public_leak
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'Auth insert message-attachments','Public read message-attachments',
      'message_attachments_insert','message_attachments_select','message_attachments_delete',
      'anon_upload_job_files','anon_delete_job_files','job_files_insert','job_files_delete',
      'job_files_authenticated_insert','job_files_authenticated_delete'
    );
  IF v_public_leak > 0 THEN
    RAISE EXCEPTION 'Scope violation: % public-schema policy(ies) match P2 names — public schema is P3''s domain', v_public_leak;
  END IF;

  -- Read must be preserved on job-files (public + anon READ policies still present).
  SELECT count(*) INTO v_job_read
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('job_files_select','anon_read_job_files');
  IF v_job_read < 2 THEN
    RAISE EXCEPTION 'Read-preservation check failed: expected 2 job-files READ policies, found %', v_job_read;
  END IF;

  -- Authenticated write path must exist (so logged-in tech uploads keep working).
  SELECT count(*) INTO v_job_auth_wr
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('job_files_authenticated_insert','job_files_authenticated_delete');
  IF v_job_auth_wr < 2 THEN
    RAISE EXCEPTION 'Auth-write check failed: expected 2 authenticated write policies, found %', v_job_auth_wr;
  END IF;
END $$;
