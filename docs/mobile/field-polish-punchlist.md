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

**Theme: trapped screens / navigation escape hatches (fix as one batch)**

- [ ] (P2) Document signing screen — no back/cancel control; the tech is stuck on the
      screen until someone signs. Expected: an always-visible way out that safely
      abandons the signing attempt. (Found 2026-07-29, TestFlight 1.0.0 (1).)
- [ ] (P2) Legal & Support pages — the three screens (Privacy / Terms / Support) have no
      top-left back button; once opened, the user is stuck. Expected: standard back
      affordance on all three. (Found 2026-07-29.)
- [ ] (P2) Job screen back button — always navigates to the claim page regardless of
      where the user came from. Expected: origin-aware back (history back with claim
      page as fallback only). (Found 2026-07-29.)

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

*(move items here with completion date + commit)*
