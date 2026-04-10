# Tech Mobile View — Full Audit Report
**Date:** 2026-04-09
**Auditor:** Claude Code (Opus 4.6)
**Scope:** All tech mobile files listed in TECH-MOBILE-AUDIT-TASK.md

---

## Phase 1: Per-Page Code Audit

### 1.1 TechLayout.jsx (Shell)
- [x] **PASS** Bottom nav has exactly 5 tabs: Dash, Schedule, Tasks, Messages, Claims — line 80-86
- [x] **PASS** Active tab uses `useLocation()` and highlights correctly — line 204-208
- [x] **PASS** Toast listener on `upr:toast` custom event, renders above nav with safe-area padding — line 180-189, 242
- [x] **PASS** Toast auto-dismisses after 5000ms — line 186
- [x] **PASS** Task badge dot on Tasks tab via `get_assigned_tasks`, 60s interval, cleanup on unmount — line 192-203
- [x] **PASS** `padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))` on `.tech-nav` — index.css:4207
- [x] **PASS** No `alert()` or `confirm()` anywhere

### 1.2 TechDash.jsx (Home)
- [x] **PASS** Loads today's appointments via `get_my_appointments_today` — line 500
- [x] **PASS** Empty state shows next 7 days via `get_appointments_range` — line 509-529
- [x] **PASS** ActiveCard renders: client name, title, address, task progress bar, quick-action buttons — lines 237-330
- [x] **PASS** Quick-action buttons 48px height — lines 287, 303, 320
- [x] **PASS** "On My Way" uses two-click confirm pattern (confirmOmw state + timer reset) — lines 203-224
- [x] **PASS** Photo button with `accept="image/*" capture="environment"` — line 279
- [x] **PASS** Photo upload: snap-first flow → uploads → optional note via dismissable toast with "Add note" — lines 143-201
- [x] **PASS** Photo storage path: `job-files/{job_id}/{timestamp}-{filename}` — line 153
- [x] **PASS** Photo calls `insert_job_document` with both `p_job_id` and `p_appointment_id` — lines 159-166
- [x] **PASS** PullToRefresh wraps content BELOW sticky greeting header — line 717
- [x] **PASS** Skeleton loading state (DashSkeleton component) — lines 456-484
- [x] **PASS** CreateFAB: "New Job" → `/tech/new-job`, "New Customer" → `/tech/new-customer` — lines 40, 55
- [x] **PASS** FutureRow timeline rows render correctly — lines 434-451
- [x] **PASS** Address tap opens maps (iOS `maps://` vs `maps.google.com`) — lines 133-141
- [x] **PASS** No `console.log` statements
- [x] **PASS** `useCallback` deps include `db` and `employee.id` — line 497-506

### 1.3 TechSchedule.jsx
- [x] **PASS** Loads via `get_appointments_range` with correct date window — line 385
- [x] **PASS** DateStrip: 61-day continuous scroll, month labels on 1st, dots for appt days — lines 53-158
- [x] **PASS** MonthPicker: overlay, prev/next month, tap date to jump — lines 163-277
- [x] **PASS** "Today" button visible when not on today — line 488-499
- [x] **PASS** View toggle: Daily vs List mode — lines 502-534
- [x] **PASS** Appointment rows: time, division-colored border (4px), client name, address, type/status badges — lines 280-356
- [x] **PASS** Tap appointment navigates to `/tech/appointment/:id` — line 292
- [x] **PASS** New appointment FAB passes `?date=selectedDay` — line 538
- [x] **PASS** Pull-to-refresh reloads data — lines 576, 599
- [ ] **MINOR** No race condition guard (`boardReqRef`) on async loads — rapid date changes could cause stale data overwrites. Low severity since `dateRange` is memoized.
- [ ] **FAIL** Several touch targets under 48px — see Touch Target Audit below

### 1.4 TechTasks.jsx
- [x] **PASS** Loads via `get_assigned_tasks(p_employee_id)` — line 132
- [x] **PASS** Two tabs: "Today" (filtered by `is_today`) and "All" — lines 8-11, 159
- [x] **PASS** Tab pills 48px height — line 192
- [x] **PASS** CompletionRing SVG with done/total percentage arc — lines 15-43
- [x] **PASS** Tasks grouped by job with collapsible headers — lines 163-169, 252-299
- [x] **PASS** Mini progress bars on collapsed groups — line 277-279
- [x] **PASS** SwipeTaskRow: swipe right >40px triggers complete with green "Done" bg — line 63
- [x] **PASS** Haptic: 20ms on threshold, 50ms on complete — lines 59, 64
- [x] **PASS** Prevents double-toggle via `togglingRef` Set — lines 125, 143-144
- [x] **PASS** Tap checkbox also toggles — line 91
- [x] **PASS** Pull-to-refresh — line 222
- [x] **PASS** Optimistic state update with revert on failure — lines 145-151

### 1.5 TechClaims.jsx
- [x] **PASS** Loads via `get_claims_list()` — line 20
- [x] **PASS** Search bar: 48px height, 16px font — lines 71-72
- [x] **PASS** Client-side filter by claim_number, insured_name, loss_city, insurance_carrier — lines 35-40
- [x] **PASS** 200ms debounce — line 31
- [x] **PASS** Rows show: claim number (mono), DOL, insured name, address (accent), division pills — lines 106-183
- [x] **PASS** Pull-to-refresh — line 78
- [ ] **FAIL (G6 CONFIRMED)** `get_claims_list()` is called without employee filter — returns ALL claims to all techs. **Potential data exposure issue.**

### 1.6 TechAppointment.jsx (Detail)
- [x] **PASS** Loads via `get_appointment_detail(p_appointment_id)` — line 51
- [x] **PASS** Division gradient hero from `DIV_GRADIENTS` — lines 207, 215
- [x] **PASS** Back button: 48x48 min touch target — line 228-229
- [x] **PASS** 4-button action bar (Navigate, Call, Message, Photo) all >=56px min height — lines 261-332
- [x] **PASS** TimeTracker renders for active appointments — line 339
- [x] **PASS** Crew section with initials avatars and Lead/Tech badges — lines 343-379
- [x] **PASS** Task list with checkboxes and progress bar — lines 382-412
- [x] **PASS** Task toggle with optimistic update + revert — lines 70-82
- [x] **PASS** Photo gallery: 2-column grid, grouped by date (Today/Yesterday/weekday/date) — lines 415-459
- [x] **PASS** Photo query: `or=(appointment_id.eq.${id},job_id.eq.${jobId})` dual filter — line 59
- [x] **PASS** Lightbox: fullscreen, pinch-to-zoom (`touchAction: 'pinch-zoom'`), close button 48x48 — lines 463-496
- [x] **PASS** Notes section with "Add field note" expandable textarea + save/cancel — lines 560-607
- [x] **PASS** Notes saved via `insert_job_document` with `p_category='note'` — line 159
- [x] **PASS** Pull-to-refresh — line 336
- [x] **PASS** Snap-first photo flow with "Add note" toast — lines 89-125

### 1.7 TimeTracker.jsx (Component)
- [x] **PASS** State machine: Scheduled → En Route → Working ↔ Paused → Completed — all branches covered
- [x] **PASS** Actions: omw, start, pause, resume, finish — all via `clock_appointment_action` — line 105
- [x] **PASS** Finish uses two-click confirm (confirmFinish state) — lines 98-100
- [x] **PASS** Timer ticks every 1s with `clearInterval` cleanup — lines 76-95
- [x] **PASS** Travel time: `now - travel_start - paused_minutes` — lines 88-89
- [x] **PASS** Completed state shows breakdown: travel time, on-site time, total — lines 179-253
- [x] **PASS** Multi-visit "Return to Job" with reason input, creates new entry — lines 118-163
- [x] **PASS** Haptic per action type (omw:50, start:50, pause:30, resume:50, finish:pattern) — line 33
- [x] **PASS** Timer uses `tech-tracker-timer` class (tabular-nums from CSS)
- [x] **PASS** Status-colored backgrounds — lines 318, 386, 417

### 1.8 TechNewCustomer.jsx
- [x] **PASS** 4 role options — lines 7-12
- [x] **PASS** Conditional fields: address for Homeowner/Tenant, company for Adjuster — lines 39-40, 190-242
- [x] **PASS** Phone validation via `normalizePhone` with error toast — lines 44-47
- [x] **PASS** Input fontSize: 16 (hardcoded) — line 15
- [x] **PASS** `tags: []` (not string) — line 59
- [x] **PASS** Duplicate phone detection via constraint error — line 81
- [x] **PASS** Dispatches `upr:contact-created` — line 74
- [x] **PASS** Sticky submit above tech nav — lines 261-280
- [x] **PASS** Navigates back on success — line 75
- [ ] **FAIL** Back button 40x40, under 48px minimum — lines 101-105

### 1.9 TechNewJob.jsx
- [x] **PASS** Contact search via `search_contacts_for_job` with 400ms debounce — line 100
- [x] **PASS** Inline create with name + phone, Save & Select — lines 353-399
- [x] **PASS** Phone validation on inline create — lines 135-138
- [x] **PASS** Division pills: 5 options with emoji — lines 8-14
- [x] **PASS** Referral source buttons — lines 16-22
- [x] **PASS** Address fields: street, city, state, ZIP — lines 488-519
- [x] **PASS** CarrierSelect dropdown — lines 523-533
- [x] **PASS** Claim number field when not OOP — lines 536-547
- [x] **PASS** `create_job_with_contact` RPC on submit — line 187
- [x] **PASS** Success toast with job number, navigate back — lines 218-219
- [x] **PASS** `tags: []` — line 148
- [ ] **FAIL** Back button 40x40, under 48px minimum — lines 236-242

### 1.10 TechNewAppointment.jsx
- [x] **PASS** Job search: active jobs, min 2 chars, 400ms debounce — line 104
- [x] **PASS** `encodeURIComponent` on search query — line 91
- [x] **PASS** DatePicker accepts `?date=` from query params — line 49
- [x] **PASS** Time select: 30-min intervals, 6am-8pm — lines 20-28
- [x] **PASS** Type buttons: 6 types filtered for mobile — lines 30-32
- [x] **PASS** Crew: collapsible, multi-select, toggle lead/tech — lines 401-496
- [x] **PASS** Tasks: collapsible, phase-grouped, inline "Add a task" — lines 498-617
- [x] **PASS** `get_unassigned_tasks` loads when job selected — line 115
- [x] **PASS** `add_adhoc_job_task` creates inline tasks — line 135
- [x] **PASS** `assign_tasks_to_appointment` bulk assigns — line 205
- [x] **PASS** Auto-generates title from selected task phases — lines 176-179
- [x] **PASS (documented)** Non-atomic crew inserts — known deferred issue — lines 195-199
- [ ] **FAIL** Back button 40x40, under 48px minimum — lines 229-235
- [ ] **FAIL** Input fontSize uses `var(--tech-text-body)` = 15px, under 16px iOS zoom threshold — line 11
- [ ] **FAIL** Type buttons height 40px, under 48px minimum — line 387

---

## Phase 2: Cross-Cutting Concerns

### 2.1 Touch Target Audit

| File | Element | Size | Line | Status |
|------|---------|------|------|--------|
| TechNewCustomer.jsx | Back button | 40x40 | 101 | **FAIL** (needs 48x48) |
| TechNewJob.jsx | Back button | 40x40 | 236 | **FAIL** (needs 48x48) |
| TechNewAppointment.jsx | Back button | 40x40 | 229 | **FAIL** (needs 48x48) |
| TechSchedule.jsx | "Today" button | height 32 | 491 | **FAIL** (needs 48) |
| TechSchedule.jsx | View toggle buttons | 36x32 | 510, 521 | **FAIL** (needs 48x48) |
| TechSchedule.jsx | New appt FAB | 36x36 | 540 | **FAIL** (needs 48x48) |
| TechNewAppointment.jsx | Type buttons | height 40 | 387 | **FAIL** (needs 48) |
| TechNewAppointment.jsx | "Add" task button | height 40 | 606 | **FAIL** (needs 48) |
| TechLayout.jsx | Install banner dismiss | padding 4 | 163 | **FAIL** (very small) |

All other interactive elements (action bar buttons, tab pills, swipe rows, FAB pills, etc.) meet the 48px minimum.

### 2.2 Error Handling Audit
- [x] **PASS** Every `try/catch` in tech files shows a toast on error
- [x] **PASS** No `alert()` or `confirm()` anywhere in tech files (grep confirmed: 0 matches)
- [x] **PASS** Network failures show user-friendly toast messages
- [x] **PASS** Photo upload failures show error toast and reset uploading state
- [x] **PASS** No `console.log` in any tech page files (grep confirmed: 0 matches)

### 2.3 CSS Token Usage

- [ ] **BUG** `APPT_STATUS_COLORS.in_progress` uses **blue** (`#eff6ff`, `#2563eb`) — same as `scheduled`. Should use **green** to match `--status-working-*` CSS variables (`#ecfdf5`, `#059669`). Status badges on schedule rows are indistinguishable for scheduled vs in_progress.
  - **File:** techConstants.js:7

- [ ] **BUG** `APPT_STATUS_COLORS.paused` uses **amber** (`#fffbeb`, `#d97706`) — same as `en_route`. Should use **red** to match `--status-paused-*` CSS variables (`#fef2f2`, `#dc2626`). Status badges show paused same as en_route.
  - **File:** techConstants.js:8

- [x] **PASS** Tech pages use `--tech-*` tokens for card radius, button radius, shadow, font sizes, tap targets, row height, nav height
- [x] **PASS** Division colors from techConstants.js
- [x] **PASS** Type badge colors from techConstants.js TYPE_CONFIG

### 2.4 Memory Leak Check
- [x] **PASS** All `setInterval` calls have `clearInterval` in cleanup (TechLayout:202, TimeTracker:94)
- [x] **PASS** All `addEventListener` calls have `removeEventListener` (TechLayout:189, TechLayout:105, TechNewJob:129, TechNewAppointment:83)
- [x] **PASS** No Supabase realtime subscriptions in tech files
- [x] **PASS** All timeout refs cleaned up on unmount (TechDash:131, TimeTracker:62-63, etc.)
- [ ] **MINOR** TechSchedule lacks race condition guard on async loads — rapid date strip scrolling could cause stale responses to overwrite fresh data. Low risk since dateRange is memoized.

### 2.5 Safe Area & iOS Compliance
- [x] **PASS** `viewport-fit=cover` in index.html — line 6
- [x] **PASS** All sticky bottom elements use `env(safe-area-inset-bottom)` with `max(12px, ...)` fallback
- [ ] **FAIL** TechNewAppointment.jsx input fontSize uses `var(--tech-text-body)` = 15px — under 16px iOS auto-zoom threshold. **All inputs on that page will zoom on focus on iOS.**
  - **File:** TechNewAppointment.jsx:11
- [x] **PASS** All other tech files hardcode `fontSize: 16` on inputs

### 2.6 Hardcoded Data / Debug Code
- [x] **PASS** No `console.log` in production paths
- [x] **PASS** No hardcoded employee IDs, user IDs, or test data
- [x] **PASS** No commented-out code blocks > 5 lines
- [x] **PASS** No TODO comments indicating incomplete features

---

## Phase 3: Missing Features Gap Analysis

### G1: No standalone notes — **NOT A GAP**
TechAppointment.jsx has a dedicated "Notes" section (lines 560-607) with "Add Note" button that creates notes independently of photos via `insert_job_document` with `p_category='note'`. Working correctly.

### G2: No appointment edit/reschedule — **CONFIRMED HIGH**
No edit UI exists anywhere. Once an appointment is created via TechNewAppointment, there is no way to change the date, time, type, crew, or tasks from the tech mobile app. The only workaround is creating a new appointment and leaving the old one.

### G3: No job/appointment history — **PARTIALLY MITIGATED**
TechSchedule shows a 61-day window (~30 days back, ~30 days forward). Techs CAN see recent past appointments. However, there's no way to view history beyond 30 days or get an aggregated history view.

### G4: No timesheet/hours summary — **CONFIRMED HIGH**
No aggregated view of hours worked. Techs can see individual completed appointment breakdowns in TimeTracker, but there's no weekly/monthly summary, no hours-by-job report, no payroll-ready view.

### G5: No search in Schedule or Tasks — **CONFIRMED MEDIUM**
Only TechClaims has search. TechSchedule has date navigation but no text search. TechTasks has tab filtering but no search. A tech with 10+ appointments/tasks must scroll to find specific ones.

### G6: Claims shows ALL claims — **CONFIRMED HIGH (Data Exposure)**
`get_claims_list()` is called without any employee parameter. Both the admin `ClaimsList.jsx` and tech `TechClaims.jsx` call the same RPC. Techs can see claim data for all employees/jobs — addresses, insured names, insurance info — for claims they have no involvement with.

### G7: No notification/alert system — **CONFIRMED MEDIUM**
The only "notification" is the red dot badge on the Tasks tab (TechLayout:219-228). No push notifications, no in-app notification center, no alerts for new assignments, schedule changes, or messages.

### G8: No offline support — **CONFIRMED MEDIUM**
All operations require network. Photo upload, task toggle, and time tracking will fail silently or show error toasts if network drops. No queue-and-retry pattern, no local cache, no service worker for offline reads.

### G9: Messages tab route — **NOT A GAP (but UX concern)**
`/tech/conversations` route EXISTS in App.jsx (line 112) and maps to the shared `Conversations` component. However, this is the **admin conversations page**, not a tech-optimized mobile view. It will render but may have UX issues (desktop-oriented layout, no TechLayout-style mobile optimization).

### G10: Claim detail dead end — **NOT A GAP**
`/tech/claims/:claimId` route EXISTS (App.jsx:107) and maps to `ClaimPage`. The claim rows in TechClaims navigate to this route (line 113). Like G9, this is a shared admin component, not tech-mobile optimized.

### G11: No issue/problem reporting — **CONFIRMED MEDIUM**
No structured way to report problems. Tech can add a note to an appointment, but there's no way to flag urgent issues, escalate to a dispatcher, or create a ticketed problem report.

### G12: No earnings/pay visibility — **CONFIRMED LOW**
No earnings display exists anywhere in the tech mobile app.

### Discovery Gaps (found during audit)

| # | Gap | Severity | Description |
|---|-----|----------|-------------|
| G13 | **Conversations page not mobile-optimized** | MEDIUM | `/tech/conversations` uses the shared admin Conversations component — no mobile-first layout, potentially broken on small screens |
| G14 | **ClaimPage not mobile-optimized** | MEDIUM | `/tech/claims/:claimId` uses shared admin ClaimPage — same issue as G13 |
| G15 | **No way to toggle crew lead/tech role after selection** | LOW | In TechNewAppointment crew picker, the first selected becomes lead, others tech. No UI to change role after initial selection (line 155-159) |

---

## Phase 4: Final Report

### A. Bug List

| Severity | Location | Description |
|----------|----------|-------------|
| **HIGH** | techConstants.js:7 | `APPT_STATUS_COLORS.in_progress` uses blue (same as `scheduled`). Should be green (`#ecfdf5`, `#059669`, `#a7f3d0`) to match `--status-working-*` CSS vars. Techs cannot distinguish "scheduled" from "in progress" on schedule rows. |
| **HIGH** | techConstants.js:8 | `APPT_STATUS_COLORS.paused` uses amber (same as `en_route`). Should be red (`#fef2f2`, `#dc2626`, `#fecaca`) to match `--status-paused-*` CSS vars. Techs cannot distinguish "en route" from "paused" on schedule rows. |
| **MEDIUM** | TechNewAppointment.jsx:11 | `inputStyle.fontSize` uses `var(--tech-text-body)` = 15px. Under 16px iOS auto-zoom threshold. All inputs on the New Appointment page will trigger Safari zoom on focus. Fix: hardcode `fontSize: 16`. |

### B. UX Issues

| Severity | Location | Description | Principle Violated |
|----------|----------|-------------|-------------------|
| **HIGH** | TechNewCustomer.jsx:101, TechNewJob.jsx:236, TechNewAppointment.jsx:229 | Back buttons are 40x40px, under 48px minimum | "48px minimum touch targets — No exceptions. Gloved hands, wet fingers." |
| **MEDIUM** | TechSchedule.jsx:491 | "Today" button height 32px | Same as above |
| **MEDIUM** | TechSchedule.jsx:510,521 | View toggle buttons 36x32px | Same as above |
| **MEDIUM** | TechSchedule.jsx:540 | New appointment FAB 36x36px | Same as above |
| **MEDIUM** | TechNewAppointment.jsx:387 | Type buttons height 40px | Same as above |
| **MEDIUM** | TechNewAppointment.jsx:606 | "Add" task button height 40px | Same as above |
| **LOW** | TechLayout.jsx:163 | Install banner dismiss "X" has only padding:4 | Same as above |

### C. Missing Features (Prioritized)

| Severity | Feature | Description | Scope |
|----------|---------|-------------|-------|
| **CRITICAL** | Claims data filtering (G6) | `get_claims_list()` returns ALL claims to all techs regardless of assignment. Create `get_tech_claims(p_employee_id)` that filters by claims linked to tech's assigned jobs. | **S** — New RPC + one-line change in TechClaims |
| **HIGH** | Appointment edit/reschedule (G2) | Allow techs to modify date, time, crew, and tasks on existing appointments. Add edit mode to TechAppointment or a separate TechEditAppointment page. | **L** — New page/mode + update RPCs |
| **HIGH** | Timesheet/hours summary (G4) | Weekly/monthly hours view showing: total hours, breakdown by job, travel vs on-site, exportable for payroll. | **L** — New page + aggregation RPC |
| **MEDIUM** | Schedule & Task search (G5) | Text search on TechSchedule (client name, address) and TechTasks (task name, job number). | **S** — Add search input + client-side filter (same pattern as TechClaims) |
| **MEDIUM** | Tech-optimized Conversations (G9/G13) | Mobile-first messaging view within TechLayout — 48px touch targets, simplified compose, contact context. | **L** — New TechConversations page |
| **MEDIUM** | Tech-optimized ClaimPage (G14) | Mobile-first claim detail view with key info visible at a glance, 48px actions. | **M** — New TechClaimDetail page |
| **MEDIUM** | Notification center (G7) | In-app notification list for: new assignments, schedule changes, messages received. Badge counter on a bell icon. | **L** — New table, RPCs, realtime subscription, UI |
| **MEDIUM** | Offline resilience (G8) | Queue failed operations (photo uploads, task toggles) for retry. Show offline indicator. Service worker for cached reads. | **L** — Service worker + IndexedDB queue |
| **MEDIUM** | Problem/issue reporting (G11) | Structured "Report Issue" button on appointment detail — type picker (safety, equipment, access), description, auto-tags job/appointment. | **M** — New RPC + inline UI on TechAppointment |
| **LOW** | Earnings/pay visibility (G12) | Simple read-only view of hours × rate per pay period. | **M** — New page + RPC |
| **LOW** | Crew role toggle (G15) | Allow changing lead/tech role after crew member is selected in TechNewAppointment. | **S** — Add toggle button to existing crew picker |

### D. Code Quality Issues

| Severity | Location | Description |
|----------|----------|-------------|
| **LOW** | TechSchedule.jsx | No race condition guard on async loads. Rapid date strip scrolling could cause stale responses to overwrite fresh data. Consider adding a request counter ref (e.g. `reqRef.current++; const thisReq = reqRef.current; ... if (thisReq !== reqRef.current) return;`). |
| **LOW** | TimeTracker.jsx:82-83 | Timer calculation during pause uses `new Date(activeEntry.paused_at) - new Date(startRef) - paused_minutes*60000`. If `startRef` is `travel_start` (not `clock_in`), the displayed elapsed time during pause includes travel, which may not match the on-site-only intent. Edge case — only visible if tech pauses immediately after starting work with 0 prior paused minutes. |

### E. Recommended Build Order

**Priority 1 — Fix bugs and data exposure (do first, same session)**
1. **Fix status color bugs** in techConstants.js — 2 lines, instant fix
2. **Fix iOS zoom bug** in TechNewAppointment.jsx — 1 line, instant fix
3. **Fix touch targets** — back buttons (40→48), schedule controls (32/36→48) — ~30 min
4. **Fix claims data exposure (G6)** — Create `get_tech_claims(p_employee_id)` RPC, update TechClaims.jsx — ~1 hour

**Priority 2 — High-impact missing features (next sprint)**
5. **Schedule & Task search (G5)** — Small scope, high daily value — ~2 hours
6. **Appointment edit/reschedule (G2)** — Unlocks core workflow — ~1 day

**Priority 3 — Efficiency features (following sprint)**
7. **Timesheet/hours summary (G4)** — Important for tech trust/transparency — ~1 day
8. **Tech-optimized Conversations (G13)** — Messages tab currently serves admin layout — ~1 day
9. **Problem/issue reporting (G11)** — Adds structured escalation path — ~4 hours

**Priority 4 — Polish and future (backlog)**
10. Tech-optimized ClaimPage (G14)
11. Notification center (G7)
12. Offline resilience (G8)
13. Earnings/pay visibility (G12)
14. Crew role toggle (G15)

---

*This report should be reviewed alongside `TECH-MOBILE-AUDIT-TASK.md` which stays as reference for the build phase.*
