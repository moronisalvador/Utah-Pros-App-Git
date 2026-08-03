-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260803220100_contractor_compliance_fk_indexes
-- WHAT: Remove only the foreign-key support indexes added by this migration.
-- ═════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.contractor_activity_actor_idx;
DROP INDEX IF EXISTS public.contractor_activity_document_idx;
DROP INDEX IF EXISTS public.contractor_activity_request_idx;
DROP INDEX IF EXISTS public.contractor_audit_evidence_document_idx;
DROP INDEX IF EXISTS public.contractor_audit_evidence_profile_idx;
DROP INDEX IF EXISTS public.contractor_audit_period_created_by_idx;
DROP INDEX IF EXISTS public.contractor_audit_period_locked_by_idx;
DROP INDEX IF EXISTS public.contractor_audit_period_materialized_by_idx;
DROP INDEX IF EXISTS public.contractor_audit_delivery_delivery_idx;
DROP INDEX IF EXISTS public.contractor_audit_delivery_request_idx;
DROP INDEX IF EXISTS public.contractor_audit_request_profile_idx;
DROP INDEX IF EXISTS public.contractor_audit_request_request_idx;
DROP INDEX IF EXISTS public.contractor_audit_roster_profile_idx;
DROP INDEX IF EXISTS public.contractor_document_superseded_by_idx;
DROP INDEX IF EXISTS public.contractor_document_verified_by_idx;
DROP INDEX IF EXISTS public.contractor_profile_owner_idx;
DROP INDEX IF EXISTS public.contractor_profile_paused_by_idx;
DROP INDEX IF EXISTS public.contractor_request_created_by_idx;
DROP INDEX IF EXISTS public.contractor_request_paused_by_idx;
DROP INDEX IF EXISTS public.contractor_request_revoked_by_idx;
DROP INDEX IF EXISTS public.contractor_request_supersedes_idx;
DROP INDEX IF EXISTS public.contractor_w9_handoff_updated_by_idx;
