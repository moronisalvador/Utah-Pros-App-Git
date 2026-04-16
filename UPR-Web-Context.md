# UPR Web Platform — Context Document
Last updated: March 28, 2026

## Project Overview
Internal business management platform for Utah Pros Restoration (UPR).
Owner/developer: Moroni Salvador.

**Live URL:** https://dev.utahpros.app (dev branch) | https://utahpros.app (main)
**GitHub repo:** moronisalvador/Utah-Pros-App-Git
**Local repo:** F:\APPS\RestorationAPP\Utah-Pros-App-Git
**Deployment:** Cloudflare Pages (auto-deploys on push to `dev` branch)
**Rule:** Always work on `dev` branch. Merge to `main` only after testing.

---

## Stack
- **Frontend:** React 19 + Vite
- **Database:** Supabase (PostgreSQL + PostgREST REST API — NO Supabase JS SDK)
- **Auth:** Supabase Auth via `@supabase/supabase-js` realtime client
- **Workers:** Cloudflare Pages Functions (`functions/api/`)
- **Email:** SendGrid v3 API
- **SMS:** Twilio (pending go-live — ID verification blocked)
- **Storage:** Supabase Storage (`job-files` bucket, `message-attachments` bucket)

**Supabase project ID:** glsmljpabrwonfiltiqm (us-east-2)
**Cloudflare account ID:** d686ab40c1b3ec7eac2a43df91d4ef3a

---

## Critical Coding Rules
1. Always read files from disk before editing — never rely on memory for current code state
2. Use `write_file` for full rewrites — `edit_file` fails silently on Windows CRLF files
3. Never use `alert()` or `confirm()` — always use `window.dispatchEvent(new CustomEvent('upr:toast', ...))`
4. Always use `const { db } = useAuth()` — never import `db` directly in components
5. Work on `dev` branch only — never touch `main`
6. All CSS changes must use `@media (max-width: 768px)` unless provably safe on desktop (dvh, env(safe-area-inset-bottom)) — never change desktop UI/layout/colors/spacing
7. Commit and deploy after every 2–3 files — test on real iPhone before continuing

---

## File Structure

```
src/
  App.jsx                        — Router, ProtectedRoute, AdminRoute, FeatureRoute, DevRoute wiring
  main.jsx                       — Entry point
  index.css                      — All global styles + CSS variables
  contexts/
    AuthContext.jsx               — Auth state, db client, login/logout/devLogin,
                                   featureFlags map, isFeatureEnabled(), canAccess()
  lib/
    supabase.js                   — REST client (baseUrl, apiKey, select/insert/update/delete/rpc)
    realtime.js                   — Supabase realtime + auth client
    api.js                        — Misc API helpers
  pages/
    Login.jsx                     — Email/password login + forgot password + dev mode selector
    SetPassword.jsx               — Password reset flow (recovery link handler)
    Dashboard.jsx                 — Stats + recent jobs, click-through to job detail
    Jobs.jsx                      — Job list: division tabs, sort, search, detail panel
    JobPage.jsx                   — Full job detail: Overview/Schedule/Files/Financial/Activity tabs
    Production.jsx                — Kanban pipeline (30 phases, 4 macro groups) + list view
    Leads.jsx                     — Jobs in lead phase (feature-flagged: page:leads)
    Collections.jsx               — Collections page (feature-flagged: page:collections)
    ClaimsList.jsx                — List of all claims
    ClaimPage.jsx                 — Full claim detail page
    ClaimPage_header.jsx          — Claim page header component (partial/patch file)
    Customers.jsx                 — Contact list, claims-grouped detail panel
    ContactProfile.jsx            — Individual contact detail
    CustomerPage.jsx              — Customer detail page
    Conversations.jsx             — SMS/MMS messaging (GHL-style, TCPA compliant)
    Schedule.jsx                  — Calendar dispatch board (Day/3Day/Week/Month)
    ScheduleTemplates.jsx         — Schedule template management
    TimeTracking.jsx              — Employee time tracking (feature-flagged: page:time_tracking). Tabs: Status Board (admin/PM/supervisor only, default for those roles) | Timesheet | By Job | Payroll. Status Board renders src/components/StatusBoard.jsx and polls get_tech_status_board() every 30s.
    Marketing.jsx                 — Marketing tools (feature-flagged: page:marketing)
    EncircleImport.jsx            — Selective Encircle claim import with division selection (feature-flagged: page:encircle_import, route: /import/encircle)
    Admin.jsx                     — Employee management + roles/permissions matrix + page access overrides
    Settings.jsx                  — Document template editor + lookup tables (carriers, referral sources)
    SignPage.jsx                  — Public esign page (no auth) — type or draw signature
    CreateJob.jsx                 — Full-page job creation flow
  pages/tech/
    TechDash.jsx                  — Field tech dashboard: sticky greeting (doesn't scroll on pull-to-refresh), active cards with client name + task progress bar + Photo/Notes/Clock In, timeline future rows, compact completed rows, upcoming 7-day preview when 0 appointments today, snap-first photo flow (auto-upload, optional caption via toast)
    TechSchedule.jsx              — Field tech 14-day schedule: type icons, jump-to-today FAB
    TechTasks.jsx                 — Field tech tasks: swipe-to-complete, collapsible job groups
    TechClaims.jsx                — Field tech claims: 200ms debounced instant search
    TechAppointment.jsx           — Appointment detail: slide-in animation, collapsing hero, photo lightbox
  components/
    TechLayout.jsx                — Field tech app shell: blur nav, active pill indicator, task badge dot
    tech/TimeTracker.jsx          — Static three-station row (OMW · Start · Finish) with timestamps under each. No live ticking. Between-step durations ("Travel: 23m", "On job: 4h") shown only after the right side of the interval is reached. Past stations greyed + non-tappable for techs (admin/PM edits via desktop). Pause is a secondary control; preserves original Start timestamp on Resume. Supports multi-visit via "Return to Job" flow.
    Layout.jsx                    — App shell: sidebar, bottom bar, toasts, offline banner
    Sidebar.jsx                   — Desktop nav + sign out button
    AddContactModal.jsx           — Add contact modal (9 roles) + LookupSelect component
    AddRelatedJobModal.jsx        — Add sibling job under same claim
    CalendarView.jsx              — Calendar rendering for Schedule page
    CarrierSelect.jsx             — Searchable insurance carrier combobox with OOP sentinel
    CreateAppointmentModal.jsx    — Create appointment on schedule
    CreateCustomerModal.jsx       — Create customer modal
    CreateJobModal.jsx            — Inline job creation modal
    CreateMenu.jsx                — FAB / quick create menu
    DatePicker.jsx                — Custom date picker
    DivisionIcons.jsx             — SVG division icons (water/mold/recon/fire/contents)
    EditAppointmentModal.jsx      — Edit existing appointment
    EditContactModal.jsx          — Edit contact details
    EmptyState.jsx                — Reusable empty state component
    ErrorBoundary.jsx             — React error boundary
    Icons.jsx                     — SVG icon components
    JobDetailPanel.jsx            — Job detail slide-out panel
    JobPanel.jsx                  — Job panel component
    ProtectedRoute.jsx            — Auth guard wrapper
    PullToRefresh.jsx             — Mobile pull-to-refresh
    ScheduleWizard.jsx            — Generate schedule from template
    MergeModal.jsx                — Shared merge UI for contacts, claims, jobs (search + compare + two-click confirm)
    SendEsignModal.jsx            — Send/collect esign request modal
    Sidebar.jsx                   — Sidebar navigation

functions/
  api/
    admin-users.js                — POST/PATCH/PUT/DELETE employee + auth management
    process-scheduled.js          — Cron: process scheduled SMS messages (60s)
    resend-esign.js               — Resend esign email for existing pending request
    send-esign.js                 — Create sign request + send email via SendGrid
    send-message.js               — Outbound SMS with TCPA compliance + DND guard
    submit-esign.js               — Process signature, generate PDF, upload to storage
    encircle-import.js            — Search/get/patch/import Encircle claims (manual selective import)
    sync-encircle.js              — Pull Encircle claims → jobs + contacts (bulk, legacy)
    track-open.js                 — Email open tracking pixel
    twilio-status.js              — Delivery receipts + RCS read status
    twilio-webhook.js             — Inbound SMS handler
  lib/
    cors.js                       — CORS helpers + jsonResponse(data, status, request, env)
    supabase.js                   — Supabase REST helper for workers
    twilio.js                     — Twilio helpers
```

---

## Database — All Tables (69 total, as of Mar 27 2026)

### Core Business
```
jobs                    — 65 rows — Core job records
claims                  — 20 rows — Insurance claims (auto CLM-YYMM-XXX numbers)
contacts                — 18 rows — All contacts (homeowner/adjuster/vendor/sub/etc.)
contact_jobs            — Many-to-many contacts ↔ jobs (role + is_primary)
contact_addresses       — Multiple addresses per contact
contact_tags            — Tags on contacts
```

### Jobs & Phases
```
job_phases              — 30 rows — Phase definitions (4 macro groups)
job_phase_history       — Phase transition audit log
job_notes               — Internal job notes (column: body, not content)
job_documents           — Files attached to jobs (has appointment_id UUID nullable, description TEXT nullable — added Mar 28)
job_tasks               — Schedule tasks
job_schedule_phases     — Schedule phase groupings
job_schedules           — Job schedule records
job_assignments         — Job-to-employee assignments
job_checklists          — Checklist instances on jobs
job_costs               — Job cost line items
job_equipment           — Equipment on jobs
job_equipment_costs     — Equipment cost tracking
job_time_entries        — Time entries per job (has travel_minutes NUMERIC column — computed on clock-in from travel_start)
job_number_sequences    — Auto-increment job number tracking
active_jobs             — View: currently active jobs
```

### Scheduling & Appointments
```
appointments            — Calendar appointments
appointment_crew        — Crew assignments per appointment
appointment_dependencies — Appointment ordering dependencies
schedule_blocks         — Blocked time on schedule
schedule_templates      — 3 rows — Reusable schedule templates
template_phases         — Phases within a schedule template
template_tasks          — Tasks within a template phase
template_dependencies   — Task dependency chains
checklist_templates     — Reusable checklists
on_call_schedule        — On-call rotation
todays_schedule         — View: today's appointments
dispatch_board_jobs     — View: jobs for dispatch board
```

### Messaging & Conversations
```
conversations           — SMS conversation threads
messages                — Individual SMS/MMS messages
conversation_participants
conversation_reads      — Read receipts per participant
conversation_tags       — Tags on conversations
scheduled_messages      — Queued outbound messages
message_templates       — 10 rows — SMS templates
sms_consent_log         — TCPA opt-in/out audit log
campaigns               — SMS/marketing campaigns
campaign_recipients     — Recipients per campaign
notification_queue      — Queued notifications
```

### Documents & Esign
```
sign_requests           — Esign requests (token, status, open tracking)
document_templates      — 8 rows — (CoC×5 divisions, work_auth, direction_pay, change_order)
document_requests       — Document request records
forms                   — Form definitions
demo_sheets             — Demo sheet records
```

### Financial
```
invoices                — Invoice records
invoice_line_items      — Line items per invoice
invoice_adjustments     — Invoice adjustment audit log
payments                — Payment records
estimates               — Estimate records
vendor_invoices         — Vendor invoice tracking (also used by Netlify vendor app)
vendors                 — Vendor records
```

### Selections & Subs
```
selection_dispatches    — Material/finish selection dispatches
selection_responses     — Sub/vendor responses to selections
sub_confirmations       — Subcontractor job confirmations
```

### Admin & Config
```
employees               — 14 rows — Staff (6 auth-linked, 8 unlinked)
nav_permissions         — 66 rows — Role-based nav access
feature_flags           — 8 rows — Feature flag controls (has force_disabled BOOLEAN column — kills page for everyone including admins)
employee_page_access    — Per-employee page overrides (employee_id, nav_key, can_view, updated_by, updated_at)
automation_rules        — Workflow automation rules
insurance_carriers      — 29 rows — Carrier lookup table
referral_sources        — 49 rows — Referral source lookup table
```

### Logging & Monitoring
```
system_events           — Entity audit log (event_type, entity_type, entity_id, actor_id, job_id, payload)
worker_runs             — Worker execution log (worker_name, status, records_processed, error_message, started_at, completed_at)
escalation_log          — Escalation audit log
email_sync_log          — Email sync records (vendor invoice app)
```

---

## All RPCs (use `db.rpc()` — SECURITY DEFINER, bypasses PostgREST schema cache)

### Jobs & Claims
```
create_job_with_contact(...)    — Atomic job + contact creation
add_related_job(...)            — Sibling job under same claim
get_claim_jobs(p_claim_id)      — {claim, jobs[]}
get_claim_detail(p_claim_id)    — Full claim detail
get_claims_list(...)            — Paginated claims list
get_job_contacts(p_job_id)      — Contacts linked to a job
link_contact_to_job(...)        — Link contact with role
search_contacts_for_job(...)    — Typeahead contact search
sync_job_to_claim(...)          — Sync job fields to parent claim
get_ar_jobs(...)                — Accounts receivable jobs view
generate_job_number()           — Next job number
generate_claim_number()         — Next CLM-YYMM-XXX
log_phase_change(...)           — Write to job_phase_history
log_system_event(...)           — Write to system_events
insert_job_document(p_job_id, p_name, p_file_path, p_mime_type, p_category, p_uploaded_by, p_appointment_id DEFAULT NULL, p_description DEFAULT NULL) — Insert job_documents row with optional appointment link and description
```

### Contacts & Customers
```
get_customers_list(...)         — Nested claims → jobs view
get_customer_detail(p_id)       — Full customer detail
get_contact_addresses(p_id)     — Contact's addresses
upsert_contact_address(...)     — Save contact address
delete_contact_address(p_id)    — Delete contact address
```

### Schedule & Appointments
```
get_appointments_range(...)     — Appointments in date range
get_appointment_detail(p_id)    — Full appointment detail
get_appointment_tasks(p_id)     — Tasks on appointment
get_tasks_for_appointment(p_id) — Alternate tasks fetch
update_appointment(...)         — Edit appointment
delete_appointment(p_id)        — Remove appointment
upsert_appointment_task(...)    — Save appointment task
toggle_appointment_task(...)    — Toggle task complete
get_job_schedule(p_job_id)      — Schedule for one job
get_job_schedules(...)          — All job schedules
get_my_appointments_today(...)  — Today's appointments for employee
get_dispatch_board(...)         — Dispatch board data
get_dispatch_panel_jobs(...)    — Jobs panel for dispatch
get_schedule_templates()        — All schedule templates
get_schedule_template(p_id)     — Single template detail
apply_schedule_plan(...)        — Create tasks/phases from template
preview_schedule(...)           — Preview before applying
```

### Tasks
```
get_job_task_pool(p_job_id)     — Tasks grouped by phase
get_job_task_summary(p_job_id)  — Task progress stats
get_unassigned_tasks(...)       — Tasks not on calendar (returns grouped — must flatten)
assign_tasks_to_appointment(...)
toggle_job_task(p_id)           — Toggle + unassigns if un-completing
add_adhoc_job_task(...)         — Ad-hoc task (auto-links job_schedule_phase_id)
add_custom_schedule_phase(...)  — Add custom phase to job schedule
finish_appointment(...)         — Release incomplete tasks
```

### Employees & Time
```
clock_appointment_action(p_appointment_id, p_employee_id, p_action) — Atomic time tracking (omw/start/pause/resume/finish). On 'omw', auto-closes any other open entries for the same employee with hours capped at LEAST(24, ...). If auto-closed entry was stale (>24h since clock_in), logs a 'time_entry.auto_closed_stale' row to system_events (payload: previous_appointment_id, new_appointment_id, clock_in, auto_closed_at, raw_hours, capped_hours, reason). Future: replace stale-close heuristic with geofence-based auto-finish when tech leaves the job site.
get_assigned_tasks(p_employee_id) — Incomplete tasks for employee with job context
get_all_employees()             — All employees with auth status
get_payroll_summary(...)        — Payroll summary
get_timesheet_entries(...)      — Time entries for payroll
get_job_labor_summary(p_job_id) — Labor cost per job
upsert_time_entry(...)          — Save time entry
approve_time_entries(...)       — Bulk approve
calc_time_entry_cost(...)       — Calculate cost from hours/rate
get_tech_status_board()         — Live dispatch board: one row per active field_tech/supervisor (plus any employee currently clocked in or scheduled today) with derived status ('paused'|'on_site'|'omw'|'scheduled'|'idle'), status_since, current/next appointment, job, client_name, address. Sorted by status priority then name. Powers the Status Board tab on Time Tracking.
```

### Auth & Permissions
```
get_all_permissions()           — Full nav_permissions matrix
upsert_permission(...)          — Save role/nav_key permission
get_employee_page_access(p_employee_id) — All page overrides for an employee
upsert_employee_page_access(p_employee_id, p_nav_key, p_can_view, p_updated_by) — Set override
delete_employee_page_access(p_employee_id, p_nav_key) — Remove override (revert to role default)
```

### Documents & Esign
```
get_document_templates(...)     — Templates by doc_type
upsert_document_template(...)   — Save template
get_sign_request_by_token(p_token) — p_token TEXT (casts to UUID internally)
create_sign_request(...)        — Creates sign_request row
complete_sign_request(...)      — Mark signed + insert job_document
record_email_open(p_token)      — Update email_opened_at + open_count
```

### Lookup Tables
```
get_insurance_carriers()        — [{id, name}]
upsert_insurance_carrier(...)   — p_name, p_sort_order
delete_insurance_carrier(p_id)
get_referral_sources()          — [{id, name}]
upsert_referral_source(...)
delete_referral_source(p_id)
```

### Feature Flags (Phase 1A — complete)
```
get_feature_flags()             — Returns all flag rows ordered by category, label
upsert_feature_flag(p_key, p_enabled, p_dev_only_user_id, p_category, p_label, p_description, p_updated_by, p_force_disabled)
delete_feature_flag(p_key)
```

### Data Integrity (Phase 4 — complete)
```
get_orphan_jobs_no_claim()      — Jobs with no claim_id
get_orphan_jobs_no_contact()    — Jobs with no primary_contact_id
get_orphan_contacts()           — Contacts with no contact_jobs links
get_orphan_conversations()      — Conversations with no participants
get_orphan_claims()             — Claims with no linked jobs
get_duplicate_contacts()        — Contacts sharing same normalized phone (groups)
```

### Record Merge (complete)
```
merge_contacts(p_keep_id, p_merge_id)  — Atomic merge: fills blanks, re-points 14 FK tables, deletes loser. Logs contact.merged event.
merge_claims(p_keep_id, p_merge_id)    — Atomic merge: fills blanks, re-points jobs, deletes loser. Logs claim.merged event.
merge_jobs(p_keep_id, p_merge_id)      — Atomic merge: fills blanks, sums financials, re-points 28 FK tables, deletes loser. Blocks if both have payments. Logs job.merged event.
```

### Messaging Tools (Phase 5 — complete)
```
get_message_log(p_limit, p_offset, p_direction, p_status) — Paginated message log with contact info (direction inferred from sender_contact_id)
get_scheduled_queue(p_limit)    — Scheduled messages with contact + template info (joins via conversation_participants)
```

### Workers & Dev
```
get_worker_runs(p_limit INT)    — Last N worker_runs rows (default 10)
bust_postgrest_cache()          — NOTIFY pgrst 'reload schema' — forces schema reload
get_table_stats(p_table TEXT)   — Row count + latest created_at for any table (Phase 6)
```

### Dashboard
```
get_dashboard_stats()           — Dashboard stat counts
```

---

## Feature Flags System (Phase 1A complete, 1B wired in AuthContext)

**Table:** `feature_flags` — 9 rows, all `enabled = false`

| Key | Category | Label |
|-----|----------|-------|
| `page:leads` | page | Leads |
| `page:marketing` | page | Marketing |
| `page:time_tracking` | page | Time Tracking |
| `page:collections` | page | Collections |
| `page:encircle_import` | pages | Encircle Import |
| `tool:bulk_sms` | tool | Bulk Messaging |
| `tool:search_export` | tool | Search & Export |
| `feature:pwa` | feature | PWA |
| `feature:twilio_live` | feature | Twilio Live SMS |

**AuthContext integration (Phase 1B — complete, access control updated Mar 27 2026):**
- `featureFlags` — keyed object `{ 'page:marketing': { enabled, dev_only_user_id, force_disabled, ... } }`
- `employeePageAccess` — keyed object `{ dashboard: true, conversations: false, ... }` — empty = no overrides
- `isFeatureEnabled(key)` — no row = `true` (backwards compat), `flag.enabled` = `true`, `dev_only_user_id === employee.id` = `true`, else `false`
- `canAccess(navKey)` — 4-layer priority:
  1. `force_disabled` on feature flag → `false` (no exceptions, even admins)
  2. `employeePageAccess[navKey]` exists → use that value
  3. `employee.role === 'admin'` → `true`
  4. `nav_permissions` by role (existing logic)
- All three (permissions, flags, page access) fetched in parallel at login
- All reset on logout

**Phases 1C–6C (all complete):** Sidebar guards, DevTools.jsx with 7 tabs (Moroni-only route)

---

## Employees (14 total)

| Name | Role | Auth |
|------|------|------|
| Moroni Salvador | admin | ✅ linked |
| Ben Palmieri | admin | ✅ linked |
| Juani Sajtroch | supervisor | ✅ linked |
| Marcelo Estefens | project_manager | ✅ linked |
| Matheus Almeida | field_tech | ✅ linked |
| Thiago Tobias | admin | ✅ linked |
| Admin User | admin | ❌ unlinked |
| Alan Nobre | field_tech | ❌ no email |
| Amaury Evangelista | supervisor | ❌ no email |
| Diego Henriques | field_tech | ❌ no email |
| Elias Almeida | field_tech | ❌ no email |
| Marcelo Bigheti | field_tech | ❌ no email |
| Marcio Silveira | supervisor | ❌ no email |
| Nano Suarez | field_tech | ❌ email set, unlinked |

**Invite flow:** Admin → Send Invite → creates auth → links `auth_user_id` → sends email → `/set-password` → sets password → auto-redirects Dashboard

---

## Auth & Session
- **Auth:** Supabase Auth — `realtimeClient.auth.signInWithPassword()`
- **Session token** used as Bearer for `db` client and admin worker calls
- **TOKEN_REFRESHED** event rebuilds `authDb` so calls don't 401 after ~1 hour
- **Dev mode:** bypasses auth by selecting employee directly (`import.meta.env.DEV` only)
- **Recovery links:** hash with `type=recovery` → redirect `/set-password` before init
- **field_tech routing:** `employee.role === 'field_tech'` → `/` redirects to `/tech` (TechLayout, bottom nav, no sidebar). `/tech/*` routes: Dash, Schedule, Tasks, Claims, Appointment detail. `/conversations` shared with all roles.
- **Tech mobile polish (Mar 28 2026 — full UI/UX redesign):**
  - **UX persona:** Design every tech screen as if the user is a 64-year-old field tech, not tech-savvy, standing in a flooded basement or doing drywall repair, wearing work gloves, one hand on phone, possibly in sunlight. One-tap actions, no required inputs blocking workflows, 48px min touch targets.
  - **viewport-fit=cover:** Required in `index.html` meta viewport tag. Without it, `env(safe-area-inset-bottom)` returns 0px on iOS and bottom nav touches the home indicator.
  - **Design tokens:** Tech-specific CSS variables (48px min tap, 16px card radius, status palette, shadow system)
  - **TechLayout:** 26px icons, 11px labels, active pill (44×30), frosted glass nav (0.92 opacity), 8px badge dot
  - **TimeTracker:** Status-colored background tints (amber=en route, green=working, red=paused). Three stations in a horizontal grid — each shows icon, label, timestamp, and optional between-step duration below. The "next" station is the only tappable/prominent (blue) one; completed stations grey out. No live ticker — all durations are closed-interval only. `travel_minutes` computed on clock-in from `travel_start`, displayed under the OMW station. `hours` (net on-site, excludes pauses) displayed under Start station after Finish. Two-click confirm finish. Pause/Resume preserves original Start timestamp. Multi-visit summary lines shown above the current-visit row.
  - **TechDash:** Sticky greeting header (doesn't move on pull-to-refresh), active cards with client name + task progress bar + Photo/Notes/Clock In actions (two-click confirm with 3s timeout), timeline-style future rows, compact completed rows, upcoming 7-day preview when 0 today, snap-first photo flow (auto-upload, optional caption via toast), shimmer skeleton loading
  - **TechTasks:** SVG completion ring (52px donut), 40px pill tabs, mini progress bars per job group, 56px rows, 26px checkboxes, swipe-to-complete with "Done" text + haptic at 40px threshold, checkbox pop animation, completed tasks at 0.5 opacity
  - **TechSchedule:** Division-colored left borders per row, time+duration left column, today header accent-colored, "You're all clear" empty state, jump-to-today FAB accent-colored with arrow icon, 72px min row height
  - **TechClaims:** Encircle-style rows (16px bold name, accent-colored address, claim number + date header, division/job count/status pills), 48px search bar (16px font prevents iOS zoom, 12px radius), empty state with search query + clear button
  - **TechAppointment:** Division gradient hero (water=blue, mold=pink, recon=amber, fire=red, contents=green), white text hierarchy, action bar (Navigate/Call/Message/Photo, 24px icons, 56px tall), 2-column photo grid (12px radius), pinch-to-zoom lightbox, relative timestamps on notes ("2h ago"), task progress bar
  - **Transitions:** Fade-up (translateY 8px) for tab switches, slide-from-right for drill-down, button scale(0.97) press feedback, checkbox pop animation
  - **Status colors:** Scheduled=blue, En Route=amber, Working=green, Paused=red, Completed=gray — visible from 3 feet away

---

## PWA (complete as of Mar 27 2026)
- **Manifest:** `public/manifest.json` — standalone display, portrait orientation
- **Service worker:** `public/sw.js` — cache-first for app shell, network-only for REST/API
- **Icons:** SVG icons at `/icon-192.svg` and `/icon-512.svg`
- **Install prompt:** TechLayout shows banner for field_tech when not in standalone mode (iOS: share instructions, Android: beforeinstallprompt)
- **Feature flag:** `feature:pwa` — enabled

---

## Esign System (complete as of Mar 23 2026)
- **Flow:** SendEsignModal → `/api/send-esign` → `sign_request` row → email via SendGrid
- **Sign page:** `/sign/:token` — public, no auth — type (cursive/Dancing Script) or draw (canvas)
  - Desktop defaults to Type mode, Mobile defaults to Draw mode
- **PDF generation:** `/api/submit-esign` — pdf-lib, fetches template from DB, substitutes `{{variables}}`, multi-page
- **Open tracking:** `/api/track-open?t=<token>` — 1×1 pixel, updates `email_opened_at` + `email_open_count`
- **Resend:** `/api/resend-esign` — reuses same token, resets open tracking
- **Doc types:** `coc` (per-division ×5), `work_auth`, `direction_pay`, `change_order`
- **Insurance clause:** insured job → direction-to-pay clause; OOP → conditional pre-assignment clause
- **Canvas DPR fix:** retina display handled via `initCanvas` + `setTransform` with `devicePixelRatio`
- **Token note:** `get_sign_request_by_token` takes `p_token TEXT` and casts to UUID internally

---

## Schedule System
- **Views:** Day (default on mobile), 3-Day, Week, Month
- **Drag/drop:** appointments draggable + resizable with ghost placement
- **Popover:** click appointment → detail popover (not page nav)
- **Job panel:** overlay + swipe to close (mobile)
- **Auto-scroll:** scrolls to current time on Day view load
- **Tap targets:** 44px minimum
- **Division filter:** All / Mitigation / Recon (role-based default)
- **Task dependency type enum:** `starts_after` | `ends_before` (NOT `finish_to_start`)
- **`get_unassigned_tasks` returns grouped by phase — must flatten before use**
- **`apply_schedule_plan`** creates job_tasks + phases with dates, auto-advances job to `reconstruction_in_progress`

---

## Cloudflare Workers — Environment Variables
```
SUPABASE_URL                    — https://glsmljpabrwonfiltiqm.supabase.co
SUPABASE_SERVICE_ROLE_KEY       — Service role key (Cloudflare Pages secrets)
SUPABASE_ANON_KEY               — Anon key
VITE_SUPABASE_URL               — Same (Vite build)
VITE_SUPABASE_ANON_KEY          — Same (Vite build)
SENDGRID_API_KEY                — SendGrid v3
ENCIRCLE_API_KEY                — Encircle integration
TWILIO_*                        — 7 vars (pending go-live)
```

**jsonResponse signature:** `jsonResponse(data, status, request, env)`

---

## Mobile Layout
- **Bottom bar:** 4 tabs (Dashboard, Messages, Jobs, Schedule) + More → opens sidebar
- **Sidebar:** slides in from left via `sidebar-open` class
- **Safe area:** footer uses `env(safe-area-inset-bottom)` for iPhone home bar
- **Pull to refresh:** `PullToRefresh` component wraps page content
- **iOS auto-zoom fix:** all inputs must have `font-size: 16px`
- **CSS transforms:** cause content clipping on real iPhones — use display toggle instead

---

## PostgREST / Supabase Gotchas
- New tables need `SECURITY DEFINER` RPCs — REST API schema cache doesn't update immediately
- RLS anon policies require `TO anon` clause — `USING (true)` alone is insufficient
- `db.select()` silently returns `[]` on 404 — silent `.catch(() => [])` masks errors
- Always inspect actual column names via `information_schema.columns` before writing queries
- `job_notes` uses column `body`, NOT `content`
- `write_file` for full rewrites — `edit_file` fails silently on CRLF files
- `bust_postgrest_cache()` RPC forces schema reload without redeploying

---

## Dev Tools Roadmap Status (as of Mar 27 2026)

| Phase | Item | Status |
|-------|------|--------|
| 1A | `feature_flags` table + RPCs + 8 seed rows | ✅ Done |
| 1B | AuthContext: `featureFlags` + `isFeatureEnabled()` | ✅ Done |
| 1C | Sidebar guards + `FeatureRoute` in App.jsx | ✅ Done |
| 2A | `DevRoute` + `/dev-tools` route in App.jsx | ✅ Done |
| 2B | DevTools.jsx page shell + Flags tab | ✅ Done |
| 3A | Health check dashboard | ✅ Done |
| 3B | Employee auth status tab | ✅ Done |
| 3C | Worker execution log tab + `worker_runs` table + RPC | ✅ Done |
| 4A | Orphan checker (5 parallel checks, expandable results) | ✅ Done |
| 4B | Claim/job tree viewer (typeahead search, contacts + tasks) | ✅ Done |
| 4C | Duplicate contact detector (by normalized phone) | ✅ Done |
| 5A | Template preview/test (variable substitution, SMS segments) | ✅ Done |
| 5B | Message log viewer (direction/status filters, pagination) | ✅ Done |
| 5C | Scheduled message queue (two-click cancel) | ✅ Done |
| 6A | RPC test runner (14 RPCs, dynamic params, JSON output) | ✅ Done |
| 6B | Table inspector (15 tables, row count, recent rows) | ✅ Done |
| 6C | `bust_postgrest_cache()` RPC + button | ✅ Done |

**All DevTools phases complete.** 7 tabs: Flags, Health, Employees, Workers, Integrity, Messaging, Advanced.

**DevRoute access:** `employee?.email === 'moroni@utah-pros.com'` — hardcoded, not role-based

---

## Known Pending Items
1. **Twilio go-live** — blocked on ID verification; 7 env vars need setting in Cloudflare
2. **Auth linking** — 8 employees have no `auth_user_id`; need emails added via Admin → Send Invite
3. **Search + export** — `tool:search_export` feature flag ready, page not built
4. **Bulk messaging** — `tool:bulk_sms` flag ready, not built
5. **Mobile React Native app** — separate repo `moronisalvador/UPR-Mobile` at `F:\APPS\Restoration APP\UPR-Mobile`
6. **`toggle_appointment_task`** — was returning 404 as of Mar 28; needs verification that RPC exists and matches frontend call signature (`p_task_id`, `p_employee_id`)
7. **TECH-UI-TASK.md cleanup** — file should be deleted after all tech UI changes verified working
8. **Task assignment logic** — tasks belong to appointments, not employees. `get_assigned_tasks` must join through `appointment_crew` to find a tech's tasks. Verify this RPC works correctly.
9. **Photo/note query fix** — TechAppointment must query `job_documents` by BOTH `appointment_id` OR `job_id` (fallback for pre-fix docs)
