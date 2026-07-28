<!--
FILE: docs/testing-and-deployment.md

WHAT THIS DOES (plain language):
  Explains how UPR is checked and released, which tests are safe in each environment, and what must
  be verified before claiming a change is done. It distinguishes repository checks from live proof.

DEPENDS ON:
  Internal: package.json, vite.config.js, .github/workflows/, CLAUDE.md,
            .claude/rules/close-out-standard.md, docs/tooling-governance.md,
            tooling/capabilities.json
  Data:     reads → build/test/configuration evidence
            writes → documentation only

NOTES / GOTCHAS:
  - Staging and production currently share Supabase.
  - A green build can exist with missing runtime variables; deployment smoke evidence still matters.
-->

# Testing and Deployment

## Local commands

| Command | Purpose | Important limitation |
|---|---|---|
| `npm run build` | Production Vite compilation and asset generation | Does not prove runtime variables, Workers, native behavior or live integrations |
| `npm test` | Credential-free unit, Worker-contract and QA-policy Vitest lanes | Network and provider egress are blocked; each lane fails on zero discovered tests or any skip/todo |
| `npm run test:browser` | Guarded Playwright desktop/390px synthetic fixture matrix plus retained-artifact scan | Exact local origin only; no hosted QA, real account, production data or provider proof |
| `npm run test:db:local` | Isolated database runner contract | Refuses to start without the exact local origin/ref/sentinel; no governed local Supabase runtime exists yet |
| `npm run lint` | Repository ESLint | Current scope/debt may include non-product tooling; report actual result and lint changed product files |
| `npm run validate:provenance` | Checks recent live-ledger evidence against reviewed source reachable from `HEAD` | Evidence must be refreshed read-only within six hours; this command never queries or writes Supabase |
| `npm run test:provenance` | Exercises ledger, origin-blob, freshness, ancestry, function and policy drift failures | Pure Node fixtures; no network/database |
| `npm run preflight:mobile` | Checks mobile program files, branch safety, Node/dependencies, neutral adapter drift and optional native/delivery tools | Reads local metadata only; warnings name optional or not-yet-required gates |
| `npm run generate:tooling` | Regenerates governed Claude Code/Codex adapters from the neutral sources in `tooling/` | Repository write only; inspect the generated diff and never hand-edit an adapter |
| `npm run check:tooling-generated` | Fails when a governed adapter is missing or differs from its neutral source | Covers only capabilities listed in `tooling/capabilities.json` — 12 of 44 tracked capability entrypoints today |
| `npm run validate:tooling` | Checks capability metadata, references, triggers, portability, generated adapter parity and shared permissions | Known findings stay warnings until their dated waiver expires; this does not prove application, production, device or provider behavior |
| `npm run test:tooling` | Exercises neutral renderer drift/runtime metadata, routing contracts, mobile preflight safety and governance failures | Decision fixtures are contracts; fresh runtime evaluation is still required before expanding the neutral inventory |
| `npm run dev` | Frontend development server | `/api/*` needs a separate Wrangler Pages Functions process |
| `npm run build:ios` | Native-target build and Capacitor sync | Still does not replace Xcode signing/simulator/device verification |

Never report expected results as executed results. Record command, commit, environment and failures.
Credential-free lanes scrub hosted/provider environment variables and use deterministic fixtures;
they never reinterpret missing configuration as permission to use production.

Use Node 22 from `.node-version`, matching CI, and install the lockfile with `npm ci`. Do not replace
repository dependencies with global Vite, Capacitor, test-runner, or Fastlane installations.

## Test layers

- **Pure unit:** deterministic helpers and rules; no network/database. Blocking and safe everywhere.
- **Worker unit/contract:** mock auth, providers and Supabase; assert negative authorization, timeout,
  idempotency and response contracts.
- **Database contract:** migrations/RPC/RLS/triggers against an isolated database with representative
  roles. Do not point mutation-heavy CI at the shared production project.
- **Browser end-to-end:** representative role journeys on a seeded, isolated/deployed environment.
- **Accessibility:** static/aXe checks plus keyboard, zoom/reflow and VoiceOver/manual evidence.
- **Provider sandbox:** payment, messaging, OAuth and webhook behavior without production effects.
- **Native:** Xcode build/sign, simulator and real-device checks for camera, location, push, biometrics,
  safe areas, lifecycle and OTA behavior.
- **Production smoke:** read-only/minimally mutating health, authentication, configuration and critical
  route checks after deployment.

## Required risk tests

- Sensitive endpoints: missing token, unknown/inactive employee, wrong role and allowed role.
- Money: cent rounding, stable idempotency, concurrent retry, partial failure and reconciliation.
- Messaging: consent, DND, STOP/START/HELP, quiet hours, suppression and retry classification.
- Database: intended and denied roles, RPC signature compatibility, trigger invariants and rollback.
  For a reporting/timeline function assembled as a stack of `UNION ALL` arms and grown by repeated
  function-body-only `CREATE OR REPLACE` migrations, add a durable guard that seeds every arm and
  asserts each still returns at least one row — so a rebuild from a stale ancestor cannot silently
  drop a live arm. Precedent: `supabase/tests/crm_contact_activity.test.js` guards all 24 arms of
  `get_contact_activity` (added after a near-miss 2026-07-24 migration would have dropped 11).
- UI: loading/error/empty states, minimize/resume, 390px mobile, keyboard/focus and stale-cache recovery.
- Integrations: missing config, invalid signature/state, duplicate event, timeout/429/5xx and redacted logs.

## CI

`.github/workflows/ci.yml` runs on `dev` and `main` changes. Build and test are intended merge gates;
lint and bundle-size reporting currently provide non-blocking visibility. GitHub branch protection is
external configuration and must be checked before relying on a workflow as an enforced gate.

CI also validates the disconnected Figma permission contract, installs its governed Chromium
runtime, and runs the guarded browser matrix. The custom Vitest and Playwright runners fail if a
lane discovers zero tests or reports any skipped/todo test, and the artifact scanner fails retained
output containing auth material, production identifiers or realistic identity fixtures.

`.github/workflows/ios-release.yml` is a valid `workflow_dispatch`-only scaffold. It must remain
manual-only until Apple enrollment and signing secrets are owner-confirmed. GitHub Actions forbids
using `secrets.*` directly in a step `if`; map the signing gate into job `env` and branch on
`env.APPLE_TEAM_ID`. `scripts/ios-release-workflow.test.js` preserves both boundaries without
dispatching a macOS job, signing an app or contacting Apple.

CI should keep unit and database/browser lanes explicit, report unexpected skips, validate required
environment bindings and retain machine-readable evidence. An isolated database is required before
database mutation tests can safely become a complete blocking gate.

## Isolated QA foundation state

The repository-internal P1/Foundation F3a slice is complete for credential-free execution:

- pure-unit, Worker-contract and QA-policy lanes are partitioned and network-blocked;
- deterministic browser fixtures cover loading, error, empty, stale and ready states, keyboard
  dialog behavior, lifecycle resume, 390px overflow, reduced motion, and serious/critical axe rules;
- production Supabase identifiers/URLs, provider egress, popups, WebSockets, downloads, write
  requests, non-pipe CDP and persistent human profiles are negative-tested refusals;
- ephemeral-profile containment recognizes absolute Windows and POSIX paths explicitly, rejects
  relative or mixed-dialect paths, and applies the same repository/profile rules on local Windows
  and Linux CI;
- retained artifacts are scanned fail-closed and all governed lanes require zero unexpected skips.

This is scaffold and synthetic-browser evidence, not proof of real UPR journeys, native behavior,
provider behavior, production behavior, or a pinned Linux visual baseline. P2a database execution
is externally gated on a reviewed local Supabase config/runtime and deterministic seed/role
fixtures. Hosted QA remains separately gated on a dedicated project, non-production credentials,
allowed origins and provider sandboxes.

## Release flow

- Routine work follows the current branch rules in `CLAUDE.md`; never push directly to `main`.
- `dev` deploys staging. Production is released through the reviewed `dev → main` path.
- Both currently share Supabase, so schema changes use the production apply-window and sequencing
  rules even when application code is staged.
- Do not apply a migration from an unmerged feature commit merely because its SQL is ready. Every
  production migration must map to reviewed source reachable from the designated release branch,
  unless an owner-authorized emergency exception records the commit, reason and reconciliation.
- Wait for Cloudflare checks and perform the appropriate deployed smoke test.
- Native release additionally requires Capgo/Apple/Xcode/TestFlight evidence and owner-controlled
  signing/reviewer credentials.
- Deploy, migration apply, provider mutation, outbound message and money movement require explicit
  authorization; verification does not broaden permission to perform them.

### Static-asset serving contract (2026-07-27)

Two outages on 2026-07-27 came from the same cause: Cloudflare Pages answered a request for a
missing `/app-assets/*` file with the app's `index.html` at **HTTP 200**, and `public/_headers`
marks that directory `immutable` for a year, so the wrong answer was cached under an asset URL.
First occurrence hit a `.js` file (blank screen), second a `.css` file (every page unstyled).

The 200-OK-for-anything-missing behaviour is **built into Pages**, not produced by any rule in
`public/_redirects` — the `/* /index.html 200` catch-all that file used to blame is rejected by
Cloudflare as an infinite loop and was never active. Three rule variants were tried and all three
failed; they are recorded in `public/_redirects`, which is the canonical explanation.

The serving contract now is:

- **`public/404.html` must exist.** Its presence is what disables the built-in fallback. Deleting it
  silently restores the outage.
- **`public/_redirects` lists app route prefixes only, never an asset path.** A rule matching
  `/app-assets/*` rewrites *real* assets to HTML too, because rewrites run before the file lookup.
- Rewrite rules target `/`, never `/index.html`: a splat rule to a `.html` target is dropped as a
  loop, and a splat-free one 308-redirects to `/` and discards the address.
- Adding a route to `src/App.jsx` requires a matching `_redirects` line, or that page's URL returns
  404. `tests/qa/unit/spa-route-coverage.test.js` re-derives the list and fails when one is missing.
- **Behaviour change:** an unknown *top-level* path (`/bogus`) now returns `404.html` instead of the
  app's in-app not-found screen. Unknown paths *below* a known prefix (`/crm/bogus`) still render the
  app, so `<Route path="*">` remains reachable there.
- Verify on a preview before merging any change to these files:
  `node scripts/smoke-deploy.mjs <preview-url>` asserts a missing asset 404s alongside the existing
  boot-graph checks, and the same probe runs every 30 minutes via `.github/workflows/deploy-smoke.yml`.

Prevention does not replace recovery. The boot guard in `index.html` is still required: it repairs a
device already holding a poisoned copy from 2026-07-27, which prevention cannot reach.

## Mobile PWA/Capacitor readiness workflow

`docs/mobile-production-readiness-roadmap.md` is the plan of record for the 37 findings observed at
audited application source `ef305f6d6afab4d846eab92fc1b04038d70221f0`. Until the foundation is
integrated, each wave starts from `codex/mobile-pwa-readiness-foundation` in a new isolated
branch/worktree, fetches current `origin/dev`, and reconciles drift without dropping the foundation.
After integration, current `origin/dev` is the base. Record all relevant SHAs and recapture only the
affected current/live state. The dated audit is not rewritten as later evidence.

Mobile sessions use the checked-in ownership manifest and at most three simultaneous subagents.
Read-only mapping, security review, contract testing, and release audit can overlap when they do not
share a live system, port, simulator, generated output, or source file. Supabase/Storage decisions,
durable account state, shared auth/release/native project files, canonical docs, and other listed
hotspots remain single-writer/serialized.

Any development server, browser, simulator, Xcode build, or persistent child is limited to five
minutes per subprocess. The launcher owns the full child tree, cleans it in `try/finally`, verifies
the port/process is gone, and records the result. Unsigned compilation or simulator launch is not
signed-device, TestFlight, privacy, entitlement, push, deep-link, OTA, or App Review proof.

The initial release promise stays online-first with tested warm continuity. Cold-offline PWA,
admin-mobile in the native binary, native push, and OTA are excluded/disabled until their owner
decisions and roadmap evidence gates are complete. Expanded field use requires zero P0 findings and
closure or explicit exclusion of every P1 within the promise. Live migration/apply, deploy,
provider/customer action, signing, distribution, and submission remain separately authorized
owner gates.

R0's current source/live map and first local authorization slice are recorded in
`docs/audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md`; the source-only S1b QBO
identity slice is recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1b-qbo-identity-2026-07-26.md`. S1b tests the
secret-first customer/payment-sync capability, both payment-sync HTTP methods, the direct
`scheduled()` entry, human-only OAuth state writes, external-admin denial on charge/attach, and
auth/configuration failure paths with zero downstream business/provider calls.

The source-only S1c CallRail/notification slice is recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1c-callrail-notify-2026-07-26.md`. Its focused
contracts cover missing/invalid/config-failed Auth, inactive/external/denied roles, explicit
`crm_call_log`, exact lead/call-ID binding, missing credentials, direct/signed audio streaming and
timeout failures. Notification coverage pins secret-first precedence, in-process/secret payload
compatibility, active-internal-admin Bearer access, allowed object state, forged recipient/body/link
rejection and zero dispatch/provider fan-out on every denial.
The final contract pass also proves a thrown push subscription does not prevent the later
subscription from succeeding or remove the per-channel summary, and positively exercises all four
human HTTP event shapes after exact object proof.

The S1d database-dispatcher apply candidate is recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md`. Its credential-free
contract suite proves exact live-body rollback, one-expression trusted-key hardening,
`PUBLIC`/`anon`/`authenticated` denial, `service_role` retention, six-function/seven-call-site
compatibility, trigger/cron metadata, no in-body role assertion, no browser caller, fail-closed
drift checks, catalog-only pre/post-apply checks, and correct unapplied provenance treatment. The
tests never invoke `notify_emit`, pg_net, a trigger, schedule, Worker, or provider.

The S1f direct-bell apply candidate is recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1f-create-notification-2026-07-26.md`. Its
credential-free contract and catalog-only pre/post scripts pin the unchanged function body,
authenticated denial, service-role retention, and sole owner-run database caller without invoking
`create_notification` or reading notification rows. S1d, S1e, and S1f require separate explicit
apply selections rather than a chronological all-pending command.

The S1g notification read/recipient candidate is recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1g-notification-reads-2026-07-26.md`. Credential-free
CI checks exact RPC signatures/results/defaults, caller reconstruction, foreign-recipient denial,
private broadcast receipts, legacy read compatibility, Realtime RLS, least-privilege ACLs, drift
guards, and the owner-gated unsafe rollback. Preflight/post-apply SQL is catalog-only and does not
read or mark notification rows. The synthetic multi-identity behavior script requires both the
`UPR_ISOLATED_DB` psql variable and `upr.isolated_test_database=on`, and is
transaction-rollback-only. `npm run test:db:local` now runs its exact pgTAP wrapper through
`supabase test db --local` before the DB Vitest lane; the runner never offers `--linked` or
`--db-url`. A temporary PGlite harness passed forward/post/behavior/rollback compilation, but the
governed current-live-compatible local Supabase clone remains an execution gate. The obsolete
anonymous/shared `notify_foundation.test.js` was retired; replacement preference-resolver
integration coverage belongs to the separate identity/device/preferences slice.

**S1e/S1g apply-order prerequisite:** before either target’s own entry gate, separately apply and
verify `20260726180000_mobile_employee_identity_authority.sql`, deploy compatible
browser/PWA/native clients and retire old clients or record the owner’s explicit risk decision,
then separately apply and verify `20260726182000_mobile_employee_identity_containment.sql`. Current
S1e and S1g preflights fail closed unless exactly one live `mobile_employee_identity_containment`
ledger row exists and its browser-read-only employee contract still matches. Recapture that
catalog/ledger state before the target preflight. This prerequisite neither authorizes nor combines
S1e or S1g; each remains its own owner-approved window.

The checksum-pinned operator sequence for all four separately authorized target windows is
`docs/mobile/s1d-s1g-database-apply-runbook.md`. It forbids `supabase db push` and other
all-pending sweeps, requires fresh value-free drift capture and a single exact migration per
window, and keeps catalog proof, synthetic behavior, side-effect approval, rollback consequences,
and close-out evidence explicit. The runbook is preparation only; it is not apply authorization.

A mobile security slice is not releasable merely because mocked Worker tests pass: verify required
runtime binding **names and presence only**, deploy only from a reviewed release commit under
separate authorization, exercise approved allow/deny identities on non-customer fixtures, and
monitor 401/403/5xx/upstream failures. For S1b, canary customer sync and payment polling before
charge/attachment/OAuth paths; do not rotate the shared capability independently. For S1c, canary
one non-customer CallRail fixture through the approved admin and explicit-capability identities,
prove denied internal/external identities, then verify one database-trigger notification fixture
without sending customer communication. Confirm secret **presence/equality only** through the
approved deployment process; never copy its value into evidence.

Authorization rollback normally uses a reviewed forward fix because reverting a gate deliberately
reopens the bypass. An S1c emergency rollback must first disable the affected HTTP entrypoint or
CallRail playback/notification trigger, then revert only the reviewed S1c source commits while
explicitly accepting that any-employee recording or arbitrary-Bearer notification access reopens.
No rollback rotates secrets or changes the shared database by implication. The separate
authenticated `notify_emit` ACL residual now has an authored S1d migration and exact rollback but
still needs its own owner-authorized apply/verification window. Immediately before apply, run
`supabase/tests/notify_emit_service_boundary_preflight.sql` and confirm the reviewed hashes, ACL,
six callers, three triggers, and one cron row. Apply only
`20260726110000_notify_emit_service_boundary.sql` from the reviewed release commit; then run
`supabase/tests/notify_emit_service_boundary_post_apply.sql`, representative role-denial checks,
fresh provenance capture, and database advisors without invoking a real notification. Any
synthetic trigger/service canary requires separate explicit authorization and non-customer
fixtures. Rollback uses the paired SQL only after its forward-body drift guard passes and must
record that authenticated arbitrary-emission capability was re-opened.

The private-media plan is a separate compatibility deployment and serialized live apply. Deploy
dual-form path normalization and authorized delivery before a bucket flip; then recapture exact
policies/grants/bucket metadata, apply in an owner-approved low-traffic window, prove
anonymous/unrelated denial plus intended access, and retain exact pre-apply rollback SQL/settings.
No source-only session authorizes that apply.

## Release evidence checklist

- Exact commit/branch and changed-file scope.
- Build, test and lint commands with real results and known skips.
- Migration name, apply state, role verification, advisor result and rollback readiness.
- Read-only migration-provenance check: new live ledger entries map to files/commits reachable from
  the release ref, and live function/policy fingerprints match the intended migration bodies.
- Provenance evidence is release-scoped: recapture the ledger tail and selected catalog fingerprints
  read-only, record the capture-base commit, and run `npm run validate:provenance` within six hours.
  CI rejects stale evidence, non-ancestor captures, unmapped rows, wrong reviewed origins, and selected
  function/policy drift. A comment-only raw body difference is allowed only when explicitly manifested
  and the normalized executable body still matches.
- Required Preview/Production variables without revealing values.
- Browser/device/provider sandbox evidence proportional to risk.
- Updated canonical documentation and dated audit/addendum when appropriate.
- External/owner gates clearly marked pending rather than implied complete.

Known July 2026 test/deployment gaps are retained in
`docs/audit/2026-07/maintainability.md` and `docs/audit/2026-07/remediation-backlog.md`. Update this
canonical file in the same commit as a test, CI, environment, branch, deployment or release change.

For the public-form RPC boundary, repository tests are static until the owner opens the shared
apply window. Before apply, refresh the exact function/ACL/caller inventory and prove the migration
is reachable from `dev`. After apply, run
`supabase/tests/public_form_rpc_boundary_post_apply.sql`; it must deny `PUBLIC`, `anon`, and
`authenticated` while preserving `service_role`. A controlled end-to-end form submission is a
separate live-write authorization, not part of the ACL apply.

For Encircle rotation, release evidence additionally shows resolver parity across Pages and
`upr-mcp`, failed-candidate/no-write behavior, inactive/wrong-role denial, fallback and explicit
disable behavior, no-cache disable semantics, and token-free status responses. Deploy compatible
code before the inert shared migration, keep the flag default-OFF, and treat candidate entry,
provider rotation/revocation, fallback removal, and retirement of the obsolete Netlify deployment
as separate owner gates.
The apply window must also run `supabase/tests/encircle_managed_credentials.test.js` with
short-lived active-admin and non-admin access tokens; that read-only test proves the replacement
zero-argument status RPC preserves legacy provider rows while enforcing its database admin gate.

## Messaging transport release sequence

The combined Phase 2–4 build is not a one-step deploy:

1. review and deploy authorization plus backward-compatible request-ID acceptance with
   `MESSAGING_SCHEMA_MODE=legacy`;
2. in an owner-approved window, apply and verify the committed messaging migration against the
   intended roles;
3. switch to `MESSAGING_SCHEMA_MODE=foundation` and deploy generic identity/attempt/event writes
   with `MESSAGING_SEND_MODE=disabled`;
4. verify the unconfigured CallRail webhook returns safely and Twilio/CallRail isolation tests pass;
5. keep CallRail activation blocked until isolated PostgreSQL compilation, private MMS/provider
   fixtures, submitted-body/recovery-snapshot retention, and notification-outbox execution pass
   review;
6. configure Preview/provider state and send traffic only under a separate Phase 5 approval.

At no point may worker code that requires a new column/table deploy before that schema exists.
Rollback first sets the mode to `disabled`; code can roll back while additive schema remains.

## Prior SMS consent attestation release sequence

The owner-approved database apply completed on 2026-07-23 from exact reviewed commit
`e71e759b27b1da1fad713413c257b7059bd5905d`. Supabase recorded it as
`20260724035913_attest_prior_sms_consent`. Before apply, the full credential-free suite passed
(717 unit, 968 Worker and 16 QA tests), the production build passed, changed-file ESLint was clean,
the artifact-retention check passed, and migration provenance passed.

Post-apply read-only catalog verification confirmed the expected tables, forced RLS, narrow
service-role grants/policies and browser-inaccessible invoker RPCs. A rollback-only synthetic
transaction confirmed admin/office attestation, unchanged general opt-in, append-only
re-attestation evidence, redacted legacy logging, duplicate-contact DND suppression and durable
pending-STOP suppression. The transaction was rolled back and a cleanup query returned zero
synthetic contacts, consents, attestations and provider events. No provider message was sent.

The application release remains separately gated: deploy the Worker/UI, then verify authenticated
status readback, the record-only modal, separate explicit Retry action, direct-conversation-only
service consent, and the send gate without sending to a real recipient. Group, broadcast and
automated messages must continue to require global opt-in. Operational rollback revokes and drops
both RPCs while retaining the locked-down current/evidence tables and redacted `sms_consent_log`
history. Sanitized apply evidence is in
`docs/audit/2026-07/evidence/prior-sms-consent-live-apply-2026-07-23.md`.

Migration `20260724043000_harden_service_sms_consent.sql` is live under ledger version
`20260724043000`. It replaced only the two existing service-role function definitions, sent
nothing and changed no consent row. The 2026-07-24 read-only recapture verified the ledger,
unchanged function signatures/ACLs/search paths, contact-phone race closure, strict
STOP→later-START chronology, exact-source hash/length precondition, exact-once patch anchors and
the employee share lock that serializes authorization revocation against attestation.
Authenticated production no-send verification confirmed the missing-permission banner, disabled
Send action and record-only modal without submitting an attestation.
Verify browser denial, service-role execution, append-only audit history, and that automated and
scheduled paths accept only `GLOBAL_OPT_IN`.
Use rollback-only synthetic records; do not send a provider message. Runtime code may roll back
while the fail-closed hardening remains; reopening either race requires a separate approved
migration.

### Native Work Authorization bridge release gate

The repository-only bridge is sequenced code-first without breaking public signing: while the new
RPC is absent, `submit-esign` falls back only for PostgREST's explicit missing-function condition,
completes the document through the existing RPC and records no consent. Any other wrapper error
fails rather than bypassing an installed boundary. Deploy that backward-compatible Worker to `dev`
first and verify that ordinary signing still completes with no consent evidence while the wrapper
is absent. After separate approval, apply
`20260727005212_upr_work_authorization_sms_consent.sql`, refresh the PostgREST schema cache if
needed, and verify the table/RPC ACLs and exact status definition before promoting `dev` to `main`.

Credential-free Worker/QA tests pin disclosure drift, missing-RPC fallback, non-bypass errors, ACLs,
suppression ordering, no global opt-in mutation and the concrete rollback. The isolated DB lane
adds behavioral proof for exact/mismatched disclosures, DND precedence, non-Work-Authorization
documents and anon denial. Production verification must be read-only/no-send: use an owner-approved
synthetic or newly signed test authorization, confirm the evidence/status result, and do not send
to a real client. Applying the migration, deploying, or using a production signing token each
remains separately owner-gated.
Capture provenance/readback after apply and before the reviewed `dev` → `main` promotion.

## QuickBooks Online attachments + payment-sync cron release sequence (2026-07-24)

Two authored, not-yet-applied migrations (`20260724180000_qbo_attachments.sql`,
`20260724180100_qbo_payments_sync_cron.sql`). Repository proof done: `npm run build`, worker+unit
vitest lanes green, `npx eslint` clean on changed files, plus a static migration test
(`functions/api/qbo-attachments-migration.test.js`) and a pure-helper unit test
(`functions/lib/quickbooks-attachable.test.js`). Reviewer gauntlet:
`migration-safety-checker` + `anon-grant-auditor` (both migrations), `worker-security-reviewer`
(`qbo-attach.js`), `upr-pattern-checker` + `design-consistency-checker` + `page-behavior-checker`
(the `QboAttachments` UI).

Shared-prod apply is owner-authorized per `database-standard.md` §0/§5 — deploy the `qbo-attach`
worker/UI first, then apply `20260724180000_qbo_attachments.sql` (additive table; rollback
`DROP TABLE`), verify the admin/manager SELECT scope and the two UNIQUE constraints, and confirm an
end-to-end attach → QBO Attachable with `IncludeOnSend` and a QBO-sent email carrying the file.
Attachments need only the already-granted accounting scope.

The payment-sync cron is a separate owner gate: apply `20260724180100_qbo_payments_sync_cron.sql`
(rollback = `cron.unschedule` + `DROP FUNCTION` + delete the config row) only after confirming
`QBO_WEBHOOK_SECRET` is set in Cloudflare; the real-time webhook half additionally needs
`QBO_WEBHOOK_VERIFIER_TOKEN` set + the Intuit **Payment** webhook subscribed to
`https://utahpros.app/api/qbo-webhook`. The poller is idempotent (dedup on `qbo_payment_id`), so an
extra fire never double-counts.

### 2026-07-23 Preview messaging proof

The owner-approved CallRail Preview test verified carrier delivery for two staff-authored outbound
messages. Both attempts were reconciled to confirmed/canonical `sent` without retry or duplicate
send. Two replies that arrived before the live webhook-shape fix were recovered from one exact
provider conversation and a bounded 18.5-minute window: four provider records read, two outbound
records skipped, two inbound SMS records processed, and zero failed or deferred. Read-only
verification confirmed provider identity, original timestamps, `received` status, direction and
the intended conversation; a refreshed authenticated dev inbox displayed both replies.

The one-time recovery endpoint existed only on an isolated Preview branch. After recovery, the
remote branch, alias and all five Preview deployments were deleted, and the route was never merged
to `dev` or `main`. This evidence proves history recovery and canonical inbound projection, not a
fresh received webhook after the compatibility fix. Before broader activation, send no duplicate
test and instead require one newly generated signed received event to claim, dedupe and project
without recovery.

The next live inbound proved direct signed-webhook projection but exposed a separate delivery gap:
all three `message.inbound` outbox rows remained pending with zero attempts because the protected
outbox worker had no trigger or schedule. The owner-approved reliability fix uses an after-commit
pg_net wake-up plus a five-minute pg_cron safety net. Apply verification must prove the exact URL
and existing secret are present without reading the secret, the trigger/function/cron grants remain
non-browser, existing backlog reaches a terminal state, a new inbound creates one delivered outbox
row, and both bell and push evidence reach the intended employee. Because channel delivery is
at-least-once across a crash between dispatch and outbox finalization, verification must tolerate
and record a rare duplicate alert rather than claiming exact-once behavior.

Inbound-message notification tests must separately assert channel routing: the bell link is the
office route `/conversations?c=<conversation-id>`, and the serialized Web Push payload URL is the
field route `/tech/conversations?c=<conversation-id>`. Device close-out must tap a fresh push and
prove the installed PWA opens with that exact conversation selected.

The repository-only admin setup panel does not change this sequence. Its
`GET /api/messaging-setup` status and `action=callrail-options` discovery contracts are read-only,
require an active internal admin, and add no migration. Before release, test missing/invalid
sessions, nonemployee/inactive/external/non-admin callers, unknown actions, missing/unknown
messaging modes, every readiness blocker, bounded CallRail pagination, provider 401/403/429/5xx and
timeout behavior, eligible-tracker filtering, `Cache-Control: no-store`, and serialized-response
redaction. Negative tests must prove the route performs no send, provider mutation, database write,
mode change, signing-key disclosure, or provider fallback.

Readiness tests also prove that binding presence alone never verifies a sender, live discovery
matches the configured company/number pair, incomplete pagination fails closed, provider calls use
bounded per-page timeouts, missing health evidence is not displayed as a clear backlog, and shared
database health is not presented as deployment-specific webhook proof.

Deploying the setup UI does not authorize activation. Production stays
`MESSAGING_SEND_MODE=disabled`; Preview/Production Cloudflare bindings, the CallRail text webhook,
tracking-number routing, signing key, and any real/test message remain separate owner/external
gates. Future RCS setup remains planned only and must prove explicit channel locking with automatic
RCS-to-SMS/MMS fallback disabled.

### Private outbound MMS verification

Repository close-out for outbound media requires: upload-route authentication and conversation
binding; JPEG/PNG/GIF magic-byte checks; one-item and 5,000,000-byte boundaries; traversal/foreign
reference rejection; private Storage download contracts; CallRail multipart fields without
a public URL; Twilio short-lived signing inside its adapter; message-bound rendering; retry
retention; and no automated/scheduled CallRail import. Build and repository tests do not prove the
live bucket, Cloudflare multipart behavior, provider acceptance, carrier rendering, or device
round trip.

A controlled live test is a separate owner-gated step: upload one non-sensitive image in Preview,
send it to the approved test phone, reply with one image, verify both private objects and exact
conversation rendering, replay the signed inbound event to prove dedupe, and confirm no raw
CallRail URL or Twilio signed URL was persisted. Orphan cleanup remains blocked on a separately
reviewed durable draft/claim design; there is no destructive browser cleanup route. Production and
RCS remain unchanged.

The 2026-07-23 pre-fix iPhone reply reached the signed webhook and durable provider-event inbox as
MMS, but media capture failed with `CALLRAIL_MMS_DOWNLOAD_FAILED` before any private Storage write.
This specifically invalidated the old derived media endpoint. Close-out must therefore prove the
corrected immediate webhook URL download and the conversation-API URL refresh used by a queued
retry; neither repository tests nor the received provider event alone is sufficient.

The owner applied the reviewed CallRail event-recovery scheduler on 2026-07-24 after verifying the
exact dev Worker URL, existing cron secret presence without reading its value,
`MESSAGING_SCHEMA_MODE=foundation`, CallRail company configuration, and the protected route. Live
retry proved the scheduler request and worker-run telemetry, but also exposed that the former
PostgREST PATCH claim could update four rows to `claimed` while returning an empty representation;
the worker therefore reported four skips. Migration
`20260724051500_claim_callrail_provider_event.sql` is now live under the same ledger version;
read-only verification confirmed the exact source fingerprint, invoker mode, empty search path and
service-role-only execution. The remaining acceptance gate is deployment of the RPC-based worker
and verification that a stale retained event becomes processed or durably retryable without
duplicate canonical history. A fresh immediate inbound MMS and owner-device rendering remain
separate end-to-end evidence.

### Mobile messaging release acceptance

Repository close-out must cover the bounded contact picker, denied messaging capability, direct-only
find-or-create behavior, service-role-only RPC grant, consent loading/error/suppression states,
admin/office attestation, technician denial, internal-note availability, explicit post-attestation
send, deep-link replacement, and newest-message anchoring.

Provider health treats only `received`, `claimed`, and `retryable` CallRail events as an actionable
backlog. Terminal `failed` events and notification `dead_letter` rows remain visible as historical
counts but do not permanently block an otherwise healthy activation. Ambiguous send attempts and
pending/processing/retryable notification rows remain blocking.

A production claim requires distinct evidence layers: exact reviewed commit; migration provenance;
shared-database apply plus grants/source fingerprint; Preview deployment and sender discovery;
fresh outbound/inbound SMS; fresh outbound/inbound MMS with private object ownership; bell and Push
link to the exact field-PWA thread; exact-build promotion to `main`; production-only provider
bindings/webhook/scheduler cutover; and the same controlled Production proofs. A passing build or a
historical provider row is not a substitute for those layers.

The S1e credential-free suite pins the live `get_inbound_leads` signature/body hash, table
ACL/policy/trigger-free preconditions, forced-RLS service-only source table, post-ID capture and
pre-storage payload-scrub triggers, opaque marker, active-internal company-wide SELECT policy,
call-log capability gate, rollback, exact mobile/desktop truthiness callers, and approved proxy
audio/error contracts. Worker tests exercise both deployment states and reject marker fallback.
Catalog-only pre/post-apply SQL proves ACL, policy and trigger state without reading values. Live apply verification must prove
browser denial and service access without selecting URL values or invoking a provider.
`supabase/tests/inbound_lead_recording_source_isolated.sql` is an executable, rollback-only suite
for a disposable post-migration clone. It refuses to run unless both the psql opt-in and
`upr.isolated_test_database=on` guard are present; its synthetic fixtures exercise marker/source
capture, recursive scrub, direct RLS, RPC allow/deny variants and authenticated DML denial.

### S1h database proof boundary

S1h has four distinct evidence layers across its ordered identity-authority, containment,
page-access-provenance, and personal-ownership migrations:

1. credential-free Vitest pins function identities, caller shapes, target hashes, browser/service
   ACL intent, selector-free AuthContext behavior, generated-catalog scripts, local-runner refusal,
   and the guarded unsafe rollback;
2. catalog-only preflight/post-apply SQL reads no business value and refuses unreviewed function,
   table, ACL, policy, employee-Auth, caller, or migration-ledger drift;
3. the guarded identity and personal ownership SQL matrices require both the psql opt-in and
   `upr.isolated_test_database=on`, cover active A/B, inactive, external, unmapped, admin,
   project-manager and service cases, explicitly deny employee self-binding/promotion and
   cross-owner Web/native token takeover, and always roll back; and
4. real GoTrue/PostgREST/RLS behavior requires separately approved synthetic identities during
   each owner-authorized apply window.

The revised source closes the two findings from the rejected artifact in code and static tests:
containment removes browser authority-row writes, and all four personal tables become
browser-RPC-only with same-owner token refresh. That source result is not database behavior proof.

The unsafe shared-project `notify_c_my_prefs.test.js` was retired: it used the anonymous client,
mutated notification defaults/preferences, and cannot prove authenticated ownership. Its
preference precedence/lock/redaction coverage is now inside the rollback-only S1h matrix. The
local runner invokes S1g and S1h as separate exact SQL files after the same local-origin/ref/sentinel
guard; it never uses `--linked` or a hosted database.

A temporary, non-retained PostgreSQL-compatible experiment modeled the S1h lifecycle, but it did
not execute the exact checked-in isolated, preflight, or post-apply files and retained neither its
harness nor a complete log. It is exploratory feedback, not reproducible verification. Exact
governed local SQL execution and live Auth/PostgREST verification remain open. Shared-database
apply, deployment, providers, signing, and device qualification remain separate owner/external
gates.

### Initial mobile offline qualification

The production source contract fixes `PRODUCTION_QUEUE_TYPES` to an empty list, requires zero
production enqueue/photo-blob callers, exposes no enqueue/retry hook API, and imports no real
dispatcher into the maintenance runner. Focused offline ownership/crash/source-contract tests cover
payload-free legacy quarantine, exact-confirmation all-store discard, bounded IndexedDB open and
version-change handling, owner/epoch revalidation, and maintenance-only completed-photo cleanup.

Passing those tests proves that the initial release does not automatically admit or replay a field
command. It does not prove offline mutation support. Web/PWA/Capacitor qualification must verify
that online writes still work and offline attempts are not presented as saved; a future queue
requires a separately reviewed end-to-end idempotency and crash-consistency contract.
