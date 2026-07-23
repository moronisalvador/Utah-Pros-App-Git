-- exec_read_sql containment — read-only post-apply verification
-- Run immediately after applying 20260723205127_exec_read_sql_containment.sql. The catalog row must
-- return pass=true. Then run the representative REST-role checks documented below without selecting
-- real business rows.

WITH target AS (
  SELECT
    p.oid,
    p.proacl,
    r.rolname AS owner,
    p.prosecdef AS security_definer,
    p.proconfig,
    pg_get_function_result(p.oid) AS result_type,
    md5(pg_get_functiondef(p.oid)) AS definition_md5,
    obj_description(p.oid, 'pg_proc') AS comment
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_roles AS r ON r.oid = p.proowner
  WHERE n.nspname = 'public'
    AND p.proname = 'exec_read_sql'
    AND pg_get_function_identity_arguments(p.oid) = 'p_query text'
),
overloads AS (
  SELECT count(*) AS overload_count
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'exec_read_sql'
)
SELECT
  max(overloads.overload_count) = 1 AS exactly_one_reviewed_overload,
  count(*) = 1 AS exact_signature_exists,
  bool_and(owner = 'postgres') AS owner_preserved,
  bool_and(security_definer) AS security_definer_preserved,
  bool_and(proconfig = ARRAY['search_path=public']::text[]) AS search_path_preserved,
  bool_and(result_type = 'jsonb') AS result_type_preserved,
  bool_and(definition_md5 = '3ba5b4885b4147206e4791124f23bddc') AS body_preserved,
  bool_and(NOT has_function_privilege('anon', oid, 'EXECUTE')) AS anon_denied,
  bool_and(NOT has_function_privilege('authenticated', oid, 'EXECUTE')) AS authenticated_denied,
  bool_and(has_function_privilege('service_role', oid, 'EXECUTE')) AS service_role_preserved,
  bool_and(comment LIKE '%service_role only%') AS comment_matches_contract,
  (
    max(overloads.overload_count) = 1
    AND count(*) = 1
    AND bool_and(owner = 'postgres')
    AND bool_and(security_definer)
    AND bool_and(proconfig = ARRAY['search_path=public']::text[])
    AND bool_and(result_type = 'jsonb')
    AND bool_and(definition_md5 = '3ba5b4885b4147206e4791124f23bddc')
    AND bool_and(NOT has_function_privilege('anon', oid, 'EXECUTE'))
    AND bool_and(NOT has_function_privilege('authenticated', oid, 'EXECUTE'))
    AND bool_and(has_function_privilege('service_role', oid, 'EXECUTE'))
  ) AS pass
FROM target
CROSS JOIN overloads;

-- Representative REST checks (use short-lived role tokens; do not paste them into source or chat):
--
-- 1. anon POST /rest/v1/rpc/exec_read_sql {"p_query":"select 1 as ok"}
--    expected: HTTP 401/403 and permission denied for function exec_read_sql
-- 2. authenticated POST of the same harmless query
--    expected: HTTP 401/403 and permission denied for function exec_read_sql
-- 3. owner MCP `upr_sql` with `select 1 as ok`
--    expected: [{"ok":1}], proving the retained service_role caller still works
--
-- Do not use protected tables in the negative test: denial occurs before the query body and the
-- harmless constant proves the same EXECUTE boundary without reading production data.
