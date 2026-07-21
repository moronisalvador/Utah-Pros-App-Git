-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_worker_runs_meta_payload
-- Phase: n/a (standalone bug-follow-up)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds the `meta` and `payload` columns to worker_runs that
--   functions/lib/worker-runs.js has documented as supported since it was
--   written, but the live table never actually had. Every recordWorkerRun()
--   call that passed `meta` (several workers, including today's
--   demo-sheet-pdf.js fix) was silently failing to insert its row at all —
--   the helper wraps the insert in try/catch by design ("telemetry must not
--   take down the work it is recording"), so the failure was invisible.
--   This made a real production failure undiagnosable from worker_runs.
--
-- ADDITIVE-ONLY:
--   Yes — two new nullable jsonb columns on an existing table. No data
--   change, no existing column touched.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   ALTER TABLE worker_runs DROP COLUMN IF EXISTS meta, DROP COLUMN IF EXISTS payload;
-- ════════════════════════════════════════════════

ALTER TABLE worker_runs
  ADD COLUMN IF NOT EXISTS meta jsonb,
  ADD COLUMN IF NOT EXISTS payload jsonb;
