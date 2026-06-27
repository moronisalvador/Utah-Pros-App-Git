-- 20260627_exec_read_sql.sql
-- Read-only raw-SQL helper for the UPR MCP's `upr_sql` tool.
--
-- WHY: PostgREST (the upr_select tool) is clumsy for aggregates, GROUP BY,
-- date_trunc, and multi-table joins — exactly the queries the June/May
-- reconciliation + MTD-inflation audit needs (e.g. counts/sums of claims,
-- jobs, invoices grouped by created_at date). This function lets the
-- owner-locked MCP run a single read-only SELECT/WITH and get JSON back.
--
-- SAFETY (defense in depth):
--   1. Must start with SELECT or WITH (no INSERT/UPDATE/DELETE/DDL entry point).
--   2. No multiple statements (a single trailing ';' is stripped; any other ';'
--      is rejected — blocks statement chaining).
--   3. Runs the query inside a READ-ONLY transaction (SET LOCAL
--      transaction_read_only = on) — this is the hard guarantee: even a
--      writable CTE (WITH x AS (INSERT ...)) is rejected by Postgres.
--   4. statement_timeout caps runaway/`pg_sleep` queries.
-- Exposure matches the MCP's existing access: it already uses the service-role
-- key (which bypasses RLS). EXECUTE is granted to service_role only — the
-- public anon/authenticated app roles cannot call it.

CREATE OR REPLACE FUNCTION public.exec_read_sql(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query  text := btrim(coalesce(p_query, ''));
  v_lower  text;
  v_result jsonb;
BEGIN
  -- strip a single trailing semicolon, if present
  IF right(v_query, 1) = ';' THEN
    v_query := btrim(left(v_query, length(v_query) - 1));
  END IF;

  v_lower := lower(v_query);

  IF v_lower !~ '^(select|with)\s' THEN
    RAISE EXCEPTION 'Only SELECT/WITH queries are allowed (got: %)', left(v_query, 40);
  END IF;

  IF position(';' in v_query) > 0 THEN
    RAISE EXCEPTION 'Multiple statements are not allowed';
  END IF;

  -- Hard guarantee: no writes can happen regardless of the query body.
  SET LOCAL transaction_read_only = on;
  -- Cap runaway queries (e.g. pg_sleep).
  SET LOCAL statement_timeout = '15s';

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) AS t', v_query)
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_read_sql(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exec_read_sql(text) TO service_role;

COMMENT ON FUNCTION public.exec_read_sql(text) IS
  'Read-only SQL passthrough for the owner-locked UPR MCP (upr_sql tool). SELECT/WITH only, single statement, runs in a read-only transaction with a 15s timeout. service_role only.';
