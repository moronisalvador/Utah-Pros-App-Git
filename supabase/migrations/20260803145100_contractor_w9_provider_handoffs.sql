-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260803145100_contractor_w9_provider_handoffs
-- WHAT: Add annual W-9 checklist and QuickBooks/Gusto handoff metadata.
--       W-9 readiness remains derived from versioned private compliance docs.
-- SECURITY: admin/office only; no tax identifiers, amounts, or tax-form files.
-- ROLLBACK: supabase/rollbacks/20260803145100_contractor_w9_provider_handoffs.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.contractor_w9_provider_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.contractor_compliance_profiles(id) ON DELETE RESTRICT,
  tax_year integer NOT NULL,
  provider_target text NOT NULL DEFAULT 'unassigned',
  quickbooks_contractor_external_id text,
  gusto_contractor_external_id text,
  handoff_status text NOT NULL DEFAULT 'not_ready',
  handoff_date date,
  provider_reference text,
  updated_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, tax_year),
  CONSTRAINT contractor_w9_provider_handoffs_year_check
    CHECK (tax_year BETWEEN 2000 AND 2200),
  CONSTRAINT contractor_w9_provider_handoffs_target_check
    CHECK (provider_target IN ('unassigned', 'quickbooks', 'gusto', 'quickbooks_and_gusto', 'other')),
  CONSTRAINT contractor_w9_provider_handoffs_status_check
    CHECK (handoff_status IN ('not_ready', 'ready', 'handed_off', 'reconciled')),
  CONSTRAINT contractor_w9_provider_handoffs_state_check CHECK (
    handoff_status IN ('not_ready', 'ready')
    OR (
      handoff_status IN ('handed_off', 'reconciled')
      AND handoff_date IS NOT NULL
      AND NULLIF(btrim(provider_reference), '') IS NOT NULL
    )
  ),
  CONSTRAINT contractor_w9_provider_handoffs_provider_check CHECK (
    handoff_status = 'not_ready'
    OR provider_target <> 'unassigned'
  )
);

CREATE INDEX contractor_w9_provider_handoffs_year_status_idx
  ON public.contractor_w9_provider_handoffs (tax_year, handoff_status, provider_target);

ALTER TABLE public.contractor_w9_provider_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_w9_provider_handoffs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.contractor_w9_provider_handoffs
FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contractor_w9_provider_handoffs
TO service_role;

CREATE POLICY contractor_w9_provider_handoffs_service_only
  ON public.contractor_w9_provider_handoffs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.contractor_w9_upsert_provider_handoff(
  p_contact_id uuid,
  p_tax_year integer,
  p_provider_target text,
  p_quickbooks_contractor_external_id text DEFAULT NULL,
  p_gusto_contractor_external_id text DEFAULT NULL,
  p_handoff_status text DEFAULT 'not_ready',
  p_handoff_date date DEFAULT NULL,
  p_provider_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid;
  v_profile uuid;
  v_id uuid;
  v_has_current_w9 boolean;
BEGIN
  SELECT e.id INTO v_actor
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
    AND e.is_active
    AND NOT e.is_external
    AND e.role::text IN ('admin', 'office');
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: W-9 handoff manager required' USING errcode = '42501';
  END IF;
  IF p_tax_year NOT BETWEEN 2000 AND 2200
     OR p_provider_target NOT IN ('unassigned', 'quickbooks', 'gusto', 'quickbooks_and_gusto', 'other')
     OR p_handoff_status NOT IN ('not_ready', 'ready', 'handed_off', 'reconciled')
     OR (
       p_handoff_status <> 'not_ready'
       AND p_provider_target = 'unassigned'
     )
     OR (
       p_handoff_status IN ('handed_off', 'reconciled')
       AND (
         p_handoff_date IS NULL
         OR NULLIF(btrim(p_provider_reference), '') IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: W-9 handoff values' USING errcode = '22023';
  END IF;

  SELECT p.id INTO v_profile
  FROM public.contractor_compliance_profiles p
  JOIN public.contacts c ON c.id = p.contact_id AND c.role = 'subcontractor'
  WHERE p.contact_id = p_contact_id;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: contractor missing' USING errcode = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.contractor_compliance_documents d
    WHERE d.profile_id = v_profile
      AND d.document_type = 'w9'
      AND d.tax_year = p_tax_year
      AND d.review_state IN ('accepted', 'superseded')
  ) INTO v_has_current_w9;
  IF p_handoff_status <> 'not_ready' AND NOT v_has_current_w9 THEN
    RAISE EXCEPTION 'W9_NOT_READY: accepted W-9 required for tax year' USING errcode = '55000';
  END IF;

  INSERT INTO public.contractor_w9_provider_handoffs (
    profile_id,
    tax_year,
    provider_target,
    quickbooks_contractor_external_id,
    gusto_contractor_external_id,
    handoff_status,
    handoff_date,
    provider_reference,
    updated_by
  ) VALUES (
    v_profile,
    p_tax_year,
    p_provider_target,
    NULLIF(btrim(p_quickbooks_contractor_external_id), ''),
    NULLIF(btrim(p_gusto_contractor_external_id), ''),
    p_handoff_status,
    p_handoff_date,
    NULLIF(btrim(p_provider_reference), ''),
    v_actor
  )
  ON CONFLICT (profile_id, tax_year) DO UPDATE SET
    provider_target = EXCLUDED.provider_target,
    quickbooks_contractor_external_id = EXCLUDED.quickbooks_contractor_external_id,
    gusto_contractor_external_id = EXCLUDED.gusto_contractor_external_id,
    handoff_status = EXCLUDED.handoff_status,
    handoff_date = EXCLUDED.handoff_date,
    provider_reference = EXCLUDED.provider_reference,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.contractor_compliance_activity (
    profile_id, actor_employee_id, event_type, note, safe_metadata
  ) VALUES (
    v_profile,
    v_actor,
    'w9_provider_handoff_updated',
    NULL,
    jsonb_build_object(
      'tax_year', p_tax_year,
      'provider_target', p_provider_target,
      'handoff_status', p_handoff_status
    )
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'tax_year', p_tax_year,
    'handoff_status', p_handoff_status
  );
END;
$function$;

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
  IF v_role NOT IN ('admin', 'office') THEN
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
  public.contractor_w9_upsert_provider_handoff(uuid, integer, text, text, text, text, date, text),
  public.get_contractor_w9_tax_year_checklist(integer, text, text, text, text, boolean, integer, integer)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.contractor_w9_upsert_provider_handoff(uuid, integer, text, text, text, text, date, text),
  public.get_contractor_w9_tax_year_checklist(integer, text, text, text, text, boolean, integer, integer)
TO authenticated, service_role;
