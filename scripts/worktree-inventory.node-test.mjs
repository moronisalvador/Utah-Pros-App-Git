#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/worktree-inventory.node-test.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Proves the worktree cleaner never proposes deleting anything that still
//   holds work — uncommitted files, commits that exist on no remote, a
//   protected branch, or a rescue archive.
//
// DEPENDS ON:
//   Internal: scripts/worktree-inventory.mjs
//   Data:     deterministic fixtures only. No git, network, or repository writes.
// ════════════════════════════════════════════════

import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, PROTECTED_BRANCHES, PROTECTED_PREFIXES } from './worktree-inventory.mjs';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;   // fixed clock; classify takes `now` so age is deterministic

const wt = (over = {}) => ({
  dir: '/tmp/wt-a',
  branch: 'claude/feature-a',
  isMain: false,
  exists: true,
  dirtyCount: 0,
  unpushedCount: 0,
  // Epoch: ancient under the pinned clock AND under a real Date.now(), so the
  // cases that predate the grace period keep asserting what they always did
  // whether or not they pass `now`.
  createdAt: 0,
  ...over,
});

/** classify() with the clock pinned — every age assertion below is exact. */
const at = (state) => classify({ now: NOW, ...state });

const br = (over = {}) => ({
  name: 'claude/feature-a',
  unpushedCount: 0,
  aheadOfDev: 0,
  checkedOutIn: null,
  ...over,
});

// ─── SECTION: worktrees ──────────────

test('a clean, fully pushed worktree is reclaimable', () => {
  const { worktrees } = classify({ worktrees: [wt()] });
  assert.equal(worktrees.reclaimable.length, 1);
  assert.equal(worktrees.blocked.length, 0);
});

test('a worktree with uncommitted files is blocked, never reclaimable', () => {
  const { worktrees } = classify({ worktrees: [wt({ dirtyCount: 26 })] });
  assert.equal(worktrees.reclaimable.length, 0);
  assert.equal(worktrees.blocked.length, 1);
  assert.match(worktrees.blocked[0].reason, /26 uncommitted/);
});

test('a worktree whose commits are on no remote is blocked', () => {
  const { worktrees } = classify({ worktrees: [wt({ unpushedCount: 3 })] });
  assert.equal(worktrees.reclaimable.length, 0);
  assert.equal(worktrees.blocked.length, 1);
  assert.match(worktrees.blocked[0].reason, /on no remote/);
});

test('dirty wins over pushed-ness — both signals block independently', () => {
  const { worktrees } = classify({
    worktrees: [wt({ dirtyCount: 1, unpushedCount: 5 })],
  });
  assert.equal(worktrees.blocked.length, 1);
  assert.equal(worktrees.reclaimable.length, 0);
});

test('a vanished directory is prunable, not blocked — nothing can be lost', () => {
  const { worktrees } = classify({
    worktrees: [wt({ exists: false, dirtyCount: 0 })],
  });
  assert.equal(worktrees.prunable.length, 1);
  assert.equal(worktrees.blocked.length, 0);
});

test('the primary working directory is always protected', () => {
  const { worktrees } = classify({
    worktrees: [wt({ isMain: true, branch: 'dev', dirtyCount: 143 })],
  });
  assert.equal(worktrees.protected.length, 1);
  assert.equal(worktrees.reclaimable.length, 0);
});

test('a clean worktree on a protected branch is still not reclaimable', () => {
  const { worktrees } = classify({ worktrees: [wt({ branch: 'main' })] });
  assert.equal(worktrees.protected.length, 1);
  assert.equal(worktrees.reclaimable.length, 0);
});

// ─── SECTION: active sessions ──────────────

test('a worktree with an open session is active, never reclaimable', () => {
  const { worktrees } = classify({
    worktrees: [wt({ dir: '/tmp/live' })],
    activeDirs: new Set(['/tmp/live']),
  });
  assert.equal(worktrees.active.length, 1);
  assert.equal(worktrees.reclaimable.length, 0);
  assert.match(worktrees.active[0].reason, /session is open/);
});

test('a session that created its worktree mid-run is protected by BRANCH', () => {
  // The gap the directory check alone leaves. A session's ledger `cwd` is
  // written once at SessionStart and never moves, so a session that starts in
  // the repository parent (or the main checkout) and then runs
  // `git worktree add` has a cwd matching NEITHER tree — and its live worktree
  // reads as clean, fully pushed and finished. Observed 2026-08-09 on the two
  // worktrees that produced this change, both classified reclaimable while
  // being actively written in.
  const { worktrees } = classify({
    worktrees: [wt({ dir: '/tmp/made-later', branch: 'claude/made-later' })],
    activeDirs: new Set(['/Users/someone']),          // where the session started
    activeBranches: new Set(['claude/made-later']),   // what it is actually on
  });
  assert.equal(worktrees.active.length, 1);
  assert.equal(worktrees.reclaimable.length, 0);
});

test('an unrelated live branch does not protect somebody else\'s worktree', () => {
  const { worktrees } = classify({
    worktrees: [wt({ dir: '/tmp/wt-a', branch: 'claude/feature-a' })],
    activeBranches: new Set(['claude/something-else']),
  });
  assert.equal(worktrees.active.length, 0);
  assert.equal(worktrees.reclaimable.length, 1);
});

test('a detached worktree is not swept into active by a null branch', () => {
  // `w.branch` is null when a worktree is detached, and an empty `branch` in
  // the ledger must not match it. It stays PROTECTED — `isProtectedBranch`
  // opens with `!name ||`, so a detached worktree was never reclaimable in the
  // first place; this pins that the branch check does not disturb it.
  const { worktrees } = classify({
    worktrees: [wt({ dir: '/tmp/detached', branch: null })],
    activeBranches: new Set(['']),
  });
  assert.equal(worktrees.active.length, 0);
  assert.equal(worktrees.reclaimable.length, 0);
  assert.equal(worktrees.protected.length, 1);
});

test('directory and branch signals are independent — either one is enough', () => {
  const byDir = classify({
    worktrees: [wt({ dir: '/tmp/live', branch: 'claude/x' })],
    activeDirs: new Set(['/tmp/live']),
  });
  const byBranch = classify({
    worktrees: [wt({ dir: '/tmp/live', branch: 'claude/x' })],
    activeBranches: new Set(['claude/x']),
  });
  assert.equal(byDir.worktrees.active.length, 1);
  assert.equal(byBranch.worktrees.active.length, 1);
});

test('an active worktree outranks dirty and unpushed — it is never destroyed', () => {
  // Ordering guard: active is checked before the blocked branches, so a live
  // session with work in progress reports as active rather than merely blocked.
  const { worktrees } = classify({
    worktrees: [wt({ dir: '/tmp/live', branch: 'claude/x', dirtyCount: 3, unpushedCount: 2 })],
    activeBranches: new Set(['claude/x']),
  });
  assert.equal(worktrees.active.length, 1);
  assert.equal(worktrees.blocked.length, 0);
});

test('an active clean worktree is still withheld — the live-session case that motivated this', () => {
  // A session that has just committed and pushed is indistinguishable from
  // finished work by git state alone. Only the ledger tells them apart.
  const { worktrees } = classify({
    worktrees: [wt({ dir: '/tmp/live', dirtyCount: 0, unpushedCount: 0 })],
    activeDirs: new Set(['/tmp/live']),
  });
  assert.equal(worktrees.reclaimable.length, 0);
  assert.equal(worktrees.active.length, 1);
});

test('an inactive worktree is unaffected by other sessions being open elsewhere', () => {
  const { worktrees } = classify({
    worktrees: [wt({ dir: '/tmp/idle' })],
    activeDirs: new Set(['/tmp/somewhere-else']),
  });
  assert.equal(worktrees.reclaimable.length, 1);
  assert.equal(worktrees.active.length, 0);
});

test('a vanished directory is still prunable even if a stale session claims it', () => {
  const { worktrees } = classify({
    worktrees: [wt({ dir: '/tmp/gone', exists: false })],
    activeDirs: new Set(['/tmp/gone']),
  });
  assert.equal(worktrees.prunable.length, 1);
  assert.equal(worktrees.active.length, 0);
});

test('activeDirs defaults to empty so callers cannot forget it and lose the guard', () => {
  const { worktrees } = classify({ worktrees: [wt()] });
  assert.equal(worktrees.active.length, 0);
  assert.equal(worktrees.reclaimable.length, 1);
});

// ─── SECTION: branches ──────────────

test('a branch fully contained in origin/dev is reclaimable', () => {
  const { branches } = classify({ branches: [br({ aheadOfDev: 0 })] });
  assert.equal(branches.reclaimable.length, 1);
});

test('a branch with commits on no remote is blocked, even if merged into dev', () => {
  const { branches } = classify({
    branches: [br({ aheadOfDev: 0, unpushedCount: 2 })],
  });
  assert.equal(branches.reclaimable.length, 0);
  assert.equal(branches.blocked.length, 1);
});

test('a pushed branch ahead of dev is review, not reclaimable', () => {
  const { branches } = classify({ branches: [br({ aheadOfDev: 9 })] });
  assert.equal(branches.review.length, 1);
  assert.equal(branches.reclaimable.length, 0);
  assert.match(branches.review[0].reason, /9 commit\(s\) not in origin\/dev/);
});

test('a branch checked out in a worktree is protected from deletion', () => {
  const { branches } = classify({
    branches: [br({ checkedOutIn: '/tmp/wt-a' })],
  });
  assert.equal(branches.protected.length, 1);
  assert.equal(branches.reclaimable.length, 0);
});

test('dev and main are protected even when they look reclaimable', () => {
  const { branches } = classify({
    branches: [br({ name: 'dev' }), br({ name: 'main' })],
  });
  assert.equal(branches.protected.length, 2);
  assert.equal(branches.reclaimable.length, 0);
});

test('rescue/* archives are protected even when fully merged into dev', () => {
  const { branches } = classify({
    branches: [br({ name: 'rescue/mac-uncommitted-2026-08-01', aheadOfDev: 0 })],
  });
  assert.equal(branches.protected.length, 1);
  assert.equal(branches.reclaimable.length, 0);
});

// ─── SECTION: policy invariants ──────────────

test('the protected set covers the two release branches', () => {
  assert.ok(PROTECTED_BRANCHES.has('dev'));
  assert.ok(PROTECTED_BRANCHES.has('main'));
});

test('rescue/ is a protected prefix', () => {
  assert.ok(PROTECTED_PREFIXES.includes('rescue/'));
});

test('nothing blocked ever appears in a reclaimable pile', () => {
  const { worktrees, branches } = classify({
    worktrees: [
      wt({ dir: '/tmp/a', dirtyCount: 4 }),
      wt({ dir: '/tmp/b', unpushedCount: 1, branch: 'claude/b' }),
      wt({ dir: '/tmp/c', branch: 'claude/c' }),
    ],
    branches: [
      br({ name: 'claude/blocked', unpushedCount: 7 }),
      br({ name: 'claude/done', aheadOfDev: 0 }),
    ],
  });

  const reclaimableDirs = new Set(worktrees.reclaimable.map((x) => x.dir));
  for (const b of worktrees.blocked) assert.ok(!reclaimableDirs.has(b.dir));

  const reclaimableNames = new Set(branches.reclaimable.map((x) => x.name));
  for (const b of branches.blocked) assert.ok(!reclaimableNames.has(b.name));

  assert.equal(worktrees.reclaimable.length, 1);
  assert.equal(branches.reclaimable.length, 1);
});

// ─── SECTION: the pre-commit window ──────────────
//
// The case session liveness CANNOT cover, and the one that actually fired.
// A worktree created a minute ago is clean, has nothing to push, and is
// therefore identical on git state to one whose work merged and finished — so
// the tool is most confident exactly where it is most wrong. The ledger records
// `cwd` and `branch` once at SessionStart, so a worktree AND branch created
// afterwards match neither active signal. Age is what is left.
//
// Reported by the release-lane session 2026-08-09: it created a worktree
// mid-session, had not committed yet, and a `--clean` run removed it.

test('a worktree created minutes ago is withheld, even though git calls it finished', () => {
  const { worktrees } = at({
    worktrees: [wt({ dir: '/tmp/brand-new', branch: 'claude/brand-new', createdAt: NOW - 5 * 60_000 })],
    // The session that made it started elsewhere, on another branch — so
    // NEITHER active signal can see it. This is the real shape of the incident.
    activeDirs: new Set(['/Users/someone']),
    activeBranches: new Set(),
  });
  assert.equal(worktrees.reclaimable.length, 0);
  assert.equal(worktrees.blocked.length, 1);
  assert.match(worktrees.blocked[0].reason, /too new to call finished/);
});

test('the grace period expires — a genuinely old, finished worktree is still reclaimable', () => {
  // The guard must not turn the cleaner into a no-op; that is the failure mode
  // on the other side.
  const { worktrees } = at({
    worktrees: [wt({ createdAt: NOW - 2 * DAY })],
  });
  assert.equal(worktrees.reclaimable.length, 1);
  assert.equal(worktrees.blocked.length, 0);
});

test('the boundary is exact at 24h', () => {
  const justInside = at({ worktrees: [wt({ createdAt: NOW - (DAY - 1) })] });
  const justOutside = at({ worktrees: [wt({ createdAt: NOW - DAY })] });
  assert.equal(justInside.worktrees.blocked.length, 1, 'younger than 24h is withheld');
  assert.equal(justOutside.worktrees.reclaimable.length, 1, '24h old is reclaimable');
});

test('an unreadable age is withheld, not assumed old', () => {
  // `createdAt: null` means the stat failed. This tool resolves "cannot tell"
  // toward keeping things, because the alternative is deleting on no evidence.
  const { worktrees } = at({ worktrees: [wt({ createdAt: null })] });
  assert.equal(worktrees.reclaimable.length, 0);
  assert.equal(worktrees.blocked.length, 1);
  assert.match(worktrees.blocked[0].reason, /age unreadable/);
});

test('a young worktree holding real work still reports the work, not its age', () => {
  // Ordering: dirty and unpushed are the more useful message for a human, and
  // both already block. Age must not mask them.
  const dirty = at({ worktrees: [wt({ createdAt: NOW - 60_000, dirtyCount: 4 })] });
  assert.match(dirty.worktrees.blocked[0].reason, /4 uncommitted/);

  const unpushed = at({ worktrees: [wt({ createdAt: NOW - 60_000, unpushedCount: 2 })] });
  assert.match(unpushed.worktrees.blocked[0].reason, /on no remote/);
});

test('a young worktree with a live session reports as active, not merely blocked', () => {
  const { worktrees } = at({
    worktrees: [wt({ dir: '/tmp/live', createdAt: NOW - 60_000 })],
    activeDirs: new Set(['/tmp/live']),
  });
  assert.equal(worktrees.active.length, 1);
  assert.equal(worktrees.blocked.length, 0);
});
