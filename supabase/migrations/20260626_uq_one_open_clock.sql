-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_uq_one_open_clock
-- PR-1 (Time-Tracking build plan) — single-open-entry DB backstop.
--
-- WHAT THIS DOES (plain language):
--   Enforces at the database level that a single employee can have at most ONE
--   open LIVE time entry at a time (clock_out IS NULL AND travel_start IS NOT NULL).
--   Even if application logic ever regresses, the DB will reject a second open clock.
--
-- NOTES / GOTCHAS:
--   - Partial unique index keyed on employee_id, scoped to open live rows only.
--     Manual desk rows (travel_start IS NULL) are excluded, so admins can still add
--     historical entries freely.
--   - Uses plain (non-CONCURRENT) CREATE INDEX because apply_migration runs inside a
--     transaction (CONCURRENTLY is disallowed there). The table is tiny, so the brief
--     lock is negligible. IF NOT EXISTS makes it idempotent.
-- ════════════════════════════════════════════════
create unique index if not exists uq_jte_one_open_clock_per_employee
on job_time_entries (employee_id)
where clock_out is null and travel_start is not null;
