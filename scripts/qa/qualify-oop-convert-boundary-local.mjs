/**
 * ════════════════════════════════════════════════
 * FILE: qualify-oop-convert-boundary-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a throwaway copy of the database on this machine, loads the saved
 *   schema, replays the five real predecessors in the order production applied
 *   them, applies the OOP quote-to-estimate permission change, checks every
 *   employee role behaves correctly, undoes it, checks the undo really put the
 *   old restriction back, applies it again, and then deletes the whole throwaway
 *   copy. Nothing it does can reach the real Utah Pros database.
 *
 * DEPENDS ON:
 *   Packages:  Node built-ins, project-pinned Supabase CLI 2.111.0, Docker
 *   Internal:  ./safe-child-env.mjs, db/baseline/schema.sql, the five
 *              predecessors named below, the paired 20260807220000
 *              migration/rollback, and the isolated proof
 *
 * NOTES / GOTCHAS:
 *   - Refuses to run against anything but a local Docker socket, and refuses if
 *     its own inputs are dirty, so a receipt always names an exact commit.
 *   - It proves DATABASE behaviour on a synthetic clone. It proves nothing about
 *     QuickBooks, the browser build, or any deployment.
 *   - Ports are deliberately offset from the sibling qualifiers so two can run
 *     back to back without colliding.
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
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'upr-oop-convert-boundary-local');
const CONTAINER_ROOT = '/tmp/upr-oop-convert-boundary-local';

const MIGRATION = 'supabase/migrations/20260807220000_oop_convert_estimate_billing_boundary.sql';
const ROLLBACK = 'supabase/rollbacks/20260807220000_oop_convert_estimate_billing_boundary.rollback.sql';
const PROOF = 'supabase/tests/oop_convert_estimate_billing_boundary.test.sql';
const BASELINE = 'db/baseline/schema.sql';

// This migration REPLACES one function body and CONSUMES public.billing_edit_access(),
// so the baseline alone is not a truthful predecessor — db/baseline/schema.sql predates
// both the OOP calculator and that helper. Applying it on the bare baseline would fail
// at `function convert_oop_quote_to_estimate does not exist`, and even if it did not, it
// would "prove" the boundary against a role list production has not had since 2026-08-05.
//
// The exact predecessors live in production, in ledger order — the same five the
// estimate-create qualifier uses, for the same reasons:
//   20260731175328  oop_pricing_builder                  -> oop_quotes, the pricing
//                                                           snapshot tables, the seeded
//                                                           published revision, and
//                                                           oop_pricing_active_employee()
//   20260731225654  qbo_multi_invoice_payment_receipts   -> payments.receipt_id, the
//                                                           payments_billing_* policies
//   20260731230907  qbo_receipt_service_grant_containment
//   20260803224628  oop_quote_to_estimate                -> CREATES the function this
//                                                           migration replaces, and
//                                                           billing_edit_access()
//                                                           ('admin','manager')
//   20260805014242  billing_editor_role_boundary         -> WIDENS billing_edit_access()
//                                                           to the live role list this
//                                                           migration's guard depends on
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
  const name = `upr-oop-convert-${process.pid}-${randomUUID().slice(0, 8)}`;
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
// This migration replaces a body rather than creating an object, so "is it gone" is the
// wrong question — the question is whether office and project_manager actually lost
// conversion, and whether the objects this migration does NOT own survived intact.
function failClosedProof(context, container) {
  const sql = `DO $$
DECLARE
  v_body text;
  v_oid oid;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'convert_oop_quote_to_estimate';

  -- 1. The rollback must REMOVE the shared predicate and put the legacy gate
  --    back. That re-breaks the office/project_manager button on purpose; if the
  --    predicate survived, the rollback is not a rollback.
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'rollback dropped convert_oop_quote_to_estimate entirely';
  END IF;
  IF v_body LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'rollback left convert_oop_quote_to_estimate still gated on billing_edit_access()';
  END IF;
  IF v_body NOT LIKE '%NOT IN (''admin'',''manager'')%' THEN
    RAISE EXCEPTION 'rollback did not restore the legacy admin-only gate';
  END IF;
  IF v_body NOT LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'rollback changed the SECURITY DEFINER posture';
  END IF;

  -- 2. The deployed browser contract must survive the rollback: still callable
  --    by authenticated, still not by anon or service_role.
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback removed the authenticated EXECUTE grant';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback widened the EXECUTE grants';
  END IF;

  -- 3. This migration does NOT own billing_edit_access(), correct_oop_estimate,
  --    or any policy. Rolling it back must leave all of them exactly as the
  --    predecessors left them.
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'billing_edit_access';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'rollback removed billing_edit_access() — it belongs to 20260804120100';
  END IF;
  IF v_body NOT LIKE '%''office''%' OR v_body NOT LIKE '%''project_manager''%' THEN
    RAISE EXCEPTION 'rollback narrowed billing_edit_access() — it is not this migration to change';
  END IF;

  -- correct_oop_estimate stays admin-only by owner decision (2026-08-07). Neither
  -- direction of this migration may touch it.
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'correct_oop_estimate';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'correct_oop_estimate disappeared';
  END IF;
  IF v_body LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'correct_oop_estimate was widened — it must stay admin-only';
  END IF;
  IF v_body NOT LIKE '%IS DISTINCT FROM ''admin''%' THEN
    RAISE EXCEPTION 'correct_oop_estimate lost its admin-only gate';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'estimates' AND policyname = 'oop_estimates_billing_write') THEN
    RAISE EXCEPTION 'rollback disturbed the estimates write policy it does not own';
  END IF;
END $$;`;
  psql(context, container, 'postgres', ['-c', sql], { isolated: true });
}

function runCycle(context, ports) {
  const projectId = `uprocb-${process.pid}-${randomUUID().slice(0, 8)}`;
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
    process.stdout.write('oop-convert-boundary local qualification cycle passed.\n');
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
  runCycle(dockerContext.name, { api: 55461, db: 55462, shadow: 55460, studio: 55463, smtp: 55464, analytics: 55467 });
  const after = inputHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');
  if (qualificationCommitSha() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({
    schema: 'upr-oop-convert-boundary-local-qualification-v1',
    commit_sha: commit,
    cli_version: SUPABASE_CLI_VERSION,
    manifest_sha256: sha256(JSON.stringify(after)),
    inputs: Object.fromEntries(after),
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`OOP convert-boundary local qualification refused: ${error.message}\n`); process.exitCode = 2; }
}
