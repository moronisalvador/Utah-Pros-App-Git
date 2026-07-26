<!--
FILE: docs/native-ios/05-data-contracts-and-environments.md

WHAT THIS DOES (plain language):
  Defines how the native iOS client selects an environment, authenticates, consumes Supabase and
  Worker contracts, generates transport types, and proves compatibility without risking the shared
  production database.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, docs/architecture.md, docs/database-schema.md,
            docs/auth-and-authorization.md, docs/upr-agent-qa-access-roadmap.md,
            docs/audit/2026-07/evidence/live-supabase.md, docs/native-ios/contracts/
  External: Supabase Swift SDK, Supabase CLI, Cloudflare Pages Functions
  Data:     reads → versioned contracts, isolated fixtures, and explicitly authorized environments
            writes → never to the shared project from automated native development or tests

NOTES / GOTCHAS:
  - dev and production currently share Supabase project glsmljpabrwonfiltiqm.
  - Generated Swift types describe transport shapes; they do not prove authorization or behavior.
  - Dated live evidence is a snapshot, not proof of current configuration.
-->

# Native iOS Data Contracts and Environments

## Purpose

The native app is a new client of an existing business system, not a new source of business truth.
Its data layer must preserve deployed PWA/Capacitor behavior while making every native dependency
explicit, testable, least-privileged, and safe to evolve.

This document is both an architecture contract and a construction sequence. A feature may not skip
ahead because a request happens to decode successfully in a simulator.

## Evidence boundary at plan creation

The following statements are **source-confirmed** at base commit
`90b265ee6f733c8dbcd75786f4e4057dd3355d38`:

- the web client has direct table/PostgREST, RPC, Storage, Realtime, and Worker callers;
- Auth and Realtime use the Supabase client, while other data paths also use a custom REST client;
- `dev` and `main` point at the same Supabase project;
- the current client maps an authenticated user to an `employees` row by email in one important
  path, while current Worker guidance resolves employee identity using `auth_user_id`;
- the existing clients must continue working while native contracts are introduced.

The repository and the dated `2026-07-22` live evidence do **not** prove current production state.
Before a native contract can reach `approved_native`, reviewers must recapture the applicable
read-only catalog, grants, RLS, function, Storage, Realtime, and provider evidence.

## Contract truth has two independent axes

Do not collapse intended behavior and deployed behavior into one ranking:

| Axis | Evidence | What it proves |
|---|---|---|
| Normative intent | current project law; approved canonical business/authorization invariants; reviewed migrations, SQL, Workers, policies, grants, and compatibility decisions | what the system is required or planned to do |
| Deployed observation | current read-only catalog/provider evidence; deployed commit/version where knowable; exact-environment behavior and authorization tests | what the named environment actually does now |

Generated reports/types, current callers, fixtures, and historical snapshots support those axes but
do not replace either one. An unapplied migration is normative/source evidence, not deployed truth.
A current catalog observation does not silently redefine an approved business or authorization
invariant.

Every contract records both axes separately. Any mismatch—such as source that expects a policy an
environment does not have, or deployed behavior with no approved source/invariant—is a stop
condition until the owners reconcile it. Neither axis silently overrides the other.

## Required environment model

### Target matrix

| Environment | Purpose | Data | Writes | Provider effects | Required proof |
|---|---|---|---|---|---|
| Swift previews and unit tests | Components, reducers, validation, decoding | In-memory deterministic fixtures | Local only | None | Fixture lineage and deterministic tests |
| Local Supabase | Contract, RLS, migration, integration, and sync tests | Disposable seeded local project | Allowed only inside disposable instance | Fake/sandbox adapters only | CLI status, seed version, project-ref sentinel |
| Hosted native QA | Multi-device, push, background, Realtime, and realistic integration | Synthetic isolated QA project | Allowed for controlled synthetic identities | Sandbox/disabled/test modes only | Dedicated project, fixture reset, kill switches |
| Shared `dev`/production project | Read-only catalog comparison and narrowly owner-authorized manual proof | Real production data | **Prohibited for automation** | **Prohibited by default** | Read-only evidence and separate owner gate |
| App Store production | Real field use after release approval | Production | User actions through approved contracts | Approved production modes only | Release evidence, monitoring, rollback |

### Current blockers

The environment roadmap identifies two prerequisite tracks:

- **P2a — deterministic local Supabase:** blocked until the repository has a governed local
  configuration, supported CLI/runtime, ordered migration proof, representative synthetic roles,
  deterministic seed/reset, and fake provider boundaries.
- **P2b — hosted isolated native QA:** blocked until a separate Supabase project, separate provider
  modes, synthetic identities, fixture lifecycle, access controls, cost ownership, and cleanup
  policy are provisioned.

Proof is layer-specific:

- P2a is required before implementing or approving migrations, grants, RLS, RPCs, direct data
  contracts, and deterministic database integration behavior.
- P2b is required before claiming deployed Auth, Storage, Realtime, Worker, provider-sandbox,
  multi-device, background, or physical-device behavior.
- A workflow may use only the layers its selected environment proves. Until a layer's track passes,
  that layer remains limited to mocks, fixtures, static contract work, and read-only discovery.
- The complete applicable P2a/P2b evidence set is required before release approval.

A green unit suite is not permission to point a Debug build at the shared project.

### Xcode configurations and schemes

Create explicit, non-overlapping build configurations:

| Scheme | Configuration | Backend | Bundle identity | Intended use |
|---|---|---|---|---|
| `UPR-Local` | Debug Local | local Supabase or mock transport | local-only suffix | previews, unit, local integration |
| `UPR-QA` | Debug QA / Release QA | hosted isolated QA | QA suffix | simulator, device, TestFlight QA |
| `UPR-Production` | Release Production | production | App Store identifier | approved release only |

Environment values must be injected through reviewed `.xcconfig` files or the governed build
system. Commit safe names and placeholders, never secret or service-role material. A Supabase
publishable key is designed for public clients, but its pairing with a project URL is still a
safety-critical environment binding.

Required runtime sentinels:

1. `UPR-Local` and automated test processes refuse the known shared project reference and host.
2. `UPR-QA` refuses the production project reference, production Worker origin, and production
   provider modes.
3. `UPR-Production` refuses local/QA references and refuses to start when a required production
   identifier is absent.
4. No configuration falls back to production when a variable is empty.
5. The app displays a persistent non-production indicator in QA builds.
6. Startup logs report only a non-secret environment label, build, and safe project fingerprint.
7. CI tests every forbidden pairing, including renamed hosts and accidental Release-with-QA values.

A compile-time flag alone is insufficient. Validate the resolved runtime configuration before the
first Auth, database, Storage, Realtime, Worker, telemetry, or push request.

## Client credentials and Supabase key migration

The native binary may contain only:

- the intended project URL;
- a modern Supabase publishable key;
- public Worker origins and other expressly public client identifiers.

It must never contain a Supabase secret key, legacy `service_role` key, provider secret, private
signing key, webhook secret, administrative bearer token, or privileged SQL mechanism.

Supabase is migrating from legacy `anon`/`service_role` keys to publishable/secret keys. The native
foundation must use a publishable key and verify the repository's migration/rotation plan without
breaking existing clients. Rotation is an operational contract because an App Store binary cannot
be recalled instantly. The key plan must specify:

- overlap period for old and new public keys;
- oldest supported client version during rotation;
- emergency disablement and minimum-version behavior;
- validation in QA before production;
- monitoring that distinguishes expired session, bad key, and authorization denial.

References:

- [Supabase database API security](https://supabase.com/docs/guides/database/secure-data)
- [Migrating to publishable and secret keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Upcoming Supabase API-key changes](https://supabase.com/changelog/29260-upcoming-changes-to-supabase-api-keys)

## Native data-layer shape

Use dependency injection and narrow protocols rather than a global omnipotent client:

```text
SwiftUI feature
  -> feature model / use case
    -> domain repository protocol
      -> contract-specific transport
        -> Supabase Auth | RPC/PostgREST | Worker | Storage | Realtime
```

Required properties:

- one composition root chooses environment and real/fake implementations;
- domain models do not import Supabase or HTTP response types;
- transport DTOs are generated or hand-authored against a versioned contract;
- mapping validates required identifiers, money units, timestamps, nullability, and enums;
- side effects use purpose-specific clients instead of exposing generic SQL/RPC access to views;
- every request carries a generated correlation ID safe for client and server logs;
- clocks, UUID generation, network reachability, and retry scheduling are injectable in tests;
- session changes cancel or rebind in-flight work;
- no singleton silently survives an account or environment switch.

Do not expose a general `rpc(name:parameters:)` or `table(name:)` API to feature modules. The
contract layer may use the SDK primitives internally, but callers receive typed capabilities such
as `AppointmentRepository.loadDetail` or `PhotoCommand.submit`.

## Authentication and employee identity

Treat these as distinct concepts:

1. **Supabase user:** authenticated subject and session.
2. **Employee membership:** active business identity and role/assignment context.
3. **Feature capability:** server-enforced permission for the exact resource or action.

The app must implement an explicit session state machine:

```text
launching -> signed_out -> authenticating -> resolving_membership
          -> active | inactive_employee | unauthorized | refresh_required | terminal_error
```

Before implementing the first authenticated workflow, resolve and document the observed
email-based versus `auth_user_id` employee lookup divergence. The intended long-term identifier
must be immutable, unique, server-validated, and backwards compatible. Native code may not guess
that email ownership is sufficient authorization.

At the trusted Worker/database boundary, derive the authenticated subject and canonical active
employee membership from the validated session. Any employee, actor, organization, assignment, or
owner identifier supplied by the client is an untrusted resource/context parameter: it must match
server-derived identity and resource relationships, and it can never establish authorization or
authoritative audit attribution.

Auth requirements:

- use the Supabase Swift Auth client and observe auth-state changes;
- store refresh credentials only through the SDK/Keychain-backed approved mechanism;
- refresh centrally, coalesce concurrent refreshes, and retry only requests proven not to have
  reached the business boundary;
- on sign-out, employee deactivation, password reset, account switch, or revoked session, cancel
  subscriptions and sensitive work, then purge/quarantine local account data;
- represent authentication failure separately from authorization denial;
- never infer a role from navigation, cached employee data, or a JWT without server enforcement.

## Contract registry

Every native screen-to-backend dependency gets one registry entry using
`contracts/registry-template.yaml`. An entry is incomplete unless it records:

- stable contract ID, owner, lifecycle status, and compatibility/version policy;
- user workflow and source-of-truth boundary;
- transport kind, endpoint/table/RPC/bucket/channel, method, timeout, and availability;
- exact request fields, response fields, nullability, enums, timestamps, money units, pagination,
  sorting, and filtering;
- authenticated subject, employee membership, allowed roles/assignments, denied roles, and the
  server/database enforcement point;
- exact schema/table/view privileges and exposed columns; each command-specific RLS policy,
  policy role/mode, `USING`, `WITH CHECK`, and referenced function; scope-column mutation tests;
  view owner/`security_invoker` behavior; exact RPC overload/owner/ACL/security mode/`search_path`
  and internal subject/resource checks; Worker authorization; Storage policy; and Realtime channel
  behavior as applicable;
- separate normative/source evidence and current-environment observation artifacts;
- server-derived actor/membership and audit attribution, plus negative tests proving client-supplied
  actor, employee, organization, assignment, owner, and parent identifiers cannot authorize;
- idempotency key, deduplication record, ambiguity/reconciliation behavior, retry class, and
  cancellation semantics for mutations;
- offline read, draft, cache, queue, conflict, attachment, account-switch, and purge behavior;
- PII/security classification, local protection, log redaction, and retention;
- stable error codes and user-recovery behavior;
- source paths, migration/function evidence, generated type version, fixtures, tests, and live/QA
  evidence timestamps;
- PWA/Capacitor callers and compatibility result;
- unresolved questions and approval gates.

The source-extracted `bootstrap-inventory.yaml` is only a starting list. It deliberately lacks
signatures, policies, data classification, authorization proof, live deployment proof, and
business approval. Its entries cannot be promoted automatically.

## Contract categories

### Direct table and PostgREST reads

Prefer purpose-specific read contracts that expose only required columns and deterministic
pagination. Before approving a direct table:

- confirm `SELECT` grants and RLS for the real client role;
- prove company, organization, owner, assignment, or role scope as required;
- deny cross-resource identifiers in negative tests;
- avoid `select=*`;
- define stable ordering with a unique tie-breaker;
- set a page-size maximum and cursor/continuation shape;
- define deleted/archived record behavior.

Direct table writes require higher scrutiny. If validation, authorization, audit, idempotency, or
multi-record invariants matter, use a reviewed RPC or Worker boundary instead.

### RPCs

For each RPC, inspect the exact deployed signature, return shape, grants, `SECURITY INVOKER` versus
`SECURITY DEFINER`, `search_path`, table access, authorization checks, and every existing caller.

New functions must not retain `EXECUTE TO PUBLIC`. A `SECURITY DEFINER` RPC is approved only when
the trusted boundary validates the caller and resource inside the function, and its contract
explains why invoker security is insufficient.

### Cloudflare Workers / Pages Functions

Use Workers for provider secrets, webhook/provider actions, privileged multi-system orchestration,
and policy that cannot safely run in a public client. Each Worker contract must define:

- server-side session verification;
- employee and role/assignment authorization;
- request schema and size limit;
- timeout and provider timeout;
- stable idempotency key and deduplication for side effects;
- provider sandbox/disabled/production mode;
- rate limit and retry guidance;
- stable redacted error envelope;
- audit/worker-run record and correlation ID.

### Storage

Bucket existence is not access proof. Each object contract must define bucket privacy, object-name
scheme, MIME/size limits, upload authorization, object RLS, read mechanism, signed URL expiry,
malware/content checks when applicable, retention, deletion, and orphan cleanup.

The current `message-attachments` pattern—private objects uploaded and viewed through authorized
Workers with opaque client references—is a useful boundary to evaluate. It is not automatically
approved for every media class.

### Realtime

For each subscription, define:

- table/channel/event/filter;
- authenticated/employee/assignment scope;
- publication and RLS evidence;
- initial snapshot and reconnect ordering;
- duplicate, out-of-order, deletion, and missed-event handling;
- token refresh and account-switch behavior;
- fallback polling and battery budget.

Realtime is an invalidation/acceleration channel, not durable truth. Every reconnect must be able
to reconcile from a bounded authoritative read.

## Shapes, pagination, time, and money

Every contract must make the following explicit:

- identifiers are opaque strings/UUIDs and never synthesized from display values;
- timestamps are ISO-8601 instants with server authority; local dates include the governing time
  zone and daylight-saving behavior;
- date-only business values are not silently decoded as instants;
- nullable, absent, and empty values retain different meanings when the backend distinguishes
  them;
- enum evolution has an unknown-value policy instead of crashing old clients;
- money uses integer minor units or reviewed decimal semantics—never binary floating point;
- paginated lists have maximum page size, deterministic sort, unique tie-breaker, continuation
  format, end condition, and mutation-during-pagination behavior;
- large payloads and attachments have explicit byte/record limits;
- schema decoding fails observably without logging sensitive payloads.

## Error envelope

Workers and native adapters normalize errors to a safe model:

```yaml
code: stable_machine_code
category: authentication | authorization | validation | conflict | rate_limit |
  unavailable | timeout | ambiguous | not_found | unknown
message: safe_user_or_support_message
request_id: non_secret_correlation_id
retry_after_seconds: optional
field_errors: optional_redacted_map
```

Expected HTTP semantics:

- `401`: session missing/expired; refresh or sign in, never treat as a role denial;
- `403`: authenticated but not authorized; no automatic retry;
- `404`: missing or intentionally concealed resource;
- `409`: version/idempotency/business conflict requiring reconciliation;
- `422`: valid transport but invalid domain input;
- `429`: bounded retry only after server guidance;
- `5xx`/network/timeout: classify read versus mutation ambiguity before retry.

Never surface raw Postgres details, stack traces, provider bodies, credentials, signed URLs, or
unnecessary PII.

## Timeout, retry, and idempotency

Each contract owns a policy; there is no universal “retry three times.”

- Reads may use bounded retry for transient transport/`429`/selected `5xx` failures when the
  request is idempotent and cancellation-aware.
- Mutations are never retried merely because the client did not receive a response.
- A mutation eligible for retry carries a stable operation UUID across process restarts and a
  server-side idempotency record/receipt.
- Client and server timeouts are both defined; a client timeout does not prove the server stopped.
- Retry uses capped exponential backoff with jitter, respects `Retry-After`, and ends in a visible
  reconciliation state.
- SDK retry behavior must be pinned, reviewed, and tested for the selected version; business
  safety may not depend on an undocumented default.

The full mutation state model is defined in
`07-offline-sync-and-reliability.md`.

## Type generation and dependency governance

Supabase supports generation of Swift database types:

```text
supabase gen types --lang swift
```

Run generation only in a trusted local or CI environment against reviewed migrations or an
explicitly authorized project. Runtime OpenAPI discovery from a public mobile key is neither a
supported architecture nor an authorization control.

Generated types:

- are committed with a generator/CLI version and source schema/migration fingerprint;
- are reviewed as generated artifacts and never hand-edited;
- compile in CI;
- feed transport DTOs but do not replace domain models;
- do not prove RLS, grants, RPC authorization, business invariants, live deployment, or backwards
  compatibility;
- are regenerated in a deliberate contract-change commit.

Pin the Supabase Swift SDK and all packages with a reviewed dependency policy and committed
`Package.resolved`. Record the Swift/Xcode, SDK, CLI, and generator versions used for release.

References:

- [Supabase local development and type generation](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase Swift Auth state changes](https://supabase.com/docs/reference/swift/v1/auth-onauthstatechange)
- [OpenAPI access change](https://supabase.com/changelog/42949-breaking-change-removing-access-to-openapi-spec-via-the-anon-key)

## Compatibility strategy

The PWA/Capacitor clients remain operational while native ships. Therefore:

- preserve existing function names, parameters, return columns, status values, and Worker
  responses used by deployed clients;
- add nullable fields or versioned endpoints rather than reinterpreting existing fields;
- keep old mutation behavior until telemetry and a version-adoption gate permit retirement;
- introduce native-safe desired-state or idempotent commands alongside unsafe legacy toggles;
- deploy compatible backend changes before the native build that consumes them;
- test the oldest supported PWA/Capacitor caller and native caller together;
- record deprecation owner, minimum client version, telemetry threshold, and removal date;
- never use a mobile release to conceal a breaking database change.

## Contract verification lane

For each proposed native contract, CI and governed QA perform:

1. registry schema validation and unique-ID checks;
2. source inventory diff to identify new/removed direct calls;
3. ordered local migrations and schema/type generation;
4. Swift DTO compile and fixture decoding/encoding tests;
5. positive and negative direct-layer authorization tests for representative roles, assignments,
   ownership, cross-resource IDs, inactive employees, expired sessions, and anonymous access;
6. mutation idempotency, ambiguous response, timeout, and duplicate-delivery tests;
7. Worker contract tests including provider sandbox/disabled assertions;
8. Storage object-policy and signed-access tests;
9. Realtime reconnect, missed-event, token-refresh, and cross-account tests;
10. compatibility tests for current PWA/Capacitor callers;
11. hosted-QA simulator/device proof using synthetic data;
12. read-only current-environment comparison before production approval.

Runtime commands are bounded to five minutes per attempt, clean up in `finally`/`defer`, terminate
spawned children, and record environmental limits as blocked rather than stalling the lane.

## Data-contract readiness gate

The first native vertical slice may connect to a non-mock backend only for layers whose required
isolation is proved:

- `NIOS-H: READY`, Phase 0 closure, current-base reconciliation, and separate Swift implementation
  authority are recorded before any native caller is implemented;
- disposable local isolation passes for every migration, grant, RLS, RPC, direct-data, and
  deterministic database contract the slice exercises;
- hosted isolated QA passes before the slice claims deployed Auth, Storage, Realtime, Worker,
  provider-sandbox, multi-device, background, or physical-device behavior;
- forbidden production pairings fail closed in every participating build/environment;
- only a publishable key and public identifiers are present in the binary;
- Auth/session/account-switch behavior is tested;
- the employee identity contract is resolved;
- every dependency has a complete registry entry at least `verified_local`;
- exact table/RPC/Worker/Storage/Realtime authorization has positive and negative evidence;
- request/response/error/pagination/time/money semantics are fixture-tested;
- every mutation has a reviewed idempotency and ambiguity strategy;
- Swift/generated types and dependency versions are pinned;
- existing PWA/Capacitor compatibility passes;
- privacy, offline, telemetry, performance, and test owners approve their portions;
- any unavailable live/provider/device proof is recorded as a later gate, never implied.

`verified_qa` and production approval require the complete applicable local and hosted evidence
set. Production also requires the stronger `approved_native` status, current read-only evidence,
real-device QA, release review, and an explicit owner-controlled deployment/release action.
