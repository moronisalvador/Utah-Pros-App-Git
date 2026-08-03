-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260803220000_contractor_compliance_read_auth_fail_closed
-- WHAT: Preserve the five public read RPC contracts while making a missing,
--       inactive, or external employee identity fail closed.
-- SECURITY: SECURITY DEFINER bodies keep pinned search paths and explicit ACLs.
-- ROLLBACK: supabase/rollbacks/20260803220000_contractor_compliance_read_auth_fail_closed.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

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
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND (v_role IS NULL OR v_role NOT IN ('admin', 'office', 'project_manager')) THEN
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

REVOKE EXECUTE ON FUNCTION
  public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date)
FROM PUBLIC, anon;

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
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND (v_role IS NULL OR v_role NOT IN ('admin','office','project_manager')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance access required' USING errcode='42501';
  END IF;
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

REVOKE EXECUTE ON FUNCTION
  public.get_contractor_compliance_detail(uuid,date,date)
FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_contractor_compliance_audit_periods()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_role text;
  v_result jsonb;
BEGIN
  SELECT e.role::text INTO v_role
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid() AND e.is_active AND NOT e.is_external;
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND (v_role IS NULL OR v_role NOT IN ('admin', 'office', 'project_manager')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: contractor audit access required' USING errcode = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'start_date', p.start_date,
    'end_date', p.end_date,
    'status', p.status,
    'inclusion_basis', p.inclusion_basis,
    'materialized_at', p.materialized_at,
    'locked_at', p.locked_at,
    'roster_count', (
      SELECT count(*) FROM public.contractor_compliance_audit_roster r
      WHERE r.audit_period_id = p.id AND r.included
    )
  ) ORDER BY p.start_date DESC, p.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM public.contractor_compliance_audit_periods p;
  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION
  public.get_contractor_compliance_audit_periods()
FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_contractor_compliance_audit_manifest(
  p_audit_period_id uuid,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_paid_filter text DEFAULT NULL,
  p_active_filter text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_role text;
  v_period public.contractor_compliance_audit_periods;
  v_result jsonb;
BEGIN
  SELECT e.role::text INTO v_role
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid() AND e.is_active AND NOT e.is_external;
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND (v_role IS NULL OR v_role NOT IN ('admin', 'office', 'project_manager')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: contractor audit access required' USING errcode = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100
     OR p_offset < 0
     OR COALESCE(p_status, 'all') NOT IN ('all', 'ready', 'gap')
     OR COALESCE(p_paid_filter, 'all') NOT IN ('all', 'yes', 'no', 'unknown')
     OR COALESCE(p_active_filter, 'all') NOT IN ('all', 'yes', 'no', 'unknown') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: manifest filters' USING errcode = '22023';
  END IF;
  IF v_role = 'project_manager'
     AND (
       COALESCE(p_paid_filter, 'all') <> 'all'
       OR COALESCE(p_active_filter, 'all') <> 'all'
     ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: period fact filters require audit manager' USING errcode = '42501';
  END IF;
  SELECT * INTO v_period
  FROM public.contractor_compliance_audit_periods
  WHERE id = p_audit_period_id;
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: audit period missing' USING errcode = 'P0002';
  END IF;

  WITH roster_rows AS (
    SELECT
      r.profile_id,
      c.id AS contact_id,
      c.name,
      c.company,
      c.trade_specialty,
      r.inclusion_source,
      r.active_in_period,
      r.paid_in_period,
      r.external_source,
      r.source_external_id,
      r.reconciliation_state,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.contractor_compliance_audit_evidence e
        WHERE e.audit_period_id = r.audit_period_id
          AND e.profile_id = r.profile_id
          AND e.requirement_group = 'workers_comp'
          AND e.interval_kind = 'gap'
      ) THEN 'gap' ELSE 'ready' END AS workers_comp_status,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.contractor_compliance_audit_evidence e
        WHERE e.audit_period_id = r.audit_period_id
          AND e.profile_id = r.profile_id
          AND e.requirement_group = 'general_liability'
          AND e.interval_kind = 'gap'
      ) THEN 'gap' ELSE 'ready' END AS general_liability_status,
      (
        SELECT count(*) FROM public.contractor_compliance_audit_requests q
        WHERE q.audit_period_id = r.audit_period_id AND q.profile_id = r.profile_id
      ) AS request_count,
      (
        SELECT max(q.sent_at_snapshot) FROM public.contractor_compliance_audit_requests q
        WHERE q.audit_period_id = r.audit_period_id AND q.profile_id = r.profile_id
      ) AS last_request_at
    FROM public.contractor_compliance_audit_roster r
    JOIN public.contractor_compliance_profiles p ON p.id = r.profile_id
    JOIN public.contacts c ON c.id = p.contact_id
    WHERE r.audit_period_id = v_period.id AND r.included
  ),
  classified AS (
    SELECT *,
      CASE
        WHEN workers_comp_status = 'gap' OR general_liability_status = 'gap' THEN 'gap'
        ELSE 'ready'
      END AS overall_status
    FROM roster_rows
  ),
  filtered AS (
    SELECT * FROM classified
    WHERE (
      NULLIF(btrim(p_search), '') IS NULL
      OR name ILIKE '%' || btrim(p_search) || '%'
      OR company ILIKE '%' || btrim(p_search) || '%'
      OR trade_specialty ILIKE '%' || btrim(p_search) || '%'
    )
      AND (COALESCE(p_status, 'all') = 'all' OR overall_status = p_status)
      AND (
        COALESCE(p_paid_filter, 'all') = 'all'
        OR (p_paid_filter = 'yes' AND paid_in_period IS TRUE)
        OR (p_paid_filter = 'no' AND paid_in_period IS FALSE)
        OR (p_paid_filter = 'unknown' AND paid_in_period IS NULL)
      )
      AND (
        COALESCE(p_active_filter, 'all') = 'all'
        OR (p_active_filter = 'yes' AND active_in_period IS TRUE)
        OR (p_active_filter = 'no' AND active_in_period IS FALSE)
        OR (p_active_filter = 'unknown' AND active_in_period IS NULL)
      )
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'id', v_period.id,
      'name', v_period.name,
      'start_date', v_period.start_date,
      'end_date', v_period.end_date,
      'status', v_period.status,
      'materialized_at', v_period.materialized_at,
      'locked_at', v_period.locked_at
    ),
    'total', (SELECT count(*) FROM filtered),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'contractor_id', f.contact_id,
        'name', f.name,
        'company', f.company,
        'trade_specialty', f.trade_specialty,
        'inclusion_source', f.inclusion_source,
        'active_in_period', CASE WHEN v_role IN ('admin', 'office') THEN f.active_in_period END,
        'paid_in_period', CASE WHEN v_role IN ('admin', 'office') THEN f.paid_in_period END,
        'external_source', CASE WHEN v_role IN ('admin', 'office') THEN f.external_source END,
        'source_external_id', CASE WHEN v_role IN ('admin', 'office') THEN f.source_external_id END,
        'reconciliation_state', CASE WHEN v_role IN ('admin', 'office') THEN f.reconciliation_state END,
        'overall_status', f.overall_status,
        'workers_comp_status', f.workers_comp_status,
        'general_liability_status', f.general_liability_status,
        'request_count', f.request_count,
        'last_request_at', f.last_request_at,
        'evidence', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'requirement_group', e.requirement_group,
            'interval_kind', e.interval_kind,
            'start_date', e.interval_start,
            'end_date', e.interval_end,
            'document_id', CASE WHEN v_role IN ('admin', 'office') THEN e.document_id END,
            'document_version', e.document_version
          ) ORDER BY e.requirement_group, e.interval_start, e.interval_kind)
          FROM public.contractor_compliance_audit_evidence e
          WHERE e.audit_period_id = v_period.id AND e.profile_id = f.profile_id
        ), '[]'::jsonb)
      ) ORDER BY CASE f.overall_status WHEN 'gap' THEN 1 ELSE 2 END, f.name)
      FROM (
        SELECT * FROM filtered
        ORDER BY CASE overall_status WHEN 'gap' THEN 1 ELSE 2 END, name
        LIMIT p_limit OFFSET p_offset
      ) f
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION
  public.get_contractor_compliance_audit_manifest(uuid,text,text,text,text,integer,integer)
FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_contractor_w9_tax_year_checklist(
  p_tax_year integer,
  p_search text DEFAULT NULL,
  p_w9_status text DEFAULT NULL,
  p_provider_target text DEFAULT NULL,
  p_handoff_status text DEFAULT NULL,
  p_active_only boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_role text;
  v_result jsonb;
BEGIN
  SELECT e.role::text INTO v_role
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid() AND e.is_active AND NOT e.is_external;
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND (v_role IS NULL OR v_role NOT IN ('admin', 'office')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: W-9 checklist access required' USING errcode = '42501';
  END IF;
  IF p_tax_year NOT BETWEEN 2000 AND 2200
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_offset < 0
     OR COALESCE(p_w9_status, 'all')
        NOT IN ('all', 'valid', 'missing', 'needs_review', 'rejected', 'stale_previous_year')
     OR COALESCE(p_provider_target, 'all')
        NOT IN ('all', 'unassigned', 'quickbooks', 'gusto', 'quickbooks_and_gusto', 'other')
     OR COALESCE(p_handoff_status, 'all')
        NOT IN ('all', 'not_ready', 'ready', 'handed_off', 'reconciled') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: W-9 checklist filters' USING errcode = '22023';
  END IF;

  WITH document_facts AS (
    SELECT
      p.id AS profile_id,
      p.contact_id,
      p.is_active,
      p.required_w9_year,
      EXISTS (
        SELECT 1 FROM public.contractor_compliance_documents d
        WHERE d.profile_id = p.id
          AND d.document_type = 'w9'
          AND d.tax_year = p_tax_year
          AND d.review_state IN ('accepted', 'superseded')
      ) AS has_valid,
      EXISTS (
        SELECT 1 FROM public.contractor_compliance_documents d
        WHERE d.profile_id = p.id
          AND d.document_type = 'w9'
          AND d.tax_year = p_tax_year
          AND d.review_state = 'pending_review'
      ) AS has_pending,
      (
        SELECT d.review_state
        FROM public.contractor_compliance_documents d
        WHERE d.profile_id = p.id
          AND d.document_type = 'w9'
          AND d.tax_year = p_tax_year
        ORDER BY d.version_number DESC
        LIMIT 1
      ) AS latest_current_state,
      EXISTS (
        SELECT 1 FROM public.contractor_compliance_documents d
        WHERE d.profile_id = p.id
          AND d.document_type = 'w9'
          AND d.tax_year < p_tax_year
          AND d.review_state IN ('accepted', 'superseded')
      ) AS has_previous,
      (
        SELECT max(d.verified_at)
        FROM public.contractor_compliance_documents d
        WHERE d.profile_id = p.id
          AND d.document_type = 'w9'
          AND d.tax_year = p_tax_year
          AND d.review_state IN ('accepted', 'superseded')
      ) AS last_verified_at,
      (
        SELECT max(d.tax_year)
        FROM public.contractor_compliance_documents d
        WHERE d.profile_id = p.id
          AND d.document_type = 'w9'
          AND d.review_state IN ('accepted', 'superseded')
      ) AS latest_accepted_tax_year,
      (
        SELECT max(q.sent_at)
        FROM public.contractor_compliance_requests q
        WHERE q.profile_id = p.id AND 'w9' = ANY(q.requested_document_types)
      ) AS last_request_at
    FROM public.contractor_compliance_profiles p
  ),
  classified AS (
    SELECT
      f.*,
      CASE
        WHEN f.has_valid THEN 'valid'
        WHEN f.has_pending THEN 'needs_review'
        WHEN f.latest_current_state = 'rejected' THEN 'rejected'
        WHEN f.has_previous THEN 'stale_previous_year'
        ELSE 'missing'
      END AS w9_status
    FROM document_facts f
  ),
  rows AS (
    SELECT
      f.profile_id,
      c.id AS contractor_id,
      c.name,
      c.company,
      c.email,
      c.trade_specialty,
      f.is_active,
      f.required_w9_year,
      f.w9_status,
      f.last_verified_at,
      f.latest_accepted_tax_year,
      f.last_request_at,
      COALESCE(h.provider_target, 'unassigned') AS provider_target,
      h.quickbooks_contractor_external_id,
      h.gusto_contractor_external_id,
      COALESCE(h.handoff_status, 'not_ready') AS handoff_status,
      h.handoff_date,
      h.provider_reference,
      h.updated_at AS handoff_updated_at
    FROM classified f
    JOIN public.contacts c ON c.id = f.contact_id AND c.role = 'subcontractor'
    LEFT JOIN public.contractor_w9_provider_handoffs h
      ON h.profile_id = f.profile_id AND h.tax_year = p_tax_year
    WHERE (NOT p_active_only OR f.is_active)
  ),
  filtered AS (
    SELECT * FROM rows
    WHERE (
      NULLIF(btrim(p_search), '') IS NULL
      OR name ILIKE '%' || btrim(p_search) || '%'
      OR company ILIKE '%' || btrim(p_search) || '%'
      OR email ILIKE '%' || btrim(p_search) || '%'
    )
      AND (COALESCE(p_w9_status, 'all') = 'all' OR w9_status = p_w9_status)
      AND (
        COALESCE(p_provider_target, 'all') = 'all'
        OR provider_target = p_provider_target
      )
      AND (
        COALESCE(p_handoff_status, 'all') = 'all'
        OR handoff_status = p_handoff_status
      )
  )
  SELECT jsonb_build_object(
    'tax_year', p_tax_year,
    'total', (SELECT count(*) FROM filtered),
    'counts', jsonb_build_object(
      'valid', (SELECT count(*) FROM filtered WHERE w9_status = 'valid'),
      'missing', (SELECT count(*) FROM filtered WHERE w9_status = 'missing'),
      'needs_review', (SELECT count(*) FROM filtered WHERE w9_status = 'needs_review'),
      'rejected', (SELECT count(*) FROM filtered WHERE w9_status = 'rejected'),
      'stale_previous_year', (
        SELECT count(*) FROM filtered WHERE w9_status = 'stale_previous_year'
      )
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'contractor_id', r.contractor_id,
        'name', r.name,
        'company', r.company,
        'email', r.email,
        'trade_specialty', r.trade_specialty,
        'is_active', r.is_active,
        'required_w9_year', r.required_w9_year,
        'w9_status', r.w9_status,
        'last_verified_at', r.last_verified_at,
        'latest_accepted_tax_year', r.latest_accepted_tax_year,
        'last_request_at', r.last_request_at,
        'provider_target', r.provider_target,
        'quickbooks_contractor_external_id', r.quickbooks_contractor_external_id,
        'gusto_contractor_external_id', r.gusto_contractor_external_id,
        'handoff_status', r.handoff_status,
        'handoff_date', r.handoff_date,
        'provider_reference', r.provider_reference,
        'handoff_updated_at', r.handoff_updated_at
      ) ORDER BY
        CASE r.w9_status
          WHEN 'missing' THEN 1
          WHEN 'rejected' THEN 2
          WHEN 'stale_previous_year' THEN 3
          WHEN 'needs_review' THEN 4
          ELSE 5
        END,
        r.name)
      FROM (
        SELECT * FROM filtered
        ORDER BY
          CASE w9_status
            WHEN 'missing' THEN 1
            WHEN 'rejected' THEN 2
            WHEN 'stale_previous_year' THEN 3
            WHEN 'needs_review' THEN 4
            ELSE 5
          END,
          name
        LIMIT p_limit OFFSET p_offset
      ) r
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION
  public.get_contractor_w9_tax_year_checklist(integer,text,text,text,text,boolean,integer,integer)
FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION
  public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date),
  public.get_contractor_compliance_detail(uuid,date,date),
  public.get_contractor_compliance_audit_periods(),
  public.get_contractor_compliance_audit_manifest(uuid,text,text,text,text,integer,integer),
  public.get_contractor_w9_tax_year_checklist(integer,text,text,text,text,boolean,integer,integer)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date),
  public.get_contractor_compliance_detail(uuid,date,date),
  public.get_contractor_compliance_audit_periods(),
  public.get_contractor_compliance_audit_manifest(uuid,text,text,text,text,integer,integer),
  public.get_contractor_w9_tax_year_checklist(integer,text,text,text,text,boolean,integer,integer)
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
