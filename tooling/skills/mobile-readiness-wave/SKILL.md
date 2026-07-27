---
name: mobile-readiness-wave
description: Run one bounded UPR Mobile PWA/Capacitor production-readiness wave from orientation through verified handoff. Use for any implementation, review, validation, planning, or release-preparation task tied to MOB-* audit findings, docs/mobile/* contracts, offline/device state, PWA install/update, Capacitor/iOS, mobile authorization/Storage, or the UPRF-MOB-001 roadmap.
---

# Mobile Readiness Wave

## Overview

Execute exactly one coherent mobile-readiness outcome while preserving UPR's authorization,
production, documentation, device-evidence, and Git boundaries. Use
`docs/mobile-production-readiness-roadmap.md` for sequence and
`docs/mobile-production-readiness-wave-ownership.md` for collaboration.

## 1. Establish authority and a clean boundary

Before proposing or editing:

1. Read `AGENTS.md` and `CLAUDE.md` completely.
2. Read applicable `.claude/rules/`, the two program documents above, relevant `docs/mobile/*`,
   affected audit findings/backlog, and the core canonical docs routed by `AGENTS.md`.
3. For database, authorization, public-form, signing, or Storage work, read the latest
   `docs/audit/2026-07/evidence/live-supabase.md`; recapture only the minimum live state needed and
   only read-only when current state matters.
4. Record branch, base SHA, `origin/dev` SHA, working-tree state, audit source SHA, and any drift.
   Never treat the dated audit as current `dev`.
5. Use an isolated worktree. Preserve unrelated changes and obey active ownership manifests.

If the requested outcome crosses unrelated findings or more than one production boundary, split it
into successive sessions and finish the current bounded slice.

## 2. Map the complete contract before editing

Trace every affected route and caller across:

- React routes/components/hooks and durable browser/native state;
- direct queries, RPC names/signatures, Realtime, Storage, and generated/client contracts;
- Cloudflare workers plus shared auth/http/Supabase/worker-run helpers;
- migrations, SQL functions, triggers, grants, policies, object policies, and rollback;
- Capacitor plugins, iOS target membership/entitlements/privacy/signing/release paths;
- tests, feature flags, observability, deployment/release compatibility, and canonical docs.

Do not infer authorization from UI gates, database behavior from TypeScript types, or external state
from repository declarations. Preserve deployed request/response and RPC contracts unless the
session explicitly includes a reviewed compatibility transition.

## 3. Declare ownership and delegate bounded reviews

Use one primary and at most three simultaneous subagents. Before parallel work, publish the ownership
table required by the program manifest. The primary is the default and integrating writer.

- `mobile-readiness-mapper`: read-only caller and contract inventory.
- `mobile-readiness-security-reviewer`: independent authorization/Storage/privacy/compliance review.
- `mobile-readiness-contract-tester`: negative, failure, replay, compatibility, and regression proof.
- `mobile-readiness-release-auditor`: close-out evidence and release/device gate audit.

Parallelize read-only investigation. Serialize shared hotspots, Supabase/live discovery, native
project/signing files, release configuration, global styles, and canonical documentation. Give a
subagent write access only through an exact, disjoint file assignment.

## 4. Preserve external and production gates

Without a separate explicit owner instruction, do not:

- apply a shared Supabase migration/policy/RPC/Storage change;
- deploy, promote, merge, change secrets/configuration, or modify branch protections;
- invoke money or provider side effects, send email/SMS/push, or create live business records;
- inspect real customer rows/object contents or use real customer identities;
- modify Apple credentials/profiles, sign/distribute, use TestFlight, or submit to App Store Connect.

It is valid to author locally tested migration/source/release changes with an explicit rollout,
rollback, and later live-apply handoff. Never conflate a local test with production verification.

## 5. Implement the smallest safe slice

Before editing, state the exact files/contracts and verification. Then:

1. Reuse established components, helpers, query keys, invalidation, auth, error, and release patterns.
2. Enforce sensitive authorization inside the trusted worker/database boundary.
3. Add explicit `REVOKE`/least-privilege `GRANT`, caller contract, rollback, and negative tests for
   every affected SQL boundary.
4. Add account-switch/logout/expiry, duplicate/replay/lost-response, partial-failure, offline/resume,
   and recovery tests where the slice touches durable state or multi-step work.
5. Add compliance matrices for messaging and signed-device lifecycle matrices for native work.
6. Update the relevant canonical docs and unfinished-work registry in the same coherent change.

## 6. Run bounded verification

Use risk-proportional targeted checks plus the repository close-out commands when applicable.
For any server, browser, simulator, Xcode, or other persistent subprocess:

- enforce a five-minute maximum;
- create and terminate owned children in `try/finally`;
- terminate the entire owned child tree, not unrelated processes;
- verify the port/process is gone and record cleanup;
- never infer authenticated, physical-device, signing, push, OTA, or release proof from a build.

Record actual command, result, SHA, environment, device/runtime, and limitations. A missing identity,
device, signing team, profile, provider account, or compatible simulator is an open gate.

## 7. Close out for the next session

The final handoff must include:

- completed bounded outcome and findings changed;
- base/result SHA, branch, commits, and working-tree state;
- exact changed files and ownership;
- actual build/test/lint/device evidence;
- live read-only evidence scope/date, if used;
- unresolved decisions and production/provider/device/signing gates;
- reviewed rollout/rollback/apply sequence where relevant;
- a ready-to-use prompt for the next single coherent session.

Do not mark a finding closed solely because code was written. Closure requires the roadmap's stated
evidence or an explicit documented exclusion/acceptance decision.
