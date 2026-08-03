-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260803220000_contractor_compliance_read_auth_fail_closed
-- WHAT: Disable browser execution without restoring the fail-open definitions.
-- SAFETY: service-role access remains available for diagnosis and recovery.
-- ═════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION
  public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date),
  public.get_contractor_compliance_detail(uuid,date,date),
  public.get_contractor_compliance_audit_periods(),
  public.get_contractor_compliance_audit_manifest(uuid,text,text,text,text,integer,integer),
  public.get_contractor_w9_tax_year_checklist(integer,text,text,text,text,boolean,integer,integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date),
  public.get_contractor_compliance_detail(uuid,date,date),
  public.get_contractor_compliance_audit_periods(),
  public.get_contractor_compliance_audit_manifest(uuid,text,text,text,text,integer,integer),
  public.get_contractor_w9_tax_year_checklist(integer,text,text,text,text,boolean,integer,integer)
TO service_role;

NOTIFY pgrst, 'reload schema';
