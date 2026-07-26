<!--
FILE: docs/native-ios/01-principles-and-definition-of-done.md

WHAT THIS DOES (plain language):
  Sets the non-negotiable engineering and experience principles for the native client and defines
  what done means at component, screen, workflow, beta, and release levels.

DEPENDS ON:
  Internal: docs/native-ios/00-product-charter.md, docs/testing-and-deployment.md,
            docs/auth-and-authorization.md,
            docs/native-ios/03a-apple-field-pro-adaptation-matrix.md,
            .claude/rules/tech-mobile-ux.md
  Data:     reads → project rules and approved evidence
            writes → documentation only

NOTES / GOTCHAS:
  - Passing a lower-level gate never implies a higher-level gate passed.
  - Simulator evidence does not replace real-device evidence.
-->

# Native iOS Principles and Definition of Done

## Non-negotiable principles

1. **One business system, multiple clients.** Swift, web, Workers, and SQL may present behavior
   differently, but status transitions, authorization, money, consent, and durable invariants have
   one documented authority.
2. **Server authorization is the boundary.** SwiftUI role checks improve usability; they do not
   authorize a Worker, RPC, table, Storage object, Realtime channel, or provider action.
3. **Contracts before callers.** A vertical slice cannot implement against an undocumented query,
   RPC, Worker, Storage, or Realtime shape. Compatibility and failure semantics are part of the
   contract.
4. **Isolated QA before write automation.** No automated native workflow writes to the shared
   Supabase project. Missing or ambiguous environment identity fails closed.
5. **Native, not web-shaped.** Use platform navigation, keyboard avoidance, focus, sheets,
   presentation, gestures, haptics, lifecycle, accessibility, and system controls unless a proven
   product reason requires a custom behavior. Native mechanics do not authorize silently erasing
   Apple Field Pro's approved hierarchy or workflow refinements.
6. **Field clarity over density.** One dominant action, large targets, visible state, plain language,
   and interruption-safe progress take priority over fitting more controls on screen.
7. **Offline behavior is explicit.** Every screen declares read cache, draft, mutation, retry,
   conflict, attachment, and sign-out behavior. “Offline capable” is never a blanket claim.
8. **Mutations are recoverable and idempotent.** Durable user intent, stable keys, bounded retry,
   cancellation semantics, and reconciliation are designed before enabling side effects.
9. **Privacy by minimization.** Collect, retain, transmit, log, cache, and expose only what the
   workflow requires. Sensitive local material receives an explicit protection and purge policy.
10. **Accessibility is architecture.** Dynamic Type, VoiceOver, contrast, reduce motion,
    Voice Control, touch targets, focus order, and error announcements are designed and tested from
    the foundation phase.
11. **Performance and battery are budgets.** Measure launch, responsiveness, memory, networking,
    media, location, Realtime, and background work on representative hardware.
12. **Observable without leaking.** Errors, sync, retries, denials, and release health are
    diagnosable using redacted structured telemetry with environment/build correlation.
13. **Backwards compatibility is a release gate.** The native client does not break deployed
    PWA/Capacitor callers. Contract evolution is additive or versioned until old clients retire.
14. **External state requires external evidence.** Repository declarations do not prove Supabase,
    Cloudflare, Apple, APNs, App Store Connect, DocuSign, or provider configuration.
15. **No silent owner decisions.** Product scope, visual direction, destructive behavior, privacy,
    retention, distribution, device support, and release risk are written decisions.

## Foundation definition of ready

No feature screen begins until its vertical-slice packet contains:

- owner-approved problem, user, outcome, and exclusions;
- approved navigation placement and representative design;
- completed Apple Field Pro Preserve/Translate/Adapt/Reopen/Verify record for each involved screen,
  with every departure justified;
- accessibility annotations and state matrix;
- source-of-truth and complete contract registry entries;
- server/database authorization and negative-role expectations;
- offline/cache/draft/mutation/idempotency/conflict strategy;
- privacy classification, local protection, logging, and retention behavior;
- telemetry, performance, and battery budgets;
- unit, contract, UI, accessibility, simulator, and device test plan;
- isolated environment, fixture lineage, cleanup, and provider-mode proof;
- rollout, compatibility, feature containment, and rollback plan;
- exact phase owner and file ownership.

## Definition of done by layer

### Design token or primitive

- Semantic purpose and supported states are documented.
- Light/dark/high-contrast behavior is intentional.
- All Dynamic Type accessibility sizes are verified without clipped meaning. Any safety-driven
  exception has an approved rationale and alternate large-content presentation.
- VoiceOver name/value/hint, focus behavior, and Voice Control discoverability are correct.
- Touch target, contrast, motion/reduced-motion, and keyboard/focus behavior meet the approved
  standard.
- SwiftUI previews cover representative content, localization length, error, and accessibility.
- Snapshot/reference evidence is reviewed on approved target sizes.
- The primitive is used by an approved workflow; speculative components do not count as progress.

### Screen

- The screen's Apple Field Pro source/maturity, current-PWA lesson, preserved anatomy/refinements,
  native mapping, field adaptation, and any approved departure are recorded.
- Loading, refreshing, content, empty, partial, stale, offline, permission-denied, authorization-
  denied, not-found, recoverable-error, and terminal-error states are handled where applicable.
- Navigation, deep link, back behavior, sheet dismissal, keyboard, rotation policy, safe areas,
  interruption, background/resume, memory pressure, and session expiry are verified.
- No sensitive action depends only on a hidden or disabled control.
- Data fields and mutations map to cataloged contracts and decoded fixtures.
- Accessibility and UI tests cover the screen's meaningful paths.
- No secrets, private payloads, signed URLs, or sensitive values appear in retained evidence.

### Vertical slice

- UI, state model, domain model, client, Worker/RPC/database boundary, cache, telemetry, tests, and
  documentation form one traceable workflow.
- Allowed and denied roles/assignments are tested at direct boundaries, not only through UI.
- Retries cannot duplicate durable or provider effects; partial failure has a reconciliation path.
- Offline/resume behavior is exercised with deterministic failure injection.
- PWA/Capacitor compatibility is checked for every shared contract changed.
- Representative simulator and real-device evidence is recorded.
- Owner acceptance uses the agreed task outcome, not visual impression alone.

### Internal beta

- Xcode build, archive, signing, entitlements, privacy manifest, dependency resolution, and release
  configuration are verified on the governed Mac.
- Automated lanes are green with zero unexpected skips; blocked external tests are named.
- Crash, hang, network, sync, and redacted diagnostic signals are visible for the exact build.
- Minimum supported device and OS, current device, and at least one real field device complete the
  approved matrix.
- Security/privacy threat model and data inventory are updated.
- TestFlight cohort, feedback intake, incident owner, feature containment, and rollback are ready.
- No production provider effect is used as a substitute for sandbox evidence.

### Production release

- All release-template evidence is complete and independently reviewed.
- Required backend contracts are deployed compatibly before the client that consumes them.
- Read-only live configuration evidence confirms the intended project, domains, provider mode,
  Apple identifiers, entitlements, APNs environment, privacy answers, and App Store metadata.
- Release candidate passes real-device field, accessibility, performance, battery, offline,
  lifecycle, upgrade, and account/session tests.
- Phased rollout, monitoring thresholds, stop conditions, rollback build, support response, and
  owner decision are recorded.
- The existing client remains available until the cutover gate explicitly retires it.
- Submission, release, and production changes are owner-controlled actions, never inferred from a
  green build.

## Evidence language

Use exactly these distinctions:

- **Verified:** directly observed with command/build/catalog/device/provider evidence and timestamp.
- **Source-confirmed:** present in the reviewed commit, not necessarily deployed or live.
- **Inferred:** reasoned from evidence but not directly observed.
- **Blocked:** the check could not run safely because an explicit dependency was absent.
- **Owner gate:** requires a product, legal, account, credential, device, signing, cost, or release
  decision.
- **Not tested:** applicable work omitted; it is not equivalent to blocked.

An optional runtime check may become blocked and the phase may continue when its risk is explicitly
carried to the correct later gate. No runtime command may run without a maximum five-minute attempt,
guaranteed cleanup, and termination of spawned child processes.
