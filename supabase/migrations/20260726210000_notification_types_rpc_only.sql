-- ════════════════════════════════════════════════
-- MIGRATION: 20260726210000_notification_types_rpc_only
-- Phase: Anon closure / least-privilege — backlog item 1.1
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops staff — and anyone on the internet — from editing the list of alert
--   types the system is allowed to send.
--
--   Today any logged-in employee can switch off any notification category,
--   including the "system health" alerts that exist to tell the owner when
--   something is broken. Anyone with no login at all can do the same, because
--   the website's key is public by design. Turning off the alarm should not be
--   easier than fixing what it is warning about.
--
--   Nothing visible changes. The bell, the preference screens and the alert
--   sender all reach this list through helper functions that keep working
--   exactly as before.
--
-- ADDITIVE-ONLY:
--   No — a deliberate REVOKE (RED tier), which is the point. Drops one
--   always-true policy and revokes browser-role table privileges. No table,
--   column or index is created or dropped. No row of data changes.
--
-- EVIDENCE (live catalog, 2026-07-26):
--   - Policy `notification_types_all` = ALL / {authenticated} / USING true /
--     WITH CHECK true.
--   - anon AND authenticated each hold all 7 table privileges. (anon has no
--     policy, so anon reads are already blocked — but the GRANT is still there,
--     one policy away from being live exposure. Revoked here too.)
--   - Every reader is SECURITY DEFINER and owned by postgres, and the table has
--     relforcerowsecurity = false, so all four bypass RLS and are unaffected:
--       notify_emit, get_effective_notification_prefs,
--       get_notification_defaults, get_employee_notification_overrides
--   - No src/ code selects this table directly; the browser reaches it only
--     through those definers.
--   - service_role is preserved: functions/api/notify.js:370 reads this table
--     with the service-role client.
--   - Precedent for RLS-on-with-no-policy + explicit revoke:
--     20260724180000_crm_lead_notes.sql:83-89.
--
-- CONSEQUENCE THE OWNER ACCEPTED (2026-07-26):
--   The `enabled` master switch for a notification type becomes migration-only.
--   No UI exists for it today and none is planned. If an in-app toggle is ever
--   wanted, it is a separate additive admin-gated RPC, not a re-opened table.
--
-- KNOWN RECONCILIATION (does not affect CI):
--   supabase/tests/notify_foundation.test.js, notify_c_my_prefs.test.js and
--   notify_d_admin_defaults.test.js insert/delete notification_types through the
--   ANON client. Those were already incompatible with the current policy
--   (authenticated-only), and this makes it permanent. They are in the `db`
--   lane, which does not run in CI (backlog 6.1), so nothing goes red today —
--   they must move to a service-role harness before that lane is wired up.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726210000_notification_types_rpc_only.rollback.sql
--   (re-grants anon + authenticated and recreates the always-true policy
--    verbatim).
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS notification_types_all ON public.notification_types;

ALTER TABLE public.notification_types ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notification_types FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.notification_types IS
  'RPC-only catalog. Browser roles hold no table privilege. Read through the '
  'SECURITY DEFINER helpers (notify_emit, get_effective_notification_prefs, '
  'get_notification_defaults, get_employee_notification_overrides) and by the '
  'service-role Worker. `enabled` is migration-only by design: disabling an alert '
  'type must not be easier than fixing what it warns about.';
