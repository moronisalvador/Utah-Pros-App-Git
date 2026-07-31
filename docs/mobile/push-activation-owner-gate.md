# Native push activation and release gate

**Last verified:** 2026-07-30

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

**Sign-out UX (owner-directed 2026-07-29, final).** After the first
TestFlight sign-out walled behind "Finish securing this device" on a
network-ambiguous `delete_my_native_device_token`, the owner directed that
"a sign out button should just do that: sign out." Explicit sign-out now
ALWAYS completes: one bounded best-effort cleanup pass runs while the
authenticated client still exists (the owner-scoped server deletes need it),
its outcome never gates the sign-out, and unfinished server work normally
stays in the durable owner-bound pending-detach journal. The journal is the
durable memory: the next same-owner sign-in reconciles it (the 60-second
provisional window and the `42501` discriminator are unchanged), and a
different account is refused at the bind gate before it publishes or enrolls.
Two honest limits: (1) if browser storage itself cannot persist the journal,
the residual has no durable memory at all — nothing writable can create one —
and the accepted-banner window becomes unbounded for that device until the
same owner signs in and the detach re-runs; (2) if a FOREIGN owner's journal
occupies the single marker slot, this sign-out's residual is not separately
journaled, but that foreign journal itself already walls every next bind on
its owner check. Because the signed-out intent is armed before cleanup runs,
a 401 during sign-out cleanup is no longer rescued by a token refresh — the
detach lands in the journal instead of succeeding after a renew; deliberate
(refresh persistence is the resurrection vector). The only walls
left on the explicit path are a recovery/reauth-owned block and a failed
local Supabase `signOut()`; observer-only sign-out (signed-out reauth),
password recovery, login/account-switch, and rejected bootstrap keep their
hard gates unchanged. The owner accepts a short window of lock-screen
banners after a sign-out whose server detach is still journaled — the
tap-refusal recipient binding prevents cross-account data access. The
classification (`deferrable`, `residualJournaled`, `enrollmentPending`) and
the bounded `transientPushRetry` mechanism in `accountDeviceCleanup.js`
remain reviewed and tested but sign-out no longer waits on the retry. Known
limit (pre-existing, shared with the composite ready path): each channel
keeps ONE pending-detach marker and prefers the marker's stale identity over
the live one, so after a token rotation the journal may cover a stale row
while a live row goes unjournaled.

**Post-sign-out session resurrection (the second 2026-07-29 defect) — fixed
in source, unified implementation.** The Retry-then-re-entry evidence (204 at
01:58:33Z, then a fresh profile load + token re-upsert at 02:00:06Z with no
credential entry and no Login screen) is explained by a token refresh racing
`signOut({ scope: 'local' })`: auth-js 2.99.3 lets `signOut()` steal the SDK
auth lock from an in-flight refresh after 5s, and the orphaned refresh later
re-persists the session (`_callRefreshToken → _saveSession` has no signed-out
re-check) — including through UPR's own `recoverSession()` 401 handler. Two
independently security-reviewed fixes were built in parallel and then unified
per the cross-session recommendation: the always-complete sign-out contract
and flow structure from the first fix, with its principal-keyed single marker
replaced by the second fix's **ended-session registry**
(`src/lib/endedSessionGuard.js`, key `upr:auth-ended-sessions:v1` — bare JWT
`session_id` UUIDs, cap 8, deliberately logout-surviving). session_id is
stable across token rotation but never reused by a new login, so nothing is
cleared at login, same-user re-login and web cross-tab login sync are
structurally unaffected, and multiple ended sessions stay guarded at once
(this closes the reviewed logout-A→login-B residual of the single marker).
Every local sign-out path (`logout()`, the login account-switch transition,
the rejected-bootstrap sign-out, and the recovery-wall sign-out) arms the
registry before its first await — so a 401 during sign-out cleanup is never
rescued by a refresh — and the two failure paths that retain the session
LIVE (a failed local `signOut()`, and logout refusing to sign past a
recovery-owned block) un-arm it so the walled session's token can still
renew. Boot, SIGNED_IN, and TOKEN_REFRESHED terminate a revived armed
session instead of bootstrapping it; `recoverSession()` refuses to refresh
an absent principal or an ended session; an un-awaited post-signOut sweep
catches the common in-flight case without delaying Login and acts only on a
POSITIVE side-effect-free storage match (never `getSession()`, which can
refresh — and so extend — the very zombie being purged). The termination
installs a pre-finalized transition (uninstalled if its sign-out throws) so
the observer never re-walls; when a zombie has clobbered a NEWER published
account's storage, no marker is installed and the full SIGNED_OUT teardown
runs so authorized UI never keeps rendering over a destroyed session. A
SIGNED_OUT reaching an already-clean tab is a no-op (a cross-tab purge
broadcast can never wall sibling tabs), and `SetPassword.jsx` refuses to
disclose a revived ended session's email on its own observer. The guard
fails OPEN (undecodable token / blocked storage → pre-fix behavior), warned
and pwa-diagnostics-breadcrumbed so the fail-open is never silent. Disclosed
residuals: `getAuthHeader()` in `realtime.js` calls `getSession()` and can
itself briefly extend a zombie during the pre-purge window (workers enforce
authorization server-side); the 02:00:06Z re-entry had accidentally
reconciled the push journal — the journal now correctly waits for a real
same-owner sign-in per the deferral contract. Open evidence items: decoding
one real deployed access token to confirm the canonical `session_id` claim
shape (owner-gated; the guard is inert-but-observable without it), and the
on-device **account-switch refusal** check below — the owner verification
gate before broad tech rollout.

Every native APNs payload now uses the exhaustive typed presentation catalog
and an opaque deterministic recipient binding. Unknown types retain generic
`Utah Pros notification` / `Open Utah Pros for details.` copy. Owner decision
2026-07-29 permits the same event-approved customer, scheduling, message, and
financial variables as PWA. Generic payload traversal and arbitrary producer
APNs copy remain prohibited; missing or over-budget rendered context uses
immutable generic event copy. The worker applies the same pure native
route/query policy before serialization and replaces unsafe input with `/`. The Push-only policy
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
| `APNS_TOPIC` | `com.utahprosrestoration.upr` — same in BOTH sets, and stays there: once the authored per-token topic change is live it is only the fallback for legacy `device_tokens` rows with no recorded `apns_topic`. Never flip it per app (2026-07-30 outage). |
| `APNS_ENV` | Preview/debug: `sandbox`; Production/TestFlight/App Store: `production` |
| `NATIVE_RICH_NOTIFICATION_PRESENTATION` | unset = typed rich copy enabled (fail-open by design); exact string `false` reverts native copy to the generic fallback WITHOUT disabling push delivery — this is the copy-level rollback seam |
| `VITE_NATIVE_PUSH_ENABLED` | exact string `false` until the focused native-token migration is live-verified |
| `VITE_APNS_ENV` | native debug/Preview: `sandbox`; TestFlight/App Store: `production` |

TestFlight is a production-signed distribution build and must use APNs
production. Only development-signed device builds use the sandbox.

**Side-by-side dev app (2026-07-29; superseded plan struck 2026-07-30):** the
`Dev` build configuration (`docs/mobile/dev-app-variant.md`) installs as bundle
id `com.utahprosrestoration.upr.dev`. ~~For push to reach it, Cloudflare
**Preview** `APNS_TOPIC` must change to `com.utahprosrestoration.upr.dev`.~~
**Do NOT flip `APNS_TOPIC` — that exact flip caused the 2026-07-30
production-fleet outage** (the dev-hosted message outbox sent every
production-token push with the dev topic; Apple rejected all of them
`400 DeviceTokenNotForTopic`). The durable replacement is per-token topics:
`device_tokens.apns_topic` records each registration's own bundle id at
enrollment and `apns.js` addresses each token with it, `APNS_TOPIC` serving
only as the legacy-row fallback (`com.utahprosrestoration.upr` in BOTH
variable sets, permanently). Authored 2026-07-30 — migration
`20260730170000_device_token_apns_topic.sql` + worker + client — pending the
separate owner-authorized apply, then deploy (schema first: the worker selects
the new column and the client passes the new parameter), then a dev-app
launch to re-enroll its token with its topic. Production's variable set is
untouched throughout.

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
show badge, sound, and the typed event alert while the native app is open.
Owner decision 2026-07-29 permits the same event-approved details as PWA. The
JavaScript foreground callback remains content-private and emits only the
constant refresh signal. Appointment audience remains the existing business
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

For sensitive or wrong notification COPY specifically, the narrower stop is
setting `NATIVE_RICH_NOTIFICATION_PRESENTATION` to the exact string `false` in
the affected Cloudflare environment and redeploying: typed rich copy reverts to
the generic fallback while push delivery itself stays up. Reach for the
`APNS_ENV` stop only when delivery itself must halt.

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

## GitHub release environments (verified 2026-07-29 — names only, never values)

`.github/workflows/ios-release.yml` reads from two GitHub environments. As of
2026-07-29 only `ios-testflight`'s three secrets are documented as confirmed;
**`ios-signing` is nowhere evidenced as configured**, and the workflow's
current `workflow_dispatch`-only form has never been dispatched (100 historical
push-triggered runs all failed at startup). The archive job fails closed at
"Validate archive inputs" until `ios-signing` exists with all nine secrets:

| Environment | Required secrets |
|---|---|
| `ios-signing` (archive job) | `APPLE_TEAM_ID`, `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`, `APPLE_PROVISIONING_PROFILE_NAME`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_NATIVE_PUSH_ENABLED` (exact string `true`), `VITE_APNS_ENV` (exact string `production`) |
| `ios-testflight` (publish job) | `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_KEY_CONTENT_BASE64` |

Note the deliberate split: the *Cloudflare hosted* `VITE_NATIVE_PUSH_ENABLED`
stays `false` (enrollment is a native-build concern), while the *`ios-signing`
build-time* value must be exact `true` for the TestFlight build. These are
different stores; do not "fix" one to match the other. First dispatch should
run with `publish_to_testflight: false` to prove the archive/signing lane
before any upload is attempted.

## Build 1.0.0 (2) — verified evidence (2026-07-30 morning)

Second internal-TestFlight build, same Path B route and the same hard gates.

- Source: clean `main` `5dfafb0ba67f6ead27e97d753f5a3e216fc46404` (promotions
  #556 + #557), genuinely clean worktree, zero tracked drift after `cap sync ios`.
- Bundle invariants confirmed in the minified output: `VITE_NATIVE_API_ORIGIN`
  `https://utahpros.app`, `VITE_APNS_ENV` `production`, push flag exact `true`,
  release SHA = that commit, and `VITE_DEV_TEST_*` empty.
- `verify-ios-release-artifact.mjs` **PASS before upload**: 1.0.0 (2),
  `aps-environment=production` on archive and IPA, `get-task-allow=false`,
  App Store profile, privacy manifest, no tracking domains. IPA SHA-256
  `d86be2b024e647116d5005b2f46581a489a13b79521902b7eeab5d8dec981811`; report
  `ios/build/UPR-b2-release-verification.json`.
- Uploaded 2026-07-30 07:11 MT via Organizer → TestFlight **Internal Only**
  (owner signed in; Xcode initially defaulted to the wrong Apple ID). Apple
  reported upload complete for 1.0.0 (2). No App Review submission, no
  `ios-release.yml` dispatch — `ios-signing` secrets still unpopulated.
- Carries: always-complete sign-out + the ended-session revival guard (the fix
  for the 2026-07-29 stuck-sign-out defect), the first-run onboarding tour
  (now database-backed — its migration applied the same morning), signing/legal
  escape hatches, origin-aware job back, nav haptics, and the ITMS-90683
  location purpose string.
- **Sign-out VERIFIED on device (owner, 2026-07-30, build 2).** The owner ran
  the sign-out path on the installed TestFlight build: sign-out completed
  normally — no "Finish securing this device" wall, no session resurrection,
  Login reachable — and **push delivery stopped afterwards**, confirming the
  device-token detach ran for real against production. This closes the defect
  found 2026-07-29 and exercises the cleanup path end-to-end on a
  production-signed build.
- **Still open owner gates:** the *second-account* half of the account-switch
  check (sign in as a different employee and confirm native Push defaults OFF
  for them, and that events for the first employee raise no banner while the
  second is active) — sign-out and the token detach are now proven, but the
  foreign-account default has not been observed; and decoding one real access
  token locally to confirm the `session_id` claim shape the revival guard keys
  on.

## First TestFlight release — verified evidence (2026-07-29 build night)

**Build path used:** Path B (local Xcode archive) per
`docs/handoff/testflight-2026-07-30-macbook.md`, with one disclosed deviation:
signing was **manual**, mirroring the CI Fastfile's exact overrides
(`DEVELOPMENT_TEAM`, `UPR_RELEASE_PROFILE_NAME="UPR App Store 2026"`,
`CURRENT_PROJECT_VERSION=1` on the `xcodebuild` command line, no project-file
edits), because the 2026-07-28 qualification's Apple Distribution certificate
and App Store profile were still installed locally. Automatic signing was not
needed and no agent handled credentials; the owner performed the App Store
Connect sign-in and the Organizer upload themselves.

- Source: clean `main` HEAD `29cc080aaea0df684cc2c4c7a9a53d8df2f53328`,
  zero tracked drift before and after `cap sync ios`.
- Bundle invariants verified in the minified output: API origin
  `https://utahpros.app`, `VITE_NATIVE_PUSH_ENABLED` exact `true`,
  `VITE_APNS_ENV` exact `production`, `VITE_RELEASE_SHA` = the commit above,
  and `VITE_DEV_TEST_EMAIL`/`VITE_DEV_TEST_PASSWORD` forced to empty strings
  (no dev credential reaches a distributed bundle).
- `verify-ios-release-artifact.mjs` **PASS before upload**: 1.0.0 (1),
  `aps-environment=production` on archive and IPA, `get-task-allow=false`,
  App Store profile, privacy manifest bundled, no tracking domains,
  non-exempt encryption false. IPA SHA-256
  `432de929decd75db5e7a48310635bf9abed57f4adde0763e4fb9dd07fb9b039a`;
  sanitized report generated at `ios/build/UPR-release-verification.json`
  with `sourceCommit` set to the verified commit.
- Uploaded 2026-07-29 19:26 MT via Organizer → TestFlight **Internal Only**.
  Apple: delivery successful with warning **ITMS-90683** (missing
  `NSLocationAlwaysAndWhenInUseUsageDescription`); the plist key and a
  verifier required-key guard are committed on `dev` so the next archive
  fails locally instead of warning at Apple.
- **Production delivery matrix (owner-verified on a physical iPhone, real
  assigned-appointment events on utahpros.app):** foreground, background,
  and terminated delivery, tap → correct appointment route, and
  minimize/resume all **passed** the same evening. The **first production
  APNs token** is proven registered by that delivery (a direct value-free
  `device_tokens` read was permission-blocked and unnecessary).
- **Account-switch refusal: not exercised — blocked by a sign-out defect
  found during the attempt.** First sign-out raised the fail-closed
  "Finish securing this device" wall on a network-ambiguous first attempt;
  the owner's Retry succeeded (API log: `delete_my_native_device_token` 204
  at 2026-07-30 01:58:33Z), but the app then bootstrapped straight back into
  the same account (~02:00:06Z, fresh profile load + token re-upsert) without
  ever reaching Login — a token refresh in flight during sign-out re-persisted
  the session (supabase-js lock-steal race). Owner directive (2026-07-29):
  sign-out must always complete immediately; the token detach becomes
  invisible best-effort/journaled. Both defects are now fixed at source: the
  always-complete sign-out contract closed the wall, and the unified
  ended-session revival guard (see the status paragraph above) closed the
  session re-entry. Neither is on-device-verified — the owner account-switch
  check on the physical iPhone remains the open gate. First-login flows for
  fresh tech installs are unaffected.
- Not done, by design: no `ios-release.yml` dispatch (Path A awaits the
  `ios-signing` secrets), no App Review submission, no flag flips.

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

The Dev Tools → Notifications diagnostic is single-environment BY DESIGN: it
targets only tokens matching the worker's currently configured `APNS_ENV`, so
it proves the exact installed build it reaches and nothing more. A green
diagnostic is NOT evidence that the cross-environment production fan-out works,
and a TestFlight (production-token) device exercised against Preview will read
`no_tokens` as a false failure. First-TestFlight push proof is a real
assigned-appointment event on `utahpros.app`, per step 3.

`isNativePushEnrollmentEnabled()` remains deliberately fail-closed: `TRUE`, `1`,
unset, and every value other than exact lowercase `true` keep enrollment off;
so does a missing or malformed `VITE_APNS_ENV`.
Cloudflare changes take effect on the next deployment; the native flag is also a
build-time value, so an already-installed IPA cannot be activated remotely.

The focused preference migration intentionally changes the state that the
deferred broad S1h preflight expects. S1h must therefore be reconciled and
re-qualified before a future apply; its refusal is a safety guard, not a reason
to replay or bypass the focused migration.
