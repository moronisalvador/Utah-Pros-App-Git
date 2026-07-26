<!--
FILE: docs/native-ios/11-roadmap.md

WHAT THIS DOES (plain language):
  Provides the dependency-ordered roadmap for building a complete native Swift app while the
  existing PWA/Capacitor product remains operational.

DEPENDS ON:
  Internal: docs/upr-engineering-foundation-roadmap.md, docs/native-ios/README.md,
            docs/native-ios/01-principles-and-definition-of-done.md through
            docs/native-ios/10-release-app-store-cutover.md
  Data:     reads → accepted native-plan decisions and phase evidence
            writes → planning status only

NOTES / GOTCHAS:
  - Milestones are evidence-gated, not calendar promises.
  - Production, database, provider, signing, and release changes require separate authorization.
-->

# Native iOS Roadmap

**Status:** Proposed program roadmap
**Last reviewed:** 2026-07-26
**Delivery model:** Build the full native app as a separate product track; keep the current PWA/Capacitor app in service until native cutover.

## Evidence language

Use **Verified**, **Source-confirmed**, **Inferred**, **Blocked**, **Owner gate**, and **Not tested**.
Record repository/owner/device/provider provenance and proposed/approved/deferred/superseded
decision state separately.

## Program rules

1. Build one complete vertical slice at a time after the platform foundation; do not create dozens of half-wired screens.
2. UI parity is not backend-contract parity. Every slice names its RPC/table/view/Storage/worker/Realtime contract and role.
3. One orchestrator owns scope, dependencies, evidence, contradictions, canonical docs, and final quality.
4. One owner edits Xcode project structure/signing/entitlements at a time. One owner writes database artifacts at a time.
5. Database and provider work are separate initiatives and authorization gates. The shared production Supabase project is read-only during native planning and ordinary QA.
6. Keep at most two implementation lanes in flight after the foundation unless file and contract ownership are provably disjoint.
7. A blocked device/provider check does not stop safe contract, unit, UI, or documentation work.
8. The existing PWA/Capacitor product continues to receive critical fixes until formal retirement.

## Milestone map

| Phase | Outcome | Depends on | Exit evidence |
|---|---|---|---|
| 0. Adopt the plan | Scope, decisions, ownership, evidence model accepted | Documentation package | Owner decisions recorded; no contradictory canonical docs |
| 1. Fresh-Mac and Xcode foundation | Reproducible nonproduction native shell | Phase 0 first-build gate; Apple/Xcode availability | Clean Simulator build/test on fresh Mac; dependency/environment/CI evidence |
| 2A. Read-contract and client foundation | Typed Auth/read boundary, environment refusal, fixtures and fakes | Phase 1; reviewed first-slice catalog | Authenticated read fixture/contract proof without production writes |
| 2B. Isolated mutation QA | Safe synthetic mutation, Storage/Realtime and negative-role proof | Governed local/hosted QA | Isolated environment, lineage, cleanup, idempotency and denial evidence |
| 3. App shell and minimum design/reliability foundation | Native navigation, auth lifecycle and slice-required reusable foundations | Phases 1 and 2A; may proceed while 2B is externally blocked | Compiled reference target and Simulator evidence; device gate remains explicit |
| 4. First field vertical slice | One owner-selected technician workflow complete end to end | Phase 3; Phase 2B before mutation acceptance | Slice checklist, offline/retry evidence, representative-tech and real-device acceptance |
| 5. Dry logs and field capture | Native dry log, rooms/readings/equipment/photos | Phase 4; camera/Storage contracts | Complete role/contract/device/energy evidence |
| 6. Documents and signing | Scan, organize, review, generate, and approved e-sign flow | Phase 3 plus its contracts/privacy/provider gates; not inherently Phase 5 | Demo-account signing/reconciliation; privacy/accessibility proof |
| 7. Location, notifications, deep links, background | System capabilities add value without becoming correctness dependencies | Phase 3 plus per-capability Apple/server/privacy gates; not inherently Phase 6 | Physical-device APNs, link, background, energy, and denial/fallback proof |
| 8. Remaining workflow parity | Required production roles and workflows complete | Stable foundations; census/prioritization | Signed parity matrix; no unowned contract gaps |
| 9. Hardening and TestFlight | Release candidate survives device, security, accessibility, performance, and upgrade testing | Phases 1–8 | Internal TestFlight release gate and adversarial review |
| 10. App Store cutover | Native binary replaces Capacitor binary under controlled release | Phase 9; Apple/owner gates | Approved release, upgrade proof, observation window |
| 11. Compatibility and retirement | Old client support retired only after evidence threshold | Phase 10 and adoption/support data | Owner-approved retirement record and cleanup plan |
| 12. Sustained native operations | Ten-year maintenance, support, security and release discipline | Production release | Recurring owners, cadence, SLOs, upgrade/rotation/privacy evidence |

## Phase 0 — Decisions and program setup

**Work**

- Approve the native product scope and non-goals.
- Adopt the accepted Apple Field Pro evolution decision and classify first-slice surfaces under
  the preservation/adaptation matrix; do not restart visual discovery from a blank page.
- Decide minimum OS, iPhone/iPad support, orientation, QA bundle strategy, signing ownership, distribution path, and initial release roles.
- Baseline the current Capacitor workflow/contract census and label required, later, and retired behavior.
- Approve architecture, security, data contracts, offline policy, platform capabilities, testing, and release documents.
- Create the ownership manifest and decision register.

**Exit criteria**

- The owner workshop records v1 users/scope, device/accessibility matrix, remaining native
  adaptation decisions, and the owner-selected first-slice candidate. Apple Field Pro
  layout/workflow/refinement continuity is already approved; the exact native visual system is not.
- Non-production field-adapted Apple Field Pro translations for representative states are
  approved; compiled/device proof belongs to later gates.
- Every first-slice screen has a source-maturity and Preserve/Translate/Adapt/Reopen/Verify record.
- The technical architecture, dependency policy, first-slice acceptance packet and initial contract
  entries are approved or explicitly blocked.
- Local/hosted QA strategy and production-refusal rules are approved; unavailable mutation QA is a
  named Phase 2B gate.
- Every remaining product decision has an owner and due gate.
- Every proposed production-facing capability has a decision record or is explicitly deferred.
- The branch/worktree is documentation-only and diff-reviewed.

## Phase 1 — Fresh-Mac and Xcode foundation

**Work**

- On a fresh Mac, verify repository commit, Xcode/toolchain, Simulator runtime, and Apple account status without exposing credentials.
- Create the SwiftUI app/project under the approved repository path in a separately authorized implementation task.
- Establish local/QA configurations and schemes. Do not create or reuse a production target,
  listing, bundle, entitlement, or signing identity before the production identity ADR.
- Add only approved, pinned Swift packages and record license/privacy/maintenance evidence.
- Create a minimal CI-capable unit-test target, formatting/static-analysis rules, and bounded runtime scripts.
- In a separately authorized CI lane, add a credential-free macOS build/unit/static workflow with
  five-minute attempts, artifact scrubbing and no production signing/data.
- Establish a single project-file/package-resolution owner.

**Exit criteria**

- Clean checkout builds and tests in Simulator within bounded commands.
- QA and production identifiers/environments cannot be confused silently.
- No signing secret or backend secret is committed.
- Project settings, deployment target, supported devices, dependency lock, and build instructions are documented.
- Credential-free CI runs from a clean checkout or is explicitly blocked on approved macOS runner
  availability; “CI-capable” alone is not completion.

## Phase 2A — Read contracts, authentication, and client safety

**Work**

- Convert the contract catalog into Swift request/response models and protocol interfaces.
- Implement auth session restore/refresh/logout behind an adapter; store only approved session material in Keychain.
- Add environment pinning and Debug refusal for the production Supabase project.
- Build deterministic fakes and sanitized decoding fixtures.
- Prove one authenticated read contract using mock/local or read-only isolated evidence and cover
  session expiry/denial without production mutation.
- Set up contract drift reporting without generating Swift directly from unreviewed live state.

**Exit criteria**

- No service-role/provider secret can enter the client.
- Auth and contract tests distinguish `401`, `403`, not-found, validation, conflict, rate-limit, timeout, and server failure.
- Production-refusal and environment-mismatch tests pass.
- Read-contract DTOs, fixtures and PWA/Capacitor compatibility are reviewed.
- A fresh Mac can reproduce the evidence.

## Phase 2B — Isolated mutation QA

**Work**

- Provision or finish the separately approved local/hosted isolated QA environment with synthetic
  roles, immutable lineage, deterministic reset/cleanup and provider effects disabled/sandboxed.
- Prove one ordinary mutation, negative roles/assignments, idempotency/ambiguity, Storage
  authorization, Realtime isolation and session revocation.
- Add bounded isolated-QA CI only after environment identity, egress, credentials, seed/cleanup and
  artifact-redaction gates pass.

**Exit criteria**

- Every mutation runs only in the exact isolated target and the shared project is fail-closed.
- Seed/reset/cleanup is idempotent with zero unexplained residual.
- Provider/business side effects remain zero unless the exact sandbox phase is separately opened.
- Negative authorization and duplicate/ambiguous-result evidence passes.

Phase 2B may remain **Blocked** on external provisioning while Phase 3 proceeds with mocks/read
contracts. It blocks mutation-capable slice acceptance, not unrelated shell/design work.

## Phase 3 — Shell, minimum design system, and reliability foundation

**Work**

- Implement SwiftUI navigation, typed routes, deep-link deferral, launch/auth states, role-aware entry points, and account switching.
- Translate the approved Apple Field Pro product/experience decisions into newly approved native
  global tokens, navigation rules, state vocabulary, accessibility floor, and only the reusable
  components required by the owner-selected first slice.
- Define the selected slice's local cache/draft/storage protection, retention, migration and logout
  rules; do not construct speculative stores for every future domain.
- Implement only the operation/offline/reconciliation machinery required by that slice, behind the
  reusable boundaries in the reliability plan.
- Validate keyboard, safe areas, Dynamic Type, VoiceOver, Reduce Motion, dark mode, and small/large devices.

**Exit criteria**

- Shell works without application feature stubs pretending to be complete.
- Auth revocation and logout leave no prior-user content.
- Offline/ambiguous outcomes have a coherent UI and tested state machine.
- The compiled SwiftUI reference/foundation target passes Simulator review. Physical-iPhone and
  representative-technician validation remain required before first-slice acceptance and foundation
  freeze.

## Phase 4 — First field vertical slice

**Owner gate:** the product owner selects the first slice after comparing value, contract stability, and capability risk. A recommended generic shape is:

`Today/Schedule -> Job -> work item -> draft -> validated submit -> server result`

Choose a slice with a meaningful read and mutation but without money, payroll, external messaging, or production provider side effects.

**Work**

- Implement from contract through repository/use case to SwiftUI.
- Implement against the slice's accepted Apple Field Pro preservation/adaptation records and
  document every evidence-driven departure.
- Include loading, empty, stale, offline, forbidden, validation, conflict, and retry behavior.
- Add unit, isolated-QA contract, snapshot, XCUITest, accessibility, and real-device evidence.
- Record implementation friction and revise foundations before scaling.
- Compare the completed slice against the same-content current PWA and Apple Field Pro sources
  before revising/finalizing the foundation.
- Conduct a task-based usability session with at least one representative field technician. If no
  participant is available, record a named human-validation gate and do not call the slice
  field-validated.

**Exit criteria**

- `vertical-slice-checklist.md` is complete with artifacts.
- No duplicate business rule is introduced in Swift without documenting its authoritative enforcement boundary.
- The orchestrator/adversarial reviewer accepts the pattern as reusable.
- Owner and representative-technician findings are reconciled; only then freeze the reusable
  baseline and scale additional modules/components.

## Phase 5 — Dry logs and field capture

If the owner chooses Dry Logs as Phase 4, record that decision and merge/reorder Phase 5 rather than
implementing the same workflow twice.

**Work**

- Model job/structure/room hierarchy, drying goals, readings, equipment, notes, photos, and timeline using the verified contracts.
- Add camera/photo capture and background upload only after Storage/authorization/idempotency contracts pass.
- Support fast entry, keyboard/scanner alternatives, unit/date/time-zone rules, offline drafts, conflicts, and review before submit.
- Measure sustained entry, scanning, upload, memory, thermal, and battery performance on representative field devices.

**Exit criteria**

- All dry-log roles and ownership/assignment boundaries have negative tests.
- No offline draft is silently lost or duplicated.
- Media retention and cleanup are verified.
- Real-device field acceptance passes without relying on production writes.

## Phase 6 — Documents and DocuSign

**Work**

- Add document scanning/import, organization, previews, PDF rendering, metadata, secure upload/download, and explicit share/export rules.
- Trace every document class to Storage policy and data retention.
- Decide whether existing UPR e-sign remains authoritative or DocuSign is introduced.
- If DocuSign is approved, implement server-owned OAuth/envelope/webhook lifecycle in a separate backend initiative and test with a demo account first.
- Evaluate native SDK versus embedded signing for accessibility, maintenance, privacy, offline behavior, reliability, and exit cost.

**Exit criteria**

- Document access has allowed/wrong-role tests.
- Signing completion is reconciled server-side, not trusted from a client redirect.
- Provider/demo evidence, privacy disclosure, and failure recovery pass.
- Production DocuSign remains an explicit later go-live gate.

## Phase 7 — Native system capabilities

**Work**

- Add notification registration, secure payload/deep links, and read-safe actions.
- Add foreground location only for approved workflows; background location remains a separate decision.
- Add background file transfer and only justified, best-effort background refresh.
- Add read/open App Intents after typed routes and authorization are stable.
- Evaluate one narrowly bounded, assistive Foundation Models feature with a deterministic fallback and human review.

**Exit criteria**

- Capability permission denied/restricted/unavailable paths pass.
- APNs, background transfer, link, location, intents, and AI claims have appropriate device evidence.
- Energy budgets and privacy labels are current.
- No capability becomes an authorization or correctness shortcut.

## Phase 8 — Remaining workflow parity

**Work**

- Prioritize the census by required release roles and daily frequency.
- Deliver in small waves using the proven slice template.
- Keep money, payroll, messaging/consent, credential administration, deletion, and other high-risk areas in separately reviewed waves.
- Track each contract as not started, in progress, native complete, device verified, release verified, or intentionally excluded.

**Exit criteria**

- Product owner signs the release-scope parity matrix.
- Every included workflow has contract, role, accessibility, offline, observability, and device evidence.
- Every excluded workflow has an intentional PWA/Capacitor/web fallback.

## Phases 9–11 — Hardening, cutover, and retirement

Follow `docs/native-ios/10-release-app-store-cutover.md`:

- freeze candidate scope and run independent adversarial review;
- execute fresh-Mac, physical-device, internal TestFlight, privacy, upgrade, and App Store gates;
- retain backward-compatible server contracts during adoption;
- stop phased release on defined conditions;
- retire Capacitor-specific delivery only after owner-approved adoption and support evidence.

## Phase 12 — Sustained native operations

**Work**

- Assign enduring product, iOS, backend-contract, security/privacy, QA/device, release, support and
  incident owners.
- Maintain a supported cadence for macOS/Xcode/Swift/iOS, device/OS matrix, Swift packages, SDKs,
  licenses, security advisories, privacy manifests and required-reason APIs.
- Track Apple Developer membership, agreements, certificates, provisioning, APNs keys, associated
  domains, App Store metadata/privacy answers and credential rotation before expiry.
- Monitor crash/hang, launch/interaction, sync/ambiguity, upload, background, battery/thermal,
  accessibility and support SLOs; run incident and rollback drills.
- Recapture contract/live-state drift, deprecate old client/API versions deliberately, and rehearse
  clean install, upgrade, backup/restore, account change and minimum-device paths each release.
- Maintain user support, release notes, field feedback, dependency removal and scheduled
  architecture/design-system health reviews.

**Exit criteria**

This phase never permanently “finishes.” Each release records current owners, cadence, SLO results,
expiring external assets, upgrade/privacy/contract evidence, incidents and next review date. An app
cannot be described as a ten-year product without this funded operational ownership.

## Parallel lanes

After Phase 2, the orchestrator may run:

| Lane | Typical ownership | May proceed beside | Must not overlap |
|---|---|---|---|
| Platform foundation | app shell, networking, local store, capability adapters | Design-system work with disjoint paths | Xcode project/signing owner, same shared core files |
| Contract/read model | models, repositories, fixtures, isolated-QA tests | Pure UI components | Another broad Supabase discovery or database writer |
| Design system/accessibility | tokens, reusable components, snapshots | Contract work | Feature-specific business rules |
| Vertical slice | bounded feature module and tests | One disjoint platform task | Same contracts, routes, project files, or canonical docs |
| Release/evidence | test plans, device matrix, artifact normalization | Completed implementation checks | Editing code under active feature ownership |

Owner/device/provider gates do not consume an implementation lane. They are scheduled dependencies.

## Fast-path controls

To move quickly without accumulating an untestable rewrite:

- timebox orientation and decisions, but do not timebox away unresolved security contracts;
- reuse one architecture and slice template;
- generate mechanical contract/model artifacts only from reviewed sources and diff them;
- stop and repair the foundation when the first slice exposes a systemic problem;
- keep work-in-progress low and finish evidence before opening the next slice;
- defer optional AI, App Intents, background location, widgets, and provider integrations until core field work is stable;
- treat manual/device gates as a queue, not a reason to block unit/contract/UI work.

## Owner decision register

| Decision | Needed by | Default if unresolved |
|---|---|---|
| Minimum OS and device/iPad scope | Before Phase 1 | Do not create the production target |
| QA bundle/backend and signing model | Before Phase 1 | Simulator-only foundation |
| Isolated QA provisioning | Before Phase 2 mutations | Read/fake tests only; mutations blocked |
| First vertical slice | Before Phase 4 | No feature implementation |
| Offline retention/conflict policy | Before Phase 3/4 completion | No durable mutation queue |
| DocuSign versus existing e-sign | Before Phase 6 | Keep current approved signing path |
| Background location | Before Phase 7 | Foreground/when-in-use only |
| AI use case and privacy scope | Before Phase 7 | AI deferred |
| Nonproduction bundle/team identity | Before Phase 1 project creation | Simulator-only disposable spike; no registered target |
| Production listing/bundle/cutover strategy | Before production target or external TestFlight | No production target/upload/submission |
| Capacitor retirement threshold | Before Phase 11 | Continue compatibility support |

Each decision uses `docs/native-ios/templates/decision-record.md`.
