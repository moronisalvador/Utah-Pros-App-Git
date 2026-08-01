-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260731220000_scheduled_message_delivery_compatibility
-- WHAT THIS DOES: pauses compatibility-era scheduling and delivery while
-- retaining the durable provenance and provider-attempt evidence needed for a
-- safe forward repair. It never restores the raw browser queue or a functional
-- legacy claim.
-- REQUIRED ORDER: run after 20260731220100 rollback if enforcement was applied,
-- and only after web/native/Worker callers no longer require the compatibility RPCs.
-- SAFETY: provider delivery remains fail closed. The durable link columns/index
-- and provenance ledger are deliberately retained; erasing either boundary or
-- restoring a consumer that ignores it could authorize a duplicate send.
-- ═════════════════════════════════════════════════════════════════════════════
DO $scheduled_delivery_compatibility_rollback_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.scheduled_messages
    WHERE status = 'pending'
      AND delivery_attempt_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'scheduled delivery compatibility rollback: unresolved provider reservations require owner reconciliation';
  END IF;
END;
$scheduled_delivery_compatibility_rollback_preflight$;

-- Keep the queue and immutable provenance evidence private. service_role keeps
-- ordinary table access for explicit owner-led reconciliation, but every RPC
-- that could create, claim, reserve, release, fail, or reconcile a delivery is
-- paused below.
REVOKE ALL ON TABLE public.scheduled_messages
  FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_messages
  TO service_role;
REVOKE ALL ON TABLE public.scheduled_message_creation_provenance
  FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT ON TABLE public.scheduled_message_creation_provenance
  TO service_role;

REVOKE ALL ON FUNCTION
  public.create_scheduled_message(uuid,uuid,text,timestamptz),
  public.claim_scheduled_message_v2(uuid,uuid),
  public.release_scheduled_message_claim(uuid,uuid,text),
  public.fail_scheduled_message_claim(uuid,uuid,text),
  public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb),
  public.reconcile_scheduled_message_delivery(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Queue inspection and cancellation remain the exact DevTools-owner contracts
-- created by compatibility. Neither function can create or submit a delivery.
REVOKE ALL ON FUNCTION
  public.cancel_scheduled_message(uuid),
  public.get_scheduled_queue(integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cancel_scheduled_message(uuid),
  public.get_scheduled_queue(integer)
  TO authenticated;

-- Preserve the frozen signature and historical grants for stale callers. It
-- returns FALSE without reading or mutating any scheduled row.
CREATE OR REPLACE FUNCTION public.claim_scheduled_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RETURN false;
END;
$function$;
ALTER FUNCTION public.claim_scheduled_message(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_scheduled_message(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_message(uuid)
  TO authenticated, service_role;

DO $scheduled_delivery_compatibility_rollback_postcondition$
BEGIN
  IF has_table_privilege('authenticated', 'public.scheduled_messages', 'SELECT')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'INSERT')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.scheduled_messages', 'DELETE')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'SELECT')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'INSERT')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'UPDATE')
     OR has_table_privilege('anon', 'public.scheduled_messages', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.scheduled_messages', 'DELETE')
     OR has_table_privilege('authenticated', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('authenticated', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR has_table_privilege('anon', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('anon', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.scheduled_message_creation_provenance', 'SELECT')
     OR has_table_privilege('service_role', 'public.scheduled_message_creation_provenance', 'INSERT')
     OR has_function_privilege(
       'authenticated',
       'public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.create_scheduled_message(uuid,uuid,text,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege('authenticated', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.claim_scheduled_message_v2(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege(
       'service_role',
       'public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege('authenticated', 'public.cancel_scheduled_message(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_scheduled_queue(integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.cancel_scheduled_message(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_scheduled_queue(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'scheduled delivery compatibility rollback: paused ACL postcondition failed';
  END IF;
END;
$scheduled_delivery_compatibility_rollback_postcondition$;
