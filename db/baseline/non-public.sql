-- ════════════════════════════════════════════════
-- FILE: db/baseline/non-public.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   The main baseline file (schema.sql) only covers the "public" part of the
--   real database. This companion file carries the rest of what Utah Pros has
--   configured there: the four file-storage buckets, the six rules saying who
--   may read or write files, and the fifteen scheduled background jobs. With
--   it loaded, a practice run on a throwaway local database sees the same
--   storage and scheduling setup production has — instead of a hand-typed
--   reconstruction that could silently be wrong.
--
-- CAPTURED: 2026-08-20, read-only, from the live project catalog
--   (storage.buckets, pg_policies WHERE schemaname='storage', cron.job).
--   Regenerate with the query in scripts/db-nonpublic-capture.sql and rewrite
--   this file to match; record the new date here AND in
--   db/baseline/captured.json. Machine-verified content; do not hand-edit
--   the values without a fresh capture.
--
-- CONTAINS NO CUSTOMER DATA — and must never. Bucket definitions, access
--   policies and cron schedules are configuration. The cron commands read
--   their secrets from integration_config at RUNTIME; no secret value appears
--   here (scripts/check-l0-bridge is not the guard for this file — the guard
--   is the capture query, which selects only catalog/config columns).
--
-- DEPENDS ON:
--   Internal:  db/baseline/schema.sql must load FIRST (two storage policies
--              reference public.employees).
--   Loader:    scripts/db-local-bootstrap.mjs bundles this between the schema
--              and the fixtures; qualifiers load it right after the baseline.
--   Roles:     CREATE POLICY on storage.objects needs supabase_storage_admin
--              membership — the loader grants it to postgres for the load and
--              revokes it after (the pattern proven by
--              scripts/qa/qualify-job-files-private-local.mjs).
--
-- NOTES / GOTCHAS:
--   - REFUSES TO RUN outside a local stack (same guard as qa-fixtures.sql).
--     The `upr.local_stack` setting is injected by the loader, never
--     committed, so no file in this repository can satisfy the guard against
--     a hosted project.
--   - ONE DELIBERATE DIVERGENCE FROM PRODUCTION: every cron job is loaded
--     DEACTIVATED (production has all 15 active). The captured commands POST
--     to https://utahpros.app workers and wake pg_net notifiers; a local
--     stack firing those every 5 minutes would hammer production endpoints
--     from a laptop. The job rows, names, schedules and command text are
--     byte-faithful so cron.unschedule()/alter_job() and command asserts test
--     against the real definitions; only `active` differs. A migration that
--     asserts `active = true` for an existing job will fail locally on
--     purpose — that assert is about live behaviour, which is owner territory.
--   - THE CRON SECTION SKIPS (with a loud WARNING) when pg_cron is absent.
--     The bootstrap installs pg_cron and then VERIFIES all 15 jobs landed, so
--     a skip cannot pass silently through `npm run db:local`. Disposable
--     qualifier stacks that never install pg_cron (e.g. the job-files one,
--     which only needs storage) tolerate the skip by design.
--   - Cron commands reference functions (wake_*, qbo_payments_sync_poll,
--     contractor_compliance_reminder_poll) that may be missing from a stale
--     schema.sql — pg_cron does not validate command text at schedule time,
--     so loading still succeeds. The drift check owns flagging the staleness.
-- ════════════════════════════════════════════════

DO $$
BEGIN
  IF current_setting('upr.local_stack', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'REFUSING TO LOAD: upr.local_stack is not ''on''. This file reconstructs local catalog state and must never run against a hosted project.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- ─── SECTION: storage buckets ──────────────
-- The four live buckets, verbatim. job-files public=true is NOT a mistake:
-- it reproduces today's live exposure so the migration that closes it
-- (20260820010000_job_files_bucket_private) has something real to close.
-- Delete that flag here only when the live bucket flips.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('contractor-compliance-private', 'contractor-compliance-private', false, 6291456,
   ARRAY['application/pdf','image/jpeg','image/png']),
  ('job-documents-private', 'job-documents-private', false, 52428800, NULL),
  ('job-files', 'job-files', true, 52428800, NULL),
  ('message-attachments', 'message-attachments', false, 10485760,
   ARRAY['image/jpeg','image/png','image/heic','image/webp','application/pdf','video/mp4','video/quicktime'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── SECTION: storage.objects policies ──────────────
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_job_files ON storage.objects;
CREATE POLICY anon_read_job_files ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'job-files');

DROP POLICY IF EXISTS job_files_select ON storage.objects;
CREATE POLICY job_files_select ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'job-files');

DROP POLICY IF EXISTS job_files_authenticated_insert ON storage.objects;
CREATE POLICY job_files_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'job-files');

DROP POLICY IF EXISTS job_files_authenticated_delete ON storage.objects;
CREATE POLICY job_files_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'job-files');

DROP POLICY IF EXISTS job_documents_private_authenticated_read ON storage.objects;
CREATE POLICY job_documents_private_authenticated_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'job-documents-private'
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );

DROP POLICY IF EXISTS job_documents_private_authenticated_delete ON storage.objects;
CREATE POLICY job_documents_private_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'job-documents-private'
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );

-- ─── SECTION: cron jobs (loaded DEACTIVATED — see header) ──────────────
DO $$
DECLARE
  job record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'non-public.sql: pg_cron is not installed — SKIPPING the 15 captured cron jobs. `npm run db:local` installs it and verifies; a disposable qualifier stack that does not need cron may ignore this.';
    RETURN;
  END IF;

  PERFORM cron.schedule('process-crm-automations', '6,21,36,51 * * * *', $upr_cron$
  SELECT net.http_post(
    url := 'https://utahpros.app/api/process-crm-automations',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-webhook-secret',(SELECT value FROM integration_config WHERE key='cron_worker_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$upr_cron$);

  PERFORM cron.schedule('process-sequences', '3,18,33,48 * * * *', $upr_cron$
  SELECT net.http_post(
    url := 'https://utahpros.app/api/process-sequences',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-webhook-secret',(SELECT value FROM integration_config WHERE key='cron_worker_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$upr_cron$);

  PERFORM cron.schedule('run-automations', '*/10 * * * *', $upr_cron$
  SELECT net.http_post(
    url := 'https://utahpros.app/api/run-automations',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-webhook-secret',(SELECT value FROM integration_config WHERE key='cron_worker_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$upr_cron$);

  PERFORM cron.schedule('upr_callrail_event_recovery', '*/5 * * * *',
    $upr_cron$SELECT public.wake_callrail_event_recovery_worker();$upr_cron$);

  PERFORM cron.schedule('upr_calls_backfill_safety_net', '20 */6 * * *',
    $upr_cron$SELECT public.wake_transcribe_call_backfill();$upr_cron$);

  PERFORM cron.schedule('upr_calls_reclassify_safety_net', '40 */6 * * *',
    $upr_cron$SELECT public.wake_transcribe_call_reclassify();$upr_cron$);

  PERFORM cron.schedule('upr_contractor_compliance_reminders_daily', '23 13 * * *',
    $upr_cron$ SELECT public.contractor_compliance_reminder_poll(); $upr_cron$);

  PERFORM cron.schedule('upr_message_notification_outbox', '*/5 * * * *',
    $upr_cron$SELECT public.wake_message_notification_outbox_worker();$upr_cron$);

  PERFORM cron.schedule('upr_midnight_clock_split_0610', '10 6 * * *',
    $upr_cron$select public.apply_midnight_clock_split();$upr_cron$);

  PERFORM cron.schedule('upr_midnight_clock_split_0710', '10 7 * * *',
    $upr_cron$select public.apply_midnight_clock_split();$upr_cron$);

  PERFORM cron.schedule('upr_ops_health', '*/15 * * * *',
    $upr_cron$SELECT public.wake_ops_health_worker();$upr_cron$);

  PERFORM cron.schedule('upr_qbo_payments_sync_hourly', '17 * * * *',
    $upr_cron$SELECT public.qbo_payments_sync_poll();$upr_cron$);

  PERFORM cron.schedule('upr_real_job_evidence_reconciler', '15 13 * * *', $upr_cron$
  INSERT INTO public.system_events (event_type, entity_type, entity_id, payload)
  SELECT 'real_job_evidence_mismatch',
         'jobs',
         '00000000-0000-0000-0000-000000000000'::uuid,
         jsonb_build_object(
           'evidence_unflagged',  counts.evidence_unflagged,
           'flagged_no_evidence', counts.flagged_no_evidence,
           'checked_at',          now()
         )
  FROM (
    SELECT COUNT(*) FILTER (WHERE m->>'category' = 'evidence_unflagged')  AS evidence_unflagged,
           COUNT(*) FILTER (WHERE m->>'category' = 'flagged_no_evidence') AS flagged_no_evidence
    FROM public.get_real_job_evidence_mismatches() AS m
  ) counts
  WHERE counts.evidence_unflagged + counts.flagged_no_evidence > 0;
  $upr_cron$);

  PERFORM cron.schedule('upr_scan_abandoned_clocks', '*/30 * * * *',
    $upr_cron$SELECT public.scan_abandoned_clocks();$upr_cron$);

  PERFORM cron.schedule('weekly-crm-digest', '7 14 * * 1', $upr_cron$
    SELECT net.http_post(
      url := 'https://utahpros.app/api/weekly-crm-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', (SELECT value FROM integration_config WHERE key = 'crm_digest_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $upr_cron$);

  -- Deactivate every job just scheduled — the one deliberate divergence.
  -- postgres may not UPDATE cron.job directly; alter_job is the granted path.
  FOR job IN SELECT jobid FROM cron.job LOOP
    PERFORM cron.alter_job(job.jobid, active := false);
  END LOOP;

  IF EXISTS (SELECT 1 FROM cron.job WHERE active) THEN
    RAISE EXCEPTION 'non-public.sql: a cron job is still ACTIVE on a local stack — it would call production endpoints from this machine'
      USING ERRCODE = '55000';
  END IF;
END $$;
