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
**Foundation branch:** `codex/mobile-pwa-readiness-foundation`
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

## Non-negotiable controls

1. Until this foundation is integrated into `dev`, work starts from
   `codex/mobile-pwa-readiness-foundation` in an isolated worktree and a new `codex/` wave branch.
   Fetch current `origin/dev`, record/reconcile drift, and do not discard the foundation. After
   integration, start from current `origin/dev`.
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
| C1 Compliance and rollout truth | 1–2 | Governed messaging, typed fail-safe flags, and truthful offline/support copy | `MOB-COMP-003`, `MOB-ROLLOUT-004/005`, `MOB-OFFLINE-010` | consent/DND/STOP/quiet-hours tests; flag matrix; offline product decision |
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

## Current checkpoint and next session

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

S1c still does not close `MOB-SEC-014`. The authenticated-executable
`notify_emit(text,jsonb)` definer can present the stored Worker secret for caller-controlled JSON;
`get_inbound_leads` and broad `inbound_leads` policies can expose stored recording URLs without the
proxy; shared Auth/Web Push fetches remain unbounded; and the wider RPC/direct-policy inventory is
unchanged. External `crm_partner` users are intentionally denied recording playback although the
desktop shell still exposes the control, so UI removal/owner policy is a compatibility follow-up.
No private bucket flip was attempted and `MOB-SEC-015` remains open.

The QBO residuals stay independent: customer/manual-payment sync still lack durable human-actor
telemetry, and external admins remain within the authored `qbo_attachments` metadata SELECT policy.
Cold-offline, exact field-only native route scope, admin-mobile native exclusion, push, OTA,
account-deletion fulfillment, pilot support, `project_manager` billing authority and the QBO
server-capability lifecycle remain explicit owner decisions rather than inferred approvals.

The next source session should take only S1d: recapture the exact live ACL/body/caller graph for
`notify_emit(text,jsonb)` and, if evidence is sufficient, author a least-privilege service-only
migration plus rollback and browser-denial/trigger-compatibility tests. Applying it to the shared
database requires a later owner-authorized window from a reviewed release commit. Do not combine
that database capability slice with QBO telemetry/RLS, recording-source RLS, shared identity/device
RPCs, private media, deployment or provider/device work.
