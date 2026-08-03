-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260803220100_contractor_compliance_fk_indexes
-- WHAT: Add leading indexes for every contractor-compliance foreign key that
--       is not already covered by a primary, unique, or query index.
-- ROLLBACK: supabase/rollbacks/20260803220100_contractor_compliance_fk_indexes.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

CREATE INDEX contractor_activity_actor_idx
  ON public.contractor_compliance_activity (actor_employee_id);
CREATE INDEX contractor_activity_document_idx
  ON public.contractor_compliance_activity (document_id);
CREATE INDEX contractor_activity_request_idx
  ON public.contractor_compliance_activity (request_id);

CREATE INDEX contractor_audit_evidence_document_idx
  ON public.contractor_compliance_audit_evidence (document_id);
CREATE INDEX contractor_audit_evidence_profile_idx
  ON public.contractor_compliance_audit_evidence (profile_id);

CREATE INDEX contractor_audit_period_created_by_idx
  ON public.contractor_compliance_audit_periods (created_by);
CREATE INDEX contractor_audit_period_locked_by_idx
  ON public.contractor_compliance_audit_periods (locked_by);
CREATE INDEX contractor_audit_period_materialized_by_idx
  ON public.contractor_compliance_audit_periods (materialized_by);

CREATE INDEX contractor_audit_delivery_delivery_idx
  ON public.contractor_compliance_audit_request_deliveries (delivery_id);
CREATE INDEX contractor_audit_delivery_request_idx
  ON public.contractor_compliance_audit_request_deliveries (request_id);

CREATE INDEX contractor_audit_request_profile_idx
  ON public.contractor_compliance_audit_requests (profile_id);
CREATE INDEX contractor_audit_request_request_idx
  ON public.contractor_compliance_audit_requests (request_id);
CREATE INDEX contractor_audit_roster_profile_idx
  ON public.contractor_compliance_audit_roster (profile_id);

CREATE INDEX contractor_document_superseded_by_idx
  ON public.contractor_compliance_documents (superseded_by_document_id);
CREATE INDEX contractor_document_verified_by_idx
  ON public.contractor_compliance_documents (verified_by);

CREATE INDEX contractor_profile_owner_idx
  ON public.contractor_compliance_profiles (assigned_owner_id);
CREATE INDEX contractor_profile_paused_by_idx
  ON public.contractor_compliance_profiles (requests_paused_by);

CREATE INDEX contractor_request_created_by_idx
  ON public.contractor_compliance_requests (created_by);
CREATE INDEX contractor_request_paused_by_idx
  ON public.contractor_compliance_requests (paused_by);
CREATE INDEX contractor_request_revoked_by_idx
  ON public.contractor_compliance_requests (revoked_by);
CREATE INDEX contractor_request_supersedes_idx
  ON public.contractor_compliance_requests (supersedes_request_id);

CREATE INDEX contractor_w9_handoff_updated_by_idx
  ON public.contractor_w9_provider_handoffs (updated_by);
