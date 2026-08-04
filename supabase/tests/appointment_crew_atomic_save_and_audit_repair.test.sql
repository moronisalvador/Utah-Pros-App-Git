-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: appointment_crew_atomic_save_and_audit_repair.test.sql
-- Phase: Mobile readiness — appointment crew Production regression recovery
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back proof for the enum-safe crew set diff and
-- the atomic create/update RPCs. It is intentionally compatible with either
-- supported predecessor (Production hotfix or QA M1) after the successor runs.

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing appointment crew repair test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

CREATE TEMP TABLE upr_crew_test_scope (id integer);
CREATE FUNCTION pg_temp.crew_event_payloads(
  p_appointment_id uuid,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(payload jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT event.payload
  FROM public.system_events event
  WHERE event.event_type = 'appointment.crew_changed'
    AND event.entity_id = p_appointment_id
    AND event.payload ? 'actor_kind'
    AND (
      p_actor_id IS NULL
      OR event.actor_id = p_actor_id
    );
$function$;

-- Fixed, non-PII fixture identities. The job is only a foreign-key anchor.
INSERT INTO public.employees (id, full_name, role, is_active, is_external, auth_user_id)
VALUES
  ('94000000-0000-4000-8000-000000000001', 'Synthetic Crew Admin', 'admin', true, false, '96000000-0000-4000-8000-000000000001'),
  ('94000000-0000-4000-8000-000000000002', 'Synthetic Crew Field', 'field_tech', true, false, '96000000-0000-4000-8000-000000000002'),
  ('94000000-0000-4000-8000-000000000003', 'Synthetic Crew Disabled', 'office', false, false, '96000000-0000-4000-8000-000000000003'),
  ('94000000-0000-4000-8000-000000000004', 'Synthetic Crew External', 'office', true, true, '96000000-0000-4000-8000-000000000004'),
  ('94000000-0000-4000-8000-000000000005', 'Synthetic Crew Partner', 'crm_partner', true, false, '96000000-0000-4000-8000-000000000005'),
  ('94000000-0000-4000-8000-000000000011', 'Synthetic Crew Lead', 'field_tech', true, false, NULL),
  ('94000000-0000-4000-8000-000000000012', 'Synthetic Crew Tech', 'field_tech', true, false, NULL),
  ('94000000-0000-4000-8000-000000000013', 'Synthetic Crew Helper', 'field_tech', true, false, NULL),
  ('94000000-0000-4000-8000-000000000014', 'Synthetic Crew Default', 'field_tech', true, false, '96000000-0000-4000-8000-000000000014');

INSERT INTO public.jobs (id, insured_name)
VALUES
  ('93000000-0000-4000-8000-000000000001', 'Synthetic local fixture'),
  ('93000000-0000-4000-8000-000000000002', 'Synthetic other-job fixture'),
  ('93000000-0000-4000-8000-000000000010', 'Synthetic merge keeper'),
  ('93000000-0000-4000-8000-000000000011', 'Synthetic merge loser');

INSERT INTO public.job_tasks (id, job_id, title)
VALUES
  ('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'Synthetic existing task'),
  ('92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000001', 'Synthetic replacement task'),
  ('92000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000002', 'Synthetic other-job task');

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000001"}', true);
INSERT INTO public.appointments (id, title, date, time_start, time_end, kind, job_id, is_private, notify_client)
VALUES (
  '95000000-0000-4000-8000-000000000001', 'Synthetic private crew appointment', DATE '2026-08-04',
  TIME '08:00', TIME '09:00', 'job', '93000000-0000-4000-8000-000000000001', true, true
), (
  '95000000-0000-4000-8000-000000000020', 'Synthetic service crew appointment', DATE '2026-08-04',
  TIME '10:00', TIME '11:00', 'job', '93000000-0000-4000-8000-000000000001', false, false
), (
  '95000000-0000-4000-8000-000000000030', 'Synthetic job-merge appointment', DATE '2026-08-05',
  TIME '12:00', TIME '13:00', 'job', '93000000-0000-4000-8000-000000000011', false, false
);

-- Trusted callers cannot use the browser signature or mutate crew without an
-- explicit, validated employee actor in the same command transaction.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
DO $service_actor_provenance$
BEGIN
  BEGIN
    INSERT INTO public.appointments (title, date, kind)
    VALUES ('Rejected service appointment', DATE '2026-08-04', 'event');
    RAISE EXCEPTION 'service role used raw appointment insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.appointments
  SET client_time_sig = 'synthetic-service-cas'
  WHERE id = '95000000-0000-4000-8000-000000000020';
  IF NOT EXISTS (
    SELECT 1
    FROM public.appointments appointment
    WHERE appointment.id =
      '95000000-0000-4000-8000-000000000020'
      AND appointment.client_time_sig = 'synthetic-service-cas'
  ) THEN
    RAISE EXCEPTION
      'service appointment metadata compare-and-set compatibility failed';
  END IF;
  BEGIN
    UPDATE public.appointments
    SET title = title
    WHERE id = '95000000-0000-4000-8000-000000000020';
    RAISE EXCEPTION 'service role updated a non-CAS appointment column';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.appointment_crew (
      appointment_id,
      employee_id,
      role
    )
    VALUES (
      '95000000-0000-4000-8000-000000000020',
      '94000000-0000-4000-8000-000000000012',
      'tech'
    );
    RAISE EXCEPTION 'service role used raw crew DML';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.merge_jobs(
      '93000000-0000-4000-8000-000000000010',
      '93000000-0000-4000-8000-000000000011'
    );
    RAISE EXCEPTION 'service role executed browser job merge';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.sync_appointment_crew(
      '95000000-0000-4000-8000-000000000020',
      '[]'::jsonb
    );
    RAISE EXCEPTION 'service role used browser crew signature';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.sync_appointment_crew(
      '95000000-0000-4000-8000-000000000020',
      '[{"employee_id":"94000000-0000-4000-8000-000000000011"}]'::jsonb,
      '94000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'service role used an inactive audit actor';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  PERFORM public.sync_appointment_crew(
    '95000000-0000-4000-8000-000000000020',
    '[{"employee_id":"94000000-0000-4000-8000-000000000011","role":"lead"}]'::jsonb,
    '94000000-0000-4000-8000-000000000001'
  );
  IF (
       SELECT count(*)
       FROM pg_temp.crew_event_payloads(
         '95000000-0000-4000-8000-000000000020',
         '94000000-0000-4000-8000-000000000001'
       ) event
       WHERE event.payload ->> 'actor_kind' = 'service_role'
         AND event.payload ? 'changed_at'
     ) <> 2 THEN
    RAISE EXCEPTION 'service crew change lost explicit employee provenance';
  END IF;
END;
$service_actor_provenance$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000001"}', true);

-- Every valid enum label persists. The missing and JSON-null role both resolve
-- to the established `tech` default, without an enum/text coercion failure.
DO $valid_set$
BEGIN
  PERFORM public.sync_appointment_crew(
    '95000000-0000-4000-8000-000000000001',
    '[
      {"employee_id":"94000000-0000-4000-8000-000000000011","role":"lead"},
      {"employee_id":"94000000-0000-4000-8000-000000000012","role":"tech"},
      {"employee_id":"94000000-0000-4000-8000-000000000013","role":"helper"},
      {"employee_id":"94000000-0000-4000-8000-000000000014","role":null}
    ]'::jsonb
  );
  IF (SELECT jsonb_object_agg(employee_id::text, role::text ORDER BY employee_id)
      FROM public.appointment_crew
      WHERE appointment_id = '95000000-0000-4000-8000-000000000001')
     IS DISTINCT FROM jsonb_build_object(
       '94000000-0000-4000-8000-000000000011', 'lead',
       '94000000-0000-4000-8000-000000000012', 'tech',
       '94000000-0000-4000-8000-000000000013', 'helper',
       '94000000-0000-4000-8000-000000000014', 'tech'
     ) THEN
    RAISE EXCEPTION 'valid/default crew roles did not persist exactly';
  END IF;
END;
$valid_set$;

DO $unchanged_identity$
DECLARE
  v_ids jsonb;
  v_after_ids jsonb;
  v_audit_count bigint;
BEGIN
  SELECT jsonb_object_agg(employee_id::text, id::text ORDER BY employee_id)
    INTO v_ids
  FROM public.appointment_crew crew
  WHERE crew.appointment_id = '95000000-0000-4000-8000-000000000001';
  PERFORM public.sync_appointment_crew(
    '95000000-0000-4000-8000-000000000001',
    '[
      {"employee_id":"94000000-0000-4000-8000-000000000011","role":"lead"},
      {"employee_id":"94000000-0000-4000-8000-000000000012","role":"tech"},
      {"employee_id":"94000000-0000-4000-8000-000000000013","role":"helper"},
      {"employee_id":"94000000-0000-4000-8000-000000000014"}
    ]'::jsonb
  );
  SELECT jsonb_object_agg(employee_id::text, id::text ORDER BY employee_id)
  INTO v_after_ids
  FROM public.appointment_crew
  WHERE appointment_id = '95000000-0000-4000-8000-000000000001';
  SELECT count(*)
  INTO v_audit_count
  FROM pg_temp.crew_event_payloads(
    '95000000-0000-4000-8000-000000000001'
  );
  IF v_after_ids IS DISTINCT FROM v_ids OR v_audit_count <> 5 THEN
    RAISE EXCEPTION
      'unchanged crew rewrote identity or emitted audit (ids %, expected %, audits %)',
      v_after_ids,
      v_ids,
      v_audit_count;
  END IF;
END;
$unchanged_identity$;

-- Invalid shapes and invalid target eligibility fail before the first mutation.
DO $invalid_sync_is_atomic$
DECLARE v_before jsonb; v_payload jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(crew) ORDER BY id)
    INTO v_before
  FROM public.appointment_crew crew
  WHERE crew.appointment_id = '95000000-0000-4000-8000-000000000001';
  FOREACH v_payload IN ARRAY ARRAY[
    '"not-an-array"'::jsonb,
    '["not-an-object"]'::jsonb,
    '[{"employee_id":"not-a-uuid","role":"tech"}]'::jsonb,
    '[{"employee_id":"94000000-0000-4000-8000-000000000011","role":"owner"}]'::jsonb,
    '[{"employee_id":"94000000-0000-4000-8000-000000000011","role":"lead"},{"employee_id":"94000000-0000-4000-8000-000000000011","role":"tech"}]'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.sync_appointment_crew('95000000-0000-4000-8000-000000000001', v_payload);
      RAISE EXCEPTION 'invalid crew payload unexpectedly succeeded: %', v_payload;
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
  FOREACH v_payload IN ARRAY ARRAY[
    '[{"employee_id":"94000000-0000-4000-8000-000000000003","role":"tech"}]'::jsonb,
    '[{"employee_id":"94000000-0000-4000-8000-000000000004","role":"tech"}]'::jsonb,
    '[{"employee_id":"94000000-0000-4000-8000-000000000005","role":"tech"}]'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.sync_appointment_crew('95000000-0000-4000-8000-000000000001', v_payload);
      RAISE EXCEPTION 'ineligible crew target unexpectedly succeeded: %', v_payload;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;
  IF (SELECT jsonb_agg(to_jsonb(crew) ORDER BY id)
      FROM public.appointment_crew crew
      WHERE crew.appointment_id = '95000000-0000-4000-8000-000000000001') IS DISTINCT FROM v_before
     OR (SELECT count(*) FROM pg_temp.crew_event_payloads(
           '95000000-0000-4000-8000-000000000001'
         )) <> 5 THEN
    RAISE EXCEPTION 'invalid crew input made a partial mutation';
  END IF;
END;
$invalid_sync_is_atomic$;

-- Set difference preserves identity for unchanged staff and audits exactly the
-- update/remove/add rows with actor, old/new snapshots, and a timestamp.
DO $set_diff_and_audit$
BEGIN
  PERFORM public.sync_appointment_crew(
    '95000000-0000-4000-8000-000000000001',
    '[
      {"employee_id":"94000000-0000-4000-8000-000000000011","role":"tech"},
      {"employee_id":"94000000-0000-4000-8000-000000000013","role":"helper"},
      {"employee_id":"94000000-0000-4000-8000-000000000014","role":"tech"}
    ]'::jsonb
  );
  IF (SELECT count(*) FROM public.appointment_crew
      WHERE appointment_id = '95000000-0000-4000-8000-000000000001') <> 3
     OR NOT EXISTS (SELECT 1 FROM public.appointment_crew
                    WHERE appointment_id = '95000000-0000-4000-8000-000000000001'
                      AND employee_id = '94000000-0000-4000-8000-000000000011'
                      AND role = 'tech')
     OR EXISTS (SELECT 1 FROM public.appointment_crew
                WHERE appointment_id = '95000000-0000-4000-8000-000000000001'
                  AND employee_id = '94000000-0000-4000-8000-000000000012')
     OR (SELECT count(*) FROM pg_temp.crew_event_payloads(
           '95000000-0000-4000-8000-000000000001'
         )) <> 8
     OR NOT EXISTS (
       SELECT 1
       FROM pg_temp.crew_event_payloads(
         '95000000-0000-4000-8000-000000000001',
         '94000000-0000-4000-8000-000000000001'
       ) event
       WHERE event.payload ->> 'operation' = 'update'
         AND event.payload #>> '{old_assignment,role}' = 'lead'
         AND event.payload #>> '{new_assignment,role}' = 'tech'
         AND event.payload ? 'changed_at'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_temp.crew_event_payloads(
         '95000000-0000-4000-8000-000000000001',
         '94000000-0000-4000-8000-000000000001'
       ) event
       WHERE event.payload ->> 'operation' = 'set_diff'
         AND jsonb_array_length(event.payload -> 'old_crew') = 4
         AND jsonb_array_length(event.payload -> 'new_crew') = 3
         AND event.payload ? 'changed_at'
     ) THEN
    RAISE EXCEPTION 'set-diff/audit contract failed';
  END IF;
END;
$set_diff_and_audit$;

-- Any active internal employee, including a field technician, can edit crew on
-- a private appointment. They still cannot toggle privacy itself.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000002"}', true);
DO $field_tech_private_crew$
BEGIN
  PERFORM public.sync_appointment_crew(
    '95000000-0000-4000-8000-000000000001',
    '[
      {"employee_id":"94000000-0000-4000-8000-000000000011","role":"lead"},
      {"employee_id":"94000000-0000-4000-8000-000000000002","role":"tech"}
    ]'::jsonb
  );
  IF NOT EXISTS (
    SELECT 1
    FROM pg_temp.crew_event_payloads(
      '95000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'field technician crew change was not attributed';
  END IF;
  BEGIN
    PERFORM public.update_appointment_with_crew(
      '95000000-0000-4000-8000-000000000001', p_is_private := false
    );
    RAISE EXCEPTION 'field technician changed appointment privacy';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$field_tech_private_crew$;

-- An unassigned active internal employee can perform the owner-approved private
-- crew change, but the response cannot disclose private appointment details.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000014"}', true);
DO $private_crew_response_is_minimal$
DECLARE v_result jsonb;
BEGIN
  BEGIN
    PERFORM public.update_appointment_with_crew(
      '95000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION
      'unassigned private appointment no-op disclosed details';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    PERFORM public.update_appointment_with_crew(
      '95000000-0000-4000-8000-000000000001',
      p_date := DATE '2026-08-04',
      p_title := 'Synthetic private crew appointment',
      p_crew := '[
        {"employee_id":"94000000-0000-4000-8000-000000000011","role":"helper"},
        {"employee_id":"94000000-0000-4000-8000-000000000002","role":"tech"}
      ]'::jsonb
    );
    RAISE EXCEPTION
      'private same-value field guesses bypassed noncrew intent authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.update_appointment_with_crew(
      '95000000-0000-4000-8000-000000000001',
      p_notes := NULL,
      p_set_notes := true,
      p_crew := '[
        {"employee_id":"94000000-0000-4000-8000-000000000011","role":"helper"},
        {"employee_id":"94000000-0000-4000-8000-000000000002","role":"tech"}
      ]'::jsonb
    );
    RAISE EXCEPTION
      'private nullable-field guess bypassed noncrew intent authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  v_result := public.update_appointment_with_crew(
    '95000000-0000-4000-8000-000000000001',
    p_crew := '[
      {"employee_id":"94000000-0000-4000-8000-000000000011","role":"helper"},
      {"employee_id":"94000000-0000-4000-8000-000000000002","role":"tech"}
    ]'::jsonb
  );
  IF v_result IS DISTINCT FROM jsonb_build_object(
       'id',
       '95000000-0000-4000-8000-000000000001'::uuid,
       'crew_changed',
       true
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_temp.crew_event_payloads(
         '95000000-0000-4000-8000-000000000001',
         '94000000-0000-4000-8000-000000000014'
       )
     ) THEN
    RAISE EXCEPTION
      'private crew-only response leaked details or lost actor attribution: %',
      v_result;
  END IF;
END;
$private_crew_response_is_minimal$;

-- Admin creates a job appointment atomically: existing task assignment, cloned
-- task template, crew, and appointment all arrive together. Event creation is
-- supported but cannot clone job tasks.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000001"}', true);
DO $atomic_create$
DECLARE v_job_appointment uuid; v_event uuid; v_before integer;
BEGIN
  SELECT (public.create_appointment_with_crew(
    p_title := 'Synthetic atomic job appointment', p_date := DATE '2026-08-05',
    p_job_id := '93000000-0000-4000-8000-000000000001', p_kind := 'job',
    p_time_start := TIME '10:00', p_time_end := TIME '11:00', p_is_private := true,
    p_crew := '[{"employee_id":"94000000-0000-4000-8000-000000000011","role":"lead"}]'::jsonb,
    p_task_ids := ARRAY['92000000-0000-4000-8000-000000000001']::uuid[],
    p_task_templates := '[{"title":"Synthetic cloned task","phase_name":"Synthetic"}]'::jsonb
  ) ->> 'id')::uuid INTO v_job_appointment;
  IF (SELECT count(*) FROM public.job_tasks WHERE appointment_id = v_job_appointment) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.appointment_crew
                    WHERE appointment_id = v_job_appointment
                      AND employee_id = '94000000-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'atomic job appointment omitted crew or tasks';
  END IF;
  SELECT (public.create_appointment_with_crew(
    p_title := 'Synthetic atomic event', p_date := DATE '2026-08-05', p_kind := 'event',
    p_crew := '[{"employee_id":"94000000-0000-4000-8000-000000000012"}]'::jsonb
  ) ->> 'id')::uuid INTO v_event;
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id = v_event AND kind = 'event' AND job_id IS NULL) THEN
    RAISE EXCEPTION 'atomic event creation failed';
  END IF;

  SELECT count(*) INTO v_before FROM public.appointments WHERE title = 'Synthetic rejected create';
  BEGIN
    PERFORM public.create_appointment_with_crew(
      p_title := 'Synthetic rejected create', p_date := DATE '2026-08-06',
      p_job_id := '93000000-0000-4000-8000-000000000001', p_kind := 'job',
      p_crew := '[{"employee_id":"94000000-0000-4000-8000-000000000011","role":"bad"}]'::jsonb,
      p_task_templates := '[{"title":"would roll back"}]'::jsonb
    );
    RAISE EXCEPTION 'invalid atomic create unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.appointments WHERE title = 'Synthetic rejected create') <> v_before
     OR EXISTS (SELECT 1 FROM public.job_tasks WHERE title = 'would roll back') THEN
    RAISE EXCEPTION 'invalid atomic create persisted partial appointment or task';
  END IF;

  BEGIN
    PERFORM public.create_appointment_with_crew(
      p_title := 'Synthetic cross-job rejected create',
      p_date := DATE '2026-08-06',
      p_job_id := '93000000-0000-4000-8000-000000000001',
      p_kind := 'job',
      p_task_ids := ARRAY[
        '92000000-0000-4000-8000-000000000003'
      ]::uuid[]
    );
    RAISE EXCEPTION 'cross-job task assignment unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF EXISTS (
    SELECT 1
    FROM public.appointments
    WHERE title = 'Synthetic cross-job rejected create'
  ) THEN
    RAISE EXCEPTION 'cross-job task rejection left a partial appointment';
  END IF;
END;
$atomic_create$;

-- The hardened same-signature legacy RPCs preserve installed-client calls
-- without reopening actor/object authorization.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000002"}', true);
DO $legacy_installed_client_compatibility$
DECLARE
  v_appointment_id uuid;
  v_created_by uuid;
BEGIN
  v_appointment_id := (
    public.create_appointment_with_crew(
      p_title := 'Synthetic legacy-client appointment',
      p_date := DATE '2026-08-06',
      p_job_id := '93000000-0000-4000-8000-000000000001',
      p_kind := 'job',
      p_time_start := TIME '09:00',
      p_time_end := TIME '10:00',
      p_type := 'monitoring',
      p_status := 'scheduled',
      p_crew := '[
        {"employee_id":"94000000-0000-4000-8000-000000000002","role":"lead"}
      ]'::jsonb
    ) ->> 'id'
  )::uuid;

  SELECT appointment.created_by
  INTO v_created_by
  FROM public.appointments appointment
  WHERE appointment.id = v_appointment_id;

  IF v_created_by IS DISTINCT FROM
       '94000000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION
      'legacy direct create did not bind the authenticated employee';
  END IF;

  PERFORM public.update_appointment(
    v_appointment_id,
    p_date := DATE '2026-08-07',
    p_actor_id := '94000000-0000-4000-8000-000000000002'
  );
  PERFORM public.assign_tasks_to_appointment(
    v_appointment_id,
    ARRAY[]::uuid[]
  );
  PERFORM public.delete_appointment(
    v_appointment_id,
    '94000000-0000-4000-8000-000000000002',
    'Synthetic local compatibility proof'
  );

  IF EXISTS (
       SELECT 1
       FROM public.appointments
       WHERE id = v_appointment_id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.appointment_status_history history
       WHERE history.appointment_id = v_appointment_id
         AND history.event_type = 'deleted'
         AND history.actor_id =
           '94000000-0000-4000-8000-000000000002'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_temp.crew_event_payloads(
         v_appointment_id,
         '94000000-0000-4000-8000-000000000002'
       ) event
       WHERE event.payload ->> 'operation' = 'delete'
     ) THEN
    RAISE EXCEPTION
      'legacy compatibility update/delete lost authorization or audit';
  END IF;
END;
$legacy_installed_client_compatibility$;

-- Phase A keeps installed-native PostgREST writes compatible. RLS and the
-- triggers still bind each row to an active internal actor and record every
-- real crew add/change/remove. Current source uses the atomic RPCs instead.
DO $legacy_raw_dml_compatibility$
DECLARE
  v_subs text[] := ARRAY[
    '96000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000002'
  ];
  v_actor_ids uuid[] := ARRAY[
    '94000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000002'
  ]::uuid[];
  v_appointment_ids uuid[] := ARRAY[
    '95000000-0000-4000-8000-000000000010',
    '95000000-0000-4000-8000-000000000011'
  ]::uuid[];
  v_index integer;
BEGIN
  FOR v_index IN 1..array_length(v_subs, 1) LOOP
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'role',
        'authenticated',
        'sub',
        v_subs[v_index]
      )::text,
      true
    );
    INSERT INTO public.appointments (
      id,
      title,
      date,
      kind,
      job_id,
      notify_client
    )
    VALUES (
      v_appointment_ids[v_index],
      'Legacy native appointment',
      DATE '2026-08-09',
      'job',
      '93000000-0000-4000-8000-000000000001',
      false
    );
    UPDATE public.appointments
    SET title = 'Legacy native appointment updated',
        notify_client = true
    WHERE id = v_appointment_ids[v_index];

    INSERT INTO public.appointment_crew (
      appointment_id,
      employee_id,
      role
    )
    VALUES (
      v_appointment_ids[v_index],
      '94000000-0000-4000-8000-000000000014',
      'tech'
    );
    UPDATE public.appointment_crew
    SET role = 'helper'
    WHERE appointment_id = v_appointment_ids[v_index]
      AND employee_id = '94000000-0000-4000-8000-000000000014';
    DELETE FROM public.appointment_crew
    WHERE appointment_id = v_appointment_ids[v_index]
      AND employee_id = '94000000-0000-4000-8000-000000000014';

    IF NOT EXISTS (
         SELECT 1
         FROM public.appointments appointment
         WHERE appointment.id = v_appointment_ids[v_index]
           AND appointment.created_by = v_actor_ids[v_index]
           AND appointment.notify_client IS TRUE
       )
       OR (
         SELECT count(*)
         FROM pg_temp.crew_event_payloads(
           v_appointment_ids[v_index],
           v_actor_ids[v_index]
         ) event
         WHERE event.payload ->> 'operation' IN (
           'insert',
           'update',
           'delete'
         )
           AND event.payload ? 'changed_at'
       ) <> 3 THEN
      RAISE EXCEPTION
        'legacy native PostgREST compatibility lost RLS actor or crew audit: %',
        v_subs[v_index];
    END IF;

    DELETE FROM public.appointments
    WHERE id = v_appointment_ids[v_index];
  END LOOP;
END;
$legacy_raw_dml_compatibility$;

-- An update/reschedule preserves crew when p_crew is NULL, records the actual
-- field-tech actor in status history, and can replace assigned tasks atomically.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000002"}', true);
DO $atomic_update_and_rollback$
DECLARE
  v_crew_before jsonb; v_history_before integer; v_audit_before integer;
  v_private_before boolean; v_notify_before boolean;
BEGIN
  SELECT
    jsonb_agg(to_jsonb(crew) ORDER BY crew.id),
    appointment.is_private,
    appointment.notify_client
    INTO v_crew_before, v_private_before, v_notify_before
  FROM public.appointment_crew crew
  JOIN public.appointments appointment ON appointment.id = crew.appointment_id
  WHERE crew.appointment_id = '95000000-0000-4000-8000-000000000001'
  GROUP BY appointment.date, appointment.is_private, appointment.notify_client;

  PERFORM public.update_appointment_with_crew(
    '95000000-0000-4000-8000-000000000001', p_date := DATE '2026-08-07',
    p_time_start := TIME '12:00', p_time_end := TIME '13:00', p_crew := NULL,
    p_task_ids := ARRAY['92000000-0000-4000-8000-000000000002']::uuid[]);
  IF (SELECT jsonb_agg(to_jsonb(crew) ORDER BY id) FROM public.appointment_crew crew
      WHERE appointment_id = '95000000-0000-4000-8000-000000000001') IS DISTINCT FROM v_crew_before
     OR NOT EXISTS (SELECT 1 FROM public.appointment_status_history
                    WHERE appointment_id = '95000000-0000-4000-8000-000000000001'
                      AND event_type = 'rescheduled'
                      AND actor_id = '94000000-0000-4000-8000-000000000002')
     OR NOT EXISTS (SELECT 1 FROM public.job_tasks
                    WHERE id = '92000000-0000-4000-8000-000000000002'
                      AND appointment_id = '95000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'reschedule with NULL crew did not preserve crew/history/task assignment';
  END IF;

  -- The composite update also owns a normal crew replacement; this is distinct
  -- from the NULL-preserve contract above.
  PERFORM public.update_appointment_with_crew(
    '95000000-0000-4000-8000-000000000001',
    p_crew := '[
      {"employee_id":"94000000-0000-4000-8000-000000000011","role":"tech"},
      {"employee_id":"94000000-0000-4000-8000-000000000013","role":"helper"}
    ]'::jsonb);
  IF (SELECT count(*) FROM public.appointment_crew
      WHERE appointment_id = '95000000-0000-4000-8000-000000000001') <> 2
     OR NOT EXISTS (
       SELECT 1
       FROM pg_temp.crew_event_payloads(
         '95000000-0000-4000-8000-000000000001',
         '94000000-0000-4000-8000-000000000002'
       ) event
       WHERE event.payload ->> 'operation' = 'insert'
     ) THEN
    RAISE EXCEPTION 'composite update did not own audited crew replacement';
  END IF;

  SELECT jsonb_agg(to_jsonb(crew) ORDER BY id)
    INTO v_crew_before
  FROM public.appointment_crew crew
  WHERE crew.appointment_id = '95000000-0000-4000-8000-000000000001';

  SELECT count(*) INTO v_history_before
  FROM public.appointment_status_history
  WHERE appointment_id = '95000000-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_audit_before
  FROM pg_temp.crew_event_payloads(
    '95000000-0000-4000-8000-000000000001'
  );
  BEGIN
    PERFORM public.update_appointment_with_crew(
      '95000000-0000-4000-8000-000000000001', p_date := DATE '2026-08-08',
      p_time_start := TIME '14:00', p_time_end := TIME '15:00', p_is_private := false,
      p_notify_client := false, p_task_ids := ARRAY['92000000-0000-4000-8000-000000000002']::uuid[],
      p_crew := '[{"employee_id":"94000000-0000-4000-8000-000000000011","role":"invalid"}]'::jsonb);
    RAISE EXCEPTION 'invalid atomic update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    -- Field tech privacy gate rejects first; retry as admin to prove crew failure rolls all fields back.
    NULL;
  END;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000001"}', true);
  BEGIN
    PERFORM public.update_appointment_with_crew(
      '95000000-0000-4000-8000-000000000001', p_date := DATE '2026-08-08',
      p_time_start := TIME '14:00', p_time_end := TIME '15:00', p_is_private := false,
      p_notify_client := false, p_task_ids := ARRAY['92000000-0000-4000-8000-000000000002']::uuid[],
      p_crew := '[{"employee_id":"94000000-0000-4000-8000-000000000011","role":"invalid"}]'::jsonb);
    RAISE EXCEPTION 'invalid admin atomic update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF (SELECT date FROM public.appointments WHERE id = '95000000-0000-4000-8000-000000000001') <> DATE '2026-08-07'
     OR (SELECT is_private FROM public.appointments WHERE id = '95000000-0000-4000-8000-000000000001') IS DISTINCT FROM v_private_before
     OR (SELECT notify_client FROM public.appointments WHERE id = '95000000-0000-4000-8000-000000000001') IS DISTINCT FROM v_notify_before
     OR (SELECT appointment_id FROM public.job_tasks WHERE id = '92000000-0000-4000-8000-000000000002') <> '95000000-0000-4000-8000-000000000001'::uuid
     OR (SELECT jsonb_agg(to_jsonb(crew) ORDER BY id) FROM public.appointment_crew crew
         WHERE appointment_id = '95000000-0000-4000-8000-000000000001') IS DISTINCT FROM v_crew_before
     OR (SELECT count(*) FROM public.appointment_status_history
         WHERE appointment_id = '95000000-0000-4000-8000-000000000001') <> v_history_before
     OR (SELECT count(*) FROM pg_temp.crew_event_payloads(
           '95000000-0000-4000-8000-000000000001'
         )) <> v_audit_before THEN
    RAISE EXCEPTION 'invalid update partially changed appointment, preference, task, or crew';
  END IF;
END;
$atomic_update_and_rollback$;

-- Presence flags make explicit NULL a real clear operation while omitted
-- nullable values preserve the stored state. The reschedule history records
-- the final NULLs and the actual authenticated employee actor.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000001"}', true);
DO $nullable_clear_and_preserve$
DECLARE
  v_history_before bigint;
BEGIN
  PERFORM public.update_appointment_with_crew(
    '95000000-0000-4000-8000-000000000001',
    p_notes := 'Synthetic temporary notes'
  );

  SELECT count(*)
  INTO v_history_before
  FROM public.appointment_status_history
  WHERE appointment_id =
    '95000000-0000-4000-8000-000000000001';

  PERFORM public.update_appointment_with_crew(
    '95000000-0000-4000-8000-000000000001',
    p_date := DATE '2026-08-09',
    p_time_start := NULL,
    p_time_end := NULL,
    p_notes := NULL,
    p_set_time_start := true,
    p_set_time_end := true,
    p_set_notes := true
  );

  IF NOT EXISTS (
       SELECT 1
       FROM public.appointments appointment
       WHERE appointment.id =
         '95000000-0000-4000-8000-000000000001'
         AND appointment.date = DATE '2026-08-09'
         AND appointment.time_start IS NULL
         AND appointment.time_end IS NULL
         AND appointment.notes IS NULL
     )
     OR (
       SELECT count(*)
       FROM public.appointment_status_history history
       WHERE history.appointment_id =
         '95000000-0000-4000-8000-000000000001'
     ) <> v_history_before + 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.appointment_status_history history
       WHERE history.appointment_id =
         '95000000-0000-4000-8000-000000000001'
         AND history.event_type = 'rescheduled'
         AND history.old_date = DATE '2026-08-07'
         AND history.old_time_start = TIME '12:00'
         AND history.old_time_end = TIME '13:00'
         AND history.new_date = DATE '2026-08-09'
         AND history.new_time_start IS NULL
         AND history.new_time_end IS NULL
         AND history.actor_id =
           '94000000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION
      'explicit nullable clear lost stored state or reschedule provenance';
  END IF;

  -- Omitting all nullable values is a no-op and must not recreate them or add
  -- another status-history row.
  PERFORM public.update_appointment_with_crew(
    '95000000-0000-4000-8000-000000000001',
    p_crew := NULL
  );
  IF NOT EXISTS (
       SELECT 1
       FROM public.appointments appointment
       WHERE appointment.id =
         '95000000-0000-4000-8000-000000000001'
         AND appointment.time_start IS NULL
         AND appointment.time_end IS NULL
         AND appointment.notes IS NULL
     )
     OR (
       SELECT count(*)
       FROM public.appointment_status_history history
       WHERE history.appointment_id =
         '95000000-0000-4000-8000-000000000001'
     ) <> v_history_before + 1 THEN
    RAISE EXCEPTION
      'omitted nullable fields changed state or emitted history';
  END IF;
END;
$nullable_clear_and_preserve$;

-- Disabled/external/partner/unmapped users and anon cannot mutate, while the
-- trigger prevents browser-side audit tampering and crew identity rewrites.
DO $denied_and_immutable$
DECLARE
  v_sub text;
  v_crew_id uuid;
  v_before jsonb;
  v_audit_before jsonb;
BEGIN
  SELECT
    jsonb_agg(to_jsonb(crew) ORDER BY crew.id),
    (array_agg(crew.id ORDER BY crew.id))[1]
  INTO v_before, v_crew_id
  FROM public.appointment_crew crew
  WHERE appointment_id = '95000000-0000-4000-8000-000000000001';
  SELECT jsonb_agg(event.payload ORDER BY event.payload::text)
  INTO v_audit_before
  FROM pg_temp.crew_event_payloads(
    '95000000-0000-4000-8000-000000000001'
  ) event;
  FOREACH v_sub IN ARRAY ARRAY[
    '96000000-0000-4000-8000-000000000003', '96000000-0000-4000-8000-000000000004',
    '96000000-0000-4000-8000-000000000005', '96000000-0000-4000-8000-000000000099'
  ] LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',v_sub)::text, true);
    BEGIN
      PERFORM public.sync_appointment_crew('95000000-0000-4000-8000-000000000001', '[]'::jsonb);
      RAISE EXCEPTION 'denied actor unexpectedly succeeded: %', v_sub;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.update_appointment(
        '95000000-0000-4000-8000-000000000001',
        p_title := 'Unauthorized legacy update'
      );
      RAISE EXCEPTION 'denied legacy update unexpectedly succeeded: %', v_sub;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.assign_tasks_to_appointment(
        '95000000-0000-4000-8000-000000000001',
        ARRAY[]::uuid[]
      );
      RAISE EXCEPTION 'denied legacy task update unexpectedly succeeded: %', v_sub;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.delete_appointment(
        '95000000-0000-4000-8000-000000000001'
      );
      RAISE EXCEPTION 'denied legacy delete unexpectedly succeeded: %', v_sub;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      UPDATE public.appointments
      SET title = 'Unauthorized raw update'
      WHERE id = '95000000-0000-4000-8000-000000000001';
      RAISE EXCEPTION
        'denied raw appointment update unexpectedly succeeded: %',
        v_sub;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000001"}', true);
  BEGIN
    UPDATE public.appointment_crew
    SET employee_id = '94000000-0000-4000-8000-000000000012'
    WHERE id = v_crew_id;
    RAISE EXCEPTION 'mutable crew identity unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    UPDATE public.system_events
    SET payload = '{}'::jsonb
    WHERE event_type = 'appointment.crew_changed'
      AND entity_id = '95000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'browser updated append-only crew audit history';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    TRUNCATE TABLE public.system_events;
    RAISE EXCEPTION 'browser truncated append-only crew audit history';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF (SELECT jsonb_agg(to_jsonb(crew) ORDER BY id) FROM public.appointment_crew crew
      WHERE appointment_id = '95000000-0000-4000-8000-000000000001') IS DISTINCT FROM v_before
     OR (
       SELECT jsonb_agg(event.payload ORDER BY event.payload::text)
       FROM pg_temp.crew_event_payloads(
         '95000000-0000-4000-8000-000000000001'
       ) event
     ) IS DISTINCT FROM v_audit_before THEN
    RAISE EXCEPTION
      'denied mutation changed crew or append-only audit payload';
  END IF;
END;
$denied_and_immutable$;

DO $admin_job_merge_appointment_reparent$
DECLARE
  v_denied_sub uuid;
  v_result jsonb;
BEGIN
  -- Direct installed-client DML cannot reparent identity, even for an admin.
  BEGIN
    UPDATE public.appointments
    SET job_id = '93000000-0000-4000-8000-000000000010'
    WHERE id = '95000000-0000-4000-8000-000000000030';
    RAISE EXCEPTION 'direct browser appointment reparent unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns column_record
    WHERE column_record.table_schema = 'public'
      AND column_record.table_name = 'appointments'
      AND column_record.column_name = 'created_by_employee_id'
  ) THEN
    BEGIN
      EXECUTE $sql$
        UPDATE public.appointments
        SET created_by_employee_id =
          '94000000-0000-4000-8000-000000000002'::uuid
        WHERE id = '95000000-0000-4000-8000-000000000030'
      $sql$;
      RAISE EXCEPTION
        'direct browser appointment creator rebind unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END IF;

  PERFORM public.sync_appointment_crew(
    '95000000-0000-4000-8000-000000000030',
    '[{"employee_id":"94000000-0000-4000-8000-000000000011","role":"lead"}]'::jsonb
  );

  FOREACH v_denied_sub IN ARRAY ARRAY[
    '96000000-0000-4000-8000-000000000002',
    '96000000-0000-4000-8000-000000000003',
    '96000000-0000-4000-8000-000000000004',
    '96000000-0000-4000-8000-000000000005',
    '96000000-0000-4000-8000-000000000099'
  ] LOOP
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'role',
        'authenticated',
        'sub',
        v_denied_sub
      )::text,
      true
    );
    BEGIN
      PERFORM public.merge_jobs(
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000011'
      );
      RAISE EXCEPTION
        'non-admin job merge unexpectedly succeeded: %',
        v_denied_sub;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
       FROM public.jobs job
       WHERE job.id = '93000000-0000-4000-8000-000000000011'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.appointments appointment
       WHERE appointment.id =
         '95000000-0000-4000-8000-000000000030'
         AND appointment.job_id =
           '93000000-0000-4000-8000-000000000011'
     ) THEN
    RAISE EXCEPTION 'denied job merge partially mutated appointment/job state';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"96000000-0000-4000-8000-000000000001"}',
    true
  );
  v_result := public.merge_jobs(
    '93000000-0000-4000-8000-000000000010',
    '93000000-0000-4000-8000-000000000011'
  );

  IF v_result ->> 'ok' IS DISTINCT FROM 'true'
     OR (v_result ->> 'appointments_moved')::integer IS DISTINCT FROM 1
     OR EXISTS (
       SELECT 1
       FROM public.jobs job
       WHERE job.id = '93000000-0000-4000-8000-000000000011'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.appointments appointment
       WHERE appointment.id =
         '95000000-0000-4000-8000-000000000030'
         AND appointment.job_id =
           '93000000-0000-4000-8000-000000000010'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.appointment_crew crew
       WHERE crew.appointment_id =
         '95000000-0000-4000-8000-000000000030'
         AND crew.employee_id =
           '94000000-0000-4000-8000-000000000011'
         AND crew.role = 'lead'::public.crew_role
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.system_events event
       WHERE event.event_type = 'job.merged'
         AND event.entity_id =
           '93000000-0000-4000-8000-000000000010'
         AND event.actor_id =
           '94000000-0000-4000-8000-000000000001'
         AND event.payload ->> 'merged_id' =
           '93000000-0000-4000-8000-000000000011'
         AND event.payload ->> 'appointments_moved' = '1'
         AND event.payload ? 'changed_at'
     ) THEN
    RAISE EXCEPTION
      'admin job merge lost atomic appointment/crew preservation or audit';
  END IF;
END;
$admin_job_merge_appointment_reparent$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $anon_denied$
BEGIN
  BEGIN
    PERFORM public.sync_appointment_crew('95000000-0000-4000-8000-000000000001', '[]'::jsonb);
    RAISE EXCEPTION 'anonymous sync unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.update_appointment(
      '95000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'anonymous legacy update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.appointments (
      title,
      date,
      kind,
      job_id
    )
    VALUES (
      'Anonymous rejected appointment',
      DATE '2026-08-09',
      'job',
      '93000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'anonymous raw appointment insert unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.merge_jobs(
      '93000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'anonymous job merge unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$anon_denied$;

RESET ROLE;

DO $catalog_contract$
BEGIN
  IF has_function_privilege('anon', 'public.sync_appointment_crew(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sync_appointment_crew(uuid,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_appointment_with_crew(text,date,uuid,text,time without time zone,time without time zone,text,text,text,boolean,boolean,jsonb,uuid[],jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_appointment_with_crew(uuid,date,time without time zone,time without time zone,text,text,text,text,jsonb,boolean,boolean,uuid[],boolean,boolean,boolean,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_appointment(uuid,date,time without time zone,time without time zone,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.assign_tasks_to_appointment(uuid,uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.delete_appointment(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.merge_jobs(uuid,uuid)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.appointments', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.appointment_crew', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('authenticated', 'public.appointments', 'SELECT,INSERT,DELETE')
     OR has_table_privilege('authenticated', 'public.appointments', 'UPDATE')
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       WHERE column_record.attrelid = 'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND column_record.attname IN (
           'id', 'job_id', 'kind', 'created_by',
           'created_by_employee_id', 'created_at'
         )
         AND has_column_privilege(
           'authenticated',
           column_record.attrelid,
           column_record.attnum,
           'UPDATE'
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       WHERE column_record.attrelid = 'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND column_record.attname NOT IN (
           'id', 'job_id', 'kind', 'created_by',
           'created_by_employee_id', 'created_at'
         )
         AND NOT has_column_privilege(
           'authenticated',
           column_record.attrelid,
           column_record.attnum,
           'UPDATE'
         )
     )
     OR NOT has_table_privilege('authenticated', 'public.appointment_crew', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.appointments', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.appointment_crew', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.system_events', 'UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'public.system_events', 'UPDATE,DELETE,TRUNCATE')
     OR NOT has_table_privilege('service_role', 'public.appointments', 'SELECT')
     OR has_table_privilege('service_role', 'public.appointments', 'UPDATE')
     OR NOT has_column_privilege('service_role', 'public.appointments', 'client_notified_at', 'UPDATE')
     OR NOT has_column_privilege('service_role', 'public.appointments', 'client_time_sig', 'UPDATE')
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       WHERE column_record.attrelid = 'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND column_record.attname NOT IN ('client_notified_at', 'client_time_sig')
         AND has_column_privilege(
           'service_role',
           column_record.attrelid,
           column_record.attnum,
           'UPDATE'
         )
     )
     OR has_table_privilege('service_role', 'public.appointments', 'INSERT,DELETE,TRUNCATE')
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       CROSS JOIN (
         VALUES
           ('anon', 'INSERT'),
           ('anon', 'UPDATE'),
           ('service_role', 'INSERT')
       ) AS privilege_record(role_name, privilege_name)
       WHERE column_record.attrelid = 'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND has_column_privilege(
           privilege_record.role_name,
           column_record.attrelid,
           column_record.attnum,
           privilege_record.privilege_name
         )
     )
     OR NOT has_table_privilege('service_role', 'public.appointment_crew', 'SELECT')
     OR has_table_privilege('service_role', 'public.appointment_crew', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       CROSS JOIN (VALUES ('anon'), ('service_role')) AS role_record(role_name)
       CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS privilege_record(privilege_name)
       WHERE column_record.attrelid = 'public.appointment_crew'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND has_column_privilege(
           role_record.role_name,
           column_record.attrelid,
           column_record.attnum,
           privilege_record.privilege_name
         )
     )
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.appointments'::regclass
                    AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.appointment_crew'::regclass
                    AND relrowsecurity)
     OR NOT has_function_privilege('authenticated', 'public.sync_appointment_crew(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sync_appointment_crew(uuid,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.sync_appointment_crew(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.sync_appointment_crew(uuid,jsonb,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.merge_jobs(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.merge_jobs(uuid,uuid)', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.appointment_crew'::regclass
                    AND tgname = 'trg_appointment_crew_actor_audit' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.appointments'::regclass
                    AND tgname = 'trg_appointments_atomic_command_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'appointment crew repair catalog contract is open or incomplete';
  END IF;
END;
$catalog_contract$;

ROLLBACK;
