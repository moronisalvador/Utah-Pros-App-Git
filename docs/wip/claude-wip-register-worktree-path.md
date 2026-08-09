---
branch: claude/wip-register-worktree-path
ships: true
opened: 2026-08-09
---

# What

wip register: read across worktrees, not just one

# Why it matters

PR #614 made writes branch-scoped but left the read single-directory, hiding 5 of 6 STALLED alarms from the main checkout where the SessionStart hook runs

# Next action

Open PR into dev; notify the MERGER release lane
