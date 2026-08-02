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
EXPLICIT sign-out ALWAYS completes (owner directive 2026-07-29: "a sign out button should just do
that: sign out"): one bounded best-effort cleanup pass runs while the authenticated client exists,
its outcome never gates the sign-out, and unfinished server work normally stays in the durable
owner-bound pending-detach journal (honest limits: broken storage can journal nothing, and a
foreign journal occupying the single slot is itself what walls the next bind — see
`push-activation-owner-gate.md`). The journal is the durable memory: the next same-owner sign-in reconciles
it and a different account is refused at the bind gate before it publishes or enrolls. The only
walls left on the explicit path are a recovery/reauth-owned block and a failed local Supabase
signOut(); observer-only sign-out (signed-out reauth), password recovery, login/account-switch,
and rejected bootstrap keep their hard gates. A durable signed-out-intent marker plus guards at
boot/SIGNED_IN/TOKEN_REFRESHED/recoverSession and a time-boxed post-signOut sweep terminate a
session that a racing token refresh re-persists after sign-out (the 2026-07-29 TestFlight defect
where the app re-entered the account without ever reaching Login); login() clears the marker
immediately before signInWithPassword so real sign-ins — including same-user re-login and web
cross-tab login — are never refused. Accepted consequence (deliberate): a fully "ready" sign-out
can still leave the native provisional-window journal behind, so a DIFFERENT employee's next
sign-in can hit the previous-account wall through the bind gate. Auth observer callbacks return
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
- an owner-approved typed lock-screen payload.

Settings → Notifications exposes Web Push Turn on/Turn off only in the browser
or installed PWA. It reads the current service-worker subscription, requests
permission only from the Turn on gesture, and deletes only that browser
subscription on Turn off. The native app never substitutes APNs for this
control, and the PWA never calls the native plugin.

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
| Updater | `nativeUpdater.js`, `NativeUpdateHealthGate.jsx`, Capgo | official app exact-default-off; isolated UPR Dev canary has late health acknowledgment, channel/binary/cache compatibility, stop and rollback |
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

- preserve the 2026-07-28 owner decision that retained sessions reopen without another biometric
  prompt and manual password sign-in owns Face ID verification; do not present default WebView
  token storage as Keychain-equivalent;
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
Push feedback without exposing notification content. `capacitor.config.json` additionally requests
iOS badge, sound, and alert presentation for a notification received while the native app is in the
foreground. Native APNs alert copy comes from the exhaustive typed,
privacy-conscious event presentation catalog and the action carries only an
allowlisted route plus an opaque recipient binding. Raw producer copy is not an
APNs presentation input. The worker applies the same
pure route/query policy before provider serialization, with an additional
Push-only rejection for the public signing bearer paths `/sign/:token` and
`/s/:code`; unsafe or credential-bearing routes fall back to `/`, so client
rejection is defense in depth. The signing paths remain valid Universal/App
Links but never become Push payload data. The tap is dropped unless that binding
matches the current employee. This native presentation setting
does not alter browser/PWA delivery. Unsafe, external, and admin targets fail
closed.

The remaining gate is compiled-plugin and installed-device proof across cold, warm, background,
terminated, sign-in/account switch, recovery/signing, and unsaved-work/back behavior.

## Native push

Native Push enrollment runs only when `VITE_NATIVE_PUSH_ENABLED` is exactly
`true` and `VITE_APNS_ENV` is exactly `sandbox` or `production`; the example
release posture remains disabled. Listener setup is independent of enrollment
and never requests permission/registers. Foreground receipt emits only a
constant refresh signal; an explicit tap passes one normalized allowlisted
route to the shared native coordinator. The native Capacitor configuration
allows the operating system to present badge, sound, and alert in the
foreground, while the listener continues to avoid notification content.
Native user intent is owner-lease-bound, so another account on the same phone
defaults off; account cleanup also removes delivered iOS notifications.
Generic SQLSTATE `42501` is not treated as foreign-token proof—only a parsed
PostgREST body whose top-level `code` and full canonical `message` exactly match
the foreign-owner response may release a provisional cleanup marker. Serialized,
nested, partial-code, or unrelated error text remains journaled.

Server delivery fans one trusted occurrence out to both exact APNs cohorts:
development-signed sandbox tokens and TestFlight/App Store production tokens.
The two provider calls retain separate token selection, hosts, fingerprints,
delivery claims and stale-token pruning. `APNS_ENV` remains mandatory on the
Worker as a fail-closed activation signal; dual delivery does not merge token
environments or change the native build's exact `VITE_APNS_ENV`.

Registration has generation/cancellation guards. Account cleanup invalidates late registration
before awaiting, deletes the old installation's server binding while the old authenticated client
is still available, revokes local delivery, and clears stored token state. Unknown/failed server or
local detach prevents readiness.

Settings → Notifications separately exposes native Turn on/Turn off for the
current app installation when the reviewed native build flags are present. New
installations default off; an existing verified legacy binding remains on
during preference migration; and an explicit off value survives restart and
blocks login bootstrap before permission, registration, or database work.
Turning off writes that intent before any await, unregisters locally, and uses
the existing owner-bound pending-detach journal for server cleanup. A
registration that overlaps Turn off keeps its marker until the upsert settles,
then runs a final owner-scoped delete. The journal distinguishes a provisional
enrollment from a confirmed binding: a definitive `42501` can release a
provisional marker that never became owned, while a network-ambiguous write
keeps its marker through the immediate delete and requires a later,
same-owner reconciliation after a 60-second safety window. A failed explicit
Turn on returns the durable intent to off. Settings silently refreshes iOS
permission on resume and distinguishes verified delivery from blocked,
unknown, and cleanup-pending states. The status helper never returns the APNs
token.

The focused `20260728223000_native_apns_token_boundary.sql` source makes raw
native tokens browser-inaccessible, derives the current active internal
employee inside selector-free enrollment/deletion RPCs, and separates sandbox
from production. Foreign ownership raises `42501`; existing environment-unknown
rows stay inert. The ordered
`20260728224000_native_push_delivery_guardrails.sql` source additionally closes
cross-employee preference mutation, bounds installations/fanout, durably claims
each source-event/device-fingerprint delivery independently of registration-row
deletion, and compare-and-deletes stale tokens. Direct producers must provide a
durable occurrence ID; explicit APNs 429/5xx refusal is retried once after
release/reclaim, and an exhausted outbox refusal persists as native-only to
avoid repeating other channels, while network ambiguity stays claimed. Their
isolated behavioral matrices pass. Both focused migrations were applied and
live-catalog verified on 2026-07-28; their exact live ledger versions and
source hashes are recorded in `docs/mobile/push-activation-owner-gate.md`. The
broader S1h source remains unapplied and is not required for this focused
activation; its preflight must be reconciled after the focused preference
boundary changes the expected input.

Do not enable native push until both focused migrations are live and:

- installation/account/APNs environment are bound;
- token rotation/logout/revocation/reinstall are handled;
- dispatcher enforces event/audience/content authorization;
- provider requests have timeout/retry/expiry/idempotency;
- foreground/action/tap listeners route safely;
- sandbox and TestFlight production delivery are verified;
- lock-screen payload/privacy policy is approved.

## OTA update boundary

The legacy `.github/workflows/capgo-deploy.yml` remains hard-disabled and is
still the production boundary: it cannot upload to `main`/production or its old
beta channel. The checked-in `capacitor.config.json` likewise keeps the official
`com.utahprosrestoration.upr` updater `autoUpdate:false`, with no default
channel. No production Capgo app/channel is activated by the UPR Dev work.

The isolated UPR Dev path is now explicit:

- `scripts/configure-ios-capgo-dev.mjs` patches only Capacitor's gitignored
  generated iOS config after a dev sync, selects
  `com.utahprosrestoration.upr.dev`/`upr-dev-canary`, requires the v2 public
  verification key, and locks channel/app/server mutation;
- `.github/workflows/ios-dev-testflight.yml` enables OTA only in the UPR Dev
  archive and verifies the embedded generated config in the signed archive/IPA;
- `NativeUpdateHealthGate.jsx` is inside the native route Suspense boundary and
  calls `markBundleReady({ healthVerified:true })` only after auth bootstrap is
  complete, unexpired, error-free, the selected lazy route has committed, and no
  React route error boundary has caught a launch render failure;
- `.github/workflows/capgo-dev.yml` is manual, `dev`-only, isolated-environment
  gated, v2-encrypted, and supports credential-free validation, channel
  compatibility checking, unassigned bundle staging, and future-delivery
  disable operations. Channel assignment/device delivery is a separate exact
  gate; rollback remains blocked until a provenance-bound allowlist exists.

The native build prunes `sw.js` and `manifest.json`; Capgo replaces the bundled
web asset root, so there is no second service-worker fetch cache competing with
the updater. `directUpdate` remains false, newly applied bundles get a 30-second
health window, failed bundles are auto-deleted, and a native-store update resets
older downloaded bundles.

OTA may update only web code compatible with the installed binary/plugin set and live database.
Release gates require:

- beta/production channel ownership and assignment evidence;
- health acknowledgment after providers/auth/primary route are usable;
- binary minimum/maximum compatibility;
- source/database/cache compatibility record;
- bad-bundle/interruption/offline/rollback/downgrade drill;
- installed version/channel telemetry and stop controls.

The setup/run/rollback evidence contract is
`docs/mobile/capgo-dev-runbook.md`. A production channel, paid Capgo plan,
official UPR binary, or production-user delivery remains a separate exact owner
approval.

## Store and release boundary

The manual `main`-only iOS workflow pins Xcode 26.6, Node 22.23.1, Ruby 3.3.12, Bundler 2.5.22 and
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

Reviewed `cap sync ios` output contains `CapacitorApp` and is clean. A distribution-signed
archive/IPA was produced and independently verified from the dirty qualification worktree on
2026-07-28, proving the local signing lane; its report correctly has no source commit, so it is not
the final upload artifact. No clean-source distribution artifact, TestFlight install, complete
physical-device matrix, or App Review proof exists.

Native release requires:

- fixed reproducible macOS pipeline and locked dependencies;
- correct application ID, display/version/build numbers, signing/profile, capabilities/entitlements;
- preserve the reviewed `ios/Gemfile.lock` under Ruby 3.3.12/Bundler 2.5.22;
- preserve reviewed Capacitor sync with `CapacitorApp` present and no unexpected native drift;
- privacy manifest present in the built artifact and declarations reconciled with plugins and App
  Store Connect;
- supported-device/orientation policy;
- account-deletion request UI plus approved fulfillment/SLA/retention process;
- physical-device validation and rollback/support runbook.

See [`testing-and-release.md`](testing-and-release.md) for the required evidence.
