<!--
FILE: docs/native-ios/README.md

WHAT THIS DOES (plain language):
  Indexes the plan for building a new native Swift iOS application alongside the existing
  PWA/Capacitor client. It defines the reading order, decision gates, and evidence boundary.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, docs/architecture.md, UPR-Web-Context.md,
            docs/upr-agent-qa-access-roadmap.md, docs/app-store-readiness-roadmap.md
  Data:     reads → repository and dated audit evidence at the recorded base commit
            writes → documentation only

NOTES / GOTCHAS:
  - This is a plan of record, not an implemented Swift application.
  - Current Capacitor behavior and production configuration are not inferred from this plan.
  - Owner decisions are intentional gates; agents must not silently choose product direction.
-->

# Native iOS Plan

**Status:** plan ready for owner review; Apple Field Pro evolution direction approved; current
PWA/Capacitor hardening gate not yet evidenced; Swift implementation has not started
**Prepared:** 2026-07-25; owner direction amended 2026-07-26
**Planning branch:** `codex/native-ios-plan`
**Base:** `origin/dev` at `90b265ee6f733c8dbcd75786f4e4057dd3355d38`
**Product decision:** build a new Swift/SwiftUI client in parallel while the existing PWA and
Capacitor app remain the operational clients.
**Product/experience direction:** evolve Apple Field Pro as the native blueprint, preserving its
layouts, workflow decisions, and refinements while adapting them for field readability, easier
tapping, native iOS behavior, and lessons from the current PWA. Exact native colors, typography,
symbols, materials, controls, and measurements remain design/device gates.

This directory is the canonical starting packet for the new native application. It is designed so
a fresh Mac session can orient once, ask the owner the consequential questions, establish safe
foundations, and then build vertical slices without rediscovering UPR's contracts.

No plan can honestly guarantee a perfect app or zero future rework. This one reduces avoidable
rework by requiring decisions, prototypes, contract inventories, threat models, isolated QA, and
exit criteria before dependent implementation begins. Rework caused by user learning is healthy;
rework caused by skipped foundations is not.

## Program sequence

The current PWA/Capacitor client is the operational fallback for the duration of the native build.
Before committed Swift implementation, it must reach the supportable maintenance baseline in
[17-current-client-hardening-gate.md](17-current-client-hardening-gate.md):

1. adopt the completed mobile audit without restarting it and independently close the hardening
   scope derived from its existing finding IDs;
2. record `NIOS-H: READY` for the exact source, deployed build, supported capabilities, and device
   evidence;
3. complete or refresh native Discovery Sessions A/B and the Phase 0 first-build decisions;
4. obtain separate implementation authority and start in a fresh isolated worktree from the
   explicitly approved current `origin/dev`.

This is not a perfection gate. Audit P0, current-client/shared-contract Critical, and unconditional
P1 blockers must close; conditional P1 capabilities must close or be visibly excluded; lower-risk
debt may be owned and deferred when it does not undermine the fallback or shared contracts.
Planning-only review and disposable design artifacts can be separately authorized before `READY`,
but the recommended Mac handoff intentionally waits so the owner can finish current-client
hardening first.

## What “design system first” means here

Before production screens are built, the team completes and owner-approves:

- experience principles, personas, navigation, typography, color, spacing, iconography, motion,
  accessibility, input, safe-area, keyboard, loading/error/empty/offline, and content foundations;
- a small set of representative high-fidelity prototypes on real target device sizes;
- the reusable primitives and components required by the first proven workflows;
- the token, component, preview, snapshot, and accessibility test harness.

It does **not** mean guessing every component the product may ever need. Components graduate into
the system from approved workflow prototypes. That preserves consistency without constructing a
large speculative library that must be discarded later.

After `NIOS-H` is `READY`, the first native Mac session is Discovery Session A from
[02-owner-decisions-and-discovery.md](02-owner-decisions-and-discovery.md), not implementation.
The preserve/evolve/replace question is already closed as **evolve**; the session uses
[03a-apple-field-pro-adaptation-matrix.md](03a-apple-field-pro-adaptation-matrix.md) to decide the
remaining field, device, visual, and first-slice details. Discovery Session B selects the first
slice and closes the native-planning first-build gates; `NIOS-H` and separate implementation
authority remain independent prerequisites before construction.

## Required reading order

| Order | Document | Purpose |
|---:|---|---|
| 1 | [00-product-charter.md](00-product-charter.md) | Product boundary, goals, non-goals, success |
| 2 | [17-current-client-hardening-gate.md](17-current-client-hardening-gate.md) | Required PWA/Capacitor maintenance baseline before Swift implementation |
| 3 | [01-principles-and-definition-of-done.md](01-principles-and-definition-of-done.md) | Non-negotiables and quality gates |
| 4 | [02-owner-decisions-and-discovery.md](02-owner-decisions-and-discovery.md) | Questions the owner must answer before construction |
| 5 | [03-design-system.md](03-design-system.md) | Native design foundation and approval sequence |
| 6 | [03a-apple-field-pro-adaptation-matrix.md](03a-apple-field-pro-adaptation-matrix.md) | What to preserve, translate, adapt, reopen, and verify |
| 7 | [04-information-architecture-and-workflow-parity.md](04-information-architecture-and-workflow-parity.md) | Route/workflow scope and parity method |
| 8 | [technical-architecture.md](technical-architecture.md) | Module, state, dependency, navigation, concurrency, and scaffold blueprint |
| 9 | [05-data-contracts-and-environments.md](05-data-contracts-and-environments.md) | Swift data layer, contract registry, and environment isolation |
| 10 | [06-security-privacy-and-compliance.md](06-security-privacy-and-compliance.md) | Authorization, secrets, privacy, and compliance |
| 11 | [07-offline-sync-and-reliability.md](07-offline-sync-and-reliability.md) | Offline truth, retries, idempotency, and recovery |
| 12 | [08-platform-capabilities.md](08-platform-capabilities.md) | Camera, location, push, documents, signing, and Apple capabilities |
| 13 | [09-testing-and-quality.md](09-testing-and-quality.md) | Automated, simulator, accessibility, performance, and device proof |
| 14 | [10-release-app-store-cutover.md](10-release-app-store-cutover.md) | Signing, TestFlight, App Store, rollout, and rollback |
| 15 | [11-roadmap.md](11-roadmap.md) | Dependency-ordered implementation phases |
| 16 | [12-agent-execution-and-ownership.md](12-agent-execution-and-ownership.md) | Multi-agent boundaries, sequencing, and close-out |
| 17 | [13-risk-register.md](13-risk-register.md) | Known risks, mitigations, gates, and owners |
| 18 | [14-mac-handoff.md](14-mac-handoff.md) | Exact fresh-session instructions for the Mac |
| 19 | [15-completeness-gates.md](15-completeness-gates.md) | Single ledger proving no lifecycle category was silently omitted |
| 20 | [16-plan-validation.md](16-plan-validation.md) | Provenance, independent challenge, validation results, and honest limits |

Supporting artifacts:

- [decisions/0001-parallel-native-swift-replacement.md](decisions/0001-parallel-native-swift-replacement.md)
  records the owner-approved parallel-client decision.
- [decisions/0002-evolve-apple-field-pro-for-native-ios.md](decisions/0002-evolve-apple-field-pro-for-native-ios.md)
  records the owner-approved Apple Field Pro evolution and field-adaptation decision.
- [decisions/0003-harden-current-client-before-swift-implementation.md](decisions/0003-harden-current-client-before-swift-implementation.md)
  records the owner-approved current-client-first sequencing decision.
- [contracts/README.md](contracts/README.md) defines the contract catalog.
- [contracts/registry-template.yaml](contracts/registry-template.yaml) is the required schema for
  each screen-to-backend contract.
- `contracts/bootstrap-inventory.yaml`, when present, is source-derived orientation only; it is not
  live-state or authorization proof.
- [templates/design-review-checklist.md](templates/design-review-checklist.md),
  [templates/vertical-slice-checklist.md](templates/vertical-slice-checklist.md),
  [templates/decision-record.md](templates/decision-record.md), and
  [templates/release-gate.md](templates/release-gate.md) standardize evidence.

## Source-of-truth boundary

The native plan does not replace current project law. For current behavior and backend truth:

1. Follow `CLAUDE.md`, `AGENTS.md`, and applicable `.claude/rules/`.
2. Use current canonical documents under `docs/`.
3. Inspect source, migrations, callers, generated reports, and read-only live catalog evidence.
4. Treat `UPR-Web-Context.md` as detailed historical inventory, not proof of current live state.
5. Treat dated audits as snapshots at their recorded commits.

If a native design wants a different business rule, backend response, or authorization model, stop
and open a separately reviewed backend contract change. A mobile UI decision cannot redefine
server or database authority.

For native product/design/workflow provenance, use this source order:

1. accepted native ADRs and `03a-apple-field-pro-adaptation-matrix.md`;
2. locked decisions/anatomies in `docs/tech-redesign/TECH-DESIGN-STANDARD.md`;
3. the normative mockups named by that standard and locked specs under
   `docs/tech-redesign/specs/`;
4. locked flow prototypes plus `docs/tech-redesign/SESSION-STATE.md` for maturity and later
   refinements;
5. current PWA source/device evidence for runtime and field lessons, not automatic visual authority.

Rejected challengers, unfinished prototypes, and stale progress prose never outrank a locked or
later accepted decision.

## Hard stops

Planning and scaffolding grant no authority to:

- write to the shared Supabase project, apply a migration, or change RLS/RPCs;
- send messages, charge money, upload business documents, schedule work, or call production
  providers;
- use production identities/data for automated tests;
- deploy, sign, publish, submit, or alter Apple/provider configuration;
- remove or degrade the PWA/Capacitor client;
- create or commit a Swift project or implementation branch before `NIOS-H` is `READY`;
- begin feature implementation before the applicable owner and readiness gates are recorded.

## First build gate

Implementation can begin only after all of the following are recorded:

- `NIOS-H: READY` with the exact current-client source/deployment boundary, finding dispositions,
  supported-capability matrix, Mac/device evidence, rollback/support state, and owner acceptance;
- owner workshop decisions and unresolved items;
- intended users, v1 workflow boundary, device/OS matrix, and accessibility target;
- the approved Apple Field Pro **evolve** direction translated into non-production representative
  prototypes, with preservation/adaptation classifications and owner approval;
- module/data architecture decision and dependency policy;
- contract registry for the first vertical slice with authorization and failure semantics;
- isolated local/hosted QA strategy with fail-closed project sentinels;
- first vertical slice and measurable acceptance criteria;
- Apple account/signing availability for the selected phase, or an explicit Simulator-only
  boundary when signing is not needed;
- exact phase ownership and a clean, isolated worktree.

The correct first native deliverable on the Mac is therefore a staged decision record and
foundation checkpoint, not a large batch of screens. `NIOS-H` and Sessions A/B are both required;
neither one alone unlocks construction. After plan review and separate implementation authority,
create a fresh implementation worktree from an explicitly approved current `origin/dev` commit and
carry this reviewed plan forward; do not code by default on the planning snapshot.
