<!--
FILE: docs/mobile/README.md

WHAT THIS DOES (plain language):
  Indexes the current canonical documentation for the UPR field-mobile PWA and Capacitor surfaces.
  It separates durable project knowledge from dated audit evidence and proposed future standards.

DEPENDS ON:
  Internal: AGENTS.md, CLAUDE.md, docs/architecture.md, docs/auth-and-authorization.md,
            docs/testing-and-deployment.md, docs/audit/mobile-pwa/
  Data:     reads → documentation only
            writes → documentation only

NOTES / GOTCHAS:
  - Dated audit findings describe their captured source/live-evidence boundary, not current truth.
  - UI visibility and feature flags are never substitutes for server/database authorization.
-->

# Mobile Documentation

## Purpose and authority

These documents are the canonical entry point for changes to UPR's field-mobile experience. They
describe the current supported architecture and boundaries evidenced at the repository. Proposed
standards and unresolved product decisions are labeled as such.

Authority order remains:

1. current user instruction;
2. root `CLAUDE.md`, `AGENTS.md`, and applicable `.claude/rules/`;
3. active initiative/ownership documents;
4. canonical `docs/*.md`, this mobile set, and `UPR-Web-Context.md`;
5. focused handoffs and dated evidence;
6. historical audits/plans.

The July 2026 production-readiness snapshot lives at
[`../audit/mobile-pwa/00-executive-summary.md`](../audit/mobile-pwa/00-executive-summary.md). Its
findings do not silently become current after code/live state changes; refresh evidence and create
an addendum or new audit.

## Document index

| Document | Authority |
|---|---|
| [`architecture.md`](architecture.md) | Current mobile entry points, routing, layout, state, data access, shared/mobile/native boundaries |
| [`design-system.md`](design-system.md) | Current implemented mobile visual/interaction conventions and explicitly proposed consolidation |
| [`motion-system.md`](motion-system.md) | Existing motion foundations plus proposed standardization and required reduced-motion behavior |
| [`data-contracts.md`](data-contracts.md) | Workflow-to-RPC/table/Storage/worker contracts, authorization and mutation guarantees |
| [`pwa-and-capacitor.md`](pwa-and-capacitor.md) | PWA/SW/install/offline/update and Capacitor/plugins/permissions/deep-link/release boundaries |
| [`testing-and-release.md`](testing-and-release.md) | Required safe validation, browser/device matrices, database compatibility, promotion and rollback evidence |
| [`s1h-database-apply-runbook.md`](s1h-database-apply-runbook.md) | Source-only S1h dependency order, exact qualification requirements, and separately authorized database window |

## Required reading before mobile changes

Always read:

- root `CLAUDE.md` and `AGENTS.md`;
- `.claude/rules/tech-mobile-ux.md`, `motion-standard.md`, `perf-budget.md`,
  `page-lifecycle.md`, `loading-error-states.md`, and `close-out-standard.md` as applicable;
- this index plus the domain document(s) affected;
- `docs/architecture.md`, `docs/auth-and-authorization.md`, and
  `docs/testing-and-deployment.md` for cross-layer changes;
- `UPR-Design-System.md` and active tech redesign/ownership manifests for UI;
- `UPR-Web-Context.md` for callers/schema/history;
- `.claude/rules/database-standard.md`, `docs/database-schema.md`, and the latest dated live evidence
  for database/RPC/RLS/Storage work.

When touching a Pages Function, also read `.claude/rules/workers-standard.md`. When touching a
shared provider, money, signing, messaging, public form, or Storage boundary, follow its focused
canonical/initiative documentation.

## Current product statement

- The browser/PWA and iOS Capacitor builds share React field routes and the same Supabase/business
  services.
- The PWA requires network for reliable cold start and every field write. Warm cached reads exist,
  but the product is not generally offline-capable.
- Account-owned PWA state is keyed by an opaque owner plus login epoch. Query, route, offline
  queue/blob, and Push cleanup now fail closed during account changes. The initial release admits
  and replays zero automatic offline commands: photo, reading, equipment placement/removal, and
  every other field write require connectivity. IndexedDB v3 is retained only for count-only
  quarantine and explicit cleanup of historical local state, bounded actionable open/version-
  change recovery, and bounded owner-scoped completed-photo maintenance. Focused zero-replay tests
  and the broader unit/QA/build lanes pass; independent review found no actionable P0/P1. Installed
  browser/device proof, current-origin integration, and the separate live RPC authorization gate
  remain.
- Web Push/APNs detach attempts use opaque owner-bound durable journals, so crash/reload does not
  silently transfer cleanup to a different account. Rejected bootstrap now exposes Login only
  after device cleanup and strictly verified local Supabase sign-out; profile, navigation,
  page-access, and feature-flag responses are schema-validated; and password recovery reaches
  SetPassword only after cleanup without signing out the recovery session. The Supabase Auth
  observer now returns synchronously and serializes work on the next macrotask, eliminating the
  observer/sign-out lock cycle. Independent source review is clean; browser/device proof remains.
- The native build graph is field-only. Office, CRM, billing/QBO, desktop settings, and
  admin-mobile implementation modules are denied by a build-time graph guard. Public login,
  recovery, legal/support, and both `/sign/:token` and `/s/:code` remain available.
- The checked-in Capacitor iOS source now contains a native privacy shield, sign-in-time biometric
  verification, an allowlisted App/Universal-Link and Push-action bridge, public legal/account
  deletion access, and an exact 12-type privacy declaration, including Other Financial Info for
  retained OOP quote/pricing data. Retained authenticated sessions reopen without a biometric
  challenge. Native Push enrollment and OTA remain exact-default-off.
- Those source controls are not a release claim. S1h database source is unapplied and not exact
  database-behavior-verified; `@capacitor/app` is present in the reviewed clean iOS sync and
  `ios/Gemfile.lock` is checked in. Deployment/provider/distribution-signing/TestFlight and the
  complete physical-device matrix remain separate.
- No Android Capacitor project is checked in. Android PWA support and Android native support are
  separate decisions.

## Documentation maintenance

Update the relevant mobile document in the same commit when changing a durable mobile boundary.
Also update the higher-level canonical file under `docs/` when architecture, authorization,
database, integrations, testing, deployment, or business rules change. Regenerate generated reports
through their scripts; do not hand-edit them.
