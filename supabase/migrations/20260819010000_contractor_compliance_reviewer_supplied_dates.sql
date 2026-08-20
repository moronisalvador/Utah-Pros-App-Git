-- ════════════════════════════════════════════════
-- MIGRATION: 20260819010000_contractor_compliance_reviewer_supplied_dates
-- Phase: Contractor Compliance — public-upload usability (owner-directed 2026-08-19)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Today a subcontractor cannot send us their insurance certificate without
--   first reading the certificate and typing its start and expiry dates. Most of
--   them do this on a phone, many do not read English, and the dates are printed
--   in insurance wording. It is the hardest step on the page and the one most
--   likely to be done wrong — and what they type lands in `coverage_end_date`,
--   which is the field the expiry reminders run on.
--
--   A person at Utah Pros already reads every document before it counts: nothing
--   is compliant until a manager reviews it. So this lets the CONTRACTOR send the
--   photo without dates, and lets the REVIEWER type the dates off the image they
--   are already looking at.
--
-- WHAT CHANGES:
--   1. `contractor_compliance_documents_date_check` is relaxed so a non-W-9
--      document may arrive with no coverage dates. It still REQUIRES both dates,
--      in the right order, before that document can be `accepted`.
--   2. `contractor_compliance_review_document` gains two optional date arguments
--      so the reviewer can supply them at the moment of acceptance, and refuses
--      to accept a coverage document that would still have no dates.
--
-- WHY ACCEPT STILL REQUIRES DATES (do not "simplify" this away):
--   The accept branch calls `contractor_compliance_continuous_coverage_end()`,
--   which computes the covered window from exactly these two columns and decides
--   whether the whole request is complete. Accepting a document with NULL dates
--   would silently feed NULLs into that math and could mark a contractor
--   compliant on the strength of a certificate nobody dated.
--
-- ADDITIVE-ONLY / blast radius:
--   NOT additive in the strict sense: it DROPs and re-adds one CHECK constraint.
--   The replacement is a strict RELAXATION — every row that satisfies the old
--   constraint satisfies the new one, so no existing row can be invalidated.
--   Verified read-only on production 2026-08-19: 4 non-W-9 documents exist and
--   all four carry both coverage dates, so all four remain valid either way.
--   No table, column, index, policy or trigger is otherwise changed, and no data
--   row is written.
--
--   It also DROPs the superseded 4-argument function. That drop is REQUIRED, not
--   tidiness: `CREATE OR REPLACE` does not replace a function when the argument
--   list changes, so without it the database would carry two SECURITY DEFINER
--   functions of this name. See the marker above the DROP for the exact failure.
--   With one function remaining, the deployed worker's four-named-argument
--   PostgREST call resolves to it through the two DEFAULT NULL date arguments —
--   so the shipped call site keeps working unchanged (FE-contract freeze,
--   database-standard.md §3).
--
--   The grant is service_role-only, matching the applied foundation. This
--   function must never be granted to `authenticated`; the reasoning is in the
--   comment above the REVOKE and is a real privilege-escalation path, not a
--   stylistic preference.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260819010000_contractor_compliance_reviewer_supplied_dates.rollback.sql
--   It restores the original CHECK constraint verbatim and restores the original
--   4-argument function body verbatim, then drops the 6-argument overload.
--   ⚠ The rollback re-TIGHTENS the constraint. If any document has been received
--   with NULL coverage dates while this migration was live, the rollback's
--   ALTER TABLE ... ADD CONSTRAINT will fail on those rows — by design, rather
--   than deleting a contractor's document. Resolve them first: either have a
--   reviewer date them, or reject them.
-- ════════════════════════════════════════════════

-- NOTE: no top-level BEGIN/COMMIT — the Supabase migration executor owns the
-- transaction, and wrapping it here would break its ledger write
-- (database-standard.md §5).

-- ─── Drift guard ──────────────
-- Refuse to run if the live constraint is not the exact definition this
-- migration was written against. A relaxation applied on top of an unexpected
-- predicate could widen something nobody reviewed.
DO $$
DECLARE v_md5 text;
BEGIN
  SELECT md5(pg_get_constraintdef(oid)) INTO v_md5
    FROM pg_constraint
   WHERE conrelid = 'public.contractor_compliance_documents'::regclass
     AND conname  = 'contractor_compliance_documents_date_check';
  IF v_md5 IS DISTINCT FROM '8c290ee9197afaabc6bed2a5a25195a7' THEN
    RAISE EXCEPTION 'DRIFT: contractor_compliance_documents_date_check is % , expected 8c290ee9197afaabc6bed2a5a25195a7', COALESCE(v_md5, 'missing')
      USING errcode = '55000';
  END IF;
END $$;

-- ─── 1. Relax the date constraint ──────────────
ALTER TABLE public.contractor_compliance_documents
  DROP CONSTRAINT contractor_compliance_documents_date_check;

ALTER TABLE public.contractor_compliance_documents
  ADD CONSTRAINT contractor_compliance_documents_date_check CHECK (
    (
      document_type = 'w9'
      AND tax_year >= 2000 AND tax_year <= 2200
      AND coverage_start_date IS NULL AND coverage_end_date IS NULL
    )
    OR (
      document_type <> 'w9'
      AND tax_year IS NULL
      AND (
        CASE
          -- An accepted coverage document must be fully dated and ordered:
          -- continuous-coverage math reads exactly these two columns.
          WHEN review_state = 'accepted' THEN
            coverage_start_date IS NOT NULL
            AND coverage_end_date IS NOT NULL
            AND coverage_end_date >= coverage_start_date
          -- Otherwise: either no dates yet (the reviewer will supply them), or
          -- both present and correctly ordered. Never one without the other.
          ELSE
            (coverage_start_date IS NULL AND coverage_end_date IS NULL)
            OR (
              coverage_start_date IS NOT NULL
              AND coverage_end_date IS NOT NULL
              AND coverage_end_date >= coverage_start_date
            )
        END
      )
    )
  );

-- ─── 2. Reviewer may supply the dates on acceptance ──────────────
-- Body is the applied 4-argument definition with ONLY the date handling added:
-- two new trailing DEFAULT NULL arguments, one validation block, and two
-- CASE assignments in the UPDATE. Everything else is byte-preserved.
CREATE OR REPLACE FUNCTION public.contractor_compliance_review_document(
  p_actor_employee_id uuid,
  p_document_id uuid,
  p_review_state text,
  p_rejection_reason text DEFAULT NULL::text,
  p_coverage_start_date date DEFAULT NULL::date,
  p_coverage_end_date date DEFAULT NULL::date
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_profile uuid; v_type text; v_start date; v_end date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  IF p_review_state NOT IN ('accepted','rejected') OR (p_review_state='rejected' AND NULLIF(btrim(p_rejection_reason),'') IS NULL) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: accepted or reasoned rejection required' USING errcode='22023';
  END IF;

  -- Resolve the dates this acceptance would end up with: the supplied values
  -- win, otherwise whatever the contractor already provided.
  SELECT COALESCE(p_coverage_start_date, d.coverage_start_date),
         COALESCE(p_coverage_end_date,   d.coverage_end_date)
    INTO v_start, v_end
    FROM public.contractor_compliance_documents d
   WHERE d.id = p_document_id AND d.review_state = 'pending_review';

  IF p_review_state = 'accepted'
     AND EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.id=p_document_id AND d.document_type <> 'w9')
     AND (v_start IS NULL OR v_end IS NULL OR v_end < v_start) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: coverage start and end dates are required to accept this document'
      USING errcode='22023';
  END IF;

  UPDATE public.contractor_compliance_documents
  SET review_state=p_review_state,verified_by=p_actor_employee_id,verified_at=now(),
      coverage_start_date=CASE WHEN document_type='w9' THEN coverage_start_date ELSE COALESCE(p_coverage_start_date, coverage_start_date) END,
      coverage_end_date=CASE WHEN document_type='w9' THEN coverage_end_date ELSE COALESCE(p_coverage_end_date, coverage_end_date) END,
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

-- destructive-approved: DROP FUNCTION of the superseded 4-argument overload.
-- CREATE OR REPLACE does NOT replace a function when the argument list changes —
-- function identity is name + input argument types — so without this drop the
-- database would hold TWO SECURITY DEFINER functions of this name with different
-- ACLs. The deployed worker sends exactly the four original named keys, which
-- would then either bind to the stale 4-argument body (no date handling, no
-- accept-requires-dates guard, so accepting a newly-permitted dateless document
-- raises a raw 23514 from the CHECK) or fail outright with 42725 "function is
-- not unique". Both break document review on apply. The paired rollback
-- recreates this exact 4-argument function, so the reverse direction is intact.
DROP FUNCTION IF EXISTS public.contractor_compliance_review_document(uuid, uuid, text, text);

-- ⚠ service_role ONLY — do not "helpfully" widen this to authenticated.
-- This SECURITY DEFINER trusts a CALLER-SUPPLIED p_actor_employee_id and never
-- binds it to auth.uid(); employee ids are readable by any signed-in session via
-- get_employee_directory. Granting EXECUTE to `authenticated` would therefore let
-- any field_tech, estimator or crm_partner accept, reject or re-date contractor
-- compliance documents while writing a forged actor into
-- contractor_compliance_activity. The applied foundation
-- (20260803090000_contractor_compliance_foundation.sql L779-780) revokes it from
-- authenticated for exactly this reason, and the only caller is
-- functions/api/contractor-compliance-requests.js over the privileged
-- functions/lib/supabase.js transport. The explicit REVOKE FROM authenticated is
-- required rather than merely omitting the grant, because the baseline carries
-- ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO authenticated.
REVOKE EXECUTE ON FUNCTION public.contractor_compliance_review_document(uuid, uuid, text, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_compliance_review_document(uuid, uuid, text, text, date, date) TO service_role;

-- ─── Postconditions ──────────────
DO $$
DECLARE v_anon boolean; v_auth boolean; v_svc boolean; v_relaxed boolean; v_count integer; v_oid oid;
BEGIN
  -- The relaxed constraint must actually permit a dateless pending row.
  SELECT pg_get_constraintdef(oid) LIKE '%review_state%' INTO v_relaxed
    FROM pg_constraint
   WHERE conrelid = 'public.contractor_compliance_documents'::regclass
     AND conname  = 'contractor_compliance_documents_date_check';
  IF v_relaxed IS NOT TRUE THEN
    RAISE EXCEPTION 'POSTCONDITION: relaxed date check not installed' USING errcode='55000';
  END IF;

  -- Exactly one function of this name must survive, or the deployed worker's
  -- four-named-argument call becomes ambiguous (42725).
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='contractor_compliance_review_document';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'POSTCONDITION: expected exactly 1 contractor_compliance_review_document, found %', v_count USING errcode='55000';
  END IF;

  -- to_regprocedure(), NOT pg_get_function_identity_arguments(): that function
  -- returns parameter NAMES with their types ('p_actor_employee_id uuid, ...'),
  -- so comparing it to a bare type list never matches. The SELECT then returned
  -- no row, left all three variables NULL, and `IS NOT FALSE` reported a
  -- privilege escalation that did not exist — aborting the apply and sending the
  -- reader after a phantom ACL bug. Found by the behavioural proof on its first
  -- real execution; every static check had passed over it.
  v_oid := to_regprocedure('public.contractor_compliance_review_document(uuid, uuid, text, text, date, date)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSTCONDITION: the 6-argument function is missing' USING errcode='55000';
  END IF;
  SELECT has_function_privilege('anon', v_oid, 'EXECUTE'),
         has_function_privilege('authenticated', v_oid, 'EXECUTE'),
         has_function_privilege('service_role', v_oid, 'EXECUTE')
    INTO v_anon, v_auth, v_svc;
  IF v_anon IS NOT FALSE THEN RAISE EXCEPTION 'POSTCONDITION: anon holds EXECUTE' USING errcode='55000'; END IF;
  IF v_auth IS NOT FALSE THEN RAISE EXCEPTION 'POSTCONDITION: authenticated holds EXECUTE' USING errcode='55000'; END IF;
  IF v_svc  IS NOT TRUE  THEN RAISE EXCEPTION 'POSTCONDITION: service_role lacks EXECUTE' USING errcode='55000'; END IF;
END $$;
