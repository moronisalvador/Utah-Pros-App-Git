-- ════════════════════════════════════════════════
-- ROLLBACK: 20260727144500_notification_role_defaults_rpc_only
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts back the wide-open access on notification_role_defaults, exactly as it
--   was. Only run this if closing the table actually broke something.
--
--   Be aware of what you are restoring: with this policy in place, ANY logged-in
--   employee — including an external CRM partner — can change who receives which
--   notifications, bypassing the admin check inside set_notification_default. The
--   re-granted anon privileges also make the table readable with the public
--   browser key.
--
--   Prefer diagnosing the breakage first. If a caller genuinely needs the table
--   directly, the right fix is a narrow policy for that exact case, not
--   ALL/USING(true) for every authenticated role.
--
-- FIDELITY:
--   Copied verbatim from the live catalog captured 2026-07-27 before the
--   migration ran: policy `notification_role_defaults_all`, ALL, TO authenticated,
--   USING true, WITH CHECK true; anon and authenticated each held
--   SELECT/INSERT/UPDATE/DELETE.
-- ════════════════════════════════════════════════

CREATE POLICY notification_role_defaults_all ON public.notification_role_defaults
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_role_defaults TO anon, authenticated;
