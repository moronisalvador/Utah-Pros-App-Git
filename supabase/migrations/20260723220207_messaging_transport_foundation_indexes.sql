-- Cover the remaining notification-outbox foreign keys identified by the
-- post-apply Supabase performance advisor. These indexes are additive and
-- preserve the service-only access model established by the foundation.

CREATE INDEX IF NOT EXISTS message_notification_outbox_contact_idx
  ON public.message_notification_outbox (contact_id);

CREATE INDEX IF NOT EXISTS message_notification_outbox_conversation_idx
  ON public.message_notification_outbox (conversation_id);
