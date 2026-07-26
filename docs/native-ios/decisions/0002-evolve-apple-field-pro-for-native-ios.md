<!--
FILE: docs/native-ios/decisions/0002-evolve-apple-field-pro-for-native-ios.md

WHAT THIS DOES (plain language):
  Records the owner-approved decision to evolve Apple Field Pro into the native iOS design rather
  than restarting visually or copying its web implementation literally.

DEPENDS ON:
  Internal: docs/native-ios/00-product-charter.md,
            docs/native-ios/03a-apple-field-pro-adaptation-matrix.md,
            docs/tech-redesign/TECH-DESIGN-STANDARD.md
  Data:     reads → owner decision in the 2026-07-26 planning conversation
            writes → documentation only

NOTES / GOTCHAS:
  - Accepted product/experience continuity does not authorize Swift implementation or release.
  - Locked Apple Field Pro outcomes are preserved; HTML/CSS/WebView mechanics are not native APIs.
  - This decision can be superseded only by a new decision record.
-->

# ADR 0002: Evolve Apple Field Pro for Native iOS

- **Status:** accepted by owner
- **Decision date:** 2026-07-26
- **Implementation status:** not started
- **Decision owner:** Moroni Salvador

## Context

Apple Field Pro contains substantial owner-directed design work: refined screen hierarchy,
field-status language, Schedule and Add Visit behavior, Job Hub structure, clock states, room-first
documentation, three note scopes, dedicated Documents and Notes pages, and the Dry Logs direction.
Some flows remain incomplete or were explicitly sent back for rework.

The operational PWA is easier for some technicians to read and use with gloves according to the
owner's report. At the same time, the PWA/Capacitor presentation retains WebView-specific keyboard,
safe-area, lifecycle, and interaction characteristics that the native project exists to remove.

A blank-slate native redesign would discard valuable owner decisions. A literal HTML/CSS port would
carry web implementation compromises into SwiftUI.

## Options considered

### Restart from a blank native direction

This maximizes visual freedom, but repeats product discovery and risks losing hours of validated
layout and workflow thinking.

### Copy Apple Field Pro as closely as possible

This preserves visible continuity, but confuses an HTML prototype with a native specification and
can preserve text, density, keyboard, safe-area, accessibility, motion, energy, or control behavior
that should change on iOS.

### Evolve Apple Field Pro using current-PWA field lessons

This retains the strongest owner decisions, uses the operational PWA as comparative field evidence,
and recomposes the implementation through native controls and device validation.

## Decision

Build the native product/experience as a field-adapted evolution of Apple Field Pro. This accepts
the layout/workflow/refinement blueprint, not a frozen native palette, font, symbol, material,
control, or measurement system.

- Preserve owner-locked information hierarchy, zone order, content priority, terminology, workflow
  choreography, and refinements by default.
- Translate navigation containers, sheets, pickers, keyboard/focus, safe areas, gestures, feedback,
  motion/haptics, symbols, typography implementation, lifecycle, and performance through native
  SwiftUI/UIKit behavior.
- Adapt target size, spacing, contrast, type, density, reach, disclosure, and feedback using
  current-PWA comparison, accessibility requirements, and representative field/device evidence.
- Reopen flows that are unfinished, superseded, unsafe, explicitly rework-requested, or dependent
  on an unverified backend/business contract.
- Require the screen-level record and deviation rule in
  `03a-apple-field-pro-adaptation-matrix.md` before first-slice implementation.
- Keep backend authorization, business rules, production state, signing, and release outside the
  authority of this design decision.

## Consequences

Positive:

- Existing owner work becomes durable input instead of informal inspiration.
- Native-first behavior no longer means visually starting over.
- Field usability is evaluated against the current operational experience rather than aesthetics
  alone.
- Unfinished Apple Field Pro areas remain honest discovery gates.

Costs and risks:

- Every first-slice screen needs provenance and preservation/adaptation analysis.
- Native prototypes must compare the same realistic task/content against both source experiences.
- Some familiar Apple Field Pro details may change when physical-device, technician,
  accessibility, security, or contract evidence proves a better solution.
- Exact typography, color, icon implementation, materials, tab structure, theme, device scope, and
  component values remain decisions even though product/experience continuity is accepted.

## Revisit conditions

Create a superseding decision record if:

- representative field evidence consistently rejects the adapted Apple Field Pro direction;
- a major change in user roles or product scope invalidates its information hierarchy;
- native-platform or accessibility constraints require a materially different product structure;
- the owner intentionally selects a new product/experience direction after reviewing equivalent working
  prototypes;
- the current PWA or backend workflow is replaced in a way that invalidates a preserved outcome.
