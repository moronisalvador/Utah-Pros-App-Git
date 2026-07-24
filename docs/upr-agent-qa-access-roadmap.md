<!--
FILE: docs/upr-agent-qa-access-roadmap.md

WHAT THIS DOES (plain language):
  Defines the evidence-backed plan for giving automated QA agents controlled browser access to UPR.
  It sets the safety gates, test layers, role journeys, environment boundaries, and owner decisions
  required before an agent may perform any write-capable workflow.

DEPENDS ON:
  Internal: AGENTS.md, CLAUDE.md, docs/testing-and-deployment.md,
            docs/auth-and-authorization.md, docs/architecture.md,
            .claude/rules/upr-agent-qa-access-ownership.md
  Data:     reads  → repository and read-only catalog evidence
            writes → planning documents only

NOTES / GOTCHAS:
  - This plan does not authorize user creation, database writes, provider calls, deployment, or secrets.
  - dev.utahpros.app and utahpros.app currently share the production Supabase project.
  - Encircle implementation landed at 0a06a21, but its migration remains unapplied and rollout OFF.
-->

# UPR Agent QA Access and Test Foundation Roadmap

Status: active; P1 credential-free internal foundation verified, P2a/P2b external gates remain

Planning capture: 2026-07-23

Implementation status: P1 complete; P2a refusal scaffold complete but database execution blocked

Implementation base: clean `dev` at `848230d`; later reconciled with current `origin/dev`

Companions:
[`upr-agent-qa-access-dispatch.md`](upr-agent-qa-access-dispatch.md) and
[`.claude/rules/upr-agent-qa-access-ownership.md`](../.claude/rules/upr-agent-qa-access-ownership.md)

## Decision summary

The safe sequence is:

1. install a credential-free localhost browser/test harness;
2. provision a separate Supabase/Auth/Storage project and synthetic role fixtures;
3. deploy a separate QA application environment with no production provider credentials;
4. add server-derived QA lineage, fail-closed side-effect policy, and privacy-safe telemetry;
5. allow isolated draft writes;
6. enable one provider sandbox at a time.

Until gates 2–4 pass, authenticated write-capable automation is blocked. The existing `dev`
deployment is not a safe write target because `dev` and production share Supabase. Production remains
read-only smoke only in every phase.

P0 remained documentation-only. On 2026-07-23 the owner opened the exact P1/internal F3a scope:
credential-free test configuration, deterministic mocks, local-only browser guards, fail-closed
database-runner refusal, artifact scanning, and CI. That work created no user, hosted resource,
schema change, credential, deployed browser session, outbound message, provider call, money action,
or production data access. Exact execution evidence and remaining P2 gates are recorded in
`docs/audit/2026-07/evidence/isolated-qa-figma-internal-foundation-2026-07-23.md`.

## Encircle handoff snapshot

The QA artifacts are rebased onto Encircle commit `0a06a21`, which the owner reports is committed and
pushed to `origin/dev` with CI and Cloudflare staging passed. Repository inspection confirms that
commit contains the managed-credential implementation, tests, pending migration/rollback, and updated
canonical documents.

The rollout is deliberately still dark:

- `20260723_encircle_managed_credentials.sql` is authored but unapplied;
- `feature:encircle_managed_credentials` remains OFF because its seed migration is unapplied;
- no Encircle candidate credential was entered, rotated, revoked, or otherwise changed;
- existing environment credentials remain the compatibility fallback;
- the owner-confirmed legacy Netlify Demo Sheet is obsolete and unsupported, not a supported QA or
  credential-cutover dependency.

Landing the Encircle code clears the former planning-file collision, but it does not open any QA
implementation or write-capable automation phase. P1 and later still require explicit owner
authorization, current read-only verification of the Encircle rollout state, and exact shared-file
ownership.

## Evidence boundary

### Current repository facts

| Fact | Evidence | Planning consequence |
|---|---|---|
| CI runs Vite build and Vitest, but no browser suite | `package.json:6-12,42-53`; `.github/workflows/ci.yml:44-84`; `docs/audit/2026-07/maintainability.md:95-107` | Playwright, visual, accessibility, and deployed smoke are new foundations, not existing capabilities |
| Database suites self-skip without credentials and many mutate | `.github/workflows/ci.yml:47-57`; `docs/audit/2026-07/maintainability.md:109-121`; representative `supabase/tests/crm_manual_lead.test.js:20-97` | Split unit/worker/database lanes; DB tests must refuse the shared project |
| Vite localhost proxies `/api` to Wrangler, while many service-role Workers cannot complete locally | `vite.config.js:16-23`; `.claude/launch.json:4-22`; `CLAUDE.md:111-130` | Local tests prove UI/mocked contracts, not deployed Worker/provider behavior |
| Auth resolves the browser employee by email, while Workers resolve by `auth_user_id` | `src/contexts/AuthContext.jsx:200-220`; `functions/lib/auth.js:87-105` | Each QA identity needs a matching Auth user and employee row across both keys |
| Owner is a hard-coded email identity, not a role | `src/lib/owner.js:21-31` | No synthetic owner automation until a non-production owner capability is designed |
| `is_external` is reporting metadata, not authorization | `supabase/migrations/20260701_crm_partner_role.sql:19-23` | It cannot be reused as the QA safety marker |
| Client feature flags and navigation are not server authorization | `src/contexts/AuthContext.jsx:318-360`; `src/App.jsx:168-220,346-381`; `docs/auth-and-authorization.md:24-65` | Negative QA includes direct URLs, Workers, RPCs, and PostgREST |
| Shared auth helpers do not independently reject inactive employees | `src/contexts/AuthContext.jsx:207-230`; `functions/lib/auth.js:90-105` | Active-membership enforcement and session-revocation tests are prerequisites |
| Several messaging and money Workers accept any valid user session | `functions/api/send-message.js:47-60,171-180`; `functions/api/qbo-charge.js:22-31,65-83`; `functions/api/stripe-pay-link.js:14-39` | A role name or hidden UI cannot make QA identities harmless |
| Client crash reporting is console-only; Worker run logging is best effort | `src/components/ErrorBoundary.jsx:20-27`; `functions/lib/worker-runs.js:31-35,48-72`; `docs/audit/2026-07/maintainability.md:152-165` | Privacy-safe, correlated observability must exist before writes |
| Accessibility, visual, lifecycle, and 390px checks are standards but not executable gates | `.claude/rules/close-out-standard.md:24-51`; `.claude/rules/page-lifecycle.md:73-77`; `docs/audit/2026-07/accessibility-compliance.md:10-23` | The first browser foundation must turn these into repeatable evidence |

### Read-only live refresh

A non-sensitive Supabase catalog query on 2026-07-23 at 18:29 UTC confirmed:

- project `glsmljpabrwonfiltiqm` remained `ACTIVE_HEALTHY`;
- enum roles were `admin`, `office`, `project_manager`, `field_tech`, `estimator`, `supervisor`,
  and `crm_partner`;
- employee aggregates were 21 total, 18 active, 14 Auth-linked, 6 external, and one likely
  test-marked row;
- no current employee row used `office` or `estimator`, despite those enum values;
- `feature:billing` and `page:crm` were enabled, `feature:twilio_live` was disabled, and
  `offline:queue` remained disabled/dev-only;
- catalog counts remained 130 public tables and 225 policies;
- the live migration head captured read-only remained
  `20260722232222 crm_caller_name_follows_merge`; the later Encircle migration is present in source
  at `0a06a21` but remains unapplied per the owner and current canonical documentation.

This aggregate refresh did not read identities, business rows, logs, secrets, or provider state.
Feature flags are current observations, not safety guarantees.

### Dated audit facts still requiring containment

The July live evidence found broad authenticated/anonymous policies, widespread authenticated
execution of privileged functions, and authenticated access to `exec_read_sql`:
`docs/audit/2026-07/evidence/live-supabase.md:39-114`. Those findings mean a synthetic identity in
the shared project is not isolated from production data.

**Dated status correction — 2026-07-23:** the `exec_read_sql` sentence above describes the
2026-07-22 snapshot, not current access. Foundation F1 applied
`20260723221707 exec_read_sql_containment`; fresh catalog evidence on 2026-07-23 confirms
`PUBLIC`, `anon`, and `authenticated` are denied while `service_role` remains executable. The
remaining broad-policy findings still block shared-production QA writes. See
`docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md` and the fresh generated RPC
inventory.

## Threat model and non-negotiable boundaries

### Assets being protected

- real customer, employee, claim, job, message, billing, and credential data;
- production SMS/email/push recipients and sender reputation;
- Stripe, QuickBooks, Intuit Payments, and bank/accounting state;
- production Auth sessions and human browser profiles;
- provider credentials, OAuth tokens, storage state, signed URLs, and capability tokens;
- production availability and shared migration history.

### Adversary and failure cases

The plan assumes an automation bug, stale test, prompt injection in rendered content, compromised
storage state, accidental redirect, overly broad CDP command, retry, cron/trigger continuation, or
misbound provider credential can occur. Safety must survive those failures without relying on an
agent remembering not to click a button.

### Always forbidden

- attaching CDP to a human Chrome profile;
- wildcard origins such as `localhost:*`, `*.utahpros.app`, or `*.pages.dev`;
- committing credentials, Auth state, traces containing bearer material, or real identities;
- using `dev` or production for mutation-heavy DB/browser tests;
- treating `is_external`, feature flags, route hiding, consent, or naming prefixes as QA containment;
- falling back from missing QA configuration to production credentials;
- enabling write automation while the side-effect decision or audit record is unavailable;
- synthetic owner impersonation using the real owner email.

## Browser and full-CDP access design

### Separate navigation and network policies

The browser boundary has two independent allowlists:

1. **Top-level navigation allowlist**
   - exact localhost origins and ports owned by the test run;
   - the exact dedicated QA UPR origin once provisioned;
   - `https://dev.utahpros.app` and `https://utahpros.app` only for explicitly read-only smoke.
2. **Network egress allowlist**
   - the selected top-level origin;
   - the exact isolated QA Supabase origin;
   - only the provider sandbox endpoints required by the current provider phase;
   - no arbitrary IP literals, private-network targets, wildcard preview domains, or production
     provider endpoints.

Application CORS in `functions/lib/cors.js:5-23` is not a browser-control boundary.

### CDP launcher requirements

- launch a dedicated, empty, per-run profile outside the repository;
- prefer `--remote-debugging-pipe`, which exposes no listening TCP socket;
- if TCP CDP is unavoidable, put the loopback/random port behind an authenticated broker or
  process ACL; loopback alone does not exclude other local processes;
- never reuse the default Chrome user-data directory;
- expose CDP only to the test process and terminate the browser at run end;
- reject unexpected main-frame navigation, redirects, popups, new targets, downloads, uploads,
  workers, service workers, WebSockets, and `file:`, `data:`, `javascript:`, extension, or custom URLs;
- enforce network policy outside page code as the primary barrier; Playwright routing is defense in
  depth, not the only control;
- log only normalized origin decisions, never query strings or headers.

### Browser acceptance criteria

- an attempted navigation, popup, WebSocket, worker request, and download to a disallowed target is
  denied and produces a redacted event;
- pipe mode exposes no debug socket; a TCP fallback rejects both non-loopback callers and an
  unauthorized second local process;
- the profile contains no pre-existing cookie, extension, history, or credential;
- production automation uses only a versioned semantic allowlist of public, proven read-only
  endpoints; method alone is not classification because Auth refresh and read-only RPCs can use POST;
- authenticated production smoke remains manual until a production-specific read-only
  identity/capability exists;
- public production smoke proves no durable row/event count or fingerprint changed before/after;
- the final diff and retained artifacts contain no cookies, Authorization headers, tokens, or
  storage-state content.

## QA identity and authorization model

### Proposed isolated identity matrix

| Fixture | App role/capability | Purpose | Current limitation |
|---|---|---|---|
| `qa_admin` | `admin`, non-owner | admin settings, access management, safe draft workflows | must not pass owner-only email checks |
| `qa_office` | `office` | customer/job/claim/schedule office workflow | role exists but had zero current live employees at capture |
| `qa_pm` | `project_manager` | assigned production/job oversight workflow | needs explicit assignment fixtures |
| `qa_tech` | `field_tech` | `/tech` mobile appointment/task/photo-mock workflow | real camera/native behavior remains device-gated |
| `qa_restricted` | `crm_partner` or explicit deny overrides | direct-route and cross-domain negative authorization | `crm_partner` has special client and RLS behavior |
| `qa_no_employee` | valid Auth user, no employee | employee-membership denial | must return 403 before data/provider access |
| `qa_inactive` | Auth-linked inactive employee | session/deactivation denial | current shared auth helpers need hardening |
| `qa_expired` | expired/revoked state | refresh and 401 behavior | generated per run; never stored |

`supervisor` and `estimator` are second-wave identities after the five requested representative
workflows. “Owner/admin” splits into automated `qa_admin` plus an owner-only manual gate. A safe
synthetic owner requires an explicit capability design; the real owner account is never persisted in
automation state.

### Trusted QA classification

Future implementation must resolve QA status server-side from immutable Auth/application state. A
request body, JWT `user_metadata`, employee name, email prefix, or `is_external` flag is not trusted.

The classification contract includes:

- active employee membership;
- QA environment/project identity;
- QA role fixture key;
- current `qa_run_id`;
- allowed action classes;
- expiry/revocation time.

The same QA lineage must attach to every synthetic root and asynchronous descendant: contacts,
claims, jobs, appointments, conversations, messages, sign requests, invoices, payments, scheduled
work, events, webhooks, and provider attempts. Missing or mixed lineage fails closed.

### Authorization acceptance matrix

Every sensitive workflow tests:

- missing, malformed, expired, and revoked tokens;
- valid Auth user with no employee;
- inactive employee;
- each wrong role and the allowed role;
- direct URL, Worker, RPC, and PostgREST access;
- feature-flag success, denial, and load failure;
- same-role wrong assignment/owner/organization;
- QA actor targeting production lineage and production actor targeting QA lineage;
- zero provider calls and zero durable business mutations on every denial.

## Structural side-effect containment

### Why current gates are insufficient

- manual and scheduled SMS use separate call paths; scheduled processing can call Twilio directly;
- automated SMS has a global switch, but automated email does not share it;
- transactional/e-sign/report/demo emails call email helpers directly;
- QBO operations can create accounting records or cause QBO email;
- Stripe mode follows whichever key resolves, and DB credential lookup can fall back to env;
- cron, triggers, queues, and webhooks may execute without the initiating user session.

Consent, DND, quiet hours, suppression, role checks, and idempotency remain required. They do not
replace QA containment.

### Central side-effect policy

Every provider adapter must require a trusted decision before making an outbound call:

```text
environment + actor class + active membership + record lineage + action class
  + provider mode + destination/account allowlist + qa_run_id
    -> deny | simulate | sandbox
```

There is no `live` outcome for a QA actor or QA record. Missing lineage, configuration, telemetry,
provider-mode proof, or allowlist membership returns deny.

The policy is enforced:

- before provider credential resolution;
- again inside the provider adapter;
- again when asynchronous work resumes from durable data;
- at webhook intake using provider account/realm/mode metadata.

Production credential fallback is prohibited in QA even when the database or config lookup fails.

### Side-effect registry and completeness gate

A versioned registry must enumerate every path capable of external or durable effects:

- direct provider URLs and raw outbound `fetch`;
- email, SMS, push, Stripe, QBO/Intuit, Storage, OAuth, and upload helpers;
- QBO-generated email;
- `pg_net`, database triggers, cron, queues, scheduled work, and webhooks.

Each entry names its actor/lineage source, adapter/policy enforcement point, provider mode, idempotency
contract, tests, and owner. CI fails on an unregistered provider import, direct egress URL, or new
side-effect path. The QA egress boundary still blocks a missed path; the registry is not the only
defense.

### Messaging containment

- one independent QA outbound kill switch covers manual, group, scheduled, sequence, automation,
  campaign, digest, transactional, e-sign, report, demo-sheet, QBO-generated email, push, and
  notification-trigger paths;
- synthetic contacts may reference only immutable owner-approved sink labels;
- Twilio QA uses test credentials/magic inputs or a dedicated test account that cannot reach live
  numbers; Twilio notes test credentials do not send real messages or update production state:
  <https://www.twilio.com/docs/iam/test-credentials>;
- Resend QA uses documented test recipients such as `delivered@resend.dev`,
  `bounced@resend.dev`, and `complained@resend.dev`:
  <https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing>;
- consent, DND, STOP/START/HELP, quiet-hours, suppression, retry, and webhook cases still run in
  simulated/sandbox mode;
- raw recipients and message bodies never enter retained QA artifacts.

### Money and accounting containment

- QA is denied before tokenization, Checkout creation, charge, payout, refund/dispute reversal,
  QBO create/update/delete/send, or cross-provider mirroring unless the selected phase has positively
  attested sandbox mode;
- Stripe requires test keys, test webhook secret, and account-mode assertion; real card details are
  forbidden. Stripe requires test keys for test cards:
  <https://docs.stripe.com/testing>;
- QuickBooks requires Development credentials, a sandbox company/realm allowlist, sandbox base URL,
  and sandbox callback; Intuit sandbox companies are test-only:
  <https://developer.intuit.com/app/developer/qbo/docs/develop/sandboxes/manage-your-sandboxes>;
- Intuit Payments uses its sandbox/mock payment data only:
  <https://developer.intuit.com/app/developer/qbpayments/docs/workflows/test-your-app>;
- stable run/content-derived idempotency keys have no timestamp/random fallback for money;
- a durable attempt exists before the external call, and failure injection proves provider success
  followed by local failure/retry yields one provider action and one reconciled local result;
- QA Stripe and QBO webhooks cannot share production secrets, ledgers, realms, or downstream
  credentials.

## Minimum privacy-safe observability before writes

### Required event fields

- event ID, `qa_run_id`, release SHA, environment, workflow, step, route;
- internal actor UUID or fixture key and role class, never login email;
- action class, record lineage, provider, provider mode;
- decision (`deny`, `simulate`, `sandbox`) and reason code;
- hashed stable idempotency key, attempt/retry count, provider request/event ID;
- outcome, latency, cleanup status, timestamps.

### Prohibited by default

Names, email addresses, phone numbers, street addresses, message bodies, file contents, signer data,
card/bank details, credentials, cookies, Authorization headers, raw provider payloads, signed URLs,
capability tokens, and unrestricted stack traces.

Destinations are recorded only as keyed hashes plus approved labels. Monetary amount is omitted or
bucketed unless the owner/privacy review explicitly approves storage.

### Reliability and alerts

- dangerous actions require a durable pre-side-effect decision/attempt row; failure to record it
  fails closed;
- client telemetry may remain best effort, but it cannot authorize a write;
- alert on QA-to-production attempts, production credentials in QA, policy denials, provider/local
  reconciliation gaps, mode/realm mismatch, divergent payload for a reused idempotency key, and
  scheduled failure;
- one synthetic failure must produce one redacted event and one tested alert;
- owner approves retention, access, incident routing, and whether a vendor/DPA/privacy-notice update
  is required.

## Authenticated Playwright storage-state handling

Playwright recommends ignoring authenticated state because it may contain impersonation-capable
cookies and headers: <https://playwright.dev/docs/auth>.

UPR requirements are stricter:

- generate one state per role and per run after secret-injected login;
- save outside the repository in an ACL-restricted temporary directory;
- assert expected QA project, fixture identity, role, active status, and expiry after login;
- never persist a real owner session;
- never upload state as an artifact or embed it in traces, screenshots, video, HAR, logs, or reports;
- redact cookies and Authorization headers before retaining any network evidence;
- use short TTLs, revoke/sign out identities, delete states at job end, and scan the workspace and
  proposed diff for bearer material;
- prove refresh-token reuse fails after revocation and that already-issued access tokens either fail
  through an evidenced server-side revocation check or expire within an owner-approved bounded TTL;
- deleting a state file is cleanup, not token revocation;
- fail if the state is reused across roles or environments.

No `.env`, storage-state, or credential file is created during this planning initiative.

## Test data, seed, and cleanup strategy

### Shared project

No automated synthetic writes. On `dev`/production, permit only read-only/minimally mutating smoke
that is separately reviewed and cannot send, charge, schedule, upload, or alter business state.

### Local Supabase

Use a clean local stack to:

- apply migrations from zero;
- test schema, functions, triggers, grants, RLS, role/assignment negatives, and rollback;
- inject failures deterministically;
- export migration head and catalog fingerprint.

Limitations: local Supabase does not prove Cloudflare bindings, provider OAuth/webhooks, deployed
headers/CORS, managed Auth settings, production Realtime/Storage configuration, native behavior, or
provider console state.

### Deployed isolated QA

Use a separate Supabase/Auth/Storage project and separate Cloudflare QA deployment. Seed only
synthetic records with immutable `qa_run_id` lineage. Do not copy production rows or identities.

Seed properties:

- idempotent, versioned fixture manifest;
- reserved synthetic content and approved sink labels;
- dedicated assignment graph for each role;
- cron/triggers/realtime disabled or QA-aware until their lineage tests pass;
- no production provider IDs, recipients, tokens, or Storage objects.

Cleanup properties:

- select/count preview before deletion;
- operate only by immutable run ownership, never fuzzy name/email prefixes;
- refuse untagged/mixed-lineage rows;
- delete in dependency order, remain idempotent, and have a TTL janitor;
- produce a redacted residual report and pass at zero;
- quarantine and alert instead of broad-deleting if ownership is ambiguous.

Browser/API workflows cannot rely on transaction rollback; cleanup is a first-class tested workflow.

## First representative workflows

All workflows begin read-only or mocked. Draft writes open only in isolated QA after the write gate.

### Owner/admin

- `qa_admin` logs in, verifies admin navigation and Team/Access read views, then creates/edits a
  synthetic draft-only configuration record in the isolated phase.
- direct negative: `qa_office`, `qa_pm`, `qa_tech`, and `qa_restricted` receive server-side denial.
- owner-only route/control stays manual and must reject `qa_admin`; no real owner state is automated.

### Office

- find a synthetic contact, open its synthetic claim/job, inspect schedule, create or update a
  synthetic draft note/appointment after write gate, and verify loading/error/empty/stale recovery.
- assert no notification, calendar event, QBO sync, SMS, email, or push is emitted.

### Project manager

- view an assigned synthetic job/claim and schedule, update one isolated draft assignment/status
  after write gate, and confirm a same-role unassigned record is denied.
- direct Worker/RPC/PostgREST assignment negatives accompany UI checks.

### Technician

- at 390px, open `/tech`, view assigned synthetic appointment/tasks, exercise mocked photo/upload and
  note UI, background for more than 30 seconds, then resume with route, scroll, form input, timer, and
  stale data preserved.
- real camera, geolocation, haptics, push, WKWebView lifecycle, and VoiceOver are owner-device gates.

### Restricted and negative authorization

- `qa_restricted` exercises allowed CRM/help paths and denied direct URLs outside scope;
- missing/expired token, no employee, inactive employee, wrong role, wrong assignment, feature-load
  failure, and mixed-lineage cases;
- every denial asserts zero provider calls, zero business mutations, and a redacted decision event.

## Visual, accessibility, mobile, and lifecycle matrix

- deterministic data, clock, locale, fonts, viewport, and animation policy;
- desktop office shell plus 390px tech and office shells with specified height, DPR, and touch mode;
- light/dark where the surface supports both;
- screenshot baselines generated/reviewed in the pinned CI image; never auto-update on failure;
- animation-disabled screenshots and targeted CSS assertions;
- axe serious/critical violations blocking on critical routes;
- keyboard order, visible focus, dialog trapping/return, status announcements, reduced motion,
  200% zoom/reflow, and horizontal-overflow checks;
- loading, error, empty, stale-data-with-banner, retry, offline/network-loss, and recovery fixtures;
- hidden for more than 30 seconds, then resume with route, scroll, filters, form input, and rendered
  content preserved; browser eviction/reload is a separate scenario;
- failure artifacts are privacy-scanned before retention.

Chromium emulation is not evidence of iOS Safari/WKWebView feel. Real iPhone, VoiceOver, camera,
location, haptics, push, safe areas, and installed-app lifecycle remain explicit owner gates.

## Phased implementation and acceptance

### P0 — Decision and threat-model gate

Scope: review these artifacts; choose isolation, domains, provider posture, telemetry, retention, and
ownership. No runtime changes.

**Repository outcome (2026-07-23):** complete as a decision package. The addendum fixes the safe
architecture, supersedes the shared-production test-auth proposal in `3841056`, and names every
remaining owner/external choice. It does not claim those external choices are approved or configured.

Acceptance:

- [x] exact environment model and production read-only rule recorded;
- [ ] owner assigns paid/external accounts and resource owners;
- [x] Encircle dark-rollout freeze/handoff boundary preserved;
- [x] unresolved decisions recorded rather than assumed.

### P1 — Credential-free local test foundation

Scope: explicit Vitest partitions/excludes; Playwright/axe config; mocked browser workflows;
navigation/egress guard; loopback CDP launcher; artifact redaction; no login credentials or live calls.

**Repository outcome (2026-07-23):** complete for the internal credential-free scope. The browser
matrix is deterministic synthetic-fixture evidence, not real UPR, hosted-QA, provider, native, or
pinned-Linux screenshot evidence.

Acceptance:

- [x] `test:unit` and mocked Worker lane make no network calls;
- [x] test discovery excludes worktrees/generated output;
- [x] localhost desktop/390px workflows cover loading/error/empty/resume and accessibility;
- [x] disallowed navigation/egress tests pass;
- [x] zero secrets or Auth state in diff/artifacts;
- [x] every credential-free lane fails on zero discovery or any skip/todo.

### P2a — Local database contract foundation

Scope: clean local Supabase; migrations from zero; RLS/RPC/trigger/rollback and failure-injection
tests; no hosted identities, storage state, deployed application, or provider calls.

**Repository outcome (2026-07-23):** target-policy and runner refusal scaffold complete. Execution
is blocked because no governed `supabase/config.toml`, local CLI/runtime, deterministic database
seed, or representative-role fixture exists. No database lane was reported as passed or skipped.

Acceptance:

- [x] local sentinel and known-shared-project refusal pass;
- [ ] zero unexpected DB-test skips;
- [ ] migration head/catalog fingerprint recorded;
- [ ] role/assignment/active-status database contracts pass;
- [ ] local seed and cleanup are idempotent with zero residual.

### P2b — Hosted isolated data and identity foundation

Scope: separate hosted Supabase/Auth/Storage project; role identities; immutable QA lineage;
versioned seed/cleanup; direct Auth/RLS/RPC/PostgREST tests.

Acceptance:

- exact hosted QA project-ref sentinel prevents shared-project execution;
- the project contains no production row, identity, credential, or Storage object;
- role, assignment, active status, revocation, and expiry matrix passes;
- seed and cleanup are idempotent with zero residual;
- P2b, not P2a alone, is the prerequisite for deployed P3 authentication/storage state.

### P3 — Isolated deployment, containment, and observability

Scope: dedicated QA Cloudflare deployment/domain; separate bindings; short-lived storage states;
central side-effect policy; provider calls simulated/denied; durable redacted event/alerts.

Acceptance:

- QA environment cannot resolve production provider credentials;
- every sensitive adapter denies QA-to-production before provider/business mutation;
- async lineage survives scheduler/queue/webhook hops;
- synthetic failure yields one redacted event/alert;
- storage states expire, revoke, delete, and never appear in artifacts.

### P4 — Isolated draft-write workflows

Scope: allow only non-provider draft writes for the five representative roles.

Acceptance:

- every allowed write is synthetic, lineage-tagged, idempotent, and cleaned;
- mixed lineage and all unauthorized roles are denied;
- side-effect spies remain at zero;
- visual/a11y/mobile/lifecycle matrix passes;
- shared `dev` and production remain read-only.

### P5 — Provider sandboxes, one at a time

Order: Resend test recipients, Twilio test path, Stripe test mode, Intuit/QBO sandbox, then other
providers only after an explicit plan. Encircle remains excluded until the owner separately approves
a sandbox/mock strategy and verifies the dark rollout state.

Acceptance per provider:

- account/key/realm/webhook mode is positively attested without exposing values;
- QA cannot load or fall back to production credentials;
- only approved sink/account targets are accepted;
- retries/idempotency and provider-success/local-failure are tested;
- wrong-mode webhook is rejected before mutation;
- owner/provider console evidence is captured.

Twilio test credentials prove request validation and simulated success/failure only: they do not
send a real message or generate normal status callbacks. Delivery, callback, and provider-success
reconciliation remain blocked until the owner approves a dedicated test account plus controlled sink.

### P6 — Release gates and gradual expansion

Scope: CI orchestration, redacted artifact retention, read-only post-deploy smoke, branch protection
evidence, and expansion to supervisor/estimator/native flows.

Acceptance:

- blocking unit/worker/isolated-DB/browser/a11y lanes have explicit skip reporting;
- public production smoke stays within its reviewed semantic allowlist and proves no durable
  row/event fingerprint change;
- current external configuration is evidenced, not inferred from repository declarations;
- native/device matrix is recorded separately;
- rollout/rollback and incident owners are named.

## Ownership and disjointness

The binding ownership file is
[`.claude/rules/upr-agent-qa-access-ownership.md`](../.claude/rules/upr-agent-qa-access-ownership.md).

Planning is disjoint now because it adds only these three new files on top of `0a06a21`. Future
implementation is not automatically disjoint: it will likely need `package.json`, lockfile, test
config, CI, auth/provider libraries, Cloudflare variables, migrations, and canonical docs. Those are
shared hotspots.

The Encircle implementation lane has landed, but its rollout is still incomplete and external-state
gated. Until a later QA phase is explicitly opened:

- no application, Worker, migration, shared library, CI, dependency, or existing canonical file is
  edited by this initiative;
- all Encircle pages, Workers, migrations, provider references, and shared hotspots remain frozen;
- P1 or later may start only after a fresh read-only check of the migration, flag, credential, CI,
  and staging state plus an exact ownership checkpoint;
- Encircle workflows remain mocked/excluded until the owner approves integration coverage and its
  sandbox/mock policy.

## Owner, paid-account, and external gates

| Gate | Owner action / possible cost | Needed before |
|---|---|---|
| Supabase isolation | approve budget; create dedicated QA project; assign Auth/Storage/project owners | P2b |
| QA identities | approve fixture roles, synthetic owner limitation, TTL/revocation policy | P2b |
| Cloudflare QA | create dedicated QA project/domain and bindings; prove Preview/Production separation | P3 |
| Browser/CDP | approve exact origins/ports, runner host, egress enforcement, artifact retention | P1/P3 |
| Telemetry | choose first-party/vendor, DPA/privacy posture, retention, access, and alert destination | P3 |
| GitHub | approve secrets, protected environments, branch checks, artifact retention | P3/P6 |
| Twilio | supply test credentials/subaccount strategy and approved sink semantics; decide status-callback limitation | P5 |
| Resend | supply QA key/domain/webhook strategy and approve documented test recipients | P5 |
| Stripe | supply test keys/account, webhook endpoint/secret, and test payout limits | P5 |
| Intuit/QBO | supply Development app credentials, sandbox company/realm, callbacks, Payments scope | P5 |
| Apple/Capgo | Apple enrollment/signing/device access; Capgo plan upgrade if OTA testing is required | P6 |
| Legal/privacy | approve telemetry/data-retention and WCAG target/device matrix | P3/P6 |
| Encircle | reverify `0a06a21` rollout state; keep migration unapplied/flag OFF/credentials unchanged unless separately authorized; choose later sandbox/mock coverage | before P1 or any Encircle QA |

Repository declarations do not prove any provider, Cloudflare, GitHub, Apple, or paid-account gate is
currently configured.

## Definition of ready for write-capable automation

Write-capable QA remains blocked until all are true:

- separate Supabase/Auth/Storage and Cloudflare QA environments;
- active-role fixtures with server-derived QA/run lineage;
- direct UI/Worker/RPC/PostgREST negative matrix;
- fail-closed side-effect policy before every provider adapter and async hop;
- production credentials unreachable from QA;
- durable redacted pre-side-effect event and tested alerts;
- short-lived uncommitted storage state;
- idempotent seed/cleanup with zero residual;
- provider sandbox positively attested for the action being tested;
- Encircle/shared-hotspot ownership and dark-rollout state reverified;
- owner explicitly opens the relevant phase.
