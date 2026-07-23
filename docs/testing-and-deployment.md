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
| `npm test` | Vitest suites | May load local Supabase credentials; classify unit vs live/write tests before running |
| `npm run lint` | Repository ESLint | Current scope/debt may include non-product tooling; report actual result and lint changed product files |
| `npm run dev` | Frontend development server | `/api/*` needs a separate Wrangler Pages Functions process |
| `npm run build:ios` | Native-target build and Capacitor sync | Still does not replace Xcode signing/simulator/device verification |

Never report expected results as executed results. Record command, commit, environment and failures.

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

CI should keep unit and database/browser lanes explicit, report unexpected skips, validate required
environment bindings and retain machine-readable evidence. An isolated database is required before
database mutation tests can safely become a complete blocking gate.

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
- Required Preview/Production variables without revealing values.
- Browser/device/provider sandbox evidence proportional to risk.
- Updated canonical documentation and dated audit/addendum when appropriate.
- External/owner gates clearly marked pending rather than implied complete.

Known July 2026 test/deployment gaps are retained in
`docs/audit/2026-07/maintainability.md` and `docs/audit/2026-07/remediation-backlog.md`. Update this
canonical file in the same commit as a test, CI, environment, branch, deployment or release change.

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
