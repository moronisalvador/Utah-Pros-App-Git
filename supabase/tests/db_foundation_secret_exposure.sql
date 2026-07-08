-- ═════════════════════════════════════════════════════════════════════════════
-- db_foundation_secret_exposure.sql  ·  DB-Foundation Phase F — SQL gate  [item ①]
--
-- WHAT THIS DOES (plain language):
--   Schema-level proof of the deny-all invariant that the vitest companion
--   (db_foundation_secret_exposure.test.js) can only prove for the anon role.
--   For each secret-bearing table it asserts, against the LIVE catalog:
--     (a) row-level security is ENABLED, and
--     (b) there are ZERO policies (so no row is ever visible to a client role),
--   and then, by actually switching into each client role, that
--     (c) SET ROLE anon          → 0 rows, and
--     (d) SET ROLE authenticated → 0 rows.
--   (c)+(d) are the real end-to-end deny-all check for BOTH browser roles.
--
-- HOW TO RUN (no automated harness for .sql — run via the Supabase MCP):
--   Paste this file into mcp__supabase__execute_sql. It RAISEs on any failure
--   and returns the single row {ok:true} on success. Read-only: SET ROLE +
--   SELECT count(*) only, never writes.
--
-- COVERS: integration_credentials, integration_config, user_google_accounts.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t   text;
  n   bigint;
  pol int;
  rls boolean;
  tables text[] := ARRAY['integration_credentials','integration_config','user_google_accounts'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- (a) RLS enabled
    SELECT c.relrowsecurity INTO rls
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = t;
    IF rls IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'DENY-ALL FAIL: RLS not enabled on public.%', t;
    END IF;

    -- (b) zero policies
    SELECT count(*) INTO pol FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF pol <> 0 THEN
      RAISE EXCEPTION 'DENY-ALL FAIL: public.% has % polic(ies) — must be zero', t, pol;
    END IF;

    -- (c) anon reads nothing
    EXECUTE 'SET LOCAL ROLE anon';
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    RESET ROLE;
    IF n <> 0 THEN
      RAISE EXCEPTION 'DENY-ALL FAIL: anon saw % row(s) in public.%', n, t;
    END IF;

    -- (d) authenticated reads nothing (auth.uid() is NULL here; zero policies deny all)
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    RESET ROLE;
    IF n <> 0 THEN
      RAISE EXCEPTION 'DENY-ALL FAIL: authenticated saw % row(s) in public.%', n, t;
    END IF;
  END LOOP;

  RAISE NOTICE 'db_foundation_secret_exposure: PASS (deny-all holds for all 3 tables, anon + authenticated)';
END $$;

SELECT true AS ok;
