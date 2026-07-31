-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260731220100_scheduled_message_delivery_enforcement
-- WHAT THIS DOES: intentionally restores the earlier broad scheduled table and
-- legacy claim posture for an emergency caller rollback; investigate immediately.
-- REQUIRED ORDER: callers may remain on the 31220000 compatibility seam. Do not
-- use this as a normal rollout reversal; reapply enforcement after remediation.
-- ═════════════════════════════════════════════════════════════════════════════
DO $scheduled_delivery_enforcement_rollback_preflight$
BEGIN
  IF has_function_privilege('authenticated', 'public.claim_scheduled_message(uuid)', 'EXECUTE')
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

CREATE POLICY allow_anon_read_scheduled_messages ON public.scheduled_messages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY allow_anon_insert_scheduled_messages ON public.scheduled_messages
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY allow_authenticated_scheduled_messages ON public.scheduled_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.scheduled_messages TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_scheduled_message(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_claimed boolean;
BEGIN
  UPDATE public.scheduled_messages SET claimed_at = now()
  WHERE id = p_id AND status = 'pending'
    AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_scheduled_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_message(uuid) TO authenticated, service_role;
