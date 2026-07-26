<!--
FILE: docs/mobile/pwa-and-capacitor.md

WHAT THIS DOES (plain language):
  Defines the current PWA and Capacitor architecture, honest offline/install/update expectations,
  native capability boundaries, and release gates.

DEPENDS ON:
  Internal: public/manifest.json, public/sw.js, src/lib/registerSW.js,
            src/lib/native*.js, src/lib/pushNotifications.js, capacitor.config.json,
            ios/, .github/workflows/capgo-deploy.yml, .github/workflows/ios-release.yml
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
| Offline | Network is required for reliable cold start. Warm cached data and selected queued mutations exist; general offline capability does not. |
| Capacitor iOS | A bundled-asset iOS integration track exists; it is not release-ready until the signed-device gates below pass. |
| Capacitor Android | Not currently supported by checked-in source; no Android platform folder exists. |

Do not call a web build, fixture test, manifest parse, Capacitor wrapper, or successful plugin import
“mobile production-ready.” Each claim has its own evidence.

## PWA architecture

### Manifest and installation

`public/manifest.json` currently declares name/short name/description, `/tech` start URL, standalone
display, theme/background colors, portrait orientation, and 192/512 SVG icon entries.

`TechLayout` handles:

- `beforeinstallprompt` capture and Chromium/Android prompt;
- iOS Add-to-Home-Screen instructions;
- standalone detection and session-scoped banner dismissal;
- field-tech-only display of the install prompt.

Current limitations:

- no explicit stable manifest `id` or `scope`;
- launcher/maskable/Apple assets are not a verified production suite;
- no observed supported-device install/repeat launch/upgrade evidence;
- no fleet/install/version telemetry.

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

Registration is mirrored from `feature:web_push` through localStorage. When disabled,
`registerSW.js` unregisters workers, clears Cache API entries, and performs a guarded reset bounce if
a registration existed.

Notification target URLs must come from an approved same-origin internal route allowlist; never pass
arbitrary user-controlled URLs into `navigate`/`openWindow`.

### HTTP caching and recovery

Current intended headers:

- HTML/root/service worker: no-store/no-cache;
- content-hashed `/assets/*`: one-year immutable;
- `/reset` and `/reset.html`: no-store plus cache-clearing response.

ErrorBoundary/stale-chunk helpers offer a bounded one-time reload/reset path. Reset is intentionally
different from account-data cleanup; it does not by itself solve query/draft/queue ownership.

There are root and `public/` `_headers` copies with drift risk. `public/_headers` is the build input;
future work should generate or own one canonical source.

### Offline expectations

Supported current statement:

> UPR requires network to start reliably. A previously loaded build may show cached data, and a
> subset of field mutations may queue, but neither cold startup nor every workflow is offline-safe.

Warm behavior:

- most eligible TanStack Query results persist up to 24 hours;
- standalone route restoration can reopen a recent field route;
- already loaded route assets may remain available under browser control;
- selected room/photo/reading/equipment/note/task commands can queue.

Not guaranteed:

- fresh/evicted cold launch;
- every route asset/font;
- current data;
- every mutation;
- account-safe or exactly-once queued work until the canonical queue contract is implemented;
- behavior after browser storage eviction/quota pressure.

Any broader offline promise requires an owner-approved workflow matrix, private-data threat model,
versioned allowlisted shell strategy, and fresh/evicted/update/rollback testing. Avoid repeating the
prior cache-poisoning failure.

### Query cache and updates

Query persistence uses a fixed `BUILD_ID` source literal as its compatibility buster. The target
architecture derives compatibility from a release manifest binding:

```text
source SHA + web/native target + app/cache compatibility ID
+ live database contract/migration snapshot + feature flags
+ binary/plugin set + Capgo channel/bundle (native)
```

Not every deploy must discard safe cache, but the decision must be generated/documented rather than
remembered manually. Test old-cache/new-bundle, rollback, account switch, storage eviction, partial
asset availability, and reset.

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
read-only validation. Required sequence on a clean macOS checkout:

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
| Biometrics | `nativeBiometric.js`, `BiometricGate` | approved secure session/credential policy; cancel/error/unavailable/revocation |
| Privacy screen | current function is a no-op | app-switcher redaction/overlay on pause/resume |
| Updater | `nativeUpdater.js`, Capgo | late health acknowledgment, channel/binary/database compatibility, rollback |
| Push | `pushNotifications.js` | attach/detach, environment, normal dispatch, listener/tap/privacy lifecycle |
| App/deep links | AppDelegate forwarding only | App plugin, schemes/domains/AASA, allowlisted cold/warm resolver |

`Info.plist` contains camera, photo read/add, location-when-in-use, and Face ID descriptions. iPhone
is portrait; iPad also permits landscape. A usage string is not runtime permission handling or
device proof.

Microphone, file, sharing, preview, download, external URL, and other capabilities must not be
claimed merely because the WebView/browser offers a partial path. Document and test each product
capability before adding a plugin.

## Native session and privacy

Supabase currently persists the bearer session in default WebView storage. Biometrics are a UI
unlock preference; normal failed verification attempts sign-out, while exception/sign-out failure
can open the gate. The app-switcher privacy function is a stub.

Before native release:

- decide mandatory versus optional biometric policy;
- use an approved token/key storage/session design;
- fail closed where policy requires;
- clear/quarantine all account-owned cache/draft/queue/route/push state;
- cover snapshots on pause/background;
- verify lost/shared/reassigned/disabled-user behavior on signed devices.

## Deep links and app lifecycle

The route tree has recovery and public signing routes, and AppDelegate forwards native callbacks.
Current source has no complete URL scheme/Associated Domains/AASA/App-plugin launch/warm listener/
push-action resolver.

One canonical resolver must:

- accept only known schemes/hosts and allowlisted internal routes;
- retain the intended route until authentication/profile/permissions are ready;
- reject unsafe/external targets;
- define cold, warm, background, and terminated behavior;
- integrate overlay/back/unsaved-work policy;
- produce privacy-safe diagnostics.

## Native push

Current source registers/upserts a device token after login. Logout does not detach it. Central
notification dispatch uses Web Push, while a separate manual APNs worker is not a complete product
path.

Do not enable native push until:

- installation/account/APNs environment are bound;
- token rotation/logout/revocation/reinstall are handled;
- dispatcher enforces event/audience/content authorization;
- provider requests have timeout/retry/expiry/idempotency;
- foreground/action/tap listeners route safely;
- sandbox and TestFlight production delivery are verified;
- lock-screen payload/privacy policy is approved.

## OTA update boundary

Capgo workflow is manual/paused and derives a SHA-qualified bundle upload version. Current client
configuration/default channel and early readiness acknowledgment do not prove safe rollout.

OTA may update only web code compatible with the installed binary/plugin set and live database.
Release gates require:

- beta/production channel ownership and assignment evidence;
- health acknowledgment after providers/auth/primary route are usable;
- binary minimum/maximum compatibility;
- source/database/cache compatibility record;
- bad-bundle/interruption/offline/rollback/downgrade drill;
- installed version/channel telemetry and stop controls.

## Store and release boundary

The repository's TestFlight workflow is paused scaffolding and currently disagrees with checked-in
project paths/credentials. `PrivacyInfo.xcprivacy` exists but is absent from the checked-in target.
No clean archive, signing, entitlement/privacy inspection, TestFlight install, or App Review proof
exists.

Native release requires:

- fixed reproducible macOS pipeline and locked dependencies;
- correct application ID, display/version/build numbers, signing/profile, capabilities/entitlements;
- privacy manifest present in the built target and declarations reconciled with plugins;
- supported-device/orientation policy;
- resolved account-deletion applicability/path;
- physical-device validation and rollback/support runbook.

See [`testing-and-release.md`](testing-and-release.md) for the required evidence.
