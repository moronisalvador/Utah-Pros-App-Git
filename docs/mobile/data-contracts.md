<!--
FILE: docs/mobile/data-contracts.md

WHAT THIS DOES (plain language):
  Maps important mobile workflows to their Supabase tables/RPCs/Storage/Workers and records the
  authorization, result, error, pagination and mutation guarantees callers may rely on.

DEPENDS ON:
  Internal: src/pages/tech/, src/components/tech/, src/components/admin-mobile/,
            src/lib/supabase.js, src/lib/offlineDb.js, functions/api/,
            supabase/migrations/, docs/database-schema.md, docs/auth-and-authorization.md
  Data:     reads → mobile business contracts
            writes → documentation only

NOTES / GOTCHAS:
  - Current live behavior requires read-only catalog/policy/function verification.
  - Direct access and RPCs are judged by authorization/atomicity/performance, not syntax.
-->

# Mobile Data Contracts

## Contract authority

For a mobile data decision, inspect in this order:

1. current live function signature/body/security/search path/ACL, table RLS/policies/grants,
   Storage configuration/policies, and migration ledger, read-only;
2. reviewed migrations and current worker implementation;
3. every mobile/desktop caller and tests;
4. this document, `docs/database-schema.md`, `docs/auth-and-authorization.md`, and
   `UPR-Web-Context.md`;
5. generated snapshots and dated audits.

The same Supabase project serves `dev` and production. Never invoke a mutation, apply a migration, or
change a live policy/function during orientation or testing without a separately authorized
production workflow.

## Access modes

| Mode | Use when | Required authorization/guarantee |
|---|---|---|
| `db.select/insert/update/delete` | One-row/simple REST behavior whose entire rule is enforceable by RLS/constraints | active identity plus tenant/role/assignment/object RLS; least columns; bounded list |
| `db.rpc` | aggregation, stable read shape, transaction, business rule, controlled mutation | explicit browser ACL; caller reconstruction inside necessary definer functions; stable signature/shape |
| Storage REST | media object transfer | private/path-scoped policy or trusted signed delivery; content/type/size/owner; metadata reconciliation |
| `/api/*` worker | provider secret, service role, webhook, company side effect, privileged orchestration | verify session/signature, resolve active employee, enforce role/object authority, timeout, idempotency, safe response/audit |
| Realtime | incremental updates after an authorized initial read | subscription filter and RLS equivalent; cleanup/reconnect/dedup; no broader payload than screen authorization |

A valid Supabase user token proves authentication only. React routes, role checks, and feature flags
do not authorize a direct REST/RPC/worker request.

## Current mobile data surface

The historical July 2026 static census found 68 inline RPC identifiers and 17 directly accessed
tables/views at the audited source SHA, plus Storage, workers, and Realtime. The complete historical
point-in-time name list is in
[`../audit/mobile-pwa/08-supabase-and-rpc-contracts.md`](../audit/mobile-pwa/08-supabase-and-rpc-contracts.md).

R0's corrected transitive graph at its captured source contains 84 client-reachable RPCs: 82 from
the then-current authenticated `/tech` graph plus the two anon-key public-signing RPCs mounted by
`NativeRoutes`. It also contains 22 direct PostgREST tables. Realtime subscribes to
`conversations`, `messages`, and `notifications`; the first two overlap the direct set. Exact
direct tables at that source boundary:

`appointment_crew`, `appointments`, `claims`, `contact_jobs`, `contacts`,
`conversation_participants`, `conversations`, `employees`, `estimate_line_items`, `estimates`,
`invoice_line_items`, `invoices`, `job_documents`, `job_time_entries`, `jobs`,
`message_templates`, `messages`, `nav_permissions`, `payments`, `scheduled_messages`,
`sign_requests`, and `sms_consent_log`.

The current native build is field-only and build-excludes office, CRM, billing/QBO, desktop
settings, and admin-mobile modules, so the R0 count/list is no longer a current native-bundle census.
Do not edit the dated R0 evidence to imply otherwise. Regenerate the transitive inventory from the
final reconciled source before qualification.

## R0 boundary recapture (point-in-time baseline)

Wave R0 re-extracted the current route tree and its transitive shared/raw helpers, then verified all
84 client-reachable mobile RPC identifiers against the live catalog read-only on 2026-07-26 UTC.
All 84 resolved to exact one-overload `SECURITY DEFINER` functions executable by `authenticated`
and `service_role`. Four allow `anon`: `get_feature_flags`, `get_employee_page_access`,
`get_sign_document_templates`, and `get_sign_request_by_token`. The first two and
`get_sign_request_by_token` also allow `PUBLIC`. A simple definition-needle scan found common
caller/auth signals in only five; that is a prioritization heuristic, not proof about authorization
in either direction.

The transitive correction matters: shared auth bootstrap, bell, Web Push, native push, clock
precheck, notification preferences, job/claim merge, and public signing add 16 RPCs that the
historical inline route scan missed. Several trust a supplied employee, notification, claim, or job
ID inside a definer function. The public signing pair trusts token equality without status/expiry
in the database predicate. Each function still requires role/assignment/object review and direct
negative tests.

The same capture confirmed broad direct-table policies and a public `job-files` bucket with
anonymous/public reads and authenticated bucket-wide insert/delete. The exact route-to-caller map,
function list, table policy/grant summary, complete media caller inventory, capture timestamps and
separate apply plan are in
[`../audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md`](../audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md).
Neither `MOB-SEC-014` nor `MOB-SEC-015` is closed.

The first local containment slice gates `/api/qbo-invoice`, `/api/qbo-estimate`,
`/api/qbo-payment`, and `/api/qbo-query` before privileged work. It preserves the existing server
capability and permits a browser Bearer only for an active, non-external `admin`.

The S1b source slice extends that browser rule to `/api/qbo-sync-customer` and the HTTP GET/POST
forms of `/api/qbo-payments-sync`, while preserving their exact secret-first server capability and
the poller's direct `scheduled()` entry. `/api/quickbooks-connect` is active-internal-admin Bearer
only and does not accept the server capability, so it cannot be used to replace OAuth state.
`/api/qbo-charge` and `/api/qbo-attach` keep their existing Bearer-only billing contract and now
reject external employees before privileged work. Approved-caller downstream success/error bodies
are unchanged; the added 403 denials are intentional. Customer-sync and manual payment-sync do not
yet durably attach the resolved human actor to worker telemetry.

The S1c source slice locally contains the two remaining Worker identity surfaces without claiming
their adjacent database paths are safe. `/api/callrail-recording` now requires an active internal
admin or the company-wide `crm_call_log` employee/role capability, then binds an exact UUID call
row to the provider call ID in its stored allowlisted URL before credential/provider access.
`/api/notify` preserves exact-secret and in-process service origins; its legacy human Bearer path is
active-internal-admin only and accepts four server-derived appointment/estimate event shapes.
Caller-selected recipients, copy, HTML, payload/data, entity/job fields and links are rejected.

Two bypasses existed outside that HTTP source slice, and both database paths are now contained.
The notification RPC path:
live `20260727233704_notify_emit_service_boundary` removed authenticated execution, retained only
`service_role`, and made the trusted top-level event type authoritative; live
`20260731165215_pg_net_worker_url_allowlists` then added the two-origin URL allowlist and
blank-secret no-op. Live S1e moved raw recording URLs into a forced-RLS service-only source table,
removed authenticated lead DML, and leaves browser/RPC callers only an opaque availability marker.
The remaining CRM residual is company-wide active-internal lead metadata/read scope, not direct raw
recording-source access. The existing QBO human-actor telemetry gap and external-admin
`qbo_attachments` metadata SELECT policy remain separate QBO residuals.

S1g is live in production under ledger row `20260728192024` for the shared PWA/Capacitor bell. It
keeps the four deployed list/count/mark signatures and result shapes while resolving the
authenticated employee from `auth.uid()`, denying inactive/external/unmapped and foreign-recipient
calls, and making direct `notifications` SELECT/Realtime visibility active-internal
own-or-broadcast. A private forced-RLS receipt table gives broadcasts per-employee read state;
targeted rows keep their base `read_at`, and existing globally-read broadcasts stay read for
everyone. Null/default list and count parameters remain broadcast-only. The client-side Realtime
filter remains a fallback, not authorization. Signed service-role calls retain the exact deployed
base-row list/count and mark behavior. The former `USING (true)`/shared broadcast state is not the
browser read contract; retained Realtime socket, resume/reconnect, token-refresh, and
account-switch qualification remain operational evidence requirements rather than an unapplied
schema claim.

## Workflow contract map

### Session, profile, permissions, and flags

| Contract | Current caller expectation |
|---|---|
| Supabase Auth session | persisted/refreshable user session |
| `get_my_employee_profile()` | live selector-free, least-column active employee corresponding to `auth.uid()` |
| navigation permissions and employee overrides | arrays/maps used for UI visibility |
| feature-flag RPC | rows keyed by feature/page/tool key |

Authorization requirement: missing/disabled/inactive employee must fail access regardless of a valid
Auth user. Permissions/flags do not grant direct worker/database privilege. A flag load error must
not expose gated behavior or publish an employee before device-state reconciliation completes.

Account cleanup uses owner-bound durable Web/APNs pending-detach journals. A direct A→B switch must
finish with A's retained authenticated client before B profile/device publication; a B session
cannot consume or relabel A's journal and is locally signed out until A reauthenticates. Journal
success requires the owner-scoped void delete RPC and verified local delivery/storage cleanup.

Source bootstrap now fails closed on malformed identity/authorization responses: exactly one
employee profile must use a canonical UUID, supported role, and boolean active/external values;
navigation and personal-page rows require unique valid keys plus boolean permission fields; feature
flags require unique valid keys, boolean `enabled`/`force_disabled`, and null or canonical-UUID
`dev_only_user_id`. Rejected bootstrap waits for device cleanup plus strictly verified local
Supabase sign-out before Login; malformed/failed sign-out remains hard-locked with the token-bound
client. Password recovery preserves its Auth session while cleanup gates SetPassword and is
retryable after failure/reload. The Supabase Auth observer returns synchronously and a serialized
next-macrotask queue preserves callback order outside the SDK lock; deadlock/order race tests are
pinned. Independent review found no remaining P0/P1. Browser/device proof remains.

Error semantics: distinguish unauthenticated, authenticated-without-employee, disabled employee,
forbidden, flag unavailable, and ordinary empty configuration.

### Dashboard, schedule, tasks, and time

| Workflow | Primary contracts | Expected UI shape/behavior |
|---|---|---|
| Dashboard | `get_tech_dashboard`, `get_active_appointment_geo`, `get_stalled_materials_for_employee` | one dashboard aggregate plus optional active appointment/attention items |
| Schedule | `get_appointments_range` | ordered appointments inside explicit inclusive date range |
| Assigned tasks | `get_assigned_tasks` | task rows for the authorized viewer/employee |
| Appointment detail/tasks | `get_appointment_detail`, `get_appointment_tasks` | one detail or not-found; ordered task list |
| Clock | `clock_appointment_action`, `clock_finish_entry`, time-entry reads | authoritative resulting clock/appointment state, not only “ok” |

Required authorization: employee may read only their/company-authorized scope; server validates any
passed employee/appointment/task ID and role/assignment. A field user cannot gain scope by changing
the parameter.

Required mutation guarantee: clock/task commands accept stable operation identity or desired state,
return the authoritative result, and classify conflict/already-applied versus retryable failure.

Pagination/growth: schedule is date-range bounded; task/dashboard results still require documented
maximums/order. Do not load all history and filter client-side.

### Claims, jobs, contacts, rooms, readings, and equipment

| Workflow | Primary contracts |
|---|---|
| Claim list/detail | `get_tech_claims`, `get_claims_list`, `get_claim_detail`, claim appointments/rooms/demo sheets |
| Job detail/hub | direct jobs/claims/documents plus `get_job_hub`, `get_job_contacts`, task summary |
| Customer/job creation | direct contacts, `search_contacts_for_job`, `get_customer_detail`, `create_job_with_contact`, carrier RPCs |
| Rooms | `get_job_rooms`, `get_claim_rooms`, `create_room`, `create_room_for_claim` |
| Readings/equipment | `get_job_readings`, `insert_reading`, `get_job_equipment`, `place_equipment`, `remove_equipment` |

Expected read semantics:

- singular IDs return one object or an explicit not-found result, never an indistinguishable empty
  array/network failure;
- lists define columns, stable order, limit/cursor, and viewer scope;
- aggregate hub/detail shapes remain backward compatible across deployed web/native/OTA clients.

Required authorization: server/database enforces company, role, assignment, object, and allowed
columns. A React-only admin menu is not a trusted boundary.

Required write semantics: compound customer/job/room/equipment intents are transactional or
idempotent/compensating. Client-generated operation IDs must be validated and uniquely applied.

### Appointment and event create/edit

Current callers combine direct appointments/appointment_crew writes with task/update/delete RPCs.
The durable contract should represent one user intent:

```text
operation_id
actor identity (derived server-side)
expected record version
appointment/event fields
complete desired crew set
complete desired task assignment set
→ authoritative record + crew/tasks + applied/already-applied status
```

The server owns transaction, role/private-event rules, conflict detection, audit fields, and
idempotency. Browser retry must not delete crew twice or duplicate tasks. Until that contract exists,
callers must surface partial/ambiguous results and reconcile before retrying.

### Media and documents

Current flow:

```text
compress/capture → upload to job-files → insert_job_document → optional note/room update
```

Required contract:

- private/confidential-by-design object delivery;
- immutable account/employee/job/claim/appointment owner and allowed path;
- MIME/size validation and safe filename handling;
- one stable client operation/object path;
- idempotent metadata upsert;
- bounded upload/metadata timeouts and classified retry;
- orphan/metadata reconciliation and compensating cleanup;
- thumbnails for lists/grids and full resolution only for deliberate view/download;
- no public-URL assumption in presentation components.

Objects: `storage.objects`, `job-files`, `job_documents`; document/signing workers and sign_requests
when applicable.

### Messaging and consent

Primary contracts:

- `get_tech_conversations` plus bounded thread message query/Realtime;
- direct conversation unread/contact DND and `sms_consent_log` writes;
- templates and attachments;
- governed `/api/send-message` worker.

Required send semantics:

- server verifies active employee and conversation/contact authority;
- consent, DND, STOP/START/HELP, approved sender, quiet hours/retry, attachment access, and audit
  rules are enforced in the company-send path;
- a stable send/idempotency key distinguishes accepted, delivered/provider-pending, failed, and
  duplicate;
- optimistic UI reconciles with the canonical provider/message row;
- external `sms:` composer is not a substitute for this contract.

Thread pagination uses stable chronological cursors/limits. Realtime inserts deduplicate against
optimistic/canonical messages and unsubscribe on scope change.

### Demo/scope sheet and OOP pricing

Scope sheet:

`get_active_demo_schema`, `get_demo_schema`, `get_demo_sheet`, drafts/list, `save_demo_sheet`,
active technicians, plus PDF/email/Encircle provider workers.

Required guarantees:

- schema/version compatibility and one authoritative saved revision;
- account-owned local draft with conflict/expiry semantics;
- idempotent save/submission;
- PDF/email/provider results separated from sheet durability;
- provider retry never duplicates customer communication.

OOP pricing:

The deployed compatibility surface is `get_oop_quote`, `get_claim_jobs`, `upsert_oop_quote`,
`delete_oop_quote` plus direct job prefill. The live builder migration
(`20260731175328_oop_pricing_builder`) adds
`get_oop_pricing_config`, `get_oop_quote_v2` and `upsert_oop_quote_v2`; its web-only admin surface
uses `get_oop_pricing_admin_state`, `save_oop_pricing_draft` and
`publish_oop_pricing_draft`.

The release boundary is fail-closed and does not treat the client route as authorization:

- every calculator RPC resolves an active internal employee with one of exactly `admin`, `office`,
  `supervisor`, `estimator` (sales rep), or `project_manager`, then enforces server-side
  `tool:oop_pricing` eligibility;
- each eligible role may access all OOP quotes company-wide; no job-assignment or quote-creator
  scope applies. `field_tech`, `crm_partner`/external, inactive, unsupported, and unauthenticated
  actors are denied;
- a supplied job must exist;
- configured saves use a stable request UUID, optimistic version check and server calculation, then
  return the authoritative quote plus its private versioned pricing snapshot; and
- delete/upsert converge idempotently and preserve the legacy signatures during the code-first
  compatibility window.

The Capacitor bundle includes only the tech calculator wrapper, which remains available solely to
the same eligible roles (never regular field technicians); the Settings builder is web-only,
admin-only, and rejected by the native bundle boundary checks.

### Admin-mobile money and leads

Contracts include financial dashboard/collections RPCs, invoices/estimates/payments/line items,
conversion, QBO provider workers, inbound lead/status RPCs, and CallRail recording proxy.

Required boundary:

- active employee plus explicit admin/financial/lead-center permission;
- caller-selected object belongs to authorized company/scope;
- cents/rounding, locking, expected version, transaction, and audit rules;
- stable idempotency for payment/conversion/QBO/provider actions;
- provider email/delete targets and recipients validated server-side;
- recordings streamed only to authorized lead-center roles and never cached publicly;
- read/report queries bounded and cannot become arbitrary provider/database tunnels.

Any worker that uses service credentials must resolve and authorize the employee before reading or
acting. A successful `/auth/v1/user` response alone is insufficient.

S1c implements the Worker portion for recording playback: internal admins retain the independently
admin-gated mobile caller; non-admin desktop staff require `crm_call_log`; the UUID must resolve to
a call whose stored `callrail_id` matches the ID in its stored CallRail URL. Success remains a
private 200 audio stream and provider/signed-audio fetches remain timed. External `crm_partner`
users are intentionally denied even though the current desktop shell still exposes Call Log; hiding
or disabling that recording control is a separate UI compatibility follow-up. Direct
`inbound_leads`/`get_inbound_leads` authorization remains an open database slice.

### Notifications and push

Notification emitters supply a trusted event, not arbitrary end-user content/audience. Required
contract:

- allowed event types and actor permission;
- server-derived audience or strictly authorized explicit recipients;
- allowlisted title/body/data/link fields and same-origin route;
- recipient preferences and active employee/device;
- web/APNs environment-specific delivery with timeout/retry/expiry;
- per-channel accepted/skipped/failed summary;
- detach/revoke on logout/account/device lifecycle;
- no lock-screen value outside the owner-approved typed event variable catalog.

The native APNs implementation uses an exhaustive typed presentation catalog:
each live event receives explicit event-approved title/body copy, while
unknown events retain the generic `Utah Pros notification` /
`Open Utah Pros for details.` fallback. Raw producer copy is never the APNs
presentation contract. Data remains reduced to one allowlisted route plus an
opaque deterministic recipient binding. The same pure route policy used by the
app runs in the worker before serialization;
admin/external paths, encoded paths, oversized input, credential fragments, and
unsupported or sensitive query shapes fall back to `/` before Apple sees them.
The Push policy additionally rejects the public signing bearer paths
`/sign/:token` and `/s/:code`; those remain valid Universal/App Links, but the
bearer capability is never provider payload data. A native action is rejected
unless the binding matches the currently verified employee. Owner decision
2026-07-29 supersedes the initial generic-only budget: native may render the
same event-approved variables as PWA, including customer, scheduling, and
financial details. Those values must be typed server context, never raw
producer APNs fields or generic payload traversal. Missing values use immutable
generic event copy. Rendered values and final APNs JSON are bounded before
provider use. Rich presentation is explicitly opt-in at the provider boundary:
only `NATIVE_RICH_NOTIFICATION_PRESENTATION=true` enables approved details;
unset, `false`, or any other value keeps generic presentation.

Native token registration is browser-RPC-only: the focused
`20260728223000_native_apns_token_boundary.sql` source is live under reconciled
ledger row `20260729021021`, and direct browser table privileges are revoked.
`20260730170000_device_token_apns_topic.sql` is live under ledger row
`20260731154315_device_token_apns_topic` and adds a nullable per-install
bundle topic, keeps the deployed two-argument registration call resolving via
a trailing default, removes the remaining inert authenticated SELECT policy
from the raw-token table, and returns only redacted registration metadata.

Appointment notification audiences are structural rather than caller-selected:
`appointment.assigned` intersects the named employee with the appointment's
current crew, while updated/canceled events resolve the current crew. Supplied
`recipient_ids` cannot widen any appointment audience.

S1c implements only the HTTP identity/object portion. An exact stored secret remains first and
keeps the full deployed trigger payload; trusted Workers continue to call `dispatchEvent`
in-process. A human Bearer must be an active internal admin and may supply only the IDs for
appointment assigned/updated/canceled or estimate accepted after exact state/membership lookup.
The existing response summary, preference resolution, sequential fan-out and per-channel
best-effort behavior are preserved. Client-side service-worker lookup, Web Push enrollment/detach,
and VAPID fetches now use bounded, fail-closed paths; provider fan-out timeout/retry completion is a
separate residual rather than a closed contract.

S1d freezes the database-origin contract without sending an event: six owner-run definer functions
contain the seven appointment/estimate/timesheet/abandoned-clock calls, all pass object bodies, and
the abandoned-clock scanner remains a `postgres` cron caller. The live S1d migration changed only
the target ACL and object merge order; the later live URL-allowlist hardening retained the frozen
secret/header names, `net.http_post`, ignored response, payload fields, triggers and schedule.
Direct execution remains `service_role` only; the owner-executed database chain must not receive an
in-body session-role check. Direct `create_notification` has a separate S1f attribute-only apply candidate that retains
only `service_role`; until applied, the live authenticated bell-emission residual remains.

S1g is live under production ledger row `20260728192024` without changing client source: active
internal callers may request broadcast-only with null/default parameters or broadcast-plus-own with
their own employee ID; a foreign employee/notification selector is forbidden. Broadcast
mark-one/mark-all writes an idempotent private receipt for that caller and never changes the
broadcast base row. Direct PostgREST and Realtime use the equivalent own-or-broadcast RLS
predicate. The guarded behavior matrix remains useful source evidence, but the synthetic
in-memory PostgreSQL harness is not live Realtime qualification; catalog, role, socket,
resume/reconnect, token-refresh, and account-switch behavior remain release verification
requirements for future changes.

## Error semantics

Every new or materially changed mobile contract must distinguish:

- `401 unauthenticated`;
- `403 authenticated but forbidden`;
- `404 authorized object not found`;
- successful empty list;
- `409` version/conflict/already-in-progress;
- accepted/already-applied idempotent replay;
- retryable timeout/rate limit/provider unavailable;
- terminal validation/business-rule failure;
- partial success requiring reconciliation.

Do not use `.catch(() => [])` where it collapses forbidden/network failure into a successful empty
state. Do not return provider secrets, raw internal stack traces, or unnecessary PII.

## Pagination, sorting, filtering, and performance

Every list contract documents:

- server-side viewer scope and filters;
- stable deterministic order with tie-breaker;
- page size and cursor/next-page shape;
- maximum date/range or retained pages;
- selected columns (avoid list `select=*`);
- index/query-plan evidence at representative cardinality;
- cache key including every viewer/filter dimension.

Claims, tasks, documents, schedule retention, admin ledgers, and any result currently filtered
client-side are priority candidates. Preserve deployed response compatibility through additive
versions or coordinated cutover.

## Offline mutation contract

Only add a dispatcher after documenting:

| Field/behavior | Requirement |
|---|---|
| owner | immutable opaque principal plus exact current login epoch |
| identity | stable client operation ID |
| intent | desired state, not ambiguous toggle where possible |
| claim | random-token, TTL-bound compare-and-swap claim; exact owner/epoch |
| retry | bounded and classified; server idempotency |
| media/blob | ownership, quota, retention, missing-blob result |
| logout/account switch | synchronously stop the runner; clear readable state; preserve/quarantine foreign or legacy rows |
| result | canonical server ID/version and applied/already-applied |
| recovery | startup reconciliation for stale syncing/error |
| UI | pending/syncing/error/retry/cancel/partial result |

The initial release admits and dispatches no offline commands. `PRODUCTION_QUEUE_TYPES` is empty,
`useOfflineQueue` exposes no enqueue/retry API, and the runner imports no dispatchers. Photo,
reading, equipment placement/removal, room, note, and task writes are online-only and fail before
local persistence when disconnected.

The retained IndexedDB boundary is historical-state maintenance only. Owner rows in every store are
counted and quarantined without reading payloads or blobs; they block rollout and are never adopted.
The field UI surfaces only counts and an exact-confirmation, two-click action that discards all
local offline stores across accounts on that device. Existing completed-photo rows are cleanup-only
with retry limits and a time-rotating key-only scan; they are never sent.
Value-free live catalog evidence for those three stable-ID contracts is
[`../audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md`](../audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md).
It does not enable replay and does not close the separate caller-authorization gap inside the three
existing `SECURITY DEFINER` bodies.

IndexedDB v3 publishes bounded typed blocked/timeout/version-change recovery state. Blocking and
version-change callbacks close only the captured connection generation; an inspection failure
blocks rollout. At the 2026-07-27 offline-remediation checkpoint (`3da70e5`), focused tests passed
58/58, the complete unit lane passed 90 files/1079 tests, Worker passed 99 files/1476 tests, QA
passed 25 files/206 tests, and web/native builds passed. Full lint reported 310 findings; the
changed-file ratchet was tracked separately. Independent review found no actionable offline P0/P1. Browser/device
qualification and the separate live RPC authorization boundary remain.

## Change checklist

Before changing a mobile contract:

1. identify every web/native/desktop/worker caller;
2. inspect live signature/body/security/search path/ACL, RLS, grants, policies, triggers, and indexes
   read-only;
3. define role/tenant/assignment/object and public/service caller contract;
4. preserve response signature/shape or ship a compatible version;
5. add negative authorization, idempotency, concurrency, timeout, partial-failure, pagination, and
   rollback tests;
6. update this file, affected canonical domain docs, and `UPR-Web-Context.md`;
7. apply only from a reviewed release commit in an authorized shared-database window;
8. verify the intended role and live provenance after apply without exposing business data.

## Recording-source contract

S1e (`20260726183409_inbound_lead_recording_source_boundary`) is live and verified: QA ledger row
`20260731224513_inbound_lead_recording_source_boundary`; production ledger row
`20260731225511_inbound_lead_recording_source_boundary`. `inbound_leads.recording_url` is an
availability field, not a provider-source contract: it is null or `upr-recording://available`, and
clients may test presence only. The raw URL belongs to service-only
`inbound_lead_recording_sources`. Browsers request playback using only `lead_id` through
`/api/callrail-recording`; the Worker reconstructs identity, authorization, lead/provider binding,
URL allowlist and provider access. `get_inbound_leads(integer)` preserves JSON shape/order/limit but
requires admin or `crm_call_log` capability. Stored `raw_payload` recursively omits keys named
`recording` or `recording_url`.

**S1e/S1g historical apply-order prerequisite:** each target required the separately governed
`20260726180000_mobile_employee_identity_authority.sql` and
`20260726182000_mobile_employee_identity_containment.sql` sequence plus the compatible-client/
old-client decision. Their successful preflights proved there was no duplicate
`mobile_employee_identity_containment` ledger row and that the browser-read-only employee catalog
contract matched. Recapture that catalog/ledger state before any follow-on migration that relies
on the same boundary; it neither combines nor reopens the already-live S1e/S1g windows.

## S1h personal identity, preferences, and devices (retired — do not apply)

`20260727022920_mobile_personal_ownership_boundary.sql` is retired and must **not** be applied.
Its exact QA and production preflights refused because newer notification-preference and
native-token lineage has changed the catalog/function contracts it would replace. The source is
historical architecture only, not an exact database-behavior claim or an apply candidate. It
described these browser-visible identities and successful authorized shapes:

| Surface | Authenticated contract in retired S1h source (not live through this migration) |
|---|---|
| `get_employee_page_access(uuid)` | own active-internal employee; active-internal admin may inspect foreign employee |
| `get_effective_notification_prefs(uuid)` | own active-internal employee only |
| `get_my_notification_prefs(uuid)` | own active-internal employee; enabled types only |
| `set_my_notification_pref(uuid,text,text,boolean)` | own active-internal employee; role lock and channel validation preserved |
| `get_my_push_subscriptions(uuid)` | own active-internal employee; redacted list only |
| `upsert_push_subscription(text,text,text,text)` | employee derived from `auth.uid()`; same-owner refresh only; a foreign endpoint conflict raises `42501` |
| `delete_push_subscription(text)` | own endpoint only; a foreign endpoint raises `42501` |
| `upsert_device_token(uuid,text,text)` | supplied employee must match the session; same-owner refresh only; a foreign token conflict raises `42501` |
| `delete_device_token(text)` | own token only; foreign ownership raises `42501` |

The retired source retained trusted service-role compatibility and used a private owner-only helper
to centralize active/internal/session mapping. Active internal admin foreign page inspection was its
only personal-RPC exception. Its proposed forced-RLS, policy-free, browser-RPC-only table posture
and raw-native-token read removal were never applied by S1h; do not infer them from this section.

The retired source's preference resolver kept catalog → role → employee override → personal
precedence and the role lock. Its self-service list alone filtered disabled types, and its Web Push
metadata never returned endpoint/key secrets.

The P0 browser-writable employee-authority dependency remains separated into an additive
compatibility contract (`20260726180000_mobile_employee_identity_authority.sql`) and a later
schema-last containment (`20260726182000_mobile_employee_identity_containment.sql`). Compatible
web/PWA/native callers must deploy and old cached/native bundles must be retired or explicitly
accepted between those windows. The provenance reconciliation
`20260727020000_upsert_employee_page_access_provenance_reconciliation.sql` and the live
`permission_write_gates` dependency were part of the retired S1h design context; they do not make
its obsolete replacement safe.

A temporary non-retained PGlite experiment modeled the lifecycle and passed a rollback-only
behavior matrix. It did **not** execute the exact checked-in migration, preflight, post-apply, or
isolated files, and neither its harness nor a complete log was retained. That missing evidence is
now secondary to the superseding live lineage: do not rerun or repair S1h. Remaining Page Access and
Web Push ownership work requires a new, later, narrow migration that preserves the live
notification-preference and native-token contracts. S1f remains a separate unapplied attribute-only
candidate; S1d/S1e/S1g are live and must not be folded into that future migration. Notification
administration, QBO telemetry/RLS, private media, public signing, deployment, providers, Apple
signing, and device qualification remain separate.
