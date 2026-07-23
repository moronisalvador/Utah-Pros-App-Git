
# July 2026 Coverage Ledger

## Coverage claim

This audit does **not** claim full repository semantic coverage.

At commit `0a7c61c`, the relevant audit universe was 1,776 files after excluding dependencies, build output, Git internals, nested worktrees and local generated state. Of those, 1,184 files were inspected by at least one content-aware method (build import/parse, ESLint parse, Vitest/static contract discovery, SQL/text pattern scan, JSON parse or manual reading). Many files were only mechanically inspected, so every product group except `.github/` is marked **partially inspected**.

“Discovered” means enumerated by hidden-inclusive file census. “Inspected” means content was parsed/scanned or manually opened; filename inventory alone does not qualify. “Fully inspected” means the entire group was read/reviewed at the level appropriate to the audit—not merely parsed. A group can have discovered=inspected but still be partial because mechanical parsing is not semantic review.

## Relevant file-group ledger

| Directory / file group | Discovered | Inspected | Status | Reason / limitation |
|---|---:|---:|---|---|
| `.claude/agents/` | 32 | 0 | Excluded | Assistant orchestration prompts; not application runtime or governing standards. File names counted only. |
| `.claude/other` (commands/hooks/settings) | 6 | 2 | Partially inspected | Secret/repository hooks were spot-checked; assistant configuration is not product behavior. |
| `.claude/rules/` | 20 | 20 | Partially inspected | All inventoried/scanned; database, Worker and documentation standards read fully, other domain rules referenced selectively. |
| `.claude/skills/` | 555 | 0 | Excluded | Repository-local assistant/tool assets, including large third-party scripts; product audit relies on application code and governing rules. |
| `.github/` | 4 | 4 | Fully inspected | CI, Capgo, iOS release workflows and PR template reviewed. External branch protection and hosted runs remain outside repo. |
| `.impeccable/` | 1 | 0 | Excluded | Design-tool configuration; no direct runtime/compliance behavior. |
| `db/` | 2 | 2 | Partially inspected | Baseline JSON metadata parsed and compared; live catalog not available and large inventories were not semantically validated object-by-object. |
| `docs/` | 73 | 73 | Partially inspected | Text search/inventory across all; risk-selected roadmaps, generated DB reports, app-store and domain contracts read deeply. Historical claims were not all independently validated. |
| `functions/api/` | 104 | 104 | Partially inspected | All parsed by focused ESLint and scanned for auth/provider/date/timeout patterns; money and representative integration endpoints read deeply. Not every endpoint was traced end-to-end. |
| `functions/lib/` | 55 | 55 | Partially inspected | All parsed/scanned; auth, HTTP, Supabase, consent and selected provider/telemetry libraries read deeply. Not every provider branch was semantically traced. |
| Other `functions/` | 1 | 1 | Partially inspected | Public form route inspected for public/CSP behavior; no deployed browser/provider test. |
| `ios/` | 25 | 25 | Partially inspected | Static inventory/text scan and release metadata review; no Xcode compile, signing, simulator, device or accessibility run. |
| `public/` | 13 | 13 | Partially inspected | Build copied assets; headers/manifest/service-worker/reset behavior spot-reviewed. Images/icons were not visually certified. |
| Root/configuration and root domain docs | 38 | 38 | Partially inspected | Governing/build/package/billing/QBO files read or scanned. Historical handoffs/plans were not all validated against runtime. |
| `scripts/` | 20 | 20 | Partially inspected | Static/security pattern scan and purpose inventory; database maintenance scripts were not executed against live Supabase. |
| `src/components/` | 201 | 201 | Partially inspected | All parsed by build/ESLint; security/accessibility/error and high-risk components spot-reviewed. No exhaustive interaction/visual review. |
| `src/contexts/` | 4 | 4 | Partially inspected | All parsed; AuthContext reviewed deeply. Remaining contexts were not exhaustively behavior-tested. |
| `src/lib/` | 76 | 76 | Partially inspected | All parsed/test-discovered; Supabase, realtime/native/business helpers spot-reviewed. Not every helper/test read line-by-line. |
| Other `src/` | 76 | 76 | Partially inspected | App shell, bootstrap, CSS/translations/tests parsed; route architecture and global CSS reviewed. Translations and all selectors not semantically audited. |
| `src/pages/crm/` | 20 | 20 | Partially inspected | All built/linted; lifecycle-critical screens and helpers searched/reviewed. No complete CRM UI or real-account run. |
| Other `src/pages/` | 55 | 55 | Partially inspected | All built/linted; billing, scheduling, settings, legal, deletion and analytics risk areas spot-reviewed. No exhaustive route walkthrough. |
| `src/pages/tech/` | 89 | 89 | Partially inspected | All built/linted; architecture/large-file/accessibility patterns scanned. No device, field-tech account, camera/geolocation/offline run. |
| `supabase/migrations/` | 207 | 207 | Partially inspected | All SQL inventoried and pattern-scanned; selected security/billing/CRM/deletion migrations read deeply. Migrations were not applied or compared object-by-object with live schema. |
| Other `supabase/` | 1 | 1 | Partially inspected | Configuration/support file inventoried/scanned; live project settings absent. |
| `supabase/tests/` | 72 | 72 | Partially inspected | All parsed by ESLint and scanned for credential/skip behavior; not executed at current commit due shared production DB risk. |
| `upr-mcp/` | 26 | 26 | Partially inspected | Parsed/linted, package/README/index structure reviewed; full MCP behavior and GitHub integration not exercised. |
| **Total relevant audit universe** | **1,776** | **1,184** | **Partially inspected** | Broad mechanical coverage plus risk-selected semantic review; not full repository coverage. |

## Excluded filesystem groups outside the audit universe

| Excluded group | Discovered count | Inspected count | Status | Reason for exclusion |
|---|---:|---:|---|---|
| `node_modules/` | 14,867 | 0 | Excluded | Installed third-party dependencies; lockfile and `npm audit` are the evidence surface. |
| `dist/` | 200 | Build manifest only | Excluded | Generated by the current audit build; artifact sizes recorded, generated contents not source-reviewed. |
| `.git/` | 1,050 | 0 | Excluded | Version-control internals; commit/status metadata inspected through Git commands, not object files. |
| `.claude/worktrees/` | 7,802 | 0 at current head | Excluded | Duplicated/stale nested checkouts, not the audited `0a7c61c` tree. Their presence is considered in TEST-003. |
| `.wrangler/` | 12 | 0 | Excluded | Generated local Worker bundle/temp state; it contaminated full-root lint and is addressed by MAINT-003. |
| `.env.local` | 1 | 0 | Excluded | Local secret-bearing configuration. Existence counted; contents deliberately not read or reproduced. |

Counts are point-in-time and `dist/` reflects the audit’s successful build.

## Live Supabase coverage addendum

Read-only live inspection ran on 2026-07-22 MDT. “Inspected” below means metadata was enumerated
through the management/catalog interface; it does not imply business rows or every object body were
read. Exact sanitized evidence is in `evidence/live-supabase.md`.

| Live object group | Discovered | Inspected | Status | Reason / limitation |
|---|---:|---:|---|---|
| Connected Supabase projects | 2 | 2 identities; 1 target | Partially inspected | Both project identities/statuses listed; only repo project `glsmljpabrwonfiltiqm` queried. `XactimaPro` excluded as unrelated. |
| Non-system schemas | 11 | 11 | Fully inspected (metadata) | Object-type counts captured for every discovered non-system schema; managed system internals not semantically audited. |
| `public` tables | 130 | 130 | Fully inspected (catalog), partially semantic | Name, RLS, size/row estimates, columns and object relationships enumerated; business row contents and every invariant were not read. |
| `public` columns | 1,689 | 1,689 | Fully inspected (metadata) | Type/null/default catalog scanned in aggregate; sensitive values excluded. |
| Public PK/FK/unique/check constraints | 499 | 499 | Fully inspected (metadata) | 130 PK, 247 FK, 52 unique and 70 checks enumerated/count-validated; only risk-selected semantics traced to callers. |
| Public indexes | 419 | 419 | Fully inspected (metadata) | Validity/readiness and advisor usage captured; no index was changed and point-in-time “unused” status was not treated as removal proof. |
| Public RLS policies | 225 | 225 | Fully inspected (definitions) | Roles, commands, `USING` and `WITH CHECK` captured/classified; behavior was not exercised with real representative accounts. |
| Public table/view grants | 135 objects | 135 | Fully inspected (metadata) | ACLs for anon/authenticated/service role captured; direct API behavior not mutation-tested. |
| Public functions | 366 | 366 metadata; 10 full bodies | Partially inspected | Privilege/search-path/dynamic-SQL/auth-pattern scan covered all; only high-risk/public definitions were read end-to-end. |
| Public non-internal triggers | 47 | 47 metadata | Partially inspected | Trigger/table/function mapping and enabled state enumerated; not every trigger function semantically traced. |
| Public views | 5 | 5 | Fully inspected (metadata) | Owner, grants and `security_invoker=true` verified; every output column/query path not semantically audited. |
| Extensions | 7 | 7 | Fully inspected (metadata) | Name, version and schema captured; extension internals excluded. |
| Storage buckets | 2 | 2 | Fully inspected (metadata) | Public flag, limits, MIME allowlist, policy and aggregate size/count captured. |
| Storage object rows | 93 | 0 contents/paths | Excluded | Only bucket-level counts/bytes were aggregated; names, metadata and file contents deliberately excluded to avoid customer data. |
| Realtime public tables | 3 | 3 | Fully inspected (metadata) | Publication membership captured; subscriber payloads/client behavior not exercised. |
| `pg_cron` jobs | 10 | 10 metadata/health | Partially inspected | Name, schedule, active state and 30-day outcome counts captured; command text was fingerprinted, not copied, to avoid embedded secrets. |
| Applied migration ledger | 375 | 375 metadata | Fully inspected (ledger), partially source-reconciled | All versions/names enumerated; latest drift reconciled with Git. Live SQL text is not stored in the ledger and early source history is absent from `dev`. |
| Supabase advisors | 727 | 727 | Fully inspected | All 513 security and 214 performance notices grouped; only highest-risk details promoted to findings. |
| Deployed Edge Functions | 2 | 2 source bodies | Fully inspected | Metadata and source read for `sheets-proxy` and `notify-test-push`; downstream Google Apps Script was not invoked/read. |
| Auth identities/sessions/users | aggregate counts only | 0 rows | Excluded | Counts used only to understand scale; identities, tokens, email/phone and session contents deliberately excluded. |
| Vault/credential values | aggregate count only | 0 values | Excluded | No secrets or decrypted values read. |
| Raw API/Auth/Postgres/Storage/Realtime logs | not enumerated | 0 | Excluded | Raw logs can contain PII/tokens and were unnecessary for catalog audit; they remain required for exploitation/incident questions. |
| Backups/PITR, network restrictions and unexposed project settings | unknown | 0 | Excluded | Not exposed by the connected read interface; requires dashboard/owner evidence. |

This addendum demonstrates broad live metadata coverage. It does **not** establish full database
semantic coverage, penetration-test coverage or legal compliance.

## Inspection methods

- Hidden-inclusive file census with `rg --files` and PowerShell counts.
- Git commit/status/branch inspection.
- Complete read of repository law and the database, Worker and documentation standards.
- Targeted line-numbered reads of evidence-critical code/docs/migrations.
- Vite production build at current commit.
- Focused application ESLint parse and full-root diagnostic comparison.
- `npm audit --omit=dev --json` at current lockfile.
- Repository-wide searches for auth gates, service-role use, time handling, CORS/origins, headers, environment use, dependency/tooling, browser/a11y frameworks, telemetry and deletion flows.
- File-count and physical-line-size analysis for architecture/maintainability.
- Cross-comparison of generated database reports, baseline metadata and applied-status documentation.
- Read-only Supabase project/catalog queries for schemas, relations, constraints, policies, grants,
  routines, Storage, Realtime, cron and operational aggregates.
- Supabase security/performance advisors, migration ledger and deployed Edge Function source review.
- Git history reconciliation for live migrations absent from audited `dev`.

## Files read deeply

Evidence-critical files read fully or in all relevant functional sections include:

- `CLAUDE.md`; `.claude/rules/database-standard.md`; `.claude/rules/workers-standard.md`; `.claude/rules/documentation-standard.md`.
- `package.json`; `vite.config.js`; `index.html`; `_headers`; `public/_headers`; `.github/workflows/ci.yml`.
- `functions/lib/auth.js`; `functions/lib/http.js`; `functions/lib/supabase.js`; `functions/lib/cors.js`; `functions/lib/sms-consent.js`; relevant `functions/lib/automated-send.js` gates.
- `functions/api/qbo-charge.js`; `functions/api/stripe-pay-link.js`.
- Relevant sections of `src/App.jsx`, `src/contexts/AuthContext.jsx`, `src/components/ErrorBoundary.jsx`, `src/pages/Legal.jsx`, `src/pages/settings/MyAccount.jsx` and `src/main.jsx`.
- `supabase/migrations/20260717_account_deletion_requests.sql` and selected database-security/CRM migration/test evidence.
- `BILLING-CONTEXT.md`; `UPR-QBO-SYNC-PROTOCOL.md`; `docs/crm-lead-lifecycle.md`; `docs/db-foundation-roadmap.md`; `docs/app-store-connect-metadata.md`; `docs/generated/schema-overview.md`; `db/baseline/live-schema-snapshot.json` metadata.
- `docs/audit/2026-07/evidence/live-supabase.md`; full live definitions for the six anonymous
  privileged functions plus `exec_read_sql`, `get_managed_credentials_status`,
  `set_integration_secret` and `set_twilio_config`.

This list is not represented as every file semantically reviewed.

## Unexecuted verification

- No migration apply, data repair or test-data cleanup.
- No business-row, Storage-object, secret, raw-log, backup/PITR or network-restriction inspection.
- No exhaustive semantic read of all 366 live function bodies or representative-role live access
  matrix.
- No current-head `npm test`, because locally loaded credentials can target the one shared production database and suites can write.
- No deployed Cloudflare/API/browser smoke, authenticated account test, provider sandbox, webhook replay, native Xcode build or App Store Connect inspection.
- No Lighthouse/Web Vitals/load test, screen-reader/device test, penetration test or legal review.

## How to raise coverage honestly

1. Create isolated Supabase/provider test environments.
2. Run and record all unit, database, browser and native test lanes at one immutable commit.
3. Refresh the dated read-only live catalog/advisor/provenance capture for each release and complete
   routine-by-routine authorization contracts for privileged browser-callable functions.
4. Perform route-by-route representative-role and device/accessibility checks.
5. Trace every side-effecting Worker for auth, role, validation, idempotency, timeout and telemetry.
6. Update this ledger with exact executed counts and preserve raw machine-readable reports.

Only after those steps should a future audit consider a full-coverage claim.
