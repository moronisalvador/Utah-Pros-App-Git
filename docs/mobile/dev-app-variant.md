<!--
FILE: docs/mobile/dev-app-variant.md

WHAT THIS DOES (plain language):
  Explains the "UPR Dev" side-by-side iOS app: a second, development-signed copy of the
  field app that installs next to the production TestFlight app so native changes from the
  dev branch (haptics, push prompts, onboarding, Face ID) can be tried on a real phone
  before they are promoted to main.

DEPENDS ON:
  Internal: ios/App/App.xcodeproj (Dev build configuration + "UPR Dev" scheme),
            ios/App/App/App.entitlements, ios/App/App/Info.plist,
            ios/App/App/Assets.xcassets/AppIcon-Dev.appiconset,
            package.json (build:ios:dev), src/lib/nativeApiOrigin.js,
            docs/mobile/push-activation-owner-gate.md
  Data:     reads → the SAME shared production Supabase as the production app (see caveat)
            writes → the SAME shared production Supabase as the production app (see caveat)

NOTES / GOTCHAS:
  - This is a UI/native sandbox, NOT a data sandbox. Both apps talk to the one shared
    Supabase project.
  - Never change Cloudflare Preview `APNS_TOPIC`; both environments retain the production bundle
    fallback. The live per-token topic records the dev bundle at enrollment.
-->

# UPR Dev — side-by-side development app variant

**Last verified:** 2026-07-31

The Xcode project carries a third build configuration, **Dev**, plus a shared scheme
named **UPR Dev**. It produces a second, independently installed copy of the field app so
the owner can test native behaviour built from the `dev` branch on the same phone that
carries the production TestFlight install.

| | Production (TestFlight) | UPR Dev (side-by-side) |
|---|---|---|
| Build configuration | `Release` | `Dev` |
| Bundle id | `com.utahprosrestoration.upr` | `com.utahprosrestoration.upr.dev` |
| Display name | UPR | UPR Dev |
| App icon | `AppIcon` | `AppIcon-Dev` (amber "DEV" banner) |
| Signing | Manual, `Apple Distribution`, `UPR_RELEASE_PROFILE_NAME` | Automatic, team `H6ZUT739T9` |
| Entitlements | `App.Release.entitlements` (`aps-environment: production`) | `App.entitlements` (`aps-environment: development`) |
| Web bundle API origin | `https://utahpros.app` (CI-enforced) | `https://dev.utahpros.app` (default in `src/lib/nativeApiOrigin.js`) |
| Install path | TestFlight via `ios-release.yml` | Xcode run to device |

The existing `Debug` configuration is untouched and remains what it was; `Dev` is a copy
of it with the bundle id, display name, and icon overridden. The `Release` configuration
and the TestFlight/CI lane (`.github/workflows/ios-release.yml`, `ios/fastlane/`,
`ios/App/Version.xcconfig`) are unchanged — `scripts/ios-release-workflow.test.js` still
locks that contract.

The display name is per-configuration via the `UPR_APP_DISPLAY_NAME` build setting;
`Info.plist`'s `CFBundleDisplayName` is `$(UPR_APP_DISPLAY_NAME)` and resolves to `UPR`
for Debug/Release and `UPR Dev` for Dev. No other Info.plist value varies by
configuration.

## Building and installing (owner flow)

From the `dev` branch:

```bash
npm run build:ios:dev
```

That script is `VITE_APNS_ENV=sandbox VITE_NATIVE_PUSH_ENABLED=true npm run build:ios`.
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
- **`capacitor.config.json` is untouched by design.** Its `appId` stays
  `com.utahprosrestoration.upr` (it seeds new-platform generation and the dormant Capgo
  updater identity); the dev bundle id lives only in the `Dev` build configuration in
  `project.pbxproj`. `cap sync ios` writes the gitignored copy
  `ios/App/App/capacitor.config.json`, so a normal `npm run build:ios`/`build:ios:dev`
  leaves zero tracked drift — that remains a release invariant checked by
  `ios-release.yml` (`git diff --exit-code -- ios/App`).
- **Biometrics/Face ID state, push intent, and the offline owner lease are per-app.**
  The two apps keep independent WKWebView storage, so sessions do not leak between them;
  signing into UPR Dev does not sign the production app in or out.

## Regenerating the badged icon

`AppIcon-Dev.appiconset` holds a single 1024px PNG derived from the production icon with
a solid amber (`#F59E0B`) bottom banner and white "DEV" text (flattened, drawn with
AppKit). If the production icon changes, regenerate the badge from the new
`AppIcon.appiconset/AppIcon-512@2x.png` the same way rather than editing the badge PNG
by hand.
