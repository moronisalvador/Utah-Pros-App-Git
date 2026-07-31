-- ════════════════════════════════════════════════
-- ROLLBACK: 20260730150000_oop_pricing_builder
-- Phase: OOP Pricing Builder
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Disables the configurable pricing API while retaining a safe legacy quote
--   path. The rollback does not restore the historical broad authenticated
--   policies or caller-controlled totals.
--
-- OWNER GATE:
--   Run only in a reviewed owner-authorized window after setting the
--   transaction-local app.oop_pricing_rollback setting to approved.
--
-- DATA AND SECURITY POSTURE:
--   Additive pricing tables and their data remain forced-RLS and inaccessible
--   to browser roles. Legacy quote signatures remain callable only through the
--   exact active-internal five-role and tool:oop_pricing rollout predicate.
--   Direct writes and the frozen 26-argument RPC keep server-derived totals,
--   actor ownership, job validation, and bounds checks. That frozen signature
--   has no request-id parameter, so rollback does not make a false idempotency
--   claim for the legacy compatibility path.
-- ════════════════════════════════════════════════

DO $guard$
BEGIN
  IF current_setting('app.oop_pricing_rollback', true) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'owner_approval_required: set app.oop_pricing_rollback=approved';
  END IF;
END $guard$;

-- Make the configurable builder surface inert. Functions and private data stay
-- in place for a future reviewed recovery, but no browser or service API caller
-- can execute the builder/configuration contracts after rollback.
REVOKE EXECUTE ON FUNCTION
  public.get_oop_pricing_config(uuid),
  public.get_oop_pricing_admin_state(),
  public.save_oop_pricing_draft(integer,jsonb,uuid),
  public.publish_oop_pricing_draft(integer,uuid),
  public.upsert_oop_quote_v2(uuid,uuid,text,text,text,text,uuid,jsonb,timestamptz,uuid),
  public.get_oop_quote_v2(uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- Retain only the caller-safe boolean helper for authenticated RLS evaluation.
-- Every other helper remains private to the SECURITY DEFINER/trigger call chain.
REVOKE EXECUTE ON FUNCTION public.oop_pricing_calculator_access()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oop_pricing_calculator_access() TO authenticated;

REVOKE EXECUTE ON FUNCTION
  public.oop_pricing_active_employee(boolean),
  public.oop_pricing_assert_job_exists(uuid),
  public.oop_pricing_validate_config(jsonb),
  public.oop_pricing_assert_storage_bounds(jsonb,numeric,numeric,numeric,jsonb,numeric),
  public.oop_clear_v2_snapshot_on_legacy_update(),
  public.oop_require_active_internal_quote_write()
FROM PUBLIC, anon, authenticated, service_role;

-- Reassert operation-specific quote policies. Missing flag, Force Off, denied
-- roles, inactive/external employees, and missing auth all fail closed through
-- oop_pricing_calculator_access().
DROP POLICY IF EXISTS "oop_quotes authenticated read" ON public.oop_quotes;
DROP POLICY IF EXISTS "oop_quotes authenticated insert" ON public.oop_quotes;
DROP POLICY IF EXISTS "oop_quotes authenticated update" ON public.oop_quotes;
DROP POLICY IF EXISTS "oop_quotes authenticated delete" ON public.oop_quotes;
DROP POLICY IF EXISTS "oop_quotes authenticated write" ON public.oop_quotes;
CREATE POLICY "oop_quotes authenticated read" ON public.oop_quotes
  FOR SELECT TO authenticated
  USING (public.oop_pricing_calculator_access());
CREATE POLICY "oop_quotes authenticated insert" ON public.oop_quotes
  FOR INSERT TO authenticated
  WITH CHECK (public.oop_pricing_calculator_access());
CREATE POLICY "oop_quotes authenticated update" ON public.oop_quotes
  FOR UPDATE TO authenticated
  USING (public.oop_pricing_calculator_access())
  WITH CHECK (public.oop_pricing_calculator_access());
CREATE POLICY "oop_quotes authenticated delete" ON public.oop_quotes
  FOR DELETE TO authenticated
  USING (public.oop_pricing_calculator_access());

-- Reassert both safe triggers instead of reverting to unrestricted DML. The
-- first keeps private snapshots from becoming silently stale after a legacy
-- update; the second enforces actor, role/flag, job, bounds, and canonical money
-- for direct table writes as well as compatibility RPC writes.
DROP TRIGGER IF EXISTS oop_clear_v2_snapshot_on_legacy_update ON public.oop_quotes;
CREATE TRIGGER oop_clear_v2_snapshot_on_legacy_update
  AFTER UPDATE ON public.oop_quotes
  FOR EACH ROW EXECUTE FUNCTION public.oop_clear_v2_snapshot_on_legacy_update();
DROP TRIGGER IF EXISTS oop_require_active_internal_quote_write ON public.oop_quotes;
CREATE TRIGGER oop_require_active_internal_quote_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.oop_quotes
  FOR EACH ROW EXECUTE FUNCTION public.oop_require_active_internal_quote_write();

-- Preserve the hardened forward bodies and frozen public signatures. The
-- generator is private to the definer call chain; authenticated and service
-- callers receive only the guarded quote CRUD RPCs.
REVOKE EXECUTE ON FUNCTION public.generate_oop_quote_number()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION
  public.get_oop_quote(uuid),
  public.get_oop_quotes(integer,uuid),
  public.delete_oop_quote(uuid),
  public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.get_oop_quote(uuid),
  public.get_oop_quotes(integer,uuid),
  public.delete_oop_quote(uuid),
  public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid)
TO authenticated, service_role;

DO $postcondition$
DECLARE
  v_generator text:=lower(pg_get_functiondef('public.generate_oop_quote_number()'::regprocedure));
  v_upsert text:=lower(pg_get_functiondef('public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid)'::regprocedure));
  v_get text:=lower(pg_get_functiondef('public.get_oop_quote(uuid)'::regprocedure));
  v_list text:=lower(pg_get_functiondef('public.get_oop_quotes(integer,uuid)'::regprocedure));
  v_delete text:=lower(pg_get_functiondef('public.delete_oop_quote(uuid)'::regprocedure));
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name IN ('oop_pricing_revisions','oop_pricing_audit','oop_quote_save_requests','oop_quote_pricing_snapshots')
      AND grantee IN ('anon','authenticated','PUBLIC')
  ) THEN
    RAISE EXCEPTION 'rollback postcondition: browser-role private-table grant leaked';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='oop_quotes')<>4
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='oop_quotes'
          AND policyname='oop_quotes authenticated read' AND cmd='SELECT'
          AND position('oop_pricing_calculator_access' in coalesce(qual,''))>0)<>1
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='oop_quotes'
          AND policyname='oop_quotes authenticated insert' AND cmd='INSERT'
          AND position('oop_pricing_calculator_access' in coalesce(with_check,''))>0)<>1
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='oop_quotes'
          AND policyname='oop_quotes authenticated update' AND cmd='UPDATE'
          AND position('oop_pricing_calculator_access' in coalesce(qual,''))>0
          AND position('oop_pricing_calculator_access' in coalesce(with_check,''))>0)<>1
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='oop_quotes'
          AND policyname='oop_quotes authenticated delete' AND cmd='DELETE'
          AND position('oop_pricing_calculator_access' in coalesce(qual,''))>0)<>1
    OR EXISTS(SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='oop_quotes'
          AND (roles<>ARRAY['authenticated']::name[] OR qual='true' OR with_check='true')) THEN
    RAISE EXCEPTION 'rollback postcondition: quote RLS is not the exact fail-closed four-policy contract';
  END IF;

  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid='public.oop_quotes'::regclass AND NOT tgisinternal
        AND tgname IN ('oop_clear_v2_snapshot_on_legacy_update','oop_require_active_internal_quote_write'))<>2 THEN
    RAISE EXCEPTION 'rollback postcondition: safe quote triggers are incomplete';
  END IF;

  IF NOT has_function_privilege('authenticated','public.oop_pricing_calculator_access()','EXECUTE')
    OR has_function_privilege('anon','public.oop_pricing_calculator_access()','EXECUTE')
    OR has_function_privilege('service_role','public.oop_pricing_calculator_access()','EXECUTE')
    OR has_function_privilege('authenticated','public.oop_pricing_active_employee(boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback postcondition: authorization-helper ACL drift';
  END IF;

  IF has_function_privilege('authenticated','public.get_oop_quote_v2(uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.get_oop_quote_v2(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.upsert_oop_quote_v2(uuid,uuid,text,text,text,text,uuid,jsonb,timestamp with time zone,uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.upsert_oop_quote_v2(uuid,uuid,text,text,text,text,uuid,jsonb,timestamp with time zone,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback postcondition: configurable pricing RPC remains executable';
  END IF;

  IF has_function_privilege('authenticated','public.generate_oop_quote_number()','EXECUTE')
    OR has_function_privilege('service_role','public.generate_oop_quote_number()','EXECUTE')
    OR has_function_privilege('anon','public.generate_oop_quote_number()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.get_oop_quote(uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.get_oop_quote(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.get_oop_quote(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback postcondition: legacy quote RPC ACL drift';
  END IF;

  IF position('pg_advisory_xact_lock' in v_generator)=0
    OR position('america/denver' in v_generator)=0
    OR position('oop_pricing_active_employee(false)' in v_upsert)=0
    OR position('oop_pricing_assert_job_exists(p_job_id)' in v_upsert)=0
    OR position('v_quote:=round(v_quote_raw,2)' in v_upsert)=0
    OR position('quote_total=p_quote_total' in replace(v_upsert,' ',''))>0
    OR position('oop_pricing_active_employee(false)' in v_get)=0
    OR position('oop_pricing_active_employee(false)' in v_list)=0
    OR position('oop_pricing_assert_job_exists(p_job_id)' in v_list)=0
    OR position('oop_pricing_active_employee(false)' in v_delete)=0 THEN
    RAISE EXCEPTION 'rollback postcondition: hardened legacy quote body drift';
  END IF;
END $postcondition$;

NOTIFY pgrst, 'reload schema';