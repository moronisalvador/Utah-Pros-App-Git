-- ═════════════════════════════════════════════════════════════════════════════
-- Notification Center — Phase C: my-preferences RPC stub fills (body-only)
--   docs/notify-roadmap.md, "Session C — My-prefs UI".
--
-- Fills the THREE Session C frozen stubs shipped by F2 (20260703_notify_f2_
-- foundation.sql). Signatures are FROZEN — this migration changes ONLY the
-- function bodies (CREATE OR REPLACE, identical arg lists); migration-safety-
-- checker fails any signature change. Zero schema: no tables, columns, or
-- policies are touched.
--
--   1. get_my_notification_prefs(p_employee_id) — the self-service view of the
--      effective matrix, scoped to types that are actually LIVE (enabled=true).
--      It reads THROUGH the frozen resolver get_effective_notification_prefs, so
--      the three-layer precedence + the user_customizable lock live in exactly
--      one place (never re-implemented here).
--   2. set_my_notification_pref(...) — upsert the caller's own pref for one
--      (type, channel), but REFUSE when an admin locked that cell
--      (role default user_customizable=false). The lock check mirrors the
--      resolver's COALESCE(user_customizable, true): a missing role default is
--      customizable.
--   3. get_my_push_subscriptions(p_employee_id) — list this employee's registered
--      push devices for the device manager. NEVER returns the send-capability
--      secrets (endpoint / p256dh / auth) — only a friendly label, when it was
--      added, and a short one-way SHA-256 hash of the endpoint (so the client can
--      recognise "this device" without ever seeing the raw endpoint).
--
-- One shared Supabase across dev + main — live in both the moment it applies.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. get_my_notification_prefs — resolver-backed, live types only ───
CREATE OR REPLACE FUNCTION public.get_my_notification_prefs(p_employee_id uuid)
RETURNS SETOF json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r
    FROM public.get_effective_notification_prefs(p_employee_id) AS r
   WHERE COALESCE((r->>'type_enabled')::boolean, false) = true;
$$;

-- ─── 2. set_my_notification_pref — own-pref upsert, lock-aware ───
CREATE OR REPLACE FUNCTION public.set_my_notification_pref(
  p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean)
RETURNS public.notification_prefs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role        text;
  v_customizable boolean;
  v_row         public.notification_prefs;
BEGIN
  IF p_channel NOT IN ('bell', 'push', 'email') THEN
    RAISE EXCEPTION 'invalid channel: %', p_channel;
  END IF;

  SELECT role::text INTO v_role FROM public.employees WHERE id = p_employee_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'unknown employee: %', p_employee_id;
  END IF;

  -- The role default's user_customizable flag governs whether this cell may be
  -- self-edited. Missing role default ⇒ customizable (matches the resolver's
  -- COALESCE(rd.user_customizable, true)). A locked cell rejects the write so the
  -- admin's role/override value stands.
  SELECT user_customizable INTO v_customizable
    FROM public.notification_role_defaults
   WHERE role = v_role AND type_key = p_type_key AND channel = p_channel;
  IF v_customizable IS FALSE THEN
    RAISE EXCEPTION 'notification preference locked by an administrator (% / %)', p_type_key, p_channel;
  END IF;

  INSERT INTO public.notification_prefs (employee_id, type_key, channel, enabled)
  VALUES (p_employee_id, p_type_key, p_channel, p_enabled)
  ON CONFLICT (employee_id, type_key, channel) DO UPDATE
    SET enabled = EXCLUDED.enabled, updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ─── 3. get_my_push_subscriptions — secrets NEVER returned (hash-only) ───
-- push_subscriptions rows hold endpoint + p256dh + auth = send-capability
-- secrets. This listing exposes ONLY: id, a friendly label (user_agent), when it
-- was added, and a truncated SHA-256 of the endpoint. digest() lives in the
-- `extensions` schema on Supabase, so it is schema-qualified (search_path=public).
CREATE OR REPLACE FUNCTION public.get_my_push_subscriptions(p_employee_id uuid)
RETURNS SETOF json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'id',            ps.id,
    'label',         ps.user_agent,
    'created_at',    ps.created_at,
    'endpoint_hash', substr(encode(extensions.digest(ps.endpoint, 'sha256'), 'hex'), 1, 16)
  )
  FROM public.push_subscriptions ps
  WHERE ps.employee_id = p_employee_id
  ORDER BY ps.created_at DESC;
$$;

-- Signatures unchanged → the F2 GRANTs still apply. Re-GRANT is harmless and
-- keeps this migration self-contained if replayed against a fresh DB.
GRANT EXECUTE ON FUNCTION public.get_my_notification_prefs(uuid)                     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_notification_pref(uuid, text, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_push_subscriptions(uuid)                     TO anon, authenticated, service_role;
