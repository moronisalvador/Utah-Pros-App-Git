-- ─────────────────────────────────────────────────────────────────────────────
-- Notification Center — Phase F1: Web Push subscriptions
--
-- docs/notify-roadmap.md, "Phase F1 — Delivery spike". Stores one row per
-- browser/device that opted into Web Push (the installed iPhone PWA + desktop
-- Chrome). Additive (CLAUDE.md Rule 7): a brand-new table, RLS-enabled at
-- creation, reached ONLY through the two SECURITY DEFINER own-row RPCs below and
-- the service-role worker (functions/lib/webPush.js senders).
--
-- SECURITY DEVIATION (documented — roadmap finding 4): endpoint + p256dh + auth
-- are *send-capability secrets* — anyone holding them can push to the device.
-- So this table deliberately does NOT copy the house permissive-RLS pattern
-- (`USING (true)` SELECT). RLS is ON with **no policy at all** → PostgREST/anon
-- get zero direct access; only these DEFINER RPCs (own-row) and the service key
-- (which bypasses RLS) can read/write. Mirrors dashboard_layouts' locked shape.
--
-- One shared Supabase across dev + main — live in both the moment it applies.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,            -- one subscription per push endpoint
  p256dh      text NOT NULL,                   -- receiver ECDH public key (base64url)
  auth        text NOT NULL,                   -- receiver auth secret (base64url)
  user_agent  text,                            -- best-effort device label
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_employee
  ON public.push_subscriptions (employee_id);

-- RLS ON, NO policies: locked to the DEFINER RPCs + service role only (see header).
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ═══ Own-row RPCs (SECURITY DEFINER; caller resolved via auth.uid()) ═══

-- Upsert the calling user's subscription for one endpoint. Re-subscribing on the
-- same endpoint (or after it was claimed by another account on a shared device)
-- rebinds it to the current employee and refreshes the keys. No-op (NULL) if the
-- auth user isn't an employee.
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text DEFAULT NULL
) RETURNS public.push_subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp uuid;
  v_row public.push_subscriptions;
BEGIN
  SELECT id INTO v_emp FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_emp, p_endpoint, p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (endpoint) DO UPDATE
    SET employee_id = EXCLUDED.employee_id,
        p256dh      = EXCLUDED.p256dh,
        auth        = EXCLUDED.auth,
        user_agent  = EXCLUDED.user_agent,
        updated_at  = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Remove the calling user's subscription for one endpoint (own-row only).
CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  SELECT id INTO v_emp FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp IS NULL THEN RETURN; END IF;
  DELETE FROM public.push_subscriptions
   WHERE endpoint = p_endpoint AND employee_id = v_emp;
END;
$$;

-- Callable by signed-in users only (both need auth.uid(); anon has none).
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text) TO authenticated;

-- New table added after initial deploy → refresh PostgREST's schema cache.
SELECT public.bust_postgrest_cache();
