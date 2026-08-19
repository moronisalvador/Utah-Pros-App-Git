---
name: wip-open-writes-outside-worktree
description: "Two repo tools need OPPOSITE git roots — the wip register wants the worktree, the session ledger wants the main checkout; conflating them was a real bug (fixed PR #614)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 07ae8e60-6638-45e8-94eb-04c0e988eda1
  modified: 2026-08-09T03:49:00.829Z
---

**The durable rule:** two tools in this repo derive a repo root and need **opposite** answers.
Never "unify the root helpers."

| file | nature | correct root |
|---|---|---|
| `docs/wip/*.md` (`scripts/wip.mjs`) | **tracked**, per-branch, committed with the work | `--show-toplevel` → this worktree |
| `.claude/session-ledger.json` (`.claude/hooks/session-ledger.mjs`) | **gitignored**, ONE shared file spanning all worktrees | `--git-common-dir` → main checkout |

`--git-common-dir` returns the **shared** `.git`, so `path.dirname()` of it lands in the main
checkout even from a worktree. The ledger wants exactly that and is correct as written — its
own comment explains that `--show-toplevel` would give every worktree an invisible ledger and
drop an untracked file into checkouts predating the `.gitignore` entry.

`wip.mjs` had copied the ledger's helper, which was wrong for a tracked per-branch file:
`wip:open` wrote the register into a tree the session couldn't commit from (while printing a
success line naming a path that didn't exist there, so re-runs said "Already registered"
against an empty `ls`), and `wip:close` **deleted it in the main checkout**, silently dirtying
it. **Fixed 2026-08-09 in PR #614**, which also stopped `# What` defaulting to the branch's
last commit — at registration time that's `dev`'s tip, i.e. another session's merge commit.
A test now asserts the two roots stay divergent, so a future cleanup fails loudly.

**Also learned, unfixed:** `npm run worktrees:clean` deleted a worktree **while a session was
live in it**. It was correct by all three `worktree-lifecycle.md` §1 conditions at that instant
— the session had re-entered a merged worktree and branched new work with no commits yet, so
"provably finished" and "in active use" were indistinguishable. Nothing was lost (branches live
in the shared `.git`), but the directory can vanish mid-turn; if it does, recreate with
`git worktree add`. `collectActiveDirs()` reads the session ledger for exactly this signal.

Related: [[harvested-worktree-orphans]], [[worktree-npm-install-lockfile-trap]],
[[shared-clone-moving-base-poisons-diff-gates]].
