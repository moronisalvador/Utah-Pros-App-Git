-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_add_clock_split_columns
-- PR-1 (Time-Tracking build plan) — split/lineage columns on job_time_entries.
--
-- WHAT THIS DOES (plain language):
--   Adds four bookkeeping columns the later midnight-split feature (PR-3) needs,
--   added now so the single-open-entry work and PR-3 share one column shape.
--     auto_continued  — true when a row was auto-reopened after a midnight split
--     continued_from  — points back to the entry this one continued from
--     auto_split_seq  — how many times this clock has been auto-split (0 = original)
--     source          — provenance tag ('manual','auto_split', etc.)
--
-- NOTES / GOTCHAS:
--   - IF NOT EXISTS on every column → safe to re-run / idempotent on the branch.
--   - No data backfill needed; defaults cover existing rows.
-- ════════════════════════════════════════════════
alter table job_time_entries
  add column if not exists auto_continued boolean not null default false,
  add column if not exists continued_from uuid references job_time_entries(id),
  add column if not exists auto_split_seq int not null default 0,
  add column if not exists source text;
