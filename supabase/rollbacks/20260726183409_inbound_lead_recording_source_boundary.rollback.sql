-- ============================================================================
-- ROLLBACK: 20260726183409_inbound_lead_recording_source_boundary
-- ============================================================================
--
-- Restores the exact pre-S1e get_inbound_leads body, grants and broad
-- authenticated policy, copies raw provider URLs back to inbound_leads, and
-- removes the service-only source table. Applying this rollback deliberately
-- reopens browser/RPC scalar recording-source exposure. It cannot reconstruct
-- privacy-safe recording keys removed from raw_payload during forward apply.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.inbound_lead_recording_sources') IS NULL
     OR to_regprocedure('public.protect_inbound_lead_recording_source()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal
         AND n.nspname = 'public'
         AND c.relname = 'inbound_leads'
         AND t.tgname = 'protect_inbound_lead_recording_source'
         AND t.tgenabled = 'O'
     )
  THEN
    RAISE EXCEPTION 'S1e recording-source boundary is absent or drifted';
  END IF;
END
$preflight$;

DROP TRIGGER protect_inbound_lead_recording_source ON public.inbound_leads;
DROP FUNCTION public.protect_inbound_lead_recording_source();
DROP TRIGGER sanitize_inbound_lead_recording_payload ON public.inbound_leads;
DROP FUNCTION public.sanitize_inbound_lead_recording_payload();

UPDATE public.inbound_leads il
SET recording_url = src.recording_url
FROM public.inbound_lead_recording_sources src
WHERE src.lead_id = il.id;

CREATE OR REPLACE FUNCTION public.get_inbound_leads(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    FROM inbound_leads il
    LEFT JOIN contacts c ON c.id = il.contact_id
    ORDER BY il.occurred_at DESC NULLS LAST, il.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_inbound_leads(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inbound_leads(integer)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text,
  jsonb, text, numeric, text, timestamptz, jsonb, uuid
) TO authenticated, service_role;

DROP POLICY inbound_leads_active_internal_select ON public.inbound_leads;
CREATE POLICY inbound_leads_all
ON public.inbound_leads
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

GRANT ALL ON TABLE public.inbound_leads TO anon, authenticated;
DROP TABLE public.inbound_lead_recording_sources;
DROP FUNCTION public.strip_recording_sources(jsonb);

DO $postcondition$
DECLARE
  v_oid oid := 'public.get_inbound_leads(integer)'::regprocedure::oid;
BEGIN
  IF md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_oid))
       <> '8e9119ed1af57bd45c6af4ed227ef38f'
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_table_privilege('anon', 'public.inbound_leads', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.inbound_leads', 'INSERT')
     OR (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'inbound_leads') <> 1
  THEN
    RAISE EXCEPTION 'S1e rollback postcondition failed';
  END IF;
END
$postcondition$;

COMMIT;
