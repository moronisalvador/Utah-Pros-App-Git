-- ============================================================================
-- FILE: 20260729163127_notification_presentation_settings.sql
-- ============================================================================
--
-- WHAT THIS DOES:
--   Adds a service-only, audited storage boundary for administrator-approved
--   notification presentation overrides. Browser roles receive no table or
--   function access. One atomic function revalidates the active internal admin,
--   applies optimistic concurrency/idempotency, and writes history.
--
-- DEPENDS ON:
--   public.notification_types(type_key)
--   public.employees(id, role, is_active, is_external)
--
-- ROLLBACK:
--   supabase/rollbacks/20260729163127_notification_presentation_settings.rollback.sql
--
-- NOTES:
--   - Additive only. No deployed notification/preferences contract changes.
--   - Route ids and templates are validated again by the Worker/code registry.
--   - No rendered customer data, provider payload, URL, or secret is stored.
-- ============================================================================

CREATE TABLE public.notification_presentation_overrides (
  type_key text NOT NULL
    REFERENCES public.notification_types(type_key) ON UPDATE CASCADE ON DELETE CASCADE,
  surface text NOT NULL
    CHECK (surface IN ('bell', 'pwa_push', 'native_push')),
  enabled boolean NOT NULL DEFAULT true,
  title_template text,
  body_template text,
  route_id text,
  contract_version integer,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_by uuid NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type_key, surface),
  CONSTRAINT notification_presentation_override_shape CHECK (
    (
      enabled
      AND title_template IS NOT NULL
      AND length(title_template) BETWEEN 1 AND 120
      AND body_template IS NOT NULL
      AND length(body_template) BETWEEN 1 AND 500
      AND route_id IS NOT NULL
      AND length(route_id) BETWEEN 1 AND 80
      AND contract_version = 1
    )
    OR
    (
      NOT enabled
      AND title_template IS NULL
      AND body_template IS NULL
      AND route_id IS NULL
      AND contract_version IS NULL
    )
  )
);

ALTER TABLE public.notification_presentation_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_presentation_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_presentation_overrides_service_read
  ON public.notification_presentation_overrides
  FOR SELECT
  TO service_role
  USING (true);
REVOKE ALL ON TABLE public.notification_presentation_overrides
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notification_presentation_overrides TO service_role;

CREATE TABLE public.notification_presentation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key text NOT NULL
    REFERENCES public.notification_types(type_key) ON UPDATE CASCADE ON DELETE RESTRICT,
  surface text NOT NULL
    CHECK (surface IN ('bell', 'pwa_push', 'native_push')),
  revision bigint NOT NULL CHECK (revision > 0),
  action text NOT NULL CHECK (action IN ('save', 'reset')),
  before_config jsonb,
  after_config jsonb NOT NULL,
  actor_employee_id uuid NOT NULL REFERENCES public.employees(id),
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type_key, surface, revision),
  CONSTRAINT notification_presentation_audit_before_object CHECK (
    before_config IS NULL OR jsonb_typeof(before_config) = 'object'
  ),
  CONSTRAINT notification_presentation_audit_after_object CHECK (
    jsonb_typeof(after_config) = 'object'
  )
);

CREATE INDEX notification_presentation_audit_lookup_idx
  ON public.notification_presentation_audit (type_key, surface, created_at DESC);

ALTER TABLE public.notification_presentation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_presentation_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_presentation_audit_service_read
  ON public.notification_presentation_audit
  FOR SELECT
  TO service_role
  USING (true);
REVOKE ALL ON TABLE public.notification_presentation_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notification_presentation_audit TO service_role;

CREATE OR REPLACE FUNCTION public.mutate_notification_presentation(
  p_actor_id uuid,
  p_type_key text,
  p_surface text,
  p_action text,
  p_config jsonb,
  p_expected_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_existing public.notification_presentation_overrides%ROWTYPE;
  v_replay public.notification_presentation_audit%ROWTYPE;
  v_current_revision bigint := 0;
  v_next_revision bigint;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL
     OR p_actor_id IS NULL
     OR p_type_key IS NULL
     OR p_surface NOT IN ('bell', 'pwa_push', 'native_push')
     OR p_action NOT IN ('save', 'reset') THEN
    RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_actor_id
      AND e.role::text = 'admin'
      AND e.is_active IS TRUE
      AND e.is_external IS FALSE
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_types nt WHERE nt.type_key = p_type_key
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_NOTIFICATION_TYPE' USING ERRCODE = '23503';
  END IF;

  -- Serialize before replay/revision reads, including the first write where no
  -- override row exists yet. This prevents two expected_revision=0 requests
  -- from both claiming revision 1 and silently overwriting one another.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_type_key || ':' || p_surface, 0)
  );

  SELECT *
  INTO v_replay
  FROM public.notification_presentation_audit
  WHERE request_id = p_request_id;

  IF FOUND THEN
    IF v_replay.actor_employee_id <> p_actor_id
       OR v_replay.type_key <> p_type_key
       OR v_replay.surface <> p_surface
       OR v_replay.action <> p_action THEN
      RAISE EXCEPTION 'REQUEST_ID_CONFLICT' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'revision', v_replay.revision,
      'config', v_replay.after_config,
      'replayed', true
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.notification_presentation_overrides
  WHERE type_key = p_type_key AND surface = p_surface
  FOR UPDATE;

  IF FOUND THEN
    v_current_revision := v_existing.revision;
    v_before := jsonb_build_object(
      'enabled', v_existing.enabled,
      'title_template', v_existing.title_template,
      'body_template', v_existing.body_template,
      'route_id', v_existing.route_id,
      'contract_version', v_existing.contract_version
    );
  END IF;

  IF COALESCE(p_expected_revision, 0) <> v_current_revision THEN
    RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  v_next_revision := v_current_revision + 1;

  IF p_action = 'save' THEN
    IF p_config IS NULL
       OR jsonb_typeof(p_config) <> 'object'
       OR (p_config - ARRAY[
         'title_template',
         'body_template',
         'route_id',
         'contract_version'
       ]::text[]) <> '{}'::jsonb
       OR NULLIF(trim(p_config->>'title_template'), '') IS NULL
       OR length(p_config->>'title_template') > 120
       OR NULLIF(trim(p_config->>'body_template'), '') IS NULL
       OR length(p_config->>'body_template') > 500
       OR NULLIF(trim(p_config->>'route_id'), '') IS NULL
       OR length(p_config->>'route_id') > 80
       OR jsonb_typeof(p_config->'contract_version') <> 'number'
       OR p_config->'contract_version' <> '1'::jsonb THEN
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.notification_presentation_overrides (
      type_key,
      surface,
      enabled,
      title_template,
      body_template,
      route_id,
      contract_version,
      revision,
      updated_by
    )
    VALUES (
      p_type_key,
      p_surface,
      true,
      p_config->>'title_template',
      p_config->>'body_template',
      p_config->>'route_id',
      (p_config->>'contract_version')::integer,
      v_next_revision,
      p_actor_id
    )
    ON CONFLICT (type_key, surface) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      title_template = EXCLUDED.title_template,
      body_template = EXCLUDED.body_template,
      route_id = EXCLUDED.route_id,
      contract_version = EXCLUDED.contract_version,
      revision = EXCLUDED.revision,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

    v_after := jsonb_build_object(
      'enabled', true,
      'title_template', p_config->>'title_template',
      'body_template', p_config->>'body_template',
      'route_id', p_config->>'route_id',
      'contract_version', (p_config->>'contract_version')::integer
    );
  ELSE
    INSERT INTO public.notification_presentation_overrides (
      type_key,
      surface,
      enabled,
      title_template,
      body_template,
      route_id,
      contract_version,
      revision,
      updated_by
    )
    VALUES (
      p_type_key,
      p_surface,
      false,
      NULL,
      NULL,
      NULL,
      NULL,
      v_next_revision,
      p_actor_id
    )
    ON CONFLICT (type_key, surface) DO UPDATE SET
      enabled = false,
      title_template = NULL,
      body_template = NULL,
      route_id = NULL,
      contract_version = NULL,
      revision = EXCLUDED.revision,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

    v_after := jsonb_build_object('enabled', false);
  END IF;

  INSERT INTO public.notification_presentation_audit (
    type_key,
    surface,
    revision,
    action,
    before_config,
    after_config,
    actor_employee_id,
    request_id
  )
  VALUES (
    p_type_key,
    p_surface,
    v_next_revision,
    p_action,
    v_before,
    v_after,
    p_actor_id,
    p_request_id
  );

  RETURN jsonb_build_object(
    'revision', v_next_revision,
    'config', v_after,
    'replayed', false
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mutate_notification_presentation(
  uuid, text, text, text, jsonb, bigint, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_notification_presentation(
  uuid, text, text, text, jsonb, bigint, uuid
) TO service_role;
