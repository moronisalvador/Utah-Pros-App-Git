<!--
FILE: docs/mobile/dev-app-variant.md

WHAT THIS DOES (plain language):
  Explains the "UPR Dev" side-by-side iOS app: its development-signed direct-device
  lane, internal TestFlight configuration, and isolated Capgo canary.

DEPENDS ON:
  Internal: ios/App/App.xcodeproj (Dev + DevRelease configurations and schemes),
            ios/App/App/App.entitlements, ios/App/App/Info.plist,
            ios/App/App/Assets.xcassets/AppIcon-Dev.appiconset,
            .github/workflows/ios-dev-testflight.yml,
            package.json (build:ios:dev), src/lib/nativeApiOrigin.js,
            docs/mobile/push-activation-owner-gate.md,
            docs/mobile/capgo-dev-runbook.md
  Data:     reads → the SAME shared production Supabase as the production app (see caveat)
            writes → the SAME shared production Supabase as the production app (see caveat)

NOTES / GOTCHAS:
  - This is a UI/native sandbox, NOT a data sandbox. Both apps talk to the one shared
    Supabase project.
  - Never change Cloudflare Preview `APNS_TOPIC`; both environments retain the production bundle
    fallback. The live per-token topic records the dev bundle at enrollment.
-->

# UPR Dev — side-by-side development app variant

**Last verified:** 2026-08-01

The Xcode project carries two configurations for the second app identity:
**Dev** for direct Xcode installation and **DevRelease** for internal TestFlight.
Both install alongside the official UPR app and both keep the amber-badged UPR Dev identity.

| | Official UPR | UPR Dev direct-device | UPR Dev internal TestFlight |
|---|---|---|---|
| Build configuration | `Release` | `Dev` | `DevRelease` |
| Bundle id | `com.utahprosrestoration.upr` | `com.utahprosrestoration.upr.dev` | `com.utahprosrestoration.upr.dev` |
| Display name / icon | UPR / `AppIcon` | UPR Dev / amber `AppIcon-Dev` | UPR Dev / amber `AppIcon-Dev` |
| Signing | Manual Apple Distribution | Automatic development | Manual Apple Distribution |
| Entitlements | production APNs | development APNs | production APNs |
| Web API origin | `https://utahpros.app` | `https://dev.utahpros.app` | `https://dev.utahpros.app` |
| Delivery | manual, owner-gated TestFlight | Xcode run to device + isolated Capgo canary | guarded `ios-dev-testflight.yml` + isolated Capgo canary |

The existing `Debug` and production `Release` configurations remain unchanged. `Dev` is a
development copy with the bundle id, display name, and icon overridden. `DevRelease` is
an isolated optimized distribution configuration: it keeps the `.dev` identity and Dev
branding, uses `App.Release.entitlements`, and accepts only the separate
`UPR_DEV_RELEASE_PROFILE_NAME` build setting. The official production workflow remains
manual/main-only; repository tests lock both contracts.

The display name is per-configuration via the `UPR_APP_DISPLAY_NAME` build setting;
`Info.plist`'s `CFBundleDisplayName` is `$(UPR_APP_DISPLAY_NAME)` and resolves to `UPR`
for Debug/Release and `UPR Dev` for Dev/DevRelease. No other Info.plist value
varies by configuration.

## Building and installing (owner flow)

From the `dev` branch:

```bash
npm run build:ios:dev
```

That existing script keeps OTA off. For an explicitly Capgo-enabled development
build, use `npm run build:ios:dev:capgo`; it builds with exact sandbox Push and
OTA flags, runs `cap sync ios`, and then applies
`scripts/configure-ios-capgo-dev.mjs` to the gitignored generated iOS
configuration. The Capgo form requires the public v2 verification key as
`CAPGO_DEV_PUBLIC_KEY_V2`; the private key is never used for a device build.
It deliberately sets **no `VITE_NATIVE_API_ORIGIN`** — `src/lib/nativeApiOrigin.js`
defaults a native build to `https://dev.utahpros.app`, which is exactly where the dev app
should send its `/api/*` calls. Don't export `VITE_NATIVE_API_ORIGIN` (or put it in
`.env.local`) when building this variant. `VITE_APNS_ENV=sandbox` matches the
development `aps-environment` entitlement; `VITE_NATIVE_PUSH_ENABLED=true` lets the
Settings → Notifications native toggle enroll (enrollment itself stays fail-closed and
user-initiated).

Then the one-command path (preferred — builds, installs, and launches over Wi-Fi/cable
with the **stable CLI toolchain**; phone unlocked, same Wi-Fi or cabled):

```bash
npm run ios:dev
```

(`scripts/install-ios-dev.mjs`; it runs `build:ios:dev` itself, so the first command
above is only needed standalone. Multiple devices connected → set
`UPR_DEV_DEVICE_UDID`.)

The Xcode GUI alternative (scheme **UPR Dev** + your iPhone, ⌘R) works ONLY from a
stable Xcode — on a Mac whose GUI Xcode is the 27 beta it builds a launch-trapping
binary; see the first caveat below. Automatic signing provisions
`com.utahprosrestoration.upr.dev` under team `H6ZUT739T9` on first build either way.
The phone then shows two apps: **UPR** (TestFlight, production) and **UPR Dev**
(amber-badged icon). Installing/removing one never touches the other.

## Internal TestFlight automation — repository path, externally gated

`.github/workflows/ios-dev-testflight.yml` is the dedicated distribution path for
`com.utahprosrestoration.upr.dev`. It builds only from `dev`, pins
`https://dev.utahpros.app`, uses production APNs, embeds a non-secret contract containing
the variant/origin/Push/OTA mode/source SHA, verifies that contract plus the
embedded Capgo app/channel/public-key controls in both the archive and
exported IPA, and requests only the internal group named **UPR Dev**. It never submits to
App Review or distributes externally.

The separate `.github/workflows/capgo-dev.yml` is manual-only, GitHub-environment
gated, and locked to `.upr.dev` plus `upr-dev-canary`. Its validate operation is
read-only; publish checks channel compatibility and stages a v2-encrypted bundle
without channel assignment or device delivery; disable stops future channel
delivery. Rollback stays manual and blocked until a provenance-bound bundle
allowlist exists. Exact setup and device drills live in
`docs/mobile/capgo-dev-runbook.md`.

Every push to `dev` runs only a credential-free Linux test preflight. Signing, archiving,
and the optional internal upload are `workflow_dispatch` only; there is deliberately no
persistent enable variable that could authorize a future provider action. Each release
therefore needs a fresh owner click. Release runs are serialized and cannot be cancelled
by a later dev push while Apple may be processing an upload.

Before the first manual run, the owner must separately establish the `.dev` App Store
Connect record, distribution profile, internal group, and `ios-dev-signing` /
`ios-dev-testflight` GitHub environments. Those environments use only `IOS_DEV_*`
signing/provider secret names, so the dev lane cannot fall back to the official app's
credentials. First run with publication false and prove the archive before separately
authorizing an upload. Source preparation is not evidence that any external object exists
or that an upload occurred.

Because TestFlight is distribution-signed, the UPR Dev TestFlight build enrolls a
**production** APNs token even though it calls Preview. Trusted notification dispatch uses
`sendNativePushToEmployeeAcrossEnvironments()`, so ordinary notifications/automations fan
out to both exact token cohorts and the row's own `apns_topic` selects `.upr` versus
`.upr.dev`. The owner-only Dev Tools self-test remains single-environment; a Preview
self-test may therefore report `no_tokens` for a TestFlight install and is not the
acceptance test. No Cloudflare variable needs to change.

### Dev-only stop and replacement procedure

This sequence affects only `com.utahprosrestoration.upr.dev`; do not alter official UPR,
Cloudflare Production, `APNS_TOPIC`, or the production TestFlight group.

1. Do not dispatch another release. Because push events run tests only, there is no
   automatic upload switch to disable.
2. If a manual run has not reached **Upload and assign UPR Dev**, cancel it. If that step
   started or its outcome is ambiguous, do not retry: wait for App Store Connect processing
   and identify the exact `.upr.dev` build first.
3. In App Store Connect, remove only the affected build from the internal **UPR Dev** group
   so new testers cannot install it. Tell current dev testers not to install/update and to
   remove the dev app if immediate containment is required. Do not touch official UPR.
4. Correct the source and manually dispatch a replacement from `dev` with
   `native_push_enabled:false` and `publish_to_testflight:false`. Its verified embedded
   contract must report the `.upr.dev` identity, Preview origin, native Push disabled,
   `retireDevToken:true`, production APNs entitlement, and the selected source SHA.
5. After dry-archive review, separately dispatch the same corrected commit with
   `native_push_enabled:false` and `publish_to_testflight:true`; assign only **UPR Dev**.
   Direct testers to update. On authenticated boot, the replacement requires both its explicit
   retirement flag and the OS-reported `.upr.dev` bundle id before it persists Push off,
   deletes the locally remembered token through the owner-scoped RPC, unregisters from APNs,
   and clears delivered banners. Official UPR cannot enter this path.
6. Before declaring containment, verify the replacement reports no pending detach, confirm the
   affected tester's `.upr.dev` token row is absent through an authorized admin/service
   inspection, and prove a trusted notification produces zero `.upr.dev` dispatch/delivery.
   A reinstall or storage-cleared app has no safe client-side token selector; remove it and use
   the authorized server-side evidence check rather than adding a broad delete-by-topic API.
   Existing installations may continue receiving until replaced/removed, so containment is not
   complete merely because the replacement was uploaded.
7. Re-enable native Push only in a later manually authorized `.upr.dev` replacement after
   enrollment, account-switch, foreground/background/terminated delivery, notification tap,
   and official-UPR non-regression checks pass.

A development-signed install expires with its provisioning profile (typically 7 days on a
free profile, up to a year on the paid team's Xcode-managed profile) — re-running from
Xcode refreshes it.

## Caveats — read before trusting a test result

- **Never build with the Xcode 27 beta (iOS 27 SDK) — the app traps at launch.**
  Verified on-device 2026-07-29: a UPR Dev build made in Xcode 27.0 beta 4 hit
  `EXC_BREAKPOINT` inside UIKit's launch runtime check with the console pointing at
  the "scene-based life cycle" migration — the iOS 27 SDK enforces UIScene adoption,
  which the Capacitor AppDelegate has not migrated to yet. Build with the stable
  toolchain instead: CLI `xcodebuild` (uses `xcode-select`, currently Xcode 26.6 —
  matching the CI pin) works even while the beta is the GUI default. Scene-lifecycle
  migration is tracked in `field-polish-punchlist.md` and must land before the repo
  ever moves its build toolchain to Xcode 27.

- **One shared production Supabase sits behind BOTH apps.** The dev variant is a UI and
  native-shell sandbox, not a data sandbox: everything you create, edit, clock, message,
  or upload in UPR Dev is real production data, exactly as if done in the production app.
  Test data discipline (delete TEST rows) applies in full.
- **Dev-app push still needs a signed-device proof; the durable schema is now live.**
  `functions/api/notify.js` sends through `functions/lib/apns.js`, and Apple validates
  each request's `apns-topic` against the *receiving app's* bundle id. The old design
  had exactly one env-derived topic per Cloudflare deployment, which cannot serve two
  bundle ids — flipping Preview's `APNS_TOPIC` to the dev bundle id is what caused the
  2026-07-30 production-fleet outage (every push from the dev-hosted outbox rejected
  400 DeviceTokenNotForTopic). The durable schema fix is live as ledger
  `20260731154315_device_token_apns_topic`: `device_tokens.apns_topic` records each
  registration's own bundle id (migration `20260730170000_device_token_apns_topic.sql`),
  the client reports it from `App.getInfo()` at enrollment, and `apns.js` addresses each
  token with its own topic — `APNS_TOPIC` remains only the fallback for legacy rows, so
  it stays `com.utahprosrestoration.upr` in BOTH variable sets and never flips again.
  Compatible source is on `dev`; a deployed signed build and dev-app re-enrollment
  (any launch of a signed-in, push-enabled install re-upserts its token) remain required
  before dev-app delivery can be claimed as device-proven.
- **Custom URL scheme is shared.** `Info.plist` registers the
  `com.utahprosrestoration.upr://` scheme in both variants (the literal is load-bearing
  in `src/lib/nativeNavigationTarget.js`). With both apps installed, iOS picks one
  arbitrarily for scheme opens; Universal Links (`applinks:` in the entitlements) are the
  primary deep-link path and carry both `utahpros.app` and `dev.utahpros.app` in both
  entitlement files.
- **The checked-in `capacitor.config.json` is untouched by design.** Its `appId`
  stays `com.utahprosrestoration.upr`, and production `autoUpdate` stays false.
  The dev bundle id still lives in the `Dev`/`DevRelease` configurations.
  `cap sync ios` writes the gitignored
  `ios/App/App/capacitor.config.json`; the explicit dev sync then patches only
  that generated copy to `.upr.dev`/`upr-dev-canary`. Normal production sync
  never runs the patch. Both paths leave zero tracked drift, and the signed
  UPR Dev artifact verifier checks the generated values rather than trusting
  source intent.
- **Biometrics/Face ID state, push intent, and the offline owner lease are per-app.**
  The two apps keep independent WKWebView storage, so sessions do not leak between them;
  signing into UPR Dev does not sign the production app in or out.

## Regenerating the badged icon

`AppIcon-Dev.appiconset` holds a single 1024px PNG derived from the production icon with
a solid amber (`#F59E0B`) bottom banner and white "DEV" text (flattened, drawn with
AppKit). If the production icon changes, regenerate the badge from the new
`AppIcon.appiconset/AppIcon-512@2x.png` the same way rather than editing the badge PNG
by hand.
