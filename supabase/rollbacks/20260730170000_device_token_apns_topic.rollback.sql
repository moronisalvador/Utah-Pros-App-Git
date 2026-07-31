-- ════════════════════════════════════════════════
-- ROLLBACK: 20260730170000_device_token_apns_topic
-- ════════════════════════════════════════════════
--
-- Restores the reviewed 20260728223000 function BODY — topic validation,
-- topic write, and the returned topic field are removed — under the SAME
-- three-parameter signature. The trailing p_apns_topic parameter is accepted
-- and ignored so a deployed client that passes it keeps enrolling; restoring
-- the two-parameter identity would refuse those calls (PostgREST PGRST202),
-- which is the same deployed-contract break this migration avoids forward.
--
-- Kept in place deliberately:
--   - the apns_topic column, its check constraint, and any recorded values
--     (dropping a live column is the removal database-standard.md §3 forbids;
--     clearing values would be a separate bounded data repair);
--   - the tightened grant posture (authenticated + service_role only).
-- The delivery worker's rollback is its own code revert; while this rollback
-- is live, new/updated rows record NULL and the env APNS_TOPIC fallback
-- governs delivery for them.

DROP FUNCTION public.upsert_my_native_device_token(text, text, text);

CREATE FUNCTION public.upsert_my_native_device_token(
  p_token text,
  p_apns_environment text,
  p_apns_topic text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_employee_id uuid;
  v_row public.device_tokens%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_token), '') IS NULL
     OR length(p_token) > 4096
     OR p_apns_environment IS NULL
     OR p_apns_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION
      'token and an exact APNs environment are required'
      USING errcode = '22023';
  END IF;

  SELECT employee.id
  INTO v_employee_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active IS TRUE
    AND employee.is_external IS FALSE
    AND employee.role::text IN (
      'admin',
      'office',
      'project_manager',
      'field_tech',
      'estimator',
      'supervisor'
    )
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  INSERT INTO public.device_tokens (
    employee_id,
    token,
    platform,
    apns_environment
  )
  VALUES (
    v_employee_id,
    btrim(p_token),
    'ios',
    p_apns_environment
  )
  ON CONFLICT (token)
  DO UPDATE SET
    platform = 'ios',
    apns_environment = EXCLUDED.apns_environment,
    updated_at = now()
  WHERE device_tokens.employee_id = EXCLUDED.employee_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: device token belongs to another employee'
      USING errcode = '42501';
  END IF;

  -- Bound one employee/environment to the five newest installations. The
  -- delivery worker uses the same cap, so one account cannot hold a Worker open
  -- across an unbounded sequence of APNs calls.
  DELETE FROM public.device_tokens stale_token
  WHERE stale_token.id IN (
    SELECT ranked.id
    FROM (
      SELECT
        token_row.id,
        row_number() OVER (
          ORDER BY token_row.updated_at DESC, token_row.id DESC
        ) AS position
      FROM public.device_tokens token_row
      WHERE token_row.employee_id = v_employee_id
        AND token_row.platform = 'ios'
        AND token_row.apns_environment = p_apns_environment
    ) ranked
    WHERE ranked.position > 5
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'platform', v_row.platform,
    'apns_environment', v_row.apns_environment,
    'updated_at', v_row.updated_at
  );
END;
$function$;

ALTER FUNCTION public.upsert_my_native_device_token(text, text, text)
  OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text, text)
  TO authenticated, service_role;
