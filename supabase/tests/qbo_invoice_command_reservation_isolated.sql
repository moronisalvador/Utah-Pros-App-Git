-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: qbo_invoice_command_reservation_isolated.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Disposable-local behavioral proof for 20260810020000_qbo_invoice_command_reservation.
-- The paired qualifier supplies the isolated database guard and separately
-- exercises the two real-session lock races that cannot be proved in one SQL
-- transaction. This proof never contacts a hosted database or QuickBooks.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing QBO reservation proof: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

INSERT INTO public.jobs (id) VALUES ('c2000000-0000-4000-8000-000000000001');
INSERT INTO public.invoices (id, job_id, invoice_number, status, invoice_type, total) VALUES
 ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-1','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-2','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-3','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-4','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-5','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000006','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-6','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000007','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-7','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000008','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-8','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000009','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-9','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000010','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-10','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000011','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-11','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000012','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-12','saved','standard',0),
 ('c3000000-0000-4000-8000-000000000013','c2000000-0000-4000-8000-000000000001','ZZ-QBO-RES-13','saved','standard',0);
INSERT INTO public.invoice_line_items (id, invoice_id, description, quantity, unit_price)
VALUES ('c5000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000009', 'ZZ original', 1, 10),
       ('c5000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010', 'ZZ desktop', 1, 10),
       ('c5000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000011', 'ZZ reject original', 1, 11),
       ('c5000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000012', 'ZZ ambiguous original', 1, 12),
       ('c5000000-0000-4000-8000-000000000005', 'c3000000-0000-4000-8000-000000000013', 'ZZ mismatch original', 1, 13);
INSERT INTO public.employees (id, auth_user_id, full_name, email, role, is_active, is_external)
VALUES ('c8000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'ZZ reservation admin', 'zz-reservation-admin@example.invalid', 'admin', true, false);

CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
END;
$$;

-- ACL proof must use the real API roles rather than postgres' bypass privileges.
DO $acl$
BEGIN
  IF has_function_privilege('anon', 'public.reserve_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reserve_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.reserve_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reservation RPC grants are not service-only';
  END IF;
  IF has_table_privilege('anon', 'public.qbo_invoice_command_reservations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.qbo_invoice_command_reservations', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.qbo_invoice_command_reservations', 'SELECT') THEN
    RAISE EXCEPTION 'reservation table grants are not service-only';
  END IF;
  IF has_function_privilege('anon', 'public.invoice_line_qbo_write_access(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.invoice_line_qbo_write_access(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'line policy helper grants are not authenticated-only';
  END IF;
END;
$acl$;

-- ACL inspection alone can miss an inherited/default privilege. Exercise the
-- actual function call under both browser-exposed roles and require PostgreSQL
-- to reject it before the SECURITY DEFINER body can reserve anything.
SET LOCAL ROLE anon;
DO $anon_denied$
BEGIN
  BEGIN
    PERFORM public.reserve_qbo_invoice_command(
      'c4000000-0000-4000-8000-0000000000a1',
      'c3000000-0000-4000-8000-000000000001',
      'save', 'c9000000-0000-4000-8000-000000000001', NULL, 'browser', 'realm-a'
    );
    RAISE EXCEPTION 'anon executed reservation RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denied$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated_denied$
BEGIN
  BEGIN
    PERFORM public.reserve_qbo_invoice_command(
      'c4000000-0000-4000-8000-0000000000a2',
      'c3000000-0000-4000-8000-000000000001',
      'save', 'c9000000-0000-4000-8000-000000000001', NULL, 'browser', 'realm-a'
    );
    RAISE EXCEPTION 'authenticated executed reservation RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_denied$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();

DO $reserve$
DECLARE
  inv1 uuid := 'c3000000-0000-4000-8000-000000000001';
  cmd1 uuid := 'c4000000-0000-4000-8000-000000000001';
  actor uuid := 'c9000000-0000-4000-8000-000000000001';
  result jsonb;
BEGIN
  SELECT public.reserve_qbo_invoice_command(cmd1, inv1, 'save', actor, NULL, 'browser', 'realm-a') INTO result;
  IF result->>'ok' <> 'true' OR result->>'reserved' <> 'true' THEN RAISE EXCEPTION 'service reserve failed: %', result; END IF;
  SELECT public.reserve_qbo_invoice_command(cmd1, inv1, 'save', actor, NULL, 'browser', 'realm-a') INTO result;
  IF result->>'ok' <> 'true' OR result->>'replay' <> 'true' THEN RAISE EXCEPTION 'exact replay failed: %', result; END IF;
  -- The UUID alone is insufficient: each immutable identity field must bind it.
  FOR result IN SELECT public.reserve_qbo_invoice_command(cmd1, inv1, a, au, ae, i, r)
    FROM (VALUES
      ('send'::text,actor,NULL::uuid,'browser'::text,'realm-a'::text),
      ('save'::text,'c9000000-0000-4000-8000-000000000002'::uuid,NULL::uuid,'browser'::text,'realm-a'::text),
      ('save'::text,actor,'c8000000-0000-4000-8000-000000000001'::uuid,'browser'::text,'realm-a'::text),
      ('save'::text,actor,NULL::uuid,'webhook'::text,'realm-a'::text),
      ('save'::text,actor,NULL::uuid,'browser'::text,'realm-b'::text)
    ) AS changed(a,au,ae,i,r)
  LOOP
    IF result->>'ok' = 'true' THEN RAISE EXCEPTION 'identity mismatch replay succeeded: %', result; END IF;
  END LOOP;
  SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000002', inv1, 'save', actor, NULL, 'browser', 'realm-a') INTO result;
  IF result->>'reason' <> 'active-command-conflict' THEN RAISE EXCEPTION 'different command did not conflict: %', result; END IF;
  UPDATE public.invoices SET locked = true WHERE id = 'c3000000-0000-4000-8000-000000000002';
  SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000002', 'save', actor, NULL, 'browser', 'realm-a') INTO result;
  IF result->>'reason' <> 'invoice-locked' THEN RAISE EXCEPTION 'locked invoice reserved: %', result; END IF;
END;
$reserve$;

-- Staging freezes the exact preimage and requested patch without mutating local
-- data. Finalization refuses pre-provider use, then applies only after the
-- command records provider_succeeded. Exact crash replay is a no-op.
DO $staged_line$
DECLARE
  inv uuid := 'c3000000-0000-4000-8000-000000000009';
  cmd uuid := 'c4000000-0000-4000-8000-000000000012';
  line_id uuid := 'c5000000-0000-4000-8000-000000000001';
  actor uuid := 'c9000000-0000-4000-8000-000000000001';
  result jsonb; frozen jsonb; intent jsonb; h text := repeat('f', 64); current_description text;
BEGIN
  SELECT public.reserve_qbo_invoice_command(cmd, inv, 'save', actor, NULL, 'browser', 'realm-a') INTO result;
  IF result->>'reserved' <> 'true' THEN RAISE EXCEPTION 'line command did not reserve: %', result; END IF;
  SELECT public.stage_qbo_invoice_line_update(cmd, inv, line_id, actor, NULL, 'browser', 'realm-a',
    'ZZ updated', 'item-1', 'Labor', NULL, NULL, -2, 4.5) INTO result;
  IF result->>'ok' <> 'true' OR result->'line_update'->'preimage'->>'description' <> 'ZZ original'
     OR result->'line_update'->'patch'->>'description' <> 'ZZ updated' THEN
    RAISE EXCEPTION 'line stage did not freeze source and patch: %', result;
  END IF;
  frozen := result->'line_update';
  SELECT description INTO current_description FROM public.invoice_line_items WHERE id = line_id;
  IF current_description <> 'ZZ original' THEN RAISE EXCEPTION 'staging mutated the local line'; END IF;
  intent := jsonb_build_object('action','save','primary_payload','{}'::jsonb,'line_update',frozen);
  SELECT public.prepare_qbo_invoice_command(cmd, inv, 'save', actor, NULL, 'browser', 'realm-a', NULL, NULL, h, intent) INTO result;
  IF result->>'prepared' <> 'true' THEN RAISE EXCEPTION 'line command did not prepare: %', result; END IF;
  SELECT public.finalize_qbo_invoice_line_update(cmd, inv, line_id, actor, NULL, 'browser', 'realm-a',
    'ZZ updated', 'item-1', 'Labor', NULL, NULL, -2, 4.5) INTO result;
  IF result->>'reason' <> 'provider-not-succeeded' THEN RAISE EXCEPTION 'pre-provider finalization was accepted: %', result; END IF;
  SELECT description INTO current_description FROM public.invoice_line_items WHERE id = line_id;
  IF current_description <> 'ZZ original' THEN RAISE EXCEPTION 'pre-provider finalization mutated the local line'; END IF;
  SELECT public.start_qbo_invoice_command_attempt(cmd, 'invoice', 'create', NULL, 'request-line', '{}'::jsonb, h) INTO result;
  IF result->>'started' <> 'true' THEN RAISE EXCEPTION 'line provider attempt did not start: %', result; END IF;
  SELECT public.set_qbo_invoice_command_state(cmd, 'provider_succeeded', '{"qbo_invoice_id":"qbo-line"}', NULL, NULL, NULL, NULL) INTO result;
  IF result->>'status' <> 'provider_succeeded' THEN RAISE EXCEPTION 'provider success was not recorded: %', result; END IF;
  SELECT public.finalize_qbo_invoice_line_update(cmd, inv, line_id, actor, NULL, 'browser', 'realm-a',
    'ZZ updated', 'item-1', 'Labor', NULL, NULL, -2, 4.5) INTO result;
  IF result->>'ok' <> 'true' OR result->>'applied' <> 'true' THEN RAISE EXCEPTION 'post-provider finalization failed: %', result; END IF;
  SELECT description INTO current_description FROM public.invoice_line_items WHERE id = line_id;
  IF current_description <> 'ZZ updated' THEN RAISE EXCEPTION 'post-provider finalization did not persist source patch'; END IF;
  SELECT public.finalize_qbo_invoice_line_update(cmd, inv, line_id, actor, NULL, 'browser', 'realm-a',
    'ZZ updated', 'item-1', 'Labor', NULL, NULL, -2, 4.5) INTO result;
  IF result->>'ok' <> 'true' OR result->>'applied' <> 'false' THEN RAISE EXCEPTION 'exact finalizer replay was not a no-op: %', result; END IF;
  SELECT public.finalize_qbo_invoice_line_update(cmd, inv, line_id, actor, NULL, 'browser', 'realm-a',
    'ZZ conflicting', 'item-1', 'Labor', NULL, NULL, -2, 4.5) INTO result;
  IF result->>'reason' <> 'patch-conflict' THEN RAISE EXCEPTION 'changed same-key line patch mutated command: %', result; END IF;
  SELECT description INTO current_description FROM public.invoice_line_items WHERE id = line_id;
  IF current_description <> 'ZZ updated' THEN RAISE EXCEPTION 'changed same-key line patch mutated stored line'; END IF;
  SELECT public.set_qbo_invoice_command_state(cmd, 'succeeded', NULL, 200, '{"ok":true}', NULL, NULL) INTO result;
  IF EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id=cmd) THEN RAISE EXCEPTION 'terminal line success retained reservation'; END IF;
END;
$staged_line$;

-- A deterministic provider rejection releases the reservation with no line
-- mutation; an ambiguous result retains both command and reservation unchanged.
DO $line_failures$
DECLARE
  actor uuid := 'c9000000-0000-4000-8000-000000000001'; result jsonb; frozen jsonb;
  intent jsonb; h text := repeat('e',64); current_description text;
  inv uuid; cmd uuid; line_id uuid;
BEGIN
  inv := 'c3000000-0000-4000-8000-000000000011'; cmd := 'c4000000-0000-4000-8000-000000000013'; line_id := 'c5000000-0000-4000-8000-000000000003';
  SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm-a') INTO result;
  SELECT public.stage_qbo_invoice_line_update(cmd,inv,line_id,actor,NULL,'browser','realm-a','ZZ rejected patch',NULL,NULL,NULL,NULL,2,11) INTO result;
  frozen := result->'line_update'; intent := jsonb_build_object('action','save','primary_payload','{}'::jsonb,'line_update',frozen);
  SELECT public.prepare_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm-a',NULL,NULL,h,intent) INTO result;
  SELECT public.start_qbo_invoice_command_attempt(cmd,'invoice','create',NULL,'request-reject','{}',h) INTO result;
  SELECT public.set_qbo_invoice_command_state(cmd,'rejected',NULL,400,'{"error":"rejected"}','rejected',NULL) INTO result;
  SELECT description INTO current_description FROM public.invoice_line_items WHERE id=line_id;
  IF current_description <> 'ZZ reject original' OR EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id=cmd) THEN
    RAISE EXCEPTION 'deterministic rejection changed line or retained reservation';
  END IF;

  inv := 'c3000000-0000-4000-8000-000000000012'; cmd := 'c4000000-0000-4000-8000-000000000014'; line_id := 'c5000000-0000-4000-8000-000000000004';
  SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm-a') INTO result;
  SELECT public.stage_qbo_invoice_line_update(cmd,inv,line_id,actor,NULL,'browser','realm-a','ZZ ambiguous patch',NULL,NULL,NULL,NULL,2,12) INTO result;
  frozen := result->'line_update'; intent := jsonb_build_object('action','save','primary_payload','{}'::jsonb,'line_update',frozen);
  SELECT public.prepare_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm-a',NULL,NULL,h,intent) INTO result;
  SELECT public.start_qbo_invoice_command_attempt(cmd,'invoice','create',NULL,'request-ambiguous','{}',h) INTO result;
  SELECT public.set_qbo_invoice_command_state(cmd,'ambiguous',NULL,500,'{"retry_same_request":true}','timeout',NULL) INTO result;
  SELECT description INTO current_description FROM public.invoice_line_items WHERE id=line_id;
  IF current_description <> 'ZZ ambiguous original' OR NOT EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id=cmd) THEN
    RAISE EXCEPTION 'ambiguous outcome changed line or released reservation';
  END IF;
END;
$line_failures$;

-- A third local state after provider success cannot be overwritten. The caller
-- can record needs_reconciliation while the reservation remains a hard fence.
DO $line_mismatch$
DECLARE
  inv uuid := 'c3000000-0000-4000-8000-000000000013'; cmd uuid := 'c4000000-0000-4000-8000-000000000015';
  line_id uuid := 'c5000000-0000-4000-8000-000000000005'; actor uuid := 'c9000000-0000-4000-8000-000000000001';
  result jsonb; frozen jsonb; intent jsonb; h text := repeat('9',64); current_description text;
BEGIN
  SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm-a') INTO result;
  SELECT public.stage_qbo_invoice_line_update(cmd,inv,line_id,actor,NULL,'browser','realm-a','ZZ requested patch',NULL,NULL,NULL,NULL,2,13) INTO result;
  frozen := result->'line_update'; intent := jsonb_build_object('action','save','primary_payload','{}'::jsonb,'line_update',frozen);
  SELECT public.prepare_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm-a',NULL,NULL,h,intent) INTO result;
  SELECT public.start_qbo_invoice_command_attempt(cmd,'invoice','create',NULL,'request-mismatch','{}',h) INTO result;
  SELECT public.set_qbo_invoice_command_state(cmd,'provider_succeeded','{"qbo_invoice_id":"qbo-mismatch"}',NULL,NULL,NULL,NULL) INTO result;
  UPDATE public.invoice_line_items SET description='ZZ third state' WHERE id=line_id;
  SELECT public.finalize_qbo_invoice_line_update(cmd,inv,line_id,actor,NULL,'browser','realm-a','ZZ requested patch',NULL,NULL,NULL,NULL,2,13) INTO result;
  IF result->>'reason' <> 'source-mismatch' THEN RAISE EXCEPTION 'third state was not fenced: %', result; END IF;
  SELECT description INTO current_description FROM public.invoice_line_items WHERE id=line_id;
  IF current_description <> 'ZZ third state' THEN RAISE EXCEPTION 'finalizer overwrote third local state'; END IF;
  SELECT public.set_qbo_invoice_command_state(cmd,'needs_reconciliation',NULL,409,'{"error":"source mismatch"}','source mismatch',NULL) INTO result;
  IF result->>'status' <> 'needs_reconciliation' OR NOT EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id=cmd) THEN
    RAISE EXCEPTION 'line mismatch did not retain reconciliation fence: %', result;
  END IF;
END;
$line_mismatch$;

-- Migration-first rolling deploy: old Workers can create the exact fence at
-- prepare only while no active command exists; provider-state RPCs stay strict.
DO $attempts$
DECLARE
  inv uuid := 'c3000000-0000-4000-8000-000000000003'; cmd uuid := 'c4000000-0000-4000-8000-000000000004';
  actor uuid := 'c9000000-0000-4000-8000-000000000001'; result jsonb;
  h text := repeat('a', 64);
BEGIN
  SELECT public.prepare_qbo_invoice_command(cmd, inv, 'save', actor, NULL, 'browser', 'realm-a', NULL, NULL, h, '{}'::jsonb) INTO result;
  IF result->>'prepared' <> 'true' OR NOT EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE invoice_id=inv AND command_id=cmd) THEN RAISE EXCEPTION 'old-worker prepare did not create exact fence: %', result; END IF;
  SELECT public.prepare_qbo_invoice_command('c4000000-0000-4000-8000-000000000011', inv, 'save', actor, NULL, 'browser', 'realm-a', NULL, NULL, h, '{}'::jsonb) INTO result;
  IF result->>'reason' <> 'active-command-conflict' THEN RAISE EXCEPTION 'prepare bypassed other active command: %', result; END IF;
  SELECT public.start_qbo_invoice_command_attempt(cmd, 'invoice', 'create', NULL, 'request-a', '{}'::jsonb, h) INTO result;
  IF result->>'started' <> 'true' THEN RAISE EXCEPTION 'start with exact fence failed: %', result; END IF;
  -- Simulate a stale/corrupt fence and prove both provider-state RPCs fail closed.
  DELETE FROM public.qbo_invoice_command_reservations WHERE invoice_id = inv;
  SELECT public.advance_qbo_invoice_command_attempt(cmd, 'invoice', 'invoice-send', 'send', 'qbo-1', 'request-b', '{}'::jsonb, h) INTO result;
  IF result->>'reason' <> 'reservation-mismatch' THEN RAISE EXCEPTION 'advance accepted missing reservation: %', result; END IF;
  SELECT public.start_qbo_invoice_command_attempt(cmd, 'invoice', 'create', NULL, 'request-a', '{}'::jsonb, h) INTO result;
  IF result->>'reason' <> 'reservation-mismatch' THEN RAISE EXCEPTION 'start accepted missing reservation: %', result; END IF;
END;
$attempts$;

-- Pre-command release is allowed; any non-terminal ledger entry keeps the fence.
DO $release$
DECLARE actor uuid := 'c9000000-0000-4000-8000-000000000001'; result jsonb; h text := repeat('b',64);
BEGIN
  SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000004','save',actor,NULL,'browser','realm-a') INTO result;
  SELECT public.release_qbo_invoice_command_reservation('c4000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000004') INTO result;
  IF result->>'released' <> 'true' THEN RAISE EXCEPTION 'pre-command release failed: %', result; END IF;
  SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000006','c3000000-0000-4000-8000-000000000005','save',actor,NULL,'browser','realm-a') INTO result;
  SELECT public.prepare_qbo_invoice_command('c4000000-0000-4000-8000-000000000006','c3000000-0000-4000-8000-000000000005','save',actor,NULL,'browser','realm-a',NULL,NULL,h,'{}') INTO result;
  SELECT public.release_qbo_invoice_command_reservation('c4000000-0000-4000-8000-000000000006','c3000000-0000-4000-8000-000000000005') INTO result;
  IF result->>'reason' <> 'command-not-terminal' THEN RAISE EXCEPTION 'prepared command was released: %', result; END IF;
  -- Terminal set-state automatically removes the matching reservation.
  SELECT public.set_qbo_invoice_command_state('c4000000-0000-4000-8000-000000000006','rejected',NULL,NULL,NULL,'local rejection',NULL) INTO result;
  IF result->>'ok' <> 'true' OR EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id='c4000000-0000-4000-8000-000000000006') THEN RAISE EXCEPTION 'rejected state retained reservation: %', result; END IF;
END;
$release$;

-- Ambiguous/provider states and needs-reconciliation intentionally have no TTL.
DO $states$
DECLARE actor uuid := 'c9000000-0000-4000-8000-000000000001'; result jsonb; h text := repeat('c',64);
  cmd uuid := 'c4000000-0000-4000-8000-000000000007'; inv uuid := 'c3000000-0000-4000-8000-000000000006';
BEGIN
  SELECT public.reserve_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm-a') INTO result;
  SELECT public.prepare_qbo_invoice_command(cmd,inv,'save',actor,NULL,'browser','realm-a',NULL,NULL,h,'{}') INTO result;
  SELECT public.start_qbo_invoice_command_attempt(cmd,'invoice','create',NULL,'request-c','{}',h) INTO result;
  SELECT public.set_qbo_invoice_command_state(cmd,'ambiguous',NULL,NULL,NULL,'timeout',NULL) INTO result;
  IF NOT EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id=cmd) THEN RAISE EXCEPTION 'ambiguous state released reservation'; END IF;
  SELECT public.set_qbo_invoice_command_state(cmd,'needs_reconciliation',NULL,NULL,NULL,'human review',NULL) INTO result;
  IF NOT EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id=cmd) THEN RAISE EXCEPTION 'needs-reconciliation released reservation'; END IF;
  SELECT public.set_qbo_invoice_command_state(cmd,'rejected',NULL,NULL,NULL,'rejected',NULL) INTO result;
  IF EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id=cmd) THEN RAISE EXCEPTION 'terminal rejected did not release reservation'; END IF;
END;
$states$;

-- Legacy active commands, even without a new reservation, block manual locking.
DO $legacy$
DECLARE result jsonb; h text := repeat('d',64); actor uuid := 'c9000000-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO public.qbo_invoice_commands (id,invoice_id,action,actor_auth_user_id,initiator,realm_id,intent_hash,intent_payload)
  VALUES ('c4000000-0000-4000-8000-000000000008','c3000000-0000-4000-8000-000000000007','save',actor,'browser','realm-a',h,'{}');
  -- Rolling deploy: a matching pre-migration active ledger command obtains its
  -- missing fence; a different command cannot usurp it.
  SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000008','c3000000-0000-4000-8000-000000000007','save',actor,NULL,'browser','realm-a') INTO result;
  IF result->>'ok' <> 'true' OR result->>'reserved' <> 'true' THEN RAISE EXCEPTION 'legacy command did not gain matching reservation: %', result; END IF;
  SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000009','c3000000-0000-4000-8000-000000000007','save',actor,NULL,'browser','realm-a') INTO result;
  IF result->>'reason' <> 'active-command-conflict' THEN RAISE EXCEPTION 'different command bypassed legacy active command: %', result; END IF;
  BEGIN
    UPDATE public.invoices SET locked=true WHERE id='c3000000-0000-4000-8000-000000000007';
    RAISE EXCEPTION 'legacy active command allowed manual lock';
  EXCEPTION WHEN sqlstate '55000' THEN NULL;
  END;
  -- A terminal success also deletes its reservation, unlike ambiguous states.
  SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000010','c3000000-0000-4000-8000-000000000008','save',actor,NULL,'browser','realm-a') INTO result;
  SELECT public.prepare_qbo_invoice_command('c4000000-0000-4000-8000-000000000010','c3000000-0000-4000-8000-000000000008','save',actor,NULL,'browser','realm-a',NULL,NULL,h,'{}') INTO result;
  SELECT public.set_qbo_invoice_command_state('c4000000-0000-4000-8000-000000000010','succeeded',NULL,200,'{}',NULL,NULL) INTO result;
  IF result->>'ok' <> 'true' OR EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id='c4000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'terminal succeeded retained reservation: %', result; END IF;
  UPDATE public.invoices SET locked=true WHERE id='c3000000-0000-4000-8000-000000000008';
  SELECT public.cas_qbo_invoice_link('c3000000-0000-4000-8000-000000000008',NULL,'qbo-after-lock') INTO result;
  IF result->>'reason' <> 'invoice-locked' THEN RAISE EXCEPTION 'CAS wrote locked invoice: %', result; END IF;
END;
$legacy$;

RESET ROLE;
-- A desktop billing editor can still update an ordinary unlocked draft, but
-- direct PostgREST writes return no rows once the same invoice has an active
-- QBO reservation. This proves the policy is not merely source text.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
DO $desktop_rls$
DECLARE updated_rows integer;
BEGIN
  UPDATE public.invoice_line_items SET description = 'ZZ desktop allowed'
  WHERE id = 'c5000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 1 THEN RAISE EXCEPTION 'desktop draft update was not allowed'; END IF;
  UPDATE public.invoice_line_items SET description = 'ZZ reservation bypass'
  WHERE id = 'c5000000-0000-4000-8000-000000000004';
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 0 THEN RAISE EXCEPTION 'direct line write bypassed active QBO reservation'; END IF;
END;
$desktop_rls$;

RESET ROLE;
ROLLBACK;
DO $done$ BEGIN RAISE NOTICE 'QBO invoice command reservation isolated proof passed'; END; $done$;
