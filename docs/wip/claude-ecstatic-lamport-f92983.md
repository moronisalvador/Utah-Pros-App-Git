---
branch: claude/ecstatic-lamport-f92983
ships: true
opened: 2026-08-14
---

# What

Seven hand-rolled office dialogs (NewInvoice, AddRelatedJob, SendEsign, AddContact,
NewEstimate, EditContact, CreateJob) moved onto the shared `<Modal>`, plus two
owner-approved additions to that primitive: `initialFocusRef` and a nesting-aware
Escape/Tab stack. PR #650 into `dev`.

# Why it matters

Every one of those dialogs shipped with no `role="dialog"`, no `aria-modal`, no
accessible name, no focus trap, no Escape handler and no body scroll-lock — so
keyboard and screen-reader users could not use them and could tab into the page
behind them. The nesting fix matters on its own: New Job opens New Contact on top
of itself, and one Escape used to close both, discarding a half-filled job form.

# Next action

PR [#650](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/650) is open and
green; merging into `dev` is the owner's call. Nothing else is blocked on this.

Deliberately NOT done, for whoever picks it up:
- `src/lib/useDialogLifecycle.js` (the tech-sheet half of the same contract) still
  has the nested-Escape bug this fixed in Modal, and `dialog-lifecycle.test.js` has
  a case *named* for that guarantee which only asserts `stopPropagation` — it would
  pass either way. Five tech sheets, separate scope.
- `react/jsx-no-undef` is not enabled (eslint-plugin-react is not installed), so an
  undefined JSX component builds clean and passes every test. That bit this branch
  once. A scoped guard now covers these eight files only.
- Dialogs opened from the "+ New" menu return focus to `document.body` on close.
  `Modal` supports `returnFocusTo`; wiring it means touching call sites in
  Layout.jsx / JobPage.jsx / ClaimPage.jsx / CustomerPage.jsx / Collections.jsx.
- `CreateJobModal`'s local `DIVISIONS` palette hardcodes six hex values that differ
  from the canonical `DIVISION_COLORS`, so divisions render different colours there
  than everywhere else. Pre-existing; fixing it changes brand colours on a live screen.
