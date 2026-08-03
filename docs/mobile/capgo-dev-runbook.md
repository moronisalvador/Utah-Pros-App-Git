<!--
FILE: docs/mobile/capgo-dev-runbook.md

WHAT THIS DOES (plain language):
  Defines how Utah Pros safely prepares, stages, observes, and stops
  live web updates for the separately installed UPR Dev iOS app.

DEPENDS ON:
  Internal: capacitor.config.json, scripts/configure-ios-capgo-dev.mjs,
            src/components/NativeUpdateHealthGate.jsx,
            .github/workflows/capgo-dev.yml,
            .github/workflows/ios-dev-testflight.yml
  External: Capgo, GitHub Actions, Apple App Store Connect/TestFlight
  Data:     reads → build and release evidence only
            writes → unassigned encrypted UPR Dev bundles or disables UPR Dev
                     channel delivery selectors when explicitly dispatched

NOTES / GOTCHAS:
  - UPR Dev is isolated by app identifier, but it still uses the shared
    production Supabase. OTA is not a safe place to write-test business data.
  - No instruction below authorizes a production UPR channel or App Store change.
-->

# Capgo UPR Dev canary runbook

**Last verified:** 2026-08-03

## Fixed isolation contract

| Boundary | Required value |
|---|---|
| Native app | UPR Dev |
| App/bundle identifier | `com.utahprosrestoration.upr.dev` |
| Capgo channel | `upr-dev-canary` |
| API origin | `https://dev.utahpros.app` |
| Allowed platform | iOS only |
| Allowed binaries | UPR Dev development and distribution builds |
| Automatic compatibility | same major/minor patch line (`disable_auto_update=minor`), allowing the next patch OTA; never below installed native `1.0.0` |
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
  native blocked, and progressive rollout off. Its last observed compatibility
  strategy was Capgo `patch`, which blocked `1.0.0` → `1.0.1`; the required
  future policy is `disable_auto_update=minor`, and a fresh provider
  correction/readback remains an external activation gate.
- GitHub `capgo-dev` contains exactly the encrypted environment secrets
  `CAPGO_DEV_API_KEY`, `CAPGO_DEV_PRIVATE_KEY_V2`, and
  `CAPGO_DEV_PUBLIC_KEY_V2`.
- A fresh dev-only RSA-4096 v2 keypair was generated on 2026-08-01. GitHub
  accepted replacement submissions for its public/private halves in
  `capgo-dev` and accepted the same public half in `ios-dev-signing`. Only
  secret names, presence, and successful submissions were verified; encrypted
  values cannot be read back. A follow-up metadata check confirmed fresh
  timestamps for all three key submissions and an unchanged timestamp for the
  existing `CAPGO_DEV_API_KEY`.
- The app-scoped Capgo API key is limited to `UPR Dev` with the
  `app_developer` role and expires 2027-08-01.
- PR #569 merged the reviewed release source into `dev` as `e0a1ec6f`; both
  release workflows continue to enforce `refs/heads/dev`.
- Manual validate run `30732493520` built the isolated native graph and then
  failed before bundle identity or any Capgo command because `rg` was absent
  from the Ubuntu runner. The same probe named stale `dist/assets` instead of
  Vite's configured `dist/app-assets`. Its retained sanitized artifact records
  no channel assignment or device delivery.
- `ios-dev-signing` shows all six expected secret names: the Capgo public key
  plus Apple team, certificate, certificate-password, profile-name, and profile
  data. Encrypted values remain unreadable. Authorized dry archive run
  `30732945226` verified `.upr.dev`, team `H6ZUT739T9`, version `1.0.0 (11.1)`,
  distribution signing/profile, production APNs, Preview origin, OTA/native
  Push enabled, `retireDevToken:false`, exact `e0a1ec6f`, and the embedded
  Capgo public-key fingerprint. TestFlight upload was disabled and skipped;
  runner signing assets were cleaned. The repository Supabase build secrets are
  present, and `ios-dev-testflight` contains its three App Store Connect API
  secret names.
- Later authorized runs uploaded UPR Dev `1.0.0 (19.1)` to its internal
  TestFlight group and physically installed it, then staged and historically
  assigned two encrypted dev-only bundles. Neither OTA installed successfully:
  the first was below the native version and the next-patch bundle was blocked
  by the then-current Capgo patch strategy. Those failed deliveries are
  retained as evidence, not success. The current workflow no longer exposes
  assignment; no production activation, subscription purchase, official-UPR
  delivery, or successful UPR Dev OTA has occurred.

Repository declarations and accepted write-only secret submissions are not
proof of secret-value readback or successful cryptographic use by a signed
archive. Record provider object ids and sanitized evidence at each authorized
release gate; never record the values of tokens or keys.

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
   native version off, `disable_auto_update=minor` so the next patch OTA remains
   compatible within the installed native major/minor line, and progressive
   rollout off.
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

1. After exact owner approval, merge the reviewed source into `dev`; do not
   dispatch from a feature branch.
2. Privately enter the five isolated `IOS_DEV_*` signing secrets listed above
   in `ios-dev-signing`; never expose them in chat, logs, or repository files.
3. Run **Capgo UPR Dev** with operation `validate` and confirmation
   `UPR DEV CAPGO VALIDATE`. This builds the native graph, proves the exact SHA,
   verifies the native service worker/manifest are absent, and makes no Capgo
   change.
4. Dispatch **iOS dev TestFlight** with publication off. The archive must verify
   the `.upr.dev` identifier, canary channel, RSA-4096 public-key fingerprint,
   updater mode, Preview API origin, source SHA, signing, entitlements, and
   privacy manifest.
5. After owner approval, upload only that verified OTA-capable UPR Dev archive
   to its internal TestFlight group and install it on a designated device.
6. After a fresh exact owner approval, run **Capgo UPR Dev** with operation
   `publish` and confirmation `UPR DEV CAPGO PUBLISH`. The workflow first checks
   compatibility against `upr-dev-canary`, then encrypts and uploads an
   immutable version tied to native version/run/SHA **without assigning it to a
   channel**. It cannot deliver that bundle.
7. Stop before assignment. The workflow intentionally exposes only
   `validate`, `publish`, and `disable`; it rejects every other operation and
   has no bundle-selection or canary-assignment command. Forward assignment and
   device delivery remain structurally unavailable until a provenance-bound
   release receipt or allowlist proves the exact staged UPR Dev bundle, source
   SHA, native compatibility, encryption key, and approved device scope.
8. After that future source gate, its regression tests, and a fresh exact
   assignment/device-delivery approval, verify cold launch, signed-out launch,
   authenticated bootstrap, current route, background/resume, network
   interruption, account switch, and next cold launch. Confirm the bundle is
   accepted only after auth startup and the lazy route finish, then inspect the
   sanitized 30-day evidence and Capgo install/fail statistics.

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

**Assignment and rollback remain blocked:** the workflow deliberately has
neither an `activate` nor a `rollback` operation. A syntactically valid bundle
name is not provenance. Do not assign or reassign the channel until a release
receipt/allowlist proves the exact UPR Dev bundle, its source SHA, native
compatibility, encryption key, approved device scope, and successful device
evidence. Any future assignment is a fresh owner and device-delivery gate.
Emergency containment uses `disable`.

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
