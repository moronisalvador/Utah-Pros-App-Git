# July 2026 Security Findings

Audit date: 2026-07-22
Evidence commit: `0a7c61c`

This dated snapshot combines architecture/database exposure, authentication/authorization and
application security findings. Facts are distinguished by the confidence field. Architectural
judgments are recommendations, not proof of an active production incident. Live Supabase,
Cloudflare, provider and account evidence is required wherever a finding says so. A read-only live
Supabase review was added on 2026-07-22; its sanitized evidence is in
`docs/audit/2026-07/evidence/live-supabase.md`.

Canonical current knowledge: `docs/architecture.md`, `docs/database-schema.md`,
`docs/auth-and-authorization.md` and `docs/integrations.md`.

## Finding ARCH-001 — Staging and production share one database

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `.claude/rules/database-standard.md:3-6`; `.claude/rules/database-standard.md:52-61`; `.claude/rules/database-standard.md:72-81`; `BILLING-CONTEXT.md:20-25`.
- **Affected workflow:** every schema migration, RLS/policy change, feature flag backed by the database, integration test and data repair.
- **Observed behavior:** repository law states that `dev` and production use the same Supabase project and that a migration becomes live in production immediately when applied.
- **Realistic failure scenario:** a migration or integration test intended for staging locks or changes a hot production table, creates test records visible to staff, or changes an RPC contract before the production frontend is ready.
- **Business impact:** production outage, data contamination, release rollback pressure and inability to exercise destructive/realistic tests safely.
- **Recommended remediation:** create an isolated non-production Supabase project with its own Auth, Storage and provider-sandbox configuration; promote migrations through it before production. Until then, prohibit mutation-heavy automated tests against the shared project, retain additive/schema-first sequencing and require low-traffic apply windows.
- **Regression test / verification:** CI applies all migrations from a clean baseline to the isolated project, runs schema/RLS contracts, then exports a catalog fingerprint; production promotion compares migration hashes before apply.
- **Estimated effort:** L (1–3 weeks, including secrets, seed data and integration cutovers).
- **Dependencies:** TEST-002, DB-001, DB-002.
- **External evidence required:** live Supabase project inventory and Cloudflare Preview/Production bindings are required to verify the documented topology and complete a split.

## Finding DB-001 — Checked-in live-schema evidence is stale and internally contradictory

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `db/baseline/live-schema-snapshot.json:1-8`; `docs/generated/schema-overview.md:1-16`; `docs/generated/schema-overview.md:138-152`; `UPR-Web-Context.md:289-300`; `docs/audit/2026-07/evidence/live-supabase.md:15-37`; `docs/audit/2026-07/evidence/live-supabase.md:154-172`.
- **Affected workflow:** schema review, RLS/anon exposure review, drift detection, migration planning and compliance evidence.
- **Observed behavior:** the baseline was captured on 2026-07-08 with 125 tables/332 functions and the generated overview says 127 tables. Read-only live capture on 2026-07-22 found 130 public tables, 366 public functions and 375 applied migrations. The checked-in reports therefore cannot represent the current catalog, grants or policy state.
- **Realistic failure scenario:** an engineer trusts the generated report, plans a redundant or unsafe policy migration, or signs off a security review against a pre-closure snapshot.
- **Business impact:** false assurance or false alarms, unsafe migrations and slower incident/security response.
- **Recommended remediation:** run the existing read-only catalog snapshot and docs-generation tools against the live project; store capture timestamp, project ref, migration-head hash and generator version; fail a scheduled check when the checked-in fingerprint diverges.
- **Regression test / verification:** regenerate both reports from one immutable snapshot and assert their table/function counts and anon-policy inventory agree; compare against the live migration ledger read-only.
- **Estimated effort:** S (0.5–1 day).
- **Dependencies:** ARCH-001.
- **External evidence required:** none for the dated counts above; each future release needs a fresh read-only capture.

## Finding DB-002 — Authenticated RLS is documented as broadly permissive

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `.claude/rules/database-standard.md:31-34`; `docs/db-foundation-roadmap.md:77-89`; `docs/db-foundation-roadmap.md:260-266`; `docs/audit/2026-07/evidence/live-supabase.md:41-74`; `docs/audit/2026-07/evidence/live-supabase.md:76-98`.
- **Affected workflow:** all authenticated reads/writes, employee least privilege, sensitive operational/financial data access and any future multi-company offering.
- **Observed behavior:** live policy review found always-true authenticated `ALL` policies on 75 tables plus unrestricted command-specific access on dozens more. The advisor reports 146 always-true policies and 342 authenticated-executable `SECURITY DEFINER` overloads. Authenticated ACLs include every table privilege on all 130 public tables; RLS/RPC bodies are therefore the principal boundary.
- **Realistic failure scenario:** a valid low-privilege employee bypasses a hidden page or calls PostgREST directly with their JWT to read or mutate rows outside their role/assignment; future tenants could see one another’s data if multi-tenancy were added without redesign.
- **Business impact:** internal privacy breach, unauthorized financial/HR/customer access, audit failure and a hard blocker for SaaS multi-tenancy.
- **Recommended remediation:** preserve the live matrix in the evidence record, classify tables/RPCs by company-wide, role-restricted, assignment-scoped and service-only access, then tighten the highest-sensitivity financial, credential, employee, customer and messaging paths first. Add organization/tenant keys before any external multi-company rollout. Treat every privileged RPC as its own authorization contract rather than bulk-granting authenticated execution.
- **Regression test / verification:** role-matrix tests using distinct admin, office, project-manager, field-tech and CRM-partner accounts must prove allowed and denied reads/writes by table/RPC; run Supabase security advisors after each wave.
- **Estimated effort:** XL (3–8 weeks for full least privilege; 3–5 days for inventory and top-risk tables).
- **Dependencies:** ARCH-001, TEST-002.
- **External evidence required:** real role accounts, owner-approved data classification and the product decision on multi-tenancy.

## Finding DB-003 — Authenticated users can execute arbitrary privileged read SQL

- **Severity:** Critical
- **Confidence:** confirmed
- **Disposition:** contained 2026-07-23; preserve as a Critical regression boundary
- **Evidence:** `supabase/migrations/20260627_exec_read_sql.sql:1-20`; `supabase/migrations/20260627_exec_read_sql.sql:22-58`; `supabase/migrations/20260627_exec_read_sql.sql:60-64`; `supabase/migrations/20260708_dbf_p3_anon_rpc_revoke.sql:158-161`; `supabase/migrations/20260723205127_exec_read_sql_containment.sql:1-54`; `docs/audit/2026-07/evidence/live-supabase.md:100-114`; `docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md`.
- **Affected workflow:** every protected database table/schema readable by the `postgres` function owner, including customer, employee, billing, credential metadata, Auth and operational records.
- **Observed behavior:** the 2026-07-22 snapshot found `exec_read_sql(text)` running as `SECURITY DEFINER` and executable by `authenticated`, allowing caller-provided `SELECT`/`WITH` text to bypass RLS. On 2026-07-23, the reviewed grant-only migration revoked `PUBLIC`, `anon`, and `authenticated`; post-apply catalog checks and direct role tests confirmed only `service_role` remains executable, with signature/body/owner unchanged.
- **Realistic failure scenario:** any valid or stolen employee session calls `/rest/v1/rpc/exec_read_sql` with a query against an RLS-protected table or protected schema and exfiltrates rows that the caller could not read through normal PostgREST.
- **Business impact:** database-wide confidentiality breach, exposure of regulated/customer/employee data, incident-response and notification costs, credential compromise if secret-bearing columns are selected, and loss of trust.
- **Recommended remediation:** completed for immediate containment. Keep the ACL service-only, retain the committed negative-role tests, and preferably move/replace the helper with fixed-query owner contracts in a future MCP hardening phase. Inventory prior direct calls if an audit source exists. Do not attempt to make free-form SQL safe with string parsing.
- **Regression test / verification:** completed live on 2026-07-23: catalog assertions passed; anon/authenticated returned `42501`; service-role `select 1 as ok` succeeded; the security advisor no longer references `exec_read_sql`. Continue running the committed regression suite and advisor after grant/function changes.
- **Estimated effort:** S (hours for containment and tests; M if replacing the MCP query design).
- **Dependencies:** none for immediate revoke; ARCH-001 and TEST-002 for safe rollout testing.
- **External evidence required:** API/Postgres logs are needed to determine whether the RPC has been invoked by non-service callers; this audit did not read raw logs.

## Finding DB-004 — Anonymous policies expose operational and customer data to unauthenticated callers

- **Severity:** Critical
- **Confidence:** confirmed
- **Evidence:** `supabase/migrations/20260708_dbf_p3_anon_policy_closure.sql:24-36`; `supabase/migrations/20260709_sms_f01_drift_capture.sql:218-247`; `docs/audit/2026-07/evidence/live-supabase.md:39-70`.
- **Affected workflow:** appointments, claims, contacts, conversations/messages, employees/bootstrap data, jobs/history, CRM automations and email-campaign/suppression data.
- **Observed behavior:** live RLS contains unrestricted anonymous SELECT on 12 tables, INSERT on 8, UPDATE on 5, DELETE on appointments and `ALL` on seven CRM/email tables. The July closure migration explicitly deferred these ownership groups, and a later drift-capture migration recreates anonymous conversation/message policies.
- **Realistic failure scenario:** an unauthenticated caller uses the publishable/legacy anon key from the browser bundle to enumerate contacts, jobs, claims, employees or messages, alter job/contact/claim state, delete appointments, or manipulate campaign and suppression records through PostgREST.
- **Business impact:** public PII disclosure, operational sabotage, corrupted schedules/CRM history, unauthorized email activity, privacy/regulatory exposure and a high-severity incident.
- **Recommended remediation:** treat this as immediate containment: confirm required logged-out journeys, replace direct table access with narrow token/identifier-constrained RPCs or Workers, revoke anonymous table grants/policies in small tested waves, and close every deferred ownership item. Preserve only a documented public allowlist with explicit abuse controls.
- **Regression test / verification:** with only the anon key, attempts to select/mutate every non-allowlisted public table must fail; public form/signing journeys still succeed through purpose-built boundaries; advisor shows no unexpected anonymous broad policy.
- **Estimated effort:** L (1–3 weeks because several active workflows depend on the deferred policies; highest-risk read/write revokes should ship sooner).
- **Dependencies:** ARCH-001, TEST-002, AUTH-004 and coordination with messaging/forms/signing owners.
- **External evidence required:** deployed browser flows and test accounts are needed to prove which deferred policies are still functionally required; raw access logs are needed to assess exploitation.

## Finding DB-005 — The shared live database is ahead of the audited `dev` branch

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `docs/audit/2026-07/evidence/live-supabase.md:154-172`; `.claude/rules/database-standard.md:52-61`; `.claude/rules/database-standard.md:72-81`.
- **Affected workflow:** database reproducibility, CRM reporting/deduplication behavior, rollback, incident diagnosis, branch promotion and clean-environment provisioning.
- **Observed behavior:** four latest live migrations are absent from `dev` at `0a7c61c` but present on `claude/upr-crm-dashboard-gap-e0e8ba` commits `c10a8bb`, `a5ef0e1` and `a7ee5f8`. Production schema/behavior was therefore changed before the corresponding feature branch was merged into the audited deployment branch.
- **Realistic failure scenario:** a dev/prod deployment assumes older RPC behavior, a rollback cannot reconstruct the live state from `dev`, or another migration is authored against stale function bodies and silently overwrites feature-branch fixes.
- **Business impact:** non-reproducible production, contract drift, data inconsistency, slower incident recovery and accidental rollback of already-live fixes.
- **Recommended remediation:** adopt migration provenance gates: apply to the shared live project only from a reviewed commit reachable from the designated deployment branch (or record an explicit emergency exception), verify the migration ledger against Git before deploy, and merge/reconcile the currently live feature commits without overwriting their database behavior.
- **Regression test / verification:** a read-only release check maps every new live migration to a migration file and commit reachable from the release ref; clean database reconstruction reaches the same catalog fingerprint.
- **Estimated effort:** S to reconcile current commits; M–L to automate provenance and clean-rebuild checks.
- **Dependencies:** ARCH-001, TEST-002 and DB-001.
- **External evidence required:** branch-protection/deployment history is required to determine who authorized the apply and whether an emergency workflow was followed.

## Finding AUTH-004 — The public form RPC bypasses anti-abuse, validation and consent-evidence controls

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `functions/api/form-submit.js:384-445`; `supabase/migrations/20260702_crm_phase10_form_rpcs.sql:177-216`; `supabase/migrations/20260702_crm_phase10_form_rpcs.sql:304-330`; `docs/audit/2026-07/evidence/live-supabase.md:116-129`.
- **Affected workflow:** hosted/web form submissions, CRM lead/contact creation, SMS opt-in and TCPA consent evidence.
- **Observed behavior:** the Worker enforces honeypot/minimum-time, rate-limit, optional Turnstile and schema validation, but the underlying `SECURITY DEFINER` RPC is directly executable by `PUBLIC`/`anon` and does not repeat them. It trusts caller-supplied `p_consent`, IP, user agent and organization ID and can mark a contact opted in.
- **Realistic failure scenario:** a caller who obtains a published form UUID invokes the RPC directly, bypasses Worker controls, creates lead/contact noise and records a chosen phone number as opted in with a fabricated IP/evidence string.
- **Business impact:** spam and CRM pollution, incorrect messaging consent, customer complaints, TCPA/legal evidence weakness and automation/provider costs.
- **Recommended remediation:** make the Worker/service role the only executor, revoke `PUBLIC`/`anon`/authenticated direct execution, derive IP/user agent/org/form identity server-side, and keep the database routine as a narrow internal transaction. If direct anonymous execution is truly required, move every anti-abuse/validation/consent invariant into a verifiable server boundary that callers cannot forge.
- **Regression test / verification:** direct anon/authenticated RPC calls fail; valid Worker submissions pass; forged consent/IP/org values cannot reach the database; duplicate, rate-limit, Turnstile and schema tests remain green.
- **Estimated effort:** M (1–3 days plus deployed public-form verification).
- **Dependencies:** DB-004 and TEST-002.
- **External evidence required:** a deployed form/browser capture is needed to confirm whether the internal form UUID is exposed; legal review is needed for the consent-evidence standard.

## Finding AUTH-005 — Public signing reads do not enforce link expiration in the database

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `src/pages/SignPage.jsx:191-206`; `functions/api/submit-esign.js:92-96`; `supabase/migrations/20260708_dbf_p3_sign_document_templates_rpc.sql:35-50`; `docs/audit/2026-07/evidence/live-supabase.md:131-139`.
- **Affected workflow:** public e-sign link retrieval and legal-template loading.
- **Observed behavior:** browser/Worker callers reject an expired link after calling `get_sign_request_by_token`, but the anonymous `SECURITY DEFINER` retrieval predicate checks only the UUID token. A direct RPC caller with an old token can continue to receive signer and job/claim/policy fields after expiry; template lookup is also token-only.
- **Realistic failure scenario:** an expired signing URL remains in email history, logs or forwarded messages; a person who obtains it bypasses the UI and calls the RPC directly to retrieve customer/claim data.
- **Business impact:** longer-than-intended PII exposure and an authorization rule that exists only in cooperative callers rather than the data boundary.
- **Recommended remediation:** enforce expiration/status in both public retrieval RPCs, return a deliberately minimal public DTO rather than the full request/template rows, and consider token revocation/rotation after completion.
- **Regression test / verification:** direct anon calls with valid, expired, completed, revoked, malformed and unknown tokens return only the documented result; expired/revoked paths disclose no job or signer fields.
- **Estimated effort:** S–M (1–2 days including compatibility and signing-flow tests).
- **Dependencies:** TEST-002 and signing owner validation.
- **External evidence required:** retention/legal owner should confirm how long completed signing artifacts and capability links must remain accessible.

## Finding AUTH-001 — QBO card-charge endpoint lacks server-side role authorization

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `functions/api/qbo-charge.js:1-14`; `functions/api/qbo-charge.js:22-31`; `functions/api/qbo-charge.js:45-66`; `functions/api/qbo-charge.js:68-90`; `functions/lib/auth.js:108-120`; `.claude/rules/workers-standard.md:16-27`.
- **Affected workflow:** keying a customer card and charging an invoice through Intuit Payments/QBO.
- **Observed behavior:** the endpoint accepts the QBO webhook secret or any bearer token that Supabase Auth recognizes. It does not resolve an employee or enforce the documented billing role before calling `createCharge`.
- **Realistic failure scenario:** any active employee obtains their normal session token, calls `/api/qbo-charge` directly with an invoice ID, tokenized card value and amount, and initiates a real charge despite lacking billing authority.
- **Business impact:** unauthorized money movement, customer dispute, reconciliation work, potential fraud/disciplinary exposure and weakened PCI/payment controls.
- **Recommended remediation:** replace the local helper with centralized `requireRole(request, env, db, ['admin','manager'])` or the exact canonical billing-edit role set; separately validate amount against invoice balance and log the actor employee ID. Restrict the webhook-secret alternative to a specifically documented server caller or remove it if unused.
- **Regression test / verification:** endpoint tests must assert 401 without token, 403 for field-tech/unauthorized employee, success for each approved role, and rejection for an inactive/missing employee. In an Intuit sandbox, verify no charge call occurs before authorization passes.
- **Estimated effort:** S (0.5–1 day including tests).
- **Dependencies:** COR-002 should ship in the same money-path hardening change.
- **External evidence required:** confirm the intended approved roles and whether any scheduler legitimately uses `x-webhook-secret`.

## Finding AUTH-002 — Stripe payment-link endpoint lacks server-side role authorization

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `functions/api/stripe-pay-link.js:1-8`; `functions/api/stripe-pay-link.js:14-35`; `functions/api/stripe-pay-link.js:37-70`; `functions/lib/auth.js:108-120`; `.claude/rules/workers-standard.md:16-23`.
- **Affected workflow:** creation of a Stripe Checkout session for an invoice balance.
- **Observed behavior:** the file says the UI gates access to admins/managers, but the Worker only validates that the bearer is a real Supabase user. It then reads invoice/contact data with service role, creates a session and writes integration/invoice state.
- **Realistic failure scenario:** a field employee calls the API directly to create or replace a customer payment link, causing an unintended or confusing checkout session and changing invoice metadata.
- **Business impact:** unauthorized financial workflow changes, duplicate/conflicting links, customer confusion and audit-control failure.
- **Recommended remediation:** use centralized `requireRole` with the canonical billing roles, resolve an active employee, record the actor, and add explicit invoice-state rules.
- **Regression test / verification:** worker tests for missing/expired token, missing employee, inactive/unauthorized roles and approved roles; mock Stripe and assert it is never called for denied requests.
- **Estimated effort:** S (0.5 day).
- **Dependencies:** COR-003.
- **External evidence required:** confirm the canonical billing-role set and Stripe production/sandbox behavior.

## Finding AUTH-003 — Feature-flag load failures expose rollout-hidden routes

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `src/contexts/AuthContext.jsx:157-184`; `src/contexts/AuthContext.jsx:340-361`; `src/App.jsx:176-181`; `src/App.jsx:383-433`.
- **Affected workflow:** rollout-hidden Leads, Time Tracking, Collections, Estimates, Marketing and CRM routes.
- **Observed behavior:** an RPC failure sets the feature map to `{}` with an explicit “Fail open” comment. `isFeatureEnabled` treats a missing row as unrestricted, and `FeatureRoute` is the direct-route gate for the listed pages.
- **Realistic failure scenario:** a transient database/RPC/configuration failure makes unfinished or owner-only screens visible and directly reachable to all authenticated users. Underlying RLS may still limit data, but route/UI exposure occurs.
- **Business impact:** incomplete features shown to staff, confusing or unsafe actions, disclosure of work-in-progress UI and mistaken reliance on rollout flags as access control.
- **Recommended remediation:** separate rollout flags from authorization. Represent flag state as loading/loaded/error; fail closed for explicitly rollout-controlled routes on error while preserving a deliberate default for unflagged legacy pages. Sensitive routes should also use `AccessRoute` or server/RLS authorization.
- **Regression test / verification:** context/route tests must simulate RPC rejection and prove each rollout-hidden route redirects or shows an unavailable state; verify ordinary unflagged routes remain available.
- **Estimated effort:** M (1–2 days including route tests and UX state).
- **Dependencies:** DB-002 for defense in depth.
- **External evidence required:** product owner must classify each flag as rollout-only, safety kill switch or authorization-adjacent.

## Finding SEC-001 — Production dependency graph contains critical/high advisories

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `package.json:14-40`; `package-lock.json:653-677`; `package-lock.json:1755-1775`; `package-lock.json:4725-4765`; `package-lock.json:5023-5055`; `package-lock.json:5641-5665`. Audit command: `npm audit --omit=dev --json` on 2026-07-22 at `0a7c61c`.
- **Affected workflow:** web runtime routing/realtime, native build/Capacitor CLI, dependency installation and archive/XML/WebSocket processing in transitive tools.
- **Observed behavior:** npm reported 14 production-dependency advisories: 1 critical, 8 high and 5 moderate. Direct affected packages include `@capacitor/cli`, `react-router-dom` and `@supabase/supabase-js`; transitive chains include `tar`, `react-router`, `ws`, `plist` and `@xmldom/xmldom`.
- **Realistic failure scenario:** a vulnerable package path processes attacker-controlled routing, WebSocket, archive or XML input, or a compromised/malformed build artifact triggers a known denial-of-service, injection or parser issue. Not every advisory is necessarily reachable in this application.
- **Business impact:** supply-chain exposure, build-agent compromise or outage, client vulnerability and failed security review.
- **Recommended remediation:** preserve the lockfile, use `npm explain` and advisory details to classify runtime reachability, upgrade direct packages within compatible majors, run build/unit/native smoke tests, and document any accepted advisory with scope and expiry. Consider moving build-only `@capacitor/cli` from production dependencies if packaging permits.
- **Regression test / verification:** `npm audit --omit=dev` has no critical/high unresolved advisories or a checked-in, time-limited exception record; web build, route tests, Supabase realtime tests and iOS sync/build smoke checks pass after upgrades.
- **Estimated effort:** M (1–3 days; longer if Capacitor/React Router upgrades require behavior changes).
- **Dependencies:** TEST-001 and external iOS build access for safe upgrade verification.
- **External evidence required:** current npm advisory records and an Apple/Xcode build environment; exploitability requires call-path review.

## Finding SEC-002 — General browser security headers are not evidenced in the repository

- **Severity:** Medium
- **Confidence:** likely
- **Evidence:** `_headers:1-8`; `public/_headers:1-25`; `index.html:1-20`.
- **Affected workflow:** all browser/PWA page loads, embedding, referrer behavior, browser feature permissions and transport policy.
- **Observed behavior:** checked-in header files configure cache behavior and a narrow `Clear-Site-Data` response. They do not declare a general Content-Security-Policy, HSTS, frame policy, `Referrer-Policy`, `Permissions-Policy` or MIME-sniffing policy.
- **Realistic failure scenario:** if Cloudflare does not add equivalent headers externally, an injection has a wider execution surface, the application can be framed unexpectedly, referrers disclose internal paths, or browser capabilities are less constrained than intended.
- **Business impact:** larger XSS/clickjacking/privacy blast radius and weak security-assessment evidence.
- **Recommended remediation:** first capture actual production and Preview response headers. Then define a tested repository-managed baseline appropriate to the Google Fonts, Supabase, Cloudflare, provider and public-form embedding requirements. Roll out CSP in report-only mode before enforcement; do not break the deliberately embeddable public form route.
- **Regression test / verification:** automated deployment smoke test fetches `/`, `/privacy`, an authenticated shell response and public form responses, asserting required headers and route-specific frame policies; CSP report telemetry stays clean before enforcement.
- **Estimated effort:** M (2–5 days including inventory/report-only tuning).
- **Dependencies:** OBS-001 for CSP reporting.
- **External evidence required:** deployed Cloudflare headers/rules and all actual connect/img/font/frame origins.

## Finding SEC-003 — Production CORS access depends on an external variable

- **Severity:** Medium
- **Confidence:** hypothesis
- **Evidence:** `functions/lib/cors.js:1-24`; `.dev.vars.example:16`; `.github/workflows/ci.yml:47-57`.
- **Affected workflow:** authenticated browser calls from `https://utahpros.app` to Pages Function APIs using the shared CORS helper.
- **Observed behavior:** the static allowlist includes localhost, `https://dev.utahpros.app` and the Pages domain, but not `https://utahpros.app`. Production is accepted only when Cloudflare `PAGES_URL` exactly equals the browser origin. Repository examples only show a localhost value.
- **Realistic failure scenario:** the production variable is missing, carries a trailing slash, or is set only in Preview; the Worker returns an empty `Access-Control-Allow-Origin`, and browser API calls fail while direct/server calls still work.
- **Business impact:** production feature outages that may evade unit tests and be misdiagnosed as provider/database failures.
- **Recommended remediation:** add the known production origin to the explicit allowlist, normalize environment origins safely, validate required Preview/Production variables at deployment, and add exact-origin tests. Keep wildcard origins prohibited.
- **Regression test / verification:** unit tests cover localhost, staging, production, Pages URL, malicious sibling domains, trailing-slash configuration and absent env; deployed smoke requests verify preflight and actual responses from both domains.
- **Estimated effort:** S (0.5 day plus deployment verification).
- **Dependencies:** TEST-004/CI environment validation in the remediation backlog.
- **External evidence required:** current Cloudflare Preview and Production `PAGES_URL` values and a browser/network capture. If the variable is correct today, this remains a resilience/configuration finding rather than an active outage.

## Finding SEC-004 — Public job-file policies allow anonymous object listing

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `supabase/migrations/20260708_dbf_p2_storage_lockdown.sql:44-45`; `supabase/migrations/20260708_dbf_p2_storage_lockdown.sql:87-127`; `docs/audit/2026-07/evidence/live-supabase.md:141-152`; `docs/audit/2026-07/evidence/live-supabase.md:176-187`.
- **Affected workflow:** job document/photo upload, retrieval and sharing through the `job-files` Storage bucket.
- **Observed behavior:** `job-files` is public and contains 72 objects. Two broad Storage SELECT policies let anonymous callers list every object in that bucket; authenticated insert/delete policies are bucket-wide rather than job/assignment/path scoped. The Supabase security advisor flags the listing exposure.
- **Realistic failure scenario:** an unauthenticated caller enumerates object metadata/paths and fetches predictable or disclosed public URLs; any authenticated employee deletes or replaces files unrelated to their assigned jobs.
- **Business impact:** exposure or loss of customer/job photos and documents, privacy breach, operational disruption and weak evidence that file access follows application roles.
- **Recommended remediation:** separate deliberate public sharing from internal job evidence. Make the bucket private where feasible, serve time-limited signed URLs after server authorization, remove object-listing policies, constrain writes/deletes by path and role, and define a MIME allowlist. If permanent public URLs are a product requirement, use a separate publish-only bucket with non-sensitive artifacts.
- **Regression test / verification:** anon listing returns no rows; valid signed/public artifact URLs behave exactly as documented; unauthorized employees cannot insert/delete another job’s path; MIME/size tests cover allowed and rejected uploads.
- **Estimated effort:** M–L (2–5 days plus client migration if URLs change).
- **Dependencies:** DB-004, TEST-002 and a file-data classification decision.
- **External evidence required:** object contents/paths were deliberately not inspected; owners must classify whether existing files are sensitive and whether URLs have been distributed externally.

## Finding SEC-005 — A live unauthenticated Edge Function proxies arbitrary requests to Google Apps Script

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `docs/audit/2026-07/evidence/live-supabase.md:213-228`.
- **Affected workflow:** `sheets-proxy` Edge Function and the fixed downstream Google Apps Script.
- **Observed behavior:** live `sheets-proxy` version 2 has JWT verification disabled, wildcard CORS and forwards arbitrary GET query strings and POST bodies to a fixed Apps Script URL. No corresponding source file exists in the audited `dev` checkout, so its deployment provenance and downstream contract are not repository-reviewable.
- **Realistic failure scenario:** an internet caller uses the function as an unauthenticated relay to read or mutate spreadsheet-backed data, exhaust Apps Script quotas, submit malicious payloads or conceal the caller origin behind Supabase infrastructure.
- **Business impact:** external data exposure/corruption, quota/cost abuse, operational outage and an untracked production code path.
- **Recommended remediation:** determine whether the function is still used; disable/delete it if obsolete. Otherwise check in its source, require JWT or a narrow signed request, enforce method/schema/size/rate limits, restrict CORS to known origins, authenticate to a least-privilege downstream endpoint and add observability without sensitive payload logging.
- **Regression test / verification:** unauthenticated and hostile-origin calls fail; allowed callers can perform only documented operations; malformed/oversized/replayed requests are rejected; the live function hash matches source reachable from the release branch.
- **Estimated effort:** S if obsolete; M (1–3 days) if it must be hardened and retained.
- **Dependencies:** TEST-004 and integration owner identification.
- **External evidence required:** the Google Apps Script was not invoked; its code, data access, authentication and call logs are required to determine actual downstream exposure.

## Finding SEC-006 — Supabase leaked-password protection is disabled

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `docs/audit/2026-07/evidence/live-supabase.md:174-187`; `docs/audit/2026-07/evidence/live-supabase.md:205-211`.
- **Affected workflow:** password creation/change and account takeover resistance for Supabase Auth users.
- **Observed behavior:** the live Supabase security advisor reports that compromised-password checking is disabled.
- **Realistic failure scenario:** an employee reuses a password present in known breach corpora; credential stuffing succeeds and the attacker inherits the account’s already-broad authenticated data/RPC access.
- **Business impact:** account takeover with a database-wide blast radius amplified by DB-002 and DB-003.
- **Recommended remediation:** enable leaked-password protection, confirm a strong minimum password policy, review MFA/session controls and communicate/reset only where the resulting policy requires it. Treat this as defense in depth, not a substitute for narrowing database authorization.
- **Regression test / verification:** Supabase advisor no longer reports the issue; a controlled test account cannot set a known-compromised test password; login/session/MFA recovery paths still work.
- **Estimated effort:** S (hours plus account-policy communication/testing).
- **Dependencies:** DB-003 containment should happen first because its blast radius is larger.
- **External evidence required:** Auth policy console access and test accounts are required to enable and verify the control; no user password data was inspected.
