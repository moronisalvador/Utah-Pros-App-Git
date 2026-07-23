-- ════════════════════════════════════════════════
-- MIGRATION: 20260723205127_exec_read_sql_containment
-- Phase: standalone security containment (DB-003)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the browser's ability to run free-form read queries with the database owner's access.
--   The owner-only MCP keeps working through its existing server service role. The function body,
--   signature, owner, return value, and timeout are not changed.
--
-- NON-ADDITIVE EMERGENCY EXCEPTION:
--   This is a grant revoke, so it intentionally removes a capability. The removed capability is the
--   Critical DB-003 exposure, not a supported browser contract: repository-wide caller tracing found
--   only the owner-locked upr-mcp `upr_sql` tool, and that caller uses service_role. No table, row,
--   function body, signature, or application behavior is changed.
--
-- APPLY WINDOW:
--   Apply only after this file and its tests are reviewed and reachable from the designated release
--   branch. Run the companion preflight first, use a low-traffic window, apply only this migration,
--   then run the post-apply catalog and representative-role checks. No frontend/worker deploy is
--   required because the retained caller already uses service_role.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   GRANT EXECUTE ON FUNCTION public.exec_read_sql(text) TO authenticated;
--
--   This restores the exact unsafe live grant removed here. PUBLIC and anon were already denied in
--   the 2026-07-23 preflight and must remain denied. service_role is never revoked by this migration.
-- ════════════════════════════════════════════════

-- Fail closed if a new overload appeared or the verified owner-tool contract changed after review.
DO $containment_preflight$
DECLARE
  v_count integer;
  v_owner name;
  v_security_definer boolean;
  v_search_path text[];
  v_result_type text;
  v_definition_md5 text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
BEGIN
  SELECT count(*)
    INTO v_count
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'exec_read_sql';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'exec_read_sql containment expected exactly one overload; found %',
      v_count;
  END IF;

  SELECT
    r.rolname,
    p.prosecdef,
    p.proconfig,
    pg_get_function_result(p.oid),
    md5(pg_get_functiondef(p.oid)),
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    has_function_privilege('service_role', p.oid, 'EXECUTE')
    INTO
      v_owner,
      v_security_definer,
      v_search_path,
      v_result_type,
      v_definition_md5,
      v_anon_can_execute,
      v_authenticated_can_execute,
      v_service_role_can_execute
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_roles AS r ON r.oid = p.proowner
  WHERE n.nspname = 'public'
    AND p.proname = 'exec_read_sql'
    AND pg_get_function_identity_arguments(p.oid) = 'p_query text';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'exec_read_sql containment expected public.exec_read_sql(p_query text)';
  END IF;

  IF v_owner <> 'postgres'
     OR v_security_definer IS DISTINCT FROM true
     OR v_search_path IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR v_result_type IS DISTINCT FROM 'jsonb'
     OR v_definition_md5 IS DISTINCT FROM '3ba5b4885b4147206e4791124f23bddc'
     OR v_anon_can_execute IS DISTINCT FROM false
     OR v_authenticated_can_execute IS DISTINCT FROM true
     OR v_service_role_can_execute IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'exec_read_sql containment preflight drift: owner=%, security_definer=%, config=%, result=%, definition_md5=%, anon=%, authenticated=%, service_role=%',
      v_owner,
      v_security_definer,
      v_search_path,
      v_result_type,
      v_definition_md5,
      v_anon_can_execute,
      v_authenticated_can_execute,
      v_service_role_can_execute;
  END IF;
END;
$containment_preflight$;

REVOKE EXECUTE ON FUNCTION public.exec_read_sql(text)
  FROM PUBLIC, anon, authenticated;

-- server-only: verified caller upr-mcp/src/tools.js uses SUPABASE_SERVICE_ROLE_KEY.
GRANT EXECUTE ON FUNCTION public.exec_read_sql(text) TO service_role;
