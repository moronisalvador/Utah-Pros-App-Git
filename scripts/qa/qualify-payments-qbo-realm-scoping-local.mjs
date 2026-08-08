/**
 * ════════════════════════════════════════════════
 * FILE: qualify-payments-qbo-realm-scoping-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a throwaway copy of the database on this machine, loads the saved
 *   schema, replays the seven real earlier changes in the order production
 *   applied them, records which QuickBooks company each payment came from,
 *   checks that a payment from one company can no longer be deleted by a
 *   look-alike number from a different company, undoes the change, checks the
 *   undo really did put things back, applies it again, and then deletes the
 *   whole throwaway copy. Nothing it does can reach the real Utah Pros database.
 *
 * DEPENDS ON:
 *   Packages:  Node built-ins, project-pinned Supabase CLI 2.111.0, Docker
 *   Internal:  ./safe-child-env.mjs, db/baseline/schema.sql, the seven
 *              predecessors named below, the paired 20260808070000
 *              migration/rollback, the committed seed, and the two proofs
 *
 * NOTES / GOTCHAS:
 *   - Refuses to run against anything but a local Docker socket, and refuses if
 *     its own inputs are dirty, so a receipt always names an exact commit.
 *     `--iterate` waives the clean-tree refusal and issues NO receipt; use it
 *     while authoring, never as evidence.
 *   - The seed runs TWICE, once either side of the migration, and is the only
 *     thing here that COMMITS. Both proofs roll back. See the seed's header for
 *     why two claims are unprovable without it.
 *   - It proves DATABASE behaviour on a synthetic clone. It proves nothing about
 *     any screen, any Worker, or any deployment.
 * ════════════════════════════════════════════════
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { safeChildEnv } from './safe-child-env.mjs';

export const SUPABASE_CLI_VERSION = '2.111.0';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUPABASE_BIN = path.join(ROOT, 'node_modules', '.bin', 'supabase');
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'upr-payments-qbo-realm-scoping-local');
const CONTAINER_ROOT = '/tmp/upr-payments-qbo-realm-scoping-local';

const MIGRATION = 'supabase/migrations/20260808070000_payments_qbo_realm_scoping.sql';
const ROLLBACK = 'supabase/rollbacks/20260808070000_payments_qbo_realm_scoping.rollback.sql';
const PROOF = 'supabase/tests/payments_qbo_realm_scoping.test.sql';
const ROLLBACK_PROOF = 'supabase/tests/payments_qbo_realm_scoping.rollback.test.sql';
const SEED = 'supabase/tests/payments_qbo_realm_scoping.seed.sql';
const BASELINE = 'db/baseline/schema.sql';

// This migration REPLACES the bodies of finalize_qbo_payment_receipt and
// reconcile_qbo_payment_receipt, so the baseline alone is not a truthful
// predecessor: db/baseline/schema.sql has no receipt machinery at all, and
// applying this on the bare baseline would fail at `function ... does not exist`.
//
// The lineage is the SEVEN migrations production actually applied, replayed in
// LEDGER order — which is NOT the order their filename timestamps sort in, so
// the list below is deliberately not sorted. Reconstructing only the receipt
// machinery would qualify against a `payments` table whose policies and billing
// predicate production has not had since 2026-08-05.
//
//   20260731175328  oop_pricing_builder                   -> oop_quote_pricing_snapshots,
//                                                            required by oop_quote_to_estimate
//   20260731225654  qbo_multi_invoice_payment_receipts    -> CREATES payment_receipts,
//                                                            payment_receipt_attempts,
//                                                            payment_receipt_events,
//                                                            payments.receipt_id, the
//                                                            payments_billing_* policies, the
//                                                            receipt-link triggers, and both
//                                                            functions in their first form
//   20260731230907  qbo_receipt_service_grant_containment -> contains the managed-default
//                                                            service_role grant drift
//   20260803224628  oop_quote_to_estimate                 -> CREATES billing_edit_access()
//   20260805014242  billing_editor_role_boundary          -> WIDENS that predicate and
//                                                            REPLACES the payments policies
//                                                            from 20260731225654
//   20260805031844  estimate_create_rpc_billing_boundary  -> carried for lineage fidelity;
//                                                            touches nothing here
//   20260806034004  qbo_receipt_service_role_check_repair -> replaces both bodies with the
//                                                            auth.role() gate. MUST BE LAST:
//                                                            it defines the exact bodies this
//                                                            migration replaces and the exact
//                                                            bodies the rollback restores, so
//                                                            applying it out of order would
//                                                            qualify against bodies production
//                                                            does not have.
const PREDECESSORS = Object.freeze([
  'supabase/migrations/20260730150000_oop_pricing_builder.sql',
  'supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql',
  'supabase/migrations/20260731231000_qbo_receipt_service_grant_containment.sql',
  'supabase/migrations/20260803192344_oop_quote_to_estimate.sql',
  'supabase/migrations/20260804120100_billing_editor_role_boundary.sql',
  'supabase/migrations/20260805020000_estimate_create_rpc_billing_boundary.sql',
  'supabase/migrations/20260805010000_qbo_receipt_service_role_check_repair.sql',
]);

export const QUALIFICATION_INPUTS = Object.freeze([
  BASELINE, ...PREDECESSORS, MIGRATION, ROLLBACK, SEED, PROOF, ROLLBACK_PROOF,
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function run(command, args, { quiet = false, label = 'command', extraEnv = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...safeChildEnv(process.env), ...extraEnv },
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || '').trim().slice(0, 400)}`);
  return result.stdout || '';
}

const docker = (context, args, options) => run('docker', ['--context', context, ...args], options);

export function assertLocalDockerEndpoint(name, endpoint, { stat = fs.statSync, platform = process.platform } = {}) {
  if (typeof endpoint !== 'string' || !endpoint) throw new Error('Docker context endpoint is unreadable');
  if (platform === 'win32' && endpoint.startsWith('npipe://')) return { name, endpoint };
  if (!endpoint.startsWith('unix://')) throw new Error(`refusing non-local Docker endpoint: ${endpoint}`);
  const socket = endpoint.slice('unix://'.length);
  let info;
  try { info = stat(socket); } catch { throw new Error('Docker socket does not exist on this machine'); }
  if (!info.isSocket()) throw new Error('Docker endpoint is not a socket');
  return { name, endpoint };
}

function verifyLocalDockerContext() {
  const name = run('docker', ['context', 'show'], { quiet: true, label: 'Docker context selection' }).trim();
  const raw = run('docker', ['--context', name, 'context', 'inspect', name, '--format', '{{json .Endpoints.docker.Host}}'], { quiet: true, label: 'Docker context inspection' }).trim();
  let endpoint;
  try { endpoint = JSON.parse(raw); } catch { throw new Error('Docker context endpoint could not be decoded'); }
  return assertLocalDockerEndpoint(name, endpoint);
}

function assertProjectCli() {
  if (!fs.existsSync(SUPABASE_BIN)) throw new Error('project Supabase CLI is missing; run npm ci first');
  const version = run(SUPABASE_BIN, ['--version'], { quiet: true, label: 'project Supabase CLI' }).trim();
  if (version !== SUPABASE_CLI_VERSION) throw new Error(`project Supabase CLI ${version} differs from the reviewed pin ${SUPABASE_CLI_VERSION}`);
}

export function assertCleanQualificationStatus(status) {
  if (status.trim()) throw new Error('qualification inputs are dirty; commit or stash them so the receipt names an exact commit');
}

function qualificationCommitSha() {
  for (const relative of QUALIFICATION_INPUTS) {
    run('git', ['ls-files', '--error-unmatch', '--', relative], { quiet: true, label: 'qualification tracked-input check' });
  }
  assertCleanQualificationStatus(run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...QUALIFICATION_INPUTS], { quiet: true, label: 'qualification input status' }));
  const sha = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { quiet: true, label: 'qualification commit identity' }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('qualification commit identity is invalid');
  return sha;
}

function inputHashes() {
  return QUALIFICATION_INPUTS.map((relative) => [relative, sha256(fs.readFileSync(path.join(ROOT, relative)))]);
}

function writeConfig(workdir, projectId, ports) {
  const supabase = path.join(workdir, 'supabase');
  fs.mkdirSync(supabase, { recursive: true });
  // Everything except the database is switched OFF. This proof is psql-only, so
  // Studio, Realtime, Analytics, Storage and the API add nothing but startup
  // time and failure modes. Measured, not assumed: the first run of THIS harness
  // died in the analytics/realtime health check without reaching a single line
  // of SQL — the identical failure qualify-oop-estimate-grouped-lines-local.mjs
  // records. Disabling the GoTrue container does not remove the auth.role() /
  // auth.uid() SQL functions the gates read; those come from the CLI's own init.
  fs.writeFileSync(path.join(supabase, 'config.toml'), [
    '# Generated disposable local-only qualification configuration.',
    `project_id = "${projectId}"`,
    '', '[api]', 'enabled = false', `port = ${ports.api}`,
    '', '[db]', `port = ${ports.db}`, `shadow_port = ${ports.shadow}`, 'major_version = 17',
    '', '[db.seed]', 'enabled = false',
    '', '[studio]', 'enabled = false', `port = ${ports.studio}`,
    '', '[local_smtp]', `port = ${ports.smtp}`,
    '', '[auth]', 'enabled = false', 'site_url = "http://127.0.0.1:4173"', 'additional_redirect_urls = ["http://127.0.0.1:4173"]',
    '', '[realtime]', 'enabled = false',
    '', '[storage]', 'enabled = false',
    '', '[analytics]', 'enabled = false', `port = ${ports.analytics}`, '',
  ].join('\n'));
}

function psql(context, container, role, args, { isolated = false } = {}) {
  const command = ['exec'];
  if (isolated) command.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  command.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'postgres', ...args);
  docker(context, command, { label: `local container psql (${role})` });
}

function createNetwork(context) {
  const name = `upr-money-read-${process.pid}-${randomUUID().slice(0, 8)}`;
  docker(context, ['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', name], { quiet: true, label: 'disposable loopback Docker network' });
  const binding = docker(context, ['network', 'inspect', '--format', '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}', name], { quiet: true, label: 'disposable network inspection' }).trim();
  if (binding !== '127.0.0.1') {
    try { docker(context, ['network', 'rm', name], { quiet: true, label: 'disposable network removal' }); } catch { /* keep the primary refusal */ }
    throw new Error('disposable Docker network is not bound exactly to 127.0.0.1');
  }
  return name;
}

function assertDisposableDatabaseContainer(context, container, projectId, network) {
  const labelsJson = docker(context, ['inspect', '--format', '{{json .Config.Labels}}', container], { quiet: true, label: 'disposable database label inspection' }).trim();
  const networksJson = docker(context, ['inspect', '--format', '{{json .NetworkSettings.Networks}}', container], { quiet: true, label: 'disposable database network inspection' }).trim();
  const networkId = docker(context, ['network', 'inspect', '--format', '{{.Id}}', network], { quiet: true, label: 'disposable network identity' }).trim();
  let labels; let networks;
  try { labels = JSON.parse(labelsJson); networks = JSON.parse(networksJson); } catch { throw new Error('disposable database identity could not be decoded'); }
  if (labels?.['com.supabase.cli.project'] !== projectId) throw new Error('database container is not labeled for this disposable project');
  if (networks?.[network]?.NetworkID !== networkId) throw new Error('database container is not attached to the verified disposable network');
}

function runCycle(context, ports) {
  const projectId = `uprmr-${process.pid}-${randomUUID().slice(0, 8)}`;
  const container = `supabase_db_${projectId}`;
  const workdir = fs.mkdtempSync(path.join(CACHE_ROOT, 'cycle-'));
  const network = createNetwork(context);
  let started = false;
  try {
    writeConfig(workdir, projectId, ports);
    run(SUPABASE_BIN, ['start', '--network-id', network, '--workdir', workdir, '--yes'], { quiet: true, label: 'local Supabase start', extraEnv: { DOCKER_CONTEXT: context } });
    started = true;
    assertDisposableDatabaseContainer(context, container, projectId, network);

    psql(context, container, 'supabase_admin', ['-c', 'GRANT supabase_admin TO postgres;']);
    psql(context, container, 'postgres', ['-c', 'DROP SCHEMA public CASCADE;']);
    docker(context, ['exec', container, 'mkdir', '-p', `${CONTAINER_ROOT}/inputs`], { quiet: true, label: 'create disposable input directory' });
    for (const relative of QUALIFICATION_INPUTS) {
      docker(context, ['cp', path.join(ROOT, relative), `${container}:${CONTAINER_ROOT}/inputs/${path.basename(relative)}`], { quiet: true, label: 'copy into disposable container' });
    }

    const base = (relative) => `${CONTAINER_ROOT}/inputs/${path.basename(relative)}`;
    psql(context, container, 'postgres', ['-f', base(BASELINE)]);
    for (const predecessor of PREDECESSORS) psql(context, container, 'postgres', ['-f', base(predecessor)]);
    // Seed pass 1: COMMITS a payments row while the column still does not exist,
    // so the forward proof can show the migration backfills nothing.
    psql(context, container, 'postgres', ['-f', base(SEED)], { isolated: true });
    psql(context, container, 'postgres', ['-f', base(MIGRATION)]);
    // Seed pass 2: COMMITS one realm-stamped projection, so the rollback proof
    // can show already-written realms survive. Same file; it picks its own phase
    // from whether the column exists, so the runner passes no arguments.
    psql(context, container, 'postgres', ['-f', base(SEED)], { isolated: true });
    psql(context, container, 'postgres', ['-f', base(PROOF)], { isolated: true });
    psql(context, container, 'postgres', ['--single-transaction', '-f', base(ROLLBACK)]);
    psql(context, container, 'postgres', ['-f', base(ROLLBACK_PROOF)], { isolated: true });
    psql(context, container, 'postgres', ['-f', base(MIGRATION)]);
    psql(context, container, 'postgres', ['-f', base(PROOF)], { isolated: true });
    process.stdout.write('QBO payments realm-scoping local qualification cycle passed.\n');
  } finally {
    const errors = [];
    if (started) {
      try { psql(context, container, 'supabase_admin', ['-c', 'REVOKE supabase_admin FROM postgres;']); } catch (error) { errors.push(error); }
      try { run(SUPABASE_BIN, ['stop', '--no-backup', '--workdir', workdir], { quiet: true, label: 'local Supabase stop', extraEnv: { DOCKER_CONTEXT: context } }); } catch (error) { errors.push(error); }
    }
    try { docker(context, ['network', 'rm', network], { quiet: true, label: 'disposable network removal' }); } catch (error) { errors.push(error); }
    if (errors.length) throw new Error(`local cleanup failed; preserved ${workdir}: ${errors.map((e) => e.message).join('; ')}`);
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const iterate = argv.length === 1 && argv[0] === '--iterate';
  if (argv.length && !iterate) throw new Error('this local-only qualification accepts no arguments except --iterate');

  const before = inputHashes();
  const commit = iterate ? null : qualificationCommitSha();
  assertProjectCli();
  const dockerContext = verifyLocalDockerContext();
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  // Ports are deliberately distinct from every sibling qualifier so two proofs
  // can run without colliding on a shared machine. 55420/30/40/50/60/70 are all
  // taken (appointment-crew x2, invoice-activity, billing-boundary +
  // estimate-create, office-financial-read + oop-grouped-lines,
  // overview-financials-grant), so this block is 55480-55487.
  runCycle(dockerContext.name, { api: 55481, db: 55482, shadow: 55480, studio: 55483, smtp: 55484, analytics: 55487 });
  const after = inputHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');

  if (iterate) {
    // A migration should be executed BEFORE it is committed. An iterate run is
    // real qualification of an uncommitted tree, so it deliberately issues no
    // receipt — there is no commit to bind one to.
    process.stdout.write('iterate mode: no receipt issued (inputs are not commit-bound).\n');
    return;
  }
  if (qualificationCommitSha() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({
    schema: 'upr-payments-qbo-realm-scoping-local-qualification-v1',
    commit_sha: commit,
    cli_version: SUPABASE_CLI_VERSION,
    manifest_sha256: sha256(JSON.stringify(after)),
    inputs: Object.fromEntries(after),
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`QBO payments realm-scoping local qualification refused: ${error.message}\n`); process.exitCode = 2; }
}
