-- Catalog-only S1e post-apply proof. This does not select lead or recording values.
DO $test$
DECLARE
  v_get oid := to_regprocedure('public.get_inbound_leads(integer)');
  v_upsert oid := to_regprocedure(
    'public.upsert_lead_from_callrail(text,text,text,text,integer,boolean,text,text,text,text,text,jsonb,text,numeric,text,timestamptz,jsonb,uuid)'
  );
BEGIN
  ASSERT to_regclass('public.inbound_lead_recording_sources') IS NOT NULL;
  ASSERT NOT has_table_privilege('anon', 'public.inbound_leads', 'SELECT');
  ASSERT has_table_privilege('authenticated', 'public.inbound_leads', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.inbound_leads', 'INSERT');
  ASSERT NOT has_table_privilege('authenticated', 'public.inbound_lead_recording_sources', 'SELECT');
  ASSERT has_table_privilege('service_role', 'public.inbound_lead_recording_sources', 'SELECT');
  ASSERT NOT has_function_privilege('anon', v_get, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', v_get, 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', v_upsert, 'EXECUTE');
  ASSERT has_function_privilege('service_role', v_upsert, 'EXECUTE');
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inbound_leads'
      AND policyname = 'inbound_leads_active_internal_select'
      AND cmd = 'SELECT'
  );
  ASSERT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.inbound_leads'::regclass
      AND NOT t.tgisinternal
      AND t.tgname = 'sanitize_inbound_lead_recording_payload'
  );
  ASSERT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.inbound_leads'::regclass
      AND NOT t.tgisinternal
      AND t.tgname = 'protect_inbound_lead_recording_source'
  );
END
$test$;
