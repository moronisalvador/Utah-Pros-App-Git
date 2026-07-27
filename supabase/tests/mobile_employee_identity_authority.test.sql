\set UPR_ISOLATED_DB 1

-- The source runner supplies upr.isolated_test_database=on through PGOPTIONS.
-- The included suite independently refuses any other database before writing.
\ir mobile_employee_identity_authority_isolated.sql
