/**
 * ════════════════════════════════════════════════
 * FILE: qualify-job-files-private-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a throwaway copy of the database on this machine, puts the shared
 *   file store into exactly the state the real one is in today (open to the
 *   whole internet), applies the change that closes it, then pretends to be
 *   each kind of person in turn to check who can still see the files and who
 *   cannot. Then it undoes the change, checks the undo really did re-open the
 *   store, applies it again, and deletes the throwaway copy. Nothing it does
 *   can reach the real Utah Pros database.
 *
 * DEPENDS ON:
 *   Packages:  Node built-ins, project-pinned Supabase CLI 2.111.0, Docker
 *   Internal:  ./safe-child-env.mjs, db/baseline/schema.sql, the paired
 *              20260820010000 migration/rollback, and the isolated proof
 *
 * NOTES / GOTCHAS:
 *   - SEEDING THE STARTING STATE IS NOT OPTIONAL, and it is different in kind
 *     from the other qualifiers. `db/baseline/schema.sql` is a dump of the
 *     PUBLIC schema only — it contains no `storage.` objects at all. A fresh
 *     local Supabase brings its own empty storage schema with no job-files
 *     bucket and none of production's four policies. Without seedLiveState()
 *     the migration's drift guard would abort on the first check, and if the
 *     guard were ever removed, every DENY case in the proof would pass against
 *     a bucket that does not exist. The seed reproduces the live catalog rows
 *     read from production on 2026-08-19.
 *   - The seed runs as supabase_storage_admin, which OWNS storage.objects.
 *     `postgres` cannot CREATE POLICY on a table it does not own, and neither
 *     can the migration — hence the two role grants before anything else.
 *   - The rollback proof asserts the UNDO WORKS, which here means asserting
 *     that an anonymous reader can see the files again. Reading that assertion
 *     as a goal rather than as a rollback check would be a bad mistake: it is
 *     the exposure being restored on purpose, for an incident window only.
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
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'upr-job-files-private-local');
const CONTAINER_ROOT = '/tmp/upr-job-files-private-local';

const MIGRATION = 'supabase/migrations/20260820010000_job_files_bucket_private.sql';
const ROLLBACK = 'supabase/rollbacks/20260820010000_job_files_bucket_private.rollback.sql';
const PROOF = 'supabase/tests/job_files_bucket_private.test.sql';
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
  const name = `upr-jobfiles-${process.pid}-${randomUUID().slice(0, 8)}`;
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

// The live starting state, read from production on 2026-08-19:
//   storage.buckets  job-files                public=true,  50 MiB
//                    job-documents-private    public=false, 50 MiB   (Phase 1)
//   storage.objects  anon_read_job_files                SELECT {anon}
//                    job_files_select                   SELECT {public}
//                    job_files_authenticated_insert     INSERT {authenticated}
//                    job_files_authenticated_delete     DELETE {authenticated}
//                    job_documents_private_authenticated_read/_delete  (Phase 1)
//
// All six exist because the migration's drift guard demands the first two and
// its postconditions demand the rest, and because a proof that "anon cannot
// read" is worthless if anon never could.
function seedLiveState(context, container) {
  const sql = `
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('job-files', 'job-files', true, 52428800),
       ('job-documents-private', 'job-documents-private', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_job_files ON storage.objects;
CREATE POLICY anon_read_job_files ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'job-files');

DROP POLICY IF EXISTS job_files_select ON storage.objects;
CREATE POLICY job_files_select ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'job-files');

DROP POLICY IF EXISTS job_files_authenticated_insert ON storage.objects;
CREATE POLICY job_files_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'job-files');

DROP POLICY IF EXISTS job_files_authenticated_delete ON storage.objects;
CREATE POLICY job_files_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'job-files');

DROP POLICY IF EXISTS job_documents_private_authenticated_read ON storage.objects;
CREATE POLICY job_documents_private_authenticated_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'job-documents-private'
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );

DROP POLICY IF EXISTS job_documents_private_authenticated_delete ON storage.objects;
CREATE POLICY job_documents_private_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'job-documents-private'
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );
`;
  psql(context, container, 'postgres', ['-c', sql]);
}

// Before the migration, prove the exposure is REAL on this stack. Otherwise
// every "anon is refused" assertion afterwards could be measuring an empty
// bucket, a missing policy, or a typo in the role name.
function preStateProof(context, container) {
  const sql = `DO $$
DECLARE v integer; v_public boolean;
BEGIN
  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('job-files', 'jf-pre/photo.jpg', '{"size": 10}'::jsonb)
  ON CONFLICT DO NOTHING;

  SELECT public INTO v_public FROM storage.buckets WHERE id = 'job-files';
  IF v_public IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PRE: job-files is not public — the seed did not reproduce the live state';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  PERFORM set_config('role', 'anon', true);
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'job-files' AND name = 'jf-pre/photo.jpg';
  PERFORM set_config('role', 'none', true);
  RESET role;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF v <> 1 THEN
    RAISE EXCEPTION 'PRE: anon could NOT read job-files before the migration (saw %) — there is no exposure to close, so this stack does not reproduce production', v;
  END IF;
  RAISE NOTICE 'ok (pre): anon reads job-files, exactly as production does today';
END $$;`;
  psql(context, container, 'postgres', ['-c', sql], { isolated: true });
}

// After the rollback the exposure must be BACK — that is what "the undo works"
// means for this change, uncomfortable as it reads. It also checks the forward
// policy is gone, because a re-apply during an incident must not fail on
// "policy already exists".
function failClosedProof(context, container) {
  const sql = `DO $$
DECLARE v integer; v_public boolean; v_restored integer; v_forward integer;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'job-files';
  IF v_public IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ROLLBACK: job-files was not made public again';
  END IF;

  SELECT count(*) INTO v_restored FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname IN ('anon_read_job_files','job_files_select');
  IF v_restored <> 2 THEN
    RAISE EXCEPTION 'ROLLBACK: expected 2 restored public policies, found %', v_restored;
  END IF;

  SELECT count(*) INTO v_forward FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname = 'job_files_authenticated_read';
  IF v_forward <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK: job_files_authenticated_read survived; a re-apply would fail mid-incident';
  END IF;

  -- The behavioural half: anon can read again.
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  PERFORM set_config('role', 'anon', true);
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'job-files' AND name = 'jf-pre/photo.jpg';
  PERFORM set_config('role', 'none', true);
  RESET role;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK: anon still cannot read job-files (saw %) — the undo did not actually undo', v;
  END IF;

  -- And Phase 1 must be untouched by the undo, in both directions.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='job-documents-private' AND public IS FALSE) THEN
    RAISE EXCEPTION 'ROLLBACK: the Phase 1 private bucket was disturbed';
  END IF;

  RAISE NOTICE 'ok (rollback): the exposure is restored and a re-apply is clean — an incident lever, not a destination';
END $$;`;
  psql(context, container, 'postgres', ['-c', sql], { isolated: true });
}

function runCycle(context, ports) {
  const projectId = `uprjf-${process.pid}-${randomUUID().slice(0, 8)}`;
  const container = `supabase_db_${projectId}`;
  const workdir = fs.mkdtempSync(path.join(CACHE_ROOT, 'cycle-'));
  const network = createNetwork(context);
  let started = false;
  try {
    writeConfig(workdir, projectId, ports);
    run(SUPABASE_BIN, ['start', '--network-id', network, '--workdir', workdir, '--yes'], { quiet: true, label: 'local Supabase start', extraEnv: { DOCKER_CONTEXT: context } });
    started = true;
    assertDisposableDatabaseContainer(context, container, projectId, network);

    // storage.objects is owned by supabase_storage_admin. Without this grant
    // neither the seed nor the migration can CREATE POLICY on it, and the
    // failure would look like a migration bug rather than a harness one.
    psql(context, container, 'supabase_admin', ['-c', 'GRANT supabase_admin TO postgres; GRANT supabase_storage_admin TO postgres;']);
    psql(context, container, 'postgres', ['-c', 'DROP SCHEMA public CASCADE;']);
    docker(context, ['exec', container, 'mkdir', '-p', `${CONTAINER_ROOT}/inputs`], { quiet: true, label: 'create disposable input directory' });
    for (const relative of QUALIFICATION_INPUTS) {
      docker(context, ['cp', path.join(ROOT, relative), `${container}:${CONTAINER_ROOT}/inputs/${path.basename(relative)}`], { quiet: true, label: 'copy into disposable container' });
    }

    const base = (relative) => `${CONTAINER_ROOT}/inputs/${path.basename(relative)}`;
    psql(context, container, 'postgres', ['-f', base(BASELINE)]);
    seedLiveState(context, container);
    preStateProof(context, container);
    psql(context, container, 'postgres', ['-f', base(MIGRATION)]);
    psql(context, container, 'postgres', ['-f', base(PROOF)], { isolated: true });
    psql(context, container, 'postgres', ['--single-transaction', '-f', base(ROLLBACK)]);
    failClosedProof(context, container);
    psql(context, container, 'postgres', ['-f', base(MIGRATION)]);
    psql(context, container, 'postgres', ['-f', base(PROOF)], { isolated: true });
    process.stdout.write('job-files-private local qualification cycle passed.\n');
  } finally {
    const errors = [];
    if (started) {
      try { psql(context, container, 'supabase_admin', ['-c', 'REVOKE supabase_storage_admin FROM postgres; REVOKE supabase_admin FROM postgres;']); } catch (error) { errors.push(error); }
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
  runCycle(dockerContext.name, { api: 55561, db: 55562, shadow: 55560, studio: 55563, smtp: 55564, analytics: 55567 });
  const after = inputHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('qualification inputs changed during execution');

  if (iterate) {
    process.stdout.write('iterate mode: no receipt issued (inputs are not commit-bound).\n');
    return;
  }
  if (qualificationCommitSha() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({
    schema: 'upr-job-files-private-local-qualification-v1',
    commit_sha: commit,
    cli_version: SUPABASE_CLI_VERSION,
    manifest_sha256: sha256(JSON.stringify(after)),
    inputs: Object.fromEntries(after),
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`job-files-private local qualification refused: ${error.message}\n`); process.exitCode = 2; }
}
