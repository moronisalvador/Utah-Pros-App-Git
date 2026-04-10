# Tech Mobile View — Full Audit & Gap Analysis
**Date:** 2026-04-09
**Scope:** Every file, feature, and flow in the field technician mobile experience
**Goal:** Verify correctness, find bugs, identify missing features, and produce a prioritized build list

---

## Context for Fresh Session

The tech mobile app is a field-technician-facing PWA within the larger UPR platform. It lives under `/tech/*` routes, uses `TechLayout.jsx` as its shell, and is designed for a 64-year-old tech in work gloves standing in a flooded basement. All design principles are in CLAUDE.md under "UX Design Principles — Tech Mobile App".

### Tech Files Map
```
src/components/TechLayout.jsx          — Shell: bottom nav, toast system, task badge
src/components/tech/TimeTracker.jsx    — Live timer state machine (Scheduled→En Route→Working→Paused→Completed)
src/components/PullToRefresh.jsx       — Pull-to-refresh wrapper (used by all tech pages)
src/pages/tech/techConstants.js        — Status colors, division gradients, type config
src/pages/tech/TechDash.jsx            — Home: today's appointments, active cards, quick actions
src/pages/tech/TechSchedule.jsx        — 14-day scrollable schedule with DateStrip + MonthPicker
src/pages/tech/TechTasks.jsx           — Task list: swipe-to-complete, completion ring, job groups
src/pages/tech/TechClaims.jsx          — Claims browser with search
src/pages/tech/TechAppointment.jsx     — Appointment detail: action bar, photos, tasks, notes, crew
src/pages/tech/TechNewCustomer.jsx     — Quick contact creation form
src/pages/tech/TechNewJob.jsx          — New job form with inline contact create
src/pages/tech/TechNewAppointment.jsx  — Schedule new appointment with crew + task assignment
```

### Key RPCs Used by Tech Pages
```
get_my_appointments_today(p_employee_id)
get_appointments_range(p_start_date, p_end_date)
get_appointment_detail(p_appointment_id)
get_appointment_tasks(p_appointment_id)
get_assigned_tasks(p_employee_id)
clock_appointment_action(p_appointment_id, p_employee_id, p_action)
toggle_appointment_task(p_task_id, p_employee_id)
insert_job_document(p_job_id, p_name, p_file_path, p_mime_type, p_category, p_uploaded_by, p_appointment_id, p_description)
search_contacts_for_job(p_query)
create_job_with_contact(...)
get_insurance_carriers()
upsert_insurance_carrier(p_name, p_sort_order)
get_unassigned_tasks(p_job_id)
add_adhoc_job_task(p_job_id, p_title, p_phase_name, p_phase_color)
assign_tasks_to_appointment(p_appointment_id, p_task_ids)
get_claims_list()
```

---

## Phase 1: Per-Page Code Audit

Read each file top to bottom. For each, verify the items below. Mark PASS/FAIL with line numbers.

### 1.1 TechLayout.jsx (Shell)
- [ ] Bottom nav has exactly 5 tabs: Dash, Schedule, Tasks, Messages, Claims
- [ ] Active tab state uses `useLocation()` and highlights correctly
- [ ] Toast listener on `upr:toast` custom event — renders toast above nav with safe-area padding
- [ ] Toast auto-dismisses (check timeout duration)
- [ ] Task badge dot on Tasks tab: fetched via `get_assigned_tasks`, refreshed on interval — verify interval value and cleanup
- [ ] `padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))` on `.tech-nav`
- [ ] No `alert()` or `confirm()` anywhere

### 1.2 TechDash.jsx (Home)
- [ ] Loads today's appointments via `get_my_appointments_today`
- [ ] Empty state: shows next 7 days via `get_appointments_range` when 0 appointments today
- [ ] ActiveCard renders: client name, appointment title, address, task progress bar, quick-action buttons
- [ ] Quick-action buttons are minimum 48px height
- [ ] "On My Way" button uses two-click confirm pattern (not alert/confirm)
- [ ] Photo button triggers file input with `accept="image/*" capture="environment"`
- [ ] Photo upload: snap-first flow — uploads immediately, then optional note via dismissable toast with "Add note" link
- [ ] Photo storage path format: `job-files/{job_id}/{timestamp}-{filename}`
- [ ] Photo calls `insert_job_document` with both `p_job_id` and `p_appointment_id`
- [ ] Pull-to-refresh wraps content BELOW sticky header
- [ ] Skeleton/loading state renders while data loads
- [ ] CreateFAB: "New Job" and "New Customer" pills navigate to correct routes
- [ ] FutureRow timeline rows for upcoming appointments render correctly
- [ ] Address tap opens maps (check URL scheme for iOS vs Android)
- [ ] No console.log statements left in production code
- [ ] `useCallback` dependency arrays include `db` and `employee`

### 1.3 TechSchedule.jsx
- [ ] Loads appointments via `get_appointments_range` with correct date window
- [ ] DateStrip: 61-day continuous scroll, month labels on 1st of month, dots for days with appointments
- [ ] MonthPicker: modal overlay, prev/next month, tap date to jump
- [ ] "Today" button appears when not viewing today
- [ ] View toggle: Daily vs List mode
- [ ] Appointment rows show: time, division-colored left border (4px), client name, address, type badge, status badge
- [ ] Tap appointment navigates to `/tech/appointment/:id`
- [ ] New appointment FAB passes `?date=selectedDay` as query param
- [ ] Pull-to-refresh reloads data
- [ ] Race condition guard: `boardReqRef` or similar counter pattern on async loads
- [ ] All touch targets >= 48px

### 1.4 TechTasks.jsx
- [ ] Loads tasks via `get_assigned_tasks(p_employee_id)`
- [ ] Two tabs: "Today" (filtered by `is_today`) and "All"
- [ ] Tab pills are 48px height
- [ ] CompletionRing SVG: shows done/total with percentage arc
- [ ] Tasks grouped by job with collapsible headers
- [ ] Mini progress bars on collapsed job groups
- [ ] SwipeTaskRow: swipe right > 40px triggers complete with green "Done" background
- [ ] Haptic feedback: 20ms on threshold, 50ms on complete
- [ ] Prevents double-toggle via `togglingRef` Set
- [ ] Tap checkbox also toggles (alternative to swipe)
- [ ] Pull-to-refresh reloads tasks
- [ ] Optimistic state update with revert on RPC failure

### 1.5 TechClaims.jsx
- [ ] Loads claims via `get_claims_list()`
- [ ] Search bar: 48px height, 16px font (prevents iOS zoom)
- [ ] Client-side filter by claim_number, insured_name, loss_city, insurance_carrier
- [ ] Debounce on search input (check ms)
- [ ] Claim rows show: claim number (monospace), date of loss, insured name, address (accent color), division pills
- [ ] Pull-to-refresh reloads claims
- [ ] **AUDIT QUESTION:** Does `get_claims_list()` filter by tech's assigned claims, or return ALL claims? If all — flag as potential data exposure issue.

### 1.6 TechAppointment.jsx (Detail)
- [ ] Loads via `get_appointment_detail(p_appointment_id)`
- [ ] Division gradient hero header from `DIV_GRADIENTS`
- [ ] Back button: min 48x48 touch target
- [ ] 4-button action bar: Navigate (maps), Call (tel:), Message (navigate), Photo (file input)
- [ ] All action bar buttons >= 48px
- [ ] TimeTracker component renders for active appointments
- [ ] Crew section: initials avatars, role badges (Lead/Tech)
- [ ] Task list with checkboxes and progress bar
- [ ] Task toggle calls `toggle_appointment_task` with optimistic update
- [ ] Photo gallery: 2-column grid, grouped by date (Today/Yesterday/weekday/date)
- [ ] Photo query: `or=(appointment_id.eq.${id},job_id.eq.${jobId})` — dual filter for legacy docs
- [ ] Lightbox: click photo opens fullscreen, pinch-to-zoom, close button 48x48
- [ ] Notes section: "Add field note" expandable → textarea + save/cancel
- [ ] Notes saved via `insert_job_document` with `p_category='note'`
- [ ] Pull-to-refresh reloads detail + tasks + docs
- [ ] Photo snap-first flow (same as TechDash)

### 1.7 TimeTracker.jsx (Component)
- [ ] State machine: Scheduled → En Route → Working ↔ Paused → Completed
- [ ] "On My Way" → `clock_appointment_action` p_action='omw'
- [ ] "Start Work" → p_action='start'
- [ ] "Pause" → p_action='pause'
- [ ] "Resume" → p_action='resume'
- [ ] "Finish" → p_action='finish' (two-click confirm)
- [ ] Live timer ticks every 1 second (check `setInterval` cleanup)
- [ ] Travel time: `now - travel_start`
- [ ] On-site time: `now - clock_in - total_paused_minutes`
- [ ] Completed state shows breakdown: travel time, on-site time, total
- [ ] Multi-visit support: "Return to Job" button, reason input, creates new `job_time_entries` row
- [ ] Haptic feedback per action type (omw: 50ms, start: 50ms, pause: 30ms, resume: 50ms, finish: pattern)
- [ ] Timer font uses `--tech-text-timer: 40px` and tabular-nums
- [ ] Status-colored background matches appointment status palette

### 1.8 TechNewCustomer.jsx
- [ ] Role picker: 4 options (Homeowner, Tenant, Adjuster, Other)
- [ ] Conditional fields: address for Homeowner/Tenant, company/carrier for Adjuster
- [ ] Phone validation: `normalizePhone` returns null for < 10 digits → shows error toast (recently fixed)
- [ ] Input fontSize: 16 (hardcoded, not var — prevents iOS zoom)
- [ ] `tags: []` not `tags: '[]'` (recently fixed)
- [ ] Duplicate phone detection via constraint error message
- [ ] Dispatches `upr:contact-created` event on success
- [ ] Sticky submit button above tech nav
- [ ] Navigates back on success

### 1.9 TechNewJob.jsx
- [ ] Contact search via `search_contacts_for_job` with 400ms debounce
- [ ] "Create New Customer" inline form: name + phone, Save & Select
- [ ] Phone validation on inline create (recently fixed)
- [ ] Division pills: 5 options with emoji
- [ ] Referral source buttons: Insurance, Retail/Cash, HOA, Commercial, TPA
- [ ] Address fields: street, city, state, ZIP
- [ ] Insurance carrier dropdown via CarrierSelect
- [ ] Claim number field (shown only when not OOP)
- [ ] `create_job_with_contact` RPC on submit
- [ ] Success toast with job number, navigate back
- [ ] `tags: []` not `tags: '[]'`

### 1.10 TechNewAppointment.jsx
- [ ] Job search: active jobs by number/insured name, min 2 chars, 400ms debounce
- [ ] `encodeURIComponent` on search query (recently fixed)
- [ ] DatePicker accepts `?date=` from query params
- [ ] Time select: 30-min intervals, 6am-8pm
- [ ] Type buttons: 6 types filtered for mobile
- [ ] Crew section: collapsible, multi-select employees, toggle lead/tech role
- [ ] Tasks section: collapsible, phase-grouped picker, inline "Add a task" input
- [ ] `get_unassigned_tasks` loads available tasks when job selected
- [ ] `add_adhoc_job_task` creates inline tasks
- [ ] `assign_tasks_to_appointment` bulk assigns on submit
- [ ] Auto-generates title from selected task phases
- [ ] Non-atomic crew inserts (known deferred issue — just document, don't fix)

---

## Phase 2: Cross-Cutting Concerns

### 2.1 Touch Target Audit
Grep all tech files for `height:`, `minHeight:`, `minWidth:`, `padding:` on interactive elements. Flag any button, link, or tappable element with effective touch area < 48px.

### 2.2 Error Handling Audit
- [ ] Every `try/catch` in tech files shows a toast on error (not console.log only)
- [ ] No `alert()` or `confirm()` anywhere in tech files
- [ ] Network failures on RPC calls show user-friendly messages
- [ ] Photo upload failures show error toast and don't leave orphan state

### 2.3 CSS Token Usage
- [ ] Tech pages use `--tech-*` tokens (not hardcoded values) for: card radius, button radius, shadow, font sizes, tap targets, row height, nav height
- [ ] Status colors come from `techConstants.js` APPT_STATUS_COLORS (not hardcoded hex)
- [ ] Division colors come from `techConstants.js` DIV_PILL_COLORS / DIV_BORDER_COLORS / DIV_GRADIENTS

### 2.4 Memory Leak Check
- [ ] All `setInterval` calls have matching `clearInterval` in cleanup
- [ ] All `addEventListener` calls have matching `removeEventListener`
- [ ] All Supabase realtime subscriptions have cleanup functions
- [ ] No state updates after component unmount (check for isMounted patterns or AbortController)

### 2.5 Safe Area & iOS Compliance
- [ ] `viewport-fit=cover` in index.html (required for env(safe-area-inset-bottom))
- [ ] All sticky bottom elements use `env(safe-area-inset-bottom)` with fallback
- [ ] Input fontSize >= 16px on all text inputs (prevents iOS auto-zoom)
- [ ] `dvh` units used where appropriate for full-height layouts

### 2.6 Hardcoded Data / Debug Code
- [ ] No `console.log` in production paths (console.error is OK for actual errors)
- [ ] No hardcoded employee IDs, user IDs, or test data
- [ ] No commented-out code blocks > 5 lines
- [ ] No TODO comments that indicate incomplete features shipping as complete

---

## Phase 3: Missing Features Gap Analysis

After completing Phase 1 & 2, compile a gap analysis. For each gap, classify as:
- **CRITICAL** — Blocks daily field work
- **HIGH** — Significantly reduces tech efficiency
- **MEDIUM** — Polish / nice-to-have for v1
- **LOW** — Future enhancement

### Known Gaps to Investigate

| # | Gap | Expected Severity | What to Check |
|---|-----|-------------------|---------------|
| G1 | **No standalone notes** — Tech can only add notes via photo flow, not independently | HIGH | Verify: Can a note be added to an appointment WITHOUT uploading a photo? Check TechAppointment.jsx notes section |
| G2 | **No appointment edit/reschedule** — Once created, date/time/crew can't be changed | HIGH | Verify: Is there any edit UI in TechAppointment or TechNewAppointment? |
| G3 | **No job/appointment history** — Only today + future visible | MEDIUM | Verify: Can a tech see completed past appointments? Check TechSchedule date range |
| G4 | **No timesheet/hours summary** — No aggregated view of hours worked | HIGH | Verify: Is there any page showing weekly/monthly hours? |
| G5 | **No search in Schedule or Tasks** — Only Claims has search | MEDIUM | Verify: Can tech search for an appointment by client name in TechSchedule? |
| G6 | **Claims shows ALL claims** — Not filtered by tech's assignments | HIGH | Verify: Does `get_claims_list()` filter by employee? If not, tech sees data for all employees |
| G7 | **No notification/alert system** — No way to know about new assignments | MEDIUM | Verify: Any push notification, badge system, or in-app notification center? |
| G8 | **No offline support** — Network required for all operations | MEDIUM | Verify: What happens when network drops mid-photo-upload or mid-task-toggle? |
| G9 | **Messages tab route** — TechLayout has Messages tab but does `/tech/conversations` page exist? | CRITICAL | Verify: Does the route exist in App.jsx? Does the page component exist? |
| G10 | **Claim detail dead end** — TechClaims list rows may not navigate anywhere useful | MEDIUM | Verify: What happens when you tap a claim in TechClaims? Does `/tech/claims/:claimId` render anything? |
| G11 | **No issue/problem reporting** — Can't flag problems to dispatcher | MEDIUM | Verify: Any structured way to escalate beyond adding a note? |
| G12 | **No earnings/pay visibility** — Tech can't see what they've earned | LOW | Verify: Any earnings display exists? |

### Discovery Gaps
While auditing, look for additional gaps not listed above. Especially:
- Flows that START but don't FINISH (e.g., button exists but handler is empty/TODO)
- States that are set but never displayed
- RPCs that are called but results aren't rendered
- Navigation paths that lead to 404 or empty pages

---

## Phase 4: Report

Produce a final report with these sections:

### A. Bug List
Actual bugs found — things that are broken or will error at runtime.
Format: `[SEVERITY] File:line — description`

### B. UX Issues
Things that work but violate the design principles in CLAUDE.md.
Format: `[SEVERITY] File:line — description — which principle violated`

### C. Missing Features (Prioritized)
Gap analysis results from Phase 3, sorted by severity.
Format: `[SEVERITY] Feature name — what it should do — estimated scope (S/M/L)`

### D. Code Quality Issues
Memory leaks, missing cleanups, stale closures, race conditions.
Format: `[SEVERITY] File:line — description`

### E. Recommended Build Order
If missing features are to be built, recommend an order based on:
1. Impact on daily tech workflow
2. Dependencies between features
3. Estimated complexity

---

## On Completion
- Do NOT delete this file — it stays as reference for the build phase
- Save the final report as `TECH-MOBILE-AUDIT-REPORT.md` in the repo root
- Do NOT commit either file — just leave them for review
