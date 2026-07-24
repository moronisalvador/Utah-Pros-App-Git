<!--
FILE: docs/testing-and-deployment.md

WHAT THIS DOES (plain language):
  Explains how UPR is checked and released, which tests are safe in each environment, and what must
  be verified before claiming a change is done. It distinguishes repository checks from live proof.

DEPENDS ON:
  Internal: package.json, vite.config.js, .github/workflows/, CLAUDE.md,
            .claude/rules/close-out-standard.md
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
| `npm run dev` | Frontend development server | `/api/*` needs a separate Wrangler Pages Functions process |
| `npm run build:ios` | Native-target build and Capacitor sync | Still does not replace Xcode signing/simulator/device verification |

Never report expected results as executed results. Record command, commit, environment and failures.
Credential-free lanes scrub hosted/provider environment variables and use deterministic fixtures;
they never reinterpret missing configuration as permission to use production.

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

Queued retry additionally requires applying the reviewed CallRail event-recovery scheduler
migration in a separate shared-Supabase window. Before apply, verify the exact dev Worker URL,
existing cron secret presence without reading its value, `MESSAGING_SCHEMA_MODE=foundation`,
CallRail company configuration, and the deployed protected route. After apply, verify the named
cron job, one `process-callrail-events` `worker_runs` record, transition of the retained event
without duplicate canonical history, and a fresh immediate inbound MMS. Repository tests and a
deployed route alone do not prove the scheduler is active.
