-- Disposable-local behavioral proof for 20260810182847. Run only by its local
-- qualifier after the existing 10000/20000 invoice command migrations.
\set ON_ERROR_STOP on
DO $guard$ BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'isolated database guard missing'; END IF;
END $guard$;

BEGIN;
INSERT INTO public.jobs(id) VALUES
 ('d2000000-0000-4000-8000-000000000001'),
 ('d2000000-0000-4000-8000-000000000002');
INSERT INTO public.employees(id,auth_user_id,full_name,email,role,is_active,is_external) VALUES
 ('d8000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000011','ZZ document admin','zz-doc-admin@example.invalid','admin',true,false),
 ('d8000000-0000-4000-8000-000000000002','d9000000-0000-4000-8000-000000000012','ZZ spoof target','zz-doc-spoof@example.invalid','admin',true,false);
INSERT INTO public.invoices(id,job_id,invoice_number,status,invoice_type,total) VALUES
 ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','ZZ-DOC-1','saved','standard',0),
 ('d3000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','ZZ-DOC-2','saved','standard',0),
 ('d3000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001','ZZ-DOC-3','saved','standard',0),
 ('d3000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000001','ZZ-DOC-4','saved','standard',0);
INSERT INTO public.invoice_line_items(id,invoice_id,description,quantity,unit_price,sort_order) VALUES
 ('d5000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002','ZZ update old',1,10,0),
 ('d5000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000003','ZZ delete old',1,20,0),
 ('d5000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000004','ZZ reorder one',1,3,0),
 ('d5000000-0000-4000-8000-000000000004','d3000000-0000-4000-8000-000000000004','ZZ reorder two',1,4,1);
CREATE FUNCTION pg_temp.service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true); END $$;

DO $acl$ BEGIN
  IF has_function_privilege('anon','public.stage_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.finalize_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.stage_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'generic line command grants are not service-only'; END IF;
END $acl$;
SET LOCAL ROLE service_role;
-- Claimless service-role SQL cannot bypass a SECURITY DEFINER auth gate.
DO $claimless$ BEGIN
  BEGIN
    PERFORM public.stage_qbo_invoice_line_change('d4000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001',NULL,'browser','realm','{"kind":"create","patch":{"description":"ZZ","quantity":1,"unit_price":1}}');
    RAISE EXCEPTION 'claimless service role bypassed guard';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $claimless$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
DO $attribution$ DECLARE created public.invoices; BEGIN
  SELECT * INTO created FROM public.create_invoice_for_job('d2000000-0000-4000-8000-000000000002','d8000000-0000-4000-8000-000000000002');
  IF created.created_by IS DISTINCT FROM 'd8000000-0000-4000-8000-000000000001'::uuid THEN RAISE EXCEPTION 'authenticated caller spoofed invoice created_by: %',created.created_by; END IF;
END $attribution$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.service();

DO $sort_bound$ DECLARE r jsonb; cmd uuid := 'd4000000-0000-4000-8000-000000000010'; inv uuid := 'd3000000-0000-4000-8000-000000000001'; actor uuid := 'd9000000-0000-4000-8000-000000000001'; change jsonb := '{"kind":"create","patch":{"description":"ZZ bound","quantity":1,"unit_price":1},"sort_order":2147483648}'; BEGIN
  SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm') INTO r;
  SELECT public.stage_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r;
  IF r->>'reason' <> 'invalid-sort-order' THEN RAISE EXCEPTION 'out-of-range sort order did not fail closed: %',r; END IF;
  SELECT public.release_qbo_invoice_command_reservation(cmd,inv) INTO r;
  IF r->>'released'<>'true' OR EXISTS(SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id=cmd) THEN RAISE EXCEPTION 'invalid sort order stranded reservation: %',r; END IF;
END $sort_bound$;

-- Helper exercises staging/preimage, provider barrier, finalization and exact
-- replay without calling a provider. The command ledger is the simulated QBO
-- success evidence, never an ambient client-side mutation.
DO $create$ DECLARE r jsonb; frozen jsonb; cmd uuid := 'd4000000-0000-4000-8000-000000000011'; inv uuid := 'd3000000-0000-4000-8000-000000000001'; actor uuid := 'd9000000-0000-4000-8000-000000000001'; change jsonb := '{"kind":"create","patch":{"description":"ZZ create","qbo_item_id":"item","qbo_item_name":"Item","qbo_class_id":null,"qbo_class_name":null,"quantity":2,"unit_price":12.5}}'; BEGIN
  SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm') INTO r;
  SELECT public.stage_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; IF r->>'ok'<>'true' OR r->'line_change'->>'line_id' IS NULL THEN RAISE EXCEPTION 'create did not freeze generated id: %',r; END IF; frozen:=r->'line_change';
  SELECT public.prepare_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm',NULL,NULL,repeat('a',64),jsonb_build_object('action','save','primary_payload','{}'::jsonb,'line_change',frozen)) INTO r;
  SELECT public.finalize_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; IF r->>'reason'<>'change-conflict' THEN RAISE EXCEPTION 'pre-provider create finalized: %',r; END IF;
  SELECT public.start_qbo_invoice_command_attempt(cmd,'primary','create',NULL,'doc-create','{}',repeat('a',64)) INTO r; SELECT public.set_qbo_invoice_command_state(cmd,'provider_succeeded','{}',NULL,NULL,NULL,NULL) INTO r;
  SELECT public.finalize_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; IF r->>'applied'<>'true' THEN RAISE EXCEPTION 'create did not apply: %',r; END IF;
  SELECT public.finalize_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; IF r->>'applied'<>'false' THEN RAISE EXCEPTION 'create exact replay was not no-op: %',r; END IF;
  IF (SELECT total FROM public.invoices WHERE id=inv) <> 25 THEN RAISE EXCEPTION 'generated totals not trigger-owned'; END IF;
END $create$;

-- Update, delete and reorder each freeze source, reject a third state, and
-- execute only after the command has a provider_succeeded state.
DO $operations$ DECLARE r jsonb; frozen jsonb; actor uuid := 'd9000000-0000-4000-8000-000000000001'; cmd uuid; inv uuid; change jsonb; BEGIN
  cmd:='d4000000-0000-4000-8000-000000000012'; inv:='d3000000-0000-4000-8000-000000000002'; change:='{"kind":"update","line_id":"d5000000-0000-4000-8000-000000000001","patch":{"description":"ZZ update new","qbo_item_id":null,"qbo_item_name":null,"qbo_class_id":null,"qbo_class_name":null,"quantity":2,"unit_price":10}}';
  SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm') INTO r; SELECT public.stage_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; frozen:=r->'line_change'; SELECT public.prepare_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm',NULL,NULL,repeat('b',64),jsonb_build_object('action','save','primary_payload','{}'::jsonb,'line_change',frozen)) INTO r; SELECT public.start_qbo_invoice_command_attempt(cmd,'primary','create',NULL,'doc-update','{}',repeat('b',64)) INTO r; SELECT public.set_qbo_invoice_command_state(cmd,'provider_succeeded','{}',NULL,NULL,NULL,NULL) INTO r; UPDATE public.invoice_line_items SET description='ZZ third state' WHERE id='d5000000-0000-4000-8000-000000000001'; SELECT public.finalize_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; IF r->>'reason'<>'source-mismatch' THEN RAISE EXCEPTION 'third update state was overwritten: %',r; END IF;
  cmd:='d4000000-0000-4000-8000-000000000013'; inv:='d3000000-0000-4000-8000-000000000003'; change:='{"kind":"delete","line_id":"d5000000-0000-4000-8000-000000000002"}'; SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm') INTO r; SELECT public.stage_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; frozen:=r->'line_change'; SELECT public.prepare_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm',NULL,NULL,repeat('c',64),jsonb_build_object('action','save','primary_payload','{}'::jsonb,'line_change',frozen)) INTO r; SELECT public.start_qbo_invoice_command_attempt(cmd,'primary','create',NULL,'doc-delete','{}',repeat('c',64)) INTO r; SELECT public.set_qbo_invoice_command_state(cmd,'provider_succeeded','{}',NULL,NULL,NULL,NULL) INTO r; SELECT public.finalize_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; IF r->>'applied'<>'true' OR EXISTS(SELECT 1 FROM public.invoice_line_items WHERE id='d5000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'delete did not apply'; END IF;
  cmd:='d4000000-0000-4000-8000-000000000014'; inv:='d3000000-0000-4000-8000-000000000004'; change:='{"kind":"reorder","ordered_line_ids":["d5000000-0000-4000-8000-000000000004","d5000000-0000-4000-8000-000000000003"]}'; SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm') INTO r; SELECT public.stage_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; frozen:=r->'line_change'; SELECT public.prepare_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm',NULL,NULL,repeat('d',64),jsonb_build_object('action','save','primary_payload','{}'::jsonb,'line_change',frozen)) INTO r; SELECT public.start_qbo_invoice_command_attempt(cmd,'primary','create',NULL,'doc-reorder','{}',repeat('d',64)) INTO r; SELECT public.set_qbo_invoice_command_state(cmd,'provider_succeeded','{}',NULL,NULL,NULL,NULL) INTO r; SELECT public.finalize_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; IF r->>'applied'<>'true' THEN RAISE EXCEPTION 'reorder did not apply: %',r; END IF; SELECT public.finalize_qbo_invoice_line_change(cmd,inv,actor,NULL,'browser','realm',change) INTO r; IF r->>'applied'<>'false' THEN RAISE EXCEPTION 'reorder replay was not no-op: %',r; END IF;
END $operations$;
ROLLBACK;
