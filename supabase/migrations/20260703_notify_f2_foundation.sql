-- ═════════════════════════════════════════════════════════════════════════════
-- Notification Center — Phase F2: data foundation
--   docs/notify-roadmap.md, "Phase F2 — Data foundation".
--
-- Ships (all in ONE transaction — apply atomically):
--   1. notifications: recipient_id + type_key columns FIRST (broadcast = NULL).
--   2. Bell RPC cutover via DROP+CREATE (never CREATE OR REPLACE — a wider
--      signature would mint an AMBIGUOUS overload for the old {}/{p_limit} call
--      shapes, the 20260702_feedback_media.sql trap). create_notification gains
--      p_recipient_id/p_type_key the same way. Semantics: a row is visible to a
--      caller iff recipient_id IS NULL (broadcast) OR recipient_id = p_employee_id.
--   3. notification_types catalog + conservative seeds (every type enabled=false
--      except feedback.submitted — the live F1 reference event).
--   4. Three-layer prefs tables (role defaults + lock, admin per-employee
--      overrides, self-service prefs) — all RLS + explicit policy at creation.
--   5. get_effective_notification_prefs(p_employee_id) — FULLY implemented,
--      F2-owned, frozen in-wave (role default → employee override → my-pref, with
--      the user_customizable lock winning). Never a stub.
--   6. Session C + D frozen stubs (signatures per the roadmap; RAISE until filled).
--   7. Appointment emission triggers (appointment_crew INSERT + appointments
--      guarded UPDATE/cancel) via the live 20260630 notify pattern — inert until
--      their catalog types are enabled AND integration_config is set.
--
-- One shared Supabase across dev + main — live in both the moment it applies.
-- The recipient columns are additive + nullable so every existing row and every
-- existing create_notification caller keeps today's org-wide broadcast behavior.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. notifications: per-recipient targeting (ADD COLUMN first, per plan) ───
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_id uuid REFERENCES public.employees(id) ON DELETE CASCADE;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS type_key text;   -- catalog key (nullable: legacy rows predate the catalog)

-- Fast unread-per-recipient lookups (broadcast rows have recipient_id IS NULL).
CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON public.notifications (recipient_id, read_at);

-- Narrow, self-cleaning test hook: lets the F2 integration suite DELETE only its
-- own sentinel rows (real code never emits type='__f2test__'), so `npm test`
-- leaves no residue on the shared DB. Deliberately scoped — not a general write path.
DROP POLICY IF EXISTS notifications_delete_testrows ON public.notifications;
CREATE POLICY notifications_delete_testrows ON public.notifications
  FOR DELETE TO anon, authenticated USING (type = '__f2test__');

-- ─── 2. Bell RPC cutover — DROP the old signatures, CREATE the recipient-aware
--        ones. Old call shapes ({}, {p_limit:30}) still resolve against the
--        defaulted params; a NULL p_employee_id sees only broadcast rows. ───

DROP FUNCTION IF EXISTS public.get_notifications(int);
CREATE FUNCTION public.get_notifications(p_limit int DEFAULT 30, p_employee_id uuid DEFAULT NULL)
RETURNS SETOF public.notifications
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT *
    FROM public.notifications
   WHERE recipient_id IS NULL OR recipient_id = p_employee_id
   ORDER BY created_at DESC
   LIMIT greatest(1, least(p_limit, 100));
$$;

DROP FUNCTION IF EXISTS public.get_unread_notification_count();
CREATE FUNCTION public.get_unread_notification_count(p_employee_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int
    FROM public.notifications
   WHERE read_at IS NULL
     AND (recipient_id IS NULL OR recipient_id = p_employee_id);
$$;

DROP FUNCTION IF EXISTS public.mark_all_notifications_read();
CREATE FUNCTION public.mark_all_notifications_read(p_employee_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notifications
     SET read_at = now()
   WHERE read_at IS NULL
     AND (recipient_id IS NULL OR recipient_id = p_employee_id);
$$;

-- create_notification: DROP the 8-arg, re-CREATE with recipient_id + type_key
-- trailing (defaulted) so the 5 live callers keep emitting broadcast rows.
DROP FUNCTION IF EXISTS public.create_notification(text, text, text, text, text, uuid, uuid, jsonb);
CREATE FUNCTION public.create_notification(
  p_type        text,
  p_title       text,
  p_body        text DEFAULT NULL,
  p_link        text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id   uuid DEFAULT NULL,
  p_job_id      uuid DEFAULT NULL,
  p_payload     jsonb DEFAULT '{}'::jsonb,
  p_recipient_id uuid DEFAULT NULL,
  p_type_key    text DEFAULT NULL
) RETURNS public.notifications
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications
    (type, title, body, link, entity_type, entity_id, job_id, payload, recipient_id, type_key)
  VALUES
    (p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_job_id,
     coalesce(p_payload, '{}'::jsonb), p_recipient_id, p_type_key)
  RETURNING *;
$$;

-- Re-GRANT after every DROP+CREATE (privileges do not survive a DROP).
GRANT EXECUTE ON FUNCTION public.get_notifications(int, uuid)               TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid)        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid)          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(text, text, text, text, text, uuid, uuid, jsonb, uuid, text)
                                                                            TO anon, authenticated, service_role;

-- ─── 3. notification_types — the event catalog (docs/notify-roadmap.md) ───
CREATE TABLE IF NOT EXISTS public.notification_types (
  type_key      text PRIMARY KEY,
  label         text NOT NULL,
  description   text,
  category      text,                                 -- UI grouping
  audience      text,                                 -- human note of default audience
  bell_default  boolean NOT NULL DEFAULT true,
  push_default  boolean NOT NULL DEFAULT true,
  email_default boolean NOT NULL DEFAULT false,
  enabled       boolean NOT NULL DEFAULT false,       -- master switch — a type is INERT until enabled
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_types_all ON public.notification_types;
CREATE POLICY notification_types_all ON public.notification_types
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Conservative seeds: bell on where it is today; push structurally opt-in (no
-- push_subscriptions row = nothing delivered); email silent EXCEPT the two
-- admin-curated money events; every type enabled=false except feedback.submitted.
INSERT INTO public.notification_types
  (type_key, label, description, category, audience, bell_default, push_default, email_default, enabled, sort_order)
VALUES
  ('message.inbound',              'New text message',        'An inbound SMS arrived from a customer.',            'messaging',    'Assigned rep, else office', true,  true,  false, false, 10),
  ('appointment.assigned',        'Appointment assigned',    'You were added to an appointment''s crew.',          'appointments', 'The crewed employee',        true,  true,  false, false, 20),
  ('appointment.updated',         'Appointment updated',     'An appointment you are on changed.',                 'appointments', 'Crew of the appointment',    true,  true,  false, false, 21),
  ('appointment.canceled',        'Appointment canceled',    'An appointment you are on was canceled.',            'appointments', 'Crew of the appointment',    true,  true,  false, false, 22),
  ('estimate.accepted',           'Estimate accepted',       'A customer accepted an estimate.',                   'sales',        'Admins',                     true,  true,  true,  false, 30),
  ('payment.received',            'Payment received',        'A payment posted to an invoice.',                    'billing',      'Admins',                     true,  true,  true,  false, 40),
  ('lead.new',                    'New lead',                'A new lead came in (call or form).',                 'sales',        'Admins',                     true,  true,  false, false, 50),
  ('esign.signed',                'Document signed',         'A customer signed a document we sent.',              'sales',        'Admins',                     true,  true,  false, false, 60),
  ('feedback.submitted',          'Feedback submitted',      'Someone filed a bug report or improvement idea.',    'admin',        'Admins minus the submitter', true,  true,  false, true,  70),
  ('timesheet.change_requested',  'Timesheet change request','A tech asked to change a timesheet.',                'admin',        'Admins',                     true,  false, false, false, 80),
  ('timesheet.change_reviewed',   'Timesheet change reviewed','Your timesheet change request was reviewed.',       'admin',        'The requesting employee',    true,  false, false, false, 81),
  ('clock.abandoned',             'Clock left running',      'A tech clock was left open and auto-closed.',        'admin',        'Admins',                     true,  false, false, false, 82)
ON CONFLICT (type_key) DO NOTHING;

-- ─── 4. Three-layer preference tables ───
-- Layer 1 — role defaults (+ the user_customizable lock). Session D writes.
CREATE TABLE IF NOT EXISTS public.notification_role_defaults (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role              text NOT NULL,
  type_key          text NOT NULL REFERENCES public.notification_types(type_key) ON DELETE CASCADE,
  channel           text NOT NULL CHECK (channel IN ('bell','push','email')),
  enabled           boolean NOT NULL DEFAULT false,
  user_customizable boolean NOT NULL DEFAULT true,       -- false = locked; hidden from self-service
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  UNIQUE (role, type_key, channel)
);
ALTER TABLE public.notification_role_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_role_defaults_all ON public.notification_role_defaults;
CREATE POLICY notification_role_defaults_all ON public.notification_role_defaults
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Layer 2 — admin per-employee overrides. Session D writes.
CREATE TABLE IF NOT EXISTS public.notification_employee_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type_key    text NOT NULL REFERENCES public.notification_types(type_key) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('bell','push','email')),
  enabled     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  UNIQUE (employee_id, type_key, channel)
);
ALTER TABLE public.notification_employee_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_employee_overrides_all ON public.notification_employee_overrides;
CREATE POLICY notification_employee_overrides_all ON public.notification_employee_overrides
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Layer 3 — self-service prefs. Session C writes (only where user_customizable).
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type_key    text NOT NULL REFERENCES public.notification_types(type_key) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('bell','push','email')),
  enabled     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, type_key, channel)
);
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_prefs_all ON public.notification_prefs;
CREATE POLICY notification_prefs_all ON public.notification_prefs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ─── 5. get_effective_notification_prefs — the ONE resolver (F2-owned, frozen) ─
-- One row per (type_key, channel) for the employee, with the effective on/off and
-- whether the user may change it. Precedence, lowest→highest:
--   type channel default  →  role default  →  admin employee override  →  my-pref
-- The my-pref layer applies ONLY when the role default leaves it user_customizable;
-- a locked (user_customizable=false) row ignores my-pref (the lock wins), so the
-- admin's override/role value stands. Missing role default ⇒ customizable, value
-- falls back to the catalog channel default.
CREATE OR REPLACE FUNCTION public.get_effective_notification_prefs(p_employee_id uuid)
RETURNS SETOF json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH emp AS (
    SELECT id, role FROM public.employees WHERE id = p_employee_id
  ),
  channels(channel) AS (VALUES ('bell'), ('push'), ('email')),
  matrix AS (
    SELECT t.type_key, t.label, t.category, t.sort_order,
           t.enabled AS type_enabled,
           c.channel,
           CASE c.channel WHEN 'bell'  THEN t.bell_default
                          WHEN 'push'  THEN t.push_default
                          ELSE              t.email_default END AS type_channel_default
      FROM public.notification_types t
      CROSS JOIN channels c
  )
  SELECT json_build_object(
    'type_key',          m.type_key,
    'label',             m.label,
    'category',          m.category,
    'channel',           m.channel,
    'type_enabled',      m.type_enabled,
    'user_customizable', COALESCE(rd.user_customizable, true),
    'enabled',
      CASE
        WHEN COALESCE(rd.user_customizable, true) AND mp.enabled IS NOT NULL
          THEN mp.enabled
        ELSE COALESCE(ov.enabled, rd.enabled, m.type_channel_default)
      END
  )
  FROM matrix m
  CROSS JOIN emp e
  LEFT JOIN public.notification_role_defaults rd
    ON rd.role = e.role::text AND rd.type_key = m.type_key AND rd.channel = m.channel
  LEFT JOIN public.notification_employee_overrides ov
    ON ov.employee_id = e.id AND ov.type_key = m.type_key AND ov.channel = m.channel
  LEFT JOIN public.notification_prefs mp
    ON mp.employee_id = e.id AND mp.type_key = m.type_key AND mp.channel = m.channel
  ORDER BY m.sort_order, m.type_key, m.channel;
$$;
GRANT EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid) TO anon, authenticated, service_role;

-- ─── 6. Session C + D frozen stubs (signatures per docs/notify-roadmap.md) ───
--   Body-only CREATE OR REPLACE fills happen in-wave; migration-safety-checker
--   fails any signature change. Each RAISEs until its owner phase lands.

-- Session C
CREATE OR REPLACE FUNCTION public.get_my_notification_prefs(p_employee_id uuid)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'not implemented (phase C)'; END; $$;

CREATE OR REPLACE FUNCTION public.set_my_notification_pref(
  p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean)
RETURNS public.notification_prefs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'not implemented (phase C)'; END; $$;

CREATE OR REPLACE FUNCTION public.get_my_push_subscriptions(p_employee_id uuid)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'not implemented (phase C)'; END; $$;

-- Session D
CREATE OR REPLACE FUNCTION public.get_notification_defaults()
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'not implemented (phase D)'; END; $$;

CREATE OR REPLACE FUNCTION public.set_notification_default(
  p_role text, p_type_key text, p_channel text, p_enabled boolean,
  p_user_customizable boolean DEFAULT NULL)
RETURNS public.notification_role_defaults LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'not implemented (phase D)'; END; $$;

CREATE OR REPLACE FUNCTION public.get_employee_notification_overrides(p_employee_id uuid)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'not implemented (phase D)'; END; $$;

CREATE OR REPLACE FUNCTION public.set_employee_notification_override(
  p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean,
  p_actor_id uuid DEFAULT NULL)
RETURNS public.notification_employee_overrides LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'not implemented (phase D)'; END; $$;

CREATE OR REPLACE FUNCTION public.delete_employee_notification_override(
  p_employee_id uuid, p_type_key text, p_channel text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'not implemented (phase D)'; END; $$;

GRANT EXECUTE ON FUNCTION public.get_my_notification_prefs(uuid)                              TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_notification_pref(uuid, text, text, boolean)          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_push_subscriptions(uuid)                              TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_notification_defaults()                                  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_notification_default(text, text, text, boolean, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_notification_overrides(uuid)                    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_employee_notification_override(uuid, text, text, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_employee_notification_override(uuid, text, text)      TO anon, authenticated, service_role;

-- ─── 7. Appointment emission triggers (live 20260630 pattern; inert by default) ─
-- notify_emit POSTs an event to the notify worker, but is doubly inert:
--   (a) returns early unless the catalog type is enabled (all appointment.* types
--       ship enabled=false — Session B flips them after verifying E2E), and
--   (b) returns early when integration_config lacks notify_worker_url.
-- So creating these triggers now emits ZERO traffic until Session B is ready.
CREATE OR REPLACE FUNCTION public.notify_emit(p_type_key text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_enabled boolean;
  v_url     text;
  v_secret  text;
BEGIN
  IF p_type_key IS NULL THEN RETURN; END IF;

  -- (a) inert until the catalog type is enabled
  SELECT enabled INTO v_enabled FROM public.notification_types WHERE type_key = p_type_key;
  IF v_enabled IS NOT TRUE THEN RETURN; END IF;

  -- (b) inert until the worker URL is configured
  SELECT value INTO v_url    FROM public.integration_config WHERE key = 'notify_worker_url';
  SELECT value INTO v_secret FROM public.integration_config WHERE key = 'notify_webhook_secret';
  IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('type_key', p_type_key) || COALESCE(p_body, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-webhook-secret', COALESCE(v_secret, ''))
  );
END;
$$;

-- appointment_crew INSERT → appointment.assigned (recipient = the crewed employee)
CREATE OR REPLACE FUNCTION public.trg_appt_crew_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify_emit('appointment.assigned', jsonb_build_object(
    'appointment_id', NEW.appointment_id,
    'employee_id',    NEW.employee_id
  ));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_appointment_crew_notify ON public.appointment_crew;
CREATE TRIGGER trg_appointment_crew_notify
  AFTER INSERT ON public.appointment_crew
  FOR EACH ROW EXECUTE FUNCTION public.trg_appt_crew_notify();

-- appointments guarded UPDATE → appointment.updated / .canceled (recipient = crew)
CREATE OR REPLACE FUNCTION public.trg_appt_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Cancel transition takes precedence over a generic update.
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.notify_emit('appointment.canceled',
      jsonb_build_object('appointment_id', NEW.id));
    RETURN NEW;
  END IF;

  -- Guard: skip when no sync-relevant field actually changed (mirrors the
  -- 20260630 calendar-sync guard — prevents bookkeeping-only churn from emitting).
  IF (NEW.title, NEW.date, NEW.time_start, NEW.time_end, NEW.status, NEW.job_id)
     IS NOT DISTINCT FROM
     (OLD.title, OLD.date, OLD.time_start, OLD.time_end, OLD.status, OLD.job_id)
  THEN
    RETURN NEW;
  END IF;

  PERFORM public.notify_emit('appointment.updated',
    jsonb_build_object('appointment_id', NEW.id));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_appointment_notify ON public.appointments;
CREATE TRIGGER trg_appointment_notify
  AFTER UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.trg_appt_notify();

-- New tables/functions added after initial deploy → refresh PostgREST's cache.
SELECT public.bust_postgrest_cache();
