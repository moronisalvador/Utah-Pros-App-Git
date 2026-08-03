\set ON_ERROR_STOP on
\set UPR_ISOLATED_DB 1
-- One non-legacy config/input fixture is shared with src/lib/oopPricing.crossTierParity.test.js.
-- Loading it here prevents the browser and canonical SQL tests from drifting to different examples.
CREATE TEMP TABLE oop_pricing_cross_tier_fixture(payload jsonb NOT NULL);
\copy oop_pricing_cross_tier_fixture(payload) FROM 'tests/qa/fixtures/oop-pricing-cross-tier-parity.json' WITH (FORMAT text)
GRANT SELECT ON oop_pricing_cross_tier_fixture TO authenticated;


-- The governed runner selects only the exact local Supabase target and supplies

-- upr.isolated_test_database=on through PGOPTIONS. The included script still
-- enforces both gates before touching synthetic fixtures.
\ir oop_pricing_builder_isolated.sql
\ir oop_pricing_builder_rollback_isolated.sql
\ir oop_quote_to_estimate_isolated.sql

BEGIN;
SELECT plan(1);
SELECT pass(
  'OOP pricing builder, rollback, and estimate-conversion contracts passed on the isolated local clone'
);
SELECT * FROM finish();
ROLLBACK;
