/**
 * ════════════════════════════════════════════════
 * FILE: qualify-oop-estimate-grouped-lines-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a throwaway copy of the database on this machine, loads the saved
 *   schema, replays the five real predecessors in the order production applied
 *   them, applies the OOP estimate grouping change, checks a nine-item quote
 *   really comes out as two customer lines, undoes it, checks the undo really
 *   brought the itemized behaviour back, applies it again, and then deletes the
 *   whole throwaway copy. Nothing it does can reach the real Utah Pros database.
 *
 * DEPENDS ON:
 *   Packages:  Node built-ins, project-pinned Supabase CLI 2.111.0, Docker
 *   Internal:  ./safe-child-env.mjs, db/baseline/schema.sql, the five
 *              predecessors named below, the paired 20260807210000
 *              migration/rollback, and the isolated proof
 *
 * NOTES / GOTCHAS:
 *   - Refuses to run against anything but a local Docker socket.
 *   - `--iterate` runs the same cycle against a DIRTY tree and prints NO
 *     receipt. It exists because a migration should be executed before it is
 *     committed, not after — the default clean-tree mode is what produces a
 *     receipt naming an exact commit.
 *   - It proves DATABASE behaviour on a synthetic clone. It proves nothing
 *     about QuickBooks, the native build, or any deployment.
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
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'upr-oop-grouped-lines-local');
const CONTAINER_ROOT = '/tmp/upr-oop-grouped-lines-local';

const MIGRATION = 'supabase/migrations/20260807210000_oop_estimate_grouped_lines.sql';
const ROLLBACK = 'supabase/rollbacks/20260807210000_oop_estimate_grouped_lines.rollback.sql';
const PROOF = 'supabase/tests/oop_estimate_grouped_lines.test.sql';
const BASELINE = 'db/baseline/schema.sql';

// This migration REPLACES the body of convert_oop_quote_to_estimate, which
// db/baseline/schema.sql does not contain at all — the baseline predates it. The
// exact production lineage, in ledger order (the same chain the estimate-create
// qualifier replays, because it is the same function family and the same tables):
//   20260731175328  oop_pricing_builder                  -> oop_quote_pricing_snapshots,
//                                                           oop_pricing_active_employee(),
//                                                           oop_pricing_calculator_access()
//   20260731225654  qbo_multi_invoice_payment_receipts   -> payments.receipt_id, needed by
//                                                           the boundary migration below
//   20260731230907  qbo_receipt_service_grant_containment
//   20260803224628  oop_quote_to_estimate                -> CREATES the function this
//                                                           migration replaces
//   20260805014242  billing_editor_role_boundary         -> the live estimates/line policies
const PREDECESSORS = Object.freeze([
  'supabase/migrations/20260730150000_oop_pricing_builder.sql',
  'supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql',
  'supabase/migrations/20260731231000_qbo_receipt_service_grant_containment.sql',
  'supabase/migrations/20260803192344_oop_quote_to_estimate.sql',
  'supabase/migrations/20260804120100_billing_editor_role_boundary.sql',
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
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || '').trim().slice(0, 600)}`);
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
  if (status.trim()) throw new Error('qualification inputs are dirty; commit or stash them so the receipt names an exact commit (or pass --iterate to run without a receipt)');
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
  // Studio, Realtime, Analytics and the API add nothing but startup time and
  // failure modes — the first run of this harness died in the analytics/realtime
  // health check, having never reached a single line of SQL.
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
  const name = `upr-oop-grouped-${process.pid}-${randomUUID().slice(0, 8)}`;
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

// After the rollback the ITEMIZED behaviour must genuinely be back. This
// migration replaces a body rather than creating objects, so "is it gone" is the
// wrong question — the question is whether a conversion once again emits one line
// per priced item. Anything less and the operator has no way back.
function failClosedProof(context, container) {
  const sql = `DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'convert_oop_quote_to_estimate';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'rollback dropped convert_oop_quote_to_estimate instead of restoring its body';
  END IF;

  -- 1. The grouping must be gone.
  IF v_body LIKE '%v_equipment_total%' OR v_body LIKE '%v_service_total%' THEN
    RAISE EXCEPTION 'rollback left the grouping in place — it is not a rollback';
  END IF;

  -- 2. The itemized behaviour must be back, fingerprinted by the per-item
  --    description format only the old body produces.
  IF v_body NOT LIKE '%units × %s days%' THEN
    RAISE EXCEPTION 'rollback did not restore the itemized per-item description';
  END IF;

  -- 3. The QuickBooks defaults belong to the grouped body only.
  IF v_body LIKE '%1000000005%' THEN
    RAISE EXCEPTION 'rollback left the QuickBooks class default behind';
  END IF;

  -- 4. Posture and grants must be exactly as the predecessor left them.
  IF v_body NOT LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'rollback changed the SECURITY DEFINER posture';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'convert_oop_quote_to_estimate'
                AND (NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'rollback left the wrong EXECUTE grants';
  END IF;

  -- 5. This migration owns NOTHING else. billing_edit_access() and the estimate
  --    policies belong to earlier migrations and must survive untouched.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname = 'billing_edit_access') THEN
    RAISE EXCEPTION 'rollback removed billing_edit_access() — it belongs to an earlier migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'estimate_line_items' AND policyname = 'oop_estimate_lines_billing_write') THEN
    RAISE EXCEPTION 'rollback disturbed an estimate-line policy it does not own';
  END IF;
END $$;`;
  psql(context, container, 'postgres', ['-c', sql], { isolated: true });
}

function runCycle(context, ports) {
  const projectId = `uprogl-${process.pid}-${randomUUID().slice(0, 8)}`;
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
    process.stdout.write('oop-estimate-grouped-lines local qualification cycle passed.\n');
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
  // --iterate deliberately skips the commit identity so a migration can be
  // EXECUTED before it is committed. It prints no receipt, because a receipt
  // that cannot name a commit is not evidence of anything.
  const commit = iterate ? null : qualificationCommitSha();
  assertProjectCli();
  const dockerContext = verifyLocalDockerContext();
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  runCycle(dockerContext.name, { api: 55461, db: 55462, shadow: 55460, studio: 55463, smtp: 55464, analytics: 55467 });
  const after = inputHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');
  if (iterate) {
    process.stdout.write('iterate mode: no receipt issued (inputs were not commit-bound).\n');
    return;
  }
  if (qualificationCommitSha() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({
    schema: 'upr-oop-estimate-grouped-lines-local-qualification-v1',
    commit_sha: commit,
    cli_version: SUPABASE_CLI_VERSION,
    manifest_sha256: sha256(JSON.stringify(after)),
    inputs: Object.fromEntries(after),
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`OOP grouped-lines local qualification refused: ${error.message}\n`); process.exitCode = 2; }
}
