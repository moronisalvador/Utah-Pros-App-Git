-- ════════════════════════════════════════════════
-- MIGRATION: 20260714_feedback_resolved_notification_type
-- Phase: n/a (standalone additive notification-type seed)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Registers a new notification type, "feedback.resolved", so that when an
--   admin marks a technician's feedback as resolved in the Feedback Inbox, the
--   technician who submitted it gets a heads-up on their phone (push) and by
--   email that their idea/bug was taken care of. This is a single data row added
--   to the existing notification_types catalog — the same pattern the
--   meld.received type used. Push + email are on by default for this type; the
--   in-app bell too. Delivery still honors each person's own on/off preferences.
--
-- ADDITIVE-ONLY:
--   Yes — one INSERT ... ON CONFLICT DO UPDATE into notification_types. No table
--   DROP/RENAME/ALTER COLUMN, no schema change, no data change to existing rows.
--   Idempotent (re-running only refreshes the catalog copy).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DELETE FROM notification_types WHERE type_key = 'feedback.resolved';
--   (No dependent rows are created by this migration; per-employee prefs, if any
--    were later customized, are ignored once the type is gone. Safe to remove.)
-- ════════════════════════════════════════════════

INSERT INTO notification_types
  (type_key, label, description, category, audience,
   bell_default, push_default, email_default, enabled, sort_order)
VALUES
  ('feedback.resolved',
   'Feedback resolved',
   'Your submitted feedback (bug report or improvement idea) was marked resolved.',
   'operations',
   'Submitter (the technician who filed the feedback)',
   true, true, true, true, 101)
ON CONFLICT (type_key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  category    = EXCLUDED.category,
  audience    = EXCLUDED.audience,
  enabled     = EXCLUDED.enabled;
