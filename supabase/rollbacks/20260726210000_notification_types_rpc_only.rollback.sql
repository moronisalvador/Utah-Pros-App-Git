-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726210000_notification_types_rpc_only
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the notification-type list back the way it was: any logged-in employee
--   can edit it again, and the browser roles regain direct table access.
--
--   Be aware of what that restores — the ability to silently switch off the
--   system-health alerts. Only run this if the closure actually broke something.
--
-- VERIFIED-BEFORE STATE (live catalog, 2026-07-26):
--   notification_types_all : ALL / {authenticated} / USING true / WITH CHECK true
--   anon AND authenticated each held all 7 table privileges.
-- ════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.notification_types TO anon, authenticated;

CREATE POLICY notification_types_all ON public.notification_types
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.notification_types IS NULL;
