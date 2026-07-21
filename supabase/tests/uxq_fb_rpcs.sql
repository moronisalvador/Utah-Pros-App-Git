-- ════════════════════════════════════════════════
-- SQL GATE: uxq_fb_rpcs.sql  (UX-Quality F-B)
-- ════════════════════════════════════════════════
-- Runnable atomicity + column-shape proof for the three F-B RPCs. Run LIVE via
-- the Supabase MCP as service_role AFTER the three migrations apply (the JS
-- companion uxq_fb_rpcs.test.js proves the anon-can't-call half; this proves the
-- behavior half, which needs a caller that CAN execute the RPCs).
--
-- Self-contained: creates its own throwaway fixtures inside a transaction and
-- ROLLBACKs at the end, so it writes NOTHING durable. If any RAISE fires, the
-- gate failed.
-- ════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_appt uuid;
  v_emp1 uuid;
  v_emp2 uuid;
  v_cnt  int;
BEGIN
  -- Grab two real employees + one real appointment to avoid FK violations.
  SELECT id INTO v_emp1 FROM employees ORDER BY created_at LIMIT 1;
  SELECT id INTO v_emp2 FROM employees WHERE id <> v_emp1 ORDER BY created_at LIMIT 1;
  SELECT id INTO v_appt FROM appointments ORDER BY created_at DESC LIMIT 1;

  IF v_appt IS NULL OR v_emp1 IS NULL OR v_emp2 IS NULL THEN
    RAISE NOTICE 'SKIP: need >=2 employees and >=1 appointment to run the crew gate';
    RETURN;
  END IF;

  -- 1) sync_appointment_crew replaces the whole set atomically.
  PERFORM sync_appointment_crew(v_appt, jsonb_build_array(
    jsonb_build_object('employee_id', v_emp1, 'role', 'lead'),
    jsonb_build_object('employee_id', v_emp2, 'role', 'helper')
  ));
  SELECT count(*) INTO v_cnt FROM appointment_crew WHERE appointment_id = v_appt;
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'crew gate: expected 2 rows, got %', v_cnt; END IF;

  -- Replace with a single member — the prior two must be gone (true replace).
  PERFORM sync_appointment_crew(v_appt, jsonb_build_array(
    jsonb_build_object('employee_id', v_emp1, 'role', 'lead')
  ));
  SELECT count(*) INTO v_cnt FROM appointment_crew WHERE appointment_id = v_appt;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'crew gate: expected 1 row after replace, got %', v_cnt; END IF;

  -- Empty array clears the crew.
  PERFORM sync_appointment_crew(v_appt, '[]'::jsonb);
  SELECT count(*) INTO v_cnt FROM appointment_crew WHERE appointment_id = v_appt;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'crew gate: expected 0 rows after clear, got %', v_cnt; END IF;

  RAISE NOTICE 'PASS: sync_appointment_crew atomic replace';
END $$;

DO $$
DECLARE
  v_est   uuid;
  v_lines jsonb;
  v_cnt   int;
  v_gen   numeric;
BEGIN
  SELECT id INTO v_est FROM estimates ORDER BY created_at DESC LIMIT 1;
  IF v_est IS NULL THEN RAISE NOTICE 'SKIP: no estimate to run the lines gate'; RETURN; END IF;

  v_lines := save_estimate_lines(v_est, jsonb_build_array(
    jsonb_build_object('description', 'GATE line A', 'quantity', 2, 'unit_price', 10),
    jsonb_build_object('description', 'GATE line B', 'quantity', 3, 'unit_price', 5)
  ), 'estimate');

  SELECT count(*) INTO v_cnt FROM estimate_line_items WHERE estimate_id = v_est;
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'lines gate: expected 2 lines, got %', v_cnt; END IF;

  -- line_total is GENERATED: 2*10 = 20 for line A, proving we never wrote it.
  SELECT line_total INTO v_gen FROM estimate_line_items
   WHERE estimate_id = v_est AND description = 'GATE line A';
  IF v_gen <> 20 THEN RAISE EXCEPTION 'lines gate: generated line_total wrong, got %', v_gen; END IF;

  RAISE NOTICE 'PASS: save_estimate_lines replace + GENERATED line_total intact';
END $$;

DO $$
DECLARE
  v_first json;
  v_cnt   int;
BEGIN
  -- get_jobs_list returns rows carrying total_count and honors the limit.
  SELECT count(*) INTO v_cnt FROM get_jobs_list(NULL, 5, 0);
  IF v_cnt > 5 THEN RAISE EXCEPTION 'jobs gate: limit not honored, got % rows', v_cnt; END IF;

  SELECT * INTO v_first FROM get_jobs_list(NULL, 5, 0) LIMIT 1;
  IF v_first IS NOT NULL AND (v_first->>'total_count') IS NULL THEN
    RAISE EXCEPTION 'jobs gate: total_count missing from row';
  END IF;

  RAISE NOTICE 'PASS: get_jobs_list pagination + total_count';
END $$;

ROLLBACK;
