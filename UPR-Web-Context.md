# UPR Web Platform — Context Document
Last updated: March 23, 2026

## Project Overview
Internal business management platform for Utah Pros Restoration (UPR).
Owner/developer: Moroni Salvador.

**Live URL:** https://dev.utahpros.app  
**GitHub repo:** moronisalvador/Utah-Pros-App-Git  
**Local repo:** F:\APPS\RestorationAPP\Utah-Pros-App-Git  
**Deployment:** Cloudflare Pages (auto-deploys on push to `dev` branch)  
**Production branch:** `main` (merge dev → main when stable)

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
1. All DB ops use `db.rpc()` or `db.select/insert/update/delete()` from `src/lib/supabase.js`
2. Never use `alert()` or `confirm()` — always use `window.dispatchEvent(new CustomEvent('upr:toast', ...))`
3. Always use `const { db } = useAuth()` — never import `db` directly in components
4. Never use the Supabase JS SDK directly — all queries are raw fetch/PostgREST
5. Always read files from disk before editing — never rely on memory for current code state
6. `edit_file` fails silently on CRLF files — use `write_file` for full rewrites when needed

---

## File Structure

```
src/
  App.jsx                        — Router, ProtectedRoute wiring
  main.jsx                       — Entry point
  index.css                      — All global styles + CSS variables
  contexts/
    AuthContext.jsx               — Auth state, db client, login/logout/devLogin
  lib/
    supabase.js                   — REST client (baseUrl, apiKey, select/insert/update/delete/rpc)
    realtime.js                   — Supabase realtime + auth client
    api.js                        — Misc API helpers
  pages/
    Login.jsx                     — Email/password login + forgot password + dev mode selector
    SetPassword.jsx               — Password reset flow (recovery link handler)
    Dashboard.jsx                 — Stats + recent jobs, click-through to job detail
    Jobs.jsx                      — Job list with division tabs, sort, search, detail panel
    JobPage.jsx                   — Full job detail: Overview/Schedule/Files/Financial/Activity tabs
    Production.jsx                — Kanban pipeline (29 phases, 4 macro groups) + list view
    Leads.jsx                     — Jobs in lead phase
    Customers.jsx                 — Contact list, claims-grouped detail panel
    ContactProfile.jsx            — Individual contact detail
    CustomerPage.jsx              — Customer detail page
    Conversations.jsx             — SMS/MMS messaging (882 lines, GHL-style)
    Schedule.jsx                  — Calendar dispatch board (Day/3Day/Week/Month)
    ScheduleTemplates.jsx         — Schedule template management
    TimeTracking.jsx              — Employee time tracking
    Marketing.jsx                 — Marketing tools
    Admin.jsx                     — Employee management + roles/permissions matrix
    Settings.jsx                  — Document template editor + lookup tables (carriers, referral sources)
    SignPage.jsx                  — Public esign page (no auth) — type or draw signature
    CreateJob.jsx                 — Full-page job creation flow
  components/
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
    EditAppointmentModal.jsx      — Edit existing appointment
    EditContactModal.jsx          — Edit contact details
    EmptyState.jsx                — Reusable empty state component
    ErrorBoundary.jsx             — React error boundary
    Icons.jsx                     — SVG icon components
    JobDetailPanel.jsx            — Job detail slide-out panel
    JobPanel.jsx                  — Job panel component
    Layout.jsx                    — Main layout shell
    ProtectedRoute.jsx            — Auth guard wrapper
    PullToRefresh.jsx             — Mobile pull-to-refresh
    ScheduleWizard.jsx            — Generate schedule from template
    SendEsignModal.jsx            — Send/collect esign request modal
    Sidebar.jsx                   — Sidebar navigation
  styles/                        — Additional style files

functions/
  api/
    admin-users.js                — POST/PATCH/PUT/DELETE employee + auth management
    process-scheduled.js          — Cron: process scheduled SMS messages (60s)
    resend-esign.js               — Resend esign email for existing pending request
    send-esign.js                 — Create sign request + send email via SendGrid
    send-message.js               — Outbound SMS with TCPA compliance + DND guard
    submit-esign.js               — Process signature, generate PDF, upload to storage
    sync-encircle.js              — Pull Encircle claims → jobs + contacts
    track-open.js                 — Email open tracking pixel
    twilio-status.js              — Delivery receipts + RCS read status
    twilio-webhook.js             — Inbound SMS handler
  lib/
    cors.js                       — CORS helpers + jsonResponse
    supabase.js                   — Supabase REST helper for workers
    twilio.js                     — Twilio helpers
```

---

## Key Supabase Tables
```
jobs                    — Core job records
job_phases              — Phase definitions (29 phases, 4 macro groups)
job_phase_history       — Phase transition audit log
job_notes               — Internal job notes
job_documents           — Files attached to jobs
job_tasks               — Schedule tasks
job_schedule_phases     — Schedule phase groupings
contacts                — All contacts (homeowner/adjuster/vendor/sub/etc.)
contact_jobs            — Many-to-many contacts ↔ jobs (with role + is_primary)
claims                  — Insurance claims (auto CLM-YYMM-XXX numbers)
conversations           — SMS conversation threads
messages                — Individual SMS/MMS messages
conversation_participants
scheduled_messages      — Queued outbound messages
message_templates       — 10 seeded SMS templates
sms_consent_log         — TCPA opt-in/out audit log
automation_rules
employees               — 7 employees (5 with auth_user_id linked)
nav_permissions         — Role-based nav access (50 rules)
sign_requests           — Esign requests (token, status, open tracking)
document_templates      — 8 templates (CoC×5, work_auth, direction_pay, change_order)
insurance_carriers      — 53 rows
referral_sources        — 49 rows
schedule_templates      — Schedule templates
appointment_templates
job_appointments
vendor_invoices         — (Netlify app, separate)
```

---

## Key RPCs (use db.rpc() for these)
```
get_insurance_carriers          — Returns [{id, name}]
upsert_insurance_carrier        — p_name, p_sort_order
get_referral_sources            — Returns [{id, name}]
get_dashboard_stats             — Dashboard stat counts
get_claim_jobs                  — p_claim_id → {claim, jobs[]}
create_job_with_contact         — Atomic job + contact creation
add_related_job                 — Sibling job under same claim
get_job_contacts                — Contacts linked to a job
link_contact_to_job             — Link contact with role
search_contacts_for_job         — Typeahead contact search
get_customers_list              — Nested claims → jobs view
get_all_employees               — All employees with auth status
get_all_permissions             — Full nav_permissions matrix
upsert_permission               — Save role/nav_key permission
get_sign_request_by_token       — p_token (text, casts to uuid internally)
create_sign_request             — Creates sign request row
complete_sign_request           — Mark signed + insert job_document
get_job_task_summary            — p_job_id → task progress stats
get_job_task_pool               — Tasks grouped by phase
get_unassigned_tasks            — Tasks not on calendar
assign_tasks_to_appointment
toggle_job_task
add_adhoc_job_task
finish_appointment
get_document_templates          — Templates by doc_type
upsert_document_template
```

---

## Auth & Employees
- **Auth:** Supabase Auth — `realtimeClient.auth.signInWithPassword()`
- **Session token** used as Bearer token for `db` client and admin worker calls
- **Dev mode:** bypasses auth by selecting employee directly (only available in `import.meta.env.DEV`)
- **Employees with auth linked:** Ben Palmieri, Juani Sajtroch, Marcelo Estefens, Matheus Almeida, Moroni Salvador
- **No auth yet:** Alan Nobre, Amaury Evangelista, Diego Henriques, Elias Almeida, Marcelo Bigheti, Marcio Silveira, Nano Suarez

---

## Cloudflare Workers — Environment Variables Required
```
SUPABASE_URL                    — https://glsmljpabrwonfiltiqm.supabase.co
SUPABASE_SERVICE_ROLE_KEY       — Service role key (set in Cloudflare Pages secrets)
SUPABASE_ANON_KEY               — Anon key (fallback)
VITE_SUPABASE_URL               — Same as SUPABASE_URL (for Vite)
VITE_SUPABASE_ANON_KEY          — Same as SUPABASE_ANON_KEY (for Vite)
SENDGRID_API_KEY                — SendGrid API key
ENCIRCLE_API_KEY                — Encircle integration key
TWILIO_*                        — 7 Twilio vars (pending go-live)
```

---

## Esign System (fully working as of Mar 23 2026)
- **Flow:** SendEsignModal → `/api/send-esign` → sign_request row → email via SendGrid
- **Sign page:** `/sign/:token` — public, no auth — supports type-or-draw signature
  - Desktop defaults to "Type" mode (cursive font, Dancing Script)
  - Mobile defaults to "Draw" mode (finger on canvas)
- **PDF generation:** `/api/submit-esign` — pdf-lib, fetches template from DB, substitutes `{{variables}}`, multi-page support
- **Open tracking:** `/api/track-open?t=<token>` — 1×1 pixel, updates `email_opened_at` + `email_open_count`
- **Resend:** `/api/resend-esign` — reuses same token, resets open tracking
- **Doc types:** coc (per-division), work_auth, direction_pay, change_order
- **Insurance section:** smart — insured job gets direction-to-pay clause, OOP gets conditional pre-assignment clause

---

## Mobile Layout
- **Bottom bar:** 4 tabs (Dashboard, Messages, Jobs, Schedule) + More → opens sidebar
- **Sidebar:** slides in from left on mobile via `sidebar-open` class
- **Safe area:** footer uses `env(safe-area-inset-bottom)` for iPhone home bar
- **Pull to refresh:** `PullToRefresh` component wraps page content

---

## Known Pending Items
1. **Twilio go-live** — blocked on ID verification; 7 env vars need setting
2. **Supabase Auth linking** — 7 employees have no `auth_user_id`
3. **Nav rename:** Current "Jobs" → "Production" page; new "Jobs" = Encircle-style card list
4. **Search + export** across pages
5. **PWA** setup
6. **Bulk messaging**
7. **Mobile React Native app** — separate repo `moronisalvador/UPR-Mobile` at F:\APPS\Restoration APP\UPR-Mobile

---

## PostgREST / Supabase Gotchas
- New tables need `SECURITY DEFINER` RPCs — REST API schema cache doesn't update immediately
- RLS anon policies require `TO anon` clause — `USING (true)` alone is insufficient
- `db.select()` silently returns `[]` on 404 — use `.catch()` guards
- Always inspect actual column names via `information_schema.columns` before writing queries
- `edit_file` tool fails silently on Windows CRLF files — use `write_file` for rewrites
