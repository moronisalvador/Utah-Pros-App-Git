<!--
FILE: docs/contractor-compliance-dispatch.md

WHAT THIS DOES (plain language):
  Lets a fresh implementation session continue Contractor Compliance without relying on chat
  history. It names the exact authority, reading, order, tests, and stop conditions.

DEPENDS ON:
  Internal: docs/contractor-compliance-roadmap.md,
            .claude/rules/contractor-compliance-wave-ownership.md
  Data:     reads → repository files and tests
            writes → repository source and documentation only when the owner requested implementation

NOTES / GOTCHAS:
  - This dispatch never authorizes a live apply, deployment, send, import, commit, push, or PR.
-->

# Contractor Compliance Cold-Session Dispatch

## Objective

Build the production-quality, default-off Contractor Compliance MVP described in
`docs/contractor-compliance-roadmap.md`, preserving private W-9 handling, historical coverage,
role-redacted access, public token confinement, and automated-email idempotency.
The active owner extension also requires named insurance audit periods with reproducible roster/
evidence manifests plus an admin/office-only annual W-9 checklist and QuickBooks/Gusto handoff
metadata. UPR does not generate, store, send, or distribute 1099s.

## Authority

Repository planning and implementation are authorized. Do not apply SQL to any hosted database,
configure Storage/Cloudflare/provider state, send email/SMS, import real documents, deploy, commit,
push, or open a PR without a new owner instruction for that exact action.

## Required reading

Read completely before editing:

- `AGENTS.md`, `CLAUDE.md`, `docs/tooling-governance.md`;
- `tooling/skills/masterplan/SKILL.md`, `tooling/skills/new-feature/SKILL.md`,
  `tooling/skills/db-migration/SKILL.md`;
- `.claude/rules/initiative-status.md`,
  `.claude/rules/contractor-compliance-wave-ownership.md`;
- `.claude/rules/database-standard.md`, `.claude/rules/workers-standard.md`,
  `.claude/rules/sms-consent-model.md`, `.claude/rules/page-lifecycle.md`,
  `.claude/rules/loading-error-states.md`, `.claude/rules/perf-budget.md`,
  `.claude/rules/close-out-standard.md`, `.claude/rules/documentation-standard.md`;
- `UPR-Design-System.md`, `docs/architecture.md`, `docs/database-schema.md`,
  `docs/auth-and-authorization.md`, `docs/business-rules.md`, `docs/integrations.md`,
  `docs/testing-and-deployment.md`, `docs/database/staging-branch-runbook.md`;
- `docs/contractor-compliance-roadmap.md` and `docs/upr-unfinished-work-registry.md`.

Fetch `origin` first, require the current designated base, inspect `git status`, and preserve all
unrelated work.

## Frozen product contracts

- contractors are `contacts.role = 'subcontractor'`;
- required groups are current-year W-9, workers-comp certificate or Utah waiver, and general
  liability;
- status vocabulary is `ready`, `missing`, `needs_review`, `expiring`, `expired`, `gap`,
  `inactive`;
- current and audit-period readiness are distinct;
- active internal admin/office manage; active internal project manager sees readiness only;
- PM/field/denied roles never receive W-9 metadata or file access;
- uploads always create `pending_review`; acceptance is a separate human action;
- feature and reminders default OFF; the product is warning-only;
- email uses the automated-send boundary; SMS is out of scope;
- no manual compliance override in this MVP;
- no reuse of `vendors`, `vendor_invoices`, `document_requests`, `job-files`, or
  `message-attachments`.
- named audit periods preserve roster/coverage/gap/document-version evidence and never infer
  `paid_in_period`;
- W-9 checklist states are `valid`, `missing`, `needs_review`, `rejected`, and
  `stale_previous_year`;
- PM/field roles receive no W-9 checklist, provider external ID, handoff metadata, or tax files;
- QuickBooks/Gusto owns 1099 preparation, filing, and delivery; no amount, 1099 document,
  correction, recipient-access, or provider-send object is in scope.

## Execution order

1. **Rebaseline:** inspect current branch, active leases, exact callers, migration tail, and any
   newly landed contractor-compliance source. Stop if another writer owns a listed surface.
2. **Tests first:** add failing/static contracts for schema/grants/rollback, role redaction,
   readiness dates/alternatives, upload validation, token expiry/revocation/scope/rate limits,
   idempotent reminder claims, consent/DND/suppression, and route/nav coverage.
3. **Foundation migration:** use `supabase migration new contractor_compliance_foundation`; add the
   paired rollback, no direct browser table access, private bucket, default-off flag/nav permission,
   role-redacted read RPCs, service-only mutation/claim RPCs, indexes, and guarded isolated SQL
   behavior source. Do not apply.
4. **Internal Worker slice:** add purpose-built role-gated dashboard/detail helpers, internal
   upload, short-lived preview/download, review, note, request, pause/revoke, and sanitized audit
   behavior. Reuse shared auth/http/supabase/worker-runs modules.
5. **Public Worker slice:** add token lookup, enumeration-safe response, hashed rate bound,
   PDF/JPEG/PNG byte validation, random server-owned path, hash metadata, and `pending_review`
   insertion. No direct anonymous table or Storage access.
6. **Reminder slice:** add durable claim/result lifecycle, stable provider idempotency, default-off
   scheduled/HTTP entry, and email copy through `sendAutomatedMessage('email', ...)`. Stop on
   ambiguous provider outcomes; never add SMS.
7. **UI slice:** add the lazy web-only routes, fail-closed feature/role/page access, navigation,
   React Query dashboard/detail/public upload pages, Main/Shared primitives, route-lazy stylesheet
   if needed for the CSS budget, and mobile/error/lifecycle behavior.
8. **Annual audit slice:** add named periods, sourced/nullable roster facts, materialized WC/GL
   coverage-gap evidence, role-redacted manifest RPC, and a cohesive audit checklist/export surface.
9. **W-9 handoff slice:** add the derived tax-year checklist, admin/office-only provider external
   IDs and handoff metadata, secure CSV export, and static negative-scope/security contracts.
10. **Documentation and close-out:** update every canonical document and `UPR-Web-Context.md`, run
   the required command/reviewer matrix, and report repository versus live evidence separately.

## Owned surfaces

Use the ownership manifest. Shared seams (`src/App.jsx`, navigation registries,
`functions/lib/automated-send.js`, `functions/lib/supabase.js`, canonical docs) receive only narrow,
contract-preserving edits. Do not modify unrelated initiative migrations or generated reports.

## Required positive and negative proof

- correct admin/office/PM dashboard projections;
- field, external, inactive, unmapped, and wrong-role denial;
- PM W-9 metadata/download denial before Storage signing;
- one contractor row per dashboard item with correct KPI totals and pagination;
- current/audit readiness for gaps, expirations, alternative workers-comp evidence, and annual W-9;
- duplicate upload preserves versions and does not auto-accept;
- invalid magic bytes, mismatched MIME, oversize, traversal, foreign document/request, expired,
  revoked, paused, exhausted, and wrong-type token denial;
- stable request/stage retry returns the prior send result or a safe in-progress/ambiguous state;
- suppression or DND reaches no provider;
- accepted coverage cancels future reminder claims;
- public responses/logs omit contractor list data, token digest, storage path, W-9 details, and raw
  provider errors;
- cold loading, stale-data error, empty success, mutation feedback, resume, back/scroll, and 390px
  UI behavior.

## Required reviewers

- `migration-safety-checker` and `anon-grant-auditor`;
- `worker-security-reviewer`;
- `consent-path-auditor`;
- `upr-pattern-checker`, `design-consistency-checker`, and `page-behavior-checker`.

All findings are blocking at the severity defined by project law. Fix or report them; never waive
them silently.

## Stop conditions

Stop and surface the evidence if:

- the live/repository contact or employee contract differs from the migration assumptions;
- a new active lease overlaps an owned surface;
- a public/anonymous grant is required;
- role-redacted detail cannot exclude W-9 metadata at the server boundary;
- the email path cannot reserve a stable provider identity before sending;
- a schema/provider failure would cause a blind retry;
- the feature cannot remain inert when the flag/binding/schema is absent;
- implementing the next step requires live SQL, deployment, provider, import, publication, or
  another separately gated action.

## Close-out commands

At minimum:

```text
npm run build
npm test
npx eslint <changed JS/JSX files>
node scripts/check-migration-hygiene.mjs
npm run report:bundle-size -- --strict
git diff --check
```

Also run focused Worker/QA/SQL-source tests, browser checks when supported, and the reviewer matrix
above. A skipped hosted database, deployed browser, provider, or device check is an explicit gate,
not a pass.
