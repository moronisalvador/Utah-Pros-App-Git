-- ISOLATED DATABASE ONLY: runtime proof for
-- 20260810182855_estimate_qbo_command_boundary. The local qualifier supplies
-- upr.isolated_test_database=on and this transaction rolls every fixture back.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;
END;
$guard$;

-- When the later durable single-company migration is present, bind this
-- rollback-only proof's synthetic realm before its service RPCs write command
-- ledgers. Standalone qualification of 20260810182855 remains compatible when
-- the binding table does not yet exist.
DO $optional_company_binding$
BEGIN
  IF pg_catalog.to_regclass('public.qbo_company_binding') IS NOT NULL THEN
    INSERT INTO public.qbo_company_binding(singleton, environment, realm_id, generation)
    VALUES (true, 'sandbox', 'realm', 1)
    ON CONFLICT (singleton) DO UPDATE SET
      environment = EXCLUDED.environment,
      realm_id = EXCLUDED.realm_id,
      generation = EXCLUDED.generation,
      updated_at = now();
  END IF;
END;
$optional_company_binding$;

INSERT INTO public.employees(id,auth_user_id,full_name,email,role,is_active,is_external)
VALUES
 ('a8000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001','Estimate proof admin','estimate-proof@example.invalid','admin',true,false),
 ('a8000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000002','Spoof target','spoof-target@example.invalid','office',true,false);
INSERT INTO public.contacts(id,phone,name,email,qbo_customer_id)
VALUES('a7000000-0000-4000-8000-000000000001','+18015550101','Estimate proof customer','customer@example.invalid','qbo-customer-1');
INSERT INTO public.estimates(id,contact_id,estimate_number,estimate_type,status,amount,subtotal,intended_division)
VALUES
 ('a3000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','EST-PROOF','initial','draft',30,30,'water'),
 ('a3000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001','EST-FENCE','initial','draft',10,10,'water');
INSERT INTO public.estimate_line_items(id,estimate_id,description,quantity,unit_price,sort_order)
VALUES
 ('a5000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','First source',1,10,0),
 ('a5000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','Second source',1,20,1),
 ('a5000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000002','Fence source',1,10,0);

CREATE FUNCTION pg_temp.qbo_estimate_document_preimage(p_estimate_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',li.id::text,'description',btrim(COALESCE(li.description,'')),
   'qbo_item_id',li.qbo_item_id,'qbo_item_name',li.qbo_item_name,
   'qbo_class_id',li.qbo_class_id,'qbo_class_name',li.qbo_class_name,
   'quantity',li.quantity,'unit_price',li.unit_price,'sort_order',li.sort_order
 ) ORDER BY li.sort_order ASC NULLS LAST,li.created_at ASC,li.id ASC),'[]'::jsonb)
 FROM public.estimate_line_items li WHERE li.estimate_id=p_estimate_id
$fn$;

CREATE FUNCTION pg_temp.qbo_estimate_provider_source_preimage(p_estimate_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT jsonb_build_object(
   'estimate',jsonb_build_object(
     'id',est_row.id::text,'job_id',est_row.job_id,'contact_id',est_row.contact_id,
     'status',est_row.status,'converted_invoice_id',est_row.converted_invoice_id,
     'qbo_estimate_id',est_row.qbo_estimate_id,'intended_division',est_row.intended_division,
     'estimate_number',est_row.estimate_number,'expiration_date',est_row.expiration_date,
     'property_address',est_row.property_address,'property_city',est_row.property_city,
     'property_state',est_row.property_state,'property_zip',est_row.property_zip),
   'job',CASE WHEN job_row.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
     'id',job_row.id::text,'division',job_row.division,'job_number',job_row.job_number,
     'claim_id',job_row.claim_id,'address',job_row.address,'city',job_row.city,
     'state',job_row.state,'zip',job_row.zip,'date_of_loss',job_row.date_of_loss,
     'primary_contact_id',job_row.primary_contact_id) END,
   'contact',CASE WHEN contact_row.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
     'id',contact_row.id::text,'qbo_customer_id',contact_row.qbo_customer_id,
     'name',contact_row.name,'email',contact_row.email) END,
   'claim',CASE WHEN claim_row.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
     'id',claim_row.id::text,'claim_number',claim_row.claim_number,
     'date_of_loss',claim_row.date_of_loss,'loss_address',claim_row.loss_address,
     'loss_city',claim_row.loss_city,'loss_state',claim_row.loss_state,
     'loss_zip',claim_row.loss_zip) END)
 FROM public.estimates est_row
 LEFT JOIN public.jobs job_row ON job_row.id=est_row.job_id
 LEFT JOIN public.contacts contact_row ON contact_row.id=COALESCE(est_row.contact_id,job_row.primary_contact_id)
 LEFT JOIN public.claims claim_row ON claim_row.id=job_row.claim_id
 WHERE est_row.id=p_estimate_id
$fn$;

-- Browser attribution is derived from auth.uid(), never p_created_by.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $attribution$
DECLARE got uuid;
BEGIN
  SELECT created_by INTO got
    FROM public.create_estimate_for_contact(
      'a7000000-0000-4000-8000-000000000001','water','initial',NULL,NULL,NULL,NULL,
      'a8000000-0000-4000-8000-000000000002');
  IF got IS DISTINCT FROM 'a8000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'browser attribution trusted p_created_by';
  END IF;
END;
$attribution$;
RESET ROLE;

-- Service callers retain the frozen signature and explicit audit attribution.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $service_attribution$
DECLARE got uuid;
BEGIN
  SELECT created_by INTO got
    FROM public.create_estimate_for_contact(
      'a7000000-0000-4000-8000-000000000001','water','initial',NULL,NULL,NULL,NULL,
      'a8000000-0000-4000-8000-000000000002');
  IF got IS DISTINCT FROM 'a8000000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'service attribution contract changed';
  END IF;
END;
$service_attribution$;

-- Claimless service-role SQL must fail the NULL-safe definer check.
DO $claimless$
BEGIN
  PERFORM set_config('request.jwt.claims','{}',true);
  BEGIN
    PERFORM public.reserve_qbo_estimate_command(
      gen_random_uuid(),gen_random_uuid(),'save',gen_random_uuid(),gen_random_uuid(),'browser','realm',repeat('0',64),'{}'::jsonb);
    RAISE EXCEPTION 'claimless estimate reserve unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
END;
$claimless$;

-- A reservation fences direct line, decision/status, and conversion writes for
-- every role, including an accidental direct service-role mutation.
DO $fence$
DECLARE r jsonb; prereq jsonb:='{"kind":"customer_sync","contact_id":"a7000000-0000-4000-8000-000000000001","primary_request_id":"upr-c-proof"}';
BEGIN
  r:=public.reserve_qbo_estimate_command(
    'a4000000-0000-4000-8000-000000000099','a3000000-0000-4000-8000-000000000002','save',
    'a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('9',64),prereq);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fence reserve failed: %',r; END IF;
  r:=public.reserve_qbo_estimate_command(
    'a4000000-0000-4000-8000-000000000099','a3000000-0000-4000-8000-000000000002','save',
    'a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('8',64),prereq);
  IF r->>'reason' IS DISTINCT FROM 'active-command-conflict' THEN
    RAISE EXCEPTION 'same command accepted a changed request hash: %',r;
  END IF;
  BEGIN
    UPDATE public.estimate_line_items SET description='must fail' WHERE id='a5000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'service line write bypassed active estimate reservation';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.estimate_line_items
       SET estimate_id='a3000000-0000-4000-8000-000000000001'
     WHERE id='a5000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'service line reassignment escaped active estimate reservation';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT estimate_id FROM public.estimate_line_items WHERE id='a5000000-0000-4000-8000-000000000003') IS DISTINCT FROM 'a3000000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'failed line reassignment changed the source document';
  END IF;
  BEGIN
    UPDATE public.estimates SET status='approved' WHERE id='a3000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'service decision bypassed active estimate reservation';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.estimates SET property_address='must fail' WHERE id='a3000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'service provider metadata bypassed active estimate reservation';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.estimates SET converted_invoice_id='a1000000-0000-4000-8000-000000000001' WHERE id='a3000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'service conversion bypassed active estimate reservation';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  r:=public.release_qbo_estimate_command_reservation('a4000000-0000-4000-8000-000000000099','a3000000-0000-4000-8000-000000000002');
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fence release failed: %',r; END IF;
END;
$fence$;

-- Create finalization: reserve → prepare → fresh start → provider result → one
-- atomic local projection. A replay after reservation deletion is a no-op.
DO $create_line$
DECLARE
  r jsonb; cmd uuid:='a4000000-0000-4000-8000-000000000001';
  prereq jsonb:='{"kind":"customer_sync","contact_id":"a7000000-0000-4000-8000-000000000001","primary_request_id":"upr-c-proof"}';
  change jsonb:='{"kind":"create","patch":{"description":"Created exact once","qbo_item_id":"item-1","qbo_item_name":"Water","qbo_class_id":"1000000005","qbo_class_name":"Mitigation","quantity":2,"unit_price":12.5}}';
  intent jsonb; created_id uuid; n integer;
BEGIN
  intent:=jsonb_build_object('action','save','provider_action','create','provider_payload','{}'::jsonb,'provider_request_id','upr-e-create-proof','customer_prerequisite',prereq,'provider_source_preimage',pg_temp.qbo_estimate_provider_source_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage',pg_temp.qbo_estimate_document_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage_hash',repeat('9',64),'line_change',change,'line_preimage',NULL);
  r:=public.reserve_qbo_estimate_command(cmd,'a3000000-0000-4000-8000-000000000001','save','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('9',64),prereq);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'create reserve failed: %',r; END IF;
  r:=public.prepare_qbo_estimate_command(cmd,'a3000000-0000-4000-8000-000000000001','save','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('9',64),NULL,NULL,repeat('a',64),intent);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'create prepare failed: %',r; END IF;
  r:=public.start_qbo_estimate_command_attempt(cmd,'primary','create',NULL,'upr-e-create-proof','{}'::jsonb,repeat('b',64));
  IF r->>'started' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'create did not acquire fresh attempt: %',r; END IF;
  r:=public.start_qbo_estimate_command_attempt(cmd,'primary','create',NULL,'upr-e-create-proof','{}'::jsonb,repeat('b',64));
  IF r->>'reason' IS DISTINCT FROM 'attempt-not-fresh' THEN RAISE EXCEPTION 'repeat start acquired provider attempt: %',r; END IF;
  r:=public.set_qbo_estimate_command_state(cmd,'provider_succeeded','{"qbo_estimate_id":"qbo-estimate-1","doc_number":"EST-PROOF","total":55}'::jsonb,NULL,NULL,NULL,NULL);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'create provider result failed: %',r; END IF;
  r:=public.finalize_qbo_estimate_command(cmd,200,'{"ok":true,"mode":"created","qbo_estimate_id":"qbo-estimate-1"}'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'create finalizer failed: %',r; END IF;
  SELECT (local_result->>'line_id')::uuid INTO created_id FROM public.qbo_estimate_commands WHERE id=cmd;
  SELECT count(*) INTO n FROM public.estimate_line_items WHERE id=created_id AND description='Created exact once' AND line_total=25;
  IF n<>1 THEN RAISE EXCEPTION 'create finalizer did not project one generated-total line'; END IF;
  IF (SELECT status FROM public.estimates WHERE id='a3000000-0000-4000-8000-000000000001')<>'submitted' THEN RAISE EXCEPTION 'first save did not submit estimate'; END IF;
  r:=public.finalize_qbo_estimate_command(cmd,200,'{"different":"ignored"}'::jsonb);
  IF r->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'create finalizer replay was not idempotent: %',r; END IF;
  SELECT count(*) INTO n FROM public.estimate_line_items WHERE description='Created exact once' AND estimate_id='a3000000-0000-4000-8000-000000000001';
  IF n<>1 THEN RAISE EXCEPTION 'line finalizer replay inserted a duplicate'; END IF;
  IF (SELECT response_payload FROM public.qbo_estimate_commands WHERE id=cmd) IS DISTINCT FROM '{"ok":true,"mode":"created","qbo_estimate_id":"qbo-estimate-1"}'::jsonb THEN RAISE EXCEPTION 'terminal replay payload changed'; END IF;
END;
$create_line$;

-- Update and reorder compare exact normalized preimages before any projection.
DO $update_and_reorder$
DECLARE
  r jsonb; created_id uuid; preimage jsonb; all_preimage jsonb; ordered jsonb; actual jsonb;
  prereq jsonb:='{"kind":"customer_sync","contact_id":"a7000000-0000-4000-8000-000000000001","primary_request_id":"upr-c-proof"}';
  change jsonb; intent jsonb;
BEGIN
  SELECT (local_result->>'line_id')::uuid INTO created_id FROM public.qbo_estimate_commands WHERE id='a4000000-0000-4000-8000-000000000001';
  SELECT jsonb_build_object('id',li.id::text,'description',btrim(COALESCE(li.description,'')),'qbo_item_id',li.qbo_item_id,'qbo_item_name',li.qbo_item_name,'qbo_class_id',li.qbo_class_id,'qbo_class_name',li.qbo_class_name,'quantity',li.quantity,'unit_price',li.unit_price,'sort_order',li.sort_order) INTO preimage FROM public.estimate_line_items li WHERE li.id=created_id;
  change:=jsonb_build_object('kind','update','line_id',created_id::text,'patch',jsonb_build_object('description','Updated exact once','qbo_item_id','item-2','qbo_item_name','Labor','qbo_class_id',NULL,'qbo_class_name',NULL,'quantity',3,'unit_price',10));
  intent:=jsonb_build_object('action','save','provider_action','update','provider_payload','{}'::jsonb,'provider_request_id','upr-e-update-proof','customer_prerequisite',prereq,'provider_source_preimage',pg_temp.qbo_estimate_provider_source_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage',pg_temp.qbo_estimate_document_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage_hash',repeat('8',64),'line_change',change,'line_preimage',preimage);
  r:=public.reserve_qbo_estimate_command('a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','save','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('8',64),prereq);
  r:=public.prepare_qbo_estimate_command('a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','save','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('8',64),'qbo-estimate-1','qbo-estimate-1',repeat('c',64),intent);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'update prepare failed: %',r; END IF;
  PERFORM public.start_qbo_estimate_command_attempt('a4000000-0000-4000-8000-000000000002','primary','update','qbo-estimate-1','upr-e-update-proof','{}',repeat('d',64));
  PERFORM public.set_qbo_estimate_command_state('a4000000-0000-4000-8000-000000000002','provider_succeeded','{"qbo_estimate_id":"qbo-estimate-1"}',NULL,NULL,NULL,NULL);
  r:=public.finalize_qbo_estimate_command('a4000000-0000-4000-8000-000000000002',200,'{"ok":true,"mode":"updated"}');
  IF r->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM public.estimate_line_items WHERE id=created_id AND description='Updated exact once' AND quantity=3 AND unit_price=10 AND line_total=30) THEN RAISE EXCEPTION 'exact update finalizer failed: %',r; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',li.id::text,'description',btrim(COALESCE(li.description,'')),'qbo_item_id',li.qbo_item_id,'qbo_item_name',li.qbo_item_name,'qbo_class_id',li.qbo_class_id,'qbo_class_name',li.qbo_class_name,'quantity',li.quantity,'unit_price',li.unit_price,'sort_order',li.sort_order) ORDER BY li.sort_order ASC NULLS LAST,li.created_at ASC,li.id ASC),'[]') INTO all_preimage FROM public.estimate_line_items li WHERE li.estimate_id='a3000000-0000-4000-8000-000000000001';
  SELECT jsonb_agg(li.id::text ORDER BY li.sort_order DESC NULLS FIRST,li.created_at DESC,li.id DESC) INTO ordered FROM public.estimate_line_items li WHERE li.estimate_id='a3000000-0000-4000-8000-000000000001';
  change:=jsonb_build_object('kind','reorder','ordered_line_ids',ordered);
  intent:=jsonb_build_object('action','save','provider_action','update','provider_payload','{}'::jsonb,'provider_request_id','upr-e-reorder-proof','customer_prerequisite',prereq,'provider_source_preimage',pg_temp.qbo_estimate_provider_source_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage',all_preimage,'document_line_preimage_hash',repeat('7',64),'line_change',change,'line_preimage',all_preimage);
  PERFORM public.reserve_qbo_estimate_command('a4000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000001','save','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('7',64),prereq);
  r:=public.prepare_qbo_estimate_command('a4000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000001','save','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('7',64),'qbo-estimate-1','qbo-estimate-1',repeat('e',64),intent);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'reorder prepare failed: %',r; END IF;
  PERFORM public.start_qbo_estimate_command_attempt('a4000000-0000-4000-8000-000000000003','primary','update','qbo-estimate-1','upr-e-reorder-proof','{}',repeat('f',64));
  PERFORM public.set_qbo_estimate_command_state('a4000000-0000-4000-8000-000000000003','provider_succeeded','{"qbo_estimate_id":"qbo-estimate-1"}',NULL,NULL,NULL,NULL);
  r:=public.finalize_qbo_estimate_command('a4000000-0000-4000-8000-000000000003',200,'{"ok":true,"mode":"updated"}');
  SELECT jsonb_agg(li.id::text ORDER BY li.sort_order) INTO actual FROM public.estimate_line_items li WHERE li.estimate_id='a3000000-0000-4000-8000-000000000001';
  IF r->>'ok' IS DISTINCT FROM 'true' OR actual IS DISTINCT FROM ordered THEN RAISE EXCEPTION 'exact reorder finalizer failed: % / % / %',r,actual,ordered; END IF;
END;
$update_and_reorder$;

-- Delete a line, send metadata, and unlink all QBO fields through the same
-- service-only finalizer. Every replay remains local-only and exact.
DO $delete_send_unlink$
DECLARE
  r jsonb; created_id uuid; preimage jsonb; prereq jsonb:='{"kind":"customer_sync","contact_id":"a7000000-0000-4000-8000-000000000001","primary_request_id":"upr-c-proof"}'; intent jsonb; change jsonb;
BEGIN
  SELECT (local_result->>'line_id')::uuid INTO created_id FROM public.qbo_estimate_commands WHERE id='a4000000-0000-4000-8000-000000000001';
  SELECT jsonb_build_object('id',li.id::text,'description',btrim(COALESCE(li.description,'')),'qbo_item_id',li.qbo_item_id,'qbo_item_name',li.qbo_item_name,'qbo_class_id',li.qbo_class_id,'qbo_class_name',li.qbo_class_name,'quantity',li.quantity,'unit_price',li.unit_price,'sort_order',li.sort_order) INTO preimage FROM public.estimate_line_items li WHERE li.id=created_id;
  change:=jsonb_build_object('kind','delete','line_id',created_id::text);
  intent:=jsonb_build_object('action','save','provider_action','update','provider_payload','{}'::jsonb,'provider_request_id','upr-e-line-delete-proof','customer_prerequisite',prereq,'provider_source_preimage',pg_temp.qbo_estimate_provider_source_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage',pg_temp.qbo_estimate_document_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage_hash',repeat('6',64),'line_change',change,'line_preimage',preimage);
  PERFORM public.reserve_qbo_estimate_command('a4000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000001','save','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('6',64),prereq);
  PERFORM public.prepare_qbo_estimate_command('a4000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000001','save','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('6',64),'qbo-estimate-1','qbo-estimate-1',repeat('1',64),intent);
  PERFORM public.start_qbo_estimate_command_attempt('a4000000-0000-4000-8000-000000000004','primary','update','qbo-estimate-1','upr-e-line-delete-proof','{}',repeat('2',64));
  PERFORM public.set_qbo_estimate_command_state('a4000000-0000-4000-8000-000000000004','provider_succeeded','{"qbo_estimate_id":"qbo-estimate-1"}',NULL,NULL,NULL,NULL);
  r:=public.finalize_qbo_estimate_command('a4000000-0000-4000-8000-000000000004',200,'{"ok":true}');
  IF r->>'ok' IS DISTINCT FROM 'true' OR EXISTS(SELECT 1 FROM public.estimate_line_items WHERE id=created_id) THEN RAISE EXCEPTION 'delete line finalizer failed: %',r; END IF;

  intent:='{"action":"send","provider_action":"send","provider_payload":{"id":"qbo-estimate-1","send_to":"customer@example.invalid"},"provider_request_id":"upr-e-send-proof","customer_prerequisite":{},"line_change":null,"line_preimage":null}'::jsonb||jsonb_build_object('provider_source_preimage',pg_temp.qbo_estimate_provider_source_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage',pg_temp.qbo_estimate_document_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage_hash',repeat('5',64));
  PERFORM public.reserve_qbo_estimate_command('a4000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000001','send','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('5',64),'{}');
  PERFORM public.prepare_qbo_estimate_command('a4000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000001','send','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('5',64),'qbo-estimate-1','qbo-estimate-1',repeat('3',64),intent);
  PERFORM public.start_qbo_estimate_command_attempt('a4000000-0000-4000-8000-000000000005','primary','send','qbo-estimate-1','upr-e-send-proof','{}',repeat('4',64));
  PERFORM public.set_qbo_estimate_command_state('a4000000-0000-4000-8000-000000000005','provider_succeeded','{"qbo_estimate_id":"qbo-estimate-1","email_status":"EmailSent","send_to":"customer@example.invalid"}',NULL,NULL,NULL,NULL);
  PERFORM set_config('upr.qbo_estimate_finalizer_command_id','a4000000-0000-4000-8000-000000000005',true);
  UPDATE public.estimate_line_items SET description='simulated privileged drift' WHERE id='a5000000-0000-4000-8000-000000000001';
  r:=public.finalize_qbo_estimate_command('a4000000-0000-4000-8000-000000000005',200,'{"ok":true,"emailed_to":"customer@example.invalid"}');
  IF r->>'reason' IS DISTINCT FROM 'document-line-source-mismatch' THEN RAISE EXCEPTION 'no-change finalizer accepted full-document drift: %',r; END IF;
  UPDATE public.estimate_line_items SET description='First source' WHERE id='a5000000-0000-4000-8000-000000000001';
  UPDATE public.contacts SET email='provider-source-drift@example.invalid' WHERE id='a7000000-0000-4000-8000-000000000001';
  r:=public.finalize_qbo_estimate_command('a4000000-0000-4000-8000-000000000005',200,'{"ok":true,"emailed_to":"customer@example.invalid"}');
  IF r->>'reason' IS DISTINCT FROM 'provider-source-mismatch' THEN RAISE EXCEPTION 'finalizer accepted provider-source drift: %',r; END IF;
  UPDATE public.contacts SET email='customer@example.invalid' WHERE id='a7000000-0000-4000-8000-000000000001';
  r:=public.finalize_qbo_estimate_command('a4000000-0000-4000-8000-000000000005',200,'{"ok":true,"emailed_to":"customer@example.invalid"}');
  IF r->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM public.estimates WHERE id='a3000000-0000-4000-8000-000000000001' AND qbo_email_status='EmailSent' AND sent_to_email='customer@example.invalid' AND qbo_emailed_at IS NOT NULL) THEN RAISE EXCEPTION 'send metadata finalizer failed: %',r; END IF;

  intent:='{"action":"delete","provider_action":"delete","provider_payload":{"id":"qbo-estimate-1"},"provider_request_id":"upr-e-delete-proof","customer_prerequisite":{},"line_change":null,"line_preimage":null}'::jsonb||jsonb_build_object('provider_source_preimage',pg_temp.qbo_estimate_provider_source_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage',pg_temp.qbo_estimate_document_preimage('a3000000-0000-4000-8000-000000000001'),'document_line_preimage_hash',repeat('4',64));
  PERFORM public.reserve_qbo_estimate_command('a4000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000001','delete','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('4',64),'{}');
  PERFORM public.prepare_qbo_estimate_command('a4000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000001','delete','a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','browser','realm',repeat('4',64),'qbo-estimate-1','qbo-estimate-1',repeat('5',64),intent);
  PERFORM public.start_qbo_estimate_command_attempt('a4000000-0000-4000-8000-000000000006','primary','delete','qbo-estimate-1','upr-e-delete-proof','{}',repeat('6',64));
  PERFORM public.set_qbo_estimate_command_state('a4000000-0000-4000-8000-000000000006','provider_succeeded','{"qbo_estimate_id":null}',NULL,NULL,NULL,NULL);
  r:=public.finalize_qbo_estimate_command('a4000000-0000-4000-8000-000000000006',200,'{"deleted":"qbo-estimate-1"}');
  IF r->>'ok' IS DISTINCT FROM 'true' OR EXISTS(SELECT 1 FROM public.estimates WHERE id='a3000000-0000-4000-8000-000000000001' AND (qbo_estimate_id IS NOT NULL OR qbo_doc_number IS NOT NULL OR qbo_email_status IS NOT NULL OR sent_to_email IS NOT NULL)) THEN RAISE EXCEPTION 'delete unlink finalizer failed: %',r; END IF;
END;
$delete_send_unlink$;

ROLLBACK;
