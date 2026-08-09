#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: .claude/hooks/session-ledger.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Keeps a small diary of every Claude session: where it worked, on which
//   branch, when it started, and — crucially — whether it walked away leaving
//   unsaved files behind.
//
//   Two jobs. When a session STARTS, it shows a short warning if the
//   repository is already carrying abandoned work, so nobody opens a fresh
//   session unaware of the mess. When a session ENDS, it writes down whether
//   that session left anything uncommitted, and when.
//
//   That end-of-session note is the whole point: without a date, an
//   uncommitted worktree is indistinguishable from work in progress. With
//   one, "abandoned 9 days ago" becomes obvious.
//
// DEPENDS ON:
//   Packages:  none (node built-ins only)
//   Internal:  scripts/worktree-inventory.mjs (read-only, --quiet --json)
//   Data:      writes .claude/session-ledger.json (gitignored, local only)
//
// HOOK EVENTS:
//   SessionStart  → surfaces abandoned work into the new session's context
//   SessionEnd    → records this session's exit state
//
// NOTES / GOTCHAS:
//   - This hook must NEVER fail a session. Every path is wrapped; on any
//     error it exits 0 silently. A diary is not worth breaking a session for.
//   - It only ever writes its own ledger file. It never runs git write
//     commands, never commits, never deletes.
//   - The ledger is local state, not repository history — it is gitignored
//     on purpose, because it describes this machine's sessions.
//   - Ledger entries are capped (MAX_ENTRIES) so the file cannot grow without
//     bound on a long-lived checkout.
// ════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 200;
const STALE_DAYS = 3;

// ─── SECTION: Helpers ──────────────

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
};

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
 * The MAIN repository root, never a worktree's own root.
 *
 * `git rev-parse --show-toplevel` inside a worktree returns that worktree —
 * which would give every worktree its own ledger (invisible to the inventory)
 * and, worse, drop an untracked file into a checkout old enough to predate
 * the .gitignore entry, making a clean worktree look dirty. `--git-common-dir`
 * always resolves to the main repository's .git, in a worktree or not.
 */
const mainRepoRoot = (cwd) => {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (common) return path.dirname(common);
  return git(['rev-parse', '--show-toplevel'], cwd);
};

const loadLedger = (file) => {
  if (!existsSync(file)) return { sessions: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.sessions) ? parsed : { sessions: [] };
  } catch {
    // A corrupt ledger is not worth a crash — start a fresh one.
    return { sessions: [] };
  }
};

const saveLedger = (file, ledger) => {
  const trimmed = { sessions: ledger.sessions.slice(-MAX_ENTRIES) };
  writeFileSync(file, JSON.stringify(trimmed, null, 2) + '\n');
};

const daysSince = (iso) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
};

/**
 * Stalled entries from the work register, via `wip --json`. Returns [] on any
 * problem — a missing register is the normal case, not an error.
 */
function readStalledWip(repoRoot) {
  try {
    const out = execFileSync('node', [path.join(repoRoot, 'scripts', 'wip.mjs'), '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
    });
    const { rows = [] } = JSON.parse(out);
    return rows
      .filter((r) => r.urgent)
      .map((r) => ({
        what: firstHeading(r.body, 'What') || r.branch,
        next: firstHeading(r.body, 'Next action') || '(not stated)',
        branch: r.branch,
        verdict: r.verdict,
        idleDays: r.idleDays,
      }));
  } catch {
    return [];
  }
}

const firstHeading = (body, heading) => {
  const m = new RegExp(`# ${heading}\\s*\\n+([^\\n]+)`).exec(body || '');
  return m ? m[1].trim() : null;
};

// ─── SECTION: Events ──────────────

/**
 * A new session is opening. Say — briefly — whether this checkout is already
 * carrying work someone walked away from.
 */
function onSessionStart(repoRoot, ledger, input, ledgerFile) {
  // Record this session as OPEN first. The inventory reads these entries and
  // refuses to reclaim a worktree with a live session in it — without this,
  // an active session sitting between two commits looks exactly like
  // finished work.
  const cwd = input.cwd || repoRoot;
  ledger.sessions.push({
    sessionId: input.session_id || null,
    cwd,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    source: input.source || null,
  });
  saveLedger(ledgerFile, ledger);

  let inv;
  try {
    const out = execFileSync(
      'node',
      [path.join(repoRoot, 'scripts', 'worktree-inventory.mjs'), '--json'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 },
    );
    inv = JSON.parse(out);
  } catch {
    return; // Inventory unavailable — stay quiet rather than guess.
  }

  const blocked = inv.worktrees?.blocked ?? [];
  const reclaimable = inv.reclaimableWorktrees ?? 0;
  const prunable = inv.prunableWorktrees ?? 0;
  const reclaimableBranches = inv.reclaimableBranches ?? 0;

  // Attach the last-known abandonment date to each dirty worktree.
  const lastSeen = new Map();
  for (const s of ledger.sessions) {
    if (s.cwd && s.endedAt) lastSeen.set(s.cwd, s.endedAt);
  }

  const notes = [];
  if (blocked.length) {
    notes.push(`${blocked.length} worktree(s) hold uncommitted work:`);
    for (const b of blocked.slice(0, 10)) {
      const when = lastSeen.get(b.dir);
      const age = when ? daysSince(when) : null;
      const stamp =
        age === null ? '' : age === 0 ? ' (left today)' : ` (left ${age}d ago)`;
      notes.push(`  · ${path.basename(b.dir)} — ${b.reason}${stamp}`);
    }
    if (blocked.length > 10) notes.push(`  · …and ${blocked.length - 10} more`);
  }

  const disposable = reclaimable + prunable + reclaimableBranches;
  if (disposable > 0) {
    notes.push(
      `${reclaimable} finished worktree(s), ${prunable} stale record(s) and ${reclaimableBranches} merged branch(es) can be deleted — \`npm run worktrees:clean\`.`,
    );
  }

  // Work that was meant to ship, never reached dev, and has gone quiet. This
  // is the failure the register exists for, so it leads.
  const stalled = readStalledWip(repoRoot);

  if (!notes.length && !stalled.length) return;

  if (stalled.length) {
    console.log('Unfinished work that was meant to ship (docs/wip/):');
    for (const s of stalled) {
      console.log(`  ⚠ ${s.what}`);
      console.log(`     ${s.branch} — ${s.verdict}, idle ${s.idleDays ?? '?'}d · next: ${s.next}`);
    }
    console.log('');
  }

  if (notes.length) {
    console.log('Repository housekeeping (worktree-lifecycle.md):');
    for (const n of notes) console.log(n);
    console.log('Full detail: `npm run worktrees` · `npm run wip`');
  }
}

/**
 * A session is closing. Record whether it is leaving anything behind.
 */
function onSessionEnd(repoRoot, ledger, input, ledgerFile) {
  const cwd = input.cwd || repoRoot;
  const status = git(['status', '--porcelain'], cwd);
  const dirtyCount = status ? status.split('\n').filter(Boolean).length : 0;
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || null;
  const unpushed = Number(git(['rev-list', '--count', 'HEAD', '--not', '--remotes'], cwd) || 0);

  const closing = {
    endedAt: new Date().toISOString(),
    reason: input.reason || null,
    dirtyCount,
    unpushedCount: unpushed,
    abandoned: dirtyCount > 0 || unpushed > 0,
  };

  // Close this session's open entry so it stops counting as active. Match on
  // session id when we have one, otherwise on the most recent open entry for
  // the same directory.
  const open = [...ledger.sessions]
    .reverse()
    .find(
      (s) =>
        !s.endedAt &&
        (input.session_id ? s.sessionId === input.session_id : s.cwd === cwd),
    );

  if (open) Object.assign(open, closing);
  else ledger.sessions.push({ sessionId: input.session_id || null, cwd, branch, ...closing });

  saveLedger(ledgerFile, ledger);

  // Visible where the session's output still lands.
  if (dirtyCount > 0 || unpushed > 0) {
    const bits = [];
    if (dirtyCount) bits.push(`${dirtyCount} uncommitted file(s)`);
    if (unpushed) bits.push(`${unpushed} unpushed commit(s)`);
    console.log(
      `⚠ Session ended in ${path.basename(cwd)} (${branch}) leaving ${bits.join(' and ')}.`,
    );
  }
}

// ─── SECTION: Entry ──────────────

function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    input = {};
  }

  const repoRoot =
    mainRepoRoot(input.cwd || process.cwd()) ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd();

  const ledgerFile = path.join(repoRoot, '.claude', 'session-ledger.json');
  const ledger = loadLedger(ledgerFile);
  const event = input.hook_event_name || process.argv[2] || '';

  if (event === 'SessionStart') onSessionStart(repoRoot, ledger, input, ledgerFile);
  else if (event === 'SessionEnd') onSessionEnd(repoRoot, ledger, input, ledgerFile);
}

try {
  main();
} catch {
  // Never fail a session over bookkeeping.
}
process.exit(0);
