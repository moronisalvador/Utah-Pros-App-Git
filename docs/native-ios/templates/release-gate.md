<!--
FILE: docs/native-ios/templates/release-gate.md

WHAT THIS DOES (plain language):
  Provides the evidence checklist for a native-iOS device, TestFlight, or App Store candidate.

DEPENDS ON:
  Internal: docs/native-ios/09-testing-and-quality.md,
            docs/native-ios/10-release-app-store-cutover.md
  External: Xcode signing, TestFlight, App Store Connect, physical devices
  Data:     reads → build, archive, test, device, privacy, and release evidence
            writes → a release-gate record only

NOTES / GOTCHAS:
  - Completing this template does not perform or authorize upload, submission, release, production
    mutation, or provider changes.
-->

# Native iOS Release Gate

## Candidate identity

- Gate type: development device | internal TestFlight | external TestFlight | App Store
- Release owner:
- QA/reviewer:
- Date/time:
- Branch:
- Base commit:
- Candidate commit:
- Working-tree status:
- Version:
- Build:
- Xcode/Swift:
- macOS:
- Scheme/configuration:
- Bundle ID:
- Apple team:
- Backend environment/project:
- Archive/dSYM/artifact location:

## Scope and diff

- [ ] Release scope and exclusions are approved.
- [ ] Full diff and `git diff --check` reviewed.
- [ ] Every changed/generated file is intended and reproducible.
- [ ] Dependency versions/licenses/privacy manifests are reviewed and locked.
- [ ] No secret, real test identity, private content, service-role key, or signing material is present.
- [ ] Required canonical documentation is current.
- [ ] Independent adversarial review is resolved.

## Build and automated quality

- [ ] Fresh-Mac dependency resolution is reproducible.
- [ ] Release configuration builds.
- [ ] Swift unit/module tests pass.
- [ ] Isolated-QA contract and negative authorization tests pass.
- [ ] XCUITest/snapshot/accessibility suites pass.
- [ ] Performance and energy budgets pass.
- [ ] All runtime attempts used a timeout of five minutes or less.
- [ ] Spawned child processes were cleaned through guaranteed cleanup.
- [ ] Failures/skips/blocked checks are listed below.

## Environment and production safety

- [ ] Bundle, scheme, Supabase project, worker/provider endpoints, APNs environment, and feature flags match the intended track.
- [ ] Debug/QA production-refusal control is verified.
- [ ] No migration, seed, policy/grant/function/Storage/provider change is implicitly bundled.
- [ ] Any separately authorized live change has its own commit/apply evidence and rollback.
- [ ] Production smoke plan is narrow, approved, synthetic, reversible, and side effects are listed.
- [ ] No uncontrolled messaging, money, payroll, signing, consent/DND, deletion, or client/employee action can occur.

## Security, privacy, and account lifecycle

- [ ] Authentication restore/refresh/revocation/logout/account switch pass.
- [ ] Wrong-role/owner/assignment cases pass for release workflows.
- [ ] Keychain/local cache/logout wipe and data protection pass.
- [ ] Deep links/notifications/App Intents reauthorize and do not reveal locked-screen data.
- [ ] Purpose strings, entitlements, privacy manifest, required-reason APIs, and SDK manifests match behavior.
- [ ] App Store privacy answers and public privacy policy match the candidate.
- [ ] Account deletion request/flow is reachable and verified.
- [ ] Export-compliance answer is reviewed.

## Device and capability proof

- [ ] Oldest supported physical iPhone.
- [ ] Small-screen/all Dynamic Type accessibility sizes.
- [ ] Current standard and large-screen iPhone.
- [ ] Supported iPad configurations, or iPad is explicitly excluded.
- [ ] Camera/photo/scanner.
- [ ] Location and denied/approximate fallback, if included.
- [ ] APNs foreground/background/terminated/denied/stale-token paths.
- [ ] Background transfer/task expiration, relaunch, and reconciliation.
- [ ] Biometrics/Keychain.
- [ ] Keyboard, safe areas, rotation, dark mode, VoiceOver, Reduce Motion.
- [ ] Apple Intelligence/App Intents availability and fallback, if included.

## Install, upgrade, and compatibility

- [ ] Clean install passes.
- [ ] Upgrade from the minimum supported Capacitor production build passes.
- [ ] Server-authoritative reload and fresh-auth policy behave as documented.
- [ ] Pending Capacitor drafts/uploads are drained, migrated explicitly, or covered by support policy.
- [ ] Legacy WebKit localStorage/IndexedDB/Cache Storage/cookies, Capacitor preferences/files,
      Keychain items/access groups, app-container files, and backup behavior are inventoried.
- [ ] Reconciled legacy data is versioned-imported, quarantined, or purged idempotently; a
      post-cleanup privacy/storage scan proves the result without deleting unresolved work.
- [ ] Push tokens, universal links, Keychain groups, caches, and native local-schema migration pass.
- [ ] PWA remains operational.
- [ ] Backend remains compatible with supported PWA/Capacitor clients.
- [ ] Minimum-version/adoption/retirement rules are owner-approved.

## Signing and App Store Connect

- [ ] Bundle ID/App Store record ownership confirmed.
- [ ] Certificates/profiles/entitlements are valid for this build.
- [ ] Version/build is unique.
- [ ] Archive, dSYMs/symbols, export record, dependency lock, and commit are retained.
- [ ] App icon, screenshots, description, keywords, support/privacy/terms URLs, category, age rating, and availability are current.
- [ ] Reviewer notes and stable demo account/mode cover authenticated and hardware-gated screens.
- [ ] Required backend services will remain available during review.
- [ ] TestFlight processing/review evidence is attached where applicable.
- [ ] Manual/automatic/phased release choice is recorded.

## Cutover and incident readiness

- [ ] Release/observation owners are named.
- [ ] Stop conditions and alert/metric sources are named.
- [ ] Support messaging and PWA fallback are ready.
- [ ] Phased release can be stopped.
- [ ] Hotfix path and server feature kill switches are verified without weakening authorization.
- [ ] No destructive database rollback is proposed.
- [ ] Compatibility-window end criteria are recorded.

## Evidence

- Build/test logs:
- Contract/authorization:
- Device matrix:
- Accessibility:
- Performance/energy:
- Archive/symbols:
- TestFlight:
- App Store metadata/privacy:
- Upgrade:
- Production smoke approval/result:

## Open defects and gates

| ID | Severity | Evidence | Owner | Disposition |
|---|---|---|---|---|
|  |  |  |  |  |

## Final disposition

- [ ] Approved for this exact gate only.
- [ ] Approved with named nonblocking limitations.
- [ ] Blocked pending owner/external evidence.
- [ ] Rejected.

Decision and rationale:

Release action authorized:

- [ ] No upload/submission/release authorized.
- [ ] Upload only.
- [ ] Submit for review only.
- [ ] Manual/phased release of the exact approved build.

Named owner approval and timestamp:
