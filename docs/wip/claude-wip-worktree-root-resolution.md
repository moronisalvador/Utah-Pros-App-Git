---
branch: claude/wip-worktree-root-resolution
ships: true
opened: 2026-08-09
---

# What

Make the `docs/wip/` register resolve to the current worktree instead of the main
checkout, and stop the "What" field defaulting to another session's merge commit.

# Why it matters

worktree-lifecycle.md §3 requires registering ship-bound work at the START, and most
sessions run in worktrees — so writing the entry into a tree the session cannot commit
from silently defeated the rule in the common case, and `wip:close` dirtied the owner's
main checkout on the way out.

# Next action

Fix wip root resolution; PR into dev
