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
`f6ca49e4` (PR **#645**, merge `5e2dcea0`), which landed in `dev` mid-session;
both panes now agree and share the name `recordConversationAccessExpired`.

# Next action

Release-lane session owns merge sequencing (it is also holding #647, which edits
the same test file). #648 is reconciled onto dev `c8688002`, CI green, MERGEABLE
— reply posted as a PR comment. If #647 merges first, reconcile onto it: the
shared-test changes are additive (one new describe block + a rename to
`recordConversationAccessExpired`).

Still open after merge: the live minimize test on `dev.utahpros.app` while signed
in — type a reply, switch tabs ~40s, come back. The executed tests cover the
sweep policy; the page's own effects are still only pinned as source text.
