# Native push activation and release gate

**Last verified:** 2026-07-28

Native push is wired end to end and the focused database boundary is live. Apple
and Cloudflare sender configuration exists, the compatible `dev` bundle is
deployed, and the owner's development-signed iPhone build enrolled a fresh APNs
sandbox token. The broader S1h program remains deferred. One authorized
background delivery succeeded; tap routing and the production-signed matrix
remain separate TestFlight gates.

## Already built — do not rebuild

| Piece | Where | State |
|---|---|---|
| Plugin | `@capacitor/push-notifications` in `package.json` + `ios/App/CapApp-SPM/Package.swift` | wired |
| Debug entitlement | `ios/App/App/App.entitlements` → `aps-environment: development` | correct |
| Release entitlement | `ios/App/App/App.Release.entitlements` → `aps-environment: production` | correct |
| Per-config wiring | `project.pbxproj` — Debug uses `App.entitlements`, Release uses `App.Release.entitlements` | correct |
| Registration | `src/lib/pushNotifications.js` → `registerPushForEmployee()` | fail-closed |
| User controls | Settings → Notifications; separate Web Push and native APNs Turn on/Turn off paths | wired in source |
| Tap → route | opaque recipient-bound `resolveNativePushActionTarget()` + `NativeNavigationBridge` | wired |
| Token storage | `device_tokens` via `upsert_my_native_device_token` | wired |
| Sender | `functions/api/notify.js` → `functions/lib/apns.js`; owner-only self-test at `send-push.js` | wired |
| Deep link | `functions/api/notify.js` writes `data.url` per notification | fixed 2026-07-27 (PUSH-01) |
| Unenroll | `detachNativePushDevice()` on logout / account switch | wired |

The Settings controls are channel-specific. Browser/PWA Turn on/Turn off owns
only the Web Push service-worker subscription. Native Turn on/Turn off owns
only this Capacitor installation's APNs binding. Native intent is durable and
bound to the current opaque owner lease, so another account on the same phone
defaults off. An explicit off is persisted before detach begins and blocks
automatic enrollment on restart. A legacy boolean migrates on only for the
verified owner of an existing local binding. Overlapping enrollment/detach is single-flight and
journaled until the potentially committed upsert settles, after which the
owner-scoped delete runs again. Provisional and confirmed markers are distinct:
only the exact foreign-token ownership refusal releases a provisional attempt;
other authorization failures retain it. A
network-ambiguous write remains journaled across its immediate delete until a
later same-owner reconciliation after the 60-second safety window. Native
Settings rechecks iOS permission on app resume and never labels denied,
unknown, or cleanup-pending delivery as On. It does not expose the token.
Account cleanup also asks iOS to remove delivered banners as defense in depth.
The foreign-owner discriminator parses the top-level PostgREST body and
requires the exact `42501` code plus the full canonical SQL message; nested,
partial, malformed, or merely similar text never clears the journal.

Every native APNs payload now uses the exhaustive typed presentation catalog
and an opaque deterministic recipient binding. Unknown types retain generic
`Utah Pros notification` / `Open Utah Pros for details.` copy. Customer message
contents, names, addresses, identifiers, financial amounts, appointment times
and free-form notes are never serialized into native alert copy. Appointment
alerts contain only the event state plus generic action copy. The worker applies the same pure native route/query policy
before serialization and replaces unsafe input with `/`. The Push-only policy
also rejects `/sign/:token` and `/s/:code`, which remain valid Universal/App
Links but contain bearer capabilities that must never reach Apple. A tap is
ignored unless that binding matches the currently verified employee and the
route passes the native allowlist.

Appointment events cannot widen their audience with `recipient_ids`:
assignment intersects the named employee with current appointment crew, and
updated/canceled events resolve current crew directly.

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
It also hard-pins `VITE_NATIVE_API_ORIGIN=https://utahpros.app` and
`VITE_RELEASE_SHA` to the exact `main` commit so a production-signed build
cannot silently call Preview/dev Workers or lose its runtime release identity.

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

After the device-local Turn on/Turn off controls passed source review, the owner
separately authorized an in-place physical-device update. On 2026-07-28 the
uncommitted reviewed batch was rebuilt against `https://dev.utahpros.app` with
native Push enabled for sandbox, synchronized with no tracked native-project
drift, signed as Debug, installed over Wi-Fi, and launched. Device tooling
confirmed UPR `1.0.0 (1)` installed and running. The physical control-state,
restart-persistence, background-banner, and tap-route observations remain
pending and must not be inferred from install/launch.

The owner then separately authorized one bounded Dev Tools delivery to that
Debug installation. The API accepted the test and the owner observed the iOS
notification while the app was in the background. Value-free live evidence at
that point showed one sandbox token and no production token for the owner.
The source repair now fans every trusted occurrence to both exact APNs cohorts,
so production-worker appointment events can target that development-signed
sandbox installation without weakening token/environment separation. This
source statement is not live delivery evidence until the reviewed Worker is
deployed and the real event/device matrix passes. The latest inbound message
evidence also showed its in-app notification row and a native delivery claim;
delivery presentation still depends on the installation environment and app
state.

Foreground presentation is now explicit in `capacitor.config.json`: iOS may
show badge, sound, and the typed privacy-safe alert while the native app is
open. The JavaScript foreground callback remains content-private and emits only
the constant refresh signal. Appointment audience remains the existing business
rule: only employees assigned to the appointment receive appointment Push.

## Pilot stop and rollback

The release owner/on-call is the Utah Pros owner-admin. Stop internal rollout
immediately for cross-account delivery/routing, sensitive notification copy,
wrong-environment delivery, repeated/duplicate notifications, login/session
regression, or a crash/blocker in the field shell.

The server-side Push stop is to set `APNS_ENV` to a value other than exact
`sandbox`/`production` (or remove the APNs signing key) in the affected
Cloudflare Preview/Production environment and redeploy. `readApnsConfig()`
then fails closed before token lookup or Apple. This operational action is
owner-gated and must be applied separately to Preview and Production.

After a stop:

1. verify a bounded notification event returns `apns_not_configured` and no
   Apple request is attempted;
2. preserve in-app bell/Web Push behavior and do not delete token rows as a
   substitute kill switch;
3. correct the source, increment the build number, and ship a replacement
   through the same clean-`main` verified workflow;
4. keep the prior TestFlight build unavailable to new testers and direct
   existing testers to update/remove it; and
5. re-enable the APNs environment only after the replacement passes
   account-switch, privacy, foreground/background/terminated, and tap checks.

## Remaining activation sequence

1. Re-enable Web Push independently in each reinstalled PWA and accept the
   system permission prompt when offered.
2. Build the final clean-source signed native archive and verify the archive
   carries
   `aps-environment=production`. The local qualification archive above proves
   the signing lane, but does not replace this final-source artifact.
3. Upload that exact verified IPA to internal TestFlight. Install it, turn on
   Push so the installation registers a production token, then verify a real
   assigned-appointment event in foreground and background plus its tap route.

`isNativePushEnrollmentEnabled()` remains deliberately fail-closed: `TRUE`, `1`,
unset, and every value other than exact lowercase `true` keep enrollment off;
so does a missing or malformed `VITE_APNS_ENV`.
Cloudflare changes take effect on the next deployment; the native flag is also a
build-time value, so an already-installed IPA cannot be activated remotely.

The focused preference migration intentionally changes the state that the
deferred broad S1h preflight expects. S1h must therefore be reconciled and
re-qualified before a future apply; its refusal is a safety guard, not a reason
to replay or bypass the focused migration.
