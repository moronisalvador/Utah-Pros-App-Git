\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

-- The governed runner selects only the exact local Supabase target and supplies
-- upr.isolated_test_database=on through PGOPTIONS. The included script still
-- enforces both gates before touching a fixture.
\ir inbound_lead_recording_source_isolated.sql

BEGIN;
SELECT plan(1);
SELECT pass(
  'S1e recording-source behavior passed on the isolated local clone'
);
SELECT * FROM finish();
ROLLBACK;
