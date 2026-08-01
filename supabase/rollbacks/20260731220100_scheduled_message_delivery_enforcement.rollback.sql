-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260731220100_scheduled_message_delivery_enforcement
-- WHAT THIS DOES: restores only the 31220000 compatibility signature for an
-- emergency caller rollback. The legacy signature stays fail-closed, while raw
-- browser table access and provenance enforcement remain sealed.
-- REQUIRED ORDER: callers may remain on the 31220000 compatibility seam. Do not
-- use this as a normal rollout reversal; reapply enforcement after remediation.
-- ═════════════════════════════════════════════════════════════════════════════
DO $scheduled_delivery_enforcement_rollback_preflight$
BEGIN
  IF has_function_privilege('authenticated', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'SELECT')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'INSERT')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'DELETE')
     OR EXISTS (
       SELECT 1
       FROM public.scheduled_messages
       WHERE status = 'pending'
         AND delivery_attempt_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'scheduled delivery enforcement rollback: expected enforced ACL is absent';
  END IF;
END;
$scheduled_delivery_enforcement_rollback_preflight$;

-- Do not recreate the three historical permissive policies or any browser table
-- ACL. Compatibility already supplied actor-derived browser RPCs and a
-- provenance-checked v2 delivery path; restoring raw writes would allow rows
-- without a trusted ledger record to re-enter the send workflow.
REVOKE ALL ON TABLE public.scheduled_messages FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_messages TO service_role;
REVOKE ALL ON TABLE public.scheduled_message_creation_provenance
  FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT ON TABLE public.scheduled_message_creation_provenance TO service_role;

-- Restore only the compatibility-era callable signature. It intentionally
-- raises before reading or updating a scheduled row, so no stale worker can
-- bypass claim_scheduled_message_v2's provenance predicate.
CREATE OR REPLACE FUNCTION public.claim_scheduled_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'claim_scheduled_message is disabled; deploy the fenced scheduled worker'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_scheduled_message(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_message(uuid) TO service_role;

DO $scheduled_delivery_enforcement_rollback_postcondition$
BEGIN
  IF has_table_privilege('authenticated', 'public.scheduled_messages', 'SELECT')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'INSERT')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'DELETE')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'SELECT')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'INSERT')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'UPDATE')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'DELETE')
     OR has_table_privilege('authenticated', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('authenticated', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR has_table_privilege('anon', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('anon', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('service_role', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR has_function_privilege('authenticated', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_scheduled_message_v2(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_scheduled_message_v2(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'scheduled delivery enforcement rollback: safe compatibility ACL postcondition failed';
  END IF;
END;
$scheduled_delivery_enforcement_rollback_postcondition$;
