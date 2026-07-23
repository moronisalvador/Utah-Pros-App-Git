
# July 2026 Repository Audit — Executive Summary

Audit date: 2026-07-22
Evidence commit: `0a7c61c` (`dev`)
Auditor: Codex
Scope: repository evidence plus read-only live Supabase metadata; no application/database source or
live state was changed

## Bottom line

UPR is a substantial, working internal restoration-business platform rather than a prototype. It has a coherent React/Cloudflare/Supabase architecture, unusually strong domain documentation, migration-based database change history, broad unit/integration-style test coverage, native iOS packaging, and explicit rules for money, messaging consent, authentication, database changes, and release flow.

I believe I can reproduce and improve the code quality of this repository, but I cannot honestly
claim equal or better *compliance* yet. Read-only inspection resolved much of the Supabase evidence
gap and found two Critical boundaries: authenticated users can invoke a privileged arbitrary-read
SQL RPC, and anonymous policies allow unrestricted reads/writes on operational/customer/CRM tables.
The project also has confirmed money-path authorization/consistency gaps, a public form RPC that
bypasses consent/anti-abuse controls, and database migrations applied ahead of `dev`. Cloudflare,
provider, legal/operational and representative-account evidence remains external.

## Evidence boundary

This is not a claim of complete semantic inspection of every file or routine. The repository audit
universe contains 1,776 relevant files after exclusions; all were inventoried and mechanically
scanned where applicable, while only a risk-selected subset was read end-to-end. Live Supabase
metadata was broadly enumerated, but business rows, secrets, raw logs and most routine bodies were
not read. Exact repository/database coverage and exclusions are in the
[coverage ledger](coverage-ledger.md) and [live evidence](evidence/live-supabase.md).

The following checks were run at `0a7c61c`:

- `npm run build`: passed; Vite 8.0.1 transformed 656 modules.
- Application-focused ESLint (`src`, `functions`, `supabase`, `upr-mcp`, `vite.config.js`): failed with 256 problems — 133 errors and 123 warnings.
- Full repository ESLint excluding only nested worktrees: failed with 731 problems — 608 errors and 123 warnings; this included committed assistant tooling and local generated Wrangler output, so it is not treated as the application defect count.
- `npm audit --omit=dev`: reported 14 production-dependency advisories — 1 critical, 8 high, 5 moderate. Advisory presence is confirmed; runtime exploitability is not.

Database integration tests were not re-run because the repository states that `dev` and production share one Supabase project and the tests can create or change live records. A previous audit run demonstrated environment/fixture failures, but it was on an earlier commit and is not represented as current-head test truth.

Read-only Supabase inspection found 130 public tables (all RLS-enabled), 225 policies, 366 public
functions, 375 applied migrations, two Storage buckets, ten active cron jobs, two deployed Edge
Functions and 513 security/214 performance advisor notices. No business-row contents or secrets
were copied into the audit.

## Highest-priority confirmed findings

| ID | Severity | Summary | Primary workflow |
|---|---|---|---|
| DB-003 | Critical | Any authenticated user can execute arbitrary privileged read SQL as the `postgres` function owner | Entire database confidentiality boundary |
| DB-004 | Critical | Anonymous always-true policies permit customer/operations/CRM reads and mutations without login | Public PostgREST data boundary |
| AUTH-001 | High | `/api/qbo-charge` verifies a session but does not enforce admin/manager role before moving money | Keyed card charge |
| AUTH-002 | High | `/api/stripe-pay-link` verifies a session but does not enforce its documented admin/manager gate | Invoice payment links |
| COR-002 | High | A successful external card charge can be followed by a failed local payment insert, leaving money moved but no UPR payment record | Keyed card charge/reconciliation |
| DB-002 | High | Live policy/grant/RPC evidence confirms broadly permissive authenticated access | All authenticated data access / future multi-tenancy |
| DB-005 | High | Four live migrations were applied from a feature branch not merged into audited `dev` | Database reproducibility and release promotion |
| AUTH-004 | High | Public form RPC bypasses Worker anti-abuse/schema/consent-evidence controls | Forms, CRM lead creation and SMS consent |
| SEC-004 | High | Public `job-files` policies allow anonymous listing of all stored objects | Job documents/photos |
| SEC-005 | High | Untracked live `sheets-proxy` accepts unauthenticated wildcard-CORS requests | Google Apps Script / spreadsheet integration |
| SEC-001 | High | Current production dependency graph has 14 advisories, including a critical `tar` chain and high direct-package chains | Build/native tooling and web runtime |
| TEST-002 | High | CI does not provide database credentials to `npm test`; many schema-contract suites explicitly self-skip | Migration and RLS regression detection |

## Important medium-risk themes

- Feature-flag loading deliberately fails open, exposing rollout-hidden routes after an RPC failure; flags must not be treated as authorization.
- The QBO card charge records `payment_date` using UTC despite the repository’s Denver-day rule.
- The shared Worker Supabase client has no request timeout even though the repository standard requires bounded outbound calls.
- Repository-managed response headers do not establish a general security-header baseline; actual production headers require a deployed-response check.
- The production origin is not in the static CORS allowlist and depends on an external `PAGES_URL` value.
- The build has a 411.70 kB global CSS asset and 339.01 kB main JS asset; the CI bundle signal is non-blocking and has no enforced threshold.
- Client render errors are console-only; no repository-bundled error-reporting integration is present.
- Account deletion is a request/notification flow. The repository does not contain a discoverable admin fulfillment screen or processor, so actual fulfillment depends on an external/manual process.
- Accessibility has useful spot evidence (semantic buttons, labels, dialogs), but no automated or manual conformance evidence sufficient to claim WCAG compliance.

## Strengths worth preserving

- Domain rules are explicit and unusually detailed: billing computation ownership, CRM lead definitions, QBO identity/deduplication, TCPA opt-in and quiet-hour gates, and Denver time conventions.
- Authentication has a centralized server helper with `requireUser`, `requireEmployee`, and `requireRole`; the two endpoint findings are adoption gaps, not missing infrastructure.
- The front end is route-split and uses error boundaries, React Query persistence, native-aware routing, and authenticated Supabase clients.
- Database changes are additive-first, documented with rollback expectations, and backed by many migration contract tests.
- All 130 public tables have RLS enabled, every public table has a primary key, all 419 indexes were
  valid/ready, and all five reporting views use security-invoker semantics.
- Messaging automation has a global kill switch, consent gate, DND gate, quiet-hour deferral, provider retry classification, and audit logging.
- Nine established cron jobs had zero non-success statuses in the 30-day live ledger, and retained
  `pg_net` results showed no 4xx/5xx or timeout.
- CI builds and tests both staging and production branches and documents the branch-protection dependency.

## Factual findings versus architectural opinions

Factual findings describe observable repository/live-catalog behavior and use confidence labels.
Examples: role checks are absent at two endpoints; a live grant allows authenticated execution of
`exec_read_sql`; anonymous always-true policies exist; feature flags fail open; a build succeeds;
lint fails.

Architectural opinions are explicitly labeled in the canonical [architecture document](../../architecture.md). They include the judgment that one shared database creates an avoidable blast radius, that 10k-line modules increase change risk, and that compliance evidence should be promoted to a repeatable release artifact. These are recommendations, not statements that the existing system is broken.

## Conclusions requiring external access

The audit cannot resolve these without evidence outside the checkout:

- Supabase raw access/Auth/Storage/API logs, backup/PITR and network-restriction settings, full Auth
  policy configuration, representative-role behavior and whether identified public boundaries were
  exploited.
- Production and Preview Cloudflare variables/secrets, route bindings, security headers, CORS behavior, Worker logs, rate limits, and deployment parity.
- QuickBooks, Intuit Payments, Stripe, Twilio, Resend, CallRail, Google, Meta, Encircle, Property Meld, Capgo, and Apple configuration or sandbox behavior.
- GitHub branch-protection settings and current hosted check history.
- Real account role matrices, field-tech workflows, data-retention operations, deletion-request fulfillment, incident response, and test-account behavior.
- Apple Developer/App Store Connect state, privacy answers, review notes, screenshots, and reviewer credentials.
- Legal conclusions under TCPA, privacy law, PCI scope, record-retention law, employment law, or WCAG/ADA. Counsel and operational evidence are required.

## Recommended release posture

Do not block low-risk documentation/UI work, but contain DB-003 immediately and close the
highest-risk DB-004 anonymous reads/writes before expanding production functionality. Then harden
AUTH-001, AUTH-002 and COR-002 as one money-path change; reconcile DB-005; and establish an isolated
Supabase test target before broad RLS/RPC remediation. Treat headers/CORS, deletion, accessibility,
telemetry and legal compliance as evidence work rather than assumptions.

The prioritized sequence, effort, and dependencies are in the [remediation backlog](remediation-backlog.md).
