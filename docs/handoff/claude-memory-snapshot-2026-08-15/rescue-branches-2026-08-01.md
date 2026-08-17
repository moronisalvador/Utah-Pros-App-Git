---
name: rescue-branches-2026-08-01
description: Two rescue branches preserve pre-reconcile Mac state — never delete them; both are now verified pushed to origin (corrected 2026-08-04)
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f547a20-1cbb-4bc2-a94e-8757aac64730
  modified: 2026-08-05T02:58:42.389Z
---

Two rescue branches preserve the Mac checkout's state before `dev` was reconciled to `origin/dev` on
2026-07-31. **Neither may be deleted or force-pushed.**

- **`rescue/mac-uncommitted-2026-08-01` = `072ec6d1`** — on origin. 33 files of PR #563
  conversation-participants work left on `dev` instead of its feature branch. Most content is
  superseded by `origin/codex/mobile-readiness-conversation-participants` (#563), but it is the
  **only** copy of `docs/handoff/testflight-2026-07-30-codex-session.md` (~2× #563's version:
  Preview APNS_TOPIC fix record, Xcode Cloud orphaned-workflow evidence) and of both `.xcscheme`
  files in their stripped state. Hunk-level verification was completed for only 14 of the 33 files,
  so "everything is on #563" is **not fully proven** — do not delete on that basis.

- **`rescue/mac-skip-worktree-2026-08-01` = `599cbe55`** — captures the five skip-worktree-hidden
  files (WIP hardening of the applied 20260726 anon_closure_tranche_a and permission_write_gates
  migrations). **Correction 2026-08-04: this is no longer local-only — it is on
  `origin/rescue/mac-skip-worktree-2026-08-01`.** Verified with
  `git rev-list --count rescue/mac-skip-worktree-2026-08-01 --not --remotes` → `0`. The earlier
  "exists on one disk only / pushing needs authorization" warning is obsolete; someone pushed it
  between 2026-08-01 and 2026-08-04. Still never delete or force-push it.

Migration numbering differs between the branches; align before diffing. Mac draft:
`40337 = scoping`, `40338 = policy_enforcement`. #563: `40337 = scoping`,
`40338 = unread_state_compatibility`, `40339 = policy_enforcement`. #563 is the newer, strictly
stricter revision — no SQL construct on the Mac draft is missing from it.

Related: [[uncaptured-local-work-2026-07-31]], [[git-skip-worktree-hides-files]].
