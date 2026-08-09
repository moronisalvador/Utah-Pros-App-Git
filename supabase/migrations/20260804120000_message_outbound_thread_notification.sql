-- ════════════════════════════════════════════════
-- MIGRATION: 20260804120000_message_outbound_thread_notification
-- Phase: n/a (standalone owner-requested change)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Right now UPR only alerts the team when a CUSTOMER texts in. If a teammate
--   writes in the same conversation, nobody else on that thread hears about it.
--   This adds the two missing alerts to the notification menu — "Teammate sent a
--   text" and "Teammate left a note" — so everyone who can see a conversation is
--   told when someone on the team writes in it. The person who typed it is never
--   notified about their own message.
--
--   They are two separate entries on purpose, not one. A text goes to the
--   customer; a note is staff-only and never leaves the building. Keeping them
--   apart lets each person mute one without losing the other, and lets the alert
--   say which one actually happened.
--
-- ADDITIVE-ONLY:
--   Yes. One INSERT of two catalog rows into public.notification_types.
--   No table DROP/RENAME/ALTER COLUMN, no function replaced, no grant or policy
--   changed, no existing row updated, no data migrated. ON CONFLICT DO NOTHING
--   makes it safe to re-run.
--
--   Seeded enabled = true DELIBERATELY, because the owner asked for this
--   behaviour on 2026-08-04. This is safe and needs no separate flag flip: a
--   notification type does nothing on its own — it only fires when a deployed
--   worker emits it. The only emitter is the new send-message.js code path, so
--   between this apply and that deploy the rows are inert. Applying schema first
--   and code second is the required order (database-standard.md §5). The reverse
--   order is equally safe here: dispatchEvent returns {skipped:'unknown_type'}
--   when the row is absent, so neither half breaks waiting for the other.
--
--   Channel defaults mirror the live message.inbound row: bell on, push on,
--   email off. Email is off on purpose — a text-by-text email would be noise,
--   and the same decision is already recorded for message.inbound in
--   20260726211000_message_inbound_email_not_an_option.sql.
--
--   No notification_role_defaults row is needed. get_effective_notification_prefs
--   resolves COALESCE(employee override, role default, type default), so the
--   bell/push defaults above apply to every role until someone customizes them.
--   Each person can then turn this off individually in Settings → Notifications.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260804120000_message_outbound_thread_notification.rollback.sql
--   Deletes both catalog rows ('message.outbound', 'message.note').
--   notification_prefs, notification_role_defaults,
--   notification_employee_overrides and notification_presentation_overrides all
--   cascade on delete; the rollback clears notification_presentation_audit first
--   because that one FK is ON DELETE RESTRICT. Deleting the rows is also the
--   instant kill switch — dispatchEvent returns {skipped:'unknown_type'} and the
--   sender-side emit is already fire-and-forget, so nothing breaks. A softer
--   stop that keeps the history is:
--     UPDATE public.notification_types SET enabled = false
--      WHERE type_key IN ('message.outbound', 'message.note');
--   Either row can also be stopped on its own — they are independent.
-- ════════════════════════════════════════════════

INSERT INTO public.notification_types
  (type_key, label, description, category, audience,
   bell_default, push_default, email_default, enabled, sort_order)
VALUES
  ('message.outbound',
   'Teammate sent a text',
   'Someone on the team sent a text in a conversation you can see.',
   'messaging',
   'Everyone with access to the conversation, except the sender',
   true, true, false, true, 11),
  ('message.note',
   'Teammate left a note',
   'Someone on the team left an internal note in a conversation you can see. '
     || 'Notes are staff-only and are never sent to the customer.',
   'messaging',
   'Everyone with access to the conversation, except the author',
   true, true, false, true, 12)
ON CONFLICT (type_key) DO NOTHING;
