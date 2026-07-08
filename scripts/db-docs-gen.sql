-- ═════════════════════════════════════════════════════════════════════════════
-- scripts/db-docs-gen.sql  ·  DB-Foundation P7 — live-schema snapshot for docs
--
-- Pure catalog introspection — SELECT only, no DDL, no data reads from any
-- application table. Safe to run with a read-only role; never needs (and must
-- never be run with) service-role DDL credentials.
--
-- Run this against the live database (Supabase MCP `execute_sql`, or psql with
-- a read-only connection) and save the single JSON value it returns to a file,
-- then feed that file to `node scripts/db-docs-gen.mjs --current <file>` to
-- emit docs/generated/schema-overview.md + docs/generated/rpc-inventory.md.
--
-- Distinct from scripts/db-drift-check.sql: that script's output feeds a FIXED
-- comparison baseline (db/baseline/live-schema-snapshot.json, owned by Phase F,
-- never written by this generator). This script's output is always "what does
-- the live schema look like right now" — a docs artifact, not a diff target.
-- ═════════════════════════════════════════════════════════════════════════════
SELECT json_build_object(
  'generated_from', 'live catalog (read-only introspection)',
  'tables', (
    SELECT json_agg(t ORDER BY t.name) FROM (
      SELECT
        c.relname AS name,
        (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS column_count,
        c.relrowsecurity AS rls_enabled,
        (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count,
        EXISTS (
          SELECT 1 FROM pg_policy p
          WHERE p.polrelid = c.oid AND 'anon'::regrole::oid = ANY(p.polroles)
        ) AS has_anon_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ) t
  ),
  'functions', (
    SELECT json_agg(f ORDER BY f.name) FROM (
      SELECT DISTINCT
        p.proname AS name,
        p.prosecdef AS security_definer,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ) f
  )
) AS snapshot;
