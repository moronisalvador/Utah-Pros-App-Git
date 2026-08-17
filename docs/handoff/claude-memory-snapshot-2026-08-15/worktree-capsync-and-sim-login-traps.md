---
name: worktree-capsync-and-sim-login-traps
description: "cap sync in a symlinked-node_modules worktree rewrites Package.swift to escape the worktree; native builds compile OUT the dev-login button, so sim UI verification is owner-gated once the sim session dies"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5438c42f-5c63-4506-bdc7-99756c8cc224
  modified: 2026-08-14T18:42:26.549Z
---

Two traps from the 2026-08-14 camera-zoom session (PR #643), both in worktrees with `node_modules` symlinked from the main checkout:

1. **`cap sync ios` rewrites `ios/App/CapApp-SPM/Package.swift` dependency paths THROUGH the symlink** — `../../../node_modules/...` becomes `../../../../../../node_modules/...` (pointing at the main checkout). Same regression class as `ec5485f7`; the [[worktree-npm-install-lockfile-trap]] covers `npm install`, this covers `npm run build:ios`/`sync:ios`. `git checkout -- ios/App/CapApp-SPM/Package.swift` before staging. `xcodebuild` also dirties `Package.resolved` (originHash + pin churn) — revert that too. `tests/qa/unit/native-spm-paths-portable.test.js` catches the Package.swift form in CI, but only if you run the qa lane before committing.

**Why:** both files look like part of your diff after a native build; committing them ships paths that resolve on exactly one laptop.
**How to apply:** after any `build:ios`/`cap sync`/`xcodebuild` in a worktree, check `git status` and revert `Package.swift`/`Package.resolved` churn before staging.

2. **The Dev-Mode login button does not exist in native bundles.** `Login.jsx` gates it on `isDev` = `import.meta.env.DEV`, which is false in every `vite build` (and `build:native` is a production build) — copying `.env.local` into the worktree changes nothing. So once the simulator's stored app session dies (observed 2026-08-14: login screen with "Failed to load employee data", survives reinstall + relaunch), **signed-in simulator UI verification is an owner action** — an agent cannot reach any authenticated screen. Verify what you can headlessly instead: `xcodebuild` compile, `strings App.debug.dylib | grep <symbol>` to prove the installed binary carries the change (Debug builds put real code in `App.debug.dylib`, not the thin `App` launcher), and source-contract tests.

**Why:** the [[direct-iphone-install-workflow]] note "owner keeps a logged-in sim session" is only true until the session expires; there is no agent-side recovery.
**How to apply:** when the sim shows the login screen, don't burn time on rebuild permutations — record the signed-in pass as an owner gate and verify the binary + contracts instead.
