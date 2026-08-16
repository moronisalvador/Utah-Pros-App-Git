---
name: harvested-worktree-orphans
description: "When triaging idle worktrees, uncommitted files do NOT mean unmerged work — and a stale tree can carry a live regression"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0fe8d934-a020-4b6d-916f-ef369fb78840
  modified: 2026-08-08T18:28:55.786Z
---

In this repo's parallel-session workflow, work is sometimes **harvested** out of a worktree and
committed from a different checkout. The originating worktree keeps its dirty files forever and
looks abandoned, but the work is already on `dev`.

Verified case (2026-08-08): worktree `eager-wright-a9dd16` held 7 uncommitted files, idle 9 days,
migrating hand-rolled visibility listeners to `useResumeRefetch`. It had already shipped as
`f27fc366` (Jul 30 08:03) — ~40 min after the last edit in that tree. The guard test and two source
files were **byte-identical** to `origin/dev`.

**Why:** "N uncommitted files, idle X days" is the signal that triggers triage, but it measures the
container, not the work. Committing on that signal alone duplicates merged work.

**How to apply:** before rescuing any idle worktree, diff its files against `origin/dev` and grep
dev for the distinctive identifiers (variable names, comment prose). If they are present, the work
merged — retire the branch.

**The sharper danger — a stale tree can be a regression.** That same worktree was 742 commits
behind and still carried two `onBlur={() => setAwayConfirmFinish(false)}` handlers in
`AttentionStrip.jsx` that were deliberately removed on Aug 6 in `17f1a5f2` (the self-disarming
Finish confirm that lost techs' clock taps — see [[clock-tap-loss-root-cause]]). Committing or
merging it would have reintroduced a fixed field bug. **So the check runs in both directions:** does
dev already have the tree's work, and does the tree revert anything dev has gained?

Cleanup footgun: agent sessions symlink `node_modules` into a worktree so vitest resolves. A
recursive delete that follows the symlink wipes the main checkout's `node_modules` — remove the
symlink itself first, no trailing slash.

Related: [[wip-triage-2026-08-04-verdicts]], [[uncaptured-local-work-2026-07-31]],
[[git-skip-worktree-hides-files]].
