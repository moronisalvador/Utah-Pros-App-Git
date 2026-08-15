---
branch: claude/vigilant-davinci-b57964
ships: true
opened: 2026-08-14
---

# What

Accessibility repair on `src/pages/Conversations.jsx` (office/tech/CRM messages
screen) — the pre-existing debt `interface-accessibility-reviewer` flagged twice
during the PR #648 close-out gauntlets. PR
[#656](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/656) into `dev`.

# Why it matters

The conversation-list row was a plain `<div>` with only `onClick`, so no keyboard
or switch-access user could open **any** conversation, and the context menu had no
keyboard dismissal at all. Two of the six reported items turned out to be already
fixed on `dev` by `9b076681`; the rest are done and pinned by
`tests/qa/unit/conversation-accessibility-contract.test.js` (8 of 9 cases verified
to fail against the pre-change file).

# Next action

Owner reviews and merges PR #656. Two things carried forward:

1. **Unrun, owner-gated:** the minimize/resume test and the 390px viewport pass on
   this page. The local dev login is `field_tech`, so `/conversations` redirects to
   the tech shell and `/crm/conversations` is behind `page:crm` — the office inbox
   needs an office/admin/PM session an agent must not create. After deploy: Tab into
   the list, Enter to open, Escape out of the ⋯ menu.
2. **Known follow-up, not done here:** `role="button"` on the row contains the More
   button, which is `nested-interactive` under strict ARIA (moot on desktop where
   that button is `display:none`; real on mobile). The clean fix is to lift the
   button out of the row or promote the list to `grid`/`row`/`gridcell` — a
   structural change to a live shared surface, deliberately out of scope for an
   accessibility-only diff.
