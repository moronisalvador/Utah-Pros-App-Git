# July 2026 Maintainability, Performance, Testing and Observability

Audit date: 2026-07-22
Evidence commit: `0a7c61c`

This dated file keeps repository-size, build, lint, testing and observability findings together.
Artifact measurements and tool results are point-in-time evidence, not permanent architecture.
Current conventions live in `docs/architecture.md` and `docs/testing-and-deployment.md`.

## Finding PERF-001 — Bundle budget is informational and cannot block regressions

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `.github/workflows/ci.yml:78-84`; `vite.config.js:12-15`.
- **Affected workflow:** every web/PWA/native cold load and release review.
- **Observed behavior:** CI concatenates/gzips JS and prints a guide value, but the step is `continue-on-error` and has no assertion. It does not report CSS, route chunks, main-entry size or change versus a committed baseline.
- **Realistic failure scenario:** a dependency or eager import adds hundreds of kilobytes; CI remains green and the regression reaches field technicians on mobile networks or the native webview.
- **Business impact:** slower startup/navigation, increased data use, lower field adoption and degraded reliability on poor connectivity.
- **Recommended remediation:** record per-entry/per-route raw+gzip+Brotli sizes, set an initial baseline from the current artifact, and fail only on meaningful regression (for example >10% or an approved absolute limit). Track CSS independently and preserve route splitting.
- **Regression test / verification:** CI produces a machine-readable manifest and fails an intentionally oversized fixture/change; approved baseline updates are reviewed in the PR.
- **Estimated effort:** S (0.5–1 day).
- **Dependencies:** none.

## Finding PERF-002 — All domains share a very large eager stylesheet

- **Severity:** Medium
- **Confidence:** likely
- **Evidence:** `src/main.jsx:31-42`; `src/index.css:1-12231`; current build artifact `dist/assets/index-ucJPhDuz.css` reported by Vite as 411.70 kB raw / 60.55 kB gzip.
- **Affected workflow:** initial load of every public, office, CRM, technician and native route.
- **Observed behavior:** `main.jsx` imports one 12,231-line global stylesheet before route selection. Only claim-specific CSS was emitted separately in the audit build; the global asset contains styles for many unrelated domains.
- **Realistic failure scenario:** a technician opening one mobile route downloads/parses the complete office, CRM, collections and admin style corpus; further feature work grows the global payload and selector-interaction cost.
- **Business impact:** higher cold-start cost, harder CSS isolation and greater visual-regression risk.
- **Recommended remediation:** inventory style ownership, extract route/domain CSS into lazy route imports, keep tokens/reset/shared primitives global, and remove dead/duplicate selectors with visual regression checks. Do not perform a blind minification/rewrite.
- **Regression test / verification:** route build manifest shows domain CSS lazy-loaded; critical routes pass screenshot/interaction checks; global CSS size falls and no route has a flash of unstyled content.
- **Estimated effort:** L (1–3 weeks, staged by domain).
- **Dependencies:** TEST-001 for E2E/visual coverage; MAINT-001.

## Finding PERF-003 — Live database advisors show concentrated indexing and RLS-planning debt

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `docs/audit/2026-07/evidence/live-supabase.md:174-203`.
- **Affected workflow:** foreign-key parent updates/deletes, relationship joins, policy-filtered table access and future scale of CRM, scheduling, billing and communications.
- **Observed behavior:** the live performance advisor reports 105 foreign keys without covering indexes, 28 policies that re-evaluate Auth functions per row and 34 role/action combinations with multiple permissive policies. It also reports 46 unused indexes, but the live database is about 50 MB and point-in-time “unused” status is not adequate removal evidence.
- **Realistic failure scenario:** table growth makes parent deletes/updates and common joins increasingly expensive, row-by-row Auth evaluation amplifies latency, and overlapping policies add work to every qualifying query. A cleanup that blindly drops “unused” indexes could create a different regression.
- **Business impact:** slower screens/jobs, higher database load, longer lock duration during updates/deletes and more difficult performance diagnosis as data volume grows.
- **Recommended remediation:** rank missing FK indexes using row counts, write/delete frequency and `EXPLAIN (ANALYZE, BUFFERS)` in an isolated environment; add the highest-value indexes with production-safe DDL. Rewrite policy Auth calls to initialization-plan form where semantics permit, consolidate duplicate permissive policies, and require a representative observation window plus query-plan review before dropping an index.
- **Regression test / verification:** advisor counts fall only through reviewed migrations; representative parent update/delete and high-traffic query plans use intended indexes; role-matrix tests prove policy consolidation preserves allowed/denied behavior; production lock/latency telemetry shows no regression.
- **Estimated effort:** M–L (3–10 days in prioritized waves, not one bulk migration).
- **Dependencies:** ARCH-001, DB-002 and TEST-002.
- **External evidence required:** representative production query frequency/latency and an isolated database are needed to prioritize safely; the advisor alone does not prove user-visible slowness.

## Finding MAINT-001 — Several critical modules are too large for low-risk change

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `src/index.css:1-12231`; `upr-mcp/src/codeIndex.js:1-10058`; `src/pages/DevTools.jsx:1-2516`; `src/pages/tech/TechDemoSheet.jsx:1-1565`; `src/pages/crm/CrmLeads.jsx:1-1560`; `src/pages/HomebuildingAnalysis.jsx:1-1437`; `src/pages/TimeTracking.jsx:1-1388`; `functions/api/generate-water-loss-report.js:1-1254`.
- **Affected workflow:** feature development, review, merge conflict resolution, defect isolation and safe parallel work across UI, reports, CRM and MCP indexing.
- **Observed behavior:** multiple files contain 1,000–12,000 physical lines and mix data access, state, rendering, styles, transformations or provider/report logic.
- **Realistic failure scenario:** a small feature changes shared state or selectors in a large file, reviewers cannot efficiently bound the impact, and an unrelated route or report regresses.
- **Business impact:** slower delivery, higher review/merge cost, harder testing and increased regression probability.
- **Recommended remediation:** refactor only behind characterization tests. Extract domain hooks/services, presentational sections, constants and route-owned CSS along stable business-rule seams. Keep database-trigger and provider contracts unchanged while splitting.
- **Regression test / verification:** each extraction is behavior-preserving under unit/route/screenshot tests; build output and public exports remain stable; file ownership and dependency direction are documented.
- **Estimated effort:** XL overall (several staged weeks); M per highest-risk module.
- **Dependencies:** TEST-001, ACC-001 and PERF-002.

## Finding MAINT-002 — Application lint debt is substantial and non-blocking

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `package.json:6-12`; `.github/workflows/ci.yml:8-12`; `.github/workflows/ci.yml:59-76`; current command `npx eslint src functions supabase upr-mcp vite.config.js` reported 256 problems (133 errors, 123 warnings) at `0a7c61c`.
- **Affected workflow:** all JavaScript/JSX changes, React hook correctness, dead code, restricted auth/data access patterns and code review.
- **Observed behavior:** both full lint and changed-file lint use `continue-on-error`. The CI comment says a 175-error baseline, while the current focused application run reports 133 errors plus 123 warnings; the baseline text is therefore not a reliable current metric.
- **Realistic failure scenario:** a new hook-dependency, undefined-variable, stale unauthenticated DB import or other real error merges because the check is informational and its output is buried in known debt.
- **Business impact:** regressions, reviewer fatigue and inability to use static analysis as a release control.
- **Recommended remediation:** capture a machine-readable current baseline by rule/path, make “no new errors” blocking immediately, clean high-risk rules first (undefined identifiers, React hook/compiler diagnostics, restricted DB imports, unsafe side effects), then ratchet warnings and remove `continue-on-error`.
- **Regression test / verification:** CI fails when a fixture adds one new lint violation, passes with unchanged baseline, and trends total debt downward; eventually focused application lint is clean and blocking.
- **Estimated effort:** M–L (3–10 days staged by rule/domain).
- **Dependencies:** MAINT-003 to isolate the correct lint universe.

## Finding MAINT-003 — The default lint scope mixes product code with tooling/generated output

- **Severity:** Low
- **Confidence:** confirmed
- **Evidence:** `package.json:6-12`; `.gitignore:25-30`; `eslint.config.js:1-60`; current `npm run lint` behavior. Full-root ESLint excluding only `.claude/worktrees/**` reported 731 problems (608 errors, 123 warnings) and traversed `.claude/skills/` plus `.wrangler/tmp/`.
- **Affected workflow:** local lint, CI lint signal, debt tracking and contributor onboarding.
- **Observed behavior:** `eslint .` has no audit-observed exclusions for repository-local Claude tooling or generated Wrangler bundles. The result is much noisier than the 256-problem application-focused run.
- **Realistic failure scenario:** developers chase vendored/tooling diagnostics, ignore the entire lint result, or record misleading quality metrics.
- **Business impact:** wasted engineering time and weakened trust in static analysis.
- **Recommended remediation:** define explicit product lint targets and ignores for generated/local output; give internal tools their own config/script if they are maintained here. Ensure CI uses a clean checkout and reports each scope separately.
- **Regression test / verification:** `npm run lint:app` never includes `.claude`, `.wrangler`, `dist`, worktrees or dependencies; an optional `lint:tools` owns supported tool files; path assertions test the config.
- **Estimated effort:** S (0.5 day).
- **Dependencies:** none.

## Finding TEST-001 — No end-to-end browser/native workflow suite is configured

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `package.json:6-12`; `package.json:42-53`; `.github/workflows/ci.yml:44-84`; `vite.config.js:1-24`; repository census found no first-party Playwright/Cypress configuration or direct dependency.
- **Affected workflow:** login/session restoration, role routing, invoice/payment UI, CRM, technician mobile routes, file uploads, offline/cache recovery and provider callback journeys.
- **Observed behavior:** CI builds and runs Vitest tests but does not launch a browser or native shell against a deployed/test environment. The package-lock mention of optional `@vitest/browser-playwright` is not a configured project dependency or suite.
- **Realistic failure scenario:** components and helpers pass in isolation while a route guard, form interaction, cache state, browser API or deployed Worker integration is broken for real users.
- **Business impact:** production-only regressions in critical office/field workflows and slower manual verification.
- **Recommended remediation:** add a small Playwright smoke suite against an isolated test environment: login for representative roles, primary navigation, read-only job/customer views, one safe draft workflow, account deletion request in seeded data, and public legal/support routes. Keep real money/provider actions mocked or sandboxed. Add a separate Xcode/native smoke checklist or UI suite.
- **Regression test / verification:** a seeded disposable environment runs browser tests on PRs; tests prove role-denied routes, key mobile viewport flows and recovery behavior. Native release has a recorded simulator/device pass.
- **Estimated effort:** L (1–3 weeks for environment, fixtures and first critical journeys).
- **Dependencies:** ARCH-001, TEST-002.

## Finding TEST-002 — Database/RLS contract tests self-skip in CI

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `.github/workflows/ci.yml:47-57`; `supabase/tests/db_foundation_billing_admin_gate.test.js:26-40`; `supabase/tests/db_foundation_p3_anon_closure.test.js:31-51`; representative CRM tests such as `supabase/tests/crm_manual_lead.test.js:29-41`.
- **Affected workflow:** migrations, RLS/anon closure, role gates, database RPC contracts, CRM triggers and live-schema compatibility.
- **Observed behavior:** database credentials are scoped to the CI Build step; the Test step receives none. Many database suites explicitly use `describe.skipIf` when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are absent, so a green CI test step does not exercise those contracts.
- **Realistic failure scenario:** a migration changes a policy, RPC signature or trigger behavior; unit tests pass and DB suites skip, so the regression is first discovered in the shared production database.
- **Business impact:** authorization exposure, production data defects, migration rollback and downtime.
- **Recommended remediation:** provision an isolated Supabase CI project or ephemeral local Supabase stack, apply migrations from zero and run database tests with distinct role users. Split `test:unit` (no external state, blocking) and `test:db` (isolated state, blocking before promotion). Never solve this by pointing mutation-heavy CI at shared production.
- **Regression test / verification:** CI output reports zero unexpected skips in `test:db`, exports the tested migration head and fails an intentionally broken RLS/RPC contract.
- **Estimated effort:** L (1–3 weeks; smaller if a reusable non-production project is accepted).
- **Dependencies:** ARCH-001, DB-001, DB-002.

## Finding TEST-003 — Local Vitest discovery can traverse nested worktrees

- **Severity:** Low
- **Confidence:** likely
- **Evidence:** `package.json:6-12`; `vite.config.js:1-24`; `.gitignore:28-30`; local census found 7,802 files under `.claude/worktrees/`, while no Vitest `exclude` is configured.
- **Affected workflow:** local `npm test`, test counts, runtime and failure triage.
- **Observed behavior:** the test command relies on default discovery. Git ignore keeps nested worktrees out of commits but does not make their on-disk test files nonexistent to Vitest. A prior audit run on an earlier commit observed duplicate nested-worktree suite discovery; it was not re-run at current head because environment-loaded DB tests may mutate the shared project.
- **Realistic failure scenario:** local tests execute stale duplicate suites from other branches, report conflicting failures and take far longer than CI.
- **Business impact:** unreliable local verification and wasted debugging time.
- **Recommended remediation:** add a Vitest config with explicit include roots and excludes for `.claude/worktrees`, `dist`, `.wrangler`, dependencies and generated output; provide separate unit/DB patterns.
- **Regression test / verification:** `vitest list` contains no path under excluded roots and matches an expected first-party test-file count.
- **Estimated effort:** S (0.5 day).
- **Dependencies:** none.

## Finding TEST-004 — CI permits a build with missing runtime configuration

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `.github/workflows/ci.yml:47-57`; `src/lib/supabase.js:1-30`; `.env.example:1-13`.
- **Affected workflow:** staging/production web deployment, Supabase authentication and API configuration.
- **Observed behavior:** CI explicitly notes that the build succeeds when Supabase secrets are unset. There is no separate deployment preflight or smoke assertion in the workflow shown.
- **Realistic failure scenario:** a renamed/deleted GitHub or Cloudflare variable produces a green build and deploys a client that cannot authenticate or query data.
- **Business impact:** complete application outage despite passing CI.
- **Recommended remediation:** keep compilation environment-tolerant, but add a deployment preflight that validates required variables by environment and a post-deploy read-only smoke test for `/`, auth settings and a safe health/config endpoint.
- **Regression test / verification:** a Preview deployment with one required variable removed fails preflight; valid staging/production deployments pass smoke checks without exposing secret values.
- **Estimated effort:** S–M (1–2 days).
- **Dependencies:** SEC-003.
- **External evidence required:** Cloudflare/GitHub/Capgo variable inventories.

## Finding OBS-001 — Client render failures have no repository-evidenced error telemetry

- **Severity:** Medium
- **Confidence:** likely
- **Evidence:** `src/components/ErrorBoundary.jsx:20-27`; `src/components/ErrorBoundary.jsx:38-110`; `package.json:14-53`; `docs/app-store-connect-metadata.md:63-65`.
- **Affected workflow:** all web/PWA/native route render failures and client-side exceptions.
- **Observed behavior:** ErrorBoundary logs to `console.error` and explicitly says a real reporting service may replace it later. No client crash/error SDK is a direct dependency, and App Store metadata states no diagnostics SDK is bundled.
- **Realistic failure scenario:** an intermittent role/device/data-specific exception shows a recovery screen, but maintainers receive no structured event, release/version, stack, route, user role or breadcrumb.
- **Business impact:** long mean time to detection/repair, repeated user disruption and incomplete release-quality evidence.
- **Recommended remediation:** add privacy-reviewed error reporting or a first-party error-ingest endpoint with release ID, route, platform, role class and redacted stack; never include customer/payment/message content by default. Add Worker alerting from `worker_runs` for scheduled failures.
- **Regression test / verification:** a synthetic render error produces one redacted event with release/route metadata in staging; PII tests prove sensitive fields are stripped; alert routing is exercised.
- **Estimated effort:** M (2–5 days plus privacy review).
- **Dependencies:** COMP-001/COMP-004 because diagnostics change disclosures/App Store privacy answers.
- **External evidence required:** confirm no Cloudflare/native telemetry exists outside the bundle and define retention/access controls.
