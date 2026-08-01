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
