/**
 * ════════════════════════════════════════════════
 * FILE: qualify-notification-producer-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Qualifies the notification-producer and appointment-reminder activation
 *   train on two fresh disposable loopback-only stacks. The first proves
 *   forward and reverse rollback; the second is a clean forward reapply.
 *   No local migration ledger is edited.
 *
 * DEPENDS ON:
 *   Packages: Node.js built-ins, project Supabase CLI 2.111.0, Docker
 *   Internal: committed baseline, migration/rollback source, focused SQL proofs
 *   Data: reads → committed source; writes → disposable local containers only
 *
 * NOTES / GOTCHAS:
 *   - No command is linked, targets a URL, pushes, or resets a remote database.
 *   - Start output is deliberately suppressed because it includes local keys.
 *   - Runtime inputs must be tracked, committed, clean, and hash-manifested.
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
export const BASELINE_SHA256 = '5c802fbf4449e5752c2cf51a3c25d997a96c68cd354c2db2ceb244643c1600a0';
const LOCAL_PROJECT_ID = 'upr-pr573-notification-producer-local-v1';
const DB_CONTAINER = `supabase_db_${LOCAL_PROJECT_ID}`;
const CONTAINER_TMP_ROOT = '/tmp/upr-pr573-local-bootstrap';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_ROOT = path.join(
  os.homedir(),
  '.cache',
  'upr-notification-producer-local',
);
const SUPABASE_BIN = path.join(ROOT, 'node_modules', '.bin', 'supabase');
const TEMPLATE = path.join(ROOT, 'scripts', 'qa', 'supabase-notification-producer-local.toml');
const BASELINE = path.join(ROOT, 'db', 'baseline', 'schema.sql');
const SEED = path.join(ROOT, 'scripts', 'qa', 'seed-notification-producer-local.sql');
const FORWARD_PROOFS = [
  'supabase/tests/notification_producer_authorization.test.sql',
  'scripts/qa/sql/notification_producer_authorization_lifecycle.sql',
  'supabase/tests/appointment_reminder_delivery_claims_isolated.sql',
];
const ROLLBACK_PROOF = 'scripts/qa/sql/notification_producer_authorization_rollback_lifecycle.sql';

export const QUALIFICATION_MIGRATIONS = Object.freeze([
  ['20260730214500_pg_net_worker_url_allowlists.sql', 'a4875b9bc91a2a758e67c862c030119f4c1244aaf98ce005600f82d2482bb972'],
  ['20260731223000_notification_unsafe_producer_containment.sql', 'c65d5e64e7923ebc9f73b3a36e89b0fdc3b4052bbc2e5081d65e05f17531432e'],
  ['20260801215912_notification_producer_authorization.sql', 'af5f8a9c47edb5317172401f186d526c695e1de20f84d964d56306d0c7817e5f'],
  ['20260802040935_preserve_notify_emit_event_id.sql', '5b49c17e6ddbc229b81510ce4d0099fa6ed0021bbcf3ef5c4d1a993eb79b694d'],
  ['20260803221500_notification_activation_prerequisites.sql', 'f0c028d114e3a9f50178b3a30eb8fd5514879775b3932406285002cf66ac2aa3'],
  ['20260803223000_appointment_reminder_delivery_claims.sql', '419095740789af05164e78f6b277fdf62ed7427d7bd8aa74d0d51c7d993cf140'],
]);
export const QUALIFICATION_ROLLBACKS = Object.freeze([
  ['20260803223000_appointment_reminder_delivery_claims.rollback.sql', 'e9914d1f49bc12d4d33b01db1138c3affd62c48531de47ca2c462f2ce8aceff5'],
  ['20260803221500_notification_activation_prerequisites.rollback.sql', 'b377bfbe6884cad930d94e2ef62825f4afe99abec5d8331cf36ec5168881b4ae'],
  ['20260802040935_preserve_notify_emit_event_id.rollback.sql', 'd005ea8c2b73e10cb9df26b6419ef4144a5ad8828a51c4410f805dc429b6bb36'],
  ['20260801215912_notification_producer_authorization.rollback.sql', '914e216d8dbab2f686af6e1c7eb93307772bfefe9c056e5081c0fa35b4c601da'],
]);
export const QUALIFICATION_AUXILIARY_INPUTS = Object.freeze([
  ['scripts/qa/supabase-notification-producer-local.toml', 'acad4749eb3cc79f56c50a552b6865e1c7fa31328025427553d427497309b373'],
  ['scripts/qa/seed-notification-producer-local.sql', 'bb9fcba96db46cf4544e65d2a95e153290aa2d43cf306cf533ba1864f5647471'],
  ['supabase/tests/notification_producer_authorization.test.sql', 'f340a3cf8407a487e9b6b3a88130013f3c93b2b3a86bbfd3b087f7e2ad8f541c'],
  ['supabase/tests/notification_producer_authorization_isolated.sql', '33ab0aed65ab839796d2520f8938f117908ec16f236e09d9fef62b3a2635e774'],
  ['supabase/tests/appointment_reminder_delivery_claims_isolated.sql', 'fc85059dadb1d350205d1612547642a22fd07709895063ebc703a6341b06ff0d'],
  ['scripts/qa/sql/notification_producer_authorization_lifecycle.sql', '0455ddd5e6808b88b5b56c2598ac435ea6d7e95151ad3977d1801aac9569132f'],
  ['scripts/qa/sql/notification_producer_authorization_rollback_lifecycle.sql', '88684137e1b7e0336dabd1f5d3a8ae32450be00b3754dfa8adc7db48f9ed4b31'],
]);
export const QUALIFICATION_HASHED_INPUTS = Object.freeze([
  ['db/baseline/schema.sql', BASELINE_SHA256],
  ...QUALIFICATION_MIGRATIONS.map(([file, hash]) => [`supabase/migrations/${file}`, hash]),
  ...QUALIFICATION_ROLLBACKS.map(([file, hash]) => [`supabase/rollbacks/${file}`, hash]),
  ...QUALIFICATION_AUXILIARY_INPUTS,
]);
export const QUALIFICATION_REPOSITORY_INPUTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'scripts/qa/qualify-notification-producer-local.mjs',
  'scripts/qa/safe-child-env.mjs',
  ...QUALIFICATION_HASHED_INPUTS.map(([file]) => file),
]);

function sha256Content(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sha256(file) {
  return sha256Content(fs.readFileSync(file));
}

export function assertHashedInputs(
  entries = QUALIFICATION_HASHED_INPUTS,
  readFile = file => fs.readFileSync(file),
) {
  for (const [relativeFile, expectedHash] of entries) {
    const source = path.join(ROOT, relativeFile);
    if (sha256Content(readFile(source)) !== expectedHash) {
      throw new Error(`qualification SHA-256 differs from reviewed source: ${relativeFile}`);
    }
  }
}

export function assertCommittedInputs({ requireProofs = true } = {}) {
  assertHashedInputs();
  if (requireProofs) {
    for (const proof of [...FORWARD_PROOFS, ROLLBACK_PROOF]) {
      if (!fs.existsSync(path.join(ROOT, proof))) throw new Error(`focused SQL proof is missing: ${proof}`);
    }
  }
}

export function assertCleanQualificationStatus(statusOutput) {
  if (statusOutput.trim().length > 0) {
    throw new Error(
      'qualification inputs must be tracked, committed, and clean before local runtime mutation',
    );
  }
}

export function disposableChildEnv(source = process.env) {
  return safeChildEnv(source, {
    SUPABASE_TELEMETRY_DISABLED: '1',
    PGOPTIONS: '-cupr.isolated_test_database=on',
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...disposableChildEnv(), ...options.extraEnv },
    stdio: options.quiet ? 'pipe' : 'inherit',
    encoding: options.quiet ? 'utf8' : undefined,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${options.label ?? command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const label = options.label ?? command;
    throw new Error(options.quiet
      ? `${label} exited ${result.status}; command output suppressed to avoid local-key disclosure`
      : `${label} exited ${result.status}`);
  }
  return result.stdout ?? '';
}

function runLocalCli(args, options = {}) {
  const {
    dockerContext,
    extraEnv,
    ...runOptions
  } = options;
  return run(SUPABASE_BIN, args, {
    quiet: true,
    label: 'local Supabase CLI',
    ...runOptions,
    extraEnv: {
      ...extraEnv,
      ...(dockerContext ? { DOCKER_CONTEXT: dockerContext } : {}),
    },
  });
}

function runDocker(dockerContext, args, options = {}) {
  return run('docker', ['--context', dockerContext, ...args], options);
}

function qualificationCommitSha() {
  const status = run('git', [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    ...QUALIFICATION_REPOSITORY_INPUTS,
  ], {
    quiet: true,
    label: 'qualification input status',
  });
  assertCleanQualificationStatus(status);
  const commitSha = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    quiet: true,
    label: 'qualification commit identity',
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error('qualification commit identity is invalid');
  }
  return commitSha;
}

function emitQualificationEvidence(commitSha, dockerContext) {
  const manifestSha256 = sha256Content(
    JSON.stringify(QUALIFICATION_HASHED_INPUTS),
  );
  process.stdout.write(
    `PR #573 local qualification evidence ${JSON.stringify({
      schema: 'upr-pr573-local-qualification-v1',
      commit_sha: commitSha,
      cli_version: SUPABASE_CLI_VERSION,
      docker_context: dockerContext.name,
      docker_transport: dockerContext.endpoint.startsWith('unix://')
        ? 'unix'
        : 'npipe',
      cycles: ['forward-rollback', 'clean-reapply'],
      manifest_sha256: manifestSha256,
      inputs: Object.fromEntries(QUALIFICATION_HASHED_INPUTS),
    })}\n`,
  );
}

export function assertLocalDockerEndpoint(
  contextName,
  endpoint,
  {
    platform = process.platform,
    stat = file => fs.statSync(file),
  } = {},
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(contextName)) {
    throw new Error('Docker context name is not allowlisted');
  }
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new Error('Docker context endpoint is missing');
  }

  if (endpoint.startsWith('unix://')) {
    let socketPath;
    try {
      socketPath = decodeURIComponent(endpoint.slice('unix://'.length));
    } catch {
      throw new Error('Docker Unix-socket endpoint is malformed');
    }
    if (!path.isAbsolute(socketPath)) {
      throw new Error('Docker Unix-socket endpoint is not absolute');
    }
    let metadata;
    try {
      metadata = stat(socketPath);
    } catch {
      throw new Error('Docker Unix-socket endpoint is unavailable locally');
    }
    if (!metadata?.isSocket?.()) {
      throw new Error('Docker Unix-socket endpoint is not a local socket');
    }
    return { name: contextName, endpoint, socketPath };
  }

  if (
    platform === 'win32'
    && /^npipe:\/{2,4}\.\/pipe\/(docker_engine|dockerdesktoplinuxengine)$/i.test(endpoint)
  ) {
    return { name: contextName, endpoint, socketPath: null };
  }

  throw new Error('Docker context must use an allowlisted local Unix socket or named pipe');
}

export function verifyLocalDockerContext() {
  const contextName = run('docker', ['context', 'show'], {
    quiet: true,
    label: 'Docker context selection',
  }).trim();
  const encodedEndpoint = run('docker', [
    '--context',
    contextName,
    'context',
    'inspect',
    contextName,
    '--format',
    '{{json .Endpoints.docker.Host}}',
  ], {
    quiet: true,
    label: 'Docker context inspection',
  }).trim();
  let endpoint;
  try {
    endpoint = JSON.parse(encodedEndpoint);
  } catch {
    throw new Error('Docker context endpoint could not be decoded');
  }
  return assertLocalDockerEndpoint(contextName, endpoint);
}

function runContainerPsql(dockerContext, role, args, { isolated = false } = {}) {
  const execArgs = ['exec'];
  if (isolated) {
    execArgs.push(
      '-e',
      'PGOPTIONS=-cupr.isolated_test_database=on',
    );
  }
  execArgs.push(
    DB_CONTAINER,
    'psql',
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    role,
    '-d',
    'postgres',
  );
  if (isolated) execArgs.push('-v', 'UPR_ISOLATED_DB=1');
  execArgs.push(...args);
  runDocker(dockerContext, execArgs, { label: `local container psql (${role})` });
}

function copyIntoContainer(dockerContext, source, destination) {
  runDocker(dockerContext, ['cp', source, `${DB_CONTAINER}:${destination}`], {
    quiet: true,
    label: 'copy into disposable database container',
  });
}

export function assertProjectCli() {
  if (!fs.existsSync(SUPABASE_BIN)) throw new Error('project Supabase CLI is missing; run npm ci first');
  if (runLocalCli(['--version']).trim() !== SUPABASE_CLI_VERSION) {
    throw new Error('project Supabase CLI version differs from the reviewed pin');
  }
}

function stageHashedSources(workdir, entries, directory) {
  const target = path.join(workdir, 'supabase', directory);
  fs.mkdirSync(target, { recursive: true });
  for (const [file, expectedHash] of entries) {
    const source = path.join(ROOT, 'supabase', directory, file);
    if (sha256(source) !== expectedHash) throw new Error(`source changed while staging: ${file}`);
    fs.copyFileSync(source, path.join(target, file));
  }
  return entries.map(([file]) => path.join(target, file));
}

function stageFocusedProofs(workdir) {
  const tests = path.join(workdir, 'supabase', 'tests');
  fs.mkdirSync(tests, { recursive: true });
  for (const proof of FORWARD_PROOFS.slice(0, 1)) {
    fs.copyFileSync(path.join(ROOT, proof), path.join(tests, path.basename(proof)));
  }
  fs.copyFileSync(
    path.join(ROOT, 'supabase', 'tests', 'notification_producer_authorization_isolated.sql'),
    path.join(tests, 'notification_producer_authorization_isolated.sql'),
  );
  fs.copyFileSync(
    path.join(ROOT, 'supabase', 'tests', 'appointment_reminder_delivery_claims_isolated.sql'),
    path.join(tests, 'appointment_reminder_delivery_claims_isolated.sql'),
  );
  const lifecycle = path.join(workdir, 'scripts', 'qa', 'sql');
  fs.mkdirSync(lifecycle, { recursive: true });
  for (const proof of FORWARD_PROOFS.slice(1)) {
    fs.copyFileSync(path.join(ROOT, proof), path.join(lifecycle, path.basename(proof)));
  }
  fs.copyFileSync(
    path.join(ROOT, ROLLBACK_PROOF),
    path.join(lifecycle, path.basename(ROLLBACK_PROOF)),
  );
  return {
    forward: [
      path.join(tests, path.basename(FORWARD_PROOFS[0])),
      path.join(lifecycle, path.basename(FORWARD_PROOFS[1])),
      path.join(tests, path.basename(FORWARD_PROOFS[2])),
    ],
    rollback: path.join(lifecycle, path.basename(ROLLBACK_PROOF)),
  };
}

function stageContainerInputs(dockerContext, workdir, rollbackFiles, proofs) {
  const containerTests = `${CONTAINER_TMP_ROOT}/tests`;
  const containerRollbacks = `${CONTAINER_TMP_ROOT}/rollbacks`;
  runDocker(dockerContext, ['exec', DB_CONTAINER, 'mkdir', '-p', containerTests, containerRollbacks], {
    quiet: true,
    label: 'create disposable database container workspace',
  });
  copyIntoContainer(dockerContext, BASELINE, `${CONTAINER_TMP_ROOT}/schema.sql`);
  copyIntoContainer(dockerContext, SEED, `${CONTAINER_TMP_ROOT}/seed.sql`);
  for (const proof of [...proofs.forward, proofs.rollback]) {
    copyIntoContainer(dockerContext, proof, `${containerTests}/${path.basename(proof)}`);
  }
  copyIntoContainer(
    dockerContext,
    path.join(workdir, 'supabase', 'tests', 'notification_producer_authorization_isolated.sql'),
    `${containerTests}/notification_producer_authorization_isolated.sql`,
  );
  for (const rollback of rollbackFiles) {
    copyIntoContainer(
      dockerContext,
      rollback,
      `${containerRollbacks}/${path.basename(rollback)}`,
    );
  }
  return {
    forward: proofs.forward.map(proof => `${containerTests}/${path.basename(proof)}`),
    rollback: `${containerTests}/${path.basename(proofs.rollback)}`,
    rollbacks: rollbackFiles.map(rollback => `${containerRollbacks}/${path.basename(rollback)}`),
  };
}

function createWorkdir(cycle) {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  const workdir = fs.mkdtempSync(path.join(CACHE_ROOT, `upr-pr573-local-${cycle}-`));
  const supabaseDir = path.join(workdir, 'supabase');
  fs.mkdirSync(supabaseDir, { recursive: true });
  fs.copyFileSync(TEMPLATE, path.join(supabaseDir, 'config.toml'));
  return workdir;
}

function createLoopbackNetwork(dockerContext) {
  const network = `upr-pr573-local-${process.pid}-${randomUUID().slice(0, 8)}`;
  runDocker(dockerContext, [
    'network', 'create', '--driver', 'bridge',
    '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', network,
  ], { quiet: true, label: 'disposable loopback Docker network' });
  const binding = runDocker(dockerContext, [
    'network', 'inspect', '--format', '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}', network,
  ], { quiet: true, label: 'disposable loopback Docker network inspection' }).trim();
  if (binding !== '127.0.0.1') {
    try {
      runDocker(dockerContext, ['network', 'rm', network], {
        quiet: true,
        label: 'disposable loopback Docker network removal',
      });
    } catch {
      /* preserve primary failure */
    }
    throw new Error('disposable Docker network is not bound exactly to 127.0.0.1');
  }
  return network;
}

function destroyLoopbackNetwork(dockerContext, network) {
  runDocker(dockerContext, ['network', 'rm', network], {
    quiet: true,
    label: 'disposable loopback Docker network removal',
  });
}

function assertDisposableDatabaseContainer(dockerContext, network) {
  const labelsJson = runDocker(dockerContext, [
    'inspect',
    '--format',
    '{{json .Config.Labels}}',
    DB_CONTAINER,
  ], {
    quiet: true,
    label: 'disposable database label inspection',
  }).trim();
  const networksJson = runDocker(dockerContext, [
    'inspect',
    '--format',
    '{{json .NetworkSettings.Networks}}',
    DB_CONTAINER,
  ], {
    quiet: true,
    label: 'disposable database network inspection',
  }).trim();
  const networkId = runDocker(dockerContext, [
    'network',
    'inspect',
    '--format',
    '{{.Id}}',
    network,
  ], {
    quiet: true,
    label: 'disposable Docker network identity inspection',
  }).trim();
  let labels;
  let networks;
  try {
    labels = JSON.parse(labelsJson);
    networks = JSON.parse(networksJson);
  } catch {
    throw new Error('disposable database identity could not be decoded');
  }
  if (labels?.['com.supabase.cli.project'] !== LOCAL_PROJECT_ID) {
    throw new Error('database container is not labeled for the disposable project');
  }
  if (
    !networks
    || typeof networks !== 'object'
    || networks[network]?.NetworkID !== networkId
  ) {
    throw new Error('database container is not attached to the verified disposable network');
  }
}

function runProofs(dockerContext, proofs) {
  for (const proof of proofs) {
    runContainerPsql(dockerContext, 'postgres', ['-f', proof], { isolated: true });
  }
}

function qualifyFreshStack(dockerContext, cycle, network, { proveRollback }) {
  const workdir = createWorkdir(cycle);
  let startAttempted = false;
  let postgresMembershipGranted = false;
  let completed = false;
  try {
    startAttempted = true;
    runLocalCli(
      ['start', '--network-id', network, '--workdir', workdir, '--yes'],
      { dockerContext, label: 'local Supabase start' },
    );
    assertDisposableDatabaseContainer(dockerContext, network);
    runContainerPsql(
      dockerContext,
      'supabase_admin',
      ['-c', 'GRANT supabase_admin TO postgres;'],
    );
    postgresMembershipGranted = true;
    runContainerPsql(
      dockerContext,
      'postgres',
      ['-c', 'DROP SCHEMA public CASCADE;'],
    );
    const rollbackFiles = stageHashedSources(workdir, QUALIFICATION_ROLLBACKS, 'rollbacks');
    const proofs = stageFocusedProofs(workdir);
    const containerInputs = stageContainerInputs(
      dockerContext,
      workdir,
      rollbackFiles,
      proofs,
    );
    runContainerPsql(
      dockerContext,
      'postgres',
      ['-f', `${CONTAINER_TMP_ROOT}/schema.sql`],
    );
    runContainerPsql(
      dockerContext,
      'postgres',
      ['-c', 'CREATE EXTENSION IF NOT EXISTS pg_cron;'],
    );
    runContainerPsql(dockerContext, 'postgres', [
      '-c',
      'CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;',
    ]);
    runContainerPsql(dockerContext, 'postgres', [
      '-c',
      "DO $$ BEGIN IF to_regclass('cron.job') IS NULL THEN RAISE EXCEPTION 'local pg_cron unavailable'; END IF; IF to_regprocedure('extensions.plan(integer)') IS NULL THEN RAISE EXCEPTION 'local pgtap unavailable'; END IF; END $$;",
    ]);
    // A second application is intentional: the governed fixture must reassert
    // its exact predecessor state without duplicating catalog or cron rows.
    runContainerPsql(
      dockerContext,
      'postgres',
      ['-f', `${CONTAINER_TMP_ROOT}/seed.sql`],
    );
    runContainerPsql(
      dockerContext,
      'postgres',
      ['-f', `${CONTAINER_TMP_ROOT}/seed.sql`],
    );
    stageHashedSources(workdir, QUALIFICATION_MIGRATIONS, 'migrations');
    runLocalCli(
      ['migration', 'up', '--local', '--workdir', workdir, '--yes'],
      { dockerContext, label: 'local Supabase migration up' },
    );
    runProofs(dockerContext, containerInputs.forward);
    if (proveRollback) {
      runContainerPsql(dockerContext, 'postgres', [
        '--single-transaction',
        ...containerInputs.rollbacks.flatMap(file => ['-f', file]),
      ]);
      runProofs(dockerContext, [containerInputs.rollback]);
    }
    completed = true;
    process.stdout.write(`PR #573 local qualification cycle ${cycle} passed.\n`);
  } finally {
    const cleanupErrors = [];
    if (postgresMembershipGranted) {
      try {
        runContainerPsql(
          dockerContext,
          'supabase_admin',
          ['-c', 'REVOKE supabase_admin FROM postgres;'],
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        runContainerPsql(dockerContext, 'supabase_admin', [
          '-c',
          "DO $$ BEGIN IF pg_has_role('postgres', 'supabase_admin', 'member') THEN RAISE EXCEPTION 'local restore role membership retained'; END IF; END $$;",
        ]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (startAttempted) {
      try {
        runLocalCli(
          ['stop', '--no-backup', '--workdir', workdir],
          { dockerContext, label: 'local Supabase stop' },
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length === 0) {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`local cleanup failed; preserved ${workdir}: ${cleanupErrors.map(error => error.message).join('; ')}`);
    }
    if (!completed) process.stdout.write(`PR #573 local qualification cycle ${cycle} failed.\n`);
  }
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0) throw new Error('this local-only qualification accepts no arguments');
  assertCommittedInputs();
  const commitSha = qualificationCommitSha();
  assertProjectCli();
  const dockerContext = verifyLocalDockerContext();
  const network = createLoopbackNetwork(dockerContext.name);
  let qualificationError = null;
  let networkError = null;
  try {
    qualifyFreshStack(
      dockerContext.name,
      'forward-rollback',
      network,
      { proveRollback: true },
    );
    qualifyFreshStack(
      dockerContext.name,
      'clean-reapply',
      network,
      { proveRollback: false },
    );
  } catch (error) {
    qualificationError = error;
  } finally {
    try {
      destroyLoopbackNetwork(dockerContext.name, network);
    } catch (error) {
      networkError = error;
    }
  }
  if (qualificationError && networkError) {
    throw new Error(`${qualificationError.message}; ${networkError.message}`);
  }
  if (qualificationError) throw qualificationError;
  if (networkError) throw networkError;
  assertCommittedInputs();
  if (qualificationCommitSha() !== commitSha) {
    throw new Error('qualification commit changed during local execution');
  }
  emitQualificationEvidence(commitSha, dockerContext);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`PR #573 local qualification refused: ${error.message}\n`);
    process.exitCode = 2;
  }
}
