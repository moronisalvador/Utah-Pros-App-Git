# UPR Mobile PWA and Capacitor Audit — Testing, Release, and Observability

## Test inventory and observed results

| Layer | Existing coverage/evidence | Audit result | What it does not prove |
|---|---|---|---|
| Unit | component, hooks, selectors, utilities, mobile math/state | 62 files / 762 tests passed | authenticated route E2E or real database policy |
| Worker | Pages Function/auth/provider helpers and behaviors | 89 files / 1,093 tests passed | current provider configuration or every negative role path |
| QA/static | governance and repository checks | 4 files / 16 tests passed | runtime PWA/native behavior |
| Full Vitest lanes | all three safe lanes | 155 files / 1,871 tests passed, 0 unexpected skips | iOS, offline, authenticated workflows, live providers |
| Browser fixture | deterministic credential-free Playwright/axe fixture | 12/12 passed at 390 and 1440, artifact scan safe | UPR routes, sessions, app data, real devices |
| Tooling governance | script tests/validator | 6 passed, 1 environment skip; validator 0 errors, 2 time-limited waivers | product correctness |
| Figma governance | repository governance | 7 passed; validator disconnected with 0 errors | rendered visual fidelity |
| Migration provenance | manifest/ledger checks | 13 tests passed; validator passed with 4 comment/whitespace warnings | authorization semantics of every RPC/policy |
| Build | web and native-target Vite build-only | both passed | Capacitor sync, Xcode compile, signing, install |
| Lint | ESLint | full: 209 errors/119 warnings; targeted mobile: 13 errors/14 warnings | — |
| Dependency audit | production dependency graph | 14 advisories: 1 critical, 8 high, 5 moderate | reachability/exploitability |
| Type check | no script/TS project | not available | static type safety |
| Capacitor doctor | installed dependency/project inspection | stopped at missing Xcode; exit 1 | archive/device/store readiness |

No test wrote production data. Existing integration tests that depend on live authorization were not
reinterpreted as product failures when their harness identity could not satisfy current RLS.

## Strong existing coverage

- large deterministic unit/worker suite with explicit QA lanes;
- negative and failure-path tests in several money, messaging, offline, media, and release helpers;
- isolated browser fixture with axe and artifact safety scanning;
- migration provenance and governance validators;
- web/native build separation and route-level lazy compilation;
- service-worker stale-chunk/reset recovery tests and comments preserving the prior incident lesson;
- paused/manual native release workflows rather than automatic release from an unready scaffold.

## Critical automated gaps

1. database-level negative authorization for field, admin-mobile, QBO, notifications, CallRail
   recordings, e-sign, Storage, and every necessary `SECURITY DEFINER` contract;
2. authenticated mobile end-to-end journeys through loading/error/empty/permission states;
3. account switch/logout with persisted queries, drafts, offline work, route restoration, and push;
4. process termination during each queue status transition and multi-tab atomic claim;
5. ambiguous response/idempotency tests for photo, clock, appointment, customer/job, message, money,
   and provider side effects;
6. cold/warm offline launch, storage eviction, service-worker flag change, stale asset, partial
   deploy, fixed cache-buster, and rollback;
7. PWA install, launcher/icon, notification delivery/tap, Android back, and iOS limitations;
8. signed iOS archive/TestFlight device tests for permissions, privacy, lifecycle, deep links,
   push, credentials, and OTA rollback;
9. authenticated axe plus VoiceOver/TalkBack, keyboard, zoom/Dynamic Type, and the seven required
   widths;
10. growth/query-plan/slow-network and client performance budgets.

`MOB-TEST-025` is a P1 release-validation gate. It does not say the untested paths are necessarily
broken; it says they cannot support a production-readiness claim.

## Safe verification commands

The audit used only build-only, static, local-test, dependency-read, and read-only metadata commands.
The detailed command/result ledger is `16-validation-log.md`. The normal safe pre-release set is:

```text
npm ci
npm test
npm run lint
npm run build
VITE_BUILD_TARGET=native npx vite build
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
npx cap doctor
```

The native-target syntax shown above is conceptual on Windows; set the environment through
PowerShell or the CI `env` block. Do not use `npm run build:ios` on Windows or during a read-only
audit because it includes `cap sync ios` and its inline environment assignment is POSIX syntax.

## Web/PWA release process

Cloudflare Pages builds Vite from `dev` for staging and `main` for production, while both connect to
one Supabase project. Hashed assets plus non-cached HTML and a push-only service worker reduce stale
bundle risk. Reset endpoints and one-time stale-chunk recovery provide a useful escape hatch.

Release gaps (`MOB-OPS-035`):

- CI marks lint and performance reporting non-blocking
  (`.github/workflows/ci.yml:88-113`);
- the build can compile with undefined frontend environment values; there is no blocking
  configuration schema/health assertion;
- the performance step reports concatenated gzip, not entry/route/CSS budgets;
- deployment is not evidenced as depending on successful security, provenance, mobile browser, or
  device gates;
- branch-protection and Cloudflare required-check configuration are external and were not verified;
- no release record binds source SHA, asset build, feature flags, live database ledger, installed
  client/cache compatibility, and rollback.

The web rollback unit is incomplete: reverting source does not reverse an already applied shared
database change, clear an incompatible persisted query shape, recall a Capgo bundle, or detach a
bad push subscription.

## Capacitor and OTA release process

The TestFlight workflow is manual and explicitly paused, which prevents accidental shipment. It
cannot currently produce a release:

- Fastlane runs from `ios` but references `App.xcodeproj`/`App.xcworkspace`; the checked-in project
  is `ios/App/App.xcodeproj`, with no workspace;
- workflow and Fastlane App Store Connect credential inputs do not match;
- required provisioning-profile name is not supplied;
- `ios/Gemfile.lock` is absent;
- privacy manifest target membership is missing;
- no archive/sign/export/TestFlight/device proof exists.

These defects are `MOB-NATIVE-020`, `MOB-NATIVE-021`, and `MOB-TEST-025`.

Capgo deployment is manual and paused for a recorded plan-limit issue. It computes a SHA-derived
bundle version and separates beta/production names, which is a useful start. The client has a
hard-coded default production channel, `resetWhenUpdate: false`, and acknowledges readiness before
React is proven usable (`MOB-OTA-019`). No rollback/channel-isolation drill or binary/plugin
compatibility gate is recorded.

## Observability and support diagnostics

### Present

- local user-facing toasts and retry/empty/error components;
- ErrorBoundary/stale-chunk recovery on many routes;
- worker run/audit records in selected integrations;
- provider transaction IDs/status details in several worker responses;
- offline queue counts and local retry state;
- CI artifacts and deterministic test outputs.

### Missing or unverified

- centralized frontend exception/session/breadcrumb reporting;
- coverage of persistent primary panes by a local crash boundary;
- native crash and watchdog/termination telemetry;
- source-map upload and release correlation;
- Web Vitals/route latency/long-task/memory monitoring;
- offline queue age, stuck-syncing, retry, orphaned-blob, and account-owner diagnostics;
- PWA/native installed version, service-worker, cache-buster, binary, and Capgo-channel visibility;
- push subscription/delivery/tap health split by web/APNs environment;
- privacy-preserving support export and incident runbook;
- verified retention/access controls for logs that may contain customer data.

This is `MOB-OBS-024` (P1). Existing external dashboards may provide part of this capability, but no
configuration evidence was available and repository code cannot substitute for that proof.

## Required release gates

### Gate A — containment and contract

- close `MOB-SEC-014` and `MOB-SEC-015` with negative role/assignment/anonymous tests;
- resolve all P1 data ownership, queue, mutation, credential, privacy, push, and OTA findings;
- bind reviewed source to generated/live Supabase provenance and a rollback-compatible contract.

### Gate B — blocking automation

- clean or ratchet lint so changed mobile/worker files are blocking;
- enforce entry JS, route chunk, CSS, dependency, provenance, and required-test budgets;
- fail closed on missing/invalid environment configuration;
- require CI before staging/production/OTA/native release.

### Gate C — staging and installed PWA

- safe synthetic authenticated accounts/data only;
- seven-width browser matrix plus iOS/Android install, launch, update, offline, notification, account
  switch, and reset;
- record source/build/database/flag identifiers and sanitized evidence.

### Gate D — signed native

- clean macOS install, Capacitor sync, Xcode archive/export, signature/entitlement/privacy-manifest
  inspection;
- internal TestFlight on representative iPhone/iPad;
- auth/secure storage/biometric/privacy, camera/location/keyboard, background/termination,
  deep-link/push, offline queue, account switch, and OTA beta/production/rollback;
- owner approval of account-deletion and supported-device policy.

### Gate E — controlled release and rollback

- small named internal pilot with no dependency on unsupported offline workflows;
- live error/update/queue/push dashboards and support runbook;
- rehearsed source, feature-flag, PWA reset, provider, database, Capgo, and App Store rollback
  boundaries;
- post-release verification and explicit stop criteria.

## Release-readiness conclusion

Repository tests are a strong asset, and the paused native workflows correctly avoid accidental
release. They do not presently gate the highest-risk authorization, offline, installed-client, or
signed-native paths. A future developer cannot safely ship the PWA or Capacitor application from
repository documentation and automation alone until the release gates above are implemented and
evidenced.
