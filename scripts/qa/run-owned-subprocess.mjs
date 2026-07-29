/**
 * ════════════════════════════════════════════════
 * FILE: run-owned-subprocess.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs one release command in its own process group, enforces a bounded
 *   timeout, and guarantees that children such as Xcode, Fastlane, or upload
 *   helpers cannot survive the owning step.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (release/QA command-line helper)
 *
 * DEPENDS ON:
 *   Packages:     Node built-ins only
 *   Internal:     scripts/qa/safe-child-env.mjs when --safe-env is selected;
 *                 called by .github/workflows/ios-release.yml
 *   Data:         reads/writes only what the wrapped command owns
 *
 * NOTES / GOTCHAS:
 *   - `detached: true` creates the owned POSIX process group. Cleanup signals
 *     the negative PID, never a process name, so unrelated processes are safe.
 *   - The timeout maximum is five minutes by repository law. Shorter values are
 *     allowed for tests; longer values are rejected before a child starts.
 *   - Exception (owner-authorized 2026-07-29): a named CI build step may raise
 *     the total-runtime budget with an explicit `--total-runtime-ms`, floor =
 *     the five-minute default (the flag can only raise, never shrink), ceiling
 *     = 45 minutes to match the CI job timeout that still bounds the step. A
 *     clean Capacitor Release archive cannot finish in five minutes, so
 *     without this the iOS release workflow fails by construction.
 * ════════════════════════════════════════════════
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { safeChildEnv } from './safe-child-env.mjs';

const MAX_TOTAL_RUNTIME_MS = 300_000;
const ABSOLUTE_TOTAL_RUNTIME_CEILING_MS = 2_700_000;
const TERM_GRACE_MS = 5_000;
const VERIFY_INTERVAL_MS = 100;
const VERIFY_ATTEMPTS = 30;
const MAX_COMMAND_TIMEOUT_MS = (
  MAX_TOTAL_RUNTIME_MS
  - TERM_GRACE_MS
  - (VERIFY_INTERVAL_MS * VERIFY_ATTEMPTS)
);

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    'Usage: node scripts/qa/run-owned-subprocess.mjs '
      + '[--timeout-ms N] [--total-runtime-ms N] [--cwd PATH] [--safe-env] -- COMMAND [ARGS...]\n',
  );
  process.exitCode = 2;
}

function parseArguments(argv) {
  let timeoutMs = MAX_COMMAND_TIMEOUT_MS;
  let totalRuntimeMs = MAX_TOTAL_RUNTIME_MS;
  let termGraceMs = TERM_GRACE_MS;
  let cwd = process.cwd();
  let useSafeEnv = false;
  let index = 0;

  while (index < argv.length && argv[index] !== '--') {
    const argument = argv[index];
    if (argument === '--timeout-ms') {
      timeoutMs = Number(argv[index + 1]);
      index += 2;
      continue;
    }
    if (argument === '--cwd') {
      cwd = argv[index + 1];
      index += 2;
      continue;
    }
    if (argument === '--safe-env') {
      useSafeEnv = true;
      index += 1;
      continue;
    }
    if (argument === '--term-grace-ms') {
      termGraceMs = Number(argv[index + 1]);
      index += 2;
      continue;
    }
    if (argument === '--total-runtime-ms') {
      totalRuntimeMs = Number(argv[index + 1]);
      index += 2;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  const command = argv.slice(index + 1);
  if (!Number.isInteger(termGraceMs) || termGraceMs < 0 || termGraceMs > TERM_GRACE_MS) {
    throw new Error(`--term-grace-ms must be an integer from 0 to ${TERM_GRACE_MS}`);
  }
  if (
    !Number.isInteger(totalRuntimeMs)
    || totalRuntimeMs < MAX_TOTAL_RUNTIME_MS
    || totalRuntimeMs > ABSOLUTE_TOTAL_RUNTIME_CEILING_MS
  ) {
    throw new Error(
      `--total-runtime-ms must be an integer from ${MAX_TOTAL_RUNTIME_MS} `
      + `to ${ABSOLUTE_TOTAL_RUNTIME_CEILING_MS} (it raises the budget for a `
      + 'named build step; it never shrinks it)',
    );
  }
  const maxTimeoutMs = (
    totalRuntimeMs
    - termGraceMs
    - (VERIFY_INTERVAL_MS * VERIFY_ATTEMPTS)
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maxTimeoutMs) {
    throw new Error(`--timeout-ms must be an integer from 1 to ${maxTimeoutMs}`);
  }
  if (!cwd) throw new Error('--cwd requires a path');
  if (argv[index] !== '--' || command.length === 0) {
    throw new Error('A command is required after --');
  }

  return {
    timeoutMs,
    termGraceMs,
    cwd,
    useSafeEnv,
    command,
  };
}

function delay(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function verifyProcessGroupGone(pid) {
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    if (!processGroupExists(pid)) return;
    await delay(VERIFY_INTERVAL_MS);
  }
  throw new Error(`Owned process group ${pid} survived cleanup`);
}

async function cleanupProcessGroup(pid, termGraceMs) {
  if (!pid || !processGroupExists(pid)) return;
  signalProcessGroup(pid, 'SIGTERM');
  await delay(termGraceMs);
  if (processGroupExists(pid)) signalProcessGroup(pid, 'SIGKILL');
  await verifyProcessGroupGone(pid);
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    usage(error.message);
    return;
  }

  const [command, ...args] = options.command;
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    env: options.useSafeEnv
      ? safeChildEnv(process.env, { NODE_ENV: 'test' })
      : process.env,
    stdio: 'inherit',
  });

  let timedOut = false;
  let interruptedSignal = null;
  let forceKillTimeout = null;
  const forwardSignal = signal => {
    interruptedSignal = signal;
    signalProcessGroup(child.pid, signal);
  };
  const handleSigint = () => forwardSignal('SIGINT');
  const handleSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);

  const timeout = setTimeout(() => {
    timedOut = true;
    process.stderr.write(
      `Owned command exceeded ${options.timeoutMs} ms; terminating process group ${child.pid}.\n`,
    );
    signalProcessGroup(child.pid, 'SIGTERM');
    forceKillTimeout = setTimeout(() => {
      signalProcessGroup(child.pid, 'SIGKILL');
    }, options.termGraceMs);
  }, options.timeoutMs);

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
  } finally {
    clearTimeout(timeout);
    if (forceKillTimeout) clearTimeout(forceKillTimeout);
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
    await cleanupProcessGroup(child.pid, options.termGraceMs);
    process.stderr.write(`Verified owned process group ${child.pid} is gone.\n`);
  }

  if (timedOut) {
    process.exitCode = 124;
  } else if (interruptedSignal || result.signal) {
    process.exitCode = 128;
  } else {
    process.exitCode = result.code ?? 1;
  }
}

await main();
