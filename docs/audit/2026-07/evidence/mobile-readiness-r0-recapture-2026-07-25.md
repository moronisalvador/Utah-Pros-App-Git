<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md

WHAT THIS DOES (plain language):
  Records the current source, caller, authorization, Storage and product-decision evidence captured
  for Mobile Production Readiness Wave R0, including the first bounded local containment slice.

DEPENDS ON:
  Internal: src/App.jsx, src/pages/tech/, src/components/admin-mobile/, functions/api/,
            functions/lib/, supabase/migrations/, docs/mobile/*,
            docs/mobile-production-readiness-roadmap.md
  Data:     reads → repository source and read-only Supabase catalog/configuration metadata
            writes → documentation only

NOTES / GOTCHAS:
  - This is dated evidence. It does not replace a release-time source/live recapture.
  - No customer row, object name, object body, credential value or provider payload was inspected.
  - No migration, deployment, provider action, message, push, signing or external setting changed.
-->

# Mobile readiness R0 recapture — 2026-07-25

## Result

R0 produced a current route/caller/boundary map and one narrowly bounded, contract-preserving local
source slice: four legacy QBO Workers now require either the preserved server capability or an
active, internal `admin` employee before connection, domain-table, telemetry or provider access.
The slice is covered by negative/failure-path tests.

This does **not** close either P0:

- `MOB-SEC-014` remains open because other Workers, 82 browser-reachable `SECURITY DEFINER` mobile
  RPCs, broad direct-table/Realtime policies, and shared compatibility callers still require
  containment.
- `MOB-SEC-015` remains open because `job-files` is still public/listable, authenticated identities
  retain bucket-wide insert/delete, and current web/worker consumers still assume public URLs.

No live apply or deployment is part of this evidence.

## Provenance and isolation

| Item | Captured value |
|---|---|
| Historical audit application source | `ef305f6d6afab4d846eab92fc1b04038d70221f0` |
| Foundation base | `7aa4b0c6569396b7e7b5524ed052eca279927218` |
| Foundation branch | `codex/mobile-pwa-readiness-foundation` |
| Fetched `origin/dev` | `90b265ee6f733c8dbcd75786f4e4057dd3355d38` |
| Reconciliation | `origin/dev` is an ancestor of the foundation; the foundation is 14 commits ahead, so no merge/rebase was required |
| R0 branch | `codex/mobile-readiness-wave-r0` |
| Isolated worktree | `/private/tmp/upr-mobile-readiness-r0` |
| Pre-edit R0 worktree | clean |
| Original checkout | unrelated `.claude/settings.local.json` modification present and untouched |
| Local source/test slice | `66182f3` through `e42edb5` (inclusive; documentation commits follow) |

The pre-edit comparison from the historical audit source through the foundation found no change in
the affected four legacy QBO Workers, `callrail-recording`, `notify`, `job-files` callers/policies,
or the shared `/tech` route graph. Other foundation/source work was retained. Runtime Cloudflare
deployment hashes and bindings were not available, so repository source is not represented as
deployed proof.

## Read-only live Supabase recapture

Catalog/configuration captures used project ref `glsmljpabrwonfiltiqm` and PostgreSQL 17.6. They
selected metadata, aggregate object count/recorded bytes, policy expressions, ACLs and function
definitions only.

### Storage and migration state

Captured at `2026-07-26 05:09:23 UTC`:

| Item | Current value | Historical audit value |
|---|---:|---:|
| Latest migration ledger version | `20260725201303` | dated audit snapshot only |
| `job-files.public` | `true` | `true` |
| File-size limit | 52,428,800 bytes (50 MiB) | 50 MiB |
| MIME allowlist | `null` | none |
| Object count (aggregate only) | 77 | 72 |
| Recorded object bytes (aggregate only) | 58,233,782 | 57,472,887 |

The four current `storage.objects` policies are exact and unchanged in substance:

| Policy | Role / operation | Expression |
|---|---|---|
| `anon_read_job_files` | `anon SELECT` | `bucket_id = 'job-files'` |
| `job_files_authenticated_insert` | `authenticated INSERT` | `WITH CHECK (bucket_id = 'job-files')` |
| `job_files_authenticated_delete` | `authenticated DELETE` | `bucket_id = 'job-files'` |
| `job_files_select` | `PUBLIC SELECT` | `bucket_id = 'job-files'` |

Both `anon` and `authenticated` hold all seven table ACL privileges on `storage.objects`
(`DELETE`, `INSERT`, `REFERENCES`, `SELECT`, `TRIGGER`, `TRUNCATE`, `UPDATE`); RLS is therefore the
only row/object restriction for those roles. A public bucket also permits public asset retrieval
without an object-read policy decision. This is configuration evidence, not authorization to read
an object.

### Mobile RPC boundary

The first inline route census found 68 names. A release-audit correction then walked the transitive
imports used by `AuthContext`, `TechLayout`, shared notification/push/clock helpers, both
conversation implementations, and the job/claim merge modal. The corrected current census contains
82 distinct browser-reachable RPC identifiers. It deliberately excludes the unused
`get_job_financials` export in `claimUtils.js`: the mobile route imports only `fmt$` from that
module and never invokes the financial helper.

At `2026-07-26 05:35:12 UTC`, all 82 exact names resolved to one live overload each:

- 82/82 are `SECURITY DEFINER`;
- 82/82 are executable by `authenticated` and `service_role`;
- 2/82, `get_employee_page_access` and `get_feature_flags`, are also executable by `anon` and
  `PUBLIC`;
- the other 80/82 deny `anon` and `PUBLIC` execution.

Names:

`add_adhoc_job_task`, `assign_tasks_to_appointment`, `clock_appointment_action`,
`clock_finish_entry`, `clock_omw_precheck`, `convert_estimate_to_invoice`,
`create_estimate_for_contact`,
`create_job_with_contact`, `create_room`, `create_room_for_claim`, `delete_appointment`,
`delete_oop_quote`, `delete_push_subscription`, `get_active_appointment_geo`,
`get_active_demo_schema`,
`get_active_drying_jobs`, `get_active_techs`, `get_appointment_detail`,
`get_appointment_tasks`, `get_appointments_range`, `get_ar_invoices`, `get_assigned_tasks`,
`get_avg_ticket`, `get_claim_appointments`, `get_claim_demo_sheets`, `get_claim_detail`,
`get_claim_jobs`, `get_claim_rooms`, `get_claims_list`, `get_customer_detail`,
`get_dashboard_action_items`, `get_demo_schema`, `get_demo_sheet`, `get_demo_sheet_drafts`,
`get_employee_page_access`, `get_estimates`, `get_feature_flags`, `get_inbound_leads`,
`get_insurance_carriers`, `get_job_contacts`, `get_job_equipment`, `get_job_hub`,
`get_job_readings`, `get_job_rooms`, `get_job_task_summary`, `get_jobs_closed`,
`get_jobs_completed`, `get_my_notification_prefs`, `get_notifications`, `get_oop_quote`,
`get_open_estimates_summary`, `get_payments_ledger`, `get_payments_received`,
`get_pipeline_summary`, `get_revenue_by_division`, `get_stalled_materials_for_employee`,
`get_tech_claims`, `get_tech_conversations`, `get_tech_dashboard`, `get_tech_status_board`,
`get_unassigned_tasks`, `get_unread_notification_count`, `insert_job_document`, `insert_reading`,
`insert_tech_feedback`, `mark_all_notifications_read`, `mark_notification_read`, `merge_claims`,
`merge_jobs`, `move_photo_to_room`, `place_equipment`, `remove_equipment`, `save_demo_sheet`,
`search_contacts_for_job`, `set_my_notification_pref`, `toggle_appointment_task`,
`update_appointment`, `update_lead_status`, `upsert_device_token`,
`upsert_insurance_carrier`, `upsert_oop_quote`, and `upsert_push_subscription`.

A deliberately simple definition scan for `auth.uid()`, request-JWT/current-auth, or literal
`caller` signals matched only `delete_push_subscription`, `get_appointment_detail`,
`get_appointments_range`, `insert_tech_feedback`, and `upsert_push_subscription`. This 5/82
heuristic is a prioritization signal, **not proof** that the other 77 lack authorization or that
the five are sufficient. Every definer function still needs an object/role/assignment review and
direct negative tests.

#### Transitive functions missed by the initial inline census

The exact live signatures/bodies/ACLs below were recaptured at `2026-07-26 05:34:42 UTC`. `A/S`
means `authenticated` and `service_role` can execute; every row is `SECURITY DEFINER`.

| Caller | Exact live signature/result | Execute grant | Decisive live body/object boundary |
|---|---|---|---|
| `TimeTracker`, `TechJobHub` via `clockPrecheck.js` | `clock_omw_precheck(uuid, uuid) → jsonb` | A/S | No caller reconstruction; reads `feature_flags`, then any open `job_time_entries` row for supplied employee ID and appointment/job labels for supplied appointment context |
| `webPushClient.disablePush` | `delete_push_subscription(text) → void` | A/S | Resolves employee by `employees.auth_user_id = auth.uid()` and deletes only matching endpoint + employee; silently returns when no employee |
| shared `AuthContext` | `get_employee_page_access(uuid) → SETOF employee_page_access` | `PUBLIC`, `anon`, A/S | No caller reconstruction; returns every override row for the supplied employee ID |
| shared `AuthContext` | `get_feature_flags() → SETOF feature_flags` | `PUBLIC`, `anon`, A/S | No caller reconstruction; returns the full feature-flag table |
| `NotificationPrefsMatrix` | `get_my_notification_prefs(uuid) → SETOF json` | A/S | No caller reconstruction; delegates supplied employee ID to definer `get_effective_notification_prefs`, which joins `employees`, notification types/defaults/overrides/preferences |
| `NotificationBell` | `get_notifications(integer, uuid) → SETOF notifications` | A/S | No caller reconstruction; reads broadcasts plus rows for the supplied employee ID, capped at 100 |
| `NotificationBell` | `get_unread_notification_count(uuid) → integer` | A/S | No caller reconstruction; counts unread broadcasts plus rows for the supplied employee ID |
| `NotificationBell` | `mark_all_notifications_read(uuid) → void` | A/S | No caller reconstruction; marks every unread broadcast and every row for the supplied employee ID read |
| `NotificationBell` | `mark_notification_read(uuid) → void` | A/S | No caller reconstruction or recipient predicate; marks the supplied notification ID read |
| job/claim `MergeModal` | `merge_claims(uuid, uuid) → jsonb` | A/S | No caller/role reconstruction; merges/deletes supplied claims, repoints jobs, and writes `system_events` |
| job `MergeModal` | `merge_jobs(uuid, uuid) → jsonb` | A/S | No caller/role reconstruction; merges/deletes supplied `jobs` and repoints or deletes across `payments`, `invoices`, `estimates`, `job_costs`, `job_supplements`, `vendor_invoices`, `job_documents`, `job_notes`, `job_checklists`, `forms`, `sign_requests`, `document_requests`, `appointments`, `job_assignments`, `job_schedules`, `schedule_blocks`, `job_time_entries`, `job_equipment`, `job_tasks`, `conversations`, `notification_queue`, `selection_dispatches`, `selection_responses`, `sub_confirmations`, `job_phase_history`, `system_events`, `dispatch_board_jobs`, and `contact_jobs` |
| `NotificationPrefsMatrix` | `set_my_notification_pref(uuid, text, text, boolean) → notification_prefs` | A/S | No caller reconstruction; validates channel, supplied employee existence, and role-default customizability, then upserts that employee's preference |
| native post-login `pushNotifications.js` | `upsert_device_token(uuid, text, text) → device_tokens` | A/S | No caller reconstruction; upserts the supplied token and can reassign it to the supplied employee ID |
| `webPushClient.enablePush` | `upsert_push_subscription(text, text, text, text) → push_subscriptions` | A/S | Resolves employee by `employees.auth_user_id = auth.uid()` and binds the endpoint to that employee; returns null when no employee |

The nested live `get_effective_notification_prefs(uuid)` helper was also recaptured at
`2026-07-26 05:36:11 UTC`: it is `SECURITY DEFINER`, executable by A/S only, and trusts the supplied
employee ID while joining `employees`, `notification_types`, `notification_role_defaults`,
`notification_employee_overrides`, and `notification_prefs`.

### Direct-table and Realtime boundary

The corrected transitive route graph contains 22 direct PostgREST tables plus Realtime subscriptions
on `conversations`, `messages`, and `notifications` (the first two overlap the direct set). At
`2026-07-26 05:35:40 UTC`, RLS was enabled and not forced on all 23 tables. Except for `messages`,
both `anon` and `authenticated` held all seven table ACL privileges; RLS is therefore the only
effective row restriction for those roles. `messages` is the important exception: `anon` has no
table privilege and `authenticated` has `SELECT` only. Policy names that say `anon` but target
`authenticated` are retained exactly as deployed.

| Table(s) | Current policy boundary |
|---|---|
| `appointments` | `all_{select,insert,update,delete}_appointments`; roles `anon, authenticated`; unconditional `true` |
| `appointment_crew` | `all_{select,insert,update,delete}_appointment_crew`; `authenticated`; unconditional `true` |
| `claims` | `anon_{read,insert,update}_claims` unconditional; authenticated/non-CRM-partner CRUD via `claims_auth_*` plus `claims_anon_delete` |
| `contacts` | `allow_anon_{read,insert,update}_contacts` unconditional; internal/non-CRM-partner CRUD via `contacts_authenticated_*` |
| `contact_jobs` | `contact_jobs_anon_{select,insert,update,delete}` target `authenticated`; unconditional `true` |
| `conversation_participants` | anonymous SELECT/INSERT unconditional; `allow_authenticated_conversation_participants FOR ALL USING/WITH CHECK (true)` |
| `conversations` | anonymous read/insert/update unconditional; `allow_authenticated_conversations FOR ALL USING/WITH CHECK (true)` |
| `employees` | anonymous read unconditional; `allow_authenticated_employees FOR ALL USING/WITH CHECK (true)` |
| `estimates`, `estimate_line_items` | `allow_authenticated_* FOR ALL`; only excludes CRM partners |
| `invoices`, `invoice_line_items` | broad authenticated access; invoice/line-item `FOR ALL` only excludes CRM partners; invoice SELECT is also unconditional for authenticated |
| `job_documents` | authenticated unconditional CRUD under the four `anon_*_job_documents` policies; four `job_documents_*` policies target `PUBLIC` and only exclude CRM partners |
| `job_time_entries` | authenticated SELECT only under `jte_select_all`, excluding CRM partners; no browser write policy despite broad table ACL grants |
| `jobs` | anonymous read/insert/update unconditional; `allow_authenticated_jobs FOR ALL` only excludes CRM partners |
| `message_templates` | authenticated SELECT/ALL unconditional |
| `messages` | no `anon` table grant; authenticated SELECT only; `messages_authenticated_select USING (messaging_can_access_conversations())` |
| `nav_permissions` | anonymous SELECT unconditional; authenticated `FOR ALL USING/WITH CHECK (true)` |
| `notifications` | authenticated SELECT unconditional; DELETE only for `type='__f2test__'`; the definer bell RPCs above bypass these RLS predicates |
| `payments` | authenticated unconditional CRUD under `allow_anon_*_payments`; `allow_authenticated_payments FOR ALL` only excludes CRM partners |
| `scheduled_messages` | authenticated SELECT/INSERT plus `FOR ALL`, all unconditional |
| `sign_requests` | authenticated read/insert/update and `FOR ALL`, all unconditional |
| `sms_consent_log` | authenticated read/insert and `FOR ALL`, all unconditional |

`inbound_leads` is not a direct browser table caller in the current graph; it is reached through
`get_inbound_leads` and the service-role CallRail Worker. Its live
`inbound_leads_all FOR ALL TO authenticated USING/WITH CHECK (true)` boundary remains relevant to
those paths.

Except for the scoped `messages` read and the read-only `job_time_entries` policy, this is
authentication-, anonymous-, or non-partner-wide access, not route, role, assignment, owner or
object authorization. Realtime does not narrow it: `NotificationBell` subscribes to every
`notifications` INSERT and filters other recipients only in the browser.

## Exact current route → caller → operation → boundary map

Every `/tech` route is nested under `ProtectedRoute` in `src/App.jsx`; `/tech/job/:jobId` also has
`FeatureRoute`, and `/tech/admin/*` has `AdminMobileRoute`. These are UI gates only.

Boundary abbreviations used below:

- `RPC`: the live 82-function definer boundary above; two shared bootstrap functions also allow
  `anon`/`PUBLIC`.
- `DIR:<table>`: direct PostgREST access under the live table boundary above.
- `RT:<table>`: Realtime delivery under that table's live SELECT/RLS boundary.
- `STO`: public `job-files` plus the four live object policies above.
- `QBO-4`: the locally implemented four-Worker boundary described under the next heading.
- `WORKER`: the named Worker must enforce its own session/employee/role/object contract.

| Route | Current UI caller | Exact operation chain | Current decisive boundary |
|---|---|---|---|
| `/login` | `src/pages/Login.jsx` | Supabase Auth session bootstrap | Auth; no MOB-SEC-014/015 domain operation |
| `/set-password` | `src/pages/SetPassword.jsx` | Supabase recovery session | Auth token contract |
| `/sign/:token` | `src/pages/SignPage.jsx` | signing RPC/worker → `POST /api/submit-esign` → service upload to `job-files` | token validation Worker/RPC + `STO`; public/signed-delivery compatibility remains |
| every authenticated `/tech/*` route | `AuthContext.jsx` | Auth identity → `DIR:employees` email lookup; `DIR:nav_permissions` role lookup; `get_feature_flags`; `get_employee_page_access(p_employee_id)` | direct employee/permission policies plus definer `RPC`; flags/page access are also anon/PUBLIC executable and page access trusts the supplied employee ID |
| every `/tech/*` route while its persistent panes/flags are mounted | `TechLayout.jsx`, persistent `TechDashV2`, `TechScheduleV2`, `TechMessagesV2` | `get_assigned_tasks`; dashboard/schedule/conversation chains below can remain mounted off-route; conversation Realtime remains flag-dependent | shared `RPC`, direct-table and `RT` boundaries apply to more than the visible pathname |
| every native post-login session | `AuthContext.jsx` → `pushNotifications.js` | native registration token → `upsert_device_token(p_employee_id, p_token, p_platform)` | definer `RPC` trusts the supplied employee ID and can reassign a token; APNs provider/signing proof unavailable |
| `/tech` | `v2/TechDashV2.jsx`, `v2/dash/DashHeader.jsx`, `AttentionStrip.jsx`, `CompletedRows.jsx`, `PhotoCaptureButton.jsx`, `TimeTracker.jsx` | dashboard/geo/stalled/task/clock RPCs including `clock_omw_precheck`; `DIR:job_time_entries`; bell count/list/mark RPCs; `RT:notifications`; photo upload → `insert_job_document` | `RPC`; scoped-read `DIR:job_time_entries`; `RT:notifications`; `STO`; client-supplied employee/notification/object IDs |
| `/tech/schedule` | `v2/TechScheduleV2.jsx`, `v2/schedule/useScheduleData.js` | `get_appointments_range` | `RPC` |
| `/tech/tasks` | `TechTasks.jsx` | `get_assigned_tasks`, `toggle_appointment_task` | `RPC`; client supplies employee ID |
| `/tech/claims` | `TechClaims.jsx` | UI role chooses `get_tech_claims(p_employee_id)` or `get_claims_list()` | `RPC`; UI choice is not authorization |
| `/tech/claims/:claimId` | `TechClaimDetail.jsx`, `MergeModal.jsx`, `GenerateReportButton.jsx` | claim/detail/appointment/room/demo/task RPCs; `DIR:job_documents`; `DIR:claims/jobs` update/search/impact; `merge_claims(p_keep_id,p_merge_id)`; `/api/generate-water-loss-report`; Storage POST → `insert_job_document` | `RPC`, broad `DIR:claims/jobs/job_documents`; merge definer has no caller/role check; report `WORKER`; `STO` |
| `/tech/claims/:claimId/photos` | `TechClaimAlbum.jsx`, `usePhotoUpload.js` | Storage POST → `insert_job_document`; public/render URL | `STO` + `RPC`, non-atomic |
| `/tech/claims/:claimId/rooms/:roomId` | `TechRoomDetail.jsx` | `get_claim_detail`, `get_claim_rooms`; Storage POST → `insert_job_document`; public photo URLs | `RPC` + `STO` |
| `/tech/jobs/:jobId` | `TechJobDetail.jsx`, `MergeModal.jsx` | `DIR:jobs/claims/job_documents/sign_requests`; contact/appointment RPCs; direct job update; merge impact reads `DIR:jobs/job_documents/payments/job_time_entries`; `merge_jobs(p_keep_id,p_merge_id)`; Storage POST → `insert_job_document` | broad direct policies + scoped-read time entries + `RPC`; merge definer has no caller/role check; `STO` |
| `/tech/job/:jobId` | `v2/TechJobHub.jsx`, `v2/hub/*`, `TimeTracker.jsx`, `MergeModal.jsx` | hub/appointment/room/task/readings/equipment RPCs including `clock_omw_precheck`; `DIR:job_time_entries`; `AdminJobMenu` soft-delete via `DIR:jobs`; merge impact reads `DIR:jobs/job_documents/payments/job_time_entries` then `merge_jobs`; Storage POST → `insert_job_document` | feature/UI admin gates only; `RPC`, broad job/document/payment policies, scoped-read time entries, `STO`; merge/clock-precheck definers trust supplied IDs |
| `/tech/jobs/:jobId/photos` | `TechJobAlbum.jsx`, `usePhotoUpload.js` | Storage POST → `insert_job_document`; public/render URL | `STO` + `RPC`, non-atomic |
| `/tech/jobs/:jobId/documents` | `TechJobDocuments.jsx`, `EsignRequestSheet.jsx` | `DIR:jobs/contact_jobs/contacts/sign_requests`; public `job-files` URL; `/api/send-esign`, `/api/resend-esign`; direct cancel update | broad direct policies + e-sign `WORKER` + `STO` |
| `/tech/appointment/:id` | `TechAppointment.jsx`, `TimeTracker.jsx`, field sheets | appointment/task/room/readings/equipment RPCs including `clock_omw_precheck`; `DIR:job_time_entries/job_documents/sign_requests`; Storage POST → metadata RPC; direct caption update | `RPC` + scoped-read time-entry/broad document policies + `STO`; precheck trusts supplied employee/appointment IDs |
| `/tech/appointment/:id/edit` | `TechEditAppointment.jsx` | appointment/task/range/unassigned RPCs; `DIR:employees/appointments/appointment_crew`; `update_appointment`, `assign_tasks_to_appointment`, `delete_appointment` | `RPC` + broad direct policies; multi-write client transaction |
| `/tech/new-customer` | `TechNewCustomer.jsx` | `DIR:contacts` insert/search | broad contacts policy; no server role boundary |
| `/tech/new-job` | `TechNewJob.jsx` | `DIR:contacts`; carrier/search/customer/create RPCs; `/api/sync-claim-to-encircle`; `/api/sync-houzz` | broad contacts + `RPC` + named provider `WORKER`s |
| `/tech/new-appointment` | `TechNewAppointment.jsx` | `DIR:employees/jobs/appointments/appointment_crew`; task/add/assign RPCs | broad direct policies + `RPC`; multi-write client transaction |
| `/tech/new-event` | `TechNewEvent.jsx` | `DIR:employees/appointments/appointment_crew` | broad direct policies; multi-write client transaction |
| `/tech/conversations` | `Conversations.jsx` or flag-selected `v2/TechMessagesV2.jsx`, `v2/messages/*` | `get_tech_conversations`; direct conversations/messages/contacts/conversation participants/templates/consent/scheduled messages; `RT:conversations/messages`; `/api/message-conversations`, `/api/attest-sms-consent`, `/api/send-message`, `/api/message-media-upload`, `/api/message-media-url`; attachment URLs | mixed `RPC`; `messages` is capability-scoped authenticated SELECT, while the other direct messaging policies are broad; named messaging `WORKER`s; legacy public media parser uses `STO` |
| `/tech/feedback` | `TechFeedback.jsx`, `FeedbackAttachments.jsx` | `insert_tech_feedback`; Storage upload/delete/public preview; `/api/feedback-notify` | `RPC` + `STO` + notification `WORKER` |
| `/tech/more` | `TechMore.jsx` | `get_assigned_tasks`; local navigation/settings | `RPC` |
| `/tech/settings` | `TechSettings.jsx`, `NotificationsSection.jsx`, `NotificationPrefsMatrix.jsx`, `webPushClient.js` | local preferences; `GET /api/vapid-public-key`; `upsert_push_subscription` / `delete_push_subscription`; `get_my_notification_prefs(p_employee_id)` / `set_my_notification_pref(p_employee_id,...)` | Web Push RPCs reconstruct `auth.uid()`; preference definers trust supplied employee ID; native/web push lifecycle remains separate |
| `/tech/help` | `TechHelp.jsx` | static/local content | no MOB-SEC-014/015 data operation |
| `/tech/tools/oop-pricing` | `TechOOPPricing.jsx` | `DIR:jobs`; `get_oop_quote`, `get_claim_jobs`, `upsert_oop_quote`, `delete_oop_quote` | feature flag only in UI; broad jobs + `RPC` |
| `/tech/tools/demo-sheet` | `TechDemoSheet.jsx` | demo/schema/save RPCs; `/api/encircle-search`, `/api/encircle-rooms`, `/api/encircle-upload`, `/api/demo-sheet-pdf`, `/api/send-demo-sheet` | `RPC` + named provider/document `WORKER`s; local drafts are a separate account-state boundary |
| `/tech/admin`, `/tech/admin/dash` | `admin/AdminDash.jsx`, `admin-mobile/dash/*` | revenue, payments, average ticket, A/R, drying/action/status/pipeline/jobs/estimates RPCs | React admin/permission gate only; `RPC` is authenticated-wide |
| `/tech/admin/collections` | `AdminCollections.jsx`, `admin-mobile/collections/*` | `get_ar_invoices`, `get_estimates`, `get_payments_ledger`, `get_payments_received` | UI financial tabs only; `RPC` is authenticated-wide |
| `/tech/admin/invoice/:invoiceId` | `AdminInvoiceDetail.jsx`, `recordPayment.js` | direct invoice/payment records; `/api/qbo-invoice`; `/api/qbo-payment` | broad financial table policies + local `QBO-4` source gate |
| `/tech/admin/estimate/new` | `AdminEstimateEditor.jsx`, `EstimateCreateForm.jsx` | `DIR:contacts/estimates/estimate_line_items`; contact/carrier/create RPCs; `/api/qbo-query` | broad financial/contact policies + `RPC` + local `QBO-4` |
| `/tech/admin/estimate/:estimateId/edit` | `AdminEstimateEditor.jsx` | `DIR:estimate_line_items` CRUD; `/api/qbo-query` | broad line-item policy + local `QBO-4` |
| `/tech/admin/estimate/:estimateId` | `AdminEstimateDetail.jsx` | `/api/qbo-estimate`; `convert_estimate_to_invoice`; `/api/qbo-invoice` | local `QBO-4` + `RPC` |
| `/tech/admin/leads` | `AdminLeadCenter.jsx`, `admin-mobile/leads/LeadRow.jsx` | `get_inbound_leads`, `update_lead_status`; `/api/callrail-recording?lead_id=` → service-role lead/credential read → CallRail stream | `RPC`; recording Worker currently resolves any employee but lacks admin/capability/object authorization |
| unmatched `/tech/admin/*` | `AdminMobileRoutes.jsx` | redirect to `/tech/admin/dash` | UI routing only |

`NativeRoutes` currently mounts the same `TechRoutes`, including `/tech/admin/*`; the desired
field-only native promise is therefore not enforced in source.

## Shared/non-route callers that constrain containment

Mobile-only edits cannot break these deployed/shared paths:

- desktop `InvoiceEditor.jsx`, `EstimateEditor.jsx`, `ClaimBilling.jsx`, and
  `settings/Payments.jsx` call the same four QBO Workers;
- `settings/Integrations.jsx` calls `/api/quickbooks-connect` and
  `/api/qbo-sync-customer`;
- the QBO customer trigger/library and payment scheduler use the shared server secret;
- desktop `CrmCallLog.jsx` calls `/api/callrail-recording`;
- desktop `ClaimPage.jsx`, `JobPage.jsx`, `CustomerPage.jsx`,
  `settings/FeedbackInbox.jsx`, `FeedbackAttachments.jsx`, and invoice attachment flows consume or
  mutate `job-files`;
- e-sign, Google Drive import, Xactimate analysis, water-loss report, demo-sheet PDF, feedback purge,
  and message-media signing consume or write the same bucket.

### Complete current `job-files` inventory

Browser writers:

- `TechAppointment.jsx`, `TechJobDetail.jsx`, `TechClaimDetail.jsx`, `TechClaimAlbum.jsx`,
  `TechJobAlbum.jsx`, `TechRoomDetail.jsx`, `v2/hub/HubDock.jsx`,
  `v2/dash/PhotoCaptureButton.jsx`, and `hooks/usePhotoUpload.js`;
- offline replay in `lib/dispatchers/photoDispatcher.js`;
- `InvoiceEditor.jsx`, `JobPage.jsx`, `FeedbackAttachments.jsx`, and
  `settings/FeedbackInbox.jsx`.

Worker/service consumers or writers:

- `google-drive-import.js`, `analyze-xactimate.js`, `generate-water-loss-report.js`,
  `submit-esign.js`, `demo-sheet-pdf.js`, `purge-feedback-media.js`, and
  `functions/lib/message-media.js`.

Public URL/render consumers:

- `usePhotoUpload.js`, `TechAppointment.jsx`, `TechRoomDetail.jsx`,
  `TechJobDocuments.jsx`, `ClaimPage.jsx`, `JobPage.jsx`, `CustomerPage.jsx`,
  `FeedbackAttachments.jsx`, `FeedbackInbox.jsx`, `GenerateReportButton.jsx`, `RoomCard.jsx`,
  `PhotoNoteSheet.jsx`, `techDateUtils.js`, `components/conversations/messageUtils.js`, and
  `functions/lib/message-media.js`.

Stored paths exist in both `job-files/{path}` and bucketless forms. Existing normalization must be
preserved through a signed/private transition.

## MOB-SEC-014 Worker state

### Implemented local slice (`QBO-4`)

`functions/lib/qbo-auth.js` is now used before privileged work by:

- `POST /api/qbo-invoice`;
- `POST /api/qbo-estimate`;
- `POST /api/qbo-payment`;
- `POST /api/qbo-query`.

Accepted identities:

1. an exact configured `x-webhook-secret`, preserving the existing server capability; or
2. a valid Supabase Bearer session resolving to an active, non-external employee with
   `role='admin'`.

The repository's real role is `project_manager`, not `manager`. The historical
`['admin','manager']` predicate was therefore admin-effective. Expanding billing authority to
`project_manager` is an owner decision, not an R0 assumption.

The exact secret path has no checked-in caller for these four routes and remains an unproven legacy
server capability with broad QBO authority. Its value was not read. Retirement/rotation cannot be
isolated from QBO customer/payment schedulers.

### Open Worker residuals

| Path | Current browser/server caller | Current problem |
|---|---|---|
| `/api/qbo-sync-customer` | Settings integration actions; QBO customer helper/trigger | valid Bearer is sufficient; service role can create/link customers and write contacts |
| `/api/qbo-payments-sync` | scheduler/manual trigger contract | valid Bearer is sufficient; service role can import payment records |
| `/api/quickbooks-connect` | Settings integration connection | valid Bearer can replace OAuth state/initiate reconnection |
| `/api/qbo-charge` | shared billing path | role-gated, but external admins are not rejected |
| `/api/qbo-attach` | invoice/estimate attachment UI | role-gated, but external admins are not rejected |
| `/api/callrail-recording` | mobile LeadRow and desktop CRM call log | any resolved employee can request an arbitrary lead ID; no admin/capability/object check |
| HTTP `/api/notify` | direct Bearer client capability plus distinct secret/in-process callers | valid session can submit arbitrary supported type/body before privileged dispatch |

The QBO actor is resolved by the new gate but is not yet persisted on every provider action, leaving
an auditability gap. Preview/Production presence of `SUPABASE_ANON_KEY` or
`VITE_SUPABASE_ANON_KEY` is also unverified; missing configuration fails closed locally.

## Owner decisions still required

No row below was decided by this source-work session.

| Decision | R0 recommendation | Evidence/acceptance needed |
|---|---|---|
| PWA cold offline | Keep unsupported; promise online-first plus explicitly tested warm continuity | owner-approved workflow matrix, private-data threat model, cold/warm/update/reset device proof and truthful UX/release copy |
| Capacitor route scope | Field routes only, using an explicit allowlist | exact allowed route list and native direct/deep-link denial tests |
| Admin-mobile native inclusion | Exclude from the first native pilot | owner approval plus source enforcement; current `NativeRoutes` still mounts `/tech/admin/*` |
| Push | Keep native APNs disabled; decide separately whether owner-gated Web Push is inside the pilot promise | subscription/account-switch/logout/tap/privacy proof on named devices; APNs entitlement/provider/permission lifecycle separately |
| OTA | Keep production OTA disabled | channel owner, binary/plugin/database compatibility manifest, signed-device bad-bundle rollback and minimum-version policy |
| Account deletion | Keep request UI truthful but do not claim fulfillment | decide integrate/replace/disable; named fulfiller, SLA, retention/anonymization, Auth/session revocation, audit and completion notice |
| Pilot support | Require desktop fallback and a small named device/user cohort | support owner/on-call hours, escalation path, stop criteria, rollback owner, incident/data-loss procedure |
| Billing role | Preserve internal admin-only authority for now | decide whether `project_manager` gains QBO authority; coordinate UI, Worker, RLS and positive/negative tests |
| QBO server capability | Preserve only for compatibility until verified | read-only binding/caller/equality inventory, owner retirement/rotation decision and coordinated scheduler cutover |

## Smallest contract-preserving containment slices

1. **S1a — four legacy QBO Workers (implemented locally).** Central active/internal-admin gate,
   preserve secret-first compatibility and response bodies, add provider-never-called failures.
2. **S1b — remaining QBO identity surface.** Gate customer sync, payment sync and OAuth connect;
   reconcile external-account behavior on charge/attach; decide actor audit and server-capability
   lifecycle. Keep scheduler and browser identities separate.
3. **S1c — CallRail recording.** Require active internal admin or an explicit lead-recording
   capability and bind `lead_id` to the authorized scope before credential/provider access.
4. **S1d — notify HTTP entry.** Separate human and non-human caller contracts; allowlist event types,
   recipient derivation, body fields and links; preserve in-process and signed automation callers.
5. **S1e-1 — shared identity and device ownership.** Preserve flag/page-access/preference/token
   signatures and shapes, but reconstruct the employee from `auth.uid()` inside the trusted
   boundary; decide whether flags remain intentionally public; prevent cross-employee preference,
   page-access and device-token access.
6. **S1e-2 — notifications and destructive merge.** Bind bell reads/marks to the session employee
   (model broadcast read state separately if needed); require the approved active/internal role
   before `merge_claims`/`merge_jobs` and verify every supplied object before mutation.
7. **S1e-3 — route-family RPC/direct-table containment.** Review one route/domain family at a time.
   Prefer invoker functions or explicit actor reconstruction; revoke unnecessary ACLs; replace
   unconditional RLS with role/assignment/object policies while preserving signatures/return
   shapes. Treat the current `messages` predicate as a scoped pattern to preserve, not as proof
   that adjacent messaging tables are safe.
8. **S2a — media delivery compatibility.** Centralize both stored path forms and replace public URL
   construction with an authorized delivery helper supporting dual-read.
9. **S2b — private Storage boundary.** After compatibility code is deployed and observed, apply
   path/object-scoped policies, MIME/type rules and the private bucket flip in a serialized window.

## Negative and failure-path matrix

### Implemented S1a

For each of the four QBO Workers, local tests require:

- missing/expired token → exact `401 {"error":"Unauthorized"}`;
- absent auth configuration, Auth outage and employee lookup failure → sanitized fail-closed
  `500/502`;
- missing employee, inactive employee, external admin, `office`, `supervisor`, `field_tech`,
  `project_manager` and `crm_partner` → `403 {"error":"Forbidden"}`;
- active internal admin → unchanged downstream disconnected contract;
- exact server secret → existing no-Bearer path preserved;
- invalid secret plus valid admin Bearer → Bearer fallback preserved;
- valid secret plus expired Bearer → secret-first behavior preserved;
- valid identity plus malformed JSON → unchanged route-specific `400`;
- all denied paths → no connection/domain/telemetry/provider helper call.

### Required before later containment/live apply

| Boundary | Positive cases | Negative/failure cases |
|---|---|---|
| remaining QBO Workers | exact scheduler capability; active internal approved human role | missing/wrong/expired secret; replay where relevant; inactive/external/wrong role; OAuth state mismatch; provider/config/timeout/partial-write failure |
| CallRail recording | approved role/capability and authorized lead | no employee, inactive/external/wrong role, unrelated/missing lead, bad provider URL, credential missing, timeout/range/stream failure |
| notify HTTP | allowed event and server-derived audience | unsupported type, forged recipient/body/link, wrong role, inactive/external user, missing secret/config, downstream partial fan-out |
| shared identity/device RPCs | own employee profile/page-access/preferences/token; intentionally public flags only if owner-approved | anonymous page-access enumeration, another employee ID, inactive/external identity, token reassignment, account switch/logout, missing Auth mapping |
| bell RPCs/Realtime | own recipient plus deliberate broadcast semantics | another employee/notification ID, forged mark-all, inactive/external identity, Realtime payload for another recipient, reconnect/dedup failure |
| destructive merge RPCs | active internal approved role and two authorized objects | anonymous/wrong/inactive/external role, unrelated object IDs, same/missing ID, financial conflict, partial multi-table failure, direct RPC bypassing UI |
| RPC/RLS | each approved role within assigned/object scope | anonymous, wrong role, unrelated job/claim/contact/appointment, forged employee/actor parameter, inactive/external identity, malformed/missing object |
| `job-files` | approved uploader/reader for assigned object and both legacy path forms | anonymous list/read, unrelated employee read/write/delete, cross-job path, path traversal, wrong MIME/oversize, metadata failure, orphan, signed URL expiry/replay |
| rollout | compatible old/new web clients and expected service caller | missing runtime binding, stale client, provider outage, failed deploy/apply, forward-fix and emergency rollback rehearsal |

## Rollout, rollback and separate live-apply plan

Nothing below is authorized by this R0 task.

### Code-only S1a rollout

1. Review/merge the source commits through the normal `dev` release path.
2. Read-only verify required Supabase Auth key binding names in Preview and Production without
   reading values.
3. Deploy only with separate authorization.
4. Smoke an approved internal admin and representative denied identities against synthetic/non-
   customer inputs; verify 401/403/409/error metrics and no provider call on denial.
5. Prefer a forward fix. Reverting the source gate deliberately restores the bearer bypass and is
   an emergency security rollback only.

Secret rotation is not a code rollback: the same capability is used by customer/payment automation
and must be coordinated across all callers.

### Database/Storage apply

1. Produce reviewed, additive/contract-preserving migrations from a commit reachable from the
   designated release branch. Keep each RPC/table/Storage domain independently revertible.
2. Within six hours of the window, recapture migration ledger, exact signatures/bodies/ACLs,
   policies/grants, bucket metadata and aggregate object counts read-only.
3. Deploy and observe dual-path media delivery before any private flip. Preserve both stored path
   forms and old-client response shapes.
4. During a separately owner-authorized serialized low-traffic window, apply exact grants/policies,
   then the bucket setting only after compatible delivery is present.
5. Verify direct anonymous/unrelated denials and intended allow cases with dedicated synthetic test
   identities; never inspect customer object contents.
6. Verify MIME/size/path behavior, signed URL expiry, metadata reconciliation and old/new client
   compatibility. Capture advisors/provenance and deployed commit.
7. Stop and forward-fix on any unexpected widening or compatibility failure.

Rollback SQL must restore the exact pre-apply grants/policies/function bodies and bucket setting
captured for that window. Reopening public/broad access is an emergency privacy rollback, not an
ordinary success path. Media compatibility code and dual-form normalization should remain deployed
until all old clients and object references are retired.

## Verification and limitations

Completed locally:

- foundation baseline: 3 Worker files / 34 tests passed;
- final focused authorization matrix: 4 files / 110 tests passed;
- independent security review: 3 files / 85 tests passed;
- independent contract review: 4 files / 110 tests passed;
- full Worker lane: 92 files / 1,230 tests passed, zero unexpected skips;
- full credential-free test command: 159 files / 2,020 tests passed, zero unexpected skips;
- web production build: passed, 665 modules transformed;
- native-target Vite build: passed, 665 modules transformed; no Capacitor sync or Xcode build;
- changed-file ESLint across the seven changed Worker/helper/test files: passed;
- full repository lint: failed at the known broad baseline with 327 findings (208 errors,
  119 warnings); none was in a changed file;
- tooling governance: 0 errors and two temporary-waiver warnings; adapter check passed;
- tooling tests: 12/12 passed;
- mobile preflight: 0 errors and two warnings (local Node v26.5.0 versus CI Node 22; optional GitHub
  delivery unavailable);
- provenance fixtures: 13/13 passed;
- release provenance validation: failed only because the separate migration-provenance evidence is
  outside its six-hour release window; four documented comment/whitespace drift warnings were also
  emitted. No migration changed in R0, and release-time recapture remains required;
- foundation-to-HEAD `git diff --check`: passed after close-out normalization.

No live write, provider call, message, push, money movement, customer-object access, development
server, browser, simulator or Xcode build occurred. The mobile preflight did invoke only its
five-minute-bounded `xcodebuild -version` probe; it completed with Xcode 26.6. A subsequent
read-only `pgrep -x xcodebuild` returned exit 1 with no matching process. No persistent child tree
or port was started.

Unavailable external evidence remains:

- representative authenticated employee identities for every allow/deny role;
- Cloudflare deployed versions and Preview/Production binding presence;
- provider-console/credential state and provider sandboxes;
- physical iOS/Android devices, installed PWA lifecycle, camera/location/background behavior;
- Apple enrollment, signing identities, entitlements, signed archives, TestFlight and App Store
  Connect;
- native APNs, production Web Push tap proof, Capgo channel/rollback;
- owner-approved product, compliance, support and pilot decisions.
