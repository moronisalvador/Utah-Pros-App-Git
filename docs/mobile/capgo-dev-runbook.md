<!--
FILE: docs/mobile/capgo-dev-runbook.md

WHAT THIS DOES (plain language):
  Defines how Utah Pros safely prepares, publishes, observes, stops, and rolls
  back live web updates for the separately installed UPR Dev iOS app.

DEPENDS ON:
  Internal: capacitor.config.json, scripts/configure-ios-capgo-dev.mjs,
            src/components/NativeUpdateHealthGate.jsx,
            .github/workflows/capgo-dev.yml,
            .github/workflows/ios-dev-testflight.yml
  External: Capgo, GitHub Actions, Apple App Store Connect/TestFlight
  Data:     reads → build and release evidence only
            writes → UPR Dev Capgo app/channel only when explicitly dispatched

NOTES / GOTCHAS:
  - UPR Dev is isolated by app identifier, but it still uses the shared
    production Supabase. OTA is not a safe place to write-test business data.
  - No instruction below authorizes a production UPR channel or App Store change.
-->

# Capgo UPR Dev canary runbook

**Last verified:** 2026-08-01

## Fixed isolation contract

| Boundary | Required value |
|---|---|
| Native app | UPR Dev |
| App/bundle identifier | `com.utahprosrestoration.upr.dev` |
| Capgo channel | `upr-dev-canary` |
| API origin | `https://dev.utahpros.app` |
| Allowed platform | iOS only |
| Allowed binaries | UPR Dev development and distribution builds |
| Automatic compatibility | patch-only; never below installed native `1.0.0` |
| Direct install | disabled |
| Production UPR | `com.utahprosrestoration.upr`; updater remains default-off |

Capgo requires one channel to be default. The default may be
`upr-dev-canary` only because this is a separate Capgo app whose identifier is
the UPR Dev bundle identifier. `--prod` in the channel configuration means a
distribution-signed UPR Dev/TestFlight binary; it does not include the official
UPR app because that binary reports a different identifier.

The checked-in `capacitor.config.json` remains the official-app source and keeps
`autoUpdate:false`. After an explicit dev sync,
`scripts/configure-ios-capgo-dev.mjs` changes only the gitignored generated iOS
copy, requires the v2 public key, selects the dev app/channel, locks runtime
channel/app/server mutation, enables background auto-update, and leaves direct
update disabled. The signed-artifact verifier reads that generated configuration
back from the archive and rejects a wrong identity, channel, update mode, or key.

## Current external setup evidence

As of 2026-08-01:

- App Store Connect already contains the separate UPR Dev record
  (`com.utahprosrestoration.upr.dev`, Apple app id `6797102091`). This runbook
  does not change the official UPR listing or signing.
- GitHub contains a `capgo-dev` environment restricted to the `dev` branch.
- The Capgo console requires the owner’s private sign-in/2FA before the app,
  channel, key, and plan availability can be verified or created.
- No Capgo upload, subscription purchase, production activation, or installed
  device delivery has been performed by this setup.

Repository declarations are not proof that the pending Capgo or GitHub values
exist. Record the dashboard object ids and a sanitized screenshot in the release
evidence after setup; never record the values of tokens or keys.

## One-time dashboard setup

Use the Capgo console at `https://console.capgo.app/`:

1. Sign in privately. Passwords, 2FA codes, recovery codes, API tokens, and keys
   stay out of chat and repository files.
2. Confirm the current plan permits one dev app and encrypted update uploads
   without accepting a paid term. Stop for exact owner approval before any
   purchase, trial conversion, or paid agreement.
3. Create or select exactly `com.utahprosrestoration.upr.dev`. Never select or
   create `com.utahprosrestoration.upr`.
4. Create `upr-dev-canary` and make it the isolated app’s default channel.
   Configure iOS on, Android off, development and production build types on,
   emulator and physical device on, self-assignment on, downgrade below the
   native version off, patch-only auto-update, and rollout initially paused or
   zero-exposure until the first signed UPR Dev binary is installed.
5. Create a dedicated API key with the narrowest write scope Capgo offers for
   this app. Do not reuse an account-owner, production, or personal CLI token.
6. Create a Capgo v2 encryption keypair. The public key may be stored as the
   GitHub environment variable `CAPGO_DEV_PUBLIC_KEY_V2`. Store the private key
   only as the masked environment secret `CAPGO_DEV_PRIVATE_KEY_V2`.
7. Store the dedicated API key only as the masked environment secret
   `CAPGO_DEV_API_KEY`.

Uploading private signing material or changing token permissions requires the
owner to enter the value directly on the exact GitHub page after a fresh
confirmation. Do not paste any of these values into chat, terminal history,
workflow inputs, artifacts, logs, or a local `.env` file.

## First canary sequence

1. Merge the reviewed source into `dev`; do not dispatch from a feature branch.
2. Run **Capgo UPR Dev** with operation `validate` and confirmation
   `UPR DEV CAPGO VALIDATE`. This builds the native graph, proves the exact SHA,
   verifies the native service worker/manifest are absent, and makes no Capgo
   change.
3. Dispatch **iOS dev TestFlight** with publication off. The archive must verify
   the `.upr.dev` identifier, canary channel, public key, updater mode, Preview
   API origin, source SHA, signing, entitlements, and privacy manifest.
4. After owner approval, upload only that verified UPR Dev archive to its
   internal TestFlight group and install it on a designated device.
5. Run **Capgo UPR Dev** with operation `publish` and confirmation
   `UPR DEV CAPGO PUBLISH`. The workflow encrypts the bundle, sets an immutable
   version tied to native version/run/SHA, and fails on incompatible native
   packages.
6. Keep rollout exposure at one designated UPR Dev device. Verify cold launch,
   signed-out launch, authenticated bootstrap, current route, background/resume,
   network interruption, account switch, and next cold launch. Confirm the
   bundle is accepted only after auth startup and the lazy route finish.
7. Inspect the sanitized 30-day GitHub evidence artifact and Capgo install/fail
   statistics. Expand only after the named test matrix passes.

The web source may change only behavior that the installed binary already
supports. A new native plugin, entitlement, permission, app purpose, or material
feature is a new native release, not an OTA. Apple’s
[App Review Guideline 2.5.2](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
still applies to TestFlight and App Store apps.

## Stop, rollback, and recovery

**Stop future delivery:** dispatch operation `disable` with
`UPR DEV CAPGO DISABLE`. It turns off every platform/build/device selector on
the dev channel. It does not instantly remove a bundle already active on a
device.

**Roll back the channel:** identify a previously verified UPR Dev bundle version
from Capgo/GitHub evidence, dispatch operation `rollback`, set that exact version,
and enter `UPR DEV CAPGO ROLLBACK`. The channel refuses downgrades below the
installed native version.

**Automatic local recovery:** a newly applied bundle gets 30 seconds to reach
the health gate. Missing acknowledgement leaves the bundle failed so the native
updater can return to the builtin/last healthy bundle. The app never acknowledges
while auth is loading, failed, expired, OTA-disabled, or non-native.

After containment, verify on the designated device:

- Capgo reports no new update delivery;
- cold launch reaches the builtin or named last-known-good bundle;
- authentication/account ownership and Preview origin are unchanged;
- service-worker/cache files remain absent from the native bundle;
- the official UPR app has received no Capgo check or bundle;
- GitHub evidence names only `.upr.dev` and `upr-dev-canary`.

Production activation, a production Capgo channel, paid plan acceptance, official
UPR App Store/signing changes, or delivery to installed production users always
requires a separate exact owner approval.
