-- ════════════════════════════════════════════════
-- MIGRATION: 20260726211000_message_inbound_email_not_an_option
-- Phase: Notification hygiene — prerequisite for participant scoping (4.1)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes sure nobody ever gets an EMAIL every time a customer sends a text.
--   Incoming texts should reach people through the in-app bell and a phone
--   push, and that is all.
--
--   Right now there is a setting that would email field technicians on every
--   inbound text. It has never fired, because technicians are not yet on any
--   conversation. The moment they are — which is the whole point of the
--   participant-scoping work — every tech would start getting an email per
--   customer text. This turns that off and makes it non-optional, so it cannot
--   be switched back on by accident later.
--
-- ADDITIVE-ONLY:
--   No table/column/index is created or dropped and no policy or grant changes.
--   It UPDATEs one settings row (and defensively any future email rows for this
--   one notification type). Reversible; see ROLLBACK.
--
-- EVIDENCE (live catalog, 2026-07-26):
--   notification_types('message.inbound') : bell_default=true, push_default=true,
--     email_default=false  ← already correct at the catalog level
--   notification_role_defaults            : exactly ONE row for this type/channel —
--     role=field_tech, channel=email, enabled=TRUE, user_customizable=TRUE
--     ← the actual landmine
--   notification_prefs                    : two employees have explicitly set
--     email=false already; untouched by this migration
--   notification_employee_overrides       : none
--
-- OWNER DECISION (2026-07-26):
--   "No one should receive emails for inbound text, that shouldn't even be an
--   option. Push + bell only." Hence enabled=false AND user_customizable=false:
--   off, and not offered.
--
-- WHY NOT JUST DELETE THE ROW:
--   An absent role default falls back to the catalog default, which is already
--   false — so deleting would work today. An explicit disabled row is better:
--   it survives a future change to the catalog default, and it records the
--   decision where the next person will look.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726211000_message_inbound_email_not_an_option.rollback.sql
--   (restores field_tech email to enabled=true, user_customizable=true).
-- ════════════════════════════════════════════════

-- Turn it off AND stop offering it, for every role that has (or later gains) an
-- email row on this type.
UPDATE public.notification_role_defaults
   SET enabled           = false,
       user_customizable = false,
       updated_at        = now()
 WHERE type_key = 'message.inbound'
   AND channel  = 'email';

-- Belt and braces: the catalog default is already false, but state it so a
-- future edit cannot quietly re-enable email for this type.
UPDATE public.notification_types
   SET email_default = false
 WHERE type_key = 'message.inbound';
