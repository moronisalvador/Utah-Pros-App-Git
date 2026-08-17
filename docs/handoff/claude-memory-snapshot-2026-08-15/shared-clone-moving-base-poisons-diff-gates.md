---
name: shared-clone-moving-base-poisons-diff-gates
description: "Worktrees share one clone, so another session's fetch moves your origin/dev ref mid-session — any \"changed vs base\" gate then reports other files' stale-copy findings as if they were yours"
metadata: 
  node_type: memory
  type: project
  originSessionId: b2d4aac8-9e30-4df6-ba9b-eeddcd3d772a
  modified: 2026-08-09T01:24:13.766Z
---

Every `.claude/worktrees/*` checkout shares **one** `.git`. When a parallel session runs
`git fetch`, **your** `origin/dev` ref advances too — silently, mid-session. Any gate that scopes
itself by "files changed vs `origin/dev`" then widens far past your own edits: every file the
branch is now *behind* on shows up as changed, and the gate lints **your stale copy** of it.

Measured 2026-08-08 (PR #604). `npm run validate:lint-ratchet -- origin/dev` reported
**8 regressions across 47 changed files** while the branch had touched **4**. Reproduced in
throwaway detached worktrees:

```
35e931f3  (that session's base)  TOTAL FINDINGS: 8   <- what the gate linted
74dd57b9  (origin/dev by then)   TOTAL FINDINGS: 0   <- already fixed upstream
```

69 commits had landed on `dev` during the session; all 7 files had moved in that window. So the
findings were **real in the copies linted and already fixed on dev** — nothing to do with the
eslint-ratchet baseline gap, which was the wrong cause I publicly attributed them to before
another session checked.

**The subtle part** (plain "lint at a clean `origin/dev`" does not state it): the error was reading
a *whole-tree* gate's output as if every line were attributable to my diff. Findings on files you
did not touch are a signal your **base moved**, not a signal of shared debt.

**How to apply.** Before generalising from a diff-scoped gate — especially before telling other
sessions they will hit the same thing — lint the **specific files** at the **exact ref** you are
making a claim about, in a throwaway checkout:

```
git worktree add --detach /tmp/x origin/dev
ln -sfn "$(pwd)/node_modules" /tmp/x/node_modules
( cd /tmp/x && npx eslint <the files> )
```

Then `git worktree remove --force /tmp/x`. A hypothesis about lint state is not a finding until it
runs on a clean tree — the same lesson `initiative-status.md` records about a reviewer who
asserted "nothing pins this" when a test did.

Related: [[vite-devserver-poisons-test-lane]] (the other shared-clone cross-talk trap),
[[worktree-npm-install-lockfile-trap]].

Same family, confirmed the same night: [[harvested-worktree-orphans]]. Both are *"trust the content,
not the git metadata"* — there a branch's commits were **not ancestors** of `dev` yet all four files
it touched were byte-identical to `dev` (the work had landed via different commits), so
not-an-ancestor no more means unlanded than changed-vs-base means yours. Diff the files; don't read
the ref graph.
