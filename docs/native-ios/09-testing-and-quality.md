<!--
FILE: docs/native-ios/09-testing-and-quality.md

WHAT THIS DOES (plain language):
  Defines the proposed native-iOS test pyramid, device matrix, evidence standard, and quality gates.

DEPENDS ON:
  Internal: CLAUDE.md, docs/testing-and-deployment.md,
            docs/native-ios/08-platform-capabilities.md, docs/native-ios/contracts/
  External: Xcode, XCTest, Simulator, physical iOS devices, TestFlight
  Data:     reads → repository, isolated-QA, device, and release evidence
            writes → documentation and bounded test artifacts only

NOTES / GOTCHAS:
  - Simulator, build, repository tests, TestFlight, provider state, and physical-device behavior
    are distinct evidence layers.
  - The shared Supabase project is never an automated mutation-test target.
-->

# Native iOS Testing and Quality

**Status:** Proposed quality contract, not yet implemented
**Last reviewed:** 2026-07-25

## Evidence language

Use the canonical labels **Verified**, **Source-confirmed**, **Inferred**, **Blocked**,
**Owner gate**, and **Not tested**. Record repository/audit/device/provider provenance separately,
and record proposed/approved/deferred/superseded as decision state.

## Current boundary

- **Source-confirmed (repository and dated audit):** the repository has a Capacitor iOS project and a manual release scaffold, but the Windows audit did not compile, sign, archive, install, or run the app with Xcode.
- **Source-confirmed (repository):** existing web/unit/integration evidence does not prove native Swift behavior.
- **Source-confirmed (repository):** `dev` and `main` share the production Supabase project. Database mutation tests must not target that project.
- **Owner gate:** a hosted or local isolated QA database with representative, synthetic fixtures is required before automated mutation-contract tests.

## Test pyramid

| Layer | Purpose | Normal environment | Required evidence |
|---|---|---|---|
| Swift unit tests | State reducers, formatting, validation, mapping, retry/idempotency rules, permissions decisions | macOS XCTest | Named suite result tied to commit and Xcode version |
| Module/component tests | Repository adapters, decoding, Keychain wrapper, upload queue, capability protocols, navigation | macOS with fakes/fixtures | Positive, empty, malformed, timeout, cancellation, and negative-role cases |
| Contract tests | Request/response shapes for RPCs, tables, Storage, workers, Realtime, and provider adapters | Local/hosted isolated QA or controlled mock | Contract ID, schema version/hash, role, fixture, result |
| SwiftUI snapshot/visual tests | Design tokens, states, Dynamic Type, dark mode, localization, compact/regular layouts | Deterministic simulator | Approved artifact with device/OS/appearance metadata |
| XCUITest journeys | Navigation, authentication shell, vertical-slice happy and failure paths | Simulator first | Video/screenshot/log plus stable synthetic fixture |
| Capability tests | Camera, scan, photos, location, notifications, biometrics, background transfer/tasks | Physical devices; some setup in Simulator | Per-capability proof and fallback proof |
| Performance/energy tests | Launch, scroll hitches, CPU, memory, disk, network, thermal and battery behavior | Physical device + XCTest/Instruments/Organizer | Baseline and regression comparison |
| TestFlight acceptance | Install/upgrade, signing, entitlements, push, background, crash collection, real distribution | Internal TestFlight | Build number, tester/device/OS, pass/fail and known limitations |
| Production smoke | Release-only routing, auth, read paths, and one separately approved reversible synthetic mutation if required | Production | Explicit owner approval, narrow identities, no client/employee side effects |

The lower layers run more often. No upper layer is replaced by a lower one: a passing build is not a device test, and a TestFlight install is not proof of every backend contract.

## Vertical-slice minimum

Every completed slice must demonstrate:

1. Contract IDs and caller roles are named.
2. Loading, content, empty, stale, offline, permission-denied, forbidden, validation-error, server-error, and retry states are intentional.
3. Mutations have a stable operation/idempotency identifier or documented reason they cannot.
4. Ambiguous network outcomes reconcile before retry.
5. Logout, account switching, token refresh, revocation, and wrong-role behavior are tested where applicable.
6. Local drafts and cached private data have a deletion/retention rule.
7. VoiceOver labels/order, Dynamic Type, Reduce Motion, contrast, touch targets, keyboard/focus, and error announcement are checked.
8. The oldest supported OS/device and a current device pass the relevant path.
9. A reviewer can trace evidence from requirement to test to build.

Use `docs/native-ios/templates/vertical-slice-checklist.md` for the recorded close-out.

## Unit and integration coverage

**Decision state: proposed — required unit-test domains:**

- Codable mapping for every contract, including unknown enum values, nullable fields, precision, and date/time-zone boundaries.
- Authentication state machine: cold start, restored session, refresh success/failure, revoked user, logout, account switch, and deep-link-before-auth.
- Authorization presentation: forbidden remains distinct from not found or network failure.
- Mutation state machine: draft, submitting, accepted, ambiguous, reconciling, succeeded, failed, retrying, and canceled.
- Offline queue ordering, deduplication, conflict, permanent rejection, logout wipe, and app-upgrade migration.
- Upload state: checksum, file missing, expired signed URL, background completion, duplicate callback, partial batch, and cancellation.
- Capability availability and permission state adapters.
- Navigation parsing for links, notifications, Spotlight, and App Intents.
- Currency, measurement, duration, locale, and accessibility formatting.

Mocks prove client behavior, not live authorization. Contract tests against isolated QA must include at least:

- allowed role succeeds;
- wrong role and wrong owner/assignment fail;
- unauthenticated fails;
- malformed and stale identifiers fail safely;
- duplicate mutation does not duplicate its effect;
- response shape matches the catalog;
- Storage read/write/delete boundaries match the intended role;
- Realtime events do not reveal rows the role cannot read.

## Database and production safety

- Never run mutation, migration, reset, seed, destructive, load, or fuzz tests against the shared UPR Supabase project.
- Debug and QA builds must fail closed if configured with the production project unless a narrowly documented read-only inspection mode is active.
- Use synthetic organizations, users, jobs, documents, phone numbers, and attachments. Never recruit real clients or employees as fixtures.
- Supabase migrations, RLS policies, grants, functions, triggers, Storage policies, and provider configuration remain separate, owner-authorized work.
- A passing isolated-QA test does not assert that a migration or configuration exists in production.
- Production smoke activity must list the exact identity, rows, side effects, cleanup, and rollback before approval. Messaging, money, payroll, signing, or deletion require their domain-specific controls.

## Device and OS matrix

The exact minimum OS and iPad support are **Owner gate** decisions. Once chosen, maintain this minimum matrix:

| Class | Purpose |
|---|---|
| Oldest supported physical iPhone | Memory, performance, camera/scanner support, minimum-OS behavior |
| Small-screen supported iPhone or simulator | Keyboard, composition fields, compact layout, all Dynamic Type accessibility sizes |
| Current standard iPhone | Primary field-work journey and notifications |
| Current large-screen iPhone | Reachability, landscape policy, modal/sheet sizing |
| iPad simulator and physical iPad if supported | Split/regular width, rotation, keyboard/pointer, App Store screenshots |
| Apple Intelligence-capable device if AI ships | Model availability, performance, energy, locale, deterministic fallback |

For each release candidate, record device model, OS build, app version/build, install source, account role, environment, and result. “Works on my phone” is not reproducible evidence.

## Simulator versus real-device gates

Simulator is appropriate for rapid UI, navigation, accessibility, deterministic network, and many App Intent checks. A physical device is required before claiming:

- camera focus/capture and document/barcode scanning;
- photo-picker and file lifecycle under memory pressure;
- precise/approximate location, permission changes, and background behavior;
- APNs token registration and production/sandbox notification routing;
- biometrics and Keychain behavior across reinstall/upgrade as applicable;
- background `URLSession`, suspension, termination, relaunch, and network handoff;
- battery, thermal, radio, and sustained scrolling performance;
- TestFlight installation, signing, entitlements, universal links, and real keyboard/safe-area behavior.

## Accessibility and interaction quality

Each user-visible state must be checked with:

- VoiceOver reading order, labels, values, hints, actions, headings, and focus restoration;
- all Dynamic Type accessibility sizes without clipped essential content; any safety-driven
  exception requires an approved rationale and alternate large-content presentation;
- bold text, increased contrast, color differentiation, dark mode, and Reduce Transparency;
- Reduce Motion and alternatives to gesture-only controls;
- external keyboard navigation where iPad is supported;
- Switch Control/Voice Control names for critical actions;
- minimum touch target and safe-area behavior;
- software keyboard show/hide, dictation, autofill/password manager, composition bar, rotation, and interrupted editing.

Accessibility defects that block a required task are release blockers, not polish.

## Reliability and offline matrix

Run each mutation-capable slice through:

- airplane mode before entry, during draft, before submit, during submit, and after accepted response loss;
- Wi-Fi-to-cellular transition;
- server timeout, `401`, `403`, `409`, `429`, `5xx`, malformed body, and expired signed URL;
- app background, termination by user/system, device restart, low storage, and update install;
- concurrent change from another authorized client;
- revoked assignment/role while a draft is open;
- repeated button taps, repeated notification delivery, and repeated background callback.

The UI must preserve a recoverable draft or explain why it cannot; never present uncertain completion as success.

## Performance, energy, and diagnostics

Before the first beta, the owner and iOS lead set numeric budgets for:

- cold/warm launch to usable content;
- scroll hitch rate for the largest realistic lists;
- memory high-water marks for photo/document flows;
- upload CPU, disk, network, and retry behavior;
- foreground and background location time;
- battery impact for a representative field shift;
- crash-free and hang-free sessions.

Use `XCTApplicationLaunchMetric`, hitch/scroll metrics, CPU/memory/storage metrics, signposts, Instruments, Xcode Organizer, and MetricKit as supported by the selected minimum OS. Apple describes MetricKit as real-device, daily performance and diagnostic evidence; it is sampled evidence, not an exhaustive event log. See [MetricKit](https://developer.apple.com/documentation/metrickit), [XCTOSSignpostMetric](https://developer.apple.com/documentation/xctest/xctossignpostmetric), and [Analyzing battery use](https://developer.apple.com/documentation/xcode/analyzing-your-app-s-battery-use).

Telemetry must:

- avoid tokens, secrets, client/customer PII, message/document content, and precise coordinates;
- include app version/build, contract/operation ID, coarse feature and outcome;
- define retention and access;
- preserve dSYMs/archive symbols for distributed builds;
- fail without blocking core user work.

## Fresh-Mac validation contract

On a newly prepared Mac, record:

1. macOS, Xcode, Swift, and selected simulator-runtime versions.
2. Repository branch and commit; working tree must be clean before generation/build.
3. Whether Apple Developer authentication exists, without exposing account data or secrets.
4. Resolved Swift Package versions and checksum/lockfile diff.
5. Selected scheme, bundle identifier, signing team, configuration, and backend environment.
6. Confirmation that Debug/QA does not point at production for mutation work.
7. A simulator build/test result and bounded log location.
8. A physical-device build result when available.
9. Every unavailable step as **Blocked** or an **Owner gate**, not an assumed pass.

Do not make the first Mac session depend on App Store signing. Establish an unsigned/simulator foundation and QA configuration first; signing and distribution follow owner enrollment.

## Runtime command safety

Every development server, simulator helper, browser controller, test subprocess, and runtime validation attempt must:

- have an explicit timeout of no more than five minutes per attempt;
- use `defer`, `finally`, or the shell equivalent to terminate spawned children;
- capture stdout/stderr to a bounded artifact;
- clean only processes created by that attempt, identified by recorded PID/process handle;
- stop retries after the bounded attempts recorded in the test plan;
- convert missing authentication, signing, simulator runtime, camera/device access, or provider access into a blocked evidence item;
- never block documentation, static analysis, or unrelated test layers.

No generic process-name kill and no unbounded preview/server command is acceptable.

## Release-blocking defect classes

- Authentication or authorization bypass, secret exposure, cross-user data, or incorrect environment routing.
- Duplicate/ambiguous money, payroll, signing, messaging, deletion, or other material mutation.
- Data loss or unrecoverable offline draft in a required field workflow.
- Crash/hang in launch, login, navigation shell, or required vertical slice.
- Inaccessible required workflow.
- Misleading success state, stale private content after logout, or sensitive notification/deep-link disclosure.
- Required capability lacking its fallback or real-device proof.
- Privacy label, purpose string, entitlement, signing, or backend contract mismatch.

## Evidence record

For every test run, retain:

- date/time and tester/agent;
- branch, commit, working-tree state;
- Xcode/OS/device/simulator;
- scheme, configuration, bundle ID, environment;
- command and timeout;
- fixture and role;
- tests passed, failed, skipped, or blocked;
- log/artifact path and secret-scrubbing confirmation;
- child-process cleanup result;
- limitations and follow-up owner gate.

The release gate consumes these records; summaries without traceable artifacts are not sufficient.
