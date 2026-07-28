<!--
FILE: docs/mobile/pwa-and-capacitor.md

WHAT THIS DOES (plain language):
  Defines the current PWA and Capacitor architecture, honest offline/install/update expectations,
  native capability boundaries, and release gates.

DEPENDS ON:
  Internal: public/manifest.json, public/sw.js, public/sw-target.js,
            src/lib/pwaAccountState.js, src/lib/pwaServiceWorker.js,
            src/components/NativeNavigationBridge.jsx, src/lib/native*.js,
            src/lib/pushNotifications.js, capacitor.config.json, ios/,
            .github/workflows/capgo-deploy.yml, .github/workflows/ios-release.yml
  Data:     reads → mobile configuration and release contracts
            writes → documentation only

NOTES / GOTCHAS:
  - PWA install candidate, installed-device proof, and offline capability are distinct claims.
  - Never run cap sync or edit generated native projects during a read-only audit.
-->

# PWA and Capacitor

## Product boundaries

| Capability | Current repository-supported statement |
|---|---|
| Mobile browser | Field routes are responsive/mobile-first and served by the web application. |
| Installed PWA | Manifest, install guidance, standalone detection, route restoration, push SW, and reset recovery exist; actual supported-device lifecycle requires verification. |
| Offline | Network is required for reliable cold start and every field write. Warm cached reads may exist; automatic command admission/replay is disabled. |
| Capacitor iOS | A field-only bundled-asset source exists with privacy/navigation/account controls; it is not release-ready until dependency sync, locked build, signing, TestFlight, and physical-device gates pass. |
| Capacitor Android | Not currently supported by checked-in source; no Android platform folder exists. |

Do not call a web build, fixture test, manifest parse, Capacitor wrapper, or successful plugin import
“mobile production-ready.” Each claim has its own evidence.

## PWA architecture

### Manifest and installation

`public/manifest.json` declares name/short name/description, stable `/tech` identity, `/` scope,
standalone display, theme/background colors, portrait orientation, and RGB PNG 192/512
any-purpose plus maskable assets. `index.html` references a 180×180 Apple touch icon.

`TechLayout` handles:

- `beforeinstallprompt` capture and Chromium/Android prompt;
- iOS Add-to-Home-Screen instructions;
- standalone detection and session-scoped banner dismissal;
- field-tech-only display of the install prompt.

The source asset dimensions/types and manifest references are checked locally. Supported-device
install/repeat-launch/upgrade appearance, mask cropping, storage eviction, and fleet/version
telemetry remain release evidence rather than source claims.

Installation produces the same field route tree and data contracts as the browser; it does not
create a separate offline backend.

### Service worker

`public/sw.js` is deliberately **push only**:

- `install` calls `skipWaiting`;
- `activate` claims clients;
- `push` displays a notification;
- `notificationclick` focuses/navigates or opens a window;
- there is no `fetch` handler and no application precache/runtime cache.

This is load-bearing incident prevention: an earlier fetch-caching worker stored HTML under hashed
JS URLs and stranded iOS clients. Do not add generic cache-first/network-fallback behavior.

Registration is mirrored from `feature:web_push` through an identity-free pre-auth localStorage
intent. `pwaServiceWorker.js` serializes the latest policy, bounds lookup/readiness/register/
unregister/cache operations, rejects an unexpected same-origin worker, and repairs late
settlements. When disabled, it unregisters every same-origin worker, clears Cache API entries, and
requests a guarded reset bounce when browser state changed.

`public/sw-target.js` applies a deny-by-default same-origin route/query allowlist at both receipt and
tap time. Unknown, malformed, encoded-path, external, credential-bearing, or fragment targets fall
back to `/tech`; raw payload metadata is not retained as a second URL override.

### HTTP caching and recovery

Current intended headers:

- HTML/root/service worker: no-store/no-cache;
- content-hashed `/assets/*`: one-year immutable;
- `/reset` and `/reset.html`: no-store plus cache-clearing response.

ErrorBoundary/stale-chunk helpers offer a bounded one-time reload/reset path. Reset is intentionally
different from account-data cleanup; it does not by itself solve query/draft/queue ownership.

`public/_headers` is the single checked-in build input. It applies `nosniff`, referrer and
permissions policy, no-store/no-cache to HTML/SW/manifest/reset, short JSON caching to AASA, and
one-year immutable caching only to hashed assets. The obsolete root duplicate is removed.

### Offline expectations

Supported current statement:

> UPR requires network to start reliably and to perform every field write. A previously loaded
> build may show cached data, but no field mutation queues.

Warm behavior:

- most eligible TanStack Query results persist up to 24 hours;
- standalone route restoration can reopen a recent field route;
- already loaded route assets may remain available under browser control;
- every field write is online-only; the initial release admits and replays zero automatic offline
  commands.

Account/lifecycle source guarantees:

- query, saved-route, queue, blob/cache, temporary-ID, and Push state is bound to an opaque owner
  plus exact login epoch;
- account change synchronously suspends old query/offline writers before any await;
- prior readable query/route state is cleared and foreign/legacy durable offline state is
  quarantined before a new owner is published;
- Web Push and native token detachment run while the old authenticated client is still available,
  and uncertain lookup/server/local cleanup fails closed;
- opaque owner-bound Web/APNs pending-detach journals retain only the endpoint/token and local
  cleanup proof needed across crash/reload; they clear only after server void-delete plus local
  unsubscribe/unregister/storage cleanup. A mismatched new account is signed out locally and cannot
  use its credentials to consume the old account's journal.

Auth source now gates rejected-bootstrap Login on ready device cleanup plus strictly verified local
Supabase sign-out, validates employee/permission/page-access/feature-flag response values before
publishing authority, and gates SetPassword on cleanup while preserving the recovery session.
Failure or malformed sign-out stays behind a retry hard lock. Auth observer callbacks now return
synchronously and feed a serialized next-macrotask queue, preventing cleanup/sign-out from
deadlocking on the SDK observer lock. Independent review is clean; browser/device proof remains.

Not guaranteed:

- fresh/evicted cold launch;
- every route asset/font;
- current data;
- every mutation;
- behavior after browser storage eviction/quota pressure.

Automatic command admission/replay is disabled: the hook has no enqueue/retry API and the runner
imports no dispatchers. Photo, reading, equipment placement/removal, room, note, and task writes
require connectivity and fail before local persistence when offline.

IndexedDB v3 remains only to contain historical local state. It counts/quarantines owner rows in
every store without reading payloads or blobs, blocks rollout on inspection failure or any
legacy/unsupported residue, and never adopts unknown work. The user-visible escape is a two-click,
exact-confirmation discard of every offline store on the device. Open waits are bounded with typed
retry guidance; blocking/version-change callbacks close only their captured connection generation.
Historical completed-photo cleanup is never sent and uses bounded retry-limited, time-rotating,
key-only owner maintenance. Hidden documents neither poll nor run maintenance.

At the 2026-07-27 offline-remediation checkpoint (`3da70e5`), focused zero-replay tests passed
58/58, the complete unit lane passed 90 files/1079 tests, Worker passed 99 files/1476 tests, QA
passed 25 files/206 tests, and web/native builds passed. Full lint reported 310 findings; the
changed-file ratchet was tracked separately. Independent review found no actionable offline P0/P1. Real multi-tab/upgrade and
representative device proof remain additional gates.

Any broader offline promise requires an owner-approved workflow matrix, private-data threat model,
versioned allowlisted shell strategy, and fresh/evicted/update/rollback testing. Avoid repeating the
prior cache-poisoning failure.

### Query cache and updates

`releaseIdentity.js` derives a privacy-safe release label from the injected source SHA and build
target, while a separately versioned cache-compatibility ID controls persisted-query reuse. CI/
Cloudflare builds fail when a release SHA is required but absent. Future full release manifests
still need to bind:

```text
source SHA + web/native target + app/cache compatibility ID
+ live database contract/migration snapshot + feature flags
+ binary/plugin set + Capgo channel/bundle (native)
```

Not every deploy discards a compatible cache. A shape-breaking change deliberately bumps
`CACHE_COMPATIBILITY_VERSION`; target isolation already keeps web/native cache identities distinct.
Old-cache/new-bundle, rollback, account switch, storage eviction, partial asset availability, and
reset still need installed-client qualification.

### Web Push

PWA push and native APNs are distinct channels. Web Push requires:

- supported installed/browser context (notably Home Screen installation on iOS);
- permission initiated from a user gesture;
- authenticated account/device attachment and logout detachment;
- governed event/audience/content and same-origin tap route;
- configured VAPID and delivery/expiry/retry health;
- privacy-safe lock-screen payload.

Service-worker source and permission UI are not delivery proof.

## Capacitor architecture

`capacitor.config.json` packages local `dist` assets under application ID
`com.utahprosrestoration.upr`; no remote `server.url` is configured. `VITE_BUILD_TARGET=native`
selects the native route tree. The checked-in platform is `ios/App/`.

Capacitor core/CLI/iOS versions are aligned at 8.3.1 in repository dependencies. Native/plugin
compatibility must be verified from a clean locked install and Xcode build; locally inherited
undeclared packages are not support evidence.

## Platform synchronization

`cap sync ios` mutates generated native project/assets and is a release/build step, not a routine
read-only validation. `@capacitor/app` is a direct package dependency and the checked-in managed
`ios/App/CapApp-SPM/Package.swift` now includes `CapacitorApp`. Repeated reviewed syncs on
2026-07-28 produced no tracked drift. Do not hand-edit the managed package file.

Required sequence on a clean macOS checkout:

1. install locked JS/Ruby dependencies;
2. build with `VITE_BUILD_TARGET=native`;
3. run `npx cap sync ios`;
4. review the exact native diff/generated configuration;
5. compile/archive/export in Xcode;
6. inspect the produced `.app`/archive;
7. install through internal TestFlight and run the device matrix.

Do not commit incidental native-project changes from an unrelated audit or dependency experiment.

## Native plugins and permissions

| Capability | Current boundary | Release requirement |
|---|---|---|
| Camera/photo | `nativeCamera.js`, Camera plugin, shared compression | denial/limited library/capture/large media/background proof |
| Geolocation | `nativeGeolocation.js` | accuracy, denial, timeout, resume and privacy copy |
| Haptics | `nativeHaptics.js` | supported impact/notification/selection lifecycle on device |
| Keyboard | `nativeKeyboard.js` | composer/long-form visual viewport, safe dock, rotation |
| Status/splash/appearance | native appearance/status/splash helpers | launch/theme/background/resume proof |
| Biometrics | `nativeLoginVerification.js` plus `nativeBiometric.js` | manual native password sign-in verification; cancel/error/unavailable/revocation and retained-session reopen |
| Privacy screen | native opaque shield in `AppDelegate.swift` before resign/background | app-switcher/device proof; deliberate active screenshots are not blocked |
| Updater | `nativeUpdater.js`, Capgo | exact-default-off; future late health acknowledgment, channel/binary/database compatibility, rollback |
| Push | `pushNotifications.js` + mounted bridge | exact-default-off enrollment; attach/detach, provider environment and signed-device delivery proof |
| App/deep links | URL scheme, Associated Domains/AASA, App-plugin cold/warm listener, allowlisted coordinator | reviewed Capacitor sync plus installed Universal/custom/recovery/signing/push-action matrix |

`Info.plist` contains camera, photo read/add, location-when-in-use, and Face ID descriptions. iPhone
is portrait; iPad also permits landscape. A usage string is not runtime permission handling or
device proof.

Microphone, file, sharing, preview, download, external URL, and other capabilities must not be
claimed merely because the WebView/browser offers a partial path. Document and test each product
capability before adding a plugin.

## Native session and privacy

Supabase still persists the bearer session in default WebView storage. Native biometrics now run
only at the manual password sign-in boundary, after prior-account cleanup and before Supabase
publishes a new session. Cancellation or verification failure blocks that sign-in; unavailable or
unenrolled biometry preserves password sign-in. Retained authenticated sessions reopen without a
biometric challenge. Account cleanup still runs before local sign-out while the old session can
detach Push state. `AppDelegate.swift` separately installs an opaque native privacy shield before
resign/background and removes it only after the app becomes active.

Before native release:

- decide whether default WebView session storage plus sign-in-time biometric verification is the
  approved release policy or whether Keychain-backed session work is required;
- verify lost/shared/reassigned/disabled-user behavior on signed devices.

## Deep links and app lifecycle

The native route tree preserves `/sign/:token` and `/s/:code`, recovery, and public legal/support
routes. Source now declares the app URL scheme, production/staging Associated Domains, a matching
AASA field-route list that excludes `/tech/admin`, AppDelegate callback forwarding, and one mounted
App-plugin/Push listener bridge.

`nativeAppLinks.js` accepts only the exact custom scheme/host, production/staging HTTPS hosts,
allowlisted field/public paths, and route-specific query/hash shapes. Recovery fragments are
validated but never queued/logged/persisted. `nativeNavigationCoordinator.js` retains at most the
latest protected Universal Link until the verified employee plus owner lease is ready, drops it on
account change, requires an already-ready account for Push actions, and uses generic foreground
Push feedback without exposing notification content. Unsafe/external/admin targets fail closed.

The remaining gate is compiled-plugin and installed-device proof across cold, warm, background,
terminated, sign-in/account switch, recovery/signing, and unsaved-work/back behavior.

## Native push

Native Push enrollment runs only when `VITE_NATIVE_PUSH_ENABLED` is exactly `true`; the example and
release posture are `false`. Listener setup is independent of enrollment and never requests
permission/registers. Foreground receipt emits only a constant refresh signal; an explicit tap
passes one normalized allowlisted route to the shared native coordinator.

Registration has generation/cancellation guards. Account cleanup invalidates late registration
before awaiting, deletes the old installation's server binding while the old authenticated client
is still available, revokes local delivery, and clears stored token state. Unknown/failed server or
local detach prevents readiness.

The hardened S1h source makes all raw token tables browser-inaccessible and permits browser
endpoint/token refresh only for the same current owner; foreign ownership raises `42501`.
Service-role dispatch/prune compatibility remains. S1h is unapplied and not exact
database-behavior-verified, so the deployed database contract remains an independent blocker.

Do not enable native push until:

- installation/account/APNs environment are bound;
- token rotation/logout/revocation/reinstall are handled;
- dispatcher enforces event/audience/content authorization;
- provider requests have timeout/retry/expiry/idempotency;
- foreground/action/tap listeners route safely;
- sandbox and TestFlight production delivery are verified;
- lock-screen payload/privacy policy is approved.

## OTA update boundary

Capgo workflow is manual/paused and derives a SHA-qualified bundle upload version.
`CapacitorUpdater.autoUpdate` is `false` and `VITE_NATIVE_OTA_ENABLED` must be exactly `true` before
client updater calls run. No boot path calls `notifyAppReady()`: `markBundleReady()` refuses unless
the caller supplies `healthVerified: true`, but the future explicit health checkpoint and call site
do not exist. This is intentional default-off safety, not an OTA-ready rollout.

OTA may update only web code compatible with the installed binary/plugin set and live database.
Release gates require:

- beta/production channel ownership and assignment evidence;
- health acknowledgment after providers/auth/primary route are usable;
- binary minimum/maximum compatibility;
- source/database/cache compatibility record;
- bad-bundle/interruption/offline/rollback/downgrade drill;
- installed version/channel telemetry and stop controls.

## Store and release boundary

The manual `main`-only iOS workflow pins Xcode 26.6, Node 22.23.1, Ruby 3.3.12, Bundler 4.0.16 and
Fastlane 2.237.0; separates verified archive creation from optional TestFlight upload; and verifies
codesign, provisioning, build identity, bundle hashes, entitlements, encryption, and privacy
manifest contents. The checked-in `ios/Gemfile.lock` supplies the reviewed Ruby dependency lock.
`ios/App/Version.xcconfig` is the single marketing-version source, while the workflow assigns the
unique App Store build number from the GitHub run number and attempt. Native Settings reads the
installed version and build from Capacitor `App.getInfo()`.

`PrivacyInfo.xcprivacy` is registered in the app target. It declares no tracking, UserDefaults
reason `CA92.1`, and exactly 12 linked/non-tracking App Functionality types: precise location,
photos/videos, name, email, phone, physical address, user ID, emails/text messages, customer
support, other user content, device ID, and Other Financial Info for saved OOP quote costs, totals,
and margin. The artifact verifier pins those exact declarations; privacy-owner review against the
exact signed build and App Store Connect entry remain external gates.

Reviewed `cap sync ios` output contains `CapacitorApp` and is clean. No clean distribution-signed
archive, TestFlight install, complete physical-device matrix, or App Review proof exists.

Native release requires:

- fixed reproducible macOS pipeline and locked dependencies;
- correct application ID, display/version/build numbers, signing/profile, capabilities/entitlements;
- preserve the reviewed `ios/Gemfile.lock` under Ruby 3.3.12/Bundler 4.0.16;
- preserve reviewed Capacitor sync with `CapacitorApp` present and no unexpected native drift;
- privacy manifest present in the built artifact and declarations reconciled with plugins and App
  Store Connect;
- supported-device/orientation policy;
- account-deletion request UI plus approved fulfillment/SLA/retention process;
- physical-device validation and rollback/support runbook.

See [`testing-and-release.md`](testing-and-release.md) for the required evidence.
