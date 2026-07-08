-- ═════════════════════════════════════════════════════════════════════════════
-- db_foundation_default_privileges.sql  ·  DB-Foundation Phase F — SQL gate  [item ③]
--
-- WHAT THIS DOES (plain language):
--   Proves the "new objects no longer auto-open to the browser" posture, as it
--   actually behaves on this managed Supabase instance (verified 2026-07-08):
--     • A brand-new TABLE and SEQUENCE grant anon NOTHING — the ALTER DEFAULT
--       PRIVILEGES REVOKE closes the auto-open vector for the data-bearing
--       objects. THIS is the primary win.
--     • FUNCTIONS are different: Supabase re-applies PostgreSQL's built-in
--       `EXECUTE TO PUBLIC` to every new function on creation (an `ddl_command_end`
--       platform behavior), so a function that does NOT explicitly lock itself
--       down stays anon-executable. Therefore the database-standard §2 MANDATES
--       every function migration `REVOKE EXECUTE ... FROM PUBLIC, anon` and grant
--       only intended roles. This gate proves a §2-compliant function denies anon
--       while `authenticated` keeps EXECUTE.
--
-- HOW TO RUN: paste into mcp__supabase__execute_sql. Creates throwaway probe
--   objects inside a transaction that ROLLS BACK — persists nothing. RAISEs on
--   any failure.
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE public._dbf_probe_tbl (id int);
CREATE SEQUENCE public._dbf_probe_seq;
-- A function that follows the database-standard §2 lock-down pattern.
CREATE FUNCTION public._dbf_probe_fn_std() RETURNS int LANGUAGE sql AS 'SELECT 1';
REVOKE EXECUTE ON FUNCTION public._dbf_probe_fn_std() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._dbf_probe_fn_std() TO authenticated, service_role;

DO $$
BEGIN
  -- Tables & sequences: the default-privilege revoke denies anon at creation.
  IF has_table_privilege('anon', 'public._dbf_probe_tbl', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: new table auto-granted SELECT to anon';
  END IF;
  IF has_table_privilege('anon', 'public._dbf_probe_tbl', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: new table auto-granted INSERT to anon';
  END IF;
  IF has_sequence_privilege('anon', 'public._dbf_probe_seq', 'USAGE') THEN
    RAISE EXCEPTION 'FAIL: new sequence auto-granted USAGE to anon';
  END IF;

  -- Functions: a §2-compliant function (explicit REVOKE FROM PUBLIC, anon) denies
  -- anon and keeps authenticated. (A function WITHOUT that revoke would still be
  -- anon-executable via Supabase's built-in PUBLIC grant — see header.)
  IF has_function_privilege('anon', 'public._dbf_probe_fn_std()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: §2-locked function still executable by anon';
  END IF;

  -- authenticated must be UNAFFECTED (we tightened anon only)
  IF NOT has_table_privilege('authenticated', 'public._dbf_probe_tbl', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION: new table no longer grants SELECT to authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public._dbf_probe_fn_std()', 'EXECUTE') THEN
    RAISE EXCEPTION 'REGRESSION: §2-locked function no longer grants EXECUTE to authenticated';
  END IF;

  RAISE NOTICE 'db_foundation_default_privileges: PASS';
END $$;

ROLLBACK;   -- drops all probe objects, persists nothing

SELECT true AS ok;
