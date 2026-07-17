-- ════════════════════════════════════════════════
-- MIGRATION: 20260717_asr_a_device_tokens_own_or_admin_rls
-- Phase: App Store Readiness — Phase A (Backend hardening)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Every phone that installs the app registers a "device token" — the address
--   Apple uses to deliver a push notification to that exact phone. Today the rule
--   that decides who can READ those rows was written as "allow everyone" even
--   though it is named "Own tokens or admin read", so any logged-in employee could
--   list every other employee's device tokens. This migration replaces that rule
--   so a signed-in employee can only read THEIR OWN device tokens, plus an
--   admin/manager can read all of them. Sending pushes is unaffected (the push
--   worker uses the service-role key, which bypasses this rule), and registering a
--   token is unaffected (it goes through the SECURITY DEFINER `upsert_device_token`
--   RPC, which also bypasses this rule).
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   RLS-POLICY change only. No table DROP/RENAME/ALTER COLUMN, no data change, no
--   function/grant change. It DROPs + re-CREATEs one SELECT policy on a live table
--   (the same DROP-then-CREATE recreate mechanism DB-Foundation P3 used on this
--   very policy). It only TIGHTENS read access; it grants nothing new. Verified no
--   authenticated frontend caller reads `device_tokens` (zero `db.select`/`db.rpc`
--   readers in `src/`); the sole reader is `functions/api/send-push.js` on the
--   service-role client (RLS-exempt), so tightening cannot regress the deployed app
--   (database-standard.md §3 frontend-contract freeze — checked, not assumed).
--
--   The admin/manager set is `('admin','project_manager')` — the SAME predicate the
--   established "admin can read all" RLS policies use (`20260419_private_appointments.sql`,
--   `20260703_tech_v2_phaseF_feed_upgrades.sql`) rather than inventing a new one.
--   `employees.role` is the `employee_role` ENUM (there is NO `manager` value — using
--   it is a hard cast error); `project_manager` is the live management-tier role.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-create the prior permissive policy (documented; do NOT run unless the fix
--   must be reverted — this restores the cross-employee read):
--
--     DROP POLICY IF EXISTS "Own tokens or admin read" ON public.device_tokens;
--     CREATE POLICY "Own tokens or admin read" ON public.device_tokens
--       FOR SELECT TO authenticated USING (true);
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS "Own tokens or admin read" ON public.device_tokens;

CREATE POLICY "Own tokens or admin read" ON public.device_tokens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.auth_user_id = auth.uid()
        AND (
          e.id = device_tokens.employee_id            -- own device tokens
          OR e.role IN ('admin', 'project_manager')   -- admin/manager may read all
        )
    )
  );
