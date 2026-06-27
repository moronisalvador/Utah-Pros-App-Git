-- ════════════════════════════════════════════════
-- Time-Tracking PR-8 — RLS hardening on job_time_entries
-- ════════════════════════════════════════════════
-- Before: a wide-open ALL policy let any authenticated client INSERT/UPDATE/DELETE
-- job_time_entries straight through PostgREST.
--
-- After: anon + authenticated may only SELECT. There is NO write policy, so direct
-- REST INSERT/UPDATE/DELETE are rejected (insert → "row violates RLS"; update/delete
-- → 0 rows). Every legitimate write already goes through a SECURITY DEFINER function
-- owned by postgres, which bypasses RLS and is unaffected:
--   clock_appointment_action, clock_finish_entry, apply_midnight_clock_split,
--   admin_upsert_time_entry, admin_clock_out_entry, delete_time_entry,
--   approve_time_entries, upsert_time_entry (legacy), merge_jobs,
--   close_open_clocks_on_appt_delete (appointment BEFORE DELETE trigger).
--
-- Reads stay open — the tech app (TimeTracker, TechDash open-clock), the office
-- TimeTracking page (RequestsView diff), MergeModal, and realtime all SELECT directly.
--
-- Validated on prod's real role config via an isolated throwaway harness before apply:
-- as `authenticated`, direct INSERT denied, UPDATE/DELETE matched 0 rows, SELECT and the
-- SECURITY DEFINER write path both succeeded. get_advisors(security) shows no new findings.
-- Rollback: re-create the permissive policy
--   create policy "allow_authenticated_job_time_entries" on public.job_time_entries
--     for all to authenticated using (true) with check (true);

alter table public.job_time_entries enable row level security;

drop policy if exists "allow_authenticated_job_time_entries" on public.job_time_entries;
drop policy if exists "allow_anon_read_job_time_entries" on public.job_time_entries;

create policy "jte_select_all" on public.job_time_entries
  for select to anon, authenticated using (true);
