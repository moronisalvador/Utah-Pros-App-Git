-- ============================================================================
-- MIGRATION: inbound lead recording-source authorization boundary
-- ============================================================================
--
-- WHAT:
--   Moves provider recording URLs out of browser-readable inbound_leads rows,
--   preserves the existing recording_url key as an opaque truthy availability
--   marker, gates get_inbound_leads to the existing Call Log capability, and
--   reduces direct inbound_leads access to active internal company-wide reads.
--
-- WHY:
--   RLS scopes rows, not columns. The deployed CRM contracts also return the
--   inbound_leads composite type, so a column-only REVOKE would either break
--   select=* callers or still leak the URL through SECURITY DEFINER RPCs.
--   There is no employee-to-CRM-org or lead-assignment relation in the current
--   data model. The compatible browser row scope is therefore explicitly
--   company-wide for active internal employees. Recording playback remains
--   narrower: admin or crm_call_log capability through the approved Worker/RPC.
--
-- TABLES/RPCS:
--   public.inbound_leads
--   public.inbound_lead_recording_sources (new; service-only)
--   public.get_inbound_leads(integer)
--
-- APPLY:
--   One shared production database. Run only from the reviewed release commit
--   in a serialized owner-authorized window after the compatible Workers deploy.
--
-- ROLLBACK:
--   Use supabase/rollbacks/20260726183409_inbound_lead_recording_source_boundary.rollback.sql.
--   It restores raw URLs to inbound_leads, the exact prior RPC, ACL and policy,
--   then removes the service-only source table. This deliberately reopens the
--   browser-readable recording-source exposure.

BEGIN;

DO $preflight$
DECLARE
  v_oid oid;
  v_upsert_oid oid;
  v_relacl aclitem[];
BEGIN
  SELECT p.oid
    INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_inbound_leads'
    AND pg_get_function_identity_arguments(p.oid) = 'p_limit integer';

  IF v_oid IS NULL
     OR pg_get_function_result(v_oid) <> 'jsonb'
     OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid)
     OR (SELECT p.proconfig FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_oid)) <> '8e9119ed1af57bd45c6af4ed227ef38f'
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'get_inbound_leads drifted from the reviewed S1e precondition';
  END IF;

  SELECT p.oid
    INTO v_upsert_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'upsert_lead_from_callrail'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_callrail_id text, p_source_type text, p_tracking_number text, p_caller_number text, p_duration_sec integer, p_spam_flag boolean, p_source text, p_medium text, p_campaign text, p_recording_url text, p_transcription text, p_form_data jsonb, p_lead_status text, p_value numeric, p_direction text, p_occurred_at timestamp with time zone, p_raw_payload jsonb, p_org_id uuid';

  IF v_upsert_oid IS NULL
     OR md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_upsert_oid))
        <> 'd5abd852ebe5c3dfa2e440f45d40c4b3'
     OR has_function_privilege('anon', v_upsert_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_upsert_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_upsert_oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'upsert_lead_from_callrail drifted from the reviewed S1e precondition';
  END IF;

  SELECT c.relacl
    INTO v_relacl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'inbound_leads';

  IF v_relacl IS DISTINCT FROM
       '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'::aclitem[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'inbound_leads'
         AND policyname = 'inbound_leads_all'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'ALL'
         AND qual = 'true'
         AND with_check = 'true'
     )
     OR (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'inbound_leads') <> 1
     OR EXISTS (
       SELECT 1
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal
         AND n.nspname = 'public'
         AND c.relname = 'inbound_leads'
     )
     OR to_regclass('public.inbound_lead_recording_sources') IS NOT NULL
  THEN
    RAISE EXCEPTION 'inbound_leads grants, policies, triggers or source table drifted';
  END IF;
END
$preflight$;

CREATE TABLE public.inbound_lead_recording_sources (
  lead_id uuid PRIMARY KEY
    REFERENCES public.inbound_leads(id) ON DELETE CASCADE,
  recording_url text NOT NULL
    CHECK (btrim(recording_url) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbound_lead_recording_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_lead_recording_sources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inbound_lead_recording_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.inbound_lead_recording_sources TO service_role;

CREATE FUNCTION public.strip_recording_sources(p_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'object' THEN COALESCE((
      SELECT jsonb_object_agg(e.key, public.strip_recording_sources(e.value))
      FROM jsonb_each(p_value) e
      WHERE e.key NOT IN ('recording', 'recording_url')
    ), '{}'::jsonb)
    WHEN 'array' THEN COALESCE((
      SELECT jsonb_agg(public.strip_recording_sources(a.value))
      FROM jsonb_array_elements(p_value) a
    ), '[]'::jsonb)
    ELSE p_value
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.strip_recording_sources(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.strip_recording_sources(jsonb)
  TO service_role;

INSERT INTO public.inbound_lead_recording_sources (lead_id, recording_url, updated_at)
SELECT id, recording_url, now()
FROM public.inbound_leads
WHERE recording_url IS NOT NULL
  AND btrim(recording_url) <> '';

UPDATE public.inbound_leads il
SET recording_url = 'upr-recording://available'
WHERE EXISTS (
  SELECT 1
  FROM public.inbound_lead_recording_sources src
  WHERE src.lead_id = il.id
);

UPDATE public.inbound_leads
SET recording_url = NULL
WHERE recording_url IS NOT NULL
  AND btrim(recording_url) = '';

UPDATE public.inbound_leads
SET raw_payload = public.strip_recording_sources(raw_payload);

CREATE FUNCTION public.sanitize_inbound_lead_recording_payload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.raw_payload := public.strip_recording_sources(NEW.raw_payload);
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sanitize_inbound_lead_recording_payload()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_inbound_lead_recording_payload()
  TO service_role;

CREATE TRIGGER sanitize_inbound_lead_recording_payload
BEFORE INSERT OR UPDATE OF raw_payload ON public.inbound_leads
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_inbound_lead_recording_payload();

CREATE FUNCTION public.protect_inbound_lead_recording_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.recording_url IS NOT NULL
     AND btrim(NEW.recording_url) <> ''
     AND NEW.recording_url <> 'upr-recording://available'
  THEN
    INSERT INTO public.inbound_lead_recording_sources (lead_id, recording_url, updated_at)
    VALUES (NEW.id, NEW.recording_url, now())
    ON CONFLICT (lead_id) DO UPDATE
      SET recording_url = EXCLUDED.recording_url,
          updated_at = EXCLUDED.updated_at;
    UPDATE public.inbound_leads
    SET recording_url = 'upr-recording://available'
    WHERE id = NEW.id
      AND recording_url IS DISTINCT FROM 'upr-recording://available';
  ELSIF TG_OP = 'UPDATE'
        AND NEW.recording_url IS NULL
        AND OLD.recording_url = 'upr-recording://available'
  THEN
    DELETE FROM public.inbound_lead_recording_sources WHERE lead_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.protect_inbound_lead_recording_source()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_inbound_lead_recording_source()
  TO service_role;

CREATE TRIGGER protect_inbound_lead_recording_source
AFTER INSERT OR UPDATE OF recording_url ON public.inbound_leads
FOR EACH ROW
EXECUTE FUNCTION public.protect_inbound_lead_recording_source();

REVOKE ALL ON TABLE public.inbound_leads FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.inbound_leads FROM authenticated;
GRANT SELECT ON TABLE public.inbound_leads TO authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text,
  jsonb, text, numeric, text, timestamptz, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text,
  jsonb, text, numeric, text, timestamptz, jsonb, uuid
) TO service_role;

DROP POLICY inbound_leads_all ON public.inbound_leads;
CREATE POLICY inbound_leads_active_internal_select
ON public.inbound_leads
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.auth_user_id = (SELECT auth.uid())
      AND e.is_active = true
      AND e.is_external = false
  )
);

CREATE OR REPLACE FUNCTION public.get_inbound_leads(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_allowed boolean := false;
  v_override boolean;
BEGIN
  IF COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role' THEN
    v_allowed := true;
  ELSE
    SELECT e.*
      INTO v_employee
    FROM public.employees e
    WHERE e.auth_user_id = (SELECT auth.uid())
      AND e.is_active = true
      AND e.is_external = false
    LIMIT 1;

    IF FOUND AND v_employee.role::text = 'admin' THEN
      v_allowed := true;
    ELSIF FOUND THEN
      SELECT epa.can_view
        INTO v_override
      FROM public.employee_page_access epa
      WHERE epa.employee_id = v_employee.id
        AND epa.nav_key = 'crm_call_log'
      LIMIT 1;

      IF FOUND THEN
        v_allowed := v_override IS TRUE;
      ELSE
        SELECT COALESCE(np.can_view, false)
          INTO v_allowed
        FROM public.nav_permissions np
        WHERE np.role = v_employee.role::text
          AND np.nav_key = 'crm_call_log'
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'insufficient privilege'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at DESC NULLS LAST, t.created_at DESC),
      '[]'::jsonb
    )
    FROM (
      SELECT il.*,
        CASE WHEN c.id IS NOT NULL
          THEN jsonb_build_object('name', c.name, 'phone', c.phone)
          ELSE NULL
        END AS contact
      FROM public.inbound_leads il
      LEFT JOIN public.contacts c ON c.id = il.contact_id
      ORDER BY il.occurred_at DESC NULLS LAST, il.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    ) t
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_inbound_leads(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inbound_leads(integer)
  TO authenticated, service_role;

DO $postcondition$
DECLARE
  v_oid oid := 'public.get_inbound_leads(integer)'::regprocedure::oid;
BEGIN
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_table_privilege('anon', 'public.inbound_leads', 'SELECT')
     OR has_table_privilege('anon', 'public.inbound_leads', 'INSERT')
     OR has_table_privilege('authenticated', 'public.inbound_leads', 'INSERT')
     OR has_table_privilege('authenticated', 'public.inbound_leads', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.inbound_leads', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.inbound_leads', 'SELECT')
     OR has_table_privilege('authenticated', 'public.inbound_lead_recording_sources', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.inbound_lead_recording_sources', 'SELECT')
     OR has_function_privilege(
       'authenticated',
       'public.upsert_lead_from_callrail(text,text,text,text,integer,boolean,text,text,text,text,text,jsonb,text,numeric,text,timestamptz,jsonb,uuid)',
       'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
       FROM public.inbound_leads
       WHERE recording_url IS NOT NULL
         AND recording_url <> 'upr-recording://available'
     )
     OR EXISTS (
       SELECT 1
       FROM public.inbound_leads
       WHERE raw_payload IS DISTINCT FROM public.strip_recording_sources(raw_payload)
     )
  THEN
    RAISE EXCEPTION 'recording-source boundary postcondition failed';
  END IF;
END
$postcondition$;

COMMIT;
