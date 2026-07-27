# UPR Mobile PWA and Capacitor Audit — Normalized Findings Ledger

**Audited snapshot:** `ef305f6d6afab4d846eab92fc1b04038d70221f0`

**Normalization rule:** one canonical ID per root issue; conditional runtime gates are identified
explicitly. P0/P1 counts include conditional blockers because they must be resolved or formally
excluded from the supported product promise before release.

## MOB-STATE-001 — Persisted mobile state is not isolated by account

- **Category / Severity / Confidence / Effort / Blocks production:** Session state and privacy / P1
  / High / M / **Yes** for shared-device or primary-interface use.
- **Production-readiness impact:** Query data and restored navigation can survive logout and be
  presented under a later session.
- **User or business impact:** A shared/reassigned device can expose prior job, customer, schedule,
  or inbox metadata and resume the wrong workflow.
- **Evidence:** One device-global IndexedDB/key persists most tech queries for 24 hours; several keys
  omit employee identity; logout clears React/auth state but not query persistence or saved route.
  Raw SMS thread bodies are deliberately excluded, which limits but does not remove the risk.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/techQueryPersister.js:35-49,83-87`;
  `src/lib/techQuery.js:69-83,140-158`; `src/contexts/AuthContext.jsx:272-283`;
  `src/lib/resumeRestore.js:34-44,80-91`; all authenticated `/tech/*` routes; cached results from
  jobs, appointments, claims, conversations, and related RPCs.
- **Root cause:** Persistence keys and lifecycle were designed per device/build, not per authenticated
  principal.
- **Recommended remediation / verification / dependencies:** Namespace persisted state by stable auth
  identity; clear or quarantine it on logout/account change; inventory local drafts/preferences; test
  two synthetic accounts through logout, token expiry, offline logout, and reinstall/update.
  Depends on a canonical device-data classification and `MOB-PWA-037`.

## MOB-DATA-002 — Offline work has no immutable authenticated owner

- **Category / Severity / Confidence / Effort / Blocks production:** Offline mutation safety / P1 /
  Confirmed / M / **Yes** wherever queued work is supported.
- **Production-readiness impact:** Device-global pending side effects are not bound to the account
  that created them.
- **User or business impact:** A later user can submit another technician's photo, room, reading,
  equipment, note, or task action; an old runner can also retain stale auth dependencies.
- **Evidence:** Queue rows/enqueue omit user and employee identity; the runner drains every pending
  row with current dependencies; incomplete initialization can return the existing singleton, and
  the hook intentionally leaves it running.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/offlineDb.js:65-80`;
  `src/hooks/useOfflineQueue.js:111-128`; `src/lib/syncRunnerSingleton.js:15-28`;
  `src/lib/syncRunner.js:77-91`; `AuthContext.jsx:272-283`; appointment/job hub offline mutations;
  job_documents, rooms, readings, equipment, tasks, `job-files`.
- **Root cause:** The queue is modeled as device work rather than principal-owned commands.
- **Recommended remediation / verification / dependencies:** Add immutable auth-user/employee owner,
  tenant, created-release, and operation ID; refuse cross-owner dispatch; quarantine/prompt on account
  change; test logout, disabled user, token refresh, shared device, and two-tab ownership. Depends on
  the state lifecycle from `MOB-STATE-001`.

## MOB-COMP-003 — Device SMS shortcuts bypass UPR messaging controls

- **Category / Severity / Confidence / Effort / Blocks production:** Messaging compliance / P1 /
  High / M / **Yes** for company/customer messaging from these actions.
- **Production-readiness impact:** Field surfaces can leave the governed UPR send boundary.
- **User or business impact:** If a user completes the device-composer send, UPR cannot enforce
  consent, DND, STOP, sender identity, quiet-hour/retry policy, or audit recording.
- **Evidence:** Three mobile surfaces launch `sms:`; the in-app worker separately implements
  consent/DND/STOP and audit controls. Clicking does not itself send—the risk occurs when the user
  completes the external send.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/components/tech/ActionBar.jsx:25-33,89-97`;
  `src/pages/tech/TechAppointment.jsx:709-723`; `src/pages/tech/v2/hub/HubDock.jsx:190-209`;
  `functions/api/send-message.js:31-39,74-161`; appointment/job hub contact actions; contacts,
  conversations, messages, sms_consent_log.
- **Root cause:** Convenience links were retained beside a later governed company-message channel.
- **Recommended remediation / verification / dependencies:** Remove company-message shortcuts or
  route them to the governed composer; separately label personal-device communications if policy
  permits them; test consent, DND, STOP/START/HELP, audit event, sender, and device handoff with
  controlled synthetic recipients. Depends on an owner-approved communication policy.

## MOB-ROLLOUT-004 — Disabling v2 primary-pane flags can blank core routes

- **Category / Severity / Confidence / Effort / Blocks production:** Feature rollout and recovery /
  P1 / High / S / **Yes** as a rollback/kill-switch defect.
- **Production-readiness impact:** A supposed safety control can remove Dashboard or Schedule without
  providing a fallback.
- **User or business impact:** Field users can land on an empty primary route during rollback or
  misconfiguration.
- **Evidence:** `/tech` and `/tech/schedule` route elements are `null`; their content exists only in
  flag-controlled persistent panes.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/App.jsx:260-270`;
  `src/components/TechLayout.jsx:253-266,299-335`; Dashboard and Schedule launch/navigation;
  feature-flag RPC/table. Live flag state was not changed or relied upon.
- **Root cause:** Legacy fallbacks were removed before the controlling flags were retired or made
  fail-safe.
- **Recommended remediation / verification / dependencies:** Make the routes own a guaranteed
  default screen, or retire the obsolete flags; add flag-on/off/missing/load-error route tests and a
  production rollback drill. Depends on a product decision about whether the flags remain controls.

## MOB-ROLLOUT-005 — Generic feature-flag failure exposes incomplete capabilities

- **Category / Severity / Confidence / Effort / Blocks production:** Feature rollout / P1 / High / S
  / **Yes** for dark-launched or incomplete routes.
- **Production-readiness impact:** A flag service/network failure changes intended-disabled behavior
  to enabled for generic feature checks.
- **User or business impact:** Users can enter incomplete Job Hub/tools/preview behavior when flag
  state cannot load.
- **Evidence:** Load failure stores `{}`; the generic helper treats a missing row as unrestricted;
  `FeatureRoute` inherits that rule. Web-push mirroring and job-hub navigation retargeting have
  narrower fail-closed handling, so the finding is scoped to generic feature exposure.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/contexts/AuthContext.jsx:157-184,340-361`;
  `src/App.jsx:182-188,277-282`; direct feature-gated routes; feature flags and employee overrides.
- **Root cause:** Backward-compatible “missing means enabled” semantics are also used for staged
  product capabilities.
- **Recommended remediation / verification / dependencies:** Classify flags as release gates versus
  optional configuration; fail closed for gated capabilities while preserving explicit safe
  defaults; test missing/error/stale/offline states per flag. No database mutation is needed to
  verify in isolated fixtures.

## MOB-ARCH-006 — Native route graph packages office-admin mobile workflows

- **Category / Severity / Confidence / Effort / Blocks production:** Mobile architecture / P2 /
  Confirmed / M / **No** if deliberately supported and secured; otherwise a release-scope blocker.
- **Production-readiness impact:** The field-only native boundary is broader than comments/product
  framing suggest, increasing release, permission, money, and testing scope.
- **User or business impact:** Admin financial/lead capabilities can drift into a field binary and
  must be secured/tested even when hidden.
- **Evidence:** `TechRoutes` is shared with native and includes `/tech/admin/*`; React role/flag guard
  hides the subtree but does not remove code/contracts.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/App.jsx:265-310,657`;
  `src/pages/tech/admin/AdminMobileRoutes.jsx:46-64`;
  `src/components/admin-mobile/AdminMobileRoute.jsx`; all admin-mobile RPCs/tables/workers.
- **Root cause:** One shared route tree optimizes reuse without a documented native capability
  allowlist.
- **Recommended remediation / verification / dependencies:** Decide whether native admin is
  supported; if not, exclude it at build-time; if yes, include its security, money, privacy, device,
  and App Review paths in the release contract. Depends on `MOB-SEC-014`.

## MOB-PERF-007 — Hidden primary panes retain background work and data

- **Category / Severity / Confidence / Effort / Blocks production:** Performance and lifecycle / P2 /
  High / M / **No**.
- **Production-readiness impact:** Dashboard, Schedule, and Messages remain mounted while hidden,
  retaining queries/DOM and some background activity.
- **User or business impact:** Possible extra radio, battery, memory, and request use; no measured
  field slowdown was established.
- **Evidence:** All flagged panes remain mounted; Dashboard/Schedule queries stay enabled; loaded
  months accumulate; conversations preserve shared polling/realtime for the global badge. GPS,
  now-line, and thread listeners have active gating, which limits the defect.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/components/TechLayout.jsx:253-266,299-324`;
  `TechDashV2.jsx:69-74`; `useScheduleData.js:47-79`;
  `useTechConversations.js:94-122`; `AttentionStrip.jsx:93-104`; primary tabs and their RPCs.
- **Root cause:** Scroll/state continuity is implemented through permanent mounting rather than
  separating retained state from active effects.
- **Recommended remediation / verification / dependencies:** Keep desired state but gate/deactivate
  hidden effects, bound month retention, and centralize shared badge data; measure requests, memory,
  battery proxies, and resume behavior on device before/after. Depends on supported continuity UX.

## MOB-UX-008 — Implemented scope-sheet workflow is presented as “Soon”

- **Category / Severity / Confidence / Effort / Blocks production:** Product discoverability / P2 /
  Confirmed / XS / **No**.
- **Production-readiness impact:** A substantial routed workflow is unreachable from its expected
  More navigation entry.
- **User or business impact:** Technicians may believe scope sheets require desktop/manual work even
  though the mobile implementation exists.
- **Evidence:** `/tech/tools/demo-sheet` is routed and implemented, while the More row is disabled
  with `comingSoon`.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/App.jsx:301-303`;
  `src/pages/tech/TechMore.jsx:201,281-282`; `TechDemoSheet.jsx:18-51,831-844,1009-1102`;
  demo_sheet schemas/forms and PDF/email workers.
- **Root cause:** Product rollout/navigation status did not reconcile with implementation state.
- **Recommended remediation / verification / dependencies:** Owner decides ship/hide/remove; if
  shipped, enable a clear route and validate permissions, drafts, PDF/email, offline/account state,
  and help content; if not, document the gate. Depends on security/provider verification.

## MOB-PRIV-009 — Native app-switcher privacy protection is a no-op

- **Category / Severity / Confidence / Effort / Blocks production:** Native privacy / P1 /
  Confirmed / M / **Yes** for native release containing customer/financial data.
- **Production-readiness impact:** Backgrounding does not cover sensitive screen snapshots.
- **User or business impact:** Claim, customer, message, employee, and financial content can remain
  visible in the OS app switcher.
- **Evidence:** `enablePrivacyScreen()` is an empty function and `App` documents/calls the stub.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/nativeBiometric.js:68-70`;
  `src/App.jsx:624-639`; every authenticated native route; sensitive data from jobs, contacts,
  messages, claims, invoices, payments.
- **Root cause:** Compatible privacy-screen integration was deferred while leaving an inert API.
- **Recommended remediation / verification / dependencies:** Add a Capacitor-8-compatible
  pause/resume privacy overlay or native mechanism; test app switcher, interruption, screen capture
  policy, unlock, and accessibility on signed iPhone/iPad. Depends on native lifecycle abstraction.

## MOB-OFFLINE-010 — A cold or evicted PWA cannot load offline

- **Category / Severity / Confidence / Effort / Blocks production:** PWA offline capability / P1 /
  Confirmed / L / **Yes if no-signal cold start is a
  supported field requirement**.
- **Production-readiness impact:** The service worker cannot supply the app shell or route assets
  without network.
- **User or business impact:** A technician launching after OS/browser eviction in a basement or
  outage can be unable to open UPR, despite warm cached reads/partial queueing creating an offline
  impression.
- **Evidence:** `public/sw.js` has push/install/activate/click handlers and deliberately no `fetch`
  handler or precache. This avoids the prior cache-poisoning incident but precludes cold offline.
- **Relevant paths/lines / route or workflow / Supabase objects:** `public/sw.js:1-30,33-77`;
  `src/lib/registerSW.js`; PWA launch/all routes; none directly.
- **Root cause:** Safety was restored by removing application caching without defining and
  implementing an explicit supported offline product mode.
- **Recommended remediation / verification / dependencies:** First approve an honest online/warm/cold
  support matrix; if cold offline is required, design an allowlisted versioned shell strategy that
  cannot cache HTML as JS; test fresh install, eviction, partial deploy, reset, and rollback. Depends
  on `MOB-STATE-001`, `MOB-PWA-037`, and threat/privacy review.

## MOB-OFFLINE-011 — Process termination can strand queue rows in `syncing`

- **Category / Severity / Confidence / Effort / Blocks production:** Offline recovery / P1 /
  High / M / **Yes** for queued workflows.
- **Production-readiness impact:** A durable command can leave the only automatically scanned state.
- **User or business impact:** The UI may show permanent in-progress work that never reaches the
  server or automatically retries after app/browser termination.
- **Evidence:** Runner reads only pending rows, writes `syncing` before dispatch, and later startup or
  polling again inspects pending counts only; there is no lease/expiry reconciliation.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/offlineDb.js:84-114`;
  `src/lib/syncRunner.js:77-115,119-142`; all queued room/photo/reading/equipment/note/task objects.
- **Root cause:** Status is durable but claim ownership/lease and crash recovery are process-local.
- **Recommended remediation / verification / dependencies:** Use an atomic lease with owner,
  attempt ID, expiry, and startup reconciliation; surface recover/retry/cancel; inject termination at
  each transition and verify exactly-once-or-explicit-reconciliation. Depends on `MOB-DATA-002` and
  `MOB-DATA-013`.

## MOB-DATA-012 — Photo object upload and metadata creation are non-atomic

- **Category / Severity / Confidence / Effort / Blocks production:** Media data preservation / P1 /
  High / L / **Yes** for reliable field capture.
- **Production-readiness impact:** Storage bytes and `job_documents` metadata can diverge across
  network loss, termination, or ambiguous response.
- **User or business impact:** Photos can be orphaned, missing from the job, or duplicated after
  retry—critical for restoration evidence.
- **Evidence:** Online and queued attempts create a timestamp-based path, upload first, then call
  `insert_job_document`; no stable operation ID, timeout, or compensation binds the pair.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/dispatchers/photoDispatcher.js:30-60`;
  `src/hooks/usePhotoUpload.js:73-119`; `TechJobAlbum.jsx:87-115`;
  `TechClaimAlbum.jsx:111-140`; photo capture/albums; `storage.objects`, `job-files`,
  job_documents, `insert_job_document`.
- **Root cause:** Browser-direct Storage and database metadata are treated as one UI action without a
  server reconciliation protocol.
- **Recommended remediation / verification / dependencies:** Allocate a stable client operation/path,
  make metadata upsert idempotent, add bounded requests and orphan reconciliation/compensation;
  simulate every lost response/termination/retry. Depends on private Storage remediation
  (`MOB-SEC-015`) and queue ownership.

## MOB-DATA-013 — Queue claim and several commands are not cross-process idempotent

- **Category / Severity / Confidence / Effort / Blocks production:** Concurrency and idempotency / P1
  / High / M / **Yes** for offline mutations.
- **Production-readiness impact:** Two tabs/processes can read the same pending row before either
  performs the non-transactional status update; ambiguous retries can repeat non-idempotent commands.
- **User or business impact:** Duplicate notes/equipment operations or double task toggles can create
  incorrect field state.
- **Evidence:** `draining` is process-local; claim is read-then-update; task toggle, note insert, and
  equipment removal do not send the queue client ID. Room/read/place dispatchers do use client IDs,
  so the finding is not generalized to every dispatcher.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/syncRunnerSingleton.js:1-8`;
  `src/lib/syncRunner.js:26-32,69-109`; `dispatchers/taskDispatcher.js:14-25`;
  `noteDispatcher.js:17-39`; `equipmentDispatcher.js:40-57`; queued task/note/equipment workflows.
- **Root cause:** Local serialization is mistaken for a distributed claim, and server contracts do
  not uniformly accept operation identity.
- **Recommended remediation / verification / dependencies:** Implement transactional IndexedDB
  claim/lease plus server idempotency ledger or natural unique keys; make toggles set desired state;
  run two-tab, WebView/relaunch, lost-response, and replay tests. Depends on `MOB-DATA-002` and
  contract changes.

## MOB-SEC-014 — Mobile authorization relies on bypassable UI gates

- **Category / Severity / Confidence / Effort / Blocks production:** Authorization / P0 /
  Confirmed / XL / **Yes—immediate containment required**.
- **Production-readiness impact:** Valid authenticated users can bypass hidden mobile roles at both
  database and service-role worker boundaries.
- **User or business impact:** Unauthorized staff can access or mutate jobs/claims/financial data,
  create/update/delete/email QBO transactions, query QBO, target internal notification recipients,
  or stream a caller-selected lead recording. Production endpoint/type enablement was not probed,
  but the repository authorization paths are directly bypassable.
- **Evidence:** Repository RLS history describes broad internal authenticated policies; `jobs`
  permits all operations to every non-CRM-partner authenticated role. Four QBO workers label Bearer
  use “admin” but only validate `/auth/v1/user` before service-role/provider operations. Notify
  accepts any valid bearer, explicit recipients, and caller content, although unknown/disabled types
  skip. CallRail recording resolves any employee and then service-role reads the selected lead.
- **Relevant paths/lines / route or workflow / Supabase objects:** `supabase/migrations/20260701_crm_partner_rls_non_crm_tables.sql:4-12,26-31`;
  `src/pages/tech/v2/hub/AdminJobMenu.jsx:36-55`;
  `functions/api/qbo-invoice.js:35-45,60-117`; `qbo-estimate.js:19-29,44-103`;
  `qbo-payment.js:16-26,41-114`; `qbo-query.js:15-26,32-64`;
  `notify.js:97-106,152-225,365-374,400-440`;
  `callrail-recording.js:48-70,84-101`; `/tech/job/:jobId`, all `/tech/admin/*`, notification
  emitters; jobs, claims, contacts, employees, invoices, estimates, payments, inbound_leads,
  notifications, external QBO/CallRail.
- **Root cause:** Authentication, navigation visibility, and authorization were conflated; privileged
  workers do not reconstruct employee role/object authority before using service credentials.
- **Recommended remediation / verification / dependencies:** Immediately restrict affected worker
  Bearer paths or disable them, then use shared server auth to resolve active employee and enforce
  explicit role/object/assignment contracts; replace broad RLS for high-impact objects; add negative
  tests for every role/direct request and audit current production reachability/configuration
  read-only. Preserve response/provider contracts and coordinate QBO/notification/lead owners.

## MOB-SEC-015 — `job-files` is a public and anonymously listable media boundary

- **Category / Severity / Confidence / Effort / Blocks production:** Storage confidentiality and
  authorization / P0 / High / L / **Yes—immediate containment required**.
- **Production-readiness impact:** Confidential-by-design field media uses a public bucket with
  anonymous object listing and broad authenticated insert/delete.
- **User or business impact:** Claim/job photos, signed PDFs, and feedback media are designed to use
  this boundary; sensitivity of the 72 current objects is unverified because no path/content was
  opened. Exposure, deletion, or unrelated upload could harm customers, evidence, and operations.
- **Evidence:** Dated live metadata records public=yes, 72 objects/57,472,887 bytes, no MIME
  allowlist, two broad SELECT policies allowing anonymous listing, and bucket-wide authenticated
  insert/delete. Mobile constructs public URLs and uploads to this bucket. No breach was observed.
- **Relevant paths/lines / route or workflow / Supabase objects:** `docs/audit/2026-07/evidence/live-supabase.md:141-152`;
  `src/hooks/usePhotoUpload.js:43-119`; photo albums, appointment/job hub, e-sign/documents,
  feedback; `storage.buckets`, `storage.objects`, `job-files`, job_documents.
- **Root cause:** Public-URL convenience became a shared application contract before private
  delivery/path-scoped policies and migration compatibility were implemented.
- **Recommended remediation / verification / dependencies:** Contain listing/write exposure;
  inventory consumers without reading customer content; introduce private paths/signed delivery and
  least-privilege role/assignment policies with a backward-compatible cutover; validate anonymous,
  unrelated authenticated, assigned, revoked, upload/delete, expiry, and rollback paths. Depends on
  media URL centralization and a reviewed production change window.

## MOB-SEC-016 — Native biometrics do not protect the persisted bearer session

- **Category / Severity / Confidence / Effort / Blocks production:** Native session security / P1 /
  High / L / **Yes** for native release.
- **Production-readiness impact:** Biometrics are an application UI preference over the default
  persisted WebView session, not hardware-backed credential protection; the exception path can open
  the app over that session.
- **User or business impact:** A lost/shared/compromised device or plugin/sign-out exception can
  expose an authenticated field session.
- **Evidence:** Supabase persists/refreshes auth in default WebView storage. The biometric wrapper
  documents a localStorage-based UI gate. Normal cancel/failure attempts sign-out; only the catch
  path—including sign-out/plugin failure—opens the gate.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/realtime.js:16-27`;
  `src/lib/nativeBiometric.js:1-5,23-31`; `src/App.jsx:537-563`; native launch/resume/login; Supabase
  Auth session.
- **Root cause:** A convenience unlock was presented without a defined native credential storage,
  threat, and fail-closed policy.
- **Recommended remediation / verification / dependencies:** Define whether biometrics are mandatory
  or optional; use an approved native token/key storage/session model; fail closed where policy
  requires; handle unavailable/cancel/error/revocation/background safely; penetration/device-test a
  signed build. Depends on owner security/UX policy and native plugin review.

## MOB-PUSH-017 — Native push token is not detached on logout or account change

- **Category / Severity / Confidence / Effort / Blocks production:** Push/session lifecycle / P1 /
  High / M / **Yes** if native push ships.
- **Production-readiness impact:** APNs registration remains associated with the prior employee after
  sign-out.
- **User or business impact:** A logged-out, lost, shared, or reassigned device remains targetable if
  native dispatch occurs. No notification was sent to prove delivery.
- **Evidence:** Login/auth initialization upserts the device token; logout has no native unregister or
  `delete_device_token` call; no application caller of that RPC was found.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/pushNotifications.js:54-58`;
  `src/contexts/AuthContext.jsx:214-226,272-283`; native login/logout/account switch; device-token
  table/RPC.
- **Root cause:** Registration is modeled as login setup, not an account/device lifecycle with
  detach, rotation, revocation, and environment identity.
- **Recommended remediation / verification / dependencies:** Store installation identity and APNs
  environment, attach/detach transactionally, rotate on token events, revoke on logout/disabled
  user, and test two accounts/lost device/reinstall/sandbox-production. Depends on the native push
  architecture in `MOB-NATIVE-023`.

## MOB-PWA-018 — Manifest identity and launcher assets are not production-grade

- **Category / Severity / Confidence / Effort / Blocks production:** PWA installation quality / P2 /
  Confirmed / S / **No**, but required before broad install promotion.
- **Production-readiness impact:** The manifest is a viable install candidate but lacks durable
  identity and verified platform-specific branding assets.
- **User or business impact:** App identity can shift if start URL changes; icons may crop/render
  poorly, especially maskable/iOS launcher contexts.
- **Evidence:** Manifest has core name/start/display/color/orientation fields, but no explicit `id` or
  `scope`; two SVG files each declare `any maskable`; the SVG is also used as Apple touch icon; no
  rendered launcher matrix exists.
- **Relevant paths/lines / route or workflow / Supabase objects:** `public/manifest.json:1-14`;
  `index.html:18-21`; `public/icon-192.svg`, `public/icon-512.svg`; PWA install/launcher; none.
- **Root cause:** Functional manifest scaffolding was not completed as a stable cross-platform
  product identity.
- **Recommended remediation / verification / dependencies:** Approve stable manifest ID/scope and a
  dedicated PNG/maskable/Apple asset suite; verify install, upgrade identity, crop/safe zone, dark
  launcher, and repeat launch on supported iOS/Android. Depends on brand/product approval.

## MOB-OTA-019 — OTA readiness is acknowledged too early and channel compatibility is unproven

- **Category / Severity / Confidence / Effort / Blocks production:** Native OTA/update safety / P1 /
  Confirmed / M / **Yes** before OTA is enabled.
- **Production-readiness impact:** A Capgo bundle can be accepted before the application, auth, and
  primary routes are usable; beta/production/binary compatibility and rollback are not proven.
- **User or business impact:** A bad bundle can strand field devices or drift from native plugins and
  the shared database.
- **Evidence:** `notifyAppReady()` runs at module load before `createRoot` and again on App mount;
  client default channel is production with `resetWhenUpdate:false`; workflow selects channels
  independently and is paused/manual.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/main.jsx:50-77`;
  `src/App.jsx:624-640`; `src/lib/nativeUpdater.js`; `capacitor.config.json`;
  `.github/workflows/capgo-deploy.yml:3-14,37-58`; native launch/update; all versioned contracts.
- **Root cause:** Bundle upload/versioning, client readiness, channel assignment, binary capability,
  and database compatibility are not one release state machine.
- **Recommended remediation / verification / dependencies:** Acknowledge only after a defined
  health checkpoint; bind source/binary/plugin/database/channel IDs; verify beta isolation,
  interrupted update, bad bundle rollback, offline boot, and downgrade on signed devices. Depends on
  release telemetry (`MOB-OBS-024`) and a working native pipeline.

## MOB-NATIVE-020 — Checked-in iOS release automation cannot produce the intended archive

- **Category / Severity / Confidence / Effort / Blocks production:** Native build/release / P1 /
  Confirmed / L / **Yes**.
- **Production-readiness impact:** The manual TestFlight scaffold references incorrect project paths
  and incompatible/missing signing inputs.
- **User or business impact:** Releases are not reproducible; an urgent fix cannot be safely
  archived, signed, uploaded, or rolled back from repository instructions.
- **Evidence:** Workflow runs Fastlane from `ios`; Fastlane references `App.xcodeproj` and a missing
  workspace while the project is `ios/App/App.xcodeproj`; credential/profile interfaces disagree;
  `Gemfile.lock` is absent; Windows `build:ios` syntax is POSIX.
- **Relevant paths/lines / route or workflow / Supabase objects:** `.github/workflows/ios-release.yml:3-15,31-92`;
  `ios/fastlane/Fastfile`; `ios/Gemfile`; `package.json:8`; native release/TestFlight; none directly.
- **Root cause:** Release files were added as independently paused scaffolds without an end-to-end
  clean-checkout archive test.
- **Recommended remediation / verification / dependencies:** Align one working directory/project,
  lock Ruby/Node dependencies, define one signing/API-key interface, fail closed on missing inputs,
  archive/export/inspect/upload from a clean macOS runner, and document owner gates/rollback.
  Depends on Apple enrollment/secrets and `MOB-NATIVE-021`.

## MOB-NATIVE-021 — App privacy manifest is absent from the checked-in target

- **Category / Severity / Confidence / Effort / Blocks production:** iOS privacy/store readiness /
  P1 / Confirmed / S / **Yes**.
- **Production-readiness impact:** The repository contains an app-level privacy manifest file but the
  Xcode target does not reference or copy it.
- **User or business impact:** The built app can omit required declarations; archive contents and App
  Store acceptance were not verified, so rejection is not asserted.
- **Evidence:** `PrivacyInfo.xcprivacy` exists, but is absent from PBX file references, App group, and
  Resources phase.
- **Relevant paths/lines / route or workflow / Supabase objects:** `ios/App/App/PrivacyInfo.xcprivacy`;
  `ios/App/App.xcodeproj/project.pbxproj:20-31,63-78,139-152`; native archive/store submission; none.
- **Root cause:** File creation was not completed with Xcode target membership and archive
  verification.
- **Recommended remediation / verification / dependencies:** Add reviewed target membership without
  hand-editing generated projects in this audit; archive and inspect the `.app`; reconcile required
  reason APIs/plugin manifests and privacy disclosures. Depends on macOS/Xcode and a working release
  pipeline.

## MOB-NATIVE-022 — Deep-link, universal-link, and notification-tap routing is absent

- **Category / Severity / Confidence / Effort / Blocks production:** Native navigation / P2 /
  Confirmed / L / **No by default; yes if recovery, signing, or push links are promised**.
- **Production-readiness impact:** Native routes exist for recovery/signing, but installed iOS cannot
  reliably translate custom/universal links or notification actions into safe app navigation.
- **User or business impact:** Links may open the browser or fail; warm/cold authentication and back
  context are unproven.
- **Evidence:** AppDelegate forwards callbacks, but no URL scheme, Associated Domains/AASA evidence,
  direct `@capacitor/app` dependency/listener, `getLaunchUrl`, or push-action route handler exists.
- **Relevant paths/lines / route or workflow / Supabase objects:** `ios/App/App/AppDelegate.swift`;
  `ios/App/App/Info.plist`; `ios/App/App/App.entitlements`; `package.json`; `src/App.jsx:309-324`;
  password recovery, `/sign/:token`, notification taps; sign_requests/auth sessions.
- **Root cause:** Native callback scaffolding was not connected to a canonical allowlisted route
  resolver and auth-resume state machine.
- **Recommended remediation / verification / dependencies:** Define schemes/domains/AASA, add the
  App plugin, parse an allowlist of internal routes, defer until auth readiness, and test cold/warm,
  logged-out/in, expired token, malicious URL, back behavior, and push tap. Depends on product URL
  ownership and Apple entitlements.

## MOB-NATIVE-023 — Native push is registration scaffolding, not a production channel

- **Category / Severity / Confidence / Effort / Blocks production:** Native notifications / P1 /
  High / XL / **Yes if native notifications are a release capability**.
- **Production-readiness impact:** Token registration is not connected to a safe, normal
  provider-to-client lifecycle.
- **User or business impact:** Important notifications can be absent, discarded, routed incorrectly,
  or target stale devices; sandbox/production mismatch can prune valid tokens.
- **Evidence:** Central dispatch targets Web Push rather than native tokens. A manual APNs worker has
  no normal caller, defaults sandbox, deletes `BadDeviceToken`, lacks timeout/retry, and sets immediate
  expiration. The app lacks foreground/action listeners and tap routing.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/pushNotifications.js`;
  `functions/api/send-push.js`; `functions/api/notify.js`; `public/sw.js`; native registration,
  foreground/background/tap/logout; device tokens, notification preferences.
- **Root cause:** Registration, dispatch, APNs environment, account lifecycle, payload privacy, and
  navigation were implemented as separate experiments.
- **Recommended remediation / verification / dependencies:** Choose one governed dispatch
  architecture; bind environment/installation/account; add timeouts/retry/expiry policy and safe
  invalid-token handling; implement foreground/action/tap listeners; test real sandbox/TestFlight
  delivery, logout, reinstall, lost device, and redacted payloads. Depends on `MOB-PUSH-017`,
  `MOB-NATIVE-022`, and notification authorization under `MOB-SEC-014`.

## MOB-OBS-024 — Primary-pane failures lack local containment and release-correlated telemetry

- **Category / Severity / Confidence / Effort / Blocks production:** Observability and recovery / P1
  / High / L / **Yes** for expanded field reliance.
- **Production-readiness impact:** A persistent primary-pane render failure can escape route-local
  recovery, and production client failures cannot be reliably correlated to a release/stack.
- **User or business impact:** Users can encounter a blank/broken shell while support lacks the
  context to identify affected version, route, account-safe breadcrumbs, or native crash.
- **Evidence:** Persistent panes are children of `TechLayout` under Suspense, not individual
  ErrorBoundaries; no top-level boundary wraps providers/router; current boundary reports console
  errors; production source maps are disabled; no client crash reporter was found. Workers have
  separate telemetry and are not described as console-only.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/App.jsx:266-270,641-660`;
  `src/components/TechLayout.jsx:299-324`; `src/components/ErrorBoundary.jsx:24-27`;
  `vite.config.js:12-15`; Dashboard/Schedule/Messages and native runtime; none directly.
- **Root cause:** Local UI recovery and centralized privacy-safe release diagnostics were not treated
  as one production requirement.
- **Recommended remediation / verification / dependencies:** Put an appropriate boundary around
  primary panes/root, add release/source-map-correlated client/native reporting with redaction and
  support diagnostics, and inject render/async/chunk/native failures in staging. Depends on privacy,
  monitoring vendor/retention, and release identity.

## MOB-TEST-025 — Required installed-device and signed-native release evidence is absent

- **Category / Severity / Confidence / Effort / Blocks production:** Testing and release validation /
  P1 / Confirmed / XL / **Yes**.
- **Production-readiness impact:** Passing local builds/tests cannot establish authenticated PWA or
  Capacitor production behavior.
- **User or business impact:** Device-specific install, safe-area, keyboard, camera, permissions,
  offline, background, update, push, deep-link, accessibility, signing, and privacy failures can
  reach field users undiscovered.
- **Evidence:** 1,871 automated tests and 12 fixture browser tests passed, but the fixture is not UPR.
  No authenticated field-screen run, real iOS/Android installed PWA, Xcode archive, TestFlight,
  physical device, VoiceOver/TalkBack, push, deep-link, or OTA rollback proof was completed.
- **Relevant paths/lines / route or workflow / Supabase objects:** `tests/`, `scripts/qa/`,
  `.github/workflows/ios-release.yml`, all mobile routes/capabilities; complete contract surface.
- **Root cause:** Repository validation is broad but release proof stops before credentials, installed
  lifecycle, shared-database contracts, signing, and devices.
- **Recommended remediation / verification / dependencies:** Build a sanitized synthetic staging
  matrix at 320/360/375/390/412/430/768 plus supported devices; add automated auth/authorization,
  offline/update/account-switch tests; archive and install via TestFlight; record exact
  SHA/database/channel/device evidence. Depends on containment of P0/P1 defects and safe QA
  identities/data.

## MOB-PERF-026 — Mobile CSS exceeds the binding budget and CI does not enforce it

- **Category / Severity / Confidence / Effort / Blocks production:** Performance budget / P2 /
  Confirmed / M / **No**.
- **Production-readiness impact:** The mobile/native entry imports a global stylesheet whose built
  output exceeds the repository's 400 KB raw budget.
- **User or business impact:** Larger parse/style cost and global regression surface; no audit
  measurement proved a specific slow interaction.
- **Evidence:** Source CSS is 583,875 bytes/12,575 lines; audited built CSS is 422,452 bytes.
  Web entry JS is 235,569 bytes gzip versus the ~232 KB guide, but below the 255 KB fail intent.
  CI's aggregate size signal is non-blocking.
- **Relevant paths/lines / route or workflow / Supabase objects:** `.claude/rules/perf-budget.md:8-16`;
  `src/main.jsx:40-42`; `src/index.css`; `.github/workflows/ci.yml:107-113`; every web/native route;
  none.
- **Root cause:** Shared office/legacy/v2/admin styles accumulate in one entry, while budgets are
  documented and reported but not enforced.
- **Recommended remediation / verification / dependencies:** Establish current artifact baselines,
  deduplicate/split by route without visual drift, ratchet CSS and entry/route JS budgets in blocking
  CI, and measure parse/style/LCP/INP on target devices. Depends on UI ownership and visual regression
  evidence.

## MOB-DEP-027 — Production dependency audit reports unresolved high-severity advisories

- **Category / Severity / Confidence / Effort / Blocks production:** Dependency security and
  maintainability / P2 / High / M / **No pending reachability; becomes blocking if reachable**.
- **Production-readiness impact:** The production dependency graph includes 14 reported advisories,
  including one critical and eight high.
- **User or business impact:** A reachable parser/router/archive/socket vulnerability could affect
  client, worker, or release integrity; no exploitability was established.
- **Evidence:** `npm audit --omit=dev` reported 1 critical, 8 high, 5 moderate across
  `@xmldom/xmldom`, `brace-expansion`, `react-router`, `tar`, and `ws` paths.
- **Relevant paths/lines / route or workflow / Supabase objects:** `package.json`, `package-lock.json`;
  mobile web/native/worker build depending on each path; none directly.
- **Root cause:** Dependency advisories are not a blocking/reachability-triaged release gate.
- **Recommended remediation / verification / dependencies:** Produce an advisory-to-runtime
  reachability table, test compatible patched versions in an isolated remediation branch, document
  accepted residuals/expiry, and add a severity+allowlist CI policy. Depends on product compatibility;
  no upgrade was authorized in this audit.

## MOB-A11Y-028 — Core task and navigation controls lack reliable semantics/focus

- **Category / Severity / Confidence / Effort / Blocks production:** Accessibility / P2 / Confirmed /
  M / **No individually; required before broad adoption**.
- **Production-readiness impact:** Critical task rows and primary navigation do not consistently
  expose keyboard/screen-reader interaction and visible focus.
- **User or business impact:** Keyboard, switch-control, and assistive-technology users can be unable
  to complete tasks or identify the focused tab; custom sheets may lose focus context.
- **Evidence:** Appointment/edit task rows are clickable non-semantic `<div>` elements; primary tech
  nav removes outline without a replacement; custom overlays do not share one trap/return contract.
  A credential-free axe fixture passed but is not the UPR route tree.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/pages/tech/TechAppointment.jsx:920`;
  `src/pages/tech/TechEditAppointment.jsx:521`; `src/index.css:4960-4962`;
  appointment task completion, bottom nav, custom sheets; appointment tasks.
- **Root cause:** Visual/touch behavior was implemented locally without enforcing semantic mobile
  primitives and focus lifecycle.
- **Recommended remediation / verification / dependencies:** Use buttons/checkbox semantics,
  restore tokenized `:focus-visible`, consolidate dialog/sheet focus/back behavior, add authenticated
  axe/keyboard tests and VoiceOver/TalkBack task/nav flows at zoom/Dynamic Type. Depends on component
  consolidation.

## MOB-MOTION-029 — Motion and gesture behavior is systemic but not consistently governed

- **Category / Severity / Confidence / Effort / Blocks production:** Motion and interaction / P2 /
  High / L / **No**.
- **Production-readiness impact:** Shared motion tokens exist, but many mobile overlays/toasts/press
  states/gestures use raw durations, abrupt unmount, layout animation, or incomplete reduced-motion
  handling.
- **User or business impact:** Inconsistent causal feedback, visual jank, abrupt exits, and excess
  motion for sensitive users; no audit evidence established a general outage or severe jank.
- **Evidence:** Tech scope contains 27 raw duration declarations; route transition and multiple core
  sheets use parallel patterns; PullToRefresh/task gestures perform per-touch state work without one
  pointer/velocity contract; reduced-motion coverage is partial. Shared tokens, Modal, View
  Transitions, native scrolling, and haptics are meaningful strengths.
- **Relevant paths/lines / route or workflow / Supabase objects:** `.claude/rules/motion-standard.md`;
  `src/components/TechLayout.jsx:326-334`; `src/components/PullToRefresh.jsx`;
  `src/pages/tech/TechTasks.jsx`; `src/index.css`; route changes, sheets, toast, pull/gesture feedback;
  none.
- **Root cause:** Multiple generations of local interaction code coexist while the documented motion
  standard is not fully embodied in shared primitives/tests.
- **Recommended remediation / verification / dependencies:** Inventory and migrate to one duration/
  easing/entry-exit/reduced-motion contract; prefer transform/opacity; make gestures pointer-safe and
  non-conflicting; run reduced-motion, 60fps/profile, background/resume, and owner-device feel checks.
  Depends on design-system consolidation.

## MOB-UX-031 — Legacy, v2, and admin-mobile visual systems remain fragmented

- **Category / Severity / Confidence / Effort / Blocks production:** Design system and maintainability
  / P2 / High / L / **No**.
- **Production-readiness impact:** Mobile screens mix tokens/shared primitives with large inline-style
  surfaces, one-off colors/radii/headers/sheets/toasts and duplicated interaction patterns.
- **User or business impact:** The product feels inconsistent, fixes do not propagate, and
  accessibility/performance regressions are easier to introduce.
- **Evidence:** Static census counted approximately 1,388 inline style objects across 127 tech files;
  legacy and v2 job routes coexist; global CSS and screen-local style systems duplicate sheets,
  loaders, errors, and actions.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/index.css`;
  `src/pages/tech/`; `src/components/tech/`; `src/components/admin-mobile/`;
  `src/pages/tech/TechJobDetail.jsx`; `src/pages/tech/v2/TechJobHub.jsx`; all mobile routes; none.
- **Root cause:** Feature waves optimized local delivery while canonical primitives and migration
  ownership remained incomplete.
- **Recommended remediation / verification / dependencies:** Freeze new one-offs, define current
  versus proposed mobile primitives, consolidate highest-reuse headers/sheets/buttons/states first,
  and render/regress at required widths/light/dark/reduced-motion. Depends on design ownership and
  must not become an opportunistic rewrite.

## MOB-NAV-032 — Native back/edge-gesture contract is not implemented or device-proven

- **Category / Severity / Confidence / Effort / Blocks production:** Navigation and gestures / P2 /
  Medium / M / **No for iOS-only launch; conditional for Android/native gesture claims**.
- **Production-readiness impact:** Visible browser history/back paths exist, but native system back,
  iOS edge-swipe interactions, open sheets, keyboard state, and unsaved forms have no unified
  lifecycle contract.
- **User or business impact:** Users may dismiss, leave, or become trapped unpredictably; actual
  behavior was not exercised on a device.
- **Evidence:** Source comments/design describe directional back behavior, but no Capacitor App
  back-button/URL listener, WKWebView gesture configuration, or end-to-end gesture matrix was found.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/lib/useNavDirection.js`;
  `src/App.jsx:601-647`; `src/components/TechLayout.jsx`; custom sheet/form routes;
  `ios/App/App/AppDelegate.swift`; all nested navigation; none directly.
- **Root cause:** Web history, overlay dismissal, native lifecycle, and gesture policy are separate
  local concerns.
- **Recommended remediation / verification / dependencies:** Define route-versus-overlay priority,
  unsaved-change behavior, keyboard/back policy, Android system back if supported, and iOS gesture
  expectation; implement through shared router/sheet primitives and test cold/warm/deep-link flows.
  Depends on `MOB-NATIVE-022` and product platform scope.

## MOB-DATA-033 — Several mobile result sets grow without cursor/retention bounds

- **Category / Severity / Confidence / Effort / Blocks production:** Data scalability / P2 / High /
  M / **No pending measured scale impact**.
- **Production-readiness impact:** Claims/tasks/documents load complete or broad result sets and
  filter client-side; schedule retains each loaded month.
- **User or business impact:** Payload, memory, and render cost can rise as production history grows.
  Current slowness was not measured.
- **Evidence:** Claims and assigned tasks load whole RPC results before local filters; document
  queries use `select=*` without a limit; schedule requests bounded ranges but accumulates loaded
  months. Messages already has limits/cursors, so the finding is scoped.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/pages/tech/TechClaims.jsx:76-113`;
  `TechTasks.jsx:171-205`; `v2/hub/hubHelpers.js:108-124`;
  `v2/schedule/useScheduleData.js:47-79`; claims/tasks/job photos/schedule; claims, tasks,
  job_documents, appointments.
- **Root cause:** Initial field volumes and client convenience shaped contracts without explicit
  page/cursor/cache-retention guarantees.
- **Recommended remediation / verification / dependencies:** Capture representative cardinality and
  query plans read-only; add stable cursor/order/limit contracts and bounded month/cache retention;
  test empty/last-page/concurrent insert/offline resume and payload/latency budgets. Depends on
  backward-compatible RPC changes.

## MOB-REL-034 — Appointment/event workflows can partially commit and retry ambiguously

- **Category / Severity / Confidence / Effort / Blocks production:** Mutation reliability / P1 /
  High / L / **Yes** for primary field scheduling edits.
- **Production-readiness impact:** Related writes are committed independently without transaction,
  compensation, operation ID, or a partial-success response.
- **User or business impact:** An appointment can exist without all crew/tasks; editing can delete
  crew and fail before rebuild; retry can duplicate work or leave state ambiguous/incomplete.
- **Evidence:** New appointment writes appointment, crew loop, then task assignment; edit updates
  core fields, deletes all crew, reinserts, then assigns tasks; event creation also separates record
  and crew. Catch blocks show one failure without server reconciliation.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/pages/tech/TechNewAppointment.jsx:212-259`;
  `TechEditAppointment.jsx:223-270`; `TechNewEvent.jsx:88-120`; create/edit appointment/event;
  appointments, appointment_crew, job tasks, update/assign RPCs.
- **Root cause:** One user intent is implemented as multiple browser REST/RPC calls.
- **Recommended remediation / verification / dependencies:** Move each composite intent to a
  transactional idempotent server contract with expected version and stable operation ID, or define
  compensation/reconciliation; inject failure after every step and replay ambiguous responses.
  Depends on preserving existing response shapes and authorization hardening.

## MOB-OPS-035 — Mobile release controls do not enforce the full readiness contract

- **Category / Severity / Confidence / Effort / Blocks production:** Release operations / P1 / High /
  L / **Yes**.
- **Production-readiness impact:** CI blocks build/tests/browser/provenance, but lint/performance are
  explicitly non-blocking; builds accept missing runtime environment values; dependency/native/
  security-device gates are absent; OTA/iOS workflows are standalone.
- **User or business impact:** A syntactically successful release can ship missing configuration,
  known quality debt, incompatible installed state, or an unverified native bundle.
- **Evidence:** CI comments/steps use `continue-on-error` for lint/bundle; build step allows missing
  Supabase variables; no native compile/device/dependency audit job; Capgo/iOS manual workflows show
  no dependency on CI. Branch protection and Cloudflare required checks are external unknowns, so
  this finding does not claim production currently bypasses CI.
- **Relevant paths/lines / route or workflow / Supabase objects:** `.github/workflows/ci.yml:8-16,68-78,88-113`;
  `capgo-deploy.yml:3-14,37-58`; `ios-release.yml:3-15,31-42`; all release paths; shared Supabase
  migration/contract state.
- **Root cause:** Validation, deployment, database compatibility, PWA reset, OTA, and App Store
  release evolved as separate lanes without one blocking manifest.
- **Recommended remediation / verification / dependencies:** Define a release manifest and required
  checks; validate env schema; ratchet lint/budgets; require security/provenance/dependency/browser
  gates; make deployment/OTA/native depend on reviewed artifacts; inspect external required-checks;
  rehearse rollback. Depends on owner release policy and P0/P1 closure.

## MOB-NATIVE-036 — Native account-deletion applicability and route are unresolved

- **Category / Severity / Confidence / Effort / Blocks production:** App Store/product lifecycle / P1
  / Medium / M / **Conditional yes pending owner/legal/App Review determination**.
- **Production-readiness impact:** The office application has account deletion, but the native route
  tree does not expose it; applicability depends on whether employee accounts are created/provisioned
  in a way covered by current store policy.
- **User or business impact:** Users may lack a discoverable deletion/request mechanism, and App
  Review can reject the submission if the rule applies. Rejection/noncompliance was not asserted.
- **Evidence:** Native routes include login/settings but not office account-deletion settings; no
  documented native employee-account lifecycle decision was found.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/App.jsx:309-324`;
  `src/pages/tech/TechSettings.jsx`; office settings/account deletion implementation; native
  Settings/account lifecycle; auth.users, employees, related deletion workflow.
- **Root cause:** The native product/account model and store-policy interpretation have not been made
  an explicit release decision.
- **Recommended remediation / verification / dependencies:** Owner/legal determines applicability
  and supported deletion/request behavior; provide a discoverable native route if required; verify
  identity, retention/legal holds, downstream data, confirmation, recovery, and App Review notes.
  Depends on business/legal policy and existing deletion backend.

## MOB-PWA-037 — Persisted-query compatibility uses a manually fixed release buster

- **Category / Severity / Confidence / Effort / Blocks production:** PWA update compatibility / P2 /
  High / S / **No alone; required before schema/cache-shape changes**.
- **Production-readiness impact:** A new web/native/OTA bundle can restore an incompatible prior
  query shape unless a maintainer remembers to edit a source literal.
- **User or business impact:** Installed clients can show stale/malformed UI or fail after a release;
  no failure was observed in this audit.
- **Evidence:** `BUILD_ID = "2026-07-03-web-push-f1"` is passed as the persisted-cache buster, while
  Capgo separately derives a SHA-qualified bundle version.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/main.jsx:44-48,73-85`;
  `src/lib/techQueryPersister.js:35-49,83-87`; `.github/workflows/capgo-deploy.yml:44-58`; PWA/native
  update and warm restore; cached RPC/table shapes.
- **Root cause:** Release identity and cache/database compatibility are manual, separate concepts.
- **Recommended remediation / verification / dependencies:** Generate a compatibility ID from the
  release manifest (not necessarily every deploy), define migration rules for safe cache reuse, and
  test old-cache/new-bundle, rollback, Capgo channel, and account switch. Depends on release
  manifest/telemetry and `MOB-STATE-001`.

## MOB-MOTION-038 — Schedule create sheet reuses a transform-incompatible keyframe

- **Category / Severity / Confidence / Effort / Blocks production:** Motion defect / P2 / Confirmed /
  XS / **No**.
- **Production-readiness impact:** The sheet animates with a keyframe designed for a horizontally
  centered pill, then snaps to a different final transform.
- **User or business impact:** Users see a lateral shift/snap on a primary create interaction; reduced
  motion and exit handling are absent for this pattern.
- **Evidence:** `.tv2-sheet` applies `tv2-pill-in`; that keyframe animates
  `translate(-50%, …)`, while the sheet's static layout has no matching horizontal transform.
- **Relevant paths/lines / route or workflow / Supabase objects:** `src/index.css:5681-5683,5697-5705`;
  `src/pages/tech/v2/schedule/CreatePicker.jsx:31-40`; Schedule create job/event sheet; none.
- **Root cause:** A visually similar entrance animation was reused without preserving the component's
  transform baseline.
- **Recommended remediation / verification / dependencies:** Give sheets a dedicated
  translateY/opacity entry and exit with reduced-motion fallback; render at all required widths and
  profile for layout shift. Depends on the canonical motion/sheet primitive.

## Severity summary

| Severity | Count | IDs |
|---|---:|---|
| P0 | 2 | MOB-SEC-014, MOB-SEC-015 |
| P1 | 21 | MOB-STATE-001, MOB-DATA-002, MOB-COMP-003, MOB-ROLLOUT-004, MOB-ROLLOUT-005, MOB-PRIV-009, MOB-OFFLINE-010, MOB-OFFLINE-011, MOB-DATA-012, MOB-DATA-013, MOB-SEC-016, MOB-PUSH-017, MOB-OTA-019, MOB-NATIVE-020, MOB-NATIVE-021, MOB-NATIVE-023, MOB-OBS-024, MOB-TEST-025, MOB-REL-034, MOB-OPS-035, MOB-NATIVE-036 |
| P2 | 14 | MOB-ARCH-006, MOB-PERF-007, MOB-UX-008, MOB-PWA-018, MOB-NATIVE-022, MOB-PERF-026, MOB-DEP-027, MOB-A11Y-028, MOB-MOTION-029, MOB-UX-031, MOB-NAV-032, MOB-DATA-033, MOB-PWA-037, MOB-MOTION-038 |
| P3 | 0 | — |
| P4 | 0 | — |

P1 findings marked conditional must either be closed or explicitly excluded from the supported
release promise with owner-approved constraints and tests. The absence of P3/P4 entries is not an
omission of known defects: minor observations such as duplicated `_headers` ownership are documented
in the supporting reports but were not promoted into separate remediation units after
normalization.
