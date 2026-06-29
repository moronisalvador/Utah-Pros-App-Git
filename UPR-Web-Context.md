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
    clockPrecheck.js              — Time-Tracking PR-2: runOmwPrecheck(db, apptId, employeeId) (fail-open call to clock_omw_precheck) + jobLabel/fmtElapsed helpers. Used by TimeTracker.jsx + TechDash.jsx before OMW.
    navItems.jsx                  — Single source of truth for office nav: NAV_ITEMS (legacy sidebar list), PRIMARY/OVERFLOW/SYSTEM groupings, nav icon components, isItemVisible() gate. Read by Sidebar + the desktop TopNav/OverflowDrawer/SettingsLayout.
  pages/
    Login.jsx                     — Email/password login + forgot password + dev mode selector
    SetPassword.jsx               — Password reset flow (recovery link handler)
    Dashboard.jsx                 — Owner "Overview" dashboard: 12-col widget grid (replaced the old
                                    stats+jobs view Jun 24 2026). See the "Overview Dashboard" section below.
    components/overview/          — Overview dashboard pieces: tokens.js (dashboard-scoped palette +
                                    placeholder data), Card.jsx (shared card shell + DeltaPill), Widgets.jsx
                                    (the 10 widget components). Styles live under .ovw-* in index.css.
    Jobs.jsx                      — Job list: division tabs, sort, search, detail panel
    JobPage.jsx                   — Full job detail: Overview/Schedule/Files/Financial/Activity tabs
    Production.jsx                — Kanban pipeline (30 phases, 4 macro groups) + list view
    Leads.jsx                     — Jobs in lead phase (feature-flagged: page:leads)
    Collections.jsx               — "My Money" / Collections page (feature-flagged: page:collections), redesigned to
                                    the UPR design system (Jun 2026). FOUR tabs: A/R · Outstanding (ARDashboard —
                                    default-sorts newest CREATED first, client-side, via get_ar_invoices().created_at
                                    added by 20260626_get_ar_invoices_created_at.sql; clickable column headers override),
                                    Invoices (InvoicesList, get_ar_invoices(), rows → /invoices/:id editor — also
                                    default-sorted newest CREATED first, client-side),
                                    Estimates (EstimatesList, get_estimates() which already returns created_at DESC,
                                    re-sorted client-side for parity, rows → /estimates/:id — a convenience
                                    view of the standalone /estimates page), Payments (PaymentsLedger,
                                    get_payments_ledger()). Header has Payment-settings + New-invoice/New-estimate
                                    actions; A/R, Invoices, and Estimates carry a period switch (All/MTD/Last 30/
                                    QTD/YTD) that scopes their data by date. **All four tab components load once via a
                                    `dbRef` (load() deps `[]`)** so a token refresh on browser-tab refocus no longer
                                    re-fires load() and flashes the loading state (the old "blink") — the latest client
                                    stays reachable through the ref. A/R + Invoices have wired Filters
                                    (division / QB-sync / amount) and a Columns show/hide editor; footer "Export →"
                                    links download a CSV of the visible rows. Estimates shows 4 KPIs incl a
                                    conversion-rate card. Row status is shown as plain COLORED TEXT (not pills) on
                                    Estimates + Invoices; Payments amounts are neutral ink (green reserved for the
                                    QB-synced ✓). Restraint throughout: color only where it carries meaning. The
                                    active tab is synced to ?tab= (replace) so tabs are deep-linkable and the
                                    browser Back button (and builder "← Back") returns to the tab you were on.
    components/collections/       — Collections redesign pieces: collTokens.js (page-scoped UPR palette + $/date
                                    formatters + period math + invoiceStatusKind + aging bucketKey/AGING_BUCKETS + CSV),
                                    collKit.jsx (shared
                                    primitives: CollCard, Kpi, SegControl, SearchBox, StatusBadge, DivisionSquare,
                                    ProgressBar, Pill, PopoverButton + Filters/Columns, inline SVG icons),
                                    ARDashboard.jsx, InvoicesList.jsx, EstimatesList.jsx, PaymentsLedger.jsx,
                                    ARChatBubble.jsx + arSnapshot.js (AI A/R Copilot — see note below),
                                    SearchSelect.jsx (typeahead dropdown for the QBO Item/Class pickers in the
                                    invoice & estimate builders), ActionMenu.jsx ("Manage ▾" dropdown in the
                                    builder top toolbar — two-click confirm for Revert/Delete). Styles
                                    live under .coll-* in index.css. Palette is page-scoped (like the dashboard's
                                    .ovw-*), NOT the app-wide tokens. COLOR SEMANTICS: a balance is neutral ink,
                                    never red — red is reserved for overdue/escalation; green = collected/current,
                                    amber = aging. A/R TOP is ONE unified summary card — an Outstanding hero + an
                                    Overdue callout (both click-to-filter the table) over the aging bar + 5 buckets —
                                    which replaced the old 4 KPI tiles + a separate aging card (they showed the same
                                    money twice). The A/R period switch scopes the WHOLE A/R view by invoice date
                                    (summary + aging + table recompute; drafts/undated always shown; default All).
                                    A/R rows are deliberately de-noised: age is plain text (red only when overdue),
                                    QB shows only on a sync error, and there are NO per-row status pills (overdue →
                                    Age, partial → Collected, draft/sent → Sent columns carry it); the Invoices tab
                                    keeps its status badge (no such columns there). Job address under Claim · Job comes
                                    from get_ar_invoices (job_address/job_city added by migration
                                    20260625_get_ar_invoices_address.sql). The Payments "Processing/in-flight" section
                                    from the design is omitted: get_payments_ledger returns cleared payments only.
                                    AI A/R COPILOT (Jun 2026) — a floating, page-aware chat bubble on the A/R tab
                                    (ARChatBubble.jsx, mounted by ARDashboard; worker functions/api/collections-chat.js,
                                    Sonnet 4.6, non-streaming). On each send the browser builds a DETERMINISTIC snapshot
                                    of exactly what's on screen — outstanding/overdue/aging totals, ranked top-debtors,
                                    the filtered+sorted invoice list, and the view state — via buildArSnapshot()
                                    (arSnapshot.js) and injects it into the system prompt, so most questions answer in
                                    ONE call with no DB lookups and the numbers always match the screen (the model never
                                    sums; code does). READ-ONLY drill-down tools map to existing data:
                                    lookup_customer → get_customer_detail / search_contacts_for_job (phone/email +
                                    claims/jobs), get_invoice_detail → invoices + invoice_line_items + payments (+
                                    xactimate_meta), list_payments → get_payments_ledger, list_estimates → get_estimates,
                                    get_job_detail → jobs select + get_job_financials, lookup_claim → claims select,
                                    list_job_labor → get_job_labor_summary. Plus LIVE QuickBooks (read-only via qboFetch,
                                    functions/lib/quickbooks.js — same OAuth as qbo-invoice/qbo-query, no new secrets):
                                    qbo_customer (real-time QBO balance + open QBO invoices for a contact) and
                                    qbo_ar_summary (live total A/R + aging across open QBO invoices, for reconciling
                                    against the on-screen/local A/R). QBO tools are intent-based — the worker builds the
                                    safe /query string (the model never passes raw QQL). ADVISORY ONLY — it never
                                    drafts/sends a message or creates/modifies any record (the human acts). Ephemeral
                                    (no history tables). Auth: any logged-in session (the page is already access-gated);
                                    reuses ANTHROPIC_API_KEY; logs worker_runs as 'collections-chat'. The shared aging
                                    bucketKey/AGING_BUCKETS were lifted into collTokens.js so the snapshot's buckets can
                                    never drift from ARDashboard's on-screen breakdown. The panel is non-blocking (no
                                    backdrop — the live A/R view it reads stays scrollable) and hides under the
                                    New-invoice/estimate modals (z 80/90 vs 200).
    ClaimsList.jsx                — List of all claims
    ClaimPage.jsx                 — Full claim detail page
    ClaimPage_header.jsx          — Claim page header component (partial/patch file)
    Customers.jsx                 — Contact list, claims-grouped detail panel
    ContactProfile.jsx            — Individual contact detail
    CustomerPage.jsx              — Customer detail page
    Conversations.jsx             — SMS/MMS messaging (GHL-style, TCPA compliant)
    Schedule.jsx                  — Calendar dispatch board (Day/3Day/Week/Month) — fully on the UPR design system (shell, Week Calendar, Jobs/Crew/Month views; Jun 2026)
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
    TechDash.jsx                  — Field tech dashboard: sticky greeting (doesn't scroll on pull-to-refresh), active cards with client name + task progress bar + Photo/Notes/Clock In, timeline future rows, compact completed rows, upcoming 7-day preview when 0 appointments today, snap-first photo flow (auto-upload, optional caption via toast). Time-Tracking PR-2: ActiveCard OMW runs clock_omw_precheck + ClockSupersedeSheet. PR-3: red "You're still clocked in" banner when the tech has an open LIVE entry and Denver local time ≥ 17:00 (denverHour() helper), linking to the appointment to finish the day; the midnight split is the backend safety net.
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
    tech/TimeTracker.jsx          — Static three-station row (OMW · Start · Finish) with timestamps under each. No live ticking. Between-step durations ("Travel: 23m", "On job: 4h") shown only after the right side of the interval is reached. Past stations greyed + non-tappable for techs (admin/PM edits via desktop). Pause is a secondary control; preserves original Start timestamp on Resume. Supports multi-visit via "Return to Job" flow. Time-Tracking PR-2 (Jun 26 2026): before OMW, calls clock_omw_precheck (src/lib/clockPrecheck.js) and shows ClockSupersedeSheet to confirm clocking out of another open job (or hard-block when clock_enforce_explicit_clockout is ON). Same precheck+sheet wired into TechDash ActiveCard's OMW.
    tech/ClockSupersedeSheet.jsx  — Red bottom sheet (PhotoNoteSheet structure) shown before OMW when the tech is clocked in elsewhere: confirm-supersede mode ([Clock out & continue]) or hard-block mode ([Go to {job}]). Pure presentational; parent owns the RPC.
    Layout.jsx                    — App shell: sidebar, bottom bar, toasts, offline banner
    Sidebar.jsx                   — Desktop nav + sign out button
    AddContactModal.jsx           — Add contact modal (9 roles) + LookupSelect component
    AddRelatedJobModal.jsx        — Add sibling job under same claim
    CalendarView.jsx              — Week-calendar grid for Schedule page (division-tinted event cards via schedule/eventCardStyle.js; UPR design system, Jun 2026)
    schedule/eventCardStyle.js    — Maps an appointment → card colors by division (teal/purple/coral/pink) / appt-blue / task-green / dashed-tentative / gray-done
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
    Sidebar.jsx                   — Sidebar navigation (mobile + iPad portrait ≤1023px; reads NAV_ITEMS from lib/navItems.jsx)
    TopNav.jsx                    — Top nav bar (≥1024px — desktop + iPad landscape): logo, primary links, GlobalSearch, NewMenu, NotificationBell, Help link (→/help), settings gear, UserMenu, overflow hamburger
    OverflowDrawer.jsx            — Desktop "More" slide-over (secondary pages: Jobs, Production, Schedule Templates, Encircle Import, OOP Pricing, Leads, Marketing)
    NewMenu.jsx                   — Top-nav "New" dropdown → New Claim (job creator) / New Estimate (page:estimates) / New Customer / New Invoice (flows via Layout.handleCreateAction)
    UserMenu.jsx                  — Top-nav avatar dropdown (admin-only Tech View + Sign Out)
    GlobalSearch.jsx              — Top-nav global search: 300ms-debounced typeahead over the global_search RPC, grouped results routing to each record
    SettingsLayout.jsx            — Settings hub shell: left sub-rail (≥1024px) wrapping the system pages; display:contents passthrough below 1024px

functions/
  api/
    admin-users.js                — POST/PATCH/PUT/DELETE employee + auth management
    process-scheduled.js          — Cron: process scheduled SMS messages (60s)
    resend-esign.js               — Resend esign email for existing pending request
    send-esign.js                 — Create sign request + send email via Resend (functions/lib/email.js)
    send-message.js               — Outbound SMS with TCPA compliance + DND guard
    send-push.js                  — APNs push via ES256 JWT; returns 503 until APNS_* env vars set (Phase 4 code-only)
    submit-esign.js               — Process signature, generate PDF, upload to storage; on success notifies office (in-app notification + job_notes activity entry + email to restoration@utah-pros.com)
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

## Overview Dashboard (owner landing — Jun 24 2026)

The owner's home screen at `/` (office/admin/PM/supervisor; field techs go to `/tech`). Replaced the old
stat-cards + two-job-tables `Dashboard.jsx` with the Claude-design **"Overview"** — a responsive 12-column
grid of 10 self-contained widget cards. Header = "Overview" title + date · division legend · period control
(MTD/Last30/QTD/YTD) · "Edit layout". Footer fine print.

**Widgets (default spans):** Revenue recognized `4` · Avg ticket `4` · Open estimates `4` · New claims booked
`6` · Jobs completed `6` · Active drying `7` (signature) · Collections `5` · Action required `6` · Employee
status `6` (live clock-in board) · Production pipeline `12` (future-ready, greyed recon/remodel lanes).

**Files:** `src/pages/Dashboard.jsx` (header + grid assembly + access-gating + kill-switch) ·
`src/components/overview/tokens.js` (palette + placeholder datasets; every widget takes a `data` prop
defaulting to its placeholder) · `src/components/overview/Card.jsx` (shell + DeltaPill + footer +
loading-skeleton / error-retry body states) · `src/components/overview/Widgets.jsx` (the 10 widgets +
`RestrictedCard`; CSS/SVG charts, no chart lib; rows deep-link via `useJobRowNav`; data-heavy list
widgets — Employee status, Action required, Active drying — scroll their rows internally via `.ovw-scroll`
(header + footer stay fixed) so long lists aren't clipped) ·
`src/components/overview/WidgetBoundary.jsx` (per-card React error boundary so one bad RPC can't blank the
grid) · `src/components/overview/hooks/` (one hook per widget, all built on the shared
`usePolledRpc(load, intervalMs, enabled)` — initial load + interval refresh that **pauses while the tab is
hidden and refetches on return**, **cancellation-safe** so a slow prior-period response can't overwrite the
current one, + `{data,loading,error,reload}`;
`dashUtils.js` = period math + money fmt; `useDashboardLayout.js` = layout persistence). Styles are scoped
under `.ovw-*` in `index.css` (grid + responsive 12→2→1-col + hover + LIVE pulse + shimmer skeleton + error).

**⚠ Dashboard-scoped palette (DO NOT confuse with app-wide DIVISION_COLORS):** this dashboard intentionally
uses its OWN division colors — Mitigation teal `#0e9384`, Reconstruction purple `#8a5cf6`, Remodeling coral
`#f2664a`, Mold pink `#ec4899` — and introduces a **"Remodeling"** division **only here**. The app-wide
`DIVISION_COLORS` and the division enum are untouched. App-wide adoption + a real Remodeling division is a
separate future project (Phase 4 below, decision pending).

**Roadmap / status:**
- **Phase 1 — DONE:** pixel-faithful visual shell + placeholder data.
- **Phase 2 — DONE (live data):** one data hook per widget (`src/components/overview/hooks/`); the period
  switch re-queries the period-scoped cards (Revenue, Avg ticket, New claims). **Live:** Employee status
  (`get_tech_status_board`, 30s poll; each row shows the tech's full name + client + job address), Collections + DSO (`get_ar_invoices` + ARDashboard bucketing), New claims
  (`claims`), Revenue by division, Avg ticket + avg/claim, Production pipeline, Action required (pending
  `sign_requests`). **Wired but empty until those features are in use** (graceful empty states): Open estimates
  (`estimates` empty), Active drying (Hydro unused), Jobs completed (wired to `get_jobs_completed` in Part A —
  reads ~0 until jobs reach a terminal phase, then lights up automatically). **New RPCs** (migration `20260624_overview_dashboard_rpcs.sql`; all
  SECURITY DEFINER, granted authenticated): `get_revenue_by_division`, `get_avg_ticket`,
  `get_open_estimates_summary`, `get_pipeline_summary`, `get_active_drying_jobs`, `get_dashboard_action_items`,
  + helper `dash_division_bucket`. "View all →" links route to /collections, /claims, /production, /jobs.
- **Phase 3 — DONE (drag/resize/reorder + per-user layouts):** `react-grid-layout` v2 (classic API via its
  `/legacy` entry). "Edit layout" toggles drag (⠿ handle) + resize (bottom-right corner) + reorder; the
  arrangement saves per user via the RLS-locked **`dashboard_layouts`** table + `get_dashboard_layout` /
  `save_dashboard_layout` RPCs (scoped by `auth.uid()`, migration `20260624_dashboard_layouts.sql`) with a
  `localStorage` instant-apply mirror + Reset. RGL CSS is inlined + themed in `index.css`. Responsive: 12-col
  ≥996px, 1-col below.
- **Part A — DONE (interactivity + robustness + access control):** (1) **Clickable rows** — Employee
  status / Active drying / Action required rows deep-link to `/jobs/:id` (keyboard-accessible via
  `useJobRowNav`, guarded on a missing id, suppressed in edit mode); Production-pipeline active stages →
  `/production`. (2) **Loading/error states** — `usePolledRpc` exposes `{loading,error,reload}`; `Card`
  renders a shimmer skeleton while loading and a "Couldn't load · Retry" on failure (no more placeholder
  flash, no silent failures). (3) **Jobs completed wired** to `get_jobs_completed(p_start,p_end)`. (4)
  **Access control** — Revenue / Avg ticket / Collections gated by the **`overview_financials`** permission
  (`canAccess('overview_financials')`): admins always pass; grant it to anyone else **per-employee** (Admin →
  Page Access) or **per-role** (Admin → Permissions) — registered in both `NAV_KEYS` and `PAGE_ACCESS_KEYS`
  in `Admin.jsx`. **View-only and deliberately separate from `canEditBilling`** (billing EDIT), so granting a
  PM the money cards does NOT confer invoice/A-R edit rights anywhere. Non-privileged viewers get a
  `RestrictedCard` AND their hooks run with `enabled=false` so those RPCs aren't even fetched (not just
  UI-hidden). No DB migration — the existing `upsert_employee_page_access` / `upsert_permission` RPCs create
  the key's rows on first toggle. (Initial Part A shipped this as an admin-only `canEditBilling` gate; made
  configurable Jun 25 2026.) (5) **`page:overview`
  feature flag** is a kill-switch handled as **content** inside `Dashboard.jsx` (a placeholder when disabled),
  **NOT** a `FeatureRoute` redirect — the dashboard is the home route `/`, so redirecting to `/` would
  infinite-loop. (6) **`WidgetBoundary`** wraps each card so one failing widget can't blank the grid.
  Migration `20260624_dashboard_interactivity.sql` (adds `job_id` to `get_active_drying_jobs` +
  `get_dashboard_action_items`, creates `get_jobs_completed`, seeds the `page:overview` flag enabled).
  Migration `20260625_action_items_customer.sql` (additive) adds `client` (`jobs.insured_name`) +
  `address` (`street, city, ST ZIP`, same derivation as `get_tech_status_board`) to each
  `get_dashboard_action_items` row; the `ActionRequired` widget now leads with **customer name · job
  number**, then the doc status, then **address · sent date**, so a row is identifiable at a glance.
  Backward-compatible (existing keys unchanged → old code ignores the new ones).
- **Part B — planned (light up the empty widgets):** upstream features that populate the three
  wired-but-empty cards. **Plan: `DASHBOARD-PARTB-PLAN.md`** (repo root). Confirmed order: **B1 Jobs-completed
  lifecycle + B4 cross-widget polish first → B3 Hydro/drying (its own session)**. **B2 Open estimates is
  owned by a separate effort** — the widget reads `get_open_estimates_summary` and lights up automatically
  once `estimates` rows exist with an open `status` (no dashboard change needed).
- **Phase 4 — decision pending:** app-wide palette + first-class "Remodeling" division (large ripple).
  **Ready-to-execute plan lives at `DASHBOARD-PHASE4-PLAN.md`** (repo root, dormant — start a session and say
  "execute DASHBOARD-PHASE4-PLAN.md", or rename to `*-TASK.md` to activate the Task File Protocol).

**Plan file (this session):** `/root/.claude/plans/yes-record-it-but-steady-kitten.md`.

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
job_time_entries        — Time entries per job (has travel_minutes NUMERIC column — computed on clock-in from travel_start; Phase 5 added travel_start_lat/lng + clock_in_lat/lng NUMERIC(9,6) captured from iOS Geolocation). Time-Tracking PR-1 (Jun 26 2026) added split/lineage columns auto_continued BOOL, continued_from UUID→self, auto_split_seq INT, source TEXT (for the future midnight-split work), and a partial unique index uq_jte_one_open_clock_per_employee on (employee_id) WHERE clock_out IS NULL AND travel_start IS NOT NULL — enforces ≤1 open LIVE entry per employee (manual rows have travel_start NULL and are excluded).
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
estimates               — Estimate records. PRE-SALE, line-item, QBO-synced (Jun 25 2026, decoupled same day).
                          Owned by a CONTACT (contact_id) + intended_division + optional property_address/city/
                          state/zip; job_id is NULLABLE and stays NULL until SOLD. amount/subtotal roll up from
                          estimate_line_items. estimate_type initial/supplement/change_order/final. QBO cols
                          qbo_estimate_id/synced_at/sync_error/doc_number/emailed_at/email_status/sent_to_email.
                          converted_invoice_id (FK invoices) set on convert — which silently auto-creates a
                          claim+job then the invoice. status draft/submitted/under_review/approved/denied/
                          revised/paid.
estimate_line_items     — Line items per estimate (Jun 25 2026). Clone of invoice_line_items; line_total is a
                          GENERATED column (quantity*unit_price) — never write it. qbo_item_id/name +
                          qbo_class_id/name per line. Copied into invoice_line_items on convert-to-invoice.
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
feature_flags           — 14 rows — Feature flag controls (has force_disabled BOOLEAN column — kills page for everyone including admins). Apr 17 additions (all dev-only for Moroni): page:tech_rooms, page:tech_moisture, page:tech_equipment, page:water_loss_report, offline:queue. Time-Tracking PR-2 (Jun 26 2026) added clock_enforce_explicit_clockout (category time_tracking, default OFF) — read BACKEND-side by clock_omw_precheck + clock_appointment_action; when ON, going On-My-Way while clocked in on another job is hard-blocked (OPEN_ENTRY_EXISTS) instead of auto-superseding. NOTE: the client reads its raw `enabled` (not isFeatureEnabled, which fails-open to true).
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
create_job_with_contact(...)    — Atomic job + contact (+ claim) creation. Optional trailing p_existing_claim_id UUID (added Jun 29 2026): when set, files the new job under that EXISTING claim (reuses it, skips the claims INSERT) instead of always minting a fresh CLM-…; NULL (default) = unchanged behavior. Now a 32-arg signature — DROP+CREATE'd in one migration (20260629_create_job_with_contact_existing_claim.sql) to avoid a second PostgREST overload (PGRST203). Both callers (TechNewJob mobile, CreateJobModal desktop) use named args so they bind unchanged. TechNewJob's existing-claim picker is scoped to the selected contact's claims via get_customer_detail(p_contact_id).data.claims; on save TechNewJob now opens /tech/jobs/:id and only pushes to Encircle for new claims.
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
clock_appointment_action(p_appointment_id, p_employee_id, p_action, p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL, p_accuracy NUMERIC DEFAULT NULL) — Atomic time tracking (omw/start/pause/resume/finish). Coords are optional; on 'omw' they populate travel_start_lat/lng on the new entry, on 'start' they populate clock_in_lat/lng. ONE function only — the legacy 3-arg overload was dropped Jun 9 2026: having both overloads made 3-key RPC calls ambiguous (PostgREST PGRST203, HTTP 300) and blocked all clock actions for techs on older app bundles. 3-key calls now resolve to this function via the DEFAULT NULL geo params. Never re-create a second overload of this function. On 'omw', auto-closes any other open entries for the same employee with hours capped at LEAST(24, ...). Time-Tracking PR-1 (Jun 26 2026) fixed the close loop: it now closes ALL open LIVE entries (clock_out IS NULL AND travel_start IS NOT NULL) — previously it required clock_in IS NOT NULL, so "en-route only" rows orphaned forever; en-route-only rows now close with hours 0 and travel_minutes captured from travel_start, arrived rows also stamp on_site_end. If auto-closed entry was stale (>24h since clock_in), logs a 'time_entry.auto_closed_stale' row to system_events (payload: previous_appointment_id, new_appointment_id, clock_in, auto_closed_at, raw_hours, capped_hours, reason). Time-Tracking PR-2 (Jun 26 2026) added a flag-gated hard-block at the top of the omw branch: if clock_enforce_explicit_clockout is ON and an open live entry exists on a DIFFERENT appointment, RAISE OPEN_ENTRY_EXISTS (P0001) instead of auto-closing; flag OFF (default) → unchanged auto-close. Signature unchanged (still 6-arg). Phase 5 layers a foreground "away from jobsite" nudge on top (see get_active_appointment_geo) — future work can add true geofence-based auto-finish.
clock_omw_precheck(p_appointment_id, p_employee_id) — Time-Tracking PR-2 (Jun 26 2026). READ-ONLY. Returns jsonb { requires_confirmation, enforce_explicit, open_entry } telling the client whether tapping On-My-Way would supersede another open clock. requires_confirmation = open live entry on a DIFFERENT appointment exists AND flag OFF; enforce_explicit = same condition AND clock_enforce_explicit_clockout ON; open_entry = { entry_id, appointment_id, title, job_id, job_number, insured_name, travel_start, clock_in, status (omw|on_site|paused), elapsed_minutes } or null. Client (src/lib/clockPrecheck.js → ClockSupersedeSheet) calls this before omw; fail-open.
apply_midnight_clock_split() — Time-Tracking PR-3 (Jun 26 2026). SECURITY DEFINER, REVOKED from anon/authenticated (cron/admin-SQL only). Runs nightly via pg_cron just after Denver midnight: for every open LIVE entry whose work_date is a prior day, caps clock_out at 23:59:59 Denver of that work_date (arrived → on-site hours via the finish formula; en-route-only → hours 0 + travel_minutes from travel_start) and reopens a continuation at next-day 00:00 (auto_continued=true, continued_from, auto_split_seq+1, source='auto_split'). STOP-LOSS: a row already auto_continued with auto_split_seq>=1 (untouched) is capped but NOT reopened, flagged notes '[abandoned: needs review]', and create_notification fires an admin alert ('time_entry.abandoned_clock'). Logs a worker_runs row. Date-filtered + idempotent (safe to run anytime; today's open clocks untouched). pg_cron is ENABLED (Jun 26 2026); jobs upr_midnight_clock_split_0610 / _0710 (10:6 & 10:7 UTC = ~00:10 Denver across MST/MDT) call it.
clock_finish_entry(p_entry_id, p_employee_id) — Time-Tracking HOTFIX (Jun 26 2026). SECURITY DEFINER, owner-checked (employee_id must match), GRANT to anon/authenticated. Finishes an open entry BY ID (appointment-independent): arrived → on-site hours from clock_in minus pauses (cap 0..24); en-route-only → hours 0 + travel_minutes from travel_start; sets appointment 'completed' only if it still exists. Recovers a clock whose appointment was deleted (stranded, appointment_id null). TechDash 5 PM banner calls this when openClock.appointment_id is null ("Clock out now"), else navigates to the appointment. Prevention: BEFORE DELETE trigger trg_close_open_clocks_before_appt_delete on appointments (fn close_open_clocks_on_appt_delete) auto-closes any open LIVE entry on an appointment before it is deleted, so the ON DELETE SET NULL FK (job_time_entries_appointment_id_fkey) can never strand an open clock again.
get_assigned_tasks(p_employee_id) — Incomplete tasks for employee with job context
get_all_employees()             — All employees with auth status
get_payroll_summary(...)        — Payroll summary
get_timesheet_entries(...)      — Time entries for payroll
get_timesheet_entries_admin(p_start_date, p_end_date, p_employee_id, p_job_id, p_status, p_division) — Time-Tracking PR-5 (Jun 27 2026). Richer admin read for the office Time Tracking page; SECURITY DEFINER, additive (get_timesheet_entries left intact). Returns all get_timesheet_entries columns PLUS travel_start, on_site_end, travel_minutes, total_paused_minutes, auto_continued, and computed duration_minutes (travel+on-site mins), is_open (clock_out null AND travel_start not null), is_overlong (hours + travel/60 > 12). Filters: p_employee_id (null=all), p_job_id, p_division (cast j.division::text — division is the job_division ENUM), p_status ('open'|'approved'|'unapproved'|'overlong'|null). PR-6 added has_pending_change (exists a pending time_entry_change_requests row).
is_time_admin(p_employee_id) — Time-Tracking PR-6 (Jun 27 2026). Boolean: role in {admin,office,project_manager,supervisor} (estimator + field_tech excluded). Used by all admin write RPCs.
admin_upsert_time_entry(p_actor_id, p_id, p_employee_id, p_job_id, p_work_date, p_hours, p_clock_in, p_clock_out, p_travel_start, p_on_site_end, p_travel_minutes, p_total_paused_minutes, p_work_type, p_description, p_notes, p_override_approved) — PR-6. Admin-only add/edit (NULL p_id = insert). Validates chronology (travel_start ≤ clock_in ≤ on_site_end ≤ clock_out), enforces single-open invariant (OPEN_ENTRY_EXISTS), approved-lock (ENTRY_APPROVED_LOCKED unless p_override_approved), sets auto_continued=false, logs system_events. Never sets total_cost (generated); relies on calc_time_entry_cost trigger to fill hourly_rate.
admin_clock_out_entry(p_id, p_actor_id, p_clock_out=now()) — PR-6. Admin-only; closes an open entry (finish formula for arrived, hours 0 + travel for en-route).
delete_time_entry(p_id, p_reason, p_actor_id) — PR-6. Admin-only HARD delete; rejects approved rows (ENTRY_APPROVED_CANNOT_DELETE); snapshots full row → time_entry_deletions + system_events BEFORE delete.
submit_time_entry_change_request(p_entry_id, p_proposed jsonb, p_tech_note, p_actor_id) — PR-6. Owner-only (NOT_OWNER otherwise); creates a pending time_entry_change_requests row, no mutation, notifies office via create_notification. proposed keys: work_date,hours,clock_in,clock_out,travel_minutes,description,notes.
review_time_entry_change_request(p_request_id, p_approve, p_actor_id, p_review_note) — PR-6. Admin-only; approve → applies proposed via admin_upsert_time_entry (override_approved) + marks approved; reject → marks rejected; notifies the tech; logs system_events.
NEW TABLES (PR-6): time_entry_change_requests (entry_id→job_time_entries ON DELETE CASCADE, requested_by, proposed jsonb, tech_note, status pending|approved|rejected, reviewed_by/note/at; partial unique index = one pending per entry; RLS on, SELECT to anon/authenticated, writes via RPC only) · time_entry_deletions (entry_id, snapshot jsonb, reason, deleted_by, deleted_at; audit trail for hard deletes).
TIME-TRACKING PR-7 (Jun 27 2026, client-only) — `src/pages/TimeTracking.jsx` admin UI rebuilt on the PR-5/PR-6 surface. The **Timesheet** tab now reads `get_timesheet_entries_admin` (was `get_timesheet_entries`), defaults to the current **semi-monthly** period (1st–15th / 16th–EOM, + Last Period preset), and adds **division** + **status** (open/unapproved/overlong/approved) filters. Admin-tier (role ∈ {admin,office,project_manager,supervisor}) gets: **inline cell edit** on hours + work_date (optimistic → `admin_upsert_time_entry` partial update → revert+toast on error); per-row **Clock out** (`admin_clock_out_entry`), **Edit** (modal, supports clock_in/out/travel_start/on_site_end/travel_minutes), **Duplicate**, **Backfill** (insert), **Delete** (inline reason → `delete_time_entry`); **bulk** approve/unapprove (`approve_time_entries`), bulk clock-out, bulk delete-with-reason; **Unapprove & edit** one-click on approved rows; row **badges** OPEN/12h+/auto/edit-pending/approved-lock. New **Requests** tab (admin only, with pending-count tab badge) lists pending `time_entry_change_requests`, shows a current→proposed **diff** + tech note, Approve/Reject via `review_time_entry_change_request`. **Field techs** (non-admin) see only their own rows and a **Request a Change** modal → `submit_time_entry_change_request` (no direct add/edit/delete; By Job + Payroll tabs hidden). **Realtime**: subscribes to `job_time_entries` + `time_entry_change_requests` via `realtimeClient` (realtime.js untouched), debounced reload. New components in the same file: `RequestsView`, `RequestModal`; `EntryModal` extended with clock-time fields; helper `useRealtimeReload`. New CSS: `.tt-tab-badge`, `.tt-badge` (open/danger/muted/edit), `.tt-inline-input`, `.tt-req-card/-head/-note/-diff`, `.tt-diff-*`. All writes go through the `admin_*`/`*_time_entry` RPCs only (no direct PostgREST writes — prereq for PR-8 RLS hardening).
TIME-TRACKING PR-8 (Jun 27 2026, DB-only) — **`job_time_entries` RLS hardened.** Dropped the wide-open `allow_authenticated_job_time_entries` (cmd=ALL, USING true) + `allow_anon_read_job_time_entries` policies; replaced with a single `jte_select_all` (FOR SELECT TO anon, authenticated USING true). There is now **no write policy**, so direct PostgREST INSERT/UPDATE/DELETE by anon/authenticated are rejected (insert → RLS violation; update/delete → 0 rows). All writes continue to flow through SECURITY DEFINER functions owned by postgres (which bypass RLS): clock_appointment_action, clock_finish_entry, apply_midnight_clock_split, admin_upsert_time_entry, admin_clock_out_entry, delete_time_entry, approve_time_entries, upsert_time_entry, merge_jobs, and the appointment BEFORE DELETE trigger close_open_clocks_on_appt_delete. Reads stay open (tech app, office page RequestsView diff, MergeModal, realtime all SELECT directly). Migration `supabase/migrations/20260627_pr8_job_time_entries_rls.sql`. Validated on prod's real role config via an isolated throwaway harness (authenticated: direct INSERT denied, UPDATE/DELETE 0 rows, SELECT + definer write OK) before apply; `get_advisors(security)` shows no new findings for the table. Completes the time-tracking plan (PR-1→PR-8). Rollback: re-create the ALL policy `using(true) with check(true)`.
TIME-TRACKING REDESIGN (Jun 27 2026, client-only) — `src/pages/TimeTracking.jsx` restyled to the shared **"My Money / Collections"** design language (`.coll-*` + `src/components/collections/collKit.jsx`/`collTokens.js`) so it matches the Overview dashboard, Collections page, and Invoice builder. Page is now `.coll-page` with a `.coll-header`, a dark-pill **SegControl** tab row (Status Board / Timesheet / Requests[+count badge] / By Job / Payroll) + a small period SegControl (semi-monthly default retained). Each tab uses **KpiGrid/Kpi** tiles (Open clocks + Pending approval are click-to-filter), a `.coll-toolbar` (SearchBox + status SegControl + a Filters PopoverButton with employee select + division ToggleChips), and grid-based `.coll-thead`/`.coll-row` tables with DivisionSquare dots and kit `Pill` badges (OPEN/12h+/AUTO/EDIT/APPROVED). Timesheet keeps employee group sub-header bars (`.tt-group-bar`). **No behavior change** — all PR-7/PR-8 logic preserved (inline edit hours/date → admin_upsert_time_entry, row Clock-out/Edit/Duplicate/Backfill/Delete-with-reason, bulk approve/clock-out/delete, Unapprove&edit, RequestsView diff + review, field-tech Request-a-change, realtime). Modals (EntryModal/RequestModal), inline-edit inputs and the request diff keep their existing `tt-*` classes. New CSS: `.coll-select`, `.coll-datein`, `.coll-check`, `.tt-group-bar` (appended to the `.coll-` block in index.css). The page now imports the page-scoped collections kit/tokens (first reuse outside Collections — sanctioned for this redesign).
STATUS-BOARD CLOCK ACTIONS (Jun 27 2026, client-only) — `src/components/StatusBoard.jsx` gained admin-only per-row actions: **Clock out** (two-click confirm → `admin_clock_out_entry`) and **Edit clock-in** (inline datetime-local → `admin_upsert_time_entry` with p_clock_in only). The board RPC (`get_tech_status_board`) doesn't carry the open entry id, so the board now also fetches open LIVE entries (`job_time_entries` where clock_out IS NULL AND travel_start IS NOT NULL) and maps them by employee_id (one per employee via the single-open invariant) to drive the actions. Actions render only for admin-tier viewers (role ∈ {admin,office,project_manager,supervisor}) and only on rows with an open clock; "Edit in" shows once clock_in is set (on_site/paused), OMW-only rows show just "Clock out". Reads rely on the PR-8 `jte_select_all` SELECT policy; writes go through the SECURITY DEFINER admin RPCs. Refetches board + open clocks after each action. No DB change.
get_job_labor_summary(p_job_id) — Labor cost per job
upsert_time_entry(...)          — Save time entry
approve_time_entries(...)       — Bulk approve
calc_time_entry_cost(...)       — Trigger fn on job_time_entries. NOTE (PR-4, Jun 27 2026): total_cost is a GENERATED column, NOT trigger-written. Expr is now round((coalesce(travel_minutes,0)/60 + coalesce(hours,0)) * coalesce(hourly_rate,0), 2) — i.e. drive time + on-site time × rate (was hours×rate only; changed via ALTER COLUMN ... SET EXPRESSION, which recomputed all rows). The trigger now ONLY fills hourly_rate from the employee when missing + stamps updated_at (its old total_cost assignment was always ignored by the generated column). get_payroll_summary is unaffected (recomputes pay from hours×rate, never reads stored total_cost); get_job_labor_summary + get_timesheet_entries sum stored total_cost so they now include drive time.
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

### Global Search (Jun 24 2026)
```
global_search(p_term TEXT, p_limit INT DEFAULT 6)
  — Desktop top-nav search. SECURITY DEFINER, GRANT EXECUTE anon/authenticated.
    Returns a JSONB object of grouped, read-only matches: customers (contacts),
    claims, jobs, invoices, payments — each [{id, title, subtitle}] (payments
    also carry invoice_id + job_id for routing). The 'estimates' key is reserved
    (always []) until an estimates module exists. Enum cols cast to text before
    NULLIF. Migration: supabase/migrations/20260624_global_search.sql. Does NOT
    modify the MCP-only upr_search. Surfaced only in the desktop TopNav.
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

**Table:** `feature_flags` — 19 rows as of Jun 2026 (mixed on / off / dev-only). The table below is the original Phase-1A seed; new flags are now added via the self-registering registry (see below), and `feature:ai_xactimate` (Jun 2026, AI Xactimate Import) is live + ON.

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

**Self-registering flag registry (`src/lib/featureFlags.js`, Jun 2026):** Flags no longer need
hand-entry in DevTools. `FEATURE_FLAG_REGISTRY` is the code-side manifest of every flag the app
references — explicit `feature:*` entries plus every `featureFlag` declared on a `navItems.jsx`
entry (auto-derived, reusing the nav label). When DevTools → Feature Flags loads, `FlagsTab.load()`
upserts any registry key **missing** from `feature_flags` — created **ENABLED**, and never touches
an existing row. ENABLED (not OFF) is deliberate: `isFeatureEnabled` treats a missing flag as **ON**
("no row = unrestricted"), so seeding OFF would *hide* a feature that was already live. To
dark-launch a feature OFF, set `enabled: false` on its registry entry. Add a flag going forward by
appending one line to `EXPLICIT_FLAGS`, or just set `featureFlag` on a nav item — it self-registers
on the next DevTools open.

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
- **Office notifications on signing (Jun 24 2026):** after `complete_sign_request`, `submit-esign.js` fires three best-effort (non-fatal) alerts so the office knows a client signed — see **In-App Notifications** below:
  1. **In-app** — `create_notification('esign_signed', …, p_link='/jobs/<id>')` → sidebar bell badge + live toast.
  2. **Activity timeline** — inserts a system-authored `job_notes` row (`author_name='E-Signature'`, body `✍️ <name> signed the <doc>.`) so it shows on the Job page activity tab (which renders `job_notes` + phase history, not `system_events`).
  3. **Internal email** — `sendEmail` to `restoration@utah-pros.com` (Resend) with the signed PDF attached + an "Open the job in UPR" link.

## In-App Notifications (Jun 24 2026)
Lightweight **org-wide** (shared-read) notification feed surfaced by a **bell in the sidebar header**. First and only producer today is e-signature completion; designed to be reused for future events.
- **Table `notifications`:** `id UUID PK, type TEXT, title TEXT, body TEXT, link TEXT (in-app route), entity_type TEXT, entity_id UUID, job_id UUID, payload JSONB, read_at TIMESTAMPTZ (null = unread), created_at TIMESTAMPTZ`. RLS: SELECT to anon/authenticated; **writes only via the SECURITY DEFINER RPC** (no insert policy). Added to the `supabase_realtime` publication.
- **RPCs:** `create_notification(p_type,p_title,p_body,p_link,p_entity_type,p_entity_id,p_job_id,p_payload)` (also granted to `service_role` for workers), `get_notifications(p_limit DEFAULT 30)`, `get_unread_notification_count()`, `mark_notification_read(p_id)`, `mark_all_notifications_read()`.
- **Frontend:** `src/components/NotificationBell.jsx` (mounted in `Sidebar.jsx` header) — bell + unread badge + dropdown; polls the count every 60s and subscribes to realtime inserts (`subscribeToNotifications` in `lib/realtime.js`) to update live and fire a `upr:toast`. Clicking an item marks it read and navigates to `link`. **Shared read state** — marking read clears it for everyone (fine for a small office; swap to a per-user read table if needed).
- **Migration:** `supabase/migrations/20260624_notifications.sql` (applied).

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
- **Calendar events (kind='event'):** non-job blocks like meetings, PTO, training. Created via the "+ FAB" or empty-cell click which opens a Job-vs-Event picker. Event rows live in the same `appointments` table with `job_id=NULL` and are fetched via `get_dispatch_events`. `CalendarView.jsx` renders them with the Appointment-blue card style (or Task-green when `type='task'`), hiding job-only chrome (address, job #, tasks). Clicking an event opens `EventModal.jsx` (create/edit combined); clicking a job still opens `EditAppointmentModal`. Division filter hides events; crew filter still applies. `hexToTint` helper lives in `src/lib/scheduleUtils.js`.
- **Design-system reskin (Jun 25 2026 — Week Calendar + page shell):** Schedule now wears the shared UPR design system (matches Collections + Dashboard). Page bg `#f4f5f7`, white header/filter bars with `#e7e9ee` borders, 23/800 title. Toolbar uses the shared `collKit` primitives — black-active `SegControl` for the Calendar/Jobs/Crew + Day/3Day/Week/Month toggles, `GhostButton` for This-week/prev/next, `coll-primary` for **+ New**. Division/Crew filters are `ToggleChip`s with a division/crew color swatch (emoji dropped). **Event-card colors now encode DIVISION, not crew** (teal Mitigation = water/fire/contents, purple Reconstruction, coral Remodeling, pink Mold; Appointment blue, Task green, dashed Tentative, gray Completed) via the new helper `src/components/schedule/eventCardStyle.js`; crew stays visible via avatar circles. Cards are soft-tint bg + 3px colored left bar + dark colored title; the week grid sits in a white card shell and the now-line is `#df3b34`. **Reskin only — no behavior/geometry/data changes:** the 7am–10pm grid, pixel time math, drag/resize, overlap-graph, placement mode, mobile swipe, and all `.schedule-*` responsive show/hide are untouched.
- **Follow-up reskin (Jun 25 2026 — Jobs/Crew/Month views + JobPanel):** the remaining Schedule surfaces now match. Jobs-view + Crew-view appointment cards (`ApptCard`/`CrewApptCard`) and the Month-view chips are division-colored via `eventCardStyle`; the left **JobPanel** is on the new palette (white chrome on `#e7e9ee`, blue-tint filter chips, `divisionPill` badges). New export `divisionPill(division)` in `eventCardStyle.js` gives a division-matched label pill in the new palette (teal/purple/coral/pink) — used by the Jobs-view label, the Crew-card job badge, and JobPanel, since the app-wide `DIV_COLORS` (blue water / amber recon) would otherwise clash with the cards. `DIV_COLORS` itself is unchanged (still used by tech pages). Still reskin-only — no behavior/data changes.

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

## Google Integration — per-employee Drive + Calendar (Jun 2026)

Each employee connects **their own** Google account once (Settings → Integrations →
"Connect Google"). One consent grants **both** features (non-restricted scopes →
no Google app verification for an Internal Workspace app):
- `drive.file` — pick files from Drive into a job (JobPage Files tab).
- `calendar.events` — push the appointments they're assigned to into their Google Calendar.

**Tokens:** `user_google_accounts` (PK `employee_id`; `access_token`, `refresh_token`,
`token_expires_at`, `google_email`, `scopes`). RLS on, **service-role only**. Refresh
token never leaves the server. Token refresh + OAuth lib: `functions/lib/google-drive.js`
(`getValidAccessToken` is shared by Calendar). OAuth state stashed in `integration_config`
(`gdrive_oauth_state` / `gdrive_oauth_user`).

### Calendar sync (Jun 28 2026)

Pushes appointments → each assigned crew member's Google Calendar (create / update /
delete). **Built to survive the planned appointments→scheduled-jobs refactor:** the
mapping is source-agnostic.

- **`google_calendar_links`** — durable mapping, one row per (synced occurrence × crew
  member). Cols: `id, source_type` (`'appointment'` today, `'job_schedule'` later),
  `source_id, employee_id, google_event_id, calendar_id, sync_hash, status`
  (`pending|synced|deleted|error`), `last_error, synced_at`. UNIQUE
  `(source_type, source_id, employee_id)`. RLS on, service-role only. Retains the
  event-id mapping even after the source row is deleted, so deletes/updates always land.
- **RPC `get_google_calendar_status()`** — per-caller `{connected (has calendar scope),
  google_email, synced_count, error_count}`.
- **Triggers** `trg_appointments_calendar_sync` (appointments I/U/D) +
  `trg_appointment_crew_calendar_sync` (crew add/remove) → `notify_google_calendar_sync()`
  → `net.http_post` to the worker (pg_net, same pattern as QBO customer sync). **Inert
  until ≥1 employee has the calendar scope** (cheap EXISTS guard), so it's a no-op on prod
  until someone connects.
- **Workers:** `functions/api/google-calendar-sync.js` (trigger target, secret-auth via
  `integration_config.gcal_webhook_secret`) and `functions/api/google-calendar-resync.js`
  (authenticated "sync my upcoming appointments now" backfill, today→+60d). Core logic in
  `functions/lib/google-calendar.js` (`syncAppointment`, `removeSourceEvents`,
  `buildEventBody`). Times sent with explicit `timeZone: 'America/Denver'` (appointments
  store local date+TIME, no TZ). `status='cancelled'` or a deleted appointment removes the events.
- **`integration_config`:** `gcal_worker_url` (seeded to the **dev** host — flip to
  `https://utahpros.app/api/google-calendar-sync` on production release) + `gcal_webhook_secret`.
- **Requires** the same Google Cloud OAuth client + Cloudflare env vars as Drive
  (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`), plus the calendar scope on the OAuth consent screen.

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

**One invoice per job (= per division)** is the norm — insurance pays each category (mitigation, reconstruction) on separate checks, so each check applies to its own single-class invoice. **A job can have more than one invoice when a supplement is needed** (you can't add lines to an already-paid invoice). The QBO `DocNumber` is unique per invoice: the number QBO already assigned, else `job_number` for the first invoice and `job_number-N` for the Nth (e.g. `R-2604-009`, then `R-2604-009-2`) — see `functions/api/qbo-invoice.js`. UPR's `invoices` / `invoice_line_items` / `invoice_adjustments` tables are the source of truth (draft → push to QBO); QBO gets a clean summary invoice.

**Read endpoint:** `functions/api/qbo-query.js` — POST, SELECT-only QBO query passthrough (Items/Classes/Invoices); auth via `x-webhook-secret` or Supabase Bearer; tokens stay server-side.

**Foundation (`migrations/20260618_invoice_qbo_foundation.sql`):** `invoices.qbo_invoice_id/qbo_synced_at/qbo_sync_error`; `generate_invoice_number()` (seq `invoice_number_seq` → `INV-######`); `create_draft_invoice_for_job()` AFTER INSERT trigger on `jobs` (one draft per job), **gated by `integration_config.auto_draft_invoices` (default `'false'` = dormant)**.

**Push worker:** `functions/api/qbo-invoice.js` — POST `{ invoice_id }` creates the QBO invoice (one line: division→Item+Class via `divisionToQbo`, amount = `adjusted_total`/`total`, customer = contact `qbo_customer_id`, claim/job ref in PrivateNote); idempotent on `qbo_invoice_id`. `{ invoice_id, action:'delete' }` removes it from QBO. `{ invoice_id, action:'send', send_to? }` asks QBO to **email the invoice to the customer** (QBO `/invoice/{id}/send` via `sendInvoice()`; recipient defaults to the invoice contact's email, override with `send_to`); on success stamps `invoices.qbo_emailed_at` + `qbo_email_status` (+ `sent_to_email`). Surfaced as the "Send invoice to customer" button (two-click confirm) in `InvoiceEditor.jsx`. Logs `worker_runs` as `qbo-invoice`. **UI note:** the editor presents this as a native UPR invoice — the primary **Save** button persists line edits and pushes to QBO (create first time, update after) in one step; QuickBooks is not surfaced in the UI labels (status: Draft → Saved → Sent → Partial → Paid).

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

**QBO→UPR payment sync — IMPLEMENTED (Jun 24 2026).** When a customer pays a QBO invoice online (card/ACH), the payment now flows back into UPR automatically:
- **`functions/api/qbo-webhook.js`** (`POST /api/qbo-webhook`) — Intuit webhook receiver. Verifies the `intuit-signature` HMAC against `QBO_WEBHOOK_VERIFIER_TOKEN`, claims each event once via `claim_qbo_event` (idempotent), and for `Payment` entities mirrors the payment into UPR (Delete/Void/Merge → removes the imported payment). Inert (acks 200) until the verifier token is set.
- **`functions/api/qbo-payments-sync.js`** (`GET/POST /api/qbo-payments-sync`, + `scheduled()`) — hourly safety-net poller; queries recent QBO Payments and reconciles any the webhook missed. Logs `worker_runs` as `qbo-payments-sync`. **Point an hourly cron at it (same mechanism as `process-scheduled`).**
- **`functions/lib/qbo-payment-sync.js`** — shared `syncQboPaymentToUpr()` / `removeQboPaymentFromUpr()`. Maps a QBO Payment's linked invoices → UPR invoices (by `qbo_invoice_id`), inserts `payments` rows (`source='qbo'`, method mapped to credit_card/ach/other), and the existing `update_invoice_paid` trigger rolls them up. **Dedup:** skips any QBO payment whose `qbo_payment_id` already exists on a UPR payment — so UPR-originated payments are never double-counted.
- **`functions/lib/intuit.js`** — `verifyIntuitSignature()` (base64 HMAC-SHA256) + `sha256hex()`.
- **Schema (`supabase/migrations/20260624_qbo_payment_webhook.sql`):** `qbo_events` table (event idempotency, service-role only) + `claim_qbo_event(p_id,p_entity,p_operation)` RPC (mirrors `claim_stripe_event`).
- **Setup:** Intuit Developer → app → Webhooks → endpoint `https://utahpros.app/api/qbo-webhook`, subscribe **Payment**, copy the Verifier Token → Cloudflare `QBO_WEBHOOK_VERIFIER_TOKEN` (Production + Preview).

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

## QuickBooks Online — Estimates (Jun 25 2026)

A full line-item **estimate builder** that mirrors the invoice tool, syncs to QBO, and
converts to an invoice. Ships **dormant** behind the `page:estimates` feature flag
(seeded **disabled** — a missing flag would read as ON, so the OFF row is required).
Edits gated by `canEditBilling` (admin + manager), same as invoices.

**Estimates are PRE-SALE and decoupled from jobs** (decouple migration
`20260625_estimate_decouple.sql`): an estimate is owned by a **contact** + an **intended_division**
(the job type it would become) + an optional property address — `job_id` stays NULL until it's
**sold**. Multiple estimates per client (initial / supplement / change_order / final). The dashboard
"Open estimates" donut (`get_open_estimates_summary`) buckets on
`COALESCE(intended_division, jobs.division)`.

**DB (`migrations/20260625_estimate_builder.sql`, applied):**
- `estimate_line_items` — clone of `invoice_line_items` (line_total GENERATED; qbo_item/class per line).
- `estimates` extended with `contact_id`, `subtotal`, `expiration_date`, `converted_invoice_id`
  (FK invoices) + the `qbo_*` sync columns.
- `recompute_estimate_from_lines()` trigger → rolls lines into `estimates.subtotal` + `amount`.
- `generate_estimate_number()` → `EST-NNNNNN` (own sequence).
- `create_estimate_for_contact(p_contact_id, p_intended_division, p_estimate_type DEFAULT 'initial',
  p_property_address/city/state/zip, p_created_by)` — makes an estimate from a CLIENT, no job.
  (Legacy `create_estimate_for_job` kept but deprecated/unused.)
- `get_estimates()` — one row per estimate; division = `COALESCE(intended_division, jobs.division)`;
  client from `contact_id`; job/claim columns populated only once converted. Granted anon, authenticated.
- `convert_estimate_to_invoice(p_estimate_id, p_force, p_created_by)` — when the estimate has no job
  (pre-sale), **silently auto-creates a claim + job** from contact + intended_division + property
  address (no insurance = OOP) via `create_job_with_contact`, then `create_invoice_for_job`, copies
  lines, links `invoices.estimate_id` + `estimates.converted_invoice_id`, status→'approved'. Legacy
  job-coupled estimates still convert as before; signature unchanged.

**Worker (`functions/api/qbo-estimate.js` + `lib/quickbooks.js`):** itemized push/update/delete/send to
the QBO `/estimate` endpoint (`createEstimate`/`updateEstimate`/`deleteEstimate`/`sendEstimate`,
reusing `divisionToQbo`/`findClassId`). Division (item/class) comes from `estimates.intended_division`,
the customer from `estimates.contact_id`, the service address from `estimates.property_*` — a job is
optional (only once converted). Uses `estimate_number` as the QBO DocNumber, sets `TxnStatus:'Pending'`
+ optional `ExpirationDate`, advances UPR status draft→submitted on first push.

**Convert → invoice in QBO (both requested directions):**
- **UPR-initiated:** the "Convert to invoice" button runs the convert RPC then pushes the invoice;
  `qbo-invoice.js` adds `LinkedTxn:[{TxnType:'Estimate'}]` when the invoice's linked estimate has a
  `qbo_estimate_id`, so QBO marks the estimate converted/Closed.
- **QBO-initiated (deposit auto-convert, dormant):** when a customer pays a deposit on an estimate via
  QBO's online pay link, QBO turns it into a new invoice. The inbound payment sync
  (`lib/qbo-payment-sync.js` → `adoptInvoiceFromQboEstimate`) detects a QBO invoice with no UPR match
  but a `LinkedTxn→Estimate`, finds the UPR estimate by `qbo_estimate_id`, runs
  `convert_estimate_to_invoice` (force), and adopts the QBO invoice id so the payment lands and the
  estimate shows converted in UPR. Activates with the QBO Payment webhook (§4B of QBO-BILLING-STATUS).

**Frontend:** `src/pages/EstimateEditor.jsx` (`/estimates/:id`) · `src/pages/Estimates.jsx`
(`/estimates`, list + KPIs + filters) · `src/components/NewEstimateModal.jsx` (client search/create
via AddContactModal + intended-division picker + optional property address — NO job picker) ·
`src/components/AutoGrowTextarea.jsx` (shared, line-item
description grows down + accepts line breaks for scope of work — also adopted by InvoiceEditor). Nav
entries (`navItems.jsx`: sidebar + desktop overflow) + routes (`App.jsx`) gated by `page:estimates`.

**Builder rebuild (Jun 2026) — `InvoiceEditor.jsx` + `EstimateEditor.jsx`, full builders in the
Collections design:** both editors were rebuilt to feel like a complete invoice/estimate builder
(HouseCall Pro / QuickBooks) and reuse the Collections design system (`collKit` / `collTokens` / `.coll-*`),
not the app-wide tokens.
- **Top action toolbar** (QBO-style, beside "← Back"): Save · Send to customer · Receive payment (invoice
  only) · Create/Copy pay link · Preview · **Manage ▾**. The Manage menu is the new
  **`src/components/collections/ActionMenu.jsx`** (self-contained dropdown, outside-click/Esc close, two-click
  confirm) and tucks away Revert to draft / Delete draft. This replaced the old bottom action bar.
- **Single full-width column** (no lateral panels): a header `CollCard` carries the eyebrow
  (INVOICE / ESTIMATE) + status (`StatusBadge` / `Pill`) + **doc-number heading** (on both editors this big
  number is a **link to the job** — `navigate('/jobs/:id')`, with an external-link icon beside it + hover
  underline, shown when the doc has a linked job) + Bill-to / Prepared-for, then a
  responsive details grid (Carrier · Claim · Job · Date of loss · Sent; **invoices add an editable Due
  date** — UPR `invoices.due_date`, does NOT sync back from QBO) + the **service/loss address** (`job.address…`
  → fallback `claim.loss_*`, the same source QBO uses). Estimates also show Type.
- **Line editor:** new **`src/components/collections/SearchSelect.jsx`** (typeahead dropdown, outside-click/
  Esc close) for the QBO Item & Class per line (options from `/api/qbo-query` SELECT … FROM Item/Class —
  the Item query selects `Type` and **filters out `Type='Category'`**, since QBO categories are grouping
  parents that can't go on a transaction line; selecting one would make QBO reject the push with "An item
  in this transaction is set up as a category instead of a product or service." A line still pointing at a
  category, e.g. a pre-existing one, renders a blank Item cell + a warning banner prompting a re-pick);
  HTML5 **drag-to-reorder** persisting `sort_order`; `AutoGrowTextarea` description; qty/rate cells; footer
  **Subtotal → Total** (invoice shows read-only **Tax** only when `invoices.tax` is set — UPR-side, never
  pushed to QBO as a separate line). Line edits save on blur/select without reloading; **Save** flushes +
  pushes to QBO (create first time, update after). A fresh **editable draft auto-opens with one blank line**
  (inserted on load when there are 0 lines) so the builder is ready to type.
- **Invoice payment summary** (full-width `CollCard` below the builder): Invoiced / Collected / Balance KPIs
  + `ProgressBar` + a HouseCall-Pro-style **payment history table** (Date · Type · Amount · Note;
  `payments?invoice_id=eq.…`). **Clicking a row opens a view-first modal** (in-file in `InvoiceEditor`,
  `C`-token styled like the preview overlay, Esc/backdrop close): read-only details + a QBO sync badge,
  then a deliberate **Edit** step loads the form *inside* the modal (guards accidental edits). Saving
  updates the `payments` row and re-syncs QBO by **delete + recreate** (the `/api/qbo-payment` worker has
  create + delete only, no update); **Delete** lives inside the edit step (two-click); **Update** is
  disabled until a field actually changes. **Stripe (card) payments are view-only** (no Edit/Delete) to
  protect the Stripe↔QBO fee reconciliation. The same modal opens in "new" mode from the **Receive
  payment** toolbar button (no inline form, no per-row Delete). Estimates have no payments; instead a
  "→ Convert to invoice" action.
- **Customer preview overlay** → `window.print()` with scoped print CSS (a faithful UPR-rendered preview;
  the *emailed* PDF is still generated by QuickBooks).
- **Back button = `navigate(-1)`** (returns to wherever you came from). For this to land on the right
  Collections tab, `Collections.jsx` syncs its active tab into **`?tab=`** (replace) via `changeTab` —
  so the dashboard "Open estimates" widget deep-links `/collections?tab=estimates`, the `/estimates` route
  redirects there, and Back from a builder restores the exact tab (A/R · Invoices · Estimates · Payments).
- **Deferred:** (a) editable customer memo / terms / PO (Phase 2 — needs schema + QBO worker; until then the
  customer memo is auto-generated on QBO push, shown read-only); (b) a per-invoice **Activity feed**
  (SMS/email/invoice/payment events, HouseCall-Pro-style) — worth building once UPR sends its own invoices
  instead of relying on QBO to email them.

---

## AI — Xactimate estimate → pre-filled invoice draft (Jun 2026)

> **Deep-dive:** for the full billing/QBO/Xactimate engineering context (invoice builder, two-way QBO sync, payments, Stripe, and this AI tool), see **`BILLING-CONTEXT.md`**.

**UPR's first AI/LLM integration.** Upload an Xactimate estimate PDF on the invoice builder and Claude reads
it, determines the amount we bill insurance, and pre-fills the draft. **Human-in-the-loop: it only fills a
DRAFT — nothing posts to QBO until the user reviews and Saves.**

**Worker (`functions/api/analyze-xactimate.js`):** POST `{ invoice_id, file_path }` (Supabase Bearer auth).
Downloads the uploaded PDF from the `job-files` bucket (service role) → base64 (chunked, V8-safe) → calls the
**Anthropic Messages API** (`https://api.anthropic.com/v1/messages`, `x-api-key: env.ANTHROPIC_API_KEY`,
`anthropic-version: 2023-06-01`) with model **`claude-opus-4-8`**, a base64 **document** block, and a **forced
strict tool** (`submit_estimate`, `tool_choice:{type:'tool'}`) whose schema returns `line_items[]`,
`totals{line_item_total,overhead,profit,sales_tax,rcv,depreciation,acv,deductible,net_claim,paid_when_incurred}`, and
`billable{amount,basis(RCV|ACV|net_claim|line_item_total),confidence,rationale}`. Inserts **one summary
line** at the billable amount (RCV by default — restoration bills full replacement cost), replacing any blank
auto-added line, and **pre-fills that line's QBO Item + Class from the job's division** via the shared
`divisionToQbo`/`findClassId` (functions/lib/quickbooks.js) — the same mapping the invoice sync uses, so the
draft shows exactly what will post (e.g. Water → "Water Damage Mitigation And Drying" / Mitigation class).
Logs `worker_runs` as `analyze-xactimate`. **Does not** touch QBO. Returns the recap (billable + totals +
reconciliation + work_type + paid_when_incurred) for the UI banner **and persists the same recap to
`invoices.xactimate_meta` (JSONB, added Jun 2026)** so the banner survives a refresh and stays available after
the invoice is saved (best-effort write — never fails the import).

**Work-type awareness (mitigation vs reconstruction):** the prompt is tailored from the job's division (via
`divisionToQbo` → Mitigation/Reconstruction). For **mitigation** (water/fire/mold cleanup) the model expects
no depreciation/deductible and bills the full RCV (= the total) at high confidence. For **reconstruction** it
watches for **"Paid When Incurred" (PWI)** line items (carriers like Farmers hold back continuous flooring
until the work is completed/photographed), sums them into `totals.paid_when_incurred`, and **keeps the
billable at the full RCV** — the held-back amount is surfaced in the banner (⏳ note) for the human to trim if
billing in stages, never auto-subtracted. The worker returns `work_type` and `paid_when_incurred`.

**Consistency (how we get the same behavior every time):** no fine-tuning. (1) The **strict tool schema**
guarantees an identical output shape every run. (2) A **worked example** in the prompt + a pinned model
anchor the one judgment call ("which total"). (3) A **deterministic arithmetic cross-check** in the worker
(RCV≈line_items+overhead+profit+tax, ACV≈RCV−depreciation, net_claim≈RCV−depreciation−deductible, within
$1/1%) auto-downgrades `high`→`medium` confidence and flags a mismatch, and the human confirms before Save.
Checks reconcile against **RCV** (always printed), never ACV — Xactimate omits the ACV line when no
depreciation is withheld, and the earlier net_claim≈ACV−deductible check then compared against 0 and falsely
flagged clean estimates as not reconciling.

**Keeping it improving (the "training" loop):** there is no fine-tuning — the API is stateless, so the
Anthropic Console (Workbench/Evals) is only for prototyping prompt wording and watching cost; it does **not**
push to UPR. The AI's behavior lives entirely in `analyze-xactimate.js`: the prompt, a `## Worked examples`
section (seeded with one reconstruction + one mitigation example), and the deterministic checks. To teach it
a new rule, add guidance / a worked example / a check there and ship. As the example set grows past the
~4K-token cache minimum (Opus 4.8), move the stable prompt+examples into a `cache_control` prefix to keep
cost/latency flat.

**Frontend (`InvoiceEditor.jsx`):** an **✨ Import Xactimate** toolbar button (gated `canEdit && !synced &&
job?.id && isFeatureEnabled('feature:ai_xactimate')`) → file picker → uploads the PDF to
`job-files/{job_id}/xactimate/{ts}-{name}.pdf` + records it via `insert_job_document` (category `xactimate`)
so the **source estimate is retained on the job automatically** — *skipping the upload and reusing the
existing copy* if a job_document with the same filename + `xactimate` category is already attached (no
duplicates). Then calls the worker and reloads. A **confirmation banner** shows the chosen amount, basis,
confidence, the totals breakdown, a ⏳ "Paid When Incurred" held-back note when present, and a ⚠ warning when the totals don't reconcile. The banner is **hydrated from `inv.xactimate_meta` on every load** (once per mount, so a manual ✕ dismiss isn't undone by line-edit reloads), so it persists across refresh and after QBO save — only the "review before Save" line is gated to drafts. While the AI works, a
**progress modal** shows a spinner, a simulated progress bar, and a status line that rotates through the real
steps (upload → read → extract → identify billable → reconcile → fill).

**Going live requires two ops steps (not code):** add **`ANTHROPIC_API_KEY`** to Cloudflare Pages env (both
**Preview** and **Production**) + redeploy, and enable the **`feature:ai_xactimate`** flag (DevTools →
feature flags). Until the key exists the worker returns `503` and the UI toasts "AI isn't configured." Key
stays server-side only — never the frontend.

**Phase 2 (later):** category/itemized line granularity (one line per room/trade instead of a single summary
line); auto-fill `tax`/`deductible`/depreciation adjustment columns; pick an already-attached job document
instead of uploading; a general "AI document import" surface (estimates, scope sheets).
*(Done: work-type-aware prompt — mitigation vs reconstruction; PWI detection + ⏳ banner note.)*
*(Done Jun 2026: QBO Item/Class auto-fill from division; progress modal; RCV-based reconciliation fix.)*

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

## Desktop/Tablet Navigation Shell (≥1024px) — Top Nav + Overflow Drawer + Settings Hub (Jun 24 2026)

A HousecallPro-style **top horizontal nav** replaces the dark vertical sidebar on **desktop and iPad-landscape widths (≥1024px)**. Phones (≤768px) and narrow tablets / iPad portrait (769–1023px) keep the dark `Sidebar` slide-over + mobile bottom bar. (Breakpoint was originally ≥1280px — lowered to **1024px on Jun 25 2026** so regular iPads in landscape get the top nav too; the prior state is preserved on branch `backup/pre-ipad-nav-breakpoint`.) The `/tech/*` field-tech app is untouched.

- **CSS-only shell:** both `<Sidebar>` and `<TopNav>` are always in the DOM; a single `@media (min-width:1024px)` block (end of `index.css`) hides `.sidebar`, shows `.topnav`, flips `.app-layout` to `flex-direction:column`, sets `--topnav-h:56px` (0 elsewhere so mobile math is unchanged), and height-corrects the three full-viewport pages (`.conversations-layout`, `.jobs-page`, `.job-page` → `calc(100dvh - var(--topnav-h))`). The `@media (max-width:768px)` block is byte-for-byte untouched. A companion `@media (min-width:1024px) and (max-width:1279px)` block collapses the `GlobalSearch` box to its icon (expands on focus) so all 7 primary links fit at narrower iPad widths; ≥1280px keeps the full inline 340px search.
- **Single source of truth:** `src/lib/navItems.jsx` — `NAV_ITEMS` (legacy sidebar list, unchanged) + `PRIMARY_ITEMS`/`OVERFLOW_ITEMS`/`SYSTEM_ITEMS` + `isItemVisible(item, {canAccess,isFeatureEnabled,employee,isMoroni})` (mirrors legacy gating: adminOnly → role; moroniOnly → email; `always` skips canAccess (Help); else canAccess(key); then featureFlag).
- **Top bar (`TopNav.jsx`):** logo · primary links [Home `/`, Inbox `/conversations` (unread badge), Schedule, Claims, Customers, My Money `/collections` (`page:collections`), Time `/time-tracking` (`page:time_tracking`)] · `GlobalSearch` · `NewMenu` · `NotificationBell` · Help link (`/help`) · settings gear (`/settings`) · `UserMenu`. **Home/Inbox/My Money/Time are LABEL renames only** — routes + nav_keys unchanged.
- **Overflow drawer (`OverflowDrawer.jsx`):** hamburger-opened left slide-over (dark) — Jobs, Production, Schedule Templates, Encircle Import, OOP Pricing, Leads, Marketing.
- **New menu (`NewMenu.jsx`):** New Claim (→ existing job+claim creator `CreateJobModal`), New Estimate (global `NewEstimateModal`, gated on `page:estimates` — hidden until the flag is on, in lockstep with the Estimates nav links), New Customer (`AddContactModal`), New Invoice (global `NewInvoiceModal`) — all via `Layout.handleCreateAction`.
- **User menu (`UserMenu.jsx`):** avatar dropdown — admin-only Tech View + Sign Out.
- **Settings hub (`SettingsLayout.jsx`):** pathless route wrapping the SYSTEM pages (`/settings`, `/help`, `/admin`, `/admin/demo-sheet-builder`, `/tech-feedback`, `/dev-tools`). Desktop shows a left sub-rail (`SYSTEM_ITEMS`, gated via `isItemVisible`): Settings · Admin · Scope Sheet Builder · Tech Feedback · Dev Tools. **Help & Guides is reached from the top-bar Help icon (`/help`), not the rail** — the page still renders inside the hub layout. Below 1024px it's `display:contents` (passthrough — pages render exactly as before). Paths + AdminRoute/DevRoute guards unchanged. `Settings.jsx` keeps its own internal Carriers/Referrals/Templates sub-nav inside its content.
- **Bell single-mount:** `Layout` gates the one `NotificationBell` by `matchMedia('(min-width:1024px)')` (TopNav on desktop/iPad-landscape, Sidebar header otherwise) so there are never two live notification subscriptions (no duplicate toasts). `NotificationBell` gained an optional `align` prop ('left'|'right').

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

---

## Homebuilding Entry Analysis (Moroni-only)

Private planning page at `/homebuilding` (gated to `moroni@utah-pros.com` via `MoroniRoute`
in `App.jsx`; side-nav link in `Sidebar.jsx` + desktop overflow entry in `navItems.jsx`).
Rendered by `src/pages/HomebuildingAnalysis.jsx` (self-contained: inline styles + scoped
`<style>`, inline-SVG icons, hand-built SVG radar — no recharts/lucide/Tailwind). Sections:
three entry paths, per-market profiles, **Build Copilot** (AI chat), **Deal Modeler**,
**AI Build & Value Estimator**, financing ladder, decisions, risk.

### AI workers (Cloudflare Pages Functions)
Both reuse the existing `ANTHROPIC_API_KEY` (Preview + Production) and re-check the logged-in
user's email server-side (`moroni@utah-pros.com`).
- `functions/api/homebuilding-chat.js` — Build Copilot chat. **Sonnet 4.6** + the `web_search`
  server tool (current rates/prices/code editions), handles `pause_turn`. Non-streaming, so it
  must finish inside Cloudflare's ~100s timeout — hence Sonnet + capped `max_uses`(3)/continuations(2);
  the frontend also has a 95s AbortController. Gets the live deal-modeler state as context.
- `functions/api/homebuilding-estimate.js` — AI estimator. **Sonnet 4.6**, single forced-tool
  structured-output call (no web search). Inputs: region, beds, baths, sqft, stories, finish,
  land, features → `{ build_cost{low,expected,high}, cost_per_sf, breakdown[], arv{...},
  feature_notes[], confidence, assumptions[], notes[] }`. ARV anchored to comps, capped at the
  neighborhood ceiling.

### History tables (new) — chat + estimate persistence
RLS enabled, **no public table policies**; access only via SECURITY DEFINER RPCs granted to
`authenticated`. Read/written from the frontend via `db.rpc(...)` (workers do not persist).
- `homebuilding_chats` — `id UUID PK, title TEXT, created_at, updated_at` (renameable conversations)
- `homebuilding_chat_messages` — `id UUID PK, chat_id UUID FK→homebuilding_chats ON DELETE CASCADE, role TEXT('user'|'assistant'), content TEXT, created_at`
- `homebuilding_estimates` — `id UUID PK, label TEXT, region TEXT, spec JSONB, estimate JSONB, created_at`

### History RPCs (new)
```
list_homebuilding_chats()                                  -- ordered by updated_at desc
create_homebuilding_chat(p_title)                          -- returns the new chat row
rename_homebuilding_chat(p_id, p_title)
delete_homebuilding_chat(p_id)                             -- cascades messages
get_homebuilding_chat_messages(p_chat_id)                  -- ordered by created_at
add_homebuilding_chat_message(p_chat_id, p_role, p_content) -- also touches chats.updated_at
save_homebuilding_estimate(p_label, p_region, p_spec, p_estimate) -- returns the saved row
list_homebuilding_estimates()                              -- newest first, limit 100
rename_homebuilding_estimate(p_id, p_label)
delete_homebuilding_estimate(p_id)
```
The Build Copilot loads/saves conversations (switch, rename, new, two-click delete); the AI
Estimator auto-saves every run and shows a Saved-estimates list (view, rename, two-click delete).


---

## New Build simulator (Moroni-only)

Full-page tool at `/homebuilding/build` (Moroni-only via `MoroniRoute`), reached from a "+ New Build"
button in the Homebuilding Analysis title block. Rendered by `src/pages/NewBuildSimulator.jsx`.
Numbers-first build planner: a standard Utah template seeds an editable itemized budget, a
schedule (gantt), a construction-loan draw schedule, financing/returns, save/load projects, optional
AI tuning, AI ARV estimate, and PDF export.

### Engine — `src/lib/buildTemplate.js`
Pure data + math (no UI). `PHASES` (trade line items w/ cost share, duration weeks, draw milestone),
`FEATURES`, `DRAW_STAGES`. Functions: `computeLineItems(spec)` (trade lines total region/finish
$/sf × sqft exactly; finish/story/bath scaling; feature add-ons), `computeSchedule`, `computeDraws`
(sum to hard total), `computeFinancing` (mirrors the deal-modeler formula), `buildPlanFromSpec`,
`defaultSpec`. Hard-cost $/sf already includes GC overhead & profit; soft + contingency are separate %.

### Workers (Cloudflare Pages Functions) — Moroni-gated, reuse ANTHROPIC_API_KEY
- `functions/api/homebuilding-plan-tune.js` — Sonnet 4.6, forced-tool structured output. Tunes the
  template baseline (per-line totals + phase durations + soft/contingency %) to the spec/submarket.
- `functions/api/homebuilding-build-plan-pdf.js` — pdf-lib; renders a multi-section Build Plan PDF
  (cover, spec, budget table, schedule, draws, financing) and returns application/pdf bytes for
  direct browser download (no storage). WinAnsi-sanitized text.

### Table `homebuilding_build_projects` (new)
`id UUID PK, label TEXT, region TEXT, spec JSONB, plan JSONB (lineItems/schedule/arv), created_at,
updated_at`. RLS on, no public table policies; access via SECURITY DEFINER RPCs granted to
`authenticated`:
```
list_homebuilding_build_projects()
get_homebuilding_build_project(p_id)
save_homebuilding_build_project(p_id, p_label, p_region, p_spec, p_plan)  -- null id = insert, else upsert
rename_homebuilding_build_project(p_id, p_label)
duplicate_homebuilding_build_project(p_id)
delete_homebuilding_build_project(p_id)
```
Derived numbers (hard total, draws, months, financing) are recomputed on the page from the stored
lineItems/schedule/arv; only those are persisted in `plan`.

### City/submarket detail (buildTemplate.js `SUBMARKETS`)
Per-city anchors for both regions — `{ name, psfMult (construction-cost nudge), lot (typical $),
arvPsf (resale $/sf) }`. Wasatch: SLC east bench, SLC County, Draper, Lehi/Saratoga Springs, Eagle
Mountain, Provo/Orem, Spanish Fork/Salem, Park City. Southern: St. George, Washington, Hurricane,
Ivins, Santa Clara, Toquerville/LaVerkin. The Spec tab's submarket is a dropdown; picking a city sets
the typical lot and scales the build cost (`submarketMult`). `computeArvBaseline(spec)` gives a quick
comps-based ARV ("City comp ARV" button) from `arvPsf`; the AI estimate (now passed the submarket)
refines it.

### Floor-plan builder (New Build → "Floor Plan" tab)
Drag room tiles from a palette onto a 1-ft grid (HTML5 DnD), then drag to move / pull the corner to
resize (pointer events; window-level move/up driven by a ref). Room model in `buildTemplate.js`:
`ROOM_TYPES` (each with fill, bed, bath, conditioned, default w/h ft), `roomDef`, and
`floorplanTotals(fp)` → { conditioned sqft, bedrooms, bathrooms, rooms }. Garage + covered patio are
excluded from conditioned sqft. The plan is stored in `plan.floorplan` (persists via the existing
build-project RPC). **Sync to spec** writes sqft/bd/ba into the Spec and regenerates the budget +
schedule from it (`buildPlanFromSpec`), so building a plan auto-costs it.

