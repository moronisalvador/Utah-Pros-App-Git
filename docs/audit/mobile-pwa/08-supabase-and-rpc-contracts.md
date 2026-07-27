# UPR Mobile PWA and Capacitor Audit — Supabase and RPC Contracts

**Inspection boundary:** repository source/migrations plus read-only metadata from Supabase project
`glsmljpabrwonfiltiqm`. No business rows, object paths/contents, identities, logs, secrets, SQL
mutation, migration, function invocation, or configuration change was used.

## Data-access inventory

The complete native route graph contains the field experience and the role-gated admin-mobile
subtree. Static extraction across those pages, `TechLayout`, mobile components, and
`usePhotoUpload` found:

- **68 distinct RPC identifiers:** 67 literal calls plus dynamically selected
  `get_revenue_by_division`;
- **17 direct tables/views:** 13 in field surfaces plus four added by admin-mobile;
- direct authenticated Storage REST writes and public URL construction for `job-files`;
- authenticated Pages Functions for messaging, e-sign, PDFs/reports, feedback media, and other
  provider operations;
- Postgres Realtime subscriptions for messages.

This is an inventory of call sites, not a claim that all contracts are safe, live, reachable by
every role, or exercised in this audit.

### RPC inventory

```text
add_adhoc_job_task, assign_tasks_to_appointment, clock_appointment_action,
clock_finish_entry, convert_estimate_to_invoice, create_estimate_for_contact,
create_job_with_contact, create_room, create_room_for_claim, delete_appointment,
delete_oop_quote, get_active_appointment_geo, get_active_demo_schema,
get_active_drying_jobs, get_active_techs, get_appointment_detail,
get_appointment_tasks, get_appointments_range, get_ar_invoices,
get_assigned_tasks, get_avg_ticket, get_claim_appointments, get_claim_demo_sheets,
get_claim_detail, get_claim_jobs, get_claim_rooms, get_claims_list,
get_customer_detail, get_dashboard_action_items, get_demo_schema, get_demo_sheet,
get_demo_sheet_drafts, get_estimates, get_inbound_leads, get_insurance_carriers,
get_job_contacts, get_job_equipment, get_job_hub, get_job_readings, get_job_rooms,
get_job_task_summary, get_jobs_closed, get_jobs_completed, get_oop_quote,
get_open_estimates_summary, get_payments_ledger, get_payments_received,
get_pipeline_summary, get_revenue_by_division, get_stalled_materials_for_employee,
get_tech_claims, get_tech_conversations, get_tech_dashboard,
get_tech_status_board, get_unassigned_tasks, insert_job_document, insert_reading,
insert_tech_feedback, move_photo_to_room, place_equipment, remove_equipment,
save_demo_sheet, search_contacts_for_job, toggle_appointment_task,
update_appointment, update_lead_status, upsert_insurance_carrier, upsert_oop_quote
```

### Direct-table inventory

Field surfaces directly read or mutate:

`appointment_crew`, `appointments`, `claims`, `contact_jobs`, `contacts`, `conversations`,
`employees`, `estimate_line_items`, `job_documents`, `jobs`, `message_templates`,
`sign_requests`, and `sms_consent_log`.

Admin-mobile adds `estimates`, `invoices`, `invoice_line_items`, and `payments`.

Direct access is not automatically defective. It becomes unsafe when database policy does not
enforce the same role, assignment, tenant, or business-rule boundary the screen assumes, or when a
workflow needs transactional/idempotent semantics that several independent REST calls cannot
provide.

## Screen-to-database contract map

| Mobile workflow | Principal contracts | Underlying/related objects | State/error behavior | Main concern |
|---|---|---|---|---|
| Dashboard and assigned work | `get_tech_dashboard`, `get_assigned_tasks`, `get_active_appointment_geo`, `get_stalled_materials_for_employee` | employees, appointments, tasks, jobs, time entries | loaders, stale cache, background refresh | identity omitted from some persisted keys; overlapping loads |
| Schedule and appointment detail | `get_appointments_range`, `get_appointment_detail`, `get_appointment_tasks` | appointments, appointment_crew, jobs, tasks | skeleton/error/empty vary by screen | hidden pane keeps work active; range result grows |
| Create/edit appointment | direct appointments/crew writes plus `assign_tasks_to_appointment`, `update_appointment`, `delete_appointment` | appointments, appointment_crew, job tasks | submit state and toasts | multi-write partial completion and retry ambiguity (`MOB-REL-034`) |
| Task completion | `toggle_appointment_task`, `add_adhoc_job_task` | appointment/job task objects | optimistic/local feedback varies | actor parameter and DB enforcement must be authoritative |
| Claims/jobs | `get_tech_claims`, `get_claims_list`, `get_claim_detail`, `get_job_hub`, direct jobs/claims writes | claims, jobs, contacts, job_documents | loaders and partial `.catch(() => [])` fallbacks | UI-only admin/assignment boundaries (`MOB-SEC-014`) |
| Rooms/readings/equipment | room/read/equipment RPC family | rooms, readings, equipment, jobs | per-sheet spinners/toasts | several independent mutations; no offline/conflict contract |
| Photos/documents | Storage write, `insert_job_document`, `move_photo_to_room`, direct metadata updates | `storage.objects`, `job-files`, job_documents | progress/error; retry can repeat | non-atomic object/metadata pair (`MOB-DATA-012`); public bucket (`MOB-SEC-015`) |
| Time clock | `clock_appointment_action`, `clock_finish_entry`, time-entry reads | appointments, time entries | optimistic state/refetch | ambiguous network result and concurrency need server idempotency |
| Messages | `get_tech_conversations`, direct conversation/contact/consent updates, messaging worker, Realtime | conversations, messages, contacts, sms_consent_log | optimistic sends, thread retry, subscriptions | `sms:` escape path; consent changes are multi-write |
| Customer/job creation | direct contacts plus `create_job_with_contact`, carrier/search RPCs | contacts, jobs, contact_jobs, carriers | validation and duplicate lookup | duplicate-tap/network ambiguity and broad table access |
| Demo/scope sheet | schema/sheet RPC family plus PDF/email workers and local drafts | demo schemas/sheets, jobs/claims | local draft and save status | draft ownership and provider end-to-end proof |
| OOP pricing | quote/get/upsert/delete RPCs, direct job prefill | quotes, jobs, claims | guarded route, confirmation | server role scope and destructive contract |
| Admin-mobile money | financial/reporting RPCs plus direct estimate/payment/line-item writes | estimates, invoices, payments, line items | per-card error/retry | native inclusion, financial authorization, atomicity |
| E-sign | direct sign-request reads/update plus workers/public token RPCs | sign_requests, templates, jobs/contacts | cancel/send/status | public token expiry enforcement differs by boundary |
| Privileged workers | QBO invoice/estimate/payment/query, notify, e-sign, PDFs/reports, Houzz sync | service-role database client plus external providers | HTTP status/toast varies | several boundaries validate a session but not the required role/object authority |

The detailed route/state ledger is in `03-screen-and-workflow-ledger.md`. The table above records
contract families so future changes can start from a workflow boundary instead of reviewing isolated
folders.

## RLS and authorization dependencies

The mobile UI loads role, navigation, feature-flag, and employee-page-access state. Those values are
presentation gates, not trusted authorization. Repository policy history explicitly says the
permissive authenticated baseline placed enforcement in frontend route guards/RPCs
(`supabase/migrations/20260701_crm_partner_rls_non_crm_tables.sql:4-12`). For `jobs`, the resulting
policy allows every non-CRM-partner authenticated session every operation
(`:26-31`). The job hub then performs a direct soft delete after only a React role gate
(`src/pages/tech/v2/hub/AdminJobMenu.jsx:36-55`).

This mismatch generalizes beyond one button: any authenticated internal session able to call
PostgREST directly is not constrained by hidden navigation.

The same boundary appears in privileged Pages Functions. The mobile-admin QBO endpoints describe
Bearer access as admin-only but `isAuthorized()` only verifies that `/auth/v1/user` accepts the
token—there is no employee or role lookup
(`functions/api/qbo-invoice.js:35-45`, `qbo-estimate.js:19-29`,
`qbo-payment.js:16-26`, `qbo-query.js:15-26`). They then use the service role and caller-controlled
IDs/actions to create, update, delete, or email QBO transactions, or query QBO
(`qbo-invoice.js:60-85,91-117`; `qbo-estimate.js:44-68,81-103`;
`qbo-payment.js:41-78`; `qbo-query.js:32-64`).

`/api/notify` similarly accepts any valid Bearer token (`functions/api/notify.js:400-424`), honors
caller-supplied recipient IDs (`:97-106`), and fans caller-controlled content through bell, Web
Push, and email (`:152-222,428-440`). The service worker navigates a push-supplied target without a
same-origin route allowlist (`public/sw.js:59-76`). Source exposure is confirmed; whether each
endpoint and notification type is enabled in the current production deployment was not tested.

The admin-mobile CallRail recording proxy resolves any employee but does not require admin or
lead-center authority before a service-role read of caller-selected `inbound_leads` and streaming
the associated recording (`functions/api/callrail-recording.js:48-70,84-101`).

`MOB-SEC-014` is therefore a confirmed P0 authorization boundary covering database and trusted
worker enforcement, not a complaint about direct-table syntax.

Dated read-only catalog evidence recorded `job-files` as public with 72 objects and 57,472,887
aggregate bytes, no MIME allowlist, two broad SELECT policies that permit anonymous listing, and
bucket-wide authenticated insert/delete without an assignment/path predicate
(`docs/audit/2026-07/evidence/live-supabase.md:141-152`). Mobile code creates public URLs for job
media. `MOB-SEC-015` is the second P0 boundary. No object name or contents were inspected.

## Security-definer and grant review

RPC existence is not proof of authorization. Each mobile RPC must be classified as:

1. `SECURITY INVOKER` and protected by correctly scoped table RLS;
2. necessary `SECURITY DEFINER` with a fixed search path, internal caller/role/assignment checks,
   explicit ACL, and documented return contract; or
3. privileged worker-only behavior, unreachable by browser roles.

The repository provenance validator passed for the audited snapshot and checked the maintained
function/policy ledger. That is useful governance evidence, not a complete behavioral proof of 68
contracts. The formerly dangerous free-form `exec_read_sql` browser grant was contained before this
snapshot; it is a service-only regression boundary and is **not** reported as a current mobile
finding (`docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md:51-80`).

## Error and return-shape consistency

Contract handling is heterogeneous:

- TanStack Query routes generally expose loading/error/refetch states;
- several legacy screens run parallel RPCs and convert individual failures to empty arrays, which
  can render missing data as “nothing here”;
- direct REST methods and RPCs return different singular/array shapes, requiring call-site shaping;
- admin cards have local error/retry behavior, while some setup lookups silently ignore failures;
- multi-step writes often surface only the final thrown error and cannot explain which earlier step
  committed;
- the offline runner has a typed dispatcher surface, but the database contracts do not consistently
  accept a stable client operation ID.

Canonical contracts need explicit success shape, typed domain error, authorization error,
not-found/empty distinction, idempotency key, retry class, and backward-compatibility promise.

## Pagination, filtering, and growth risks

- `get_payments_ledger` requests up to 1,000 rows and admin lead center requests 100 without an
  evidenced cursor.
- assigned-task and document/photo queries are not consistently bounded
  (`MOB-DATA-033`).
- several job-document lists use broad `select=*` or retrieve all matching media metadata.
- persistent Dashboard/Schedule/Messages panes and layout refreshes can duplicate requests
  (`MOB-PERF-007`).
- no audit result proves index support or latency for every filter at production scale.

These are P2 scalability risks, not a claim that current production is slow. Query plans and
aggregate latency must be captured read-only against representative cardinalities before changing
indexes.

## Migration and live-state drift

The audited branch is a source snapshot, while `dev` and `main` share one Supabase project. A dated
catalog capture observed migration-ledger/source differences
(`docs/audit/2026-07/evidence/live-supabase.md:154-165`). Counts alone do not prove drift because
early history and naming conventions differ. Release evidence must instead bind each app release to:

- reviewed source SHA and generated schema/RPC provenance;
- live migration ledger and relevant function definitions/ACLs;
- backward-compatible return signatures;
- feature-flag state and rollback compatibility.

No migration was applied or reconciled during this audit.

## Recommended contract hardening

1. Contain P0 Storage exposure and replace broad authenticated write policies with explicit,
   assignment/role-scoped database enforcement.
2. Inventory the 68 RPCs in a generated contract report: signature, security mode, owner, ACL,
   tables, caller, expected shape, pagination, and compatibility status.
3. Move cross-table/high-impact mutations behind transactional, idempotent trusted boundaries;
   preserve deployed response contracts.
4. Add stable operation IDs and atomic claim/lease semantics for queued work.
5. Namespace device state and query keys by authenticated account; clear/quarantine on logout.
6. Standardize `not found`, forbidden, empty, conflict, retryable, and terminal errors.
7. Add negative authorization, duplicate-retry, partial-failure, concurrency, and growth tests.
8. Require source/live provenance and rollback evidence before a mobile release.

## Contract-readiness conclusion

The application has a broad and purposeful database API, but mobile correctness depends too heavily
on frontend gates and best-effort multi-call workflows. P0 authorization/Storage boundaries and P1
mutation/session-state defects prevent production-readiness. The next phase should harden existing
contracts and preserve shapes, not rewrite every direct query into an RPC.
