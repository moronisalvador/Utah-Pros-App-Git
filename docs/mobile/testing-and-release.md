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
npm run test:browser:list
npm run test:browser
npm run test:artifacts
npm run test:tooling
npm run validate:tooling
npm run test:figma-governance
npm run validate:figma-governance
npm run test:provenance
npm run validate:provenance
npm audit --omit=dev
```

For native **build-only** validation, set `VITE_BUILD_TARGET=native` using the current shell/CI
environment and run `npx vite build`. Do not claim native readiness from that result.

`npm run build:ios` includes `cap sync ios`; run it only in a native implementation/release workflow
where generated changes are intended and reviewable, on a supported environment. It is not a
read-only audit command.

The repository has no TypeScript/typecheck gate. Lint has a known baseline; report the full result and
make changed mobile/worker files clean/blocking. Never edit code merely to make an audit command
green unless remediation was separately authorized.

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
- offline logout/token expiry/disabled user;
- process kill at pending/leased/syncing/provider-accepted/metadata/done;
- two-tab/process claim;
- queue replay and desired-state idempotency;
- blob missing/quota/eviction;
- old cache/new bundle/rollback and account switch;
- user-visible recover/retry/cancel/partial result.

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

1. install locked Node and Ruby dependencies;
2. build native target and run reviewed `cap sync ios`;
3. validate native diff, target membership, plugin versions, Info.plist, entitlements, privacy
   manifests, app/version/build IDs;
4. run unit/worker/database/security gates;
5. archive/export and inspect codesign, provisioning, entitlements, embedded privacy manifest and
   bundled web assets;
6. upload a named internal TestFlight build;
7. install on representative iPhone/iPad;
8. run launch/login/session/secure storage/biometric/privacy, camera/photo/location/keyboard/safe
   area, foreground/background/termination, deep link/recovery/signing, push/tap, offline queue,
   account switch, update and Capgo rollback;
9. resolve account-deletion/App Review/support-device policy;
10. record sanitized evidence and owner promotion approval.

No App Store/OTA promotion occurs only because an archive compiled.

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
native app version/build, Xcode/signing/entitlements/privacy manifest
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
