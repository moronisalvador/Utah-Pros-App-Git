/**
 * ════════════════════════════════════════════════
 * FILE: qualify-invoice-activity-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a throwaway copy of the database on this machine, loads the saved
 *   schema, applies the invoice activity change, checks it behaves correctly,
 *   undoes it, checks the undo really closed everything, applies it again, and
 *   then deletes the whole throwaway copy. Nothing it does can reach the real
 *   Utah Pros database.
 *
 * DEPENDS ON:
 *   Packages:  Node built-ins, project-pinned Supabase CLI 2.111.0, Docker
 *   Internal:  ./safe-child-env.mjs, db/baseline/schema.sql, the paired
 *              20260804210000 migration/rollback, the isolated proof
 *
 * NOTES / GOTCHAS:
 *   - Refuses to run against anything but a local Docker socket, and refuses if
 *     its own inputs are dirty, so a receipt always names an exact commit.
 *   - It proves DATABASE behaviour on a synthetic clone. It proves nothing
 *     about QuickBooks, the Worker byte-compare, or any deployment.
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
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'upr-billing-boundary-local');
const CONTAINER_ROOT = '/tmp/upr-billing-boundary-local';

const MIGRATION = 'supabase/migrations/20260804120100_billing_editor_role_boundary.sql';
const ROLLBACK = 'supabase/rollbacks/20260804120100_billing_editor_role_boundary.rollback.sql';
const PROOF = 'supabase/tests/billing_editor_role_boundary.test.sql';
const BASELINE = 'db/baseline/schema.sql';

// This migration REPLACES bodies and policies rather than creating objects, so the
// baseline alone is not a truthful predecessor: db/baseline/schema.sql predates both
// payments.receipt_id and billing_edit_access(). Applying the target on the bare baseline
// fails at `column "receipt_id" does not exist` — and, worse, would have "proven" the
// boundary against a shape production has not had since 2026-07-31.
//
// These are the exact predecessors live in production, applied in ledger order:
//   20260731175328  oop_pricing_builder                  -> oop_quote_pricing_snapshots,
//                                                           required by oop_quote_to_estimate
//   20260731225654  qbo_multi_invoice_payment_receipts   -> payments.receipt_id, the
//                                                           payments_billing_* policies
//   20260731230907  qbo_receipt_service_grant_containment
//   20260803224628  oop_quote_to_estimate                -> creates billing_edit_access()
//                                                           and the estimates policies that
//                                                           call it
const PREDECESSORS = Object.freeze([
  'supabase/migrations/20260730150000_oop_pricing_builder.sql',
  'supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql',
  'supabase/migrations/20260731231000_qbo_receipt_service_grant_containment.sql',
  'supabase/migrations/20260803192344_oop_quote_to_estimate.sql',
]);

export const QUALIFICATION_INPUTS = Object.freeze([BASELINE, ...PREDECESSORS, MIGRATION, ROLLBACK, PROOF]);

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
  fs.writeFileSync(path.join(supabase, 'config.toml'), [
    '# Generated disposable local-only qualification configuration.',
    `project_id = "${projectId}"`,
    '', '[api]', `port = ${ports.api}`,
    '', '[db]', `port = ${ports.db}`, `shadow_port = ${ports.shadow}`, 'major_version = 17',
    '', '[db.seed]', 'enabled = false',
    '', '[studio]', `port = ${ports.studio}`,
    '', '[local_smtp]', `port = ${ports.smtp}`,
    '', '[auth]', 'site_url = "http://127.0.0.1:4173"', 'additional_redirect_urls = ["http://127.0.0.1:4173"]',
    '', '[analytics]', `port = ${ports.analytics}`, '',
  ].join('\n'));
}

function psql(context, container, role, args, { isolated = false } = {}) {
  const command = ['exec'];
  if (isolated) command.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  command.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'postgres', ...args);
  docker(context, command, { label: `local container psql (${role})` });
}

function createNetwork(context) {
  const name = `upr-invoice-activity-${process.pid}-${randomUUID().slice(0, 8)}`;
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

// After the rollback the boundary must be genuinely RE-NARROWED, not merely renamed.
// This migration replaces bodies and policies rather than creating objects, so "gone"
// is the wrong question — the question is whether the widened roles actually lost access.
function failClosedProof(context, container) {
  const sql = `DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'billing_edit_access';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'rollback removed billing_edit_access() entirely — it is a live policy dependency';
  END IF;
  IF v_body LIKE '%''office''%' OR v_body LIKE '%''project_manager''%' THEN
    RAISE EXCEPTION 'rollback left the widened roles in billing_edit_access()';
  END IF;

  -- The widened write policies must be gone; the prior pair is restored by the rollback.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND policyname IN ('invoices_billing_write', 'invoice_lines_billing_write')) THEN
    RAISE EXCEPTION 'rollback retained a widened invoice write policy';
  END IF;

  -- The definer RPCs must no longer consult the widened predicate.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname IN ('create_invoice_for_job', 'convert_estimate_to_invoice')
               AND pg_get_functiondef(p.oid) LIKE '%billing_edit_access()%') THEN
    RAISE EXCEPTION 'rollback left an invoice-creation RPC gated on the widened predicate';
  END IF;

  -- Payout authority is NOT part of this migration and must be untouched either way.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payments') THEN
    RAISE EXCEPTION 'rollback left public.payments with no policy at all';
  END IF;
END $$;`;
  psql(context, container, 'postgres', ['-c', sql], { isolated: true });
}

function runCycle(context, ports) {
  const projectId = `uprbb-${process.pid}-${randomUUID().slice(0, 8)}`;
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
    psql(context, container, 'postgres', ['-f', base(MIGRATION)]);
    psql(context, container, 'postgres', ['-f', base(PROOF)], { isolated: true });
    psql(context, container, 'postgres', ['--single-transaction', '-f', base(ROLLBACK)]);
    failClosedProof(context, container);
    psql(context, container, 'postgres', ['-f', base(MIGRATION)]);
    psql(context, container, 'postgres', ['-f', base(PROOF)], { isolated: true });
    process.stdout.write('billing-boundary local qualification cycle passed.\n');
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
  if (argv.length) throw new Error('this local-only qualification accepts no arguments');
  const before = inputHashes();
  const commit = qualificationCommitSha();
  assertProjectCli();
  const dockerContext = verifyLocalDockerContext();
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  runCycle(dockerContext.name, { api: 55451, db: 55452, shadow: 55450, studio: 55453, smtp: 55454, analytics: 55457 });
  const after = inputHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');
  if (qualificationCommitSha() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({
    schema: 'upr-billing-boundary-local-qualification-v1',
    commit_sha: commit,
    cli_version: SUPABASE_CLI_VERSION,
    manifest_sha256: sha256(JSON.stringify(after)),
    inputs: Object.fromEntries(after),
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`Billing-boundary local qualification refused: ${error.message}\n`); process.exitCode = 2; }
}
