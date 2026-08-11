/**
 * FILE: qualify-invoice-line-edit-lock-local.mjs
 * Runs the invoice-line lock boundary proof only on a disposable local Docker DB.
 * `--iterate` permits dirty authoring inputs, verifies their hashes stay fixed,
 * and deliberately emits no commit-bound receipt.
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
const CACHE = path.join(os.homedir(), '.cache', 'upr-invoice-line-edit-lock-local');
const INPUT = '/tmp/upr-invoice-line-edit-lock-inputs';
const BASELINE = 'db/baseline/schema.sql';
const PREDECESSORS = [
  'supabase/migrations/20260730150000_oop_pricing_builder.sql',
  'supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql',
  'supabase/migrations/20260731231000_qbo_receipt_service_grant_containment.sql',
  'supabase/migrations/20260803192344_oop_quote_to_estimate.sql',
  'supabase/migrations/20260804120100_billing_editor_role_boundary.sql',
];
const MIGRATION = 'supabase/migrations/20260810010000_invoice_line_edit_lock_boundary.sql';
const ROLLBACK = 'supabase/rollbacks/20260810010000_invoice_line_edit_lock_boundary.rollback.sql';
const PROOF = 'supabase/tests/invoice_line_edit_lock_boundary_isolated.sql';
const INPUTS = [BASELINE, ...PREDECESSORS, MIGRATION, ROLLBACK, PROOF];
const hash = (value) => createHash('sha256').update(value).digest('hex');

function run(command, args, label, quiet = false, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env: { ...safeChildEnv(process.env), ...extraEnv }, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'] });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || '').trim().slice(0, 400)}`);
  return result.stdout || '';
}
function docker(context, args, label, quiet = false) { return run('docker', ['--context', context, ...args], label, quiet); }
function assertCleanInputs() {
  for (const input of INPUTS) run('git', ['ls-files', '--error-unmatch', '--', input], 'tracked-input check', true);
  const dirty = run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...INPUTS], 'input status check', true);
  if (dirty.trim()) throw new Error('qualification inputs are dirty; commit or stash them so the receipt names an exact commit');
}
function qualificationCommitSha() {
  assertCleanInputs();
  const commit = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], 'qualification commit identity', true).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('qualification commit identity is invalid');
  return commit;
}
function inputHashes() { return INPUTS.map((input) => [input, hash(fs.readFileSync(path.join(ROOT, input)))]); }
function localContext() {
  const name = run('docker', ['context', 'show'], 'Docker context selection', true).trim();
  const raw = run('docker', ['--context', name, 'context', 'inspect', name, '--format', '{{json .Endpoints.docker.Host}}'], 'Docker context inspection', true).trim();
  let endpoint; try { endpoint = JSON.parse(raw); } catch { throw new Error('Docker context endpoint could not be decoded'); }
  if (!endpoint.startsWith('unix://')) throw new Error(`refusing non-local Docker endpoint: ${endpoint}`);
  const stat = fs.statSync(endpoint.slice('unix://'.length));
  if (!stat.isSocket()) throw new Error('Docker endpoint is not a socket');
  return name;
}
function writeConfig(workdir, projectId) {
  fs.mkdirSync(path.join(workdir, 'supabase'), { recursive: true });
  fs.writeFileSync(path.join(workdir, 'supabase', 'config.toml'), [
    '# Generated disposable local-only qualification configuration.',
    `project_id = "${projectId}"`,
    '', '[api]', 'port = 55561',
    '', '[db]', 'port = 55562', 'shadow_port = 55560', 'major_version = 17',
    '', '[db.seed]', 'enabled = false',
    '', '[studio]', 'port = 55563',
    '', '[local_smtp]', 'port = 55564',
    '', '[auth]', 'site_url = "http://127.0.0.1:4173"',
    'additional_redirect_urls = ["http://127.0.0.1:4173"]',
    '', '[analytics]', 'port = 55567', '',
  ].join('\n'));
}
function psql(context, container, role, args, isolated = false) {
  const command = ['exec']; if (isolated) command.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  command.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'postgres', ...args);
  docker(context, command, `psql (${role})`);
}
function rollbackProof(context, container) {
  psql(context, container, 'postgres', ['-c', `DO $$ BEGIN
    IF to_regprocedure('public.update_invoice_line_item(uuid,uuid,text,text,text,text,text,numeric,numeric)') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained line editor RPC'; END IF;
    IF to_regprocedure('public.mark_invoice_line_revision_draft()') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.invoice_line_items'::regclass AND tgname='trg_invoice_lines_revision_draft') THEN RAISE EXCEPTION 'rollback retained draft trigger'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoice_line_items' AND policyname='invoice_lines_billing_write' AND qual LIKE '%billing_edit_access()%') THEN RAISE EXCEPTION 'rollback did not restore line policy'; END IF;
  END $$;`], true);
}
function main(argv = process.argv.slice(2)) {
  const iterate = argv.length === 1 && argv[0] === '--iterate';
  if (argv.length && !iterate) throw new Error('this local-only qualification accepts no arguments except --iterate');
  const before = inputHashes();
  const commit = iterate ? null : qualificationCommitSha();
  if (!fs.existsSync(BIN) || run(BIN, ['--version'], 'Supabase CLI version', true).trim() !== '2.111.0') throw new Error('project Supabase CLI 2.111.0 is required');
  const context = localContext(); const project = `uprile-${process.pid}-${randomUUID().slice(0, 8)}`; const container = `supabase_db_${project}`;
  fs.mkdirSync(CACHE, { recursive: true }); const workdir = fs.mkdtempSync(path.join(CACHE, 'cycle-'));
  let started = false;
  try {
    writeConfig(workdir, project);
    run(BIN, ['start', '--workdir', workdir, '--yes'], 'disposable local Supabase start', true, { DOCKER_CONTEXT: context }); started = true;
    psql(context, container, 'supabase_admin', ['-c', 'GRANT supabase_admin TO postgres;']);
    psql(context, container, 'postgres', ['-c', 'DROP SCHEMA public CASCADE;']);
    docker(context, ['exec', container, 'mkdir', '-p', INPUT], 'input directory');
    for (const input of INPUTS) docker(context, ['cp', path.join(ROOT, input), `${container}:${INPUT}/${path.basename(input)}`], 'copy input');
    const inside = (input) => `${INPUT}/${path.basename(input)}`;
    psql(context, container, 'postgres', ['-f', inside(BASELINE)]);
    for (const predecessor of PREDECESSORS) psql(context, container, 'postgres', ['-f', inside(predecessor)]);
    psql(context, container, 'postgres', ['-f', inside(MIGRATION)]); psql(context, container, 'postgres', ['-f', inside(PROOF)], true);
    psql(context, container, 'postgres', ['--single-transaction', '-f', inside(ROLLBACK)]); rollbackProof(context, container);
    psql(context, container, 'postgres', ['-f', inside(MIGRATION)]); psql(context, container, 'postgres', ['-f', inside(PROOF)], true);
    process.stdout.write('invoice-line edit lock local qualification cycle passed.\n');
  } finally {
    if (started) { try { psql(context, container, 'supabase_admin', ['-c', 'REVOKE supabase_admin FROM postgres;']); } catch {} try { run(BIN, ['stop', '--no-backup', '--workdir', workdir], 'disposable local Supabase stop', true, { DOCKER_CONTEXT: context }); } catch {} }
    fs.rmSync(workdir, { recursive: true, force: true });
  }
  const after = inputHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');
  if (iterate) {
    process.stdout.write('iterate mode: no commit-bound receipt issued (inputs are not commit-bound).\n');
    return;
  }
  if (qualificationCommitSha() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({ schema: 'upr-invoice-line-edit-lock-local-qualification-v1', commit_sha: commit, inputs: Object.fromEntries(after) })}\n`);
}
try { main(); } catch (error) { process.stderr.write(`Invoice-line edit lock local qualification refused: ${error.message}\n`); process.exitCode = 2; }
