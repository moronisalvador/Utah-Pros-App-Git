<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-s1c-callrail-notify-2026-07-26.md

WHAT THIS DOES (plain language):
  Records the source, caller, identity, object, test, review, rollout and rollback evidence for
  Mobile Production Readiness S1c: the CallRail recording proxy and HTTP notify identity surface.

DEPENDS ON:
  Internal: functions/api/callrail-recording.js, functions/api/notify.js and their tests,
            functions/lib/auth.js, functions/lib/http.js, functions/lib/callrail-api.js,
            functions/lib/webPush.js, the React callers, notification migrations,
            docs/mobile-production-readiness-roadmap.md, and the R0/S1b evidence
  Data:     reads → repository source, Git metadata, generated live snapshots, and dated evidence
            writes → documentation only

NOTES / GOTCHAS:
  - This is source/local-test evidence, not deployment, production-identity, provider, customer,
    database-apply or live-configuration proof.
  - Binding and configuration names were inventoried; no secret value was read.
  - No recording, customer row/object, provider payload or notification content was inspected.
  - No provider, notification, migration, deployment, secret, setting or external side effect was
    invoked.
-->

# Mobile readiness S1c — CallRail recording and notify HTTP — 2026-07-26

## Result

S1c produced a narrow, locally verified continuation of the complete R0→S1b history:

- `GET /api/callrail-recording` now requires an active internal admin or the company-wide
  `crm_call_log` employee/role capability before lead, credential, account-discovery or provider
  work.
- The requested UUID must identify an `inbound_leads` call row whose stored `callrail_id` matches
  the provider call ID embedded in its stored allowlisted CallRail recording URL.
- Direct audio, app→API account rewrite, JSON→signed-audio, private-cache and deployed JSON error
  contracts remain compatible. Both recording fetch stages use the shared 15-second timeout.
- HTTP `POST /api/notify` checks a supplied stored secret first and never falls through to Bearer
  on wrong or empty values. Its full server payload and response-summary contract remain intact.
- A human Bearer must resolve to an active internal admin and may request only
  `appointment.assigned`, `appointment.updated`, `appointment.canceled`, or `estimate.accepted`.
  Exact object state/membership is verified and only object IDs enter the dispatcher; client
  audience, copy, HTML, payload/data, entity/job fields and links are rejected.
- Trusted Workers still call `dispatchEvent` in-process. Audience, enrichment, preferences,
  sequential fan-out, per-channel best effort, disabled-type skips and response summaries were not
  redesigned.

The focused test matrix is 83/83. Every denied identity, authorization/configuration failure and
object-scope failure asserts that credentials, account discovery, recording providers, signed
audio or notification dispatch are never reached.

This is explicitly **partial containment**, not closure of `MOB-SEC-014`. The authenticated
`notify_emit` definer, direct `get_inbound_leads`/`inbound_leads` access, authenticated
`create_notification`, broader RPC/direct policies and shared Auth/Web Push timeout gaps remain.
It does not affect `MOB-SEC-015`.

## Provenance, instructions and isolation

| Item | Evidence |
|---|---|
| Required base branch | `codex/mobile-readiness-s1b-qbo-identity` |
| Required exact base | `f49435e8945c11ede9745cedb61940943953cd01` |
| Fetched `origin/dev` | `90b265ee6f733c8dbcd75786f4e4057dd3355d38` |
| Reconciliation | fetched `origin/dev` is an ancestor of the exact S1b base; no merge/rebase was needed |
| S1c branch | `codex/mobile-readiness-s1c-callrail-notify` |
| Isolated worktree | `/private/tmp/upr-mobile-readiness-s1c-callrail-notify` |
| Original checkout | unrelated `.claude/settings.local.json` modification remained untouched |
| CallRail source/test result | `7d315d2` |
| Notify source/test result | `9e77c5b` |
| Final fan-out/allowlist contract tests | `841569a` |
| Canonical authorization/integration docs | `0287be7` |
| Mobile testing/data/roadmap docs | `a068e68` |
| Master context and registry | `6a18416` |
| Captured at | `2026-07-26 16:19:23 UTC` |

The full history is linear: foundation → R0 (`66182f3..3d25519`) → S1b
(`e124ded..f49435e`) → S1c. No R0 or S1b commit was rewritten or dropped. No push occurred.

Before editing, the primary reread `AGENTS.md`, `CLAUDE.md`, the complete
`$mobile-readiness-wave` skill, applicable worker/database/documentation/close-out and mobile
ownership rules, the canonical architecture/schema/auth/business/integration/testing documents,
the mobile roadmap/data/release contracts, the current unfinished-work registry, the R0 recapture,
the S1b evidence, and the latest dated `live-supabase.md`. External state remained read-only; the
decision did not depend on inspecting live rows, objects, payloads, credentials or secret values.

| Owner | Mode | Owned scope | Deliverable |
|---|---|---|---|
| Primary | sole writer | two Worker source/tests, canonical docs, registry and evidence | integrated S1c slice, verification, commits and handoff |
| Caller mapper | read-only | mobile/desktop/secret/in-process/scheduler callers | complete caller/capability inventory |
| Contract reviewer | read-only | deployed request/response, proxy, timeout and fan-out behavior | compatibility findings and independent tests |
| Security reviewer | read-only | identity, object, secret and alternate-path bypass analysis | prioritized containment verdict/residuals |
| Release auditor | read-only, after integration | history, evidence, verification, rollout/rollback/gates | final release-readiness verdict |

## Read-only caller and capability inventory

### CallRail recording

| Caller | Surface and preserved contract |
|---|---|
| Mobile/admin PWA | `LeadRow.jsx` under `/tech/admin/leads`; native currently mounts the admin-mobile route. It sends the Supabase Bearer, requires `res.ok` plus `Content-Type: audio/*`, consumes a blob and parses JSON errors. The route is independently admin-gated. |
| Desktop internal | `CrmCallLog.jsx` under `/crm/call-log`; sends the same Bearer/blob request and uses the same audio/error contract. Non-admin access is represented by employee/role `crm_call_log`. |
| Desktop external | `CrmLayout.jsx` deliberately exposes Call Log to `crm_partner`; S1c denies that external identity. This security contraction needs a UI hide/disable or an explicit owner policy before a compatibility claim. |
| Secrets/providers | Service-role reads the exact lead and only then the stored CallRail credential. Approved app-form URLs may resolve/persist the account ID and rewrite to the API form. No credential value or provider response was read during S1c. |

The deployed success is HTTP 200 with a body, provider-derived `Content-Type` and
`Cache-Control: private, max-age=300`. Browser Range, Bearer and CallRail authorization are not
forwarded to the signed-audio URL. Existing 400/401/403/404/500/502 JSON families remain
client-readable; added 403 and sanitized authorization/lookup failures are the intentional
security transition.

### HTTP notify and in-process fan-out

No checked-in mobile, desktop or browser Bearer caller for `/api/notify` was found.

| Origin | Identity/capability and preserved behavior |
|---|---|
| Database HTTP | `notify_emit(text,jsonb)` reads `notify_worker_url` plus the stored secret and uses `net.http_post`. Appointment assignment/update/cancel, estimate acceptance, timesheet request/review and abandoned-clock scan/cron originate here. Exact secret-first payload compatibility is retained. |
| In-process Workers | CallRail lead, form/Webflow lead, feedback submitted/resolved, inbound Meld, operations health, message notification outbox, e-sign, Twilio inbound and QBO/Stripe/charge payment paths import the dispatcher directly or through their shared helper. No HTTP identity was added to them. |
| Schedulers | Abandoned-clock uses the database emit path. Operations health and message-outbox recovery use their existing secret-gated Worker/scheduler entry and in-process dispatch. Scheduler contracts were inventoried read-only and not modified. |
| Human legacy HTTP | No checked-in caller; retained only as active-internal-admin with four exact object-derived event shapes. |

Configuration names only: Supabase URL/anonymous/service-role bindings, `notify_worker_url`,
`notify_webhook_secret`, CallRail account configuration and CallRail/Web Push credential rows.
Presence, equality, values, deployment hashes and current runtime behavior were not inspected.

## Trusted-boundary and object contract

| Surface | New first boundary | Object/failure order | Preserved compatibility |
|---|---|---|---|
| Recording, admin mobile | valid session → active internal employee → admin | UUID → call row → allowlisted stored URL → stored/provider call-ID equality → credential → account/provider | 200 audio/blob/private cache, app→API rewrite, JSON→signed stream, deployed JSON errors |
| Recording, desktop capability | valid session → active internal employee → employee override, else role `crm_call_log` | same object order; explicit employee denial wins over non-admin role permission | company-wide because no employee→CRM-org assignment model exists |
| Notify, secret | header presence → exact stored equality | JSON/type parsed only after capability; full server payload retained | trigger/scheduler request and 200 summary unchanged; wrong/empty secret never falls through |
| Notify, human | valid session → active internal admin | allowlisted type → UUID/state or assignment membership → IDs-only dispatch body | 401/403/400/404/500 distinctions and 200 dispatcher summary |
| Notify, in-process | unchanged trusted import | existing origin-specific object/event derivation | existing catalog, enrichment, audience, preference and fan-out contracts |

## Source and test slice

`functions/api/callrail-recording.js` now uses shared active-employee authentication, excludes
external identities, applies the admin-or-`crm_call_log` capability, validates the exact call
object before secrets, sanitizes internal lookup failures and times the signed-audio fetch.
`functions/api/callrail-recording.test.js` locks identity/configuration/role/capability/object
ordering, credential/account/provider failure isolation, direct/app/signed success and deployed
error shapes.

`functions/api/notify.js` keeps secret and in-process service paths while constraining the unused
human HTTP path to an internal admin plus four object-derived events. Header presence prevents an
empty secret from becoming a Bearer fallback. `functions/api/notify.test.js` locks missing,
invalid, inactive, external and denied identities; auth/employee/object failures; exact
secret precedence; forged fields; approved object scope; and zero dispatcher/provider work after
denial.

No migration, schema, client UI, shared fan-out implementation, Web Push implementation, provider
adapter, secret, runtime setting or external system was changed.

## Verification

All commands ran in the isolated S1c worktree. No browser, server, simulator or persistent child
process was started.

| Command | Observed result |
|---|---|
| `npm ci` | passed; 418 locked packages installed; lockfile unchanged |
| focused CallRail/notify Vitest | 83/83 passed |
| `npm test` | passed after final contract cases; unit 774/774, Worker 1,358/1,358, QA 16/16; 2,148 total, zero unexpected skips |
| `npm run build` | passed; Vite production build, 665 modules transformed |
| native-target `vite build` | passed with `VITE_BUILD_TARGET=native`; 665 modules transformed; no Capacitor sync/signing |
| changed-file ESLint | passed with zero findings for all four changed JavaScript files |
| `npm run lint` | reports the unchanged full-tree baseline: 206 errors and 119 warnings; no changed JavaScript finding |
| `npm run validate:tooling` | passed; zero errors, two dated CAP-GOV/CAP-SEC waiver warnings; generated adapters match |
| `npm run test:tooling` | 12/12 passed |
| `npm run preflight:mobile` | zero errors; pre-evidence warnings for expected documentation changes, local Node 26 vs CI Node 22 and optional GitHub delivery unavailable |
| `git diff --check` | passed |

The install reported the existing dependency-audit summary of 10 vulnerabilities (1 low, 8 high,
1 critical). No dependency or lockfile change was part of S1c; dependency triage remains separate.

## Independent review

Three independent read-only passes were assigned:

- Contract: the bounded HTTP slice preserves internal recording audio/error/rewrite behavior and
  secret/in-process notify fan-out. It found the empty-secret fallthrough edge, which was fixed and
  regression-tested. It identified the external-partner UI mismatch, Web Push/Auth timeout gap and
  additional compatibility tests; all are tested or recorded.
- Security: `review-ready` for the bounded source slice after the empty-secret fix. It independently
  observed 79/79 focused and 115/115 adjacent CallRail/Web Push tests. It classified
  `notify_emit`, direct recording-source access, `create_notification`, feature-flag mismatch,
  signed-URL/raw-provider diagnostics and shared timeout gaps as residuals rather than S1c closure.
- Release: performed after the integrated evidence/doc state; final findings and disposition are
  recorded before close-out.

Reviewers did not infer deployment, live configuration, customer/provider, production identity or
device proof.

## Residuals carried forward

1. **P1 notification capability:** authenticated can execute `SECURITY DEFINER`
   `notify_emit(text,jsonb)`, which reconstructs no caller, loads the stored Worker URL/secret and
   forwards caller-controlled JSON. The right-hand body can override `type_key`. This is the next
   dedicated S1d migration/caller-compatibility slice.
2. **P1 recording-source bypass:** authenticated `get_inbound_leads` returns `il.*`, including
   `recording_url`, and broad `inbound_leads` policies allow direct access/mutation. Proxy
   containment is not recording confidentiality.
3. **P2 direct bell bypass:** authenticated can execute the `create_notification` definer outside
   `/api/notify`; queue with the shared notification/RPC wave.
4. **P2 rollout mismatch:** non-admin Worker capability does not consume the desktop CRM
   rollout/force-disable flags. The independent admin-mobile path remains admin-only.
5. **P2 compatibility/privacy:** the provider-returned signed URL/content type and bounded upstream
   `detail`/`snippet` fields remain trusted/preserved deployed behavior.
6. **P2 timeout:** shared Supabase Auth and Web Push use raw fetch. CallRail account/provider/signed
   audio and notification email are timed; global fan-out timeout completion is still open.
7. **P2 UI compatibility:** `crm_partner` sees the desktop playback control but receives 403. Hide
   it or obtain an explicit separate recording authority decision before claiming partner parity.
8. **Separate QBO residual — no S1c mixing:** customer/manual-payment sync do not persist durable
   human-actor telemetry.
9. **Separate QBO residual — no S1c mixing:** the live `qbo_attachments` SELECT policy does not
   require `employees.is_external=false`, so an external admin can satisfy it. This needs its own
   additive migration/apply/rollback window.
10. Wider mobile RPC/direct-policy, private media, account/device, native, push/OTA and qualification
    work remains governed by the roadmap and registry.

## Rollout

No rollout was authorized or performed. A future owner-authorized source release should:

1. integrate the complete foundation→R0→S1b→S1c linear range into a reviewed release branch;
2. decide whether external CRM partners must lose the visible playback control before deployment;
3. verify required binding/configuration **names and presence only** in Preview and Production
   without exposing values;
4. deploy the immutable reviewed source to the approved non-production environment;
5. exercise missing/expired/inactive/external/wrong-role, internal admin, explicit allow and
   explicit deny identities using non-customer synthetic fixtures;
6. canary one non-customer recording in direct/app/signed forms and verify private audio/error/
   timeout behavior without recording its content;
7. verify one pre-approved non-customer database-trigger notification plus disabled-type/partial
   fan-out summaries without sending customer communication;
8. monitor 401/403/404/5xx, provider timeout/error and notification channel summaries before any
   production promotion;
9. separately contain/apply `notify_emit` and recording-source database boundaries before claiming
   `MOB-SEC-014` closure.

There is no migration or database apply in S1c.

## Rollback

A reviewed forward authorization fix is preferred. Reverting S1c restores known any-employee
recording and arbitrary valid-Bearer notification behavior and is not a neutral compatibility
rollback.

For an emergency source rollback:

1. disable or externally restrict the affected playback/HTTP entrypoint and pause the relevant
   notification trigger before reverting;
2. revert only the S1c source commits with owner/security approval and record that
   `MOB-SEC-014` regressed;
3. leave database functions, schedules, secrets and provider configuration unchanged;
4. verify the prior response/trigger contract and continue monitoring unauthorized/failed access;
5. ship a forward containment repair before re-enabling the entrypoint.

The future `notify_emit`, recording-source and QBO policy changes each need separate additive
rollback SQL and owner-authorized apply windows; they are not part of S1c rollback.

## External gates and next bounded session

Open gates: push/PR/integration, Preview/Production deployment and hash proof, binding-name/presence
reconciliation, representative deployed identities, non-customer provider/trigger canaries,
external-partner UI/policy decision, live RPC/RLS containment, shared timeout work, full-tree lint/
dependency ownership, private media, physical-device/signing/TestFlight/push/OTA and final
qualification.

The next session should be **S1d notify RPC capability only**: start from the final S1c branch tip,
recapture the exact current live `notify_emit(text,jsonb)` signature/body/ACL/callers read-only and,
if sufficient, author a least-privilege service-only migration plus rollback and browser-denial/
trigger-compatibility tests. Do not apply it, send notifications, change configuration, deploy, or
combine it with recording-source RLS, `create_notification`, QBO residuals, device/native or media
work.

No deployment, migration apply, push, secret read/rotation, live setting change, provider call,
customer/recording/notification-content inspection, message, call, file transfer, money movement,
signing or distribution occurred.
