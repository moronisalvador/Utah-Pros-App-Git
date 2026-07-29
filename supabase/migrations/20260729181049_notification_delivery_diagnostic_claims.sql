-- ============================================================================
-- FILE: 20260729181049_notification_delivery_diagnostic_claims.sql
-- ============================================================================
--
-- WHAT THIS DOES:
--   Adds a service-only claim ledger for the owner notification delivery
--   diagnostic. A stable employee/channel/request identity is claimed before
--   any bell or provider side effect, and a bounded sanitized result is stored
--   so an HTTP retry replays the result instead of delivering twice.
--
-- DEPENDS ON:
--   public.employees(id, role, is_active, is_external)
--
-- ROLLBACK:
--   supabase/rollbacks/20260729181049_notification_delivery_diagnostic_claims.rollback.sql
--
-- NOTES:
--   - Additive only. No deployed notification or preference contract changes.
--   - Browser roles receive no table or function access.
--   - Rows contain only delivery counts/reasons; no recipient address, provider
--     payload, credential, customer data, or notification copy is stored.
-- ============================================================================

CREATE TABLE public.notification_delivery_diagnostic_claims (
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  channel text NOT NULL
    CHECK (channel IN ('bell', 'web_push', 'native_push', 'email')),
  request_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'complete')),
  result jsonb,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (employee_id, channel, request_id),
  CONSTRAINT notification_delivery_diagnostic_result_shape CHECK (
    (
      state = 'pending'
      AND result IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      state = 'complete'
      AND jsonb_typeof(result) = 'object'
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX notification_delivery_diagnostic_claimed_at_idx
  ON public.notification_delivery_diagnostic_claims (claimed_at);

ALTER TABLE public.notification_delivery_diagnostic_claims
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_diagnostic_claims
  FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_delivery_diagnostic_service_select
  ON public.notification_delivery_diagnostic_claims
  FOR SELECT
  TO service_role
  USING (true);
CREATE POLICY notification_delivery_diagnostic_service_insert
  ON public.notification_delivery_diagnostic_claims
  FOR INSERT
  TO service_role
  WITH CHECK (true);
CREATE POLICY notification_delivery_diagnostic_service_update
  ON public.notification_delivery_diagnostic_claims
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
CREATE POLICY notification_delivery_diagnostic_service_delete
  ON public.notification_delivery_diagnostic_claims
  FOR DELETE
  TO service_role
  USING (true);

REVOKE ALL ON TABLE public.notification_delivery_diagnostic_claims
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.notification_delivery_diagnostic_claims
  TO service_role;

CREATE FUNCTION public.claim_notification_delivery_diagnostic(
  p_employee_id uuid,
  p_channel text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_claimed boolean;
  v_state text;
  v_result jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_employee_id IS NULL
     OR p_request_id IS NULL
     OR p_channel NOT IN ('bell', 'web_push', 'native_push', 'email') THEN
    RAISE EXCEPTION 'invalid notification diagnostic claim'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees employee_row
    WHERE employee_row.id = p_employee_id
      AND employee_row.role::text = 'admin'
      AND employee_row.is_active IS TRUE
      AND employee_row.is_external IS FALSE
  ) THEN
    RAISE EXCEPTION 'notification diagnostic owner required'
      USING ERRCODE = '42501';
  END IF;

  WITH expired_claims AS (
    SELECT
      existing_claim.employee_id,
      existing_claim.channel,
      existing_claim.request_id
    FROM public.notification_delivery_diagnostic_claims existing_claim
    WHERE existing_claim.claimed_at < now() - interval '90 days'
    ORDER BY existing_claim.claimed_at
    LIMIT 1000
  )
  DELETE FROM public.notification_delivery_diagnostic_claims existing_claim
  USING expired_claims
  WHERE existing_claim.employee_id = expired_claims.employee_id
    AND existing_claim.channel = expired_claims.channel
    AND existing_claim.request_id = expired_claims.request_id;

  INSERT INTO public.notification_delivery_diagnostic_claims (
    employee_id,
    channel,
    request_id
  )
  VALUES (
    p_employee_id,
    p_channel,
    p_request_id
  )
  ON CONFLICT (employee_id, channel, request_id) DO NOTHING
  RETURNING true INTO v_claimed;

  IF COALESCE(v_claimed, false) THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'state', 'pending'
    );
  END IF;

  SELECT existing_claim.state, existing_claim.result
  INTO v_state, v_result
  FROM public.notification_delivery_diagnostic_claims existing_claim
  WHERE existing_claim.employee_id = p_employee_id
    AND existing_claim.channel = p_channel
    AND existing_claim.request_id = p_request_id;

  RETURN jsonb_build_object(
    'claimed', false,
    'state', COALESCE(v_state, 'pending'),
    'result', v_result
  );
END;
$function$;

CREATE FUNCTION public.complete_notification_delivery_diagnostic(
  p_employee_id uuid,
  p_channel text,
  p_request_id uuid,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_employee_id IS NULL
     OR p_request_id IS NULL
     OR p_channel NOT IN ('bell', 'web_push', 'native_push', 'email')
     OR p_result IS NULL
     OR jsonb_typeof(p_result) <> 'object'
     OR NOT (p_result ?& ARRAY[
       'channel',
       'ok',
       'sent',
       'attempted',
       'pruned'
     ]::text[])
     OR (p_result - ARRAY[
       'channel',
       'ok',
       'sent',
       'attempted',
       'pruned',
       'reason'
     ]::text[]) <> '{}'::jsonb
     OR p_result->>'channel' IS DISTINCT FROM p_channel
     OR jsonb_typeof(p_result->'ok') <> 'boolean'
     OR jsonb_typeof(p_result->'sent') <> 'number'
     OR jsonb_typeof(p_result->'attempted') <> 'number'
     OR jsonb_typeof(p_result->'pruned') <> 'number'
     OR COALESCE((p_result->>'sent')::numeric, -1) < 0
     OR COALESCE((p_result->>'attempted')::numeric, -1) < 0
     OR COALESCE((p_result->>'pruned')::numeric, -1) < 0
     OR (
       p_result ? 'reason'
       AND (
         jsonb_typeof(p_result->'reason') <> 'string'
         OR length(p_result->>'reason') NOT BETWEEN 1 AND 80
       )
     ) THEN
    RAISE EXCEPTION 'invalid notification diagnostic result'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.notification_delivery_diagnostic_claims existing_claim
  SET
    state = 'complete',
    result = p_result,
    completed_at = now()
  WHERE existing_claim.employee_id = p_employee_id
    AND existing_claim.channel = p_channel
    AND existing_claim.request_id = p_request_id
    AND existing_claim.state = 'pending'
  RETURNING existing_claim.result INTO v_result;

  IF v_result IS NULL THEN
    SELECT existing_claim.result
    INTO v_result
    FROM public.notification_delivery_diagnostic_claims existing_claim
    WHERE existing_claim.employee_id = p_employee_id
      AND existing_claim.channel = p_channel
      AND existing_claim.request_id = p_request_id
      AND existing_claim.state = 'complete';
  END IF;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'notification diagnostic claim missing'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'result', v_result
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_notification_delivery_diagnostic(
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery_diagnostic(
  uuid,
  text,
  uuid
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_notification_delivery_diagnostic(
  uuid,
  text,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery_diagnostic(
  uuid,
  text,
  uuid,
  jsonb
) TO service_role;
