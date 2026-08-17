---
name: uncaptured-local-work-2026-07-31
description: "RESOLVED 2026-08-04 for the 6 branches (all pushed). Still at risk: an orphaned 11-commit Twilio feature at e7ae3fd2 and 3 stashes, so git gc/prune/stash-clear still destroys data"
metadata:
  node_type: memory
  type: project
  originSessionId: 0f547a20-1cbb-4bc2-a94e-8757aac64730
  modified: 2026-08-04T20:04:22.628Z
---

The Mac checkout at `/Users/moronisalvador/APPS/Utah-Pros-App-Git` holds work that exists on
**no remote**. Until it is pushed, these destroy data: `git gc`, `git prune`,
`git reflog expire`, `git stash clear`, `git branch -D`.

**RESOLVED 2026-08-04:** all six branches that existed on no remote were pushed to origin under
their own names — `codex/mobile-readiness-reminder-activation` (9 commits),
`codex/mobile-readiness-conversation-notifications` (4),
`codex/mobile-readiness-current-origin-review` (2),
`codex/mobile-readiness-notification-parity` (1),
`claude/remove-sms-consent-check-e15260` (1), and `rescue/mac-skip-worktree-2026-08-01` (1).
Backup only: no PR, no merge, nothing deployed. The single-disk risk for those is gone.

**Every `/private/tmp/upr-*` worktree is gone** — the Mac restart cleared `/private/tmp`, so all
~30 are `prunable`. Commits survived because branch refs live in the shared `.git`; only
**uncommitted** work was lost. The appointment-reminder task's two verified fixture edits,
uncommitted at its pause, are **unrecoverable** — do not reconstruct them from a handoff
description.

**Push gotcha worth remembering:** in zsh, `git push origin "refs/heads/$b:refs/heads/$b"` is
mangled — `:r` is parsed as a parameter modifier, producing `...branchefs/heads/...`. Use
`git push origin "$b"`. Also never report push success from a piped command: the pipe's exit
status is the last stage's, so `git push … | tail -1` always looks like it succeeded.

Still outstanding from the original sweep:
- **Orphaned, reachable from nothing:** detached HEAD `e7ae3fd2` in
  `~/.codex/worktrees/9013/Utah-Pros-App-Git` — 11 commits of Twilio inbound projection. No branch,
  no tag, no remote. Rescue with `git branch <name> e7ae3fd2`.
- **3 stashes**; `stash@{1}`/`stash@{2}` are invisible to `git rev-list --all` and live only in
  `.git/logs/refs/stash`.

Full detail + ordered recovery plan: `../HANDOFF-2026-07-31-mac-reconcile.md`.
Related: [[git-skip-worktree-hides-files]], [[rescue-branches-2026-08-01]].
