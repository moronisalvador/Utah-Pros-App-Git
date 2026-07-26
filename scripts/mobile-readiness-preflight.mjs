#!/usr/bin/env node
/**
 * FILE: mobile-readiness-preflight.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a UPR mobile-readiness task has the expected foundation, safe Git branch, local
 *   runtime, generated agent files, and optional native tools before work begins.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  mobile readiness docs, canonical skill/agents, generated Codex adapters
 *
 * NOTES / GOTCHAS:
 *   - It reads tool/version and Git metadata only. It never reads environment-file contents.
 *   - Native tools and installed npm packages are warnings until the selected wave requires them.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIVE_MINUTES_MS = 300_000;

export const REQUIRED_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  '.node-version',
  '.claude/mobile-readiness-codex-adapters.json',
  '.claude/skills/mobile-readiness-wave/SKILL.md',
  '.codex/config.toml',
  '.codex/agents/mobile-readiness-mapper.toml',
  '.codex/agents/mobile-readiness-security-reviewer.toml',
  '.codex/agents/mobile-readiness-contract-tester.toml',
  '.codex/agents/mobile-readiness-release-auditor.toml',
  '.agents/skills/mobile-readiness-wave/SKILL.md',
  'docs/mobile-production-readiness-roadmap.md',
  'docs/mobile-production-readiness-wave-ownership.md',
  'docs/mobile-production-readiness-setup.md',
  'docs/handoff/mobile-production-readiness-wave-1-prompt.md',
  'docs/audit/mobile-pwa/00-executive-summary.md',
  'docs/audit/mobile-pwa/13-findings-ledger.md',
  'docs/audit/mobile-pwa/16-validation-log.md',
];

export function classifyBranch(branch) {
  if (!branch || branch === 'HEAD') return { level: 'error', message: 'detached HEAD' };
  if (branch === 'main') return { level: 'error', message: 'main is not a work branch' };
  if (branch === 'dev') return { level: 'warning', message: 'create an isolated codex/ wave branch' };
  return { level: 'pass', message: branch };
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: FIVE_MINUTES_MS,
    windowsHide: true,
    killSignal: 'SIGTERM',
  });
}

function oneLine(value) {
  return (value || '').trim().split(/\r?\n/)[0] || 'unavailable';
}

function main() {
  const results = [];
  const add = (level, check, detail) => results.push({ level, check, detail });

  for (const repoPath of REQUIRED_PATHS) {
    if (!fs.existsSync(path.join(repositoryRoot, repoPath))) {
      add('error', 'foundation', `${repoPath} is missing`);
    }
  }
  if (!results.some((item) => item.check === 'foundation')) {
    add('pass', 'foundation', `${REQUIRED_PATHS.length} required files present`);
  }

  const branchResult = run('git', ['branch', '--show-current']);
  if (branchResult.status !== 0) {
    add('error', 'git branch', oneLine(branchResult.stderr));
  } else {
    const branch = oneLine(branchResult.stdout);
    const classification = classifyBranch(branch);
    add(classification.level, 'git branch', classification.message);
  }

  const statusResult = run('git', ['status', '--short']);
  if (statusResult.status !== 0) {
    add('error', 'git status', oneLine(statusResult.stderr));
  } else if (statusResult.stdout.trim()) {
    add('warning', 'git status', 'working tree has changes; preserve and declare them');
  } else {
    add('pass', 'git status', 'working tree clean');
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(
    nodeMajor === 22 ? 'pass' : 'warning',
    'Node',
    `${process.version}${nodeMajor === 22 ? '' : '; CI declares Node 22'}`,
  );

  const npmResult = run('npm', ['--version']);
  add(
    npmResult.status === 0 ? 'pass' : 'error',
    'npm',
    npmResult.status === 0 ? oneLine(npmResult.stdout) : oneLine(npmResult.stderr),
  );

  add(
    fs.existsSync(path.join(repositoryRoot, 'node_modules')) ? 'pass' : 'warning',
    'dependencies',
    fs.existsSync(path.join(repositoryRoot, 'node_modules'))
      ? 'node_modules present; npm ci is still the reproducible install command'
      : 'node_modules absent; run npm ci before build/test work',
  );

  const adapterResult = run('node', [
    'scripts/render-mobile-readiness-codex-adapters.mjs',
    '--check',
  ]);
  add(
    adapterResult.status === 0 ? 'pass' : 'error',
    'Codex adapters',
    adapterResult.status === 0 ? oneLine(adapterResult.stdout) : oneLine(adapterResult.stderr),
  );

  const xcodeResult = run('xcodebuild', ['-version']);
  add(
    xcodeResult.status === 0 ? 'pass' : 'warning',
    'Xcode (native lane)',
    xcodeResult.status === 0 ? oneLine(xcodeResult.stdout) : 'unavailable; web/source waves can proceed',
  );

  const ghResult = run('gh', ['auth', 'status']);
  add(
    ghResult.status === 0 ? 'pass' : 'warning',
    'GitHub delivery (optional)',
    ghResult.status === 0 ? 'authenticated' : 'not authenticated or unavailable',
  );

  for (const result of results) {
    console.log(`[${result.level.toUpperCase()}] ${result.check}: ${result.detail}`);
  }
  const errors = results.filter((result) => result.level === 'error');
  console.log(
    `Preflight complete: ${errors.length} error(s), ${
      results.filter((result) => result.level === 'warning').length
    } warning(s).`,
  );
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
