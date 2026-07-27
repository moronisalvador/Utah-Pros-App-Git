\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1

-- The governed runner pins --local and supplies the second, independent guard
-- through PGOPTIONS. The included script still checks both before fixtures.
\ir mobile_personal_ownership_boundary_isolated.sql

BEGIN;
SELECT plan(1);
SELECT pass(
  'S1h mobile personal ownership behavior passed on the isolated local clone'
);
SELECT * FROM finish();
ROLLBACK;
