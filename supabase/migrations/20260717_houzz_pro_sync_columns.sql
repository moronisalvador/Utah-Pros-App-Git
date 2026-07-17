-- ════════════════════════════════════════════════
-- MIGRATION: 20260717_houzz_pro_sync_columns
-- Phase: n/a (standalone additive integration columns)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds three tracking columns to the jobs table so UPR can remember
--   whether a reconstruction job's customer + project info was successfully
--   handed off to Houzz Pro (our reconstruction project-management tool).
--   Houzz Pro has no public API, so the handoff goes through a Zapier
--   webhook (see functions/api/sync-houzz.js) — these columns just record
--   whether that handoff succeeded, when, and why it failed if it didn't.
--
-- ADDITIVE-ONLY:
--   Yes — three nullable columns added to the existing jobs table. No table
--   DROP/RENAME/ALTER COLUMN, no RLS/policy change (the table's existing
--   RLS policy already covers all columns of a row), no data change to
--   existing rows (new columns default to NULL).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   ALTER TABLE jobs
--     DROP COLUMN IF EXISTS houzz_sync_status,
--     DROP COLUMN IF EXISTS houzz_synced_at,
--     DROP COLUMN IF EXISTS houzz_sync_error;
-- ════════════════════════════════════════════════

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS houzz_sync_status text,
  ADD COLUMN IF NOT EXISTS houzz_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS houzz_sync_error text;

COMMENT ON COLUMN jobs.houzz_sync_status IS 'Houzz Pro Zapier handoff status: sent | failed | null (never attempted).';
COMMENT ON COLUMN jobs.houzz_synced_at IS 'When the job was last successfully handed off to the Houzz Pro Zap. Confirms the webhook accepted it, not that Houzz Pro finished creating the project (Zapier runs the Zap asynchronously).';
COMMENT ON COLUMN jobs.houzz_sync_error IS 'Error message from the last failed Houzz Pro sync attempt, if any.';
