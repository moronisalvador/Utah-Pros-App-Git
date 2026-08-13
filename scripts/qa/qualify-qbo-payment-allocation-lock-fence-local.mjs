/**
 * ════════════════════════════════════════════════
 * FILE: qualify-qbo-payment-allocation-lock-fence-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a disposable local Supabase stack and proves the grouped-payment
 *   allocation fence, concurrent lock behavior, rollback, and clean reapply.
 *   It removes the temporary stack and files when the cycle ends.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins, local Supabase CLI, local Docker
 *   Internal:  safe-child-env.mjs; baseline, migration, rollback, and SQL proof files
 *   Data:      reads  → repository SQL inputs and disposable local PostgreSQL rows
 *              writes → disposable local PostgreSQL only; never hosted Supabase
 *
 * NOTES / GOTCHAS:
 *   - Refuses a non-local Docker socket. Normal mode requires clean tracked
 *     inputs and emits a commit receipt; --iterate is for dirty authoring work
 *     and deliberately emits no commit-bound receipt.
 * ════════════════════════════════════════════════
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { safeChildEnv } from './safe-child-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(ROOT, 'node_modules', '.bin', 'supabase');
const CACHE = path.join(os.homedir(), '.cache', 'upr-qbo-payment-allocation-lock-fence-local');
const INPUT = '/tmp/upr-qbo-payment-allocation-fence-inputs';
const BASELINE = 'db/baseline/schema.sql';
const PREDECESSORS = [
  'supabase/migrations/20260730150000_oop_pricing_builder.sql',
  'supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql',
  'supabase/migrations/20260731231000_qbo_receipt_service_grant_containment.sql',
  'supabase/migrations/20260731180000_qbo_estimate_conversion_concurrency.sql',
  'supabase/migrations/20260731210000_qbo_invoice_command_ledger.sql',
  'supabase/migrations/20260803192344_oop_quote_to_estimate.sql',
  'supabase/migrations/20260804120100_billing_editor_role_boundary.sql',
  'supabase/migrations/20260805010000_qbo_receipt_service_role_check_repair.sql',
  'supabase/migrations/20260808070000_payments_qbo_realm_scoping.sql',
];
const LINE = 'supabase/migrations/20260810010000_invoice_line_edit_lock_boundary.sql';
const COMMAND = 'supabase/migrations/20260810020000_qbo_invoice_command_reservation.sql';
const MIGRATION = 'supabase/migrations/20260810030000_qbo_payment_allocation_lock_fence.sql';
const ROLLBACK = 'supabase/rollbacks/20260810030000_qbo_payment_allocation_lock_fence.rollback.sql';
const PROOF = 'supabase/tests/qbo_payment_allocation_lock_fence_isolated.sql';
const INPUTS = [BASELINE, ...PREDECESSORS, LINE, COMMAND, MIGRATION, ROLLBACK, PROOF];
const hash = (value) => createHash('sha256').update(value).digest('hex');
function run(command, args, label, quiet = false, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env: { ...safeChildEnv(process.env), ...extraEnv }, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'] });
  if (result.error || result.status !== 0) {
    const detail = (result.error?.message || result.stderr || '').trim();
    throw new Error(`${label} failed: ${detail.slice(-2000)}`);
  }
  return result.stdout || '';
}
function asyncRun(command, args, label) { return new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: ROOT, encoding: 'utf8', env: safeChildEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; let err = '';
  child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; }); child.once('error', reject); child.once('close', (status) => resolve({ status, out, err, label }));
}); }
const docker = (context, args, label, quiet = false) => run('docker', ['--context', context, ...args], label, quiet);
const sqlArgs = (container, sql, isolated = false) => ['exec', ...(isolated ? ['-e', 'PGOPTIONS=-cupr.isolated_test_database=on'] : []), container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', sql];
const sql = (context, container, statement, isolated = false) => docker(context, sqlArgs(container, statement, isolated), 'psql');
const sqlAsync = (context, container, statement) => asyncRun('docker', ['--context', context, ...sqlArgs(container, statement)], 'concurrent psql');
const service = "SET ROLE service_role; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',false);";
function hashes() { return INPUTS.map((input) => [input, hash(fs.readFileSync(path.join(ROOT, input)))]); }
function receipt(iterate) {
  if (iterate) return null;
  for (const input of INPUTS) run('git', ['ls-files', '--error-unmatch', '--', input], 'tracked input', true);
  if (run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...INPUTS], 'clean input', true).trim()) throw new Error('qualification inputs are dirty; use --iterate while authoring');
  return run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], 'commit receipt', true).trim();
}
function localContext() {
  const context = run('docker', ['context', 'show'], 'docker context', true).trim(); const raw = run('docker', ['--context', context, 'context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'], 'docker context inspect', true).trim();
  const endpoint = JSON.parse(raw); if (!endpoint.startsWith('unix://') || !fs.statSync(endpoint.slice(7)).isSocket()) throw new Error('refusing non-local Docker context'); return context;
}
function config(workdir, project) { const port = 50000 + ((process.pid % 1000) * 10); fs.mkdirSync(path.join(workdir, 'supabase'), { recursive: true }); fs.writeFileSync(path.join(workdir, 'supabase/config.toml'), `project_id = "${project}"\n[api]\nport = ${port + 1}\n[db]\nport = ${port + 2}\nshadow_port = ${port}\nmajor_version = 17\n[studio]\nport = ${port + 3}\n[local_smtp]\nport = ${port + 4}\n[analytics]\nport = ${port + 7}\n`); }
async function races(context, container) {
  const job = 'd2000000-0000-4000-8000-000000000001'; const contact = 'd1000000-0000-4000-8000-000000000001'; const a = 'd3000000-0000-4000-8000-000000000001'; const b = 'd3000000-0000-4000-8000-000000000002'; const c = 'd3000000-0000-4000-8000-000000000003'; const d = 'd3000000-0000-4000-8000-000000000004';
  sql(context, container, `INSERT INTO public.contacts(id,phone,qbo_customer_id) VALUES('${contact}','+15550000001','customer-fence'); INSERT INTO public.jobs(id) VALUES('${job}'); INSERT INTO public.invoices(id,job_id,contact_id,invoice_number,status,invoice_type,total,qbo_invoice_id) VALUES('${a}','${job}','${contact}','FENCE-A','saved','standard',0,'qbo-a'),('${b}','${job}','${contact}','FENCE-B','saved','standard',0,'qbo-b'),('${c}','${job}','${contact}','FENCE-C','saved','standard',0,'qbo-c'),('${d}','${job}','${contact}','FENCE-D','saved','standard',0,'qbo-d');`);
  // READ COMMITTED proof: manual UPDATE starts while reservation holds row;
  // after reservation commits its trigger must observe the newly committed fence.
  const reserve = sqlAsync(context, container, `${service} BEGIN; SELECT public.reserve_qbo_payment_receipt('fence-read-committed','ir-1','realm-fence',repeat('a',64),jsonb_build_object('contact_id','${contact}','allocations',jsonb_build_array(jsonb_build_object('invoice_id','${a}','amount_cents',100))),NULL); SELECT pg_sleep(1); COMMIT;`);
  await new Promise((r) => setTimeout(r, 150)); const lock = sqlAsync(context, container, `BEGIN; UPDATE public.invoices SET locked=true WHERE id='${a}'; COMMIT;`); const [reserveResult, lockResult] = await Promise.all([reserve, lock]);
  if (reserveResult.status !== 0 || lockResult.status === 0 || !/INVOICE_PAYMENT_ALLOCATION_IN_FLIGHT/.test(lockResult.err)) throw new Error(`READ COMMITTED fence race failed: ${reserveResult.err} ${lockResult.err}`);
  const manualFirst = sqlAsync(context, container, `BEGIN; UPDATE public.invoices SET locked=true WHERE id='${b}'; SELECT pg_sleep(1); COMMIT;`); await new Promise((r) => setTimeout(r, 150)); const reserveAfter = await sqlAsync(context, container, `${service} SELECT public.reserve_qbo_payment_receipt('fence-manual-first','ir-2','realm-fence',repeat('b',64),jsonb_build_object('contact_id','${contact}','allocations',jsonb_build_array(jsonb_build_object('invoice_id','${b}','amount_cents',100))),NULL);`); const manualResult = await manualFirst;
  if (manualResult.status !== 0 || reserveAfter.status === 0 || !/INVOICE_LOCKED/.test(reserveAfter.err)) throw new Error(`manual-first reservation race failed: ${reserveAfter.out} ${reserveAfter.err}`);
  // Two inverse-order multi-invoice finalizer/reconciliation calls must wait,
  // not deadlock: their replacement bodies lock UUID order before projections.
  const definition = run('docker', ['--context', context, 'exec', container, 'psql', '-At', '-U', 'postgres', '-d', 'postgres', '-c', "SELECT pg_get_functiondef('public.finalize_qbo_payment_receipt(uuid,jsonb,jsonb)'::regprocedure)"], 'finalizer definition', true);
  if (!/lock_qbo_payment_allocation_invoices\(p_allocations\)/.test(definition)) throw new Error('finalizer replacement body did not install ordered update locking');
  const receipt = (payment, total) => `jsonb_build_object('qbo_realm_id','realm-fence','qbo_customer_id','customer-fence','qbo_payment_id','${payment}','total_cents',${total},'applied_cents',${total},'unapplied_cents',0,'txn_date','2026-08-10','source','qbo','normalized_snapshot','{}'::jsonb)`;
  const allocation = (items) => `jsonb_build_array(${items.map(([id, qbo]) => `jsonb_build_object('invoice_id','${id}','qbo_invoice_id','${qbo}','amount_cents',100)`).join(',')})`;
  sql(context, container, `INSERT INTO public.payment_receipt_attempts(id,client_request_id,intuit_request_id,qbo_realm_id,request_fingerprint,request_payload,status,qbo_payment_id) VALUES ('d4000000-0000-4000-8000-000000000001','finalizer-a','ir-fa','realm-fence',repeat('e',64),'{}','qbo_created','pay-final-a'),('d4000000-0000-4000-8000-000000000002','finalizer-b','ir-fb','realm-fence',repeat('f',64),'{}','qbo_created','pay-final-b'),('d4000000-0000-4000-8000-000000000003','finalizer-manual','ir-fm','realm-fence',repeat('1',64),'{}','qbo_created','pay-final-m');`);
  const finalA = sqlAsync(context, container, `${service} BEGIN; SELECT public.finalize_qbo_payment_receipt('d4000000-0000-4000-8000-000000000001',${receipt('pay-final-a', 200)},${allocation([[a, 'qbo-a'], [c, 'qbo-c']])}); SELECT pg_sleep(1); COMMIT;`); await new Promise((r) => setTimeout(r, 150)); const finalB = sqlAsync(context, container, `${service} SELECT public.finalize_qbo_payment_receipt('d4000000-0000-4000-8000-000000000002',${receipt('pay-final-b', 200)},${allocation([[c, 'qbo-c'], [a, 'qbo-a']])});`); const [finalAResult, finalBResult] = await Promise.all([finalA, finalB]);
  if (finalAResult.status !== 0 || finalBResult.status !== 0) throw new Error(`opposite-order multi-invoice finalizers deadlocked or failed: ${finalAResult.err} ${finalBResult.err}`);
  const finalManual = sqlAsync(context, container, `${service} BEGIN; SELECT public.finalize_qbo_payment_receipt('d4000000-0000-4000-8000-000000000003',${receipt('pay-final-m', 100)},${allocation([[d, 'qbo-d']])}); SELECT pg_sleep(1); COMMIT;`); await new Promise((r) => setTimeout(r, 150)); const manualDuringFinal = await sqlAsync(context, container, `BEGIN; UPDATE public.invoices SET locked=true WHERE id='${d}'; COMMIT;`); const finalManualResult = await finalManual;
  if (finalManualResult.status !== 0 || manualDuringFinal.status !== 0) throw new Error(`finalizer/manual-lock race deadlocked or failed: ${finalManualResult.err} ${manualDuringFinal.err}`);
  // Clear the durable reservation created by the READ COMMITTED race. Its
  // presence is the race assertion, not input to the rollback refusal cases.
  sql(context, container, "UPDATE public.payment_receipt_attempts SET status='rejected' WHERE client_request_id='fence-read-committed';");
}
function rollbackProof(context, container) {
  const fence = `${service} SELECT public.reserve_qbo_payment_receipt('rollback-fenced','ir-r1','realm-fence',repeat('c',64),jsonb_build_object('contact_id','d1000000-0000-4000-8000-000000000001','allocations',jsonb_build_array(jsonb_build_object('invoice_id','d3000000-0000-4000-8000-000000000003','amount_cents',100))),NULL);`;
  sql(context, container, fence); const fenced = spawnSync('docker', ['--context', context, ...sqlArgs(container, `\\i ${INPUT}/${path.basename(ROLLBACK)}`)], { encoding: 'utf8' }); if (fenced.status === 0 || !/nonterminal payment attempt remains/.test(fenced.stderr)) throw new Error('rollback did not refuse fenced active attempt');
  sql(context, container, "UPDATE public.payment_receipt_attempts SET status='rejected' WHERE client_request_id='rollback-fenced'; INSERT INTO public.payment_receipt_attempts(client_request_id,intuit_request_id,qbo_realm_id,request_fingerprint,request_payload,status) VALUES('rollback-legacy','ir-r2','realm-fence',repeat('d',64),'{}','unknown_outcome');"); const legacy = spawnSync('docker', ['--context', context, ...sqlArgs(container, `\\i ${INPUT}/${path.basename(ROLLBACK)}`)], { encoding: 'utf8' }); if (legacy.status === 0 || !/nonterminal payment attempt remains/.test(legacy.stderr)) throw new Error('rollback did not refuse unfenced legacy active attempt');
  sql(context, container, "UPDATE public.payment_receipt_attempts SET status='rejected' WHERE client_request_id='rollback-legacy';"); docker(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', `${INPUT}/${path.basename(ROLLBACK)}`], 'rollback');
}
async function main() {
  const iterate = process.argv.length === 3 && process.argv[2] === '--iterate'; if (process.argv.length > 2 && !iterate) throw new Error('only --iterate is accepted'); const before = hashes(); const commit = receipt(iterate);
  // Keep the pinned CLI's established local state layout. Supplying a fresh
  // SUPABASE_HOME makes CLI 2.111.0 bind-mount an empty start-secrets
  // directory over pgsodium_root.key, preventing the disposable DB from
  // becoming healthy. The project workdir remains unique and disposable.
  const cliEnv = { SUPABASE_TELEMETRY_DISABLED: '1' };
  let context; let project; let container; let workdir;
  try {
    if (!fs.existsSync(BIN) || run(BIN, ['--version'], 'Supabase CLI version', true, cliEnv).trim() !== '2.111.0') throw new Error('project Supabase CLI 2.111.0 is required');
    context = localContext(); project = `uprqbofence-${process.pid}-${randomUUID().slice(0, 8)}`; container = `supabase_db_${project}`;
    // Colima shares /Users into its VM, but not macOS's /var/folders temp
    // hierarchy. Keep Docker bind-mount sources under the user cache so the
    // CLI-created pgsodium key remains a file inside the VM.
    fs.mkdirSync(CACHE, { recursive: true }); workdir = fs.mkdtempSync(path.join(CACHE, 'cycle-'));
    config(workdir, project); run(BIN, ['start', '--workdir', workdir, '--yes'], 'local Supabase start', true, { ...cliEnv, DOCKER_CONTEXT: context });
    docker(context, ['exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-c', 'GRANT supabase_admin TO postgres;'], 'local postgres membership setup');
    sql(context, container, 'DROP SCHEMA public CASCADE;'); docker(context, ['exec', container, 'mkdir', '-p', INPUT], 'input directory'); for (const input of INPUTS) docker(context, ['cp', path.join(ROOT, input), `${container}:${INPUT}/${path.basename(input)}`], 'copy input'); const inside = (input) => `${INPUT}/${path.basename(input)}`; for (const input of [BASELINE, ...PREDECESSORS, LINE, COMMAND, MIGRATION, PROOF]) docker(context, ['exec', '-e', 'PGOPTIONS=-cupr.isolated_test_database=on', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', inside(input)], 'apply local input'); await races(context, container); rollbackProof(context, container); for (const input of [MIGRATION, PROOF]) docker(context, ['exec', '-e', 'PGOPTIONS=-cupr.isolated_test_database=on', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', inside(input)], 'clean reapply');
  } finally {
    try { if (context && project) { const ids = docker(context, ['ps', '-aq', '--filter', `name=${project}`], 'container listing', true).trim().split(/\s+/).filter(Boolean); if (ids.length) docker(context, ['rm', '-f', ...ids], 'container cleanup', true); } } catch {}
    if (workdir) fs.rmSync(workdir, { recursive: true, force: true });
  }
  const after = hashes(); if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution'); if (iterate) return process.stdout.write('iterate mode: no commit-bound receipt issued (inputs are not commit-bound).\n'); if (receipt(false) !== commit) throw new Error('qualification commit changed during local execution'); process.stdout.write(`${JSON.stringify({ schema: 'upr-qbo-payment-allocation-lock-fence-local-qualification-v1', commit_sha: commit, inputs: Object.fromEntries(after) })}\n`);
}
main().catch((error) => { process.stderr.write(`QBO payment allocation fence local qualification refused: ${error.message}\n`); process.exitCode = 2; });
