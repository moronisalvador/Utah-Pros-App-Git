<!--
FILE: docs/native-ios/contracts/README.md

WHAT THIS DOES (plain language):
  Defines the catalog used to trace every native screen and workflow to its backend, authorization,
  offline, privacy, compatibility, and evidence contracts.

DEPENDS ON:
  Internal: docs/native-ios/05-data-contracts-and-environments.md,
            docs/native-ios/06-security-privacy-and-compliance.md,
            docs/native-ios/07-offline-sync-and-reliability.md
  Data:     reads → source, migrations, callers, generated types, isolated QA, read-only live proof
            writes → versioned contract documentation only

NOTES / GOTCHAS:
  - bootstrap-inventory.yaml is orientation, not an approved contract catalog.
  - A generated Swift type does not prove grants, RLS, authorization, or live deployment.
-->

# Native iOS Contract Catalog

## Purpose

This directory prevents the native app from rediscovering backend behavior screen by screen. One
registry entry traces each native dependency from user intent through transport, authorization,
offline behavior, privacy, tests, compatibility, and external evidence.

A contract is not just a response type. It includes:

```text
user intent
  -> native use case
    -> request and response shape
      -> authentication and authorization
        -> database / Worker / Storage / Realtime enforcement
          -> failure, retry, idempotency, and reconciliation
            -> privacy, retention, and compatibility
```

The catalog does not authorize backend changes. Migrations, grants, policies, RPCs, Workers,
Storage configuration, Realtime configuration, provider settings, deployments, and production
writes require their own reviewed and explicitly authorized work.

## Files

- `registry-template.yaml` is the normative entry schema and an illustrative non-live example.
- `bootstrap-inventory.yaml` is an optional source-extracted list of names and representative
  callers at a recorded commit. Every item starts at `inventory_only`.
- Approved entries may later be split into domain files when the owner chooses the catalog layout.
  Retain stable IDs and validate the combined catalog in CI.

No file may contain credentials, access tokens, real customer payloads, signed URLs, private keys,
or unredacted production evidence.

## Lifecycle statuses

Use only these values:

| Status | Meaning | May native code depend on it? |
|---|---|---|
| `inventory_only` | A name/caller was mechanically or manually observed; signature, semantics, authorization, and live state are unverified | No |
| `draft` | Intended native contract is being designed; questions or evidence remain | No, except mocks/prototypes |
| `source_reviewed` | Relevant source, callers, migrations/functions/policies are reviewed at a commit | Mocks/local scaffolding only |
| `verified_local` | Shapes, positive/negative auth, errors, idempotency, and compatibility pass in deterministic local isolation | Local implementation only |
| `verified_qa` | Hosted isolated QA plus applicable simulator/device/provider sandbox evidence passes | Internal QA build |
| `approved_native` | Current external evidence and all security/privacy/offline/release gates are reviewed for the named native release | Yes, for the recorded version/environment |
| `blocked` | A named prerequisite, contradiction, safety issue, or owner/external gate prevents promotion | No |
| `deprecated` | Supported only for recorded legacy callers until the removal gate | No new native dependency |

Promotion is deliberate and reviewer-recorded. A higher status is not inferred because an endpoint
returned `200`, a generated type compiled, or a PWA screen currently works.

If evidence expires or the contract changes materially, move the entry back to the appropriate
status or mark it `blocked`. Never leave `approved_native` while replacing its meaning in place.

## Stable identity and versioning

Each entry has:

- a stable lowercase `id`, such as `tech.appointment.load-detail`;
- a semantic `version`;
- a `compatibility.strategy` of `additive`, `versioned`, `legacy_frozen`, or `new`;
- the oldest supported PWA/Capacitor/native callers;
- deprecation/removal gates when applicable.

Changing documentation, evidence links, or fixtures without changing behavior need not change the
contract version. Change the version when request, response, authorization, side-effect,
idempotency, pagination, conflict, privacy, or failure semantics change.

Breaking changes require a new version/endpoint/function or an approved coordinated compatibility
plan. The App Store release lag makes server-first backwards compatibility mandatory.

## Entry construction sequence

For every first vertical slice:

1. Copy the relevant sections from `registry-template.yaml`.
2. Record the owner-approved user intent and native caller.
3. Trace every current PWA/Capacitor caller and source path.
4. Inspect exact table columns, RPC overload/signature, Worker route, Storage bucket/object policy,
   Realtime publication/channel, and provider boundary.
5. Inspect migrations, function security mode, grants, RLS, triggers, and trusted caller checks.
6. Record request/response/error/time/money/pagination semantics.
7. Define subject, employee, organization, role, assignment, ownership, and resource enforcement.
   The trusted boundary derives actor/membership and audit attribution from the validated session;
   client-supplied identity/scope identifiers remain untrusted resource parameters.
8. Define cache/draft/operation/idempotency/retry/ambiguity/conflict/account-switch behavior.
9. Classify fields/objects and define local/log/telemetry/retention behavior.
10. Capture deterministic fixtures without real customer data.
11. Add positive and negative tests in disposable local isolation.
12. Prove current PWA/Capacitor compatibility.
13. Verify hosted QA with synthetic identities and applicable simulator/device/provider evidence.
14. Recapture applicable read-only current external state.
15. Obtain named data, security/privacy, workflow, and release approvals.

Do not skip directly from `inventory_only` to `approved_native`.

## Evidence rules

Use the project evidence language:

- **Verified:** directly observed for the exact commit/build/environment with timestamped evidence.
- **Source-confirmed:** observed in reviewed repository source, not necessarily live.
- **Inferred:** reasoned but not directly proved.
- **Blocked:** could not be safely verified because a named dependency was absent.
- **Owner gate:** requires a product, legal, account, cost, device, signing, or release decision.
- **Not tested:** applicable work was omitted.

Evidence records include:

- base/source/deployed commit where knowable;
- command/test/catalog/device/provider and timestamp;
- safe environment fingerprint;
- expected and actual result;
- reviewer;
- expiration/recapture trigger;
- redaction statement.

Do not paste secrets or real records into the catalog. Link to governed redacted evidence instead.

## Required reviewers

The entry identifies real people/roles before promotion:

- workflow/product owner;
- backend/database owner;
- security/privacy reviewer;
- iOS owner;
- QA/accessibility owner;
- compliance/legal/finance/provider owner when the feature requires one;
- release owner for `approved_native`.

One agent may prepare evidence, but it cannot silently self-approve consequential product, privacy,
legal, financial, or release decisions.

## Contract kinds

Use one or more transport blocks:

- `postgrest` — direct table/view reads or narrowly justified writes;
- `rpc` — database functions with exact signature and grants;
- `worker` — Cloudflare Pages Function/Worker boundary;
- `storage` — bucket/object upload/read/delete;
- `realtime` — publication/channel/subscription;
- `auth` — session and employee-membership resolution;
- `local` — device-only draft/cache/operation behavior;
- `provider` — server-mediated external provider contract.

A workflow with upload, metadata RPC, and Realtime completion needs separate transport entries or a
compound entry that traces every boundary. Do not hide a distributed transaction behind one label.

## Authorization evidence minimum

Every data-bearing or side-effecting contract states:

- authenticated subject source;
- active employee resolution;
- role/capability;
- organization/company scope;
- assignment/ownership relationship;
- resource and parent/child identifier validation;
- database policy/function or Worker enforcement point;
- exact per-command grants/policies, roles, policy mode, `USING`/`WITH CHECK`, scope-column
  mutation, views, RPC overload ACL/security/search path, and internal caller/resource checks;
- separate normative/source evidence and current deployed observation;
- allowed and denied test identities;
- anonymous, inactive, wrong-role, wrong-assignment, mixed-ID, client-forged-actor/scope, and
  direct-boundary negative tests.

`authenticated`, hidden navigation, a cached role, or a generated client type is not sufficient.

## Mutation evidence minimum

Every mutation states:

- stable operation/idempotency key and where it is enforced;
- composite uniqueness scope and concurrent first-writer behavior;
- canonical payload/hash behavior;
- precondition/version;
- server receipt/lookup authorization, replay shape, retention, cleanup owner, and expiry behavior;
- duplicate request outcome;
- client timeout versus server timeout;
- retryable, permanent, conflict, and ambiguous errors;
- reconciliation;
- cancellation and supersession;
- corrected-payload behavior using a new operation ID linked to the immutable terminal original;
- provider effect and audit record where applicable;
- PWA/Capacitor compatibility.

If these are absent, the native operation is online-only and manual, or the contract is blocked.

## CI validation

The native foundation should add a catalog validator that fails on:

- invalid YAML or unknown lifecycle values;
- duplicate IDs or conflicting versions;
- missing required owners, source paths, or compatibility fields;
- `approved_native` without required evidence/review/gate completion;
- a mutation without idempotency/ambiguity declarations;
- a Storage contract without bucket privacy/object authorization/retention;
- a Realtime contract without reconnect/reconciliation;
- forbidden secret-like content;
- a new native direct-call string absent from the registry;
- an approved contract whose generated type/fixture/test fingerprint drifted.

The source scanner is a guardrail, not truth. Dynamic endpoint construction, aliases, wrappers, and
server-only callers require human review.

## Bootstrap inventory boundary

`bootstrap-inventory.yaml`, when present:

- is derived from explicit string literals in selected mobile/admin/conversation source paths;
- may omit dynamic calls, aliases, shared helpers, server-only routes, and provider dependencies;
- may include dead, legacy, or feature-flagged callers;
- records no signature, RLS/grant, business authorization, live deployment, safety, or product
  approval;
- uses `status: inventory_only` for every entry;
- is not permission to expose a table, call an RPC, subscribe, upload, or reproduce a legacy
  security boundary in Swift.

Its only job is to reduce accidental omissions during the first Mac orientation.
