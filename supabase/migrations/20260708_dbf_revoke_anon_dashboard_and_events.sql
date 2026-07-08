-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_revoke_anon_dashboard_and_events.sql
-- DB-Foundation Phase F — follow-up: close two live anon exposures the review
--   gauntlet found (anon-grant-auditor + migration-safety-checker + phase-reviewer).
--   docs/db-foundation-roadmap.md → Phase F block.
--
-- WHAT THIS DOES (plain language):
--   Two objects were granted to the logged-out `anon` role during the old
--   blanket-anon era and were faithfully reproduced by Phase F's drift-capture
--   migrations. Neither has any legitimate anon consumer, so this removes anon's
--   access. The logged-in app and the service-role workers are unaffected.
--     ① get_dashboard_stats() — returns raw business KPI counts (active jobs,
--        contacts, open leads). Its only caller is DevTools, which runs on the
--        authenticated client. No pre-login surface needs it.
--     ② system_events — the audit log. Written by service-role workers and read
--        via SECURITY DEFINER RPCs; its only browser writer (CrmLeads click-to-call)
--        runs as `authenticated`. The table has NO authenticated policy, so dropping
--        the two anon policies leaves it RLS-on deny-all for PostgREST (service-role
--        + definer only) — the same posture as the credential tables. Verified live:
--        anon held only SELECT+INSERT; authenticated direct access already went
--        through service-role/definer, not the anon policies.
--
-- Least-privilege per `.claude/rules/database-standard.md` §1–2 (anon is not on the
-- allowlist for either object). Policy/grant-only; no table/column/function change.
--
-- ROLLBACK (restores the prior anon surface):
--   GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO anon;
--   CREATE POLICY anon_insert_system_events ON public.system_events FOR INSERT TO anon WITH CHECK (true);
--   CREATE POLICY anon_select_system_events ON public.system_events FOR SELECT TO anon USING (true);
--   GRANT SELECT, INSERT ON public.system_events TO anon;
-- ═════════════════════════════════════════════════════════════════════════════

-- ① Dashboard KPI counts — authenticated + service_role only.
REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats() FROM anon;

-- ② Audit log — drop the anon policies + grants → RLS-on deny-all for PostgREST.
DROP POLICY IF EXISTS anon_insert_system_events ON public.system_events;
DROP POLICY IF EXISTS anon_select_system_events ON public.system_events;
REVOKE SELECT, INSERT ON public.system_events FROM anon;
