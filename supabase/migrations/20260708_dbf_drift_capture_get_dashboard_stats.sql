-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_drift_capture_get_dashboard_stats.sql
-- DB-Foundation Phase F — drift capture: get_dashboard_stats()  [roadmap item ⑥]
--   docs/db-foundation-roadmap.md → Phase F block (Drift reconciliation).
--
-- WHAT THIS DOES (plain language):
--   The dashboard's headline counts (active jobs, conversations needing a reply,
--   total contacts, open leads) come from get_dashboard_stats(), which lives in the
--   production database but was never captured in a migration. This RE-DERIVES its
--   exact live definition (dumped via pg_get_functiondef on 2026-07-08) so the repo
--   can rebuild it. CREATE OR REPLACE with the identical body → applying to the live
--   DB is a behavior-preserving no-op; on a fresh build it recreates the function.
--
-- CONTRACT FREEZE: signature get_dashboard_stats() RETURNS json and the JSON keys
--   (active_jobs, needs_response, total_contacts, open_leads) are unchanged.
--
-- ROLLBACK: none needed on live (definition already present).
--   DROP FUNCTION IF EXISTS public.get_dashboard_stats();  -- fresh build only
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'active_jobs', (
      SELECT COUNT(*)::int
      FROM jobs
      WHERE phase NOT IN ('completed', 'closed', 'cancelled')
    ),
    'needs_response', (
      SELECT COUNT(*)::int
      FROM conversations
      WHERE status = 'needs_response'
    ),
    'total_contacts', (
      SELECT COUNT(*)::int
      FROM contacts
    ),
    'open_leads', (
      SELECT COUNT(*)::int
      FROM contacts
      WHERE role = 'lead'
    )
  );
$function$;

-- Live grants (faithful reproduction; anon needed explicitly now that default
-- privileges no longer auto-grant it).
REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO anon, authenticated, service_role;
