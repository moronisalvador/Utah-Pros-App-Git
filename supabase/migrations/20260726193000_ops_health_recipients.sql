-- ════════════════════════════════════════════════
-- MIGRATION: 20260726193000_ops_health_recipients
-- Phase: n/a (standalone follow-up to 20260725190000_ops_health_alerting)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Points the automated "system health" alerts at one person instead of every
--   admin. Right now five admin accounts get an in-app alert every time the
--   watchman finds a problem, including two people who cannot act on it and one
--   local test account. The owner asked for these to reach him alone: an alarm
--   sent to people who cannot do anything about it is how alarms get ignored.
--
--   It stores a plain list of employee ids in the existing settings table. No
--   secret, no new table, no change to who can see anything else. If this row is
--   ever removed, the alerts simply go back to all admins rather than stopping.
--
-- ADDITIVE-ONLY:
--   Yes. One INSERT into integration_config (a key that does not exist today).
--   No table DROP/RENAME/ALTER COLUMN, no policy change, no grant change, no
--   change to any existing row. Idempotent via ON CONFLICT.
--
-- SAFETY:
--   - integration_config is deny-all to browser roles; only the service-role
--     Worker reads this key. Employee ids are not secrets, but they are also not
--     exposed by this change.
--   - functions/api/notify.js re-filters whatever the Worker passes through
--     filterActiveInternalEmployeeIds(), so a stale or wrong id degrades to
--     "fewer recipients", never to a leak or a wrong audience.
--   - The consuming Worker fails OPEN: an unreadable or absent value leaves the
--     existing role audience in place, because losing ops alerts entirely is
--     worse than over-notifying.
--
-- SEQUENCING:
--   The Worker change (functions/api/ops-health.js resolveOpsRecipients) is
--   backward compatible and may deploy before or after this row exists. Until
--   the row exists, behavior is unchanged (all admins).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726193000_ops_health_recipients.rollback.sql
--   (deletes the single integration_config row, restoring the all-admins
--    audience). No data is lost; nothing else references this key.
-- ════════════════════════════════════════════════

-- Owner-only ops alerting. JSON array of employees.id.
-- d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da = Moroni Salvador (admin, active, internal)
INSERT INTO public.integration_config (key, value)
VALUES (
  'ops_health_recipient_ids',
  '["d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da"]'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
