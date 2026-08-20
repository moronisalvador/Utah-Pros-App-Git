/**
 * FILE: qualify-stripe-payment-command-ledger-local.mjs
 * Builds a throwaway local Supabase database, applies the Stripe payment command
 * ledger, runs the role/state proof, rolls back, verifies the rollback removed
 * everything, reapplies, and proves it again. It refuses remote Docker and
 * refuses to issue a receipt from a dirty tree.
 *
 * PREDECESSORS is deliberately EMPTY, and that is measured rather than assumed:
 * the migration references only `invoices`, `payments` and `feature_flags`, all
 * of which db/baseline/schema.sql already carries. Replaying unrelated
 * migrations would add risk without adding coverage.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { safeChildEnv } from './safe-child-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(ROOT, 'node_modules', '.bin', 'supabase');
const CACHE = path.join(os.homedir(), '.cache', 'upr-stripe-payment-command-ledger-local');
const INPUT = '/tmp/upr-stripe-payment-command-ledger-inputs';
const BASELINE = 'db/baseline/schema.sql';
const PREDECESSORS = [];
const MIGRATION = 'supabase/migrations/20260820020000_stripe_payment_command_ledger.sql';
const ROLLBACK = 'supabase/rollbacks/20260820020000_stripe_payment_command_ledger.rollback.sql';
const PROOF = 'supabase/tests/stripe_payment_command_ledger_isolated.sql';
const INPUTS = [BASELINE, ...PREDECESSORS, MIGRATION, ROLLBACK, PROOF];
const hash = (value) => createHash('sha256').update(value).digest('hex');

function run(command, args, label, quiet = false, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...safeChildEnv(process.env), ...extraEnv },
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    timeout: 300000,
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || '').trim().slice(0, 600)}`);
  return result.stdout || '';
}
function docker(context, args, label, quiet = false) {
  return run('docker', ['--context', context, ...args], label, quiet);
}
function hashes() { return INPUTS.map((input) => [input, hash(fs.readFileSync(path.join(ROOT, input)))]); }

function assertClean() {
  for (const input of INPUTS) run('git', ['ls-files', '--error-unmatch', '--', input], 'tracked-input check', true);
  if (run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...INPUTS], 'input status check', true).trim()) {
    throw new Error('qualification inputs are dirty; use --iterate while authoring');
  }
}
function receiptCommit() {
  assertClean();
  const value = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], 'qualification commit identity', true).trim();
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('qualification commit identity is invalid');
  return value;
}

function localContext() {
  const name = run('docker', ['context', 'show'], 'Docker context selection', true).trim();
  const raw = run('docker', ['--context', name, 'context', 'inspect', name, '--format', '{{json .Endpoints.docker.Host}}'], 'Docker context inspection', true).trim();
  let endpoint;
  try { endpoint = JSON.parse(raw); } catch { throw new Error('Docker context endpoint could not be decoded'); }
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

function psql(context, container, role, sql, isolated = false) {
  const args = ['exec'];
  if (isolated) args.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  args.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'postgres', '-c', sql);
  docker(context, args, `psql (${role})`);
}
function psqlFile(context, container, file, isolated = false) {
  const args = ['exec'];
  if (isolated) args.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  args.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', file);
  docker(context, args, 'proof psql');
}

/** The proof must refuse to run without the isolation GUC — prove that too. */
function isolationGuardProof(context, container, file) {
  const attempted = spawnSync('docker', ['--context', context, 'exec', container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', file], {
    cwd: ROOT, encoding: 'utf8', env: safeChildEnv(process.env), timeout: 120000,
  });
  if (attempted.status === 0 || !/refusing to run outside a disposable database/.test(attempted.stderr || '')) {
    throw new Error(`the proof ran without its isolation guard: status=${attempted.status}, ${(attempted.stderr || '').slice(0, 300)}`);
  }
}

/** After the rollback, nothing the migration added may remain. */
function rollbackProof(context, container) {
  psql(context, container, 'postgres', `DO $$ BEGIN
    IF to_regclass('public.stripe_payment_commands') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained the ledger table'; END IF;
    IF to_regprocedure('public.stripe_command_guard()') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained the guard'; END IF;
    IF to_regprocedure('public.reserve_stripe_payment_command(text,text,text,text,text,jsonb,uuid,uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained reserve'; END IF;
    IF to_regprocedure('public.start_stripe_payment_command(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained start'; END IF;
    IF to_regprocedure('public.finalize_stripe_payment_command(uuid,text,text,text,text,jsonb,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained finalize'; END IF;
    IF to_regprocedure('public.get_stripe_payment_command(text,text)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained get'; END IF;
    IF EXISTS (SELECT 1 FROM public.feature_flags WHERE key = 'feature:stripe_payment_command_v1') THEN RAISE EXCEPTION 'rollback retained the feature flag'; END IF;
    -- And it must leave the tables it never owned completely alone.
    IF to_regclass('public.payments') IS NULL OR to_regclass('public.invoices') IS NULL THEN RAISE EXCEPTION 'rollback damaged a money table'; END IF;
  END $$;`, true);
}

/** The flag must ship OFF, or applying the migration would open the projection. */
function flagShipsDisabledProof(context, container) {
  psql(context, container, 'postgres', `DO $$
  DECLARE v_enabled boolean; v_forced boolean;
  BEGIN
    SELECT enabled, force_disabled INTO v_enabled, v_forced
      FROM public.feature_flags WHERE key = 'feature:stripe_payment_command_v1';
    IF v_enabled IS NULL THEN RAISE EXCEPTION 'the feature flag row was not created'; END IF;
    IF v_enabled THEN RAISE EXCEPTION 'the feature flag shipped ENABLED — applying this would open the projection'; END IF;
    IF v_forced THEN RAISE EXCEPTION 'the feature flag shipped force_disabled, which is not the intended default'; END IF;
  END $$;`, true);
}

function removeDisposableProject(context, project) {
  const ids = docker(context, ['ps', '-aq', '--filter', `name=${project}`], 'disposable container listing', true).trim().split(/\s+/).filter(Boolean);
  if (ids.length) docker(context, ['rm', '-f', ...ids], 'disposable container removal', true);
  // `supabase start` creates this exact project-scoped network but does not
  // reliably remove it after a failed start. Never prune shared Docker
  // resources: remove only this run's network, once Docker confirms it is empty.
  const network = `supabase_network_${project}`;
  const networks = docker(context, ['network', 'ls', '--filter', `name=${network}`, '--format', '{{.Name}}'], 'disposable network listing', true)
    .trim().split(/\s+/).filter((name) => name === network);
  if (networks.length) {
    const attachments = docker(context, ['network', 'inspect', network, '--format', '{{len .Containers}}'], 'disposable network attachment inspection', true).trim();
    if (attachments === '0') docker(context, ['network', 'rm', network], 'disposable network removal', true);
  }
}

async function main(argv = process.argv.slice(2)) {
  const iterate = argv.length === 1 && argv[0] === '--iterate';
  if (argv.length && !iterate) throw new Error('only --iterate is accepted');
  const before = hashes();
  const commit = iterate ? null : receiptCommit();

  if (!fs.existsSync(BIN) || run(BIN, ['--version'], 'Supabase CLI version', true).trim() !== '2.111.0') {
    throw new Error('project Supabase CLI 2.111.0 is required');
  }
  const context = localContext();
  const project = `uprstripecmd-${process.pid}-${randomUUID().slice(0, 8)}`;
  const container = `supabase_db_${project}`;
  fs.mkdirSync(CACHE, { recursive: true });
  const workdir = fs.mkdtempSync(path.join(CACHE, 'cycle-'));
  let started = false;

  try {
    writeConfig(workdir, project);
    run(BIN, ['start', '--workdir', workdir, '--yes'], 'disposable local Supabase start', true, { DOCKER_CONTEXT: context });
    started = true;

    psql(context, container, 'supabase_admin', 'GRANT supabase_admin TO postgres;');
    psql(context, container, 'postgres', 'DROP SCHEMA public CASCADE;');
    docker(context, ['exec', container, 'mkdir', '-p', INPUT], 'input directory');
    for (const input of INPUTS) {
      docker(context, ['cp', path.join(ROOT, input), `${container}:${INPUT}/${path.basename(input)}`], 'copy input');
    }
    const inside = (input) => `${INPUT}/${path.basename(input)}`;

    // Baseline → (no predecessors) → migration → proof.
    psqlFile(context, container, inside(BASELINE));
    for (const prior of PREDECESSORS) psqlFile(context, container, inside(prior));
    psqlFile(context, container, inside(MIGRATION));
    flagShipsDisabledProof(context, container);
    isolationGuardProof(context, container, inside(PROOF));
    psqlFile(context, container, inside(PROOF), true);

    // Rollback → prove it really removed everything.
    psqlFile(context, container, inside(ROLLBACK));
    rollbackProof(context, container);

    // Reapply → prove it again, so the migration is not one-shot.
    psqlFile(context, container, inside(MIGRATION));
    flagShipsDisabledProof(context, container);
    psqlFile(context, container, inside(PROOF), true);

    process.stdout.write('Stripe payment command ledger local qualification cycle passed.\n');
  } finally {
    if (started) { try { removeDisposableProject(context, project); } catch { /* best effort */ } }
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  const after = hashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');
  if (iterate) {
    return process.stdout.write('iterate mode: no commit-bound receipt issued (inputs are not commit-bound).\n');
  }
  if (receiptCommit() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({
    schema: 'upr-stripe-payment-command-ledger-local-qualification-v1',
    commit_sha: commit,
    inputs: Object.fromEntries(after),
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`Stripe payment command ledger local qualification refused: ${error.message}\n`);
  process.exitCode = 2;
});
