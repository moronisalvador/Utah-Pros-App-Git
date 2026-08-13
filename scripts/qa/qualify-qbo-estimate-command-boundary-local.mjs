/**
 * ════════════════════════════════════════════════
 * FILE: qualify-qbo-estimate-command-boundary-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a temporary local Supabase, proves the estimate safety rules plus
 *   the one-company QuickBooks binding and both rollbacks, then removes that
 *   exact local stack. It never contacts QuickBooks or a hosted database.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins, project-pinned Supabase CLI, local Docker
 *   Internal:  safe-child-env.mjs, baseline, migrations, rollback, SQL proof
 *   Data:      reads  → disposable local database fixtures only
 *              writes → disposable local database fixtures only
 *
 * NOTES / GOTCHAS:
 *   - The runner refuses a non-local Docker socket and removes only its exact
 *     containers, zero-attached network, and temporary working directory.
 * ════════════════════════════════════════════════
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { safeChildEnv } from './safe-child-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(ROOT, 'node_modules', '.bin', 'supabase');
const CACHE = path.join(os.homedir(), '.cache', 'upr-qbo-estimate-command-boundary-local');
const INPUT = '/tmp/upr-qbo-estimate-command-boundary-inputs';
const BASELINE = 'db/baseline/schema.sql';
const PREDECESSORS = [
  'supabase/migrations/20260730150000_oop_pricing_builder.sql',
  'supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql',
  'supabase/migrations/20260731180000_qbo_estimate_conversion_concurrency.sql',
  'supabase/migrations/20260731210000_qbo_invoice_command_ledger.sql',
  'supabase/migrations/20260731231000_qbo_receipt_service_grant_containment.sql',
  'supabase/migrations/20260803192344_oop_quote_to_estimate.sql',
  'supabase/migrations/20260804120100_billing_editor_role_boundary.sql',
  'supabase/migrations/20260805010000_qbo_receipt_service_role_check_repair.sql',
  'supabase/migrations/20260805020000_estimate_create_rpc_billing_boundary.sql',
  'supabase/migrations/20260808070000_payments_qbo_realm_scoping.sql',
  'supabase/migrations/20260810010000_invoice_line_edit_lock_boundary.sql',
  'supabase/migrations/20260810020000_qbo_invoice_command_reservation.sql',
  'supabase/migrations/20260810030000_qbo_payment_allocation_lock_fence.sql',
];
const MIGRATION = 'supabase/migrations/20260810182855_estimate_qbo_command_boundary.sql';
const ROLLBACK = 'supabase/rollbacks/20260810182855_estimate_qbo_command_boundary.rollback.sql';
const PROOF = 'supabase/tests/qbo_estimate_command_boundary_isolated.sql';
const BINDING_MIGRATION = 'supabase/migrations/20260810182905_qbo_single_company_binding.sql';
const BINDING_ROLLBACK = 'supabase/rollbacks/20260810182905_qbo_single_company_binding.rollback.sql';
const BINDING_PROOF = 'supabase/tests/qbo_single_company_binding_isolated.sql';
const BINDING_SOURCE_INPUTS = [
  'functions/lib/quickbooks.js',
  'functions/lib/quickbooks-accounting-request-id.test.js',
  'functions/api/quickbooks-callback.js',
  'functions/api/quickbooks-callback.test.js',
  'upr-mcp/src/supabase.js',
  'upr-mcp/src/qbo.js',
  'upr-mcp/src/qbo.test.js',
  'tests/qa/unit/qbo-single-company-binding.test.js',
];
const INPUTS = [
  BASELINE, ...PREDECESSORS, MIGRATION, ROLLBACK, PROOF,
  BINDING_MIGRATION, BINDING_ROLLBACK, BINDING_PROOF,
  ...BINDING_SOURCE_INPUTS,
];
const hash = (value) => createHash('sha256').update(value).digest('hex');

function run(command, args, label, quiet = false, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env: { ...safeChildEnv(process.env), ...extraEnv }, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'] });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || '').trim().slice(0, 700)}`);
  return result.stdout || '';
}
function runAsync(command, args, label, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, encoding: 'utf8', env: { ...safeChildEnv(process.env), ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => reject(new Error(`${label} could not start: ${error.message}`)));
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}
function docker(context, args, label, quiet = false) { return run('docker', ['--context', context, ...args], label, quiet); }
function dockerAsync(context, args, label) { return runAsync('docker', ['--context', context, ...args], label); }
function hashes() { return INPUTS.map((input) => [input, hash(fs.readFileSync(path.join(ROOT, input)))]); }
function assertClean() {
  for (const input of INPUTS) run('git', ['ls-files', '--error-unmatch', '--', input], 'tracked-input check', true);
  if (run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...INPUTS], 'input status check', true).trim()) throw new Error('qualification inputs are dirty; use --iterate while authoring');
}
function receiptCommit() { assertClean(); const value = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], 'qualification commit identity', true).trim(); if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('qualification commit identity is invalid'); return value; }
function localContext() {
  const name = run('docker', ['context', 'show'], 'Docker context selection', true).trim();
  const raw = run('docker', ['--context', name, 'context', 'inspect', name, '--format', '{{json .Endpoints.docker.Host}}'], 'Docker context inspection', true).trim();
  let endpoint; try { endpoint = JSON.parse(raw); } catch { throw new Error('Docker context endpoint could not be decoded'); }
  if (!endpoint.startsWith('unix://')) throw new Error(`refusing non-local Docker endpoint: ${endpoint}`);
  if (!fs.statSync(endpoint.slice('unix://'.length)).isSocket()) throw new Error('Docker endpoint is not a Unix socket');
  return name;
}
function writeConfig(workdir, project) {
  const port = 56000 + ((process.pid % 200) * 10);
  fs.mkdirSync(path.join(workdir, 'supabase'), { recursive: true });
  fs.writeFileSync(path.join(workdir, 'supabase', 'config.toml'), `project_id = "${project}"
[api]
port = ${port + 1}
[db]
port = ${port + 2}
shadow_port = ${port}
major_version = 17
[db.seed]
enabled = false
[studio]
port = ${port + 3}
[local_smtp]
port = ${port + 4}
[auth]
site_url = "http://127.0.0.1:4173"
additional_redirect_urls = ["http://127.0.0.1:4173"]
[analytics]
port = ${port + 7}
`);
}
function psqlArgs(container, role, sql, isolated = false) {
  const args = ['exec']; if (isolated) args.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  args.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'postgres', '-c', sql); return args;
}
function psql(context, container, role, sql, isolated = false) { docker(context, psqlArgs(container, role, sql, isolated), `psql (${role})`); }
function psqlFile(context, container, file, isolated = false) {
  const args = ['exec']; if (isolated) args.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  args.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', file); docker(context, args, 'proof psql');
}
const service = "SET ROLE service_role; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',false);";
const browser = (actor) => `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{\"sub\":\"${actor}\",\"role\":\"authenticated\"}',false);`;

async function runRaces(context, container) {
  const actor = 'e9000000-0000-4000-8000-000000000001';
  const employee = 'e8000000-0000-4000-8000-000000000001';
  const estimateLine = 'e5000000-0000-4000-8000-000000000001';
  const estimateStatus = 'e3000000-0000-4000-8000-000000000002';
  const estimateFinalize = 'e3000000-0000-4000-8000-000000000003';
  const lineFinalize = 'e5000000-0000-4000-8000-000000000003';
  const lineReserveCommand = 'e4000000-0000-4000-8000-000000000001';
  const statusReserveCommand = 'e4000000-0000-4000-8000-000000000002';
  const finalizeCommand = 'e4000000-0000-4000-8000-000000000003';
  const contact = 'e7000000-0000-4000-8000-000000000001';
  const prerequisite = `'{"kind":"customer_sync","contact_id":"${contact}","primary_request_id":"upr-c-race"}'::jsonb`;
  psql(context, container, 'postgres', `INSERT INTO public.employees(id,auth_user_id,full_name,email,role,is_active,is_external) VALUES ('${employee}','${actor}','Estimate race admin','estimate-race-admin@example.invalid','admin',true,false); INSERT INTO public.contacts(id,phone,name,qbo_customer_id) VALUES ('${contact}','+18015550199','Estimate race customer','qbo-race-customer'); INSERT INTO public.estimates(id,contact_id,estimate_number,estimate_type,status,amount,subtotal) VALUES ('e3000000-0000-4000-8000-000000000001','${contact}','EST-RACE-LINE','initial','draft',10,10),('${estimateStatus}','${contact}','EST-RACE-STATUS','initial','draft',10,10),('${estimateFinalize}','${contact}','EST-RACE-FINAL','initial','draft',10,10); INSERT INTO public.estimate_line_items(id,estimate_id,description,quantity,unit_price,sort_order) VALUES ('${estimateLine}','e3000000-0000-4000-8000-000000000001','desktop source',1,10,0),('${lineFinalize}','${estimateFinalize}','finalize source',1,10,0);`);

  // A genuine authenticated browser update holds its line lock in a BEFORE
  // trigger. The service reservation can still lock the parent, and the fresh
  // guard must abort the stale browser statement rather than persist it.
  psql(context, container, 'postgres', `CREATE FUNCTION public.upr_estimate_line_pause() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN IF NEW.id='${estimateLine}'::uuid THEN PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$; CREATE TRIGGER aaa_upr_estimate_line_pause BEFORE UPDATE ON public.estimate_line_items FOR EACH ROW EXECUTE FUNCTION public.upr_estimate_line_pause();`);
  const desktopLine = dockerAsync(context, psqlArgs(container, 'postgres', `${browser(actor)} SET statement_timeout='5s'; UPDATE public.estimate_line_items SET description='desktop must abort' WHERE id='${estimateLine}';`), 'desktop estimate line session');
  await new Promise((resolve) => setTimeout(resolve, 160));
  const reserveLine = await dockerAsync(context, psqlArgs(container, 'postgres', `${service} SELECT public.reserve_qbo_estimate_command('${lineReserveCommand}','e3000000-0000-4000-8000-000000000001','save','${actor}','${employee}','browser','realm-race',repeat('1',64),${prerequisite});`), 'reserve during desktop line session');
  const desktopLineResult = await desktopLine;
  if (reserveLine.status !== 0 || !/"reserved"\s*:\s*true/.test(reserveLine.stdout) || desktopLineResult.status === 0 || !/ESTIMATE_QBO_COMMAND_ACTIVE/.test(desktopLineResult.stderr)) throw new Error(`desktop/reserve line race failed: desktop=${desktopLineResult.status} ${desktopLineResult.stdout} ${desktopLineResult.stderr}; reserve=${reserveLine.status} ${reserveLine.stdout} ${reserveLine.stderr}`);
  psql(context, container, 'postgres', `DO $$ BEGIN IF (SELECT description FROM public.estimate_line_items WHERE id='${estimateLine}') <> 'desktop source' THEN RAISE EXCEPTION 'desktop/reserve line race committed browser mutation'; END IF; END $$; DROP TRIGGER aaa_upr_estimate_line_pause ON public.estimate_line_items; DROP FUNCTION public.upr_estimate_line_pause(); ${service} SELECT public.release_qbo_estimate_command_reservation('${lineReserveCommand}','e3000000-0000-4000-8000-000000000001');`);

  // The reservation transaction holds the estimate row lock. A real browser
  // status transition waits, then sees the committed reservation in the guard
  // and refuses. This is the conversion/status race: whichever wins is serial,
  // and an active QBO command always wins over a terminal transition.
  const reserveStatus = dockerAsync(context, psqlArgs(container, 'postgres', `${service} BEGIN; SELECT public.reserve_qbo_estimate_command('${statusReserveCommand}','${estimateStatus}','save','${actor}','${employee}','browser','realm-race',repeat('2',64),${prerequisite}); SELECT pg_sleep(1.2); COMMIT;`), 'reserve before status transition');
  await new Promise((resolve) => setTimeout(resolve, 160));
  const desktopStatus = await dockerAsync(context, psqlArgs(container, 'postgres', `${browser(actor)} SET statement_timeout='5s'; UPDATE public.estimates SET status='approved' WHERE id='${estimateStatus}';`), 'desktop estimate status session');
  const reserveStatusResult = await reserveStatus;
  if (reserveStatusResult.status !== 0 || desktopStatus.status === 0 || !/ESTIMATE_QBO_COMMAND_ACTIVE/.test(desktopStatus.stderr)) throw new Error(`status/reserve race failed: reserve=${reserveStatusResult.status} ${reserveStatusResult.stderr}; status=${desktopStatus.status} ${desktopStatus.stdout} ${desktopStatus.stderr}`);
  psql(context, container, 'postgres', `DO $$ BEGIN IF (SELECT status FROM public.estimates WHERE id='${estimateStatus}') <> 'draft' THEN RAISE EXCEPTION 'status/reserve race committed terminal transition'; END IF; END $$; ${service} SELECT public.release_qbo_estimate_command_reservation('${statusReserveCommand}','${estimateStatus}');`);

  // This deliberately reproduces the physical line->estimate versus
  // finalizer estimate->line order. A passing migration must make both sessions
  // converge before their timeouts; PostgreSQL's deadlock detector is a failure.
  const frozen = JSON.stringify({ kind: 'update', line_id: lineFinalize, patch: { description: 'finalized line', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 2, unit_price: 10 } }).replaceAll("'", "''");
  const providerSource = `(SELECT jsonb_build_object('estimate',jsonb_build_object('id',est_row.id::text,'job_id',est_row.job_id,'contact_id',est_row.contact_id,'status',est_row.status,'converted_invoice_id',est_row.converted_invoice_id,'qbo_estimate_id',est_row.qbo_estimate_id,'intended_division',est_row.intended_division,'estimate_number',est_row.estimate_number,'expiration_date',est_row.expiration_date,'property_address',est_row.property_address,'property_city',est_row.property_city,'property_state',est_row.property_state,'property_zip',est_row.property_zip),'job','null'::jsonb,'contact',jsonb_build_object('id',contact_row.id::text,'qbo_customer_id',contact_row.qbo_customer_id,'name',contact_row.name,'email',contact_row.email),'claim','null'::jsonb) FROM public.estimates est_row LEFT JOIN public.contacts contact_row ON contact_row.id=est_row.contact_id WHERE est_row.id='${estimateFinalize}')`;
  psql(context, container, 'postgres', `${service} INSERT INTO public.qbo_estimate_commands(id,estimate_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,request_hash,expected_qbo_estimate_id,target_qbo_estimate_id,intent_hash,intent_payload,status,provider_result) SELECT '${finalizeCommand}','${estimateFinalize}','save','${actor}','${employee}','browser','realm-race',repeat('3',64),NULL,NULL,repeat('a',64),jsonb_build_object('provider_source_preimage',${providerSource},'line_change','${frozen}'::jsonb,'document_line_preimage',jsonb_build_array(jsonb_build_object('id',li.id::text,'description',btrim(COALESCE(li.description,'')),'qbo_item_id',li.qbo_item_id,'qbo_item_name',li.qbo_item_name,'qbo_class_id',li.qbo_class_id,'qbo_class_name',li.qbo_class_name,'quantity',li.quantity,'unit_price',li.unit_price,'sort_order',li.sort_order)),'document_line_preimage_hash',repeat('3',64),'line_preimage',jsonb_build_object('id',li.id::text,'description',btrim(COALESCE(li.description,'')),'qbo_item_id',li.qbo_item_id,'qbo_item_name',li.qbo_item_name,'qbo_class_id',li.qbo_class_id,'qbo_class_name',li.qbo_class_name,'quantity',li.quantity,'unit_price',li.unit_price,'sort_order',li.sort_order)),'provider_succeeded',jsonb_build_object('qbo_estimate_id','qbo-finalize','doc_number','Q-FINAL') FROM public.estimate_line_items li WHERE li.id='${lineFinalize}'; INSERT INTO public.qbo_estimate_command_reservations(estimate_id,command_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,request_hash,prerequisite_payload) VALUES ('${estimateFinalize}','${finalizeCommand}','save','${actor}','${employee}','browser','realm-race',repeat('3',64),${prerequisite}); RESET ROLE; CREATE FUNCTION public.upr_estimate_finalize_pause() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN IF NEW.id='${lineFinalize}'::uuid THEN PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$; CREATE TRIGGER aaa_upr_estimate_finalize_pause BEFORE UPDATE ON public.estimate_line_items FOR EACH ROW EXECUTE FUNCTION public.upr_estimate_finalize_pause();`);
  const desktopFinalize = dockerAsync(context, psqlArgs(container, 'postgres', `${browser(actor)} SET statement_timeout='5s'; UPDATE public.estimate_line_items SET description='desktop no-op' WHERE id='${lineFinalize}';`), 'desktop/finalizer line session');
  await new Promise((resolve) => setTimeout(resolve, 160));
  const finalizer = await dockerAsync(context, psqlArgs(container, 'postgres', `${service} SET statement_timeout='5s'; SELECT public.finalize_qbo_estimate_command('${finalizeCommand}',200,'{"ok":true}'::jsonb);`), 'estimate finalizer session');
  const desktopFinalizeResult = await desktopFinalize;
  if (desktopFinalizeResult.status === 0 || !/ESTIMATE_QBO_COMMAND_ACTIVE/.test(desktopFinalizeResult.stderr) || finalizer.status !== 0 || !/"ok"\s*:\s*true/.test(finalizer.stdout)) throw new Error(`desktop/finalizer lock-order race failed: desktop=${desktopFinalizeResult.status} ${desktopFinalizeResult.stdout} ${desktopFinalizeResult.stderr}; finalizer=${finalizer.status} ${finalizer.stdout} ${finalizer.stderr}`);
  psql(context, container, 'postgres', `DROP TRIGGER aaa_upr_estimate_finalize_pause ON public.estimate_line_items; DROP FUNCTION public.upr_estimate_finalize_pause();`);
}

async function rollbackRefusal(context, container, rollbackFile) {
  const attempt = () => dockerAsync(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', rollbackFile], 'expected rollback refusal');
  psql(context, container, 'postgres', `${service} SELECT public.reserve_qbo_estimate_command('e4000000-0000-4000-8000-000000000099','e3000000-0000-4000-8000-000000000002','save','e9000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001','browser','realm-race',repeat('4',64),'{"kind":"customer_sync","contact_id":"e7000000-0000-4000-8000-000000000001","primary_request_id":"upr-c-race"}'::jsonb);`);
  const reserved = await attempt();
  if (reserved.status === 0 || !/QBO_ESTIMATE_RESERVATIONS_ACTIVE/.test(reserved.stderr)) throw new Error(`rollback did not refuse active reservation: ${reserved.status} ${reserved.stdout} ${reserved.stderr}`);
  psql(context, container, 'postgres', `${service} DELETE FROM public.qbo_estimate_command_reservations; INSERT INTO public.qbo_estimate_commands(id,estimate_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,request_hash,intent_hash,intent_payload,status) VALUES ('e4000000-0000-4000-8000-000000000098','e3000000-0000-4000-8000-000000000002','save','e9000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001','browser','realm-race',repeat('4',64),repeat('b',64),'{}','provider_started');`);
  const active = await attempt();
  if (active.status === 0 || !/QBO_ESTIMATE_COMMANDS_ACTIVE/.test(active.stderr)) throw new Error(`rollback did not refuse active command: ${active.status} ${active.stdout} ${active.stderr}`);
  psql(context, container, 'postgres', "DELETE FROM public.qbo_estimate_commands WHERE status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation');");
}
async function wrongOrderRollbackRefusal(context, container, rollbackFile) {
  const attempt = await dockerAsync(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', rollbackFile], 'wrong-order rollback');
  if (attempt.status === 0 || !/(qbo_estimate_command_reservations|does not exist)/.test(`${attempt.stdout} ${attempt.stderr}`)) throw new Error(`rollback did not refuse before its forward migration: ${attempt.status} ${attempt.stdout} ${attempt.stderr}`);
}
async function bindingUnattributedArtifactRefusal(context, container, migrationFile) {
  const contact = 'b7000000-0000-4000-8000-000000000004';
  const estimate = 'b3000000-0000-4000-8000-000000000004';
  const command = 'b4000000-0000-4000-8000-000000000004';
  psql(context, container, 'postgres', `INSERT INTO public.contacts(id,phone,name) VALUES ('${contact}','+18015550196','Unattributed realm proof'); INSERT INTO public.estimates(id,contact_id,estimate_number,estimate_type,status,amount,subtotal) VALUES ('${estimate}','${contact}','EST-UNATTRIBUTED-REALM','initial','draft',10,10); INSERT INTO public.qbo_estimate_commands(id,estimate_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,request_hash,intent_hash,intent_payload,status) VALUES ('${command}','${estimate}','save','b9000000-0000-4000-8000-000000000004','b8000000-0000-4000-8000-000000000004','browser','realm-unattributed',repeat('1',64),repeat('2',64),'{}','ambiguous');`);
  const attempt = await dockerAsync(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', migrationFile], 'unattributed realm-evidence binding migration');
  if (attempt.status === 0 || !/QBO_COMPANY_BINDING_UNATTRIBUTED_REALM_EVIDENCE/.test(`${attempt.stdout} ${attempt.stderr}`)) throw new Error(`binding migration did not refuse unattributed realm evidence: ${attempt.status} ${attempt.stdout} ${attempt.stderr}`);
  psql(context, container, 'postgres', `DO $$ BEGIN IF to_regclass('public.qbo_company_binding') IS NOT NULL THEN RAISE EXCEPTION 'unattributed realm evidence left a company binding'; END IF; IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.integration_credentials'::regclass AND attname='qbo_binding_generation' AND NOT attisdropped) THEN RAISE EXCEPTION 'unattributed realm evidence left a credential-generation column'; END IF; IF NOT EXISTS (SELECT 1 FROM public.qbo_estimate_commands WHERE id='${command}' AND realm_id='realm-unattributed' AND status='ambiguous') THEN RAISE EXCEPTION 'unattributed realm preflight mutated command evidence'; END IF; END $$; DELETE FROM public.qbo_estimate_commands WHERE id='${command}'; DELETE FROM public.estimates WHERE id='${estimate}'; DELETE FROM public.contacts WHERE id='${contact}';`);
}
async function bindingUnboundArtifactSplitRefusal(context, container, migrationFile) {
  const contact = 'b7000000-0000-4000-8000-000000000002';
  const job = 'b6000000-0000-4000-8000-000000000002';
  const invoice = 'b2000000-0000-4000-8000-000000000002';
  const estimate = 'b3000000-0000-4000-8000-000000000002';
  const attemptId = 'b1000000-0000-4000-8000-000000000002';
  const invoiceCommand = 'b4000000-0000-4000-8000-000000000002';
  const estimateCommand = 'b4000000-0000-4000-8000-000000000003';
  psql(context, container, 'postgres', `INSERT INTO public.contacts(id,phone,name) VALUES ('${contact}','+18015550197','Unbound realm split proof'); INSERT INTO public.jobs(id) VALUES ('${job}'); INSERT INTO public.invoices(id,job_id,contact_id,invoice_number,status,invoice_type,total) VALUES ('${invoice}','${job}','${contact}','INV-BINDING-SPLIT','draft','standard',10); INSERT INTO public.estimates(id,contact_id,estimate_number,estimate_type,status,amount,subtotal) VALUES ('${estimate}','${contact}','EST-BINDING-SPLIT','initial','draft',10,10); INSERT INTO public.payment_receipt_attempts(id,client_request_id,intuit_request_id,qbo_realm_id,request_fingerprint,request_payload,status) VALUES ('${attemptId}','binding-split-client','binding-split-intuit','realm-artifact-A',repeat('d',64),'{}','rejected'); INSERT INTO public.qbo_payment_allocation_fences(attempt_id,invoice_id,qbo_realm_id,amount_cents) VALUES ('${attemptId}','${invoice}','realm-artifact-A',100); INSERT INTO public.qbo_invoice_commands(id,invoice_id,action,actor_auth_user_id,initiator,realm_id,intent_hash,intent_payload,status) VALUES ('${invoiceCommand}','${invoice}','save','b9000000-0000-4000-8000-000000000002','browser','realm-artifact-A',repeat('e',64),'{}','succeeded'); INSERT INTO public.qbo_invoice_command_reservations(invoice_id,command_id,action,actor_auth_user_id,initiator,realm_id) VALUES ('${invoice}','${invoiceCommand}','save','b9000000-0000-4000-8000-000000000002','browser','realm-artifact-A'); INSERT INTO public.qbo_estimate_commands(id,estimate_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,request_hash,intent_hash,intent_payload,status) VALUES ('${estimateCommand}','${estimate}','save','b9000000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000002','browser','realm-artifact-B',repeat('f',64),repeat('a',64),'{}','succeeded');`);
  const attempt = await dockerAsync(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', migrationFile], 'unbound cross-artifact binding migration');
  if (attempt.status === 0 || !/QBO_COMPANY_BINDING_ARTIFACT_REALM_MISMATCH/.test(`${attempt.stdout} ${attempt.stderr}`)) throw new Error(`binding migration did not refuse conflicting unbound artifact realms: ${attempt.status} ${attempt.stdout} ${attempt.stderr}`);
  psql(context, container, 'postgres', `DO $$ BEGIN IF to_regclass('public.qbo_company_binding') IS NOT NULL THEN RAISE EXCEPTION 'unbound artifact split left a company binding'; END IF; IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.integration_credentials'::regclass AND attname='qbo_binding_generation' AND NOT attisdropped) THEN RAISE EXCEPTION 'unbound artifact split left a credential-generation column'; END IF; IF NOT EXISTS (SELECT 1 FROM public.qbo_payment_allocation_fences WHERE attempt_id='${attemptId}' AND qbo_realm_id='realm-artifact-A') OR NOT EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id='${invoiceCommand}' AND realm_id='realm-artifact-A') OR NOT EXISTS (SELECT 1 FROM public.qbo_estimate_commands WHERE id='${estimateCommand}' AND realm_id='realm-artifact-B') THEN RAISE EXCEPTION 'unbound artifact preflight mutated authoritative evidence'; END IF; END $$; DELETE FROM public.qbo_payment_allocation_fences WHERE attempt_id='${attemptId}'; DELETE FROM public.payment_receipt_attempts WHERE id='${attemptId}'; DELETE FROM public.qbo_invoice_command_reservations WHERE command_id='${invoiceCommand}'; DELETE FROM public.qbo_invoice_commands WHERE id='${invoiceCommand}'; DELETE FROM public.qbo_estimate_commands WHERE id='${estimateCommand}'; DELETE FROM public.invoices WHERE id='${invoice}'; DELETE FROM public.estimates WHERE id='${estimate}'; DELETE FROM public.system_events WHERE job_id='${job}' OR entity_id IN ('${invoice}','${estimate}'); DELETE FROM public.jobs WHERE id='${job}'; DELETE FROM public.contacts WHERE id='${contact}';`);
}
async function bindingSeedMismatchRefusal(context, container, migrationFile) {
  const contact = 'b7000000-0000-4000-8000-000000000001';
  const estimate = 'b3000000-0000-4000-8000-000000000001';
  const command = 'b4000000-0000-4000-8000-000000000001';
  psql(context, container, 'postgres', `INSERT INTO public.contacts(id,phone,name) VALUES ('${contact}','+18015550198','Binding mismatch proof'); INSERT INTO public.estimates(id,contact_id,estimate_number,estimate_type,status,amount,subtotal) VALUES ('${estimate}','${contact}','EST-BINDING-MISMATCH','initial','draft',10,10); INSERT INTO public.qbo_estimate_commands(id,estimate_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,request_hash,intent_hash,intent_payload,status) VALUES ('${command}','${estimate}','save','b9000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001','browser','realm-artifact',repeat('b',64),repeat('c',64),'{}','succeeded'); INSERT INTO public.integration_credentials(provider,realm_id,environment,access_token,refresh_token,token_expires_at) VALUES ('quickbooks','realm-credential','sandbox','seed-access','seed-refresh',now() + interval '1 hour');`);
  const attempt = await dockerAsync(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', migrationFile], 'mismatched credential/artifact binding migration');
  if (attempt.status === 0 || !/QBO_COMPANY_BINDING_ARTIFACT_REALM_MISMATCH/.test(`${attempt.stdout} ${attempt.stderr}`)) throw new Error(`binding migration did not refuse mismatched credential/artifact realms: ${attempt.status} ${attempt.stdout} ${attempt.stderr}`);
  psql(context, container, 'postgres', `DO $$ BEGIN IF to_regclass('public.qbo_company_binding') IS NOT NULL THEN RAISE EXCEPTION 'failed realm preflight left a company binding'; END IF; IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.integration_credentials'::regclass AND attname='qbo_binding_generation' AND NOT attisdropped) THEN RAISE EXCEPTION 'failed realm preflight left a credential-generation column'; END IF; IF NOT EXISTS (SELECT 1 FROM public.integration_credentials WHERE provider='quickbooks' AND realm_id='realm-credential') OR NOT EXISTS (SELECT 1 FROM public.qbo_estimate_commands WHERE id='${command}' AND realm_id='realm-artifact') THEN RAISE EXCEPTION 'failed realm preflight mutated credential or command evidence'; END IF; END $$; DELETE FROM public.integration_credentials WHERE provider='quickbooks'; DELETE FROM public.qbo_estimate_commands WHERE id='${command}'; DELETE FROM public.estimates WHERE id='${estimate}'; DELETE FROM public.contacts WHERE id='${contact}';`);
}
function rollbackProof(context, container) {
  psql(context, container, 'postgres', `DO $$ DECLARE body text; BEGIN IF to_regclass('public.qbo_estimate_commands') IS NULL THEN RAISE EXCEPTION 'rollback lost estimate command audit table'; END IF; IF NOT EXISTS(SELECT 1 FROM public.qbo_estimate_commands WHERE status='succeeded') THEN RAISE EXCEPTION 'rollback lost terminal estimate command audit evidence'; END IF; IF to_regprocedure('public.reserve_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained estimate reserve RPC'; END IF; IF to_regprocedure('public.get_qbo_estimate_command(uuid)') IS NULL THEN RAISE EXCEPTION 'rollback lost service-only estimate audit reader'; END IF; IF NOT has_table_privilege('service_role','public.qbo_estimate_commands','SELECT') OR has_table_privilege('service_role','public.qbo_estimate_commands','INSERT') OR has_table_privilege('service_role','public.qbo_estimate_commands','UPDATE') OR has_table_privilege('service_role','public.qbo_estimate_commands','DELETE') THEN RAISE EXCEPTION 'rollback estimate command audit grants are not read-only'; END IF; IF has_table_privilege('authenticated','public.qbo_estimate_commands','SELECT') OR has_table_privilege('anon','public.qbo_estimate_commands','SELECT') THEN RAISE EXCEPTION 'rollback exposed estimate command audit rows'; END IF; IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.estimate_line_items'::regclass AND tgname='trg_estimate_lines_guard_qbo_command') THEN RAISE EXCEPTION 'rollback retained estimate line guard'; END IF; SELECT pg_get_functiondef('public.create_estimate_for_contact(uuid,text,text,text,text,text,text,uuid)'::regprocedure) INTO body; IF body NOT LIKE '%e.auth_user_id=auth.uid()%' OR body NOT LIKE '%pg_catalog%' THEN RAISE EXCEPTION 'rollback lost sticky create attribution hardening'; END IF; END $$;`, true);
}
function seedBindingRollbackEvidence(context, container) {
  psql(context, container, 'postgres', "INSERT INTO public.qbo_company_binding(singleton,environment,realm_id,generation) VALUES(true,'sandbox','realm-race',9) ON CONFLICT(singleton) DO UPDATE SET environment=EXCLUDED.environment,realm_id=EXCLUDED.realm_id,generation=EXCLUDED.generation,updated_at=now();");
}
function bindingRollbackProof(context, container) {
  psql(context, container, 'postgres', `DO $$ BEGIN IF to_regclass('public.qbo_company_binding') IS NULL THEN RAISE EXCEPTION 'binding rollback lost durable company table'; END IF; IF NOT EXISTS(SELECT 1 FROM public.qbo_company_binding WHERE singleton AND environment='sandbox' AND realm_id='realm-race' AND generation=9) THEN RAISE EXCEPTION 'binding rollback lost durable company evidence'; END IF; IF to_regprocedure('public.replace_qbo_connection(text,text,text,text,timestamptz,text,uuid,timestamptz)') IS NOT NULL OR to_regprocedure('public.refresh_qbo_connection_cas(text,text,bigint,text,text,timestamptz,text)') IS NOT NULL THEN RAISE EXCEPTION 'binding rollback retained connection mutation RPC'; END IF; IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.integration_credentials'::regclass AND tgname='trg_integration_credentials_qbo_company_binding' AND NOT tgisinternal) THEN RAISE EXCEPTION 'binding rollback lost credential realm guard'; END IF; IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.integration_credentials'::regclass AND attname='qbo_binding_generation' AND NOT attisdropped) THEN RAISE EXCEPTION 'binding rollback lost credential generation'; END IF; IF NOT has_table_privilege('service_role','public.qbo_company_binding','SELECT') OR has_table_privilege('service_role','public.qbo_company_binding','INSERT') OR has_table_privilege('service_role','public.qbo_company_binding','UPDATE') OR has_table_privilege('service_role','public.qbo_company_binding','DELETE') THEN RAISE EXCEPTION 'binding rollback service grant is not read-only'; END IF; IF has_table_privilege('authenticated','public.qbo_company_binding','SELECT') OR has_table_privilege('anon','public.qbo_company_binding','SELECT') THEN RAISE EXCEPTION 'binding rollback exposed company identity'; END IF; END $$; ${service} DO $$ BEGIN BEGIN INSERT INTO public.integration_credentials(provider,access_token,refresh_token,realm_id,environment) VALUES('quickbooks','wrong','wrong','realm-other','sandbox'); RAISE EXCEPTION 'binding rollback allowed wrong-company credential'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; BEGIN INSERT INTO public.integration_credentials(provider,access_token,refresh_token,realm_id,environment) VALUES('quickbooks','matching','matching','realm-race','sandbox'); RAISE EXCEPTION 'binding rollback allowed direct same-company token write'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; END $$; RESET ROLE;`, true);
}
function removeProject(context, project) { const ids = docker(context, ['ps', '-aq', '--filter', `name=${project}`], 'disposable container listing', true).trim().split(/\s+/).filter(Boolean); if (ids.length) docker(context, ['rm', '-f', ...ids], 'disposable container cleanup', true); }
function removeProjectNetwork(context, project) {
  const network = `supabase_network_${project}`;
  const names = docker(context, ['network', 'ls', '--filter', `name=^${network}$`, '--format', '{{.Name}}'], 'disposable network listing', true).trim().split(/\s+/).filter(Boolean);
  if (!names.includes(network)) return false;
  const attached = Number(docker(context, ['network', 'inspect', network, '--format', '{{len .Containers}}'], 'disposable network inspection', true).trim());
  if (!Number.isInteger(attached) || attached !== 0) throw new Error(`refusing to remove disposable network with ${attached} attached container(s)`);
  docker(context, ['network', 'rm', network], 'disposable network cleanup', true);
  return true;
}

async function main(argv = process.argv.slice(2)) {
  const iterate = argv.length === 1 && argv[0] === '--iterate'; if (argv.length && !iterate) throw new Error('only --iterate is accepted');
  const before = hashes(); const commit = iterate ? null : receiptCommit();
  if (!fs.existsSync(BIN) || run(BIN, ['--version'], 'Supabase CLI version', true, { SUPABASE_TELEMETRY_DISABLED: '1' }).trim() !== '2.111.0') throw new Error('project Supabase CLI 2.111.0 is required');
  run(process.execPath, [path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
    'functions/api/quickbooks-callback.test.js',
    'functions/lib/quickbooks-accounting-request-id.test.js', '--reporter=dot'],
  'QBO binding worker source proof', true, { UPR_TEST_LANE: 'worker' });
  run(process.execPath, [path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
    'tests/qa/unit/qbo-single-company-binding.test.js', '--reporter=dot'],
  'QBO binding QA source proof', true, { UPR_TEST_LANE: 'qa' });
  run(process.execPath, [path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
    'upr-mcp/src/qbo.test.js', '--reporter=dot'],
  'QBO binding MCP source proof', true, { UPR_TEST_LANE: 'unit' });
  const context = localContext(); const project = `uprqboest-${process.pid}-${randomUUID().slice(0, 8)}`; const container = `supabase_db_${project}`;
  fs.mkdirSync(CACHE, { recursive: true }); const workdir = fs.mkdtempSync(path.join(CACHE, 'cycle-')); let cleanup = 'not-started';
  try {
    writeConfig(workdir, project); run(BIN, ['start', '--workdir', workdir, '--yes'], 'disposable local Supabase start', true, { DOCKER_CONTEXT: context, SUPABASE_TELEMETRY_DISABLED: '1' });
    psql(context, container, 'supabase_admin', 'GRANT supabase_admin TO postgres;'); psql(context, container, 'postgres', 'DROP SCHEMA public CASCADE;');
    docker(context, ['exec', container, 'mkdir', '-p', INPUT], 'create input directory'); for (const input of INPUTS) docker(context, ['cp', path.join(ROOT, input), `${container}:${INPUT}/${path.basename(input)}`], 'copy input');
    const inside = (input) => `${INPUT}/${path.basename(input)}`;
    psqlFile(context, container, inside(BASELINE));
    for (const prior of PREDECESSORS) psqlFile(context, container, inside(prior));
    await wrongOrderRollbackRefusal(context, container, inside(ROLLBACK));
    psqlFile(context, container, inside(MIGRATION));
    await bindingUnattributedArtifactRefusal(context, container, inside(BINDING_MIGRATION));
    await bindingUnboundArtifactSplitRefusal(context, container, inside(BINDING_MIGRATION));
    await bindingSeedMismatchRefusal(context, container, inside(BINDING_MIGRATION));
    psqlFile(context, container, inside(BINDING_MIGRATION));
    psqlFile(context, container, inside(PROOF), true);
    psqlFile(context, container, inside(BINDING_PROOF), true);
    seedBindingRollbackEvidence(context, container);
    await runRaces(context, container);
    psqlFile(context, container, inside(BINDING_ROLLBACK));
    bindingRollbackProof(context, container);
    await rollbackRefusal(context, container, inside(ROLLBACK));
    psqlFile(context, container, inside(ROLLBACK));
    rollbackProof(context, container);
    psqlFile(context, container, inside(MIGRATION));
    psqlFile(context, container, inside(BINDING_MIGRATION));
    psqlFile(context, container, inside(PROOF), true);
    psqlFile(context, container, inside(BINDING_PROOF), true);
    process.stdout.write('QBO estimate command and durable company-binding local qualification cycle passed.\n');
  } finally {
    const cleanupErrors = [];
    let networkRemoved = false;
    try { removeProject(context, project); } catch (error) { cleanupErrors.push(`containers: ${error.message}`); }
    try { networkRemoved = removeProjectNetwork(context, project); } catch (error) { cleanupErrors.push(`network: ${error.message}`); }
    try { fs.rmSync(workdir, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(`workdir: ${error.message}`); }
    cleanup = cleanupErrors.length
      ? `FAILED: ${cleanupErrors.join('; ')}`
      : networkRemoved ? 'removed disposable containers, zero-attached network, and workdir' : 'removed disposable containers and workdir (network already absent)';
    process.stdout.write(`local qualification cleanup: ${cleanup}\n`);
    if (cleanupErrors.length) throw new Error(`local qualification cleanup failed: ${cleanupErrors.join('; ')}`);
  }
  const after = hashes(); if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');
  if (iterate) return process.stdout.write('iterate mode: no commit-bound receipt issued (inputs are not commit-bound).\n');
  if (receiptCommit() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({ schema: 'upr-qbo-estimate-command-boundary-local-qualification-v1', commit_sha: commit, inputs: Object.fromEntries(after) })}\n`);
}
main().catch((error) => { process.stderr.write(`QBO estimate command boundary local qualification refused: ${error.message}\n`); process.exitCode = 2; });
