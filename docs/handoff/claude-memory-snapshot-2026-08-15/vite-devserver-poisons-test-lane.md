---
name: vite-devserver-poisons-test-lane
description: A running Vite dev server makes unrelated unit tests fail in worktrees that symlink node_modules — stop the server before trusting a red test run
metadata: 
  node_type: memory
  type: project
  originSessionId: bb6751c9-aa16-4a0b-8a26-06bc51e74f3d
  modified: 2026-08-08T18:40:55.310Z
---

In a git worktree whose `node_modules` is a **symlink to the main checkout's**, a running Vite dev
server (`preview_start` / `npx vite`) causes unrelated unit tests to fail. Both processes share the
same `node_modules/.vite` cache directory through the symlink.

Observed 2026-08-08: the full unit lane reported `2 failed | 127 passed`
(`src/lib/techDateUtils.test.js > currentLocaleTag`, `src/pages/settings/p3TeamAccess.test.jsx`).
Each file **passed when run alone**, and clean `origin/dev` in a fresh worktree passed 129/129.
Stopping the dev server and re-running the identical tree gave **129/129, 1651/1651**.

**Why:** don't chase the test. It is not order-dependence in the test itself and not the change
under review — it is cache cross-talk between the dev server and the vitest transform pipeline.

**How to apply:** before concluding a test failure is real in a worktree, stop any dev server and
re-run. To attribute a failure honestly, run the same lane on clean `origin/dev` in a throwaway
worktree (`git worktree add --detach /tmp/x origin/dev`, symlink node_modules, `UPR_TEST_LANE=unit
npx vitest run`). Note the lane env var is required — bare `npx vitest` dies with
"UPR_TEST_LANE must be exactly unit, worker, qa, or db".

Related: [[worktree-npm-install-lockfile-trap]], [[signout-defect2-parallel-fixes]].
