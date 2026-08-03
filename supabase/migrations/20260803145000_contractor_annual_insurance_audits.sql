-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260803145000_contractor_annual_insurance_audits
-- WHAT: Add named, reproducible workers-compensation and general-liability
--       audit periods with roster, coverage, gap, and request-history snapshots.
-- SECURITY: tables are service-owned; role-redacted RPCs enforce internal roles.
-- ROLLBACK: supabase/rollbacks/20260803145000_contractor_annual_insurance_audits.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.contractor_compliance_audit_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  inclusion_basis text NOT NULL DEFAULT 'current_active_profiles',
  external_source text,
  source_external_id text,
  created_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  materialized_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  materialized_at timestamptz,
  locked_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_compliance_audit_period_name_check
    CHECK (length(btrim(name)) BETWEEN 3 AND 120),
  CONSTRAINT contractor_compliance_audit_period_dates_check
    CHECK (end_date >= start_date AND end_date - start_date <= 731),
  CONSTRAINT contractor_compliance_audit_period_status_check
    CHECK (status IN ('draft', 'open', 'locked', 'closed')),
  CONSTRAINT contractor_compliance_audit_period_basis_check
    CHECK (inclusion_basis IN ('current_active_profiles', 'manual_external')),
  CONSTRAINT contractor_compliance_audit_period_lock_check CHECK (
    (status IN ('locked', 'closed') AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
    OR (status IN ('draft', 'open') AND locked_at IS NULL AND locked_by IS NULL)
  )
);

CREATE TABLE public.contractor_compliance_audit_roster (
  audit_period_id uuid NOT NULL REFERENCES public.contractor_compliance_audit_periods(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.contractor_compliance_profiles(id) ON DELETE RESTRICT,
  included boolean NOT NULL DEFAULT true,
  inclusion_source text NOT NULL,
  active_in_period boolean,
  paid_in_period boolean,
  external_source text,
  source_external_id text,
  source_as_of timestamptz,
  reconciliation_state text NOT NULL DEFAULT 'unknown',
  reconciliation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_period_id, profile_id),
  CONSTRAINT contractor_compliance_audit_roster_source_check
    CHECK (inclusion_source IN ('current_active_profile', 'manual', 'external_import')),
  CONSTRAINT contractor_compliance_audit_roster_reconciliation_check
    CHECK (reconciliation_state IN ('unknown', 'unreconciled', 'reconciled', 'variance')),
  CONSTRAINT contractor_compliance_audit_roster_period_fact_check CHECK (
    (inclusion_source = 'current_active_profile' AND active_in_period IS NULL AND paid_in_period IS NULL)
    OR inclusion_source IN ('manual', 'external_import')
  ),
  CONSTRAINT contractor_compliance_audit_roster_external_source_check CHECK (
    inclusion_source <> 'external_import'
    OR (NULLIF(btrim(external_source), '') IS NOT NULL AND NULLIF(btrim(source_external_id), '') IS NOT NULL)
  ),
  CONSTRAINT contractor_compliance_audit_roster_metadata_check CHECK (
    NOT (reconciliation_metadata ?| ARRAY['token', 'token_digest', 'storage_path', 'tax_identifier', 'ssn', 'ein'])
  )
);

CREATE TABLE public.contractor_compliance_audit_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.contractor_compliance_audit_periods(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.contractor_compliance_profiles(id) ON DELETE RESTRICT,
  requirement_group text NOT NULL,
  interval_kind text NOT NULL,
  interval_start date NOT NULL,
  interval_end date NOT NULL,
  document_id uuid REFERENCES public.contractor_compliance_documents(id) ON DELETE RESTRICT,
  document_version integer,
  captured_review_state text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_compliance_audit_evidence_group_check
    CHECK (requirement_group IN ('workers_comp', 'general_liability')),
  CONSTRAINT contractor_compliance_audit_evidence_kind_check
    CHECK (interval_kind IN ('coverage', 'gap')),
  CONSTRAINT contractor_compliance_audit_evidence_dates_check
    CHECK (interval_end >= interval_start),
  CONSTRAINT contractor_compliance_audit_evidence_document_check CHECK (
    (
      interval_kind = 'coverage'
      AND document_id IS NOT NULL
      AND document_version IS NOT NULL
      AND captured_review_state IN ('accepted', 'superseded')
    )
    OR (
      interval_kind = 'gap'
      AND document_id IS NULL
      AND document_version IS NULL
      AND captured_review_state IS NULL
    )
  )
);

CREATE TABLE public.contractor_compliance_audit_requests (
  audit_period_id uuid NOT NULL REFERENCES public.contractor_compliance_audit_periods(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.contractor_compliance_requests(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.contractor_compliance_profiles(id) ON DELETE RESTRICT,
  requested_document_types text[] NOT NULL,
  source text NOT NULL,
  created_at_snapshot timestamptz NOT NULL,
  sent_at_snapshot timestamptz,
  completed_at_snapshot timestamptz,
  revoked_at_snapshot timestamptz,
  expires_at_snapshot timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_period_id, request_id)
);

CREATE TABLE public.contractor_compliance_audit_request_deliveries (
  audit_period_id uuid NOT NULL REFERENCES public.contractor_compliance_audit_periods(id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL REFERENCES public.contractor_compliance_request_deliveries(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.contractor_compliance_requests(id) ON DELETE RESTRICT,
  stage_key text NOT NULL,
  status text NOT NULL,
  sent_at_snapshot timestamptz,
  completed_at_snapshot timestamptz,
  outcome_reason text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_period_id, delivery_id)
);

CREATE INDEX contractor_compliance_audit_period_dates_idx
  ON public.contractor_compliance_audit_periods (start_date, end_date, status);
CREATE INDEX contractor_compliance_audit_evidence_manifest_idx
  ON public.contractor_compliance_audit_evidence
  (audit_period_id, profile_id, requirement_group, interval_kind);
CREATE INDEX contractor_compliance_audit_requests_profile_idx
  ON public.contractor_compliance_audit_requests
  (audit_period_id, profile_id, created_at_snapshot);

ALTER TABLE public.contractor_compliance_audit_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_roster FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_request_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_audit_request_deliveries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.contractor_compliance_audit_periods,
  public.contractor_compliance_audit_roster,
  public.contractor_compliance_audit_evidence,
  public.contractor_compliance_audit_requests,
  public.contractor_compliance_audit_request_deliveries
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.contractor_compliance_audit_periods,
  public.contractor_compliance_audit_roster,
  public.contractor_compliance_audit_evidence,
  public.contractor_compliance_audit_requests,
  public.contractor_compliance_audit_request_deliveries
TO service_role;

CREATE POLICY contractor_compliance_audit_periods_service_only
  ON public.contractor_compliance_audit_periods FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_audit_roster_service_only
  ON public.contractor_compliance_audit_roster FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_audit_evidence_service_only
  ON public.contractor_compliance_audit_evidence FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_audit_requests_service_only
  ON public.contractor_compliance_audit_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY contractor_compliance_audit_request_deliveries_service_only
  ON public.contractor_compliance_audit_request_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.contractor_compliance_create_audit_period(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_inclusion_basis text DEFAULT 'current_active_profiles'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid;
  v_id uuid;
BEGIN
  SELECT e.id INTO v_actor
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
    AND e.is_active
    AND NOT e.is_external
    AND e.role::text IN ('admin', 'office');
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: contractor audit manager required' USING errcode = '42501';
  END IF;
  IF length(btrim(p_name)) NOT BETWEEN 3 AND 120
     OR p_end_date < p_start_date
     OR p_end_date - p_start_date > 731
     OR p_inclusion_basis NOT IN ('current_active_profiles', 'manual_external') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: audit name, dates, or basis' USING errcode = '22023';
  END IF;
  INSERT INTO public.contractor_compliance_audit_periods (
    name, start_date, end_date, status, inclusion_basis, created_by
  ) VALUES (
    btrim(p_name), p_start_date, p_end_date, 'draft', p_inclusion_basis, v_actor
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', 'draft');
END;
$function$;

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
  IF v_role NOT IN ('admin', 'office', 'project_manager') THEN
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

CREATE OR REPLACE FUNCTION public.contractor_compliance_upsert_audit_roster(
  p_audit_period_id uuid,
  p_contact_id uuid,
  p_included boolean DEFAULT true,
  p_active_in_period boolean DEFAULT NULL,
  p_paid_in_period boolean DEFAULT NULL,
  p_inclusion_source text DEFAULT 'manual',
  p_external_source text DEFAULT NULL,
  p_source_external_id text DEFAULT NULL,
  p_reconciliation_state text DEFAULT 'unknown',
  p_reconciliation_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid;
  v_profile uuid;
BEGIN
  SELECT e.id INTO v_actor
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
    AND e.is_active
    AND NOT e.is_external
    AND e.role::text IN ('admin', 'office');
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: contractor audit manager required' USING errcode = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.contractor_compliance_audit_periods p
    WHERE p.id = p_audit_period_id AND p.status IN ('locked', 'closed')
  ) THEN
    RAISE EXCEPTION 'AUDIT_LOCKED: roster is immutable' USING errcode = '55000';
  END IF;
  IF p_inclusion_source NOT IN ('manual', 'external_import')
     OR p_reconciliation_state NOT IN ('unknown', 'unreconciled', 'reconciled', 'variance')
     OR (
       p_inclusion_source = 'external_import'
       AND (
         NULLIF(btrim(p_external_source), '') IS NULL
         OR NULLIF(btrim(p_source_external_id), '') IS NULL
       )
     )
     OR COALESCE(p_reconciliation_metadata, '{}'::jsonb)
        ?| ARRAY['token', 'token_digest', 'storage_path', 'tax_identifier', 'ssn', 'ein'] THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: sourced audit roster facts required' USING errcode = '22023';
  END IF;
  SELECT p.id INTO v_profile
  FROM public.contractor_compliance_profiles p
  JOIN public.contacts c ON c.id = p.contact_id AND c.role = 'subcontractor'
  WHERE p.contact_id = p_contact_id;
  IF v_profile IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.contractor_compliance_audit_periods p WHERE p.id = p_audit_period_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: audit period or contractor missing' USING errcode = 'P0002';
  END IF;
  INSERT INTO public.contractor_compliance_audit_roster (
    audit_period_id, profile_id, included, inclusion_source,
    active_in_period, paid_in_period, external_source, source_external_id,
    source_as_of, reconciliation_state, reconciliation_metadata, captured_at
  ) VALUES (
    p_audit_period_id, v_profile, p_included, p_inclusion_source,
    p_active_in_period, p_paid_in_period, NULLIF(btrim(p_external_source), ''),
    NULLIF(btrim(p_source_external_id), ''), now(), p_reconciliation_state,
    COALESCE(p_reconciliation_metadata, '{}'::jsonb), now()
  )
  ON CONFLICT (audit_period_id, profile_id) DO UPDATE SET
    included = EXCLUDED.included,
    inclusion_source = EXCLUDED.inclusion_source,
    active_in_period = EXCLUDED.active_in_period,
    paid_in_period = EXCLUDED.paid_in_period,
    external_source = EXCLUDED.external_source,
    source_external_id = EXCLUDED.source_external_id,
    source_as_of = EXCLUDED.source_as_of,
    reconciliation_state = EXCLUDED.reconciliation_state,
    reconciliation_metadata = EXCLUDED.reconciliation_metadata,
    captured_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_materialize_audit_period(
  p_audit_period_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid;
  v_period public.contractor_compliance_audit_periods;
  v_count integer;
BEGIN
  SELECT e.id INTO v_actor
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
    AND e.is_active
    AND NOT e.is_external
    AND e.role::text IN ('admin', 'office');
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: contractor audit manager required' USING errcode = '42501';
  END IF;
  SELECT * INTO v_period
  FROM public.contractor_compliance_audit_periods
  WHERE id = p_audit_period_id
  FOR UPDATE;
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: audit period missing' USING errcode = 'P0002';
  END IF;
  IF v_period.status IN ('locked', 'closed') THEN
    RAISE EXCEPTION 'AUDIT_LOCKED: manifest is immutable' USING errcode = '55000';
  END IF;

  IF v_period.inclusion_basis = 'current_active_profiles' THEN
    DELETE FROM public.contractor_compliance_audit_roster
    WHERE audit_period_id = v_period.id AND inclusion_source = 'current_active_profile';
    INSERT INTO public.contractor_compliance_audit_roster (
      audit_period_id, profile_id, included, inclusion_source,
      active_in_period, paid_in_period, reconciliation_state,
      reconciliation_metadata, captured_at
    )
    SELECT
      v_period.id,
      p.id,
      true,
      'current_active_profile',
      NULL,
      NULL,
      'unknown',
      jsonb_build_object(
        'basis',
        'current active profile at materialization; not proof of activity or payment in the audit period'
      ),
      now()
    FROM public.contractor_compliance_profiles p
    JOIN public.contacts c ON c.id = p.contact_id AND c.role = 'subcontractor'
    WHERE p.is_active;
  END IF;

  DELETE FROM public.contractor_compliance_audit_request_deliveries
  WHERE audit_period_id = v_period.id;
  DELETE FROM public.contractor_compliance_audit_requests
  WHERE audit_period_id = v_period.id;
  DELETE FROM public.contractor_compliance_audit_evidence
  WHERE audit_period_id = v_period.id;

  INSERT INTO public.contractor_compliance_audit_evidence (
    audit_period_id, profile_id, requirement_group, interval_kind,
    interval_start, interval_end, document_id, document_version,
    captured_review_state
  )
  SELECT
    v_period.id,
    r.profile_id,
    CASE
      WHEN d.document_type IN ('workers_comp', 'workers_comp_waiver') THEN 'workers_comp'
      ELSE 'general_liability'
    END,
    'coverage',
    GREATEST(d.coverage_start_date, v_period.start_date),
    LEAST(d.coverage_end_date, v_period.end_date),
    d.id,
    d.version_number,
    d.review_state
  FROM public.contractor_compliance_audit_roster r
  JOIN public.contractor_compliance_documents d ON d.profile_id = r.profile_id
  WHERE r.audit_period_id = v_period.id
    AND r.included
    AND d.document_type IN ('workers_comp', 'workers_comp_waiver', 'general_liability')
    AND d.review_state IN ('accepted', 'superseded')
    AND d.coverage_start_date <= v_period.end_date
    AND d.coverage_end_date >= v_period.start_date;

  WITH requirement_groups(requirement_group, document_types) AS (
    VALUES
      ('workers_comp'::text, ARRAY['workers_comp', 'workers_comp_waiver']::text[]),
      ('general_liability'::text, ARRAY['general_liability']::text[])
  ),
  covered AS (
    SELECT
      r.profile_id,
      g.requirement_group,
      range_agg(daterange(
        GREATEST(d.coverage_start_date, v_period.start_date),
        LEAST(d.coverage_end_date, v_period.end_date),
        '[]'
      )) FILTER (WHERE d.id IS NOT NULL) AS intervals
    FROM public.contractor_compliance_audit_roster r
    CROSS JOIN requirement_groups g
    LEFT JOIN public.contractor_compliance_documents d
      ON d.profile_id = r.profile_id
      AND d.document_type = ANY(g.document_types)
      AND d.review_state IN ('accepted', 'superseded')
      AND d.coverage_start_date <= v_period.end_date
      AND d.coverage_end_date >= v_period.start_date
    WHERE r.audit_period_id = v_period.id AND r.included
    GROUP BY r.profile_id, g.requirement_group
  ),
  gaps AS (
    SELECT c.profile_id, c.requirement_group, gap_interval
    FROM covered c
    CROSS JOIN LATERAL unnest(
      datemultirange(daterange(v_period.start_date, v_period.end_date, '[]'))
      - COALESCE(c.intervals, '{}'::datemultirange)
    ) AS gap_ranges(gap_interval)
  )
  INSERT INTO public.contractor_compliance_audit_evidence (
    audit_period_id, profile_id, requirement_group,
    interval_kind, interval_start, interval_end
  )
  SELECT
    v_period.id,
    g.profile_id,
    g.requirement_group,
    'gap',
    lower(g.gap_interval),
    upper(g.gap_interval) - 1
  FROM gaps g;

  INSERT INTO public.contractor_compliance_audit_requests (
    audit_period_id, request_id, profile_id, requested_document_types,
    source, created_at_snapshot, sent_at_snapshot, completed_at_snapshot,
    revoked_at_snapshot, expires_at_snapshot
  )
  SELECT
    v_period.id,
    q.id,
    q.profile_id,
    q.requested_document_types,
    q.source,
    q.created_at,
    q.sent_at,
    q.completed_at,
    q.revoked_at,
    q.expires_at
  FROM public.contractor_compliance_requests q
  JOIN public.contractor_compliance_audit_roster r
    ON r.profile_id = q.profile_id
    AND r.audit_period_id = v_period.id
    AND r.included
  WHERE q.created_at < ((v_period.end_date + 1)::timestamp AT TIME ZONE 'America/Denver')
    AND q.requested_document_types
        && ARRAY['workers_comp', 'workers_comp_waiver', 'general_liability']::text[]
    AND (
      (q.expires_at AT TIME ZONE 'America/Denver')::date >= v_period.start_date
      OR (q.sent_at AT TIME ZONE 'America/Denver')::date
         BETWEEN v_period.start_date AND v_period.end_date
    );

  INSERT INTO public.contractor_compliance_audit_request_deliveries (
    audit_period_id, delivery_id, request_id, stage_key, status,
    sent_at_snapshot, completed_at_snapshot, outcome_reason
  )
  SELECT
    v_period.id,
    d.id,
    d.request_id,
    d.stage_key,
    d.status,
    d.sent_at,
    d.completed_at,
    d.outcome_reason
  FROM public.contractor_compliance_request_deliveries d
  JOIN public.contractor_compliance_audit_requests q
    ON q.request_id = d.request_id AND q.audit_period_id = v_period.id;

  UPDATE public.contractor_compliance_audit_periods
  SET status = 'open', materialized_by = v_actor, materialized_at = now(), updated_at = now()
  WHERE id = v_period.id;

  SELECT count(*) INTO v_count
  FROM public.contractor_compliance_audit_roster
  WHERE audit_period_id = v_period.id AND included;
  RETURN jsonb_build_object('id', v_period.id, 'status', 'open', 'roster_count', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.contractor_compliance_lock_audit_period(
  p_audit_period_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  SELECT e.id INTO v_actor
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
    AND e.is_active
    AND NOT e.is_external
    AND e.role::text IN ('admin', 'office');
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: contractor audit manager required' USING errcode = '42501';
  END IF;
  UPDATE public.contractor_compliance_audit_periods
  SET status = 'locked', locked_by = v_actor, locked_at = now(), updated_at = now()
  WHERE id = p_audit_period_id AND status = 'open' AND materialized_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: materialized open audit required' USING errcode = '55000';
  END IF;
END;
$function$;

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
  IF v_role NOT IN ('admin', 'office', 'project_manager') THEN
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
  public.contractor_compliance_create_audit_period(text, date, date, text),
  public.get_contractor_compliance_audit_periods(),
  public.contractor_compliance_upsert_audit_roster(uuid, uuid, boolean, boolean, boolean, text, text, text, text, jsonb),
  public.contractor_compliance_materialize_audit_period(uuid),
  public.contractor_compliance_lock_audit_period(uuid),
  public.get_contractor_compliance_audit_manifest(uuid, text, text, text, text, integer, integer)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.contractor_compliance_create_audit_period(text, date, date, text),
  public.get_contractor_compliance_audit_periods(),
  public.contractor_compliance_upsert_audit_roster(uuid, uuid, boolean, boolean, boolean, text, text, text, text, jsonb),
  public.contractor_compliance_materialize_audit_period(uuid),
  public.contractor_compliance_lock_audit_period(uuid),
  public.get_contractor_compliance_audit_manifest(uuid, text, text, text, text, integer, integer)
TO authenticated, service_role;
