/**
 * ════════════════════════════════════════════════
 * FILE: qualify-notification-producer-crew-composition-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Qualifies the forward-only notification-producer + Crew Phase-A composition
 *   on two fresh, disposable loopback-only Supabase stacks. It never links to,
 *   pushes to, or resets a hosted project. The two predecessor lineages mirror
 *   Production (no original producer migrations) and QA (M1/M2 already applied).
 *
 * DEPENDS ON:
 *   Packages: Node built-ins, project-pinned Supabase CLI 2.111.0, Docker
 *   Data: reads committed source; writes only owned local containers/workdirs
 *
 * NOTES / GOTCHAS:
 *   - Runtime output from `supabase start` is suppressed because it contains
 *     local development keys.
 *   - Every source input is SHA-256 bound and must be clean at one commit.
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
export const CHILD_PROCESS_TIMEOUT_MS = 300_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUPABASE_BIN = path.join(ROOT, 'node_modules', '.bin', 'supabase');
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'upr-notification-crew-composition-local');
const CONTAINER_ROOT = '/tmp/upr-notification-crew-composition-local';
const PORT_PROBE_TIMEOUT_MS = 10_000;
const PORT_PROBE_SOURCE = `
const net = require('node:net');
const ports = JSON.parse(process.argv[1]);
const servers = [];
const closeAll = () => Promise.all(servers.map(server => (
  server.listening
    ? new Promise(resolve => server.close(resolve))
    : Promise.resolve()
)));
(async () => {
  try {
    for (const port of ports) {
      const server = net.createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
      });
    }
    await closeAll();
  } catch {
    await closeAll();
    process.exitCode = 1;
  }
})();
`;

export const PRODUCTION_PREDECESSOR = Object.freeze([
  ['db/baseline/schema.sql', 'd7db40590c27b3842ee9c51784ebba0503a29bd25e7501df42b2f9076a2d8b92'],
  ['scripts/qa/seed-notification-producer-crew-composition-local.sql', '2ac5a58e3ae9f867b87422f65dc43f50abb1d08098a19ea2fb262a2822207ba0'],
  ['scripts/qa/seed-notification-producer-crew-composition-production-local.sql', '5e0fefaefac536bc182c91703c02ef435087b9c8674af3cb0cfdb1af4423ab42'],
  ['supabase/migrations/20260730214500_pg_net_worker_url_allowlists.sql', 'a4875b9bc91a2a758e67c862c030119f4c1244aaf98ce005600f82d2482bb972'],
  ['supabase/migrations/20260731223000_notification_unsafe_producer_containment.sql', 'c65d5e64e7923ebc9f73b3a36e89b0fdc3b4052bbc2e5081d65e05f17531432e'],
  ['supabase/migrations/20260804000042_sync_appointment_crew_enum_authorization_hotfix.sql', '465e2a3136f56ffcbc25d227f40fb9137f1984f716c3bd654ced6414432020da'],
  ['supabase/migrations/20260804000910_appointment_crew_atomic_save_and_audit_repair.sql', '9d8f44c578f169dd497e3832da59bf1e198e33c19ef558254ff203e628fa14c6'],
]);
export const QA_PREDECESSOR = Object.freeze([
  ['db/baseline/schema.sql', 'd7db40590c27b3842ee9c51784ebba0503a29bd25e7501df42b2f9076a2d8b92'],
  ['scripts/qa/seed-notification-producer-crew-composition-local.sql', '2ac5a58e3ae9f867b87422f65dc43f50abb1d08098a19ea2fb262a2822207ba0'],
  ['supabase/migrations/20260730214500_pg_net_worker_url_allowlists.sql', 'a4875b9bc91a2a758e67c862c030119f4c1244aaf98ce005600f82d2482bb972'],
  ['supabase/migrations/20260731223000_notification_unsafe_producer_containment.sql', 'c65d5e64e7923ebc9f73b3a36e89b0fdc3b4052bbc2e5081d65e05f17531432e'],
  ['supabase/migrations/20260801215912_notification_producer_authorization.sql', 'af5f8a9c47edb5317172401f186d526c695e1de20f84d964d56306d0c7817e5f'],
  ['supabase/migrations/20260802040935_preserve_notify_emit_event_id.sql', '5b49c17e6ddbc229b81510ce4d0099fa6ed0021bbcf3ef5c4d1a993eb79b694d'],
  ['supabase/migrations/20260804000910_appointment_crew_atomic_save_and_audit_repair.sql', '9d8f44c578f169dd497e3832da59bf1e198e33c19ef558254ff203e628fa14c6'],
]);
export const SUCCESSOR_INPUTS = Object.freeze([
  ['supabase/migrations/20260804153859_notification_producer_crew_phase_a_composition.sql', '9c263a3a681eaa15706645c1d9a39685c664d7dda5aa355e1967821559d1c570'],
  ['supabase/rollbacks/20260804153859_notification_producer_crew_phase_a_composition.rollback.sql', 'dbd9132e651c32597dacae4e62a1d46936294007207729cba87550699a90197c'],
  ['supabase/tests/appointment_crew_atomic_save_and_audit_repair.test.sql', 'd3a316557eb75545e0743c26ccada832adc64682db8dcaccb3196cb1b6e94c09'],
  ['supabase/tests/notification_producer_crew_phase_a_composition_isolated.sql', 'ef41a08ed88e6b0ddbe89e3abdc137681b218403e8a82b30720ea24b932320c3'],
  ['scripts/qa/sql/notification_producer_crew_phase_a_composition_lifecycle.sql', 'c3ca435dae8fc205a400cc4f7298b1490e7b5b9d827a079e8f6d6d14811e2067'],
  ['scripts/qa/sql/notification_producer_crew_phase_a_composition_rollback_lifecycle.sql', '83c6eddec374b757bafa4ea7a93b82ab0a14bafbdad2691962f4e32ce2390c0f'],
]);
export const QUALIFICATION_HASHED_INPUTS = Object.freeze([
  ...PRODUCTION_PREDECESSOR,
  ...QA_PREDECESSOR.filter(([file]) => file !== 'db/baseline/schema.sql'),
  ...SUCCESSOR_INPUTS,
]);
export const QUALIFICATION_REPOSITORY_INPUTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'scripts/qa/qualify-notification-producer-crew-composition-local.mjs',
  'scripts/qa/safe-child-env.mjs',
  'tests/qa/unit/notification-producer-crew-composition-local.test.js',
  'tests/qa/unit/notification-producer-crew-composition.test.js',
  ...QUALIFICATION_HASHED_INPUTS.map(([file]) => file),
]);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => sha256(fs.readFileSync(file));
const inputPath = relative => path.join(ROOT, relative);

export function assertHashedInputs(entries = QUALIFICATION_HASHED_INPUTS, readFile = fs.readFileSync) {
  for (const [relative, expected] of entries) {
    if (sha256(readFile(inputPath(relative))) !== expected) {
      throw new Error(`qualification SHA-256 differs from reviewed source: ${relative}`);
    }
  }
}

export function assertCleanQualificationStatus(status) {
  if (status.trim()) throw new Error('qualification inputs must be tracked, committed, and clean before local runtime mutation');
}

export function disposableChildEnv(source = process.env) {
  return safeChildEnv(source, {
    SUPABASE_TELEMETRY_DISABLED: '1',
    PGOPTIONS: '-cupr.isolated_test_database=on',
  });
}

export function childResultOrThrow(result, {
  label,
  quiet,
  timeoutMs,
}) {
  if (result.error?.code === 'ETIMEDOUT') {
    const disclosureGuard = quiet
      ? '; command output suppressed to avoid local-key disclosure'
      : '';
    throw new Error(`${label} exceeded ${timeoutMs} ms and was terminated${disclosureGuard}`);
  }
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(quiet
    ? `${label} exited ${result.status}; command output suppressed to avoid local-key disclosure`
    : `${label} exited ${result.status}`);
  return result.stdout ?? '';
}

function run(command, args, {
  cwd = ROOT,
  quiet = false,
  label = command,
  extraEnv = {},
  timeoutMs = CHILD_PROCESS_TIMEOUT_MS,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CHILD_PROCESS_TIMEOUT_MS) {
    throw new Error(`${label} timeout must be between 1 and ${CHILD_PROCESS_TIMEOUT_MS} ms`);
  }
  const result = spawnSync(command, args, {
    cwd,
    env: { ...disposableChildEnv(), ...extraEnv },
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: quiet ? 'utf8' : undefined,
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  return childResultOrThrow(result, { label, quiet, timeoutMs });
}

function docker(context, args, options = {}) {
  return run('docker', ['--context', context, ...args], options);
}

export function assertLocalDockerEndpoint(contextName, endpoint, { stat = fs.statSync, platform = process.platform } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(contextName)) throw new Error('Docker context name is not allowlisted');
  if (typeof endpoint !== 'string' || !endpoint) throw new Error('Docker context endpoint is missing');
  if (endpoint.startsWith('unix://')) {
    const socket = decodeURIComponent(endpoint.slice('unix://'.length));
    if (!path.isAbsolute(socket)) throw new Error('Docker Unix-socket endpoint is not absolute');
    let metadata;
    try { metadata = stat(socket); } catch { throw new Error('Docker Unix-socket endpoint is unavailable locally'); }
    if (!metadata?.isSocket?.()) throw new Error('Docker Unix-socket endpoint is not a local socket');
    return { name: contextName, endpoint, socketPath: socket };
  }
  if (platform === 'win32' && /^npipe:\/{2,4}\.\/pipe\/(docker_engine|dockerdesktoplinuxengine)$/i.test(endpoint)) {
    return { name: contextName, endpoint, socketPath: null };
  }
  throw new Error('Docker context must use an allowlisted local Unix socket or named pipe');
}

export function verifyLocalDockerContext() {
  const name = run('docker', ['context', 'show'], { quiet: true, label: 'Docker context selection' }).trim();
  const raw = run('docker', ['--context', name, 'context', 'inspect', name, '--format', '{{json .Endpoints.docker.Host}}'], { quiet: true, label: 'Docker context inspection' }).trim();
  let endpoint;
  try { endpoint = JSON.parse(raw); } catch { throw new Error('Docker context endpoint could not be decoded'); }
  return assertLocalDockerEndpoint(name, endpoint);
}

function assertProjectCli() {
  if (!fs.existsSync(SUPABASE_BIN)) throw new Error('project Supabase CLI is missing; run npm ci first');
  if (run(SUPABASE_BIN, ['--version'], { quiet: true, label: 'project Supabase CLI' }).trim() !== SUPABASE_CLI_VERSION) throw new Error('project Supabase CLI version differs from the reviewed pin');
}

function qualificationCommitSha() {
  for (const relative of QUALIFICATION_REPOSITORY_INPUTS) {
    run('git', ['ls-files', '--error-unmatch', '--', relative], { quiet: true, label: 'qualification tracked-input check' });
  }
  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...QUALIFICATION_REPOSITORY_INPUTS], { quiet: true, label: 'qualification input status' });
  assertCleanQualificationStatus(status);
  const sha = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { quiet: true, label: 'qualification commit identity' }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('qualification commit identity is invalid');
  return sha;
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

function copyToContainer(context, container, source, destination) {
  docker(context, ['cp', source, `${container}:${destination}`], { quiet: true, label: 'copy into disposable database container' });
}

function stageMigrations(workdir, entries) {
  const migrations = path.join(workdir, 'supabase', 'migrations');
  fs.mkdirSync(migrations, { recursive: true });
  for (const [relative, expectedHash] of entries) {
    if (!relative.startsWith('supabase/migrations/')) continue;
    const source = inputPath(relative);
    if (fileHash(source) !== expectedHash) {
      throw new Error(`source changed while staging: ${relative}`);
    }
    fs.copyFileSync(source, path.join(migrations, path.basename(source)));
  }
}
function psql(context, container, role, args, { isolated = false } = {}) {
  const command = ['exec'];
  if (isolated) command.push('-e', 'PGOPTIONS=-cupr.isolated_test_database=on');
  command.push(container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1');
  if (isolated) command.push('-v', 'UPR_ISOLATED_DB=1');
  command.push('-U', role, '-d', 'postgres', ...args);
  docker(context, command, { label: `local container psql (${role})` });
}

function createNetwork(context, name) {
  docker(context, ['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', name], { quiet: true, label: 'disposable loopback Docker network' });
  const binding = docker(context, ['network', 'inspect', '--format', '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}', name], { quiet: true, label: 'disposable loopback Docker network inspection' }).trim();
  if (binding !== '127.0.0.1') {
    try {
      docker(context, ['network', 'rm', name], { quiet: true, label: 'disposable loopback Docker network removal' });
    } catch {
      /* Preserve the primary refusal while leaving cleanup evidence in Docker. */
    }
    throw new Error('disposable Docker network is not bound exactly to 127.0.0.1');
  }
  return name;
}

function assertDisposableDatabaseContainer(context, container, projectId, network) {
  const labelsJson = docker(context, ['inspect', '--format', '{{json .Config.Labels}}', container], { quiet: true, label: 'disposable database label inspection' }).trim();
  const networksJson = docker(context, ['inspect', '--format', '{{json .NetworkSettings.Networks}}', container], { quiet: true, label: 'disposable database network inspection' }).trim();
  const networkId = docker(context, ['network', 'inspect', '--format', '{{.Id}}', network], { quiet: true, label: 'disposable Docker network identity inspection' }).trim();
  let labels;
  let networks;
  try {
    labels = JSON.parse(labelsJson);
    networks = JSON.parse(networksJson);
  } catch {
    throw new Error('disposable database identity could not be decoded');
  }
  if (labels?.['com.supabase.cli.project'] !== projectId) {
    throw new Error('database container is not labeled for this disposable project');
  }
  if (!networks || typeof networks !== 'object' || networks[network]?.NetworkID !== networkId) {
    throw new Error('database container is not attached to the verified disposable network');
  }
}

function listOwnedContainerIds(context, projectId, all = false) {
  const args = ['ps'];
  if (all) args.push('-a');
  args.push(
    '--filter',
    `label=com.supabase.cli.project=${projectId}`,
    '--format',
    '{{.ID}}',
  );
  return docker(context, args, {
    quiet: true,
    label: all
      ? 'post-cleanup all disposable container assertion'
      : 'post-cleanup running disposable process assertion',
  });
}

function listMatchingNetworkNames(context, network) {
  return docker(context, [
    'network',
    'ls',
    '--filter',
    `name=${network}`,
    '--format',
    '{{.Name}}',
  ], { quiet: true, label: 'post-cleanup disposable network assertion' });
}

export function assertCleanupObservation({
  runningContainerIds,
  allContainerIds,
  networkNames,
}, network) {
  if (runningContainerIds.trim()) {
    throw new Error('post-cleanup check found a running process for the disposable project');
  }
  if (allContainerIds.trim()) {
    throw new Error('post-cleanup check found containers for the disposable project');
  }
  const remainingNetworks = networkNames.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
  if (remainingNetworks.includes(network)) {
    throw new Error('post-cleanup check found the disposable Docker network');
  }
}

function assertPortsAvailable(ports, label) {
  run(
    process.execPath,
    ['-e', PORT_PROBE_SOURCE, JSON.stringify(Object.values(ports))],
    {
      quiet: true,
      label,
      timeoutMs: PORT_PROBE_TIMEOUT_MS,
    },
  );
}

function removeOwnedContainers(context, projectId) {
  const ids = listOwnedContainerIds(context, projectId, true)
    .split(/\r?\n/u)
    .map(value => value.trim())
    .filter(Boolean);
  if (!ids.length) return;
  if (ids.some(id => !/^[a-f0-9]{12,64}$/u.test(id))) {
    throw new Error('owned disposable container identity was ambiguous');
  }
  for (const id of ids) {
    const label = docker(context, [
      'inspect',
      '--format',
      '{{index .Config.Labels "com.supabase.cli.project"}}',
      id,
    ], { quiet: true, label: 'owned disposable container label verification' }).trim();
    if (label !== projectId) {
      throw new Error('refusing to remove a container outside the disposable project');
    }
  }
  docker(context, ['rm', '--force', ...ids], {
    quiet: true,
    label: 'owned disposable container fallback removal',
  });
}

function removeOwnedNetwork(context, network) {
  const names = listMatchingNetworkNames(context, network)
    .split(/\r?\n/u)
    .map(value => value.trim())
    .filter(Boolean);
  if (names.includes(network)) {
    docker(context, ['network', 'rm', network], {
      quiet: true,
      label: 'disposable loopback Docker network removal',
    });
  }
}

function assertPostCleanup(context, projectId, network, ports) {
  const runningContainerIds = listOwnedContainerIds(context, projectId);
  const allContainerIds = listOwnedContainerIds(context, projectId, true);
  const networkNames = listMatchingNetworkNames(context, network);
  assertCleanupObservation({
    runningContainerIds,
    allContainerIds,
    networkNames,
  }, network);
  assertPortsAvailable(ports, 'post-cleanup loopback port assertion');
}

function compositionRollbackProof(context, container) {
  const sql = `BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
    'public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)',
    'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
    'public.release_notification_delivery_claim(uuid)',
    'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'
  ]::text[] LOOP
    IF to_regprocedure(v_signature) IS NULL
       OR has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       OR has_function_privilege('service_role', to_regprocedure(v_signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'composition rollback retained notification mutation (%)', v_signature;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.sync_appointment_crew(uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'composition rollback regressed Phase-A browser crew RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.sync_appointment_crew(uuid,jsonb,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'composition rollback regressed Phase-A service crew RPC';
  END IF;
END $$;
ROLLBACK;`;
  psql(context, container, 'postgres', ['-c', sql], { isolated: true });
}

function runCycle(context, cycle, predecessor, ports) {
  const cycleSlug = cycle === 'production-predecessor' ? 'prod' : 'qa';
  const projectId = `uprcr-${cycleSlug}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const container = `supabase_db_${projectId}`;
  const network = `upr-notification-crew-composition-${process.pid}-${randomUUID().slice(0, 8)}`;
  assertPortsAvailable(ports, 'preflight loopback port availability assertion');
  const workdir = fs.mkdtempSync(path.join(CACHE_ROOT, `${cycle}-`));
  let startAttempted = false;
  let started = false;
  let primaryError = null;
  try {
    createNetwork(context, network);
    writeConfig(workdir, projectId, ports);
    startAttempted = true;
    run(SUPABASE_BIN, ['start', '--network-id', network, '--workdir', workdir, '--yes'], { quiet: true, label: 'local Supabase start', extraEnv: { DOCKER_CONTEXT: context } });
    started = true;
    assertDisposableDatabaseContainer(context, container, projectId, network);
    psql(context, container, 'supabase_admin', ['-c', 'GRANT supabase_admin TO postgres;']);
    psql(context, container, 'postgres', ['-c', 'DROP SCHEMA public CASCADE;']);
    docker(context, ['exec', container, 'mkdir', '-p', `${CONTAINER_ROOT}/inputs`], { quiet: true, label: 'create disposable input directory' });
    for (const [relative] of SUCCESSOR_INPUTS) {
      if (relative.startsWith('supabase/migrations/')) continue;
      const source = inputPath(relative);
      copyToContainer(context, container, source, `${CONTAINER_ROOT}/inputs/${path.basename(source)}`);
    }
    copyToContainer(context, container, inputPath('db/baseline/schema.sql'), `${CONTAINER_ROOT}/inputs/schema.sql`);
    const seedEntries = predecessor.filter(([relative]) => (
      relative.startsWith('scripts/qa/seed-notification-producer-crew-composition')
    ));
    for (const [relative] of seedEntries) {
      const source = inputPath(relative);
      copyToContainer(context, container, source, `${CONTAINER_ROOT}/inputs/${path.basename(source)}`);
    }
    copyToContainer(
      context,
      container,
      inputPath('supabase/migrations/20260804153859_notification_producer_crew_phase_a_composition.sql'),
      `${CONTAINER_ROOT}/inputs/20260804153859_notification_producer_crew_phase_a_composition.sql`,
    );
    psql(context, container, 'postgres', ['-f', `${CONTAINER_ROOT}/inputs/schema.sql`]);
    psql(context, container, 'postgres', ['-c', 'CREATE EXTENSION IF NOT EXISTS pg_cron;']);
    psql(context, container, 'postgres', ['-c', 'CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;']);
    psql(context, container, 'postgres', ['-c', "DO $$ BEGIN IF to_regclass('cron.job') IS NULL THEN RAISE EXCEPTION 'local pg_cron unavailable'; END IF; IF to_regprocedure('extensions.plan(integer)') IS NULL THEN RAISE EXCEPTION 'local pgtap unavailable'; END IF; END $$;"]);
    for (const [relative] of seedEntries) {
      psql(context, container, 'postgres', ['-f', `${CONTAINER_ROOT}/inputs/${path.basename(relative)}`]);
    }
    // Apply the exact predecessor first, then the Phase-A composition.
    stageMigrations(workdir, predecessor.slice(1, -1));
    run(SUPABASE_BIN, ['migration', 'up', '--local', '--workdir', workdir, '--yes'], {
      label: 'local composition migration up',
      extraEnv: { DOCKER_CONTEXT: context },
    });
    stageMigrations(workdir, [predecessor.at(-1), SUCCESSOR_INPUTS[0]]);
    run(SUPABASE_BIN, ['migration', 'up', '--local', '--workdir', workdir, '--yes'], {
      label: 'local Phase-A composition migration up',
      extraEnv: { DOCKER_CONTEXT: context },
    });
    const composition = `${CONTAINER_ROOT}/inputs/20260804153859_notification_producer_crew_phase_a_composition.sql`;
    const rollback = `${CONTAINER_ROOT}/inputs/20260804153859_notification_producer_crew_phase_a_composition.rollback.sql`;
    const forwardProofs = [
      'appointment_crew_atomic_save_and_audit_repair.test.sql',
      'notification_producer_crew_phase_a_composition_isolated.sql',
      'notification_producer_crew_phase_a_composition_lifecycle.sql',
    ];
    // The first forward application records the exact staged migration ledger.
    for (const proof of forwardProofs) psql(context, container, 'postgres', ['-f', `${CONTAINER_ROOT}/inputs/${proof}`], { isolated: true });
    psql(context, container, 'postgres', ['--single-transaction', '-f', rollback]);
    psql(context, container, 'postgres', ['-f', `${CONTAINER_ROOT}/inputs/notification_producer_crew_phase_a_composition_rollback_lifecycle.sql`], { isolated: true });
    compositionRollbackProof(context, container);
    psql(context, container, 'postgres', ['-f', `${CONTAINER_ROOT}/inputs/appointment_crew_atomic_save_and_audit_repair.test.sql`], { isolated: true });
    psql(context, container, 'postgres', ['-f', composition]);
    for (const proof of forwardProofs) psql(context, container, 'postgres', ['-f', `${CONTAINER_ROOT}/inputs/${proof}`], { isolated: true });
    process.stdout.write(`notification + Crew Phase-A composition local qualification cycle ${cycle} passed.\n`);
  } catch (error) {
    primaryError = error;
  } finally {
    const errors = [];
    if (started) {
      try { psql(context, container, 'supabase_admin', ['-c', 'REVOKE supabase_admin FROM postgres;']); } catch (error) { errors.push(error); }
    }
    if (startAttempted) {
      try { run(SUPABASE_BIN, ['stop', '--no-backup', '--workdir', workdir], { quiet: true, label: 'local Supabase stop', extraEnv: { DOCKER_CONTEXT: context } }); } catch (error) { errors.push(error); }
    }
    try { removeOwnedContainers(context, projectId); } catch (error) { errors.push(error); }
    try { removeOwnedNetwork(context, network); } catch (error) { errors.push(error); }
    try { assertPostCleanup(context, projectId, network, ports); } catch (error) { errors.push(error); }
    if (errors.length) {
      const primary = primaryError ? `${primaryError.message}; ` : '';
      throw new Error(`${primary}local cleanup failed; preserved ${workdir}: ${errors.map(error => error.message).join('; ')}`);
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  }
  if (primaryError) throw primaryError;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length) throw new Error('this local-only qualification accepts no arguments');
  assertHashedInputs();
  const commit = qualificationCommitSha();
  assertProjectCli();
  const dockerContext = verifyLocalDockerContext();
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  runCycle(dockerContext.name, 'production-predecessor', PRODUCTION_PREDECESSOR, {
    api: 55421, db: 55422, shadow: 55420, studio: 55423, smtp: 55424, analytics: 55427,
  });
  runCycle(dockerContext.name, 'qa-m1-m2-predecessor', QA_PREDECESSOR, {
    api: 55431, db: 55432, shadow: 55430, studio: 55433, smtp: 55434, analytics: 55437,
  });
  assertHashedInputs();
  if (qualificationCommitSha() !== commit) throw new Error('qualification commit changed during local execution');
  process.stdout.write(`${JSON.stringify({ schema: 'upr-notification-crew-phase-a-composition-local-qualification-v1', commit_sha: commit, cli_version: SUPABASE_CLI_VERSION, cycles: ['production-predecessor', 'qa-m1-m2-predecessor'], manifest_sha256: sha256(JSON.stringify(QUALIFICATION_HASHED_INPUTS)), inputs: Object.fromEntries(QUALIFICATION_HASHED_INPUTS) })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`Notification + Crew Phase-A composition local qualification refused: ${error.message}\n`); process.exitCode = 2; }
}
