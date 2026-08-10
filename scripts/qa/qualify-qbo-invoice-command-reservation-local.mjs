/**
 * FILE: qualify-qbo-invoice-command-reservation-local.mjs
 * Builds a throwaway local Supabase database, applies the reservation migration,
 * runs role/state proofs plus genuine concurrent psql sessions (including the
 * desktop-line/finalizer lock order), rolls back, verifies the rollback,
 * reapplies, and proves it again. It refuses remote Docker.
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
const CACHE = path.join(os.homedir(), '.cache', 'upr-qbo-invoice-command-reservation-local');
const INPUT = '/tmp/upr-qbo-invoice-command-reservation-inputs';
const BASELINE = 'db/baseline/schema.sql';
const PREDECESSORS = [
  'supabase/migrations/20260730150000_oop_pricing_builder.sql',
  'supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql',
  'supabase/migrations/20260731231000_qbo_receipt_service_grant_containment.sql',
  'supabase/migrations/20260731180000_qbo_estimate_conversion_concurrency.sql',
  'supabase/migrations/20260731210000_qbo_invoice_command_ledger.sql',
  'supabase/migrations/20260803192344_oop_quote_to_estimate.sql',
  'supabase/migrations/20260804120100_billing_editor_role_boundary.sql',
];
const LINE_MIGRATION = 'supabase/migrations/20260810010000_invoice_line_edit_lock_boundary.sql';
const LINE_ROLLBACK = 'supabase/rollbacks/20260810010000_invoice_line_edit_lock_boundary.rollback.sql';
const MIGRATION = 'supabase/migrations/20260810020000_qbo_invoice_command_reservation.sql';
const ROLLBACK = 'supabase/rollbacks/20260810020000_qbo_invoice_command_reservation.rollback.sql';
const PROOF = 'supabase/tests/qbo_invoice_command_reservation_isolated.sql';
const INPUTS = [BASELINE, ...PREDECESSORS, LINE_MIGRATION, LINE_ROLLBACK, MIGRATION, ROLLBACK, PROOF];
const hash = (value) => createHash('sha256').update(value).digest('hex');

function run(command, args, label, quiet = false, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env: { ...safeChildEnv(process.env), ...extraEnv }, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'] });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || '').trim().slice(0, 500)}`);
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
  // Parallel local qualifications share this machine; derive one short-lived
  // loopback port block from this process instead of a project-global constant.
  const port = 50000 + ((process.pid % 1000) * 10);
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
  const result = ['exec']; if (isolated) result.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  result.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'postgres', '-c', sql); return result;
}
function psql(context, container, role, sql, isolated = false) { docker(context, psqlArgs(container, role, sql, isolated), `psql (${role})`); }
function psqlFile(context, container, file, isolated = false) {
  const args = ['exec']; if (isolated) args.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on'); args.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', file); docker(context, args, 'proof psql');
}
const servicePrefix = `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);`;
async function raceProof(context, container) {
  const job = 'c2000000-0000-4000-8000-000000000099';
  const invReserveFirst = 'c3000000-0000-4000-8000-000000000091'; const invLockFirst = 'c3000000-0000-4000-8000-000000000092';
  const invFinalizer = 'c3000000-0000-4000-8000-000000000093';
  const invLineFinalizer = 'c3000000-0000-4000-8000-000000000094';
  const invBrowserReserve = 'c3000000-0000-4000-8000-000000000095';
  const lineFinalizer = 'c5000000-0000-4000-8000-000000000094';
  const lineBrowserReserve = 'c5000000-0000-4000-8000-000000000095';
  const cmdLineFinalizer = 'c4000000-0000-4000-8000-000000000094';
  const cmdBrowserReserve = 'c4000000-0000-4000-8000-000000000096';
  const actor = 'c9000000-0000-4000-8000-000000000099';
  psql(context, container, 'postgres', `INSERT INTO public.jobs(id) VALUES ('${job}'); INSERT INTO public.invoices(id,job_id,invoice_number,status,invoice_type,total) VALUES ('${invReserveFirst}','${job}','ZZ-RACE-1','saved','standard',0),('${invLockFirst}','${job}','ZZ-RACE-2','saved','standard',0),('${invFinalizer}','${job}','ZZ-RACE-3','saved','standard',0),('${invLineFinalizer}','${job}','ZZ-RACE-4','saved','standard',0),('${invBrowserReserve}','${job}','ZZ-RACE-5','draft','standard',10); INSERT INTO public.invoice_line_items(id,invoice_id,description,quantity,unit_price) VALUES ('${lineFinalizer}','${invLineFinalizer}','ZZ race source',1,10),('${lineBrowserReserve}','${invBrowserReserve}','ZZ browser source',1,10); INSERT INTO public.employees(id,auth_user_id,full_name,email,role,is_active,is_external) VALUES ('c8000000-0000-4000-8000-000000000099','${actor}','ZZ race admin','zz-race-admin@example.invalid','admin',true,false);`);
  const reserveFirst = dockerAsync(context, psqlArgs(container, 'postgres', `${servicePrefix} BEGIN; SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000091','${invReserveFirst}','save','${actor}',NULL,'browser','realm-race'); SELECT pg_sleep(1.2); COMMIT;`), 'reserve-first session');
  await new Promise((resolve) => setTimeout(resolve, 160));
  const lockAfterReserve = await dockerAsync(context, psqlArgs(container, 'postgres', `BEGIN; UPDATE public.invoices SET locked=true WHERE id='${invReserveFirst}'; COMMIT;`), 'lock-after-reserve session');
  const reserveFirstResult = await reserveFirst;
  if (reserveFirstResult.status !== 0 || lockAfterReserve.status === 0 || !/INVOICE_QBO_COMMAND_ACTIVE/.test(lockAfterReserve.stderr)) throw new Error(`reserve-first race failed: reserve=${reserveFirstResult.status}, lock=${lockAfterReserve.status}, ${lockAfterReserve.stderr}`);
  const lockFirst = dockerAsync(context, psqlArgs(container, 'postgres', `BEGIN; UPDATE public.invoices SET locked=true WHERE id='${invLockFirst}'; SELECT pg_sleep(1.2); COMMIT;`), 'lock-first session');
  await new Promise((resolve) => setTimeout(resolve, 160));
  const reserveAfterLock = await dockerAsync(context, psqlArgs(container, 'postgres', `${servicePrefix} SELECT public.reserve_qbo_invoice_command('c4000000-0000-4000-8000-000000000092','${invLockFirst}','save','${actor}',NULL,'browser','realm-race');`), 'reserve-after-lock session');
  const lockFirstResult = await lockFirst;
  if (lockFirstResult.status !== 0 || reserveAfterLock.status !== 0 || !/invoice-locked/.test(reserveAfterLock.stdout)) throw new Error(`lock-first race failed: lock=${lockFirstResult.status}, reserve=${reserveAfterLock.status}, ${reserveAfterLock.stdout} ${reserveAfterLock.stderr}`);

  // Prove the real authenticated browser race, including the dangerous window
  // after the UPDATE passed its STABLE RLS snapshot and locked the line but
  // before its fresh trigger recheck locks the parent. Reservation commits in
  // that window; the browser statement must then abort without changing data.
  psql(context, container, 'postgres', `CREATE OR REPLACE FUNCTION public.upr_qbo_browser_reserve_pause() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN IF NEW.id='${lineBrowserReserve}'::uuid THEN PERFORM pg_sleep(1.0); END IF; RETURN NEW; END $$; CREATE TRIGGER aaa_upr_qbo_browser_reserve_pause BEFORE UPDATE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION public.upr_qbo_browser_reserve_pause();`);
  const browserUpdate = dockerAsync(context, psqlArgs(container, 'postgres', `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',false); SET statement_timeout='5s'; UPDATE public.invoice_line_items SET description='ZZ browser must abort' WHERE id='${lineBrowserReserve}';`), 'browser-update-before-reserve session');
  await new Promise((resolve) => setTimeout(resolve, 160));
  const reserveDuringBrowserUpdate = await dockerAsync(context, psqlArgs(container, 'postgres', `${servicePrefix} SET statement_timeout='5s'; SELECT public.reserve_qbo_invoice_command('${cmdBrowserReserve}','${invBrowserReserve}','save','${actor}',NULL,'browser','realm-race');`), 'reserve-during-browser-update session');
  const browserUpdateResult = await browserUpdate;
  if (reserveDuringBrowserUpdate.status !== 0 || !/"reserved": true/.test(reserveDuringBrowserUpdate.stdout)
      || browserUpdateResult.status === 0 || !/INVOICE_QBO_COMMAND_ACTIVE/.test(browserUpdateResult.stderr)) {
    throw new Error(`browser/reserve race failed: browser=${browserUpdateResult.status}, reserve=${reserveDuringBrowserUpdate.status}, ${browserUpdateResult.stdout} ${browserUpdateResult.stderr} ${reserveDuringBrowserUpdate.stdout} ${reserveDuringBrowserUpdate.stderr}`);
  }
  psql(context, container, 'postgres', `DO $$ BEGIN IF (SELECT description FROM public.invoice_line_items WHERE id='${lineBrowserReserve}') <> 'ZZ browser source' THEN RAISE EXCEPTION 'browser/reserve race committed line mutation'; END IF; IF NOT EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id='${cmdBrowserReserve}') THEN RAISE EXCEPTION 'browser/reserve race lost reservation'; END IF; END $$; DROP TRIGGER aaa_upr_qbo_browser_reserve_pause ON public.invoice_line_items; DROP FUNCTION public.upr_qbo_browser_reserve_pause();`);
  // Two legitimate terminal finalizers must serialize and converge, never
  // deadlock or recreate a fence. The first removes it; terminal replay sees
  // released:false after it acquires the same lock sequence.
  psql(context, container, 'postgres', `${servicePrefix} INSERT INTO public.qbo_invoice_commands (id,invoice_id,action,actor_auth_user_id,initiator,realm_id,intent_hash,intent_payload,status,completed_at) VALUES ('c4000000-0000-4000-8000-000000000093','${invFinalizer}','save','${actor}','browser','realm-race',repeat('e',64),'{}','succeeded',now()); INSERT INTO public.qbo_invoice_command_reservations(invoice_id,command_id,action,actor_auth_user_id,initiator,realm_id) VALUES ('${invFinalizer}','c4000000-0000-4000-8000-000000000093','save','${actor}','browser','realm-race');`);
  const finalizerA = dockerAsync(context, psqlArgs(container, 'postgres', `${servicePrefix} BEGIN; SELECT public.release_qbo_invoice_command_reservation('c4000000-0000-4000-8000-000000000093','${invFinalizer}'); SELECT pg_sleep(1.0); COMMIT;`), 'terminal finalizer A');
  await new Promise((resolve) => setTimeout(resolve, 160));
  const finalizerB = await dockerAsync(context, psqlArgs(container, 'postgres', `${servicePrefix} SELECT public.release_qbo_invoice_command_reservation('c4000000-0000-4000-8000-000000000093','${invFinalizer}');`), 'terminal finalizer B');
  const finalizerAResult = await finalizerA;
  if (finalizerAResult.status !== 0 || finalizerB.status !== 0 || !/released/.test(finalizerB.stdout)) throw new Error(`terminal finalizers did not converge: A=${finalizerAResult.status}, B=${finalizerB.status}, ${finalizerB.stdout} ${finalizerB.stderr}`);

  // Reproduce the physical desktop UPDATE lock order in a true second session.
  // The owner role is intentional here: an active reservation makes the real
  // authenticated RLS path return zero rows before a lock can be taken. Bypassing
  // only that policy lets this disposable proof exercise the identical line row
  // and AFTER-trigger parent locks. The BEFORE sleep opens the exact window that
  // deadlocked when finalization used parent→line instead of line→parent.
  const frozen = JSON.stringify({
    line_id: lineFinalizer,
    preimage: { description: 'ZZ race source', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 10 },
    patch: { description: 'ZZ race finalized', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 2, unit_price: 10 },
  }).replaceAll("'", "''");
  psql(context, container, 'postgres', `${servicePrefix} INSERT INTO public.qbo_invoice_commands(id,invoice_id,action,actor_auth_user_id,initiator,realm_id,intent_hash,intent_payload,status,provider_result,provider_succeeded_at) VALUES ('${cmdLineFinalizer}','${invLineFinalizer}','save','${actor}','browser','realm-race',repeat('7',64),jsonb_build_object('action','save','line_update','${frozen}'::jsonb),'provider_succeeded','{"qbo_invoice_id":"qbo-race"}',now()); INSERT INTO public.qbo_invoice_command_reservations(invoice_id,command_id,action,actor_auth_user_id,initiator,realm_id) VALUES ('${invLineFinalizer}','${cmdLineFinalizer}','save','${actor}','browser','realm-race'); RESET ROLE; CREATE OR REPLACE FUNCTION public.upr_qbo_line_lock_race_pause() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN IF NEW.id='${lineFinalizer}'::uuid THEN PERFORM pg_sleep(1.0); END IF; RETURN NEW; END $$; CREATE TRIGGER aaa_upr_qbo_line_lock_race_pause BEFORE UPDATE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION public.upr_qbo_line_lock_race_pause();`);
  const desktopLine = dockerAsync(context, psqlArgs(container, 'postgres', `BEGIN; SET LOCAL statement_timeout='5s'; UPDATE public.invoice_line_items SET description='ZZ race source' WHERE id='${lineFinalizer}'; COMMIT;`), 'desktop line lock-order session');
  await new Promise((resolve) => setTimeout(resolve, 160));
  const lineFinalize = await dockerAsync(context, psqlArgs(container, 'postgres', `${servicePrefix} SET statement_timeout='5s'; SELECT public.finalize_qbo_invoice_line_update('${cmdLineFinalizer}','${invLineFinalizer}','${lineFinalizer}','${actor}',NULL,'browser','realm-race','ZZ race finalized',NULL,NULL,NULL,NULL,2,10);`), 'line finalizer lock-order session');
  const desktopLineResult = await desktopLine;
  if (desktopLineResult.status !== 0 || lineFinalize.status !== 0 || !/"applied": true/.test(lineFinalize.stdout)) throw new Error(`desktop/finalizer lock-order race failed: desktop=${desktopLineResult.status}, finalizer=${lineFinalize.status}, ${desktopLineResult.stderr} ${lineFinalize.stdout} ${lineFinalize.stderr}`);
  psql(context, container, 'postgres', 'DROP TRIGGER aaa_upr_qbo_line_lock_race_pause ON public.invoice_line_items; DROP FUNCTION public.upr_qbo_line_lock_race_pause();');
}
async function rollbackRefusalProof(context, container) {
  const runRollback = () => dockerAsync(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', `${INPUT}/${path.basename(ROLLBACK)}`], 'expected-refusal rollback');
  psql(context, container, 'postgres', `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations r WHERE r.command_id='c4000000-0000-4000-8000-000000000091')
       OR EXISTS (SELECT 1 FROM public.qbo_invoice_commands c WHERE c.id='c4000000-0000-4000-8000-000000000091') THEN
      RAISE EXCEPTION 'pre-ledger reservation refusal fixture is missing';
    END IF;
  END $$;`);
  const reserved = await runRollback();
  if (reserved.status === 0 || !/QBO_INVOICE_RESERVATIONS_ACTIVE/.test(reserved.stderr)) {
    throw new Error(`rollback did not refuse pre-ledger reservation: ${reserved.status}, ${reserved.stdout} ${reserved.stderr}`);
  }

  psql(context, container, 'postgres', `DELETE FROM public.qbo_invoice_command_reservations; DELETE FROM public.qbo_invoice_commands WHERE status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation'); INSERT INTO public.qbo_invoice_commands(id,invoice_id,action,actor_auth_user_id,initiator,realm_id,intent_hash,intent_payload,status) VALUES ('c4000000-0000-4000-8000-000000000095','c3000000-0000-4000-8000-000000000093','save','c9000000-0000-4000-8000-000000000001','browser','realm-race',repeat('8',64),'{}','prepared');`);
  const legacy = await runRollback();
  if (legacy.status === 0 || !/QBO_INVOICE_COMMANDS_ACTIVE/.test(legacy.stderr)) {
    throw new Error(`rollback did not refuse legacy active command: ${legacy.status}, ${legacy.stdout} ${legacy.stderr}`);
  }
  psql(context, container, 'postgres', `DELETE FROM public.qbo_invoice_commands WHERE status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation');`);
}
async function lineRollbackOrderRefusalProof(context, container) {
  const attempted = await dockerAsync(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', `${INPUT}/${path.basename(LINE_ROLLBACK)}`], 'expected wrong-order line rollback');
  if (attempted.status === 0 || !/INVOICE_LINE_ROLLBACK_ORDER/.test(attempted.stderr)) {
    throw new Error(`line rollback did not refuse while reservation migration remained installed: ${attempted.status}, ${attempted.stdout} ${attempted.stderr}`);
  }
}
function rollbackProof(context, container) {
  psql(context, container, 'postgres', `DO $$ BEGIN
    IF to_regclass('public.qbo_invoice_command_reservations') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained reservation table'; END IF;
    IF to_regprocedure('public.reserve_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained reserve RPC'; END IF;
    IF to_regprocedure('public.stage_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained stage RPC'; END IF;
    IF to_regprocedure('public.finalize_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained finalizer RPC'; END IF;
    IF to_regprocedure('public.invoice_line_qbo_write_access(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained line policy helper'; END IF;
    IF to_regprocedure('public.guard_invoice_line_write_during_qbo_command()') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained line write guard'; END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.invoices'::regclass AND tgname='trg_invoices_guard_qbo_command_lock') THEN RAISE EXCEPTION 'rollback retained lock trigger'; END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.invoice_line_items'::regclass AND tgname='trg_invoice_lines_guard_qbo_command_write') THEN RAISE EXCEPTION 'rollback retained line write trigger'; END IF;
  END $$;` , true);
}
function lineRollbackProof(context, container) {
  psql(context, container, 'postgres', `DO $$ BEGIN
    IF to_regprocedure('public.mark_invoice_line_revision_draft()') IS NOT NULL THEN RAISE EXCEPTION 'line rollback retained revision trigger function'; END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.invoice_line_items'::regclass AND tgname='trg_invoice_lines_revision_draft') THEN RAISE EXCEPTION 'line rollback retained revision trigger'; END IF;
  END $$;`, true);
}
function removeDisposableProject(context, project) {
  const ids = docker(context, ['ps', '-aq', '--filter', `name=${project}`], 'disposable container listing', true).trim().split(/\s+/).filter(Boolean);
  if (ids.length) docker(context, ['rm', '-f', ...ids], 'disposable container removal', true);
}
async function main(argv = process.argv.slice(2)) {
  const iterate = argv.length === 1 && argv[0] === '--iterate'; if (argv.length && !iterate) throw new Error('only --iterate is accepted');
  const before = hashes(); const commit = iterate ? null : receiptCommit();
  if (!fs.existsSync(BIN) || run(BIN, ['--version'], 'Supabase CLI version', true).trim() !== '2.111.0') throw new Error('project Supabase CLI 2.111.0 is required');
  const context = localContext(); const project = `uprqbores-${process.pid}-${randomUUID().slice(0,8)}`; const container = `supabase_db_${project}`;
  fs.mkdirSync(CACHE, { recursive: true }); const workdir = fs.mkdtempSync(path.join(CACHE, 'cycle-')); let started = false;
  try {
    writeConfig(workdir, project); run(BIN, ['start','--workdir',workdir,'--yes'], 'disposable local Supabase start', true, { DOCKER_CONTEXT: context }); started = true;
    psql(context, container, 'supabase_admin', 'GRANT supabase_admin TO postgres;'); psql(context, container, 'postgres', 'DROP SCHEMA public CASCADE;');
    docker(context, ['exec',container,'mkdir','-p',INPUT], 'input directory'); for (const input of INPUTS) docker(context, ['cp',path.join(ROOT,input),`${container}:${INPUT}/${path.basename(input)}`], 'copy input');
    const inside = (input) => `${INPUT}/${path.basename(input)}`;
    psqlFile(context,container,inside(BASELINE)); for (const prior of PREDECESSORS) psqlFile(context,container,inside(prior)); psqlFile(context,container,inside(LINE_MIGRATION)); psqlFile(context,container,inside(MIGRATION)); psqlFile(context,container,inside(PROOF),true); await raceProof(context,container); await lineRollbackOrderRefusalProof(context,container); await rollbackRefusalProof(context,container);
    psqlFile(context,container,inside(ROLLBACK)); rollbackProof(context,container); psqlFile(context,container,inside(LINE_ROLLBACK)); lineRollbackProof(context,container);
    psqlFile(context,container,inside(LINE_MIGRATION)); psqlFile(context,container,inside(MIGRATION)); psqlFile(context,container,inside(PROOF),true);
    process.stdout.write('QBO invoice command reservation local qualification cycle passed.\n');
  } finally {
    if (started) { try { removeDisposableProject(context, project); } catch {} }
    fs.rmSync(workdir,{recursive:true,force:true});
  }
  const after = hashes(); if (JSON.stringify(before)!==JSON.stringify(after)) throw new Error('qualification inputs changed during execution');
  if (iterate) return process.stdout.write('iterate mode: no commit-bound receipt issued (inputs are not commit-bound).\n');
  if (receiptCommit() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({schema:'upr-qbo-invoice-command-reservation-local-qualification-v1',commit_sha:commit,inputs:Object.fromEntries(after)})}\n`);
}
main().catch((error) => { process.stderr.write(`QBO invoice command reservation local qualification refused: ${error.message}\n`); process.exitCode = 2; });
