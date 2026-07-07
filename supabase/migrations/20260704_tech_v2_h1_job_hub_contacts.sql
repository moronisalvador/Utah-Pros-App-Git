-- ════════════════════════════════════════════════
-- Tech Mobile v2 — Phase H1 (Job Hub v2 — Stage & Dock)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Two things, both additive:
--   (1) Drift-captures get_job_contacts(job_id) — the function already exists in
--       the live database but has never been written into a migration file, so
--       schema-as-code was out of sync. This records its exact current definition
--       (no behavior change).
--   (2) Replaces get_job_hub(job_id) to add ONE new key, contacts[], carrying the
--       job's people (adjuster, insured, etc.) in the SAME shape get_job_contacts
--       returns — so the redesigned Job Hub can show the Job & Claim contacts
--       without a second round trip. Every other key is byte-identical to before.
--
-- WHY contacts CALLS get_job_contacts (not a copied query):
--   Calling the existing SECURITY DEFINER helper guarantees the embedded contacts
--   are identical in shape and ordering to a direct get_job_contacts() call — one
--   source of truth, no drift between the two paths.
--
-- SAFETY (CLAUDE.md Rule 7 / tech-v2 migration rule):
--   - ADDITIVE ONLY: no table/column/policy change. get_job_contacts is captured
--     verbatim from pg_get_functiondef (no behavior change); get_job_hub gains one
--     key and keeps all prior keys unchanged (backward-compat test committed:
--     supabase/tests/tech_v2_h1_job_hub.test.js).
--   - Both functions keep SECURITY DEFINER + GRANT EXECUTE TO anon, authenticated
--     (same posture as before — the parked definer-audit #224 tracks the class).
--   - Reads only: contact_jobs, contacts, jobs, claims, sign_requests,
--     appointments, appointment_crew, employees, job_tasks. No writes.
-- ════════════════════════════════════════════════

-- ── (1) Drift-capture get_job_contacts verbatim (no behavior change) ──────────
CREATE OR REPLACE FUNCTION public.get_job_contacts(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.is_primary DESC, r.role ASC)
  INTO result
  FROM (
    SELECT
      cj.id AS link_id, cj.role, cj.is_primary, cj.notes AS link_notes,
      c.id, c.name, c.phone, c.email, c.company,
      c.role AS contact_role,
      c.billing_address, c.billing_city, c.billing_state, c.billing_zip,
      c.insurance_carrier, c.desk_phone, c.desk_extension
    FROM contact_jobs cj
    JOIN contacts c ON c.id = cj.contact_id
    WHERE cj.job_id = p_job_id
  ) r;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_job_contacts(uuid) TO anon, authenticated;

-- ── (2) get_job_hub v2 — adds contacts[]; every other key byte-identical ──────
CREATE OR REPLACE FUNCTION public.get_job_hub(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'job', to_jsonb(j.*),
    'claim', CASE WHEN c.id IS NOT NULL
      THEN jsonb_build_object('id', c.id, 'claim_number', c.claim_number)
      ELSE NULL END,
    -- NEW in v2 (H1): the job's contacts in get_job_contacts' shape (adjuster,
    -- insured, etc.). Delegates to the helper so the shape can never drift.
    'contacts', public.get_job_contacts(j.id),
    'work_auth_signed', EXISTS (
      SELECT 1 FROM sign_requests sr
      WHERE sr.job_id = j.id
        AND sr.doc_type = 'work_auth'
        AND sr.status = 'signed'
    ),
    'appointments', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY row_data->>'date' DESC, row_data->>'time_start' DESC NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
          'id', a.id,
          'job_id', a.job_id,
          'job_number', j.job_number,
          'division', j.division,
          'title', a.title,
          'date', a.date,
          'time_start', a.time_start,
          'time_end', a.time_end,
          'type', a.type,
          'status', a.status,
          'notes', a.notes,
          'duration_days', a.duration_days,
          'is_milestone', a.is_milestone,
          'color', a.color,
          'crew', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'employee_id', ac.employee_id,
              'full_name', e.full_name,
              'role', ac.role
            ))
            FROM appointment_crew ac
            JOIN employees e ON e.id = ac.employee_id
            WHERE ac.appointment_id = a.id
          ), '[]'::jsonb),
          'task_total', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id),
          'task_completed', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id AND jt.is_completed = true)
        ) AS row_data
        FROM appointments a
        WHERE a.job_id = j.id
      ) sub
    ), '[]'::jsonb)
  )
  INTO result
  FROM jobs j
  LEFT JOIN claims c ON c.id = j.claim_id
  WHERE j.id = p_job_id;

  RETURN result; -- NULL when the job id does not exist
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_job_hub(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
