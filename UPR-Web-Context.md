# UPR Web Platform — Context Document
Last updated: July 1, 2026 (accuracy audit — corrected table/employee/flag counts, DevTools tab count,
Capgo pipeline status, PostgREST select() gotcha, divisionToQbo remodel bucket, and other drift; see
git history for the full findings)

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
                                    added by 20260626_get_ar_invoices_created_at.sql; clickable column headers override —
                                    Client/Sent/Age/Total/Collected/Balance, Client A→Z on first click, numeric/date cols descending-first),
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
                                    money twice). EACH aging bucket amount is also click-to-filter (Jul 2026): tapping
                                    a band drills the table to the open invoices in that age range (state `bucket`;
                                    `.coll-aging-btn`). A bucket OVERRIDES the Open/Overdue/All `mode` (aging applies
                                    only to open invoices) and picking a mode/Outstanding/Overdue clears the bucket, so
                                    exactly one slice is highlighted at a time; empty bands aren't clickable; the footer
                                    + CSV + Copilot snapshot all follow the active band. The A/R period switch scopes the WHOLE A/R view by invoice date
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
                                    qbo_customer (real-time QBO balance + open QBO invoices for a contact),
                                    qbo_ar_summary (live total A/R + aging across open QBO invoices), and reconcile_qbo
                                    (diffs the FULL UPR open A/R against ALL open QBO invoices in one pass — matched by
                                    qbo_invoice_id ↔ QBO Invoice.Id, fallback qbo_doc_number ↔ DocNumber — and returns
                                    categorized to-do lists: sync_errors, qbo_open_not_in_upr, upr_open_unsynced,
                                    upr_open_not_open_in_qbo, balance_mismatch, with complete counts/$ totals + capped
                                    per-item lists). QBO tools are intent-based — the worker builds the safe /query string
                                    (the model never passes raw QQL). ADVISORY ONLY — it never
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
    Help.jsx                      — In-app Help & Guides centre (route /help, reached from the TopNav ? button + Sidebar; wrapped by SettingsLayout). Landing menu of guide cards → opens a guide; the open guide is kept in the URL hash (#how-it-works / #invoicing, plus an optional #guide/section to deep-link straight to a section) so it deep-links and survives refresh, and the ? button (no hash) always lands on the menu. Two guides today: "How UPR Works" (office orientation — the Customer→Claim→Job→Invoice hierarchy rendered natively + worked example, the cardinality rules, first-call-to-paid job lifecycle, creating a new job (the New Job modal walkthrough + dos/don'ts), a tour of every main screen, the 7 divisions, a "where do I do X" quick-reference, a glossary, and a field-tech mobile note) and "Invoicing & Financials" (build → Save to QBO → get paid → Collections; downloadable PDF). Visible to every logged-in user (not role-gated). Printable hierarchy diagram served from /public/UPR-Hierarchy-Diagram.html. Contextual ? links (HelpLink.jsx) on the New Job modal, invoice builder, Collections, and Claims open the matching guide section in a new tab. Static content only — no DB reads/writes.
    SignPage.jsx                  — Public esign page (no auth) — type or draw signature
    CreateJob.jsx                 — Full-page job creation flow
    Legal.jsx                     — Public /terms + /privacy pages (required by Intuit's QBO production profile)
    AdminFeedback.jsx             — Tech feedback inbox (route /tech-feedback, admin-only)
    AdminDemoSheetBuilder.jsx     — Scope-sheet schema builder (route /admin/demo-sheet-builder)
    admin/AdminIntegrations.jsx   — Admin "API Keys" page (route /admin/integrations, admin-only): paste the GitHub token (+ default repo) that the UPR MCP reads; extensible to more providers. Uses the github-connect worker.
    ClaimCollectionPage.jsx       — Per-claim A/R view (older sibling of the Collections hub)
    PaymentSettings.jsx           — Stripe pay-link + payout settings (route /payments/settings)
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
    TechMore.jsx                  — Field tech "More" page: list-based home for secondary tools. Sections: Work (Tasks with count badge, OOP Pricing when tool:oop_pricing flag on, Collections, Time Tracking) + Resources (Help & Guides → /tech/help, Checklists, Demosheet). Unbuilt items render as dimmed "Soon" rows; built items are <Link>s with chevron.
    TechHelp.jsx                  — Field tech "Help & Guides" page (route /tech/help). Plain-language, big-tap how-to for the phone app: the timer (On My Way → Start Work → Pause → Finish), snap-first photos, the task checklist, moisture readings, schedule, claims, starting a new job (the + → New Job field flow, incl. new-vs-existing claim), plus a "Stuck?" → Send Feedback footer. Static content only (no DB). Reached from the standalone ? button in the TechDash greeting header (left of the ⋮ menu) and the More → Help & Guides row. Card content now lives in techHelpContent.jsx (shared with the contextual TechHelpSheet).
    techHelpContent.jsx           — Shared field-tech help content: the TOPICS array ({key,Icon,title,lines,accent}) + the TopicCard renderer + topic icons. Imported by both TechHelp.jsx (full page) and TechHelpSheet.jsx (contextual sheet) so the wording never drifts. Static; file-level eslint-disable for react-refresh/only-export-components (intentional data+component module).
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
    tech/TechHelpSheet.jsx        — Bottom help sheet (PhotoNoteSheet structure: backdrop + slide-up, tech-fade-in/tech-slide-up, safe-area pad, grabber + ✕). Renders the requested topic's TopicCard first then the rest of TOPICS (from techHelpContent). NO navigation / no target=_blank (Capacitor-safe) — opens over the screen so an in-progress form isn't lost. Props {open,onClose,topicKey}.
    tech/TechHelpButton.jsx       — Self-contained "?" button (dash help-button styling) that owns its open state and renders TechHelpSheet. One-line drop-in: <TechHelpButton topicKey="newjob" />. Used on TechNewJob (newjob), TechAppointment (timer, white-on-hero variant), TechClaims (claims).
    Layout.jsx                    — App shell: sidebar, bottom bar, toasts, offline banner
    Sidebar.jsx                   — Desktop nav + sign out button
    HelpLink.jsx                  — Reusable contextual "?" that deep-links into a /help guide section in a NEW TAB (so in-progress modals/forms aren't lost). Props: anchor ("guide[/section]"), label, size, variant; reuses IconHelp. Used on CreateJobModal, InvoiceEditor, Collections, ClaimsList.
    AddContactModal.jsx           — Add contact modal (9 roles) + LookupSelect component
    AddRelatedJobModal.jsx        — Add sibling job under same claim
    CalendarView.jsx              — Week-calendar grid for Schedule page (division-tinted event cards via schedule/eventCardStyle.js; UPR design system, Jun 2026)
    schedule/eventCardStyle.js    — Maps an appointment → card colors by division (teal/purple/coral/pink) / appt-blue / task-green / dashed-tentative / gray-done
    CarrierSelect.jsx             — Searchable insurance carrier combobox with OOP sentinel
    CreateAppointmentModal.jsx    — Create appointment on schedule
    CreateCustomerModal.jsx       — Create customer modal
    CreateJobModal.jsx            — Inline job creation modal. New claim / Existing claim toggle (2026-07, mirrors TechNewJob): existing mode lists the contact's claims via get_customer_detail, prefills loss/carrier/claim# and passes p_existing_claim_id to create_job_with_contact (reuses the claim, skips the Encircle re-push)
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
    NewMenu.jsx                   — Top-nav "New" dropdown → New Job (job+claim creator; label renamed from "New Claim" 2026-07) / New Estimate (page:estimates) / New Customer / New Invoice (flows via Layout.handleCreateAction)
    UserMenu.jsx                  — Top-nav avatar dropdown (admin-only Tech View + Sign Out)
    GlobalSearch.jsx              — Top-nav global search: 300ms-debounced typeahead over the global_search RPC, grouped results routing to each record
    SettingsLayout.jsx            — Settings hub shell: left sub-rail (≥1024px) wrapping the system pages; display:contents passthrough below 1024px

functions/
  api/                            — 58 files total; only the SMS/Esign/Encircle/demo-sheet workers below are
                                    inventoried here. QBO, Stripe, Google Drive/Calendar, and Homebuilding AI
                                    workers (~41 files) are documented in their own sections further down this
                                    doc instead of duplicated here — see CLAUDE.md's Workers section for the
                                    full grouped list of all 58.
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
`#f2664a`, Mold pink `#ec4899`. **Remodeling is now a real app-wide division** (added Jun 29 2026): the
`job_division` enum includes `remodeling`, new jobs/invoices number as `RM-YYMM-###`, it maps to the same QBO
item/class as reconstruction (`divisionToQbo`), and it appears in the New Job form + all division color/label
maps. This dashboard keeps its own scoped palette (above).

**Roadmap / status:**
- **Phase 1 — DONE:** pixel-faithful visual shell + placeholder data.
- **Phase 2 — DONE (live data):** one data hook per widget (`src/components/overview/hooks/`); the period
  switch re-queries the period-scoped cards (Revenue, Avg ticket, New Jobs Closed). **Live:** Employee status
  (`get_tech_status_board`, 30s poll; each row shows the tech's full name + client + job address), Collections + DSO (`get_ar_invoices` + ARDashboard bucketing), New Jobs Closed
  (`get_jobs_closed` — see the canonical sale rule below), Revenue by division, Avg ticket + avg/claim, Production pipeline, Action required (pending
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
- **"New Jobs Closed" card + commission foundation — DONE (migrations `20260630_job_sales_canonical.sql`,
  `_commission_foundation.sql`, superseded by `_commission_on_real_jobs.sql`):**
  The old **"New claims booked"** card (counted raw `claims`) was renamed to **"New Jobs Closed"** and now
  counts **real (sold) jobs**, excluding estimate-only opportunities. Card reads `get_jobs_closed(p_floor)`
  (hook `useJobsClosed.js`, replacing `useNewClaims.js`); grid layout key stays `newClaims` (internal id) so
  saved per-user layouts aren't reset.

  ### ⭐ What counts as a SALE / REAL JOB (THE canonical rule — all reporting must use this)
  **Single source of truth = `jobs.is_real_job`** (migration `20260627_real_job_classification.sql`). A job is
  auto-flagged real when a **work-auth/recon agreement is signed**, a **QBO invoice** is created, or its
  **estimate is approved** (`real_job_source`/`real_job_marked_at` record which & when); the office can force
  it via `set_job_real_job`. **Billing, the "New Jobs Closed" card (`get_jobs_closed`), and commissions all
  read `is_real_job` — never reinvent it.** *(Reconciliation note: this branch first shipped a parallel
  `job_sales` view; it was **retired** in `_commission_on_real_jobs.sql` so there's exactly one definition.)*
- **Commission foundation (lean v1) — DONE:** the base for paying sales commissions (first payroll of each
  month, for everything sold the **previous month**), built on `is_real_job`.
  - **Salesperson = derived** per job (no manual override): the signed work-auth/recon `sign_requests.sent_by`,
    else the approved `estimates.created_by`. So the estimate-create flow now stamps `created_by`
    (**`NewEstimateModal`** passes `p_created_by: employee?.id`; it was previously null — why older sales are
    unattributed).
  - **`employees.commission_percent` / `commission_flat`** (both nullable) — the per-employee rate. A rate set
    ⇒ earns; both null ⇒ none (the rate **is** the "is a salesperson" flag). `commission_flat` (flat $/sale)
    wins over `commission_percent` (% of the job's invoice total) when both set.
  - **`get_commissions(p_month date)`** — SECURITY DEFINER RPC, **the one place commissions are ever computed**.
    One row per real job; period = month of **`jobs.created_at`** (NOT `real_job_marked_at` — the backfill
    stamped that to the migration date). Returns employee, job, division, base = `SUM(COALESCE(adjusted_total,
    total))`, commission, `commission_period`, `is_attributed`. Unattributed sales (no derived person, or no
    rate) are returned with `is_attributed = false` — **visible, not silently dropped**.
  - **Commissions effectively start now:** most historical jobs have no recorded salesperson, so they're
    unattributed; no backfill.
  - **Admin UI — DONE (migration `20260630_employee_commission_rates.sql`):** **Settings → Payroll →
    Commissions** (`CommissionsPanel` in `src/pages/Settings.jsx`) lists every employee with a Type
    (None / Percent / Flat) + Rate, saved per row. Reads `get_employee_commissions()`, writes
    `upsert_employee_commission(p_employee_id, p_percent, p_flat)` (percent XOR flat; both null clears it).
  - **Help guide — DONE:** "Estimates, Jobs, Sales & Commissions" (`src/pages/Help.jsx`) explains the whole
    flow in plain language for staff.
  - **Deferred (Phase 2, when payroll runs in-app):** a monthly commissions **report** reading
    `get_commissions`, and a `commission_payouts` lock table so paid amounts can't shift if an invoice is
    later edited. **Cut from v1 deliberately:** per-employee basis options and an `is_salesperson` flag
    (the rate is the flag).
- **Part B — planned (light up the empty widgets):** upstream features that populate the three
  wired-but-empty cards. **Plan: `DASHBOARD-PARTB-PLAN.md`** (repo root). Confirmed order: **B1 Jobs-completed
  lifecycle + B4 cross-widget polish first → B3 Hydro/drying (its own session)**. **B2 Open estimates is
  owned by a separate effort** — the widget reads `get_open_estimates_summary` and lights up automatically
  once `estimates` rows exist with an open `status` (no dashboard change needed).
- **Phase 4 — first-class "Remodeling" division shipped Jun 29 2026** (enum + `RM-` numbers + app-wide color/label maps + QBO mapping). The app-wide palette overhaul (recolor every division to the dashboard scheme) is still pending.
  **Ready-to-execute plan lives at `DASHBOARD-PHASE4-PLAN.md`** (repo root, dormant — start a session and say
  "execute DASHBOARD-PHASE4-PLAN.md", or rename to `*-TASK.md` to activate the Task File Protocol).

**Plan file (this session):** `/root/.claude/plans/yes-record-it-but-steady-kitten.md`.

---

## Database — All Tables (91 base tables live as of Jul 1 2026 — table count drifts fast with every
migration; verify via `upr_schema`/`upr_describe` MCP tools rather than trusting this number)

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
equipment_placements    — Equipment placed on a job (replaced the earlier planned job_equipment_costs,
                          which was never shipped — see Encircle Replacement Phase 2 Hydro below)
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
                          created_by (FK employees), created_at, deleted_at (soft),
                          encircle_room_id BIGINT, encircle_structure_id BIGINT (added later, undated —
                          links a room back to its Encircle source when imported).
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
employees               — 15 rows as of Jul 1 2026 (8 auth-linked, 7 unlinked) — Staff. Row count drifts
                          with hiring — see the Employees section below or query live for current roster.
nav_permissions         — 66 rows — Role-based nav access
feature_flags           — 20 rows as of Jul 1 2026 — Feature flag controls (has force_disabled BOOLEAN column — kills page for everyone including admins). Apr 17 additions (all dev-only for Moroni): page:tech_rooms, page:tech_moisture, page:tech_equipment, page:water_loss_report, offline:queue. Time-Tracking PR-2 (Jun 26 2026) added clock_enforce_explicit_clockout (category time_tracking, default OFF) — read BACKEND-side by clock_omw_precheck + clock_appointment_action; when ON, going On-My-Way while clocked in on another job is hard-blocked (OPEN_ENTRY_EXISTS) instead of auto-superseding. NOTE: the client reads its raw `enabled` (not isFeatureEnabled, which fails-open to true).
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
get_dispatch_board(p_start_date, p_end_date, p_auto_show) — Dispatch board data (kind='job' appointments only — joins to jobs so events naturally excluded). Each job row includes claim_id + date_of_loss (from the linked claim, via j.claim_id; added Jun 18 2026 for the schedule job picker).
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
get_tech_status_board()         — Live dispatch board: one row per active field_tech/supervisor (plus any employee currently clocked in or **on a crew for an appointment today**) with derived status ('paused'|'on_site'|'omw'|'scheduled'|'idle'), status_since, current/next appointment, job, client_name, address. Sorted by status priority then name. Powers the Status Board tab on Time Tracking + the Overview "Employee status" widget (useEmployeeStatus.js). FIX (Jun 30 2026, migration `20260630_status_board_denver_date_and_field_admins.sql`): (1) **timezone** — "today" was `a.date = CURRENT_DATE` (UTC); after ~6pm Denver it matched the wrong day and dropped today's scheduled crews. Now `(now() AT TIME ZONE 'America/Denver')::date`. (2) **field-working admins** — the old `next_appt` (future-only, role-gated) is replaced by a `today_appt` CTE + a WHERE that includes anyone on a crew for an appointment today regardless of role, so admins who run jobs (Ben/Juani) appear as 'scheduled' until they clock in (office-only staff with no appointment today still don't show; next_appt_time/title still only populate for genuinely-upcoming appointments). Same RETURNS TABLE signature (CREATE OR REPLACE). Also that day: a one-off data cleanup reset 4 appointments stuck en_route/in_progress/paused with no open clock back to 'scheduled'. PIN (Jun 30 2026, migration `20260630_status_board_pinned_employees.sql`): added `employees.show_on_status_board BOOLEAN DEFAULT false` and `OR e.show_on_status_board` to the WHERE, so specific people (owners/admins who occasionally do field work) can be pinned to always appear (read 'idle' until clocked in/scheduled) without including every office admin. Seeded true for the owner login (Moroni Salvador, email moroni@utah-pros.com). NB: a separate loginless test record "Moroni Tech" holds moroni.s@utah-pros.com — the two Moroni rows are distinct employees; the pin is keyed to the real login.
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
  — ⚠️ two overloads exist live (this 8-arg one, plus an older 7-arg version without p_force_disabled) —
  the same PGRST203-ambiguity risk called out elsewhere in this doc for other RPCs. Drop the 7-arg
  overload next time this function is touched.
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

### Other RPC families (documented in their own sections, not duplicated here)
These exist live and are correctly documented elsewhere in this doc — listed here only so this
catalog doesn't read as exhaustive when it isn't:
- **Homebuilding AI** (16 RPCs — chat/estimate/build-project CRUD) — see "Homebuilding Entry Analysis"
  and "New Build simulator" sections below.
- **In-App Notifications** (`create_notification`, `get_notifications`, `get_unread_notification_count`,
  `mark_notification_read`, `mark_all_notifications_read`) — see "In-App Notifications" below.
- **Commissions/payroll** (`get_commissions`, `get_employee_commissions`, `upsert_employee_commission`) —
  live, but genuinely undocumented anywhere in this doc as of this audit; confirm with the owner whether
  this is a shipped-but-undocumented feature or in-progress before relying on it.
- **Billing** (`create_invoice_for_job`, `convert_estimate_to_invoice`, `get_job_financials`,
  `get_ar_invoices`, `get_payments_ledger`, `get_open_estimates_summary`, etc.) — see the QuickBooks
  Online sections below and `BILLING-CONTEXT.md`.

---

## Feature Flags System (Phase 1A complete, 1B wired in AuthContext)

**Table:** `feature_flags` — 20 rows as of Jul 1 2026 (mixed on / off / dev-only; row count drifts as
flags are added via the self-registering registry below — verify live via `upr_select` rather than
trusting this number). Original Phase-1A seed plus everything added since:

| Key | Category | Label | Enabled |
|-----|----------|-------|---------|
| `page:leads` | page | Leads | off |
| `page:marketing` | page | Marketing | off |
| `page:time_tracking` | page | Time Tracking | on |
| `page:collections` | page | Collections | on |
| `page:estimates` | page | Estimates | **on** — no longer dormant, see QBO Estimates section |
| `page:overview` | page | Overview Dashboard | on |
| `page:encircle_import` | pages | Encircle Import | on |
| `page:water_loss_report` | reports | Water Loss Report PDF | off, dev-only |
| `page:tech_rooms` | tech | Tech: Rooms & Photo Organization | off, dev-only |
| `page:tech_moisture` | tech | Tech: Moisture Readings (Hydro) | off, dev-only |
| `page:tech_equipment` | tech | Tech: Equipment Placements | off, dev-only |
| `tool:bulk_sms` | tool | Bulk Messaging | off |
| `tool:search_export` | tool | Search & Export | off |
| `tool:oop_pricing` | tool | OOP Pricing Calculator (dev-only → Moroni, Apr 20 2026) | off, dev-only |
| `feature:pwa` | feature | PWA | on |
| `feature:twilio_live` | feature | Twilio Live SMS | off |
| `feature:billing` | feature | Billing & Invoicing | on |
| `feature:ai_xactimate` | feature | AI Xactimate Import | on |
| `offline:queue` | infra | Offline Queue + Service Worker | off, dev-only |
| `clock_enforce_explicit_clockout` | time_tracking | Enforce explicit clock-out | off |

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

**Phases 1C–6C (all complete):** Sidebar guards, DevTools.jsx with 9 tabs (Moroni-only route) —
Flags, Health, Employees, Workers, Integrations, Backfill, Integrity, Messaging, Advanced.

## CRM Partner role (external marketing-agency accounts, Jul 1 2026)

A restricted `employees.role` value (`crm_partner`) for an outside marketing agency running
leads/advertising — sees the **whole CRM** (`/crm/*`) **except Integrations**, nothing outside
`/crm` at all. Reuses the existing employee/auth pipeline rather than a parallel user system;
scoped via migrations in `supabase/migrations/20260701_crm_partner_*.sql` (an initial rollout, then
a `_widen_access` follow-up migration that opened Settings/pipeline-config/revenue back up and
added the Integrations-specific block — the product call landed on "full CRM minus Integrations"
rather than the initial narrower design; read `_widen_access` first if reasoning about current
behavior, the earlier migrations' RLS narrowing on Settings/revenue is superseded by it):

- **Role/marker:** `crm_partner` added to the `employee_role` enum; `employees.is_external boolean`
  (reporting/audit marker only, not an access mechanism).
- **`is_crm_partner(auth_user_id uuid)`** — `SECURITY DEFINER` helper (looks up `employees` by
  `auth_user_id`), used throughout RLS policies and RPC guards below.
- **Access to `/crm/*` itself:** NOT via `nav_permissions` (the CRM nav item isn't in
  `Sidebar.jsx`'s `NAV_ITEMS` yet) — `/crm` is gated by `<FeatureRoute flag="page:crm">`, which is
  `dev_only_user_id`-locked to Moroni during the build. `isFeatureEnabled()` in
  `AuthContext.jsx` has an explicit bypass: `key === 'page:crm' && employee.role === 'crm_partner'`
  always passes, independent of the internal rollout flag.
- **Blocking everything outside `/crm` — the real enforcement layer:** most non-CRM routes in
  `App.jsx` (`/jobs`, `/claims`, `/customers`, etc.) have **no per-route guard at all** — they only
  rely on the sidebar not showing a link, which was fine when every authenticated session was
  trusted staff. `Layout.jsx` has a single choke-point `useEffect` (route-change based) that
  redirects any `crm_partner` whose path isn't under `/crm` or `/help` back to `/crm/leads`.
  `HomeRedirect` in `App.jsx` sends `/` there too (mirrors the existing `field_tech → /tech`
  pattern).
- **RLS tightened on existing (not new) tables** — a `crm_partner` is a real authenticated Supabase
  session and can call PostgREST directly, so frontend hiding alone isn't enough. `NOT
  is_crm_partner(auth.uid())` is on the `authenticated`-role policies for: `jobs`, `claims`,
  `invoices`, `estimates`, `estimate_line_items`, `invoice_line_items`, `job_costs`, `payments`,
  `vendor_invoices`, `job_supplements`, `job_time_entries`, `job_documents`, `crm_build_phases`,
  `crm_build_stages` (the internal build-roadmap tracker stays blocked — engineering artifact, not
  a CRM business feature). `contacts` is split: SELECT is scoped to lead-linked contacts only
  (`id IN (SELECT contact_id FROM inbound_leads ...)`), INSERT/UPDATE/DELETE fully blocked.
  `pipeline_stages` is **fully open** (`USING (true)`) per the widened scope — a partner can
  read/write pipeline stages like any internal role. `anon`-role policies were deliberately left
  untouched (pre-existing, separate permissiveness issue, out of scope here). Regression-tested via
  a simulated authenticated RLS session (SQL, rolled back) both before and after the widen — a
  partner gets 0 rows from `jobs`/`claims`/`invoices`/etc. and full `pipeline_stages` access; an
  `office` role is unaffected throughout.
- **RPCs also guarded** (RLS on a table doesn't stop a `SECURITY DEFINER` RPC that reads/writes it):
  `get_crm_revenue_by_division()` and `get_attribution_rollup()` show **real revenue/ROAS** to a
  partner (the initial masking was reverted in `_widen_access`); `upsert_pipeline_stage()` /
  `delete_pipeline_stage()` also had their partner-block reverted — a partner can fully manage
  pipeline stages. The one RPC still guarded for this role: `get_integration_status()` returns zero
  rows for a `crm_partner` caller (matches the Integrations page being fully off-limits).
- **UI scoping:** `Sidebar.jsx` hides the "New Job"/"Customer" quick-create buttons for this role.
  `CrmLayout.jsx` hides only the **Integrations** nav item and the "Build roadmap" footer link for
  this role — Settings and everything else in the CRM sidebar is visible. `CrmIntegrations.jsx`
  redirects a `crm_partner` straight to `/crm/leads` (full block, not read-only) — the
  CallRail/Google Ads/Meta Ads connect workers themselves are not yet role-gated server-side
  (frontend + RPC block only for now; the workers are a good follow-up hardening target since these
  are shared platform OAuth credentials). `CrmRoadmap.jsx` keeps its own redirect-on-render guard as
  defense-in-depth beneath the layout-level hiding (roadmap is the only other page still blocked).
- **Account creation:** `Admin.jsx` → Employees tab — `crm_partner` added to the role dropdown, an
  `is_external` checkbox added to the create/edit form. `functions/api/admin-users.js` (POST/PATCH)
  forwards `is_external` through to the `employees` insert/update alongside the existing fields.
- **Known gap / explicitly descoped:** `inbound_leads.caller_number` (raw customer phone) is not
  masked for a partner — both `CrmLeads.jsx` and `CrmCallLog.jsx` read `inbound_leads` via a raw
  `db.select`, not an RPC, so masking would need a view or RPC rewrite of an already-live read
  path. Flagged for Moroni to confirm the masking approach before building it — this remains
  unmasked under the wider "whole CRM" scope too.

---

## Employees (15 total as of Jul 1 2026 — headcount changes with hiring, verify live before relying
on this table)

| Name | Role | Auth |
|------|------|------|
| Moroni Salvador | admin | ✅ linked |
| Ben Palmieri | admin | ✅ linked |
| Juani Sajtroch | admin | ✅ linked |
| Marcelo Estefens | project_manager | ✅ linked |
| Matheus Almeida | supervisor | ✅ linked |
| Thiago Tobias | admin | ✅ linked |
| Marcelo Bigheti | field_tech | ✅ linked |
| Nano Suarez | field_tech | ✅ linked |
| Admin User | admin | ❌ unlinked |
| Alan Nobre | field_tech | ❌ no email |
| Amaury Evangelista | supervisor | ❌ no email |
| Diego Henriques | field_tech | ❌ no email |
| Elias Almeida | field_tech | ❌ no email |
| Marcio Silveira | supervisor | ❌ no email |
| Moroni Tech | field_tech | ❌ email set, unlinked |

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

## Tech Mobile v2 — Phase F Foundation (Jul 3 2026)

The field-tech Dashboard (`/tech`) + Schedule (`/tech/schedule`) rebuild. Full plan:
`docs/tech-v2-roadmap.md`; wave ownership: `.claude/rules/tech-v2-wave-ownership.md`.
Phase F ships **schema/RPC + data layer + wiring only** — the two v2 pages are STUBS the
S/D wave fills in.

- **Feature flags (seeded live, `enabled=false`, `dev_only_user_id`=owner):**
  `page:tech_dash_v2`, `page:tech_sched_v2`. Owner-only during the wave; everyone else gets
  the legacy pages, byte-identical. Registered in `src/lib/featureFlags.js` EXPLICIT_FLAGS
  with `enabled:false` (load-bearing — the DevTools auto-seed would otherwise create them ON).
- **RPCs:**
  - `get_tech_dashboard(p_employee_id uuid) → jsonb` **(NEW)** — one round trip:
    `{ server_now, today, week_start, appointments (Denver day, cancelled excluded),
    upcoming (next 7 days scoped to me), open_entry, hours_today, hours_week (each
    `{ travel, on_site, total }`), photos_today }`. Hours = SUM(stored `hours`) + live term
    for the single open entry; travel = SUM(`travel_minutes`)/60 + live en-route term; week
    = Monday-start America/Denver (payroll parity). Helper `tech_hours_bucket(...)`.
  - `get_appointments_range(date,date)` + `get_my_appointments_today(uuid, p_include_cancelled boolean DEFAULT true)`
    — additive jsonb keys `color/kind/duration_days/is_milestone`, crew `employees` gain
    `color/avatar_url`, plus `task_total`/`task_completed`. Legacy keys unchanged
    (backward-compat tests committed). `get_my_appointments_today` 1-arg legacy call still
    resolves (default). ⚠️ Note: this feed keys "today" off `CURRENT_DATE` (UTC) — legacy
    behavior, left as-is; `get_tech_dashboard` uses the Denver day instead.
  - `clock_appointment_action(...)` — same signature; OMW `work_date` now stamps in
    `America/Denver` (was UTC — misdated evening clock-ins; Finding #3).
  - **Drift capture:** 13 previously migration-less tech RPCs are now captured verbatim in
    `supabase/migrations/20260703_tech_v2_phaseF_drift_capture.sql` (no behavior change).
- **Data layer:** TanStack Query trio pinned `5.101.2`. `src/lib/techQuery.js` is the FROZEN
  query-key + invalidation registry (kinds: dash/sched-month/active-clock/tasks/rooms/docs;
  `techKeys`, `invalidateTech`, `techQueryClient`). Cache persisted to a dedicated IndexedDB
  DB `upr-query-cache` via `src/lib/techQueryPersister.js`; `PersistQueryClientProvider`
  mounted in `src/main.jsx`.
- **Pane host:** `TechLayout` renders the two v2 panes persistently OUTSIDE the keyed
  `<Outlet/>` (no remount storm), hidden via `display:none`, with continuous scrollTop
  tracking + restore and an `active` prop (gates pollers/geo). Flags off → panes not mounted,
  legacy identical.
- **Primitives** (`src/components/tech/v2/`): `StatusChip` (status owns color), `ApptListRow`,
  `TechV2Page`, `TechPane`, skeletons, and `apptHref()/jobHref()` (nav — M2 flips
  `HUB_ENABLED`). CSS = new `tv2-*` classes inside reserved `TECH-V2:` markers in `index.css`.
- **v1 relief patch (legacy, only window before the freeze):** `TechSchedule` fetch window
  anchored to today (day taps no longer refetch the ~61-day range unless they exit the
  window); `TechDash` no longer re-skeletons when data already exists.
- **`--tech-*` / `--status-*` token layer now documented** in `UPR-Design-System.md`.

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
delete). **Built source-agnostic** (~~to survive the planned appointments→scheduled-jobs
refactor~~ — that refactor was declared stale and superseded by the Schedule Desktop plan of
record, `docs/schedule-roadmap.md`, 2026-07-03; the mapping stays source-agnostic regardless).

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
- **`integration_config`:** `gcal_worker_url` — **already flipped to production**
  (`https://utahpros.app/api/google-calendar-sync`, confirmed live Jul 1 2026) + `gcal_webhook_secret`.
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

**Lib:** `functions/lib/quickbooks.js` — OAuth exchange/refresh, `qboFetch`, `getValidAccessToken` (refreshes within 5 min of expiry), `mapContactToCustomer` (normalizes name whitespace), `queryCustomer`, `findExistingCustomer` (email → display-name dedup), `createCustomer`, `ensureQboCustomer` (on-demand: POSTs to `qbo-sync-customer` so a billable contact becomes a QBO customer at invoice/estimate time — see BILLING-CONTEXT.md "on-demand creation"). Captures Intuit's `intuit_tid` from API responses (logged on every call; stored in `contacts.qbo_sync_error` on failures for support troubleshooting).

**On-demand customer creation (Phase A, shipped; full detail in BILLING-CONTEXT.md):** `qbo-invoice.js` / `qbo-estimate.js` call `ensureQboCustomer(request, env, contactId)` when a billable contact has no `qbo_customer_id` yet, then re-read and throw the usual "sync the client first" error only if it's still missing. No-op today (the `trg_qbo_customer_sync` contact-insert trigger still pre-creates); **Phase B (planned, not yet applied)** retires that trigger so contacts sync to QBO only when transacted with — applied only after Phase A reaches `main` (shared dev/main Supabase).

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

**Division → QBO (`lib/quickbooks.js` `divisionToQbo`):** recon→Item `1010000201` + class Reconstruction; **remodeling→same Item/class as recon** (added Jun 29 2026 — remodeling maps onto Reconstruction, not its own bucket, see the Overview Dashboard section above); water/mit→Item `1010000071` + class Mitigation; mold→Item `1010000131` (no class); contents→Item `38` (no class). Insurance-adjustment item `1010000231`. Class Ids resolved at runtime by name. **Note:** `BILLING-CONTEXT.md` is the current, more detailed source for the QBO/billing architecture — this doc's Phase 1/2a/2b/2c framing below is historical/narrative and the two docs use different organizing schemes for the same subsystem; prefer `BILLING-CONTEXT.md` when they disagree. **Invoice numbering (Jun 20 2026):** the worker sends the **job number as the QBO `DocNumber`** (on create + update; unique since one invoice per job, ≤21 chars). The QBO company has *Custom transaction numbers* ON — so when we sent no DocNumber, QBO left the invoice number **blank**; supplying the job number fixes that and makes the QBO invoice number == the job number. (If that QBO setting is ever OFF, QBO ignores the supplied number and auto-numbers — still safe.) The worker captures `qboInv.DocNumber` back into **`invoices.qbo_doc_number`**, and the UI displays that (UPR's `INV-######` is only the pre-send draft handle). **QBO memo (standard):** `Date of loss: <dol> · Job: <job#> · Claim: <claim#> · Service Address: <full addr>` — written to BOTH `CustomerMemo` (prints on the invoice; needs QBO *Sales → Message to customer*, on by default) and `PrivateNote` (internal). The job's **service address** (`jobs.address/city/state/zip`, claim loss-address fallback — can differ from billing) + date of loss come from the job (claim fallback). The address also goes to the invoice's structured **`ShipAddr` (Ship To)** — full length, no 31-char cap, prints when QBO *Sales → Shipping* is on. We **no longer write the legacy 31-char custom field** — on QBO Advanced the enhanced/named custom fields aren't writable via the v3 API (only the 3 legacy string fields are; Intuit's GraphQL Custom Fields API is Gold/Platinum-partner-gated), so Ship To + CustomerMemo are the right writable homes. `get_ar_invoices` / `get_payments_ledger` return `qbo_doc_number`; linkage is by `qbo_invoice_id` (internal id).

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
converts to an invoice. Shipped **dormant** behind the `page:estimates` feature flag at first
(seeded **disabled** — a missing flag would read as ON, so the OFF row was required); **the flag is
now `enabled: true` live (confirmed Jul 1 2026) — estimates are live, not dormant.**
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
- **Encircle + Resend (undocumented until this audit — ~22 tools total, `upr-mcp/src/encircle.js` + `resend.js`):** mirrors the Encircle and Resend REST APIs (claims/rooms/notes/media/assignments for Encircle; domains/emails for Resend) the same way the QBO tools mirror QuickBooks — see those source files for the exact tool list rather than duplicating it here.
- **CallRail + Deepgram, Stripe, Twilio, Google Ads, Meta Ads, GitHub (added Jul 2026 — 32 tools, `upr-mcp/src/{callrail,stripe,twilio,googleads,metaads,github}.js`):** each module follows the same generic-power-tool + named-conveniences pattern; reads run immediately, writes preview unless `confirm:true`. Credential model splits two ways — **reuse a stored token** (CallRail=`callrail`, Deepgram=`deepgram`, Google Ads=`google_ads`, Meta Ads=`meta_ads` rows in `integration_credentials`; no worker secret for the token) vs. **static worker secret** (`STRIPE_SECRET_KEY`; `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`; the ad apps also need their `*_CLIENT_ID/SECRET`/`*_APP_ID/SECRET` + account-id secrets). A tool returns a clear "not configured"/"not connected" error until its credential is present. See the source files for the exact tool list. Highlights: `callrail_list_calls`/`callrail_transcribe`, `stripe_get_balance`/`stripe_create_payout`, `twilio_send_sms`, `google_ads_campaign_spend`, `meta_ads_insights`.
- **GitHub — DB-managed token + full write lifecycle (Jul 2026, `upr-mcp/src/github.js`):** the PAT is now read from `integration_credentials` (provider=`github`) first — set on the **admin API-keys page** (`/admin/integrations`) via the `github-connect` worker — with an env `GITHUB_TOKEN` fallback; default repo from `integration_config.github_default_repo` → `GITHUB_DEFAULT_REPO`. Tools cover the full PR/commit lifecycle: reads (`github_list_prs`, `github_get_pr`, `github_get_file`, `github_list_commits`, `github_get_commit`, `github_list_branches`, `github_search_code`) and guarded writes (`github_merge_pr`, `github_create_pr`, `github_update_pr`, `github_create_branch`, `github_commit_file`, `github_add_comment`, `github_create_issue`) + generic `github_get`/`github_request`. A Worker has no git binary, so "push/pull" = the Contents/Git-data API. PAT scopes: Contents R/W, Pull requests R/W, Issues R/W.

**New table:** `upr_mcp_audit` (see Logging & Monitoring). **New RPC:** `get_upr_mcp_audit(p_limit)`.
**Files:** `upr-mcp/{wrangler.toml, package.json, package-lock.json, src/index.js, auth.js, mcp.js, qbo.js, encircle.js, resend.js, callrail.js, stripe.js, twilio.js, googleads.js, metaads.js, github.js, supabase.js, tools.js, audit.js}`; migration `supabase/migrations/20260622_upr_mcp_audit.sql`.

---

## Desktop/Tablet Navigation Shell (≥1024px) — Top Nav + Overflow Drawer + Settings Hub (Jun 24 2026)

A HousecallPro-style **top horizontal nav** replaces the dark vertical sidebar on **desktop and iPad-landscape widths (≥1024px)**. Phones (≤768px) and narrow tablets / iPad portrait (769–1023px) keep the dark `Sidebar` slide-over + mobile bottom bar. (Breakpoint was originally ≥1280px — lowered to **1024px on Jun 25 2026** so regular iPads in landscape get the top nav too; the prior state is preserved on branch `backup/pre-ipad-nav-breakpoint`.) The `/tech/*` field-tech app is untouched.

- **CSS-only shell:** both `<Sidebar>` and `<TopNav>` are always in the DOM; a single `@media (min-width:1024px)` block (end of `index.css`) hides `.sidebar`, shows `.topnav`, flips `.app-layout` to `flex-direction:column`, sets `--topnav-h:56px` (0 elsewhere so mobile math is unchanged), and height-corrects the three full-viewport pages (`.conversations-layout`, `.jobs-page`, `.job-page` → `calc(100dvh - var(--topnav-h))`). The `@media (max-width:768px)` block is byte-for-byte untouched. A companion `@media (min-width:1024px) and (max-width:1279px)` block collapses the `GlobalSearch` box to its icon (expands on focus) so all 7 primary links fit at narrower iPad widths; ≥1280px keeps the full inline 340px search.
- **Single source of truth:** `src/lib/navItems.jsx` — `NAV_ITEMS` (legacy sidebar list, unchanged) + `PRIMARY_ITEMS`/`OVERFLOW_ITEMS`/`SYSTEM_ITEMS` + `isItemVisible(item, {canAccess,isFeatureEnabled,employee,isMoroni})` (mirrors legacy gating: adminOnly → role; moroniOnly → email; `always` skips canAccess (Help); else canAccess(key); then featureFlag).
- **Top bar (`TopNav.jsx`):** logo · primary links [Home `/`, Inbox `/conversations` (unread badge), Schedule, Claims, Customers, My Money `/collections` (`page:collections`), Time `/time-tracking` (`page:time_tracking`)] · `GlobalSearch` · `NewMenu` · `NotificationBell` · Help link (`/help`) · settings gear (`/settings`) · `UserMenu`. **Home/Inbox/My Money/Time are LABEL renames only** — routes + nav_keys unchanged.
- **Overflow drawer (`OverflowDrawer.jsx`):** hamburger-opened left slide-over (dark) — Jobs, Production, Schedule Templates, Encircle Import, OOP Pricing, Leads, Marketing.
- **New menu (`NewMenu.jsx`):** New Job (→ existing job+claim creator `CreateJobModal`; label renamed from "New Claim" 2026-07), New Estimate (global `NewEstimateModal`, gated on `page:estimates` — hidden until the flag is on, in lockstep with the Estimates nav links), New Customer (`AddContactModal`), New Invoice (global `NewInvoiceModal`) — all via `Layout.handleCreateAction`.
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

## Native iOS App (Capacitor) — mostly shipped

Camera, push registration, geolocation, biometric gate, and the Capgo OTA updater below are all
live, not in-progress. Only the privacy-screen plugin (see Deferred below) is genuinely still pending.

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
- **OTA deploy pipeline:** `.github/workflows/capgo-deploy.yml` — **paused since 2026-06-24** (Capgo account hit its plan limit; every automated upload was rejected). Push triggers are commented out; it's `workflow_dispatch` (manual) only until the Capgo plan is upgraded. Requires GitHub repo secrets `CAPGO_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Permission strings in Info.plist:** `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSFaceIDUsageDescription`
- **Deferred:** `@capacitor-community/privacy-screen` (app-switcher blur) — published version targets Capacitor 7, incompatible with our Capacitor 8 plugins. Re-enable when a Cap-8 compatible version ships; `enablePrivacyScreen()` is already a no-op stub.
- **Task tracker:** `CAPACITOR-TASK.md` — already removed (all phases shipped), per the Task File Protocol in `CLAUDE.md`.

---

## PostgREST / Supabase Gotchas
- New tables need `SECURITY DEFINER` RPCs — REST API schema cache doesn't update immediately
- RLS anon policies require `TO anon` clause — `USING (true)` alone is insufficient
- `db.select()` **throws** on any non-OK response (400/404/500) — it does NOT silently return `[]`. (Corrected Jul 1 2026 — this doc previously repeated a false claim also found in CLAUDE.md; verified against `src/lib/supabase.js:56-58`.) Always wrap in try/catch.
- Always inspect actual column names via `information_schema.columns` before writing queries
- `job_notes` uses column `body`, NOT `content`
- `write_file` for full rewrites — `edit_file` fails silently on CRLF files
- `bust_postgrest_cache()` RPC forces schema reload without redeploying

---

## Dev Tools Roadmap Status (phases below complete as of Mar 27 2026; the Integrations tab — QBO/etc.
connection management, documented in its own sections above — shipped after this table and is the
9th tab, added Jul 1 2026 to fix the doc's stale "8 tabs" count)

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

**All DevTools phases complete.** 9 tabs: Flags, Health, Employees, Workers, Integrations, Backfill, Integrity, Messaging, Advanced.

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
- `sync-claim-to-encircle` (Apr 18 2026) — pushes UPR-native claims UP to Encircle. Fired automatically from CreateJobModal + TechNewJob after `create_job_with_contact` RPC succeeds — only when a NEW claim was minted; a job filed under an existing claim (`p_existing_claim_id`, both callers as of Jul 2026) skips the push since that claim is already synced. Idempotent via `claims.encircle_claim_id`. Failures stored on `claims.encircle_sync_error` and surfaced in DevTools → Backfill → Unsynced Claims panel with per-row retry **and a bulk "Sync Selected" button** (checkboxes default to all-selected; uncheck test rows before syncing; pushes sequentially with live `done/total` progress; dedup guard makes repeats safe). On success writes Encircle id back to `claims.encircle_claim_id` AND all child `jobs.encircle_claim_id`.
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

**DevRoute access:** `employee?.email === 'moroni@utah-pros.com'` — hardcoded, not role-based. **Note:**
the UPR MCP Server's `ALLOWED_EMAIL` uses `moroni.s@utah-pros.com` (with a dot) instead — two different
owner-only gates use two different email strings for the same person. Not a bug (both work), just worth
knowing before assuming they're interchangeable.

---

## Known Pending Items
(Jul 1 2026 audit pruned 2 already-resolved items — TECH-UI-TASK.md cleanup and the photo/note
appointment_id-OR-job_id fix are both done — and flagged 3 as unverified rather than asserted true.)

1. **Twilio go-live** — blocked on ID verification. *Env var count unverified: only 4 distinct
   `TWILIO_*` vars found in code as of this audit, not the 7 previously claimed — recheck before relying
   on that number.*
2. **Auth linking** — some employees have no `auth_user_id` (headcount changes — see Employees section
   for current roster rather than trusting a hardcoded count here); add emails via Admin → Send Invite.
3. **Search + export** — `tool:search_export` feature flag ready, page not built (confirmed still true).
4. **Bulk messaging** — `tool:bulk_sms` flag ready, not built (confirmed still true).
5. **Mobile React Native app** — separate repo `moronisalvador/UPR-Mobile`. *Unverified — external repo,
   can't confirm current state from here.*
6. **`toggle_appointment_task`** — frontend call sites (`TechAppointment.jsx`, `TechEditAppointment.jsx`,
   `TechTasks.jsx`) look correctly wired to `(p_task_id, p_employee_id)`; RPC exists live but its
   definition wasn't found in a `supabase/migrations/` file, so its exact server-side signature is
   unverified from the repo alone.
7. **Task assignment logic** — tasks belong to appointments, not employees. `get_assigned_tasks` must join through `appointment_crew` to find a tech's tasks. Frontend call sites look correct as of this audit.
8. **~~TechJobDetail follow-up~~ COMPLETE (Apr 16 2026)** — `/tech/jobs/:jobId` now renders the purpose-built `TechJobDetail.jsx`; `/tech/jobs/:jobId/photos` renders `TechJobAlbum.jsx`. Shared primitives (Hero, ActionBar, NowNextTile, PhotosGroup, Lightbox, DetailRow) promoted to `src/components/tech/`; small helpers (formatTime, relativeDate, photoDateTime, fileUrl, openMap) promoted to `src/lib/techDateUtils.js`. Desktop `JobPage` unchanged at `/jobs/:jobId`.
9. **Desktop ClaimPage photo URL bug** — confirmed still present (Jul 1 2026): `ClaimPage.jsx` builds photo URLs as `${db.baseUrl}/storage/v1/object/public/job-files/${doc.file_path}` but `doc.file_path` already starts with `job-files/`, producing a double prefix. TechClaimDetail uses the correct pattern: `${db.baseUrl}/storage/v1/object/public/${doc.file_path}`. Desktop photos may not be loading — still needs a fix.
10. **In-app SMS** — TechClaimDetail + TechAppointment Message buttons open native `sms:` compose; swap to in-app Messages flow when available (confirmed still a live `TODO: switch to in-app SMS` comment in tech files).
11. **Claim-level photo attachments** — TechClaimDetail uploads with `p_appointment_id: null`. On multi-job claims, the tech is prompted to pick which job the photo attaches to. Single-job claims direct-fire to `jobs[0].id`.

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
⚠️ **Filename dates contradict this listing order** (0417 sorts before 0420) — both files landed in the
same commit, so true applied order can't be reconstructed from git alone. Content is directionally
correct (0420 has the base `create_room`/`get_job_rooms`; 0417 has the claim-scoped versions +
`get_claim_rooms`) — treat the exact sequencing as unverified rather than trusting the order above.

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

### Known dev-server quirk (not blocking, unverified as of Jul 1 2026)
`npm run dev` intermittently hits a Vite deps-cache version-hash mismatch
that manifests as "Invalid hook call" in OfflineStatusPill. Clearing
`node_modules/.vite` and restarting usually fixes it. Production bundle
(`npm run build` / Cloudflare Pages) is unaffected. *Not re-confirmed by this audit (no code
artifact to check statically) — if you haven't hit this recently, it may be stale; drop it next
edit if so.*

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
Drag room tiles from a palette onto a 0.5-ft (6") grid (HTML5 DnD; `GRID_FT = 0.5` in
`NewBuildSimulator.jsx` — corrected Jul 1 2026, was documented as 1-ft), then drag to move / pull the corner to
resize (pointer events; window-level move/up driven by a ref). Room model in `buildTemplate.js`:
`ROOM_TYPES` (each with fill, bed, bath, conditioned, default w/h ft), `roomDef`, and
`floorplanTotals(fp)` → { conditioned sqft, bedrooms, bathrooms, rooms }. Garage + covered patio are
excluded from conditioned sqft. The plan is stored in `plan.floorplan` (persists via the existing
build-project RPC). **Sync to spec** writes sqft/bd/ba into the Spec and regenerates the budget +
schedule from it (`buildPlanFromSpec`), so building a plan auto-costs it.

## CRM Module — Phase 0 (Jul 1 2026 — progress tracking + shell skeleton)

Roadmap of record: `docs/crm-roadmap.md`. Full CRM build workflow rules (branch-per-phase, additive-
only migrations, shared-DB caveats, test-data isolation): `CLAUDE.md` → "CRM Phase Workflow". Phase 0
is the first build phase — a minimal `/crm` route skeleton plus the always-current build-progress
tracker every later phase reports into at close-out.

**Feature flag:** `page:crm` — `dev_only_user_id` = Moroni's employee id
(`d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da`), `enabled = false`. Invisible to every other employee on
both `dev` and `main` until opened up. Gates the `/crm/*` route tree (`<FeatureRoute flag="page:crm">`
in `src/App.jsx`) and the CRM nav entry (`src/lib/navItems.jsx` — `NAV_ITEMS` + `OVERFLOW_ITEMS`,
key `crm`, `IconCrm`).

**Tables** (migration: `supabase/migrations/20260701_crm_phase0_scaffold.sql` — additive, all RLS
`FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)` at creation):
```
crm_orgs          — id, name, is_test bool default false, created_at. The org_id tenancy seam every
                    later CRM table carries. Seeded with exactly two rows: "Utah Pros Restoration"
                    (is_test=false, the real org) and "Utah Pros — TEST" (is_test=true, disposable —
                    every CRM test row from later phases keys to this org).
crm_build_phases  — phase_key TEXT PK, title, status ('planned'|'in_progress'|'shipped', default
                    'planned'), shipped_at, sort_order. One row per roadmap phase: 0, 1, 2, 3, 4a,
                    4b, 4c, 4d, 5, and (since roadmap v3, 2026-07-02 — migration
                    `20260702_crm_roadmap_v3_phases.sql`) F, 6a, 6b, 7, 8, 9, 10.
crm_build_stages  — id, phase_key FK→crm_build_phases (ON DELETE CASCADE), title, status
                    ('todo'|'in_progress'|'done', default 'todo'), sort_order, UNIQUE(phase_key,
                    title). The sub-steps/to-dos inside each phase — seeded from each phase's
                    committed close-out checklist in docs/crm-roadmap.md.
```

**RPCs** (all SECURITY DEFINER, GRANT EXECUTE TO anon, authenticated):
```
get_crm_build_progress()                  — Returns one jsonb object: { phases: [...], overall_done,
                                             overall_total }. Each phase object carries phase_key,
                                             title, status, shipped_at, sort_order, stages (array of
                                             { id, title, status, sort_order }), done_count,
                                             total_count. Powers /crm/roadmap end to end.
set_crm_phase_status(p_phase_key, p_status) — Validates status is one of planned/in_progress/shipped;
                                             stamps shipped_at = now() whenever p_status = 'shipped'
                                             (re-stamps on every call, doesn't just set-once); raises
                                             on an unknown phase_key. Returns the updated row.
set_crm_stage_status(p_stage_id, p_status)  — Same shape for crm_build_stages (todo/in_progress/
                                             done). Returns the updated row.
```

**Frontend**: `src/components/CrmLayout.jsx` — deliberately bare (just `<Outlet/>`); Phase 1 replaces
it with the real designed shell (contextual left sidebar, `--crm-*` scoped tokens, SVG icon set —
see docs/crm-roadmap.md's "Design & shell decisions" section). `src/pages/crm/CrmRoadmap.jsx` —
`/crm/roadmap`, read-only, reads `get_crm_build_progress()` via `db.rpc()`; renders every phase as a
card with a status badge, a `done/total` progress bar, and its stages as a checklist. This page is
the single source of truth for CRM build progress — no external tracker. CSS lives in `src/index.css`
under a `.crm-roadmap-*` block (plain app tokens — Phase 1 introduces the `.crm-shell`/`--crm-*`
scoped token set, not used yet).

**Test-first**: `supabase/tests/crm_phase0_build_progress.test.js` — an integration test (vitest,
hits the live Supabase REST API directly via `src/lib/supabase.js`'s unauthenticated client) proving
`set_crm_phase_status` stamps `shipped_at`, `set_crm_stage_status` marks a stage done, and
`get_crm_build_progress` rolls up done/total counts correctly; committed before the migration (see
git history). Self-skips via `describe.skipIf` when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
aren't set — matches CI's `npm test` step, which doesn't currently receive those secrets (only the
Build step does; see `.github/workflows/ci.yml`). **Known sandbox limitation**: this session's outbound
network egress proxy does not allow-list the Supabase host, so the test could not be executed for real
here — the identical assertions were instead verified directly against the live `dev`/`main` shared
database via the Supabase MCP `execute_sql` tool (a `DO $$ ... ASSERT ...` block), which passed. The
committed test will run for real on a machine with normal (non-sandboxed) egress and populated
credentials.

**Dogfooding**: Phase 0 marks its own `crm_build_phases`/`crm_build_stages` rows via these same RPCs
at close-out (`set_crm_stage_status` per stage, then `set_crm_phase_status('0', 'shipped')`) — the
first real exercise of the tracker. As of this session's close-out, 6 of 7 stages are marked `done`
and phase 0 is `in_progress` (not yet `shipped`) — the one remaining stage is the live branch-preview
visual check, which needs a logged-in Moroni session and could not be done from this sandbox (same
network egress limitation as the integration test, above). Flip it to `done` and the phase to
`shipped` via `set_crm_stage_status`/`set_crm_phase_status` once that's confirmed on the pushed
branch's Cloudflare preview.

## CRM Module — Phase 1 (Jul 1 2026 — CRM shell + CallRail lead ingestion)

Builds on Phase 0 (above), which merged into `dev` first. Full spec: `docs/crm-roadmap.md` →
"Phase 1 — CRM shell + CallRail lead ingestion".

**Table** (migration: `supabase/migrations/20260701_crm_phase1_shell_callrail.sql` — additive, RLS
`FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)` at creation):
```
inbound_leads — id, org_id (FK crm_orgs), contact_id (FK contacts, nullable — see the spam/duration
                filter below), source_type ('call'|'form'), callrail_id UNIQUE, tracking_number,
                caller_number, duration_sec, spam_flag bool default false, source, medium, campaign,
                recording_url, transcription, form_data jsonb, lead_status default 'new', value,
                direction, occurred_at, raw_payload jsonb, notes, created_at, updated_at. Indexed on
                contact_id, org_id, occurred_at desc. Deliberately NOT named `leads` — see the
                roadmap's terminology-fix note: `Leads.jsx` is unrelated (jobs in phase='lead'), and
                this is a raw call/form touch that may never become anything.
```

**RPCs** (SECURITY DEFINER, GRANT EXECUTE TO anon, authenticated):
```
upsert_lead_from_callrail(p_callrail_id, p_source_type, p_tracking_number, p_caller_number,
  p_duration_sec, p_spam_flag, p_source, p_medium, p_campaign, p_recording_url, p_transcription,
  p_form_data, p_lead_status, p_value, p_direction, p_occurred_at, p_raw_payload, p_org_id)
  — True upsert-and-merge keyed on callrail_id (CallRail redelivers webhooks for the same call as
  the recording/transcript become available later): fields present in the new payload overwrite,
  null fields preserve whatever was already saved. p_org_id defaults to the real Utah Pros org when
  omitted; callers pass the "Utah Pros — TEST" org id explicitly for test rows. **NEVER auto-creates
  a contact** (`20260701_crm_lead_no_autocreate_contact.sql`): it LINKS the lead to an existing
  contact when one already matches `caller_number` (so a known customer's call lands on their
  timeline), but an unknown number stays a contact-free lead — most inbound calls are
  spam/wrong-numbers/price-shoppers, and auto-creating a contact per call floods the contacts table
  (and, via `trg_qbo_customer_sync`, QuickBooks). A contact is created only when the lead is
  qualified: it books (the app's find-or-create-by-phone flows) or staff run `promote_lead_to_contact`.
  (This retired the old `shouldCreateContact` spam-gate predicate + `functions/lib/callrail.js`, now
  moot since nothing is auto-created.) Every call writes a `system_events` row (`crm_lead_created`
  or `crm_lead_updated`).
promote_lead_to_contact(p_lead_id, p_name, p_email, p_created_by) — the CRM "Add as customer" action
  (Leads board detail panel, shown for a contact-free lead): find-or-creates a contact by the lead's
  `caller_number` (already E.164 from CallRail), backfills name/email where blank, links this lead
  **and any other still-unlinked leads from the same number**, and logs a `crm_lead_promoted`
  system_events row. `SECURITY DEFINER`, granted `anon, authenticated`.
update_lead_status(p_lead_id, p_status, p_notes, p_updated_by) — staff follow-up (Call Log page);
  logs a `crm_lead_status_updated` system_events row.
set_lead_transcription(p_lead_id, p_transcription, p_source default 'deepgram', p_analysis jsonb
  default null) — stores a call transcript we generated ourselves (see transcribe-call.js). Sets
  `transcription`, `transcription_source`, `transcribed_at`, `transcript_analysis` (COALESCE — a
  null analysis leaves the existing one), bumps `updated_at`, logs `crm_call_transcribed`
  (payload notes `has_analysis`). `SECURITY DEFINER`, granted `anon, authenticated`. Modeled on
  `update_lead_status`. **v2 (migration `20260701_crm_call_transcription_analysis.sql`)** dropped
  the original 3-arg version and recreated it with `p_analysis`.
set_lead_caller_name(p_lead_id, p_name) — stores a transcript-detected caller name on the lead
  (`caller_name`, only-if-blank) and backfills a LINKED contact's name only when that name is
  currently blank. **Never creates a contact** (raw-call spam must not pollute contacts — same
  stance as ingestion). `SECURITY DEFINER`, granted `anon, authenticated`, logs
  `crm_lead_caller_named`. (migration `20260701_crm_caller_name.sql`.)
set_lead_details(p_lead_id, p_notes, p_value, p_updated_by) — sets a lead's `notes` (text) + `value`
  (numeric) DIRECTLY (form is source of truth; null clears). Powers the Call Log "Notes & value"
  editor. Logs `crm_lead_details_updated`. (migration `20260701_crm_lead_details.sql`; the columns
  already existed.)
get_tracking_numbers() → (tracking_number, label, call_count) — every DISTINCT tracking number seen
  in inbound_leads LEFT JOINed to its campaign title + call count, most-active first. Powers the
  **CRM Settings → Tracking Numbers** editor AND the Call Log's read-only title lookup (`labelMap`).
set_tracking_number_label(p_tracking_number, p_label) — upsert the campaign TITLE for a tracking
  number (on the org's row). Both `SECURITY DEFINER`, granted `anon, authenticated`.
  (migration `20260701_crm_tracking_numbers.sql`.) **Titles are set in CRM Settings**, not inline on
  the Call Log — the Call Log chip is now read-only, showing the title (or the formatted number when
  untitled). `CrmSettings.jsx` lists every number with its call count + an editable title field.
get_inbound_leads(p_limit default 100, capped 500) → jsonb array of the newest leads with the linked
  `contact` ({name, phone}) embedded — mirrors the old `select=*,contact:contacts(name,phone)` shape
  exactly. `SECURITY DEFINER`, `STABLE`, granted `anon, authenticated`. **Why an RPC and not a GET
  select:** a GET is cacheable, so returning to the Call Log after a soft navigation showed a STALE
  cached list (a just-landed live call was missing until a hard refresh); an RPC is a POST, which
  browsers never cache. `CrmCallLog.jsx` `load()` calls this. (migration `20260701_crm_get_inbound_leads.sql`.)
  **Auto-refresh:** `CrmCallLog.jsx` polls this every 15s while the tab is visible + refetches on tab
  focus, and has a manual **Refresh** button — so a newly-landed call appears without a hard reload
  (CallRail's post-call webhook can lag ~1 min after the call). Silent background refreshes don't
  blank the list or toast; open inline editors keep their local state. NOTE: to make calls appear at
  *ring* time (near-instant), add a CallRail **"Call Started"** webhook pointing at the same
  `/api/callrail-webhook?secret=…` endpoint — ingestion already handles it (the mapper tolerates the
  missing duration/recording and `upsert_lead_from_callrail` is idempotent on `callrail_id`, so the
  post-call event enriches the same row). An in-progress lead renders with duration `—` plus a
  pulsing **"Waiting for recording & transcript…"** indicator (`isAwaitingRecording`: a call with no
  recording seen in the last 10 min) so a fresh 0:00 row never looks broken — the page auto-refreshes
  it into Play/transcript once CallRail delivers and the webhook auto-transcribes.
```

**New table `crm_tracking_numbers`** (`id, org_id, tracking_number, label, created_at, updated_at`,
`UNIQUE(org_id, tracking_number)`, RLS-enabled at creation) — maps a CallRail tracking number to a
**campaign label**. CallRail leaves `campaign`/`source` empty on direct dials, so the tracking
number IS the ad-source identity; staff label each number ("Google Ads", "Yard signs") inline on
the Call Log and the label shows on every call from it. `org_id` supplied by the RPC (Postgres
forbids a subquery column DEFAULT); the table is only written through `set_tracking_number_label`.

**`src/lib/phone.js`** gained `formatPhone(e164)` → `"(801) 447-1917"` (US 10-digit; echoes
anything else unchanged) for displaying tracking/caller numbers.

**`inbound_leads.caller_name text`** (migration `20260701_crm_caller_name.sql`, additive) — a
name detected from the call transcript by the Claude naming pass (see transcribe-call.js). The Call
Log prefers `contact.name` → `caller_name` → the raw phone number for the row label.

**`inbound_leads` columns added** (two additive migrations):
- `20260701_crm_call_transcription.sql`: `transcription_source text` + `transcribed_at timestamptz`
  — WHERE a transcript came from (`'deepgram'`) and WHEN.
- `20260701_crm_call_transcription_analysis.sql`: `transcript_analysis jsonb` — the structured
  Deepgram result: `{ model, speakerMode: 'channel'|'diarize', turns:[{speaker,text}], summary,
  sentiment:{label,score}, topics:[], entities:[{label,value}] }`. Mirrors the existing
  `raw_payload`/`form_data` JSONB pattern. The flat `transcription` text column stays alongside it
  (for search / a future LLM); `transcript_analysis` backs the Call Log conversation view.

**Existing RPC widened**: `get_integration_status(p_provider)` (originally QBO-only) only checked
`refresh_token IS NOT NULL` for "connected". CallRail has no OAuth — its API key lives in
`integration_credentials.access_token` with `refresh_token` left NULL — so the check was widened to
`refresh_token IS NOT NULL OR access_token IS NOT NULL`. Strict superset of the old behavior (QBO
always has both set together once connected), verified live via the Supabase MCP (see Verification
below) — not a behavior change for existing QBO callers.

**Workers** (`functions/api/`):
```
callrail-webhook.js   — POST, receives CallRail's call/form events, maps payload → 
                         upsert_lead_from_callrail, logs a worker_runs row per call. Auth is a
                         `?secret=` query param checked against integration_config
                         ('callrail_webhook_secret') — a documented placeholder (CallRail lets you
                         fully customize the webhook target URL, so this avoids guessing at an
                         unverified HMAC/signature-header scheme); confirm against CallRail's actual
                         webhook docs/dashboard and adjust if it differs. **Payload shape CONFIRMED
                         against a live delivery:** CallRail POSTs `application/x-www-form-urlencoded`
                         (NOT JSON), so the worker parses text→JSON→URLSearchParams; every decoded
                         value is a string, and the call id is under `resource_id` (no top-level
                         `id`). The pure mappers now live in `functions/lib/callrail.js`
                         (mapCallPayload/mapFormPayload/pickCallId/boolish/isAllowedRecordingUrl),
                         unit-tested against the real payload in `functions/lib/callrail.test.js`.
                         `boolish()` fixes a form-encoding trap where the string "false" was truthy
                         and mis-flagged clean calls as spam. **Auto-transcribe:** after the upsert,
                         if `shouldAutoTranscribe(lead)` (a call with an api-form recording and no
                         transcript yet), it runs Deepgram in the background via `context.waitUntil`
                         (imports `transcribeLead` from transcribe-call.js) — so the transcript +
                         summary are ready within seconds of the recording landing, no manual click.
                         Idempotent: only the recording-ready delivery passes, and a re-delivery after
                         the transcript exists is skipped (never re-bills Deepgram); best-effort, so a
                         failed auto-transcript never fails the webhook. Always returns 200 except on a
                         bad/missing secret (403), to avoid a CallRail retry storm.
callrail-connect.js   — GET (read the webhook secret) / POST (save API key, returns the secret) /
                         DELETE (disconnect), all authenticated. Writes integration_credentials
                         (provider='callrail', key in access_token) and generates the webhook
                         shared secret into integration_config on first connect only (never rotated
                         on reconnect — it's already pasted into CallRail's dashboard by then). The
                         GET exists because integration_config has no anon/authenticated RLS policy
                         (service-role only) — the frontend can't select it directly, so
                         CrmIntegrations.jsx calls this endpoint to display the webhook URL +
                         secret for Moroni to paste into CallRail's dashboard. Reuses
                         google-drive.js's generic getActorEmployee Bearer-auth helper (not
                         Google-Drive-specific despite the file name).
github-connect.js     — GET (connected? + default_repo) / POST (save GitHub PAT, validated
                         against GitHub /user; also sets integration_config.github_default_repo;
                         token-less POST updates just the repo) / DELETE (disconnect), all
                         authenticated (getActorEmployee). Writes integration_credentials
                         (provider='github', PAT in access_token). Backs AdminIntegrations.jsx;
                         the UPR MCP's github.js reads this token (env GITHUB_TOKEN fallback).
callrail-backfill.js  — POST, authenticated, manually triggered (not a cron). Pulls historical
                         CALLS ONLY via CallRail's v3 list-calls API and upserts through the same
                         RPC. Needs the connected API key + the CallRail account id; the account id
                         is resolved by functions/lib/callrail-api.js resolveCallRailAccountId()
                         (saved integration_config('callrail_account_id') → CALLRAIL_ACCOUNT_ID env
                         → auto-discovered via CallRail's /v3/a.json and persisted). callrail-connect
                         POST also resolves+stores it on connect (and thereby validates the key), so
                         no Cloudflare env var is required — a pasted key is enough. Requests
                         `&fields=transcription` (CallRail omits the transcript from the default list
                         response — opt-in Conversation Intelligence); both backfill + webhook run the
                         value through `transcriptText()` (functions/lib/callrail-api.js) which coerces
                         CallRail's string/object/array transcript shape to plain text. Field name +
                         shape unverified against the live account — re-run the backfill to confirm.
                         Endpoint path/field names are unverified against a live account — same
                         open item as the webhook. Hard-capped at 50 pages to guard against a
                         runaway pagination loop. **Disclosed scope gap**: the roadmap spec asks for
                         "historical calls + form leads" — this worker deliberately backfills calls
                         only; CallRail's historical form-submission list API is a second,
                         differently-shaped endpoint this session couldn't verify without a live
                         account (same open item as whether the site's form even routes through
                         CallRail's Form Tracking product — see docs/crm-roadmap.md "Open items to
                         confirm before Phase 1 starts"). Does NOT affect live form leads — those
                         arrive the same way calls do, through callrail-webhook.js's
                         mapFormPayload(), once CallRail is connected.
callrail-recording.js — GET, authenticated. Streams a call recording INLINE so staff never leave
                         the Call Log. `inbound_leads.recording_url` is CallRail's authenticated API
                         endpoint (opening it directly in a browser → "HTTP Token: Access denied"),
                         so this proxy takes a `lead_id`, reads that lead's recording_url + the
                         CallRail API key from integration_credentials, fetches with the
                         `Authorization: Token token="…"` header, and streams the audio back. SSRF
                         guard (`isAllowedRecordingUrl`, functions/lib/callrail.js): proxies only a
                         CallRail-hosted URL stored on that lead. **app→api rewrite (critical):** the
                         LIVE webhook delivers `app.callrail.com/calls/{id}/recording/redirect?access_key=…`,
                         which THROWS when fetched server-side → the Worker crashed and Cloudflare
                         returned a raw **502 (text/html)**, so live-call recordings would not play or
                         transcribe. The proxy now rewrites that app URL to the working
                         `api.callrail.com/v3/a/{acct}/calls/{id}/recording.json` form (via
                         `extractCallId` + `callrailApiRecordingUrl` + `resolveCallRailAccountId`)
                         before fetching — the same form the backfill stores and that streams cleanly.
                         `callrail-webhook.js` also normalizes recording_url to the api form AT INGEST,
                         so all consumers (this proxy + `transcribe-call`) get a working URL.
                         `resolveCallRecording` now try/catches the fetch so a throw returns a clean
                         error shape instead of 502-ing the Worker. The key never reaches the client. Robust to CallRail's response shape: streams
                         audio/* directly, follows a JSON `{url}` descriptor to the signed audio and
                         streams that, else returns a 502 with the upstream status + body snippet so
                         a bad shape is diagnosable. `CrmCallLog.jsx` fetches it as a blob (an
                         `<audio src>` can't carry the Supabase Bearer) and plays it in a compact
                         **custom** player (`RecordingPlayer` — a hidden `<audio>` engine + CRM-styled
                         play/pause, seek, and time), not the browser's default control chrome. Each
                         call row also has a collapsible **"Show transcript"** toggle (only when a
                         transcript exists), and a **"Transcribe"** button when a recording exists
                         but no transcript does (calls transcribe-call.js below). The
                         recording-URL resolution (direct-audio-stream vs. JSON→signed-URL) now lives
                         in the shared `resolveCallRecording()` (functions/lib/callrail-api.js),
                         reused by transcribe-call.js.
transcribe-call.js    — POST, authenticated. Transcribes call audio OURSELVES because our CallRail
                         plan doesn't expose transcripts via the API (that needs CallRail's Premium
                         Conversation Intelligence add-on, ~$110/mo — confirmed live: `transcription`,
                         `lead_score`, `lead_explanation` all come back null even on long answered
                         calls). Body `{ lead_id }` (one call, from the Call Log Transcribe button) or
                         `{ backfill: true, days?: 30 }` (every recent call with a recording but no
                         transcript). Reads the Deepgram + CallRail keys from integration_credentials,
                         resolves the recording via `resolveCallRecording()`, then hands Deepgram the
                         signed URL so it fetches the audio itself (no Worker buffering; falls back to
                         POSTing bytes when CallRail streams directly). **v2 request** (one call):
                         `model=nova-3&smart_format&punctuate&utterances&diarize` +
                         Audio Intelligence `summarize=v2&sentiment&topics&detect_entities`.
                         **`multichannel` was DROPPED** — CallRail actually hands us a **MONO**
                         recording, and multichannel on a 1-channel file makes Deepgram treat the whole
                         call as one "channel 0" speaker, SUPPRESSING diarization (a two-person call
                         collapsed into a single "Agent" block). `diarize` alone separates the voices;
                         when mono still defeats it (≤1 speaker → `needsResegment`), a Claude pass
                         (`resegmentSpeakers` + pure `buildResegmentPrompt`/`parseResegmentedTurns`)
                         **rebuilds** the Agent/Customer turns from the raw transcript
                         (`speakerMode='resegment'`). Stores BOTH the flat text (`formatDeepgramTranscript`)
                         and the structured `transcript_analysis` (`buildTranscriptAnalysis` — pure,
                         unit-tested: turns + summary + sentiment + topics + entities) via
                         `set_lead_transcription`. **Idempotency:** the single-lead guard skips only
                         when a row has BOTH transcript AND analysis (unless `force`); the backfill
                         targets `or=(transcription.is.null,transcript_analysis.is.null)` so pre-v2
                         rows get re-enriched once with nova-3 + intelligence, then are skipped.
                         Backfill hard-capped at 200 (MAX_BACKFILL); logs one worker_runs row.
                         **Deepgram key** lives in integration_credentials (provider='deepgram') —
                         a pasted key, not a Cloudflare env var, same pattern as CallRail's. Confirmed
                         live: CallRail's download is MONO (hence the diarize + re-segment path above);
                         the parser is defensive — unconfirmed Audio-Intelligence shapes degrade to
                         null/[], never throw.
                         **Speaker naming (best-effort):** after Deepgram, a Claude Haiku pass
                         (`functions/lib/speakerNaming.js` — pure buildSpeakerPrompt/
                         parseSpeakerIdentities/applySpeakerIdentities, unit-tested) identifies which
                         speaker is the Agent vs Customer and each person's name, relabeling the
                         `transcript_analysis` turns (each turn gains a `role`). **When diarization
                         collapsed to one speaker** (mono), the worker instead runs `resegmentSpeakers`
                         (above), which rebuilds AND names the turns in one pass. The caller's name is
                         stored via `set_lead_caller_name`. Needs `ANTHROPIC_API_KEY` (Cloudflare env,
                         already set for the chat workers); any failure leaves Speaker 1/2 untouched.
                         Topics are capped to the 6 most-confident in `buildTranscriptAnalysis`
                         (Deepgram over-tags). The Call Log renders turns as grouped speaker blocks
                         (consecutive same-speaker turns merged; name bold-blue; tinted by role).
```

**Frontend — the real CRM shell** (`src/components/CrmLayout.jsx`, replacing Phase 0's bare
`<Outlet/>`): a `.crm-shell` wrapper scoping its own `--crm-*` design tokens (dark sidebar, Public
Sans font loaded in `index.html`) — deliberately its own visual identity, not UPR's Inter-based
look, mirroring how `.tech-layout` scopes `--tech-*` tokens. A left sidebar (desktop ≥1024px; a
horizontal scrollable strip below that) lists Overview, Leads, Call Log, Tasks, Attribution,
Reports, Integrations, Settings — icons in the new `src/lib/crmIcons.jsx` (kept separate from
`src/lib/navItems.jsx` because a couple of names, e.g. `IconLeads`, would otherwise collide with
unrelated existing icons there). `/crm/roadmap` (Phase 0) is intentionally NOT one of these sidebar
items — it stays in the main app's visual style as a separate build/ops page, linked from the CRM
sidebar's footer instead of taking a nav slot; `/crm` now redirects to `overview` (was `roadmap`).
`/crm/roadmap` also gained a page-local dark mode (defaults on, toggle button in the page header) —
a `.crm-roadmap-page.dark` wrapper re-points the same `--bg-*`/`--text-*`/`--border-*`/
`--accent-light` custom properties `.page`/`.card`/`.status-badge` already read, same scoped-
token-override trick as `.tech-layout`/`.crm-shell`. Plain component state, not `localStorage` (per
the app's no-localStorage-for-state rule) — resets to dark on reload rather than persisting.

**Top-nav placement**: the `crm` nav entry moved from `OVERFLOW_ITEMS` (the "..." drawer) to
`PRIMARY_ITEMS` in `src/lib/navItems.jsx` — it now renders directly in the always-visible desktop
top bar, not buried behind the menu. Visibility is unchanged: still gated by `isItemVisible()`'s
`featureFlag: 'page:crm'` check, so it only appears for whoever the flag's `dev_only_user_id`
resolves to (Moroni) — every other employee's top bar still shows exactly the original 7 items.
The legacy `NAV_ITEMS` sidebar entry's path was also updated to `/crm/overview` (was `/crm/roadmap`)
to match the new default landing page.

Only two sidebar pages have real data this phase (`src/pages/crm/`):
- **CrmCallLog.jsx** (`/crm/call-log`) — lists `inbound_leads` (embeds `contacts` via the
  `contact_id` FK), newest first; inline `<select>` to change `lead_status` (calls
  `update_lead_status`); recording link + transcript shown when present.
- **CrmIntegrations.jsx** (`/crm/integrations`) — a card per provider: CallRail (paste-API-key
  form when disconnected, or a status + inline two-click "Disconnect" confirm when connected —
  calls `/api/callrail-connect` POST/DELETE), plus **Google Ads and Meta Ads (Phase 2, shipped
  this session)** — a shared `OAuthProviderCard` component: "Connect"/"Reconnect" redirects to
  `/api/google-ads-connect` or `/api/meta-ads-connect` (GET → `{url}` → `window.location.href`,
  same pattern DevTools' QuickBooks card uses), lands back on `/crm/integrations?google_ads=` /
  `?meta_ads=connected|error|badstate` which the page toasts and clears from the URL. Two-click
  "Disconnect" via the same connect workers' DELETE. None of the three cards ever writes
  `integration_credentials` directly from the frontend (no anon/authenticated RLS policy —
  service-role only, same as QBO); status reads go through the read-only `get_integration_status`
  RPC for all three providers.

Only `CrmTasks.jsx` still renders the shared `CrmStubPage.jsx` ("Coming in Phase 4d") until its
phase ships. `CrmLeads.jsx` and `CrmSettings.jsx` shipped real screens in **Phase 4a**;
`CrmOverview.jsx`, `CrmAttribution.jsx`, and `CrmReports.jsx` shipped in **Phase 3** — see those
sections below.

**Test-first**:
- `functions/lib/callrail.test.js` — vitest unit test for `shouldCreateContact({spam_flag,
  duration_sec})` (test target "c"), committed before `functions/lib/callrail.js` existed.
- `supabase/tests/crm_phase1_callrail.test.js` — integration test (same pattern as Phase 0's) for
  `upsert_lead_from_callrail` idempotency (test target "b"): a redelivered "recording ready" webhook
  updates the same row instead of duplicating it, preserving fields the second payload didn't
  include; plus an integration assertion that a spam/sub-15-second call never creates a contact.
  Self-skips via `describe.skipIf` without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (matches
  CI). **Same known sandbox limitation as Phase 0**: this session's network egress doesn't allow-list
  the Supabase host, so the committed test couldn't run live here either — the identical scenario
  (create → redeliver with new fields → assert one row + merged fields; spam call → assert no
  contact) was instead run for real against the live shared database via the Supabase MCP
  `execute_sql` tool, passed, and the manually-inserted rows were deleted afterward.

**Acceptance criteria status (docs/crm-roadmap.md "Phase 1 — verification & acceptance")**: the
RPC-level criteria (idempotent upsert, spam filter, `system_events`/`worker_runs` logging, API key
read from `integration_credentials` not a hardcoded secret) are verified live per above. **Not
verified from this sandbox** — needs Moroni, post-merge: a real call/form through an actual CallRail
account and dedicated dev tracking number (this session has no CallRail account access), the
backfill's row count against CallRail's own dashboard, and the visual check of Call Log +
Integrations against the original Stitch handoff mockup (not present in the repo — it was reviewed
in an earlier session's chat, not committed as an asset) on the branch's Cloudflare preview. The
CallRail webhook auth mechanism and payload field names are also placeholders pending confirmation
against CallRail's real dashboard/docs (see the workers' NOTES above) — the two "open items to
confirm before Phase 1 starts" from the roadmap were not resolvable in this session either, for the
same reason.

**Independent review**: `upr-pattern-checker` found 5 hardcoded-hex CSS violations outside the
`.crm-shell` token block and one two-click-confirm missing its `onBlur` cancel — all fixed (see git
history). `crm-phase-reviewer` (Opus) then graded the phase DO-NOT-SHIP-YET pending three fixable
items, all addressed before this PR: (1) the Integrations page's file header claimed it showed the
webhook URL/secret but didn't — `callrail-connect.js` gained a `GET` endpoint and the page now
displays it; (2) the backfill worker's calls-only scope vs. the roadmap's "calls + form leads" spec
was silently narrowed in this doc rather than disclosed — fixed above; (3) phase/stage status was
undocumented — fixed by this paragraph and the dogfooding note below. The remaining open acceptance
criteria (real call/form, backfill count, visual check, webhook auth confirmation) were confirmed by
the reviewer as legitimately blocked by this session's no-CallRail-account/no-Supabase-egress
limits, not silent gaps.

**Dogfooding**: 4 of 8 `crm_build_stages` rows are marked `done` as of this session's close-out
(test-first, `npm test`/`build`/`eslint`, `upr-pattern-checker`+`crm-phase-reviewer` sign-off,
this doc update) via `set_crm_stage_status`; `crm_build_phases('1')` is `in_progress`, not yet
`shipped` — same honest pattern as Phase 0. The remaining 4 stages (full acceptance criteria, the
visual check, marking `shipped`, and the `dev → main` PR) need a real CallRail account and a
logged-in Moroni session this sandbox doesn't have. Flip them via
`set_crm_stage_status`/`set_crm_phase_status('1', 'shipped')` once confirmed on the pushed branch's
Cloudflare preview and a real CallRail connection.

**Phase 1 close-out (Roadmap v3, Wave 0, Session A — 2026-07-02)**: Phase 1's core build (above)
had already merged to `dev`/`main` in earlier sessions (PR #189 + follow-ups through #223) with a
real, live CallRail connection — the "needs Moroni / no CallRail account" caveats in the two
paragraphs above are now resolved: 59 real call rows are live in `inbound_leads`, correctly linking
to existing contacts by `caller_number` and never auto-creating one (intake rule changed post-spec,
see below), webhook auth + payload shape are confirmed against real deliveries (not placeholders —
`functions/lib/callrail.test.js` pins an actual captured payload), the CallRail API key reads from
`integration_credentials` not a hardcoded secret, and every lead/run writes `system_events`/
`worker_runs`. The backfill (30-day default window) processed 57 records against CallRail's own
54-in-window count — within tolerance. This close-out session:
- Confirmed a **business-rule change since the original spec**: `upsert_lead_from_callrail` no
  longer auto-creates a contact at all (migration `20260701_crm_lead_no_autocreate_contact.sql`,
  commit `1494542`) — it only LINKS to an existing contact by phone; a contact is created only via
  the new `promote_lead_to_contact` RPC ("+ Add as customer" on the Leads board) or normal booking
  flows. This retires the original `shouldCreateContact({spam_flag, duration_sec})` predicate and
  its vitest unit test (removed in the same commit) — moot, not skipped, since no call can ever
  auto-create a contact now regardless of spam/duration. The roadmap's test-target "(c)" and the
  Phase 1 branch checklist's item (b)+(c) title are stale references to this retired function; the
  integration test in `supabase/tests/crm_phase1_callrail.test.js` was rewritten for the new
  behavior and still covers the intent (unknown number → no contact).
- **Form-capture stage stays open, disclosed, not closed as done or as superseded.** No owner
  decision on the CallRail-Form-Tracking-vs-Phase-10 fork was recorded in `docs/crm-roadmap.md`'s
  dispatch section, so the roadmap's default-if-undecided rule applies ("verify the CallRail form
  path anyway"). Checked live via the CallRail MCP tools: `callrail_list_form_submissions` returns
  **0 records** across the full ~2-year retention window, and `inbound_leads` has **0**
  `source_type='form'` rows — a real fixture is genuinely unobtainable without the owner (either a
  live test form submission, or an owner decision to supersede this stage per Phase 10). `mapFormPayload`
  in `functions/lib/callrail.js` therefore remains **untested guesswork** (only `mapCallPayload` is
  pinned to a real captured fixture) — a live form submission through the site today would run through
  unverified field-name mapping. `crm_build_stages` sort_order 8 stays `todo` with this disclosure.
- **Visual check vs. the Stitch handoff** also stays open/owner-gated — the mockup isn't a repo asset
  and can't be verified from this sandbox.
- Fixed 2 new hardcoded-hex CSS violations `upr-pattern-checker` found in the `.crm-shell` token
  block (`.crm-timeline-badge[data-type="sms"]` and `.crm-badge-won`, both duplicating
  `--crm-success-bg`'s `#ecfdf5` instead of referencing it) — now tokenized.
- `crm-phase-reviewer` (Sonnet, this session) independently verified the above against the live
  files/migrations (not just the summary) and recommended **SHIP** — call-side ingestion,
  idempotency, logging, and credential handling all pass with real evidence; the two open items are
  genuinely owner-gated. Flagged one non-blocking, latent issue: `20260701_crm_lead_no_autocreate_contact.sql`
  sorts lexically *before* `20260701_crm_phase1_shell_callrail.sql` (`l` &lt; `p`), but functionally
  depends on it (references the `inbound_leads` type the phase-1 migration creates). The live DB is
  correct (migrations were applied via MCP in chronological order, not filename order), but a clean
  rebuild via `supabase db push`/reset would resolve migrations by filename and could apply them out
  of order. Not fixed in this session — renaming an already-applied migration file risks desyncing
  Supabase's migration-history tracking against the shared `dev`/`main` project; left as a disclosed
  follow-up rather than a live risky rename.
- Reconciled `crm_build_stages` (phase_key='1'): flipped sort_order 6 ("set phase-1 shipped; delete
  test rows") and 7 ("pushed to dev, verified, dev → main PR opened") from `todo` to `done` — both
  had genuinely already happened (PR #189 merged; Phases 2/3/4a/4c already shipped on top of Phase 1)
  but were never flipped, under-reporting progress. No test rows tagged with a dev tracking number
  were found to delete (`inbound_leads` has zero `callrail_id LIKE 'test-%'` rows). Form-capture
  (sort_order 8) and the visual check (sort_order 4) stay `todo`, disclosed above. `crm_build_phases('1')`
  set to **`shipped`** — all non-owner-gated acceptance criteria pass.

### Phase 2 — Ad spend ingestion (Google Ads + Meta Ads)

**New table** `ad_spend` (`supabase/migrations/20260701_crm_phase2_adspend.sql`, applied to the
live shared dev/main Supabase project) — `id, org_id (FK crm_orgs), platform ('google'|'meta'),
campaign_id, campaign_name, date, spend, impressions, clicks, platform_conversions, created_at,
updated_at`, `UNIQUE(platform, campaign_id, date)`. `platform_conversions` is deliberately
informational-only (Google/Meta's own conversion counts never reconcile with CallRail's) —
**CallRail leads + won jobs in UPR remain the funnel's one source of truth**; ad platforms only
ever supply spend dollars. RLS enabled + explicit `FOR ALL` policy at creation.

**RPCs** (both `SECURITY DEFINER`, granted `anon, authenticated`):
- `upsert_ad_spend(p_platform, p_campaign_id, p_campaign_name, p_date, p_spend, p_impressions,
  p_clicks, p_platform_conversions, p_org_id)` — true upsert on `(platform, campaign_id, date)`;
  `spend`/`impressions`/`clicks`/`platform_conversions` overwrite on conflict (not additive) so a
  same-day re-pull corrects that day's revised numbers in place. Defaults `org_id` to the real
  (non-test) org, same pattern as `upsert_lead_from_callrail`. **Idempotency verified live** via
  Supabase MCP: two calls for the same platform/campaign/date left exactly one row with the
  second call's values; the manually-inserted test row (`campaign_id='TESTCMP001'`) was deleted
  afterward.
- `get_ad_spend(p_platform, p_start_date, p_end_date)` — read helper for verification now and the
  Phase 3 dashboard later.

**Workers**:
```
functions/lib/date-mt.js      — mountainYesterday(nowUtc) / isStale(lastUtc, nowUtc, days), pure,
                                 America/Denver (DST-aware via Intl) calendar-day math — the one
                                 place the roadmap's "pick one timezone convention" rule lives.
                                 Test-first: functions/lib/date-mt.test.js, 7 vitest unit tests
                                 (MDT/MST DST boundaries + a UTC-midnight-that-isn't-an-MT-boundary
                                 case), committed failing before the implementation existed.
functions/lib/google-ads.js   — Google OAuth (buildAuthorizeUrl/exchangeCodeForTokens/
                                 refreshTokens/saveTokens/getValidAccessToken, mirrors
                                 quickbooks.js) + fetchCampaignSpend() via GAQL searchStream.
                                 SEPARATE OAuth app from google-drive.js's per-user Drive/Calendar
                                 app on purpose — its own env vars (GOOGLE_ADS_CLIENT_ID/SECRET/
                                 REDIRECT_URI/DEVELOPER_TOKEN/CUSTOMER_ID, optional
                                 GOOGLE_ADS_LOGIN_CUSTOMER_ID for MCC) — one company-wide
                                 integration_credentials row, not per-employee.
functions/lib/meta-ads.js     — Meta/Facebook OAuth (no classic refresh_token grant — a short-lived
                                 code-exchange token is exchanged for a ~60-day long-lived token;
                                 getValidAccessToken re-exchanges the current long-lived token when
                                 within 5 days of expiry) + fetchCampaignSpend() via Graph API
                                 Insights (paginated, MAX_PAGES=50 cap). Env vars: META_APP_ID/
                                 APP_SECRET/REDIRECT_URI/AD_ACCOUNT_ID.
google-ads-connect.js         — GET (authenticated, returns {url} for window.location.href) /
google-ads-callback.js          DELETE (disconnect), mirrors quickbooks-connect.js/
                                 quickbooks-callback.js exactly. Callback redirects to
                                 /crm/integrations?google_ads=connected|error|badstate.
meta-ads-connect.js /         — same shape as the Google Ads pair; callback exchanges the OAuth
meta-ads-callback.js            code for a short-lived token then immediately for a long-lived one
                                 before saving. Redirects to /crm/integrations?meta_ads=...
sync-google-ads.js /          — GET/POST (authenticated, manual trigger) + `scheduled()` export for
sync-meta-ads.js                Cloudflare's dashboard-configured daily Cron Trigger (no
                                 wrangler.toml in this repo, per CLAUDE.md). Default run pulls ONE
                                 day — mountainYesterday(now) — via fetchCampaignSpend(), upserts
                                 each campaign/day through upsert_ad_spend. `{ backfill: true,
                                 days }` (default 365, capped at 400 — MAX_BACKFILL_DAYS) pulls a
                                 historical range. Per-row upsert failures don't abort the run
                                 (mirrors callrail-backfill.js); every invocation logs a
                                 worker_runs row (worker_name 'sync-google-ads'/'sync-meta-ads').
```

**Frontend**: `CrmIntegrations.jsx` gained real Google Ads / Meta Ads cards (`OAuthProviderCard`,
shared by both providers) replacing Phase 1's "Coming in Phase 2" placeholders — see the Phase 1
Integrations entry above for the full connect/disconnect flow. New `--crm-integration-google`
(`#4285f4`) / `--crm-integration-meta` (`#0866ff`) tokens in the `.crm-shell` block.

**DISCLOSED GAP, NOT AN OVERSIGHT — needs human verification before the first real cron run**:
the exact Google Ads API (GAQL `searchStream`, pinned at `v18`) and Meta Graph API (Insights,
pinned at `v19.0`) request/response field shapes are best-effort, written from public API docs,
**not exercised against a live developer-token account in this session** — same disclosed-gap
pattern Phase 1 used for CallRail's webhook payload shapes. This is downstream of the roadmap's
own Phase 2 prerequisite ("Google Ads developer token approved") being an external, days-to-weeks
Google approval process with no tool available in this environment to check or complete it.
Nothing runs until a human connects real credentials via the Integrations page — confirm the API
shapes against a live account at that point, per each file's NOTES section
(`functions/lib/google-ads.js`, `functions/lib/meta-ads.js`).

**Test-first**: `functions/lib/date-mt.test.js` (7 tests) committed at `597772e` before
`functions/lib/date-mt.js` existed — confirmed genuinely failing at that commit (import error),
then passing once the implementation landed at `fcc6b42`.

**`npm run test` + `npm run build` + `npx eslint`**: all green on every changed file.

**Independent review**: `upr-pattern-checker` found one hardcoded inline `style={{ gap: 8 }}` in
`CrmIntegrations.jsx` where `--space-2` already existed as the matching token — fixed (now
`.crm-integration-actions-row`). `crm-phase-reviewer` (Opus) graded every acceptance criterion
PASS except this doc update (fixed by this paragraph) and two live-only unverifiable items (the
`crm_build_phases`/test-row state, confirmed below; the backfill-vs-platform-dashboard tolerance
check, which needs a live connected account) — recommendation **SHIP into `dev`** (not `main` —
invisible behind `page:crm`/`dev_only_user_id` either way). Full verdict in this session's
transcript.

**Dogfooding**: all 8 `crm_build_stages` rows for phase-2 are marked `done` via
`set_crm_stage_status` (test-first, acceptance criteria met in-session, test/build/eslint green,
both review agents passed, this doc update, `crm_build_phases('2')` set to `shipped`, test
`ad_spend` row deleted) — except the branch-push/PR stage, flipped once the PR is actually opened.
The GAQL/Insights live-account verification called out above is an operational follow-up for
Moroni post-merge, not a build-completion blocker (same treatment Phase 1 gave its
CallRail-account-dependent items).

### Phase 3 — Attribution + funnel dashboard

**Design record**: `docs/crm-phase3-attribution-model.md` (Opus-High pass, written before any metric
code per the roadmap's model note). Locks in: **last-touch, single-touch** attribution for v1 (every
touch stored so first-touch/weighted is a future re-aggregation, not a schema change); **UPR's
won-job + QBO `jobs.invoiced_value` is the single source of truth for conversions + revenue**;
CallRail's "converted" flag and `ad_spend.platform_conversions` are informational-only, never in the
ROAS/cost math; zero-spend channels render `—`, not `0`.

**New table** `lead_attribution` (`supabase/migrations/20260701_crm_phase3_attribution.sql`, applied
live to the shared dev/main Supabase) — `id, org_id (FK crm_orgs), lead_id (FK inbound_leads, ON
DELETE CASCADE), contact_id (FK contacts, ON DELETE CASCADE), channel (CHECK IN
google_ads|meta_ads|organic|referral|insurance|other), source, campaign, referral_source_id (FK
referral_sources), occurred_at, created_by, created_at, updated_at`. One row per attribution TOUCH;
last-touch is computed at query time by `MAX(occurred_at)` so position never goes stale. RLS enabled
+ explicit `FOR ALL` policy at creation; writes via the `upsert_lead_attribution` RPC. Additive-only
— no existing table altered.

**RPCs** (all `SECURITY DEFINER`, granted `anon, authenticated`):
- `crm_channel_for_source(p_source text) → text` — normalizes a raw source string to a canonical
  channel. Data-driven: keyword rules (ordered so organic-Google — My Business/SEO — is matched
  before paid-Google — Ads/LSA), then a `referral_sources.category` fallback (insurance→insurance,
  personal/trade/program/real_estate/emergency→referral, digital→organic, traditional/other→other).
  Verified live against 23 sample strings incl. the paid-vs-organic Google split.
- `get_attribution_rollup(p_start_date, p_end_date, p_org_id) → TABLE(channel, spend, leads,
  estimates, won_jobs, revenue)` — the per-channel funnel aggregate; always returns all six channels
  (VALUES list) so zero-spend rows never disappear. Raw counts/sums ONLY — the derived money math
  lives in the unit-tested `src/lib/attribution.js`, never in SQL. Leads counted per lead (CallRail =
  truth); estimates (`status <> 'draft'`), won jobs (`phase <> 'lead' AND status <> 'deleted'`) and
  revenue (`SUM(jobs.invoiced_value)`) counted per contact's last-touch channel with `COUNT(DISTINCT
  job.id)` guarding the contact→jobs fan-out; anything unresolvable folds into `other`. **Verified
  live**: the job/revenue aggregation matched an independent hand-recompute exactly (other 95 jobs /
  $300,975, insurance 2 / $1,250, google_ads 2 / $0, organic 2 / $0, referral 1 / $0 — 102 jobs /
  $302,225 total), and the spend/ROAS/cost-per-job path was verified with disposable TEST-org
  `ad_spend` rows (google $1000 / meta $500) then cleaned up (`ad_spend` back to 0 rows).
- `get_attribution_by_campaign(p_start_date, p_end_date, p_org_id) → TABLE(channel, platform,
  campaign_id, campaign_name, spend, leads)` — paid-campaign detail (Google Ads split by agency,
  encoded in `campaign_name`), leads matched by `inbound_leads.campaign = ad_spend.campaign_name`.
- `get_crm_revenue_by_division(p_start_date, p_end_date) → TABLE(division, won_jobs, revenue)` —
  Reports' won-revenue-by-division. **Namespaced `get_crm_*`** to avoid colliding with the
  pre-existing `get_revenue_by_division(date,date) → jsonb` (a different, unrelated function — the
  first migration attempt failed on this and was corrected).
- `upsert_lead_attribution(p_channel, p_source, p_campaign, p_lead_id, p_contact_id,
  p_referral_source_id, p_occurred_at, p_created_by, p_org_id) → lead_attribution` — the RPC write
  path (manual entry / enrichment); validates channel, requires a lead_id or contact_id, logs a
  `system_events` `crm_lead_attributed` row. Not wired to UI this phase (dashboards are read-only).

**Money math** — `src/lib/attribution.js` (pure, importable, unit-tested): `costPerLead(spend,leads)`
(null if spend≤0 or leads≤0), `roas(revenue,spend)` (null ONLY if spend≤0 — a real $0 revenue on
real spend is a legitimate 0.0×), `costPerJob(spend,jobs)`, `conversionRate(num,denom)` (null only on
zero denom — a 0 numerator over a positive denom is a real 0%), `deriveChannelMetrics(row)`,
`rollupTotals(rows)` (blended efficiency computed on PAID channels only so ads aren't credited with
organic revenue), `funnelStages(counts)`, and `fmtMoney/fmtRatio/fmtPct` (null → `—`, real 0 →
`$0`/`0.0×`/`0%`). **Test-first**: `src/lib/attribution.test.js` (40 units, every expected value
hand-computed) committed failing before the module existed, then green.

**Frontend** (fill the three CRM-shell stub pages, `.crm-*` design system):
- **CrmOverview.jsx** (`/crm/overview`) — KPI cards (spend/leads/estimates/won/revenue/ROAS) + the
  Leads→Estimates→Won funnel (bars scale to the largest stage so they stay readable before CallRail
  leads accumulate).
- **CrmAttribution.jsx** (`/crm/attribution`) — per-channel table (Spend, Leads, Cost/lead,
  Estimates, Won, Cost/job, Revenue, ROAS; zero-spend rows show `—`) + Google Ads by campaign/agency.
- **CrmReports.jsx** (`/crm/reports`) — Source ROI, Won revenue by division, funnel conversion.
- **attributionParts.jsx** (components) + **attributionData.js** (helpers: `CHANNEL_LABELS`, `RANGES`,
  `rangeToDates`, `toNumberRow`, `deriveRows`) — split into two files so the `react-refresh` lint rule
  stays clean. New `--crm-*` scoped CSS block (metric cards, funnel, range picker, table,
  `--crm-channel-insurance` token). No `App.jsx` change — routes already existed from Phase 1.

**`npm run test` (80 pass / 9 skip) + `npm run build` + `npx eslint` (changed files)**: all green.

**Independent review**: `upr-pattern-checker` found one raw hex (`#d97706`) where a `--crm-*` token
should exist — fixed (`--crm-channel-insurance` token) — plus a cosmetic `get_funnel_overview`
comment/doc drift (the RPC shipped as `get_attribution_rollup`) — fixed. `crm-phase-reviewer` (Opus,
weighted on the attribution math) graded the pure money-math module (`attribution.js`) clean —
test-first ordering independently reproduced, every null/zero/div-by-zero boundary and the paid-only
blended ROAS hand-checked — and returned three actionable items, all resolved:
1. **Estimate filter** — flagged `e.status <> 'draft'` as dropping NULL-status rows via SQL
   three-valued logic. **Verified live the premise doesn't hold** (`estimates.status` is NOT NULL;
   0 nulls, 0 drafts; rollup estimates = 34 = all), so there was no undercount — but hardened to the
   null-safe `e.status IS DISTINCT FROM 'draft'` (codebase convention) anyway; totals unchanged.
2. **Google paid/organic keywords** — "Google Business Profile" (GMB's rename) and spelled-out
   "Local Services Ads" weren't covered. Added `%business profile%` → organic and `%local service%`
   → google_ads; re-verified live (both now classify correctly, existing 23 samples unchanged). The
   actual `referral_sources`/`contacts.referral_source` values in the DB already classified correctly.
3. **Doc update** — this section + the stub-description fix above.
The reviewer also noted the by-design last-touch asymmetry (leads counted by the lead's own source,
downstream conversions by the contact's last-touch channel) — disclosed on the Attribution page and
in the design doc, not a blocker for last-touch v1.

**Owner-gated verification**: `page:crm` is `enabled=false` with a `dev_only_user_id` gate, so
`/crm/*` is invisible to any non-Moroni session — the branch preview **builds** green (same Vite
build as local), but the behind-auth screenshot of the Attribution/Overview/Reports screens vs the
handoff requires Moroni's own session (same owner-gated treatment Phase 1/2 used for
account-dependent checks). `ad_spend` is still empty pending the Google Ads token, so paid-channel
cost/ROAS cells legitimately render `—` until the first sync runs.

**Dogfooding**: phase-3 `crm_build_stages` reconciled honestly and `crm_build_phases('3')` set to
`shipped` via the status RPCs (see the close-out reconciliation in this session).

### Phase 4a — Lead pipeline

Built directly off the Phase 1 shell (its only hard dependency, per the roadmap's own escape
hatch) rather than waiting on Phase 3, which was being built in a separate, parallel session at
the same time — no file overlap: this phase owns the Leads board, the contact activity timeline,
and pipeline-stage Settings CRUD; Phase 3 owns Attribution/Overview/Reports.

**New tables** (`supabase/migrations/20260701_crm_phase4a_lead_pipeline.sql`, applied to the live
shared dev/main Supabase project):
- **`pipeline_stages`** — `id, org_id (FK crm_orgs), name, sort_order, color, is_won, is_lost,
  created_at, updated_at`. Replaces the hardcoded New/Contacted/Qualified/Estimate Sent/Won/Lost
  enum that used to live only as `inbound_leads.lead_status` text + `CrmCallLog.jsx`'s
  `STATUS_OPTIONS` array — now a real, admin-editable table. Seeded with that same six-stage
  default set for both the real org and the disposable "Utah Pros — TEST" org. RLS enabled +
  explicit `FOR ALL` policy at creation.
- **`lead_pipeline_stage`** — `id, lead_id (FK inbound_leads, UNIQUE), org_id (FK crm_orgs),
  stage_id (FK pipeline_stages), moved_by (FK employees), created_at, updated_at`. Tracks each
  lead's current stage as its own table rather than a column added to `inbound_leads` — keeps this
  phase's migration to brand-new tables only, with zero touch to a table a prior phase introduced.
  A lead with no row here reads as sitting in the first stage (lowest `sort_order`) — both the
  frontend (`src/lib/crmPipeline.js`'s `groupLeadsByStage()`) and nothing server-side enforce this;
  it's a read-time fallback, not a DB default. RLS enabled + explicit policy at creation.

**RPCs** (all `SECURITY DEFINER`, granted `anon, authenticated`):
- `get_pipeline_stages(p_org_id)` — read helper, defaults to the real org.
- `upsert_pipeline_stage(p_id, p_name, p_color, p_sort_order, p_is_won, p_is_lost, p_org_id)` — add
  (`p_id` NULL) or rename/recolor/reorder/toggle-won-lost (`p_id` set) a stage; no code change
  needed for any of that, per the roadmap's "not a hardcoded enum" requirement.
- `delete_pipeline_stage(p_stage_id)` — refuses (raises, surfaced as a toast) if any lead is still
  on that stage, so a delete can never silently orphan a `lead_pipeline_stage` row.
- `move_lead_to_stage(p_lead_id, p_stage_id, p_moved_by)` — true upsert on `lead_id`; logs a
  `crm_lead_stage_changed` `system_events` row.
- `get_contact_activity(p_contact_id)` — the unified activity timeline: `UNION ALL` across
  `inbound_leads` (calls/forms, Phase 1), `messages` joined through `conversation_participants`
  (SMS — `messages.channel` exists on the table but is never written by any current worker, so the
  SMS branch reads `messages.type`, e.g. `sms_outbound`/`sms_inbound`, which
  `functions/api/send-message.js` / `twilio-webhook.js` actually populate), `job_notes` joined
  through `contact_jobs` (notes are job-scoped, not contact-scoped, hence the join), and `estimates`
  (`contact_id` is direct). Ordered newest-first across all four sources.

**Phase 4a follow-up — manual lead entry** (`supabase/migrations/20260701_crm_manual_lead.sql`):
the Leads board originally only populated from CallRail ingestion, so with CallRail unconnected
the board was empty and untestable, and there was no way to add a walk-in/referral lead by hand.
Added a **"+ New lead"** button on `CrmLeads.jsx` (and in its empty state) opening a create panel
(name/phone/source/value), backed by a new `create_manual_lead(p_phone, p_name, p_source, p_value,
p_org_id, p_created_by)` RPC (`SECURITY DEFINER`, granted `anon, authenticated`). It matches or
creates a `contacts` row by phone (name backfilled only when blank), then inserts an `inbound_leads`
row and logs a `crm_lead_created_manual` `system_events` row. **Additive-only — no schema change**:
a manual lead has no CallRail id so the RPC synthesizes a unique `manual:<uuid>` `callrail_id` (that
column is NOT NULL + UNIQUE), and uses `source_type='form'` because the `source_type` CHECK only
allows `call`/`form` and an additive change must not alter that live constraint — the real origin
lives in the `source` column (e.g. `Referral`, `Walk-in`). Verified live against the TEST org
(create → assert one lead + one contact by phone → a second same-phone lead reuses the one contact →
cleaned up); integration test at `supabase/tests/crm_manual_lead.test.js` (committed test-first,
self-skips without live creds, same as the Phase 0/1 suites). **Phone is normalized to E.164 in
`CrmLeads.jsx`'s create panel** via `normalizePhone()` (`src/lib/phone.js`) before the RPC call —
the same canonical form CallRail ingestion and every other create-contact flow use — so a
hand-typed `(801) 555-0100` matches (never duplicates) an existing contact on the unique `phone`
column; an invalid number is rejected with a toast.

**Frontend** (`src/pages/crm/`), replacing their Phase 1 `CrmStubPage.jsx` placeholders:
- **CrmLeads.jsx** (`/crm/leads`) — a real Kanban board, reusing `Production.jsx`'s drag-and-drop
  pattern (desktop-only `draggable`, gated by the same `isTouchDevice()` check) rather than building
  one from scratch. Columns come from `get_pipeline_stages`, sorted via `sortStages()`; cards are
  every non-spam `inbound_leads` row (contact embedded), bucketed via `groupLeadsByStage()`. Header
  subtitle shows a **weighted pipeline value** (`weightedPipelineValue()` — `is_won` stages weight
  1, `is_lost` weight 0, open stages weight by position among the open stages, `(index+1)/(open+1)`
  — a deliberately simple stage-position heuristic, not a configurable probability field, since
  `pipeline_stages` has no such column). Clicking a card opens a slide-out detail panel: a stage
  `<select>` (the touch-device path for moving a lead, since drag is disabled there), lead
  metadata, and the `get_contact_activity`-backed timeline, badge-colored per activity type.
- **CrmSettings.jsx** (`/crm/settings`) — TWO sections. **(1) Tracking numbers:** lists every
  CallRail number from `get_tracking_numbers` with its call count + an editable **title** (the
  campaign it belongs to) → `set_tracking_number_label`; the Call Log shows that title in place of the
  raw number (read-only there). **(2) Pipeline-stage CRUD:** add, inline rename/recolor/
  won-lost-toggle, reorder via left/right buttons that swap `sort_order` with the neighboring stage
  (simpler and more reliable than drag-and-drop for an admin settings screen), delete via the
  inline two-click confirm pattern (`onBlur` cancels — no modal, per CLAUDE.md Rule 2), surfacing
  the server-side in-use guard as a toast if a stage still has leads on it.

**New pure-function module**: `src/lib/crmPipeline.js` — `sortStages`, `groupLeadsByStage`,
`stageWeight`, `weightedPipelineValue`. No DB access; used by both `CrmLeads.jsx` (board rendering)
and `CrmSettings.jsx` (stage ordering).

**New CSS**: `.crm-board-*` / `.crm-panel-*` / `.crm-timeline-*` / `.crm-stage-*` in `src/index.css`,
all under the existing `--crm-*` token scope (no new global tokens).

**Test-first**: `src/lib/crmPipeline.test.js` committed at `2afde90`, before `src/lib/crmPipeline.js`
existed (`bb34502`) — confirmed genuinely failing at the test-only commit (import error). Covers
stage-ordering-respects-`sort_order` (including a no-mutation check) and the weighted-pipeline-value
math against a hand calculation across open/won/lost stages, plus the null-value-contributes-zero
edge case.

**`npm run test` + `npm run build` + `npx eslint`**: all green on every changed file.

**Independent review**: `upr-pattern-checker` found zero violations. `crm-phase-reviewer` (Opus)'s
first pass raised one claimed blocker — that `get_contact_activity` referenced a non-existent
`messages.channel` column. That premise was actually wrong: `messages.channel` is a real column
(confirmed live via `information_schema.columns` and by running the RPC against a real contact),
so the RPC never threw. It's simply never populated by any current worker, so the fix applied was
a data-quality improvement rather than a crash fix — the SMS branch now reads the actually-populated
`messages.type` instead. A second reviewer pass, done skeptically (independently re-verifying
`messages.type`'s provenance via `send-message.js`/`twilio-webhook.js` rather than taking the fix on
faith), confirmed the fix and passed every acceptance criterion except this doc update itself
(now resolved by this section) — recommendation **SHIP into `dev`**.

**Dogfooding**: 3 of `phase-4a`'s 5 `crm_build_stages` rows flipped to `done` via
`set_crm_stage_status` — test-first, the Kanban+timeline+Settings-CRUD acceptance criteria, and
test/build/eslint+both review agents; `crm_build_phases('4a')` set to `shipped` (per CLAUDE.md's
"set status → update this doc — before opening the PR" order, same as Phase 2). Two stages stay
`todo`, honestly: the visual-check-vs-Stitch-handoff stage — it needs a logged-in Moroni session on
the branch's Cloudflare preview, which this sandbox doesn't have, same disclosed owner-gated
treatment Phase 1 gave its CallRail-account-dependent items, not a forgotten step — and the final
"set shipped/docs updated/pushed/PR opened" stage, which bundles the push+PR sub-step that hasn't
happened yet as of this doc edit (docs and the phase-shipped flip are done; push+PR is not) — same
split Phase 2 used, flipped once the PR is actually opened. No test rows needed cleanup this phase:
all verification queries against real (non-test-org) rows were read-only or exercised against
disposable TEST-org rows that were deleted immediately after (see the migration's own commit
message).

### Phase 4c — Email campaigns

Built **before Phase 4b** (text blasts) via an explicit, authorized reprioritization: 4b is
blocked on Twilio A2P 10DLC carrier approval (external, days-to-weeks); email runs on Resend,
already integrated, with no such dependency. The roadmap's own hard prerequisite — the CRM shell +
Phases 3/4a merged into `dev` — was confirmed live before this build started (branch diffed 0/0
against `origin/dev` at the tip carrying PR #195/#196). 4b's mention as 4c's prerequisite in
`docs/crm-roadmap.md` is the linear-chain default, not a real code/data dependency — 4c introduces
its own tables and touches nothing 4b would have added.

**New tables** (`supabase/migrations/20260701_crm_phase4c_email_campaigns.sql`, applied to the live
shared dev/main Supabase project) — deliberately NOT built on the pre-existing `campaigns`/
`campaign_recipients` tables (already live, queried by `Marketing.jsx` before this phase): those are
hard-wired for SMS — `campaigns.campaign_type` has a CHECK constraint with no `'email_blast'` value,
and `campaign_recipients.phone` is `NOT NULL` with no email column. Adding either would mean
ALTERing a live table, forbidden by this phase's additive-only rule — so email campaigns get fully
separate tables and the legacy SMS tables are left untouched for Phase 4b:
```
email_suppressions          — id, org_id (FK crm_orgs), email, reason ('unsubscribed'|'bounced'|
                               'complained'|'manual', default 'unsubscribed'), source,
                               suppressed_at, created_at. UNIQUE on lower(email) — an address is
                               suppressed regardless of casing on a later send. This is the
                               compliance-critical list every send checks.
email_campaigns              — id, org_id, name, subject, template_id (FK message_templates,
                               nullable — best-effort only, see NOTES below), body_html,
                               audience_filter jsonb, status ('draft'|'sending'|'sent'|'failed'),
                               audience_count, total_sent, total_suppressed, total_failed,
                               scheduled_at, sent_at, created_by (FK employees), created_at,
                               updated_at.
email_campaign_recipients     — id, campaign_id (FK email_campaigns, CASCADE), contact_id (FK
                               contacts, CASCADE), email, status ('pending'|'sent'|'suppressed'|
                               'failed'), resend_id, error_message, sent_at, created_at.
                               UNIQUE(campaign_id, contact_id) — the snapshotted audience for one
                               send.
```
All three RLS-enabled at creation (`FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)`),
writes via RPC only.

**RPCs** (all `SECURITY DEFINER`, granted `anon, authenticated`):
- `preview_email_audience(p_filter, p_org_id) → TABLE(contact_id, name, email)` — segmentation off
  `contacts`/`referral_sources` per the roadmap: filters on `referral_source` (matches
  `contacts.referral_source`), `role`, and a `tags` jsonb containment check. Always excludes no-email,
  `dnd`, and any suppressed address regardless of filter — non-negotiable. Deliberately does **not**
  filter on `contacts.opt_in_status` (that's the SMS/TCPA opt-in flag) — US marketing email is
  governed by CAN-SPAM, which is opt-out based, not opt-in based.
- `get_email_campaigns(p_org_id)` — read helper, defaults to the real org.
- `upsert_email_campaign(p_id, p_name, p_subject, p_template_id, p_body_html, p_audience_filter,
  p_org_id, p_created_by)` — create (`p_id` NULL) or edit a still-`draft` campaign; recomputes
  `audience_count` via `preview_email_audience` on every save.
- `delete_email_campaign(p_id)` — refuses (raises) unless the campaign is `draft`/`failed`.
- `queue_email_campaign(p_campaign_id)` — snapshots the resolved audience into
  `email_campaign_recipients` (idempotent — `ON CONFLICT DO NOTHING`), flips status to `sending`.
- `record_email_campaign_send(p_recipient_id, p_status, p_resend_id, p_error_message)` — per-recipient
  result + campaign counter rollup; auto-flips the campaign to `sent` once no `pending` recipients
  remain, so the worker never needs a separate "finalize" call.
- `email_unsubscribe(p_email, p_recipient_id, p_org_id)` — the public unsubscribe write path. Given a
  recipient id, resolves its email/marks that `email_campaign_recipients` row `suppressed`; either
  way upserts `email_suppressions` (`ON CONFLICT (lower(email)) DO UPDATE` — repeat clicks never
  error/duplicate).

**Shared send foundation** (`functions/lib/`, built now so Phase 4b can add its SMS branch
additively rather than a rewrite):
```
email-consent.js    — emailAllows({ email, suppressed, dnd }) → boolean. Pure predicate, no I/O —
                       refuses on no email, suppressed, or dnd; allows otherwise. Test-first:
                       email-consent.test.js (5 vitest units) committed at 095ab01 before this file
                       existed — confirmed genuinely failing (import error) at that commit, green
                       once the implementation landed.
automated-send.js   — sendAutomatedMessage(channel, contactId, templateKey, variables, env, extra)
                       — the generic single-send entry point Phase 4d's fixed automations will call;
                       'sms' throws (documented Phase 4b TODO), 'email' looks up the contact +
                       optional message_templates row (matched by title — that table has no
                       channel/key column, so this is a best-effort reuse of its variable-
                       substitution *pattern*, not a real integration) then calls sendGatedEmail.
                       sendGatedEmail(env, { contact, subject, html, recipientId }) is the ONE path
                       to sendEmail() for any marketing message — both sendAutomatedMessage('email')
                       and the campaign worker call it, so the suppression/consent check is
                       structurally unbypassable. It checks email_suppressions (case-insensitive
                       ilike lookup) + contact.dnd via emailAllows(), appends an unsubscribe footer
                       link, and sets List-Unsubscribe/List-Unsubscribe-Post headers (RFC 8058
                       one-click). The unsubscribe link carries `?rid=<recipient id>` when the caller
                       has one (campaign sends) so a click flips that exact recipient row, or a plain
                       `?email=` link otherwise (a future non-campaign automation send).
email.js             — sendEmail() gained an optional `headers` param (passed through to Resend's own
                       `headers` object untouched) — the only change to this pre-existing
                       transactional-only file; every other caller (esign, demo-sheet, billing-2fa,
                       water-loss-report) is unaffected since the param defaults to unset.
```

**Workers**:
```
send-email-campaign.js  — POST, authenticated (Supabase session bearer token, verified against
                           /auth/v1/user with the anon key). Queues the campaign's audience, then
                           loops recipients: re-fetches each contact's LIVE name + dnd (not the
                           queue-time snapshot — a large campaign can take a while, and dnd could
                           change mid-send) before calling sendGatedEmail, records each result via
                           record_email_campaign_send, and logs one worker_runs row. Never calls
                           sendEmail() directly — always through sendGatedEmail so the suppression
                           gate can't be bypassed. Disclosed gap: the recipient loop runs
                           synchronously in the request; a campaign large enough to risk the
                           Cloudflare Pages Function execution-time limit would need a batched/queued
                           redesign — not built this phase since no real campaign has been sent yet.
email-unsubscribe.js    — public GET/POST (no auth by design — RFC 8058 one-click unsubscribe
                           requires an unauthenticated POST to succeed), reached from the campaign
                           email footer link and List-Unsubscribe-Post. Accepts `?rid=` (preferred,
                           resolves the exact recipient + campaign) or `?email=` (fallback), calls
                           email_unsubscribe, always returns a 200 HTML confirmation page except when
                           neither param is present (400).
crm-campaign-ai-design.js — POST, authenticated (same requireAuth as send-email-campaign.js — any
                           valid logged-in session, NOT the Moroni-only gate the Homebuilding AI
                           workers use, since CRM Campaigns is a shared team feature behind
                           `page:crm`, not a personal tool). Powers the CRM Campaigns builder's
                           "✨ Design with AI" button (`RichEmailEditor.jsx`): takes a plain-English
                           instruction + the current subject/body_html, asks Claude Sonnet 5 to
                           rewrite the email's INNER content HTML only (never the outer branded shell)
                           as a polished, brand-styled design — styled headings, accent-tinted
                           callout blocks, button-style CTAs, matching the hardcoded brand colors in
                           email-template.js's wrapEmailBody. Forced tool_choice structured output
                           (`{ body_html }`) — requires explicitly setting `thinking: { type:
                           'disabled' }`, since Sonnet 5 (unlike the 4.6 the Homebuilding workers use)
                           defaults extended thinking ON when the param is omitted, and forced tool
                           calls are incompatible with thinking enabled. No new table — logs a
                           worker_runs row like every other worker.
```

**Frontend**: `src/pages/Marketing.jsx` (pre-existing page, rewritten) — a simple Email/SMS tab
switcher. SMS tab unchanged (still Phase 4b's "coming soon" stub reading the legacy `campaigns`
table). Email tab (`EmailCampaignsTab`/`EmailCampaignForm`) — campaign list with status/audience/
sent/suppressed/failed counts, a simple builder (name, subject, body with `{{name}}` substitution,
referral-source + role segmentation dropdowns), a live "Preview audience" count
(`preview_email_audience`), save-as-draft/edit/delete (two-click inline confirm, no modal), and
"Send now" (calls `POST /api/send-email-campaign` via `getAuthHeader()`, same pattern
`CrmIntegrations.jsx` uses for its worker calls). New `.marketing-*` CSS block in `src/index.css` —
plain app tokens (`--space-*`/`--text-*`), not the CRM shell's `--crm-*` scope, since this page lives
outside `/crm/*`.

**`page:marketing` flag**: gained a `dev_only_user_id` (Moroni's employee id) this phase via a data
`UPDATE` (not a schema change) so the new Email tab is previewable — `enabled` stays `false`, so
every other employee still sees nothing, unchanged from before this phase.

**Test-first**: `functions/lib/email-consent.test.js` (5 units) committed at `095ab01`, confirmed
genuinely failing (import error) before `email-consent.js` existed at `4e63d64`.

**`npm run test` (94 pass / 9 skip) + `npm run build` + `npx eslint`**: all green on every changed
file.

**Independent review**: `upr-pattern-checker` — clean, no violations (RLS + explicit policies on all
three new tables at creation, no ALTER/DROP/rename of any pre-existing table, `useAuth()`-only `db`
in `Marketing.jsx`, no `alert()`/`confirm()`, two-click inline delete confirm, no hardcoded hex in
the new CSS). `crm-phase-reviewer` (Opus, weighted on the `emailAllows` gate + unsubscribe wiring)
traced every `sendEmail()` caller and confirmed the campaign path only ever reaches it through
`sendGatedEmail`; traced the full unsubscribe loop end-to-end (footer link → RPC → suppression table
→ excluded from the next `preview_email_audience`/`sendGatedEmail` check) and confirmed it genuinely
closes; confirmed test-first ordering by running the test at its own commit (failed, as expected).
First pass returned **DO-NOT-SHIP-YET** on 3 items: (1) `{{name}}` was rendering the recipient's
*email address* — `send-email-campaign.js` was substituting `recipient.email` instead of a real
name; (2) the campaign worker's `dnd` re-check was dead (always passed `undefined`); (3) the
suppression lookup was case-sensitive while every other suppression check in the system is
case-insensitive. Fixed (`61dd57a`): the worker now re-fetches each contact's live `name`+`dnd` at
send time instead of trusting the queue-time snapshot, and `isEmailSuppressed` uses a case-insensitive
`ilike` lookup. Also fixed a related cosmetic gap the reviewer flagged (a dead `?campaign=` query
param on the unsubscribe link that the endpoint never read) by switching to `?rid=<recipient id>`,
which the `email_unsubscribe` RPC uses to actually flip that recipient's row to `suppressed`. A
narrow confirmation pass re-verified all four fixes directly against the current file contents
(not the commit message) before this doc was written. All fixes were additionally verified live via
the Supabase MCP (`execute_sql`): queued a disposable TEST-org campaign/recipient, unsubscribed via
the `rid` path, confirmed the recipient row flipped to `suppressed`, confirmed a case-insensitive
suppression match — then cleaned up every test row.

**Owner-gated, disclosed as such (not a forgotten step)**: "Send now" has never been exercised
against a real Resend send + a real inbox click on the unsubscribe link — this sandbox has no
outbound egress to Supabase/Resend from a browser session, and sending real email requires a
connected Resend domain already live in production (see `EMAIL-DELIVERABILITY.md`), not something to
trigger from this build session. The RPC-level behavior (audience resolution, queueing, per-recipient
gating, unsubscribe) is verified live per above; the actual email delivery + inbox rendering + a real
one-click unsubscribe round-trip needs a logged-in Moroni session against the branch preview. The
recipient loop's synchronous-execution-time risk at real campaign scale (see workers section above)
is also disclosed, not silently capped.
**Sending-subdomain flag (per the task's explicit ask)**: this phase sends marketing volume from the
same `restoration@utahpros.app` address `EMAIL-DELIVERABILITY.md` documents for transactional mail
(esign, invoices, 2FA). That file's own §5 already recommends a dedicated sending subdomain
(`send.utah-pros.com`) as "the highest-impact upgrade" specifically to protect a shared domain's
reputation once volume increases — marketing sends are exactly that increase. No code change is
needed to adopt it (`EMAIL_FROM`/`EMAIL_REPLY_TO` env vars, already read by `functions/lib/email.js`)
but it wasn't set up in this session (a new Resend-verified subdomain + DNS records, which needs
Moroni's access to `utah-pros.com` DNS) — flagged here rather than silently reusing the transactional
sender at real volume.

**Dogfooding**: `crm_build_stages` for `phase-4c` reconciled and `crm_build_phases('4c')` status set
via the status RPCs — see the close-out reconciliation in this session for exactly which stages
flipped to `done` vs. stayed `todo` (the owner-gated real-send/visual-check items stay open, with the
reason stated above, not silently marked done).

## Public build-status page — `/status` (Jul 1 2026, off Phase 0/1)

A logged-out, public mirror of `/crm/roadmap` — no auth, no `page:crm` flag, no CRM shell. Built so
anyone with the link (not just Moroni) can see build progress without an account. Deliberately the
**only** public CRM surface; every other `/crm/*` route stays behind `<FeatureRoute flag="page:crm">`
in `src/App.jsx`.

**Route**: `src/pages/Status.jsx`, registered as a top-level public route in `WebRoutes()`
(`src/App.jsx`, alongside `/login`/`/privacy`/`/terms`) — outside `ProtectedRoute`/`Layout` entirely,
so it renders with no employee session. Not registered in `NativeRoutes()` (iOS/Capacitor only ships
`/login` + `/tech/*`, same as `/privacy`/`/terms`).

**Data access**: calls `db.rpc('get_crm_build_progress')` using the **unauthenticated `db` singleton
imported directly from `@/lib/supabase`** — not `useAuth()`'s `db` — since the page must work with no
session (CLAUDE.md rule 3's documented carve-out for public/bootstrapping calls; same pattern
`Login.jsx` already uses for its dev-mode employee picker). No new migration was needed:
`get_crm_build_progress()` was already `GRANT EXECUTE`'d to `anon` (and `authenticated`, `PUBLIC`) in
`supabase/migrations/20260701_crm_phase0_scaffold.sql` — verified live via
`information_schema.routine_privileges` before building, not assumed. The underlying
`crm_build_phases`/`crm_build_stages` RLS policies are also `anon`-permissive, though moot since the
RPC is `SECURITY DEFINER`. The RPC only ever returns phase/stage metadata (key, title, status,
done/total counts) — no contact/lead/financial data — so nothing here needed extra redaction.

**Shared rendering**: the phase/stage card markup was extracted from `CrmRoadmap.jsx` into
`src/components/BuildProgressPhaseCard.jsx` (a plain presentational component, no data fetching) so
`/status` and `/crm/roadmap` render identically from the same code, not two hand-synced copies. CSS
is the same pre-existing `.crm-roadmap-*` block (plain app tokens, not `.crm-shell`'s `--crm-*`
tokens — this card renders outside the CRM shell). New CSS for the page's own outer shell only:
`.status-page`/`.status-page-inner` in `src/index.css`, styled after `.login-page` (dark surround,
centered column) but scrollable-width instead of a fixed-width card, since it holds a full phase
list; a `@media (max-width: 768px)` block adjusts padding only, per CLAUDE.md rule 5.

**Test-first**: `supabase/tests/crm_status_public_access.test.js` — integration test (vitest, same
`describe.skipIf(!hasCreds)` self-skip pattern as the Phase 0/1 suites) asserting
`get_crm_build_progress()` succeeds for an anon-key-only caller and returns the expected
`{ phases, overall_done, overall_total }` shape, plus a guard that the payload never contains
email/token/password-shaped strings — the regression check for "the RPC is still granted to anon."
Committed before `Status.jsx`.

**Verification this session**: `npm test`/`build`/`eslint` (changed files) all pass. Browser-verified
with Playwright — confirmed the route renders with no login redirect and the correct title/subtitle
against the real dev server, and (route-mocked, since this sandbox's network policy blocks direct
browser egress to Supabase — MCP tool calls use a different channel) confirmed the phase/stage cards
render pixel-identical to `/crm/roadmap` at both desktop and mobile (390px) widths. The anon-grant
data path itself was verified separately via direct SQL against the live `dev`/`main` shared Supabase
project (`information_schema.routine_privileges`), not through the browser.


---

## Roadmap v3 — gap audit + parallel-wave dispatch model (session 2026-07-02, docs/seed only — no feature code)

**What this session shipped** (branch `claude/new-session-vloxml` → PR into `dev`):
- `docs/crm-roadmap.md` → new **"Roadmap v3"** section (the dispatch model of record): live-DB status
  reconciliation, evidence-based gap-audit appendix (capability taxonomy A–J, verdicts only from
  code/schema, adversarially re-verified by a 10-agent challenge pass), and seven new phase blocks —
  **F (Foundation), 6a, 6b, 7, 8, 9, 10 (CRM Forms)**. The old strict-sequential rule is superseded:
  Phase F ships ALL schema/interfaces/wiring first, then 4d/6a/6b/7/8/9/10 run as ONE parallel wave
  (4b joins whenever A2P carrier approval lands). File-ownership matrix + frozen-file list will be
  committed by Phase F as `.claude/rules/crm-wave-ownership.md`.
- `supabase/migrations/20260702_crm_roadmap_v3_phases.sql` — **applied + verified live**: seeds
  phases F/6a/6b/7/8/9/10 (sort 9–15, all `planned`) + their close-out stages into
  `crm_build_phases`/`crm_build_stages` (idempotent ON CONFLICT DO NOTHING), plus one additive
  Phase 1 stage: **form-capture verification** (the CallRail form path is wired but untested at every
  layer — no `mapFormPayload` test, no form-ingestion test, payload shape guesswork).
- `.claude/agents/migration-safety-checker.md` (sonnet, read-only — additive-only/RLS/org_id/
  external-ID-upsert/backward-compatible-REPLACE/frozen-stub rules) and
  `.claude/agents/consent-path-auditor.md` (sonnet, read-only — every send call site must route
  through `sendAutomatedMessage()`/`sendGatedEmail()`; flags `skip_compliance`/direct sends in
  automation context). Both run before every wave-phase PR.
- `CLAUDE.md` → CRM Phase Workflow amended: foundation-then-parallel-wave model, zero-schema rule
  for wave sessions (function-body-only replaces of own frozen stubs), backward-compatible-REPLACE
  rule, dependency graph supersedes strict-sequential.

**Key audit findings recorded in the roadmap appendix** (full evidence there):
- **P0 (latent, exposure verified zero):** live `merge_contacts` reassigns only 14 legacy FKs before
  deleting the loser — a merge today CASCADE-deletes the loser's `lead_attribution` +
  `email_campaign_recipients` + `email_campaign_exclusions` rows and SET-NULLs their
  `inbound_leads.contact_id`. Neither it nor `get_duplicate_contacts` exists in `supabase/migrations/`
  (schema drift). **Fix ships first-thing in Phase F**; until then don't merge contacts with CRM
  activity. Merge UI already exists (`MergeModal.jsx` ×5 pages + DevTools).
- Weighted pipeline is a positional ramp (`stageWeight()` = (pos+1)/(open+1)), not probability —
  Phase 9 adds `pipeline_stages.win_probability` (F schema) with positional fallback.
- Email consent gate re-confirmed structurally unbypassable; `transcript_analysis` render confirmed.
- `system_events` audit gaps (campaign exclusions/edits/deletes, per-recipient suppression;
  duplicate empty-payload `crm_email_campaign_sent`) → Phase 6b audit hardening.
- Phase 4b remains blocked on A2P 10DLC carrier approval (external); Phase F pre-builds the
  `automated-send.js` sms branch + `consentAllows()` behind an `automation_settings.sms_sending_enabled`
  kill-switch so 4b/4d/8 never edit that file.

**Dispatch (see roadmap v3 section for the full model):** Wave 0 = Phase F (Opus·high) ∥ Phase 1
close-out (Sonnet·medium). Wave 1 (after F merges) = 4d·6a·6b·7·8·9·10 in parallel, per-phase cold
prompts generated after F commits its artifact names. Owner pre-decisions at dispatch: CallRail Form
Tracking replacement intent (forks Phase 1's form-fixture stage) and Cloudflare Turnstile site key
(Phase 10, or ships toggle-off).

---

## /masterplan skill — reusable planning recipe (session 2026-07-02, docs only)

`.claude/skills/masterplan/SKILL.md` — codifies the roadmap-v3 planning standard as a
one-line-invocable skill for ANY UPR initiative: `/masterplan <initiative>` in a fresh
session (strongest model, high effort, plan mode, "ultracode" in the message). The skill
walks the session through: live-verified state + finish-first list → evidence-only gap
audit (HAVE/PARTIAL/MISSING, exposure-checked bug findings) → ROI-ordered phase design
(options-on-record evaluations, decision forks, external hard gates) → Foundation-then-
parallel-wave restructure (frozen signatures, ownership manifest, kill-switch pre-builds,
what-resisted ledger) → mandatory adversarial challenge pass (refute-first verdicts,
disjointness proofs, counter-ordering) → present-and-wait → on go, commit the roadmap
section + idempotent tracker seeds (CRM tracker for CRM initiatives; doc checklists
otherwise — no generic tracker exists) + `docs/<slug>-dispatch.md` cold-session blocks +
any 3-plus-phase-recurring agents, ending with Wave-0 blocks. Built against a 2-agent
extraction benchmark of the roadmap-v3 artifacts and adversarially critiqued
(completeness + cold-usability, both SHIP_WITH_EDITS, findings folded in). Worked
example it points sessions at: docs/crm-roadmap.md "Roadmap v3" + docs/crm-dispatch.md.

---

## CRM Phase F — Foundation (Jul 2 2026 — shipped)

Owns 100% of the wave's schema + interfaces + wiring; downstream wave phases ship zero schema.
Migrations (all applied + verified live, additive-only, RLS + explicit policy + org_id at creation):

- `20260702_crm_phaseF_merge_contacts_safety.sql` — **P0 fix.** Captures the drifted live
  `merge_contacts` body as a migration and supersedes it: now reassigns `lead_attribution`,
  `email_campaign_recipients`, `email_campaign_exclusions` (dedupe on their `UNIQUE(campaign_id,
  contact_id)`) and `inbound_leads.contact_id` onto the survivor **before** deleting the loser.
  Signature unchanged. Proof: `supabase/tests/crm_merge_contacts_safety.test.js`. Merges are now
  CRM-history-safe.
- `20260702_crm_phaseF_wave_schema.sql` — new tables: `automation_settings` (per-org; SMS
  kill-switch `sms_sending_enabled` **default OFF** + 4 per-automation toggles; one row per org
  seeded), `crm_tasks`, `lead_stage_history` (append-only pipeline history), `crm_segments`,
  `crm_import_batches`, `crm_sequences`/`crm_sequence_steps`/`crm_sequence_enrollments`
  (`UNIQUE(sequence_id, contact_id)` → enroll idempotency), `lead_score_factors`,
  `form_definitions`/`form_definition_versions`/`form_submissions` (`public_id` +
  `submission_token` UNIQUE). New columns: `inbound_leads.lost_reason` + `.lead_score`,
  `contacts.owner_id` + `.lifecycle_status`, `pipeline_stages.win_probability` (0..1, NULL →
  positional fallback).
- `20260702_crm_phaseF_shared_rpc_replaces.sql` — the **only two** live-RPC REPLACEs of the wave:
  `move_lead_to_stage` gains `p_lost_reason DEFAULT NULL` + writes a `lead_stage_history` row per
  move (dropped 3-arg + recreated 4-arg, no overload ambiguity; shipped 4a caller still works);
  `get_contact_activity` gains email/jobs/tasks arms (same 1-arg signature + columns). Proof:
  `supabase/tests/crm_shared_rpc_compat.test.js`. **Wave phases must NOT re-REPLACE these.**
- `20260702_crm_phaseF_rpc_stubs.sql` — 30 signature-frozen stubs (SECURITY DEFINER, GRANT anon +
  authenticated, body `RAISE EXCEPTION 'not implemented (phase X)'`), one owner phase each. Exact
  signatures + ownership in `.claude/rules/crm-wave-ownership.md`. Covers 4d(2), 6a(5), 6b(3),
  7(5), 8(4), 9(8: score_lead + 7 reports), 10(3).

Consent gate (frozen after F): `functions/lib/sms-consent.js` `consentAllows({phone,opt_in_status,
dnd})` (TCPA opt-in predicate, twin of `emailAllows`) + unit tests; `functions/lib/automated-send.js`
sms branch fully built — `sendGatedSms()` gates on the `sms_sending_enabled` kill-switch (default OFF)
then `consentAllows()`, sends via `twilio.js`, audits every outcome to `sms_consent_log`
(`automated_send`/`send_blocked_disabled`/`send_blocked_dnd`/`send_blocked_no_consent`/
`send_blocked_no_phone`/`send_failed`); `sendAutomatedMessage('sms', …)` routes through it. Unit test
`functions/lib/automated-send.test.js` proves OFF→no send, ON+no-consent→no send, ON+consent→sends.
Result: 4b/4d/8 never edit `automated-send.js`; 4b's remaining scope = external A2P registration +
flag flip + `Marketing.jsx`.

Shared code + frontend: `functions/lib/phone.js` (`normalizePhone` worker twin of `src/lib/phone.js`)
+ tests; `src/components/crm/ActivityTimeline.jsx` extracted from `CrmLeads.jsx` (behavior-identical,
self-loading); `CrmOverview.jsx` renders `OverdueTasksWidget` (Phase 7) + `ForecastWidget` (Phase 9)
slot stubs; `CrmContacts.jsx` skeleton renders `ContactsDirectory`/`ContactDetail` (6a) +
`ImportExportPanel`/`MergeTool` (6b) slot stubs (all in `src/components/crm/`); `CrmConversations`/
`CrmSequences`/`CrmForms` stub pages seeded (own CrmStubPage) so App.jsx stays frozen.

Wiring (frozen in-wave): `App.jsx` routes (`/crm/contacts|conversations|sequences|forms`);
`CrmLayout.jsx` nav (13 items) + `crmIcons.jsx` (IconContacts/Conversations/Sequences/Forms);
`index.css` Contacts-skeleton CSS + 8 reserved per-phase section markers.

Ownership manifest `.claude/rules/crm-wave-ownership.md` committed (frozen-file list, per-session
owned files, exact frozen stub signatures, migration + index.css rules) — each wave session's read
scope = CLAUDE.md + its phase block + this manifest. `crm_lead_stage_changed` `system_events` payload
now also carries `from_stage_id` + `lost_reason`.

Extra consent-safety fix (from the consent-path-auditor pass): `merge_contacts` now also reconciles
the survivor's consent flags to the more-restrictive record — `dnd` OR'd, `opt_in_status` false if
EITHER opted out, opt-out audit (`dnd_at`/`opt_out_at`/`opt_out_reason`) carried forward — so a merge
can't resurrect contactability a duplicate had revoked (TCPA). Regression-tested in the merge safety
suite.

**`crm_build_stages` reconciliation (honest):** 7 stages. Flipped **done** (real, verified work):
test-first suites; acceptance (schema+stubs+consent gate+slots+wiring+manifest all built & applied
live); `npm test`/`build`/`eslint` pass; UPR-Web-Context updated; reviewer gauntlet
(migration-safety-checker fixed→clean, upr-pattern-checker clean, consent-path-auditor PASS,
crm-phase-reviewer conditional-SHIP→both conditions met). The **visual-preview** and **push/verify/PR**
tail stages are the mechanical close-out, flipped as they complete (not owner-gated, not forgotten).
Phase `F` set `shipped` at close-out per the CRM workflow (commit → set shipped → PR). **Test-runner
caveat:** the two integration suites (`crm_merge_contacts_safety`, `crm_shared_rpc_compat`) self-skip
without CI creds and cannot run from this sandbox (network egress blocks the Supabase host — only the
MCP path is allowed); their behavior was instead verified directly against the live shared DB via
Supabase MCP (rollback DO-blocks), results captured in the PR. They execute green in CI/an
allowlisted env.

## CRM Phase 6a — Contacts read & segments (Jul 2 2026 — shipped)

Wave-1 phase (ran beside 6b). **Zero schema migrations** — one function-body-only migration
`20260702_crm_phase6a_contacts_segments.sql` fills five frozen 6a stubs + backward-compat-replaces
one live RPC. Edits confined to the two owned slot files + the Phase 6a `index.css` reserved section
(all per `.claude/rules/crm-wave-ownership.md`).

**RPCs (bodies filled; signatures unchanged from Phase F stubs):**
- `get_crm_contacts(p_search, p_limit, p_offset, p_org_id) → SETOF json` — searchable, paged
  directory. Matches name/email/company (ILIKE) + phone (digits-only LIKE). Each row carries
  `total_count` (`count(*) OVER ()` over the full pre-pagination match set) so the UI pages without a
  second count query. `contacts` has no `org_id` (one global book) so `p_org_id` is accepted but does
  not scope rows.
- `get_contact_consent(p_contact_id) → json` — **unified do-not-contact read.** `do_not_contact` =
  `dnd` OR `opt_out_at IS NOT NULL` OR email in `email_suppressions` (case/space-insensitive
  `lower(btrim(...))` match). Returns `{ contact_id, do_not_contact, sms:{dnd,opted_out,opt_out_at,
  opt_out_reason}, email:{address,suppressed,reason,suppressed_at} }`. **`opt_in_status` is
  deliberately NOT used** — it defaults `false` for all 117 contacts (an un-opted-in state, not an
  opt-out), so keying DNC off it would flag the whole book. This RPC is the single source of truth for
  the badge — never re-derive from raw columns.
- `upsert_segment(p_id, p_name, p_description, p_filter, p_org_id, p_created_by) → crm_segments`,
  `get_segments(p_org_id) → SETOF crm_segments`, `delete_segment(p_segment_id) → void` — segments CRUD.
  A segment's `filter` jsonb uses the **exact shape `preview_email_audience` consumes**
  (`{ referral_source, role, tag, city, company, search }`), so a saved segment is a drop-in campaign
  audience. Org defaults to the first non-test `crm_orgs` row (same pattern as `create_manual_lead`).
- `get_duplicate_contacts()` — **backward-compatible body-replace** (same
  `RETURNS TABLE(phone_normalized text, contact_ids uuid[], names text[], count bigint)`). Now
  UNION-es email-normalized groups (`lower(btrim(email))`) onto the existing phone groups; for an email
  group the `phone_normalized` column carries the normalized email (it's the group's match key, not
  necessarily a phone). The one shipped caller (`DevTools.jsx` "Scan for Duplicates") reads the same
  columns and keeps working. **Follow-up for 6b (owns `DevTools.jsx`):** that view's `formatPhone()`
  will garble email match-keys on display (cosmetic; no error) — branch on group type there.

**Components (owned slot files rendered by the frozen `CrmContacts.jsx` skeleton):**
- `src/components/crm/ContactsDirectory.jsx` — debounced search + pagination (25/page) over
  `get_crm_contacts`; collapsible Segments panel with CRUD, inline two-click delete, and a live preview
  count per segment via `preview_email_audience(filter)`.
- `src/components/crm/ContactDetail.jsx` — read-only: contact info + tags, the unified DNC badge (red
  "Do not contact" + reason line, or green "Contactable") from `get_contact_consent`, and the shared
  `ActivityTimeline`. Owner/lifecycle setters land in 6b.

**Tests:** `supabase/tests/crm_phase6a_contacts_segments.test.js` (test-first, committed failing before
the bodies existed): consent unified-DNC read across all three sources; segment filter round-trip (saved
filter → `preview_email_audience` count matches a direct query); email-normalized dup detection.
Integration suite (self-skips without CI creds, same as sibling CRM suites) — behavior verified live via
Supabase MCP: dnd/opt-out/suppressed each read `do_not_contact=true`, clean reads `false`; directory
`total_count` correct; a saved segment matched 2 contactable of 3 tagged (the dnd one excluded); email
dup group detected. `npm test` 193 passed / 25 skipped, `npm run build` green, eslint clean on changed
files. Foundation's `merge_contacts` safety fix confirmed present + its `crm_shared_rpc_compat` /
`crm_merge_contacts_safety` suites green.

Reviewer gauntlet: migration-safety-checker **clean** (signatures frozen, zero DDL, grants present);
upr-pattern-checker **clean** (CSS token fixes applied). Isolation stays the `page:crm` flag —
`/crm/contacts` invisible to staff until 6b opens it.

## CRM Phase 6b — Ownership, CSV import, staff roles & audit hardening (Jul 2 2026 — shipped)

Wave-1 phase (ran beside 6a). **Zero schema migrations** — one function-body-only migration
`20260702_crm_phase6b_rpcs.sql` fills three frozen 6b stubs + backward-compat-replaces four live
Phase 4c email-campaign RPCs (audit hardening). Edits confined to the owned files
(`ImportExportPanel.jsx`, `MergeTool.jsx`, `Admin.jsx`, `DevTools.jsx`, `featureFlags.js`,
`CrmLayout.jsx` role-gating only) + the Phase 6b `index.css` reserved section — all per
`.claude/rules/crm-wave-ownership.md`.

**RPCs (bodies filled; signatures unchanged from Phase F stubs / Phase 4c):**
- `import_contacts(p_rows jsonb, p_org_id, p_created_by, p_filename) → crm_import_batches` — CSV import
  with **dedupe-on-import**. Each incoming row matches an existing contact on **normalized phone**
  (last-10-digits, same convention as `get_duplicate_contacts`; a phone needs ≥10 digits to be a key)
  OR **normalized email** (`lower(btrim(...))`). A match → **fill-blanks UPDATE** (`COALESCE(existing,
  incoming)` — import never clobbers a curated value); no match → INSERT. The lookup re-queries
  `contacts` per row so duplicates **within one file** collapse too. A row with neither phone nor email
  is `skipped` (recorded in the batch `errors`); a row that throws is `errored` and the loop continues
  (one bad row can't lose the file). Writes a `crm_import_batches` audit row (org-scoped —
  `contacts` itself has no `org_id`) + a `crm_contacts_imported` system_event. Supported target fields:
  name, email, phone, phone_secondary, company, role, referral_source, notes, billing_address/city/
  state/zip, lifecycle_status, owner_id, tags. `contacts.phone` has a UNIQUE constraint — the
  normalized match prevents insert collisions.
- `set_contact_owner(p_contact_id, p_owner_id, p_actor_id) → contacts` — sets/clears `owner_id`
  (NULL unassigns; a non-null owner must be a real `employees` row); emits `crm_contact_owner_set`
  with `{owner_id, previous_owner_id}`.
- `set_contact_lifecycle(p_contact_id, p_lifecycle_status, p_actor_id) → contacts` — sets/clears
  `lifecycle_status`, gated to a fixed vocabulary **`lead | prospect | customer | past_customer |
  archived`** (the column is free-text with no CHECK; this RPC is the gate). Emits
  `crm_contact_lifecycle_set` with `{lifecycle_status, previous_status}`.
- **Audit-hardening body-replaces** (signatures + behavior unchanged, add `system_events` only —
  closes the "Audit trail PARTIAL" gap): `set_campaign_exclusions` → `crm_email_campaign_exclusions_set`
  `{excluded_count, audience_count}`; `upsert_email_campaign` → `crm_email_campaign_created` /
  `crm_email_campaign_updated`; `delete_email_campaign` → `crm_email_campaign_deleted` `{name, status}`
  (name captured pre-delete). **`record_email_campaign_send`**: the `crm_email_campaign_sent` event now
  fires **exactly once** — gated on `FOUND` from the `status='sending'→'sent'` UPDATE, so a
  retried/duplicate send on an already-sent campaign no longer emits a second empty event — and carries
  a `{sent, suppressed, failed, total}` counts payload (was empty `{}`). Shipped callers
  (`src/pages/crm/CrmCampaigns.jsx`, `functions/api/send-email-campaign.js`) unchanged and still pass.

**Components:**
- `src/components/crm/ImportExportPanel.jsx` (Contacts "Import / Export" slot) — browser-side quote-aware
  CSV parse → column-mapping UI (auto-guesses target from header names) → optional default owner +
  default lifecycle stamped on all rows → `import_contacts` → created/updated/skipped/error summary +
  a "Recent imports" audit list from `crm_import_batches`. Export streams all contacts to a CSV Blob.
- `src/components/crm/MergeTool.jsx` (Contacts "Find duplicates" slot) — two tabs: **Duplicates**
  (`get_duplicate_contacts` groups → pick keeper → sequential `merge_contacts` per loser, inline
  two-click confirm) and **Owner & lifecycle** (contact search → `set_contact_owner` /
  `set_contact_lifecycle`). **Placement note:** the owner/lifecycle setters live here, not in
  `ContactDetail.jsx` — that file is Phase 6a's, frozen read-only for the wave, and the frozen
  `CrmContacts.jsx` skeleton exposes no 6b detail-slot. MergeTool (a data-quality panel) is the
  wave-compliant home; when 6a/6b later reconcile, these could move into the detail.
- `src/components/CrmLayout.jsx` (role-gating only) — **per-screen staff gating**: a CRM screen is
  visible when `isFeatureEnabled('feature:crm_<screen>')` (rollout sub-flag; absent/enabled = open) AND
  `canAccess('crm_<screen>')` (per-employee override → admin → role `nav_permissions`). Enforced in both
  the nav filter and an **Outlet route guard** (direct-URL nav can't bypass the hidden nav; shows a
  "No access" panel). Overview is always reachable (CRM home); `crm_partner` accounts keep the whole CRM
  except Integrations (unchanged). Nav keys normalize hyphens → underscores (`call-log` → `crm_call_log`).
- `src/pages/Admin.jsx` — CRM per-screen keys (`crm_leads … crm_settings`) added to the role×nav_key
  matrix (PermissionsTab) **and** the per-employee override list (PageAccessTab, new "CRM" section), so
  roles are defined per screen **before** `page:crm` opens to staff.
- `src/lib/featureFlags.js` — registers the twelve `feature:crm_*` per-screen sub-flags (default ON =
  unrestricted) so they appear in DevTools for per-screen rollout/dev-only control.
- `src/pages/DevTools.jsx` — the duplicate-scan view now shows an email match-key as-is instead of
  running it through `formatPhone` (the cosmetic 6a follow-up).

**Isolation / rollout:** still the `page:crm` flag (dev-only to Moroni). **Opening `page:crm` to staff
gates on this phase** — the per-screen roles now exist; the flag flip itself is the owner's, post-merge.

**Tests:** `crm_phase6b_import_ownership.test.js` + `crm_phase6b_audit_hardening.test.js` (test-first,
committed failing before the bodies): import dedupe (existing-phone → update not create; within-file
email collapse; unmatchable row skipped), owner/lifecycle setters + events + junk-lifecycle rejection;
all four audit events fire; campaign-sent de-duplicated with counts. Integration suite (self-skips
without CI creds) — behavior **verified live via Supabase MCP**: dedupe A=0/1/0 (1 contact for the
phone), within-file B=1/1 (1 contact for the email), skip C recorded, owner+lifecycle set with events,
junk lifecycle rejected, campaign create/update/exclusions/delete events present, sent event fires once
with `{sent:1,total:1}` on a retried call, campaign flips to `sent`. All TEST rows + audit events
cleaned. `npm test` 216 passed / 34 skipped, `npm run build` green, eslint clean on changed files
(Admin.jsx's 12 errors are pre-existing — zero added).

Reviewer gauntlet: migration-safety-checker **clean** (zero DDL, 7 signatures frozen, grants present),
consent-path-auditor **PASS** (no send call sites added; `record_email_campaign_send` change is an
audit-log fix downstream of the consent decision; send gate untouched), upr-pattern-checker **clean**
(one two-click-confirm `onBlur` nit fixed), crm-phase-reviewer **SHIP** (all money/consent/audit code
correct + backward-compatible). Note: `import_contacts` sets `owner_id` from CSV without an explicit
employee-existence check like `set_contact_owner`, but `contacts.owner_id` carries an FK to
`employees(id)` so a bad id errors that one row (caught → `error_count`), and the UI only supplies real
employee ids — low risk, FK-backstopped.

**`crm_build_stages` reconciliation (honest): 7 stages — 6 flipped `done`, 1 left `todo`.** Done:
test-first, acceptance (slots/owner/lifecycle/roles), test+build+eslint/zero-schema, reviewer gauntlet,
UPR-Web-Context updated, and set-shipped/TEST-rows-deleted/pushed/PR-opened. **Left `todo` (owner-gated,
NOT forgotten):** *"Visual: import wizard + role-gated nav on preview"* — the CRM is invisible behind
the dev-only `page:crm` flag, so on-preview visual confirmation is the owner's after the flag opens.
Build-verified here (compiles + renders); there is no `blocked` status value yet, so it stays `todo`
with this disclosure (same convention as sibling phases).

## CRM Phase 4d — Fixed automations (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`). Ships the four fixed automations as a cron worker + owner toggles.
**Zero schema migrations** — the `automation_settings` table, its RLS/policy, the SMS kill-switch
`sms_sending_enabled`, and the 4 per-automation toggle columns are all Foundation-owned; this phase
only filled two frozen RPC stub bodies and added a worker + UI.

**Worker — `functions/api/run-automations.js`** (new; `onRequest*` authenticated manual trigger +
`scheduled()` for a Cloudflare Cron Trigger; one `worker_runs` row per run). Four automations, each
individually gated by its `automation_settings` toggle:
- **speed-to-lead** (SMS) — texts a brand-new answered call / form lead within a 60-min lookup window.
- **missed-call text-back** (SMS) — texts back an unanswered inbound tracking-number call.
- **no-response follow-up** (email, **live**) — emails an open (`lead_status='new'`) lead quiet for
  3–30 days (`isStale`).
- **job-complete review request** (email, **live**) — emails a Google-review ask when a
  `job_phase_history` row lands on a `completed` phase; recipient = `jobs.primary_contact_id`.

Every send routes through `sendAutomatedMessage()` (Foundation's frozen gate) — this worker never
touches `twilio.js`/`email.js`/`send-message.js` and never passes `skip_compliance`. Each fired
trigger writes a `system_events` row whose `event_type` is the substrate a future rule engine would
subscribe to: `speed_to_lead→lead_created`, `missed_call_textback→call_missed`,
`no_response_followup→lead_stale`, `review_request→job_completed` (payload `{automation, channel,
outcome, reason}`). **Idempotency**: `alreadyFired(event_type, entity_id)` on `system_events` means a
lead/job is contacted at most once per trigger; a terminal outcome (`sent` or consent-`skipped`)
writes the row, a transient `failed` writes nothing so the next tick retries. **Consent skips are
durable** — recorded in `system_events` for every channel, plus `sms_consent_log` for SMS (via the
frozen gate). Copy prefers a `message_templates` row by title, hardcoded fallback otherwise; SMS
bodies append "Reply STOP to opt out." Review link = `env.GOOGLE_REVIEW_URL` (fallback
`https://utahpros.app`).

**SMS is dark, doubly.** The two SMS automations are skipped entirely at the worker level unless
`sms_sending_enabled` is ON (`smsLive` guard — no queries, no burned idempotency rows while dark), and
even if that guard were removed, `sendGatedSms` in the frozen `automated-send.js` independently
refuses to text while the kill-switch is OFF. Phase 4b flips `sms_sending_enabled` ON after A2P 10DLC
carrier approval — no code change needed here. Email automations run on their own toggles regardless.

**RPCs — `supabase/migrations/20260702_crm_phase4d_automation_rpcs.sql`** (function-body-only
`CREATE OR REPLACE`, signatures byte-for-byte identical to Foundation's stubs, both SECURITY DEFINER +
GRANT anon/authenticated):
- `get_automation_settings(p_org_id uuid DEFAULT NULL) → automation_settings` — resolves the org
  (`COALESCE(p_org_id, first non-test org)`), lazily creates the row, returns it.
- `set_automation_setting(p_key text, p_value boolean, p_org_id uuid DEFAULT NULL) → automation_settings`
  — whitelists `p_key` against the 5 real boolean columns before a `format('… %I …')` UPDATE (no
  arbitrary-column write), returns the updated row.
Applied + verified live: get resolves the real org, toggles flip and persist, invalid key rejected,
`sms_sending_enabled` stays OFF, the shipped `sendGatedSms` caller still succeeds.

**UI — `src/pages/crm/CrmSettings.jsx`**: an "Automations" card (loads `get_automation_settings`,
toggles via `set_automation_setting`) with 4 switches, per-automation Text/Email badge, and a banner
explaining the two SMS automations stay dark until the global SMS switch is on. Styles live in the
`CRM WAVE RESERVED — Phase 4d` marker in `src/index.css` (tokens only). Backend does the sending; this
page only flips flags.

**Tests** (`functions/api/run-automations.test.js`, committed failing first): `isStale` + the three
other trigger predicates; each automation fires the correct `system_events` type via injected fake
db + send; consent-block leaves a durable `skipped` record; a fired trigger never re-fires. Full
vitest suite 214 passed / 19 skipped; `npm run build` + `npx eslint` (3 changed source files) clean.

**Reviewer gauntlet:** migration-safety-checker PASS (no schema, signatures frozen, injection
mitigated); consent-path-auditor PASS (double kill-switch, no bypass, durable skips, frozen gate
untouched); upr-pattern-checker + crm-phase-reviewer — see the PR.

**`crm_build_stages` reconciliation (honest):** 5 stages, all flipped **done** — test-first suite,
acceptance (4 automations route through the gate + fire system_events + toggleable), test/build/eslint
+ auditor gauntlet, the Settings toggle UI, and the mechanical close-out (phase set `shipped`, this
doc updated, PR opened). No test automation rows were seeded against production data — the automation
toggles were exercised only via the `set_automation_setting`/`get_automation_settings` RPC round-trip
and reset to OFF (verified live), so there are no test rows to delete. **Live-send verification is
owner-gated:** the SMS paths cannot fire an end-to-end text until Phase 4b flips `sms_sending_enabled`
(carrier approval), and the email paths only send against a real completed job / stale real lead — so
no real message was dispatched from this session by design. `crm_build_phases('4d')` set `shipped`.

## CRM Phase 9 — Intelligence: scoring, forecasting, reports, AI digest (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`). Adds rule-based lead scoring, a weighted pipeline forecast, a fixed
report set, and a weekly AI digest. **Zero schema migrations** — every table/column it consumes
(`pipeline_stages.win_probability`, `inbound_leads.lead_score`, `lead_score_factors`,
`lead_stage_history`) is Foundation-owned; this phase only filled 8 frozen RPC stub bodies and added
UI + one worker. All displayed money math lives in the pure, unit-tested JS layer — the RPCs return
raw counts only (the Phase 3 convention).

**Money/decision math — `src/lib/crmPipeline.js` + `src/lib/attribution.js` (+ tests, test-first):**
- `stageWeight(stage, sortedStages)` now **prefers `pipeline_stages.win_probability` (0..1)** and falls
  back to the existing positional ramp when it is null/undefined/out-of-range; `is_won`→1 / `is_lost`→0
  stay terminal. `get_pipeline_stages` already returns the column. The Leads board's
  `weightedPipelineValue` inherits this automatically (same tested function).
- `classifyLeadChannel` / `scoreLeadFactors` / `scoreLead` — deterministic, **no ML**. Five factors,
  clamped 0..100: source (channel via crm_channel_for_source buckets), engagement (answered-call
  duration / form / missed), speed-to-first-touch (minutes), transcript sentiment, transcript
  urgency-topic keywords. Spam hard-zeros to a single factor. The SQL `score_lead` mirrors this exact
  point table.
- `attribution.js` gains `deriveConversionTrend`, `deriveLeaderboard`, `speedToLeadSummary`,
  `ltvSummary` — all with the same div-by-zero-guard / "real 0 ≠ —" conventions as the Phase 3 helpers.

**RPCs — `supabase/migrations/20260702_crm_phase9_intelligence_rpcs.sql`** (function-body-only
`CREATE OR REPLACE`, signatures byte-for-byte identical to Foundation's stubs; SECURITY DEFINER +
GRANT anon/authenticated; applied + verified live):
- `score_lead(p_lead_id) → integer` — mirrors the JS rule table; persists a 5-row breakdown to
  `lead_score_factors` + the clamped total to `inbound_leads.lead_score`; writes a `crm_lead_scored`
  `system_events` row. Speed-to-first-touch: answered inbound call = 0 min, else earliest outbound
  staff message after the lead (defensive, NULL on any lookup issue).
- `get_conversion_trend` (monthly leads→estimates→won→revenue), `get_estimator_leaderboard`
  (per `jobs.estimator`), `get_call_volume` (daily answered/missed), `get_speed_to_lead`
  (creation→first-move buckets, `within_sla` flag on ≤5-min), `get_estimate_aging` (submitted-not-
  converted by age), `get_pipeline_movement` (per-stage in/out/net), `get_contact_ltv` (top-25 or one
  contact by won-job revenue). All return `SETOF json` raw counts. Live parity check: a real
  answered-call lead scored **31**, matching the JS `scoreLead`.
- **History-backed honesty:** `get_speed_to_lead` + `get_pipeline_movement` carry a `data_since`
  (earliest `lead_stage_history.moved_at`) so the UI renders "Since <date>" — the log only accrues
  from Foundation's `move_lead_to_stage` replace onward, never implying older history.

**UI:**
- `src/components/crm/ForecastWidget.jsx` — fills the Overview slot: weighted-pipeline-forecast
  headline + per-open-stage breakdown (win % from `stageWeight`). Fails quiet (non-critical card).
- `src/pages/crm/CrmReports.jsx` — the full report set (conversion trend, estimator leaderboard,
  speed-to-lead SLA with since-caption, call volume, estimate aging, pipeline movement with
  since-caption, top-customer LTV) alongside the existing Source ROI / division / funnel cards. CSS in
  the `CRM WAVE RESERVED — Phase 9` marker (tokens only; one `@media (max-width:768px)` rule).

**Worker — `functions/api/weekly-crm-digest.js`** (new; `onRequest*` authenticated manual trigger +
`scheduled()` for a weekly Cloudflare Cron Trigger; one `worker_runs` row per run). Gathers 7-day
pipeline movement (RPC), stale open leads, and week-over-week ad-spend anomalies (±40%, div-by-zero
guarded); Claude (`claude-sonnet-5`) **summarizes only the numbers we computed** (deterministic
fallback digest when `ANTHROPIC_API_KEY` is absent); sends via `sendGatedEmail` (**import-only** from
the frozen `automated-send.js` — never `sendEmail`/twilio directly, no `skip_compliance`). Recipients
resolve `env.CRM_DIGEST_RECIPIENTS` → `env.OWNER_EMAIL` → the `crm_digest_recipients` row in
`integration_config` (comma-separated); with none set the worker still runs and sends nothing. Pure
helpers (`parseRecipients`, `spendAnomalies`, `isStaleLead`, `buildFallbackDigest`) unit-tested.

**Scheduling — Supabase pg_cron + pg_net (live, no Cloudflare dashboard needed).** The worker's HTTP
trigger authenticates EITHER a logged-in employee (manual UI) OR an `x-webhook-secret` header matching
`integration_config.crm_digest_secret` — the CallRail/Encircle webhook-secret pattern (the `scheduled()`
Cloudflare-cron export still works too, if ever configured). A weekly `pg_cron` job **`weekly-crm-digest`**
(jobid 3, `7 14 * * 1` = Mon 14:07 UTC ≈ 8am Denver) `net.http_post`s `https://utahpros.app/api/weekly-crm-digest`
with that secret header. Secret + recipient list live in `integration_config`
(`crm_digest_secret`, `crm_digest_recipients` = `moroni.s@utah-pros.com` initially — widen by updating
that row, no deploy). **Activates once this worker is deployed to production** (the endpoint 404s until
then, harmless). To change: `UPDATE integration_config SET value=… WHERE key='crm_digest_recipients';`
to add recipients; `SELECT cron.unschedule('weekly-crm-digest');` to stop it.

**AI reply suggestions — `src/components/crm/AiReplySuggestions.jsx`** (new): standalone, **draft-only**
(no send path — a human sends). Contextual template drafts with an injectable async `generate` prop for
a future AI endpoint. **NOT wired** — Phase 7 (`CrmConversations.jsx`) had not merged into `dev` at
ship time, and the dispatch forbids editing an unmerged phase's file, so the one-line wiring
(`<AiReplySuggestions context={…} onUseDraft={setComposerText} />`) is a documented **follow-up**.

**Tests** (committed failing first): `crmPipeline.test.js` (win_probability preference + positional
fallback, score_lead rule fixtures, spam/clamp), `attribution.test.js` (report helpers with guards),
`weekly-crm-digest.test.js` (13 pure-helper tests), `supabase/tests/crm_phase9_intelligence.test.js`
(self-skipping integration: SQL `score_lead` == JS `scoreLead` parity + report row shapes). Full vitest
254 passed / 32 skipped; `npm run build` + `npx eslint` (all changed files) clean.

**Reviewer gauntlet:** consent-path-auditor PASS (digest routes only through `sendGatedEmail`, no
bypass; AiReplySuggestions has no send path). migration-safety-checker / upr-pattern-checker /
crm-phase-reviewer — see the PR.

**`crm_build_stages` reconciliation (honest):** stages 0–3, 5, 6 flipped **done** (test-first suite;
acceptance — report set + forecast widget + digest + draft-only AI replies; test/build/eslint; auditor
gauntlet; doc update; mechanical close-out). The **Visual stage (4)** — "Reports set + forecast widget
on preview" — stays **todo**: `/crm/*` is invisible behind the `page:crm` flag (owner-gated, Phase 6b),
so a branch-preview screenshot can't be produced this session; the build/lint pass and live RPC
verification stand in until the owner opens the flag. `crm_build_phases('9')` set `shipped`.
## CRM Phase 8 — Drip / nurture sequences (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`, consent-critical). **Zero schema migrations** — one function-body-only
migration `20260702_crm_phase8_sequences.sql` fills the four frozen Phase 8 stubs; the
`crm_sequences` / `crm_sequence_steps` / `crm_sequence_enrollments` tables + their RLS/policies and the
`UNIQUE(sequence_id, contact_id)` idempotency constraint are all Foundation-owned. Edits confined to the
two owned files (`CrmSequences.jsx`, `functions/api/process-sequences.js`) + the Phase 8 `index.css`
reserved section (per `.claude/rules/crm-wave-ownership.md`).

**RPCs (bodies filled; signatures byte-for-byte identical to Phase F stubs; all SECURITY DEFINER + GRANT
anon/authenticated):**
- `upsert_sequence(p_id, p_name, p_description, p_status, p_steps jsonb, p_org_id, p_created_by) →
  crm_sequences` — create or edit. **`p_steps` semantics:** a jsonb array (incl. `[]`) REPLACES the step
  set; **`NULL` leaves steps untouched** (used by status-only edits — pause/activate/archive). Default is
  `'[]'` (frozen), so a status-only caller must pass `p_steps => null` explicitly. Steps are renumbered
  to a contiguous 0-based `step_order` (respecting any provided order, then array position) so
  `UNIQUE(sequence_id, step_order)` can never be violated by caller input.
- `get_sequences(p_org_id) → SETOF json` — one object per sequence with ordered `steps`, aggregate
  `stats` (`active/paused/completed/exited/total`), and an `enrollments` roster (contact name/phone,
  status, `current_step`, `next_run_at`, `exit_reason`) capped at 200 rows.
- `delete_sequence(p_sequence_id) → void` — FK `ON DELETE CASCADE` takes steps + enrollments.
- `enroll_in_sequence(p_sequence_id, p_contact_id, p_segment_id, p_org_id) → SETOF
  crm_sequence_enrollments` — enroll a single contact OR a whole segment. **Idempotent** via
  `ON CONFLICT (sequence_id, contact_id) DO NOTHING` — re-enrolling returns the existing row, never a
  duplicate. `next_run_at` scheduled from the first step's `delay_hours` (`now() + make_interval`), NULL
  when the sequence has no steps. Segment resolver mirrors `preview_email_audience`'s filter keys
  (`referral_source`/`role`/`tag`) but **omits the email-only / consent constraints** — a sequence can
  carry SMS steps, and consent is enforced per-step at send time, not at enroll (enrollment is not a
  send).

**Worker — `functions/api/process-sequences.js`** (new; `onRequest*` authenticated manual trigger +
`scheduled()` for a Cloudflare Cron Trigger; one `worker_runs` row per run). Advances every active
sequence's due enrollments (`status='active' AND next_run_at <= now`, sequence `status='active'`):
1. **Exit check first** (before spending a send): `exit_on_reply` fires on an inbound `messages`
   (`type='sms_inbound'`, `sender_contact_id`) since `enrolled_at`; `exit_on_conversion` fires on a
   `crm_lead_promoted` `system_events` row (`payload->>contact_id`) since `enrolled_at`. On exit →
   `status='exited'` + `exit_reason` + a `crm_sequence_exited` event.
2. **Send** the current step through `sendAutomatedMessage()` (Foundation's frozen gate — email `subject`
   /`html`, SMS `orgId`/`body`). Never touches `twilio.js`/`email.js`/`send-message.js`, never passes
   `skip_compliance`.
3. **Outcome plan** (`planStepOutcome`, pure/unit-tested): `sent` → advance to next step scheduled by
   ITS `delay_hours`, or complete after the last step; **`held`** → an SMS returned
   `{skipped, reason:'sms_disabled'}` because the kill-switch is OFF, so the step is **NOT advanced** —
   `next_run_at` pushed `HOLD_RETRY_HOURS` (6h) forward so it sends the moment Phase 4b flips
   `sms_sending_enabled` (never bypassed); `skipped` → a durable consent skip (dnd/suppressed/no address)
   advances past the step (don't pester); `retry` → transient failure, untouched, retried next run. Each
   terminal outcome writes a `crm_sequence_step_{sent,held,skipped}` `system_events` row
   (`{step_order, channel, reason}`); SMS additionally logs `sms_consent_log` inside the frozen gate.

**Timing:** `delay_hours → next_run_at` is a fixed-hour UTC epoch offset (`computeNextRunAt`) —
timezone-invariant, so a "48h later" step lands 48h later across a DST change. `date-mt.js` (a
day-boundary/MT-calendar helper) does **not** apply to fixed-hour delays; same reasoning
`run-automations.js` documents for its lookback windows. The roadmap's "MT helpers" wording refers to
the shared time-convention rule, not a literal day-math import here.

**UI — `src/pages/crm/CrmSequences.jsx`** (fills the Phase F "Coming in Phase 8" stub): master/detail —
sequence list (name, status badge, step/enrollment counts) + a builder (ordered steps: channel
email/sms, `delay_hours`, subject [email]/body, move up/down, add/remove), status lifecycle
(draft/active/paused/archived via the status-only edit that preserves steps), inline two-click delete,
enroll a `crm_segments` segment (dropdown from `get_segments`), and a per-sequence enrollment roster +
stats. SMS steps are labeled "held until the SMS switch is on (Phase 4b)" in the editor. `useAuth()` db;
`upr:toast` feedback; CSS lives only in the `CRM WAVE RESERVED — Phase 8` `index.css` marker (tokens
only; mobile stacks to one column).

**Tests** (committed failing first): `functions/api/process-sequences.test.js` (20 pure unit tests —
`computeNextRunAt`/`firstRunAt`/`advanceEnrollment` timing, `classifyEvent`/`evaluateExit` reply &
conversion rules, and `planStepOutcome`'s sent/held/skipped/retry with the SMS-held-not-advanced
assertion). `supabase/tests/crm_phase8_sequences.test.js` (integration; self-skips without CI creds like
sibling CRM suites): sequence CRUD + ordered read-back, status-only edit preserves steps, enrollment
idempotency, segment enroll (matching contacts only), cascade delete. Behavior **live-verified via
Supabase MCP**: steps stored + renumbered `{0,1,2}` from input `{5,2,9}`, status-only edit kept 3 steps,
idempotent enroll = 1, segment enrolled 2 of 3 (non-match excluded), `get_sequences` shape correct,
delete cascaded to 0/0. `npm test` 236 passed / 30 skipped; `npm run build` green; `npx eslint` clean on
changed files.

**Reviewer gauntlet:** migration-safety-checker **PASS** (signatures frozen, zero DDL, grants present);
upr-pattern-checker **PASS** (useAuth/toast/two-click/tokens, index.css inside marker); consent-path-
auditor **PASS** (every send funnels through `sendAutomatedMessage`; SMS held+retried, never
force-sent/bypassed; durable audit on both channels; enrollment is not a send); crm-phase-reviewer —
see the PR. SMS stays dark behind the F kill-switch until Phase 4b (carrier approval).

**`crm_build_stages` reconciliation (honest, mapped to the 8 seeded stages by sort order):**
- **[0] Test-first** — `done` (suite committed failing first, now green).
- **[1] Acceptance: CRUD + segment enrollment + pause/stop; `process-sequences` cron w/ `worker_runs`;
  email live / SMS held** — `done` (live-verified via MCP; segment→enroll proven at the RPC layer with
  6a's `upsert_segment`/`get_segments` feeding `enroll_in_sequence`).
- **[2] Segment-UI→enroll E2E verification tail after 6a merges (disclosed)** — **`todo`
  (deploy/flag-gated).** 6a has merged and the segment→enroll **data path is verified at the RPC
  boundary**, but the literal **browser** click-through (make a segment in 6a's Contacts UI → enroll it
  via the Sequences UI in a running app) needs a Cloudflare preview with `page:crm` opened, which isn't
  runnable from this session — left open honestly, not forgotten.
- **[3] test+build+eslint pass; zero schema migrations; `automated-send.js` import-only** — `done`.
- **[4] migration-safety + upr-pattern + consent-path auditors clean; crm-phase-reviewer sign-off** —
  `done` (three auditors PASS; crm-phase-reviewer result in the PR).
- **[5] Visual: sequence builder + enrollment list on preview** — **`todo` (deploy-gated)** — same
  Cloudflare-preview + `page:crm` requirement as [2]; the UI builds clean but a preview screenshot can't
  be produced here.
- **[6] `UPR-Web-Context.md` updated** — `done` (this entry).
- **[7] Set phase 8 shipped; delete test sequences/enrollments; pushed, verified, PR opened** — `done`
  (no test rows remain — SQL smoke tests self-cleaned or rolled back via `RAISE`, verified 0
  `zz8%`/`smoke%` rows; `crm_build_phases('8')` set `shipped`; PR opened as the handoff).

There is no `blocked` status value yet, so [2] and [5] stay `todo` with the disclosure above — both are
owner/deploy-gated (the `page:crm` flag keeps `/crm/*` invisible until Phase 6b opens it), not skipped
work.
## CRM Phase 7 — Daily driver: tasks, timeline, comms in shell (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`). The daily-driver surface: a real Tasks page, an Overview overdue-tasks
widget, win/loss capture + stage-age on Leads, click-to-call logging, and the existing Conversations
inbox embedded in the CRM shell. **Zero schema migrations** — `crm_tasks`, `lead_stage_history`,
`inbound_leads.lost_reason`, and `pipeline_stages.is_lost/is_won` are all Foundation-owned; this phase
filled five frozen RPC stub bodies and edited only its four owned files + the Phase 7 `index.css`
reserved section (per `.claude/rules/crm-wave-ownership.md`). App.jsx / CrmLayout.jsx / crmIcons.jsx
untouched (routes/nav/icons were pre-wired by Foundation).

**RPCs — `supabase/migrations/20260702_crm_phase7_task_rpcs.sql`** (function-body-only `CREATE OR
REPLACE`, signatures byte-for-byte identical to Foundation's stubs; all SECURITY DEFINER + GRANT
anon/authenticated). **Task status domain is `'open' | 'done'`** (the `crm_tasks_status_check`
constraint — NOT `'completed'`; the whole phase uses `'done'`):
- `get_crm_tasks(p_assignee, p_status, p_contact_id, p_lead_id, p_org_id) → SETOF json` — filtered
  list; LEFT JOINs `employees` (assignee_name) + `contacts` (contact_name). Order: open before done,
  then `due_at` asc NULLS LAST, then newest.
- `upsert_crm_task(p_id, p_title, p_notes, p_due_at, p_remind_at, p_assignee_id, p_contact_id,
  p_lead_id, p_org_id, p_created_by) → crm_tasks` — create (p_id NULL) or edit. Title required
  (trim-checked). Org defaults to the first non-test `crm_orgs` row (same pattern as
  `create_manual_lead`). **On edit it replaces every editable field with the passed value**, so the
  editor always submits full form state; writes a `crm_task_created` `system_events` row on insert.
- `set_task_status(p_task_id, p_status, p_actor_id) → crm_tasks` — validates `open|done`; sets
  `completed_at=now()` on done / NULL on reopen; writes a `crm_task_status_changed` event.
- `delete_crm_task(p_task_id) → void`.
- `get_overdue_tasks(p_assignee, p_org_id, p_now timestamptz DEFAULT now()) → SETOF json` — open tasks
  whose **Mountain-Time due DATE is a prior Denver day**: `(due_at AT TIME ZONE 'America/Denver')::date
  < (p_now AT TIME ZONE 'America/Denver')::date`. This is the SQL mirror of `functions/lib/date-mt.js`
  `isStale(due, now, 1)` — a task due earlier *today* in Denver is NOT overdue (UTC storage, MT day
  boundary). Verified live: prior-MT-day task overdue=true, earlier-same-MT-day task overdue=false.

**Components (owned files):**
- `src/pages/crm/CrmTasks.jsx` — real Tasks page: Open/Done tabs + assignee filter (Everyone/Mine/per
  employee); rows with a check toggle (complete/reopen), title/notes, due chip (red **Overdue** when
  past its MT day via the shared `isTaskOverdue`), assignee + contact/lead chips, and inline two-click
  delete. Editor panel: title (required), notes, due + reminder (`datetime-local` ↔ ISO), assignee
  select, and a small typeahead (`EntitySearch`) to link a contact (contacts search) or a lead
  (inbound_leads search). All CRUD via the RPCs above.
- `src/components/crm/OverdueTasksWidget.jsx` — Overview card from `get_overdue_tasks`; **hidden when
  nothing is overdue** (keeps the Overview clean, honoring Foundation's "renders nothing" slot
  contract). Exports `isTaskOverdue(dueAt, now)` (the MT-day mirror; imported by CrmTasks + unit-tested).
- `src/pages/crm/CrmLeads.jsx` — three additions: (1) **required win/loss reason** — dragging or
  `<select>`-moving a lead into an `is_lost` stage opens `LostReasonPrompt`; the reason is required
  client-side (`lostReasonError`, exported + unit-tested) and passed as `p_lost_reason` to
  `move_lead_to_stage` (the RPC keeps it optional — Foundation's `crm_shared_rpc_compat` backward-compat
  test stays green). (2) **stage-age badges** — "Nd in stage" from `lead_pipeline_stage.updated_at`
  (now selected in the load), red `.stale` at ≥7 days. (3) **click-to-call** — the lead's number is a
  `tel:` link that fire-and-forget inserts a `crm_click_to_call` `system_events` row (never blocks the
  dial).
- `src/pages/crm/CrmConversations.jsx` — thin wrapper rendering the existing `src/pages/Conversations`
  inbox inside the CRM shell. **No new send path** — outbound SMS still goes through the existing
  `/api/send-message` worker (call-only, DND/opt-in enforced there); `send-message.js` / `twilio.js` /
  `automated-send.js` untouched; `skip_compliance` never used.

**Tests** (committed failing first): `src/components/crm/overdueTasks.test.js` (MT-day boundary via
`isTaskOverdue` — prior day overdue, earlier-same-day not, UTC-midnight-not-MT-midnight not, null never);
`src/pages/crm/crmLeads.lostReason.test.js` (`lostReasonError`: required on lost, accepted with reason,
never on non-lost — both mock `@/contexts/AuthContext` so importing the component in the node test env
doesn't pull in the realtime client); `supabase/tests/crm_phase7_tasks.test.js` (integration, self-skips
without creds like sibling suites: title required, upsert→get shape, done/reopen `completed_at`, and the
MT-day overdue predicate). Full vitest 225 passed / 29 skipped; `npm run build` green; `npx eslint` clean
on changed files (the two non-component helper exports carry a targeted `react-refresh/only-export-
components` disable — ownership forbids a new shared `src/lib` file, so the helpers live in their owned
component files).

**Reviewer gauntlet:** migration-safety-checker **PASS** (zero DDL, five signatures byte-for-byte frozen,
grants + SECURITY DEFINER present); upr-pattern-checker / consent-path-auditor / crm-phase-reviewer — see
the PR. Isolation stays the `page:crm` flag (opening to staff gates on Phase 6b).

**`crm_build_stages` reconciliation (honest):** stages 0–3, 5, 6 flipped **done** — test-first suite,
acceptance (Tasks/overdue widget/win-loss+stage-age/Conversations/click-to-call), test+build+eslint +
zero-schema, the auditor gauntlet, this doc, and the mechanical close-out. **Stage 4 ("Visual: … on
preview") stays `todo` on purpose** — a preview deploy only exists after the branch is pushed, so the
Tasks/Conversations/Overview-widget/lost-reason visual pass happens on the Cloudflare preview URL at
review time, not from this headless session. No test task rows remain (the live smoke was rolled back;
the integration suite self-cleans; `crm_tasks` verified empty of `smoke/v/phase7-` rows).
`crm_build_phases('7')` set `shipped`.

## CRM Phase 10 — CRM Forms: embeddable lead capture (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`). Ships a first-party embeddable lead-capture form builder — the
public-endpoint + consent + XSS-weighted phase. **Zero schema migrations** — the
`form_definitions` / `form_definition_versions` / `form_submissions` tables (public_id UNIQUE,
submission_token UNIQUE, immutable published version snapshots) are all Foundation-owned; this phase
only filled three frozen RPC stub bodies and added a shared lib + worker + hosted page + embed
snippet + builder UI.

**Shared lib — `functions/lib/forms.js`** (new; pure, browser+worker-safe, unit-tested in
`forms.test.js`): `sanitizeLinkMarkup` (HTML-escapes everything, then converts ONLY `[text](url)`
with an http(s)/mailto url into an `<a rel="noopener noreferrer nofollow">` — javascript:/data:/
relative urls stay inert text; this is the sole link path, used by both the builder preview and the
hosted page), `validateSubmission(schema,data)` (required + per-type checks), `checkSpam` (honeypot +
min-fill-time), `consentValue`. This is the load-bearing XSS defense.

**RPCs — `supabase/migrations/20260702_crm_phase10_form_rpcs.sql`** (function-body-only
`CREATE OR REPLACE`, signatures byte-for-byte identical to Foundation's stubs, all SECURITY DEFINER +
GRANT anon/authenticated):
- `upsert_form(p_id, p_name, p_schema, p_theme, p_status, p_publish, p_turnstile_enabled, p_org_id,
  p_created_by) → form_definitions` — create/edit a form; generates a unique `public_id`; editing
  always writes a working DRAFT version and **publishing never mutates an already-published version
  row** (the next edit opens a fresh draft one version above it → every published snapshot stays
  immutable/revertable). Treats empty `{}` theme / read-only calls as no-ops so metadata isn't wiped.
- `get_forms(p_org_id) → SETOF json` — one json per non-archived form with published + draft schema,
  `submission_count`, and the most recent (≤200) submissions inline, so the builder's submissions
  view needs no extra RPC.
- `upsert_lead_from_form(p_form_id, p_submission_token, p_data, p_utm, p_consent, p_ip, p_user_agent,
  p_org_id) → inbound_leads` — **idempotent on `callrail_id = 'form:' || submission_token`** (the
  `create_manual_lead` `'manual:'` precedent); requires a published form; finds/creates the contact by
  SQL-normalized phone (mirrors `src/lib/phone.js`); logs `inbound_leads` (`source_type='form'`,
  source/medium/campaign from UTM); attributes via `upsert_lead_attribution` + `crm_channel_for_source`;
  writes `form_submissions`; **on consent → an `sms_consent_log` `opt_in` row (IP + form public_id +
  consent-text version) and sets `contacts.opt_in_status/opt_in_source='web_form'/opt_in_at`** (no
  opt-in written when consent is false); fires `system_events` `crm_lead_created` (so speed-to-lead
  triggers on form leads) + `crm_form_submitted`. Verified live on `dev` end-to-end (create → publish →
  edit-immutable → get_forms → submit → idempotent redelivery → consent / no-consent asserts), then
  all test rows deleted.

**Worker — `functions/api/form-submit.js`** (new; public `POST /api/form-submit`): permissive CORS
`*` on purpose (embeddable, credential-free, RPC-gated); spam gate = honeypot + min-fill-time +
per-IP rate limit (`form_submissions` in a 10-min window) + optional **per-form** Cloudflare Turnstile
(`form.turnstile_enabled`; if enabled but no `TURNSTILE_SECRET_KEY` yet, the check is skipped so forms
work before the site key exists); server-side `validateSubmission` against the PUBLISHED version;
computes consent server-side from the submitted data; calls `upsert_lead_from_form`; logs a
`worker_runs` row. Spam-dropped submissions return `200 {ok:true}` (a bot can't tell it was filtered).

**Hosted page — `functions/f/[public_id].js`** (new; `GET /f/:public_id`): standalone HTML (not the
SPA) rendered from the published schema; every field label/option/value escaped, labels/description/
thank-you via `sanitizeLinkMarkup`; sets `Content-Security-Policy: frame-ancestors *` and never
`X-Frame-Options`, so it embeds on any customer site; posts JSON to `/api/form-submit`; reads the
UTM/gclid/fbclid/referrer/landing that `embed.js` forwarded onto its URL into hidden attribution;
`postMessage` auto-resize; Turnstile widget only when enabled AND `TURNSTILE_SITE_KEY` is set.

**Embed — `public/embed.js`** (new static asset, served at `/embed.js`):
`<script src="…/embed.js" data-upr-form="PUBLIC_ID" async></script>` injects an `<iframe>` to
`/f/<public_id>` and forwards the **parent page's** UTM/gclid/fbclid + `document.referrer` +
landing URL into the iframe URL; origin derived from the script's own `src` (works dev+prod);
height messages trusted only from the form origin AND the exact iframe window (`event.source`).

**UI — `src/pages/crm/CrmForms.jsx`**: structured builder (NOT drag-drop — up/down reorder): 9 field
types (text/email/phone/textarea/select/radio/checkbox/date/**consent**), required toggles, options
editor, theme colors, restricted `[text](url)` markup in labels/description/thank-you, a **live
preview** rendering labels through the same `sanitizeLinkMarkup`, Save-draft vs Publish (two-click
confirm), copy-embed snippet (+ direct `/f/<id>` link), and a per-form **submissions** tab. Styles
live in the `CRM WAVE RESERVED — Phase 10` marker in `src/index.css` (tokens only); the hosted page's
own inline theme colors are intentional (standalone non-SPA). `page:crm`-gated like the rest of the shell.

**Optional Webflow adapter:** not built — the first-party form + embed covers WordPress/any site and
captures gclid/fbclid + writes `sms_consent_log`, which the Webflow-webhook path can't. Left as the
roadmap's documented optional stage.

**Ownership:** touched only Phase-10-assigned files (`CrmForms.jsx`, `functions/f/[public_id].js`,
`functions/api/form-submit.js`, `public/embed.js`) + the new shared `functions/lib/forms.js`
(Phase-10-owned, imports nothing frozen) + the three own frozen RPC stubs + the Phase 10 index.css
marker. No frozen file edited; no schema added.

**Tests / gauntlet:** `forms.test.js` (sanitizer XSS, validation, spam) + `crm_phase10_forms.test.js`
(publish immutability, get_forms, idempotency + consent-write) committed failing first. Full vitest
314 passed / 57 skipped; `npm run build` + `npx eslint` (changed files) clean. Integration suite
self-skips in CI (no creds, like every CRM suite) — the RPCs were instead verified live via SQL
assertions on `dev`. migration-safety-checker PASS; upr/consent/phase reviewers — see the PR.

**`crm_build_stages` reconciliation (honest):** 7 stages. Flipped **done**: test-first suite;
acceptance (builder + hosted form + embed + submissions→inbound_leads + attribution + events);
test/build/eslint + zero-schema; the auditor gauntlet; UPR-Web-Context update; and the mechanical
close-out. Left **todo** and disclosed: **"Visual: builder + live embedded form on a test page"** is
owner-gated — it needs the Cloudflare branch preview (a headless session can't render the iframe on an
external test page); the code is complete and unit/flow-verified. `crm_build_phases('10')` set `shipped`.

## CRM post-wave follow-ups (Jul 2 2026)

Small fixes committed straight to `dev` after the wave landed, from the #247–250 merge-readiness
review. All are behind `page:crm` (or dark behind the SMS kill-switch), so none is staff-visible yet.

- **ForecastWidget headline fix** (`src/components/crm/ForecastWidget.jsx`) — the "expected value of
  open leads" headline now sums only OPEN stages. It previously used `weightedPipelineValue().total`,
  which folds won-stage leads in at weight 1 (realized revenue) — inflating the number and making it
  disagree with the per-stage rows. `crmPipeline.weightedPipelineValue` is unchanged (Phase 9 tests
  stay green).
- **TCPA quiet-hours (SMS Gate 3)** — `functions/lib/automated-send.js` `sendGatedSms` now blocks
  automated SMS outside 8am–9pm in the recipient's local time via `isWithinQuietHours()` (tz-aware,
  DST-safe, unit-tested), returning `{ skipped:true, reason:'quiet_hours' }`. `process-sequences.js`
  HOLDS + retries that outcome (never drops it), same as the kill-switch hold. SMS-only (email/CAN-SPAM
  exempt); still behind `sms_sending_enabled`, so zero live impact until Phase 4b. Recipient tz defaults
  to `America/Denver` (`env.SMS_QUIET_HOURS_TZ` override) — per-recipient/area-code tz and
  `run-automations.js` held-retry remain for 4b (tracked in `docs/crm-roadmap.md` Phase 4b).
- **AiReplySuggestions wired into Conversations** — the shared `src/pages/Conversations.jsx` gained an
  OPTIONAL `replyAssist(context, insertDraft)` render-prop (the main app passes nothing → inert there;
  `src/pages/crm/CrmConversations.jsx` passes `AiReplySuggestions`). `insertDraft` fills the composer via
  the same DOM+state path as a template insert — draft-only, no send path added. Closes the Phase 9
  deferred follow-up.

---

## Feedback Media — plan of record (session 2026-07-02, docs only — no feature code)

**What this session shipped** (branch `claude/chat-session-og9agt` → PR into `dev`):
- `docs/feedback-media-roadmap.md` — the dispatch model of record for upgrading the feedback
  surface (photos + **video** attachments for everyone incl. a new desktop `/feedback` page,
  client-side **image** compression, video caps, 90-day attachment purge, admin inbox rebuilt with
  video player/lightbox, notify-on-submit). Live-verified gap audit (taxonomy A–G), 5 findings,
  three phase blocks (**F → B ∥ C**, disjointness adversarially proven), dependency graph,
  ownership matrix + frozen list (in-doc — no separate manifest file), options-on-record
  (video compression: caps not transcode; bucket: keep `job-files`; notify: bell + gated push).
- `docs/feedback-media-dispatch.md` — three complete cold-session copy-paste blocks (F, B, C).
- Zero code/schema/seed changes — non-CRM initiative, progress tracks via the roadmap doc's
  checklists (CRM tracker not used).

**Key findings recorded in the roadmap** (full evidence there):
- **RPC-cutover landmine (averted at plan time):** adding DEFAULT params to `insert_tech_feedback`
  via `CREATE OR REPLACE` would create an ambiguous overload and break every live submit instantly
  (shared Supabase). Phase F must DROP the 5-arg function + CREATE the 7-arg one, with a committed
  old-signature test; the new body mirrors screenshots↔attachments both ways so B/C deploy order
  never matters.
- **Two live bugs:** screenshot removal/abandon orphans storage objects (`TechFeedback.jsx:118-124`);
  AdminFeedback's shared `noteText` state can save notes onto the wrong row. Both fixed in-plan.
- **Push reaches nobody today:** `send-push` has zero callers, APNS env unset, `device_tokens` = 0
  rows. Notify design = in-app bell via `create_notification` (works today; global feed) + per-admin
  push fan-out (503-tolerant; goes live when the owner configures APNs). Email declined by owner.
- `storage.*` owned by `supabase_storage_admin` → migrations cannot create buckets/policies; the
  live `job-files` 50MB server cap is dashboard-configured (invisible to schema-as-code).
- New nav items need `always: true` or `isItemVisible()`/`canAccess()` hides them from everyone.

**Dispatch:** Wave 0 = Session F alone (Opus·high — schema cutover + `mediaCompress.js` +
`FeedbackAttachments.jsx` composer + working desktop page + wiring). Wave 1 after F merges =
Session B (Opus·medium — TechFeedback rebuild + `feedback-notify` worker) ∥ Session C (Opus·high —
AdminFeedback rebuild + `purge-feedback-media` worker). Owner anytime-lane actions: APNS env +
device tokens; point the external cron at the purge endpoint; optional dedicated bucket.

## CRM Phase 5 — Automation recipes (Jul 2 2026 — shipped)

Configurable linear automation builder (Session K). One additive migration
`20260702_crm_phase5_automations.sql` (post-wave single session — manifest §7 amends the
"zero schema" wave rule): two NEW tables + this phase's five API RPCs created directly (no stub
ceremony — no cross-session consumer). Behind `page:crm` + the new dev-only
`feature:crm_automations` sub-flag (seeded as a DB row — not in `featureFlags.js`, which is out
of Phase 5's ownership; a missing row would default OPEN, so seeding it is what gates the screen).

**Tables** (both `org_id` + RLS + explicit policy at creation):
- `crm_automations` — `id, org_id, name, description, trigger_event_type` (a `system_events.event_type`),
  `conditions jsonb` (`[{field, op, value}]` AND-filters), `actions jsonb` (ordered
  `[{type: send_email|send_sms|enroll_sequence|create_task, config, delay_hours}]`), `enabled`,
  `created_by, created_at, updated_at`.
- `crm_automation_runs` — one row per (rule, triggering event): `automation_id` (FK CASCADE),
  `org_id, triggering_event_id` (a `system_events.id` — no FK, the bus is append-only),
  `contact_id, entity_type, entity_id, current_action` (cursor into `actions[]`), `status`
  (`active|completed|failed|skipped|held`), `next_run_at, last_error`. **`UNIQUE(automation_id,
  triggering_event_id)`** is the idempotency/S1 dedup key — `system_events` has no cursor, so
  run-creation dedups on this, never on timestamps.

**RPCs** (SECURITY DEFINER + GRANT anon, authenticated): `get_crm_automations(p_org_id)` (list +
per-rule run stats), `upsert_crm_automation(...)` (create/edit — **S1 guard here**; `p_enabled`
NULL = leave as-is), `set_automation_enabled(p_id, p_enabled)` (**re-checks S1 on enable**),
`delete_crm_automation(p_automation_id)` (cascades runs), `get_automation_runs(p_automation_id,
p_org_id, p_limit)`. Plus `crm_fixed_automation_conflict(p_org_id, p_trigger_event_type)` (the S1
predicate, shared by both guarded RPCs) and `enqueue_automation_run(...)` (idempotent
`INSERT … ON CONFLICT (automation_id, triggering_event_id) DO NOTHING` — the worker calls it
because the REST client's `upsert` MERGES, which would overwrite a live run).

**Finding S1 (double-send, binding)** — the fixed engine (`run-automations.js`) and this
configurable engine keep dedup markers in namespaces that can't see each other, so a "missed
call → text" rule + the fixed missed-call-textback = two SMS for one call (TCPA, per-message).
Resolution: `crm_fixed_automation_conflict` refuses an ENABLED rule whose `trigger_event_type`
duplicates an ENABLED fixed automation, checked in `upsert_crm_automation` AND
`set_automation_enabled`; the engine also skips such rules at fire time (defense in depth). The
trigger→fixed-automation map (`speed_to_lead`/`missed_call_textback` → `crm_lead_created`(+`_manual`);
`review_request` → `job.phase_changed`/`job.status_changed`; `no_response_followup` is a time-scan
with no discrete event → collides with nothing) is duplicated in the engine's
`FIXED_AUTOMATION_TRIGGERS` and MUST stay in sync with the SQL predicate.

**Worker — `functions/api/process-crm-automations.js`** (new; `onRequest*` authenticated manual
trigger + `scheduled()` cron, deliberately named distinct from 4d's `run-automations.js`).
Structural sibling of `process-sequences.js`. ① **MATCH** — scans recent `system_events`
(`MATCH_LOOKBACK_MIN` 180) for enabled, non-S1-blocked triggers, evaluates AND-conditions against
the event payload merged over the trigger entity (payload wins on key collision), and enqueues one
idempotent run per match. ② **ADVANCE** — due runs (`status in (active,held) & next_run_at<=now`)
execute `actions[current_action]`: sends go ONLY through `sendAutomatedMessage()` (the frozen
consent gate — never twilio/email directly, never `skip_compliance`), enroll via
`enroll_in_sequence`, task via `upsert_crm_task`; then the cursor advances via imported Phase-8
`planStepOutcome`/`computeNextRunAt` semantics (read-only import; `process-sequences.js` never
edited). A held SMS (kill-switch OFF / TCPA quiet-hours) becomes `status='held'`, cursor
UNCHANGED, retried in `HOLD_RETRY_HOURS` — never dropped, never advanced past; a durable consent
skip (dnd/suppressed/no contact) advances past. One `worker_runs` row per cron run. Single-tenant:
`system_events` has no org_id, so runs scope to the one real org.

**UI — `src/pages/crm/CrmAutomations.jsx`** (master/detail, hand-rolled — no new dependency):
rule list → editor/detail. Editor = trigger picker (only event types the RPC layer actually
emits) → optional AND-condition rows (typed operators, `is_empty`/`in`/… with a field datalist) →
ordered action list with native up/down reorder + per-action wait + type-specific config; enable
checkbox with a client-side S1 collision warning (RPC still enforces). Detail = recipe summary +
per-rule run log (`get_automation_runs`). `useAuth()` `db` only, `upr:toast` feedback, inline
two-click delete. CSS only in the `CRM WAVE RESERVED — Phase 5` `index.css` marker (tokens;
mobile-only `@media (max-width:768px)` with 48px targets). Seams (authorized additive, manifest
§7): `App.jsx` lazy import + `<Route path="automations">`, `crmIcons.jsx` `IconAutomations`,
`CrmLayout.jsx` one `SIDEBAR_ITEMS` row + icon import.

**Tests** (committed failing first): `functions/api/process-crm-automations.test.js` (25 pure
unit tests — S1 `blockedTriggers`/`isTriggerBlocked`, null-safe typed AND-condition evaluator,
`planRunOutcome` held/skip/retry translation, idempotent `matchAutomations`);
`supabase/tests/crm_phase5_automations.test.js` (integration — CRUD, UNIQUE run idempotency, S1
save+enable guard; self-skips without creds like the other CRM suites). The SQL behavior (CRUD,
UNIQUE idempotency, S1 save+enable guard, conflict predicate) was verified live via Supabase MCP
assertions. `npm test` (319 passed / 53 skipped) + `npm run build` + `npx eslint` (changed files)
all green.

**Deliberately NOT** (owner-chosen v1 scope): branching/if-else, any node-graph canvas or new
frontend dep, editing `run-automations.js` (4d-owned) or `process-sequences.js` (Phase-8-owned —
imported read-only), touching the orphan `automation_rules` (its removal is a separate reviewed
cleanup). Recorded end-state (not v1): migrate the fixed four into `crm_automations` and retire
`run-automations.js` — one engine, guard obsolete.

## CRM Phase 5 re-plan (Jul 2 2026) — plan of record committed (no feature code)

Phase 5 ("Visual automation builder") scheduled by owner directive — its original go-signal gate
("4 fixed automations proven valuable + a real 5th need") is superseded, recorded transparently in
`docs/crm-roadmap.md` → **"Phase 5 re-plan (2026-07-02) — Linear automation recipes"** (the
authoritative section). v1 scope = **linear automation recipes**: trigger (a `system_events`
event type) → AND-conditions → ordered actions (send email/SMS via the frozen gate, enroll in
sequence, create task). One combined build session (**Session K**), runs **in parallel with
Phase 10** — disjointness proven by an adversarial challenge pass before commit.

Key design facts (adversarially verified): `system_events` is **RPC-fed, not trigger-fed** (one
lone DB trigger), no cursor/org_id → run-creation dedups on
**`UNIQUE(automation_id, triggering_event_id)`**; the legacy `automation_rules` table is a
verified unwired orphan (no org_id, zero code references, stale TODO at
`functions/api/twilio-webhook.js:229`) — Phase 5 uses fresh `crm_automations` /
`crm_automation_runs` instead; **finding S1 (double-send)** is binding — the fixed engine
(`run-automations.js`) and the new configurable engine keep dedup markers in namespaces that
can't see each other, so `upsert_crm_automation` AND the engine must block rules duplicating an
enabled fixed automation (TCPA). No new frontend dependency (hand-rolled linear builder per the
CrmLeads DnD precedent).

Artifacts committed (docs/seed only — zero feature code): the roadmap re-plan section (phase
block, gap audit, options-on-record, resisted ledger, challenge report; old Phase 5 block +
graph line superseded in place), `.claude/rules/crm-wave-ownership.md` **§7** (Session K row,
authorized additive seam edits to App.jsx/crmIcons/CrmLayout, own-additive-schema + no-stub
amendments, S1 guard), the **Session K dispatch block** in `docs/crm-dispatch.md`, and
`supabase/migrations/20260702_crm_phase5_replan_stages.sql` (applied + verified live: phase
title → "Automation recipes — linear visual builder", status still `planned`, placeholder stage
replaced by 7 real stages).

## CRM Phase 5-Ops plan (Jul 3 2026) — plan of record committed (no feature code)

Owner directive (full scope): extend the shipped automation engine with **ops actions**
(notify_staff via `create_notification`, job_note via `job_notes`, set_job_phase via a NEW
two-write-encapsulating RPC, create_draft_invoice via the idempotent `create_invoice_for_job` —
draft-only, the QBO push door stays human), a **scheduled-scan trigger family** ("something
DIDN'T happen": estimate aging, missing daily moisture reading [MT day boundary], invoice
overdue, stuck phase, dispatch SLA (`scan.no_appointment_after_create`) — code-defined registry,
thresholds-only config, deterministic uuidv5 dedup through the existing
`UNIQUE(automation_id, triggering_event_id)`),
and a **7-recipe starter pack seeded `enabled=false`**. Key finding recorded: the job/e-sign
trigger events ARE emitted (live counts verified — DB-side trigger functions from Mar-era
migrations; a repo-grep claim to the contrary was refuted), so no emit-path work is needed.
Commissions are explicitly NOT an action (stay derived via `is_real_job` → `get_commissions`).
Artifacts: roadmap "Phase 5-Ops plan (2026-07-03)" section, ownership manifest **§8** (Session L
row — Session K's two code files transferred post-#253; additive-ALTER allowance; call-only
plumbing list), Session L dispatch block in `docs/crm-dispatch.md`, and
`supabase/migrations/20260703_crm_phase5ops_stages.sql` (applied + verified: phase `5-ops`
seeded `planned` with 7 stages). Also this session: PR #169 (commissions foundation) reconciled
onto `dev` and merged — commission tracking starts from now (historical jobs stay unattributed
by owner decision).

## Feedback Media (Jul 3 2026) — Phase F foundation shipped

Photos + video on employee feedback, desktop submissions, retention plumbing. Roadmap +
BINDING ownership matrix: `docs/feedback-media-roadmap.md` (Foundation-then-parallel-wave;
Phase F owned 100% of the schema — Sessions B/C ship zero migrations).

**`tech_feedback` new columns** (`20260702_feedback_media.sql`, additive): `attachments jsonb
NOT NULL DEFAULT '[]'` (records `{path,name,mime,size,original_size,width?,height?,duration?}`,
path bucket-LESS), `source text NOT NULL DEFAULT 'tech'` CHECK tech|desktop, `resolved_at
timestamptz`, `attachments_purged_at timestamptz`. ⚠️ Legacy `screenshots` values were
double-encoded jsonb STRING scalars (JSON.stringify through PostgREST) — backfilled to real
arrays; the insert RPC now decodes string-scalar input too.

**RPCs** (all SECURITY DEFINER, anon+authenticated):
- `insert_tech_feedback(p_employee_id, p_type, p_title, p_description, p_screenshots, p_attachments, p_source)` —
  **7-arg via DROP+CREATE** (the old 5-arg signature was dropped in the same transaction; a
  plain OR REPLACE would have created an ambiguous overload and broken every live submit).
  Body mirrors both directions: screenshots→attachments (`{path}`-only, bucket prefix
  stripped) for old callers; image attachments→screenshots (`job-files/` prefix added,
  videos excluded) for new callers. Old 5-arg call verified live through PostgREST.
- `update_tech_feedback(p_id, p_status, p_admin_notes)` — unchanged signature; stamps
  `resolved_at` on first transition into resolved/dismissed, keeps it terminal↔terminal,
  NULLs it on reopen, never touches `attachments_purged_at`.
- `get_tech_feedback()` — RETURNS TABLE gained `attachments, source, resolved_at,
  attachments_purged_at` (appended; existing caller ignores extra keys).
- `get_purgeable_feedback_media(p_days int DEFAULT 90)` — terminal + unpurged + non-empty
  attachments older than `GREATEST(p_days, 30)` days; the ≥30-day clamp lives INSIDE the RPC
  because the future purge endpoint is unauthenticated by cron convention.
- `mark_feedback_attachments_purged(p_id)` — idempotent, first stamp wins.

**Shared code (FROZEN for the wave):** `src/lib/mediaCompress.js` (caps: 5 files / 1 video /
90s / img in ≤25MB / video ≤50MB; compressImage → 1920px 0.8 JPEG, never larger than the
original, HEIC fallback ≤10MB; probeVideo never rejects, 5s→nulls; 33 unit tests) and
`src/components/FeedbackAttachments.jsx` (snap-first immediate upload to
`job-files/feedback/{employeeId}/{ts}-{sanitized}`, per-tile state machine with Retry —
retry re-validates the caps, best-effort storage DELETE on remove behind a busy `removing`
state — fixes the old orphaned-upload bug without opening a submit race, duration chip,
≥48px targets; contract `value/onChange/onBusyChange/disabled/caps`, calls useAuth()
itself). ⚠️ Composer reset contract: `value` seeds tiles ON MOUNT ONLY — to clear it
(e.g. after submit) remount with a new `key`; it deliberately has no value-watching effect
(a prop-sync effect raced parallel upload completions and dropped fresh tiles — caught by
adversarial review, fixed pre-merge).

**Desktop surface:** `src/pages/Feedback.jsx` at `/feedback` (Layout shell, ungated —
every employee), submits `p_source:'desktop'` + `p_attachments` as a REAL array (never
JSON.stringify). Nav: OVERFLOW_ITEMS + SYSTEM_ITEMS entries with `always: true` +
`hideForRoles: ['crm_partner']` (isItemVisible gained the generic `hideForRoles` check —
crm_partner is locked to /crm/*+/help by Layout's choke point, so the link would dead-end
for them). The legacy mobile Sidebar link is hardcoded after the NAV_ITEMS loop like Help
(same crm_partner exclusion) — NAV_ITEMS itself stays identical. CSS: `fbm-*` classes in
`index.css` Phase F block, with reserved Session B / Session C blocks appended after it.

### Session B (submit surfaces + notify) — shipped Jul 3 2026

**`src/pages/tech/TechFeedback.jsx` rebuilt** on the shared `FeedbackAttachments` composer:
photos + one short video with free compression/caps, real storage DELETE on remove (fixes the
old orphaned-upload bug), snap-first (no blocking inputs), ≥48px targets (back button now 48px).
`'feature'` is relabeled **"Improvement"** in the UI only (DB CHECK still `'bug'|'feature'`).
Submit passes `p_attachments` as a REAL array (never JSON.stringify) + `p_source:'tech'`, then
navigates back to `/tech`. No dedicated index.css rules needed — the form uses inline tech
tokens and the composer ships its own global `.fbm-*` styles (Phase F block); the Session B
reserved marker carries a note to that effect.

**`src/pages/Feedback.jsx` (desktop)** polished: captures the insert RPC's returned row and
fires the same notify; header DEPENDS-ON updated. Keeps `p_source:'desktop'`.

**New worker `functions/api/feedback-notify.js`** (+ `feedback-notify.test.js`, 12 tests): POST
`{feedback_id}`, `requireAuth` in send-push.js's shape (Bearer required; validated against
`/auth/v1/user` using the **anon key** as apikey — the service-role key is unnecessary for token
validation, and using anon also sidesteps the block-secrets hook's env-var-name literal match).
Service-key client (`supabase(env)`) loads the feedback row + submitter `full_name` + admins
(`employees?role=eq.admin`). Two channels:
1. **In-app bell** — `create_notification` RPC (`p_type:'feedback'`, link `/tech-feedback`,
   entity `tech_feedback`/id). Works today; the notifications feed is **global** (no recipient
   column) so every employee sees the notice — accepted + disclosed per the roadmap.
2. **Per-admin push** — one same-origin `POST /api/send-push` per admin **excluding the
   submitter**, forwarding the caller's `Authorization` header, title `New bug report` /
   `New improvement idea`, body `{submitter}: {title}`, data `{feedback_id, route:'/tech-feedback'}`.
   Returns `{notified, attempted, bell, results}`.

Both pages call it **fire-and-forget** via `src/lib/api.js` (`api('feedback-notify', …)` attaches
the user Bearer) with a swallowed `.catch(()=>{})` — the success toast never depends on it.
Pure helpers `selectAdminIds(employees, submitterId)` + `buildPushPayload(feedback, name)` are
node-tested; the handler test injects fake db + fetch to prove 401-without-Bearer,
submitter-excluded fan-out count, and a 503 from send-push reported without failing the request.

⚠️ **Owner-gated — push delivery reaches nobody today:** APNs env vars (`APNS_*`) are unset (the
send-push worker returns 503) and `device_tokens` has 0 rows, and admins work on desktop where
the iOS token path never runs. The **in-app bell is the channel that works now**; the push
fan-out is wired degrade-gracefully and becomes real the day the owner configures APNs + devices
register. Zero schema migrations shipped (Session B constraint).

### Session C (AdminFeedback rebuild + gallery) — not started
*Reserved. Session C documents its AdminFeedback.jsx rebuild here: attachments gallery /
video viewer (lives in AdminFeedback, not the shared composer), source badge,
resolved/purged states, styles only below its reserved index.css marker.*

## Tech Mobile v2 — plan of record (session 2026-07-03, docs + reviewer agent only — no feature code)

**What this session shipped** (branch `claude/planning-session-sec1ev` → PR into `dev`):
- `docs/tech-v2-roadmap.md` — the dispatch model of record for rebuilding the tech mobile
  Dashboard + Schedule to Apple/Google-Calendar polish and then merging TechAppointment +
  TechJobDetail into a Job Hub. Live-verified gap audit (taxonomy A–H), 7 severity findings,
  six phase blocks (**F → S ∥ D → C → M1 → M2**; S∥D disjointness adversarially proven,
  parallelism optional), dependency graph, ownership matrix + frozen list, options-on-record
  (TanStack Query vs hand-rolled cache; no virtualization dep; persister kept per owner
  offline decision), 6-agent challenge report folded in.
- `docs/tech-v2-dispatch.md` — six complete cold-session copy-paste blocks (F, S, D, C, M1, M2).
- `.claude/agents/tech-phase-reviewer.md` — Opus acceptance grader for tech-v2 phases
  (weights clock/time-entry math, flag rollout safety, legacy non-regression, frozen-list
  compliance; reconciles the roadmap checkboxes both directions).
- Zero code/schema/seed changes — non-CRM initiative; progress tracks via the roadmap doc's
  checklists (CRM tracker not used, on record).

**Key findings recorded in the roadmap** (full evidence there):
- **Two P1 root causes of "glitchy/slow":** `TechLayout.jsx:227-230` keys the content wrapper
  by pathname → every navigation remounts the page (all state dies, every RPC refires);
  `TechSchedule.jsx:486-510` derives the fetch window from `selectedDay` → every day tap
  refetches the full ~61-day window. Phase F ships a minimal v1 relief patch for both.
- **NEW live bug (challenge pass):** `clock_appointment_action` stamps `work_date` with the
  UTC date — a clock-in at/after 6pm MDT lands on tomorrow's `work_date` (1 of 158 live rows
  misdated; payroll groups by `work_date`; the midnight-split writer uses Denver — writers
  disagree). Fix = body-only REPLACE slotted into Phase F.
- **Schema drift ×13:** the core tech RPC surface (`get_my_appointments_today`,
  `get_assigned_tasks`, `toggle_appointment_task`, `update_appointment`, …) exists live with
  ZERO migration coverage. Phase F commits a verbatim `pg_get_functiondef` capture migration
  first.
- **The schema already out-runs the UI:** `appointments.color/kind/duration_days/is_milestone`
  exist but both tech feed RPCs strip them (desktop dispatch RPCs return color). Exposing
  them is additive jsonb keys — zero consumer breakage (challenge-confirmed).
- **Flag fail-open trap:** no `feature_flags` row = enabled for EVERYONE
  (`AuthContext.jsx:262`) — so v2 flag rows must be seeded in Supabase BEFORE any code
  referencing them merges; `EXPLICIT_FLAGS` entries need explicit `enabled:false`
  (auto-seed creates missing keys ON); `force_disabled` is inert for `isFeatureEnabled`.
- **Hours for the dashboard** must SUM the stored `job_time_entries.hours` column (+
  `travel_minutes`, + a live term for the open entry) — never recompute from timestamps
  (manual/admin-edited/midnight-split rows diverge); weeks are Monday-start Denver to match
  `get_payroll_summary`.
- Cancelled-as-"Upcoming" dash bug is latent-only: cancellation is a hard delete; zero
  `cancelled` rows have ever existed (no CHECK constraint prevents future writers, so v2
  feeds filter it anyway).

**Dispatch:** Wave 0 = Session F alone (Opus·high — flags seeded first, drift capture,
feed upgrades, `get_tech_dashboard`, work_date fix, v1 relief patch, TanStack trio
@5.101.2 + idb persister `upr-query-cache`, TechLayout pane host, v2 primitives + css
markers, ownership manifest). Wave 1 after F merges = Session S (Opus·high — Agenda + Day
timeline + week pager; Month view explicitly deferred) ∥ Session D (Opus·medium — Now/Next
hero, attention strip, My-numbers, one-RPC dashboard) — parallel-capable, serial fine.
Then C (Sonnet·medium cutover/cleanup + Month-view stretch, owner-gated bake), M1
(Opus·high Job Hub behind `page:tech_job_hub`), M2 (Opus·medium href flip + resolver
redirect + legacy detail deletion). Owner anytime-lane actions: flag flips in DevTools
(owner-only → all techs), phone bake sign-offs.

## Schedule Desktop — plan of record (session 2026-07-03, docs only — no feature code)

**What this session shipped** (branch `claude/build-plan-ftgfa1` → PR into `dev`):
- `docs/schedule-roadmap.md` — the dispatch model of record for the desktop Schedule page:
  create-and-schedule booking flow, dead-weight removal, Month-view parity. Live-verified
  evidence base (E1–E10), 5 severity findings, a full booking-modal design spec, three phase
  blocks (**A → B → C, strictly serial** — shared Schedule.jsx surface), dependency graph,
  ownership matrix + frozen-contract list, options-on-record, 3-agent challenge report folded in.
- `docs/schedule-dispatch.md` — three complete cold-session copy-paste blocks (A, B, C).
- Struck the stale "appointments→scheduled-jobs refactor" references in place (this doc's
  Calendar-sync section + `GOOGLE-INTEGRATIONS-HANDOFF.md`) — owner declared it stale; this plan
  supersedes it.
- Zero code/schema/seed changes — non-CRM initiative; progress tracks via the roadmap doc's
  checklists.

**Key findings recorded in the roadmap** (full evidence there):
- **The pain quantified:** 56 of 105 non-lead jobs (53%) have never had an appointment; every
  calendar create path requires an existing job; `Layout.jsx` force-navigates to the job page
  after create, which has zero scheduling affordance.
- **Templates/Wizard subsystem is data-proven dead** (0/230 appointments ever linked; wizard last
  run 2026-04-14) — Session B removes the UI; tables/RPCs stay, documented retired.
- **Owner corrections on record:** Week (not Month) is the beloved view; kill Jobs/Crew grids +
  3-Day span; HCP-style booking modal on the schedule page only; claim picker rows must show
  address · date of loss · claim number with "New claim" the default every time.
- **Live side-effect chain governs test protocol:** appointment INSERT triggers gcal sync; the
  worker emails the CLIENT ('confirmed', first-sync CAS) when job.client_email && notify_client
  (default TRUE), and emails + calendar-invites the CREW — test rows need no client_email/notify
  OFF and no real crew.
- **`get_dispatch_board` appointment objects carry no job_id** (parent job row does) — Month
  parity is frontend `_jobId` stamping, no RPC change; auto-show surfaces a new job with an
  in-range appointment without a pin, but the booking modal pins via `dispatch_board_jobs` to
  cover Auto-show-OFF.
- **`jobs.lead_source` exists, is NULL on all 236 jobs, zero writers** — booking modal writes it
  via post-insert update (an RPC param-add would mint an overload — the clock_appointment_action
  PGRST203 incident class).
- **Coordination:** draft PR #102 must be closed/rebased before Session B (it edits 6 of B's
  files incl. ScheduleTemplates.jsx, which B deletes); tech-v2 co-edits App.jsx (tech routes,
  different region) + index.css markers — Session A pre-commits all three SCHEDULE V2 markers.

**Dispatch:** Wave 0 = Session A (Opus·high — shared client/claim component extraction, tested
save chain, BookingModal, creationPicker "New job" entry, ~70%-budget chained-modals fallback).
Wave 1 = Session B (Opus·medium — Templates/Wizard removal end-to-end incl. both navItems entries
+ Admin.jsx registry row, viewMode-axis collapse with placementMode over-deletion guard, verbatim
MonthView extraction, JobPage "Schedule appointment" reverse path, remodeling-filter fix as its
own commit; gated on PR #102 closure). Wave 2 = Session C (Opus·medium — Month drag-reschedule,
click-day create, events rendering, chip enrichment; Week regression-verify only).
