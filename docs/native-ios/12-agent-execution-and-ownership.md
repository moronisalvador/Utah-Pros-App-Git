<!--
FILE: docs/native-ios/12-agent-execution-and-ownership.md

WHAT THIS DOES (plain language):
  Defines orchestrator accountability, bounded-agent workstreams, file/contract ownership, runtime
  safety, and fresh-Mac handoff for native-iOS delivery.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, docs/upr-engineering-foundation-roadmap.md,
            docs/native-ios/README.md, docs/native-ios/01 through 11
  Data:     reads → ownership manifests, agent reports, diffs, and test evidence
            writes → planning, ownership, and normalized evidence only

NOTES / GOTCHAS:
  - Agent concurrency never broadens production, database, provider, signing, messaging, money, or
    release authority.
  - Specialist notes never replace the canonical documents owned by the orchestrator.
-->

# Native iOS Agent Execution and Ownership

**Status:** Proposed execution contract
**Last reviewed:** 2026-07-26

## Evidence language

Use the canonical labels **Verified**, **Source-confirmed**, **Inferred**, **Blocked**,
**Owner gate**, and **Not tested**. Record provenance and decision state separately. Use the
severity rubric in `13-risk-register.md`; severity, implementation state and release disposition
must not be collapsed into one label.

## One accountable orchestrator

One primary orchestrator remains responsible for:

- scope completeness and non-goals;
- repository and product orientation;
- dependency ordering and critical path;
- workstream boundaries and disjointness;
- contract/evidence standards;
- read-only production restrictions;
- ownership manifest and single-writer rules;
- finding/decision normalization;
- severity and release-gate calibration;
- duplicate, contradiction, and unsupported-claim resolution;
- cross-layer workflow tracing;
- canonical-document consistency;
- final diff, test, security, privacy, and release-quality review.

Delegation transfers work, not accountability. Specialist notes are inputs; they cannot become competing canonical architecture, schema, or roadmap documents.

## Workstream model

Use approximately six to eight workstreams when the phase is large enough to justify them. Start fewer during foundation work.

| Workstream | Bounded scope | Typical outputs | Prerequisites |
|---|---|---|---|
| Product/workflow census | Named roles, journeys, states, parity, Apple Field Pro maturity/disposition, and release scope | Route/screen/workflow and preservation/adaptation matrices | Repository orientation |
| Contract and authorization | Assigned RPC/table/view/Storage/worker/Realtime IDs and role matrix | Contract entries, fixtures, negative tests | Contract catalog; coordinated Supabase inspection |
| Swift platform foundation | App shell, environment, auth adapter, local state, networking protocols | Owned Swift modules/tests | Xcode project and environment decisions |
| Design system/accessibility | Tokens, components, snapshots, accessibility states | Reusable UI and evidence | Layout/device decisions |
| Feature vertical slice | One named journey end to end | Slice module, tests, checklist | Foundations and verified contracts |
| Native capabilities | One capability family, such as camera/scan or push/background | Adapter, entitlement proposal, device test plan | Privacy/server/provider decisions |
| Quality/release | Test matrix, performance/energy, TestFlight/App Store evidence | Release-gate packet | Stable candidate |
| Independent adversarial review | Challenge finished specialist results and candidate | Contradiction/gap report | Specialist evidence exists |

Do not spawn broad agents merely to maximize concurrency. Each workstream must have a concrete completion condition and minimal overlap.

## Required agent brief

Before starting, every agent receives:

1. a bounded objective and explicit non-goals;
2. exact repository paths and contract IDs discovered during orientation;
3. applicable `CLAUDE.md`, `.claude/rules/`, initiative, and canonical-document references;
4. environment/branch/commit and current dirty-tree ownership;
5. common evidence labels and severity/release model;
6. production/read-only restrictions and forbidden actions;
7. expected output structure and artifact paths;
8. facts-versus-inference language;
9. testing commands, five-minute runtime timeout, and cleanup policy;
10. dependencies, owner gates, and who may edit shared files;
11. instruction not to create a separate canonical architecture/contract/roadmap;
12. stop/escalation conditions.

Any design or workflow brief also receives the exact Apple Field Pro source path/section, source
maturity, locked anatomy/refinements, current-PWA evidence to compare, and required
Preserve/Translate/Adapt/Reopen/Verify disposition. “Native-first” is not permission to reinterpret
those decisions silently.

The agent reports:

- scope actually inspected;
- repository evidence with file/line or command/artifact references;
- proposed changes/decisions labeled as such;
- tests run, exact results, and limitations;
- blocked owner/device/provider gates;
- files changed;
- unexpected or potentially conflicting state;
- remaining risks and recommended next dependency.

## Ownership manifest

The orchestrator maintains a live manifest before parallel edits:

| Field | Required value |
|---|---|
| Workstream/agent | Stable name |
| Objective | One bounded outcome |
| Owned paths | Exact directories/files; globs only when narrow |
| Read-only paths | Shared context the agent may inspect |
| Contract IDs | Exact RPC/table/view/worker/Storage/Realtime entries |
| Shared hotspot owner | Named single writer |
| Dependencies | Required inputs and upstream status |
| Output/evidence | Expected files/tests/artifacts |
| Production authority | `none` unless separately and explicitly approved |
| Status | queued, active, blocked, review, complete |

Pairwise path disjointness is necessary but not sufficient. Two agents conflict if they alter the same contract, navigation route, entitlement, build setting, generated artifact, dependency lock, business rule, test fixture, or canonical decision even when paths differ.

## Single-writer hotspots

Only one assigned owner may edit each hotspot at a time:

- Xcode project/workspace structure and `project.pbxproj`;
- Swift Package manifests and `Package.resolved`;
- schemes, build settings, configuration files, bundle IDs, entitlements, capabilities, and privacy manifest;
- app entry point, navigation root, auth/session container, environment routing, shared networking, and local-store schema;
- design tokens and shared component primitives;
- the Apple Field Pro screen preservation/adaptation matrix and cross-screen deviations;
- contract catalog and generated client models;
- database migrations, RLS/grants/functions/triggers, Storage policies, and seed/fixture definitions;
- CI/release workflows, Fastlane, signing/export configuration, App Store metadata, and release gate;
- canonical architecture, authorization, business-rules, integration, testing/deployment, and roadmap documents.

If a task needs a hotspot owned elsewhere, send a structured request to the owner. Do not “make a quick fix” in parallel.

## Database and Supabase coordination

- **Source-confirmed (repository):** `dev` and `main` use the same Supabase production project.
- Production Supabase, production services, and production data are strictly read-only during planning and ordinary native development.
- One contract-discovery owner coordinates live read-only inspection. Do not run multiple broad schema-discovery agents.
- One database writer owns any separately authorized database implementation. Migrations are reviewed and committed before an owner-authorized apply window.
- Native agents may create protocol fakes, local fixtures, and isolated-QA tests; they may not infer live RLS from types or UI gates.
- No agent may apply migrations, alter RPCs/functions/triggers/grants/policies/Storage/schema, seed production, or use real production rows as test fixtures without explicit new authority.
- No service-role key or free-form SQL capability belongs in the iOS app.
- A database/provider gate is reported as blocked while safe client, documentation, or isolated work continues.

## Dependency sequencing

Use this sequence for each major phase:

1. Orient once and record branch/commit/status.
2. Complete or refresh the relevant workflow/contract census.
3. Complete first-slice Apple Field Pro source-maturity and preservation/adaptation records, then
   resolve remaining prerequisite owner decisions.
4. Assign bounded, disjoint specialist work.
5. Run independent work in parallel only where dependencies permit.
6. Trace important journeys across UI, use case, client adapter, backend, authorization, local/offline state, and tests.
7. Collect specialist reports.
8. Run independent adversarial review after evidence exists.
9. Resolve duplicates, contradictions, unsupported claims, and misclassified gates.
10. Update canonical documents through their assigned owner.
11. Run targeted tests, diff review, and phase exit gate.

Do not let an optional simulator/browser/provider/device check block Steps 7–11. Mark the layer blocked and continue the safe work.

## Runtime and subprocess safety

Every development server, simulator helper, browser controller, Xcode command, test runner, and runtime validator must:

- set an explicit timeout of at most five minutes per attempt;
- record the parent and child process handles/PIDs it creates;
- capture bounded, secret-scrubbed stdout and stderr;
- clean up in `defer`, `finally`, `trap`, or an equivalent guaranteed cleanup block;
- terminate and wait for spawned child processes on success, failure, timeout, cancellation, or agent interruption;
- verify only those recorded processes were terminated;
- avoid generic `killall`/process-name cleanup when other developer work may exist;
- cap retries and record each attempt;
- fail gracefully when authentication, signing, device access, simulator runtime, provider access, or environmental constraints prevent verification.

If a process appears stale, first identify its command, parent, start time, working directory, port, and logs. Terminate it only when attributable to the current task.

## Fresh-Mac execution

This implementation sequence runs only after Discovery Sessions A and B, the Phase 0 first-build
gate, and separate owner authorization to implement. It runs in the fresh implementation
worktree/branch created from the explicitly approved current `origin/dev` commit under
`14-mac-handoff.md`; never implement on the review-only `codex/native-ios-plan` branch.

The first authorized implementation session on the Mac uses this order:

1. Verify the Mac owner’s repository clone/worktree, intended branch/commit, and clean status.
2. Read repository instructions and native canonical documents.
3. Load the committed Apple Field Pro prototype, preservation/adaptation matrix, and same-workflow
   current-PWA evidence before proposing visual changes.
4. Record macOS, Xcode, Swift, Git, and simulator runtimes.
5. Confirm Apple Developer/Xcode account access without printing identifiers beyond what the owner approves and without displaying secrets.
6. Resolve the minimum OS/device, project path, QA bundle, schemes/configurations, and package decisions.
7. Build the foundation in Simulator before requiring signing or a physical device.
8. Prove QA environment routing and production refusal.
9. Run bounded unit/static checks with guaranteed cleanup.
10. Add development signing and physical-device proof only when the owner gate is ready.
11. Record a handoff with branch/commit/status, files, tests, logs, gates, and next dependency.

Do not copy signing keys, credentials, `.env` files, provisioning profiles, or Keychain contents into prompts, logs, repository files, or agent notes.

## Implementation task close-out

Before an agent reports complete:

- inspect `git diff --check`, `git status --short`, and the full diff for owned paths;
- confirm all changed files are intended and no user-owned change was overwritten;
- confirm generated files were produced by their canonical process;
- run targeted unit/contract/UI/static tests in bounded attempts;
- state whether a Mac, Simulator, physical device, TestFlight, provider, isolated QA, or production layer was actually exercised;
- update required canonical documents through the assigned owner;
- list any skipped/blocked gate honestly;
- do not commit, push, deploy, apply, submit, or release unless that exact delivery action was requested.

Unexpected files are reported. Remove them only when clearly generated accidentally by the current task and when removal cannot discard user work.

## Independent adversarial review

The reviewer did not author the work under review and receives:

- accepted scope and exit criteria;
- ownership manifest;
- contract/role matrix;
- specialist results and test artifacts;
- full candidate diff;
- known gates and limitations.

The reviewer challenges:

- repository fact presented as implementation proof;
- proposal presented as fact;
- UI role gate without server/database authorization;
- production configuration inferred from repository declarations;
- mock/Simulator/build evidence promoted to provider/device/release proof;
- missing negative roles or ambiguous retry handling;
- unowned contract, local data, privacy, accessibility, energy, upgrade, and rollback paths;
- duplicated business rules or parallel ownership violations;
- outdated App Store/privacy/SDK assumptions;
- false “complete” status where an owner/external gate remains.
- blank-slate redesign presented as “native-first” despite locked Apple Field Pro decisions;
- literal HTML/CSS/WebView copying presented as preservation without field/native evidence;

The orchestrator resolves each issue as accepted, corrected, duplicate, unsupported, deferred with owner, or blocked with evidence. The reviewer does not silently rewrite canonical documents.

## Stop and escalation conditions

Stop the affected workstream and escalate when:

- intended environment or Supabase project is uncertain;
- a task would write production data or change live configuration;
- a secret, credential, real identity, or private content appears in a diff/log;
- ownership overlaps a running agent or user change;
- a contract requires a migration/provider change outside authorization;
- signing/team/bundle ownership is uncertain;
- an action could send a company message, move money, affect payroll, sign/delete data, or change consent/DND;
- a proposed App Store action would upload, submit, release, or alter availability;
- required evidence contradicts canonical project law.

Escalation should state the concrete blocker, evidence, safest continued work, and exact owner decision/authority needed.

## Phase handoff format

Every phase ends with:

- objective and achieved outcome;
- branch, commit, base commit, and working-tree status;
- ownership manifest disposition;
- files changed;
- contracts and roles covered;
- exact tests/evidence by layer;
- production/provider/database actions taken (`none` by default);
- unresolved defects, decisions, and owner/external gates;
- compatibility/release impact;
- next dependency-ordered action;
- ready-to-use opening prompt for a fresh Mac/session when applicable.

This handoff is the recovery point after agent interruption, context compaction, or machine change. Work resumes from it rather than restarting orientation or completed evidence.
