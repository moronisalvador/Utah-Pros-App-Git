-- ════════════════════════════════════════════════
-- ROLLBACK: 20260808200000_collections_nav_project_manager_grant
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Takes the sidebar "Collections" link back away from project managers. They
--   return to what they saw before 2026-08-08: no link.
--
--   Note what this does NOT do. It does not stop a project manager opening that
--   page — they could always reach /collections directly, because the route is
--   guarded by a feature flag and not by this permission row, and the reports
--   behind it answer them by design. This file removes a link, nothing more.
--   Anyone running it expecting to close an access hole would be closing nothing.
--
--   This is a deliberate narrowing, not a repair. Run it only if showing project
--   managers that link turns out to be wrong — not because something is broken,
--   because nothing here can break: this file only removes one permission row.
--
-- SCOPE:
--   Exactly the one row the forward migration inserts, matched by
--   (nav_key, role). The pre-existing admin, manager and office rows for this
--   nav_key are NOT matched and survive untouched, as do all other nav keys.
--
--   It deliberately does NOT touch 20260807230000_office_financial_read_boundary
--   (production ledger 20260808050037), which is what actually decides who the
--   database will answer with accounts-receivable data, nor
--   20260808060000_overview_financials_office_pm_grant (ledger 20260808180954).
--   Both have their own paired rollbacks.
--
-- -- destructive-approved: removes exactly the one nav_permissions row this
-- -- migration's forward file added, by (nav_key, role). No other row is matched.
-- ════════════════════════════════════════════════

DELETE FROM public.nav_permissions
 WHERE nav_key = 'collections'
   AND role = 'project_manager';
