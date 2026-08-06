# Work-in-progress register

One file per piece of unfinished work that is **meant to ship**.

`npm run wip` reads these files, joins them against live git state, and reports what is actually
true. Nothing in a file describes status — status is always derived — so this register cannot go
stale the way a hand-maintained list does.

## Why this exists

Nothing here has ever been *lost*: the 2026-08-04 audit found 87 branches and zero unpushed
commits. Work gets **forgotten**, not deleted. A session stops — tiredness, credits, tokens run
out — and what remains on disk carries no record of what it was for or why it mattered.

Three decisions shape the design:

- **The record is written when work starts, not when it ends.** A session that dies mid-turn never
  gets to write a handoff. Anything depending on a graceful exit fails in exactly the case that
  matters most.
- **`dev` is the finish line, not `main`** (owner-directed 2026-08-04). Both branches are actively
  maintained and anything in `dev` reaches `main` on its own cadence, so an entry closes once it
  lands in `dev`. Flagging "in dev, not in production" would cry wolf over finished work — and a
  register that cries wolf gets ignored, which is the only way this fails.
- **The alarm is work that never reached `dev` at all** and has gone quiet: a branch still in
  flight, uncommitted files, commits on no remote.

## Naming

Auto-generated branch names (`claude/dazzling-mestorf-d3028f`) say nothing about the work, and
renaming a branch that a live session is sitting on is not safe. So the register carries the
meaning instead: `npm run wip` and `npm run worktrees` print the entry's **What** line beside the
branch, and the cryptic name stops mattering.

For branches you create yourself, prefer `<owner>/<area>-<purpose>` —
`codex/billing-invoice-send-fix`, not `codex/fix-2`.

## Commands

```bash
npm run wip                                            # what is open, and what it is really doing
npm run wip:open -- --next "wire the settings toggle"  # register the current branch
npm run wip:close -- <slug>                            # close it (refuses unless shipped)
```

`wip:open` infers `--branch` from the current checkout and `--what` from the last commit subject,
so the minimum useful call is a single `--next`. Write `--what` yourself when the commit subject is
not a good label — that string is what everything else displays instead of the branch name. Add
`--why` when the reason is not obvious; that field is what makes the entry worth reading in three
weeks. Pass `--no-ships` for a spike or experiment that is not meant to ship; those never warn.

`wip:close` refuses to close a ship-bound entry that has not landed in `origin/dev`. Override with
`--force` when you are deliberately abandoning the work — that is a real decision, and the point is
to make it a deliberate one rather than a silent one.

## File format

```markdown
---
branch: claude/my-feature
ships: true
opened: 2026-08-04
---

# What

One line — what this is. This is the label shown instead of the branch name, so make it read
like a title: "Invoice send button mislabels drafts as Sent".

# Why it matters

Why it should reach production. Write this for someone who has forgotten everything.

# Next action

The single next step. Not a plan — the next thing to do.
```

One file per item, never a shared list: parallel sessions edit different files and never conflict.

## States

| Verdict | Meaning |
|---|---|
| `LANDED` | in `origin/dev` — done; `main` follows on its own cadence. Close the entry |
| `IN_PROGRESS` | pushed but never merged to `dev` — **the gap this register exists for** |
| `UNPUSHED` | commits exist on no remote |
| `DIRTY` | uncommitted changes on disk |
| `ORPHANED` | the entry's branch no longer exists |

`DIRTY` and `UNPUSHED` outrank merge status: the most losable state is always the one reported.
Anything that is not `LANDED`, is marked `ships: true`, and has been quiet for 7+ days is reported
as **STALLED** and surfaced at the start of every session.

Related: [`.claude/rules/worktree-lifecycle.md`](../../.claude/rules/worktree-lifecycle.md).
