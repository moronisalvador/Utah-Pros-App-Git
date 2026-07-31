-- ════════════════════════════════════════════════
-- MIGRATION: 20260731220100_scheduled_message_delivery_enforcement
-- Phase: Conversation participant safety — scheduled-message hardening
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the browser's ability to edit or read the scheduled-text queue
--   directly. Old sending jobs then stop safely, while the reviewed browser and
--   server functions become the only ways to create, inspect, or deliver rows.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Authorization-only policy/grant closure plus a fail-closed replacement of
--   the frozen legacy claim body. No table/column or existing-data change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run
--   supabase/rollbacks/20260731220100_scheduled_message_delivery_enforcement.rollback.sql
--   only after its unresolved-reservation preflight passes. That emergency
--   rollback deliberately restores the former broad caller posture.
-- ════════════════════════════════════════════════
--
-- ROLLOUT ORDER: apply only after 20260731220000 and all web/native/Worker
-- callers are deployed and verified. Never apply during a mixed-client window.

DO $scheduled_delivery_enforcement_preflight$
DECLARE v_policy record;
BEGIN
  IF to_regprocedure('public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.cancel_scheduled_message(uuid)') IS NULL
     OR to_regprocedure('public.claim_scheduled_message_v2(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.reconcile_scheduled_message_delivery(uuid)') IS NULL THEN
    RAISE EXCEPTION 'scheduled delivery enforcement: compatibility RPCs are absent';
  END IF;
  FOR v_policy IN SELECT * FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'scheduled_messages'
  LOOP
    IF v_policy.policyname NOT IN ('allow_anon_read_scheduled_messages', 'allow_anon_insert_scheduled_messages', 'allow_authenticated_scheduled_messages')
       OR v_policy.roles <> ARRAY['authenticated']::name[]
       OR (v_policy.policyname = 'allow_anon_read_scheduled_messages'
           AND (v_policy.cmd <> 'SELECT' OR regexp_replace(COALESCE(v_policy.qual, ''), '\s+', '', 'g') <> 'true' OR v_policy.with_check IS NOT NULL))
       OR (v_policy.policyname = 'allow_anon_insert_scheduled_messages'
           AND (v_policy.cmd <> 'INSERT' OR v_policy.qual IS NOT NULL OR regexp_replace(COALESCE(v_policy.with_check, ''), '\s+', '', 'g') <> 'true'))
       OR (v_policy.policyname = 'allow_authenticated_scheduled_messages'
           AND (v_policy.cmd <> 'ALL' OR regexp_replace(COALESCE(v_policy.qual, ''), '\s+', '', 'g') <> 'true' OR regexp_replace(COALESCE(v_policy.with_check, ''), '\s+', '', 'g') <> 'true')) THEN
      RAISE EXCEPTION 'scheduled delivery enforcement: unexpected scheduled_messages policy %', v_policy.policyname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='scheduled_messages') <> 3
     OR NOT has_table_privilege('authenticated', 'public.scheduled_messages', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.scheduled_messages', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.scheduled_messages', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.scheduled_messages', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'SELECT')
     OR has_function_privilege('authenticated', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_scheduled_message(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'scheduled delivery enforcement: legacy policy or ACL baseline drifted';
  END IF;
END;
$scheduled_delivery_enforcement_preflight$;

DROP POLICY allow_anon_read_scheduled_messages ON public.scheduled_messages;
DROP POLICY allow_anon_insert_scheduled_messages ON public.scheduled_messages;
DROP POLICY allow_authenticated_scheduled_messages ON public.scheduled_messages;
-- Both hosted catalogs were read-only verified on 2026-07-31: the policies are
-- authenticated-only, but legacy table ACLs still include anon. Tighter anon
-- drift is safe, so the preflight does not require those grants to exist; this
-- unconditional revoke and the postcondition close either baseline.
REVOKE ALL ON TABLE public.scheduled_messages FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_messages TO service_role;

-- Preserve the frozen signature for stale workers, but ensure it fails before
-- it can claim a row or trigger a provider send. The v2 fenced workflow is the
-- only service execution path after this migration.
CREATE OR REPLACE FUNCTION public.claim_scheduled_message(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
BEGIN
  RAISE EXCEPTION 'claim_scheduled_message is retired; use claim_scheduled_message_v2'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_scheduled_message(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Browser functions retain only their narrowly actor-derived contracts.
REVOKE ALL ON FUNCTION public.create_scheduled_message(uuid,uuid,text,timestamptz), public.cancel_scheduled_message(uuid), public.get_scheduled_queue(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_scheduled_message(uuid,uuid,text,timestamptz), public.cancel_scheduled_message(uuid), public.get_scheduled_queue(integer) TO authenticated;

DO $scheduled_delivery_enforcement_postcondition$
BEGIN
  IF has_table_privilege('authenticated', 'public.scheduled_messages', 'SELECT')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'INSERT')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'DELETE')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'TRIGGER')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'SELECT')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'INSERT')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'UPDATE')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'DELETE')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'REFERENCES')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'TRIGGER')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'DELETE')
     OR has_table_privilege('service_role', 'public.scheduled_messages', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.scheduled_messages', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.scheduled_messages', 'TRIGGER')
     OR has_function_privilege('authenticated', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.cancel_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_scheduled_queue(integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cancel_scheduled_message(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_scheduled_queue(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_scheduled_message_v2(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_scheduled_message_v2(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_scheduled_message_v2(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'scheduled delivery enforcement: ACL postcondition failed';
  END IF;
END;
$scheduled_delivery_enforcement_postcondition$;
