/**
 * ════════════════════════════════════════════════
 * FILE: mobile-production-readiness-wave-ownership.md
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sets the collaboration rules for the mobile production-readiness program. It prevents two
 *   sessions or agents from changing the same sensitive area without a named owner.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  docs/mobile-production-readiness-roadmap.md, tooling/capabilities.json,
 *              CLAUDE.md, AGENTS.md
 *   Data:      reads  → documentation only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Agent names describe bounded roles; they do not grant production permissions.
 *   - The primary session remains accountable for every delegated conclusion and edit.
 * ════════════════════════════════════════════════
 */

# Mobile Production Readiness — Wave Ownership

**Status:** active and binding for `UPRF-MOB-001`
**Last verified:** 2026-07-26

## Team shape

Use one GPT-5.6 Sol Ultra primary orchestrator and no more than three simultaneous subagents. The
primary owns scope, decisions, integration, tests, documentation, Git state, and the final report.
Subagents receive concrete bounded tasks and never become unsupervised writers by implication.

The project provides four reusable roles from neutral sources in `tooling/`, with generated Claude
Code and Codex adapters:

| Role | Risk / default mode | Purpose |
|---|---|---|
| `mobile-readiness-mapper` | green / read-only | Trace routes, callers, contracts, migrations, workers, policies, and documentation before edits. |
| `mobile-readiness-security-reviewer` | green / read-only | Challenge authentication, authorization, Storage, privacy, compliance, and secret boundaries. |
| `mobile-readiness-contract-tester` | amber / workspace-write | Design/run negative, failure, compatibility, and regression checks; writes are limited to bounded local caches/artifacts, never tracked source. |
| `mobile-readiness-release-auditor` | green / read-only | Verify evidence, release gates, device claims, rollback, and honest limitations. |

The primary is the only default source writer. The contract tester's workspace access does not grant
source ownership. If a session needs more than one source writer, it must divide work into disjoint
file sets and record the ownership table before editing.

## Parallelism rules

Safe parallel work:

- independent source/caller inventories in different domains;
- read-only production/configuration inspection coordinated through one named lead;
- test-plan creation and independent adversarial review;
- documentation consistency, accessibility, or release-evidence review;
- running non-mutating test lanes that do not share ports, simulators, or generated output.

Serialized work:

- any migration, RLS, RPC, grant, Storage policy, or shared Supabase decision;
- `src/App.jsx`, `src/contexts/AuthContext.jsx`, `src/lib/supabase.js`, `src/lib/realtime.js`;
- shared authentication/HTTP/Supabase worker libraries;
- offline queue, query-cache identity, logout, and durable device state;
- `ios/App/App.xcodeproj/project.pbxproj`, signing, entitlements, privacy manifest, or CocoaPods;
- service worker, release identity, OTA, deployment configuration, or GitHub release gates;
- global stylesheet, shared mobile layouts/design primitives, canonical docs, and registries.

Only one agent may run a live-state discovery sweep for the same system at a time. Other agents use
the captured sanitized evidence to avoid duplicate broad access and inconsistent snapshots.

## Required ownership declaration

Before parallel edits, add this table to the session commentary or working note:

| Owner | Mode | Files/systems | Deliverable | Must not touch |
|---|---|---|---|---|
| Primary | writer | exact paths | integrated change | all undeclared hotspots |
| Agent 1 | read-only or named writer | exact paths/systems | bounded report/change | other owners' paths |
| Agent 2 | read-only or named writer | exact paths/systems | bounded report/change | other owners' paths |
| Agent 3 | read-only or named writer | exact paths/systems | bounded report/change | other owners' paths |

If two tasks converge on the same file or contract, stop one writer, integrate the first result, and
reassign the second as a reviewer. Never resolve shared-worktree overlap with reset, checkout, or
deletion of another agent's changes.

## Production and external authority

All roles are read-only for Supabase, Cloudflare, production, provider consoles, customer data,
Apple signing, TestFlight, and App Store state unless the user separately authorizes the exact
action. Source authorization does not imply live authorization.

These actions always remain owner gates:

- live migration/policy/RPC/Storage apply and rollback;
- deployment, promotion, merge, branch protection, and secret changes;
- Twilio/Resend/push/provider sends or money-related calls;
- viewing real customer object contents or using real customer identities;
- signing, certificate/profile work, archive distribution, TestFlight, and App Store submission;
- legal/product decisions about native scope, offline promise, retention, privacy, deletion, or
  acceptance of residual risk.

## Subprocess and shared-resource ownership

The agent starting a server, browser, simulator, Xcode build, or other child process owns cleanup.
Use a five-minute maximum per subprocess unless a human explicitly approves a different bound.
Cleanup must run in `finally`, terminate the full owned child tree, verify the port/process is gone,
and avoid touching unrelated processes. Simulator availability, signing absence, missing accounts,
unavailable devices, and authentication gaps are limitations to record—not permission to invent
evidence.

## Session close-out

The primary reconciles every agent report against the real files, runs the integrated checks, and
records:

- exact base and result SHAs;
- changed files and declared ownership;
- tests/builds actually run and their results;
- read-only live evidence date and scope, if any;
- processes/simulators created and cleanup result;
- open product, production, signing, device, credential, and owner gates;
- commit/branch/working-tree state and a ready next-session handoff.

An agent report is supporting evidence. It is not closure until the primary verifies and integrates
it.
