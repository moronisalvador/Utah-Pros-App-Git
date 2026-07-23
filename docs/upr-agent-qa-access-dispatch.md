<!--
FILE: docs/upr-agent-qa-access-dispatch.md

WHAT THIS DOES (plain language):
  Provides copy-ready prompts for future sessions implementing the UPR QA access foundation.
  Each prompt carries the safety boundaries, owned scope, prerequisites, and stop conditions needed
  for a cold session to work without relying on this planning conversation.

DEPENDS ON:
  Internal: docs/upr-agent-qa-access-roadmap.md,
            .claude/rules/upr-agent-qa-access-ownership.md, AGENTS.md, CLAUDE.md
  Data:     reads  → repository evidence and later owner-approved isolated QA state
            writes → future phase-owned files only after owner authorization

NOTES / GOTCHAS:
  - These are proposed prompts, not authorization to launch a phase.
  - Every phase stops on an environment, provider-mode, ownership, or secret ambiguity.
-->

# UPR Agent QA Access — Dispatch and Cold-Session Prompts

Plan of record:
[`upr-agent-qa-access-roadmap.md`](upr-agent-qa-access-roadmap.md)

Binding ownership:
[`.claude/rules/upr-agent-qa-access-ownership.md`](../.claude/rules/upr-agent-qa-access-ownership.md)

## Universal preflight for every phase

```text
You are implementing one explicitly authorized phase of the UPR Agent QA Access and Test Foundation.

Read completely before acting:
- AGENTS.md and CLAUDE.md
- docs/upr-agent-qa-access-roadmap.md
- docs/upr-agent-qa-access-dispatch.md
- .claude/rules/upr-agent-qa-access-ownership.md
- docs/testing-and-deployment.md
- docs/auth-and-authorization.md
- docs/architecture.md
- applicable .claude/rules documents and current July audit evidence

Run git status --short --branch. Preserve all unrelated changes. Confirm the prior phase acceptance
evidence and current Encircle handoff before touching any implementation file. The planning baseline
is origin/dev commit 0a06a21: managed-credential code landed, CI and Cloudflare staging passed per the
owner, migration unapplied, rollout flag OFF, and credentials unchanged. Reverify that state
read-only; do not infer that repository source means the migration or credential cutover is live.

Non-negotiables:
- dev and production share Supabase and are never write-capable QA targets.
- Production testing is read-only smoke only.
- Do not create identities, secrets, provider resources, deployments, or paid services unless the
  owner explicitly authorized that exact action for this phase.
- Never attach automation to a human browser profile or persist a real owner session.
- Feature flags, is_external, route hiding, consent, and naming prefixes are not QA containment.
- Unknown environment, lineage, provider mode, credential, telemetry, or ownership fails closed.
- Never expose or log secret values, cookies, Authorization headers, Auth state, PII, message bodies,
  payment details, signed URLs, or raw provider payloads.
- Stop if a requested change overlaps an unowned Encircle/shared hotspot or assumes the pending
  Encircle rollout has advanced.

Use only the phase-owned files. Run proportional verification and report actual results, unexpected
skips, retained artifacts, external gates, and exact working-tree diff. Do not commit, push, deploy,
apply migrations, create accounts, or call providers unless the phase instruction and owner explicitly
authorize that delivery step.
```

## P0 — Owner decisions and environment design

```text
Objective: close the decision gates in P0 without modifying runtime code or external systems.

Start with Universal preflight. This is documentation and evidence review only.

Produce a decision addendum covering:
1. dedicated Supabase/Auth/Storage project ownership and budget;
2. dedicated Cloudflare QA project/domain;
3. exact browser navigation and egress allowlists;
4. QA role fixtures, including no synthetic owner under the current email identity model;
5. provider order and mock/sandbox policy;
6. telemetry vendor/first-party choice, retention, access, alerts, privacy review;
7. GitHub secret/environment/artifact controls;
8. WCAG target and real-device matrix;
9. Encircle post-`0a06a21` rollout ownership, sandbox/mock decision, and shared-hotspot freeze.

Read-only external inventory is allowed only if explicitly available. Do not create or change any
resource. Distinguish verified current configuration from requested future state.

Acceptance: every P1/P2a/P2b dependency has an owner and an explicit approved/blocked state. Stop with the
proposed documentation diff and unresolved owner actions. Do not publish.
```

## P1 — Credential-free localhost test foundation

```text
Objective: add the local, mocked browser/test foundation without credentials or live network access.

Prerequisites: P0 decisions approved; Encircle `0a06a21` rollout state reverified read-only and exact
test/config ownership granted. The unapplied migration, OFF flag, and existing credentials are not
changed by this phase.

Owned scope is limited to the P1 rows in the ownership manifest:
- explicit Vitest config/partitions and scripts;
- Playwright + axe dependency/config;
- e2e fixture/mocked workflow files;
- exact-origin navigation/egress guard;
- pipe-based ephemeral CDP launcher; authenticated-broker/process-ACL TCP fallback only;
- artifact redaction/scanning and ignore rules;
- CI lane only if expressly assigned.

Required behavior:
- unit/worker lanes block network;
- test discovery excludes nested worktrees, build output, Wrangler output, generated output;
- mocked localhost flows cover desktop and 390px office/tech shells;
- loading/error/empty/stale/resume, keyboard/focus, reduced motion, zoom/reflow and screenshot fixtures;
- disallowed redirect/popup/worker/WebSocket/download/egress attempts fail;
- pipe mode exposes no TCP debug socket; a TCP fallback rejects an unauthorized second local process;
- production origin cannot enter this lane;
- no .env, credentials, storage state, real data, browser profile, provider call, database write, or
  deployment.

Verification includes test listing, unit/worker lane, browser guard negatives, axe, deterministic
screenshots in the pinned environment, secret/artifact scan, build, targeted lint, and diff check.

Stop with results and owner gates. Do not publish.
```

## P2a — Local Supabase database contracts

```text
Objective: build migration/RLS/RPC/trigger contracts in a clean local Supabase stack only.

Prerequisites: local runner sentinel and data policy approved; migrations-from-zero provenance
reconciled; Encircle/shared migration ownership cleared without applying or changing the pending
Encircle rollout.

Never point this phase at glsmljpabrwonfiltiqm. The runner must refuse the known shared project ref,
missing local sentinel, unexpected migration head, or non-local environment.

Build:
- migrations-from-zero and catalog fingerprint lane;
- database role/assignment/owner/organization contract fixtures;
- immutable qa_run_id lineage design and local seed manifest;
- preview/count-first cleanup, mixed-lineage refusal, idempotency, TTL janitor;
- direct RLS/RPC/PostgREST matrix for missing/expired/inactive/wrong-role/wrong-assignment cases.

Do not create hosted Auth users, storage state, deployments, provider resources, or production copies.

Acceptance: zero unexpected skips, migration head/fingerprint recorded, role matrix passes, seed and
cleanup repeat cleanly, zero residual, and known shared project is provably rejected.

Stop with the proposed diff, local evidence, and P2b external gates. Do not
apply changes to the shared project or publish.
```

## P2b — Hosted isolated Supabase/Auth/Storage and role identities

```text
Objective: create the hosted QA identity/data foundation only in the owner-approved dedicated
Supabase/Auth/Storage project.

Prerequisites: P2a accepted; dedicated QA project exists; exact project ref/sentinel, budget, owner,
and retention policy approved; Encircle/shared ownership cleared. The isolated project may apply
reviewed migrations from zero, but this does not authorize applying the Encircle migration to the
shared project or changing its live flag/credentials.

Never point this phase at glsmljpabrwonfiltiqm. Build qa_admin, qa_office, qa_pm, qa_tech,
qa_restricted, qa_no_employee, qa_inactive, and qa_expired identities; matching Auth email and
employees.auth_user_id links; assignment fixtures; immutable qa_run_id lineage; hosted seed/cleanup;
and direct Auth/RLS/RPC/PostgREST negatives.

Do not create a synthetic owner using the real owner email. Do not copy production rows, identities,
credentials, or Storage objects. Do not call providers or deploy the application.

Acceptance: exact QA project sentinel passes; shared project is rejected; no production data exists;
role/assignment/active/revocation/expiry matrix passes; refresh-token reuse fails after revocation;
captured access-token invalidation or bounded expiry is evidenced; seed/cleanup repeats to zero.

P2a alone does not unlock P3. Stop with the proposed diff, hosted-QA evidence without secrets, and
external gates. Do not publish.
```

## P3 — Isolated deployment, storage state, containment, and telemetry

```text
Objective: connect the isolated QA data project to a dedicated QA Cloudflare deployment while all
provider outcomes remain deny or simulate.

Prerequisites: P2a and P2b accepted; dedicated QA Cloudflare project/domain and separate bindings exist;
credential and observability ownership approved; Encircle/shared auth/provider hotspots explicitly
assigned from the `0a06a21` baseline.

Build in the assigned shared-hotspot order:
1. server-side active employee + QA/run resolution;
2. fail-closed side-effect policy before credential resolution;
3. versioned side-effect registry plus CI failure on unregistered direct egress/provider paths;
4. adapter enforcement for every enumerated messaging/money/provider path;
5. durable lineage across queues, scheduled work, triggers and webhooks;
6. privacy-safe pre-side-effect decision/attempt ledger and alerts;
7. per-role/per-run ephemeral Playwright storage states outside repo;
8. exact navigation/egress policy for the dedicated QA origin and QA Supabase only.

All provider adapters must remain mocked/simulated. Missing config or telemetry denies. No production
credential fallback. Do not persist or automate the real owner account.

Acceptance:
- QA-to-production and mixed lineage denied before provider/business mutation;
- provider spies are zero for all denied cases;
- async lineage survives without a user session;
- one synthetic failure produces one redacted event/alert;
- storage state TTL, role assertion, revocation, deletion, and artifact exclusion pass;
- refresh-token reuse fails after revocation; captured access tokens are invalidated by an evidenced
  server check or expire within the approved bound;
- production/shared-project targets remain read-only and inaccessible to write runners.

Stop with evidence, diff, and provider account gates. Do not publish or deploy unless separately
authorized.
```

## P4 — Isolated draft-write workflows

```text
Objective: enable only synthetic, non-provider draft writes in the isolated QA environment.

Prerequisites: P3 accepted; owner explicitly opens write-capable QA; cleanup/alert on-call owner named.

Implement and verify the first workflows:
- qa_admin: admin read views plus one synthetic draft-only config/access workflow; owner-only denial;
- qa_office: synthetic contact/claim/job/schedule plus draft note/appointment;
- qa_pm: assigned synthetic job/claim plus same-role unassigned denial;
- qa_tech: 390px assigned appointment/tasks, mocked photo/note, hidden >30s/resume preservation;
- qa_restricted: CRM/help allow plus direct URL/Worker/RPC/PostgREST denials.

Every write must carry qa_run_id lineage, be idempotent, avoid triggers/providers or prove QA-aware
handling, and clean to zero. Every denial asserts zero provider calls and zero business mutations.

Run deterministic visual/a11y/mobile/lifecycle matrix and privacy-scan all failure artifacts. Real
camera/location/haptics/push/WKWebView/VoiceOver remain owner-device gates.

Stop after isolated QA evidence and cleanup. Never run these writes on dev or production. Do not
publish unless separately authorized.
```

## P5 — Provider sandbox activation template

```text
Objective: enable exactly one owner-approved provider sandbox. Do not combine providers.

Provider: <Resend | Twilio | Stripe | Intuit/QBO>
Prerequisites: P4 accepted; dedicated sandbox/test account, credentials, callback/webhook, allowed
targets, budget/limits, and provider owner are approved and evidenced.

Before any call, positively attest without exposing values:
- QA environment/project;
- provider account/key/realm mode;
- exact endpoint;
- callback/webhook mode;
- approved sink/account target;
- no production credential fallback;
- durable redacted attempt and stable idempotency key.

Required negatives:
- production key/realm/account in QA;
- QA actor or record targeting production;
- missing/mixed lineage;
- unapproved recipient/account;
- wrong-mode webhook;
- retry with same key and divergent payload.

Required failure injection:
- provider success followed by local failure and retry;
- timeout/429/5xx;
- duplicate webhook/event;
- cleanup/reconciliation.

Provider notes:
- Resend uses documented resend.dev test recipients first.
- Twilio test credentials do not send real messages and do not produce normal status callbacks;
  this lane proves request validation and simulated errors only. Delivery, callbacks, and
  provider-success reconciliation require a separately approved dedicated test account and sink.
- Stripe requires test keys/test webhook and never real card details.
- Intuit requires Development credentials and an allowlisted sandbox company/realm; Payments uses
  documented mock data.
- Encircle is not selectable merely because `0a06a21` landed. It requires a separate sandbox/mock
  decision, explicit authorization, and proof that the shared migration/flag/credentials remain at
  their intended rollout state.

Acceptance: only the selected sandbox/sink is reachable; production is structurally unreachable;
idempotency/reconciliation/observability pass; owner console evidence captured without secrets.

Stop after this provider. Do not open another provider, deploy, or publish without new authorization.
```

## P6 — CI/release and native expansion

```text
Objective: make the accepted QA layers repeatable release evidence and expand only after the web
foundation is stable.

Prerequisites: P1, P2a, P2b, and P3-P5 accepted for the enabled scope; GitHub protected
environments/secrets/artifact
policy approved; branch protection verified; Apple/device owners assigned.

Build:
- blocking unit and mocked Worker lanes;
- isolated DB lane with zero unexpected skips and migration fingerprint;
- isolated deployed browser/a11y/visual lane;
- public-only production post-deploy smoke from a versioned semantic endpoint/RPC allowlist;
- redacted artifact retention and secret scan;
- supervisor/estimator fixture expansion if product roles require it;
- separate native checklist/suite for real iPhone, VoiceOver, camera, location, haptics, push, safe
  areas, minimize/resume, and installed-app lifecycle.

Do not claim Chromium emulation proves iOS/WKWebView. Authenticated production smoke remains manual
until a production-specific read-only capability exists. Method alone does not classify a call as
read-only; prove no durable row/event fingerprint changes before/after public smoke. Capgo OTA
coverage remains blocked if the plan/account limit is not resolved.

Acceptance: enforced checks and current external configuration are verified, skips are explicit,
rollback/on-call owners are named, and native evidence is recorded separately.

Stop with the release-readiness diff and external gates. Do not publish unless explicitly requested.
```
