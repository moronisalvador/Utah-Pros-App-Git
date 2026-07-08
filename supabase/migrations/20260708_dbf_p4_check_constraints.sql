-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p4_check_constraints.sql
-- DB-Foundation Phase P4 — data integrity: CHECK constraints  [item ⑤]
--   docs/db-foundation-roadmap.md → Phase P4 block · docs/db-foundation-p4-orphan-report.md §5
--
-- WHAT THIS DOES (plain language):
--   Time entries store how long a tech worked, paused, and travelled. Those are
--   durations — they can never be negative, and a negative value would corrupt the
--   labor-cost math (cost = (travel_minutes/60 + hours) × rate). This adds guards
--   that keep each of those three numbers at zero or above (NULL still allowed, so
--   an in-progress entry with no value yet is fine). Added the fast way: NOT VALID
--   (guards NEW/edited rows immediately, brief lock) then VALIDATE (one pass over
--   existing rows, non-blocking). ZERO existing rows violate, so VALIDATE passes.
--
--   The schema already enforces the other important CHECKs (invoice/estimate/
--   payment status enums, payments.amount > 0, pipeline_stages.win_probability in
--   [0,1], contact role/method). Money non-negativity on invoices/estimates was
--   deliberately NOT added — negatives are absent today but a blanket CHECK could
--   block a legitimate future credit/adjustment on the most sensitive money tables
--   (adjustments already live in invoice_adjustments). See report §5.
--
-- APPLY-WINDOW (database-standard.md §5): YELLOW / additive. job_time_entries is
--   not a P3-contested table; applied 2026-07-08 in a discrete window.
--
-- ROLLBACK:
--   ALTER TABLE public.job_time_entries DROP CONSTRAINT IF EXISTS job_time_entries_hours_nonneg;
--   ALTER TABLE public.job_time_entries DROP CONSTRAINT IF EXISTS job_time_entries_paused_nonneg;
--   ALTER TABLE public.job_time_entries DROP CONSTRAINT IF EXISTS job_time_entries_travel_nonneg;
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.job_time_entries
  ADD CONSTRAINT job_time_entries_hours_nonneg
  CHECK (hours IS NULL OR hours >= 0) NOT VALID;

ALTER TABLE public.job_time_entries
  ADD CONSTRAINT job_time_entries_paused_nonneg
  CHECK (total_paused_minutes IS NULL OR total_paused_minutes >= 0) NOT VALID;

ALTER TABLE public.job_time_entries
  ADD CONSTRAINT job_time_entries_travel_nonneg
  CHECK (travel_minutes IS NULL OR travel_minutes >= 0) NOT VALID;

ALTER TABLE public.job_time_entries VALIDATE CONSTRAINT job_time_entries_hours_nonneg;
ALTER TABLE public.job_time_entries VALIDATE CONSTRAINT job_time_entries_paused_nonneg;
ALTER TABLE public.job_time_entries VALIDATE CONSTRAINT job_time_entries_travel_nonneg;
