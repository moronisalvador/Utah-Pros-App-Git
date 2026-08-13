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
  - The dev and production app deployments share the production Supabase project.
  - `qa-staging` is a separate hosted database branch for write-testing; its schema is usable, but
    its historical migration ledger/rebase is not parity.
  - A green build can exist with missing runtime variables; deployment smoke evidence still matters.
-->

# Testing and Deployment

## Local commands

| Command | Purpose | Important limitation |
|---|---|---|
| `npm run build` | Production Vite compilation and asset generation | Does not prove runtime variables, Workers, native behavior or live integrations |
| `npm test` | Credential-free unit, Worker-contract and QA-policy Vitest lanes | Network and provider egress are blocked; each lane fails on zero discovered tests or any skip/todo |
| `npm run test:browser` | Guarded Playwright desktop/390px synthetic fixture matrix plus retained-artifact scan | Exact local origin only; no hosted QA, real account, production data or provider proof |
| `npm run test:db:local` | Generic isolated-database runner contract | Refuses to start without the exact local origin/ref/sentinel; the repository still has no generic all-migration local runtime/config |
| `npm run test:db:notification-producer:local` | PR #573 scoped forward → rollback → clean-reapply qualification on two fresh local stacks | Requires every runtime input tracked/committed/clean, pins its full proof manifest, and proves only this migration train, never hosted QA or production |
| `npm run lint` | Repository ESLint | Full-tree debt is reported non-blocking; the PR changed-file ratchet blocks any per-file/per-rule growth above its frozen shrink-only release baseline |
| `npm run validate:lint-ratchet -- <git-base>` | Lints changed JS/JSX files and compares findings with the frozen release baseline | Existing baseline findings may shrink but must never grow; new files/rules start at zero |
| `node scripts/capture-eslint-ratchet-baseline.mjs [--write]` | Re-captures that baseline from a full-repo lint | Owner-approved re-captures only; refuses to write if any recorded count would rise or any unrecorded file would gain an entry (`--allow-raise` overrides) |
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

`.github/workflows/ci.yml` runs on `dev` and `main` changes. Build, test and the PR changed-file lint
ratchet are intended merge gates. The full-tree lint report remains non-blocking. The changed-file
ratchet compares findings by file, severity and rule against
`scripts/eslint-ratchet-baseline.json`: recorded debt may shrink but never grow, while a genuinely
new file or rule starts at zero. Never raise that baseline.
`no-use-before-define` is variables-only at warning level so new warnings remain blocking.

**The baseline covers EVERY file that already carries findings, and must keep doing so.** Regenerate
it only with `node scripts/capture-eslint-ratchet-baseline.mjs` (dry run by default, `--write` to
apply) — never by hand. That script lints the whole repo and refuses to write when any recorded count
would rise **or** any unrecorded file would gain its first entry; `--allow-raise` plus owner sign-off
is the only override, and shrinking never needs it. The 2026-07-29 capture instead recorded only the
16 files present in one promotion diff. Because `check-eslint-ratchet.mjs` resolves a missing entry
to `allowed = 0`, the other dirty files were not merely unrecorded — they were silently pinned at
zero, so touching any one of them failed CI on pre-existing debt the author never wrote, on rules
unrelated to their diff. PR #604 is the worked example: a pure dark-theme token migration was
reported as 3 regressions in two `src/components/tech/` files and had to clear that unrelated debt
in commit `135b9f62` to go green. Expanded 2026-08-08 under owner decision, raising no recorded
count. Scope is everything ESLint lints, not just `src/`: `upr-mcp/` and `supabase/tests/` are
reachable by the ratchet's git-diff filter too, so a narrower capture would leave landmines behind.

A finding is **fixed rather than frozen** when the finding is not real debt. Every `no-undef` in the
repository was a missing Node-globals declaration for `scripts/` and `upr-mcp/`, so those are
declared in `eslint.config.js` instead of baselined — a frozen `no-undef` entry would record debt
that does not exist and blind those files to a genuine undefined-variable typo.


Shrink opportunities are reported only for files actually linted in the current changed-file set;
an untouched baseline file is absent evidence, not a verified zero-finding cleanup.
GitHub branch protection is external configuration and must be checked before relying on a workflow
as an enforced gate.

CI also validates the disconnected Figma permission contract, installs its governed Chromium
runtime, and runs the guarded browser matrix. The custom Vitest and Playwright runners fail if a
lane discovers zero tests or reports any skipped/todo test, and the artifact scanner fails retained
output containing auth material, production identifiers or realistic identity fixtures.

`.github/workflows/ios-release.yml` is a valid `workflow_dispatch`-only scaffold. It must remain
manual-only until Apple enrollment and signing secrets are owner-confirmed. GitHub Actions forbids
using `secrets.*` directly in a step `if`; map the signing gate into job `env` and branch on
`env.APPLE_TEAM_ID`. `scripts/ios-release-workflow.test.js` preserves both boundaries without
dispatching a macOS job, signing an app or contacting Apple. A TestFlight-capable
archive also fails closed unless `VITE_NATIVE_PUSH_ENABLED` is exact lowercase
`true` and `VITE_APNS_ENV` is exact lowercase `production`; a development
archive must use a separately built sandbox bundle.

The separate `.github/workflows/ios-dev-testflight.yml` source path targets only
`com.utahprosrestoration.upr.dev` from `dev`, uses `https://dev.utahpros.app`, and
still requires production APNs because it creates a distribution/TestFlight artifact.
Its push trigger runs credential-free tests only; every signed archive and optional
upload requires a fresh manual dispatch. It uses separate `ios-dev-signing` /
`ios-dev-testflight` environments with dev-exclusive `IOS_DEV_*` signing/provider
secret names, serializes runs across the provider side effect, embeds and reverifies the
exact dev origin/Push mode/source SHA, and requests only the internal **UPR Dev** group.
The manual `native_push_enabled:false` option embeds an exact dev-token retirement flag;
authenticated boot additionally requires the OS-reported `.upr.dev` identity before it
deletes the remembered token through the owner-scoped RPC and unregisters locally. Authorized
dry archive run `30732945226` succeeded from exact `dev` source `e0a1ec6f` with
`publish_to_testflight:false`: it verified the `.upr.dev` identity, dev-only distribution
signature/profile, production APNs, dev origin, OTA/public-key embedding, native Push mode, and
runner cleanup without uploading to TestFlight or delivering to a device. The Apple internal-group
upload, install, and signed-device matrix remain owner-gated, so this is not yet a verified live
release path. The official
`ios-release.yml` remains manual/main-only and unchanged.

The separate manual `.github/workflows/capgo-dev.yml` keeps credential-free
validation portable across the pinned Ubuntu runner: its native release-SHA
proof uses the pinned Node runtime to inspect Vite's configured
`dist/app-assets` directory. The verifier fails closed on malformed or absent
release identity, missing/empty/unreadable output, symlinks, unexpected entry
types, or an absent SHA. Source contracts reject undeclared `rg`/`grep`
dependencies and the stale `dist/assets` path. This verification makes no
Capgo request and does not broaden the independently gated publish, channel
assignment, device-delivery, signing, or production actions. The current
`publish` choice is deliberately fail-closed after exact confirmation and
before credentials, compatibility checks, upload, channel mutation, or any
provider request. Pinned Capgo CLI `8.31.5` assigns an upload with no explicit
channel to the app default (or its production fallback), so no repository check
may describe that path as unassigned. A provider-capable publish path requires
a new provenance-bound design, regression coverage, and fresh external-action
authorization.

Native Push activation also requires the two focused migrations to pass in
order against a disposable local Supabase database. The behavior proof must
show that employee A cannot read or change employee B's notification
preferences, the service role can resolve a target employee's effective
preference, browser roles have no direct preference/token/claim-table access,
a repeated source-event/device delivery cannot be claimed twice, and an APNs
rejection cannot delete a newer token registration. Enrollment must reject a
missing environment and retain at most five iOS tokens per
employee/environment. Worker tests additionally pin exact sandbox/production
routing, bounded fanout, sanitized route-only payload data, durable delivery
identity, and fail-closed missing configuration. None of this local proof
authorizes a shared-database apply, Cloudflare deployment, Apple provider
request, physical-device installation, or TestFlight upload.

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
provider behavior, production behavior, or a pinned Linux visual baseline. Generic P2a database
execution remains gated on a reviewed all-migration local Supabase config/runtime and
deterministic seed/role fixtures. PR #573 now has a narrower, project-scoped local qualification
runtime; it is not the generic P2a foundation. Its exact reviewed migration train was subsequently
applied and qualified on the dedicated hosted QA project with non-production credentials and
provider traffic disabled; that evidence does not convert the branch into the generic P2a
foundation.

The five-producer authorization candidate adds
`supabase/tests/notification_producer_authorization.test.sql`. Its behavior suite refuses unless
both `UPR_ISOLATED_DB=1` and `upr.isolated_test_database=on` are present, then transactionally tests
anonymous/inactive/external/cross-account denial, actor binding, crew row-identity preservation,
exact-retry timesheet idempotency, serialized review, and service-only delivery claims.

On 2026-08-02, development qualification passed the exact reviewed train on two fresh disposable
PostgreSQL 17/Supabase stacks: baseline restore, idempotent synthetic seed, prerequisites
`20260730214500` and `20260731223000`, forward `20260801215912` then
`20260802040935`, behavior and lifecycle proofs, reverse rollback, rollback lifecycle proof, and a
second clean forward reapply. The behavior matrix executes valid and invalid bell, native APNs,
Web Push, and email claims; duplicate refusal; stale/wrong/deleted/reassigned target refusal;
inactive/external/removed-assignee refusal; and definitive target release followed by one safe
reclaim.

The project-scoped CLI is pinned to `2.111.0`; the baseline, migrations, rollbacks, config, seed,
isolated behavior suite, and both lifecycle proofs are SHA-256 manifest-pinned. Child processes
scrub hosted credentials. Before any Docker mutation the runner verifies the selected engine is an
existing local Unix socket or allowlisted Windows named pipe, passes that exact context to every
Docker/Supabase command, and verifies the database container's project label plus exact disposable
network identity before replacing its schema. The Docker bridge binds published ports to
`127.0.0.1`; CLI output containing local keys is suppressed; and both stacks, networks, and
workdirs were removed after success. Synthetic seed data contains no customer PII, is applied
twice per stack to prove idempotence, and the local reminder cron executes only `SELECT 1`.

The final runner additionally refuses any dirty/untracked runtime input before Docker, rechecks the
manifest and HEAD after execution, and emits the exact commit SHA plus full input manifest. The
commit-bound two-stack run passed on the non-rewriting reconciliation merge
`1cec9b3beddb755d6c8e7a2fd58818c1f5880f10` with 13 pinned inputs and manifest SHA-256
`67a764fc77cfd5db77bc7aebe2ec4b8bc257ce21c1784801a4edd221fd73d149`.
Its forward/rollback and clean-reapply cycles both cleaned their stacks, networks, and workdirs.
The close-out documentation commits that record this receipt change none of the runner's 17
runtime inputs; rerun the qualification whenever any one of those inputs changes.

This local result qualifies only the pinned PR #573 train and remains distinct from hosted proof.
Separately, QA applied exact source `20260801215912` as hosted ledger `20260803182131`, followed by
`20260802040935` as hosted ledger `20260803182303`. Catalog/postflight retained forced RLS,
least-privilege service access, all five flags false, no `appointment.reminder` row, and no reminder
cron. The governed hosted lane recorded 163 passing assertions and zero assertion failures; 212
skipped assertions plus 46 setup errors across 44 files / 90 suite nodes remain tracked baseline
debt. Neither result is deployed
Worker/native/provider or Production proof, nor permission to enable a flag, schedule a cron,
deploy, or deliver a notification. Do not redirect the local command to `qa-staging`, dev/Preview,
or the shared project. Local setup follows the official Supabase
[CLI local-development](https://supabase.com/docs/guides/local-development/cli/getting-started),
[configuration](https://supabase.com/docs/guides/local-development/cli/config), and
[seed-data](https://supabase.com/docs/guides/local-development/seeding-your-database) models while
remaining deliberately repository-scoped and unlinked.

## Release flow

- Routine work follows the current branch rules in `CLAUDE.md`; never push directly to `main`.
- `dev` deploys the Cloudflare **Preview** environment. Production is released through the reviewed
  `dev → main` path; only the separate hosted Supabase branch is called `qa-staging`.
- The `dev` and production app deployments share the production Supabase project, so schema changes
  use the production apply-window and sequencing rules even when application code is staged.
  The separate `qa-staging` database branch is the only hosted write-test target; its seeded schema
  is usable, but its historical migration ledger is not replay-compatible and must not be repaired
  with ad-hoc ledger writes.
- Do not apply a migration from an unmerged feature commit merely because its SQL is ready. Every
  production migration must map to reviewed source reachable from the designated release branch,
  unless an owner-authorized emergency exception records the commit, reason and reconciliation.
- Wait for Cloudflare checks and perform the appropriate deployed smoke test.
- Native release additionally requires Capgo/Apple/Xcode/TestFlight evidence and owner-controlled
  signing/reviewer credentials.
- Deploy, migration apply, provider mutation, outbound message and money movement require explicit
  authorization; verification does not broaden permission to perform them.

### Contractor Compliance release sequence (repository source only)

Contractor Compliance is deliberately dark until each gate is authorized and verified:

1. review the additive migration/rollback and credential-free contracts; run migration-safety,
   anonymous-grant, Worker-security, consent-path, UPR-pattern, design, and page-behavior reviews;
2. apply only to isolated `qa-staging` in a fresh owner-approved window, then prove forced RLS,
   direct-role denial, private bucket posture, role-redacted RPCs, date/alternative readiness,
   public token/rate transitions, and claim/finalize idempotency;
3. deploy compatible Worker/UI source with `page:contractors` OFF and both Cloudflare bindings
   absent/false; verify routes remain dark and no reminder/provider call occurs;
4. in a separately approved shared-production window, preflight live columns/object names and
   apply the reviewed migration, then repeat value-free ACL/RLS/function/bucket checks;
5. configure the capability-token secret, public rate-limit salt, and feature binding, enable the
   database flag for named internal users, and verify admin/office management plus
   project-manager redaction using synthetic documents only. Verify named audit materialization/
   locking, unknown paid/activity facts, W-9 stale-year classification, provider-handoff rejection
   without an accepted W-9, and exports that omit file/tax-identifier data;
6. only after separate provider authorization, enable the reminder binding, verify the source-declared
   daily `upr_contractor_compliance_reminders_daily` job, and run one
   named synthetic suppressed/DND/send canary with delivery-ledger reconciliation; and
7. obtain owner approval for the reviewed audit-sheet/Drive import mapping before touching real
   contractor files. Duplicate detection uses hashes and preserves every historical version.

Rollback disables reminder and feature bindings first, then the database flag. Private evidence
remains inert; dropping populated compliance tables or objects is not an operational rollback.

### Conversation participant compatibility apply unit (2026-07-31)

Production treats `20260731040337_conversation_participant_scoping.sql`,
`20260731040338_conversation_unread_state_compatibility.sql`, and
`20260731213000_conversation_assignment_authority_containment.sql` as one exposure-free apply
unit. Apply them in that order in one separately authorized low-traffic window; if a step fails,
reverse every prior step before closing the window. QA already contains immutable `40337/40338`,
so its next step is only `31213000`. Verify the resulting function bodies contain no
appointment/job/claim authority, then deploy compatible web and supported-native callers.
`20260731213100_conversation_participant_policy_enforcement.sql` remains post-adoption only and
must not run until older direct-unread writers are unsupported.

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

The initial audited release promise (2026-07-25) stayed online-first with tested warm continuity
and excluded cold-offline PWA, admin-mobile in the native binary, native Push, and OTA. Native Push
subsequently passed production TestFlight physical-device delivery on 2026-07-29; that historical
exclusion is no longer a claim that APNs has never shipped. Per-token/dev-app re-enrollment,
account-switch, and feature-specific device matrices remain separate open gates. Expanded field use
requires zero P0 findings and closure or explicit exclusion of every P1 within the promise. Live
migration/apply, deploy, provider/customer action, signing, distribution, and submission remain
separately authorized owner gates.

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

The live S1d database-dispatcher boundary is recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md`. Its credential-free
contract suite proves exact live-body rollback, one-expression trusted-key hardening,
`PUBLIC`/`anon`/`authenticated` denial, `service_role` retention, six-function/seven-call-site
compatibility, trigger/cron metadata, no in-body role assertion, no browser caller, fail-closed
drift checks and catalog-only pre/post-apply checks. It is live as ledger entry
`20260727233704 notify_emit_service_boundary`; a 2026-07-28 read-only recapture confirmed the
reviewed body hash and owner/service-only EXECUTE. The
tests never invoke `notify_emit`, pg_net, a trigger, schedule, Worker, or provider.

The 2026-08-01 appointment-reminder incident adds two focused release
contracts:

- `functions/api/notify.test.js` proves reminder audience derivation cannot be
  widened by producer recipients, excludes inactive/external/non-crew
  employees, pins Denver quiet-time boundaries, fails closed on a quiet-time
  preference read error, and checks exact bell/PWA/APNs reminder context.
- `tests/qa/unit/appointment-reminder-delivery-contract.test.js` statically
  proves the pending same-signature `notify_emit` repair preserves a usable
  producer occurrence ID, keeps the function argument authoritative for
  `type_key`, disables/unschedules before replacement, retains service-only
  execution, records the exact validated predecessor instead of inferring it
  from an optional table, and never reactivates reminders during rollback.

These credential-free tests do not prove the pending database function on the
shared project or physical-device receipt. Reminder activation is blocked
until the compatible Production Worker SHA is observed and the exact pending
migration has separate reviewed apply/verification evidence. The current live
containment is `appointment.reminder.enabled=false` with no
`upr_appointment_reminders` cron job.

Production alone has the original migration ledger row
`20260801232759 technician_quiet_time_and_appointment_reminders`;
`qa-staging` does not. The reviewed `20260802040935` source landed in `dev`
through PR #571 at `9e723f4a` and is QA-only as hosted ledger `20260803182303`,
ordered after `20260801215912` as hosted ledger `20260803182131`. QA still has
no reminder catalog row or cron. Treat later Production apply,
re-enable/reschedule, and provider/device proof as separate gates.

Before activation, tests must also prove durable per-recipient/channel reminder delivery claims
prevent bell/PWA/email replay. The separate appointment-crew successor has
proved server-authoritative appointment crew behavior under the owner-approved
policy: any active authenticated internal employee may
change crew, while anonymous, unmapped, disabled, external, and `crm_partner`
identities and targets are denied. It also proved enum default/null/invalid
handling, no-op stability, immutable actor attribution, add/remove/role-change
set diffs, cross-job task denial, and all-or-nothing create/edit/reschedule
behavior. Generic APNs tests must prove
unset/false rich-presentation configuration excludes appointment title,
customer, and time, while exact `true` alone renders those fields.

The governed local command for that crew repair is:

```bash
npm run test:db:appointment-crew:local
```

It refuses dirty or untracked inputs, pins Supabase CLI `2.111.0`, verifies a
local Docker socket and loopback-only network attachment, and binds all
predecessor/migration/rollback/proof files to SHA-256. It creates two fresh
sequential stacks: one from the Production bridge lineage and one from QA's
M1/M2 lineage. Each stack runs forward behavior, reverse fail-closed rollback,
clean reapply, and behavior again. Its final JSON receipt binds the result to
one committed SHA. Hosted targets, `--linked`, `db push`, and provider traffic
are not supported by this runner.

The behavior proof covers enum defaults, explicit/null/invalid roles, stable
no-op IDs, add/remove/role-change set diffs, immutable row and full-set audit
attribution, private crew-only response minimization, and active internal field
technician access. It also proves explicit nullable start/end/notes clears,
omitted-field preservation, private-row equality-probe denial, and explicitly
employee-attributed service crew writes with raw service crew DML and
appointment insert/delete denied. It also preserves the deployed service
column-scoped appointment metadata compare-and-set compatibility. It
exercises atomic create, edit, reschedule, task,
privacy, and notification-preference failure paths; positive compatibility for
the same-signature legacy update/task/delete RPCs; denied
anonymous/unmapped/disabled/external/`crm_partner` callers; and temporary
Phase-A PostgREST compatibility for authorized installed-native appointment
and crew writes. The latter must prove appointment RLS plus the command guard,
crew RLS plus immutable-identity/audit enforcement, anonymous denial, and
actor attribution for both admin and field-technician callers. Catalog
assertions require those narrowly retained authenticated table grants, RLS on
both appointment tables, least-privilege execution, browser-inaccessible
destructive audit privileges, and an admin-only atomic `merge_jobs` regression
that proves appointment reparenting and crew preservation while direct
`appointments.job_id`, non-admin, anonymous, and service paths fail closed.
The rollback state proved that all eight command entry points and direct
appointment/crew writes fail closed. Phase B revokes the
compatibility grants only after supported-native adoption evidence.

The exact successor source at
`b62eee896c67d4058e7eeb6383fa698996d831c9` passed that commit-bound
two-lineage qualification. QA applied it as
`20260804060640_appointment_crew_atomic_save_and_audit_repair`, then passed the
complete transaction-rolled-back behavior proof and protected database lane.
Production applied the same committed source as
`20260804061426_appointment_crew_atomic_save_and_audit_repair`; Production
verification was read-only and covered ledger identity, function
owners/configuration/source markers, role grants, policies, RLS, trigger
bindings, enum/default, and Phase-A table/column ACLs. No Production behavior
fixture, customer-row read, provider call, or device action was used.

The compatible caller source merged through PR #579 to `dev` as
`ce30f2242a34f713c5cb9294cc2ce7513d938e15`. Exact-SHA GitHub Actions runs
`30884704586` and `30884704581` passed the CI, database, and credential-free
native gates; Cloudflare deployment `b586f62f-1521-47f4-a1ba-7332d5b6245c`
passed, and the repository smoke runner verified all 30 boot assets at
`https://dev.utahpros.app`. A blocking Production review then caught unchanged
appointment fields riding with crew-only saves; the sparse changed-field
correction passed fresh local, two-lineage, security, dev, and PR gates at
`89c51c3702679841f9c4b7e72880c49239af2401`. PR #580 merged that source to
`main` as `01c66128b1eb6346cd6f0d7d198bf2938ca494c1`.
Post-merge CI run `30887474018` and Cloudflare deployment
`06389930-8e7d-4dc8-837c-ffd922f1e204` passed. The immutable deployment and
Production alias both passed the 30-asset/content-type/missing-asset smoke, and
their sorted asset manifests matched SHA-256
`f26a58edaeee3b98d169cf20b7afc0394f377d036aedd83387104da615b72bdd`.
The database migration was not replayed during that source-only release.

The S1f direct-bell apply candidate is recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1f-create-notification-2026-07-26.md`. Its
credential-free contract and catalog-only pre/post scripts pin the unchanged function body,
authenticated denial, service-role retention, and sole owner-run database caller without invoking
`create_notification` or reading notification rows. Only S1f still requires a separate explicit
apply selection rather than a chronological all-pending command; live S1d, S1e, and S1g must not
be replayed.

The S1g notification read/recipient boundary is live as
`20260728192024_notification_read_recipient_boundary`; its corrected qualification is recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1g-source-correction-2026-07-28.md`. Credential-free
CI checks exact RPC signatures/results/defaults, caller reconstruction, foreign-recipient denial,
private broadcast receipts, legacy read compatibility, Realtime RLS, least-privilege ACLs, drift
guards, and the owner-gated unsafe rollback. Preflight/post-apply SQL is catalog-only and does not
read or mark notification rows. The synthetic multi-identity behavior script requires both the
`UPR_ISOLATED_DB` psql variable and `upr.isolated_test_database=on`, and is
transaction-rollback-only. `npm run test:db:local` now runs its exact pgTAP wrapper through
`supabase test db --local` before the DB Vitest lane; the runner never offers `--linked` or
`--db-url`. A temporary PGlite harness passed forward/post/behavior/rollback compilation, but the
exact-file sequence also passed in a disposable official local Supabase 2.110.0 stack. The live
value-free postcondition, active-internal Moroni list/count, foreign/unmapped denial, advisors, and
fresh provenance passed without reading notification contents or changing read state. Two-session
PostgREST/Realtime plus PWA/Capacitor bell behavior remain release evidence gates. The obsolete
anonymous/shared `notify_foundation.test.js` was retired; replacement preference-resolver
integration coverage belongs to the separate identity/device/preferences slice.

**Historical S1e/S1g apply-order prerequisite:** each target required the separately governed
`20260726180000_mobile_employee_identity_authority.sql` and
`20260726182000_mobile_employee_identity_containment.sql` sequence plus the compatible-client/
old-client decision. Their successful preflights proved there was no duplicate
`mobile_employee_identity_containment` ledger row and that the browser-read-only employee catalog
contract matched. Both targets are now live; do not replay them. A future dependent migration must
recapture the same catalog/ledger state in its own owner-approved window.

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
No rollback rotates secrets or changes the shared database by implication. S1d is already live and
must not be replayed. Its exact rollback remains emergency-only and must record that it re-opens
authenticated arbitrary-emission capability. Any synthetic trigger/service canary still requires
separate explicit authorization and a non-customer fixture.

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

### Scheduled-message delivery hardening release gate

The scheduled-message hardening source is a code-first, fail-closed two-migration release; it is
not applied or live evidence. After the participant authorization foundation is present, deploy
and verify the hardened browser and scheduler callers, including the stable browser operation ID
and the central `sendAutomatedMessage()` reservation hook. Until the new RPCs exist, those callers
must refuse scheduling/dequeue rather than fall back to the old send path. Then, in a separately
owner-approved low-traffic window, apply and verify
`20260731220000_scheduled_message_delivery_compatibility.sql` followed by
`20260731220100_scheduled_message_delivery_enforcement.sql`. Compatibility preserves the legacy
claim signature and historical grants as a callable `false` no-op, so a stale Worker also pauses
rather than sending without a reservation. Compatibility requires exact participant enforcement, locks the queue, and
aborts with SQLSTATE `55000` when the aggregate pending count is nonzero; it never edits those
rows. It creates FORCE-RLS actor-derived provenance that snapshots creator, conversation,
body/send time, recipient contact, and recipient phone, closes raw browser queue writes, and sets
all historical queue policy predicates to `false` in that transaction. Enforcement reasserts the
fail-closed policies and revoked browser ACLs while retaining the provenance boundary. Do not leave
compatibility without enforcement as the intended steady state.

The compatibility migration is additive and introduces the fenced claim plus one durable linked
attempt. Its reconciliation path is provider-free: accepted provider evidence materializes once,
a fresh linked attempt stays `in_flight`, and an unknown stale result is failed for owner review
rather than re-sent. Reverse recovery is
`31220100 → 31220000 → 31213100 → 31213000 → 40338 → 40337`; it is containment, not a normal
reversal. Every step seals browser tables/RPCs and retains provenance, delivery links, and the
unique index. Unresolved linked pending work blocks rollback for owner reconciliation.

Required repository checks cover actor/membership and exactly-one-recipient revalidation, stable
operation-ID retry semantics, direct-browser-table denial, reservation/reconciliation contracts,
and the provider barrier/concurrent scheduler case proving one reservation permits only one
provider invocation. `supabase/tests/scheduled_message_delivery.test.sql` is the paired guarded,
rollback-only isolated-database proof for RPC ACLs, idempotent creation, one reservation,
fresh-in-flight preservation and exactly-once materialization. It must run only on a disposable
local clone with the isolation sentinel; it is not CI or hosted proof. Earlier 2026-07-31 source
revisions passed the participant and scheduled proofs with final transactions rolled back. The
current source adds the authorized-media RPC, explicit-deny queue policies, legacy-claim no-op,
and an atomic final reservation gate. The latter share-locks the current automated-SMS switch,
invokes the canonical phone-locked consent authority, accepts only `GLOBAL_OPT_IN`, and proves
that kill-switch, DND, and no-consent races leave zero provider-attempt residue. The full governed
runner remains open because this worktree has no local Supabase project configuration. Focused
tests also prove a managed-credential timeout fails before Twilio and cannot use the normal
cached/environment fallback. No migration apply, deployment, provider traffic, or live
scheduled-message claim follows from repository tests.

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

Historical release sequence for the now-live `20260724180000_qbo_attachments.sql` and
`20260724180100_qbo_payments_sync_cron.sql` migrations. Repository proof included `npm run build`, worker+unit
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

## QBO multi-invoice payment receipts release sequence (live since 2026-08-06)

The receipt foundation and grant containment are live on the shared project as ledgers
`20260731225654` and `20260731230907`; the role-check repair is live as `20260806034004`.
`feature:qbo_receive_payment` is enabled/not force-disabled, both Cloudflare variable sets have
`QBO_RECEIVE_PAYMENT_ENABLED=true`, and the former Vite-only UI gate is retired. Billing roles use
the same database-gated UI on both origins. The first successful production receipt ran on
2026-08-06. The 2026-07-31 Preview-only/no-receipt observations were useful pre-activation evidence
but are now historical; rollback still closes the database and Worker switches before code changes.

Before any external step, pin an exact committed revision and require: credential-free unit,
Worker, and QA lanes; focused exact-cents, 1/100/101 allocation, duplicate/concurrent request,
lost-response, bad provider echo, authorization, webhook/CDC retry, stale-event, terminal-event,
legacy compatibility, and rollback tests; changed-file ESLint; build; migration hygiene; paired
isolated SQL behavior proof; and independent migration-safety, anonymous-grant, Worker-security,
project-law, design, and page-lifecycle reviews. Repository tests must mock Intuit and block network;
they are not provider proof.

Release is deliberately code-first and serialized:

1. Deploy the backward-compatible Worker/UI with both gates disabled. Verify the legacy
   single-invoice payment and inbound payment-sync paths still work; do not expose the new route.
2. In a separate owner-authorized `qa-staging` window, apply the exact reviewed migration and run
   the transactional SQL behavior test. Verify tables, constraints, indexes, forced RLS, zero
   browser grants, seven service-only RPC signatures/bodies, retry fields, disabled feature flag,
   and rollback containment.
3. With separate provider authority, run the documented Intuit Development sandbox matrix: one and
   multiple invoices, partial/full application, same-request concurrency/replay, timeout after
   acceptance, local-finalization failure, explicit method/reference/deposit readback, stale/cross-
   customer rejection, unsupported currency/unapplied credit, update/void/delete, out-of-order
   webhook, a two-session webhook-first/outbound-finalize race with monotonic attempt state and no
   deadlock, two distinct Payments racing on one invoice without a rollup-trigger deadlock, missed
   webhook recovered by CDC, and a backdated transaction.
4. The owner separately authorized the inert shared-database apply before sandbox activation.
   Post-apply readback found managed Supabase defaults had retained direct `service_role` writes on
   the three new tables. Follow-up `20260731231000_qbo_receipt_service_grant_containment.sql` is
   live on staging as `20260731230543` and production as `20260731230907`: receipt and attempt
   tables are service-role SELECT-only, the event table has no direct service grant, browser grants
   are zero, and all writes remain RPC-only. The full staging behavior suite and real direct-role
   denial proof passed after containment and rolled back with zero residue.
5. Separately enable the Worker switch, then the database flag, and run one named-admin production
   proof. Retain the client/Intuit request ID, one QBO Payment ID, every linked invoice/allocation,
   fresh QBO balances, one UPR receipt, projections, event convergence, and Worker run without
   exposing credentials or unrelated customer data.

Rollback starts by disabling the database flag, setting `QBO_RECEIVE_PAYMENT_ENABLED` away from
literal `true`, and redeploying. Only then use the paired containment rollback to revoke/remove
receipt RPCs. Receipt/attempt/event/projection-link evidence remains; deleting financial audit
records is never part of an operational rollback.

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

The pre-activation sequence above is historical. A read-only Cloudflare inspection on 2026-07-31
confirmed both Preview and Production at `MESSAGING_SCHEMA_MODE=foundation` and
`MESSAGING_SEND_MODE=callrail`; production CallRail staff SMS/MMS activation and bidirectional
evidence are recorded in `UPR-Web-Context.md`. No Twilio credential variable names were present.
CallRail is therefore the preservation baseline: do not change provider mode, bindings, webhook or
number routing during a normal `dev → main` promotion. Any future Twilio activation remains a
separate owner/provider window after CallRail-compatible code is already deployed; there is no
adapter or cross-channel fallback. Emergency rollback remains `MESSAGING_SEND_MODE=disabled` plus
redeploy. Future RCS setup remains planned only and must prove explicit channel locking with
automatic RCS-to-SMS/MMS fallback disabled.

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

### Twilio inbound durability verification

The 2026-07-29 inactive Twilio parity source has credential-free Worker and QA coverage for exact
and invalid signatures, future/repeated form parameters, schema/credential/account fail-closed
gates, SMS/MMS normalization, MessageSid replay and concurrent duplicate behavior, transient
projection retry, STOP/START/HELP ordering and TwiML, Advanced Opt-Out silence, private-media
authentication/redirect/type/byte/size bounds, assigned/fallback audience, exact thread links, and
stable outbox/native occurrence identity. The focused run passed 98 Worker tests plus 19 QA source
contracts using the repository-pinned dependency tree from the primary checkout; this does not
prove a database effect.

Final repository verification passed `npm test` with 1,362 unit, 1,670 Worker, and 590 QA tests
and zero unexpected skips; `npm run build`; changed-file eslint; migration hygiene (3 checked,
0 failures); and `git diff --check`. The strict bundle report exited successfully but retained the
existing advisory entry-graph overage: 259,110 bytes gzip, 2,215 bytes below its blocking line.
The required consent-path, Worker-security, migration-safety, anon-grant, and UPR-pattern reviews
all passed after their findings were resolved.

`supabase/tests/twilio_inbound_notification_parity_isolated.sql` is the rollback-only behavioral
proof for the post-migration database. It exercises one canonical/unread/outbox effect, replay
no-op, duplicate-phone STOP, stale START suppression, visible HELP, private MMS, assigned
recipient/fallback payloads, and service-role-only execution. It ran only against isolated
`qa-staging`; fixtures were transactionally rolled back. This worktree has no `supabase/config.toml`,
the local Colima Docker daemon is not running, and the historic migration ledger cannot reconstruct
the legacy baseline, so `supabase start`/`npm run test:db:local` is not currently a reproducible
local proof.

On 2026-07-29 the exact reviewed migration was applied to seeded `qa-staging` under ledger version
`20260729220202`; the rollback-only proof completed without exception and a post-proof query found
zero fixture residue. Catalog checks proved invoker mode, pinned search path, service-only ACL,
caller guard, shared phone lock, and outbox projection. The same source was then applied to the
shared project under ledger version `20260729221116`; its deployed definition hash
`58b9d8db71347fb317145e683b8919db`, ACL, and configuration exactly match `qa-staging`. Production
verification was read-only and sent no traffic.

The remaining release order is exact: keep Twilio inbound/provider switching untouched; obtain
separate authorization for provider webhook/configuration and controlled test traffic; prove signed
SMS/MMS and status canaries; then promote compatible code through a reviewed `dev → main` release
before any production provider switch. Production mode, number routing, provider console,
Cloudflare binding changes, deployment promotion, and traffic remain independent gates.

### Mobile messaging release acceptance

The participant foundation migration was applied to `qa-staging` on 2026-07-31 as ledger
`20260731143710`, then to production on 2026-08-01 as ledger `20260801145727`, from source SHA-256
`f9bb379dc794be199cbe6f9e057d5582b61eee71f12e913c9b7a18ad4c6cb1cb`. Read-only postconditions
proved forced RLS and service-only policies on both empty membership tables, no browser table
reads, intended RPC signatures/ACLs and body markers, one foundation ledger row, no enforcement
ledger row, and retained legacy INSERT compatibility. Security/performance advisors introduced no
error-level participant finding; authenticated-definer warnings are intentional caller-gated RPCs,
while two nullable actor foreign keys retain informational index advisories.

The exact reconciled `20260731040338_conversation_unread_state_compatibility.sql` source
(SHA-256 `727669d58ed55ccac46673c4db3f8ac354406f00b791097ef44d98b1a9e88e3d`) was then applied to
`qa-staging` as ledger `20260731181046` and production as ledger `20260801145753`. Post-apply
catalog checks proved both new RPCs are
caller-derived definers with `search_path=pg_catalog, public`, execute for
`authenticated, service_role`, deny `anon`, and leave both membership tables forced-RLS and
browser-inaccessible. A transaction-only QA proof returned an empty authorized snapshot and
zero-row empty unread update, denied a nonexistent conversation and an unmapped actor, then rolled
back. It read no conversation content and retained no fixture or business-row change.

The exact committed `20260731213000_conversation_assignment_authority_containment.sql` source
(SHA-256
`0c7b8769f53bbb45fd7d6127b86b88d53c4fc3101d3b7b72e2b6f51bb5c87f51`) applied to
`qa-staging` on 2026-08-01 as ledger
`20260801144448_conversation_assignment_authority_containment`, then to production as ledger
`20260801145825_conversation_assignment_authority_containment` after production first applied
`40337` and `40338` as ledgers `20260801145727` and `20260801145753`. Each migration preflight and
postcondition completed transactionally. Independent readback matched all four reviewed function
body hashes, postgres ownership, invoker/definer and volatility settings, pinned search paths,
and exact browser/service ACLs; no body references appointment/job/claim/crew authority. QA's
scheduled pending aggregate remained zero; production retained the known aggregate of one.

The hosted step was catalog verification only; the guarded SQL behavior suite is destructive by
design and was deliberately not run there. Earlier on 2026-07-31, superseded `40337–40339`
candidate sources passed disposable local Colima/Supabase clones and rollback/reapply cycles.
That evidence remains useful history but is not proof of the corrected
`31213000 + 31213100 + 31220000 + 31220100` train. Source-contract tests now cover the corrected
authority, authorized-media lookup, ACL, pending-count, provenance, reservation, and full rollback
chain. Earlier revisions of both behavioral proofs passed on a disposable local clone with fixtures
rolled back, but the exact current source has not run through the full governed runner. Provider
traffic and deployment remained untouched during the database apply.

Native repository proof also passed on 2026-07-31: the graph boundary first caught the new
revocation helper missing from its explicit page allowlist; after that correction,
`npm run build:ios:dev` completed the native Vite build and Capacitor sync, and an unsigned
`xcodebuild` for the generic iOS Simulator completed with `BUILD SUCCEEDED`. The installed iPhone
17 Pro Simulator app rendered readable messages, staff sender labels, the title-expanded chat
information, and the native **Chat participants** sheet. The sheet's expected load error is
positive sequencing evidence from the pre-apply state: the simulator app targeted production
before 40337 was applied there. No RPC mutation, provider send, hosted apply, or deployment
occurred during that simulator proof.
Physical-device/TestFlight proof remains separate.

Credential-free negative tests use fake time and deferred actor-scoped responses to prove four
revocation cases: successful inbox omission clears all removed desktop drafts/leases; tech
per-ID expiry enumerates that conversation's sensitive caches and clears its draft; a success arriving
after 30 seconds cannot renew either the tech inbox or active-thread lease; and hidden→visible
purges expired private rows synchronously before an offline revalidation promise starts. These are
local contract proofs, not installed-device or production evidence. A separate deferred
out-of-order test resolves a newer desktop proof first and confirms that the older response is
superseded; silent-reconcile coverage pins stable ordering, omission/addition behavior, and exact
object identity for unchanged rows.
Tech omission coverage also proves actor-derived snapshot batches are capped at 200; filtered
hooks check only exact prior-page omissions; and the always-mounted default hook rechecks sensitive
IDs outside the capped top 50. Fake-timer tests model an unread-to-read omission across repeated
15-second polls beyond the original 30-second lease: allowed snapshots preserve its thread and
draft, while a later denial purges both immediately. QueryObserver tests prove timer expiry and an
authoritative empty proof publish an in-place tombstone without detaching the observer, a
background error retains data only inside the current-owner lease and can recover on refetch, and
delayed account-A responses/timers cannot repopulate or purge same-ID account-B caches. Page-state
contracts additionally pin desktop and tech expired-proof markers ahead of successful empty
states, and executable loader coverage proves tech refresh preserves prior exact-key order and
unchanged row identity while removing omissions and appending new rows.

Release order is compatibility-sensitive because dev and main share production Supabase:

1. **Completed 2026-08-01:** production applied `40337 → 40338 → 31213000`; QA completed
   `31213000`.
2. **Completed 2026-08-01:** trusted conversation authority was verified to contain no
   appointment/job/claim/crew source on QA or production.
3. **Web completed 2026-08-01; native pending:** compatible web source merged to `dev` as
   `745de63c` and Cloudflare Preview deployment
   `7249c5de-a24d-4ffe-ba86-6a57168aa776` completed successfully in 40 seconds. The `dev` custom
   domain served the matching `index-PE0YoM2i.js` asset and loaded the authenticated Conversations
   page. A supported native release and retirement of older direct-unread writers remain required.
4. Apply `31213100` participant enforcement.
5. Deploy hardened web/Worker callers immediately before the scheduled database window; they fail
   closed until their RPCs exist.
6. Verify the aggregate scheduled pending count is zero; if it is not, stop for separate
   owner-directed reconciliation without mutating rows. A read-only 2026-07-31 check found exactly
   one legacy production pending row, so production is currently stopped at this gate.
7. Apply `31220000 → 31220100` in one serialized window and verify provenance, recipient snapshot,
   fencing, grants, fail-closed policy posture, legacy-claim no-op behavior, and that the final
   reservation refuses a disabled SMS switch or any consent result other than
   `GLOBAL_OPT_IN` without linking an attempt.
8. Preserve the exact reviewed source through dev, web production, and the supported native
   release; complete negative authorization and physical-device checks.

For every remaining QA step, target the exact `qa-staging` ref. Its seeded catalog is healthy and
usable, while
the `MIGRATIONS_FAILED` badge reflects the real historical ledger/replay gap documented in the
staging runbook; do not use rebase or ad-hoc ledger writes to clear it. Immutable
`40337/40338/31213000` are ledgered for this train; none of
`31213100/31220000/31220100` has applied.

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

The exact S1e source is now live on `qa-staging` as
`20260731224513_inbound_lead_recording_source_boundary` and on the shared project as
`20260731225511_inbound_lead_recording_source_boundary`. Both catalog postconditions passed.
Production readback found zero residual scalar HTTP recording URLs, zero retained recording keys in
lead payloads, no browser source-table grant, and service-role SELECT. No provider request or
production write-test ran. The security advisor continues to report the intentional authenticated
`get_inbound_leads` definer RPC; its body now enforces the active-internal CRM capability gate.

### Retired S1h database proof boundary

`20260727022920_mobile_personal_ownership_boundary.sql` is retained only as historical source and
must not be applied. Its exact catalog preflight was executed read-only on both `qa-staging` and
production and refused as designed: the focused native-token, preference, and per-token APNs topic
lineage changed the function and migration dependencies it was written to replace. Replaying it
would overwrite newer live contracts and expose legacy raw-token-returning RPCs.

Any remaining Page Access/Web Push ownership work must use a new later migration limited to the
residual page-access/subscription tables and RPCs. It must preserve the live
`notification_prefs`, native-token and APNs-topic contracts. The old guarded isolated/rollback
matrices remain useful historical evidence, not an apply runbook.

The focused native Push qualification additionally proves that every direct
production dispatcher supplies a durable occurrence identity; missing identity
fails closed for APNs; two identical-copy events with different occurrences
both deliver; a retry of one occurrence collapses; token deletion plus
re-registration does not reopen a claimed delivery; an explicit APNs 429/5xx
is release/reclaim retried once; an exhausted message-outbox refusal persists
as native-only without repeating bell/Web Push/email; and a timeout retains its
claim rather than double-sending.

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

## Notification presentation release order

The admin presentation control plane uses an additive, backward-compatible release:

1. run Worker/library/UI/static migration tests plus web and native builds;
2. apply and behavior-test the exact migration on `qa-staging`;
3. commit reviewed source, deploy compatible Worker/UI code to `dev`, then apply the same committed
   migration to the shared production database;
4. verify production RLS/grants/function/catalog and the protected page without saving a live
   override or sending a notification;
5. promote reviewed `dev → main` and verify the production page/API.

Old code ignores the additive tables. New runtime code fails safely to code-owned presentation if
the schema/config read is missing or invalid. Application rollback therefore stops consuming
overrides first and leaves audit data intact; dropping the tables/audit is a separate destructive
rollback.

Steps 1–5 completed on 2026-07-29. The exact migration is recorded in production as
`20260729171946`, with post-apply RLS/grant/function checks and zero live override/audit rows.
Reviewed PR `#547` merged `dev → main` as
`3f456810162dad8c4407d354b36085778d138ae2`; the production bundle embeds that exact SHA.
The protected API returns `401` JSON without authorization, the Settings route returns the SPA
shell, both route-specific notification presentation assets have the correct JavaScript/CSS
content types, and the 34-asset production deployment smoke passed. During the earlier dev
verification, the smoke test detected a stale HTML response cached for a JavaScript chunk; a zone
cache purge removed it, and the complete no-cache-bust smoke rerun passed.

## Notification delivery diagnostic qualification

The owner-only delivery tester has two separate proof layers:

1. Credential-free Worker tests prove denial before side effects, strict request-field and channel
   allowlists, the 15-key event allowlist, fixed self-recipient/copy/routes, durable claim/replay
   before every side effect, browser-subscription pruning, distinct typed identities, stable APNs
   and Resend request identities, and sanitized provider failures.
2. Live delivery remains one separately owner-authorized send per selected channel. A local test
   double, successful build, or protected endpoint response is not evidence that a bell, browser,
   iPhone, or inbox presented the notification. During the 2026-07-29 owner-authorized sweep, the
   owner reported receiving all 15 typed notifications in the tested PWA/native presentation
   surfaces. That observation qualifies the tested transport/presentation path; it does not prove
   that every real producer emits at the correct business moment.

The UI's “Test all four channels” action means exactly one bell, Web Push, native APNs, and email
diagnostic for the owner account. The separate “Test all 15 notification types” action fetches the
authoritative catalog and requires exactly 15 entries, then sends each type to the owner bell, PWA,
and environment-matched iPhone: 45 event/surface checks. Each PWA check fans out to every enrolled
owner browser subscription, so the provider delivery count may be greater than 45. It sends no
email/SMS/MMS and creates no business occurrence. Separate Web Push tags prevent different types
from collapsing into one displayed notification; three surface calls run in parallel per event
while events run sequentially to bound Worker/provider concurrency. The synthetic sweep requires
each catalog row to exist but intentionally does not consume the real-event `enabled` switch; it
qualifies presentation and transport, not whether a source workflow is activated or emits.

The compatible Worker/UI is deployed, and a 2026-07-31 read-only production ledger check verified
the exact committed additive claim-ledger migration as
`20260729183731_notification_delivery_diagnostic_claims`. The endpoint still fails closed with
`claim_unavailable` before contacting any provider if the ledger contract is unavailable.

## OOP quote-to-estimate release sequence (authored 2026-08-03)

The calculator UI is compatible with the old schema: pricing and ordinary quote saves still work,
and only the new explicit conversion click consumes the additive RPC/column. Release in this order:

1. run the CI-visible contract test, migration hygiene, changed-file lint, full test suite and build;
2. apply the exact committed migration to an isolated/local database and run
   the governed `npm run test:db:local` OOP proof, which includes
   `supabase/tests/oop_quote_to_estimate_isolated.sql` (then repeat on `qa-staging` if used for the
   release rehearsal);
3. deploy the compatible UI to `dev`, apply the same reviewed migration to the shared database in a
   low-traffic window, and verify grants, narrowed direct-write policies, the linked draft,
   conversion/correction retry behavior, conflict and converted-invoice refusals, and exact line total;
4. verify browser/PWA opens the existing Estimate editor; verify the native admin-only review route
   refuses non-OOP estimates, opens the same saved lines/total, lets an online admin correct only
   service-address and existing safe line columns, preserves typed edits after a failed write, and
   contains no QuickBooks/send action; neither conversion path may contact QuickBooks itself; and
5. only after qualification, use DevTools to make `tool:oop_pricing` available to eligible roles,
   then promote the reviewed `dev → main` change.

Before first use, the paired rollback removes the additive objects. After any quote is converted,
that rollback deliberately refuses; containment is to return the OOP flag to owner preview or force
disabled and revert the UI while preserving the quote/estimate provenance link. Applying the
migration, flipping the flag, deploying, provider writes and production verification are each
separate owner-authorized actions.

## P4c two-stage production release (2026-08-13)

Use [`admin-mobile-p4c-production-runbook.md`](admin-mobile-p4c-production-runbook.md) for the
release record. D1 must be verified and released first because it is deliberately schema-free: its
provider-maintenance guard and containment preserve current invoice/receipt contracts on the
existing production database. Estimate QuickBooks mutations are intentionally unavailable during
this bounded foundation interval; local estimate editing remains available until D2 restores the
provider path behind its durable command boundary, with provider controls absent and explicit
maintenance copy on every estimate screen. Stored Stripe pay links are non-clickable. D1 tests also
prove that Payment and Estimate webhook retries survive beyond the CDC window, remain realm-pinned,
and drain in legacy or receipt mode without a provider call while the global gate is closed. They
also prove that confirmed UPR MCP payout, checkout-link, and generic Stripe mutations refuse before
provider work while read tools and previews remain available. D1 also proves Xactimate import returns
`xactimate_import_durable_boundary_required` after
authorization/cheap validation and before document or Storage access, Anthropic, QBO, financial
records, or telemetry; the editor exposes maintenance copy and a read-only historical recap only.
Validate D1 without a provider or money canary; deployment and
configuration readback are distinct evidence.

The D1 `origin/dev@2dbfeadd` / `main@eabc817d` record is historical. D2 reached Production `main` in
merge `68b153957db43b28ae6695a40926779a199ac680`; all six serialized P4c migrations applied and passed
catalog/ACL postflight. The strict document capability and provider traffic are exact-on after the
drain/quiet-window checks. Reopening found one binding/credential, zero active queues, and no recent
QBO errors; signed-in Production reload verified estimate Update QuickBooks/Resend and invoice Save
invoice. D2 restores only durable invoice/estimate document paths—not contained Stripe, attachment,
card-charge, payment-delete, or Xactimate writes. No provider mutation canary was run.
