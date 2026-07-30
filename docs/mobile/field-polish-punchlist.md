# Field polish punch list — TestFlight-era small findings

**Started:** 2026-07-29 (first TestFlight build night) · **Owner:** Moroni
**What this is:** a running list of small on-device findings from real field/tech use of the
native app and PWA. One line each. Not for bugs that block work (report those immediately) —
for polish: haptics, spacing, copy, motion, small UX friction.

**How to use with Claude Code:** start a session per THEME (e.g. "haptics pass"), point it at
this file, let it fix the batch, verify per `.claude/rules/tech-mobile-ux.md` +
`motion-standard.md` (haptics/motion changes go through the `review-animations` gate), mark
items done in place with the date. Native-feel items (haptics, gestures) are only fully
verifiable in the next native build — group them accordingly.

**Format:** `- [ ] (severity) surface — what's wrong → expected` · severity: P2 = annoying, P3 = polish

## Open

**Theme: haptics consistency**

- [ ] (P3) Tech nav bar — tab presses have no haptic feedback, while the notification bell
      and the header trio by the technician's name feel great. Expected: primary nav taps
      match the dashboard header buttons' haptic (via src/lib/nativeHaptics.js, per
      motion-standard.md §4). (Found 2026-07-29, TestFlight 1.0.0 (1), iPhone 17 Pro Max.)

**Theme: notifications surface (feature-sized — may fold into the onboarding session)**

- [ ] (P3) Settings → Notifications — tapping the section should open a dedicated
      notifications page: activate/deactivate push plus per-type customization (the
      per-type self-recipient config that already exists server-side). (Owner request
      2026-07-29.)

## Done

**Theme: trapped screens / navigation escape hatches (fixed as one batch, 2026-07-29)**

- [x] (P2) Document signing screen — fixed 2026-07-29, commit acd7927e. The trapped
      surface is SignPage (`/sign/:token`), reached in-app by the tech "Collect
      signature on-site" flow; it now renders an escape hatch on every state when
      in-app history exists (header Back, Back bar on error/expired/signed cards,
      Done on the completion card). Abandon is safe — nothing is written before the
      atomic submit. The public customer link intentionally stays unchanged (no
      in-app history → no controls).
- [x] (P2) Legal & Support pages — fixed 2026-07-29, commit acd7927e. Standard chevron
      Back on all three (Legal.jsx LegalLayout): always visible in the tech shell at
      /tech/legal/* (fallback /tech/settings), history-gated on the public copies so
      the pre-login Login-footer path works and a cold direct visitor keeps the plain
      document. Cross-links now stay inside /tech/legal/* in the tech shell.
- [x] (P2) Job screen back button — fixed 2026-07-29, commit a7f27445. Origin-aware via
      new src/lib/backNav.js (React Router history idx): pops to the real origin
      (dashboard / schedule / claim / messages / push deep link); claim page only as
      the no-history fallback, '/tech' when the job has no claim. Applied to
      TechJobDetail + v2 TechJobHub/HubHeader (incl. not-found screens) and the
      Album/Documents "Back to job" buttons (pop, no duplicate history entries).
      Hub back control also brought up to the 44px tap floor + press feedback.
