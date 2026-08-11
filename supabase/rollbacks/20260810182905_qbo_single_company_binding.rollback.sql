-- SECURITY-STICKY ROLLBACK: 20260810182905_qbo_single_company_binding
--
-- Remove the RPCs that can establish or refresh a connection. The durable binding,
-- credential generation column, forced RLS, read-only service grant, and guard
-- trigger remain because deleting them would make every persisted QBO external
-- id ambiguous again. A company replacement is a separate reviewed data reset.

REVOKE EXECUTE ON FUNCTION public.replace_qbo_connection(text,text,text,text,timestamptz,text,uuid,timestamptz),
  public.refresh_qbo_connection_cas(text,text,bigint,text,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.replace_qbo_connection(text,text,text,text,timestamptz,text,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.refresh_qbo_connection_cas(text,text,bigint,text,text,timestamptz,text);

ALTER TABLE public.qbo_company_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_company_binding FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qbo_company_binding FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.qbo_company_binding TO service_role;
REVOKE EXECUTE ON FUNCTION public.guard_quickbooks_company_binding()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.guard_qbo_realm_binding()
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
