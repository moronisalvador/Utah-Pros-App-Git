-- ═════════════════════════════════════════════════════════════════════════════
-- db_foundation_default_privileges.sql  ·  DB-Foundation Phase F — SQL gate  [item ③]
--
-- WHAT THIS DOES (plain language):
--   Proves the "new objects no longer auto-open to the browser" fix. Historically
--   every new table/function/sequence in `public` was born with the anon role
--   already granted full access (Supabase's default). A single forgotten
--   `REVOKE`/RLS and a secret leaks. After DB-Foundation, a freshly created object
--   grants anon NOTHING by default; the `authenticated` role keeps its default
--   grant (we only tightened anon). Anon access must from now on be an explicit,
--   auditable `GRANT ... TO anon` (the database-standard §2 allowlist).
--
-- HOW TO RUN: paste into mcp__supabase__execute_sql. Creates throwaway probe
--   objects inside a transaction that ROLLS BACK — persists nothing. RAISEs on
--   any failure.
--
-- RED before 20260708_dbf_default_privileges_revoke_anon.sql applies (a new
-- object still grants anon → assertions fail).
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE public._dbf_probe_tbl (id int);
CREATE SEQUENCE public._dbf_probe_seq;
CREATE FUNCTION public._dbf_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';

DO $$
BEGIN
  -- anon must have NOTHING on a brand-new object
  IF has_table_privilege('anon', 'public._dbf_probe_tbl', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: new table auto-granted SELECT to anon';
  END IF;
  IF has_table_privilege('anon', 'public._dbf_probe_tbl', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: new table auto-granted INSERT to anon';
  END IF;
  IF has_function_privilege('anon', 'public._dbf_probe_fn()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: new function auto-granted EXECUTE to anon';
  END IF;
  IF has_sequence_privilege('anon', 'public._dbf_probe_seq', 'USAGE') THEN
    RAISE EXCEPTION 'FAIL: new sequence auto-granted USAGE to anon';
  END IF;

  -- authenticated must be UNAFFECTED (we tightened anon only)
  IF NOT has_table_privilege('authenticated', 'public._dbf_probe_tbl', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION: new table no longer grants SELECT to authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public._dbf_probe_fn()', 'EXECUTE') THEN
    RAISE EXCEPTION 'REGRESSION: new function no longer grants EXECUTE to authenticated';
  END IF;

  RAISE NOTICE 'db_foundation_default_privileges: PASS';
END $$;

ROLLBACK;   -- drops all probe objects, persists nothing

SELECT true AS ok;
