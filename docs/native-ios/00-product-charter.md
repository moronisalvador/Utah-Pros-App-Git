<!--
FILE: docs/native-ios/00-product-charter.md

WHAT THIS DOES (plain language):
  Defines why the native application exists, what it will and will not replace, and how success is
  measured before implementation starts.

DEPENDS ON:
  Internal: docs/native-ios/README.md, docs/architecture.md, docs/business-rules.md,
            docs/app-store-readiness-roadmap.md,
            docs/native-ios/03a-apple-field-pro-adaptation-matrix.md
  Data:     reads → owner direction and current repository evidence
            writes → documentation only

NOTES / GOTCHAS:
  - Planned capabilities are not commitments until their phase is approved.
  - The existing PWA/Capacitor app remains supported until a separately approved cutover.
-->

# Native iOS Product Charter

## Owner decision

Utah Pros will keep the current PWA/Capacitor application operational and build a separate,
full native iOS client in Swift/SwiftUI. The new client will reuse UPR's governed backend contracts;
it will not fork the business database or silently create a second set of business rules.

The native client may eventually replace Capacitor on iOS, but replacement occurs only after
measured parity, security, reliability, accessibility, device, TestFlight, and rollback gates. The
PWA continues to serve web users and may remain the appropriate client for desktop workflows.

On 2026-07-26 the owner also chose Apple Field Pro as the native product/experience blueprint. The
native client preserves its owner-locked layouts, workflow decisions, and refinements by default,
adapts them for field readability and easier tapping using current-PWA lessons, and implements them
through a newly validated native design system. Exact colors, typography, symbols, materials,
controls, and measurements remain owner/device decisions.

## Product promise

Create a fast, calm, field-reliable iPhone application that feels designed for iOS, gives a
technician an unambiguous next action, preserves work through poor connectivity and lifecycle
interruptions, and exposes sensitive company capabilities only through verified authorization
boundaries.

The target field context remains demanding: one-handed use, gloves, bright or wet environments,
time pressure, intermittent connectivity, frequent camera/document work, and users who should not
need to understand the underlying software architecture.

## Goals

- Native keyboard, focus, safe-area, navigation, sheet, gesture, animation, haptic, lifecycle, and
  accessibility behavior instead of web emulation inside a native shell.
- A coherent field-adapted SwiftUI evolution of Apple Field Pro rather than either a blank-slate
  redesign or a screen-by-screen CSS port.
- Explicit typed contracts for every RPC, table, Worker, Storage, Realtime, Auth, and provider seam.
- Field-safe offline and resume behavior with truthful sync state and recoverable drafts.
- Lower avoidable CPU/network/battery use through measured native patterns.
- A platform foundation for camera/media, documents and signing, location, richer notifications,
  background work where iOS permits it, and future Apple platform capabilities.
- Incremental value through complete vertical slices rather than a long invisible rewrite.
- Continued compatibility with the operational PWA/Capacitor clients during the transition.

## Candidate capability horizon

These capabilities belong in discovery and roadmap prioritization; listing them does not authorize
implementation:

- drying logs and psychrometric/moisture documentation;
- job documentation, forms, PDFs, uploads, and e-signature/DocuSign workflows;
- contextual location capture and owner-approved location-based assistance;
- richer actionable, categorized, deep-linked notifications;
- media capture, annotation, compression, upload, and recovery;
- background-safe draft/sync coordination within iOS execution limits;
- native extension and field adaptation of the Apple Field Pro information architecture and visual
  direction;
- Apple intelligence/AI frameworks only after the APIs are public, device/OS support is known, data
  handling is privacy-reviewed, graceful fallback exists, and product value is proven.

## Non-goals

- A blind pixel-for-pixel or route-for-route port of the React application.
- A blank-slate redesign that silently discards owner-locked Apple Field Pro refinements.
- Rewriting the Supabase database, Workers, integrations, or business rules as part of UI work.
- Introducing separate iOS-only truth for status, billing, consent, authorization, or workflow
  state.
- Using production data or provider effects to accelerate development.
- Shipping every desktop/admin surface in native v1 without an owner-approved use case.
- Depending on unreleased Apple capabilities for core workflows.
- Removing the current clients before a rollback-tested cutover.
- Calling a build, simulator run, or successful login “production ready.”

## Users and scope decision

The current evidence strongly supports a field-first application, but the owner must choose the
actual product boundary:

| Candidate | Default planning posture | Owner decision required |
|---|---|---|
| Technician field workflows | Primary native v1 focus | exact first workflows and parity floor |
| Supervisor/project-manager field workflows | Candidate after first vertical slice | roles, assignment model, and device use |
| Office/admin workflows | Keep web-first unless a native use case is proven | which actions, if any, justify iPhone UI |
| Customer/public experiences | Out of scope by default | separate product/security review |
| iPad | Adaptive later unless selected up front | supported form factors and multitasking |

## Success measures

Targets must be baselined and approved during Phase 0; unmeasured adjectives are not acceptance
criteria. At minimum, measure:

- task completion and error rate for representative field workflows;
- launch-to-useful-content and interaction responsiveness on the oldest supported device;
- crash-free sessions, hang rate, memory pressure, and network failure recovery;
- draft loss and duplicate-mutation rate, with a target of zero unexplained events;
- sync queue age, retry outcomes, and user-visible recovery;
- battery and thermal impact for location, camera, upload, Realtime, and background scenarios;
- Dynamic Type, VoiceOver, contrast, touch target, reduced motion, and keyboard coverage;
- denied-role and wrong-assignment behavior at client, Worker, and database boundaries;
- TestFlight feedback closure and release rollback readiness;
- PWA/Capacitor contract compatibility until cutover.

## Product constraints

- `dev` and production currently share one Supabase project. Application staging is not database
  isolation.
- The new client uses only the approved public client credential; the exact modern publishable-key
  and rotation contract is owned by `05-data-contracts-and-environments.md`. No service-role or
  provider secret belongs in the app.
- Server/database authorization remains authoritative; hiding SwiftUI controls is only presentation.
- iOS background execution, notification delivery, location, and external-provider SDK behavior are
  constrained by Apple and must be tested, not assumed.
- The current public App Store direction and existing bundle identity are inputs, but final native
  product naming, bundle/version migration, listing, and distribution require an explicit owner
  cutover decision.

## Governance

Every phase has one accountable orchestrator, bounded owners, exact paths, exit criteria, and an
evidence record. Product code, database, provider configuration, Apple configuration, deployment,
and publication are distinct authorization boundaries. Approval of this charter approves planning,
not any of those external effects.
