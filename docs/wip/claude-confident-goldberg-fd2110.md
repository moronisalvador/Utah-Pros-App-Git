---
branch: claude/confident-goldberg-fd2110
ships: true
opened: 2026-08-14
---

# What

PR #660 — the visible half of the tech-messages resume defect. #645 stopped a 30s
access-lease expiry destroying the draft; the thread still unmounted onto the
conversation list on every resume past 30s and cold-loaded back (TabLoading flash,
scroll thrown to newest). Expiry now holds protected content for one bounded
re-prove grace, and the list/thread swap is gated on `reproving` rather than on
`hasActiveAccessLease`.

# Why it matters

A tech who checks the calculator for half a minute loses their place in a customer
thread — the mandatory minimize test (`page-lifecycle.md` §2/§5). The change also
moves a security line, so it is deliberately its own reviewed PR: the eager purge
at expiry was what guaranteed no server-sourced message content survived a lost
lease. It is now a bounded 5s wall-clock grace, with every denial door proven to
purge immediately.

# Next action

OWNER DECISION, then merge sequencing. PR #658 landed a `page-lifecycle.md` owner
ruling — "keep hiding the protected server content … do not render stale message
bodies … that option was offered and declined" — scoped to BOTH panes. #660 does
render stale bodies during the re-proof window. #658's own rationale distinguishes
the two surfaces (the tech pane's `get_tech_conversations` RPC IS server-scoped;
desktop's raw table select is not, pending `20260731213100`), so the text and the
rationale disagree. Three options are written out in #660's body. Reported to the
coordinating session (`elated-bohr-7c146c`), which owns merge sequencing.

Also open: two close-out reviewers were still running at handoff; on-device resume
is owner-gated (needs an authenticated session); and whichever of #658/#660 lands
second needs a small reconcile on `UPR-Web-Context.md` and
`tests/qa/unit/conversation-access-lease.test.js`.
