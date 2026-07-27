<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-s1b-qbo-identity-2026-07-26.md

WHAT THIS DOES (plain language):
  Records the source, caller, identity, test, rollout and rollback evidence for Mobile Production
  Readiness S1b, the remaining QuickBooks Worker identity slice.

DEPENDS ON:
  Internal: functions/api/qbo-*.js, functions/api/quickbooks-connect.js,
            functions/lib/qbo-auth.js, functions/lib/quickbooks.js,
            src/pages/settings/Integrations.jsx, src/components/collections/QboAttachments.jsx,
            supabase/migrations/20260701_crm_qbo_phase_b_gate_contact_trigger.sql,
            supabase/migrations/20260724180000_qbo_attachments.sql,
            supabase/migrations/20260724180100_qbo_payments_sync_cron.sql,
            docs/mobile-production-readiness-roadmap.md
  Data:     reads → repository source, Git metadata, and the dated R0 recapture
            writes → documentation only

NOTES / GOTCHAS:
  - This is source/local-test evidence, not deployment, provider, customer, production or live
    identity proof.
  - Binding and database configuration names were inventoried; no secret value was read.
  - No provider, customer record, live setting, migration, deployment or external side effect was
    invoked.
-->

# Mobile readiness S1b — QBO identity — 2026-07-26

## Result

S1b produced a narrow, locally verified continuation of R0:

- `/api/qbo-sync-customer` and HTTP GET/POST `/api/qbo-payments-sync` retain their exact
  secret-first server capability and otherwise require an active, internal `admin`.
- The payment poller's direct Cloudflare `scheduled()` entry remains independent of HTTP
  authorization.
- `/api/quickbooks-connect` is human Bearer-only; the shared server capability cannot replace
  OAuth state.
- `/api/qbo-charge` and `/api/qbo-attach` retain their existing Bearer-only billing predicate and
  now explicitly deny external employees before connection, business data, telemetry or provider
  access.

Approved-caller downstream request/response shapes, OAuth callback redirects, scheduler behavior
and provider helpers were not changed; new authorization denials are the deliberate transition.
Seventy-seven focused tests cover denied identities, auth/configuration failure, server capability
precedence/fallback, OAuth state writes, both poller HTTP methods, the direct scheduler entry and
exact disconnected responses.

This does **not** close `MOB-SEC-014`. CallRail recording and notification Workers, privileged
mobile RPCs, broad direct policies and the direct `qbo_attachments` metadata SELECT residual remain
open. Customer-sync and manual payment-sync also do not persist the resolved human actor in current
worker telemetry. It does not affect `MOB-SEC-015`.

## Provenance and isolation

| Item | Evidence |
|---|---|
| Required base branch | `codex/mobile-readiness-wave-r0` |
| Required exact base | `3d25519a21d10f11f5dadf41d35f470453adb7b7` |
| Fetched `origin/dev` | `90b265ee6f733c8dbcd75786f4e4057dd3355d38` |
| Reconciliation | `origin/dev` is an ancestor of the exact R0 base; no merge or rebase was needed |
| S1b branch | `codex/mobile-readiness-s1b-qbo-identity` |
| Isolated worktree | `/private/tmp/upr-mobile-readiness-s1b-qbo-identity` |
| Original checkout | unrelated `.claude/settings.local.json` modification remained untouched |
| Latest source/test result | `fb7af3f` |
| Latest canonical-document result before this evidence | `57302ae` |
| Captured at | `2026-07-26 15:22:13 UTC` |

The S1b commits are linear descendants of the exact R0 tip:

| Commit | Purpose |
|---|---|
| `e124ded` | preserve the scheduler capability while hardening customer/payment-sync browser identities |
| `a1255e2` | keep OAuth/charge/attach Bearer-only and reject external mutation identities |
| `49c2cf8` | add the focused negative/failure/compatibility matrix |
| `eb9eba0` | update canonical authorization, business and integration rules |
| `4504bba` | update testing, mobile data-contract and roadmap records |
| `7a51b2a` | reconcile billing/master context and the unfinished-work registry |
| `fb7af3f` | restore and test the exact three-argument direct-scheduler signature |
| `e4715dd` | reconcile current customer-sync, OAuth and billing caller contracts |
| `faf4f47` | clarify approved-caller compatibility and durable actor-audit residuals |
| `947fdfc` | retain the QBO actor-audit follow-up in the roadmap and registry |
| `57302ae` | complete the shared QBO server-capability inventory wording |

No R0 commit was rewritten or dropped. No push occurred.

## Read-only caller and binding-name inventory

No customer row, attachment object, provider payload, credential value or live setting was read.

| Route | Checked-in callers and preserved identity |
|---|---|
| `POST /api/qbo-sync-customer` | Settings preview/backfill; `ensureQboCustomer()` self-call from invoice/estimate Workers. Exact server capability or active internal admin. The old contact trigger is attached but deliberately inert. |
| `GET/POST /api/qbo-payments-sync` | Supabase pg_cron/pg_net caller recorded in the checked-in migration; no browser caller found. Exact server capability or active internal admin. |
| `scheduled()` in `qbo-payments-sync` | Direct Cloudflare scheduler entry; no Request/Bearer gate added. |
| `GET /api/quickbooks-connect` | Settings Integrations UI. Active internal admin Bearer only; callback contract unchanged. |
| `POST /api/qbo-charge` | No checked-in product caller found. Existing billing Bearer only; no server-secret identity. |
| `POST /api/qbo-attach` | Shared invoice/estimate attachment UI. Existing billing Bearer only; no server-secret identity. |

Binding names only:

- Supabase identity/data: `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- QBO capability/OAuth/provider: `QBO_WEBHOOK_SECRET`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`,
  `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`, `APP_BASE_URL`.
- Database configuration names: `qbo_webhook_secret`, `qbo_payments_sync_worker_url`,
  legacy/inert `qbo_worker_url`, transient `qbo_oauth_state`, `qbo_oauth_user`, and
  `qbo_bank_account_id`.

Binding presence, equality, deployment hash and current scheduled-runtime behavior remain unknown.

## Trusted-boundary and contract matrix

| Surface | New first boundary | Preserved compatibility |
|---|---|---|
| Customer sync | exact server capability, else active internal admin | `{contact_id}`/backfill/dry-run bodies; exact 400/404/409 and summary shapes; on-demand self-call |
| Payment sync HTTP | exact server capability, else active internal admin | GET and POST; disconnected/query failure remains HTTP 200 with `{ok:false,error}` |
| Payment sync direct schedule | unchanged direct `scheduled()` → reconciliation | no synthetic Request, Bearer or secret requirement introduced |
| OAuth connect | active internal admin Bearer only | missing-config 500, two transient state writes, `{url}`, callback redirects |
| Card charge | existing billing role plus explicit external denial | no server capability; approved-caller body, cents, balance, request ID, money and response contracts unchanged |
| Attachment mutation | existing billing role plus explicit external denial | no server capability; approved-caller idempotent attach/delete, file and response contracts unchanged |

Denied paths may call only Supabase Auth plus the employee lookup. Tests assert zero connection,
business-table, OAuth-state, telemetry, reconciliation or provider-helper calls after denial.
Allowed browser customer/manual-payment sync resolves the actor for authorization but does not
durably record it in `worker_runs`; no audit schema/write was authorized in S1b.

## Verification

All commands ran in the isolated S1b worktree. No browser, server, simulator or persistent child
process was started.

| Command | Observed result |
|---|---|
| `npm ci` | passed; 418 locked packages installed; lockfile unchanged |
| focused S1b Vitest | 77/77 passed |
| adjacent QBO/money/callback/attachment/payment tests | 210/210 passed |
| `npm run build` | passed; Vite production build, 665 modules transformed |
| `npm test` | passed; unit 774/774, Worker 1307/1307, QA 16/16; 2,097 total, zero unexpected skips |
| changed-file ESLint | passed with zero findings for all seven changed JavaScript files |
| `npm run lint` | reports the pre-existing full-tree baseline: 206 errors and 119 warnings in unchanged files; no changed JavaScript finding |
| `npm run validate:tooling` | passed; zero errors, two dated CAP-GOV/CAP-SEC waiver warnings; generated adapters match |
| `npm run test:tooling` | 12/12 passed |
| `npm run preflight:mobile` | zero errors; warnings only for local Node 26 vs CI Node 22 and optional GitHub delivery unavailable |
| `git diff --check` | passed |

The install reported the existing dependency-audit summary of 10 vulnerabilities (1 low, 8 high,
1 critical). No dependency or lockfile change was part of S1b; dependency triage remains a separate
release/security task.

## Independent review

Three independent, read-only close-out passes reviewed the current integrated worktree:

- Security: `pass`; no remaining source authorization-order, capability-separation,
  external-identity or downstream-isolation finding. The reviewer independently observed 77/77
  focused tests, 1,307/1,307 Worker tests and clean changed-JavaScript lint.
- Contract: `pass`; exact secret precedence/fallback, GET/POST/direct-scheduler, human-only OAuth,
  Bearer-only charge/attach, three-argument scheduler signature, callback and approved-caller
  response contracts passed. The reviewer observed a 201-test final contract matrix plus 6/6
  Settings caller tests.
- Release: the pre-commit audit required the promised evidence artifact, stale caller prose, exact
  scheduler signature and explicit RLS/actor-audit residuals. Those findings were corrected. The
  final clean-tree `ready-for-owner-gate` check is performed after this artifact is committed and is
  recorded in the handoff.

Reviewers did not infer deployment, provider, customer, production-identity or live-setting proof.

## Rollout

No rollout was authorized or performed. A future owner-authorized release should:

1. integrate the complete R0→S1b linear commit range into a reviewed release branch without
   dropping the R0 commits;
2. confirm required binding **names/presence** in Preview and Production without exposing values,
   and separately reconcile the shared capability's scheduler/self-call lifecycle;
3. deploy to the approved non-production environment;
4. exercise missing, expired, inactive, external and wrong-role identities plus an approved
   internal admin using synthetic/non-customer fixtures;
5. verify the server-capability customer self-call, payment HTTP scheduler and direct scheduler
   contracts, then separately exercise OAuth/charge/attachment only with explicit provider and
   money/file authorization;
6. monitor 401/403/5xx, worker telemetry, OAuth state failures and reconciliation lag before a
   production release;
7. deploy the reviewed immutable result to production and repeat the bounded identity/telemetry
   checks.

There is no migration in this slice and no database apply step.

## Rollback

The preferred authorization rollback is a reviewed forward fix. Reverting the S1b gates restores
the known valid-session/external-admin bypass and is not a neutral compatibility action.

For an emergency compatibility rollback:

1. disable or externally restrict the affected entrypoint before reverting;
2. redeploy the last reviewed R0 result only with owner/security approval and record that
   `MOB-SEC-014` has regressed;
3. leave scheduler/database configuration unchanged because S1b changed no migration or capability
   value;
4. verify the previous response/scheduler contract and continue monitoring denied/privileged
   access;
5. ship a forward authorization repair before re-enabling the entrypoint.

The direct `qbo_attachments` SELECT residual requires its own additive, reviewed migration and
rollback SQL; it is not part of this source rollback.

## External gates and remaining work

- Push, PR/release integration, deployment and deployed-hash verification.
- Read-only binding-name/presence reconciliation in both Pages environments; no value inspection.
- Representative allow/deny identities and non-customer fixtures.
- Provider/customer, OAuth, scheduler, attachment and money-path smoke tests under separate
  authorization.
- `project_manager` billing authority and shared QBO capability retention/rotation owner decisions.
- Durable human-actor telemetry for customer-sync and manual payment-sync.
- Additive RLS containment for external-admin direct reads of `qbo_attachments` metadata.
- Full-tree lint/dependency baseline ownership.
- Remaining `MOB-SEC-014` CallRail/notification, RPC and direct-policy slices.
- `MOB-SEC-015`, native scope, device/signing/TestFlight/push/OTA and final qualification gates.

No deployment, migration apply, push, secret read/rotation, live setting change, provider call,
customer-content inspection, message, call, file transfer, money movement, signing or distribution
occurred.
