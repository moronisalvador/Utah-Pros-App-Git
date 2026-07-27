# UPR Mobile PWA and Capacitor Audit — Capacitor/Native Readiness

## Verdict

The checked-in Capacitor iOS application is a meaningful native wrapper, not empty scaffolding, but it
is **not production-ready**. Camera/location/keyboard/haptics/biometric/updater/push integrations and
an iOS project exist; release automation, credential protection, privacy lifecycle, push delivery,
deep links, OTA rollback semantics, and signed-device evidence do not meet the production bar.

## Capacitor architecture

`capacitor.config.json` packages the Vite `dist` directory for app ID
`com.utahprosrestoration.upr` and does not
configure a remote `server.url`. That is a strong boundary: the binary loads a bundled application
rather than silently becoming a remote website wrapper.

The native Vite target selects `NativeRoutes` in `src/App.jsx`. It includes login, password recovery,
public signing, and the same `TechRoutes` used by the web app; root and unknown routes redirect to
`/tech`.

The checked-in native platform is iOS under `ios/App/`. Capacitor core/native packages are aligned at
8.3.1 and the native minimum is consistent with Capacitor 8. There is no checked-in Android project.

## Configuration and plugin inventory

### JavaScript/native capability wrappers

| Capability | Source | Readiness |
|---|---|---|
| Camera | `src/lib/nativeCamera.js` | implemented; device permission/capture proof missing |
| Geolocation | `src/lib/nativeGeolocation.js` | implemented; accuracy/denial/resume proof missing |
| Haptics | `src/lib/nativeHaptics.js` | impact/notification paths exist; selection lifecycle is ineffective |
| Keyboard | `src/lib/nativeKeyboard.js` | one-time configuration; device composer/form proof missing |
| Appearance/splash | `src/lib/nativeAppearance.js` | wrapper exists; launch proof missing |
| Biometrics | `src/lib/nativeBiometric.js`, `BiometricGate` | UI gate only; token remains in WebView storage (`MOB-SEC-016`) |
| Privacy screen | `enablePrivacyScreen()` | no-op (`MOB-PRIV-009`) |
| Updater | `src/lib/nativeUpdater.js`, `main.jsx`, `App.jsx` | Capgo configured; readiness acknowledged too early (`MOB-OTA-019`) |
| Push | `src/lib/pushNotifications.js` | permission/register/token upsert only; lifecycle/dispatch incomplete |
| Deep links/app lifecycle | AppDelegate forwarding only | JavaScript App-plugin routing absent (`MOB-NATIVE-022`) |

The absence of a direct `@capacitor/app` dependency and native App product is material: AppDelegate
forwards callbacks to Capacitor, but there is no `appUrlOpen`/`getLaunchUrl` listener to turn them into
safe application routes.

## Permissions and privacy declarations

`ios/App/App/Info.plist:29-38` contains camera, photo-library read/add, location-when-in-use, and Face
ID descriptions. iPhone is portrait-only; iPad declares portrait and landscape.

The repository includes `ios/App/App/PrivacyInfo.xcprivacy`, declaring no tracking and a UserDefaults
reason. The Xcode project has no `PrivacyInfo` file reference or Resources-phase entry, so the intended
app-level privacy manifest is not part of the checked-in target (`MOB-NATIVE-021`). Archive contents
and App Store acceptance were not verified.

The checked-in entitlement contains `aps-environment=development`. Distribution signing may replace
or validate this through the provisioning profile; the audited source is not evidence of the final
archive. Codesign/entitlement inspection is mandatory.

## Session and biometric lifecycle

The Supabase JS client persists sessions without a native storage adapter
(`src/lib/realtime.js:16-27`). `src/lib/nativeBiometric.js:1-5` explicitly documents that the token
remains in localStorage and Face ID only unlocks the UI.

The gate opens when biometrics are unavailable/disabled and opens on general exceptions
(`src/App.jsx:543-563`). If verification fails, sign-out is attempted; if sign-out throws, the outer
catch still opens the app over the existing session. This is `MOB-SEC-016` (P1).

The app-switcher privacy function is a no-op even though the application displays claim, customer,
message, employee, and financial information (`MOB-PRIV-009`). Official Capacitor 8 support is
documented at [Privacy Screen](https://capacitorjs.com/docs/apis/privacy-screen).

## Push notifications

### Registration

After login, AuthContext invokes native push registration without blocking login. The wrapper requests
permission, listens for APNs registration/error, applies a 15-second timeout, and upserts a device
token.

Logout clears Supabase/React/biometric state but does not delete or unregister the APNs token.
`delete_device_token` exists in repository database artifacts, but no application call site uses it.
This leaves a logged-out, lost, shared, or reassigned device associated with the prior employee and
targetable if a native dispatch path is used; no logged-out delivery was attempted
(`MOB-PUSH-017`).

### Delivery and interaction

The central notification dispatcher sends Web Push subscriptions, not native device tokens. A manual
`/api/send-push` endpoint exists, but no normal repository caller was found. It:

- defaults to APNs sandbox even though distribution/TestFlight devices use production APNs;
- can delete tokens on `BadDeviceToken`, making environment misconfiguration destructive;
- has no request timeout/retry;
- uses immediate expiration, discarding temporarily undeliverable notifications.

The client has no foreground-received or notification-action listener. This is `MOB-NATIVE-023` and
is a P1 blocker if native notifications are a promised release capability. Apple environment guidance
is summarized in [TN2265](https://developer.apple.com/library/archive/technotes/tn2265/_index.html).

## Deep links and native navigation

AppDelegate forwards custom URL and universal-link callbacks, which is a useful starting point.
The rest of the contract is absent:

- no URL scheme in Info.plist;
- no Associated Domains entitlement;
- no evidenced Apple App Site Association file;
- no direct App plugin;
- no cold/warm `appUrlOpen` or launch URL handling;
- no push-action routing.

Password recovery and public signing routes exist in the native router, but HTTPS links cannot enter
those routes in the installed app. `MOB-NATIVE-022` is P2 unless recovery/signing/push taps are a
required native launch workflow, in which case it becomes a release blocker. Capacitor guidance:
[App API](https://capacitorjs.com/docs/apis/app) and
[Deep Links](https://capacitorjs.com/docs/guides/deep-links).

## OTA update lifecycle

Capgo configuration uses a hard-coded production default channel and `resetWhenUpdate: false`.
The deployment workflow chooses `production` for main and `beta` otherwise, but binary/channel
assignment and cloud configuration were not verified.

`notifyAppReady()` runs at module load before `createRoot` (`src/main.jsx:50-77`) and again on App
mount. The first call can accept a bundle before React providers, routes, auth, or primary panes are
usable; the later call cannot restore rollback protection. This is `MOB-OTA-019`.

The Capgo workflow is manual-only and its comments record an external plan-limit block. A bad-bundle
rollback and beta/production isolation drill has not been completed. Reference:
[Capgo rollback behavior](https://capgo.app/docs/live-updates/rollbacks/).

## Native build and release readiness

The TestFlight workflow is structurally inconsistent with the checked-in project (`MOB-NATIVE-020`):

- workflow invokes Fastlane from `ios`;
- Fastlane references `App.xcodeproj` and `App.xcworkspace`;
- the project is `ios/App/App.xcodeproj`, and no workspace is checked in;
- workflow supplies App Store Connect key ID/issuer/content, while Fastlane reads an API-key path;
- Fastlane expects a provisioning-profile name not supplied by the workflow;
- `ios/Gemfile.lock` is absent;
- `package.json`'s `build:ios` environment assignment is POSIX syntax and is not ordinary
  PowerShell-compatible.

The existing workflow test checks manual trigger/secret gating, not referenced paths, dependency lock,
archive, signing, upload authentication, or TestFlight install.

`npx cap doctor` observed aligned installed Capacitor 8.3.1 packages but could not complete because
Xcode is unavailable on Windows. It also saw an undeclared Android package inherited from the
dependency-reuse environment; that is not evidence of repository Android support.

## App Store readiness gaps

1. no successful clean Xcode archive, export, codesign/entitlement inspection, or TestFlight install;
2. app privacy manifest absent from the checked-in target; archive result unverified;
3. WebView-local auth tokens and a UI gate whose exception path can fail open;
4. app-switcher privacy protection absent;
5. APNs registration not connected to a safe end-to-end delivery/account lifecycle;
6. deep links/recovery/signing/push taps not routed;
7. OTA readiness and channel isolation not safe/proven;
8. iPhone/iPad device matrix absent;
9. account deletion is not discoverable in the native route tree.

Apple requires in-app deletion when an app supports account creation. UPR's employee-provisioning
model needs an explicit owner/legal/App Review determination. The safest implementation is a
discoverable native deletion/request path; until applicability is resolved, `MOB-NATIVE-036` remains
a conditional P1 gate. Reference:
[Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app).

## Native-versus-PWA drift risks

- the same route implementation has different service-worker, deep-link, storage, push, update, and
  permission behavior;
- native bundles include `/tech/admin/*` despite source comments describing a field-only boundary
  (`MOB-ARCH-006`);
- a Capgo bundle can update web code independently of App Store binary/plugin capabilities;
- PWA and native push use different storage and dispatch paths;
- one fixed query-cache buster is shared across release channels;
- no compatibility record binds source SHA, web build, Capgo bundle, binary version, plugin set,
  Supabase migration state, and feature flags.

## Required native release gate

On a clean macOS checkout:

1. install locked Node/Ruby dependencies;
2. build the native target and sync Capacitor;
3. assert all Fastlane/Xcode paths and target membership;
4. archive/export and inspect signature, entitlements, privacy manifest, Info.plist, version, and
   bundled web assets;
5. install through internal TestFlight;
6. run iPhone/iPad auth, camera, photo, location, biometric, privacy, keyboard, background/resume,
   deep-link, push, logout/account-switch, offline queue, and OTA rollback tests;
7. record build/source/database/channel identifiers and rollback procedure.

## Capacitor conclusion

The native project contains enough real integration to justify continued investment, but it cannot be
released responsibly from the repository as written. Treat it as a pre-release integration track
until the P1 native blockers and physical-device release gate are closed.
