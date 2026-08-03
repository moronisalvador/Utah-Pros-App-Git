-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260803090000_contractor_compliance_foundation
-- Only run in an approved maintenance window after the feature is disabled and
-- all private objects have been retained or migrated. The bucket is deliberately
-- not deleted: deleting a Storage bucket can irreversibly delete W-9 evidence.
-- ═════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS contractor_compliance_contact_profile_trigger ON public.contacts;

DO $contractor_compliance_unschedule$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='upr_contractor_compliance_reminders_daily';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
END;
$contractor_compliance_unschedule$;

REVOKE EXECUTE ON FUNCTION public.get_contractor_compliance_dashboard(text, text, integer, integer, date, date) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_contractor_compliance_detail(uuid, date, date) FROM authenticated, service_role;

DROP FUNCTION IF EXISTS public.contractor_compliance_reminder_poll();
DROP FUNCTION IF EXISTS public.get_contractor_compliance_detail(uuid, date, date);
DROP FUNCTION IF EXISTS public.get_contractor_compliance_dashboard(text, text, integer, integer, date, date);
DROP FUNCTION IF EXISTS public.contractor_compliance_rotate_request(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_set_profile_active(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_mutate_profile_requests(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_advance_w9_year();
DROP FUNCTION IF EXISTS public.contractor_compliance_finish_delivery(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.contractor_compliance_claim_delivery(uuid, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_reminder_candidates(integer);
DROP FUNCTION IF EXISTS public.contractor_compliance_authorize_document_file(uuid, uuid);
DROP FUNCTION IF EXISTS public.contractor_compliance_record_public_attempt(uuid, text, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_public_request(text);
DROP FUNCTION IF EXISTS public.contractor_compliance_mutate_request(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_create_request(uuid, uuid, text[], text, integer, text, text, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_append_activity(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_review_document(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.contractor_compliance_ingest_document(uuid, uuid, uuid, text, text, text, text, text, text, bigint, text, date, date, integer);
DROP FUNCTION IF EXISTS public.contractor_compliance_continuous_coverage_end(uuid, text[], date);
DROP FUNCTION IF EXISTS public.contractor_compliance_has_continuous_coverage(uuid, text[], date, date);
DROP FUNCTION IF EXISTS public.ensure_contractor_compliance_profile();

DELETE FROM public.nav_permissions WHERE nav_key = 'contractors';
DELETE FROM public.feature_flags WHERE key = 'page:contractors';
DELETE FROM public.integration_config WHERE key = 'contractor_compliance_reminder_worker_url';

DROP TABLE IF EXISTS public.contractor_compliance_public_attempts;
DROP TABLE IF EXISTS public.contractor_compliance_activity;
DROP TABLE IF EXISTS public.contractor_compliance_request_deliveries;
DROP TABLE IF EXISTS public.contractor_compliance_requests;
DROP TABLE IF EXISTS public.contractor_compliance_documents;
DROP TABLE IF EXISTS public.contractor_compliance_profiles;

NOTIFY pgrst, 'reload schema';
