<!--
FILE: docs/mobile/capgo-dev-runbook.md

WHAT THIS DOES (plain language):
  Defines how Utah Pros safely prepares, stages, assigns, observes, and stops
  live web updates for the separately installed UPR Dev iOS app.

DEPENDS ON:
  Internal: capacitor.config.json, scripts/configure-ios-capgo-dev.mjs,
            src/components/NativeUpdateHealthGate.jsx,
            .github/workflows/capgo-dev.yml,
            .github/workflows/ios-dev-testflight.yml
  External: Capgo, GitHub Actions, Apple App Store Connect/TestFlight
  Data:     reads → build and release evidence only
            writes → unassigned UPR Dev bundles or the UPR Dev channel only
                     when explicitly dispatched

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
- Capgo app `UPR Dev` exists with id `com.utahprosrestoration.upr.dev`.
  Channel `upr-dev-canary` (id `44318`) is its default download channel with
  iOS on, Android/Electron off, development/distribution and
  simulator/physical-device builds allowed, self-assignment on, downgrade below
  native blocked, patch-only automatic updates, and progressive rollout off.
- GitHub `capgo-dev` contains exactly the encrypted environment secrets
  `CAPGO_DEV_API_KEY`, `CAPGO_DEV_PRIVATE_KEY_V2`, and
  `CAPGO_DEV_PUBLIC_KEY_V2`; secret presence was verified without reading values.
- `ios-dev-signing` does not yet have a verified `CAPGO_DEV_PUBLIC_KEY_V2`
  secret. GitHub cannot reveal the value already stored in `capgo-dev`, and
  Capgo does not expose a recoverable copy. The owner must privately add the
  retained public half or separately authorize a coordinated dev-key rotation
  before any archive dispatch.
- The app-scoped Capgo API key is limited to `UPR Dev` with the
  `app_developer` role and expires 2027-08-01.
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
   native version off, patch-only auto-update, and progressive rollout off.
   Zero exposure comes from having no assigned bundle until the separate
   assignment gate.
5. Create a dedicated API key with the narrowest write scope Capgo offers for
   this app. Do not reuse an account-owner, production, or personal CLI token.
6. Create a Capgo v2 encryption keypair. Store both
   `CAPGO_DEV_PUBLIC_KEY_V2` and `CAPGO_DEV_PRIVATE_KEY_V2` only as encrypted
   `capgo-dev` environment secrets. Also store only the public half as the
   encrypted `CAPGO_DEV_PUBLIC_KEY_V2` secret in `ios-dev-signing`. The archive
   job reads that public value and the UPR Dev signing material in the same
   protected job, then embeds the public half only in the
   `com.utahprosrestoration.upr.dev` app/IPA. It never uses an intermediate key
   artifact. The private half never enters an app build, signing job, or
   artifact.
7. Store the dedicated API key only as the masked environment secret
   `CAPGO_DEV_API_KEY`.

Uploading private signing material or changing token permissions requires the
owner to enter the value directly on the exact GitHub page after a fresh
confirmation. Do not paste any of these values into chat, terminal history,
workflow inputs, logs, or a local `.env` file. The owner authorized the public
verification key inside only the isolated UPR Dev app/IPA on 2026-08-01; that
exception does not apply to the private key or API key.

## First canary sequence

1. Merge the reviewed source into `dev`; do not dispatch from a feature branch.
2. Run **Capgo UPR Dev** with operation `validate` and confirmation
   `UPR DEV CAPGO VALIDATE`. This builds the native graph, proves the exact SHA,
   verifies the native service worker/manifest are absent, and makes no Capgo
   change.
3. Dispatch **iOS dev TestFlight** with publication off. The archive must verify
   the `.upr.dev` identifier, canary channel, RSA-4096 public-key fingerprint,
   updater mode, Preview API origin, source SHA, signing, entitlements, and
   privacy manifest.
4. After owner approval, upload only that verified OTA-capable UPR Dev archive
   to its internal TestFlight group and install it on a designated device.
5. After a fresh exact owner approval, run **Capgo UPR Dev** with operation
   `publish` and confirmation `UPR DEV CAPGO PUBLISH`. The workflow first checks
   compatibility against `upr-dev-canary`, then encrypts and uploads an
   immutable version tied to native version/run/SHA **without assigning it to a
   channel**. It cannot deliver that bundle.
6. After a separate exact bundle-assignment/device-delivery approval, assign
   only the reviewed staged version to `upr-dev-canary` and keep exposure at
   one designated UPR Dev device. Verify cold launch,
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

## Stop and recovery

**Stop future delivery:** dispatch operation `disable` with
`UPR DEV CAPGO DISABLE`. It turns off every platform/build/device selector on
the dev channel. It does not instantly remove a bundle already active on a
device.

**Rollback remains manual and blocked:** the workflow deliberately has no
`rollback` operation. A syntactically valid bundle name is not provenance. Do
not reassign the channel until a release receipt/allowlist proves the exact
previous UPR Dev bundle, its source SHA, native compatibility, encryption key,
and successful device evidence. That future reassignment is a fresh owner and
device-delivery gate. Emergency containment uses `disable`.

**Automatic local recovery:** a newly applied bundle gets 30 seconds to reach
the health gate. Missing acknowledgement leaves the bundle failed so the native
updater can return to the builtin/last healthy bundle. The app never acknowledges
while auth is loading, failed, expired, OTA-disabled, non-native, or any React
route error boundary has caught a render failure during the launch.

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
