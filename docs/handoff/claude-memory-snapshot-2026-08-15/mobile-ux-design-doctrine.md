---
name: mobile-ux-design-doctrine
description: "Owner's standing UX direction — POS-style wizards via the impeccable skill for mobile flows, never desktop forms on phones"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-06T19:03:12.172Z
---

Owner-directed 2026-08-06, after rejecting a desktop-form port on the phone
("trying to enter a payment very quickly in a car… this is awful") and then
approving its wizard replacement ("Awesome. Finally, I like this a lot better.
We should always use this skill to design interactive, easy, animated UI and
UX. I wish our entire software was like this.").

**Why:** the mobile usage scene is one-handed, hurried, in a truck or on a
site. Multi-field forms fail there; one-decision-per-screen flows succeed.

**How to apply:**
- For any new or reworked MOBILE surface, load the `impeccable` skill and
  design a step flow, not a form: one decision per screen, giant tap rows
  (56px), a sticky hero total/outcome, drawn SVG icons, smart defaults behind
  a "More options" fold, WAAPI slide transitions (reduced-motion instant),
  and the two-tap money gate where money moves.
- Steal from real-world references, not accounting software: Square POS
  collect-payment is the canonical pattern (App Store listing screenshots are
  a fast public source). QBO-style forms are for DESKTOP only.
- The reference implementation is
  `src/components/collections/ReceivePaymentMobileFlow.jsx` (wizard) beside
  `ReceivePaymentForm.jsx` (desktop) — one page, two renderers, switched on
  `IS_NATIVE_BUILD || matchMedia('(max-width: 768px)')`.
- Layout trap learned the hard way: `position: sticky` bottom bars float
  mid-list inside the tech shell's scroll context. Pin bottom bars with
  `position: fixed; bottom: calc(var(--tech-nav-height, 0px) +
  env(safe-area-inset-bottom, 0px))` (the Dash FAB precedent) and pad the
  scroll body (~180px) so the tail clears.
- The owner keeps a logged-in session on the iOS Simulator so agents can
  drive/verify native UI end to end — see [[direct-iphone-install-workflow]].
