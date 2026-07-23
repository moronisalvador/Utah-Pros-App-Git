-- exec_read_sql containment — read-only preflight
-- Run immediately before the apply window. Every row should match the reviewed values recorded in
-- docs/audit/2026-07/exec-read-sql-containment.md. This file performs no writes and reads no
-- business-row contents.

WITH target AS (
  SELECT
    p.oid,
    n.nspname AS schema_name,
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS result_type,
    r.rolname AS owner,
    p.prosecdef AS security_definer,
    p.proconfig,
    p.proacl,
    obj_description(p.oid, 'pg_proc') AS comment,
    md5(pg_get_functiondef(p.oid)) AS definition_md5
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_roles AS r ON r.oid = p.proowner
  WHERE n.nspname = 'public'
    AND p.proname = 'exec_read_sql'
)
SELECT
  schema_name,
  proname,
  identity_arguments,
  result_type,
  owner,
  security_definer,
  proconfig,
  proacl,
  comment,
  definition_md5,
  has_function_privilege('anon', oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', oid, 'EXECUTE') AS service_role_can_execute
FROM target;

SELECT
  count(*) AS overload_count,
  count(*) = 1 AS exactly_one_reviewed_overload
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'exec_read_sql';

SELECT
  version,
  name,
  cardinality(statements) AS statement_count,
  md5(array_to_string(statements, E'\n')) AS statements_md5
FROM supabase_migrations.schema_migrations
WHERE EXISTS (
  SELECT 1
  FROM unnest(statements) AS statement
  WHERE statement ILIKE '%exec_read_sql%'
)
ORDER BY version;
