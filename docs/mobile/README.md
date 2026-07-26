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
- The PWA requires network for reliable cold start. Warm cached reads and selected queued mutations
  exist, but the product is not generally offline-capable.
- The checked-in Capacitor iOS project is a pre-release integration track until its security,
  privacy, push, deep-link, OTA, archive, and device gates are closed.
- No Android Capacitor project is checked in. Android PWA support and Android native support are
  separate decisions.
- Admin-mobile routes exist inside the shared/native route graph. Their inclusion is a product
  decision and does not relax database/worker authorization.

## Documentation maintenance

Update the relevant mobile document in the same commit when changing a durable mobile boundary.
Also update the higher-level canonical file under `docs/` when architecture, authorization,
database, integrations, testing, deployment, or business rules change. Regenerate generated reports
through their scripts; do not hand-edit them.
