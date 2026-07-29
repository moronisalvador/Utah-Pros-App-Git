# Native push activation and release gate

**Last verified:** 2026-07-28

Native push is wired end to end and the focused database boundary is live. Apple
and Cloudflare sender configuration exists, the compatible `dev` bundle is
deployed, and the owner's development-signed iPhone build enrolled a fresh APNs
sandbox token. The broader S1h program remains deferred. One authorized
background-delivery and tap-to-route proof is the remaining Debug activation
check; TestFlight remains a separate release gate.

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

## Live activation evidence

The owner separately authorized and the operator applied the two reviewed
migrations in order on 2026-07-28:

| Source | Live ledger version | SHA-256 |
|---|---:|---|
| `20260728223000_native_apns_token_boundary.sql` | `20260729021021` | `4936264f1fe8484cfb399f4f9fcd3abfeb39ebd2c3c034e27a4d4fbab543666f` |
| `20260728224000_native_push_delivery_guardrails.sql` | `20260729021050` | `8457889fb77b5681e63e4143728a18a625523483494cecf5e27ee8d00c9df8ca` |

Their reviewed rollback SHA-256 values are respectively
`b584ecc1f3ed834828030866b98e2cec8c1d19ec26bfd17df17dcf387782e273`
and
`a19b40a81e2fa04b453dfdecc0206f970524b75f9cb2393335dd137d135fc079`.
Live catalog checks passed the new token constraint, selector-free
authenticated RPC ACLs, anonymous denial, forced RLS, service-only delivery
claims, fail-closed retained preference policy, and direct-table denial.
Security advisors retained the intentional authenticated `SECURITY DEFINER`
warnings for caller-checking RPCs. Performance advisors reported an unindexed
`native_push_delivery_claims.employee_id` foreign key and an unused new
`claimed_at` index; those are review follow-ups, not evidence that the boundary
failed.

Compatible source `d5d08cb48ed083d45108dce018969df760076f55` is deployed
to `dev`. Cloudflare's hosted web flag remains `false`; this is intentional
because enrollment is a native-build concern. The locally installed Debug build
used exact `VITE_NATIVE_PUSH_ENABLED=true` and `VITE_APNS_ENV=sandbox`, carried
the development APNs entitlement, launched on the owner's iPhone 17 Pro Max, and
registered a fresh redacted sandbox token. Older environment-less token rows
remain inert.

## Remaining activation sequence

1. Put the installed Debug app in the background, use the owner-only Dev Tools
   control exactly once, observe the iOS banner, and tap it to prove
   `/tech/settings` routing. Record only the bounded result; never expose the
   token or private key.
2. Deploy the compatible production bundle, build the final clean-source
   signed native archive, and verify the archive carries
   `aps-environment=production`. The local qualification archive above proves
   the signing lane, but does not replace this final-source artifact.
3. Upload that exact verified IPA to internal TestFlight and repeat the
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
