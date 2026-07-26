<!--
FILE: docs/native-ios/technical-architecture.md

WHAT THIS DOES (plain language):
  Defines the proposed technical shape of the Swift application and the architecture decisions that
  must be approved before an Xcode project or feature modules are created.

DEPENDS ON:
  Internal: docs/native-ios/00-product-charter.md, docs/native-ios/05-data-contracts-and-environments.md,
            docs/architecture.md, docs/auth-and-authorization.md
  Data:     reads → current backend/client boundaries and owner-approved decision records
            writes → documentation only

NOTES / GOTCHAS:
  - Proposed defaults are not implemented facts.
  - SDK/framework types must not become UPR domain or feature-layer contracts.
-->

# Native iOS Technical Architecture Blueprint

## Status and intent

This document defines a decision framework and a conservative proposed baseline. The Mac
architecture checkpoint must confirm or replace each proposed choice in an ADR before scaffolding.
The goal is a modular, testable native client—not a framework showcase and not a second backend.

## Decisions required before project creation

Record separate decisions for:

1. same repository versus a dedicated native repository;
2. nonproduction development/QA bundle and team identity before scaffolding; production bundle,
   App Store listing relationship, versioning and cutover in a later ADR before a production target
   or external TestFlight;
3. supported iPhone/iPad devices, minimum iOS, Xcode and Swift toolchain policy;
4. SwiftUI/UIKit boundary and minimum accessibility/platform behavior;
5. module/package structure and dependency direction;
6. state-management and observation model;
7. navigation and deep-link ownership;
8. networking/Supabase SDK boundary and generated contract strategy;
9. local persistence, encryption/file protection, migration, and purge strategy;
10. offline operation queue, idempotency, and conflict approach;
11. authentication/session/Keychain and account-switch behavior;
12. dependency admission, pinning, license, security, and privacy-manifest policy;
13. build configurations, environment identity, secrets, and feature containment;
14. telemetry/crash/performance tooling and privacy/retention;
15. test targets, fixtures, simulator/device matrix, CI, signing, and release ownership.

If a choice is not needed for the first vertical slice, mark it deferred with an owner and trigger.
Do not silently encode it in project settings.

## Proposed baseline

Subject to the ADR checkpoint:

- Swift and SwiftUI are the primary language/UI framework.
- Use structured concurrency (`async`/`await`, task groups, actors where ownership requires them)
  and avoid unstructured global tasks.
- Prefer Apple frameworks and `URLSession`; admit third-party packages only when their maintenance,
  security, privacy, size, testability, and product value justify lifecycle ownership.
- A Supabase Swift SDK may implement transport/Auth/Storage/Realtime behind UPR-owned interfaces.
  SDK response or error types do not cross into domain/features.
- Start as a modular monolith with strict dependency direction. Split deployable systems or many
  packages only when measured build/team boundaries require them.
- Use protocol seams at external/time/system boundaries, not protocols around every value type.
- Keep feature state explicit and testable. Global singletons are not an application architecture.
- Make configuration typed, immutable after startup, environment-identified, and fail-closed.
- Make every side-effect path injectable so tests can prove provider/network calls stayed at zero.

## Proposed module map

Names are illustrative until the project/repository ADR is accepted:

| Module | Owns | Must not own |
|---|---|---|
| `UPRApp` | app lifecycle, composition root, scene handling, root navigation | business rules, raw queries |
| `UPRDesignSystem` | tokens, primitives, accessibility behavior, previews | domain data access |
| `UPRDomain` | value types, client state orchestration, input ergonomics, capabilities, use-case interfaces | authoritative server/database invariants, SwiftUI, SDK types, secrets |
| `UPRContracts` | versioned wire DTOs, decoding fixtures, mapping contracts | screen state or business authorization assumptions |
| `UPRData` | Auth/PostgREST/RPC/Worker/Storage/Realtime adapters, repositories | direct view dependencies |
| `UPRPersistence` | protected drafts, cache, operation journal, schema migration | provider/server authority |
| `UPRPlatform` | camera, location, notifications, documents, haptics, background adapters | feature business rules |
| `UPRObservability` | redacted events, metrics, crash/performance adapters | raw sensitive payloads |
| `Feature*` | feature UI, state, use-case composition, navigation destinations | raw Supabase/URLSession/SDK access |
| test/support targets | fixtures, clocks, IDs, transports, stores, permission/device fakes | production credentials/data |

Dependency direction:

```text
UPRApp -> Feature* -> UPRDomain
                  -> UPRDesignSystem
                  -> use-case/repository interfaces

UPRData ---------> UPRContracts + UPRDomain
UPRPersistence --> UPRDomain
UPRPlatform -----> UPRDomain interfaces
UPRObservability -> redacted domain events

Composition root connects implementations. Domain never imports UI, transport, SDK, or platform.
```

Feature modules may share domain/use-case interfaces and design primitives. They do not import one
another's internal views or reach through a repository to its transport.

Client-side validation may improve input and offline feedback, but every mirrored business rule must
name its authoritative server/database source, compatibility contract, and drift test. Swift domain
code never becomes a second authority for status transitions, authorization, money, consent,
signing, or durable invariants.

## State and use-case flow

Use one visible ownership chain per screen:

```text
SwiftUI event
  -> feature state/action
  -> domain use case
  -> repository/platform interface
  -> transport/cache/operation journal
  -> typed result/domain event
  -> feature state
  -> rendered accessibility state
```

Each asynchronous operation has an owner, cancellation rule, stale-result rule, and retry policy.
View disappearance does not automatically cancel durable user intent; it should cancel disposable
display loads. Long-lived subscriptions and tasks belong to a lifecycle-scoped owner and terminate
on sign-out/environment change.

Do not make every feature depend on a generic global “app state.” Share only authenticated identity,
capabilities, environment, navigation coordination, sync status, and other genuinely application-
wide state through explicit scoped dependencies.

## Navigation

- Use one typed destination model for tabs, stacks, sheets, full-screen covers, notification actions,
  universal links, and restored state.
- Parse external links into validated intents, then authorize and resolve data before navigation.
- Never encode secrets or durable bearer capability tokens into analytics or retained link logs.
- Define behavior for expired sessions, missing/unauthorized/deleted records, interrupted modal
  flows, notification cold launch, and back navigation.
- Preserve the user's draft and meaningful place through expected background/resume events.
- UI tests own a versioned deep-link catalog so every supported route has success and denial proof.

## Data and contract boundary

- Features consume domain repositories/use cases, not Supabase directly.
- Wire DTOs represent exact versioned server shapes and decode against committed sanitized fixtures.
- Mapping from optional/legacy server fields to domain meaning is explicit and tested.
- RPC/table/Worker names, roles, assignment rules, RLS/Storage/Realtime boundary, pagination,
  ordering, time zone, nullability, errors, idempotency, and compatibility live in the contract
  registry.
- Generated types accelerate work but never prove live grants, policies, function bodies, triggers,
  or deployed Workers.
- Prefer a Worker for provider/secret operations and a purpose-built RPC for trusted multi-row
  invariants. Do not work around server design with a privileged client.
- Backend changes ship compatibly before the native binary that needs them and preserve existing
  callers until their retirement window closes.

## Authentication and authorization

- Supabase Auth session material is stored through an reviewed Keychain/session adapter, not
  scattered through preferences.
- At startup, restore/refresh session, resolve the active employee/capabilities, and handle absent,
  inactive, revoked, or partially provisioned identities explicitly.
- Sign-out/account switch cancels tasks/subscriptions, clears or quarantines user-scoped caches and
  drafts per retention policy, removes sensitive temporary files, and resets navigation.
- Client capabilities determine presentation only. Every Worker/RPC/table/Storage/Realtime access
  remains independently authorized.
- No owner/service-role/provider credential is embedded in the app, tests, previews, logs, or
  diagnostic bundles.

## Configuration and environments

Proposed configurations:

- `DebugLocal`: governed local/mock services only;
- `DebugQA`: dedicated hosted QA services with synthetic identities/data;
- `ReleaseBeta`: production-shaped release build using explicitly approved beta services/mode;
- `Release`: production.

Final names and topology require an ADR. Regardless of names:

- bundle ID, display name, icons, URL schemes, associated domains, APNs environment, analytics,
  Supabase project, Worker origin, and provider mode must be coherent and visible in a safe runtime
  diagnostics screen;
- builds fail when required configuration is absent or an environment/project combination is
  forbidden;
- no fallback from local/QA to production exists;
- public client configuration can be compiled in, while signing/provider/service credentials remain
  external;
- logs and screenshots may show environment labels, never credential values.

## Persistence and offline boundary

Choose the persistence technology only after modeling first-slice data, query, migration,
encryption, backup, file-protection, and test needs. Whether using SwiftData, Core Data, SQLite, or a
thin file store:

- persistence models remain separate from wire and domain models;
- schema migrations and downgrade/failed-migration recovery are tested from every supported app
  version;
- cache, user drafts, durable operation journal, and downloaded sensitive files have different
  retention policies;
- user/environment lineage is part of every locally durable record;
- sync operations use stable IDs/idempotency and observable states;
- account switch, remote deactivation, uninstall/restore assumptions, and protected-data
  unavailable states have explicit behavior.

## Dependencies

Every non-Apple package needs a short decision record containing:

- problem and alternatives, including a small in-house adapter;
- maintained versions/platforms and release cadence;
- license and attribution;
- transitive packages, binary size, privacy manifest/required-reason APIs, data collection/networking;
- security history and update owner;
- concurrency/testability implications;
- pin/update/removal strategy.

Wrap external packages at the module boundary. Do not let convenience APIs define domain types or
spread across features. Dependency upgrades are their own reviewed task.

## Scaffolding sequence

After decisions are approved:

1. create the project/workspace and deterministic build settings;
2. add schemes/configurations with fail-closed environment identity;
3. establish module boundaries and dependency checks;
4. add design token/preview/test foundations;
5. add time/ID/network/store/telemetry test doubles;
6. implement Auth bootstrap against mocks, then isolated QA;
7. implement one read-only first-slice path end to end;
8. add the first mutation only after operation/offline/idempotency and direct authorization tests;
9. prove simulator, device, accessibility, performance, lifecycle, and cleanup;
10. hold a foundation review before creating the next feature module.

## Architecture gate

The architecture is ready for the first slice when:

- every required decision has an accepted ADR or an explicit deferred trigger;
- a dependency graph has no feature-to-transport or domain-to-framework violation;
- environment mismatch and missing configuration fail closed;
- no secret can enter the binary or retained fixture/artifact;
- decoded fixtures and negative contract tests run without network;
- Auth/sign-out/task/subscription/cache ownership is specified;
- first-slice navigation, state, offline, privacy, telemetry, performance, and test diagrams agree;
- the owner and independent reviewer approve the exact scaffold diff.
