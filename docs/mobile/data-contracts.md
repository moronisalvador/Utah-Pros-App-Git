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

R0's corrected transitive current-source graph contains 84 client-reachable RPCs: 82 from the
authenticated `/tech` graph plus the two anon-key public-signing RPCs mounted by `NativeRoutes`.
It also contains 22 direct PostgREST tables. Realtime subscribes to `conversations`, `messages`,
and `notifications`; the first two overlap the direct set. Exact direct tables:

`appointment_crew`, `appointments`, `claims`, `contact_jobs`, `contacts`,
`conversation_participants`, `conversations`, `employees`, `estimate_line_items`, `estimates`,
`invoice_line_items`, `invoices`, `job_documents`, `job_time_entries`, `jobs`,
`message_templates`, `messages`, `nav_permissions`, `payments`, `scheduled_messages`,
`sign_requests`, and `sms_consent_log`.

Do not treat these hand-maintained counts as generated truth after code changes. Update this document
and regenerate/extend the contract inventory when a caller changes.

## R0 current boundary recapture

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

Two bypasses remain outside that HTTP source slice. S1d now has a reviewed, locally tested but
unapplied migration that removes authenticated execution of `notify_emit(text,jsonb)`, retains
only `service_role`, and makes the trusted top-level event type win over the object body. Until its
separate owner-authorized apply, the live definer can still forward caller-controlled JSON while
presenting the stored Worker secret. `get_inbound_leads` plus broad `inbound_leads` policies can
still expose stored recording URLs without the proxy. Therefore neither S1c nor local S1d readiness
closes `MOB-SEC-014`. The existing QBO human-actor telemetry gap and external-admin
`qbo_attachments` metadata SELECT policy remain separate QBO residuals.

## Workflow contract map

### Session, profile, permissions, and flags

| Contract | Current caller expectation |
|---|---|
| Supabase Auth session | persisted/refreshable user session |
| employees/profile lookup | one active employee corresponding to the Auth identity |
| navigation permissions and employee overrides | arrays/maps used for UI visibility |
| feature-flag RPC | rows keyed by feature/page/tool key |

Authorization requirement: missing/disabled/inactive employee must fail access regardless of a valid
Auth user. Permissions/flags do not grant direct worker/database privilege. A flag load error must
not expose gated behavior.

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

`get_oop_quote`, `get_claim_jobs`, `upsert_oop_quote`, `delete_oop_quote` plus direct job prefill.
Server enforces viewer role/object and returns an authoritative quote/version; delete/upsert must be
idempotent and audited as business policy requires.

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
- no sensitive lock-screen payload beyond approved privacy policy.

S1c implements only the HTTP identity/object portion. An exact stored secret remains first and
keeps the full deployed trigger payload; trusted Workers continue to call `dispatchEvent`
in-process. A human Bearer must be an active internal admin and may supply only the IDs for
appointment assigned/updated/canceled or estimate accepted after exact state/membership lookup.
The existing response summary, preference resolution, sequential fan-out and per-channel
best-effort behavior are preserved. Shared Auth and Web Push still use unbounded legacy fetch paths;
provider timeout completion is therefore an explicit residual rather than a closed contract.

S1d freezes the database-origin contract without sending an event: six owner-run definer functions
contain the seven appointment/estimate/timesheet/abandoned-clock calls, all pass object bodies, and
the abandoned-clock scanner remains a `postgres` cron caller. The unapplied migration changes only
the target ACL and object merge order; catalog/URL gates, secret/header names, `net.http_post`,
ignored response, payload fields, triggers, and schedule remain unchanged. Its intended direct
grant is `service_role`; the owner-executed database chain must not receive an in-body
session-role check. Current live authenticated execution remains the higher-priority apply gate,
while direct `create_notification` remains a separate bell-RPC residual.

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
| owner | immutable Auth user/employee/tenant |
| identity | stable client operation ID |
| intent | desired state, not ambiguous toggle where possible |
| claim | atomic lease/expiry/attempt owner |
| retry | bounded and classified; server idempotency |
| media/blob | ownership, quota, retention, missing-blob result |
| logout | purge, quarantine, or owner-only resume |
| result | canonical server ID/version and applied/already-applied |
| recovery | startup reconciliation for stale syncing/error |
| UI | pending/syncing/error/retry/cancel/partial result |

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
