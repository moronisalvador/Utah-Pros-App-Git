---
name: worktree-npm-install-lockfile-trap
description: "In a .claude/worktrees/* checkout `npm test` fails (node_modules lives in the parent), and the obvious `npm install` fix silently rewrites package-lock.json"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8a9a326d-6db1-4712-8117-894abc65a110
  modified: 2026-08-07T18:44:43.765Z
---

A fresh `.claude/worktrees/*` checkout has **no real `node_modules`** — only `.vite`/`.vite-temp`.
`npx vitest` works (it resolves upward to the parent checkout), but **`npm test` fails**:
`scripts/qa/run-vitest-lane.mjs` resolves `path.join(root, 'node_modules', 'vitest', 'vitest.mjs')`
against the worktree root, so it dies with `MODULE_NOT_FOUND` before running anything.

`npm install` in the worktree fixes it (fast — ~4s, deps are cached) **but silently modifies
`package-lock.json`**: the local npm strips the `libc: ["glibc"]` / `["musl"]` fields from optional
platform-specific deps. That is a real, unrelated diff that would regress Linux CI if committed, and
it shows up in `git status` looking like it belongs to your work.

**How to apply:** run `npm install` in the worktree when you need `npm test` (there is no cheaper
path — the lane runner won't accept the parent's `node_modules`), then **`git checkout -- package-lock.json`
before staging**. Stage by explicit path anyway, per AGENTS.md.

**Why it bites:** `git status --porcelain` shows `M package-lock.json` with no directory prefix, and
if your shell has drifted into a subdirectory from an earlier `cd`, `git diff -- package-lock.json`
returns *empty* while the unscoped status still lists it — which reads as a phantom change. Check
`pwd` before concluding a diff is empty. Related: [[git-skip-worktree-hides-files]].
