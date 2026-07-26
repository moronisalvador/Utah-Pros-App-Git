<!--
FILE: docs/native-ios/10-release-app-store-cutover.md

WHAT THIS DOES (plain language):
  Defines the proposed TestFlight, App Store, compatibility, cutover, and rollback plan for
  replacing the Capacitor binary with native Swift.

DEPENDS ON:
  Internal: docs/app-store-readiness-roadmap.md, docs/app-store-connect-metadata.md,
            docs/testing-and-deployment.md, docs/native-ios/09-testing-and-quality.md
  External: Apple Developer Program, Xcode signing, TestFlight, App Store Connect, App Review
  Data:     reads → repository, archive, device, TestFlight, and App Store evidence
            writes → documentation only until a separately approved release task

NOTES / GOTCHAS:
  - Signing, provider configuration, upload, submission, and release are owner/external actions.
  - An App Store binary cannot be rolled back like a web deployment.
-->

# Native iOS Release, App Store, and Cutover

**Status:** Proposed release contract
**Last reviewed:** 2026-07-25
**Goal:** Keep the PWA and Capacitor app serviceable while a complete native app is built, then release the native binary through a controlled compatibility window.

## Evidence language

Use the canonical labels **Verified**, **Source-confirmed**, **Inferred**, **Blocked**,
**Owner gate**, and **Not tested**. Record provenance separately and keep
proposed/approved/deferred/superseded decision state independent from evidence.

## Current release boundary

- **Source-confirmed (repository):** the current Capacitor target declares production bundle identifier `com.utahprosrestoration.upr`.
- **Source-confirmed (repository):** the repository records a public App Store distribution decision, with Apple Business Manager Custom Apps as a fallback.
- **Source-confirmed (repository):** icons, splash assets, privacy manifest, purpose strings, an account-deletion request flow, export-compliance metadata, push entitlement/delegate bridging, and a manual Fastlane/workflow scaffold exist for the Capacitor target.
- **Source-confirmed (repository):** the current push entitlement value is development-oriented. That is not production APNs proof.
- **Source-confirmed (dated Windows evidence):** Xcode compilation, signing, archive, installation, TestFlight upload, and App Review submission were not tested.
- **Owner gate:** Apple Developer enrollment/team access, certificate/profile strategy, App Store Connect access, credentials, screenshots, reviewer account, archive/device proof, and actual submission remain external.

The metadata in `docs/app-store-connect-metadata.md` describes the current known Capacitor implementation. It must be recaptured for the native candidate; new SDKs, telemetry, location, AI, signing, Storage, or notification behavior can change the answers.

## Distribution topology

| Track | Purpose | Identifier/environment | Release authority |
|---|---|---|---|
| Native local/Simulator | Compile, unit test, deterministic UI | **Owner gate:** local configuration; no production mutations | iOS lead |
| Native QA | Isolated-QA contracts, devices, internal testing | Separate QA bundle ID chosen by owner; isolated QA backend | iOS lead + QA |
| Native internal TestFlight | Signed distribution and real-device acceptance | Separate QA listing/bundle where Apple setup permits, or an approved pre-release scheme | Apple account owner |
| Capacitor operational/production | Current operational client and intended App Store binary if the owner releases it | `com.utahprosrestoration.upr`; production | Existing release owner |
| Native production | Eventual replacement binary | **Owner gate:** same versus new production listing/bundle; same-record migration is only the recommendation | Apple account owner |

**Decision state: proposed.** Development uses a distinct QA bundle identifier so native and Capacitor builds can coexist on a device and so QA cannot impersonate production entitlements, keychain groups, APNs topic, universal links, or backend configuration. The exact identifier is an owner decision; this document does not invent or register one.

**Owner gate:** before project creation, choose only the nonproduction development/QA identity and
verify its team ownership. Read the existing production bundle/App Store record state without
creating or reusing a production target. The separate production listing/bundle/cutover ADR is due
before external TestFlight or any production target/upload. Apple cautions that a bundle ID must be
chosen carefully and cannot be changed after the first upload. See
[Preparing an app for distribution](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution).

## Upgrade strategy

**Recommended:** Preserve the same customer-facing App Store listing and bundle ID at cutover.

- If Capacitor ships first, the native binary is an ordinary higher-version update to that app, subject to Apple validation.
- If no Capacitor production binary has shipped by native readiness, the owner decides which implementation becomes the first App Store build; do not create a duplicate public listing by default.
- The PWA remains a separately deployed web product. A native update does not alter PWA caching, install state, or release.
- Native Swift code cannot use the Capacitor web-update mechanism. Native code changes go through Xcode/TestFlight/App Store distribution.

Preserving the listing maintains download history, reviews, app identity, universal links, and customer update behavior, but it does not automatically migrate web-container local data.

## Local-state migration

Do not assume WKWebView cookies, localStorage, IndexedDB, Cache Storage, Capacitor preferences, pending uploads, or web push state become usable Swift state.

**Decision state: proposed — default migration policy:**

1. Server-authoritative records reload after authentication.
2. Require a fresh sign-in on first native launch unless a separately reviewed, one-time Keychain/app-group bridge is proven safe and necessary.
3. Before the native production release, the Capacitor app exposes and resolves any pending/offline work; release notes warn users to sync before upgrading.
4. The native app must not claim a Capacitor draft was migrated unless an explicit versioned importer validates and acknowledges it.
5. Native local storage starts with its own schema version and migration tests.
6. Detach or expire the old client’s push-token association where the server model requires it; register the native APNs token after sign-in. Never copy or cache an old device token.
7. Revalidate deep links, universal links, keychain access groups, shared containers, notification categories, and background session identifiers.
8. Verify logout clears user-scoped native caches and that an upgrade cannot show prior-user data.
9. Inventory legacy WebKit data stores, cookies, Cache Storage, IndexedDB, Capacitor preferences and
   files, legacy Keychain access groups/items, backups, and app-container artifacts retained by a
   same-bundle update.
10. Reconcile pending work before any cleanup. Then run a versioned import, quarantine, or purge
    routine with idempotent migration markers and post-cleanup privacy/storage evidence. Never
    broadly delete the legacy container merely because the native app launched.

**Owner gate:** if offline Capacitor drafts cannot be enumerated and drained, define a mandatory compatibility period and user support procedure before approval.

## Backend compatibility window

From the first native TestFlight build until the owner formally retires the Capacitor client:

- RPCs, workers, table/view shapes, Storage conventions, Realtime payloads, and authentication behavior used by either client remain backward compatible.
- Prefer additive response fields and new versioned endpoints. Do not rename/remove columns, change nullability/enum meaning, or replace a return shape without caller inventory and transition design.
- The native app declares its client version/build on supported requests so the server can measure compatibility without trusting it for authorization.
- Server-side role, consent, assignment, ownership, money, signing, and messaging rules remain authoritative for both clients.
- Every schema/provider change lists affected PWA, Capacitor, native, worker, test, and automation callers.
- Minimum-supported-client enforcement, if ever needed, uses an owner-approved server policy and user-visible upgrade path. It cannot be a surprise kill switch.
- PWA and Capacitor critical security fixes continue during the window. Native development is not permission to abandon the current product.

**Owner gate:** retirement requires adoption evidence, no unresolved offline work, support readiness, and an owner-approved minimum-version policy. Calendar age alone is not sufficient.

## Release ladder

### Gate 0 — Repository candidate

- Clean, reviewed branch and exact commit.
- Native project, dependencies, generated artifacts, entitlements, privacy manifest, and configuration diff reviewed.
- No production credential, signing secret, real identity, or service-role key in repository/build logs.
- Unit, contract, UI, accessibility, and targeted performance results attached.
- Canonical architecture, contracts, privacy, testing, and release documents updated.

### Gate 1 — Fresh-Mac build

- Clone/checkout on a supported Mac.
- Record macOS, Xcode, Swift, SPM resolution, scheme, configuration, bundle ID, and backend environment.
- Build and test on Simulator with bounded commands and child cleanup.
- Confirm Release cannot silently select QA and Debug/QA cannot mutate production.

### Gate 2 — Development-signed physical device

- **Owner gate:** Apple team and development signing.
- Install on representative devices.
- Prove launch/auth, keyboard/safe areas, camera/scan/photos, location where included, Keychain/biometrics, background transfers, deep links, and notification permission states.
- Capture energy/performance baselines.

### Gate 3 — Internal TestFlight

- **Owner gate:** archive/export/upload with unique build number.
- Retain `.xcarchive`, dSYMs/symbol files, export options, dependency lock, commit, and build log.
- App Store Connect processing succeeds; privacy-manifest and entitlement issues are resolved.
- Internal testers execute the release gate on clean install and supported upgrade paths.

Apple’s [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview) documents internal/external tester limits, first-build external review, and 90-day build expiration. Those mechanics must be rechecked when release begins.

### Gate 4 — External beta, when useful

- **Owner gate:** product owner decides whether external testing adds value.
- Beta description, support contact, export/compliance answers, privacy disclosures, and review information are current.
- Use synthetic/authorized test identities and production-safe provider modes.
- Feedback and crash/hang evidence are triaged against a named build.

### Gate 5 — App Store candidate

- Full compatibility and device matrix complete.
- App icon, screenshots, description, keywords, support/privacy/terms URLs, age rating, category, pricing/availability, encryption, data collection, and account deletion are recaptured.
- Reviewer notes explain role-based functionality, hardware dependencies, and any controlled demo mode.
- A stable reviewer account and required backend services are available throughout review without exposing a real employee/client identity.
- Release owner chooses manual, automatic, or phased release and records the choice.

Apple’s [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) require complete, reviewable apps and appropriate demo access; [account-deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app) covers apps that support account creation.

### Gate 6 — Production release and observation

- Owner explicitly approves the exact version/build and release action.
- Support, incident, provider, database, and App Store owners are named for the observation window.
- Start phased/manual release where appropriate; confirm install and upgrade on a non-development device.
- Run only the approved production smoke plan.
- Observe crashes, hangs, auth, contract errors, upload reconciliation, notifications, background work, and support reports.
- Stop the phased release if a stop condition is met.

## App Store privacy and review

Before every candidate:

- Generate and inspect the app privacy report/manifest coverage for the app and third-party SDKs.
- Reconcile actual data collection, linked data, tracking, retention, deletion, and purpose with App Store Connect answers and the public privacy policy.
- Recheck required-reason APIs and privacy manifests after every dependency change.
- Verify every purpose string is specific to the capability users actually invoke.
- Keep account deletion reachable and functional; distinguish an in-app request from immediate deletion if the business process requires review.
- Confirm export-compliance answers against the actual cryptography and SDK set.
- Avoid reviewer-only behavior, hidden production switches, or inaccessible authenticated screens.

Apple states that invalid privacy manifests are rejected; see [Adding a privacy manifest](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk). Metadata stored today is not proof of future behavior.

## Rollback and stop conditions

An installed App Store binary cannot be remotely replaced with an older binary. Available controls are:

- stop a phased release;
- remove a build from sale where appropriate;
- disable a narrowly designed server feature flag or provider integration without breaking unrelated clients;
- submit an expedited/hotfix build;
- direct users to the still-supported PWA for an affected workflow;
- preserve server compatibility for the last supported Capacitor client.

Do not “rollback” by destructive database migration, policy weakening, secret exposure, or silent data deletion.

Stop release for:

- authentication/authorization bypass or cross-user data;
- wrong environment/project/provider routing;
- data loss, unreconciled duplicate mutation, or stale private cache after logout;
- crash/hang in required journeys;
- incorrect privacy disclosure, entitlement, signing, or reviewer access;
- material battery/location/background regression;
- broken upgrade from the supported Capacitor version;
- notification, signing, messaging, payroll, money, or deletion side effect outside its approved gate.

## Cutover completion criteria

Cutover is complete only when:

- the native production build is approved and deliberately released;
- clean-install and Capacitor-upgrade paths pass on supported devices;
- backend compatibility and adoption telemetry show the agreed threshold;
- pending Capacitor work and push/session transitions are resolved;
- PWA behavior remains intact;
- support and incident procedures are active;
- App Store metadata/privacy answers match the released binary;
- the owner records whether and when Capacitor-specific release infrastructure may be retired.

Removing Capacitor code, App Store assets, workflows, credentials, or documentation is a separate cleanup initiative after the compatibility window, not part of initial native release.

Cutover is not the end of the product lifecycle. `11-roadmap.md` Phase 12 begins sustained native
operations: toolchain/OS/device/dependency maintenance, Apple membership/agreement/certificate/APNs
rotation, contract/privacy drift review, crash/energy/accessibility SLOs, incident drills, support,
and recurring release evidence.
