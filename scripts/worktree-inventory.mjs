#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: worktree-inventory.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Looks at every extra working copy ("worktree") and every local branch in
//   this repository, and sorts them into three piles: ones that are finished
//   and safe to delete, ones that still hold work nobody has saved anywhere
//   else, and ones we never touch. It can print that list, or — only when
//   asked — actually delete the finished ones.
//
//   It never deletes anything that holds unsaved or unpushed work, and it
//   never touches GitHub. Deleting a local branch here does not delete the
//   branch on the remote.
//
// DEPENDS ON:
//   Packages:  none (node:child_process, node:fs, node:path, node:util only)
//   Internal:  none — deliberately standalone so it still runs in a repo
//              whose node_modules are missing.
//   Data:      reads .claude/session-ledger.json when present (open sessions)
//
// EXPORTS:
//   classify(state)         pure classifier, unit-tested
//   PROTECTED_BRANCHES      names never proposed for deletion
//   PROTECTED_PREFIXES      branch prefixes never proposed for deletion
//
// NOTES / GOTCHAS:
//   - "unpushed" means: commits reachable from the branch that are on NO
//     remote ref at all (`git rev-list <b> --not --remotes`). That is the
//     only check that actually proves the work survives losing this disk.
//     Comparing against origin/<same-name> is NOT equivalent and will
//     mislabel merged branches as safe when they are not.
//   - A worktree whose directory has vanished (macOS wipes /private/tmp)
//     is "prunable": git still tracks it, and its branch stays checked out
//     and therefore undeletable, until `git worktree prune` runs.
//   - rescue/* is protected on purpose. Those branches are deliberate
//     archives of recovered work; being merged into dev does not make them
//     disposable.
//   - --clean is intentionally the only mutating path, it only ever acts on
//     the RECLAIMABLE pile, and it re-verifies each item immediately before
//     removing it.
//   - Per-branch git calls were the whole runtime: 87 branches x 2 rev-lists
//     plus 35 sequential `git status` took ~26s, which silently blew the
//     SessionStart hook's own timeout. Branch state now comes from three bulk
//     commands and the worktree statuses run concurrently (~0.7s). Keep it
//     that way — this runs on every session start.
// ════════════════════════════════════════════════

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// ─── SECTION: Policy ──────────────

/** Branches that are never proposed for deletion, whatever their state. */
export const PROTECTED_BRANCHES = new Set(['dev', 'main', 'HEAD']);

/**
 * Branch prefixes that are never proposed for deletion.
 * rescue/* holds recovered work we keep deliberately (see NOTES).
 */
export const PROTECTED_PREFIXES = ['rescue/'];

const isProtectedBranch = (name) =>
  !name ||
  PROTECTED_BRANCHES.has(name) ||
  PROTECTED_PREFIXES.some((p) => name.startsWith(p));

// ─── SECTION: Pure classifier ──────────────

/**
 * Sort worktrees and branches into piles. Pure — all git I/O happens in the
 * collectors below, so this stays unit-testable.
 *
 * @param {object} state
 * @param {Array}  state.worktrees  {dir, branch, isMain, exists, dirtyCount, unpushedCount}
 * @param {Array}  state.branches   {name, unpushedCount, aheadOfDev, checkedOutIn}
 * @param {Set}    state.activeDirs directories with a session open right now
 * @returns {{worktrees: object, branches: object}} each pile keyed by verdict
 */
export function classify({ worktrees = [], branches = [], activeDirs = new Set() }) {
  const wt = { protected: [], prunable: [], reclaimable: [], blocked: [], active: [] };

  for (const w of worktrees) {
    if (w.isMain) {
      wt.protected.push({ ...w, reason: 'primary working directory' });
      continue;
    }
    if (!w.exists) {
      // Directory is gone; nothing can be lost by dropping the stale record.
      wt.prunable.push({ ...w, reason: 'directory no longer exists' });
      continue;
    }
    // A session working here right now looks exactly like finished work in the
    // moment between its commit and its next edit. Never reclaim underneath it.
    if (activeDirs.has(w.dir)) {
      wt.active.push({ ...w, reason: 'a session is open in this worktree' });
      continue;
    }
    if (w.dirtyCount > 0) {
      wt.blocked.push({
        ...w,
        reason: `${w.dirtyCount} uncommitted file(s) — commit, stash, or discard first`,
      });
      continue;
    }
    if (w.unpushedCount > 0) {
      wt.blocked.push({
        ...w,
        reason: `${w.unpushedCount} commit(s) on no remote — push first`,
      });
      continue;
    }
    if (isProtectedBranch(w.branch)) {
      wt.protected.push({ ...w, reason: `protected branch ${w.branch}` });
      continue;
    }
    wt.reclaimable.push({ ...w, reason: 'clean and fully pushed' });
  }

  const br = { protected: [], reclaimable: [], review: [], blocked: [] };

  for (const b of branches) {
    if (isProtectedBranch(b.name)) {
      br.protected.push({ ...b, reason: 'protected branch' });
      continue;
    }
    if (b.checkedOutIn) {
      br.protected.push({
        ...b,
        reason: `checked out in ${path.basename(b.checkedOutIn)}`,
      });
      continue;
    }
    if (b.unpushedCount > 0) {
      br.blocked.push({
        ...b,
        reason: `${b.unpushedCount} commit(s) on no remote — push first`,
      });
      continue;
    }
    if (b.aheadOfDev === 0) {
      br.reclaimable.push({ ...b, reason: 'fully contained in origin/dev' });
      continue;
    }
    br.review.push({
      ...b,
      reason: `${b.aheadOfDev} commit(s) not in origin/dev (safe on remote, but unfinished)`,
    });
  }

  return { worktrees: wt, branches: br };
}

// ─── SECTION: Git collectors ──────────────

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

const gitSafe = (args, opts = {}) => {
  try {
    return git(args, opts);
  } catch {
    return '';
  }
};

const gitAsync = async (args, cwd) => {
  try {
    const { stdout } = await execFileP('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 << 20 });
    return stdout.trim();
  } catch {
    return '';
  }
};

/**
 * Which local branches have commits that exist on NO remote.
 *
 * Done in bulk, not per-branch. Key fact: if a branch's TIP is reachable from
 * some remote then so is every one of its ancestors — so a single
 * `rev-list --branches --not --remotes` identifies every unpushed tip at once.
 * The per-branch exact counts are then computed only for the handful that are
 * actually unpushed (normally zero).
 */
async function collectUnpushed(repoRoot, tips) {
  const raw = await gitAsync(['rev-list', '--branches', '--not', '--remotes'], repoRoot);
  const unpushedShas = new Set(raw.split('\n').filter(Boolean));
  if (!unpushedShas.size) return new Map();

  const suspect = [...tips.entries()].filter(([, sha]) => unpushedShas.has(sha));
  const counts = await Promise.all(
    suspect.map(async ([name]) => [
      name,
      Number(await gitAsync(['rev-list', '--count', name, '--not', '--remotes'], repoRoot) || 0),
    ]),
  );
  return new Map(counts);
}

function parsePorcelain(raw) {
  const entries = [];
  let cur = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur);
      cur = { dir: line.slice('worktree '.length), branch: null };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch refs/heads/'.length);
    } else if (line === 'detached') {
      cur.branch = null;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

async function collectWorktrees(repoRoot, unpushedByBranch) {
  const entries = parsePorcelain(await gitAsync(['worktree', 'list', '--porcelain'], repoRoot));

  // `git status` dominates the runtime, so run every worktree concurrently
  // rather than in sequence — 35 sequential statuses took ~26s.
  return Promise.all(
    entries.map(async (e, i) => {
      const exists = existsSync(e.dir);
      let dirtyCount = 0;
      if (exists) {
        const status = await gitAsync(['status', '--porcelain'], e.dir);
        dirtyCount = status ? status.split('\n').filter(Boolean).length : 0;
      }
      return {
        ...e,
        isMain: i === 0,
        exists,
        dirtyCount,
        unpushedCount: e.branch ? unpushedByBranch.get(e.branch) || 0 : 0,
      };
    }),
  );
}

async function collectBranches(repoRoot, tips, unpushedByBranch) {
  const checkedOut = new Map();
  for (const w of parsePorcelain(await gitAsync(['worktree', 'list', '--porcelain'], repoRoot))) {
    if (w.branch) checkedOut.set(w.branch, w.dir);
  }

  // One call replaces a per-branch `rev-list --count origin/dev..<b>`:
  // "merged into origin/dev" is exactly "that count is zero".
  const mergedRaw = await gitAsync(
    ['branch', '--merged', 'origin/dev', '--format=%(refname:short)'],
    repoRoot,
  );
  const merged = new Set(mergedRaw.split('\n').filter(Boolean));

  const names = [...tips.keys()];
  const unmerged = names.filter((n) => !merged.has(n));
  const aheadCounts = new Map(
    await Promise.all(
      unmerged.map(async (name) => [
        name,
        Number(await gitAsync(['rev-list', '--count', `origin/dev..${name}`], repoRoot) || 0),
      ]),
    ),
  );

  return names.map((name) => ({
    name,
    unpushedCount: unpushedByBranch.get(name) || 0,
    aheadOfDev: merged.has(name) ? 0 : aheadCounts.get(name) || 0,
    checkedOutIn: checkedOut.get(name) || null,
  }));
}

/**
 * Remote branches that never landed in origin/dev.
 *
 * Local-only inventory is how cloud work goes invisible: sessions run in the
 * cloud, push a branch, and nothing on this machine ever mentions it again.
 * Two bulk calls, so this stays cheap enough for the session hook.
 */
async function collectRemoteStragglers(repoRoot) {
  const [unmergedRaw, datedRaw] = await Promise.all([
    gitAsync(['branch', '-r', '--no-merged', 'origin/dev', '--format=%(refname:short)'], repoRoot),
    gitAsync(
      ['for-each-ref', '--sort=committerdate', '--format=%(refname:short)|%(committerdate:short)', 'refs/remotes/origin/'],
      repoRoot,
    ),
  ]);

  const dates = new Map(
    datedRaw.split('\n').filter(Boolean).map((l) => {
      const [n, d] = l.split('|');
      return [n, d];
    }),
  );

  return unmergedRaw
    .split('\n')
    .filter(Boolean)
    .filter((n) => !['origin/HEAD', 'origin/main', 'origin/dev'].includes(n) && !n.startsWith('origin/rescue/'))
    .map((name) => ({ name, lastCommit: dates.get(name) || 'unknown' }))
    .sort((a, b) => a.lastCommit.localeCompare(b.lastCommit));
}

/** Every local branch name → its tip SHA, in one call. */
async function collectTips(repoRoot) {
  const raw = await gitAsync(
    ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/'],
    repoRoot,
  );
  return new Map(
    raw
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const i = l.lastIndexOf(' ');
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
}

/**
 * Directories with a Claude session open right now, per the session ledger.
 *
 * A session that crashed never writes its SessionEnd, so an entry left open
 * forever would pin a worktree permanently. Entries older than ACTIVE_WINDOW_H
 * are therefore treated as dead, not active.
 */
const ACTIVE_WINDOW_H = 24;

function collectActiveDirs(repoRoot) {
  const file = path.join(repoRoot, '.claude', 'session-ledger.json');
  if (!existsSync(file)) return new Set();
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return new Set();
  }
  const cutoff = Date.now() - ACTIVE_WINDOW_H * 3_600_000;
  const active = new Set();
  for (const s of ledger?.sessions ?? []) {
    if (!s?.cwd || s.endedAt) continue;
    const started = Date.parse(s.startedAt ?? '');
    if (Number.isNaN(started) || started < cutoff) continue;
    active.add(s.cwd);
  }
  return active;
}

// ─── SECTION: Reporting ──────────────

/** English plural that survives the -ch/-sh cases ("branches", "stashes"). */
const plural = (n, s) => {
  if (n === 1) return `${n} ${s}`;
  const suffix = /(?:ch|sh|s|x|z)$/.test(s) ? 'es' : 's';
  return `${n} ${s}${suffix}`;
};

/**
 * A display label that stays unambiguous. Many worktrees are named
 * `<something>/Utah-Pros-App-Git`, so the basename alone collides; fall back
 * to the parent directory when the basename is not distinctive.
 */
const REPO_DIR_NAME = 'Utah-Pros-App-Git';
const label = (dir) => {
  const base = path.basename(dir);
  if (base !== REPO_DIR_NAME) return base;
  const parent = path.basename(path.dirname(dir));
  return `${parent}/${base}`;
};

function report(result, { stashCount, remote }) {
  const { worktrees: w, branches: b } = result;
  const lines = [];

  lines.push('');
  lines.push('  WORKTREE & BRANCH INVENTORY');
  lines.push('  ' + '─'.repeat(70));

  lines.push('');
  lines.push(`  WORKTREES  ${w.reclaimable.length} reclaimable · ${plural(w.prunable.length, 'stale record')} · ${w.blocked.length} blocked · ${w.active.length} active · ${w.protected.length} protected`);

  if (w.active.length) {
    lines.push('');
    lines.push('  ●  A SESSION IS OPEN HERE — never reclaimed underneath a live session:');
    for (const x of w.active) lines.push(`     ${label(x.dir)}`);
  }

  if (w.blocked.length) {
    lines.push('');
    lines.push('  ⚠  HOLDS UNSAVED WORK — resolve before these are ever removed:');
    for (const x of w.blocked) lines.push(`     ${label(x.dir).padEnd(52)} ${x.reason}`);
  }
  if (w.prunable.length) {
    lines.push('');
    lines.push(`  ·  ${plural(w.prunable.length, 'stale record')} (directory gone, branch still pinned) — cleared by --clean`);
  }
  if (w.reclaimable.length) {
    lines.push('');
    lines.push('  ✓  DONE — clean and fully pushed, removable by --clean:');
    for (const x of w.reclaimable) lines.push(`     ${label(x.dir)}`);
  }

  lines.push('');
  lines.push(`  BRANCHES   ${b.reclaimable.length} reclaimable · ${b.review.length} unfinished · ${b.blocked.length} blocked · ${b.protected.length} protected`);

  if (b.blocked.length) {
    lines.push('');
    lines.push('  ⚠  COMMITS ON NO REMOTE — losing this disk loses them:');
    for (const x of b.blocked) lines.push(`     ${x.name.padEnd(52)} ${x.reason}`);
  }
  if (b.review.length) {
    lines.push('');
    lines.push('  ?  UNFINISHED — on a remote, but never landed in dev:');
    for (const x of b.review) lines.push(`     ${x.name.padEnd(52)} ${x.reason}`);
  }
  if (b.reclaimable.length) {
    lines.push('');
    lines.push(`  ✓  ${plural(b.reclaimable.length, 'branch')} fully contained in origin/dev — removable by --clean`);
  }

  if (remote && remote.length) {
    lines.push('');
    lines.push(`  REMOTE     ${plural(remote.length, 'branch')} on origin never merged into dev (oldest first):`);
    for (const r of remote.slice(0, 8)) lines.push(`     ${r.lastCommit}  ${r.name.replace(/^origin\//, '')}`);
    if (remote.length > 8) lines.push(`     …and ${remote.length - 8} more`);
    lines.push('     These are invisible to every local check — cloud sessions push here.');
  }

  if (stashCount > 0) {
    lines.push('');
    lines.push(`  STASHES    ${plural(stashCount, 'stash')} — never touched by this script; review with \`git stash list\``);
  }

  const totalBlocked = w.blocked.length + b.blocked.length;
  lines.push('');
  lines.push('  ' + '─'.repeat(70));
  if (totalBlocked === 0) {
    lines.push('  No unsaved or unpushed work detected.');
  } else {
    lines.push(`  ${plural(totalBlocked, 'item')} hold work that exists nowhere else. Resolve those first.`);
  }
  lines.push(`  Run \`npm run worktrees:clean\` to remove only the ✓ items above.`);
  lines.push('');

  return lines.join('\n');
}

// ─── SECTION: Cleanup ──────────────

async function clean(result, repoRoot) {
  const removedWorktrees = [];
  const removedBranches = [];
  const skipped = [];

  // Stale records first — this releases branches pinned by vanished dirs.
  if (result.worktrees.prunable.length) {
    git(['worktree', 'prune'], { cwd: repoRoot });
  }

  for (const w of result.worktrees.reclaimable) {
    // Re-verify immediately before destroying anything.
    const status = gitSafe(['status', '--porcelain'], { cwd: w.dir });
    if (status) {
      skipped.push(`${label(w.dir)} — became dirty since the scan`);
      continue;
    }
    try {
      git(['worktree', 'remove', w.dir], { cwd: repoRoot });
      removedWorktrees.push(w.dir);
    } catch (e) {
      skipped.push(`${label(w.dir)} — ${e.message.split('\n')[0]}`);
    }
  }

  // Recompute branch state: pruning above may have freed more branches.
  const tips = await collectTips(repoRoot);
  const unpushedByBranch = await collectUnpushed(repoRoot, tips);
  const branches = await collectBranches(repoRoot, tips, unpushedByBranch);
  const fresh = classify({ worktrees: [], branches });

  for (const b of fresh.branches.reclaimable) {
    try {
      // -d (not -D): git itself refuses if the branch is not fully merged.
      git(['branch', '-d', b.name], { cwd: repoRoot });
      removedBranches.push(b.name);
    } catch (e) {
      skipped.push(`${b.name} — ${e.message.split('\n')[0]}`);
    }
  }

  return { removedWorktrees, removedBranches, skipped };
}

// ─── SECTION: CLI ──────────────

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const doClean = args.includes('--clean');
  const quiet = args.includes('--quiet');

  const repoRoot = git(['rev-parse', '--show-toplevel']);
  const tips = await collectTips(repoRoot);
  const unpushedByBranch = await collectUnpushed(repoRoot, tips);
  const [worktrees, branches, stashRaw, remote] = await Promise.all([
    collectWorktrees(repoRoot, unpushedByBranch),
    collectBranches(repoRoot, tips, unpushedByBranch),
    gitAsync(['stash', 'list'], repoRoot),
    collectRemoteStragglers(repoRoot),
  ]);
  const activeDirs = collectActiveDirs(repoRoot);
  const stashCount = stashRaw.split('\n').filter(Boolean).length;

  const result = classify({ worktrees, branches, activeDirs });

  if (asJson) {
    const blocked = [...result.worktrees.blocked, ...result.branches.blocked];
    process.stdout.write(
      JSON.stringify(
        {
          stashCount,
          remoteStragglers: remote.length,
          remote,
          blockedCount: blocked.length,
          activeWorktrees: result.worktrees.active.length,
          reclaimableWorktrees: result.worktrees.reclaimable.length,
          prunableWorktrees: result.worktrees.prunable.length,
          reclaimableBranches: result.branches.reclaimable.length,
          unfinishedBranches: result.branches.review.length,
          ...result,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  if (doClean) {
    const { removedWorktrees, removedBranches, skipped } = await clean(result, repoRoot);
    console.log('');
    console.log(`  Removed ${plural(removedWorktrees.length, 'worktree')} and ${plural(removedBranches.length, 'local branch')}.`);
    console.log(`  Pruned ${plural(result.worktrees.prunable.length, 'stale worktree record')}.`);
    if (skipped.length) {
      console.log('');
      console.log('  Skipped:');
      for (const s of skipped) console.log(`     ${s}`);
    }
    console.log('');
    console.log('  Nothing on any remote was changed.');
    console.log('');
    return 0;
  }

  // In --quiet mode (hooks), stay silent unless something needs attention.
  const needsAttention =
    result.worktrees.blocked.length > 0 ||
    result.branches.blocked.length > 0 ||
    result.worktrees.reclaimable.length > 0 ||
    result.worktrees.prunable.length > 0;

  if (quiet && !needsAttention) return 0;

  console.log(report(result, { stashCount, remote }));
  return 0;
}

// Only run the CLI when invoked directly, so tests can import the classifier.
if (process.argv[1] && process.argv[1].endsWith('worktree-inventory.mjs')) {
  main().then((code) => process.exit(code));
}
