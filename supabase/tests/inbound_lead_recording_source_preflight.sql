-- Catalog-only S1e apply-window preflight. This does not select lead or recording values.
DO $test$
DECLARE
  v_get oid;
  v_upsert oid;
BEGIN
  v_get := to_regprocedure('public.get_inbound_leads(integer)');
  v_upsert := to_regprocedure(
    'public.upsert_lead_from_callrail(text,text,text,text,integer,boolean,text,text,text,text,text,jsonb,text,numeric,text,timestamptz,jsonb,uuid)'
  );

  ASSERT v_get IS NOT NULL;
  ASSERT md5((SELECT prosrc FROM pg_proc WHERE oid = v_get))
    = '8e9119ed1af57bd45c6af4ed227ef38f';
  ASSERT NOT has_function_privilege('anon', v_get, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', v_get, 'EXECUTE');
  ASSERT v_upsert IS NOT NULL;
  ASSERT md5((SELECT prosrc FROM pg_proc WHERE oid = v_upsert))
    = 'd5abd852ebe5c3dfa2e440f45d40c4b3';
  ASSERT has_function_privilege('authenticated', v_upsert, 'EXECUTE');
  ASSERT to_regclass('public.inbound_lead_recording_sources') IS NULL;
END
$test$;
