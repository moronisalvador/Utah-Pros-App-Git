-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260803090000_contractor_compliance_foundation
-- WHAT: Additive, private contractor compliance records and read-only internal
--       readiness projections. This is source only; it is not an apply request.
-- SECURITY: compliance files (especially W-9s) are service-owned. Browser roles
--       have no table or Storage-object access. All RPCs below re-check identity.
-- ROLLBACK: supabase/rollbacks/20260803090000_contractor_compliance_foundation.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.contractor_compliance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL UNIQUE REFERENCES public.contacts(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  required_w9_year integer NOT NULL DEFAULT EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Denver'))::integer,
  assigned_owner_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  requests_paused_at timestamptz,
  requests_paused_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  requests_pause_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_compliance_profiles_w9_year_check CHECK (required_w9_year BETWEEN 2000 AND 2200),
  CONSTRAINT contractor_compliance_profiles_pause_check CHECK (
    (requests_paused_at IS NULL AND requests_paused_by IS NULL AND requests_pause_reason IS NULL)
    OR (requests_paused_at IS NOT NULL AND requests_pause_reason IS NOT NULL)
  )
);

CREATE TABLE public.contractor_compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.contractor_compliance_profiles(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  version_number integer NOT NULL,
  review_state text NOT NULL DEFAULT 'pending_review',
  coverage_start_date date,
  coverage_end_date date,
  tax_year integer,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_source text NOT NULL DEFAULT 'internal_upload',
  source_external_id text,
  storage_bucket text NOT NULL DEFAULT 'contractor-compliance-private',
  storage_object_path text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  sha256_hex char(64) NOT NULL,
  extracted_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  verified_at timestamptz,
  rejection_reason text,
  superseded_at timestamptz,
  superseded_by_document_id uuid REFERENCES public.contractor_compliance_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_compliance_documents_type_check CHECK (document_type IN ('w9', 'workers_comp', 'workers_comp_waiver', 'general_liability')),
  CONSTRAINT contractor_compliance_documents_state_check CHECK (review_state IN ('pending_review', 'accepted', 'rejected', 'superseded')),
  CONSTRAINT contractor_compliance_documents_version_check CHECK (version_number > 0),
  CONSTRAINT contractor_compliance_documents_storage_check CHECK (storage_bucket = 'contractor-compliance-private' AND storage_object_path !~ '(^/|\\.\\.)'),
  CONSTRAINT contractor_compliance_documents_file_check CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png') AND byte_size > 0 AND byte_size <= 6291456),
  CONSTRAINT contractor_compliance_documents_hash_check CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT contractor_compliance_documents_date_check CHECK (
    (document_type = 'w9' AND tax_year BETWEEN 2000 AND 2200 AND coverage_start_date IS NULL AND coverage_end_date IS NULL)
    OR (document_type <> 'w9' AND tax_year IS NULL AND coverage_start_date IS NOT NULL AND coverage_end_date IS NOT NULL AND coverage_end_date >= coverage_start_date)
  ),
  CONSTRAINT contractor_compliance_documents_review_check CHECK (
    (review_state = 'pending_review' AND verified_at IS NULL AND verified_by IS NULL AND rejection_reason IS NULL)
    OR (review_state = 'accepted' AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND rejection_reason IS NULL)
    OR (review_state = 'rejected' AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND rejection_reason IS NOT NULL)
    OR (review_state = 'superseded' AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND rejection_reason IS NULL)
  ),
  CONSTRAINT contractor_compliance_documents_profile_version_unique UNIQUE (profile_id, document_type, version_number),
  CONSTRAINT contractor_compliance_documents_path_unique UNIQUE (storage_bucket, storage_object_path)
);

CREATE TABLE public.contractor_compliance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.contractor_compliance_profiles(id) ON DELETE RESTRICT,
  request_identity text NOT NULL UNIQUE,
  requested_document_types text[] NOT NULL,
  recipient_email text,
  token_digest char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  max_uploads integer NOT NULL DEFAULT 8,
  upload_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual',
  sent_at timestamptz,
  paused_at timestamptz,
  paused_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  pause_reason text,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  revoke_reason text,
  completed_at timestamptz,
  supersedes_request_id uuid REFERENCES public.contractor_compliance_requests(id) ON DELETE RESTRICT,
  rotation_operation_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_compliance_requests_types_check CHECK (
    cardinality(requested_document_types) > 0
    AND requested_document_types <@ ARRAY['w9', 'workers_comp', 'workers_comp_waiver', 'general_liability']::text[]
  ),
  CONSTRAINT contractor_compliance_requests_digest_check CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT contractor_compliance_requests_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT contractor_compliance_requests_upload_check CHECK (max_uploads BETWEEN 1 AND 20 AND upload_count BETWEEN 0 AND max_uploads),
  CONSTRAINT contractor_compliance_requests_pause_check CHECK ((paused_at IS NULL AND paused_by IS NULL AND pause_reason IS NULL) OR (paused_at IS NOT NULL AND pause_reason IS NOT NULL)),
  CONSTRAINT contractor_compliance_requests_revoke_check CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE TABLE public.contractor_compliance_request_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.contractor_compliance_requests(id) ON DELETE RESTRICT,
  stage_key text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'claimed',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz,
  provider_message_id text,
  outcome_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_compliance_request_deliveries_stage_unique UNIQUE (request_id, stage_key),
  CONSTRAINT contractor_compliance_request_deliveries_status_check CHECK (status IN ('claimed', 'sent', 'suppressed', 'failed', 'ambiguous', 'cancelled')),
  CONSTRAINT contractor_compliance_request_deliveries_outcome_check CHECK (
    (status = 'claimed' AND completed_at IS NULL) OR (status <> 'claimed' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE public.contractor_compliance_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.contractor_compliance_profiles(id) ON DELETE RESTRICT,
  document_id uuid REFERENCES public.contractor_compliance_documents(id) ON DELETE SET NULL,
  request_id uuid REFERENCES public.contractor_compliance_requests(id) ON DELETE SET NULL,
  actor_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  note text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_compliance_activity_safe_metadata_check CHECK (NOT (safe_metadata ?| ARRAY['token', 'token_digest', 'storage_object_path', 'original_filename', 'tax_identifier', 'ssn', 'ein']))
);

CREATE TABLE public.contractor_compliance_public_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.contractor_compliance_requests(id) ON DELETE RESTRICT,
  ip_hash char(64) NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_compliance_public_attempts_hash_check CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT contractor_compliance_public_attempts_count_check CHECK (attempt_count BETWEEN 1 AND 20),
  CONSTRAINT contractor_compliance_public_attempts_window_unique UNIQUE (request_id, ip_hash, window_started_at)
);

CREATE INDEX contractor_compliance_documents_profile_type_state_dates_idx
  ON public.contractor_compliance_documents (profile_id, document_type, review_state, coverage_end_date);
CREATE INDEX contractor_compliance_documents_review_queue_idx
  ON public.contractor_compliance_documents (review_state, received_at) WHERE review_state = 'pending_review';
CREATE UNIQUE INDEX contractor_compliance_documents_content_dedupe_idx
  ON public.contractor_compliance_documents (profile_id, document_type, sha256_hex);
CREATE INDEX contractor_compliance_requests_profile_open_idx
  ON public.contractor_compliance_requests (profile_id, expires_at) WHERE revoked_at IS NULL AND completed_at IS NULL;
CREATE INDEX contractor_compliance_deliveries_due_idx
  ON public.contractor_compliance_request_deliveries (status, claimed_at) WHERE status = 'claimed';
CREATE INDEX contractor_compliance_activity_profile_created_idx
  ON public.contractor_compliance_activity (profile_id, created_at DESC);

ALTER TABLE public.contractor_compliance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_request_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_request_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_activity FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_public_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_public_attempts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.contractor_compliance_profiles, public.contractor_compliance_documents, public.contractor_compliance_requests, public.contractor_compliance_request_deliveries, public.contractor_compliance_activity, public.contractor_compliance_public_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contractor_compliance_profiles, public.contractor_compliance_documents, public.contractor_compliance_requests, public.contractor_compliance_request_deliveries, public.contractor_compliance_activity, public.contractor_compliance_public_attempts TO service_role;

CREATE POLICY contractor_compliance_profiles_service_only ON public.contractor_compliance_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_documents_service_only ON public.contractor_compliance_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_requests_service_only ON public.contractor_compliance_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_request_deliveries_service_only ON public.contractor_compliance_request_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_activity_service_only ON public.contractor_compliance_activity FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_public_attempts_service_only ON public.contractor_compliance_public_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.contractor_compliance_profiles (contact_id, assigned_owner_id)
SELECT c.id, c.owner_id FROM public.contacts c WHERE c.role = 'subcontractor'
ON CONFLICT (contact_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_contractor_compliance_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF NEW.role = 'subcontractor' THEN
    INSERT INTO public.contractor_compliance_profiles(contact_id,assigned_owner_id) VALUES(NEW.id,NEW.owner_id)
    ON CONFLICT(contact_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $function$;
CREATE TRIGGER contractor_compliance_contact_profile_trigger AFTER INSERT OR UPDATE OF role, owner_id ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.ensure_contractor_compliance_profile();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contractor-compliance-private', 'contractor-compliance-private', false, 6291456, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

DO $contractor_compliance_bucket_postcondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'contractor-compliance-private'
      AND public IS FALSE
      AND file_size_limit = 6291456
      AND allowed_mime_types @> ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
  ) THEN
    RAISE EXCEPTION 'contractor compliance bucket must stay private and byte-bounded';
  END IF;
END;
$contractor_compliance_bucket_postcondition$;

INSERT INTO public.feature_flags (key, enabled, force_disabled, category, label, description, updated_at)
VALUES ('page:contractors', false, false, 'page', 'Contractor Compliance', 'Private W-9 and insurance compliance. Default off until Storage, Worker, and route gates are verified.', now())
ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, label = EXCLUDED.label, description = EXCLUDED.description, updated_at = now();

INSERT INTO public.nav_permissions (role, nav_key, can_view, can_edit)
VALUES
  ('admin', 'contractors', true, true),
  ('office', 'contractors', true, true),
  ('project_manager', 'contractors', true, false),
  ('field_tech', 'contractors', false, false),
  ('estimator', 'contractors', false, false),
  ('supervisor', 'contractors', false, false),
  ('crm_partner', 'contractors', false, false)
ON CONFLICT (role, nav_key) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit;

CREATE OR REPLACE FUNCTION public.contractor_compliance_has_continuous_coverage(p_profile_id uuid,p_types text[],p_start date,p_end date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  SELECT COALESCE(range_agg(daterange(d.coverage_start_date,d.coverage_end_date,'[]')) @> daterange(p_start,p_end,'[]'),false)
  FROM public.contractor_compliance_documents d
  WHERE d.profile_id=p_profile_id AND d.document_type=ANY(p_types) AND d.review_state IN ('accepted','superseded')
    AND d.coverage_start_date IS NOT NULL AND d.coverage_end_date IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_continuous_coverage_end(
  p_profile_id uuid,
  p_types text[],
  p_start date
) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH coverage AS (
    SELECT range_agg(daterange(d.coverage_start_date,d.coverage_end_date,'[]')) AS intervals
    FROM public.contractor_compliance_documents d
    WHERE d.profile_id=p_profile_id
      AND d.document_type=ANY(p_types)
      AND d.review_state IN ('accepted','superseded')
      AND d.coverage_start_date IS NOT NULL
      AND d.coverage_end_date IS NOT NULL
  )
  SELECT upper(interval_value)-1
  FROM coverage
  CROSS JOIN LATERAL unnest(coverage.intervals) AS ranges(interval_value)
  WHERE interval_value @> p_start
  ORDER BY upper(interval_value) DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_contractor_compliance_dashboard(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_audit_start date DEFAULT NULL,
  p_audit_end date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_role text;
  v_today date := (now() AT TIME ZONE 'America/Denver')::date;
  v_start date := COALESCE(p_audit_start, (now() AT TIME ZONE 'America/Denver')::date);
  v_end date := COALESCE(p_audit_end, COALESCE(p_audit_start, (now() AT TIME ZONE 'America/Denver')::date));
  v_result jsonb;
BEGIN
  SELECT e.role::text INTO v_role FROM public.employees e
  WHERE e.auth_user_id = auth.uid() AND e.is_active IS TRUE AND e.is_external IS FALSE;
  IF v_role NOT IN ('admin', 'office', 'project_manager') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance access required' USING errcode = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR p_offset IS NULL OR p_offset < 0 OR v_end < v_start OR EXTRACT(YEAR FROM v_start) <> EXTRACT(YEAR FROM v_end) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: invalid contractor compliance page or audit range' USING errcode = '22023';
  END IF;
  WITH rows AS (
    SELECT p.id profile_id, c.id contact_id, c.name, c.company, c.trade_specialty, p.is_active, p.required_w9_year,
      owner.full_name owner_name,
      (SELECT max(r.sent_at) FROM public.contractor_compliance_requests r WHERE r.profile_id = p.id) last_request_at,
      CASE WHEN p.is_active IS FALSE THEN 'inactive'
           WHEN NOT EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type='w9' AND d.review_state IN ('accepted','superseded') AND d.tax_year=EXTRACT(YEAR FROM v_start)::integer) THEN CASE WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type='w9' AND d.review_state='pending_review' AND d.tax_year=EXTRACT(YEAR FROM v_start)::integer) THEN 'needs_review' ELSE 'missing' END
           ELSE 'ready' END AS w9_status,
      CASE WHEN p.is_active IS FALSE THEN 'inactive'
           WHEN public.contractor_compliance_has_continuous_coverage(p.id,ARRAY['workers_comp','workers_comp_waiver'],v_start,v_end) THEN CASE WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type IN ('workers_comp','workers_comp_waiver') AND d.review_state IN ('accepted','superseded') AND d.coverage_start_date <= v_today AND d.coverage_end_date >= v_today AND d.coverage_end_date <= v_today + 60) THEN 'expiring' ELSE 'ready' END
           WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type IN ('workers_comp','workers_comp_waiver') AND d.review_state='pending_review') THEN 'needs_review'
           WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type IN ('workers_comp','workers_comp_waiver') AND d.review_state IN ('accepted','superseded') AND d.coverage_end_date < v_start) THEN 'expired'
           WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type IN ('workers_comp','workers_comp_waiver') AND d.review_state IN ('accepted','superseded')) THEN 'gap' ELSE 'missing' END AS workers_comp_status,
      CASE WHEN p.is_active IS FALSE THEN 'inactive'
           WHEN public.contractor_compliance_has_continuous_coverage(p.id,ARRAY['general_liability'],v_start,v_end) THEN CASE WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type='general_liability' AND d.review_state IN ('accepted','superseded') AND d.coverage_start_date <= v_today AND d.coverage_end_date >= v_today AND d.coverage_end_date <= v_today + 60) THEN 'expiring' ELSE 'ready' END
           WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type='general_liability' AND d.review_state='pending_review') THEN 'needs_review'
           WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type='general_liability' AND d.review_state IN ('accepted','superseded') AND d.coverage_end_date < v_start) THEN 'expired'
           WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type='general_liability' AND d.review_state IN ('accepted','superseded')) THEN 'gap' ELSE 'missing' END AS general_liability_status,
      (SELECT min(d.coverage_end_date) FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type <> 'w9' AND d.review_state IN ('accepted','superseded') AND d.coverage_end_date >= v_today) earliest_expiration
    FROM public.contractor_compliance_profiles p
    JOIN public.contacts c ON c.id=p.contact_id AND c.role='subcontractor'
    LEFT JOIN public.employees owner ON owner.id=p.assigned_owner_id
  ), classified AS (
    SELECT *, CASE WHEN is_active IS FALSE THEN 'inactive'
      WHEN 'expired' IN (w9_status, workers_comp_status, general_liability_status) THEN 'expired'
      WHEN 'gap' IN (w9_status, workers_comp_status, general_liability_status) THEN 'gap'
      WHEN 'missing' IN (w9_status, workers_comp_status, general_liability_status) THEN 'missing'
      WHEN 'needs_review' IN (w9_status, workers_comp_status, general_liability_status) THEN 'needs_review'
      WHEN 'expiring' IN (w9_status, workers_comp_status, general_liability_status) THEN 'expiring'
      ELSE 'ready' END overall_status
    FROM rows
  ), filtered AS (
    SELECT * FROM classified WHERE (NULLIF(btrim(p_search),'') IS NULL OR name ILIKE '%' || btrim(p_search) || '%' OR company ILIKE '%' || btrim(p_search) || '%' OR trade_specialty ILIKE '%' || btrim(p_search) || '%')
      AND (NULLIF(btrim(p_status),'') IS NULL OR overall_status = p_status)
  )
  SELECT jsonb_build_object('audit', jsonb_build_object('start_date',v_start,'end_date',v_end,'timezone','America/Denver'),
    'audit_period', jsonb_build_object('start_date',v_start,'end_date',v_end,'timezone','America/Denver'),
    'total',(SELECT count(*) FROM filtered), 'total_count',(SELECT count(*) FROM filtered),
    'kpis',jsonb_build_object('ready',(SELECT count(*) FROM filtered WHERE overall_status='ready'),'missing',(SELECT count(*) FROM filtered WHERE overall_status='missing'),'needs_review',(SELECT count(*) FROM filtered WHERE overall_status='needs_review'),'expiring',(SELECT count(*) FROM filtered WHERE overall_status='expiring'),'expired',(SELECT count(*) FROM filtered WHERE overall_status='expired'),'gap',(SELECT count(*) FROM filtered WHERE overall_status='gap'),'inactive',(SELECT count(*) FROM filtered WHERE overall_status='inactive')),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('contractor_id',contact_id,'contact_id',contact_id,'profile_id',profile_id,'name',name,'company',company,'trade_specialty',trade_specialty,'overall_status',overall_status,'requirements',jsonb_build_object('w9',jsonb_build_object('status',w9_status),'workers_comp',jsonb_build_object('status',workers_comp_status),'general_liability',jsonb_build_object('status',general_liability_status)),'w9_status',w9_status,'workers_comp_status',workers_comp_status,'general_liability_status',general_liability_status,'earliest_expiration',earliest_expiration,'assigned_owner_name',owner_name,'last_request_at',last_request_at) ORDER BY CASE overall_status WHEN 'expired' THEN 1 WHEN 'gap' THEN 2 WHEN 'missing' THEN 3 WHEN 'needs_review' THEN 4 WHEN 'expiring' THEN 5 WHEN 'inactive' THEN 6 ELSE 7 END, earliest_expiration NULLS LAST, name) FROM (SELECT * FROM filtered ORDER BY CASE overall_status WHEN 'expired' THEN 1 WHEN 'gap' THEN 2 WHEN 'missing' THEN 3 WHEN 'needs_review' THEN 4 WHEN 'expiring' THEN 5 WHEN 'inactive' THEN 6 ELSE 7 END, earliest_expiration NULLS LAST, name LIMIT p_limit OFFSET p_offset) page),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_contractor_compliance_detail(
  p_contact_id uuid,
  p_audit_start date DEFAULT NULL,
  p_audit_end date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_role text;
  v_profile uuid;
  v_result jsonb;
  v_active boolean;
  v_today date := (now() AT TIME ZONE 'America/Denver')::date;
  v_start date := COALESCE(p_audit_start, (now() AT TIME ZONE 'America/Denver')::date);
  v_end date := COALESCE(p_audit_end, COALESCE(p_audit_start, (now() AT TIME ZONE 'America/Denver')::date));
  v_w9_year integer;
  v_w9_status text;
  v_wc_status text;
  v_gl_status text;
  v_overall text;
  v_wc_end date;
  v_gl_end date;
BEGIN
  SELECT e.role::text INTO v_role FROM public.employees e WHERE e.auth_user_id=auth.uid() AND e.is_active IS TRUE AND e.is_external IS FALSE;
  IF v_role NOT IN ('admin','office','project_manager') THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance access required' USING errcode='42501'; END IF;
  IF (p_audit_start IS NULL) <> (p_audit_end IS NULL)
     OR v_end < v_start
     OR EXTRACT(YEAR FROM v_start) <> EXTRACT(YEAR FROM v_end) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: audit period must be complete and remain within one Denver calendar year' USING errcode='22023';
  END IF;
  SELECT p.id,p.is_active INTO v_profile,v_active
  FROM public.contractor_compliance_profiles p
  JOIN public.contacts c ON c.id=p.contact_id AND c.role='subcontractor'
  WHERE p.contact_id=p_contact_id;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: contractor profile not found' USING errcode='P0002'; END IF;
  v_w9_year := EXTRACT(YEAR FROM v_start)::integer;
  v_wc_end := public.contractor_compliance_continuous_coverage_end(v_profile,ARRAY['workers_comp','workers_comp_waiver'],v_start);
  v_gl_end := public.contractor_compliance_continuous_coverage_end(v_profile,ARRAY['general_liability'],v_start);

  v_w9_status := CASE WHEN NOT v_active THEN 'inactive'
    WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type='w9' AND d.review_state IN ('accepted','superseded') AND d.tax_year=v_w9_year) THEN 'ready'
    WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type='w9' AND d.review_state='pending_review' AND d.tax_year=v_w9_year) THEN 'needs_review'
    ELSE 'missing' END;
  v_wc_status := CASE WHEN NOT v_active THEN 'inactive'
    WHEN public.contractor_compliance_has_continuous_coverage(v_profile,ARRAY['workers_comp','workers_comp_waiver'],v_start,v_end)
      THEN CASE WHEN p_audit_start IS NULL AND v_wc_end<=v_today+60 THEN 'expiring' ELSE 'ready' END
    WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type IN ('workers_comp','workers_comp_waiver') AND d.review_state='pending_review') THEN 'needs_review'
    WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type IN ('workers_comp','workers_comp_waiver') AND d.review_state IN ('accepted','superseded') AND d.coverage_end_date<v_start) THEN 'expired'
    WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type IN ('workers_comp','workers_comp_waiver') AND d.review_state IN ('accepted','superseded')) THEN 'gap'
    ELSE 'missing' END;
  v_gl_status := CASE WHEN NOT v_active THEN 'inactive'
    WHEN public.contractor_compliance_has_continuous_coverage(v_profile,ARRAY['general_liability'],v_start,v_end)
      THEN CASE WHEN p_audit_start IS NULL AND v_gl_end<=v_today+60 THEN 'expiring' ELSE 'ready' END
    WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type='general_liability' AND d.review_state='pending_review') THEN 'needs_review'
    WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type='general_liability' AND d.review_state IN ('accepted','superseded') AND d.coverage_end_date<v_start) THEN 'expired'
    WHEN EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type='general_liability' AND d.review_state IN ('accepted','superseded')) THEN 'gap'
    ELSE 'missing' END;
  v_overall := CASE WHEN NOT v_active THEN 'inactive'
    WHEN 'expired' IN (v_w9_status,v_wc_status,v_gl_status) THEN 'expired'
    WHEN 'gap' IN (v_w9_status,v_wc_status,v_gl_status) THEN 'gap'
    WHEN 'missing' IN (v_w9_status,v_wc_status,v_gl_status) THEN 'missing'
    WHEN 'needs_review' IN (v_w9_status,v_wc_status,v_gl_status) THEN 'needs_review'
    WHEN 'expiring' IN (v_w9_status,v_wc_status,v_gl_status) THEN 'expiring'
    ELSE 'ready' END;

  SELECT jsonb_build_object(
    'profile_id',p.id,
    'contractor',jsonb_build_object(
      'id',c.id,'name',c.name,'company',c.company,'email',c.email,'phone',c.phone,
      'trade_specialty',c.trade_specialty,'is_active',p.is_active,
      'assigned_owner_name',owner.full_name,
      'last_request_at',(
        SELECT max(r.sent_at)
        FROM public.contractor_compliance_requests r
        WHERE r.profile_id=p.id
          AND (
            v_role<>'project_manager'
            OR r.requested_document_types && ARRAY['workers_comp','workers_comp_waiver','general_liability']::text[]
          )
      ),
      'reminders_paused_at',p.requests_paused_at,
      'reminders_pause_reason',p.requests_pause_reason,
      'overall_status',v_overall
    ),
    'contact',jsonb_build_object('id',c.id,'name',c.name,'company',c.company,'email',c.email,'phone',c.phone,'trade_specialty',c.trade_specialty),
    'readiness',jsonb_build_object('current_status',v_overall,'view_mode',CASE WHEN p_audit_start IS NULL THEN 'current' ELSE 'audit' END,'audit_start',p_audit_start,'audit_end',p_audit_end),
    'requirements',jsonb_build_array(
      jsonb_build_object(
        'key','w9','label','W-9','status',v_w9_status,
        'detail',CASE WHEN v_role='project_manager' THEN NULL ELSE 'Required tax year '||v_w9_year::text END
      ),
      jsonb_build_object('key','workers_comp','label','Workers compensation or Utah waiver','status',v_wc_status,'expires_on',v_wc_end),
      jsonb_build_object('key','general_liability','label','General liability','status',v_gl_status,'expires_on',v_gl_end)
    ),
    'documents',CASE WHEN v_role='project_manager' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',d.id,'document_type',d.document_type,'version_number',d.version_number,
        'state',d.review_state,'review_state',d.review_state,
        'coverage_start_date',d.coverage_start_date,'coverage_end_date',d.coverage_end_date,
        'tax_year',d.tax_year,'original_filename',d.original_filename,'mime_type',d.mime_type,
        'byte_size',d.byte_size,'received_at',d.received_at,'received_source',d.received_source,
        'verified_at',d.verified_at,'rejection_reason',d.rejection_reason
      ) ORDER BY d.document_type,d.version_number DESC)
      FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id
    ),'[]'::jsonb) END,
    'coverage_timeline',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',d.id,'document_type',d.document_type,'state',d.review_state,
        'start_on',d.coverage_start_date,'end_on',d.coverage_end_date
      ) ORDER BY d.coverage_start_date,d.coverage_end_date)
      FROM public.contractor_compliance_documents d
      WHERE d.profile_id=p.id AND d.document_type<>'w9' AND d.review_state IN ('accepted','superseded')
    ),'[]'::jsonb),
    'requests',CASE WHEN v_role='project_manager' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',r.id,'requested_document_types',r.requested_document_types,'expires_at',r.expires_at,
        'sent_at',r.sent_at,'paused_at',r.paused_at,'revoked_at',r.revoked_at,
        'completed_at',r.completed_at,'created_at',r.created_at,
        'state',CASE WHEN r.completed_at IS NOT NULL THEN 'completed' WHEN r.revoked_at IS NOT NULL THEN 'revoked' WHEN r.paused_at IS NOT NULL THEN 'paused' WHEN r.expires_at<=now() THEN 'expired' ELSE 'open' END,
        'deliveries',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'stage',x.stage_key,'status',x.status,'sent_at',x.sent_at,
          'completed_at',x.completed_at,'outcome_reason',x.outcome_reason
        ) ORDER BY x.created_at) FROM public.contractor_compliance_request_deliveries x WHERE x.request_id=r.id),'[]'::jsonb)
      ) ORDER BY r.created_at DESC)
      FROM public.contractor_compliance_requests r WHERE r.profile_id=p.id
    ),'[]'::jsonb) END,
    'activity',CASE WHEN v_role='project_manager' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'event_type',a.event_type,'note',a.note,
        'safe_metadata',a.safe_metadata,'created_at',a.created_at
      ) ORDER BY a.created_at DESC)
      FROM public.contractor_compliance_activity a WHERE a.profile_id=p.id
    ),'[]'::jsonb) END,
    'permissions',jsonb_build_object('can_manage',v_role IN ('admin','office'),'can_view_files',v_role IN ('admin','office'),'readiness_only',v_role='project_manager'),
    'audit',jsonb_build_object('start_date',v_start,'end_date',v_end,'timezone','America/Denver','mode',CASE WHEN p_audit_start IS NULL THEN 'current' ELSE 'audit' END)
  ) INTO v_result
  FROM public.contractor_compliance_profiles p
  JOIN public.contacts c ON c.id=p.contact_id
  LEFT JOIN public.employees owner ON owner.id=p.assigned_owner_id
  WHERE p.id=v_profile;
  RETURN v_result;
END;
$function$;

-- Service-only command boundary. Workers authenticate their internal actor here;
-- public callers are authenticated by the Worker before any of these are called.
CREATE OR REPLACE FUNCTION public.contractor_compliance_ingest_document(
  p_actor_employee_id uuid DEFAULT NULL, p_request_id uuid DEFAULT NULL, p_contractor_id uuid DEFAULT NULL,
  p_document_type text DEFAULT NULL, p_source text DEFAULT 'internal_upload', p_storage_bucket text DEFAULT 'contractor-compliance-private',
  p_storage_path text DEFAULT NULL, p_original_filename text DEFAULT NULL, p_mime_type text DEFAULT NULL,
  p_byte_size bigint DEFAULT NULL, p_content_sha256 text DEFAULT NULL, p_effective_date date DEFAULT NULL,
  p_expiration_date date DEFAULT NULL, p_tax_year integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_profile uuid; v_id uuid; v_version integer;
BEGIN
  SELECT p.id INTO v_profile FROM public.contractor_compliance_profiles p JOIN public.contacts c ON c.id=p.contact_id AND c.role='subcontractor' WHERE p.contact_id=p_contractor_id FOR UPDATE;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: contractor profile not found' USING errcode='P0002'; END IF;
  IF p_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.contractor_compliance_requests r
    JOIN public.contractor_compliance_profiles p ON p.id=r.profile_id
    WHERE r.id=p_request_id AND r.profile_id=v_profile
      AND p.is_active IS TRUE AND p.requests_paused_at IS NULL
      AND p_document_type=ANY(r.requested_document_types)
      AND r.expires_at>now() AND r.revoked_at IS NULL AND r.paused_at IS NULL
      AND r.completed_at IS NULL AND r.upload_count<r.max_uploads
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: invalid upload request' USING errcode='42501'; END IF;
  IF p_request_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  SELECT COALESCE(max(d.version_number),0)+1 INTO v_version FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type=p_document_type;
  INSERT INTO public.contractor_compliance_documents(profile_id,document_type,version_number,review_state,coverage_start_date,coverage_end_date,tax_year,received_source,storage_bucket,storage_object_path,original_filename,mime_type,byte_size,sha256_hex)
  VALUES(v_profile,p_document_type,v_version,'pending_review',p_effective_date,p_expiration_date,p_tax_year,p_source,p_storage_bucket,p_storage_path,p_original_filename,p_mime_type,p_byte_size,lower(p_content_sha256)) RETURNING id INTO v_id;
  IF p_request_id IS NOT NULL THEN UPDATE public.contractor_compliance_requests SET upload_count=upload_count+1,updated_at=now() WHERE id=p_request_id; END IF;
  INSERT INTO public.contractor_compliance_activity(profile_id,document_id,request_id,actor_employee_id,event_type) VALUES(v_profile,v_id,p_request_id,p_actor_employee_id,'document_received');
  RETURN jsonb_build_object('id',v_id,'review_state','pending_review','version_number',v_version);
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_review_document(p_actor_employee_id uuid, p_document_id uuid, p_review_state text, p_rejection_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_profile uuid; v_type text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  IF p_review_state NOT IN ('accepted','rejected') OR (p_review_state='rejected' AND NULLIF(btrim(p_rejection_reason),'') IS NULL) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: accepted or reasoned rejection required' USING errcode='22023';
  END IF;
  UPDATE public.contractor_compliance_documents
  SET review_state=p_review_state,verified_by=p_actor_employee_id,verified_at=now(),
      rejection_reason=CASE WHEN p_review_state='rejected' THEN NULLIF(btrim(p_rejection_reason),'') ELSE NULL END
  WHERE id=p_document_id AND review_state='pending_review'
  RETURNING profile_id,document_type INTO v_profile,v_type;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: reviewable document not found' USING errcode='P0002'; END IF;
  INSERT INTO public.contractor_compliance_activity(profile_id,document_id,actor_employee_id,event_type) VALUES(v_profile,p_document_id,p_actor_employee_id,'document_' || p_review_state);
  IF p_review_state='accepted' THEN
    UPDATE public.contractor_compliance_documents
    SET review_state='superseded',superseded_at=now(),superseded_by_document_id=p_document_id
    WHERE profile_id=v_profile AND document_type=v_type AND id<>p_document_id AND review_state='accepted';
    UPDATE public.contractor_compliance_requests r SET completed_at=now(),updated_at=now()
    WHERE r.profile_id=v_profile AND r.completed_at IS NULL AND r.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM unnest(r.requested_document_types) typ WHERE
        (typ='w9' AND NOT EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type='w9' AND d.review_state IN ('accepted','superseded') AND d.tax_year=(SELECT required_w9_year FROM public.contractor_compliance_profiles WHERE id=v_profile)))
        OR (typ='general_liability' AND COALESCE(public.contractor_compliance_continuous_coverage_end(v_profile,ARRAY['general_liability'],(now() AT TIME ZONE 'America/Denver')::date),'0001-01-01'::date)
              <= COALESCE(NULLIF(substring(r.request_identity FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$'), '')::date,(now() AT TIME ZONE 'America/Denver')::date))
        OR (typ IN ('workers_comp','workers_comp_waiver') AND COALESCE(public.contractor_compliance_continuous_coverage_end(v_profile,ARRAY['workers_comp','workers_comp_waiver'],(now() AT TIME ZONE 'America/Denver')::date),'0001-01-01'::date)
              <= COALESCE(NULLIF(substring(r.request_identity FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$'), '')::date,(now() AT TIME ZONE 'America/Denver')::date))
      );
  END IF;
  RETURN jsonb_build_object('id',p_document_id,'review_state',p_review_state);
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_append_activity(p_actor_employee_id uuid, p_contractor_id uuid, p_activity_type text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_profile uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  SELECT id INTO v_profile FROM public.contractor_compliance_profiles WHERE contact_id=p_contractor_id;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: contractor profile not found' USING errcode='P0002'; END IF;
  INSERT INTO public.contractor_compliance_activity(profile_id,actor_employee_id,event_type,note) VALUES(v_profile,p_actor_employee_id,p_activity_type,NULLIF(btrim(p_note),''));
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_create_request(p_actor_employee_id uuid, p_contractor_id uuid, p_document_types text[], p_recipient_email text DEFAULT NULL, p_expires_in_days integer DEFAULT 30, p_source text DEFAULT 'manual', p_token_digest text DEFAULT NULL, p_request_identity text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_profile uuid; v_id uuid; v_identity text; v_contact_email text;
BEGIN
  IF NOT ((p_actor_employee_id IS NULL AND p_source='automated_reminder' AND current_setting('request.jwt.claim.role',true)='service_role') OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office'))) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  IF p_expires_in_days NOT BETWEEN 1 AND 90 OR p_token_digest !~ '^[0-9a-f]{64}$'
     OR NULLIF(btrim(p_request_identity),'') IS NULL
     OR cardinality(p_document_types)<1
     OR NOT p_document_types <@ ARRAY['w9','workers_comp','workers_comp_waiver','general_liability']::text[] THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: request identity, document types, expiry, or digest' USING errcode='22023';
  END IF;
  SELECT p.id,c.email INTO v_profile,v_contact_email
  FROM public.contractor_compliance_profiles p
  JOIN public.contacts c ON c.id=p.contact_id AND c.role='subcontractor'
  WHERE p.contact_id=p_contractor_id AND p.is_active IS TRUE;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: active contractor profile not found' USING errcode='P0002'; END IF;
  v_identity := btrim(p_request_identity);
  INSERT INTO public.contractor_compliance_requests(profile_id,request_identity,requested_document_types,recipient_email,token_digest,expires_at,created_by,source)
  VALUES(v_profile,v_identity,ARRAY(SELECT DISTINCT typ FROM unnest(p_document_types) typ ORDER BY typ),lower(COALESCE(NULLIF(btrim(p_recipient_email),''),NULLIF(btrim(v_contact_email),''))),lower(p_token_digest),now()+make_interval(days=>p_expires_in_days),p_actor_employee_id,p_source)
  ON CONFLICT(request_identity) DO UPDATE SET updated_at=public.contractor_compliance_requests.updated_at
  WHERE public.contractor_compliance_requests.token_digest=EXCLUDED.token_digest AND public.contractor_compliance_requests.profile_id=EXCLUDED.profile_id AND public.contractor_compliance_requests.requested_document_types=EXCLUDED.requested_document_types
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: request identity mismatch' USING errcode='23505'; END IF;
  INSERT INTO public.contractor_compliance_activity(profile_id,request_id,actor_employee_id,event_type)
  SELECT v_profile,v_id,p_actor_employee_id,'request_created'
  WHERE NOT EXISTS (SELECT 1 FROM public.contractor_compliance_activity a WHERE a.request_id=v_id AND a.event_type='request_created');
  IF p_source='automated_reminder' AND v_identity LIKE '%:overdue_week_%' THEN
    INSERT INTO public.contractor_compliance_activity(profile_id,request_id,event_type,note)
    SELECT v_profile,v_id,'overdue_escalated','Overdue compliance follow-up is assigned to the internal owner.'
    WHERE NOT EXISTS (SELECT 1 FROM public.contractor_compliance_activity a WHERE a.request_id=v_id AND a.event_type='overdue_escalated');
  END IF;
  RETURN jsonb_build_object('request_id',v_id,'expires_at',now()+make_interval(days=>p_expires_in_days));
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_mutate_request(p_actor_employee_id uuid, p_request_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_profile uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  UPDATE public.contractor_compliance_requests SET paused_at=CASE WHEN p_action='pause' THEN now() WHEN p_action='resume' THEN NULL ELSE paused_at END,paused_by=CASE WHEN p_action='pause' THEN p_actor_employee_id WHEN p_action='resume' THEN NULL ELSE paused_by END,pause_reason=CASE WHEN p_action='pause' THEN COALESCE(NULLIF(btrim(p_reason),''),'paused by manager') WHEN p_action='resume' THEN NULL ELSE pause_reason END,revoked_at=CASE WHEN p_action='revoke' THEN now() ELSE revoked_at END,revoked_by=CASE WHEN p_action='revoke' THEN p_actor_employee_id ELSE revoked_by END,revoke_reason=CASE WHEN p_action='revoke' THEN COALESCE(NULLIF(btrim(p_reason),''),'revoked by manager') ELSE revoke_reason END,updated_at=now() WHERE id=p_request_id AND p_action IN ('pause','resume','revoke') RETURNING profile_id INTO v_profile;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: request not found' USING errcode='P0002'; END IF;
  INSERT INTO public.contractor_compliance_activity(profile_id,request_id,actor_employee_id,event_type) VALUES(v_profile,p_request_id,p_actor_employee_id,'request_' || p_action);
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_public_request(p_token_digest text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  SELECT jsonb_build_object('request_id',r.id,'contractor_id',p.contact_id,'requested_document_types',r.requested_document_types,'expires_at',r.expires_at)
  FROM public.contractor_compliance_requests r JOIN public.contractor_compliance_profiles p ON p.id=r.profile_id
  WHERE r.token_digest=lower($1) AND r.expires_at>now() AND r.revoked_at IS NULL AND r.paused_at IS NULL AND r.completed_at IS NULL AND r.upload_count<r.max_uploads;
$function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_record_public_attempt(p_request_id uuid, p_token_digest text, p_ip_digest text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contractor_compliance_requests r WHERE r.id=p_request_id AND r.token_digest=lower(p_token_digest) AND r.expires_at>now() AND r.revoked_at IS NULL AND r.paused_at IS NULL) THEN RETURN false; END IF;
  INSERT INTO public.contractor_compliance_public_attempts(request_id,ip_hash,window_started_at,attempt_count) VALUES(p_request_id,COALESCE(lower(p_ip_digest),repeat('0',64)),date_trunc('hour',now()),1) ON CONFLICT(request_id,ip_hash,window_started_at) DO UPDATE SET attempt_count=public.contractor_compliance_public_attempts.attempt_count+1,last_attempt_at=now() RETURNING attempt_count INTO v_count;
  RETURN v_count <= 10;
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_authorize_document_file(p_actor_employee_id uuid, p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: W-9 file access requires manager role' USING errcode='42501'; END IF;
  RETURN (SELECT jsonb_build_object('storage_bucket',d.storage_bucket,'storage_object_path',d.storage_object_path,'original_filename',d.original_filename) FROM public.contractor_compliance_documents d WHERE d.id=p_document_id);
END; $function$;

-- Emits at most one due stage per requirement on a daily run. A later Worker
-- derives the raw HMAC token from identity; the database stores only its digest.
CREATE OR REPLACE FUNCTION public.contractor_compliance_reminder_candidates(p_limit integer DEFAULT 100)
RETURNS TABLE(request_identity text, contractor_id uuid, document_types text[], recipient_email text, stage text, requirement_label text, due_label text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
WITH t AS (SELECT (now() AT TIME ZONE 'America/Denver')::date today), base AS (
  SELECT p.id,p.contact_id,c.email,p.required_w9_year,t.today,(p.created_at AT TIME ZONE 'America/Denver')::date profile_start,
    EXISTS(SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=p.id AND d.document_type='w9' AND d.review_state IN ('accepted','superseded') AND d.tax_year=p.required_w9_year) w9_ok,
    public.contractor_compliance_continuous_coverage_end(p.id,ARRAY['workers_comp','workers_comp_waiver'],t.today) wc_end,
    public.contractor_compliance_continuous_coverage_end(p.id,ARRAY['general_liability'],t.today) gl_end
  FROM public.contractor_compliance_profiles p
  JOIN public.contacts c ON c.id=p.contact_id AND c.role='subcontractor'
  CROSS JOIN t
  WHERE p.is_active AND p.requests_paused_at IS NULL
), req AS (
  SELECT contact_id,email,today,'w9' kind,ARRAY['w9']::text[] types,make_date(required_w9_year,1,1) anchor,false missing,'current-year W-9' label FROM base WHERE NOT w9_ok
  UNION ALL SELECT contact_id,email,today,'workers_comp',ARRAY['workers_comp','workers_comp_waiver'],COALESCE(wc_end,profile_start),wc_end IS NULL,'workers compensation coverage or Utah waiver' FROM base WHERE wc_end IS NULL OR wc_end<=today+60
  UNION ALL SELECT contact_id,email,today,'general_liability',ARRAY['general_liability'],COALESCE(gl_end,profile_start),gl_end IS NULL,'general liability certificate' FROM base WHERE gl_end IS NULL OR gl_end<=today+60
), stages AS (
  SELECT r.*, s.stage,s.due
  FROM req r
  CROSS JOIN LATERAL (
    SELECT due_stage.stage,due_stage.due
    FROM (
      SELECT 'missing_initial'::text stage,r.anchor due WHERE r.missing
      UNION ALL
      SELECT scheduled.stage,scheduled.due
      FROM (VALUES ('60d',r.anchor-60),('30d',r.anchor-30),('14d',r.anchor-14),('7d',r.anchor-7),('expiration',r.anchor)) scheduled(stage,due)
      WHERE NOT r.missing
      UNION ALL
      SELECT 'overdue_week_'||g::text,r.anchor+(g*7) FROM generate_series(1,8) g
    ) due_stage
    WHERE due_stage.due<=r.today
    ORDER BY due_stage.due DESC
    LIMIT 1
  ) s
)
SELECT 'contractor:'||contact_id::text||':'||kind||':'||stage||':'||anchor::text,contact_id,types,email,stage,label,
  CASE WHEN stage LIKE 'overdue%' THEN 'overdue' WHEN stage='expiration' THEN 'expires today' WHEN stage='missing_initial' THEN 'missing now' ELSE 'renewal due' END
FROM stages WHERE email IS NOT NULL ORDER BY due,contact_id LIMIT LEAST(GREATEST(p_limit,1),500);
$function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_claim_delivery(p_request_id uuid, p_stage text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_delivery public.contractor_compliance_request_deliveries; v_contact uuid; v_types text[];
BEGIN
  IF NULLIF(btrim(p_stage),'') IS NULL OR length(p_stage)>80 THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contractor_compliance_requests r JOIN public.contractor_compliance_profiles p ON p.id=r.profile_id
    WHERE r.id=p_request_id AND p.is_active AND p.requests_paused_at IS NULL AND r.expires_at>now() AND r.revoked_at IS NULL AND r.paused_at IS NULL AND r.completed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM unnest(r.requested_document_types) typ
        WHERE
          (typ='w9' AND NOT EXISTS (
            SELECT 1 FROM public.contractor_compliance_documents d
            WHERE d.profile_id=p.id AND d.document_type='w9'
              AND d.review_state IN ('accepted','superseded') AND d.tax_year=p.required_w9_year
          ))
          OR (typ='general_liability' AND COALESCE(public.contractor_compliance_continuous_coverage_end(
                p.id,ARRAY['general_liability'],(now() AT TIME ZONE 'America/Denver')::date
              ),'0001-01-01'::date)
              <= COALESCE(NULLIF(substring(r.request_identity FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$'), '')::date,(now() AT TIME ZONE 'America/Denver')::date))
          OR (typ IN ('workers_comp','workers_comp_waiver') AND COALESCE(public.contractor_compliance_continuous_coverage_end(
                p.id,ARRAY['workers_comp','workers_comp_waiver'],(now() AT TIME ZONE 'America/Denver')::date
              ),'0001-01-01'::date)
              <= COALESCE(NULLIF(substring(r.request_identity FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$'), '')::date,(now() AT TIME ZONE 'America/Denver')::date))
      )
  ) THEN RETURN NULL; END IF;
  INSERT INTO public.contractor_compliance_request_deliveries(request_id,stage_key,idempotency_key,status) VALUES(p_request_id,p_stage,'contractor-compliance:' || p_request_id::text || ':' || p_stage,'claimed') ON CONFLICT(request_id,stage_key) DO NOTHING RETURNING * INTO v_delivery;
  IF v_delivery.id IS NULL THEN RETURN NULL; END IF;
  SELECT p.contact_id,r.requested_document_types INTO v_contact,v_types
  FROM public.contractor_compliance_requests r
  JOIN public.contractor_compliance_profiles p ON p.id=r.profile_id
  WHERE r.id=p_request_id;
  RETURN jsonb_build_object(
    'delivery_id',v_delivery.id,'contractor_id',v_contact,'contact_id',v_contact,
    'document_types',v_types,'provider_idempotency_key',v_delivery.idempotency_key
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_finish_delivery(p_delivery_id uuid, p_outcome text, p_provider_message_id text DEFAULT NULL, p_skip_reason text DEFAULT NULL, p_ambiguous boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_request uuid;
BEGIN
  UPDATE public.contractor_compliance_request_deliveries
  SET status=CASE WHEN p_ambiguous THEN 'ambiguous' WHEN p_outcome IN ('sent','suppressed','failed','cancelled') THEN p_outcome ELSE 'failed' END,
      provider_message_id=NULLIF(btrim(p_provider_message_id),''),
      outcome_reason=NULLIF(btrim(p_skip_reason),''),
      sent_at=CASE WHEN p_outcome='sent' AND p_ambiguous IS FALSE THEN now() ELSE sent_at END,
      completed_at=now()
  WHERE id=p_delivery_id AND status='claimed'
  RETURNING request_id INTO v_request;
  IF v_request IS NULL THEN RETURN; END IF;
  IF p_outcome = 'sent' AND p_ambiguous IS FALSE THEN
    UPDATE public.contractor_compliance_requests SET sent_at=now(),updated_at=now() WHERE id=v_request;
    INSERT INTO public.contractor_compliance_activity(profile_id,request_id,event_type)
    SELECT r.profile_id,r.id,'request_email_sent' FROM public.contractor_compliance_requests r WHERE r.id=v_request;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_advance_w9_year()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_year integer := EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Denver'))::integer; v_count integer;
BEGIN
  UPDATE public.contractor_compliance_profiles SET required_w9_year=v_year,updated_at=now() WHERE is_active IS TRUE AND required_w9_year<v_year;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_mutate_profile_requests(p_actor_employee_id uuid,p_contractor_id uuid,p_action text,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_profile uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  UPDATE public.contractor_compliance_profiles SET requests_paused_at=CASE WHEN p_action='pause_reminders' THEN now() WHEN p_action='resume_reminders' THEN NULL ELSE requests_paused_at END,requests_paused_by=CASE WHEN p_action='pause_reminders' THEN p_actor_employee_id WHEN p_action='resume_reminders' THEN NULL ELSE requests_paused_by END,requests_pause_reason=CASE WHEN p_action='pause_reminders' THEN NULLIF(btrim(p_reason),'') WHEN p_action='resume_reminders' THEN NULL ELSE requests_pause_reason END,updated_at=now() WHERE contact_id=p_contractor_id AND p_action IN ('pause_reminders','resume_reminders') RETURNING id INTO v_profile;
  IF v_profile IS NULL OR (p_action='pause_reminders' AND NULLIF(btrim(p_reason),'') IS NULL) THEN RAISE EXCEPTION 'INVALID_ARGUMENT: profile or pause reason' USING errcode='22023'; END IF;
  INSERT INTO public.contractor_compliance_activity(profile_id,actor_employee_id,event_type,note) VALUES(v_profile,p_actor_employee_id,'profile_'||p_action,NULLIF(btrim(p_reason),''));
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_set_profile_active(p_actor_employee_id uuid,p_contractor_id uuid,p_is_active boolean,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_profile uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  IF p_is_active IS FALSE AND NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'INVALID_ARGUMENT: deactivation reason required' USING errcode='22023'; END IF;
  UPDATE public.contractor_compliance_profiles SET is_active=p_is_active,updated_at=now() WHERE contact_id=p_contractor_id RETURNING id INTO v_profile;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: contractor profile not found' USING errcode='P0002'; END IF;
  INSERT INTO public.contractor_compliance_activity(profile_id,actor_employee_id,event_type,note) VALUES(v_profile,p_actor_employee_id,CASE WHEN p_is_active THEN 'profile_activated' ELSE 'profile_deactivated' END,NULLIF(btrim(p_reason),''));
END; $function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_rotate_request(p_actor_employee_id uuid,p_old_request_id uuid,p_token_digest text,p_request_identity text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_old public.contractor_compliance_requests; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active AND NOT e.is_external AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  SELECT id INTO v_id FROM public.contractor_compliance_requests WHERE request_identity=p_request_identity;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('request_id',v_id); END IF;
  SELECT * INTO v_old FROM public.contractor_compliance_requests WHERE id=p_old_request_id FOR UPDATE;
  IF v_old.id IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_ARGUMENT: request rotation' USING errcode='22023'; END IF;
  UPDATE public.contractor_compliance_requests SET revoked_at=now(),revoked_by=p_actor_employee_id,revoke_reason='rotated request',updated_at=now() WHERE id=v_old.id;
  INSERT INTO public.contractor_compliance_requests(profile_id,request_identity,requested_document_types,recipient_email,token_digest,expires_at,created_by,source,supersedes_request_id) VALUES(v_old.profile_id,p_request_identity,v_old.requested_document_types,v_old.recipient_email,lower(p_token_digest),now()+interval '30 days',p_actor_employee_id,'manual_resend',v_old.id) RETURNING id INTO v_id;
  RETURN jsonb_build_object('request_id',v_id);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_contractor_compliance_detail(uuid,date,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.contractor_compliance_has_continuous_coverage(uuid,text[],date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.contractor_compliance_continuous_coverage_end(uuid,text[],date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_contractor_compliance_detail(uuid,date,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contractor_compliance_has_continuous_coverage(uuid,text[],date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.contractor_compliance_continuous_coverage_end(uuid,text[],date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.ensure_contractor_compliance_profile(), public.contractor_compliance_advance_w9_year(), public.contractor_compliance_mutate_profile_requests(uuid,uuid,text,text), public.contractor_compliance_set_profile_active(uuid,uuid,boolean,text), public.contractor_compliance_rotate_request(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_compliance_advance_w9_year(), public.contractor_compliance_mutate_profile_requests(uuid,uuid,text,text), public.contractor_compliance_set_profile_active(uuid,uuid,boolean,text), public.contractor_compliance_rotate_request(uuid,uuid,text,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.contractor_compliance_ingest_document(uuid,uuid,uuid,text,text,text,text,text,text,bigint,text,date,date,integer), public.contractor_compliance_review_document(uuid,uuid,text,text), public.contractor_compliance_append_activity(uuid,uuid,text,text), public.contractor_compliance_create_request(uuid,uuid,text[],text,integer,text,text,text), public.contractor_compliance_mutate_request(uuid,uuid,text,text), public.contractor_compliance_public_request(text), public.contractor_compliance_record_public_attempt(uuid,text,text), public.contractor_compliance_authorize_document_file(uuid,uuid), public.contractor_compliance_reminder_candidates(integer), public.contractor_compliance_claim_delivery(uuid,text), public.contractor_compliance_finish_delivery(uuid,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_compliance_ingest_document(uuid,uuid,uuid,text,text,text,text,text,text,bigint,text,date,date,integer), public.contractor_compliance_review_document(uuid,uuid,text,text), public.contractor_compliance_append_activity(uuid,uuid,text,text), public.contractor_compliance_create_request(uuid,uuid,text[],text,integer,text,text,text), public.contractor_compliance_mutate_request(uuid,uuid,text,text), public.contractor_compliance_public_request(text), public.contractor_compliance_record_public_attempt(uuid,text,text), public.contractor_compliance_authorize_document_file(uuid,uuid), public.contractor_compliance_reminder_candidates(integer), public.contractor_compliance_claim_delivery(uuid,text), public.contractor_compliance_finish_delivery(uuid,text,text,text,boolean) TO service_role;

-- Daily source wiring. The Worker itself remains inert unless both Cloudflare
-- feature bindings are exactly "true"; applying this source alone cannot send.
INSERT INTO public.integration_config(key,value)
VALUES ('contractor_compliance_reminder_worker_url','https://utahpros.app/api/contractor-compliance-reminders')
ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.contractor_compliance_reminder_poll()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_url text; v_secret text;
BEGIN
  SELECT value INTO v_url FROM public.integration_config WHERE key='contractor_compliance_reminder_worker_url';
  SELECT value INTO v_secret FROM public.integration_config WHERE key='cron_worker_secret';
  IF v_url NOT IN (
    'https://dev.utahpros.app/api/contractor-compliance-reminders',
    'https://utahpros.app/api/contractor-compliance-reminders'
  ) OR NULLIF(btrim(v_secret),'') IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url:=v_url,
    headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',v_secret),
    body:='{}'::jsonb,
    timeout_milliseconds:=30000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.contractor_compliance_reminder_poll() FROM PUBLIC, anon, authenticated, service_role;

-- 13:23 UTC runs in the early Denver morning and stays off the hour boundary.
SELECT cron.schedule(
  'upr_contractor_compliance_reminders_daily',
  '23 13 * * *',
  $$ SELECT public.contractor_compliance_reminder_poll(); $$
);

NOTIFY pgrst, 'reload schema';
