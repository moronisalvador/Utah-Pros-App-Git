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

1. Work starts from current `origin/dev` in an isolated worktree and a `codex/` branch unless a
   handoff names a reviewed integration branch.
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

## Recommended first build session

Start with `R0`: recapture current `dev`, lock the product decisions, and produce the exact,
current-state implementation map for `MOB-SEC-014` and `MOB-SEC-015`. The session may add tests and
prepare narrowly scoped source changes if current evidence supports them, but it stops before any
live migration, deploy, provider action, or customer-data access. Use the checked-in prompt at
`docs/handoff/mobile-production-readiness-wave-1-prompt.md`.
