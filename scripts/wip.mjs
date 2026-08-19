#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: wip.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Keeps a short written record of work that is meant to reach production but
//   is not there yet — what it is, why it matters, and what the next step is.
//
//   Each piece of work gets one small file in docs/wip/. The file is committed,
//   so it survives deleting the worktree, losing the laptop, or a session dying
//   halfway through. Everything else — whether the branch is pushed, merged, or
//   already live — is read fresh from git, so the record cannot quietly go
//   stale the way a hand-written status list does.
//
//   The record is only closed when the work is actually IN PRODUCTION, not when
//   it merges to dev. Work that reached dev and stopped is the exact gap this
//   exists to make visible.
//
// DEPENDS ON:
//   Packages:  none (node built-ins only)
//   Internal:  docs/wip/*.md (the register itself)
//   Data:      none (no Supabase access)
//
// EXPORTS:
//   deriveVerdict(entry, gitState)  pure state machine, unit-tested
//   parseFrontmatter(text)          minimal YAML-subset reader, unit-tested
//   VERDICTS
//
// NOTES / GOTCHAS:
//   - One file per item, NOT one shared list. Parallel sessions edit different
//     files and never conflict; a shared JSON array would collide constantly
//     in a repo that runs this many worktrees at once.
//   - "In production" means every commit on the branch is reachable from
//     origin/main. Merged-to-dev is reported separately and deliberately does
//     NOT close an entry.
//   - This script never commits, pushes, deletes a branch, or touches a remote.
//     `close` removes one register file and nothing else.
//   - BRANCH-SCOPED ON WRITE, REPO-WIDE ON READ. `open` writes into the current
//     worktree so the entry is committed on the branch it describes (see
//     registerRoot); `wip` reads every worktree's docs/wip/ so an entry that
//     has not merged is still visible from the main checkout, where the
//     SessionStart hook runs; `close` deletes only within the current worktree.
//     The two halves are one decision — branch-scoped writing without
//     repo-wide reading hides exactly the unmerged work this register exists
//     to shout about.
// ════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const REGISTER_DIR = path.join('docs', 'wip');
const STALE_DAYS = 7;

// ─── SECTION: Verdicts ──────────────

export const VERDICTS = {
  LANDED: 'LANDED',             // in origin/dev — done; main follows on its own cadence
  UNPUSHED: 'UNPUSHED',         // commits exist on no remote
  DIRTY: 'DIRTY',               // uncommitted changes on disk
  IN_PROGRESS: 'IN_PROGRESS',   // pushed, never merged — the real gap
  ORPHANED: 'ORPHANED',         // register entry whose branch is gone
};

/**
 * Decide what a register entry's real state is, from git facts only.
 * Pure so the state machine is unit-testable without a repository.
 *
 * `dev` is the finish line, NOT `main` (owner-directed 2026-08-04): both
 * branches are actively maintained and anything in dev reaches main on its own
 * cadence, so flagging "in dev, not in production" would cry wolf over work
 * that is genuinely finished. What actually goes missing is work that never
 * reached dev at all.
 *
 * Order matters: unsaved work outranks merge status, because a dirty tree is
 * the state most likely to be lost.
 */
export function deriveVerdict(entry, git) {
  if (!git.branchExists) {
    // Both refs gone, but dev's history still remembers the merge. Since
    // close-out-standard.md 11a merges AND deletes the branch, this is now the
    // NORMAL end state of successful work — not decay. Without this, every
    // shipped entry became permanently unclosable and shouted from the
    // SessionStart banner forever.
    if (git.mergedViaPr) {
      return { verdict: VERDICTS.LANDED, detail: `branch deleted; ${git.mergedViaPr}` };
    }
    return { verdict: VERDICTS.ORPHANED, detail: 'branch no longer exists' };
  }
  if (git.dirtyCount > 0) {
    return { verdict: VERDICTS.DIRTY, detail: `${git.dirtyCount} uncommitted file(s)` };
  }
  if (git.unpushedCount > 0) {
    return { verdict: VERDICTS.UNPUSHED, detail: `${git.unpushedCount} commit(s) on no remote` };
  }
  if (git.inDev) {
    return {
      verdict: VERDICTS.LANDED,
      detail: git.inProduction ? 'in dev and in production' : 'in dev; main follows',
    };
  }
  return { verdict: VERDICTS.IN_PROGRESS, detail: `${git.aheadOfDev} commit(s) never merged to dev` };
}

/**
 * Does this entry deserve to shout? Anything not yet in dev, that is meant to
 * ship, and has gone quiet.
 */
export function isUrgent(entry, verdict, idleDays) {
  if (verdict === VERDICTS.LANDED) return false;
  if (!entry.ships) return false;
  return idleDays === null || idleDays >= STALE_DAYS;
}

// ─── SECTION: Frontmatter ──────────────

/**
 * Read the `--- key: value ---` header of a register file.
 * Deliberately a tiny subset — no dependency, no surprises.
 */
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else v = v.replace(/^["']|["']$/g, '');
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

// ─── SECTION: Git ──────────────

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

/**
 * The root of the CURRENT worktree — not the main checkout.
 *
 * The register in `docs/wip/` is TRACKED, per-branch, and meant to be committed
 * alongside the work it describes and merged into `dev` with it. So it has to be
 * written into whichever worktree the session is actually running in.
 *
 * This deliberately does NOT match `.claude/hooks/session-ledger.mjs`, which uses
 * `--git-common-dir` to reach the main checkout on purpose — and is right to. The
 * two files have opposite requirements, and conflating them is the bug this
 * replaced: `--git-common-dir` resolves to the SHARED `.git`, so from a worktree
 * `path.dirname()` of it lands in the main checkout. `wip:open` then wrote the
 * register into a tree the session could not commit from, and `wip:close` deleted
 * it there, silently dirtying the owner's main checkout. Observed live 2026-08-09.
 *
 *   ledger      → gitignored, ONE shared file, must be visible across worktrees
 *                 → `--git-common-dir` (main checkout). Correct as it stands.
 *   wip register → tracked, per-branch, committed with the work
 *                 → `--show-toplevel` (this worktree). What this function does.
 *
 * Do not "unify" these. From the main checkout both resolve identically, so this
 * change is a no-op there and only fixes the worktree case.
 */
export const registerRoot = (gitFn = git, cwd = process.cwd()) =>
  gitFn(['rev-parse', '--show-toplevel'], cwd) || cwd;

/** Every worktree path in `git worktree list --porcelain`, in listed order. */
export function worktreeRootsFrom(porcelain) {
  const roots = [];
  for (const line of String(porcelain ?? '').split('\n')) {
    if (line.startsWith('worktree ')) roots.push(line.slice('worktree '.length));
  }
  return roots;
}

/**
 * Where to LOOK for register entries: every worktree that has a `docs/wip/`.
 *
 * The write side is branch-scoped (see registerRoot above), which is what makes
 * an entry committable by its owner. Reading has to span worktrees or that fix
 * costs more than it buys: an entry for work that never merged exists ONLY on
 * its own branch, so a single-directory read makes it invisible from the main
 * checkout — and `.claude/hooks/session-ledger.mjs` runs `wip --json` from
 * exactly there, so the STALLED banner would never fire for it.
 *
 * Measured on this repository 2026-08-09, from the main checkout: reading one
 * directory found 6 entries and 1 alarm; reading every worktree found 12 and 6.
 * Five live alarms were being suppressed — for branches that had never reached
 * dev, which is precisely the class this register exists to shout about.
 *
 * The current worktree is searched FIRST, so its own copy of a slug wins over a
 * stale copy carried on another branch.
 */
export const registerRoots = (root) =>
  [root, ...worktreeRootsFrom(git(['worktree', 'list', '--porcelain'], root)).filter((d) => d !== root)]
    .filter((d) => existsSync(path.join(d, REGISTER_DIR)));

/** A path relative to `root` when inside it, absolute when it belongs elsewhere. */
const showPath = (root, file) =>
  file.startsWith(root + path.sep) ? path.relative(root, file) : file;

/**
 * The worktree directory a branch is checked out in, or null.
 * Block-by-block parse — see the note at the call site for why a regex is wrong.
 */
export function worktreeDirFor(branch, root, porcelainOverride = null) {
  const raw = porcelainOverride ?? git(['worktree', 'list', '--porcelain'], root);
  let dir = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) dir = line.slice('worktree '.length);
    else if (line === '') dir = null;
    else if (line === `branch refs/heads/${branch}`) return dir;
  }
  return null;
}

/**
 * The ref to judge this entry by: the local branch, or failing that its
 * remote-tracking ref.
 *
 * Deleting the local branch once work lands is not decay — `worktree-lifecycle.md`
 * §1 explicitly instructs it, and `worktrees:clean` does it automatically. But the
 * ORPHANED check runs before the LANDED check, so a local-only lookup meant that
 * following that instruction flipped a shipped entry to
 * "ORPHANED (branch no longer exists)" permanently, and the SessionStart banner
 * then warned about it at the top of every session, forever. Observed 2026-08-09
 * on `claude/kind-grothendieck-9f41f6`, whose work was merged in PR #608.
 *
 * `origin/<branch>` still resolves after local cleanup, and is enough to answer the
 * only question that matters at that point: did this land? When BOTH are gone there
 * is genuinely nothing left to judge, and ORPHANED is then the honest answer.
 */
export function refFor(branch, root, gitFn = git) {
  if (gitFn(['rev-parse', '--verify', '--quiet', branch], root) !== '') return branch;
  const remote = `origin/${branch}`;
  if (gitFn(['rev-parse', '--verify', '--quiet', remote], root) !== '') return remote;
  return null;
}

/**
 * Last resort when BOTH the local branch and its remote are gone: ask dev's own
 * history whether it ever merged this branch.
 *
 * `gh pr merge --delete-branch` writes
 *   "Merge pull request #675 from moronisalvador/claude/jovial-archimedes-71f695"
 * and then removes the branch, so the subject line is the only surviving record.
 *
 * The `$` anchor is load-bearing, not defensive tidiness. This repository
 * contains BOTH `codex/qbo-picker-controls` and
 * `codex/qbo-picker-controls-rebased`; an unanchored match would report the
 * first as landed on the strength of the second's merge. Here that happens to
 * be the right answer, which is exactly what makes it a dangerous default.
 *
 * LIMITATION, stated rather than discovered: this reads GitHub's default
 * merge-commit shape. A SQUASH or REBASE merge leaves no such commit and this
 * returns null. That degrades to the old behaviour — ORPHANED, close refuses,
 * operator passes --force — which is the safe direction: a missed merge costs
 * one flag, whereas a FALSE landed would delete the record of work that never
 * shipped. If this repository ever adopts squash merges, stamp the merge SHA
 * into the entry at close-out and consult that first; the two compose (stamp
 * forward, grep the backlog).
 *
 * Returns the merge subject (useful detail for the operator) or null.
 */
export function mergeEvidenceFor(branch, root, gitFn = git) {
  const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return gitFn([
    'log', 'origin/dev', '--merges', '--max-count=1', '--format=%s',
    '--extended-regexp', `--grep=^Merge pull request #[0-9]+ from [^/]+/${escaped}$`,
  ], root) || null;
}

function gitStateFor(branchName, root) {
  const branch = refFor(branchName, root);
  if (!branch) {
    return {
      branchExists: false, mergedViaPr: mergeEvidenceFor(branchName, root),
      dirtyCount: 0, unpushedCount: 0, inDev: false, inProduction: false,
      aheadOfDev: 0, lastCommitAt: null,
    };
  }

  // Only a checked-out branch can be dirty. Parse the porcelain into discrete
  // blocks — a regex spanning `worktree …` to `branch …` silently matches
  // ACROSS blocks and returns the wrong directory's dirty count.
  // Look this up by the ORIGINAL branch name, never the resolved ref: a worktree is
  // always checked out to a local branch, so `origin/<branch>` never matches and
  // would silently report every fallback entry as clean.
  let dirtyCount = 0;
  const dir = worktreeDirFor(branchName, root);
  if (dir && existsSync(dir)) {
    const s = git(['status', '--porcelain'], dir);
    dirtyCount = s ? s.split('\n').filter(Boolean).length : 0;
  }

  return {
    branchExists: true,
    mergedViaPr: null,
    dirtyCount,
    unpushedCount: Number(git(['rev-list', '--count', branch, '--not', '--remotes'], root) || 0),
    aheadOfDev: Number(git(['rev-list', '--count', `origin/dev..${branch}`], root) || 0),
    inDev: Number(git(['rev-list', '--count', `origin/dev..${branch}`], root) || 0) === 0,
    inProduction: Number(git(['rev-list', '--count', `origin/main..${branch}`], root) || 0) === 0,
    lastCommitAt: git(['log', '-1', '--format=%cI', branch], root) || null,
  };
}

// ─── SECTION: Register I/O ──────────────

const slugFor = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

function readRegister(root) {
  const seen = new Set();
  const entries = [];
  for (const worktree of registerRoots(root)) {
    const dir = path.join(worktree, REGISTER_DIR);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || f === 'README.md') continue;
      const slug = f.replace(/\.md$/, '');
      if (seen.has(slug)) continue;   // current worktree is searched first — it wins
      seen.add(slug);
      const file = path.join(dir, f);
      const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
      entries.push({ file, slug, ...data, ships: data.ships === true, body });
    }
  }
  return entries;
}

const daysSince = (iso) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
};

/**
 * Open PRs, with staleness. Optional signal: requires the gh CLI and network,
 * so it fails soft to [] — the register must keep working offline, and the
 * SessionStart hook must never hang on GitHub.
 */
function collectOpenPrs(root) {
  try {
    const out = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,updatedAt,isDraft'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8_000 },
    );
    return JSON.parse(out).map((p) => ({
      ...p,
      idleDays: daysSince(p.updatedAt),
    }));
  } catch {
    return [];
  }
}

// ─── SECTION: Commands ──────────────

function cmdOpen(root, args) {
  const flag = (n, d = '') => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };

  const branch = flag('branch') || git(['rev-parse', '--abbrev-ref', 'HEAD'], process.cwd());
  if (!branch || branch === 'HEAD') {
    console.error('Could not determine a branch. Pass --branch <name>.');
    return 1;
  }
  if (branch === 'dev' || branch === 'main') {
    console.error(`Refusing to register "${branch}" — register the feature branch, not a release branch.`);
    return 1;
  }

  // The register's whole job is to carry the meaning a generated branch name
  // cannot (worktree-lifecycle.md §4), so a wrong "What" defeats it entirely.
  //
  // This used to default to the branch's last commit subject. But you register at
  // the START (§3), when the branch has no commits of its own yet — so that read
  // returned whatever `dev` was last pointed at, usually somebody else's merge
  // commit. A register entry claiming "Merge pull request #604 from ..." describes
  // another session's work, which is worse than describing none.
  //
  // Take the FIRST commit unique to this branch when there is one — that is
  // genuinely this work — and otherwise say nothing, matching how `why` and `next`
  // already prompt rather than guess.
  const ownFirstSubject = git(
    ['log', '--format=%s', '--reverse', `origin/dev..${branch}`],
    root,
  ).split('\n')[0].trim();
  const what = flag('what') || ownFirstSubject || '(not stated — what is this work?)';
  const why = flag('why') || '(not stated — say why this matters before it is forgotten)';
  const next = flag('next') || '(not stated — the single next action)';
  const ships = !args.includes('--no-ships');

  // Look across every worktree, but only ever WRITE into this one: an entry that
  // already exists on another branch must not be duplicated here.
  const already = readRegister(root).find((e) => e.slug === slugFor(branch));
  if (already) {
    console.log(`Already registered: ${showPath(root, already.file)}`);
    return 0;
  }

  const dir = path.join(root, REGISTER_DIR);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slugFor(branch)}.md`);

  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    file,
    `---
branch: ${branch}
ships: ${ships}
opened: ${today}
---

# What

${what}

# Why it matters

${why}

# Next action

${next}
`,
  );

  console.log(`Registered ${path.relative(root, file)}`);
  console.log(ships
    ? '  Marked ship-bound: this stays open until it lands in origin/dev.'
    : '  Marked NOT ship-bound — it will never raise a warning.');
  return 0;
}

function cmdClose(root, args) {
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('Usage: npm run wip:close -- <slug-or-branch> [--force]');
    return 1;
  }
  const entries = readRegister(root);
  const entry = entries.find((e) => e.slug === target || e.branch === target || e.slug === slugFor(target));
  if (!entry) {
    console.error(`No register entry matching "${target}".`);
    return 1;
  }

  // Reading spans worktrees; deleting must not. Removing another worktree's
  // tracked file leaves a deletion staged on a branch this session is not on,
  // for a session that did not ask for it — the same class of harm the
  // registerRoot fix above closed, just in the other direction.
  if (!entry.file.startsWith(path.join(root, REGISTER_DIR) + path.sep)) {
    console.error(`"${target}" is registered in a different worktree:`);
    console.error(`  ${entry.file}`);
    console.error('Close it from there, so the deletion is committed on the branch that owns it.');
    return 1;
  }

  const state = gitStateFor(entry.branch, root);
  const { verdict, detail } = deriveVerdict(entry, state);

  if (entry.ships && verdict !== VERDICTS.LANDED && !args.includes('--force')) {
    console.error(`Refusing to close: ${entry.branch} is ${verdict} (${detail}).`);
    console.error('This entry is marked ship-bound and has not landed in origin/dev yet.');
    console.error('Land it, or pass --force to abandon it deliberately.');
    return 1;
  }

  rmSync(entry.file);
  console.log(`Closed ${showPath(root, entry.file)} (${verdict}).`);
  return 0;
}

function cmdList(root, { json = false, quiet = false } = {}) {
  const entries = readRegister(root);
  const rows = entries.map((e) => {
    const state = gitStateFor(e.branch, root);
    const { verdict, detail } = deriveVerdict(e, state);
    const idleDays = daysSince(state.lastCommitAt);
    return { ...e, state, verdict, detail, idleDays, urgent: isUrgent(e, verdict, idleDays) };
  });

  // Unregistered work: a branch ahead of dev with no entry at all.
  // "Not merged into origin/dev" comes from ONE `git branch --merged` call.
  // Asking per-branch would be ~87 subprocesses on this repo, and this runs
  // inside the SessionStart hook.
  const registered = new Set(rows.map((r) => r.branch));
  const merged = new Set(
    git(['branch', '--merged', 'origin/dev', '--format=%(refname:short)'], root)
      .split('\n')
      .filter(Boolean),
  );
  const unregistered = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], root)
    .split('\n')
    .filter(Boolean)
    .filter((b) => !['dev', 'main'].includes(b) && !b.startsWith('rescue/') && !registered.has(b))
    .filter((b) => !merged.has(b));

  const openPrs = collectOpenPrs(root);
  const stalePrs = openPrs.filter((p) => !p.isDraft && p.idleDays !== null && p.idleDays >= STALE_DAYS);

  if (json) {
    process.stdout.write(JSON.stringify({ rows, unregistered, openPrs, stalePrs }, null, 2) + '\n');
    return 0;
  }

  const landed = rows.filter((r) => r.verdict === VERDICTS.LANDED);
  const stalled = rows.filter((r) => r.verdict !== VERDICTS.LANDED && r.urgent);
  const moving = rows.filter((r) => r.verdict !== VERDICTS.LANDED && !r.urgent);

  if (quiet && !stalled.length && !unregistered.length) return 0;

  const out = [];
  out.push('');
  out.push('  UNFINISHED WORK');
  out.push('  ' + '─'.repeat(70));

  if (!rows.length) {
    out.push('');
    out.push('  Nothing registered.');
  }

  if (stalled.length) {
    out.push('');
    out.push(`  ⚠  STALLED — meant to ship, never reached dev, quiet ${STALE_DAYS}d+:`);
    for (const r of stalled) {
      const age = r.idleDays === null ? 'no commits' : `idle ${r.idleDays}d`;
      out.push(`     ${describe(r)}`);
      out.push(`        ${r.branch} — ${r.verdict} (${r.detail}) · ${age}`);
      out.push(`        next: ${firstLine(r, 'Next action')}`);
    }
  }

  if (moving.length) {
    out.push('');
    out.push('  ·  IN FLIGHT:');
    for (const r of moving) {
      const age = r.idleDays === null ? '' : ` · idle ${r.idleDays}d`;
      out.push(`     ${describe(r)}`);
      out.push(`        ${r.branch} — ${r.verdict} (${r.detail})${age}`);
      out.push(`        next: ${firstLine(r, 'Next action')}`);
    }
  }

  if (landed.length) {
    out.push('');
    out.push('  ✓  LANDED IN DEV — close these:');
    for (const r of landed) {
      out.push(`     ${describe(r)}`);
      out.push(`        npm run wip:close -- ${r.slug}`);
    }
  }

  if (stalePrs.length) {
    out.push('');
    out.push(`  ⚠  OPEN PRs QUIET ${STALE_DAYS}d+ — merge, revive, or close them:`);
    for (const p of stalePrs) {
      out.push(`     #${p.number} ${p.title.slice(0, 60)}`);
      out.push(`        ${p.headRefName} · idle ${p.idleDays}d`);
    }
  } else if (openPrs.length) {
    out.push('');
    out.push(`  ·  ${openPrs.length} open PR(s), all recently active.`);
  }

  if (unregistered.length) {
    out.push('');
    out.push(`  ?  ${unregistered.length} branch(es) ahead of dev with NO register entry:`);
    for (const b of unregistered.slice(0, 12)) out.push(`     ${b}`);
    if (unregistered.length > 12) out.push(`     …and ${unregistered.length - 12} more`);
    out.push('     Register with: npm run wip:open -- --branch <name> --next "…"');
  }

  out.push('');
  console.log(out.join('\n'));
  return 0;
}

const firstLine = (entry, heading) => {
  const m = new RegExp(`# ${heading}\\s*\\n+([^\\n]+)`).exec(entry.body || '');
  return m ? m[1].trim() : '(not stated)';
};

/**
 * The human-readable label for an entry.
 *
 * Auto-generated branch names (`claude/dazzling-mestorf-d3028f`) carry no
 * meaning, and renaming a branch a live session is sitting on is not safe. So
 * the register supplies the description instead: the name stays whatever git
 * calls it, and the human reads the "What" line.
 */
const describe = (entry) => firstLine(entry, 'What');

// ─── SECTION: CLI ──────────────

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const root = registerRoot();

  if (cmd === 'open') return cmdOpen(root, rest);
  if (cmd === 'close') return cmdClose(root, rest);
  return cmdList(root, {
    json: process.argv.includes('--json'),
    quiet: process.argv.includes('--quiet'),
  });
}

if (process.argv[1] && process.argv[1].endsWith('wip.mjs')) {
  process.exit(main());
}
