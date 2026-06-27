-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_pr3_cron_schedule
-- PR-3 (Time-Tracking build plan) — schedule the nightly midnight split.
--
-- WHAT THIS DOES (plain language):
--   Tells pg_cron to run apply_midnight_clock_split() shortly after midnight in
--   Denver. pg_cron runs in UTC, and Denver is UTC-6 (MDT) or UTC-7 (MST), so we
--   schedule two fires — 06:10 and 07:10 UTC — to cover both. Whichever lands at
--   ~00:10 Denver does the work; the other is a harmless no-op because the
--   function only acts on entries whose work_date is already in the past.
--
-- NOTES / GOTCHAS:
--   - cron.schedule(name, ...) is idempotent: re-running updates the named job.
--   - The split function is date-filtered + idempotent, so a double fire never
--     double-splits.
-- ════════════════════════════════════════════════
select cron.schedule('upr_midnight_clock_split_0610', '10 6 * * *', $$select public.apply_midnight_clock_split();$$);
select cron.schedule('upr_midnight_clock_split_0710', '10 7 * * *', $$select public.apply_midnight_clock_split();$$);
