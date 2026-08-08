/**
 * ════════════════════════════════════════════════
 * FILE: qualify-overview-financials-grant-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a throwaway copy of the database on this machine, loads the saved
 *   schema, adds the two permission rows that let the office manager and project
 *   managers see the Dashboard money cards, checks the right people gained access
 *   and nobody else did, undoes it, checks the undo really removed only those two
 *   rows, applies it again, and deletes the whole throwaway copy. Nothing it does
 *   can reach the real Utah Pros database.
 *
 * DEPENDS ON:
 *   Packages:  Node built-ins, project-pinned Supabase CLI 2.111.0, Docker
 *   Internal:  ./safe-child-env.mjs, db/baseline/schema.sql, the paired
 *              20260808060000 migration/rollback, and the isolated proof
 *
 * NOTES / GOTCHAS:
 *   - No predecessors: nav_permissions and the employee_role enum both exist in
 *     the baseline, and this migration consumes nothing added since.
 *   - Two INSERTs are worth executing because `nav_permissions.role` is free
 *     `text`. A typo would apply cleanly, pass every static check, and grant
 *     nobody anything. The proof joins against the enum to catch exactly that.
 *   - `--iterate` waives the clean-tree refusal and issues NO receipt.
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
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'upr-overview-financials-grant-local');
const CONTAINER_ROOT = '/tmp/upr-overview-financials-grant-local';

const MIGRATION = 'supabase/migrations/20260808060000_overview_financials_office_pm_grant.sql';
const ROLLBACK = 'supabase/rollbacks/20260808060000_overview_financials_office_pm_grant.rollback.sql';
const PROOF = 'supabase/tests/overview_financials_office_pm_grant.test.sql';
const BASELINE = 'db/baseline/schema.sql';

export const QUALIFICATION_INPUTS = Object.freeze([BASELINE, MIGRATION, ROLLBACK, PROOF]);

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
  const name = `upr-navgrant-${process.pid}-${randomUUID().slice(0, 8)}`;
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

// db/baseline/schema.sql is schema-only, so nav_permissions arrives EMPTY. Without
// these, "no office rows survived the rollback" would be ambient emptiness rather
// than evidence — the first version of the fail-closed check below asserted exactly
// that and failed for the wrong reason. These two rows are the control group: they
// belong to other nav_keys, so a correct rollback must leave them untouched, and a
// rollback that forgot its nav_key predicate would take them with it.
function seedControlRows(context, container) {
  const sql = `INSERT INTO public.nav_permissions (nav_key, role, can_view, can_edit)
VALUES ('dashboard', 'office', true, false),
       ('dashboard', 'project_manager', true, false)
ON CONFLICT (nav_key, role) DO NOTHING;`;
  psql(context, container, 'postgres', ['-c', sql]);
}

// After the rollback the two rows must be GONE and the control rows must remain.
// "Are the rows gone" is the right question here — unlike a body-and-policy
// replacement, this migration genuinely only adds rows.
function failClosedProof(context, container) {
  const sql = `DO $$
DECLARE v_other bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.nav_permissions WHERE nav_key = 'overview_financials') THEN
    RAISE EXCEPTION 'rollback left an overview_financials row behind';
  END IF;

  -- The rollback must be surgical: every other nav_key/role pair the baseline
  -- shipped is still present. A WHERE clause that forgot its nav_key predicate
  -- would delete the entire office/project_manager permission set, which is a
  -- far worse outage than the grant it is undoing.
  SELECT count(*) INTO v_other FROM public.nav_permissions
   WHERE role IN ('office', 'project_manager') AND nav_key = 'dashboard';
  IF v_other <> 2 THEN
    RAISE EXCEPTION 'rollback took the control rows too: expected 2 dashboard permissions, found %', v_other;
  END IF;
  RAISE NOTICE 'ok: rollback removed only the two overview_financials rows; both control rows intact';
END $$;`;
  psql(context, container, 'postgres', ['-c', sql], { isolated: true });
}

function runCycle(context, ports) {
  const projectId = `uprnav-${process.pid}-${randomUUID().slice(0, 8)}`;
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
    seedControlRows(context, container);
    psql(context, container, 'postgres', ['-f', base(MIGRATION)]);
    psql(context, container, 'postgres', ['-f', base(PROOF)], { isolated: true });
    psql(context, container, 'postgres', ['--single-transaction', '-f', base(ROLLBACK)]);
    failClosedProof(context, container);
    psql(context, container, 'postgres', ['-f', base(MIGRATION)]);
    psql(context, container, 'postgres', ['-f', base(PROOF)], { isolated: true });
    process.stdout.write('overview-financials-grant local qualification cycle passed.\n');
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
  runCycle(dockerContext.name, { api: 55471, db: 55472, shadow: 55470, studio: 55473, smtp: 55474, analytics: 55477 });
  const after = inputHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');

  if (iterate) {
    process.stdout.write('iterate mode: no receipt issued (inputs are not commit-bound).\n');
    return;
  }
  if (qualificationCommitSha() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({
    schema: 'upr-overview-financials-grant-local-qualification-v1',
    commit_sha: commit,
    cli_version: SUPABASE_CLI_VERSION,
    manifest_sha256: sha256(JSON.stringify(after)),
    inputs: Object.fromEntries(after),
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`Overview-financials grant local qualification refused: ${error.message}\n`); process.exitCode = 2; }
}
