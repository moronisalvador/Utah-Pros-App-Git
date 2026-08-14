---
branch: claude/eager-kalam-21b7ee
ships: true
opened: 2026-08-14
---

# What

Desktop `Conversations.jsx` resume fix: an expired 30s access lease now HIDES and
re-proves instead of running the denial path. PR #648 into `dev`.

# Why it matters

Hiding the browser tab for 30+ seconds erased the half-typed reply for every
conversation and dumped the user out of the open thread — the office inbox is a
screen staff keep open all day. Denial (successful refresh omitting the row,
401/403, explicit leave) still destroys, unchanged. Twin of the tech-pane fix
`f6ca49e4` (PR #644), which landed in `dev` mid-session; both panes now agree.

# Next action

Owner merges PR #648 (CI green, MERGEABLE). Then run the live minimize test on
`dev.utahpros.app` while signed in — type a reply, switch tabs ~40s, come back —
because the contract tests pin intent, not effect. Three follow-up chips were
filed for pre-existing `Conversations.jsx` debt the gauntlet surfaced (keyboard/AT
access, note-yellow tokens, and the owner call on whether re-proof may keep stale
threads on screen).
