---
name: job-hub-wave2-spec
description: "The owner-approved Job Hub layout for wave 2 — settled screen-by-screen on 2026-08-07; the published artifact is the spec, and these are the rulings behind it"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-08T04:57:34.278Z
---

**Wave 2 target, owner-approved 2026-08-07 ("Perfect, nailed it").** The spec is the published
artifact: `https://claude.ai/code/artifact/4096ec76-2584-494d-b142-e061e159a982` (source lives in
that session's scratchpad as `job-hub-preview.html`). Read the artifact first; these are the
*reasons*, which the pixels do not carry.

**The reversal that set the direction:** the owner first chose "app's current language" over Field
Pro shapes, then — after using shipped wave 1 on a real phone — reversed: *"this job hub ended up
messy and not intuitive, I prefer the one on the side panel."* Diagnosis that mattered: wave 1 put
a **new head on the old body** (new hero + tiles, but the entire legacy below-fold left intact), so
one screen carried two designs. Wave 2 replaces the below-fold too. Framing: *"marry the apple
field pro with the current page and make a baby."*

## Screen order (appointment mode)

```
blue division-gradient hero   back · help · status pill
                              title · "W-2608-004 · Gary Sorensen"
                              tappable address (pin + chevron, 48px)
                              [ Customer › ]  [ Claim › ]
🔴 No signed Work Authorization      ← BOTH modes, first in scroller
Message · Docs · Notes · More
WORKING · Today 9:00 – 11:30 AM                      ✎ Edit
   ON MY WAY   ·   STARTED   ·   FINISH
    9:12 AM        9:30 AM       Tap to finish
   Travel 18m    On job 2h 8m
crew / assigned techs
office note  ← its own card, under the crew
Dry Logs · Tasks · Rooms · Visits · Activity
```

## Rulings (do not re-litigate)

- **No ticking clock.** Owner: *"that's scary… no need for a big clock scaring the technicians
  about time ticking."* Durations sit under each station, labeled (`Travel 18m` / `On job 2h 8m`),
  minutes until 60 then `2h 8m` — which is exactly what `fmtMinutes` in `HubStage.jsx` already
  does. Housecall Pro independently does the same; that screenshot is the reference.
- **The three circles ARE the control** — the live `TimeTracker` `Station()` model verbatim:
  active = accent circle/white icon/accent label, **armed = red** (that red first-tap IS the
  confirm, so dropping the black two-tap pill loses no safeguard), done = grey circle with a
  *secondary* label, pending = grey with a *tertiary* label. No green checkmarks. Truck / play /
  stop glyphs. No separate Finish pill, no standalone Pause.
- **Bar = Message · Docs · Notes · More.** **Call removed** — there is no dialer in the app and
  won't be for a while (I argued to keep it; the owner was right). **Photo removed** — capture
  happens inside rooms, notes and daily logs. Navigate removed because the hero address row is the
  navigate affordance (§12.5 says so too). Edit removed because it lives on the status line.
- **Docs = nouns, More = verbs.** More holds on-site field tools: Scope sheet, Take a reading,
  Daily log. Every customer-facing document is generated from the **Docs page's `+` FAB** (Encircle
  pattern, already spec'd in §12.5.3): Work Auth, Cert. of Completion, Cert. of Satisfaction, Auth
  to Pay Direct, Mold Consent, Non-Restorable Release. **Work authorization is NOT in More** —
  splitting it from its five siblings would teach two mental models for one task.
- **Work-auth alert renders in BOTH hero modes**, first in the scroller, while
  `work_auth_signed === false`. Tapping carries `state: { startEsign: 'work_auth' }` to pre-select
  it. **Already correct in shipped wave 1** — only the artifact had misrepresented it as job-mode-only.
- **Office note is its own card under the crew** (final position; it was tried above the clock
  first).

## Build dependencies — none of these exist yet

Customer page · Docs page + its `+` FAB · Notes page · daily logs. See
[[job-hub-redesign-starting-point]] for wave 1 state and the two traps (the `?appt=` sync, the
native allowlist), and [[field-pro-is-the-native-rewrite-target]] for why this is deliberately a
band-aid.

## Verified against the running app 2026-08-08 (screenshot, sim, job mode)

Corrects an earlier claim here that "job mode still wears the old compact header" — **it does
not.** `HubHeader` is shared, so job mode already renders the blue division-gradient hero. What
wave 2 actually still has to change, measured off the live screen:

1. Hero has only `[Claim ›]` — needs `[Customer ›]` beside it, and the pin icon currently sits on
   the Claim pill instead of on a tappable 48px address row.
2. Action bar is `Call · Message · Docs · Notes` — Call goes, More arrives.
3. The below-fold is still legacy (`TOOLS` list + the `Photo · Call · Navigate · Message · More`
   dock). This is the "new head on the old body" the owner reacted to; replacing it is the
   substance of wave 2.

See [[job-hub-stale-sim-bundle-trap]] — the reason wave 1 looked unshipped for a day.
