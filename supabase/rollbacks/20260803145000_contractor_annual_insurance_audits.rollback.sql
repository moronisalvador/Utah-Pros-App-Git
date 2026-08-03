-- Roll back annual insurance-audit contracts. Base compliance records remain.
DROP FUNCTION IF EXISTS public.get_contractor_compliance_audit_manifest(uuid, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.contractor_compliance_lock_audit_period(uuid);
DROP FUNCTION IF EXISTS public.contractor_compliance_materialize_audit_period(uuid);
DROP FUNCTION IF EXISTS public.contractor_compliance_upsert_audit_roster(uuid, uuid, boolean, boolean, boolean, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.get_contractor_compliance_audit_periods();
DROP FUNCTION IF EXISTS public.contractor_compliance_create_audit_period(text, date, date, text);

DROP TABLE IF EXISTS public.contractor_compliance_audit_request_deliveries;
DROP TABLE IF EXISTS public.contractor_compliance_audit_requests;
DROP TABLE IF EXISTS public.contractor_compliance_audit_evidence;
DROP TABLE IF EXISTS public.contractor_compliance_audit_roster;
DROP TABLE IF EXISTS public.contractor_compliance_audit_periods;
