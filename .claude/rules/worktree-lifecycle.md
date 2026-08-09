# Worktree & Branch Lifecycle

**Last verified:** 2026-08-09

Linked from `CLAUDE.md` and `close-out-standard.md` step 11. Born from the 2026-08-04 audit that
found **65 worktrees, 87 local branches, 3 stashes and 3.0 GB** under `.claude/worktrees/` — with
**15 worktrees holding uncommitted work** nobody could date or attribute. Nothing had been lost;
everything had been *forgotten*, which is the cheaper failure only until it isn't.

## 1. A worktree is deleted when its work is done

**Done means all three, verified, not assumed:**

1. `git status --porcelain` is empty in that worktree;
2. `git rev-list --count <branch> --not --remotes` is `0` — the commits exist on a remote, so
   losing this disk loses nothing;
3. the work has landed (merged into `origin/dev`) **or** been deliberately retired.

When all three hold, remove the worktree and its local branch **in the same close-out** that
finished the work. Deleting a local branch does not touch the remote — the history stays on
GitHub, recoverable by name, forever.

Never hand-delete a worktree directory with `rm -rf`: git keeps an administrative record, the
branch stays pinned as "checked out", and the branch then cannot be deleted. Use
`git worktree remove`, or the tool below.

## 2. The mechanism

```bash
npm run worktrees          # classify everything; deletes nothing
npm run worktrees:clean    # delete ONLY the provably-finished items
```

`scripts/worktree-inventory.mjs` sorts every worktree and branch into: **reclaimable** (all three
conditions above), **stale record** (directory gone — `/private/tmp` gets wiped by macOS),
**blocked** (uncommitted or unpushed — never auto-deleted), and **protected**.

`--clean` acts only on the reclaimable and stale piles, re-checks each item immediately before
removing it, deletes branches with `git branch -d` (never `-D`, so git itself refuses anything
unmerged), and never contacts a remote. Behaviour is pinned by
`scripts/worktree-inventory.node-test.mjs` (`npm run test:worktrees`).

**Protected, never proposed for deletion:** `dev`, `main`, the primary working directory, any
branch currently checked out somewhere, and **`rescue/*`** — those are deliberate archives of
recovered work, and being merged into `dev` does not make them disposable.

Stashes are never touched. Review them by hand (`git stash list`); a stash is invisible to every
check in §1 and is the easiest place for work to die quietly.

## 3. Register work that is meant to ship — at the start

**`npm run wip:open -- --next "…"`** when you begin substantive work on a branch. It writes one
small tracked file in `docs/wip/` **inside the worktree you are standing in** — commit it with your
work, because that is what makes the record outlive the worktree. `npm run wip` reports every
entry's real state, read fresh from git, **across every worktree**, so an entry on a branch that has
not merged is still visible from the main checkout where the `SessionStart` banner is produced.

**Register at the start, not the end.** A session that runs out of credits or tokens dies mid-turn
and never writes a handoff — so anything that depends on a graceful exit fails in exactly the case
that costs the most. Registering costs one command while you still have context.

**`dev` is the finish line** (owner-directed 2026-08-04). Both `dev` and `main` are actively
maintained and anything in `dev` reaches `main` on its own cadence, so an entry closes when it
lands in `dev`. The alarm is work that **never reached `dev` at all** and has gone quiet for 7+
days: that surfaces at the start of every session with its description and next action.

`wip:close` refuses to close a ship-bound entry that has not landed; `--force` abandons it
deliberately. Deliberate abandonment is fine — silent abandonment is the problem.

## 4. Naming

Auto-generated names (`claude/dazzling-mestorf-d3028f`) say nothing, and renaming a branch a live
session is sitting on is not safe. So **the register carries the meaning**: its `# What` line is
printed beside the branch everywhere, and the cryptic name stops mattering. Registering is the fix
for a bad name — not `git branch -m`.

For branches you create yourself, use `<owner>/<area>-<purpose>`:
`codex/billing-invoice-send-fix`, not `codex/fix-2`. Name the worktree directory after the same
purpose.

## 5. Do not abandon a session mid-work

The failure is not stopping — it is stopping **without leaving a mark**. An uncommitted worktree
carries no date and no author, so a week later nobody can tell live work from dead work.

**Parking work is a deliberate act.** Before a session ends with anything unsaved, do one of:

- **commit it** — the repository default is small commits straight to `dev` (Rule 6), and a WIP
  commit on a side branch is always better than a dirty tree;
- **push it** — even a throwaway branch; a pushed branch survives losing the disk, a dirty
  worktree does not;
- **name it** — if it must stay dirty, say so in the handoff: what it is, why it is parked, and
  what the next action would be.

`.claude/hooks/session-ledger.mjs` records, at `SessionEnd`, which directory and branch a session
left and how much it left uncommitted, into the gitignored `.claude/session-ledger.json`. At
`SessionStart` it surfaces any abandoned work with its age (`left 9d ago`). That age is the point:
it converts an anonymous dirty tree into a dated, attributable decision.

The ledger is a diary, not a gate. It never blocks, never commits, never deletes, and never fails
a session — if it errors, it exits silently.

## 6. Close-out obligation

A session that created a worktree owns removing it. Carry either outcome into the handoff:

- **removed** — name the worktree and branch deleted, and close its register entry; or
- **kept** — name it, say which of §1's three conditions is unmet, and state the next action.

"I left it for later" without a named next action is how a repository reaches 65 worktrees.
