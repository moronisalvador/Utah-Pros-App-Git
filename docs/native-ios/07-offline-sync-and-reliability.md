<!--
FILE: docs/native-ios/07-offline-sync-and-reliability.md

WHAT THIS DOES (plain language):
  Defines how the native client reads cached data, preserves offline user intent, submits mutations,
  handles ambiguous outcomes, uploads media, reconciles conflicts, and recovers across app,
  network, device, session, and server failures.

DEPENDS ON:
  Internal: src/lib/offlineDb.js, src/lib/syncRunner.js, src/lib/dispatchers/,
            docs/native-ios/05-data-contracts-and-environments.md,
            docs/native-ios/06-security-privacy-and-compliance.md
  External: iOS lifecycle/background APIs, Supabase/Worker contracts
  Data:     reads → approved caches, drafts, receipts, and authoritative server state
            writes → isolated QA until a workflow receives production approval

NOTES / GOTCHAS:
  - This is a target native design, not a claim that the current PWA queue has these guarantees.
  - iOS background execution is opportunistic; foreground reconciliation remains mandatory.
  - A timed-out mutation is ambiguous unless the server can prove whether it committed.
-->

# Native iOS Offline Sync and Reliability

## Reliability objective

The app must preserve the user's durable intent without creating duplicate, cross-account, stale,
or unauthorized effects. It must explain what is saved locally, what is confirmed by the server,
what needs attention, and what cannot proceed offline.

“Offline capable” is not a single feature. Each workflow independently defines:

- authoritative read and cache behavior;
- local draft behavior;
- whether a mutation may be queued;
- idempotency and server receipt;
- ordering/dependencies;
- conflict/reconciliation behavior;
- attachment transfer behavior;
- permission/session/account changes;
- foreground/background expectations;
- user-visible recovery and support evidence.

## Current source-confirmed queue: useful evidence, not the native design

At base commit `90b265ee6f733c8dbcd75786f4e4057dd3355d38`, the PWA source uses IndexedDB
database `upr-offline` version 1 with stores for queue, photos, rooms, readings, equipment,
cache metadata, and ID swaps. It dispatches:

- `room.create`;
- `photo.upload`;
- `reading.insert`;
- `equipment.place`;
- `equipment.remove`;
- `note.insert`;
- `task.toggle`.

The runner observes online/foreground events and a roughly 30-second interval, uses
`pending`/`syncing`/`done`/`error` states, caps attempts at five, and uses increasing delays near
1 second, 4 seconds, 15 seconds, 1 minute, and 5 minutes.

That code contains important risks to address before native construction:

| Source-confirmed behavior | Native risk | Required target control |
|---|---|---|
| Queue records are not visibly scoped by environment/account/employee/project | Previous user or wrong build could submit another context's work | Immutable environment, auth subject, employee, organization, and workflow scope on every record |
| `syncing` items are not visibly reclaimed by a durable lease after crash | Work can remain stranded forever | Expiring lease, startup recovery, owner process ID, heartbeat only when needed |
| Drain order is not a dependency graph | Child work may run before parent/local-ID resolution | Explicit dependency DAG and stable local-to-server ID mapping |
| `task.toggle` expresses an action, not desired state | Retry/replay can undo the intended result | Versioned desired-state command with precondition and idempotency |
| Notes do not visibly send a stable client operation/content ID | Ambiguous retry can duplicate | Stable operation UUID, payload hash, unique server receipt |
| Photo path uses current time and metadata RPC follows object upload | Retry can duplicate objects or leave orphans | Reserve/deterministic object identity, checksum, finalize transaction, orphan janitor |
| Equipment removal lacks visible client idempotency | Duplicate or ambiguous removal is hard to reconcile | Stable command ID and current-state/receipt lookup |
| Broad retry treatment lacks domain/HTTP taxonomy | Permanent denial may retry; ambiguous mutation may duplicate | Contract-specific retry/ambiguity classifier |
| Processing depends on browser foreground/best effort | No durable native background guarantee | Background transfer where supported plus mandatory foreground reconciliation |

The Swift app must not translate this queue class-for-class. Preserve deployed PWA behavior while
adding backwards-compatible native-safe contracts.

## Reliability principles

1. **Server truth and user intent are distinct.** A local draft is not a server record; a submitted
   operation is not confirmed until a receipt or authoritative read proves it.
2. **The queue stores commands, not arbitrary closures.** Commands are versioned, serializable,
   inspectable, deterministic, and migratable.
3. **Mutations are idempotent at the trusted boundary.** A client-only UUID does nothing unless the
   Worker/RPC records and enforces it.
4. **Timeout does not mean failure.** Loss of the response after commit creates an ambiguous state
   that must reconcile before retry.
5. **Offline permission is provisional.** Authorization is rechecked server-side at submission;
   revoked access cannot be overridden by a cached role.
6. **Ordering is explicit.** Dependencies and preconditions replace accidental insertion order.
7. **Background work is an optimization.** iOS may suspend or terminate the app; launch/foreground
   reconciliation is always correct.
8. **Account isolation is absolute.** No queue, media, cache, receipt, or draft crosses account or
   environment.
9. **Recovery is visible.** Users can distinguish saved locally, sending, confirmed, waiting,
   conflicted, failed, and cancelled states.
10. **Reliability is measured.** Queue age, ambiguity, duplicates prevented, conflicts, retries,
    orphan media, and recovery latency are observable without sensitive content.

## Native persistence architecture

Use a single actor-isolated persistence/reconciliation subsystem owned by the application
composition root. The specific framework—SwiftData, Core Data, SQLite wrapper, or another reviewed
store—is an owner/architecture decision after prototypes prove migration, query, concurrency,
encryption/protection, and testability.

Required logical stores:

- account/environment metadata;
- cached server entities with server version and fetched/expiry timestamps;
- local drafts;
- durable operations/commands;
- operation dependencies;
- local-to-server ID mappings;
- server receipts and reconciliation results;
- protected attachment metadata and transfer state;
- sync checkpoints and tombstones;
- redacted diagnostic events.

Every row includes:

- environment ID;
- immutable auth subject ID;
- employee/organization scope where applicable;
- schema and payload version;
- creation/update time from an injectable clock;
- local identifier;
- server identifier/version when known;
- data classification and retention class where needed.

Schema migration is part of every release test. An unreadable store must fail safely, preserve
recoverable user drafts when possible, and never silently reinterpret an old command.

## Operation state machine

Use explicit states:

| State | Meaning | Allowed next states |
|---|---|---|
| `draft` | Local user work not submitted | `pending`, `cancelled` |
| `pending` | Durable command eligible when preconditions/dependencies permit | `in_flight`, `cancelled`, `permanent_failure` |
| `in_flight` | Attempt owns an expiring lease | `confirmed`, `ambiguous`, `retryable_failure`, `permanent_failure` |
| `confirmed` | Server receipt and/or authoritative state proves the result | terminal |
| `ambiguous` | Request may have committed but confirmation was lost | `confirmed`, `retryable_failure`, `permanent_failure`, `needs_review` |
| `retryable_failure` | Classified transient failure, bounded schedule remains | `pending`, `permanent_failure`, `cancelled` |
| `permanent_failure` | Validation, authorization, incompatibility, or retry exhaustion; the original payload remains immutable | `cancelled`, `superseded` when a corrected command with a new ID is created |
| `needs_review` | Automated reconciliation cannot choose safely | `confirmed`, `cancelled`, `superseded` after human resolution |
| `cancelled` | User/system cancelled before a committed effect was proved | terminal unless a late receipt moves to `confirmed` |
| `superseded` | A newer desired-state command replaces this intent | terminal |

State transitions are transactional with attempt/lease updates. A process crash in `in_flight`
must become reconcilable after the lease expires; it does not immediately mean “retry.”

The UI must never label `pending`, `in_flight`, or `ambiguous` as uploaded/saved/sent/completed.

## Operation envelope

Every durable command contains:

```yaml
operation_id: stable_uuid_generated_once
supersedes_operation_id: optional_prior_terminal_operation
contract_id: registry_contract_id
contract_version: integer_or_semver
environment_id: local_or_qa_or_production_fingerprint
auth_subject_id: untrusted_local_context_hint_for_namespacing
employee_id: untrusted_local_context_hint_for_namespacing
organization_id: untrusted_local_context_hint_when_applicable
resource_scope: job_claim_appointment_conversation_or_other_ids
created_at_client: informational_timestamp
payload: versioned_minimal_intent
payload_hash: canonical_hash
precondition: optional_server_version_or_expected_state
dependencies: stable_operation_ids
attempt_count: bounded_integer
lease: owner_and_expiry
next_attempt_at: optional
state: operation_state
last_safe_error: redacted_code
server_receipt: optional_immutable_reference
```

The trusted boundary derives the authenticated subject and canonical employee membership from the
validated session. Client-supplied actor, employee, organization, assignment, owner, and resource
IDs are untrusted context/resource parameters; they must match server-derived identity and
relationships and can never authorize the operation or establish audit attribution.

The trusted boundary records `operation_id`, server-derived actor/membership, operation kind,
canonical payload hash, result/receipt, and reviewed retention. Same-ID resubmission is permitted
only when the canonical payload hash is unchanged. Reusing an ID with a changed payload is a
conflict. Correcting a failed payload creates a new operation ID with
`supersedes_operation_id` pointing to the terminal original; the original payload and receipt
history remain immutable.

## Which operations may work offline

Classify each workflow before implementation:

| Strategy | Examples | Rule |
|---|---|---|
| Cache-only read | Prior job overview, room list | Display freshness and scope; never imply current authorization/status |
| Local draft | Notes, form entry, report draft | Save protected draft; submit only after validation/auth recheck |
| Idempotent create | Room, reading, note after contract upgrade | Stable client/operation ID and server unique receipt required |
| Desired-state update | Task should be complete, equipment should be removed | Send target state plus version/precondition; do not queue toggles |
| Ordered multi-step workflow | Parent record then child readings/photos | Dependency graph and local/server ID mapping |
| Media transfer | Photo/document upload | Durable file, deterministic/reserved identity, checksum, finalize |
| Online-only consequential action | Message send, signature completion, money/provider action | Do not queue unless separately designed with server idempotency and owner approval |
| Never cache/queue | Privileged secrets or unnecessary restricted fields | Require online authorized boundary |

The UI must explain when an operation is online-only before the final action, preserve a safe draft
when possible, and avoid a destructive surprise after the user completes a long form.

## Replace action verbs with desired state

Commands such as “toggle,” “increment,” or “remove whatever is currently selected” are unsafe
across retries and stale caches. For native callers, add backwards-compatible versioned contracts:

```text
set task completion to true
  with operation ID
  expected task version
  actor/session authorization
  returned authoritative task and receipt
```

Do not change the deployed `toggle_appointment_task` signature in place while PWA/Capacitor uses
it. Introduce the safer contract alongside it, migrate callers with adoption evidence, then retire
the legacy action through a separate compatibility plan.

Apply the same analysis to equipment state, appointment status, clock events, consent, financial
status, document/signing lifecycle, and all provider side effects.

## Dependencies and local identifiers

Offline child work may reference a parent not yet created on the server. Use:

- stable local IDs generated once;
- a dependency edge from child operation to the parent operation;
- an atomic local-to-server ID map written with the parent receipt;
- payload resolution at send time, without mutating the original semantic intent;
- cycle detection and orphaned-dependency diagnostics;
- cancellation rules that explain what happens to dependent drafts/operations;
- reconciliation when a parent already exists because an earlier response was lost.

Queue order is a topological decision with user/business priorities, not a table scan. Independent
operations may run with bounded concurrency; dependent operations cannot.

## Attempt, timeout, retry, and ambiguity taxonomy

### Classification

| Result | Mutation behavior |
|---|---|
| Local validation failure | Do not send; keep editable draft |
| `401` before business boundary | Refresh once through centralized Auth when pre-SQL/pre-effect is proved |
| `403` | Permanent denial; do not retry; refresh authoritative capability and explain |
| `404` | Reconcile parent/resource; usually permanent or superseded |
| `409` | Fetch receipt/current version and enter conflict/reconciliation path |
| `422` | Permanent until user/data correction |
| `429` | Retry only if contract is idempotent, bounded, and honors `Retry-After` |
| Selected `5xx` before effect | Bounded retry when server proves no effect |
| Network loss/client timeout after send | `ambiguous`; query receipt/current state before retry |
| App termination during attempt | Expire lease, then reconcile; never assume failure |
| Unknown/decoder mismatch | Stop automatic retry; preserve evidence and require contract review |

### Schedule

Use contract-specific capped exponential backoff with full jitter, a maximum attempt/age budget,
network/power awareness, and server guidance. Persist `next_attempt_at`; do not wake continuously.

Retry budgets are separate from reconciliation attempts. A user tapping “try again” cannot create
a new operation ID for the same intent unless the prior result is conclusively cancelled/failed or
the UI explains the new effect.

### Cancellation

Cancellation stops local attempts; it cannot reverse a server/provider effect already committed.
After cancelling an ambiguous operation, continue receipt reconciliation where required and tell
the user if a late confirmation arrives.

## Server receipt and reconciliation contract

Every queued mutation must expose one of:

- an idempotency lookup by operation ID;
- an authoritative resource read containing the operation ID/client ID/version;
- a Worker-run/provider record linking the operation ID to the effect.

Its contract must also define:

- the composite uniqueness scope, including operation ID plus the server-derived account/tenant
  boundary and contract/version where required;
- transactional concurrent-claim behavior so only one first writer performs the effect;
- deterministic same-hash receipt/response replay and a stable mismatch result for a changed hash;
- receipt lookup authorization derived from the current validated session and current resource
  access, never merely possession of an operation ID;
- the receipt/result shape, including whether it replays the original response or points to an
  authoritative resource read;
- retention longer than the maximum offline, retry, ambiguity, support, and rollback window;
- cleanup ownership/monitoring and the safe result when an operation arrives after receipt expiry.

Reconciliation compares:

- operation ID and payload hash;
- authenticated actor/resource scope;
- server receipt/result;
- authoritative current record/version;
- local intended state;
- dependent operations and attachments.

Outcomes are `confirmed`, `not_observed_safe_to_retry`, `conflict`, `unauthorized`, or
`needs_review`. “No response” is not an outcome.

## Read cache and freshness

Each screen's contract registry declares:

- cacheable fields and excluded sensitive fields;
- account/environment namespace;
- fetched-at, server version/ETag/checkpoint, and stale/expiry policy;
- behavior for fresh, stale-while-revalidate, offline-stale, empty, deleted, and authorization-
  revoked states;
- maximum retained records/bytes and eviction priority;
- whether a stale record may support a mutation;
- initial snapshot and Realtime invalidation behavior;
- purge on sign-out/account switch/environment change.

Display freshness when it affects field decisions. An offline cached assignment does not prove the
employee remains assigned; the server must reauthorize submission.

Do not treat Realtime as the durable cache journal. On reconnect, fetch authoritative changes from
a bounded checkpoint or refresh the affected query.

## Conflict strategy by data type

Do not apply a single last-write-wins rule.

| Data | Default conflict approach |
|---|---|
| Append-only field observation/readings | Stable operation ID; accept distinct valid observations; flag semantic duplicates |
| Free-text draft/note | Preserve both versions or offer reviewed merge; never silently discard local work |
| Task desired state | Compare server version/current state; supersede only with explicit newer intent |
| Appointment/status workflow | Server validates transition; conflict requires authoritative refresh and user choice |
| Equipment placement/removal | Entity state machine and operation receipt; no blind replay |
| Money, payroll, consent, signature | Server-owned append-only/audited transition; no generic offline merge |
| Photos/documents | Content checksum + metadata version; duplicate/orphan reconciliation |

Every conflict UI explains the local intent, current server state, consequence of each choice, and
whether another user changed it. Preserve an audit trail where the domain requires one.

## Media and document transfer

### Target upload protocol

Prefer a server-coordinated lifecycle:

1. create a stable local operation and protected file;
2. validate type, size, orientation/metadata decision, account/resource scope, and available space;
3. reserve an authorized object/upload record using operation ID, intended resource, MIME, size,
   and checksum;
4. receive a deterministic/reserved private object path or short upload capability;
5. transfer using a background-capable `URLSession` when appropriate;
6. validate bytes/checksum server-side;
7. finalize metadata exactly once and receive the authoritative object/document receipt;
8. reconcile if finalization response is lost;
9. remove local material only after the retention rule and confirmed receipt permit it;
10. clean abandoned reservations/orphans through a governed server process.

### Requirements

- private/object-scoped access; do not inherit the historically public `job-files` design;
- collision-safe, non-PII object names;
- stable checksum and operation identity;
- MIME and byte limits both client- and server-side;
- compression/original-retention decision by workflow;
- EXIF/GPS metadata policy;
- resumable/background behavior and cellular/power policy;
- signed read expiry and refresh;
- thumbnail/cache purge;
- deletion/legal-hold behavior;
- visible progress, pause/cancel, low-disk, permission, and partial-failure states;
- orphan and duplicate monitoring.

A Storage upload followed by a separate metadata RPC is a distributed transaction. The contract
must make every partial state recoverable.

## Background execution

iOS may suspend, terminate, throttle, defer, or decline background work. Design for:

- foreground flush on launch, resume, authenticated session restoration, and manual retry;
- background `URLSession` for eligible transfers, with stable task-to-operation mapping and
  relaunch callback handling;
- `BGProcessingTask`/`BGAppRefreshTask` only for appropriate opportunistic reconciliation, never as
  a deadline guarantee;
- task expiration handlers that release leases and persist a safe state;
- bounded work, cancellation, battery/network policy, and no busy polling;
- notification-triggered refresh as a hint, not a guaranteed silent execution path;
- protected-file availability when the device is locked;
- real-device tests across force quit, reboot, low power, offline, cellular, locked device, and OS
  scheduling delay.

Do not promise that a field upload will finish in the background by a specific time. Show the
actual durable/confirmed state when the user returns.

## Realtime and sync interaction

Realtime events can:

- invalidate a cache key;
- trigger a bounded authoritative fetch;
- accelerate receipt discovery;
- update visible status after version/order validation.

They cannot:

- confirm a mutation solely by matching a display value;
- bypass row/channel authorization;
- replace an initial snapshot or reconnect cursor;
- cause duplicate command execution;
- apply an older event over a newer server version.

Deduplicate by stable event/record/version where available. On gap, token refresh, reconnect, app
resume, or subscription error, reconcile from the authoritative contract.

## Session, authorization, and account changes

Before processing any operation:

- verify environment and current auth subject match the record;
- resolve active employee membership;
- allow the server to reauthorize exact resource/action;
- stop on account/environment mismatch;
- never rewrite old queue ownership to the new account.

On sign-out or deactivation:

- stop the runner and background scheduling;
- cancel/rebind transfers safely;
- preserve ambiguous operations only in protected quarantine for the authorized recovery path;
- purge or quarantine drafts/caches according to policy;
- remove credentials;
- show no previous-account content at the next launch.

If an employee loses permission while offline, submission is denied. The app keeps only the minimum
local evidence needed to explain/recover according to policy; it does not override the denial.

## Disk, memory, and corruption behavior

- Enforce per-workflow and total cache/attachment budgets.
- Reserve enough free space before large capture/transform operations.
- Evict regenerable cache before unconfirmed drafts or operations.
- Detect corruption with schema/version/checksum checks.
- Back up only material intentionally eligible for backup; exclude caches and pending sensitive
  files by default.
- Never delete an unconfirmed user draft merely to satisfy cache pressure without a clear policy
  and user-visible recovery.
- Test database migration failure, partial write, full disk, file disappearance, duplicate task
  callback, and damaged attachment.

## User experience states

Use consistent language and semantics:

- **Saved on this device** — durable local draft only.
- **Waiting to send** — pending prerequisites/network.
- **Sending** — an attempt is active.
- **Checking result** — outcome is ambiguous/reconciling.
- **Synced** — authoritative receipt/state confirms it.
- **Needs attention** — user correction or conflict is required.
- **Not authorized** — server denied the current user; retry is not offered as a fix.
- **Cancelled** — local attempts stopped; explain if server confirmation is still possible.

Provide a centralized sync/attention surface with per-item workflow/resource context, safe error,
age, next action, and support correlation ID. Do not expose raw payloads or customer data in broad
diagnostic lists.

## Observability and service levels

Record redacted metrics:

- operations created/confirmed/ambiguous/retryable/permanent/needs-review;
- queue age percentiles and oldest safe age;
- attempts and reconciliation latency by contract;
- duplicate submissions prevented;
- conflict and authorization-denial rates;
- attachment bytes, duration, resume, checksum failure, and orphan count;
- background attempt/expiration/foreground recovery;
- local-store migration/corruption/low-disk events;
- app/build/environment/contract version.

Set budgets per vertical slice, including:

- maximum time before a foreground-eligible pending operation attempts;
- maximum ambiguity duration before visible escalation;
- maximum retained draft/attachment age;
- maximum queue/storage size;
- duplicate durable/provider effect target of zero;
- tolerated battery/network cost.

Metrics do not include message bodies, document contents, exact coordinates, customer PII, tokens,
signed URLs, or raw payloads.

## Verification matrix

### Deterministic unit/model tests

- every state transition and invalid transition;
- lease acquisition/expiry and crash recovery;
- dependency topological ordering, cycle, cancellation, and ID mapping;
- canonical payload hash and operation-ID reuse conflict;
- retry classifier, jitter bounds, retry/age exhaustion, and `Retry-After`;
- desired-state supersession;
- conflict resolution;
- account/environment isolation;
- data-store migration and unknown command version;
- clock skew and timestamp/date behavior.

### Isolated integration/contract tests

- server idempotency and receipt lookup;
- response lost after commit;
- request lost before commit;
- delayed/duplicated/out-of-order responses and Realtime events;
- `401`/`403`/`404`/`409`/`422`/`429`/`5xx`/timeout classification;
- role/assignment revoked between queue and send;
- parent/child creation and local/server ID resolution;
- Storage reserve/upload/finalize failures at each boundary;
- checksum mismatch, duplicate upload, expired access, and orphan cleanup;
- PWA/Capacitor compatibility for any shared contract.

### Simulator and real-device tests

- launch/resume/background/termination during each operation state;
- offline at launch, network flapping, Wi-Fi/cellular switch, captive/no-internet condition;
- reboot, locked device, Low Power Mode, constrained network, and background task expiration;
- low storage, memory pressure, protected-file unavailability, uninstall/reinstall, device restore;
- sign-out/account switch/password reset/deactivation mid-operation;
- permission revoked during photo/location/document workflow;
- old app/store migration and application upgrade;
- duplicate user taps and repeated notifications/deep links.

Use only isolated synthetic environments. Every runtime attempt has a five-minute limit, guaranteed
cleanup, child-process termination, and a recorded blocked result when the OS/device/environment
cannot safely provide proof.

## Recovery runbooks

Before beta, document and rehearse:

- queue stuck or lease not reclaimed;
- broad authorization failures after role/policy change;
- contract decoding failure after backend change;
- duplicate or ambiguous provider effect;
- lost/corrupted local store;
- runaway retry/battery/network consumption;
- private media unavailable or orphan count rising;
- user/account association error;
- bad release creating incompatible queued commands.

Runbooks include feature containment, minimum version if necessary, server compatibility window,
diagnostic export, safe user guidance, receipt reconciliation, and criteria for cancelling versus
preserving work.

## Offline/reliability readiness gate

A workflow may claim offline mutation support only when:

- its registry entry defines cache, draft, operation, dependencies, conflict, retry, ambiguity,
  attachment, account-switch, and purge behavior;
- every command is versioned, account/environment scoped, and durably persisted;
- the server enforces stable idempotency and exposes a receipt/reconciliation path;
- action verbs such as toggles have a native-safe desired-state contract;
- crash-expired leases recover without blind replay;
- dependencies and local/server IDs are deterministic;
- transient, permanent, authorization, conflict, and ambiguous outcomes are distinguished;
- media partial states and orphans are recoverable;
- background execution is treated as opportunistic and foreground reconciliation works;
- UI states accurately distinguish local from server-confirmed work;
- redacted telemetry and runbooks exist;
- deterministic, isolated integration, simulator, and real-device failure matrices pass;
- existing PWA/Capacitor callers remain compatible;
- security/privacy and data-contract reviewers approve the workflow.

If a workflow cannot meet these gates, ship it as cache-only, draft-only, or online-only and label
that behavior honestly. One blocked optional runtime check must not block unrelated audit/planning
work, but it remains a named release gate for the affected guarantee.
