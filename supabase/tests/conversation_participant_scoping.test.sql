\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

-- The governed isolated runner must select a disposable local target and supply
-- upr.isolated_test_database=on through PGOPTIONS. The included behavior suite
-- independently enforces both boundaries before it creates any fixture.
\ir conversation_participant_scoping_isolated.sql

BEGIN;
SELECT plan(1);
SELECT pass(
  'conversation participant scoping behavior passed on the isolated local clone'
);
SELECT * FROM finish();
ROLLBACK;
