# UPR Mobile PWA and Capacitor Audit — Screen and Workflow Ledger

**Legend:** `Ready` means source-complete and supported by proportionate automated/runtime evidence.
`Conditional` means usable only under stated online/role/feature constraints. `Blocked` means a P0/P1
finding prevents production reliance. This is an audit judgment, not a claim that every listed screen
is broken.

## Entry and shell workflows

| Screen/workflow | Route | Main files | Data contract | Authorization | Implemented states | Missing/unverified states | Mobile UX | Readiness | Findings |
|---|---|---|---|---|---|---|---|---|---|
| Login/session bootstrap | `/login` | `Login.jsx`, `AuthContext.jsx`, `realtime.js` | Supabase Auth; `employees`, permissions, flags | Auth session mapped to employee | loading, auth error, no employee | secure native token storage; device/session switch proof | coherent | Blocked for native primary use | MOB-STATE-001, MOB-SEC-016 |
| Password recovery | `/set-password` | `SetPassword.jsx`, `AuthContext.jsx` | Supabase recovery session | recovery token | recovery redirect, save/error | native deep-link round trip | shared web UI | Conditional | MOB-NATIVE-022 |
| Public signing | `/sign/:token` | `SignPage.jsx`, `submit-esign.js` | signing RPCs + worker + Storage | bearer token in URL; worker validation | load, expired/error, sign/submit | native universal-link routing; end-to-end device proof | shared web UI | Conditional | MOB-NATIVE-022 |
| Mobile shell/navigation | `/tech/*` | `TechLayout.jsx`, `RouteRestorer.jsx`, v2 nav | tasks poll; local route state | authenticated employee; UI flags | five tabs, outlet, resume, offline pill | account-switch reset; full back/minimize/device proof | strong persistent shell | Blocked | MOB-STATE-001, MOB-PERF-007 |

## Field screens

| Screen/workflow | Route | Main files | Data contracts | Authorization | Implemented states | Missing/unverified states | Mobile UX status | Production status | Related findings |
|---|---|---|---|---|---|---|---|---|---|
| Technician dashboard | `/tech` | `v2/TechDashV2.jsx`, `v2/dash/*` | `get_tech_dashboard`, `get_active_appointment_geo`, clock RPCs | employee ID passed by client; DB contract authoritative | skeleton, ready, attention, empty sections, clock actions | safe flag-off fallback; hidden-pane/poll profiling | purpose-built | Blocked | MOB-ROLLOUT-004, MOB-ROLLOUT-005, MOB-PERF-007, MOB-SEC-014 |
| Schedule/agenda | `/tech/schedule` | `v2/TechScheduleV2.jsx`, `v2/schedule/*` | `get_appointments_range` | authenticated; employee filtering at caller/contract | loading, agenda/day, filters, create | safe flag-off fallback; pagination/large-data proof; real timezone/device proof | purpose-built | Blocked | MOB-ROLLOUT-004, MOB-DATA-033 |
| Assigned tasks | `/tech/tasks` | `TechTasks.jsx` | `get_assigned_tasks`, `toggle_appointment_task` | client supplies employee ID | loading, empty, complete/error toast | idempotent retry; cross-account cache proof | usable legacy mobile | Blocked for offline retry | MOB-DATA-013, MOB-SEC-014 |
| Claims list | `/tech/claims` | `TechClaims.jsx` | `get_tech_claims`, `get_claims_list` | UI scope/role; privileged RPCs | loading, search, empty, error | server-enforced scope; pagination | usable | Blocked | MOB-SEC-014, MOB-DATA-033 |
| Claim detail | `/tech/claims/:claimId` | `TechClaimDetail.jsx` | claim/appointment/room/demo/task RPCs; documents; claim update | UI controls plus broad DB contracts | loading, sections, media, create room, status update | assignment enforcement; atomic media; safe large claims | feature-rich, mixed legacy styles | Blocked | MOB-SEC-014, MOB-SEC-015, MOB-DATA-012 |
| Claim album | `/tech/claims/:claimId/photos` | `TechClaimAlbum.jsx` | claim detail, `job_documents`, Storage, `insert_job_document` | authenticated bucket/table access | loading, empty, upload, error | private URLs; idempotent/atomic upload; offline truth | dedicated gallery | Blocked | MOB-SEC-015, MOB-DATA-012 |
| Claim room | `/tech/claims/:claimId/rooms/:roomId` | `TechRoomDetail.jsx` | claim/room RPCs, Storage, documents | authenticated; job/claim scope depends on DB | loading, readings/photos, upload | assignment enforcement; deterministic retry | field-oriented | Blocked | MOB-SEC-014, MOB-SEC-015, MOB-DATA-012 |
| Legacy job detail | `/tech/jobs/:jobId` | `TechJobDetail.jsx` | jobs, contacts, claims, documents, signing, Storage | UI role for admin actions; broad DB contracts | loading, documents, WA warning, edits | parity/cutover plan; private media; server auth | usable but duplicated | Blocked | MOB-SEC-014, MOB-SEC-015, MOB-UX-031 |
| v2 job hub | `/tech/job/:jobId` | `v2/TechJobHub.jsx`, `v2/hub/*` | `get_job_hub`, appointment, rooms, readings, equipment, documents, clocks | feature flag + UI role; DB contract authoritative | skeleton, hub sections, tools, photos, admin menu | fail-closed flag behavior; server role/assignment; complete offline contract | strongest mobile workflow | Blocked | MOB-ROLLOUT-005, MOB-SEC-014, MOB-DATA-012, MOB-DATA-013 |
| Job album | `/tech/jobs/:jobId/photos` | `TechJobAlbum.jsx` | jobs, `job_documents`, Storage | authenticated bucket/table access | loading, empty, upload | private media; idempotency; pagination | dedicated gallery | Blocked | MOB-SEC-015, MOB-DATA-012 |
| Job documents/e-sign | `/tech/jobs/:jobId/documents` | `TechJobDocuments.jsx`, `EsignRequestSheet.jsx` | jobs, contacts, sign requests, e-sign workers, public Storage URLs | authenticated UI; tokenized public signing | loading, grouped statuses, send/cancel/open | private file delivery; native deep link; provider/device E2E | capable | Blocked | MOB-SEC-015, MOB-NATIVE-022 |
| Appointment execution | `/tech/appointment/:id` | `TechAppointment.jsx`, field sheets | appointment/tasks, documents, rooms/readings/equipment, Storage | authenticated; IDs passed to RPCs | loading, task toggle, photos, rooms, tools, errors | queue recovery/idempotency; role/assignment enforcement | broad field surface | Blocked | MOB-DATA-002, MOB-DATA-012, MOB-DATA-013, MOB-SEC-014 |
| Edit appointment | `/tech/appointment/:id/edit` | `TechEditAppointment.jsx` | appointments, crew, tasks, update/delete RPCs | UI access; DB/RPC contract authoritative | loading, conflicts, save, delete, task edits | atomic multi-write rollback; server role/assignment | usable | Blocked | MOB-SEC-014, MOB-REL-034 |
| New customer | `/tech/new-customer` | `TechNewCustomer.jsx` | direct `contacts` insert/search | any non-partner authenticated session under broad policy | validation, duplicate lookup, save/error | server permission; idempotency; offline draft | focused form | Blocked | MOB-SEC-014, MOB-REL-034 |
| New job | `/tech/new-job` | `TechNewJob.jsx` | contacts, carriers, `create_job_with_contact`, Houzz worker follow-up | UI availability; DB/worker enforcement varies | search/create customer, form validation, success/error | idempotent composite creation; follow-up reconciliation | capable, long form | Blocked | MOB-SEC-014, MOB-REL-034 |
| New appointment | `/tech/new-appointment` | `TechNewAppointment.jsx` | jobs, employees, appointments, crew, task RPCs | authenticated; broad table contracts | job search, tasks, crew, validation, save | transaction/rollback across three writes; idempotency | capable, long form | Blocked | MOB-REL-034, MOB-SEC-014 |
| New event | `/tech/new-event` | `TechNewEvent.jsx` | appointments, crew | authenticated; broad policies | validation, private/team event, save | atomic crew assignment; authorization | straightforward | Blocked | MOB-REL-034, MOB-SEC-014 |
| Conversations/messages | `/tech/conversations` | `v2/TechMessagesV2.jsx`, `v2/messages/*` | conversation/message tables, realtime, `/api/send-message`, consent/DND | session; worker is governed send boundary | list/thread loading, empty/error, drafts, attachments, templates, consent | push/logout detach; private media completion; provider/device E2E | strong v2 pane | Conditional for in-app sends; shortcuts blocked | MOB-COMP-003, MOB-PUSH-017, MOB-SEC-015 |
| Feedback | `/tech/feedback` | `TechFeedback.jsx` | feedback RPC/worker and `job-files` prefix | authenticated employee | compose, attachment upload, retry/error | private attachment access; retention/device proof | usable | Blocked for sensitive media | MOB-SEC-015 |
| More hub | `/tech/more` | `TechMore.jsx` | assigned-task count, local settings | authenticated | navigation cards, counts | feature/status consistency | coherent | Conditional | MOB-UX-008 |
| Mobile settings | `/tech/settings` | `TechSettings.jsx`, `components/tech/settings/*` | local appearance/language; push APIs/RPCs | authenticated employee | sections, push enable/disable, biometric preference | account deletion path; secure token storage; logout push detach | coherent | Blocked for native release | MOB-SEC-016, MOB-PUSH-017, MOB-NATIVE-036 |
| Help | `/tech/help` | `TechHelp.jsx`, `techHelpContent.jsx` | static/local | authenticated | content and navigation | content ownership/freshness runtime review | usable | Conditional | — |
| OOP pricing | `/tech/tools/oop-pricing` | `TechOOPPricing.jsx` | quote/job/claim RPCs | route visibility; DB contract authoritative | job/quote load, edit, delete, validation | server role scope; offline/draft preservation | dense but purpose-built | Blocked | MOB-SEC-014, MOB-REL-034 |
| Demo/scope sheet | `/tech/tools/demo-sheet` | `TechDemoSheet.jsx` | schema/sheet RPCs, PDF/email workers, local drafts | authenticated; server contracts vary | autosave draft, edit, submit, PDF/email result handling | navigation discoverability; account-namespaced draft; provider E2E | substantial implementation | Conditional | MOB-UX-008, MOB-STATE-001 |
| Admin dashboard | `/tech/admin`, `/tech/admin/dash` | `admin/AdminDash.jsx`, `admin-mobile/dash/*` | revenue/payment/A/R/operations/work RPCs | React admin+flag guard; RPC/worker enforcement authoritative | per-card loading, error/retry, empty, period switch | server-side financial role; growth/device proof | coherent card dashboard | Blocked | MOB-ARCH-006, MOB-SEC-014, MOB-DATA-033 |
| Collections | `/tech/admin/collections` | `admin/AdminCollections.jsx`, `admin-mobile/collections/*` | invoices, estimates, payments and A/R RPCs | React admin+flag guard; broad contracts | tabs, loading, empty, retry | cursor pagination; financial role/assignment | purpose-built | Blocked | MOB-SEC-014, MOB-DATA-033 |
| Invoice/payment/QBO actions | `/tech/admin/invoice/:invoiceId` | `admin/AdminInvoiceDetail.jsx`, `PaymentSheet.jsx`, `recordPayment.js`, QBO workers | invoices, line items, payments, QBO create/update/delete/email | React admin guard; QBO workers accept any valid bearer in source | loading, payment validation, busy/error, QBO actions | trusted-worker admin enforcement; idempotency/partial-provider recovery | capable but high impact | Blocked | MOB-SEC-014, MOB-REL-034 |
| Estimate create/edit | `/tech/admin/estimate/new`, `/tech/admin/estimate/:estimateId/edit` | `admin/AdminEstimateEditor.jsx`, `admin-mobile/estimate/*` | estimates/line items direct writes, create/search/carrier RPCs, QBO worker | React admin+flag guard; server contracts vary | load, create/edit lines, validation, save/error | transactional edits; trusted-worker role; provider retry | substantial editor | Blocked | MOB-SEC-014, MOB-REL-034 |
| Estimate detail/conversion | `/tech/admin/estimate/:estimateId` | `admin/AdminEstimateDetail.jsx` | estimate detail, `convert_estimate_to_invoice`, QBO/email actions | React admin+flag guard; no extra financial gate | load, detail, convert/force path, error | role/object enforcement; idempotent conversion/provider result | focused detail | Blocked | MOB-SEC-014, MOB-REL-034 |
| Lead center/call recording | `/tech/admin/leads` | `admin/AdminLeadCenter.jsx`, `admin-mobile/leads/*`, `callrail-recording.js` | inbound leads/status RPC; service-role recording proxy | React admin+flag guard; recording worker resolves any employee only | loading, filters/status, transcript/recording errors | server admin/lead permission; recording privacy/device proof | useful operational surface | Blocked | MOB-SEC-014 |
| Admin unknown-route recovery | `/tech/admin/*` unmatched | `admin/AdminMobileRoutes.jsx` | none | inside React admin+flag guard | replace redirect to dashboard | hardware/edge-back proof | predictable source behavior | Conditional | MOB-NAV-032 |

## Cross-workflow observations

### Loading, empty, error, and success

Most major screens implement at least loading and ready states, and many include empty/error feedback.
The strongest v2 screens use shared skeletons and query-state patterns. Legacy pages frequently use
local spinners, inline styles, swallowed fallback errors, or optimistic local updates with differing
rollback rules. A generic `PageLoader` still exposes a bare “Loading…” experience in some paths.

### Onboarding, permission, offline, and update states

- **Onboarding:** no field onboarding/provisioning tour or first-run capability/permission education
  is present; the native tree begins at login and relies on centrally provisioned employees.
- **Permission denied:** protected/feature/admin guards redirect or hide routes; there is no consistent
  dedicated explanation/recovery state for revoked role, missing employee, native permission denial,
  or direct-link authorization failure.
- **Offline:** the shell exposes an offline/sync pill and selected queued operations expose counts or
  errors. Most screens have no explicit offline state and may show stale data, a generic request
  error, or an empty fallback.
- **Update available:** stale-chunk reset and automatic recovery exist, but there is no canonical
  “update ready / restart now / defer safely” state or release/version display for PWA/Capgo users.
- **Empty/loading/error:** v2 screens have the strongest shared primitives; legacy and admin screens
  still vary, and swallowed sub-request errors can look like legitimate emptiness.

### Back, minimize, and resume

The shell has explicit persistent tabs and installed-mode route restoration, and v2 link helpers
centralize some job/appointment destinations. Complete proof is missing for:

- iOS edge-swipe and Android system-back behavior across sheets and nested routes;
- keyboard-open back behavior in the message composer and long forms;
- native deep links, public signing, and notification-tap routing;
- background termination during offline sync or unsaved form entry;
- account switch while restored routes/caches/drafts exist.

### Data loss, duplication, and false success

The highest-risk workflows are not simple screen rendering:

- Storage upload followed by metadata RPC is non-atomic and retry paths are not deterministic.
- Queue rows can strand in `syncing`, cross user boundaries, or execute more than once.
- appointment/event creation spans multiple direct writes without a transaction/idempotency contract.
- some secondary calls are intentionally swallowed or converted to empty arrays, making “no data” and
  “failed to load” indistinguishable.
- if the user completes a send in the device composer opened by a direct `sms:` link, the message
  bypasses UPR consent/audit controls.

## Ledger conclusion

UPR has broad workflow coverage and several polished field-specific surfaces. The screen inventory
does not support expanded reliance today because the most important gaps occur below and around the
screens: authorization, media privacy, per-user persistent state, mutation guarantees, lifecycle
recovery, and real-device/release evidence.
