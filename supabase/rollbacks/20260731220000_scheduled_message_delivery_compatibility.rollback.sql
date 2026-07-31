-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260731220000_scheduled_message_delivery_compatibility
-- WHAT THIS DOES: restores the exact broad legacy queue and claim bodies, and
-- drops the additive reservation RPCs introduced by 31220000.
-- REQUIRED ORDER: run after 20260731220100 rollback if enforcement was applied,
-- and only after web/native/Worker callers no longer require the compatibility RPCs.
-- SAFETY: the durable link columns/index are deliberately retained. Erasing a
-- provider reservation would make a later legacy worker capable of resending it.
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

DROP FUNCTION IF EXISTS public.reconcile_scheduled_message_delivery(uuid);
DROP FUNCTION IF EXISTS public.reserve_scheduled_message_delivery(uuid,uuid,uuid,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.fail_scheduled_message_claim(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.release_scheduled_message_claim(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.claim_scheduled_message_v2(uuid,uuid);
DROP FUNCTION IF EXISTS public.cancel_scheduled_message(uuid);
DROP FUNCTION IF EXISTS public.create_scheduled_message(uuid,uuid,text,timestamptz);
CREATE OR REPLACE FUNCTION public.claim_scheduled_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_claimed boolean;
BEGIN
  UPDATE public.scheduled_messages
  SET claimed_at = now()
  WHERE id = p_id
    AND status = 'pending'
    AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_scheduled_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_message(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.get_scheduled_queue(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, body text, send_at timestamptz, status text, contact_name text, contact_phone text, template_name text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $$
  SELECT sm.id, sm.body, sm.send_at, sm.status, COALESCE(c.name, cp.phone), cp.phone, mt.title
  FROM scheduled_messages sm LEFT JOIN conversations conv ON sm.conversation_id = conv.id
  LEFT JOIN conversation_participants cp ON cp.conversation_id = conv.id AND cp.is_active = true
  LEFT JOIN contacts c ON cp.contact_id = c.id LEFT JOIN message_templates mt ON sm.template_id = mt.id
  ORDER BY sm.send_at ASC LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.get_scheduled_queue(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scheduled_queue(integer) TO authenticated, service_role;
