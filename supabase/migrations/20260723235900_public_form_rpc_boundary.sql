-- ═══════════════════════════════════════════════════════════════════════════════
-- 20260723235900_public_form_rpc_boundary.sql
--
-- WHAT:
--   Make upsert_lead_from_form service-role-only without changing its signature or body.
--
-- WHY:
--   The public form and shared-secret Webflow Workers already use the service-role client and enforce
--   published schema, spam/rate/Turnstile checks, consent evidence, and webhook authentication.
--   Direct PUBLIC/anon/authenticated execution bypasses those controls on a SECURITY DEFINER writer.
--
-- TABLES + RPCS:
--   RPC ACL only → public.upsert_lead_from_form(uuid,text,jsonb,jsonb,boolean,text,text,uuid)
--   Tables/functions/body/return shape → unchanged
--
-- APPLY:
--   Shared-production migration. Apply only from reviewed dev in a serialized, owner-authorized
--   window, then run supabase/tests/public_form_rpc_boundary_post_apply.sql.
--
-- ROLLBACK:
--   See supabase/rollbacks/20260723235900_public_form_rpc_boundary.rollback.sql. It restores the
--   exact legacy grants but re-opens the bypass, so use only for an owner-approved emergency after
--   confirming a deployed direct browser caller that repository inventory did not find.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_oid oid;
  v_overloads integer;
  v_security_definer boolean;
  v_result text;
  v_config text[];
BEGIN
  SELECT count(*)
    INTO v_overloads
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'upsert_lead_from_form';

  IF v_overloads IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'public form boundary preflight failed: expected one upsert_lead_from_form overload, found %',
      v_overloads;
  END IF;

  v_oid := to_regprocedure(
    'public.upsert_lead_from_form(uuid,text,jsonb,jsonb,boolean,text,text,uuid)'
  );
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'public form boundary preflight failed: frozen function signature is missing';
  END IF;

  SELECT p.prosecdef, pg_get_function_result(p.oid), p.proconfig
    INTO v_security_definer, v_result, v_config
  FROM pg_proc p
  WHERE p.oid = v_oid;

  IF v_security_definer IS DISTINCT FROM true
     OR v_result IS DISTINCT FROM 'inbound_leads'
     OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
    RAISE EXCEPTION
      'public form boundary preflight failed: live function contract drifted';
  END IF;

  IF has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'public form boundary preflight failed: trusted service_role caller lacks EXECUTE';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_lead_from_form(
  uuid, text, jsonb, jsonb, boolean, text, text, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_lead_from_form(
  uuid, text, jsonb, jsonb, boolean, text, text, uuid
) TO service_role;

COMMIT;
