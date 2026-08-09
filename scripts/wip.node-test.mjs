#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/wip.node-test.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Proves the production-work register calls things by their real state — and
//   above all that merging to dev never counts as shipped, because work that
//   reached dev and stopped is exactly what this register exists to catch.
//
// DEPENDS ON:
//   Internal: scripts/wip.mjs
//   Data:     deterministic fixtures only. No git, network, or repository writes.
// ════════════════════════════════════════════════

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  deriveVerdict, isUrgent, parseFrontmatter, refFor, registerRoot, VERDICTS, worktreeDirFor,
} from './wip.mjs';

// ─── SECTION: register location ──────────────
//
// The register is a TRACKED, per-branch file, so it must be written into the
// worktree the session is running in. Getting this wrong is invisible: the tool
// prints a success line naming a path in a DIFFERENT tree.

const MAIN = '/repo';
const WORKTREE = '/repo/.claude/worktrees/some-name';

// Stand-in for the real `git` helper: returns what each rev-parse would return
// from inside a linked worktree.
const gitInWorktree = (args) => {
  if (args.includes('--show-toplevel')) return WORKTREE;
  if (args.includes('--git-common-dir')) return `${MAIN}/.git`;
  return '';
};

test('resolves to the CURRENT worktree, not the shared main checkout', () => {
  // The regression: --git-common-dir returns the shared .git, so dirname() of it
  // is the main checkout. wip:open then wrote the register where the session
  // could not commit it, and wip:close deleted it there, dirtying a tree the
  // session did not own. Observed live 2026-08-09.
  assert.equal(registerRoot(gitInWorktree, WORKTREE), WORKTREE);
  assert.notEqual(registerRoot(gitInWorktree, WORKTREE), MAIN);
});

test('is a no-op from the main checkout, where both forms agree', () => {
  const gitInMain = (args) => (args.includes('--show-toplevel') ? MAIN : `${MAIN}/.git`);
  assert.equal(registerRoot(gitInMain, MAIN), MAIN);
});

test('falls back to cwd outside a git repository rather than throwing', () => {
  assert.equal(registerRoot(() => '', '/somewhere'), '/somewhere');
});

// ─── SECTION: ref resolution after branch cleanup ──────────────

const resolver = (present) => (args) => (present.includes(args[args.length - 1]) ? 'sha' : '');

test('falls back to the remote ref once the local branch is cleaned up', () => {
  // worktree-lifecycle.md §1 tells you to delete the local branch when work lands,
  // and worktrees:clean does it automatically. Because deriveVerdict checks
  // ORPHANED before LANDED, a local-only lookup turned every shipped entry into a
  // permanent "branch no longer exists" warning on the SessionStart banner —
  // observed on claude/kind-grothendieck-9f41f6, whose work merged in PR #608.
  assert.equal(refFor('feature/x', '/repo', resolver(['origin/feature/x'])), 'origin/feature/x');
});

test('prefers the local branch while it still exists', () => {
  assert.equal(refFor('feature/x', '/repo', resolver(['feature/x', 'origin/feature/x'])), 'feature/x');
});

test('is genuinely orphaned only when local AND remote are both gone', () => {
  assert.equal(refFor('feature/x', '/repo', resolver([])), null);
});

test('does NOT adopt the session-ledger root derivation', () => {
  // .claude/hooks/session-ledger.mjs uses --git-common-dir on purpose: its file is
  // gitignored and must be ONE shared file across all worktrees. The wip register
  // is the opposite — tracked and per-branch. This asserts the two stay divergent,
  // so a future "unify the root helpers" cleanup fails here instead of silently
  // reintroducing the bug.
  const ledgerStyleRoot = path.dirname(gitInWorktree(['rev-parse', '--git-common-dir']));
  assert.equal(ledgerStyleRoot, MAIN);
  assert.notEqual(registerRoot(gitInWorktree, WORKTREE), ledgerStyleRoot);
});

const state = (over = {}) => ({
  branchExists: true,
  dirtyCount: 0,
  unpushedCount: 0,
  aheadOfDev: 0,
  inDev: false,
  inProduction: false,
  lastCommitAt: '2026-08-01T00:00:00Z',
  ...over,
});

const entry = (over = {}) => ({ branch: 'claude/feature', ships: true, ...over });

// ─── SECTION: the gap this exists to close ──────────────
// dev is the finish line, not main (owner-directed 2026-08-04): both branches
// are actively maintained, so anything in dev reaches main on its own cadence.

test('merged to dev is LANDED even when not yet in main', () => {
  const { verdict, detail } = deriveVerdict(entry(), state({ inDev: true, inProduction: false }));
  assert.equal(verdict, VERDICTS.LANDED);
  assert.match(detail, /main follows/);
});

test('in dev AND in main is still LANDED — production is not a separate state', () => {
  const { verdict, detail } = deriveVerdict(entry(), state({ inDev: true, inProduction: true }));
  assert.equal(verdict, VERDICTS.LANDED);
  assert.match(detail, /in production/);
});

test('landed work never shouts, however old — this is what stops the crying wolf', () => {
  assert.equal(isUrgent(entry({ ships: true }), VERDICTS.LANDED, 999), false);
});

test('never-merged work that has gone quiet IS the alarm', () => {
  assert.equal(isUrgent(entry({ ships: true }), VERDICTS.IN_PROGRESS, 30), true);
});

test('never-merged work still moving does not shout yet', () => {
  assert.equal(isUrgent(entry({ ships: true }), VERDICTS.IN_PROGRESS, 1), false);
});

test('work explicitly not ship-bound never shouts', () => {
  assert.equal(isUrgent(entry({ ships: false }), VERDICTS.IN_PROGRESS, 999), false);
});

// ─── SECTION: unsaved work outranks merge status ──────────────

test('uncommitted changes outrank everything — most losable state wins', () => {
  const { verdict } = deriveVerdict(
    entry(),
    state({ dirtyCount: 12, inDev: true, inProduction: true }),
  );
  assert.equal(verdict, VERDICTS.DIRTY);
});

test('unpushed commits outrank merge status', () => {
  const { verdict } = deriveVerdict(entry(), state({ unpushedCount: 3, inDev: true }));
  assert.equal(verdict, VERDICTS.UNPUSHED);
});

test('a pushed, unmerged branch is IN_PROGRESS', () => {
  const { verdict, detail } = deriveVerdict(entry(), state({ aheadOfDev: 4 }));
  assert.equal(verdict, VERDICTS.IN_PROGRESS);
  assert.match(detail, /4 commit\(s\) never merged to dev/);
});

test('a register entry whose branch vanished is ORPHANED', () => {
  const { verdict } = deriveVerdict(entry(), state({ branchExists: false }));
  assert.equal(verdict, VERDICTS.ORPHANED);
});

// ─── SECTION: worktree resolution ──────────────
// Regression: a regex spanning `worktree …` to `branch …` matches ACROSS
// blocks and returns the FIRST worktree's path, so a branch in a clean
// worktree inherited the main checkout's dirty count.

const PORCELAIN = [
  'worktree /repo/main',
  'HEAD aaaa',
  'branch refs/heads/dev',
  '',
  'worktree /repo/wt-a',
  'HEAD bbbb',
  'branch refs/heads/claude/feature-a',
  '',
  'worktree /repo/wt-b',
  'HEAD cccc',
  'branch refs/heads/claude/feature-b',
  '',
].join('\n');

test('resolves a branch to ITS worktree, not the first block in the list', () => {
  assert.equal(worktreeDirFor('claude/feature-b', '/repo', PORCELAIN), '/repo/wt-b');
});

test('resolves the first block correctly too', () => {
  assert.equal(worktreeDirFor('dev', '/repo', PORCELAIN), '/repo/main');
});

test('a middle block resolves to itself', () => {
  assert.equal(worktreeDirFor('claude/feature-a', '/repo', PORCELAIN), '/repo/wt-a');
});

test('a branch checked out nowhere resolves to null, not a stray directory', () => {
  assert.equal(worktreeDirFor('claude/not-checked-out', '/repo', PORCELAIN), null);
});

test('a detached block does not leak its path to a later branch', () => {
  const detached = ['worktree /repo/detached', 'HEAD dddd', 'detached', '', 'worktree /repo/wt-c', 'HEAD eeee', 'branch refs/heads/claude/c', ''].join('\n');
  assert.equal(worktreeDirFor('claude/c', '/repo', detached), '/repo/wt-c');
});

// ─── SECTION: frontmatter ──────────────

test('reads branch, ships and opened from frontmatter', () => {
  const { data, body } = parseFrontmatter(
    '---\nbranch: claude/x\nships: true\nopened: 2026-08-04\n---\n\n# What\n\nA thing\n',
  );
  assert.equal(data.branch, 'claude/x');
  assert.equal(data.ships, true);
  assert.equal(data.opened, '2026-08-04');
  assert.match(body, /# What/);
});

test('ships: false parses as boolean false, not the string "false"', () => {
  const { data } = parseFrontmatter('---\nbranch: b\nships: false\n---\nbody\n');
  assert.equal(data.ships, false);
});

test('a file with no frontmatter degrades to an empty header, not a crash', () => {
  const { data, body } = parseFrontmatter('# Just a heading\n');
  assert.deepEqual(data, {});
  assert.match(body, /Just a heading/);
});

test('quoted values are unquoted', () => {
  const { data } = parseFrontmatter('---\nbranch: "claude/x"\n---\n');
  assert.equal(data.branch, 'claude/x');
});
