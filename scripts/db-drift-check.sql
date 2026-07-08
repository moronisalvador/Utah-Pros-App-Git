-- ═════════════════════════════════════════════════════════════════════════════
-- scripts/db-drift-check.sql  ·  DB-Foundation — regenerate the live snapshot
--
-- Run this against the live database (Supabase MCP `execute_sql`, or psql) and
-- save the single JSON value it returns to db/baseline/current-snapshot.json.
-- Then `node scripts/db-drift-check.mjs --current db/baseline/current-snapshot.json`
-- diffs it against the committed baseline and reports objects untracked by any
-- migration. Read-only — pure catalog introspection.
-- ═════════════════════════════════════════════════════════════════════════════
SELECT json_build_object(
  'project_ref', current_setting('cluster_name', true),
  'table_count', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relkind IN ('r','p')),
  'function_count', (SELECT count(DISTINCT proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public'),
  'tables', (SELECT json_agg(c.relname ORDER BY c.relname)
             FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind IN ('r','p')),
  'functions', (SELECT json_agg(x.proname ORDER BY x.proname)
                FROM (SELECT DISTINCT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public') x)
) AS snapshot;
