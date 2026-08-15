-- ════════════════════════════════════════════════
-- MIGRATION: 20260805030000_crm_weekly_digest_notification_type
-- Phase: n/a (standalone owner-requested change)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds "Weekly CRM digest" to the notification catalog so admins can control,
--   from Settings → Notifications, whether they personally get the weekly
--   AI-written CRM summary email — instead of that recipient list being a
--   Cloudflare env var or a raw database row nobody remembers to update (which
--   is why one admin never received it). It defaults ON for the admin role, so
--   nothing changes for anyone getting it today, and each admin can turn it
--   off for themselves. It is not offered to other roles, matching every
--   other admin-only alert already in this catalog.
--
-- ADDITIVE-ONLY:
--   Yes. One INSERT of one catalog row into public.notification_types plus one
--   INSERT of one row into public.notification_role_defaults. No table
--   DROP/RENAME/ALTER COLUMN, no function replaced, no grant or policy
--   changed, no existing row updated. ON CONFLICT DO NOTHING makes both safe
--   to re-run.
--
--   Seeded enabled = true, like 20260804120000_message_outbound_thread_
--   notification.sql: a catalog row does nothing by itself. bell_default and
--   push_default are false and stay false — nothing in this repository calls
--   create_notification or dispatchEvent for this type_key, so there is no
--   bell/push consumer to wire up. The only consumer is
--   functions/api/weekly-crm-digest.js's resolveRecipients(), which reads
--   get_effective_notification_prefs() directly with its existing service-role
--   client (that RPC has been granted to service_role since
--   20260703_notify_f2_foundation.sql). So this migration is inert on its own,
--   and applying it before or after the paired code change is equally safe:
--   until the code deploys, nothing reads the new row; once it deploys, it
--   prefers this preference-based recipient list only once at least one admin
--   has an effective 'email' preference here, and otherwise falls back to the
--   pre-existing static list (env var / integration_config row) — see that
--   file's header for the exact fallback order.
--
--   The admin role_default row is what makes this "default ON for admins,
--   opt-out per person" instead of "everyone starts opted out until someone
--   configures a role row by hand". Every other admin-audience type in this
--   catalog (payment.received, lead.new, esign.signed, feedback.submitted,
--   timesheet.change_requested) skips a role_default row and instead relies on
--   its own emitter's role-scoped audience query in functions/api/notify.js;
--   this type has no emitter, so the role_default row is what
--   get_effective_notification_prefs actually resolves against, rather than
--   the type-level email_default (kept false, so a role with no explicit
--   default row — i.e. every role but admin — stays opted out).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260805030000_crm_weekly_digest_notification_type.rollback.sql
--   Deletes the notification_role_defaults row, then the notification_types
--   row (notification_prefs and notification_employee_overrides cascade on
--   delete of the type; notification_presentation_audit is cleared first
--   because that FK is ON DELETE RESTRICT, mirroring
--   20260804120000_message_outbound_thread_notification.rollback.sql). Deleting
--   the type row is also the instant kill switch — resolvePreferenceRecipients()
--   then finds zero admins with an effective preference and
--   resolveRecipients() falls back to the legacy static list, so nothing
--   breaks. A softer stop that keeps the row and history:
--     UPDATE public.notification_role_defaults SET enabled = false
--      WHERE role = 'admin' AND type_key = 'crm_weekly_digest' AND channel = 'email';
-- ════════════════════════════════════════════════

INSERT INTO public.notification_types
  (type_key, label, description, category, audience,
   bell_default, push_default, email_default, enabled, sort_order)
VALUES
  ('crm_weekly_digest',
   'Weekly CRM digest',
   'A weekly AI-written summary of CRM pipeline movement, stale leads that '
     || 'need follow-up, and ad-spend swings.',
   'admin',
   'Admins (opt-in via notification preferences)',
   false, false, false, true, 90)
ON CONFLICT (type_key) DO NOTHING;

INSERT INTO public.notification_role_defaults
  (role, type_key, channel, enabled, user_customizable)
VALUES
  ('admin', 'crm_weekly_digest', 'email', true, true)
ON CONFLICT (role, type_key, channel) DO NOTHING;
