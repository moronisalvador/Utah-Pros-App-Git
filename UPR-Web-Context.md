# UPR Web Platform — Context Document
Last updated: June 20, 2026 (Stripe S3 — card payments & fee automation, dormant)

## Project Overview
Internal business management platform for Utah Pros Restoration (UPR).
Owner/developer: Moroni Salvador.

**Live URL:** https://dev.utahpros.app (dev branch) | https://utahpros.app (main)
**GitHub repo:** moronisalvador/Utah-Pros-App-Git
**Local repo:** F:\APPS\RestorationAPP\Utah-Pros-App-Git
**Deployment:** Cloudflare Pages (auto-deploys on push to `dev` branch)
**Rule:** Always work on `dev` (or a feature branch). Ship to `main` only via a reviewed `dev → main` PR a human merges — see **Deployment & Release Workflow** below.

---

## Deployment & Release Workflow

**Branches → environments**
- **Feature branch / `dev`** → Cloudflare auto-deploys `dev` to **https://dev.utahpros.app** on every push. Verify here first.
- **`main`** → production **https://utahpros.app** (and the Capacitor iOS app loads `/tech/*` from this build).

**How code reaches production (sanctioned path):**
Automated agents **cannot `git push` to `main`** — the Claude Code safety guardrail blocks direct pushes to the default branch by design, and production needs human review. To release:
1. Land the change on **`dev`** (feature branch → `dev`, fast-forward) and test on the dev deploy.
2. **Open a PR `dev → main`** (ask the user first — repo convention is no PRs unless requested). The **user reviews + merges**; Cloudflare deploys `main`. (Or the user merges `dev → main` locally.)
3. The agent's last git step on a finished task is "on `dev` + request the `dev → main` merge," never a direct `main` push.

**Single shared Supabase (dev + main).** One project (`glsmljpabrwonfiltiqm`) backs both environments, so migrations and data changes — e.g. **publishing a new `demo_sheet_schemas` version** — affect staging AND production at once. Sequence so production code is live before the schema it needs: seed new schema versions as a **draft** (`is_active=false`, inert), merge code to `main`, then call the activating RPC (`publish_demo_schema`). This prevents old production code from rendering a schema it can't handle.

**Scope Sheet rollback (≈60s).** Schema and code revert independently — see CLAUDE.md → *Scope Sheet rollback runbook* for full steps. Fast paths: (1) **schema** — `SELECT publish_demo_schema('6b14aefb-4591-47ee-b00f-e12ddb8f956a');` reactivates v1 instantly (new code renders v1 via the hardcoded-sketch fallback); (2) **code** — `git revert -m 1 <merge-sha>` → `dev` → `dev → main` PR → Cloudflare redeploys. Old saved sheets keep their `schema_id` snapshot, so historical sheets are never affected. Prefer new schema *versions* over in-place edits for granular rollback.

---

## Stack
- **Frontend:** React 19 + Vite
- **Database:** Supabase (PostgreSQL + PostgREST REST API — NO Supabase JS SDK)
- **Auth:** Supabase Auth via `@supabase/supabase-js` realtime client
- **Workers:** Cloudflare Pages Functions (`functions/api/`)
- **Email:** Resend (`https://api.resend.com/emails`) via shared `functions/lib/email.js` helper
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
    techDateUtils.js              — Shared helpers for tech pages: formatTime, relativeDate, photoDateTime, fileUrl, openMap.
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
    OOPPricing.jsx                — Out-of-Pocket Pricing Calculator (Apr 20 2026). Route /tools/oop-pricing. Feature-flagged tool:oop_pricing (dev-only → Moroni). 2-column desktop / stacked mobile layout: LEFT inputs (job type pill, customer, labor, 5 equipment rows count×days, materials+fees, mold add-ons when job_type=mold, notes) / RIGHT sticky breakdown (customer-facing line items + big QUOTE TOTAL) + internal margin panel (hidden via .oop-no-print). Margin color tiers: green ≥20%, amber 10–20%, red <10% (with "Recommend decline or reprice" banner). Supports ?jobId=X prefill (reads jobs table → sets jobType from division + insured_name + address + shows linked chip) and ?quoteId=X rehydrate (loads via get_oop_quote). Browser print omits input column + sidebar + internal margin via @media print rules in index.css. Pricing math + form hydration extracted to src/lib/oopPricing.js (shared with TechOOPPricing.jsx).
    Admin.jsx                     — Employee management + roles/permissions matrix + page access overrides
    Settings.jsx                  — Document template editor + lookup tables (carriers, referral sources)
    SignPage.jsx                  — Public esign page (no auth) — type or draw signature
    CreateJob.jsx                 — Full-page job creation flow
  pages/tech/
    TechDash.jsx                  — Field tech dashboard: sticky greeting (doesn't scroll on pull-to-refresh), active cards with client name + task progress bar + Photo/Notes/Clock In, timeline future rows, compact completed rows, upcoming 7-day preview when 0 appointments today, snap-first photo flow (auto-upload, optional caption via toast)
    TechSchedule.jsx              — Field tech 14-day schedule: type icons, jump-to-today FAB
    TechTasks.jsx                 — Field tech tasks: swipe-to-complete, collapsible job groups. Reached via More tab (demoted from primary nav Apr 16 2026).
    TechClaims.jsx                — Field tech claims: 200ms debounced instant search. Scope toggle ("Mine"/"All") defaults to All, sticky per-device via localStorage `upr:tech-claims-scope`.
    TechClaimDetail.jsx           — Field tech claim detail (purpose-built mobile, replaces desktop ClaimPage at /tech/claims/:claimId). Division-gradient hero (loss emoji, insured name, tappable address, loss meta), 3-button action bar (Call/Navigate/Message as native tel:/maps/sms:), context-aware Now-Next appointment tile (4 cases: now_active/today/next/hidden), Jobs-as-tiles with inline task progress + next-appt label, Photos & Notes grouped by job with 3-up thumbnail strips + overflow count + "See all →" (navigates to /photos album), full-screen lightbox pager, Add Photo / Add Note with bottom-sheet job picker on multi-job claims, collapsed Claim details reference block (carrier/policy/insured/adjuster), admin kebab (Merge/Delete via MergeModal + DELETE-to-confirm dialog), slide-in entry animation, pull-to-refresh, statusBarLight on mount.
    TechClaimAlbum.jsx            — Field tech claim photo album at /tech/claims/:claimId/photos. Slim sticky top bar (back + "Photos" + claim#/insured subtitle + count badge), division-tinted accent strip, 2-column thumbnail grid (~160×160) with per-job grouping on multi-job claims, absolute date + time caption under each thumbnail ("Mar 28, 2026" / "9:52 AM"), pinned bottom Add Photo button with multi-job sheet picker. Imports shared Lightbox from components/tech/.
    TechJobDetail.jsx             — Field tech job detail (purpose-built mobile, replaces desktop JobPage at /tech/jobs/:jobId). Division-gradient hero (emoji, mono job number, insured name, tappable address, phase pill, loss meta), 3-button action bar, "Part of CLM-XXXX · View claim →" breadcrumb, context-aware Now-Next tile filtered to this job's appointments, full Appointments list grouped Upcoming / Past with status pills + crew + task counts, Photos & Notes single-group with See all → /tech/jobs/:id/photos, Add Photo / Add Note (no picker — single job), collapsed Job details reference block (phase, status, division, carrier, policy#, claim#, deductible admin-only, insured, adjuster), admin kebab (Merge job via MergeModal type='job' + DELETE-to-confirm soft delete → returns to parent claim), pull-to-refresh, entry animation, statusBarLight.
    TechJobAlbum.jsx              — Field tech job photo album at /tech/jobs/:jobId/photos. Same structure as TechClaimAlbum but single-group (this IS one job), no job picker. Subtitle = job# · insured.
    TechAppointment.jsx           — Appointment detail: slide-in animation, collapsing hero, photo lightbox. Message button now opens native sms:{phone} (TODO: in-app SMS when available).
    TechMore.jsx                  — Field tech "More" page: list-based home for secondary tools. Sections: Work (Tasks with count badge, OOP Pricing when tool:oop_pricing flag on, Collections, Time Tracking) + Resources (Training Docs, Checklists, Demosheet). Unbuilt items render as dimmed "Soon" rows; built items are <Link>s with chevron.
    TechOOPPricing.jsx            — Mobile-first OOP Pricing Calculator at /tech/tools/oop-pricing (Apr 20 2026). Same math as desktop OOPPricing.jsx (shared via src/lib/oopPricing.js). Sticky top header (back + title + quote# + linked job chip + Save/Update CTA), PullToRefresh wraps content below header, tappable TotalCard summarises $quote + margin pill (tap to expand customer-facing breakdown + internal cost panel), big stepper controls (+/-, 44px tap targets) on equipment rows for gloved hands, 16px font on inputs (prevents iOS Safari auto-zoom), bottom padding accounts for env(safe-area-inset-bottom) + tech-nav-height. Supports ?jobId=X prefill and ?quoteId=X rehydrate. Toasts via upr:toast event; two-click confirm for reset/delete; no alert/confirm.
    TechDemoSheet.jsx             — Field-tech Demo (scope) Sheet at /tech/tools/demo-sheet (May 8 2026 — port of standalone Netlify demo-sheet-v21.jsx). Captures per-room scope: dimensions, baseboard/trim LF, flooring SF, drywall, flood cuts, insulation, cabinets/countertops, doors, fixtures, appliances, drying equipment, contents move hours, notes. Repalettes original orange theme onto UPR blue/neutral tokens, drops dark mode. Tech dropdown loads from get_active_techs RPC (was hardcoded). Reuses src/components/AddressAutocomplete (Google Places via lib/googleMaps loadPlaces). Encircle 🔗 search modal hits /api/encircle-search; selecting a claim auto-pulls structures+rooms via /api/encircle-rooms (rooms become preset chips). Autosave: every 2s while editing, save_demo_sheet RPC writes to forms.form_data with form_type='demo_sheet'; URL gets ?id=<formId> on first save so refresh restores. Drafts banner lists recent unfinished sheets via get_demo_sheet_drafts. Submit fans out to /api/send-demo-sheet (Resend HTML email) + /api/encircle-upload (general note posted to the linked claim) + /api/demo-sheet-pdf (renders the sheet to a PDF and attaches it to the job's Files via job_documents, category 'demo_sheet' — also surfaces on the customer page Files section) in parallel; ResultScreen shows per-channel success/fail (email, Encircle, PDF); final save_demo_sheet flips status to 'submitted' and stores encircle_note_id. Toasts via upr:toast event; no alert/confirm. Entry point: 'Demo Sheet' button under the Tools section on TechAppointment, prefills jobNumber/address/insuredName from the appointment's job context via query params.
  components/
    TechLayout.jsx                — Field tech app shell: blur nav, active pill indicator, task badge dot. 5-tab order: Dash | Claims | Schedule | Messages | More (Apr 16 2026). Task count red-dot now lives on the More tab icon.
    tech/Hero.jsx                 — Shared division-gradient hero. Prop-configurable: { division, topLabel, title, address, statusText, statusColors, meta[], onBack, backLabel, showMenu, onMenu }. Used by TechClaimDetail and TechJobDetail.
    tech/ActionBar.jsx            — Shared 3-button action bar: Call (tel:), Navigate (maps), Message (sms:). Disabled state when phone/address missing. Used by TechClaimDetail and TechJobDetail. TechAppointment keeps its own 5-button version.
    tech/NowNextTile.jsx          — Shared context-aware "what's happening" tile + pickNowNext(appointments, employeeId) helper. 4 cases: now_active (en_route/in_progress/paused) / today / next / hidden.
    tech/PhotosGroup.jsx          — Shared photos + notes group (mini-header per job, 3-up thumbnail grid + overflow cell, notes preview). Used by TechClaimDetail (multi-group on multi-job claims) and TechJobDetail (isSingleJob mode).
    tech/Lightbox.jsx             — Shared full-screen photo pager: prev/next, counter, tap-to-close, description caption. Used by TechClaimDetail, TechClaimAlbum, TechJobDetail, TechJobAlbum.
    tech/DetailRow.jsx            — Shared label/value row for collapsed detail panels. Supports href (tel/mailto), mono, capitalize, multiline.
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
    SendEsignModal.jsx            — Send/collect esign request modal (5 doc_types inc. recon_agreement)
    ReconAgreementContent.jsx     — Signer-side expandable layout for recon_agreement doc_type (intro, property info, authorizations, scope & estimate, payment, 16 legal sections, 4 attested consents). Rendered inside SignPage when doc_type matches. Amber branding.
    Sidebar.jsx                   — Sidebar navigation

functions/
  api/
    admin-users.js                — POST/PATCH/PUT/DELETE employee + auth management
    process-scheduled.js          — Cron: process scheduled SMS messages (60s)
    resend-esign.js               — Resend esign email for existing pending request
    send-esign.js                 — Create sign request + send email via Resend (functions/lib/email.js)
    send-message.js               — Outbound SMS with TCPA compliance + DND guard
    send-push.js                  — APNs push via ES256 JWT; returns 503 until APNS_* env vars set (Phase 4 code-only)
    submit-esign.js               — Process signature, generate PDF, upload to storage
    encircle-backfill.js          — Batch 6-month historical importer. Cursor-paginates Encircle, creates contacts+claims+jobs, repairs legacy orphans, gated CLM writeback. GET=dry-run, POST=execute. Idempotent via (encircle_claim_id, division) composite.
    encircle-import.js            — Search/get/patch/import Encircle claims (manual selective import)
    sync-claim-to-encircle.js     — Push UPR-native claim UP to Encircle. POST { claim_id }. Idempotent (skips if claims.encircle_claim_id set). Writes encircle_claim_id back on claims AND all child jobs. On failure stores error on claims.encircle_sync_error for retry. Called automatically from CreateJobModal + TechNewJob post-RPC; manual retry via DevTools → Backfill tab → Unsynced Claims panel.
    sync-encircle.js              — Pull Encircle claims → jobs + contacts (bulk, legacy)
    track-open.js                 — Email open tracking pixel
    twilio-status.js              — Delivery receipts + RCS read status
    twilio-webhook.js             — Inbound SMS handler
    encircle-search.js            — GET /api/encircle-search?policyholder_name|contractor_identifier|assignment_identifier=… (TechDemoSheet job picker). Limits to 20 newest property_claims. Uses X-Encircle-Attribution=UtahProsRestoration.
    encircle-rooms.js             — GET /api/encircle-rooms?claim_id=… returns { rooms[], structures[] }. Fetches structures for the claim then rooms per structure in parallel; multi-structure rooms get prefixed with structure name.
    encircle-upload.js            — POST /api/encircle-upload { claim_id, title, text } — posts a general note to the Encircle property claim (v2 /notes). Returns { ok, id } so the page can persist encircle_note_id.
    send-demo-sheet.js            — POST /api/send-demo-sheet { subject, message } — sends the rendered demo-sheet HTML email via Resend (functions/lib/email.js). From/To are env-overridable (DEMO_SHEET_FROM_EMAIL, DEMO_SHEET_TO_EMAILS).
    demo-sheet-pdf.js             — POST /api/demo-sheet-pdf { p_job_id?, job_number?, sheet_id?, requested_by?, model } (Bearer-authed like generate-water-loss-report) — renders a submitted demo sheet to a PDF with pdf-lib (navy header, blue room bars, per-room section label/value rows, Job Totals box, page footers), uploads to job-files/{job_id}/demo-sheets/demo-sheet-{ts}.pdf, and records it in job_documents via insert_job_document (category 'demo_sheet'). Resolves the job from p_job_id, falling back to a jobs.job_number lookup; returns { success:true, attached:false, reason:'no_matching_job' } (non-error) when the sheet isn't linked to a UPR job. The PDF then shows under the job's Files tab AND the customer page Files section (get_customer_detail returns all job_documents, no category filter). The render `model` is built client-side in TechDemoSheet.buildPdfModel() so all schema-walking (collectSectionEntries/computeSummary) stays in one place.
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
job_time_entries        — Time entries per job (has travel_minutes NUMERIC column — computed on clock-in from travel_start; Phase 5 added travel_start_lat/lng + clock_in_lat/lng NUMERIC(9,6) captured from iOS Geolocation)
job_number_sequences    — Auto-increment job number tracking
active_jobs             — View: currently active jobs
```

### Scheduling & Appointments
```
appointments            — Calendar appointments + events. kind TEXT ('job'|'event') added Apr 17 2026; job_id is nullable when kind='event'. CHECK constraint enforces: (kind='job' AND job_id IS NOT NULL) OR (kind='event' AND job_id IS NULL). Partial index idx_appointments_events_date on (date) WHERE kind='event'.
appointment_crew        — Crew assignments per appointment (also used for event tech assignment)
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
sign_requests           — Esign requests (token, status, open tracking). Recon agreement adds:
                          consent_terms, consent_commitment, consent_esign, consent_authority BOOLEAN (all nullable),
                          consents_signed_at TIMESTAMPTZ — populated by complete_sign_request when consents are attested.
document_templates      — 24 rows — (CoC×5 divisions, work_auth, direction_pay, change_order,
                          recon_agreement×16 legal sections with sort_order 1–16)
document_requests       — Document request records
forms                   — Multi-form storage (form_type enum: demo_sheet, mold_protocol, fire_scope,
                          contents_inventory, reconstruction_scope, inspection, custom). Columns:
                          id, created_at, updated_at, job_id, submitted_by, form_type, form_version,
                          form_date, technician_name, status (draft|submitted), encircle_claim_id,
                          encircle_note_id, encircle_synced_at, email_sent, email_sent_at,
                          form_data JSONB, summary JSONB. RLS permissive (allow_authenticated_forms).
demo_sheets             — VIEW over forms WHERE form_type='demo_sheet' (legacy flat shape, read-only).
                          The TechDemoSheet page reads/writes `forms` directly via RPCs.
rooms                   — Per-CLAIM physical rooms (water/mold/recon share same structure).
                          Columns: id, claim_id (FK claims, CASCADE), name, area_sqft, ceiling_height_ft,
                          sort_order, client_id UUID UNIQUE (offline idempotency key),
                          created_by (FK employees), created_at, deleted_at (soft).
                          Added Apr 17 2026 as part of Encircle replacement Phase 1.
                          NOTE: Earlier draft had job_id; refactored to claim_id on Apr 17 so jobs
                          under the same claim share rooms.
job_documents           — Extended Apr 17 with `room_id UUID` (FK rooms, ON DELETE SET NULL).
                          Tags photos/notes to a specific room for Encircle-style grouping.
                          `insert_job_document` RPC accepts p_room_id as final optional param.
```

**Supported eSign doc_types:** `coc`, `work_auth`, `direction_pay`, `change_order`, `recon_agreement`.
Only `recon_agreement` uses the four separately-attested consent columns + the expandable ReconAgreementContent signer layout.

### Financial
```
invoices                — Invoice records
invoice_line_items      — Line items per invoice (line_total is a GENERATED column = quantity*unit_price — never write it)
invoice_adjustments     — Invoice adjustment audit log
payments                — Payment records
stripe_events           — Stripe webhook idempotency ledger (RLS-locked, service-role only). Added Jun 20 2026 (Stripe S3)
billing_2fa_codes       — One-time email-2FA codes for editing payout destinations (RLS-locked). Added Jun 20 2026
estimates               — Estimate records
vendor_invoices         — Vendor invoice tracking (also used by Netlify vendor app)
vendors                 — Vendor records
oop_quotes              — OOP Pricing Calculator quotes (Apr 20 2026). Auto-generated
                          quote_number TEXT UNIQUE (format OOP-YYMM-XXX).
                          job_id UUID nullable FK jobs (ON DELETE SET NULL).
                          job_type TEXT CHECK ('water','mold').
                          Inputs: tech_hours, bill_rate, (count,days) × 5 equipment types
                          (air_mover, lgr, xlgr, air_scrubber, neg_air — neg_air mold only),
                          materials_actual_cost, antimicrobial_sqft, disposal_trips,
                          containment_linear_ft + prv_invoice_cost (mold only).
                          Snapshots: quote_total, net_margin_pct (audit trail; UI recomputes
                          on open). Denormalized insured_name + address for standalone
                          quotes without a linked job.
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
feature_flags           — 13 rows — Feature flag controls (has force_disabled BOOLEAN column — kills page for everyone including admins). Apr 17 additions (all dev-only for Moroni): page:tech_rooms, page:tech_moisture, page:tech_equipment, page:water_loss_report, offline:queue.
employee_page_access    — Per-employee page overrides (employee_id, nav_key, can_view, updated_by, updated_at)
device_tokens           — Native push tokens (employee_id, token UNIQUE, platform 'ios'|'android'|'web', created_at, updated_at) — used by send-push worker
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
upr_mcp_audit           — UPR MCP tool-call audit (actor_email, tool, arguments jsonb, status, result, error, created_at) — written by the upr-mcp worker via service role
```

---

## All RPCs (use `db.rpc()` — SECURITY DEFINER, bypasses PostgREST schema cache)

### Jobs & Claims
```
create_job_with_contact(...)    — Atomic job + contact creation
add_related_job(...)            — Sibling job under same claim
get_claim_jobs(p_claim_id)      — {claim, jobs[]}
get_claim_detail(p_claim_id)    — Full claim detail
get_claims_list(...)            — Paginated claims list. Sorted by last_activity_at DESC NULLS LAST, then created_at DESC. last_activity_at = GREATEST of MAX(appointments.updated_at), MAX(job_documents.created_at), MAX(system_events.created_at WHERE event_type NOT LIKE '%.created'), MAX(job_time_entries.updated_at), all joined via jobs.claim_id. Frozen bulk-import sources (claims.updated_at, jobs.updated_at, *.created events) are excluded — they set every row to the same import timestamp and would hide real activity.
get_tech_claims(p_employee_id)  — Claims where tech is on appointment_crew. Same last_activity_at computation and tiered sort as get_claims_list.
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
get_dispatch_board(...)         — Dispatch board data (kind='job' appointments only — joins to jobs so events naturally excluded). Each job row includes claim_id + date_of_loss (from the linked claim, via j.claim_id; added Jun 18 2026 for the schedule job picker).
get_dispatch_events(p_start_date, p_end_date) — Returns non-job calendar events (kind='event') with assigned crew; shape mirrors per-appointment object in get_dispatch_board. Added Apr 17 2026.
get_dispatch_panel_jobs(...)    — Jobs panel for dispatch. Returns id, insured_name, job_number, division, phase, address, date_of_loss (from linked claim, added Jun 18 2026), on_board, in_production, appointment_count.
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
clock_appointment_action(p_appointment_id, p_employee_id, p_action, p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL, p_accuracy NUMERIC DEFAULT NULL) — Atomic time tracking (omw/start/pause/resume/finish). Coords are optional; on 'omw' they populate travel_start_lat/lng on the new entry, on 'start' they populate clock_in_lat/lng. ONE function only — the legacy 3-arg overload was dropped Jun 9 2026: having both overloads made 3-key RPC calls ambiguous (PostgREST PGRST203, HTTP 300) and blocked all clock actions for techs on older app bundles. 3-key calls now resolve to this function via the DEFAULT NULL geo params. Never re-create a second overload of this function. On 'omw', auto-closes any other open entries for the same employee with hours capped at LEAST(24, ...). If auto-closed entry was stale (>24h since clock_in), logs a 'time_entry.auto_closed_stale' row to system_events (payload: previous_appointment_id, new_appointment_id, clock_in, auto_closed_at, raw_hours, capped_hours, reason). Phase 5 layers a foreground "away from jobsite" nudge on top (see get_active_appointment_geo) — future work can add true geofence-based auto-finish.
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
complete_sign_request(p_token, p_signer_name, p_signer_ip, p_signed_file_path,
                      p_consent_terms DEFAULT NULL, p_consent_commitment DEFAULT NULL,
                      p_consent_esign DEFAULT NULL, p_consent_authority DEFAULT NULL)
                                — Mark signed + insert job_document + emit system_events 'esign.signed'.
                                  Derives job_documents.name from doc_type (fixed prior hardcoded-CoC bug).
                                  Consent flags only stored for recon_agreement; other doc types pass NULLs.
record_email_open(p_token)      — Update email_opened_at + open_count
```

**eSign audit trail:** `complete_sign_request` emits a `system_events` row with `event_type='esign.signed'`,
`entity_type='sign_request'`, `entity_id=<sign_request_id>`, and a payload including doc_type, signer info,
signed_at, divisions, and (for recon_agreement) the four consent booleans + consents_signed_at.

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

### Rooms & Encircle Replacement (Phase 1 + 1.5 — Apr 17 2026)
All claim-scoped. Frontend passes p_job_id where convenient; function resolves claim_id internally.
```
get_job_rooms(p_job_id)         — Resolves job→claim, returns rooms for that claim.
                                  Row shape: id, claim_id, name, area_sqft, ceiling_height_ft,
                                  sort_order, client_id, created_by, created_at, deleted_at,
                                  photo_count INT (job_documents WHERE room_id=r.id AND category='photo'),
                                  reading_count INT (stub 0, wired in Phase 2 Hydro).
get_claim_rooms(p_claim_id)     — Direct claim-level lookup. Same shape as get_job_rooms.
create_room(p_job_id, p_name,
            p_area_sqft, p_ceiling_height_ft, p_sort_order,
            p_client_id, p_created_by)
                                — Resolves claim from job, INSERT … ON CONFLICT (client_id)
                                  DO UPDATE (idempotent for offline retries).
create_room_for_claim(p_claim_id, p_name, …same optional params…)
                                — Direct claim-level variant.
update_room(p_room_id, p_name, p_area_sqft, p_ceiling_height_ft, p_sort_order)
delete_room(p_room_id)          — Soft delete (sets deleted_at=now) + nulls
                                  job_documents.room_id that pointed at it.
move_photo_to_room(p_document_id, p_room_id DEFAULT NULL)
                                — p_room_id NULL untags the photo.
insert_job_document(…, p_room_id UUID DEFAULT NULL)
                                — MODIFIED Apr 17. Older 7-param and 8-param overloads dropped.
                                  Single canonical 9-param version; all existing callers use named
                                  args via db.rpc() so backward compatibility is preserved.
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
upsert_device_token(p_employee_id UUID, p_token TEXT, p_platform TEXT)  — Registers iOS/Android device for push; idempotent (unique on token)
delete_device_token(p_token TEXT)                                        — Removes a device token (logout/uninstall cleanup)
get_active_appointment_geo(p_employee_id UUID)                           — Returns jsonb of the tech's in_progress/paused appointment with clock_in_lat/lng, or NULL. Powers the "away from jobsite" nudge. Fixed Jun 9 2026: ordered by nonexistent a.start_at (errored on every call since creation); now orders by a.date DESC, a.time_start DESC.
get_upr_mcp_audit(p_limit INT)                                           — Recent UPR MCP tool-call audit rows (default 100, max 500)
```

### RPC Data-Flow Reference — tech area (reads / writes)
Derived from each function's SQL body (reads = FROM/JOIN, writes =
INSERT/UPDATE/DELETE), intersected with real `public` tables to drop CTE/alias
noise. Use these directly in the `DEPENDS ON → Data` header field instead of
re-introspecting. Built Jun 23 2026 during the tech-area doc backfill; extend
this table per area as the backfill continues.

| RPC | reads | writes |
|-----|-------|--------|
| add_adhoc_job_task | job_schedule_phases, job_schedules | job_tasks |
| assign_tasks_to_appointment | — | job_tasks |
| clock_appointment_action | appointments, job_time_entries | appointments, job_time_entries, system_events |
| create_job_with_contact | contact_addresses, contacts, jobs | claims, contact_addresses, contact_jobs, contacts, jobs |
| create_room | jobs | rooms |
| create_room_for_claim | — | rooms |
| delete_appointment | appointment_crew, appointments | appointment_crew, appointments, job_tasks |
| delete_oop_quote | oop_quotes | oop_quotes |
| get_active_appointment_geo | appointment_crew, appointments, job_time_entries, jobs | — |
| get_active_demo_schema | demo_sheet_schemas | — |
| get_active_techs | employees | — |
| get_appointment_detail | appointment_crew, appointments, employees, jobs | — |
| get_appointment_tasks | employees, job_tasks | — |
| get_appointments_range | appointment_crew, appointments, employees, jobs | — |
| get_assigned_tasks | appointment_crew, appointments, contacts, job_tasks, jobs | — |
| get_claim_appointments | appointment_crew, appointments, employees, job_tasks, jobs | — |
| get_claim_demo_sheets | forms, jobs | — |
| get_claim_detail | claims, contacts, jobs | — |
| get_claim_jobs | claims, jobs | — |
| get_claim_rooms | job_documents, rooms | — |
| get_claims_list | appointments, claims, contacts, job_documents, job_time_entries, jobs, system_events | — |
| get_demo_schema | demo_sheet_schemas | — |
| get_demo_sheet | forms | — |
| get_demo_sheet_drafts | forms | — |
| get_insurance_carriers | insurance_carriers | — |
| get_job_contacts | contact_jobs, contacts | — |
| get_job_equipment | equipment_placements, rooms | — |
| get_job_readings | moisture_readings, rooms | — |
| get_job_rooms | job_documents, jobs, rooms | — |
| get_job_task_summary | job_tasks | — |
| get_my_appointments_today | appointment_crew, appointments, employees, jobs | — |
| get_oop_quote | oop_quotes | — |
| get_stalled_materials_for_employee | appointment_crew, appointments, jobs | — |
| get_tech_claims | appointment_crew, appointments, claims, contacts, job_documents, job_time_entries, jobs, system_events | — |
| get_unassigned_tasks | job_tasks | — |
| insert_job_document | — | job_documents |
| insert_reading | moisture_readings | moisture_readings |
| insert_tech_feedback | — | tech_feedback |
| move_photo_to_room | — | job_documents |
| place_equipment | — | equipment_placements |
| remove_equipment | equipment_placements | equipment_placements |
| save_demo_sheet | demo_sheet_schemas, employees | forms |
| search_contacts_for_job | contact_jobs, contacts | — |
| toggle_appointment_task | employees, job_tasks | job_tasks |
| update_appointment | — | appointments |
| upsert_insurance_carrier | — | insurance_carriers |
| upsert_oop_quote | — | oop_quotes |

### Dashboard
```
get_dashboard_stats()           — Dashboard stat counts
```

### OOP Pricing Calculator (Apr 20 2026)
All SECURITY DEFINER, GRANT EXECUTE TO authenticated. Dev-only behind
`tool:oop_pricing` feature flag (initially Moroni Salvador).
```
generate_oop_quote_number()     — Returns next OOP-YYMM-XXX number (counts existing
                                   rows with current prefix + 1, zero-padded to 3 digits).
upsert_oop_quote(p_id UUID,     — Insert (p_id NULL → auto-generates quote_number) or
  p_job_id, p_job_type,           update. 25 params covering all input fields + snapshot
  p_insured_name, p_address,      totals (p_quote_total, p_net_margin_pct). Returns full
  p_tech_hours, p_bill_rate,      oop_quotes row. COALESCE-wraps numerics so NULL inputs
  p_air_mover_count/days, ...     default to 0.
  p_lgr_count/days, ...
  p_xlgr_count/days, ...
  p_air_scrubber_count/days, ...
  p_neg_air_count/days,
  p_materials_actual_cost,
  p_antimicrobial_sqft,
  p_disposal_trips,
  p_containment_linear_ft,
  p_prv_invoice_cost,
  p_quote_total, p_net_margin_pct,
  p_notes, p_created_by)
get_oop_quotes(p_limit, p_job_id) — Paginated list. When p_job_id set, scoped to that job.
                                     Summary columns only (id, quote_number, job_id,
                                     job_type, insured_name, address, quote_total,
                                     net_margin_pct, created_at, created_by).
get_oop_quote(p_id)             — Returns single full oop_quotes row for the calculator
                                   to hydrate on load.
delete_oop_quote(p_id)          — Hard delete; returns BOOLEAN (FOUND).
```

### Demo Sheet (May 8 2026 — port of standalone Netlify app)
```
save_demo_sheet(p_id, p_data, p_job_date, p_tech_id, p_job_number, p_address,
                p_insured_name, p_encircle_claim_id, p_status, p_encircle_note_id,
                p_job_id, p_summary, p_email_sent, p_schema_id)
                                — Insert/update a forms row with form_type='demo_sheet'.
                                  When p_id is NULL inserts; otherwise updates only rows
                                  where form_type='demo_sheet'. Resolves technician_name
                                  from employees.display_name||full_name based on p_tech_id.
                                  May 8 2026: added p_schema_id (snapshot of the
                                  demo_sheet_schemas row this sheet was filled against —
                                  defaults to the active schema on insert; never changes
                                  on update). p_job_id writes forms.job_id so the sheet
                                  is reachable from a claim via jobs.claim_id; p_summary
                                  JSONB stores rolled-up totals; p_email_sent flips
                                  forms.email_sent + email_sent_at on submit. Sets
                                  encircle_synced_at=now() the first time encircle_note_id
                                  is supplied. Returns the row UUID.
                                  Jun 9 2026 frontend fix: the first save (INSERT, no id)
                                  is now guarded against concurrent saves on the client —
                                  racing autosaves used to create duplicate draft rows on
                                  slow connections (18 orphaned duplicates were purged from
                                  forms that day). Resolved Jun 24 2026: all email moved off
                                  SendGrid (dead since mid-April 2026 — every forms.email_sent
                                  and sign_requests.email_opened_at since then was false/null)
                                  onto Resend via functions/lib/email.js. Requires RESEND_API_KEY
                                  + a verified utahpros.app sending domain in Resend.
get_demo_sheet_drafts()         — Recent 20 demo_sheet drafts (id, updated_at, job_date,
                                  job_number, address, insured_name, encircle_claim_id) for
                                  the resume-draft banner. Sorted by updated_at DESC.
get_demo_sheet(p_id)            — Single demo_sheet row including form_data, summary,
                                  job_id, and schema_id. Used to rehydrate state when the
                                  page loads with ?id=…
get_claim_demo_sheets(p_claim_id) — All demo sheets attached to ANY job under the claim
                                  (joins forms.job_id → jobs.claim_id). Returns id, status,
                                  email_sent, job_id, job_number, division, technician_name,
                                  form_date, insured_name, address, room_count, summary.
                                  Sorted by updated_at DESC. Powers the Demo Sheets list
                                  on TechClaimDetail (mobile) and ClaimPage (desktop).
get_job_demo_sheets(p_job_id)   — Same shape but scoped to a single job.
get_active_techs()              — UUID + display_name for all is_active employees with role
                                  in (field_tech, supervisor, project_manager, admin).
                                  Replaces the demo's hardcoded TECHS array.
```

### Demo Sheet Builder (May 8 2026 — Phase 1: DB foundation)
```
demo_sheet_schemas              — Versioned JSONB definitions of the demo sheet's
                                  sections + fields + room presets. One row is is_active
                                  at a time (partial unique index). Each forms row
                                  (form_type='demo_sheet') is FK'd to the schema_id it
                                  was filled against — snapshot semantics, so editing
                                  the schema later doesn't reshape old sheets. Seeded
                                  with v1 mirroring the previously-hardcoded constants
                                  (12 sections, 12 room presets, full field tree).
                                  Inline updated_at trigger via
                                  public.demo_sheet_schemas_touch_updated_at().

get_active_demo_schema()        — Returns id/version/name/definition/updated_at for the
                                  currently-active schema. Used by TechDemoSheet to
                                  render new sheets and by the builder.
get_demo_schema(p_id)           — One row by id (includes is_active + notes).
list_demo_schemas()             — All versions newest-first plus per-version sheet_count
                                  (how many forms are pinned to each).
upsert_demo_schema(p_id, p_name, p_definition, p_notes, p_created_by)
                                — Insert (auto-bumps version) or update an existing row.
                                  Never flips is_active — use publish_demo_schema for that.
publish_demo_schema(p_id)       — Atomically deactivate the current active row and
                                  activate this one. New sheets created after publish
                                  pick up this schema; existing sheets keep their
                                  schema_id snapshot.
```

**Schema definition shape (JSONB):**
```jsonc
{
  "version": 1,
  "name": "v1 — initial port",
  "roomPresets": ["Living Room", "Kitchen", ...],
  "jobSections": [ /* v2+ — JOB-LEVEL sections, asked once per sheet (see below) */ ],
  "sections": [
    {
      "key": "trim", "label": "Baseboard & Trim", "icon": "📏",
      "alwaysOn": true,                    // OR { "gateField": "floodCuts" }
      "doneFlag": "trimDone",              // boolean key set when "Done → Next" is tapped
      "fields": [
        { "key": "baseboardLF", "type": "stepper", "label": "...",
          "unit": "LF", "step": 1, "small": true, "summaryKey": "baseboardLF" },
        // field types: stepper | single-chip | multi-chip | text | textarea |
        //              checkbox | select | list (nested itemFields) | row | computed
        // showWhen: { field, equals } | { field, includes }
        // unitWhen: { field, equals, thenLabel, thenUnit }   (dynamic unit)
        // summaryKey + summaryAggregate: 'sum' | 'tally' (for rollup totals)
        // computed: { type:'computed', formula:{op:'multiply', a:<key>, b:<key>},
        //            unit, summaryKey }  — read-only value = a×b, summed across contexts
      ]
    }
  ]
}
```

`forms.schema_id` (UUID, nullable, FK to demo_sheet_schemas) — every demo_sheet form
points back to its schema. Backfilled to v1 for all pre-existing rows.

**v2 — Scope Sheet (Jun 24 2026):** the demo sheet was extended into a fuller "scope sheet"
for Xactimate estimating (user-facing label renamed Demo → **Scope Sheet**; route/table/RPC/
doc-category keys unchanged). Two new schema capabilities:
- **`jobSections`** — a top-level array of JOB-LEVEL sections (answered once per sheet, not
  per room). Rendered FIRST in the tech page by the new `JobSections` component (shares
  `Section`/`FieldRenderer` with `RoomCard`), guided/sequential like rooms. Job-section
  answers persist in `forms.form_data.jobData`; their `summaryKey` fields roll into the same
  `summary` totals. `computeSummary(rooms, jobData, schema)` now walks jobSections too.
- **`computed` field type** — `formula:{op:'multiply', a, b}` displays a read-only product of
  two sibling fields and aggregates via `summaryKey` (e.g. tension posts × days = post-days).
- v2 seed (`9ff2566c-…`, **draft until published**) adds jobSections: Loss Details
  (category/class/source of loss), Emergency Call (after-hours/business-hours), Floor
  Protection (types + SF), Tests & Itel (asbestos/lead/Itel checkboxes), Scope Notes, and the
  **folded floor-plan/sketch question** (gateField `hasSketchDone`, placed last so it gates
  the room list). Plus a per-room `containment` section (6 mil SF + tension posts + days +
  computed post-days). The tech page keeps the legacy hardcoded sketch card as a fallback for
  v1 schemas (no jobSections), so old drafts render unchanged.
- **Required fields + enforcement** — fields carry an optional `required: true` (toggled per
  question in the builder). A section's "Done → Next" is disabled until its visible required
  fields are answered (`sectionRequiredMet`/`fieldHasValue`: required number > 0, required
  checkbox checked, choice/text non-empty; non-required fields never block). v2 marks
  category/class/source, emergency timing, and floor-protection type required (+ a "None used"
  protection option). Because job sections are sequential and floor-plan is last, this makes the
  required answers mandatory to submit.
- **Autosave safety net** — TechDemoSheet mirrors the live draft to `localStorage`
  (`scopesheet:draft:<id|pending>`) on every change; a header status shows Saving/Saved/Failed;
  failed saves retry (~8s) and the mirror is restored on next load (cleared on confirmed save /
  submit). Prevents field data loss on poor signal.
- **Perf:** page routes are `React.lazy` + `Suspense` code-split (App.jsx) — initial JS dropped
  from one ~1.9 MB chunk to ~335 KB + per-page chunks. Draft load fetches `get_demo_sheet` once
  (deduped between the schema + bootstrap effects); job totals are `useMemo`-ized.

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
| `tool:oop_pricing` | tool | OOP Pricing Calculator (dev-only → Moroni, Apr 20 2026) |
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
- **field_tech routing:** `employee.role === 'field_tech'` → `/` redirects to `/tech` (TechLayout, bottom nav, no sidebar). `/tech/*` routes: Dash, Claims, Schedule, Conversations (Messages tab), More, plus Tasks and Appointment detail (reached via More and from appointment cards respectively). Primary bottom nav is 5 tabs in that order; Tasks was demoted out of the primary bar on Apr 16 2026 because techs almost exclusively interact with tasks inside the appointment detail view.
- **Tech mobile polish (Mar 28 2026 — full UI/UX redesign):**
  - **UX persona:** Design every tech screen as if the user is a 64-year-old field tech, not tech-savvy, standing in a flooded basement or doing drywall repair, wearing work gloves, one hand on phone, possibly in sunlight. One-tap actions, no required inputs blocking workflows, 48px min touch targets.
  - **viewport-fit=cover:** Required in `index.html` meta viewport tag. Without it, `env(safe-area-inset-bottom)` returns 0px on iOS and bottom nav touches the home indicator.
  - **Design tokens:** Tech-specific CSS variables (48px min tap, 16px card radius, status palette, shadow system)
  - **TechLayout:** 26px icons, 11px labels, active pill (44×30), frosted glass nav (0.92 opacity), 8px badge dot. Tab order is Dash | Claims | Schedule | Messages | More. The badge dot lives on the More tab and lights up when today's assigned tasks are incomplete.
  - **TechMore:** Full-page list (not a drawer overlay) at `/tech/more`. Two sections today — Work + Resources — with iconized 56px-min rows. Each row = 38px accent-light icon pill + label + (badge or chevron or "Soon" pill). Built rows are `<Link>` elements; "Soon" rows are non-clickable, 0.55 opacity. Designed to grow as new tools ship; admin-only section reserved for Phase 5.
  - **TimeTracker:** Status-colored background tints (amber=en route, green=working, red=paused). Three stations in a horizontal grid — each shows icon, label, timestamp, and optional between-step duration below. The "next" station is the only tappable/prominent (blue) one; completed stations grey out. No live ticker — all durations are closed-interval only. `travel_minutes` computed on clock-in from `travel_start`, displayed under the OMW station. `hours` (net on-site, excludes pauses) displayed under Start station after Finish. Two-click confirm finish. Pause/Resume preserves original Start timestamp. Multi-visit summary lines shown above the current-visit row.
  - **TechDash:** Sticky greeting header (doesn't move on pull-to-refresh), active cards with client name + task progress bar + Photo/Notes/Clock In actions (two-click confirm with 3s timeout), timeline-style future rows, compact completed rows, upcoming 7-day preview when 0 today, snap-first photo flow (auto-upload, optional caption via toast), shimmer skeleton loading
  - **TechTasks:** SVG completion ring (52px donut), 40px pill tabs, mini progress bars per job group, 56px rows, 26px checkboxes, swipe-to-complete with "Done" text + haptic at 40px threshold, checkbox pop animation, completed tasks at 0.5 opacity
  - **TechSchedule:** Division-colored left borders per row, time+duration left column, today header accent-colored, "You're all clear" empty state, jump-to-today FAB accent-colored with arrow icon, 72px min row height
  - **TechClaims:** Encircle-style rows (16px bold name, accent-colored address, claim number + date header, division/job count/status pills), 48px search bar (16px font prevents iOS zoom, 12px radius), empty state with search query + clear button
  - **TechAppointment:** Division gradient hero (water=blue, mold=pink, recon=amber, fire=red, contents=green), white text hierarchy, action bar (Navigate/Call/Message/Photo, 24px icons, 56px tall), 2-column photo grid (12px radius), pinch-to-zoom lightbox, relative timestamps on notes ("2h ago"), task progress bar
  - **TechClaimDetail:** Same division-gradient hero playbook as TechAppointment, applied to claim level. Kills the 5-accordion desktop layout in favor of: hero + 3-button action bar + context-aware Now-Next tile + large Jobs tiles + grouped Photos/Notes with lightbox album + collapsed reference details. Reusable component patterns (Hero, ActionBar, NowNextTile, PhotosGroup, Lightbox, DetailRow) are intentionally local to the file for now — will be promoted to `src/components/tech/` once TechJobDetail also uses them (planned follow-up task).
  - **Transitions:** Fade-up (translateY 8px) for tab switches, slide-from-right for drill-down, button scale(0.97) press feedback, checkbox pop animation
  - **Status colors:** Scheduled=blue, En Route=amber, Working=green, Paused=red, Completed=gray — visible from 3 feet away

---

## PWA (complete as of Mar 27 2026)
- **Manifest:** `public/manifest.json` — standalone display, portrait orientation
- **Service worker:** `public/sw.js` — cache-first for app shell, network-only for REST/API
- **Icons:** SVG icons at `/icon-192.svg` and `/icon-512.svg`
- **Install prompt:** TechLayout shows banner for field_tech when not in standalone mode (iOS: share instructions, Android: beforeinstallprompt)
- **Feature flag:** `feature:pwa` — enabled

### ⚠️ iOS PWA meta tags — DO NOT CHANGE without understanding this
- **`apple-mobile-web-app-status-bar-style` MUST stay `default`** in `index.html`. Do not change to `black-translucent`.
- **Why it matters:** iOS bakes the status-bar-style into the home-screen icon at install time. The service worker updates CSS/JS but **never** updates this meta — so a change affects only *future* installs, and old installs keep their original value forever.
- **The bug it causes (Apr 16 2026, fixed in commit `39c63c7`):** with `black-translucent` + `viewport-fit=cover`, iOS Safari PWAs report `100dvh` as screen-minus-safe-areas (e.g. 812 on iPhone 17 Pro, vs 874 screen height) while `env(safe-area-inset-bottom)` still returns 34px. The `.tech-layout` uses `100dvh`, so it stops 62px above the bottom of the screen, and `.tech-nav` adds its own 34px safe-area padding on top of that — resulting in ~96px of empty space below the bottom nav icons. With `default`, iOS places content below the status bar and `100dvh` covers the full usable viewport — both insets behave as expected.
- **Capacitor is unaffected** because its WKWebView doesn't apply the same viewport shortening — `100dvh` equals the full screen there.
- **Recovery for broken installs:** existing PWAs installed under the broken config cannot self-heal — users must remove the home-screen icon and re-add from Safari to pick up the new meta.
- **Debug recipe:** attach Safari Web Inspector to the iOS simulator's installed PWA (not Safari tab) and run in Console: `JSON.stringify({padBottom: getComputedStyle(document.querySelector('.tech-nav')).paddingBottom, height: getComputedStyle(document.querySelector('.tech-nav')).height, innerHeight: window.innerHeight, screenHeight: screen.height, standalone: matchMedia('(display-mode: standalone)').matches})`. If `innerHeight < screen.height` by more than ~34px, the viewport is being double-subtracted.

---

## Esign System (recon_agreement added Apr 16 2026)
- **Flow:** SendEsignModal → `/api/send-esign` → `sign_request` row → email via Resend (functions/lib/email.js)
- **Sign page:** `/sign/:token` — public, no auth — type (cursive/Dancing Script) or draw (canvas)
  - Desktop defaults to Type mode, Mobile defaults to Draw mode
- **PDF generation:** `/api/submit-esign` — pdf-lib, fetches template from DB, substitutes `{{variables}}`, multi-page
- **Open tracking:** `/api/track-open?t=<token>` — 1×1 pixel, updates `email_opened_at` + `email_open_count`
- **Resend:** `/api/resend-esign` — reuses same token, resets open tracking
- **Doc types:** `coc` (per-division ×5), `work_auth`, `direction_pay`, `change_order`, `recon_agreement`
- **Insurance clause:** insured job → direction-to-pay clause; OOP → conditional pre-assignment clause
- **Canvas DPR fix:** retina display handled via `initCanvas` + `setTransform` with `devicePixelRatio`
- **Token note:** `get_sign_request_by_token` takes `p_token TEXT` and casts to UUID internally
- **Template format:** `work_auth`, `direction_pay`, `change_order` use ONE row with inline `## heading` splits; `recon_agreement` uses 16 rows (one per section, sort_order 1–16, heading in `heading` column). `submit-esign.js` branches on `doc_type` to handle both.
- **Recon agreement specifics:**
  - Signer page renders `ReconAgreementContent.jsx` (expandable summary cards + full legal drawer + 4 attested consent checkboxes, amber branding)
  - All 4 consents required; `submit-esign` returns 400 if any missing
  - PDF includes an "ACKNOWLEDGMENTS — ATTESTED AT SIGNING" block with filled-amber checkbox rects
  - `recon_agreement` gets the company pre-authorization block (same as `work_auth` / `change_order`)
- **Audit trail:** `complete_sign_request` emits `system_events` row with `event_type='esign.signed'`, payload includes doc_type, signer info, divisions, and (for recon) the 4 consent booleans

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
- **Calendar events (kind='event'):** non-job blocks like meetings, PTO, training. Created via the "+ FAB" or empty-cell click which opens a Job-vs-Event picker. Event rows live in the same `appointments` table with `job_id=NULL` and are fetched via `get_dispatch_events`. `CalendarView.jsx` renders them with a pastel tech-color background + solid tech-color left border + 📅 icon prefix, hiding job-only chrome (address, job #, tasks). Clicking an event opens `EventModal.jsx` (create/edit combined); clicking a job still opens `EditAppointmentModal`. Division filter hides events; crew filter still applies. `hexToTint` helper lives in `src/lib/scheduleUtils.js`.

---

## Cloudflare Workers — Environment Variables
```
SUPABASE_URL                    — https://glsmljpabrwonfiltiqm.supabase.co
SUPABASE_SERVICE_ROLE_KEY       — Service role key (Cloudflare Pages secrets)
SUPABASE_ANON_KEY               — Anon key
VITE_SUPABASE_URL               — Same (Vite build)
VITE_SUPABASE_ANON_KEY          — Same (Vite build)
VITE_BUILD_TARGET               — "native" only set inside `npm run build:ios`; default web
RESEND_API_KEY                  — Resend API key (all transactional email; replaced SENDGRID_API_KEY Jun 2026)
EMAIL_FROM                      — optional sender override; default "Utah Pros Restoration <restoration@utahpros.app>" (domain must be verified in Resend)
EMAIL_REPLY_TO                  — optional reply-to override; default restoration@utah-pros.com
ENCIRCLE_API_KEY                — Encircle integration
QBO_CLIENT_ID                   — QuickBooks Online OAuth client id (Intuit Developer app)
QBO_CLIENT_SECRET               — QuickBooks Online OAuth client secret
QBO_ENVIRONMENT                 — "sandbox" | "production" (default production)
QBO_REDIRECT_URI                — https://dev.utahpros.app/api/quickbooks-callback (must match Intuit app exactly)
QBO_WEBHOOK_SECRET              — Shared secret; must equal integration_config.qbo_webhook_secret (DB trigger → worker auth)
APP_BASE_URL                    — Optional; base for the OAuth return redirect (default: origin of QBO_REDIRECT_URI)
DEMO_SHEET_FROM_EMAIL           — Optional override (default restoration@utah-pros.com)
DEMO_SHEET_TO_EMAILS            — Optional CSV override (default moroni.s@utah-pros.com,restoration@utah-pros.com)
TWILIO_*                        — 7 vars (pending go-live)
APNS_P8_KEY                     — AuthKey_XXX.p8 contents (PEM) — blocked on Apple Developer enrollment
APNS_KEY_ID                     — 10-char APNs Auth Key ID
APNS_TEAM_ID                    — 10-char Apple Developer Team ID
APNS_TOPIC                      — iOS bundle id, e.g. com.utahprosrestoration.upr
APNS_ENV                        — "sandbox" (TestFlight/dev) | "production" (App Store); defaults sandbox
```

**jsonResponse signature:** `jsonResponse(data, status, request, env)`

---

## QuickBooks Online Integration (Jun 18 2026 — Phase 1: customer sync)

One-directional push: when a paying-party contact (`role` in homeowner /
property_manager / tenant, with a non-empty name) is inserted into `contacts`,
it is created as a Customer in QuickBooks Online. Same worker + service-role
pattern as the Encircle sync.

**Data flow:**
`contacts` INSERT → trigger `trg_qbo_customer_sync` → `notify_qbo_customer_sync()`
fires `net.http_post` (pg_net, async, non-blocking) to `/api/qbo-sync-customer`
with `{ contact_id }` + an `x-webhook-secret` header → worker creates the QBO
customer → writes `qbo_customer_id` / `qbo_synced_at` back on the contact. The
trigger no-ops unless QuickBooks is connected, so it is safe to ship before
setup is finished.

**Tables (RLS-locked — service-role only; NO anon/authenticated policies):**
- `integration_credentials` — `provider PK, access_token, refresh_token, realm_id, environment ('sandbox'|'production'), token_expires_at, company_name, connected_by UUID→employees, connected_at, updated_at`. One row per provider (`'quickbooks'`). Access token auto-refreshes (~1h) inside the worker; refresh token rolls forward.
- `integration_config` — `key PK, value, updated_at`. Keys: `qbo_worker_url`, `qbo_webhook_secret`, plus transient `qbo_oauth_state` / `qbo_oauth_user` during connect.

**Columns added to `contacts`:** `qbo_customer_id TEXT`, `qbo_synced_at TIMESTAMPTZ`, `qbo_sync_error TEXT` (+ partial index `idx_contacts_qbo_unsynced`).

**RPCs (SECURITY DEFINER, granted to authenticated — never return tokens):**
- `get_integration_status(p_provider DEFAULT 'quickbooks')` → provider, connected, environment, company_name, realm_id, token_expires_at, connected_at
- `get_qbo_sync_stats()` → synced, pending, errored (counts over contacts)

**Workers:**
- `quickbooks-connect.js` — GET, authed (Supabase Bearer). Returns `{ url }` to start Intuit OAuth; stashes a CSRF `state`.
- `quickbooks-callback.js` — GET. Intuit redirect target; exchanges code→tokens, stores connection + company name, redirects to `/dev-tools?qbo=connected`.
- `qbo-sync-customer.js` — POST. Auth via `x-webhook-secret` (trigger) or Supabase Bearer (manual). Body `{ contact_id }`, `{ backfill:true, limit }`, or `{ backfill:true, dry_run:true }` (preview — reports would-create vs would-link, writes nothing). Dedup before create: matches an existing QBO customer by **email**, then by **normalized exact DisplayName** (links to it instead of duplicating); QBO 6240 duplicate-name handled by appending the phone's last 4. Backfill capped at 100/call. Logs to `worker_runs` as `qbo-sync-customer`.

**Lib:** `functions/lib/quickbooks.js` — OAuth exchange/refresh, `qboFetch`, `getValidAccessToken` (refreshes within 5 min of expiry), `mapContactToCustomer` (normalizes name whitespace), `queryCustomer`, `findExistingCustomer` (email → display-name dedup), `createCustomer`. Captures Intuit's `intuit_tid` from API responses (logged on every call; stored in `contacts.qbo_sync_error` on failures for support troubleshooting).

**UI:** DevTools → Integrations tab (Moroni-only) — Connect/Reconnect, connection status, synced/pending/error counts, **Preview sync** (dry-run with per-contact create/link breakdown), and "Sync existing customers" backfill.

**Environments / domains (IMPORTANT):**
- **dev branch → https://dev.utahpros.app** (Cloudflare **Preview** env) — staging; used for sandbox testing.
- **main branch → https://utahpros.app** (Cloudflare **Production** env) — what everyone uses; production QuickBooks runs here.
- `integration_config.qbo_worker_url` is the DB trigger's target; set to the **production** worker `https://utahpros.app/api/qbo-sync-customer`. Env vars must live in the matching Cloudflare environment (Preview for dev, Production for main).
- Public EULA/Privacy pages (required by the Intuit production profile) are served at `https://utahpros.app/terms` and `/privacy` (`src/pages/Legal.jsx`). Connecting your own company needs production keys but **no marketplace review**.

**Production setup checklist:**
1. developer.intuit.com → get **Production** Client ID + Secret. Add redirect URI `https://utahpros.app/api/quickbooks-callback` under the **Production** Redirect URIs tab; set EULA=`/terms`, Privacy=`/privacy`, host domain=`utahpros.app`.
2. Cloudflare **Production** env vars: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT=production`, `QBO_REDIRECT_URI=https://utahpros.app/api/quickbooks-callback`, `QBO_WEBHOOK_SECRET` (must equal `integration_config.qbo_webhook_secret`). Redeploy.
3. https://utahpros.app/dev-tools → Integrations → Connect QuickBooks → authorize your real company.
4. Preview sync → review → "Sync existing customers" to backfill the existing paying-party contacts.

(Sandbox testing used the same flow with `dev.utahpros.app` URLs, `QBO_ENVIRONMENT=sandbox`, and the Development-tab redirect URI. Before the production cutover, clear the sandbox connection (`DELETE FROM integration_credentials WHERE provider='quickbooks'`) and reset `contacts.qbo_customer_id/qbo_synced_at/qbo_sync_error` to NULL so the production backfill processes everything fresh.)

**Scope:** Customers + invoices, one-way (UPR→QBO). Customer dedup matches on email + exact (normalized, case-insensitive) name; fuzzy/spelling variants are not caught. Phone-only stubs later given a name+role are NOT caught by the contacts INSERT trigger — use the backfill.

---

## QuickBooks Online — Invoices (Jun 18 2026 — Phase 2a)

**One invoice per job (= per division)** — insurance pays each category (mitigation, reconstruction) on separate checks, so each check applies to its own single-class invoice. UPR's `invoices` / `invoice_line_items` / `invoice_adjustments` tables are the source of truth (draft → push to QBO); QBO gets a clean summary invoice.

**Read endpoint:** `functions/api/qbo-query.js` — POST, SELECT-only QBO query passthrough (Items/Classes/Invoices); auth via `x-webhook-secret` or Supabase Bearer; tokens stay server-side.

**Foundation (`migrations/20260618_invoice_qbo_foundation.sql`):** `invoices.qbo_invoice_id/qbo_synced_at/qbo_sync_error`; `generate_invoice_number()` (seq `invoice_number_seq` → `INV-######`); `create_draft_invoice_for_job()` AFTER INSERT trigger on `jobs` (one draft per job), **gated by `integration_config.auto_draft_invoices` (default `'false'` = dormant)**.

**Push worker:** `functions/api/qbo-invoice.js` — POST `{ invoice_id }` creates the QBO invoice (one line: division→Item+Class via `divisionToQbo`, amount = `adjusted_total`/`total`, customer = contact `qbo_customer_id`, claim/job ref in PrivateNote); idempotent on `qbo_invoice_id`. `{ invoice_id, action:'delete' }` removes it from QBO. `{ invoice_id, action:'send', send_to? }` asks QBO to **email the invoice to the customer** (QBO `/invoice/{id}/send` via `sendInvoice()`; recipient defaults to the invoice contact's email, override with `send_to`); on success stamps `invoices.qbo_emailed_at` + `qbo_email_status` (+ `sent_to_email`). Surfaced as the "Email to customer" button (two-click confirm) in `InvoiceEditor.jsx`. Logs `worker_runs` as `qbo-invoice`.

**On-demand draft RPC (`migrations/20260618_invoice_create_rpc.sql`):** `create_invoice_for_job(p_job_id, p_created_by DEFAULT NULL) RETURNS invoices` — idempotent (returns existing invoice for the job if any), else inserts a `'draft'` `'standard'` invoice with `generate_invoice_number()`. Granted to `authenticated`. Used by the Billing UI's "Create invoice" button (works without the dormant auto-draft trigger).

**Billing UI (`src/components/ClaimBilling.jsx`):** rendered on the Claim page (`ClaimPage.jsx`, desktop SectionCard + mobile CollapsibleSection — relocatable later). Props `{ jobs, db, canEdit }`. One row per job/division: Create invoice → set amount (`db.update invoices subtotal/total`) → **Push to QuickBooks** (`POST /api/qbo-invoice`) with a QBO-synced/Error badge; "Remove from QuickBooks" (delete action) once synced. All edit actions gated behind `canEdit`.

**AR mapping (`migrations/20260618_invoice_to_job_ar_sync.sql`):** trigger `trg_invoices_sync_job_ar` (AFTER INSERT/UPDATE/DELETE on `invoices`) → `sync_job_invoiced_from_invoices(job_id)` keeps `jobs.invoiced_value` / `invoiced_date` in sync from invoices, so the existing **Financials/Collections dashboard** (which reads `jobs.invoiced_value` via `getBalances()`) reflects QBO automatically. "Invoiced" = pushed to QBO (`qbo_invoice_id IS NOT NULL`); billed amount = `SUM(COALESCE(adjusted_total, total))`; `invoiced_date` stamped from `min(qbo_synced_at)` (COALESCE — never overwrites a set date). **Non-destructive**: only writes a job that has ≥1 pushed invoice, so legacy hand-entered values (no invoices / drafts only) are never zeroed. Drafts and "Save amount" don't move AR until pushed. **Collected ($) still hand-logged** (PaymentModal → `jobs.collected_value`); QBO payment sync is phase 2c.

**Read-time repoint (`migrations/20260618_get_job_financials.sql` + `lib/claimUtils.js`):** the `invoices` table is the **source of truth** for the Financials/Collections views. RPC `get_job_financials(p_job_ids uuid[] DEFAULT NULL) RETURNS TABLE(job_id, invoice_count, invoiced, collected, balance_due, deductible, insurance_responsibility, homeowner_responsibility, depreciation_withheld, depreciation_released, invoiced_date)` rolls up **pushed** invoices per job (`qbo_invoice_id IS NOT NULL`; granted `anon, authenticated`). `claimUtils.withJobFinancials(db, jobs)` overlays that rollup onto job objects (attaches `job._fin`, overrides `invoiced_value`; `collected_value` only when invoice `amount_paid > 0`) with **COALESCE fallback** to the legacy `jobs` fields — a job with no pushed invoices renders exactly as before. `getBalances()` prefers `job._fin` (invoiced + deductible) when present, else legacy. Wired into `ClaimCollectionPage`, `ClaimPage`, `Jobs`, `Production`, `JobPage`. `CustomerPage` (`get_customer_detail`) and `MergeModal` still read `jobs.invoiced_value`, kept accurate by the AR-sync trigger. The trigger is **retained** as a denormalized projection (belt-and-suspenders + covers the non-overlaid consumers); read-time and trigger use identical definitions so they always agree. Rollup failures degrade silently to legacy values.

**Division → QBO (`lib/quickbooks.js` `divisionToQbo`):** recon→Item `1010000201` + class Reconstruction; water/mit→Item `1010000071` + class Mitigation; mold→Item `1010000131` (no class); contents→Item `38` (no class). Insurance-adjustment item `1010000231`. Class Ids resolved at runtime by name. **Invoice numbering (Jun 20 2026):** the worker sends the **job number as the QBO `DocNumber`** (on create + update; unique since one invoice per job, ≤21 chars). The QBO company has *Custom transaction numbers* ON — so when we sent no DocNumber, QBO left the invoice number **blank**; supplying the job number fixes that and makes the QBO invoice number == the job number. (If that QBO setting is ever OFF, QBO ignores the supplied number and auto-numbers — still safe.) The worker captures `qboInv.DocNumber` back into **`invoices.qbo_doc_number`**, and the UI displays that (UPR's `INV-######` is only the pre-send draft handle). **QBO memo (standard):** `Date of loss: <dol> · Job: <job#> · Claim: <claim#> · Service Address: <full addr>` — written to BOTH `CustomerMemo` (prints on the invoice; needs QBO *Sales → Message to customer*, on by default) and `PrivateNote` (internal). The job's **service address** (`jobs.address/city/state/zip`, claim loss-address fallback — can differ from billing) + date of loss come from the job (claim fallback). The address also goes to the invoice's structured **`ShipAddr` (Ship To)** — full length, no 31-char cap, prints when QBO *Sales → Shipping* is on. We **no longer write the legacy 31-char custom field** — on QBO Advanced the enhanced/named custom fields aren't writable via the v3 API (only the 3 legacy string fields are; Intuit's GraphQL Custom Fields API is Gold/Platinum-partner-gated), so Ship To + CustomerMemo are the right writable homes. `get_ar_invoices` / `get_payments_ledger` return `qbo_doc_number`; linkage is by `qbo_invoice_id` (internal id).

**Status:** foundation + push worker + Billing UI + AR mapping trigger + **read-time repoint** (dashboard reads `invoices` via `get_job_financials`, legacy fallback) live on prod, validated (real QBO invoice created/deleted; AR-sync trigger verified; `get_job_financials` applied + returns clean with the table empty; full Vite build passes). **Remaining 2a:** flip `auto_draft_invoices` → `'true'` once Moroni has tested the Billing UI on prod. **2b:** UPR invoice editing UI (line items, adjustments) + two-way sync — then surface the richer rollup fields the dashboard now has access to (insurance/homeowner split, depreciation). **2c:** payments sync → invoice `amount_paid` (`collected` auto-switches to invoice-sourced once `> 0`). **Future:** once invoicing is steady-state, retire the hand-entered Revenue editor + `jobs.invoiced_value` mirror and drop the trigger.

**Employee guide / in-app tutorial:** `UPR-Invoicing-Financials-Employee-Guide.md` (markdown source) → `public/UPR-Invoicing-Financials-Guide.pdf` (downloadable; generated by `scripts/build-invoicing-guide-pdf.py` via reportlab — keep the two in sync if content changes). **Jun 20 2026: Help page, markdown guide, and PDF all rewritten to the current flow** — line-item builder on the dedicated `/invoices/:id` editor, "+ New invoice" picker, Send/Update to QuickBooks, payment recording that auto-syncs to QBO, and the Stripe card pay-link. In-app tutorial `src/pages/Help.jsx` at route `/help` (App.jsx), with a Download-PDF button. Linked from `Sidebar.jsx` as **Help & Guides** rendered as a **standalone NavLink outside the `canAccess` gate** (canAccess is default-deny for keys without a `nav_permissions` row, so a normal NAV_ITEMS entry would show for admins only) — this makes it visible to every logged-in office user.

**Phase 0.5 shipped (auto-push invoice edits):** `qbo-invoice` worker now creates **or** updates a QBO invoice (was create-only; new `updateInvoice()` in `functions/lib/quickbooks.js` does GET-SyncToken → sparse update). `ClaimBilling.jsx` autosaves the amount on blur and auto-pushes (no manual Save/Push buttons) with a Syncing/QuickBooks #/Error/Draft chip; editing a synced invoice re-syncs it; `$0` drafts stay local. UI-driven (only edit path today) to give immediate feedback and avoid a worker-writeback trigger loop. Employee tutorial (Help page + guide + PDF) updated to match.

**Billing safeguards (Jun 18):** Billing section gated by feature flag `feature:billing` (in `feature_flags`, enabled; OFF = hidden for everyone, or set `dev_only_user_id` to limit to one person — all from Dev Tools). New helper `canEditBilling(role)` in `claimUtils` = **admin + manager only**, used for Billing edit (`ClaimPage` → `canEditBill`) and Collections A/R edits (`ClaimCollectionPage`: Log Payment / A/R status / mark-deductible / Notes hidden or disabled for other roles → read-only A/R). `ClaimBilling`: "Remove from QuickBooks" now needs a two-click confirm; the first push of a new invoice is an explicit **Send to QuickBooks** click (edits to an already-synced invoice still auto-sync). These are UI-level gates — deeper enforcement (RLS / RPC role checks) is future hardening.

**Active initiative status/handoff (start here when resuming): `QBO-BILLING-STATUS.md`.** **Next phases — see `QBO-PHASE-2-PLAN.md`** (repo root): two-way QBO↔UPR sync roadmap. Priority Phases 1–3 = inbound webhook infra (`qbo-webhook` + `qbo_sync_events` queue + CDC reconcile cron) → **payments QBO→UPR** → **invoice changes QBO→UPR**, then customer two-way, invoice-editing depth (2b), and A/R ops. Key planned schema: `qbo_sync_events`, `invoices.qbo_sync_token`, `payments.qbo_payment_id`+`source`; new env `QBO_WEBHOOK_VERIFIER_TOKEN` (distinct from the internal `QBO_WEBHOOK_SECRET`).

---

## "+ New invoice" job picker (Jun 20 2026)

`src/components/NewInvoiceModal.jsx` — shared job-picker that calls the idempotent
`create_invoice_for_job(p_job_id)` RPC and opens `/invoices/:id` (one invoice per job;
opens the existing invoice if the job already has one). Two modes: **customer-scoped**
(pass `{ contact, claims }` — reuses already-loaded `get_customer_detail` data, no extra
query) and **global** (no props — customer typeahead via `search_contacts_for_job`, then
that customer's claims→jobs). Rows badge "Has invoice" vs "New". Entry points: Customer
page header button (gated `feature:billing` + `canEditBilling`) and a global **+ New
invoice** button on the Collections hub header.

---

## Stripe — Card Payments & Fee Automation (S3 — Jun 20 2026, DORMANT)

Live card/ACH collection + automated QuickBooks fee reconciliation. **All code is shipped
but inert until the `STRIPE_*` keys exist in Cloudflare** — every Stripe worker returns
`503 {error:'Stripe not configured'}` when unconfigured, and the UI shows "not set up yet"
toasts. One-way UPR→QBO is preserved; **UPR is the only writer to QBO** (do NOT also run
Stripe's QBO connector / Synder — it would double-post).

**Pattern (clearing-account fee automation):** customer pays via a UPR pay-link →
Stripe's webhook records the **gross** as a UPR payment and pushes it to QBO **deposited
to a "Stripe Clearing" bank account** → the exact `balance_transaction.fee` is booked as a
QBO **Purchase** (clearing → Merchant Fees) → on `payout.paid` a QBO **Transfer** moves the
**net** (clearing → real bank). Clearing self-zeroes; the bank reconciles to the Stripe
payout exactly.

**Env to add (Cloudflare Pages — Preview for dev, Production for main):**
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (the last from the
registered webhook endpoint). Optional `APP_BASE_URL` for Checkout success/cancel return
URLs (defaults to the request origin).

**Migration `20260620_stripe_s3.sql` (applied):**
- `invoices`: `stripe_payment_link_url`, `stripe_checkout_session_id`, `stripe_payment_link_created_at`.
- `payments`: `source` ('manual'|'stripe', default 'manual'), `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_fee`, `stripe_fee_qbo_purchase_id`; unique index `payments_stripe_charge_uniq` on `stripe_charge_id` (charge-level idempotency).
- `stripe_events` — webhook idempotency ledger (`id` PK = Stripe event id, type, status, payload, error, timestamps). **RLS enabled, NO policies** (service-role only, like `integration_credentials`).
- `claim_stripe_event(p_id, p_type) RETURNS boolean` — race-safe `INSERT … ON CONFLICT DO NOTHING` claim (TRUE = new/process, FALSE = duplicate/skip). Granted to `service_role`.
- `get_billing_settings`/`set_billing_setting` — added keys: `qbo_bank_account_id/name` (QBO deposit bank = Transfer destination), `stripe_payout_bank_id/name` (standard payout checking account), `stripe_instant_card_id/name` (instant-payout debit card). `stripe_connected` stays read-only here (workers set it).

**Lib `functions/lib/stripe.js`** (fetch-only, V8-safe): `stripeConfigured`, `stripeFetch` (form-encoding + idempotency key), `constructEvent` (Web Crypto HMAC-SHA256 signature verify over the raw body + tolerance), `retrieveCharge`/`getBalanceTransaction`/`retrievePaymentIntent`, `createCheckoutSession`, `listExternalAccounts` (banks+cards via `GET /v1/accounts/{id}/external_accounts`), `getInstantAvailable` (`/v1/balance`), `createPayout`.

**Lib `functions/lib/quickbooks.js`** (extended): `createPayment` gains optional
`depositAccountId` → `DepositToAccountRef` (Stripe deposits to clearing; manual payments
unchanged). New `createPurchase` (fee expense, paid-from clearing → Merchant Fees),
`createTransfer` (clearing → bank), `deleteEntity(entity, id)` (S4 reversal helper).

**Workers (`functions/api/`):**
- `stripe-webhook.js` — Stripe signature auth (no Bearer). `payment_intent.succeeded` → record gross UPR payment (source 'stripe') + push to QBO (deposit to clearing) + book fee Purchase. `payout.paid` → Transfer net (clearing → `qbo_bank_account_id`). Event-level idempotency via `claim_stripe_event`; charge-level via the unique index. Returns 200 even on QBO sub-failure (payment still recorded; error stored on the payment + event) so Stripe doesn't retry into the guard. Logs `worker_runs` as `stripe-webhook`.
- `stripe-pay-link.js` — POST `{ invoice_id }` (Supabase Bearer); creates a Checkout session for the balance, stores link/session on the invoice, returns `{ url }`.
- `stripe-payout.js` — POST `{ amount? }` (Supabase Bearer); instant payout to `stripe_instant_card_id` (defaults to full `instant_available`).
- `stripe-accounts.js` — GET (Supabase Bearer); lists external accounts for the payout selectors; flips `stripe_connected=true` on first successful key use.
- `billing-2fa.js` — email-2FA gate for the payout destinations (below). POST `{action:'request'}` emails a 6-digit code to the owner (Resend); `{action:'commit', code, changes}` verifies and writes the protected keys via service role. Admin/manager only.

**Payout-destination email-2FA (`migrations/20260620_payout_2fa.sql`):** changing the
Stripe deposit bank / instant-payout debit card is a money-movement action, so it is NOT a
plain edit field. The four payout keys (`stripe_payout_bank_id/name`,
`stripe_instant_card_id/name`) were **removed from the open `set_billing_setting`
whitelist** — only the `billing-2fa` worker (service role) writes them, after verifying a
one-time code emailed to the owner (`integration_config.billing_2fa_email`, default
`moroni.s@utah-pros.com`). Codes are single-use, 10-min, SHA-256-hashed in the RLS-locked
`billing_2fa_codes` table. **Email now sends via Resend** (functions/lib/email.js, Jun 2026 —
replaced the dead SendGrid path). Requires RESEND_API_KEY + a verified utahpros.app sending
domain in Resend; if email is down, these fields can't be changed until it's restored.

**Frontend:** `InvoiceEditor.jsx` — Create/Copy pay-link action + active-link banner.
`PaymentSettings.jsx` — "Load from Stripe" probe; live Instant Payout button once
connected; the QBO deposit bank-account selector; and a **locked "🔒 Payout destinations"
panel** whose Edit flow emails a verification code (via `billing-2fa`) before saving the
bank/card (manual label, or live dropdown once Stripe is connected).

**S4 — refunds & disputes (`migrations/20260620_stripe_s4.sql`, applied):** `payments`
gains `refunded_amount` / `refunded_at` / `dispute_status`, and `update_invoice_paid` was
rewritten to net `refunded_amount` out of collected (defaults 0 → no change for existing
rows) and to reopen a paid invoice's status when collected drops to 0. The `stripe-webhook`
now handles **`charge.refunded`** (net the refund; on a FULL refund reverse the QBO Payment
+ fee Purchase via `deletePayment`/`deleteEntity`; partial refunds net in UPR and flag QBO
for a manual reduction) and **`charge.dispute.created`** (reopen A/R + reverse the QBO
Payment + stamp `dispute_status`). `ClaimBilling` shows a red **Refunded/Disputed** chip on
the payment. *Follow-ups: dispute fee + won/lost resolution (re-record on win), and
auto-reducing a QBO payment on partial refund.* **Also fixed in S4:** the S3 webhook mapped
ACH to `'eft'`, which violates the `payments_payment_method_check` — now `'ach'`.

**Status:** S3 + S4 built; builds/lints clean; both migrations applied & verified
(columns, RLS-locked ledgers, idempotency true→false, trigger nets refunds). **Activation
pending owner Stripe setup** (keys + QBO "Stripe Clearing"/"Merchant Fees"/deposit-bank
accounts mapped on `/payments/settings` + webhook endpoint registered →
`STRIPE_WEBHOOK_SECRET`, subscribing `payment_intent.succeeded`, `payout.paid`,
`charge.refunded`, `charge.dispute.created`). Then a live test on dev. See
`QBO-BILLING-STATUS.md` §4 for the exact click-path.

---

## UPR MCP Server — owner-only remote MCP for QBO + UPR DB (Jun 23 2026)

Standalone Cloudflare **Worker** (`upr-mcp/`, NOT part of the Pages app) exposing a remote **Model Context Protocol** server, so QuickBooks Online and the UPR database can be driven from any Claude chat (web/desktop/mobile) via a custom connector.

- **URL:** `https://upr-mcp.moroni-s.workers.dev` — MCP endpoint `/mcp`.
- **Deploy:** Cloudflare **Workers Builds** connected to the GitHub repo. Production branch **`main`**, root directory `upr-mcp`, deploy command `npx wrangler deploy`; auto-redeploys on push to `main`. **Mirror every `upr-mcp` change to `dev` too** (policy: dev never behind main). Needs a `package-lock.json` (Cloudflare runs `npm ci`).
- **Auth — two layers:** (1) *Claude → server*: OAuth 2.1 via `@cloudflare/workers-oauth-provider`, federated to **Google**, allowlisted to `ALLOWED_EMAIL` (moroni.s@utah-pros.com); grants/tokens in KV binding `OAUTH_KV`. (2) *server → QBO*: reuses UPR's existing connection (tokens in `integration_credentials`). Supabase via service-role key.
- **Secrets (wrangler):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`. Vars: `QBO_ENVIRONMENT`, `ALLOWED_EMAIL`.
- **Safeguards:** every write tool requires `confirm: true` (returns a preview otherwise); every call logged to `upr_mcp_audit`; kill switch `integration_config.upr_mcp_enabled = 'false'`; allowlisted email re-checked on every call.
- **Transport gotcha:** `GET /mcp` MUST return a `text/event-stream` SSE stream — Claude's connector opens it and won't send `POST initialize` until it does (returning 405 breaks the connect). `POST /mcp` handles JSON-RPC (stateless).

**Tools**
- QBO read: `qbo_query`, `qbo_get`, `qbo_list_invoices`, `qbo_list_payments`, `qbo_list_estimates`, `qbo_report`.
- QBO write: `qbo_create_invoice`, `qbo_update_invoice`, `qbo_delete_invoice` (refuses invoices with payments), `qbo_create_payment`, `qbo_relink_payment`, `qbo_delete_payment`, `qbo_create_customer`, `qbo_update_customer`, `qbo_create_item`, `qbo_create_entity` / `qbo_update_entity` / `qbo_delete_entity`, `qbo_send_invoice` (emails the customer), `qbo_create_estimate`.
- UPR DB: `upr_select`, `upr_rpc` (any of the ~150 RPCs — **mutating fns gated**: names not starting get_/list_/search_/preview_/count_/fetch_ require `confirm`), `upr_schema` (tables + functions), `upr_describe` (a table's columns / an RPC's params), `upr_search` (cross-entity find: contacts/jobs/claims), `upr_insert`, `upr_update`, `upr_delete` (filter required).

**New table:** `upr_mcp_audit` (see Logging & Monitoring). **New RPC:** `get_upr_mcp_audit(p_limit)`.
**Files:** `upr-mcp/{wrangler.toml, package.json, package-lock.json, src/index.js, auth.js, mcp.js, qbo.js, supabase.js, tools.js, audit.js}`; migration `supabase/migrations/20260622_upr_mcp_audit.sql`.

---

## Mobile Layout
- **Bottom bar:** 4 tabs (Dashboard, Messages, Jobs, Schedule) + More → opens sidebar
- **Sidebar:** slides in from left via `sidebar-open` class
- **Safe area:** footer uses `env(safe-area-inset-bottom)` for iPhone home bar
- **Pull to refresh:** `PullToRefresh` component wraps page content
- **iOS auto-zoom fix:** all inputs must have `font-size: 16px`
- **CSS transforms:** cause content clipping on real iPhones — use display toggle instead

---

## Native iOS App (Capacitor) — In Progress

- **Bundle id:** `com.utahprosrestoration.upr`
- **Source:** `ios/App/App.xcodeproj` (SPM, not CocoaPods — Capacitor 8 default)
- **Config:** `capacitor.config.json` — `ios.contentInset: "never"` (let CSS handle safe areas)
- **Build:** `npm run build:ios` — sets `VITE_BUILD_TARGET=native`, runs Vite + `cap sync ios`
- **Router split:** `src/App.jsx` renders `NativeRoutes` (only `/login` + `/tech/*`) when `VITE_BUILD_TARGET=native`; admin pages are excluded from the native bundle (~40% smaller)
- **Plugins installed:**
  - `@capacitor/camera` — TechDash + TechAppointment use native camera via `src/lib/nativeCamera.js`, fall back to photo library on simulators
  - `@capacitor/push-notifications` — `src/lib/pushNotifications.js` registers + upserts to `device_tokens` on login; APNs delivery via `functions/api/send-push.js` — blocked on Apple Developer enrollment + `APNS_*` env vars
  - `@capacitor/geolocation` — `src/lib/nativeGeolocation.js` captures coords on OMW + Start Work (saved to `job_time_entries.travel_start_lat/lng` and `clock_in_lat/lng`); TechDash renders an "away from jobsite" banner when current position is >200m from `clock_in_lat/lng` for an in_progress/paused appointment (foreground check on mount + app resume)
  - `@capacitor/haptics` + `@capacitor/status-bar` + `@capacitor/splash-screen` — `src/lib/nativeHaptics.js` (impact/notify) and `src/lib/nativeAppearance.js` (statusBarLight/Dark, hideSplash). Splash held until React mounts, status bar flips to light on TechAppointment's gradient hero and back to dark elsewhere.
  - `@aparajita/capacitor-biometric-auth` — `src/lib/nativeBiometric.js` + `<BiometricGate>` in App.jsx. Cold-launch gate on native: if a Supabase session exists and the flag is set, show "Unlocking UPR…" lock screen and prompt Face ID / Touch ID / passcode. Cancel or failure → sign out + show login. Flag is enabled in Login.jsx after a successful password login on native, cleared in AuthContext.logout. Token still lives in localStorage — full Keychain migration is future hardening.
  - `@capgo/capacitor-updater` — OTA React/CSS/HTML updates without App Store resubmit. `src/lib/nativeUpdater.js` exposes `markBundleReady()` (called on App.jsx mount — critical, Capgo rolls back otherwise), plus `checkForUpdate` and `getCurrentBundleInfo` helpers. `capacitor.config.json` plugin config: `autoUpdate: true`, `defaultChannel: production`, auto-cleanup on success/fail.
- **OTA deploy pipeline:** `.github/workflows/capgo-deploy.yml` runs on push to `main` (production channel) or `dev` (beta channel). Requires GitHub repo secrets `CAPGO_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. One-time setup on Capgo dashboard: create app, generate API token.
- **Permission strings in Info.plist:** `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSFaceIDUsageDescription`
- **Deferred:** `@capacitor-community/privacy-screen` (app-switcher blur) — published version targets Capacitor 7, incompatible with our Capacitor 8 plugins. Re-enable when a Cap-8 compatible version ships; `enablePrivacyScreen()` is already a no-op stub.
- **Task tracker:** `CAPACITOR-TASK.md` (removed when all phases ship)

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

**All DevTools phases complete.** 8 tabs: Flags, Health, Employees, Workers, Backfill, Integrity, Messaging, Advanced.

**Backfill tab** (Apr 18 2026) — 6-month Encircle historical importer UI.
- Date-range + `date_field` (`date_of_loss` | `created_at`) picker
- Division strategy: `smart` (by `type_of_loss`) or `fixed` (user picks divisions)
- Behavior toggles: skip already-imported, repair orphans, skip no-phone claims, writeback CLM
- Preview (dry-run GET) renders totals grid + per-claim action table (new/repair/skip)
- Run (POST) executes with two-click confirm; result card shows counts, errors, 5 random samples with Encircle links
- Calls `/api/encircle-backfill` worker; logs to `worker_runs` as `encircle-backfill`

**Encircle integration patterns (four entry points):**
- `sync-encircle` — automated 15-newest sync, hardcoded `division='reconstruction'`, jobs only. Scheduled worker. Legacy. Fixed Jun 9 2026: upsert now targets `on_conflict=encircle_claim_id,division` (was `encircle_claim_id` alone, which has no matching unique index → 42P10 → "Supabase upsert failed").
- `encircle-import` — manual UI at `/import/encircle`, one claim at a time, full contact→claim→jobs chain + CLM writeback. Fixed Jun 9 2026: `loss_type` is now normalized via `normalizeLossType()` before the claims insert (Encircle sends free text / `type_of_loss_*` prefixed values which violated `claims_loss_type_check`; unmappable values fall back to `'other'`).
- `encircle-backfill` — batch worker, date-range + cursor pagination, full chain + orphan repair + gated writeback (only when Encircle `contractor_identifier` is empty).
- `sync-claim-to-encircle` (Apr 18 2026) — pushes UPR-native claims UP to Encircle. Fired automatically from CreateJobModal + TechNewJob after `create_job_with_contact` RPC succeeds. Idempotent via `claims.encircle_claim_id`. Failures stored on `claims.encircle_sync_error` and surfaced in DevTools → Backfill → Unsynced Claims panel with per-row retry **and a bulk "Sync Selected" button** (checkboxes default to all-selected; uncheck test rows before syncing; pushes sequentially with live `done/total` progress; dedup guard makes repeats safe). On success writes Encircle id back to `claims.encircle_claim_id` AND all child `jobs.encircle_claim_id`.
  - **Reliability fix (Jun 18 2026):** the client call in CreateJobModal + TechNewJob was *fire-and-forget* — when the page tore down (mobile app backgrounding, TechNewJob's immediate `navigate(-1)`, tab close) the request was abandoned, leaving the claim unsynced with **no `encircle_sync_error` recorded** (the tell: 17 unsynced claims, 0 errors, while every push that actually ran succeeded). Symptom users reported as "new claim under an existing client doesn't reach Encircle" — but it was not existing-client-specific (existing-client claims synced 9/12; the misdiagnosis led staff to duplicate clients as a workaround). Fix: both callers now **`await syncClaimToEncircle()` (8s AbortController timeout) before navigating/closing**, so the request completes while the page is alive (connectivity is guaranteed — the `create_job_with_contact` RPC just succeeded online). On timeout it proceeds without blocking (claim shows in the Unsynced panel).
  - **Duplicate guard (Jun 18 2026):** before creating, the worker searches Encircle by `contractor_identifier` (our CLM via `findExistingEncircleClaimByClm`); an exact CLM match links to the existing Encircle claim instead of creating a second one. Protects against retries, double-submits, failed write-backs, and any future overlap between the client push and a server-side sweep. Response carries `deduped: true` when it links rather than creates.
  - **Internal trigger auth (Jun 18 2026):** the worker's POST now accepts EITHER a logged-in user (UI) OR a valid `x-webhook-secret` header matching `integration_config.encircle_sweep_secret` (RLS-locked key/value table created by the QuickBooks migration; the worker reads it with its service-role key). This lets the database push claims server-side via `pg_net` without a user session and without any new Cloudflare env var — mirrors the QuickBooks `notify_qbo_customer_sync` trigger pattern (does NOT reuse the QBO secret). Used Jun 18 2026 to backfill the historical unsynced real claims (test/junk rows excluded). The existing user-auth path is unchanged. This same hook can later drive a recurring `pg_cron` sweep if desired.

**Idempotency rules:**
- Jobs: composite unique `(encircle_claim_id, division)` — upsert target for multi-division claims. Made non-partial Jun 9 2026 (was `WHERE encircle_claim_id IS NOT NULL`, which PostgREST `on_conflict` inference can't match); behavior is identical since NULLs never conflict in unique indexes.
- Claims: `encircle_claim_id TEXT` (added Apr 18 2026, non-unique index because one pre-existing dupe on encircle_claim_id 4517466). Linked via backfill from jobs. Populated going forward by sync-claim-to-encircle.
- Contacts: `phone UNIQUE NOT NULL`; email fallback lookup only when matched row has `phone IS NULL`.
- `type_of_loss` values come prefixed (`type_of_loss_water`, `type_of_loss_mold`). Smart mapping: water/sewer/flood → `[water, reconstruction]`; mold → `[mold]`; fire/smoke → `[fire, reconstruction]`; wind/storm/hail → `[reconstruction]`; unknown → `[water, reconstruction]`.

**Claims schema additions (Apr 18 2026):**
- `encircle_claim_id TEXT` — Encircle PropertyClaim id linked to this UPR claim (for bidirectional sync)
- `encircle_synced_at TIMESTAMPTZ` — when the link was established
- `encircle_sync_error TEXT` — last sync error message (cleared on success)

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
10. **~~TechJobDetail follow-up~~ COMPLETE (Apr 16 2026)** — `/tech/jobs/:jobId` now renders the purpose-built `TechJobDetail.jsx`; `/tech/jobs/:jobId/photos` renders `TechJobAlbum.jsx`. Shared primitives (Hero, ActionBar, NowNextTile, PhotosGroup, Lightbox, DetailRow) promoted to `src/components/tech/`; small helpers (formatTime, relativeDate, photoDateTime, fileUrl, openMap) promoted to `src/lib/techDateUtils.js`. Desktop `JobPage` unchanged at `/jobs/:jobId`.
11. **Desktop ClaimPage photo URL bug** — noticed during TechClaimDetail build: desktop `ClaimPage.jsx` builds photo URLs as `${db.baseUrl}/storage/v1/object/public/job-files/${doc.file_path}` but `doc.file_path` already starts with `job-files/`, producing a double prefix. TechClaimDetail uses the correct pattern: `${db.baseUrl}/storage/v1/object/public/${doc.file_path}`. Desktop photos may not be loading — verify.
12. **In-app SMS** — TechClaimDetail + TechAppointment Message buttons open native `sms:` compose; swap to in-app Messages flow when available (search `TODO: switch to in-app SMS` in tech files).
13. **Claim-level photo attachments** — TechClaimDetail uploads with `p_appointment_id: null`. On multi-job claims, the tech is prompted to pick which job the photo attaches to. Single-job claims direct-fire to `jobs[0].id`.

---

## Encircle Replacement — Phase 1 + 1.5 (Apr 17 2026)

The Encircle replacement build is scoped as a 6-8 week effort ending with Hydro
(moisture readings, IICRC S500) and a Water Loss Report PDF. Phase 1 + 1.5
landed Apr 17 and covers rooms + offline-first photo capture.

### What's live
- **Rooms** — claim-scoped per `rooms` table. UI: Rooms grid on TechClaimDetail,
  dedicated TechRoomDetail page with Photos/Notes tabs. Add Room sheet with 16
  starter templates + custom name. All feature-gated behind `page:tech_rooms`.
- **PhotoNoteSheet** — shared bottom sheet used post-upload. Two tabs (Note +
  Room). Extracted from duplicated JSX in TechAppointment.jsx and TechDash.jsx.
- **Offline queue** — IDB-backed write queue. All four photo capture surfaces
  (TechAppointment, TechDash ActiveCard, TechClaimDetail, TechRoomDetail) route
  through it when `offline:queue` is enabled. Sync runner drains on online/
  visibilitychange/30s poll with exponential backoff (1s/4s/15s/1m/5m). Max 5
  retries before status=error. OfflineStatusPill in TechLayout shows
  "Syncing N" / "N failed" (tap to retry) / brief "Synced" flash.
- **Service worker** — `public/sw.js` CacheFirst for /assets and Supabase
  Storage reads under job-files/; NetworkFirst (3s timeout → cache) for the
  three cacheable RPCs: get_job_rooms, get_appointment_detail,
  get_my_appointments_today. Cache name `upr-v1`.
- **5 feature flags** seeded dev-only for Moroni Salvador admin
  (`d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da`):
  - `page:tech_rooms` — Rooms UI + PhotoNoteSheet Room tab
  - `page:tech_moisture` — Phase 2 Hydro (placeholder)
  - `page:tech_equipment` — Phase 2 equipment placements (placeholder)
  - `page:water_loss_report` — Phase 3 PDF (placeholder)
  - `offline:queue` — Queue kill-switch; on = enqueue path, off = inline path

### New files
```
src/components/tech/
  PhotoNoteSheet.jsx       — shared bottom sheet, Note + Room tabs
  RoomCard.jsx             — cover-photo tile, scrim + name overlay, photo-count chip
  AddRoomSheet.jsx         — template grid + custom name
  OfflineStatusPill.jsx    — mounted in TechLayout header, floating top-right
src/pages/tech/
  TechRoomDetail.jsx       — /tech/claims/:claimId/rooms/:roomId — Photos/Notes tabs
src/lib/
  offlineDb.js             — idb wrapper, 7 stores: queue, photos, rooms, readings,
                             equipment, cacheMeta, idSwaps
  syncRunner.js            — drain/dispatch/backoff/emit
  syncRunnerSingleton.js   — one runner per (db, employee.id)
  registerSW.js            — SW registration helper (unused; main.jsx already registers)
  dispatchers/
    roomDispatcher.js      — create_room RPC + temp→server UUID swap
    photoDispatcher.js     — Storage upload + insert_job_document, resolves roomId swap
src/hooks/
  useOfflineQueue.js       — useSyncExternalStore-based hook, lazy-inits singleton
supabase/migrations/
  20260420_phase1_rooms.sql               — table, RPCs, insert_job_document extension
  20260417_phase1_rooms_claim_scoped.sql  — job_id → claim_id refactor + get_claim_rooms
```

### Client ID idempotency contract
- Every new table has `client_id UUID UNIQUE`.
- Every write RPC takes `p_client_id` and does `ON CONFLICT (client_id) DO UPDATE`.
- Retries are safe. Photo dispatcher uses `resolveIdSwap` to turn a temp
  room UUID (queued before `room.create` synced) into the real server UUID
  before calling `insert_job_document`.

### Pending follow-ups
- Web admin parity (`ClaimPage.jsx` desktop) — rooms section not yet added
- Photo capture auto-open PhotoNoteSheet after enqueue to allow note + room
  tagging pre-sync (currently only possible after sync completes)
- Rename / delete room UI on TechRoomDetail (currently create-only)
- Offline app-shell bootstrap — SW doesn't cache index.html for cold-offline-launch
- Phase 3: Water Loss Report PDF (extend pdf-lib engine from submit-esign.js)

---

## Encircle Replacement — Phase 2 Hydro (Apr 18 2026)

IICRC S500 drying workflow: moisture readings, equipment placements, stall
detection. All feature-gated (`page:tech_moisture`, `page:tech_equipment`)
to Moroni's admin account — team sees zero change.

### Schema additions
```
material_type enum   — 'drywall','wood_subfloor','wood_framing','wood_hardwood',
                       'wood_engineered','concrete','carpet','carpet_pad',
                       'tile','laminate','vinyl','insulation','other'
equipment_type enum  — 'dehu_lgr','dehu_conventional','dehu_desiccant',
                       'air_mover','air_mover_axial','afd','hepa','heater','other'

moisture_readings    — id UUID, job_id, room_id, equipment_id (FK set after
                       equipment_placements exists), reading_date,
                       material material_type, location_description,
                       mc_pct, rh_pct, temp_f, gpp, dew_point_f,
                       dry_standard_pct, drying_goal_pct,
                       is_affected BOOL DEFAULT true,
                       taken_by, taken_at, edited_at, edited_by, notes,
                       client_id UUID UNIQUE (offline), created_at
                       Indexes: (job_id, reading_date DESC),
                                (room_id, material, reading_date DESC)

equipment_placements — id UUID, job_id, room_id, equipment_type,
                       nickname, serial_number,
                       status TEXT CHECK('active','removed'),
                       placed_at, removed_at, placed_by, removed_by,
                       notes, client_id UUID UNIQUE, created_at
                       Partial index: (job_id) WHERE status='active'
```

### RPCs
```
insert_reading(p_job_id, p_room_id, p_material, p_location, p_mc, p_rh,
               p_temp_f, p_gpp, p_dew_point, p_is_affected, p_equipment_id,
               p_taken_by, p_notes, p_client_id, p_taken_at DEFAULT now())
  — Idempotent upsert on client_id. Establishes dry_standard when the
    first unaffected reading for a (job, material) pair lands; backfills
    prior affected rows in the same pair; copies standard forward for
    future ones. drying_goal defaults to dry_standard + 2.

update_reading(p_reading_id, ...)  — 10-minute edit window; RAISES after
delete_reading(p_reading_id)       — 10-minute delete window; RAISES after

get_job_readings(p_job_id)
  — Joins room_name, computes per-row is_stalled via CTE: latest row for
    each (room, material) is stalled if mc_pct > drying_goal_pct AND a
    prior reading ≥36h older shows (prior.mc − latest.mc) < 1.0.

get_job_equipment(p_job_id, p_include_removed DEFAULT false)
  — Joins room_name + days_onsite.

place_equipment(p_job_id, p_room_id, p_equipment_type, p_nickname,
                p_serial, p_placed_by, p_client_id, p_notes)
  — Idempotent on client_id.

remove_equipment(p_equipment_id, p_removed_by)
  — No-op if already removed.

get_stalled_materials(p_job_id)
  — One row per stalled (room, material) pair on the job.

get_stalled_materials_for_employee(p_employee_id)
  — Aggregates stalled materials across every job the tech has touched via
    appointment_crew in the last 30 days. Joins job_number + latest
    appointment_id per job. Powers the StalledWidget on TechDash.
```

### New files
```
src/lib/
  psychrometric.js              — pure calcs: calcSaturationPressure_inHg,
                                   calcDewPoint, calcVaporPressure, calcGPP.
                                   Magnus-Tetens + ASHRAE humidity-ratio.
                                   Guards NaN on out-of-range input.
  psychrometric.test.js         — 27 vitest assertions covering ASHRAE
                                   checkpoints at ±2% (±5% for 90°F/80%
                                   where fixed-Pa Magnus under-predicts).
  dispatchers/
    readingDispatcher.js        — insert_reading RPC; resolveIdSwap on
                                   room + equipment ids.
    equipmentDispatcher.js      — dispatchEquipmentPlace (resolveIdSwap
                                   on room) + dispatchEquipmentRemove.

src/components/tech/
  MaterialIcon.jsx              — 10 SVG icons (one per material group) +
                                   MATERIAL_LABELS export.
  ReadingEntrySheet.jsx         — 4-step bottom sheet: Room → Material →
                                   MC/RH/Temp with live GPP + dew-point
                                   readout → Affected/location/equipment/
                                   notes. Auto-advance on material tap.
                                   Default-room skips step 1.
  EquipmentPlacementSheet.jsx   — 2-step sheet: type picker → details.
                                   Exports EQUIPMENT_LABELS.
  StalledWidget.jsx             — Red banner on TechDash, polled every
                                   2 min. Tap row → navigate to latest
                                   appointment on that job.

supabase/migrations/
  20260418_phase2_hydro.sql             — tables, enums, 8 RPCs
  20260418_get_stalled_for_employee.sql — employee-scoped aggregator

package.json  — added "test": "vitest run" and vitest devDependency.
```

### TechAppointment integration
- New sections between Tasks and Photos: **Moisture** and **Equipment**,
  both flag-gated.
- Moisture rows: material icon, name + (unaffected) marker, room /
  location / relativeTime, mono MC% color-coded (green ≤ goal, amber
  within 2, red above), goal% subline, STALLED chip when flagged.
  "N stalled" red pill in section header.
- Equipment rows: 3-letter type badge, nickname || type, room · Day N,
  inline two-click Remove.
- Save via `handleSaveReading` / `handlePlaceEquipment` / `handleRemoveEquipment`
  — route through offline queue when `offline:queue` is on, else call
  RPC inline + loadHydro(). sync:item-done listener triggers loadHydro
  when a Hydro item for this job finishes draining.

### TechDash integration
- StalledWidget mounted at the top of the scrollable PullToRefresh region.
  Returns null when nothing is stalled (zero footprint on clean days).

### Known dev-server quirk (not blocking)
`npm run dev` intermittently hits a Vite deps-cache version-hash mismatch
that manifests as "Invalid hook call" in OfflineStatusPill. Clearing
`node_modules/.vite` and restarting usually fixes it. Production bundle
(`npm run build` / Cloudflare Pages) is unaffected.
