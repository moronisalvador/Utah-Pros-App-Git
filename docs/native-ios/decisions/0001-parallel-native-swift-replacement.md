<!--
FILE: docs/native-ios/decisions/0001-parallel-native-swift-replacement.md

WHAT THIS DOES (plain language):
  Records the owner-approved decision to build a new native Swift client in parallel rather than
  incrementally replacing Capacitor screens inside the current application.

DEPENDS ON:
  Internal: docs/native-ios/00-product-charter.md, docs/architecture.md
  Data:     reads → owner decision in the 2026-07-25 planning conversation
            writes → documentation only

NOTES / GOTCHAS:
  - Accepted architecture direction does not authorize implementation or release.
  - This decision can be superseded only by a new decision record.
-->

# ADR 0001: Build a Parallel Native Swift Client

- **Status:** accepted by owner
- **Decision date:** 2026-07-25
- **Implementation status:** not started
- **Decision owner:** Moroni Salvador

## Context

The PWA works well and the Capacitor application is operationally useful, but several interactions
retain web/WKWebView characteristics. Keyboard geometry, composition fields, lifecycle behavior,
safe areas, gestures, and other native presentation details can feel inconsistent even when the
same workflows work well as a PWA.

Utah Pros also expects deeper field capabilities: drying logs, job documentation, e-signature,
location, notifications, media, a new interface, and future Apple platform integrations. The owner
wants a long-lived, native-feeling iOS product while avoiding disruption to the current working
client.

## Options considered

### Continue Capacitor only

Lowest short-term cost and maximum code reuse, but it preserves WKWebView-specific UI/lifecycle
constraints and makes the desired native product direction harder to reach.

### Replace selected Capacitor screens gradually inside one hybrid application

Delivers native value sooner and limits rewrite risk, but creates a prolonged navigation, state,
design, build, and ownership boundary between Swift and React. The owner decided not to use this as
the primary migration model.

### Build a separate native client in parallel

Allows coherent SwiftUI architecture and native interaction design while the current client remains
available. It costs more and creates dual-client contract compatibility obligations, but it best
matches the desired long-term product.

## Decision

Build a separate Swift/SwiftUI iOS application in parallel with the PWA/Capacitor clients.

- Reuse the governed Supabase/Worker backend contracts; do not create an ungoverned second backend.
- Begin with owner discovery, architecture, design foundations, contract safety, and isolated QA.
- Deliver complete vertical slices so the owner can evaluate real product value early.
- Keep the existing Capacitor application operational and releasable during construction.
- Do not place new major iOS-only product work into Capacitor by default; exceptions require a
  conscious urgency/maintenance decision.
- Decide the nonproduction development/QA identity before scaffolding. Decide the production
  bundle/listing migration before creating a production target or external TestFlight; decide
  Capacitor retirement only after cutover/adoption evidence.

## Consequences

Positive:

- SwiftUI navigation, presentation, keyboard, focus, accessibility, lifecycle, and system
  capabilities can be designed as native behavior.
- The new interface can be coherent rather than constrained by incremental hybrid seams.
- The current application provides business continuity and a behavioral reference.

Costs and risks:

- Shared backend contracts must support multiple deployed client versions.
- Some presentation code is intentionally rewritten.
- Feature parity, rollout, analytics, support, and regression scope span two iOS clients during the
  transition.
- A full rewrite can hide risk for too long unless vertical slices, owner reviews, and measurable
  gates remain mandatory.
- App Store identity, installed-app upgrade behavior, authentication persistence, deep links, push
  tokens, and stored local data need an explicit cutover design.

## Revisit conditions

Create a superseding decision record if:

- the backend cannot safely support dual clients without a different API boundary;
- validated product scope favors a much smaller native companion rather than a replacement;
- schedule or funding no longer supports the quality gates;
- Apple platform or distribution constraints materially change;
- the owner chooses an incremental hybrid migration after evaluating the first native slice.
