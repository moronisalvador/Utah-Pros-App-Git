---
branch: claude/hopeful-kepler-3abd83
ships: true
opened: 2026-08-14
---

# What

fix(a11y): move New Conversation dialog onto the shared Modal

# Why it matters

The New Conversation dialog on the office Conversations page had no
`role="dialog"`, no `aria-modal`, no focus trap and no Escape handler — a
keyboard or screen-reader user could tab straight out of it into the page
behind. Flagged by the 2026-08-14 close-out gauntlet. Seven other components
still hand-roll the same `.conv-modal*` markup and still carry the gap; this
PR is the worked reference for migrating them (spawned as a separate task).

Two traps recorded here because they will recur on those seven: the shared
Modal focuses its own ✕ from a `useEffect`, so a plain `autoFocus` on a search
field silently loses the caret; and `.ui-modal-body` already scrolls, so a
list nested inside it becomes a scroller-in-a-scroller.

# Next action

PR https://github.com/moronisalvador/Utah-Pros-App-Git/pull/646 is open into
`dev` with both reviewers passing. The merge click is the owner's. Once it
lands in `dev`, close this entry (`npm run wip:close -- claude-hopeful-kepler-3abd83`)
and remove the worktree + local branch (`npm run worktrees:clean`).

Not verified end to end in a browser: the dialog lives on the office
Conversations page, and reaching it needs an office-role login or a
shared-database feature-flag flip — both owner-gated. CSS composition was
verified live; component wiring is covered by tests.
