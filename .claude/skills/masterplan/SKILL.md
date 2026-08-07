---
name: masterplan
description: Produce an evidence-backed, adversarially challenged plan for a complex, cross-cutting, high-risk, or multi-session UPR initiative. Use when the owner explicitly asks for a master plan, invokes /masterplan, needs architecture or sequencing decisions, or the work requires coordinated ownership and external gates. Keep planning read-only unless repository plan authoring is separately requested; live actions and publication always require separate authorization.
---

<!-- GENERATED from tooling/skills/masterplan/SKILL.md by scripts/render-tooling-adapters.mjs. Do not edit this adapter directly. Source SHA-256: ced8375076b8155f. -->

# UPR masterplan

This skill designs the work; it does not silently start building it. The output must be proportionate
to the initiative and usable by a future session without relying on conversation history.

## 1. Establish the planning contract

Extract the initiative, desired outcome, known constraints, authorized evidence sources, and whether
the user requested:

- an inline plan only;
- repository planning artifacts;
- implementation after approval;
- any separately gated live or publication action.

If the objective is genuinely ambiguous and different interpretations would materially change the
plan, ask one focused question. Otherwise state reasonable assumptions and continue.

Read `AGENTS.md`, `CLAUDE.md`, `docs/tooling-governance.md`, the six canonical `docs/*.md` knowledge
files, applicable `.claude/rules/`, focused domain references, active roadmaps/ownership manifests,
and `docs/upr-unfinished-work-registry.md`. Historical audits are evidence with dates, not current law.

## 2. Build an evidence ledger

Inspect the real repository before proposing architecture. Trace affected pages, components, routes,
Workers, shared libraries, RPCs, tables, policies, grants, tests, flags, provider bindings, and
callers. Use read-only live/provider evidence only when a decision depends on it and access is
available.

Classify each material claim:

- **HAVE** — current code, tests, catalog, or provider evidence proves the capability;
- **PARTIAL** — some required behavior exists but acceptance is not met;
- **MISSING** — evidence proves the required capability is absent;
- **UNKNOWN** — current evidence is unavailable or inconclusive.

For every PARTIAL, MISSING, or UNKNOWN item record the evidence, consequence, next proof required,
and whether the blocker is repository, owner, paid-account, provider, device, deployment, or live
state. Do not call a passing build proof of deployment, credentials, database apply, provider
binding, or native behavior.

Finish already-started work before inventing a replacement unless the evidence shows the current
direction is unsafe or cannot meet the outcome.

For a full web/mobile interface replacement, use `upr-interface-craft` as the supporting design
specialist and follow its replacement-program reference. Preserve product truth and contracts while
treating the discarded visual system as workflow evidence and anti-reference, not as the new
system's aesthetic foundation.

## 3. Define outcomes and boundaries

Write checkable acceptance criteria, non-goals, contracts that must remain compatible, business-rule
enforcement boundaries, rollback expectations, observability, and explicit owner/external gates.
Separate these states:

1. capability exists;
2. repository implementation exists;
3. required gate is satisfied;
4. rollout or retirement is complete.

For money, messaging, auth, PII, credentials, public endpoints, database, Storage, signing, native,
and external-provider work, incorporate the applicable negative tests and server-side controls from
project law. Do not rely on UI gates.

## 4. Choose a proportionate artifact tier

Use the smallest tier that remains executable:

| Tier | Use when | Deliverable |
|---|---|---|
| 0 — bounded | One session, low coordination, no contested seam | Inline plan with acceptance criteria and verification |
| 1 — sequenced | Several dependent steps or one high-risk change | One roadmap or implementation plan |
| 2 — coordinated | Multiple sessions or concurrent owners with real shared seams | Roadmap plus cold-session dispatch and ownership manifest |
| 3 — program | Long-running initiative with external gates, several risk domains, or durable unfinished work | Tier 2 plus registry entries and purpose-built phase review where justified |

Do not create a tracker, seed, dispatch document, ownership manifest, or reviewer merely because a
template exists. Explain why every proposed artifact earns its maintenance cost.

## 5. Design dependencies before concurrency

Build a dependency graph from contracts and file ownership. A Foundation phase is appropriate only
when a shared seam must be established once before consumers can proceed—for example a frozen RPC
contract, shared authorization helper, route shell, schema, or reusable component.

Parallel work is allowed only when:

- file and object ownership are disjoint or explicitly leased;
- contracts are frozen and testable;
- shared-database apply windows cannot conflict;
- each lane can merge safely without pretending another lane already shipped;
- review and owner bandwidth can support the concurrency.

Otherwise serialize. Optimize for safe completion and short feedback loops, not the number of
simultaneous sessions. Record every dependency that resists concurrency and its fallback.

For genuine concurrent work, the ownership manifest must name files, database objects, shared seams,
lease boundaries, stop conditions, and integration order. Check current active manifests before
assigning ownership.

## 6. Create phase and dispatch contracts

Each phase must state:

- objective and user-visible outcome;
- evidence baseline and dependencies;
- owned files/objects plus frozen or forbidden areas;
- implementation steps at the contract level;
- positive, negative, failure, rollback, and observability tests;
- authorization and external gates;
- canonical documents to update;
- reviewers selected by changed surface;
- actual close-out commands and verification layers;
- completion evidence and residual risk.

Cold-session dispatch blocks must be self-contained: objective, authority, required reading, scope,
acceptance criteria, ownership, tests, reviewers, stop conditions, and separately authorized actions.
They must not depend on this conversation, a particular model, or a particular orchestration tool.

## 7. Challenge the plan

Perform an independent challenge outcome before recommending adoption. When the runtime and task
authorization allow independent reviewers, use them for genuinely separable evidence or judgment;
otherwise run the same checks directly.

Challenge at least:

1. **Evidence refutation:** strongest reason every HAVE claim might be wrong.
2. **Simpler option:** whether a smaller change reaches the outcome.
3. **Ordering:** whether a proposed dependency is real or merely habitual.
4. **Ownership:** hidden file, RPC, table, flag, or reviewer overlap.
5. **Authorization:** UI-only gates, anonymous exposure, secret paths, or trusted-boundary gaps.
6. **Failure recovery:** timeout, duplicate event, partial apply, rollback, stale client, offline,
   resume, and provider outage.
7. **Operational truth:** migration, credential, deployment, device, and external gates represented
   honestly.

Record the strongest objections, the evidence used, and the resulting change or explicit rejection.

## 8. Present the decision before authoring

Present:

- recommended outcome and why;
- evidence ledger and unresolved UNKNOWNs;
- options considered and rejected;
- selected artifact tier and dependency graph;
- phases, ownership, gates, verification, rollback, and challenge findings;
- what is intentionally out of scope.

If only planning was requested, stop there. Repository plan authoring requires an implementation
request. A request to author planning files still does not authorize database apply, seed/status
mutation, feature activation, provider changes, commit, push, PR, deployment, outbound communication,
or money movement.

## 9. Author and close out only when requested

When repository planning artifacts are authorized:

- edit only the approved roadmap/dispatch/manifest/registry and required canonical documentation;
- preserve unrelated work and active leases;
- never invent live status or mark a phase complete without evidence;
- keep status writes and database-backed tracker seeds proposed unless separately authorized;
- run tooling/documentation checks and validate every referenced path;
- report the exact diff, verification, branch, working-tree state, and remaining gates.

Implementation sessions should use `new-feature`, `db-migration`, `new-crm-module`, or another
applicable dispatcher. Interface implementation uses `new-feature` with `upr-interface-craft` as a
supporting specialist. Publication and live actions remain separately authorized.
