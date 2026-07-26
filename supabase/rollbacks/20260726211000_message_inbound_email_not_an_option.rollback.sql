-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726211000_message_inbound_email_not_an_option
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Restores the setting that would email field technicians on every incoming
--   customer text, and makes it user-changeable again.
--
--   Think before running this. Once technicians are attached to conversations,
--   re-enabling it means an email per customer text, per tech.
--
-- VERIFIED-BEFORE STATE (live catalog, 2026-07-26):
--   notification_role_defaults: exactly one row for
--     (type_key='message.inbound', channel='email') —
--     role=field_tech, enabled=true, user_customizable=true
--   notification_types('message.inbound').email_default was already false and is
--   therefore NOT restored here (this migration did not change it in practice).
-- ════════════════════════════════════════════════

UPDATE public.notification_role_defaults
   SET enabled           = true,
       user_customizable = true,
       updated_at        = now()
 WHERE type_key = 'message.inbound'
   AND channel  = 'email'
   AND role     = 'field_tech';
