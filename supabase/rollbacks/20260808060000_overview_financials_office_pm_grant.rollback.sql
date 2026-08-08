-- ════════════════════════════════════════════════
-- ROLLBACK: 20260808060000_overview_financials_office_pm_grant
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Takes the Dashboard money cards back away from the office manager and the
--   project managers. They return to seeing the operational cards only, which is
--   what they saw before 2026-08-08. Admins are unaffected.
--
--   This is a deliberate narrowing, not a repair. Run it only if showing those
--   people revenue, payments, average ticket and collections turns out to be
--   wrong — not because something is broken, because nothing here can break: this
--   file only removes two permission rows.
--
-- SCOPE:
--   Exactly the two rows the forward migration inserts, matched by
--   (nav_key, role). No other nav_key, no other role, no other table.
--
--   It deliberately does NOT touch 20260807230000_office_financial_read_boundary
--   (production ledger 20260808050037). That migration is what actually stops a
--   field technician reading accounts receivable from the database, and it has
--   its own paired rollback. Undoing the UI grant must never re-open the server
--   boundary — after this runs, office and project_manager can still be answered
--   by those five reports, they simply have no screen that asks.
--
-- -- destructive-approved: removes exactly the two nav_permissions rows this
-- -- migration's forward file added, by (nav_key, role). No other row is matched.
-- ════════════════════════════════════════════════

DELETE FROM public.nav_permissions
 WHERE nav_key = 'overview_financials'
   AND role IN ('office', 'project_manager');
