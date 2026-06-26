-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_clock_orphan_cleanup
-- PR-1 (Time-Tracking build plan) — one-time straggler cleanup.
--
-- WHAT THIS DOES (plain language):
--   Closes any open LIVE entry left over from a PRIOR day (the orphan rows the old
--   code could not close). Sets clock_out to the best available end time
--   (on_site_end, else clock_in, else 23:59:59 Denver of the work_date), tags the
--   row source='manual' if untagged, and appends a cleanup marker to notes.
--
-- NOTES / GOTCHAS:
--   - Expected to affect 0 rows today (the 3 known orphans are already closed).
--     Kept for safety and for idempotent re-runs on the preview branch.
--   - Only touches prior-day rows; today's open clocks are left alone.
--   - America/Denver is the timezone of record.
-- ════════════════════════════════════════════════
update job_time_entries
set clock_out = coalesce(on_site_end, clock_in,
                         ((work_date::text||' 23:59:59')::timestamp at time zone 'America/Denver')),
    source = coalesce(source,'manual'),
    notes = coalesce(notes,'')||' [pre-constraint cleanup]', updated_at = now()
where clock_out is null and travel_start is not null
  and work_date < (now() at time zone 'America/Denver')::date;
