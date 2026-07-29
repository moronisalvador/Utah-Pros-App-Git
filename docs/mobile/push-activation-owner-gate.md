# Native push activation and release gate

**Last verified:** 2026-07-28

Native push is wired end to end in the repository. Apple and Cloudflare sender
configuration now exists, but enrollment remains deliberately off until the two
focused Push migrations are qualified and separately applied. The broader S1h
program remains deferred. No deployment, device enrollment, provider delivery,
or push-tap proof has occurred.

## Already built — do not rebuild

| Piece | Where | State |
|---|---|---|
| Plugin | `@capacitor/push-notifications` in `package.json` + `ios/App/CapApp-SPM/Package.swift` | wired |
| Debug entitlement | `ios/App/App/App.entitlements` → `aps-environment: development` | correct |
| Release entitlement | `ios/App/App/App.Release.entitlements` → `aps-environment: production` | correct |
| Per-config wiring | `project.pbxproj` — Debug uses `App.entitlements`, Release uses `App.Release.entitlements` | correct |
| Registration | `src/lib/pushNotifications.js` → `registerPushForEmployee()` | fail-closed |
| Tap → route | `resolveNativePushActionTarget()` + `NativeNavigationBridge` | wired |
| Token storage | `device_tokens` via `upsert_my_native_device_token` | wired |
| Sender | `functions/api/notify.js` → `functions/lib/apns.js`; owner-only self-test at `send-push.js` | wired |
| Deep link | `functions/api/notify.js` writes `data.url` per notification | fixed 2026-07-27 (PUSH-01) |
| Unenroll | `detachNativePushDevice()` on logout / account switch | wired |

The **Release entitlement detail matters more than it looks**. A TestFlight build
is signed with a distribution profile and must carry `aps-environment: production`;
a build that ships `development` registers against APNs sandbox and every push
silently fails. The two-file split above is what prevents that, so do not collapse
them back into one.

## External configuration verified 2026-07-28

- Apple Developer Program team `H6ZUT739T9` is active.
- App ID `com.utahprosrestoration.upr` has Push Notifications and Associated
  Domains enabled.
- APNs Auth Key `JX22945D4T` is team-scoped for **Sandbox & Production**.
- Apple Distribution certificate `3QA6GT9L28` and App Store profile
  `UPR App Store 2026` are active.
- App Store Connect Admin team key `XV5CUK6XLC` is configured in GitHub
  environment `ios-testflight` as encrypted key-id, issuer-id, and private-key
  secrets. GitHub confirmed the three secret names before the local `.p8`
  download was removed.
- Cloudflare Pages project `utah-pros-app-git` contains all six push variables
  in both Production and Preview. Secret values were not retained in the
  repository.
- Production uses `APNS_ENV=production`; Preview uses `APNS_ENV=sandbox`.
- `VITE_NATIVE_PUSH_ENABLED=false` remains explicit in both environments.
- The native build additionally requires `VITE_APNS_ENV`: local development
  and Preview use `sandbox`; TestFlight/App Store use `production`.
- The first generated key was revoked before use after a secret-handling trace
  exposed it during setup. Its local file and the replacement key's local file
  were permanently removed; only the encrypted Cloudflare copy of the active
  replacement remains.

## Local distribution proof

The app-target-only manual signing fix produced a clean Xcode 26.6 Release
archive and exported IPA on 2026-07-28. The repository verifier cross-checked
the archive and IPA and passed:

- bundle `com.utahprosrestoration.upr`, team `H6ZUT739T9`;
- version `1.0.0 (1)`;
- valid code signature and App Store provisioning profile;
- `aps-environment=production` and `get-task-allow=false`;
- the reviewed privacy manifest, no tracking domains, and non-exempt
  encryption disabled; and
- IPA SHA-256
  `eb022fae79464c25980746e961e80b383958677854ec5eafe1b4365d840b4b41`.

This is local release qualification, not an upload candidate: the worktree was
dirty, the report therefore has no source commit, and the final focused
database/deploy/promotion gates remain open.

The release workflow runs Xcode/Fastlane archive and provider upload commands
through `scripts/qa/run-owned-subprocess.mjs`: each command owns a distinct
process group, is capped at five minutes, terminates remaining children, and
verifies the group is gone. Longer GitHub job watchdogs cover dependency/test
Actions and are not permission for a persistent child to outlive that bound.

## Environment contract

Cloudflare Pages keeps Production and Preview variables separately. A value
added to only one leaves push broken on the other, which reads as intermittent
failure rather than an explicit configuration error.

| Variable | Value |
|---|---|
| `APNS_P8_KEY` | encrypted secret; full `.p8`, newlines preserved |
| `APNS_KEY_ID` | `JX22945D4T` |
| `APNS_TEAM_ID` | `H6ZUT739T9` |
| `APNS_TOPIC` | `com.utahprosrestoration.upr` |
| `APNS_ENV` | Preview/debug: `sandbox`; Production/TestFlight/App Store: `production` |
| `VITE_NATIVE_PUSH_ENABLED` | exact string `false` until the focused native-token migration is live-verified |
| `VITE_APNS_ENV` | native debug/Preview: `sandbox`; TestFlight/App Store: `production` |

TestFlight is a production-signed distribution build and must use APNs
production. Only development-signed device builds use the sandbox.

## Remaining activation sequence

1. Apply and live-verify the already-isolated
   `20260728223000_native_apns_token_boundary.sql`, followed by
   `20260728224000_native_push_delivery_guardrails.sql`. Together they leave
   environment-unknown tokens inert, expose only selector-free redacted
   enrollment, cap installations, contain notification preferences to the
   authenticated owner, claim each source-event/device-fingerprint delivery
   durably with a 90-day replay window that survives token-row deletion and
   bounded expired-claim cleanup, and
   compare-and-delete only the stale token version Apple rejected.
   Every production dispatcher must carry its persisted source occurrence;
   missing identity skips APNs. Explicit Apple 429/5xx rejection receives one
   release/reclaim retry; the message-notification outbox persists an exhausted
   explicit refusal as native-only so already-delivered bell/Web Push/email
   channels do not repeat. A timeout/network ambiguity keeps the claim and is
   never automatically replayed. The first migration pins the exact legacy RPC
   contracts and validates its new check constraint through the low-lock
   `NOT VALID` → `VALIDATE` sequence. The companion retains the legacy
   preference policy object with fail-closed predicates, gives the private
   claim table an explicit service-only policy, and refuses every new-object
   name collision. Its exact-contract rollback is deliberately unsafe and
   requires an explicit operator session flag.
2. Set `VITE_APNS_ENV=sandbox` for native Preview/debug builds and
   `VITE_APNS_ENV=production` for TestFlight/App Store. Change
   `VITE_NATIVE_PUSH_ENABLED` to exact lowercase `true` only in compatible
   builds.
3. Deploy compatible `dev` and production bundles, build the final clean-source
   signed native archive, and verify the archive carries
   `aps-environment=production`. The local qualification archive above proves
   the signing lane, but does not replace this final-source artifact.
4. Install the new build on a physical iPhone, accept the permission prompt,
   confirm an owner-bound `device_tokens` row, trigger one authorized test
   notification, and prove background banner plus tap-to-route.
5. Upload that exact verified IPA to internal TestFlight and repeat the
   registration/delivery/tap proof from the TestFlight install.

`isNativePushEnrollmentEnabled()` remains deliberately fail-closed: `TRUE`, `1`,
unset, and every value other than exact lowercase `true` keep enrollment off;
so does a missing or malformed `VITE_APNS_ENV`.
Cloudflare changes take effect on the next deployment; the native flag is also a
build-time value, so an already-installed IPA cannot be activated remotely.

The focused preference migration intentionally changes the state that the
deferred broad S1h preflight expects. S1h must therefore be reconciled and
re-qualified before a future apply; its refusal is a safety guard, not a reason
to replay or bypass the focused migration.
