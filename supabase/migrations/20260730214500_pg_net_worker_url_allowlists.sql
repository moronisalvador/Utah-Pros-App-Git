-- ════════════════════════════════════════════════
-- MIGRATION: 20260730214500_pg_net_worker_url_allowlists
-- Phase: n/a (standalone hardening from the 2026-07-30 push-outage audit)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Two database functions call our own web workers at a URL stored in the
--   integration_config settings table: the Google-Calendar sync notifier and
--   the notification emitter. Until now each would call WHATEVER address that
--   setting contained. This change makes both refuse to call anything except
--   the two real UPR addresses (the dev site and the production site) — the
--   exact same guard the four newer "wake" functions already have. Each also
--   now skips the call when the shared secret is missing, because the worker
--   on the other end rejects a blank secret anyway.
--
-- FUNCTION-BODY-ONLY / additive:
--   Yes — two CREATE OR REPLACE function-body replaces. No table
--   DROP/RENAME/ALTER COLUMN, no data change, no new object, no policy
--   change. Both signatures, return types, owners and effective grants are
--   unchanged (the REVOKE/GRANT below only re-declares the existing posture,
--   required because this managed project re-grants EXECUTE TO PUBLIC on
--   every function DDL — database-standard.md §1).
--
-- BEHAVIOR DELTA (the only one):
--   A worker URL outside the two-entry allowlist, or a missing/blank
--   companion secret, now results in a silent no-op instead of an outbound
--   pg_net POST. Evidence the secret gate is behavior-preserving:
--   functions/api/google-calendar-sync.js:42-47 and the
--   authorizeNotifyRequest branch of functions/api/notify.js:686-696 both
--   return 401 for a blank x-webhook-secret, so those calls never succeeded.
--
-- CONTEXT:
--   2026-07-30: message_notification_outbox_worker_url pointed at
--   dev.utahpros.app and production pushes died against Preview env vars.
--   The audit that followed found these two callers accept arbitrary URLs —
--   a rewritten integration_config row would turn a SECURITY DEFINER pg_net
--   caller into an SSRF vector that also leaks the webhook secret header.
--   Registry + ops audit: docs/database/integration-config-worker-urls.md.
--
-- ── DEFERRED ──
--   notify_google_calendar_sync keeps its live `authenticated` EXECUTE grant
--   (from 20260708_dbf_p3). Repo-wide grep finds no browser caller — only the
--   SECURITY DEFINER trigger functions call it — so tightening it to
--   service-role-only is a candidate ACL-only change, but that is a separate
--   reviewed grant change, not smuggled into this body-only migration.
--   The two transcribe-call pg_cron command strings
--   (20260722_crm_calls_classification_cron.sql) inline the same
--   config-driven net.http_post with no allowlist; hardening a cron command
--   string needs cron.alter/unschedule+reschedule, a different shape from a
--   function-body replace, and is deferred to its own change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260730214500_pg_net_worker_url_allowlists.rollback.sql
--   restores the exact prior bodies (20260630_client_appointment_notifications
--   and 20260728224000_native_push_delivery_guardrails) and re-declares the
--   same ACLs, with its own drift preflight/postcondition. Rolling back
--   reopens the config-driven arbitrary-URL surface this migration closes —
--   prefer a forward fix of the allowlist entries if a URL must change.
-- ════════════════════════════════════════════════

-- Drift guard: refuse to apply over anything but the reviewed live bodies.
-- notify_emit's expected md5 is independently confirmed by the
-- 20260728224000 rollback preflight (same value). notify_google_calendar_sync's
-- is computed from the 20260630 migration source; if the live body ever
-- diverged from that file, this apply stops here — inspect before proceeding.
DO $allowlist_preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_overloads integer;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.notify_google_calendar_sync(uuid,text,jsonb)',
          'notify_google_calendar_sync',
          '9c97af19a10e688964bc830f9d11c160',
          true
        ),
        (
          'public.notify_emit(text,jsonb)',
          'notify_emit',
          '3f972d71b7995dd7787ef6ff2fb76872',
          false
        )
    ) AS expected(identity, function_name, body_md5, authenticated_execute)
  LOOP
    SELECT count(*)
    INTO v_overloads
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = v_expected.function_name;
    IF v_overloads IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'worker-URL allowlist preflight: % overloads of % (expected exactly 1)',
        v_overloads, v_expected.function_name;
    END IF;

    v_oid := to_regprocedure(v_expected.identity);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        'worker-URL allowlist preflight: missing %', v_expected.identity;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc function_record
      WHERE function_record.oid = v_oid
        AND pg_get_userbyid(function_record.proowner) = 'postgres'
        AND function_record.prosecdef
        AND function_record.proconfig = ARRAY['search_path=public']::text[]
        AND md5(function_record.prosrc) = v_expected.body_md5
    ) THEN
      RAISE EXCEPTION
        'worker-URL allowlist preflight: contract drift for % (live body md5 %)',
        v_expected.identity,
        (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid);
    END IF;

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            IS DISTINCT FROM v_expected.authenticated_execute
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'worker-URL allowlist preflight: grant drift for % (anon=%, authenticated=%, service_role=%)',
        v_expected.identity,
        has_function_privilege('anon', v_oid, 'EXECUTE'),
        has_function_privilege('authenticated', v_oid, 'EXECUTE'),
        has_function_privilege('service_role', v_oid, 'EXECUTE');
    END IF;
  END LOOP;
END;
$allowlist_preflight$;

-- ─── 1. Google-Calendar sync notifier ───
-- Identical to the 20260630 body except the config gate: the NULL/blank URL
-- check becomes the exact two-URL allowlist + secret-presence check used by
-- the outbox / ops-health / CallRail-recovery / QBO-payments wake functions.
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
  IF NOT EXISTS (
    SELECT 1 FROM user_google_accounts
    WHERE refresh_token IS NOT NULL AND scopes ILIKE '%calendar%'
  ) THEN RETURN; END IF;

  SELECT value INTO v_worker_url FROM integration_config WHERE key = 'gcal_worker_url';
  SELECT value INTO v_secret     FROM integration_config WHERE key = 'gcal_webhook_secret';

  -- Exact UPR worker-URL allowlist: a rewritten integration_config row must
  -- never turn this SECURITY DEFINER pg_net caller into an SSRF vector (or
  -- leak the webhook secret to a third-party host). A blank secret is refused
  -- here because the worker 401s it anyway.
  IF v_worker_url IS NULL OR v_worker_url NOT IN (
    'https://dev.utahpros.app/api/google-calendar-sync',
    'https://utahpros.app/api/google-calendar-sync'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  v_body := jsonb_build_object('source_type', 'appointment', 'source_id', p_source_id, 'op', p_op);
  IF p_cancel IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('cancel_client', p_cancel);
  END IF;

  PERFORM net.http_post(
    url     := v_worker_url,
    body    := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret)
  );
END;
$$;

-- Managed-Supabase function trap (database-standard.md §1): every function
-- DDL re-grants EXECUTE TO PUBLIC at ddl_command_end, so the prior posture
-- must be explicitly re-declared. This is the SAME effective ACL as before
-- (20260708_dbf_p3): PUBLIC/anon denied, authenticated + service_role kept.
REVOKE EXECUTE ON FUNCTION public.notify_google_calendar_sync(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_google_calendar_sync(uuid, text, jsonb) TO authenticated, service_role;

-- ─── 2. Notification emitter ───
-- Identical to the 20260728224000 body except the config gate, same as above.
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

  -- Exact UPR worker-URL allowlist: a rewritten integration_config row must
  -- never turn this SECURITY DEFINER pg_net caller into an SSRF vector (or
  -- leak the webhook secret to a third-party host). A blank secret is refused
  -- here because authorizeNotifyRequest 401s it anyway.
  IF v_url IS NULL OR v_url NOT IN (
    'https://dev.utahpros.app/api/notify',
    'https://utahpros.app/api/notify'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

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
      v_secret
    )
  );
END;
$function$;

-- Same trap, same re-declaration of the existing posture (20260728224000):
-- PUBLIC/anon/authenticated denied, service_role only.
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb) TO service_role;

-- Postcondition: the replaced bodies landed exactly as reviewed and the
-- effective grants are unchanged from the preflight expectation.
DO $allowlist_postflight$
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
          '9c12900f57b2516170dc374b5a63cc23',
          true
        ),
        (
          'public.notify_emit(text,jsonb)',
          'c72e0f7fd40a4abec42cce1cd912a45b',
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
        AND function_record.prosrc LIKE '%NOT IN (%'
        AND function_record.prosrc LIKE '%https://utahpros.app/api/%'
    )
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            IS DISTINCT FROM v_expected.authenticated_execute
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'worker-URL allowlist postcondition failed for % (live body md5 %, anon=%, authenticated=%, service_role=%)',
        v_expected.identity,
        (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid),
        has_function_privilege('anon', v_oid, 'EXECUTE'),
        has_function_privilege('authenticated', v_oid, 'EXECUTE'),
        has_function_privilege('service_role', v_oid, 'EXECUTE');
    END IF;
  END LOOP;
END;
$allowlist_postflight$;
