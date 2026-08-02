/*
 * ════════════════════════════════════════════════
 * FILE: notification_producer_authorization.test.sql
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the notification-producer safety checks only against the approved
 *   disposable local database, then reports one overall pass or failure.
 *
 * DEPENDS ON:
 *   Packages:  Supabase CLI, pgTAP
 *   Internal:  notification_producer_authorization_isolated.sql
 *   Data:      reads  → disposable local notification and appointment data
 *              writes → disposable local test rows inside rolled-back work
 *
 * NOTES / GOTCHAS:
 *   - The governed runner supplies both the local-only sentinel and database
 *     setting; this file must never be aimed at a hosted project.
 * ════════════════════════════════════════════════
 */
\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

-- The governed runner supplies upr.isolated_test_database=on through PGOPTIONS
-- and resolves only the disposable local stack.
\ir notification_producer_authorization_isolated.sql

BEGIN;
SELECT plan(1);
SELECT pass(
  'notification producer authorization behavior passed on the isolated local clone'
);
SELECT * FROM finish();
ROLLBACK;
