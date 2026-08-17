---
name: field-pro-is-the-native-rewrite-target
description: "Owner's strategic ruling: Field Pro is the design for a FUTURE all-native-Swift rewrite of the whole app — today's web work copies its content into UPR's existing design, deliberately"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-07T14:59:35.502Z
---

**Owner-directed, 2026-08-07, in conversation. Do not relitigate.**

> "We will eventually go all in on the Field Pro, just as we designed, because it's really good. But for now I want everything that we put in the job hub in the Field Pro, I want it in the UPR, following the current UPR design — because it would be very weird to have one screen in the app that doesn't look like the entire rest of the app. So it's a band-aid for now… But in the future we will move the entire software to Field Pro. **And I want to do that all native Swift code. That's why we're not doing it now.**"

Two things this settles:

1. **`docs/tech-redesign/` is not a web design system.** It is the design spec for a future **native Swift rewrite of the entire app**. Read it for *content, structure and interaction* — never import its token scale, type ramp, or palette into `src/`.
2. **Today's Job Hub work is deliberately a band-aid**, and that is the correct outcome, not a compromise to apologize for. The reason is **visual consistency with the surrounding app**, not aesthetics: one screen in a different design language reads to a user as a bug. Ship Field Pro's *content* (adaptive hero, clock card, Dry Logs, Rooms grid, Activity, Notes/Docs pages, top action bar) rendered in `UPR-Design-System.md` tokens.

This supersedes the narrower "Field Pro layout, current tokens" phrasing in [[job-hub-redesign-starting-point]] — same instruction, but now with the *why* and the long-term destination attached.

Practical consequences:
- Don't propose adopting Field Pro's palette/type for any web surface; the answer is already no.
- The eventual native move is a much larger program than the plugin-by-plugin work in
  [[swift-native-plugin-pattern]] — but that pattern is the on-ramp, and every plugin shipped
  (photo viewer, share sheet, doc preview) is a piece of the native surface area that rewrite
  will need anyway.
- Reference render of the decision: the published preview artifact shows the same Job Hub screen
  under both palettes, UPR as the default.
