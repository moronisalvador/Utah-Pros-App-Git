/**
 * ════════════════════════════════════════════════
 * FILE: mobile-production-readiness-roadmap.md
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Defines the ordered program for making UPR's mobile web and iPhone experiences safe,
 *   dependable, and releasable. It turns the completed audit into bounded work sessions with
 *   explicit proof and owner-controlled production gates.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  docs/audit/mobile-pwa/*, docs/mobile/*, docs/app-store-readiness-roadmap.md,
 *              docs/mobile-production-readiness-wave-ownership.md
 *   Data:      reads  → documentation only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This roadmap authorizes source work only through a separately approved session objective.
 *   - It never authorizes a shared Supabase migration, production deploy, provider action,
 *     Apple signing change, App Store submission, or customer-data access.
 * ════════════════════════════════════════════════
 */

# UPR Mobile Production Readiness Roadmap

**Status:** active plan of record
**Program ID:** `UPRF-MOB-001`
**Historical foundation branch:** `codex/mobile-pwa-readiness-foundation`
**Current integration-review branch:** `codex/mobile-readiness-current-origin-review`
(not the designated release branch)
**Current appointment-reminder wave:** `codex/mobile-readiness-reminder-activation`
qualified at exact clean commit `1d3c987dd4e5ce3c31ff333b387757dea5d82856`;
implementation `1cc1840dfe408b1b4d4f6e61b7b199958e692d2a` reconciled through merge
`6f6aa8a2d25bedc4dc9ab75753005d2b004e51dc` over exact
`origin/dev@1eef7b5806dbd65a30482b35e3c666333ab8f585`
**S1h source handoff branch:** `codex/mobile-readiness-s1h-identity-device-preferences`
**Audit documentation commits:** `79a9e4edb53b8b57b677e4c4b023a84c2f9c34ee`,
`079e985`
**Audited application source:** `ef305f6d6afab4d846eab92fc1b04038d70221f0`
**Audit result:** 37 findings — 2 P0, 21 P1, 14 P2

## Outcome and product boundary

The program is complete only when every audit finding is closed with evidence, explicitly excluded
from the supported product promise by an owner decision, or accepted through the repository's
documented exception process. The first credible release promise is deliberately narrow:

- The PWA is online-first with tested warm continuity. Cold-offline use is unsupported until a
  later decision and device proof explicitly add it.
- The initial PWA/Capacitor release admits and replays zero automatic offline commands. Every field
  write requires connectivity; D2 remains a future, separately approved capability wave.
- Capacitor initially covers approved technician/field routes. Admin-mobile is excluded from the
  native release unless a later owner decision and authorization/device evidence include it.
- Native push and OTA remain disabled for production until their full lifecycle, compatibility,
  rollback, privacy, and signed-device gates pass.
- A desktop/support fallback remains available through the controlled field pilot.
- The separate App Store roadmap remains authoritative for Apple ownership, metadata, legal,
  signing, TestFlight, and submission gates.

The completed audit is historical evidence, not proof about current `dev`. Every remediation wave
must record its base SHA and re-check affected callers, policies, workers, migrations, and live
configuration read-only before relying on an audit statement.

### Appointment-reminder activation checkpoint

The source wave closes the durable cross-channel replay and server-authoritative crew-validation
gaps with a reminder-specific claim table/RPC family, while leaving the exact-five producer
ledger unchanged. It also adds the missing producer foreign-key indexes and removes browser/Public
access from three RLS/no-policy secret tables. The reminder remains disabled and unscheduled.

The exact committed disposable forward/rollback/reapply gate passed at `1d3c987d` with manifest
`796208d8d5dcc7876f90cc0dd9adf8ee072fa6871472f25d2a7675605b4e7952`. Remaining completion is
ordered: hosted QA apply/behavior/rollback decision; separately authorized shared-project
preflight/apply/postflight; compatible Worker promotion and exact Production SHA verification;
then separately authorized enablement/scheduling and provider/physical-device proof. A repository
merge or green CI closes none of those external gates by itself.

## Non-negotiable controls

1. Start every bounded continuation from its exact reviewed handoff SHA in an isolated worktree.
   Fetch current `origin/dev`, record both SHAs, reconcile with normal no-rewrite merges, and review
   the combined result before a release commit. Never rebase/rewrite the R0→current evidence chain
   merely to appear current.
2. The primary orchestrator is GPT-5.6 Sol at Ultra reasoning. It may run at most three concurrent
   subagents in this environment, following the ownership manifest.
3. Only one writer owns a shared hotspot at a time. Read-only discovery and independent review may
   run in parallel.
4. Supabase and production are read-only during discovery, design, source implementation, and
   review. A migration may be authored and tested locally, but applying it requires a separate,
   explicit owner-authorized production window from a reviewed commit.
5. Provider sends, money movement, deploys, signing, TestFlight, App Store changes, secret changes,
   and real-customer tests are never implied by a source-work session.
6. Long-lived subprocesses use a five-minute timeout, `try/finally` child-tree cleanup, and a
   post-run port/process check. A limitation is recorded honestly instead of being converted into
   simulated evidence.
7. Each session has one coherent outcome, targeted tests, documentation close-out, and a known Git
   state. Do not combine unrelated backlog cleanup with a readiness wave.

## Program sequence

| Wave | Suggested sessions | Outcome | Primary findings | Exit evidence |
|---|---:|---|---|---|
| F0 Foundation | 1 | Roadmap, ownership, agent adapters, preflight, and handoff are reproducible | governance only | foundation checks pass; branch published |
| R0 Recapture and decisions | 1 | Reconcile current `dev` with the audit; freeze supported PWA/native/offline/admin/push/OTA scope | all, no closure | current SHA inventory, decision record, exact P0 caller map |
| S1 Authorization containment | 2–3 | Trusted workers, RPCs, direct writes, roles, assignments, and negative contracts are server-authoritative | `MOB-SEC-014` | affected-path inventory; negative tests; reviewed migration/deploy/rollback plan; independent security review |
| S2 Private media boundary | 2 | Inventory every `job-files` consumer; implement private least-privilege delivery and compatibility | `MOB-SEC-015`, prerequisite for `MOB-DATA-012` | anonymous/unrelated denial tests; allow-path tests; URL migration and rollback proof; no customer object inspection |
| D1 Account-safe device state | 2 | Namespace, classify, retain, and clear query, route, draft, queue, blob, preference, and push state | `MOB-STATE-001`, `MOB-DATA-002` | two-account/logout/expiry/reinstall matrix |
| D2 Durable commands and media | 2–3 | Recoverable leases, idempotency, stable media operations, orphan reconciliation | `MOB-OFFLINE-011`, `MOB-DATA-013`, `MOB-DATA-012` | kill/replay/two-tab/lost-response/failure-injection tests |
| D3 Business write integrity | 1–2 | Critical composite mutations are atomic or explicitly compensating | `MOB-REL-034` | per-step failure, concurrency, retry, reconciliation evidence |
| C1 Compliance and rollout truth | 1–2 | Governed messaging, typed fail-safe flags, and truthful offline/support copy | `MOB-COMP-003`, `MOB-ROLLOUT-004/005`, `MOB-OFFLINE-010` | consent/DND/STOP/quiet-hours tests; flag matrix; ~~offline product decision~~ **CLOSED 2026-07-27 — owner ratified online-only for the initial release; see `.claude/rules/tech-mobile-ux.md` offline amendment** |
| O1 Observability and release control | 2 | Recoverable errors, release correlation, one blocking compatibility/provenance manifest | `MOB-OBS-024`, `MOB-OPS-035`, `MOB-PWA-037`, `MOB-DEP-027` | redaction/failure injection; fail-closed gate; rollback rehearsal; advisory disposition |
| W1 PWA maturity | 1–2 | Stable install identity/assets, cache/update behavior, authenticated installed-device proof | `MOB-PWA-018`, remaining PWA scope | iOS/Android install/update/warm/cold/reset matrix for promised modes |
| N1 Native security and privacy | 1–2 | Approved native session, unlock, background snapshot, account lifecycle, route scope | `MOB-SEC-016`, `MOB-PRIV-009`, `MOB-NATIVE-036`, `MOB-ARCH-006` | signed-device lifecycle tests and owner decisions |
| N2 Native channels and navigation | 2–3 | Governed push attach/detach/dispatch and allowlisted deep links | `MOB-PUSH-017`, `MOB-NATIVE-023`, `MOB-NATIVE-022` | sandbox/TestFlight delivery and cold/warm/account-switch URL matrix |
| N3 Native release | 1–2 | Reproducible signed archive, privacy manifest membership, safe OTA compatibility and rollback | `MOB-OTA-019`, `MOB-NATIVE-020/021` | clean archive inspection, signed install, bad-bundle rollback |
| Q1 UX, accessibility, performance | 2–3 | Close measured interaction, semantics, list, CSS, motion, back, and continuity findings | all P2 UX/perf/data findings | seven-width visual/axe/AT matrix; profiles and binding budgets |
| Q2 Qualification and re-audit | 1–2 | Repeatable release matrix and an independent new audit snapshot | `MOB-TEST-025`, all remaining | zero open P0; every promised P1 closed; pilot and rollback decision |

Expected execution is roughly 20–28 focused sessions. The number is a planning range, not a target
to optimize; split a wave whenever authorization, Storage, money, external providers, shared
hotspots, or device evidence would otherwise become ambiguous.

## Session lifecycle

Every implementation session uses this sequence:

1. Read `AGENTS.md`, `CLAUDE.md`, applicable rules, this roadmap, the ownership manifest, the
   relevant canonical `docs/mobile/*`, audit findings, and latest dated live evidence where
   authorization/Storage/database decisions are involved.
2. Run the repository preflight and record the base SHA, branch, working-tree state, tools, and
   external limitations.
3. Map all callers and trusted boundaries before editing. Refresh live configuration only through
   read-only inspection and do not inspect customer row/object contents.
4. Assign one writer and up to three bounded read-only reviewers. Declare file ownership before
   parallel work.
5. Implement the smallest contract-preserving slice. Add negative and failure-path tests in the
   same session.
6. Run risk-proportional verification. Five-minute-bound any server, simulator, browser, or Xcode
   subprocess and guarantee child cleanup.
7. Update canonical documentation and the unfinished-work registry. Record external/device gates as
   open when they were not actually performed.
8. Commit a coherent source state. Push, open a PR, deploy, apply, sign, or submit only when that
   delivery step was explicitly requested.

## Overnight autonomy boundary

An unattended session may read source and approved read-only configuration, create isolated
worktrees/branches, edit source/tests/docs, install lockfile-pinned local dependencies, run bounded
local builds/tests/simulators, commit coherent local changes, and leave review artifacts.

It must stop before:

- applying or repairing any shared Supabase migration;
- production/staging deploy or release promotion;
- changing Cloudflare, Supabase, Apple, provider, GitHub protection, or secret settings;
- sending email/SMS/push, moving money, touching real customer objects, or creating live business
  records;
- signing/distributing an archive or submitting to TestFlight/App Store;
- merging to `dev` or `main`;
- making an owner product/legal/risk decision.

An unattended run is successful when it reaches a clean, reviewed, locally verified handoff. It
does not need to cross an external gate to claim useful completion.

## Release and program exit gates

- `P0`: zero open findings before any expanded field evaluation.
- `P1`: every finding within the promised release scope closed with tests and observed evidence.
  Conditional P1 findings require an explicit exclusion or closure; silence is not exclusion.
- Authorization and Storage changes: negative tests plus an independent reviewer and a separately
  authorized live apply/verification window.
- PWA: authenticated installed iOS and Android tests for every promised online/offline/update mode.
- Native: clean signed archive inspection, privacy manifest, entitlements, TestFlight install,
  supported iPhone/iPad/OS matrix, account switch, background/privacy, deep-link and push proof.
- Operations: compatibility manifest, release-correlated diagnostics, rollback rehearsal, named
  owner/on-call/support fallback, and sanitized evidence tied to exact SHAs.
- Final qualification: a fresh independent audit snapshot; the 2026-07 audit is never rewritten to
  represent later code.

## Current checkpoint and remaining gates

The current integration-review topology preserves every history without rebase or rewrite.
`codex/mobile-readiness-current-origin-review` first records merge `4688ed64` with direct parents
`4583f0a6` and mobile tip `e2b7585f`. A 2026-07-27 08:02 MDT pre-publish fetch advanced
`origin/dev` to `983b8ca4`; the follow-up merge has direct parents `4688ed64` and `983b8ca4`, with
common base `4583f0a6`. The only content conflict was `src/App.jsx`; its resolution preserves both
target-specific web/native registries and the latest field-tech redirects. **At that 2026-07-27
checkpoint**, this was local source integration prepared for draft-PR review, not a
`dev`/production release. Subsequent current-origin integration is now present in `dev`; the
R0→S1h sequence below is provenance, not a request to restart from the foundation.

Wave R0 source/live recapture is complete on `codex/mobile-readiness-wave-r0` from foundation
`7aa4b0c`, with fetched `origin/dev` `90b265e` confirmed as an ancestor. The exact route/caller,
Worker/RPC/direct-table, policy/grant/object, owner-decision, test, rollout, rollback and separate
live-apply record is
`docs/audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md`.

The corrected transitive census is 84 client-reachable `SECURITY DEFINER` RPCs—82 in the
authenticated `/tech` graph plus two public-signing RPCs—and 22 direct PostgREST tables, plus
Realtime on conversations/messages/notifications. Four RPCs allow `anon` and three allow
`PUBLIC`; shared employee-ID, notification, device-token, clock-precheck, destructive-merge, and
public signing boundaries are explicitly queued behind the Worker slices.

R0 contains the locally verified S1a slice for four legacy QBO Workers. S1b continues from the
exact R0 tip and locally contains the remaining QBO Worker identity surface: customer/payment sync
retain their scheduler capability but require an active internal admin for browser access, OAuth
connect is human-only, and charge/attachment mutation reject external employees. Focused tests
cover negative identities, auth/configuration failure, secret precedence/fallback, both poller HTTP
methods, direct `scheduled()`, OAuth state writes and exact disconnected response contracts. This
is authorization containment, not complete actor auditing: customer-sync and manual payment-sync
do not persist the resolved human actor in current telemetry.

S1c continues from the exact S1b tip and locally contains the CallRail recording proxy and HTTP
notification identity surfaces. Recording playback now requires an active internal admin or the
company-wide `crm_call_log` employee/role capability, then proves the UUID call row and provider
call-ID/allowlisted-URL binding before credential or provider access. HTTP notify preserves exact
secret-first and in-process origins; the human Bearer path is active-internal-admin only and is
restricted to four appointment/estimate object-derived events with no caller-selected audience,
copy, payload or link. Focused tests pin denial/configuration/object failures, provider-never-called
ordering, audio/error/timeout compatibility, secret precedence and the deployed fan-out summary.

S1d continues from exact S1c tip `352be211`, in a fresh
`codex/mobile-readiness-s1d-notify-rpc` worktree. Current `origin/dev` provenance-only commit
`d54b6ba` was merged without rewriting S1c; it maps the second already-applied
`ops_health_alerting` ledger row and changes no product/migration contract.

The bounded read-only live capture at `2026-07-26 16:52:53 UTC` initially confirmed one exact
`notify_emit(text,jsonb) -> void` overload, owner `postgres`, `SECURITY DEFINER`,
`search_path=public`, and then-current grants to `authenticated` plus `service_role`. Six owner-run
definer functions contain seven direct calls across appointment/estimate triggers, timesheet RPCs,
and the abandoned-clock scan/`postgres` cron. No browser/Pages source caller exists.
`20260726110000_notify_emit_service_boundary.sql`, its exact rollback, catalog-only apply checks,
and credential-free contracts were authored from that capture. The patch removes browser EXECUTE, retains
`service_role`, and changes only the JSON object merge order so `p_body` cannot replace the trusted
type key; trigger/scheduler URL, secret, header, payload, pg_net, ignored-response, caller and
schedule contracts remain frozen.

S1d is **live** as ledger row `20260727233704_notify_emit_service_boundary`; authenticated
execution is denied and service-role execution retained. The later live
`20260731165215_pg_net_worker_url_allowlists` migration adds the two-origin URL allowlist and
blank-secret no-op without changing the owner-run caller graph. Direct
`get_inbound_leads`/broad `inbound_leads` recording-source access, authenticated
`create_notification`, shared Auth/Web Push timeouts, the
wider RPC/direct-policy inventory, and the external-partner playback UI mismatch remain separate.
No private bucket flip was attempted and `MOB-SEC-015` remains open.

The QBO residuals stay independent: customer/manual-payment sync still lack durable human-actor
telemetry, and external admins remain within the authored `qbo_attachments` metadata SELECT policy.
Cold-offline, exact native route scope, broad admin-mobile native exclusion, push, OTA,
account-deletion fulfillment, pilot support, `project_manager` billing authority and the QBO
server-capability lifecycle remain explicit owner decisions rather than inferred approvals.

**2026-08-03 owner scope decision:** the iOS product admits one bounded exception to the original
field-only page set: an admin-only OOP estimate-review route reached only after the calculator
creates a job-linked official estimate. The page may correct the saved service address and existing
line descriptions, quantities and rates, but does not call `/api/qbo-estimate`: the existing
endpoint lacks the durable retry/reconciliation contract required for phone timeouts. The full
Admin Mobile subrouter, Collections, invoice/payment, generic QBO catalog, provider-send and
estimate-to-invoice paths remain excluded. This is a product-scope decision, not evidence that the
conversion migration, feature flag or deployed native binary is live.

S1e recording-source authorization is live and verified: QA ledger
`20260731224513_inbound_lead_recording_source_boundary`, production ledger
`20260731225511_inbound_lead_recording_source_boundary`. Raw URLs are in a forced-RLS service-only
table while an opaque truthy marker preserves the frozen `inbound_leads` shape.
`get_inbound_leads` enforces the admin/`crm_call_log` decision; direct access has no anonymous
privilege or authenticated DML, with active-internal company-wide metadata reads because no
employee-to-CRM-org/lead assignment field exists. Compatible Worker/runtime proof remains; do not
reapply S1e.

S1f authenticated `create_notification` bell-emission containment is now authored and locally
verified, not applied. The attribute-only migration removes browser EXECUTE, retains the
service-role Worker and owner-run midnight-clock caller, and leaves the function body/signature and
recipient/broadcast behavior unchanged. S1d and S1e are live; S1f retains its own unapplied window.

S1g notification read/mark recipient authorization is live as
`20260728192024_notification_read_recipient_boundary`. It preserves the four deployed RPC
identities/results and PWA/Capacitor callers, derives
the active internal employee from `auth.uid()`, denies foreign selectors, adds private per-employee
broadcast receipts, and changes the existing Realtime SELECT policy to own-or-broadcast. Historical
globally-read broadcasts stay read; targeted read state remains row-local. S1d, S1e, and S1g are
live; only S1f retains a separate unapplied window. A 2026-07-28 correction aligns the exact
five-column identity
containment dependency, adds the required explicit deny policy, retains the sentinel policy object
inert, and makes rollback preserve authorization while disabling browser access. Credential-free
contracts pass, and the corrected exact preflight/forward/post-apply/behavior/rollback chain passed
against both a temporary synthetic PGlite database and a disposable official local Supabase 2.110.0
stack. The live value-free postcondition, Moroni positive list/count, foreign-selector denial,
unmapped-caller denial, advisors, and provenance all passed. Two-session PostgREST/Realtime and
PWA/Capacitor client qualification remain close-out gates. The unsafe
historical shared/anonymous notification test is retired,
and its unrelated
preference-resolver coverage moves to the next shared identity/device/preferences QA slice.

The checksum-pinned operator index at `docs/mobile/s1d-s1g-database-apply-runbook.md` records four
separate windows; it does not authorize or combine them. S1d, S1e, and S1g are historical completed
windows and must not be replayed. S1f still requires its own reviewed release commit, fresh drift
capture, explicit owner go, single-migration execution, post-apply/behavior proof, and dated
close-out.

**Historical S1e/S1g apply-order prerequisite:** each target required the separately governed
`20260726180000_mobile_employee_identity_authority.sql` and
`20260726182000_mobile_employee_identity_containment.sql` sequence plus the compatible-client/
old-client decision. Their successful preflights proved there was no duplicate
`mobile_employee_identity_containment` ledger row and that the browser-read-only employee catalog
contract matched. Both targets are now live; do not replay them. A future dependent migration must
recapture the same catalog/ledger state in its own owner-approved window.

The owner subsequently handed the DB-1 and application overlap into this session. The first three
sources below are live and provenance-mapped; the fourth is retired:

1. `20260726180000_mobile_employee_identity_authority.sql` — additive selector-safe profile,
   directory, and historical message-author contracts;
2. `20260726182000_mobile_employee_identity_containment.sql` — later schema-last employee/pay
   authority containment after compatible clients and cache retirement;
3. `20260727020000_upsert_employee_page_access_provenance_reconciliation.sql` — the exact
   prerequisite function provenance reconciliation;
4. `20260727022920_mobile_personal_ownership_boundary.sql` — **RETIRED / DO NOT APPLY** personal
   page/preference/Web/native device source.

The retired S1h preflight correctly refused on QA and production after newer live
notification-preference and native-token lineage changed the contracts it would replace. A
temporary non-retained PGlite experiment of its old lifecycle does not override that drift. Any
remaining Page Access/Web Push ownership work requires a new, later, narrowly scoped migration that
preserves live preference/native-token signatures, shapes, and authorization. The retirement gate
is recorded in [`mobile/s1h-database-apply-runbook.md`](mobile/s1h-database-apply-runbook.md).

The PWA/device-state source now binds query persistence, route restore, queue/blob/cache mappings,
and Push cleanup to an opaque owner plus exact login epoch. Account transitions synchronously stop
old writers before asynchronous cleanup and fail closed on uncertain server/local detach.
Owner-bound Web/APNs detach journals survive crash/reload; direct A→B cleanup retains A's
token-bound client and prevents B from consuming/relabeling A state. Rejected bootstrap now waits
for device cleanup and strictly verified local sign-out before Login; employee/permission/
page-access/flag responses are schema-validated before publication; and password recovery waits for
cleanup without losing its recovery session. The final Auth-lock fix makes observer callbacks
synchronous and processes their work through a serialized next-macrotask queue. Observer-only
expired-session cleanup now preserves its durable journal and uses a fresh same-account session
rather than retrying with the expired client. Post-fix race tests pass 46/46; independent security
review reran them and found no remaining source P0/P1. Browser/device proof remains separate.
Credential-free local browser smoke now covers the logged-out root at 390px and 1440px plus public
`/privacy` and `/status`; authenticated and installed-device proof remains separate.
Offline claims use random tokens, TTLs, and compare-and-swap completion. Value-free live
catalog evidence
confirms stable UUID contracts for room creation, reading insertion, and equipment placement, but
the initial release enables none of them for offline use. `PRODUCTION_QUEUE_TYPES` is empty, the
hook exposes no enqueue/retry API, the runner imports no dispatchers, and every field write is
online-only. The three stable-ID definer RPCs still have a separate caller-authorization gap.
Evidence:
[`audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md`](audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md).

IndexedDB v3 is now legacy containment only: owner rows in every store are count-only quarantined,
inspection failure blocks rollout, bounded typed open/version-change callbacks are generation-
scoped, exact-confirmation two-click cleanup discards all device-local offline stores, and
historical completed-photo maintenance is key-only, retry-limited, time-rotating, and never sends.
Focused verification passes 58/58. In the current-origin integration worktree, the complete unit
lane passes 90 files/1079 tests, Worker passes 99 files/1476 tests, QA passes 25 files/206 tests, and
web/native builds pass. Independent review found no actionable offline P0/P1. Full lint retains a
310-problem repository baseline, and preflight reports 0 errors/2 expected warnings (dirty
integration tree and optional GitHub delivery unavailable). Real multi-tab/upgrade and
representative PWA/native device proof remain additional gates.

The native source remains allowlist-only by construction: a target-specific page registry plus final
Vite module-graph guard excludes office, CRM, desktop settings and broad admin-mobile/billing code
while retaining the explicit admin-only OOP estimate-review exception above. The full browser build
remains intact. Native preserves login/recovery/legal/support and both public signing routes. Shared
account-deletion request UI is reachable from field settings. Enrolled
biometrics fail closed, AppDelegate covers app-switcher snapshots, and the exact app privacy
manifest declares 12 linked/non-tracking App Functionality data types, including Other Financial
Info for retained OOP quote/pricing data.

Current-origin browser smoke caught and repaired a registry/destructuring omission that left the
existing `/settings/lists` route referring to an unbound `ListsAndValues` page. A generic source
contract now requires every declared browser lazy page to be exported by the web registry and every
web-registry export to be destructured by `App`; the two sets are equal at 90 entries. Independent
cross-platform review found no P0/P1 in that three-file repair, and native graph isolation remains
intact. The final `dev` reconciliation also preserves field-tech redirects from office
conversation/job/claim/schedule detail routes into their PWA equivalents while leaving list routes
available; the redirect/registry continuity lane passes 27/27.

The mounted native navigation bridge validates custom/Universal Links and Push actions through one
allowlist, retains protected links only until the verified account lease is ready, drops stale
account intents, and never surfaces raw foreground Push content. Native Push enrollment and the
official UPR OTA path remain exact-default-off. An isolated UPR Dev Capgo canary now has source
contracts for generated `.upr.dev` configuration, v2 encryption, minimum native compatibility,
late auth/route health acknowledgement, signed-artifact verification, sanitized evidence, explicit
rollback, and future-delivery disable. `MOB-OTA-019` remains open until Capgo plan/object/key state,
a signed UPR Dev archive/install, interruption/failed-bundle drills, device rollback, statistics,
and official-UPR non-regression are observed.

These source changes do not make the product production-ready. The reviewed
`@capacitor/app` sync and checked-in `ios/Gemfile.lock` now align with Ruby
3.3.12, Bundler 2.5.22, and Fastlane 2.237.0; the release workflow still
rebuilds and rejects native drift. The current-origin integration is present in `dev`, but
authenticated/installed web/native regression, the remaining S1f window, residual Page Access/Web
Push replacement work, QBO telemetry/RLS, private media, public-signing/route-family containment,
deployment/providers, Apple signing/TestFlight, and installed PWA/physical-device qualification
remain independent gates. No one gate authorizes another.
