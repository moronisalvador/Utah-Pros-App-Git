<!--
FILE: docs/mobile/testing-and-release.md

WHAT THIS DOES (plain language):
  Defines the required safe validation, installed-device evidence, release manifest, promotion and
  rollback gates for UPR mobile browser/PWA and Capacitor iOS changes.

DEPENDS ON:
  Internal: package.json, .github/workflows/, docs/testing-and-deployment.md,
            .claude/rules/close-out-standard.md, docs/mobile/data-contracts.md,
            docs/mobile/pwa-and-capacitor.md
  Data:     reads → build/test/release evidence
            writes → documentation only

NOTES / GOTCHAS:
  - A web build, fixture test and native archive prove different things.
  - Shared Supabase changes are production changes even when the client branch is dev.
-->

# Mobile Testing and Release

## Evidence model

Report each layer separately:

1. static/source review;
2. unit/component/hook tests;
3. worker contract tests;
4. isolated database/RLS/RPC tests;
5. production build and artifact measurements;
6. authenticated browser route tests;
7. hosted staging configuration/provider proof;
8. installed PWA device proof;
9. signed native archive/TestFlight/device proof;
10. controlled production/post-release evidence.

A higher layer does not retroactively prove a different layer. “Build passes” does not mean
environment variables, provider credentials, database authorization, install, offline, signing, or
real-device behavior works.

## Safe local commands

From a clean checkout with the lockfile:

```text
npm ci
npm test
npm run lint
npm run build
npm run build:native
npm run test:browser:list
npm run test:browser
npm run test:artifacts
npm run check:tooling-generated
npm run test:tooling
npm run validate:tooling
npm run test:figma-governance
npm run validate:figma-governance
npm run test:provenance
npm run validate:provenance
npm audit --omit=dev
```

`npm run build:native` forces the native target and runs the completed-module-graph guard that
rejects office, CRM, billing/QBO, desktop settings, and admin-mobile modules. Do not replace it with
an ambient shell flag or claim native readiness from a green Vite bundle.

`npm run build:ios` includes `cap sync ios`; run it only in a native implementation/release workflow
where generated changes are intended and reviewable, on a supported environment. It is not a
read-only audit command.

Release-source checks also include:

```text
node --test scripts/native-bundle-boundary.node-test.mjs
UPR_TEST_LANE=unit npx vitest run --config vitest.config.js scripts/ios-release-workflow.test.js
plutil -lint ios/App/App/Info.plist
plutil -lint ios/App/App/PrivacyInfo.xcprivacy
plutil -lint ios/App/App/App.entitlements
plutil -lint ios/App/App/App.Release.entitlements
```

`scripts/qa/verify-ios-release-artifact.mjs` validates an actual archive/IPA, not source alone. Run
it only when the signed artifact exists and compare its JSON report with the release manifest.

The repository has no TypeScript/typecheck gate. Lint has a known baseline; report the full result and
make changed mobile/worker files clean. CI keeps full-tree lint non-blocking but blocks a PR when any
changed JS/JSX file has an error or warning. The variables-only `no-use-before-define` warning is part
of that ratchet and catches TDZ regressions without activating untouched baseline debt. Never edit
code merely to make an audit command green unless remediation was separately authorized.

At the 2026-07-28 guardrail checkpoint based on `3435583`, full-tree lint reports 1,118 findings:
200 errors and 918 warnings, including 808 `no-use-before-define` warnings. This is measured baseline
debt, not a passing gate; changed-file lint remains the zero-warning acceptance boundary.

## Runtime harness safety

Development servers, preview servers, browser launchers, and other child processes used by automated
validation must:

- have an explicit timeout of at most five minutes per attempt;
- start under an owned process/job group;
- clean browser contexts, ports, and the entire spawned child tree in `finally`;
- verify the expected origin/port before driving a browser;
- use synthetic authorized identities/data only;
- fail gracefully and record a human/device/provider gate when credentials or environment are
  unavailable;
- never block unrelated build/static/documentation validation.

Do not kill an unrelated Node/browser process based on name alone; resolve ownership/PID/port first.
The iOS release workflow applies this contract through
`scripts/qa/run-owned-subprocess.mjs` around both Fastlane archive/Xcode and
TestFlight upload commands; the helper owns a process group, enforces the
five-minute ceiling, terminates survivors, and verifies cleanup.

## Required automated coverage

### Every mobile change

- focused unit/component/hook tests for changed behavior;
- failure/empty/loading/stale/offline states;
- changed-file lint;
- web build and native-target build when shared routes/native code are affected;
- bundle/CSS delta;
- real route render at relevant required widths;
- keyboard/focus/axe check;
- minimize/background/resume;
- documentation and ownership-manifest reconciliation.

### Sensitive contracts

- negative role/tenant/assignment/object authorization;
- direct bearer/PostgREST/RPC/worker requests outside the UI;
- idempotent replay, lost response, timeout, duplicate tap, concurrent edit, and partial failure;
- money cents/locking/audit/provider outcome;
- messaging consent, DND, STOP/START/HELP, sender, quiet hours, retry, audit;
- public token expiry/status and Storage path/access;
- service-role worker timeout/redaction/no secret response.

### Offline and durable state

- two-account device lifecycle;
- crash/reload pending-detach journal replay, owner mismatch, and old-client A→B cleanup ordering;
- rejected-bootstrap cleanup/strict local sign-out, fully typed identity/permission/flag responses,
  and cleanup-ready password recovery that preserves the recovery session;
- offline logout/token expiry/disabled user;
- process kill at pending/leased/syncing/provider-accepted/metadata/done;
- two-tab/process claim;
- queue replay and desired-state idempotency;
- blob missing/quota/eviction;
- old cache/new bundle/rollback and account switch;
- user-visible recover/retry/cancel/partial result.

The source offline matrix must census production callers separately from dormant dispatcher files.
For the initial release, assert zero enqueue call sites, `PRODUCTION_QUEUE_TYPES=[]`, no enqueue/
retry hook API, and no runner dispatcher imports. Every photo, reading, placement, removal, room,
note, and task write must fail before local persistence while offline. Hidden documents must neither
poll nor run maintenance, and same-owner multi-tab marker recovery must never adopt another epoch.
The value-free live contract capture is
[`../audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md`](../audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md);
its separate definer-RPC authorization finding remains open.

The remediation tests pin zero admission/dispatch, online-only field UI, v3 count-only inspection,
blocking legacy rollout state, exact-confirmation all-store discard, bounded typed open/
version-change recovery, generation isolation, and retry-limited time-rotating historical-photo
cleanup. At the 2026-07-27 offline-remediation checkpoint (`3da70e5`), the focused six-file lane
passed 58/58, the complete unit lane passed 90 files/1079 tests, Worker passed 99 files/1476 tests,
QA passed 25 files/206 tests, and web/native builds passed. Full lint reported 310 findings, and
preflight reported 0 errors/2 expected warnings (dirty integration tree and optional GitHub delivery
unavailable). Independent review found no actionable offline P0/P1. The changed-file lint ratchet,
real browser multi-tab/upgrade, and physical-device execution remain additional release gates.

## Authenticated browser matrix

Use safe synthetic employees representing each supported role/permission. Never use real
clients/employees or production rows merely to satisfy E2E.

Required widths:

| Width | Required checks |
|---:|---|
| 320 | smallest layout, long text, critical actions, no horizontal overflow |
| 360 | common compact Android, keyboard/forms |
| 375 | compact iPhone, safe areas |
| 390 | current baseline iPhone, all primary routes/states |
| 412 | Android large, tabs/sheets/media |
| 430 | large iPhone, one-hand/docked actions |
| 768 | tablet boundary, portrait/landscape assumptions |

Also test relevant iPad/tablet portrait/landscape/split-view and a desktop safety width. Cover:

- login/session restore/expired/revoked/missing employee/logout/account switch;
- every primary tab and nested back flow;
- job/claim/appointment/task/clock/media/message/create/edit/delete workflows;
- loading/error/empty/permission/offline/update states;
- unsaved forms and background/resume;
- dark/light, reduced motion, zoom/Dynamic Type, localized/long content;
- keyboard, focus order/return, VoiceOver/TalkBack/keyboard alternatives.

Record build SHA, synthetic fixture identity, database compatibility snapshot, browser/device/OS,
expected/observed result, sanitized screenshot/log, and disposition. A generic fixture is not an
application route result.

## PWA release gate

### Before deployment

- validate manifest identity/scope/icons and service-worker source;
- confirm no fetch/cache behavior can recreate HTML-as-JS poisoning;
- verify HTML/SW/reset/asset headers in a release preview;
- build and record asset hashes, entry/route/CSS budgets, and cache compatibility ID;
- run old-version/current-version and rollback fixture;
- verify account-scoped cache/draft/queue/push state;
- confirm database/RPC compatibility and feature-flag defaults/kill switches.

### Installed devices

At minimum:

- iOS Safari browser and Home Screen PWA on supported small/large iPhone;
- Android Chrome browser and installed PWA on a current Pixel-class and one OEM device;
- iPad/tablet if supported.

Validate install UI, icon/title/scope, first/repeat launch, auth restore, camera/file, keyboard, safe
areas, standalone navigation/back, notification permission/delivery/tap, online/warm/cold offline,
storage eviction, partial asset/deploy failure, update, reset, rollback, logout/account switch, and
accessibility.

If cold offline is not supported, the UI/release notes must say so and affected workflows must fail
clearly.

## Capacitor release gate

On a clean macOS runner:

1. install locked Node and Ruby dependencies (Ruby 3.3.12, Bundler 2.5.22,
   Fastlane 2.237.0, and a reviewed `ios/Gemfile.lock`);
2. build the native target with `npm run build:native` and run reviewed `cap sync ios`;
3. validate native diff, target membership, plugin versions, Info.plist, entitlements, privacy
   manifests, app/version/build IDs;
4. run unit/worker/database/security gates;
5. archive/export and inspect codesign, provisioning, entitlements, embedded privacy manifest and
   bundled web assets;
6. upload a named internal TestFlight build;
7. install on representative iPhone/iPad;
8. run launch/login/session/secure storage/biometric/privacy, camera/photo/location/keyboard/safe
   area, foreground/background/termination, deep link/recovery/signing, push/tap, offline
   zero-admission/legacy cleanup, account switch, update and Capgo rollback;
9. resolve account-deletion/App Review/support-device policy;
10. record sanitized evidence and owner promotion approval.

No App Store/OTA promotion occurs only because an archive compiled.

The checked-in `ios/Gemfile.lock` and managed `ios/App/CapApp-SPM/Package.swift` are synchronized,
including the direct `@capacitor/app` dependency used by the mounted native navigation bridge.
Clean-checkout release proof must continue to demonstrate that the locks reproduce without
unexpected native drift.

The side-by-side UPR Dev identity has two deliberately separate native configurations:
development-signed `Dev` for direct device runs and distribution-signed `DevRelease` for
internal TestFlight. `.github/workflows/ios-dev-testflight.yml` is fail-closed behind
a fresh manual dispatch for every signed archive/upload, accepts only `dev`, pins the
`.upr.dev` bundle and Preview API origin, uses production APNs, and reverifies the embedded
origin/Push/SHA contract before an internal-only upload. A `dev` push runs credential-free
tests only. Dev-exclusive `IOS_DEV_*` signing/provider names prevent fallback to official
UPR credentials, and runs serialize across the Apple side effect. The external Apple
record/profile/group, GitHub environments, first dry archive, upload, install, and device
matrix remain independent owner gates. The manual `native_push_enabled:false` replacement
also embeds the exact dev-token retirement flag; authenticated boot must prove the
OS-reported `.upr.dev` identity before deleting its remembered owner-scoped token and
unregistering locally. The exact containment and zero-dispatch evidence sequence lives in
`docs/mobile/dev-app-variant.md`; none of that lane changes the official main-only UPR
release path.

## Database compatibility gate

Before any web/PWA/native/OTA release that changes a data contract:

- inspect live migration ledger/function/RLS/grant/Storage state read-only;
- verify the reviewed migration is reachable from the designated release branch;
- run migration safety, provenance, anonymous-grant, negative-role, signature/return-shape, rollback,
  and caller-compatibility checks;
- apply only in the owner-authorized shared-project window;
- verify the intended role live and regenerate/capture provenance;
- confirm old deployed clients remain compatible or enforce a safe version/feature gate;
- bind the database snapshot/version to the release manifest.

Never use generated client types alone as database proof and never point mutation-heavy tests at the
shared project.

For S1h, source hardening is not an apply decision. Its compatibility order is:

1. additive selector-safe employee identity RPCs;
2. compatible browser/PWA/native deployment and explicit retirement/acceptance of old cached/native
   clients;
3. schema-last employee identity containment;
4. page-access provenance reconciliation;
5. personal preferences/Web Push/native-token containment.

The live `permission_write_gates` dependency is separately pinned. Every unapplied migration above
requires its own reviewed commit, drift capture, owner window, provenance record, and live proof.
A temporary non-retained PGlite model did not execute the exact checked-in forward/preflight/
post-apply/isolated files; the exact governed sequence remains open.

## Release manifest

Every promoted mobile artifact should record:

```text
source commit and reviewed branch
Node/npm lock and build target
web asset/build ID and cache compatibility ID
database migration/provenance snapshot
feature-flag/kill-switch assumptions
Cloudflare deployment ID
PWA manifest/SW hashes
native marketing version from ios/App/Version.xcconfig
unique workflow-assigned build number and installed App.getInfo() values
Xcode/signing/entitlements/privacy manifest
Capacitor/plugin versions
Capgo bundle/channel/minimum binary (when used)
provider environment identifiers without secrets
test/device evidence links
rollback boundaries and owner
```

The manifest is operational evidence, not a new place to store credentials or customer information.

## Post-deployment verification

### Web/PWA

- deployment reached final success and expected commit;
- root/manifest/SW/reset/assets have expected content types/cache headers/hashes;
- fresh browser and already-installed client open the expected version;
- login, primary tabs, one read, one approved synthetic mutation, error/reset, logout/account switch;
- monitoring sees the release and no error/queue/update spike;
- no service-worker/cache loop or old/new contract mismatch.

### Native/OTA

- TestFlight/App Store/Capgo artifact matches release manifest;
- cold/warm/background launch and auth/security/privacy gates;
- one controlled permission/media/location/push/deep-link workflow;
- correct beta/production channel and binary compatibility;
- error/crash/update/queue telemetry receives the release ID;
- rollback/disable controls remain available.

Do not perform provider sends, money movement, or production-data mutation as a generic smoke test.
Use separately approved synthetic flows.

## Rollback expectations

Rollback is multi-layered:

| Layer | Required rollback |
|---|---|
| Feature | fail-safe flag/kill switch that leaves a usable route |
| Web | redeploy prior compatible artifact; verify HTML/assets/SW/reset |
| PWA state | cache compatibility/reset path without exposing cross-account data |
| Database | reviewed backward-compatible/rollback migration; shared-project impact explicit |
| Worker/provider | disable/revert endpoint/config without replaying side effects |
| OTA | stop channel, roll back bad bundle, verify binary compatibility |
| Native | App Store/TestFlight replacement/feature disable; no instant binary recall assumption |
| Push | disable event/transport safely; preserve consent and detach invalid devices |

A source revert alone is not a complete rollback when a database migration, provider side effect,
installed cache, push subscription, or OTA bundle already changed state.

## Promotion decision

Expanded mobile production use requires:

- zero open P0;
- zero open unconditional P1;
- every conditional P1 explicitly excluded or owner-approved with matching UI/docs/tests;
- passing blocking automation;
- current read-only production configuration/provenance;
- required installed PWA and/or signed-native device matrix;
- monitored small pilot, support fallback, stop criteria, and rehearsed rollback.

## Current source-versus-release checkpoint

The reconciled mobile source now includes:

- field-only native graph enforcement while preserving the complete browser/desktop graph;
- a web-registry completeness contract that keeps every declared lazy browser page exported and
  every registry export destructured by `App`;
- public `/privacy`, `/terms`, `/support`, `/sign/:token`, and `/s/:code` routes in both targets;
- a shared account-deletion request panel in desktop and field settings;
- selector-free profile bootstrap and opaque owner/epoch device-state gating;
- owner-bound durable Web/APNs detach journals and old-client direct account-switch cleanup;
- fail-closed normal account cleanup, owner-bound durable state, zero offline command admission/
  replay, and bounded legacy-state maintenance;
- native biometric fail-closed handling and an opaque app-switcher privacy shield;
- mounted allowlisted custom/Universal-Link and Push-action navigation;
- exact-default-off native Push enrollment and OTA with zero boot acknowledgment;
- exact 12-type app privacy declaration, including Other Financial Info for retained OOP
  quote/pricing data, and fail-closed archive/IPA verification source.

This is still a source checkpoint, not production readiness. S1h and the other database lanes are
unapplied; the reviewed current-`origin/dev` no-rewrite integration is local source history prepared
for review, not a `dev` or production release. Reviewed Capacitor sync and the Ruby lockfile now
exist, and a distribution-signed archive/IPA from the dirty qualification worktree independently
proved the local signing lane. Its report correctly has no source commit, so no clean-source final
artifact, deployment, provider delivery, TestFlight install, or complete physical-device
qualification is implied. The identified Auth source
defects are fixed: rejected
bootstrap strictly proves cleanup/sign-out before Login, bootstrap authorization values are typed,
and password recovery is cleanup-gated without losing its session. Observer-only expired-session
cleanup now preserves its durable journal and requires a fresh same-account bootstrap instead of
retrying with the expired client. The race suite passes 46/46, and an independent security
spot-check reran it and found no remaining source P0/P1.
Credential-free local smoke passes for the logged-out root at 390px and 1440px and for public
`/privacy` and `/status`; authenticated browser, installed-PWA, signed-native, and physical-device
proof remain.
