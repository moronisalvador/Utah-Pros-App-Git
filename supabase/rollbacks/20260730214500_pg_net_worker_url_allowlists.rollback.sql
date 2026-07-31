-- ═══════════════════════════════════════════════════════════════════════════════
-- EMERGENCY ROLLBACK: 20260730214500_pg_net_worker_url_allowlists
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Restores the exact recaptured pre-allowlist bodies of
-- notify_google_calendar_sync (current production baseline) and notify_emit
-- (20260728224000_native_push_delivery_guardrails), while preserving the
-- forward migration's service-role-only ACL hardening.
--
-- WARNING: this rollback REOPENS the config-driven arbitrary-URL surface —
-- after running it, a rewritten integration_config row can again point either
-- pg_net caller at any host, carrying the webhook secret header with it. If
-- the problem is that a legitimate worker URL changed, prefer a reviewed
-- forward migration that updates the allowlist entries instead.
--
-- The gcal notifier's ACL tightening is deliberately NOT reversed here: its
-- only callers are the owner-executed SECURITY DEFINER trigger functions, so
-- no live caller needs authenticated EXECUTE back. To ALSO reopen it (not
-- recommended — pre-20260730214500 posture, zero functional benefit):
--   GRANT EXECUTE ON FUNCTION public.notify_google_calendar_sync(uuid, text, jsonb) TO authenticated;
--
-- No trigger, caller, schedule, table, row, policy, URL row, secret, header
-- or setting is changed by either direction.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Refuse to overwrite anything but the reviewed allowlisted bodies.
DO $allowlist_rollback_preflight$
DECLARE
  v_expected record;
  v_oid oid;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.notify_google_calendar_sync(uuid,text,jsonb)',
          '07ee1574e28447ddae2c868a841eb2d8',
          false
        ),
        (
          'public.notify_emit(text,jsonb)',
          'c72e0f7fd40a4abec42cce1cd912a45b',
          false
        )
    ) AS expected(identity, body_md5, authenticated_execute)
  LOOP
    v_oid := to_regprocedure(v_expected.identity);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        'worker-URL allowlist rollback preflight: missing %', v_expected.identity;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc function_record
      WHERE function_record.oid = v_oid
        AND pg_get_userbyid(function_record.proowner) = 'postgres'
        AND function_record.prosecdef
        AND function_record.proconfig = ARRAY['search_path=public']::text[]
        AND md5(function_record.prosrc) = v_expected.body_md5
    )
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            IS DISTINCT FROM v_expected.authenticated_execute
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'worker-URL allowlist rollback preflight drift for % (live body md5 %)',
        v_expected.identity,
        (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid);
    END IF;
  END LOOP;
END;
$allowlist_rollback_preflight$;

-- ─── 1. notify_google_calendar_sync — exact pre-allowlist live body ───
CREATE OR REPLACE FUNCTION public.notify_google_calendar_sync(p_source_id UUID, p_op TEXT, p_cancel JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_url TEXT;
  v_secret     TEXT;
  v_body       JSONB;
BEGIN
  IF p_source_id IS NULL THEN RETURN; END IF;
  -- Inert until at least one employee has connected Google Calendar (the writer).
  IF NOT EXISTS (
    SELECT 1 FROM user_google_accounts
    WHERE refresh_token IS NOT NULL AND scopes ILIKE '%calendar%'
  ) THEN RETURN; END IF;

  SELECT value INTO v_worker_url FROM integration_config WHERE key = 'gcal_worker_url';
  SELECT value INTO v_secret     FROM integration_config WHERE key = 'gcal_webhook_secret';
  IF v_worker_url IS NULL OR btrim(v_worker_url) = '' THEN RETURN; END IF;

  v_body := jsonb_build_object('source_type', 'appointment', 'source_id', p_source_id, 'op', p_op);
  IF p_cancel IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('cancel_client', p_cancel);
  END IF;

  PERFORM net.http_post(
    url     := v_worker_url,
    body    := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', COALESCE(v_secret, ''))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_google_calendar_sync(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_google_calendar_sync(uuid, text, jsonb)
  TO service_role;

-- ─── 2. notify_emit — exact 20260728224000 body ───
CREATE OR REPLACE FUNCTION public.notify_emit(
  p_type_key text,
  p_body jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled boolean;
  v_url text;
  v_secret text;
BEGIN
  IF p_type_key IS NULL THEN RETURN; END IF;
  SELECT enabled
  INTO v_enabled
  FROM public.notification_types
  WHERE type_key = p_type_key;
  IF v_enabled IS NOT TRUE THEN RETURN; END IF;

  SELECT value
  INTO v_url
  FROM public.integration_config
  WHERE key = 'notify_worker_url';
  SELECT value
  INTO v_secret
  FROM public.integration_config
  WHERE key = 'notify_webhook_secret';
  IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url,
    body := COALESCE(p_body, '{}'::jsonb) || jsonb_build_object(
      'notification_event_id',
      gen_random_uuid(),
      'type_key',
      p_type_key
    ),
    headers := jsonb_build_object(
      'Content-Type',
      'application/json',
      'x-webhook-secret',
      COALESCE(v_secret, '')
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb) TO service_role;

-- Postcondition: the restored bodies are byte-exact to their source
-- migrations and the ACLs are unchanged.
DO $allowlist_rollback_postcondition$
DECLARE
  v_expected record;
  v_oid oid;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.notify_google_calendar_sync(uuid,text,jsonb)',
          'd1dcb8230af897aec350df9364d1bf84',
          false
        ),
        (
          'public.notify_emit(text,jsonb)',
          '3f972d71b7995dd7787ef6ff2fb76872',
          false
        )
    ) AS expected(identity, body_md5, authenticated_execute)
  LOOP
    v_oid := to_regprocedure(v_expected.identity);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc function_record
      WHERE function_record.oid = v_oid
        AND pg_get_userbyid(function_record.proowner) = 'postgres'
        AND function_record.prosecdef
        AND function_record.proconfig = ARRAY['search_path=public']::text[]
        AND md5(function_record.prosrc) = v_expected.body_md5
    )
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            IS DISTINCT FROM v_expected.authenticated_execute
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'worker-URL allowlist rollback postcondition failed for % (live body md5 %)',
        v_expected.identity,
        (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid);
    END IF;
  END LOOP;
END;
$allowlist_rollback_postcondition$;

COMMIT;
