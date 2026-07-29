<!--
FILE: docs/handoff/native-ios-push-and-pwa-session-2026-07-28.md
Claude Code review packet for the 2026-07-28 native iOS, messaging, push, and
PWA remediation session. This is evidence and handoff context, not authority to
apply, deploy, send, upload, promote, or change provider state.
-->

# Native iOS, push activation, messaging, and PWA session handoff

**Session date:** 2026-07-28 (America/Denver)  
**Repository:** Utah-Pros-App-Git  
**Working branch:** `codex/mobile-readiness-native-usability`  
**Starting `origin/dev`:** `c9060b299a5a0430ad4814267322de51a2d9e07f`  
**Reviewed integration commit:** `dc8120797b273c1c5aa944659005aec56b7bbcf3`  
**Current deployed `dev` at this checkpoint:** `d5d08cb48ed083d45108dce018969df760076f55`  
**Current continuation base / `origin/dev`:** `bf45ae00fd96e8b115220fab2d2920472b9ca533`
**Pre-push reconciliation target:** `origin/dev`
`8e1cf9cceba72f027caf91debded4afb6841b276`
**Reviewed continuation source commits:** `64f2d86` through `81f9dac` (16
small logical commits; exact list in section 10)
**Production `main` was not changed.**

This packet is intentionally explicit so another agent can challenge the work
without reconstructing the full conversation. It contains no APNs private key,
App Store Connect private key, bearer token, device token, customer content, or
login credential.

## 1. Owner decisions and scope

The owner asked to finish the current native design before resuming the Apple
Field Pro redesign. The redesign remains deferred until the current app is
polished, feature-complete, distributed through TestFlight, and delivered to
the App Store.

The owner requested and authorized:

- stop challenging Face ID every time the installed app opens; retain the
  biometric challenge only at an enabled sign-in boundary;
- remove the blocking SMS-permission banner from conversation entry while
  preserving the server send boundary;
- treat no recorded objection, no DND, and no STOP opt-out as permission for a
  human one-to-one service text to an existing client;
- keep exact transactional automation examples available, including
  appointment scheduled, appointment canceled, and signature request;
- add installed version information to Settings and establish release
  versioning;
- polish and standardize notification-bell and overflow-menu motion and visual
  treatment;
- keep privacy, terms, and support pages inside the field shell so the user can
  navigate back;
- configure Apple, Cloudflare, GitHub, and the physical iPhone for native push;
- apply only the two focused native-push migrations, not the broader S1h
  personal-ownership migration;
- send one owner-only push test after enrollment;
- restore and verify the existing PWA Web Push experience; and
- commit and push the reviewed work to
  `codex/mobile-readiness-native-usability`, reconcile it to `dev`, and produce
  this review packet.

Moroni Salvador is an owner-authorized test identity/contact. That permission
did not widen the send path, permit arbitrary recipients, expose credentials,
or authorize production customer testing.

## 2. Delivered product behavior

### Face ID and session behavior

- Removed the cold-launch biometric gate that challenged every app open.
- Native biometric verification now runs only as an optional pre-sign-in
  callback, before submitting credentials, when the user has enabled it.
- Missing, malformed, unavailable, or failed biometric probes fail closed.
- Reopening an already authenticated installed app preserves the session
  without another Face ID prompt.

### Versioning

- Added `ios/App/Version.xcconfig` as the central marketing-version source.
- Settings displays the installed native app version and build.
- CI and release verification assert the configured marketing version.
- Current installed Debug identity is `1.0.0 (1)`.

### Notification Center motion and visual treatment

- Stabilized the notification panel lifecycle so opening no longer flashes.
- Added bounded open/close motion and aligned the bell with the existing
  rounded visual system.
- Applied the same motion language to the three-dot menu.
- Improved row hierarchy, unread treatment, grouping, tap targets, safe-area
  behavior, and mutation recovery.
- Added focused motion/markup regression coverage.

### Legal/support navigation

- Settings links use field-shell routes:
  `/tech/legal/privacy`, `/tech/legal/terms`, and `/tech/legal/support`.
- These routes render the same legal components inside `TechLayout`; the bottom
  navigation remains available, eliminating the prior native dead end.

### SMS interaction and enforcement

- Removed the thread-open consent preflight and hidden consent-status banner
  that blocked the composer while policy was being resolved.
- The client still sends staff messages only through
  `POST /api/send-message`; it does not write provider message rows.
- Direct one-to-one service sends use an explicit purpose-scoped decision.
- Explicit STOP/opt-out and DND still fail closed before a provider call.
- Marketing remains separately gated.
- Automated sends still route through `sendAutomatedMessage()`.
- Only an exact allowlist of transactional service events may use the
  no-recorded-opt-in path. The examples implemented include appointment
  scheduled, appointment canceled, and signature request.
- The opt-out-only database migration
  `20260728000000_sms_consent_opt_out_only.sql` was authored and isolated but
  **was not applied to shared production** in this session.

### Native APNs delivery

- Native enrollment is bound to an explicit APNs environment.
- Environment-less legacy tokens are inert.
- Browser callers use selector-free, authenticated self-service RPCs; direct
  access to token and delivery-claim tables is denied.
- APNs delivery has a bounded request lifecycle, durable
  source-occurrence/device claims, controlled release/reclaim for explicit
  retryable Apple responses, compare-and-delete pruning, and no automatic
  replay after a network-ambiguous outcome.
- Notification dispatch routes native delivery through the shared service
  boundary.
- The owner-only diagnostic endpoint fixes recipient, copy, and route on the
  server. Dev Tools can supply only a stable UUID request id.

## 3. Shared Supabase changes

The project is the shared production database
`glsmljpabrwonfiltiqm`. Every apply below was separately owner-authorized and
executed from reviewed migration source. No direct SQL iteration was used
against production.

### Applied in this overall session

| Purpose | Source migration | Live ledger version | Result |
|---|---|---:|---|
| Notification-read recipient boundary (earlier window) | `20260726260000_notification_read_recipient_boundary.sql` | `20260728192024` | Live postcondition and authorized identity checks passed |
| Native APNs token boundary | `20260728223000_native_apns_token_boundary.sql` | `20260729021021` | Applied and live-verified |
| Native push delivery guardrails | `20260728224000_native_push_delivery_guardrails.sql` | `20260729021050` | Applied and live-verified |

Focused native-push source hashes:

- token boundary forward:
  `4936264f1fe8484cfb399f4f9fcd3abfeb39ebd2c3c034e27a4d4fbab543666f`
- token boundary rollback:
  `b584ecc1f3ed834828030866b98e2cec8c1d19ec26bfd17df17dcf387782e273`
- delivery guardrails forward:
  `8457889fb77b5681e63e4143728a18a625523483494cecf5e27ee8d00c9df8ca`
- delivery guardrails rollback:
  `a19b40a81e2fa04b453dfdecc0206f970524b75f9cb2393335dd137d135fc079`

### Live postconditions checked

- Project health: `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.063`.
- Both focused migration ledger rows exist.
- `device_tokens.apns_environment` exists and is nullable for backward
  compatibility; its constraint is validated.
- New native token upsert/delete RPCs do not accept a foreign employee
  selector.
- Intended authenticated RPC execution is present; `anon` execution is absent.
- Legacy authenticated token-writer execution is removed.
- Direct authenticated/anonymous table reads remain denied.
- Token and delivery-claim tables have RLS and forced RLS.
- Delivery claims expose service-only DML.
- Notification-preference policy predicates are fail-closed.
- Authenticated self-preference RPC execution remains available; anonymous
  execution does not.

### Advisor output requiring review, not concealment

Supabase security advisors still report authenticated `SECURITY DEFINER`
functions. These are intentional selector-free, caller-checking RPCs with
pinned `search_path` and explicit revoke/grant posture; Claude should re-audit
that assertion against the source.

Performance advisors report:

- an unindexed foreign key on
  `native_push_delivery_claims.employee_id`;
- an existing notification-preference type foreign-key warning;
- an existing `device_tokens` RLS init-plan warning; and
- a new `claimed_at` index not yet used.

No follow-up migration was improvised during the apply window. These are
explicit optimization-review items.

### Deliberately not applied

- `20260727022920_mobile_personal_ownership_boundary.sql` (broad S1h) remains
  deferred. The focused preference/token boundary changes its expected input
  state, so its preflight should refuse until S1h is reconciled and
  re-qualified.
- `20260728000000_sms_consent_opt_out_only.sql` remains source-only.
- No unrelated migration, rollback, destructive DDL, or data cleanup ran.

## 4. Apple, Cloudflare, GitHub, and device state

### Apple

- Team: `H6ZUT739T9`.
- Bundle: `com.utahprosrestoration.upr`.
- Push Notifications and Associated Domains are enabled.
- APNs key ID `JX22945D4T` is valid for Sandbox and Production.
- App Store Connect app `6795664765` exists as **UPR Field Operations**,
  version 1.0, SKU `UPR-IOS-2026`.
- Distribution certificate `3QA6GT9L28` and App Store profile
  `UPR App Store 2026` exist.
- App Store Connect Admin key ID `XV5CUK6XLC` is configured in the GitHub
  `ios-testflight` environment.
- The first generated APNs/App Store key material that was mishandled during
  setup was revoked before use. Downloaded private-key files were removed;
  private values are not in the repository or this packet.

### Cloudflare

Pages project `utah-pros-app-git` has Preview and Production bindings for:

- `APNS_P8_KEY`
- `APNS_KEY_ID`
- `APNS_TEAM_ID`
- `APNS_TOPIC`
- `APNS_ENV`
- `VITE_NATIVE_PUSH_ENABLED`

Preview uses APNs sandbox; Production uses APNs production. Hosted
`VITE_NATIVE_PUSH_ENABLED=false` remains intentional so a web deployment cannot
enroll native tokens. Native builds independently require exact
`VITE_NATIVE_PUSH_ENABLED=true` plus a valid `VITE_APNS_ENV`.

The compatible `dev` deployment for `d5d08cb` is live at its immutable Pages
deployment and through `https://dev.utahpros.app`. Production `main` was not
promoted.

### GitHub

The `ios-testflight` environment contains encrypted
`ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_CONTENT_BASE64`. This closes the
App Store Connect API authentication-key gate only. Provider upload remains
owner-gated.

### Physical iPhone

- Device: owner's iPhone 17 Pro Max.
- Development build: bundle `com.utahprosrestoration.upr`, team
  `H6ZUT739T9`, `1.0.0 (1)`.
- Entitlement: `aps-environment=development`.
- Native build inputs:
  `VITE_NATIVE_API_ORIGIN=https://dev.utahpros.app`,
  `VITE_NATIVE_PUSH_ENABLED=true`, `VITE_APNS_ENV=sandbox`, and reviewed
  release SHA.
- The app was signed, installed in place over Wi-Fi, launched, and retained its
  session.
- A fresh redacted sandbox token registered after the migrations applied.
  Two older environment-less rows remain inert.

### Distribution proof

A local Xcode 26.6 Release archive and IPA previously passed bundle/team,
version/build, signature, App Store profile, production APNs entitlement,
`get-task-allow=false`, encryption declaration, privacy manifest, and
archive/IPA parity checks. Qualification IPA SHA-256:
`eb022fae79464c25980746e961e80b383958677854ec5eafe1b4365d840b4b41`.

That archive came from a dirty worktree and is **not** the final upload
artifact. TestFlight still requires a clean-source archive from the final
reviewed SHA and separate upload authorization.

## 5. PWA More/Web Push incident

The owner reported an installed mobile PWA failure on More. Its support code was
`upr-web-c9060b299a5a0430ad4814267322de51a2d9e07f`, proving the running shell was
the session's old starting release while hosted `dev` had advanced to
`d5d08cb`.

Evidence collected:

- no native-push commit changed `TechMore.jsx`,
  `NotificationsSection.jsx`, `webPushClient.js`, `pwaServiceWorker.js`, or
  `registerSW.js` between the reported release and current `dev`;
- the current hosted module map names the current `TechMore` chunk, and that
  chunk returns HTTP 200 JavaScript;
- the current `TechMore` page renders under both field-tech and admin-mobile
  identities in `TechMore.render.test.jsx`;
- `feature:web_push` remains enabled for the owner and is not force-disabled;
- `/api/vapid-public-key` reports configured;
- authenticated Web Push upsert/get/delete RPC execution remains present and
  anonymous execution remains denied; and
- the owner still has two existing Web Push subscriptions, latest from
  2026-07-27.

The evidence does not support the hypothesis that the focused APNs migrations
disabled PWA Web Push. It supports a stale installed-PWA shell/chunk. The
existing **Clear cache & reload** action uses the `/reset` cache-only recovery,
preserving login and subscription state. On 2026-07-28, after reinstall/recovery,
the owner enabled mobile notifications on one physical PWA installation and
confirmed that Settings reported Push **On**. If a second PWA installation is
still in use, its independent subscription state remains to be confirmed.

## 6. Verification actually performed

### Full repository verification on reviewed integration source

- `npm run build` — passed.
- `npm test` — passed:
  - unit: 1,313 tests;
  - Worker: 1,539 tests;
  - QA: 563 tests;
  - zero unexpected skips.

### Focused push verification

- Official disposable local Supabase forward/behavior/rollback suites for both
  focused migrations — passed before live apply.
- Static migration contracts under `tests/qa/unit` — passed.
- Specialized migration-safety, anonymous-grant, and mobile-security reviews —
  no blocking finding.
- `UPR_TEST_LANE=worker npx vitest run
  functions/api/send-push.test.js functions/lib/apns.test.js` — 20 passed.
- Signed Debug Xcode build — passed.
- Physical install, launch, and redacted sandbox enrollment — passed.

### PWA regression verification

- `UPR_TEST_LANE=unit npx vitest run
  src/pages/tech/TechMore.render.test.jsx` — 2 passed.
- Focused PWA/Web Push lane including `webPushClient`,
  `pwaServiceWorker`, `registerSW`, and `TechMore` — 35 passed.
- Current hosted `TechMore` chunk fetch — HTTP 200 JavaScript.

### Lint

Changed-file lint for `DevTools.jsx` retains 41 legacy findings
(16 errors, 25 warnings), down from the committed baseline of 43
(16 errors, 27 warnings). The session introduced zero new findings and removed
two raw-toast warnings by routing feedback through `src/lib/toast.js`.
This is not a claim that `DevTools.jsx` is globally lint-clean.

## 7. Adversarial review notes for Claude Code

Please challenge these areas first:

1. Re-derive every `SECURITY DEFINER` caller check, `search_path`, revoke, grant,
   and direct-table denial in the two live push migrations.
2. Confirm the delivery-claim state machine never retries a network-ambiguous
   APNs outcome and cannot duplicate across notification dispatch paths.
3. Confirm a stale-token response can compare-and-delete only the version Apple
   rejected.
4. Confirm `POST /api/send-push` cannot choose another employee, arbitrary
   payload, arbitrary route, or reuse an unstable idempotency key.
5. Re-run consent/DND/STOP/START/HELP/quiet-hours tests and trace every
   automated send through `sendAutomatedMessage()`.
6. Review the exact transactional-event allowlist for accidental marketing or
   free-form use.
7. Decide whether the unindexed delivery-claim foreign key merits an additive,
   separately qualified migration before scale.
8. Verify the PWA incident on a real installed PWA after cache recovery; do not
   accept source tests as device proof.
9. Produce the final TestFlight archive only from a clean reviewed SHA and
   confirm `aps-environment=production` in the exported artifact.
10. Keep the Apple Field Pro redesign deferred; do not mix it into release
    stabilization.

## 8. Still open / not claimed done

- The one background APNs banner and tap-to-`/tech/settings` proof must be
  observed on the physical phone.
- Physical PWA More/Settings/Web Push confirmation after cache recovery remains
  required.
- The final documentation/test close-out commit is not represented by the
  checkpoint SHA at the top until this packet is finalized.
- Production `dev → main` review/promotion did not occur.
- A clean-source production archive was not created from the final SHA.
- No TestFlight upload, processing, internal-tester install, or App Store
  submission occurred.
- No outbound SMS was sent.
- The broad S1h migration remains deferred and now needs reconciliation.
- The opt-out-only SMS migration remains unapplied.
- Complete iPhone/iPad/device-orientation qualification remains open.
- Apple Field Pro redesign work remains deferred.

## 9. Commit chronology

The following commits are reachable after starting release `c9060b2`:

```text
f6f28e9 test(native): define sign-in biometric boundary
1858522 fix(native): challenge biometrics only at sign-in
34bccc0 refactor(native): retire cold-launch biometric gate
0ec7126 test(native): define installed app identity
0de3ab7 feat(native): show installed version in settings
9ee5a36 build(ios): centralize marketing version
a8c0682 ci(ios): verify release marketing version
7c6cd99 fix(native): stabilize notification panel lifecycle
8c4b3d0 feat(native): animate notification popover
ec768d6 docs(mobile): align native release contracts
8e1b1f4 docs(native): record sign-in and bell behavior
281eeab docs(ios): update release status and redesign deferral
40293e9 fix(native): reuse safe-area owner for bell
c538ebc fix(native): align sign-in and bell controls
d5129b2 fix(native): make bell mutations recoverable
3b97bab fix(native): fail closed on biometric probe errors
7aed08d test(native): block malformed biometric probes
6f67931 docs(native): qualify simulator motion evidence
a871c85 docs(ios): record native session prompt decision
d898091 docs(native): align session hardening registry
3409ef4 fix(db): harden notification recipient migration
7564155 test(db): prove fail-closed notification rollback
ebd737a docs(db): record corrected notification boundary
8748533 docs(mobile): pin corrected S1g apply gate
71e81dd docs(audit): capture S1g qualification correction
86050e5 docs(audit): close S1g pre-apply qualification
58a14ae docs(audit): capture live S1g provenance
3ab2f85 docs(database): refresh live S1g catalog
04be455 docs(mobile): record S1g live verification
0452862 docs(mobile): advance S1g readiness status
10768dd feat(mobile): polish native notification popovers
e721667 test(mobile): lock notification popover polish
3bacff8 fix(sms): define purpose-scoped consent codes
2a8df3d fix(sms): keep automated sends globally opted in
b543c92 fix(sms): enforce direct one-to-one service consent
df68952 fix(sms): remove thread-open consent preflight
2cb8a47 fix(sms): suppress hidden consent status copy
a092a1d db(sms): add guarded opt-out-only consent decision
67ee2bf docs(sms): record direct implied-consent boundary
f882f3d ci(ios): bound archive and upload subprocesses
72c5261 ci(ios): reverify signed release artifacts
cae5391 docs(ios): record signed release and push gates
d74ef4a docs(mobile): reconcile push rollout runbook
7f5581f docs(mobile): refresh release and consent context
1ded030 db(push): isolate native APNs token ownership
1c490f4 fix(ios): bind push environment and Face ID login
8af4a6c ci(ios): require production APNs environment
0b37d82 feat(push): add bounded APNs delivery
15a86d9 feat(push): route APNs through notification dispatcher
2b95ec1 feat(sms): allow exact transactional service notices
44891be fix(sms): audit implied service sends before provider
1d91a27 docs(sms): lock transactional service boundary
8d2eb32 docs(push): adopt focused APNs activation path
a2e5803 docs(release): record native token and archive gates
dc81207 Harden native push readiness and SMS consent
d5d08cb feat(dev-tools): add owner native push test
```

## 10. Device push controls added after the checkpoint

The final source batch adds device-local Turn on/Turn off controls to Settings
→ Notifications on both supported clients without merging the channels:

- browser and installed-PWA controls continue to use only the Web Push
  service-worker subscription;
- Capacitor controls use only this app installation's APNs registration and
  selector-free owner RPCs;
- new native installations default off; the preference is a versioned,
  owner-bound record; a legacy local `true` may migrate on only when the
  existing device binding proves the same owner; and an explicit off survives
  restart;
- an account switch cannot carry account A's native-on preference into account
  B: account B performs no permission, APNs, or enrollment RPC work until that
  account explicitly turns Push on;
- native off is persisted before any await, so Auth bootstrap cannot race it
  back on;
- a registration that overlaps off writes an owner-bound detach marker before
  upsert, retains it until the possibly committed request settles, and runs a
  final owner-scoped delete afterward;
- same-owner Settings/Auth enrollment joins one in-flight attempt instead of
  misclassifying its marker as stale cleanup;
- the v2 journal distinguishes provisional enrollment from confirmed cleanup:
  only SQLSTATE `42501` with the exact foreign-owner RPC phrase can release a
  provisional marker, while generic authorization failures and
  network-ambiguous upserts remain journaled through immediate cleanup until a
  later same-owner reconciliation after a 60-second safety window;
- failed explicit native enable returns the durable intent to off;
- native Settings checks current iOS permission on load and silently on resume,
  never calls denied, unknown, or cleanup-pending delivery On, and never
  returns or renders the raw token;
- logout/detach best-effort clears already-delivered native notifications from
  the device;
- native APNs banners always use fixed generic copy (`Utah Pros notification` /
  `Open Utah Pros for details.`); customer, appointment, message, and financial text is never
  serialized into the APNs alert;
- APNs data carries only an allowlisted route plus a stable opaque recipient
  binding, and a tap is routed only when that binding matches the current
  employee; a notification delivered for account A cannot route under account
  B; and
- English, Spanish, and Portuguese Settings copy describes the two native
  states and pending cleanup.

Files in this reviewed continuation batch:

- `.github/workflows/ios-release.yml`
- `.github/workflows/capgo-deploy.yml`
- `capacitor.config.json`
- `functions/api/notify.js`
- `functions/api/notify.test.js`
- `functions/lib/apns.js`
- `functions/lib/apns.test.js`
- `scripts/ios-release-workflow.test.js`
- `scripts/qa/run-owned-subprocess.mjs`
- `scripts/qa/verify-notifications-settings-ui.mjs`
- `src/components/NativeNavigationBridge.jsx`
- `src/components/NativeNavigationBridge.test.jsx`
- `src/lib/nativeAppLinks.js`
- `src/lib/nativeAppLinks.test.js`
- `src/lib/nativeNavigationTarget.js`
- `src/lib/pushNotifications.js`
- `src/lib/pushNotifications.test.js`
- `tests/qa/unit/native-navigation-source.test.js`
- `tests/qa/fixtures/notifications-settings.html`
- `tests/qa/fixtures/notifications-settings.jsx`
- `tests/qa/fixtures/notifications-settings-mocks/*`
- `src/components/tech/settings/NotificationsSection.jsx`
- `src/components/tech/settings/nativePushPresentation.js`
- `src/components/tech/settings/notificationsSection.native.test.jsx`
- `src/i18n/locales/{en,es,pt}/settings.json`
- `src/index.css`
- `UPR-Web-Context.md`
- `docs/app-store-readiness-roadmap.md`
- `docs/audit/mobile-pwa/16-validation-log.md`
- `docs/audit/mobile-pwa/17-native-push-testflight-preflight-2026-07-28.md`
- `docs/audit/mobile-pwa/18-notifications-settings-closeout-2026-07-28.md`
- `docs/audit/2026-07/native-ios/README.md`
- `docs/mobile-production-readiness-roadmap.md`
- `docs/mobile-production-readiness-setup.md`
- `docs/mobile/data-contracts.md`
- `docs/mobile/pwa-and-capacitor.md`
- `docs/mobile/push-activation-owner-gate.md`
- `docs/mobile/testing-and-release.md`
- this handoff

Reviewed source commit sequence:

1. `64f2d86` — Harden native notification routes
2. `6840b20` — Bind native notification navigation
3. `2c8bf52` — Harden native push registration
4. `5917304` — Separate native and web push settings
5. `f84324e` — Clarify notification settings copy
6. `491b27f` — Add notification settings QA fixture
7. `05abce1` — Mock notification fixture dependencies
8. `b256168` — Verify mobile notification settings UI
9. `363253a` — Record notification settings closeout
10. `b913800` — Minimize APNs notification payloads
11. `b86aaaa` — Scope appointment push recipients
12. `23240a0` — Harden TestFlight release workflow
13. `d759571` — Disable dormant native OTA publishing
14. `49b2a72` — Document native push contracts
15. `46d9a6f` — Update mobile release guidance
16. `81f9dac` — Record native TestFlight preflight

Before the authorized branch push, `origin/dev` advanced from the continuation
base to `8e1cf9cceba72f027caf91debded4afb6841b276`. The wave was therefore
reconciled by an ordinary merge without rewriting history. The two conflicts
were intentional overlapping contracts: the lean `UPR-Web-Context.md`
restructure and lazy Spanish/Portuguese locale loading in the native
notification Settings test. Resolution preserves `dev`'s lean context and
`ensureLanguage()` behavior while retaining the reviewed native Push controls
and tests. The reconciled merge commit is
`10d8c70ec4cb1582cfa7644ef1e9862290e78bf8`.

The final TestFlight workflow now builds the native bundle only with
`VITE_NATIVE_API_ORIGIN=https://utahpros.app` and
`VITE_RELEASE_SHA=${{ github.sha }}`. A source gate refuses any other API
origin or SHA. Both archive and publish jobs install Bundler `2.5.22`, matching
`ios/Gemfile.lock`; the workflow source tests lock all three contracts.

The first independent mobile security review requested four major fixes:
owner-bind the durable on/off preference, distinguish exact foreign-token
proof from generic `42501`, bind notification taps to the current employee,
and remove private content from foreground-visible APNs alerts. The first
release audit requested production API/SHA workflow inputs, lockfile-consistent
Bundler, removal or full proof of the newly proposed CSS motion, current
canonical release documentation, retained exact Xcode preflight evidence, and
an explicit Push pilot stop/rollback plan. All requested changes are present
in this working tree.

The final security re-review then requested four further major fixes: parse the
exact structured PostgREST ownership error instead of searching serialized
text; reuse the native route/query policy in the APNs worker before provider
serialization; make appointment audiences structurally crew-scoped even when
trusted callers supply `recipient_ids`; and hard-disable plus API-pin the
dormant Capgo workflow. These changes and negative tests are also present.
The next pass caught that the shared navigation policy still admitted the
public signing bearer paths `/sign/:token` and `/s/:code` into Push data. The
Push-only resolver now rejects both to `/`, while ordinary Universal/App Links
retain them; APNs tests prove neither bearer value reaches serialized provider
data. The same review tightened the browser proof to the shared egress guard
and a scrubbed child environment. The release auditor rejected the first
resume proof because it mocked the hook, omitted 48px/clipping assertions, and
failed exact scroll equality by two pixels. The final fixture uses the real
tech shell and real resume hook, checks all three states, reports an explicit
failure above two pixels, and passed the exact bounded command twice with zero
measured drift on the current source.
Final independent close-out then passed without a blocker, major, or minor
finding in all six lanes: mobile Push security, notification contract,
TestFlight release readiness, UPR source patterns, design/motion consistency,
and page lifecycle behavior. The UPR pattern reviewer initially questioned a
duplicate refresh, then explicitly withdrew that concern after confirming the
native and Web Push branches are mutually exclusive. Final integrated tests
and independent re-reviews are recorded below before publication.

Focused post-remediation and final integrated verification:

- native Push/bridge/Settings/release-workflow unit lane — 114 passed;
- APNs/notification-dispatch worker lane — 83 passed;
- native navigation QA lane — 9 passed;
- targeted ESLint across changed executable files — zero findings;
- `npm test` — 1,356 unit, 1,548 Worker, and 564 QA tests passed
  with zero unexpected skips after the static navigation contract was updated
  to require the employee-bound action resolver and the reconciled locale test
  adopted `dev`'s lazy `ensureLanguage()` contract;
- repository-wide `npm run lint` still fails the unrelated baseline with 2,964
  findings (1,375 errors, 1,589 warnings); the explicit changed-file ratchet
  above is clean;
- the real Notifications Settings component passed the credential-free
  390×844 forced loading/error/ready check twice and a 31-second silent resume
  check through the real hook under controlled visibility events; route, input,
  ready state, and scroll were preserved with zero measured drift on both
  final current-source runs (the runner fails above two pixels), visible
  actions were at least 48px, ordinary press feedback and its reduced-motion
  fallback were both verified, horizontal overflow/clipping was zero, local
  POST/external WebSocket probes were denied, zero external requests were
  allowed, and the scrubbed child environment was used; both owned
  browser/server process groups were verified gone and the limitations are
  retained in
  `docs/audit/mobile-pwa/18-notifications-settings-closeout-2026-07-28.md`;
- the release subprocess tree test was made deterministic under the full
  parallel unit lane by using a lightweight POSIX child tree; it still proves
  timeout status `124`, whole-group cleanup, and descendant process removal;
- `npm run build` — passed; compared with base `bf45ae0`, the five largest
  named JavaScript deltas were `AuthContext` +3,416 B (+1,529 B gzip), `i18n`
  +3,030 B (+4,019 B gzip), `TechSettings` +2,156 B (+685 B gzip), `index`
  +1,751 B (+929 B gzip), and `realtime` +240 B (+222 B gzip; tied at
  +240 B raw with `supabase` and `SignPage`); the final scoped 48px
  failure-action and GPU-only press-motion rules added 420 B raw / 63 B gzip
  to the built CSS. Source `index.css` is 590,687 B, below the 595,000 B
  ceiling, and no new render-blocking asset was emitted;
- production-configured native Vite build — passed with exact production API,
  Push enabled, production APNs, and a local preflight release marker;
- `cap sync ios` — passed with ten plugins and no tracked `ios/` drift;
- bounded unsigned generic-iOS Release build with Xcode 26.6 — passed; the
  owned process group was verified gone and temporary DerivedData was removed;
  and
- exact commands, bundle/version/build, privacy manifest, generated Push
  presentation options, release marker, limitations, and cleanup are retained
  in
  `docs/audit/mobile-pwa/17-native-push-testflight-preflight-2026-07-28.md`.

Post-merge requalification against `origin/dev` `8e1cf9c`:

- focused lazy-locale/native Settings test — 13 passed; targeted ESLint clean;
- `npm run build` — passed with 693 modules;
- blocking `npm run report:bundle-size -- --strict` — passed. Entry-graph
  JavaScript is advisory-over-target at 258,516 B gzip but remains 2,809 B
  below the failure line; the heaviest route is 163,412 B raw under 179,200 B;
  final built CSS is 433,174 B raw / 63,191 B gzip;
- the exact bounded 390×844 browser harness passed again after the merge and
  final motion refinement with 48px actions, zero clipping/overflow, real
  31-second resume, zero scroll drift, ordinary/reduced-motion behavior, zero
  allowed external requests, and verified owned-process cleanup;
- L0 bridge — 14/14 passed; tooling adapters current; tooling governance had
  zero errors/warnings; tooling tests 23/23 passed; and
- the newly inherited `review-animations` feel-gate found and removed
  paint-triggering color transitions from the Settings press feedback. Final
  verdict: **Approve**. Exact table and device limitation are retained in
  `docs/audit/mobile-pwa/18-notifications-settings-closeout-2026-07-28.md`.

The continuation source is committed in the 16 small logical commits listed
above, the evidence handoff commit `2b94522`, and the ordinary current-`dev`
merge `10d8c70`. The final motion/evidence commit follows this report update;
the single owner-authorized branch push is intentionally performed only after
that commit, so the real remote outcome must be reported alongside this packet.
This continuation has not been integrated into `dev`, deployed, promoted to
`main`, or uploaded to TestFlight. After the reviewed source verification, the
owner separately authorized a physical-device update.
The native bundle was rebuilt with
`VITE_NATIVE_API_ORIGIN=https://dev.utahpros.app`,
`VITE_NATIVE_PUSH_ENABLED=true`, and `VITE_APNS_ENV=sandbox`; `cap sync ios`
completed with no tracked native-project drift. Xcode 26.6 produced a signed
Debug app carrying the development Push entitlement, and the app was installed
in place over Wi-Fi on the owner's iPhone 17 Pro Max. Device tooling confirmed
UPR `1.0.0 (1)` installed, launched, and remained running. The owner later
authorized one bounded Dev Tools send and observed the notification while the
Debug app was in the background. That proves sandbox APNs delivery to this
development-signed installation; it does not prove production delivery or the
TestFlight foreground/background/tap matrix.

A final local release preflight built the native bundle with exact
`VITE_NATIVE_PUSH_ENABLED=true` and `VITE_APNS_ENV=production`, synchronized
Capacitor with no tracked `ios/App` drift, verified the generated foreground
presentation options, and completed an unsigned generic-iOS Release build with
Xcode 26.6. The production-signed artifact remains deliberately delegated to
the `main`-only GitHub release workflow and its protected signing environment.
The repository-wide lint command still reports the large pre-existing baseline
outside this batch; changed executable files have zero findings (the JSON
config is outside the targeted ESLint configuration). Local macOS still has
Ruby 2.6 and Bundler 1.17.2, so a local clean Bundler 2.5.22 dependency check
was not possible; the protected workflow installs Ruby 3.3 and the exact
lockfile Bundler before archiving.

## 11. Safe continuation

1. One recovered physical PWA installation now reports Push **On**. Confirm
   the second installation separately only if it remains in use.
2. Keep the existing appointment audience rule: only assigned employees
   receive appointment Push.
3. Preserve the completed integrated tests, browser close-out evidence,
   successful Xcode 26.6 unsigned Release preflight, and native foreground
   alert/badge/sound source contract through independent security/release
   re-review.
4. Complete the already-authorized single push of the reviewed wave branch
   after the final documentation commit, and record its exact remote tip.
5. After a separate owner authorization, reconcile the wave into `dev`, push
   `dev`, and verify the deployed PWA before production promotion.
6. After another separate owner authorization, open and merge the reviewed
   `dev → main` release PR without rewriting history.
7. Reauthenticate GitHub CLI if needed, then—only after separate TestFlight
   upload authorization—dispatch the `main`-only iOS release workflow with
   publishing enabled. The workflow performs the production-signed archive,
   export, artifact checks, and App Store Connect upload.
8. Install the processed TestFlight build, turn on native Push to register a
   production token, and verify assigned-appointment and inbound-message
   delivery in foreground, background, terminated, and tap-open states.
9. Exercise an account A→B switch and verify an A notification cannot route or
   carry the on preference into B.
10. Treat every additional test Push as a separate owner-authorized external
   send; never expose tokens, private keys, or notification contents in evidence.
