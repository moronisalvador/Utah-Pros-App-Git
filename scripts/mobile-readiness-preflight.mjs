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
 *   Internal:  mobile readiness docs, neutral capability sources, and generated runtime adapters
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

export const MOBILE_WORK_BRANCH_PREFIX = 'codex/mobile-readiness-';
export const MOBILE_FOUNDATION_REF =
  'origin/codex/mobile-pwa-readiness-foundation';

export const REQUIRED_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  '.node-version',
  'tooling/capabilities.json',
  'tooling/skills/mobile-readiness-wave/SKILL.md',
  'tooling/agents/mobile-readiness-mapper.md',
  'tooling/agents/mobile-readiness-security-reviewer.md',
  'tooling/agents/mobile-readiness-contract-tester.md',
  'tooling/agents/mobile-readiness-release-auditor.md',
  '.claude/skills/mobile-readiness-wave/SKILL.md',
  '.claude/agents/mobile-readiness-mapper.md',
  '.claude/agents/mobile-readiness-security-reviewer.md',
  '.claude/agents/mobile-readiness-contract-tester.md',
  '.claude/agents/mobile-readiness-release-auditor.md',
  '.codex/config.toml',
  '.codex/agents/mobile-readiness-mapper.toml',
  '.codex/agents/mobile-readiness-security-reviewer.toml',
  '.codex/agents/mobile-readiness-contract-tester.toml',
  '.codex/agents/mobile-readiness-release-auditor.toml',
  '.agents/skills/mobile-readiness-wave/SKILL.md',
  '.agents/skills/mobile-readiness-wave/agents/openai.yaml',
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
  if (!branch.startsWith(MOBILE_WORK_BRANCH_PREFIX)) {
    return {
      level: 'error',
      message: `expected a bounded ${MOBILE_WORK_BRANCH_PREFIX}* branch; found ${branch}`,
    };
  }
  return { level: 'pass', message: branch };
}

export function classifyRepositoryTopology({
  headSha,
  originDevSha,
  foundationSha,
  mergeHeadSha = null,
  originDevInHead = false,
  originDevInMergeHead = false,
  foundationInHead = false,
  foundationInMergeHead = false,
  hasUnmergedEntries = false,
  ancestryCheckFailed = false,
}) {
  const errors = [];
  if (!headSha) errors.push('HEAD is unavailable');
  if (!originDevSha) errors.push('origin/dev is unavailable; fetch it before work');
  if (!foundationSha) {
    errors.push(`${MOBILE_FOUNDATION_REF} is unavailable; fetch the foundation ref`);
  }
  if (hasUnmergedEntries) errors.push('the index has unresolved merge entries');
  if (ancestryCheckFailed) errors.push('Git ancestry could not be verified');

  if (originDevSha && !originDevInHead && !originDevInMergeHead) {
    errors.push('current local origin/dev is not preserved by HEAD or MERGE_HEAD');
  }
  if (foundationSha && !foundationInHead && !foundationInMergeHead) {
    errors.push('the mobile foundation is not preserved by HEAD or MERGE_HEAD');
  }

  if (errors.length > 0) {
    return { level: 'error', message: errors.join('; ') };
  }

  return {
    level: 'pass',
    message: [
      `HEAD ${headSha.slice(0, 12)}`,
      `origin/dev ${originDevSha.slice(0, 12)}`,
      `foundation ${foundationSha.slice(0, 12)}`,
      mergeHeadSha ? `MERGE_HEAD ${mergeHeadSha.slice(0, 12)}` : null,
      'both histories preserved by ancestry (local refs; fetch first)',
    ].filter(Boolean).join('; '),
  };
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

function resolveCommit(ref) {
  const result = run('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
  return result.status === 0 ? oneLine(result.stdout) : null;
}

function isAncestor(ancestor, descendant) {
  if (!ancestor || !descendant) return null;
  const result = run('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
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

  const headSha = resolveCommit('HEAD');
  const originDevSha = resolveCommit('origin/dev');
  const foundationSha = resolveCommit(MOBILE_FOUNDATION_REF);
  const mergeHeadSha = resolveCommit('MERGE_HEAD');
  const unmergedResult = run('git', ['ls-files', '--unmerged']);
  const ancestry = {
    originDevInHead: isAncestor(originDevSha, headSha),
    originDevInMergeHead: mergeHeadSha
      ? isAncestor(originDevSha, mergeHeadSha)
      : false,
    foundationInHead: isAncestor(foundationSha, headSha),
    foundationInMergeHead: mergeHeadSha
      ? isAncestor(foundationSha, mergeHeadSha)
      : false,
  };
  const topology = classifyRepositoryTopology({
    headSha,
    originDevSha,
    foundationSha,
    mergeHeadSha,
    originDevInHead: ancestry.originDevInHead === true,
    originDevInMergeHead: ancestry.originDevInMergeHead === true,
    foundationInHead: ancestry.foundationInHead === true,
    foundationInMergeHead: ancestry.foundationInMergeHead === true,
    hasUnmergedEntries:
      unmergedResult.status !== 0 || !!unmergedResult.stdout.trim(),
    ancestryCheckFailed: Object.values(ancestry).some((value) => value === null),
  });
  add(topology.level, 'git topology', topology.message);

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

  const adapterResult = run('node', ['scripts/render-tooling-adapters.mjs', '--check']);
  add(
    adapterResult.status === 0 ? 'pass' : 'error',
    'tooling adapters',
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
