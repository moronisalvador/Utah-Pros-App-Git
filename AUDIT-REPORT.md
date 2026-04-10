# UPR Platform — Audit Report
**Date:** 2026-04-09
**Auditor:** Claude Code (automated)
**Branch:** dev
**Scope:** Full platform audit — 35 pages, 36 components, 11 workers, 67 tables, 100+ RPCs

---

## PHASE 0: Database Integrity & Frontend-DB Contract

### 0A: Schema Verification
- **67 tables** found in public schema (context doc says 69 — minor doc discrepancy)
- **1 view** found: `billing_overview` (used by ARPage.jsx) — OK
- **100+ RPCs** found (includes overloaded functions: `add_related_job` x2, `insert_job_document` x2, `upsert_feature_flag` x2)
- **All 67 tables have RLS enabled** — no security gaps
- **All 67 tables have RLS policies** — full coverage for anon + authenticated roles

### 0B: Frontend-to-DB Contract
- **~70 unique RPC calls** from frontend — ALL match existing DB functions ✓
- **Workers use direct table operations only** (no `db.rpc()` calls) — verified
- **Direct table access columns verified** for: employees, contacts, jobs, conversations — all match ✓
- `billing_overview` view used in `ARPage.jsx:24` exists as a PostgreSQL view ✓

### 0C: Data Integrity
| Check | Count | Status |
|-------|-------|--------|
| Total jobs | 76 | — |
| Total contacts | 22 | — |
| Total claims | 25 | — |
| Total employees | 15 | — |
| Total appointments | 10 | — |
| Jobs without claim_id | 45 (59%) | WARNING |
| Orphan conversations (no participants) | 0 | OK |
| Duplicate phone numbers | 0 | OK |

### Phase 0 Findings

**[0A.1] OK: RLS Coverage**
All 67 tables have RLS enabled with policies for both anon and authenticated roles. No security gaps.

**[0B.1] OK: RPC Contract**
All ~70 frontend RPC calls match existing database functions. No missing RPCs.

**[0B.2] OK: Column References**
Spot-checked employees, contacts, jobs, conversations table columns against frontend queries. All referenced columns exist.

**[0B.3] WARNING: CLAUDE.md documents `contacts` with `first_name`/`last_name` but actual DB has `name` (single field)**
- Detail: Code correctly uses `name`. Documentation in CLAUDE.md is stale.
- Fix: Update CLAUDE.md contacts table definition to match actual schema.

**[0C.1] WARNING: 45 out of 76 jobs (59%) have no `claim_id`**
- Detail: These are either retail/direct jobs without insurance claims, or Encircle-imported jobs that weren't linked.
- Impact: May cause blank claim references in UI. Not necessarily a bug if by design.
- Fix: Verify this is intentional. If not, run a data cleanup to link orphan jobs.

---

## PHASE 1: Auth, Session & Routing

### Files Reviewed
- `src/contexts/AuthContext.jsx` (286 lines)
- `src/components/ProtectedRoute.jsx` (21 lines)
- `src/App.jsx` (185 lines)
- `src/pages/Login.jsx` (239 lines)
- `src/pages/SetPassword.jsx` (224 lines)
- `functions/api/admin-users.js` (381 lines)

### Phase 1 Findings

**[1.1] OK: Token Refresh**
`TOKEN_REFRESHED` event properly rebuilds `authDb` via `setAuthDb(createSupabaseClient(session.access_token))`. Prevents 401 errors after ~1 hour.

**[1.2] OK: Session Bootstrap**
`getSession()` handles null/expired sessions gracefully — just skips `handleAuthUser`. Loading state managed correctly.

**[1.3] OK: devLogin Security**
Double-gated: function body checks `import.meta.env.DEV`, AND export is `devLogin: import.meta.env.DEV ? devLogin : null`. Cannot leak to production.

**[1.4] OK: Route Guards**
- `AdminRoute`: checks `employee.role !== 'admin'`, handles null employee
- `DevRoute`: hardcoded `moroni@utah-pros.com` check
- `FeatureRoute`: uses `isFeatureEnabled()` which fails open (no flag = unrestricted)
- `ProtectedRoute`: shows spinner during loading, redirects to `/login` when unauthenticated
- All routes wrapped in `ErrorBoundary`

**[1.5] OK: 4-Layer Permission System**
`canAccess()` priority: force_disabled → employee override → admin bypass → role-based. Correct.

**[1.6] OK: Password Reset Flow**
`SetPassword.jsx` handles: recovery detection, 4s timeout for auth events, expired/invalid link state, password validation (6+ chars, match). Auto-redirects to `/` on success.

**[1.7] OK: Admin Users Worker Auth**
All 4 HTTP methods (POST/PATCH/PUT/DELETE) call `requireAdmin()` first, which verifies JWT via Supabase Auth API and checks `employee.role === 'admin'`.

**[1.8] WARNING: admin-users.js POST — no rollback on partial failure**
- File: `functions/api/admin-users.js:192-211`
- Detail: Creates auth user first (line 193), then inserts employee row (line 211). If the employee insert fails (e.g., duplicate email, DB error), the auth user is left orphaned with no cleanup.
- Fix: Wrap in try/catch — if employee insert fails, call `deleteAuthUser(authUser.id)` to roll back.

**[1.9] WARNING: admin-users.js DELETE — hard delete may fail on FK constraints**
- File: `functions/api/admin-users.js:372`
- Detail: `db.delete('employees', ...)` will fail if the employee has FK references in `appointment_crew`, `job_time_entries`, `job_assignments`, etc. No pre-check or cascade handling.
- Fix: Either soft-delete (set `is_active=false`) or check for references before deleting. The PUT endpoint (toggle active) is the safer approach for deactivation.

**[1.10] SUGGESTION: Password reset redirectTo hardcoded to production**
- File: `src/pages/Login.jsx:57`
- Detail: `redirectTo: 'https://utahpros.app/set-password'` — always points to prod, even during dev. Dev users testing password reset will be redirected to production.
- Fix: Use `window.location.origin + '/set-password'` for dynamic redirect.

---

## PHASE 5: Messaging & Realtime

### Files Reviewed
- `functions/api/send-message.js` (223 lines)
- `functions/api/twilio-webhook.js` (252 lines)
- `functions/api/twilio-status.js` (57 lines)
- `functions/api/process-scheduled.js` (197 lines)
- `functions/lib/twilio.js` (138 lines)
- `src/lib/realtime.js` (78 lines)
- `src/pages/Conversations.jsx` (subscriptions grep)

### Phase 5 Findings

**[5.1] OK: TCPA Compliance Chain**
`send-message.js` checks DND (line 90) then opt_in_status (line 111) before every outbound message. Every blocked attempt is logged to `sms_consent_log`. Skip_compliance flag is clearly documented as system-only.

**[5.2] OK: CTIA Keyword Handling**
`twilio-webhook.js` detects STOP/UNSUBSCRIBE/CANCEL/END/QUIT, START/UNSTOP/SUBSCRIBE/YES, and HELP/INFO keywords. Case-insensitive, exact match on trimmed body. STOP sets both `opt_in_status: false` AND `dnd: true`. START reverses both. HELP returns required company info.

**[5.3] OK: Inbound Contact Auto-Creation**
Unknown senders auto-create a contact with `opt_in_status: true` (implied consent from initiating conversation). Consent logged to `sms_consent_log`.

**[5.4] OK: Realtime Subscription Cleanup**
`Conversations.jsx` properly unsubscribes from both `subscribeToMessages` and `subscribeToConversations` in useEffect cleanup functions. No memory leak.

**[5.5] OK: Delivery Status Tracking**
`twilio-status.js` updates message status from Twilio callbacks (queued→sent→delivered/failed). Handles RCS `read` and `clicked` events. Always returns 200.

**[5.6] OK: Scheduled Messages**
`process-scheduled.js` marks messages as 'processing' before sending (prevents double-send), runs full compliance checks, limits to 20 per run, handles errors gracefully.

**[5.7] BUG: Group conversation sends comma-separated phone numbers to Twilio**
- File: `functions/api/send-message.js:151-157`
- Detail: For `conversation.type === 'group'`, builds `toNumbers = participants.map(p => p.phone).join(',')` and passes as a single `To` parameter. Twilio's Messages API does NOT support comma-separated recipients — each message requires a separate API call. This will either fail or only reach the first number.
- Fix: Loop through participants like the broadcast case does, sending individual messages to each phone number.

**[5.8] WARNING: Twilio signature validation silently skipped if auth token missing**
- File: `functions/api/twilio-webhook.js:49`
- Detail: `const isValid = !env.TWILIO_AUTH_TOKEN || await validateTwilioSignature(...)` — if `TWILIO_AUTH_TOKEN` env var is missing in production, ALL webhooks are accepted without validation. This could allow spoofed inbound messages.
- Fix: Log a warning when auth token is missing. In production, fail closed (reject) rather than fail open.

**[5.9] WARNING: Unread count increment is not atomic**
- File: `functions/api/twilio-webhook.js:221`
- Detail: `unread_count: (conversation.unread_count || 0) + 1` — reads current value then writes back. If two inbound messages arrive simultaneously, both read the same count and write the same incremented value, losing one increment.
- Impact: Minor — affects badge counts, not message delivery. Rare in practice.
- Fix: Use an RPC with `UPDATE conversations SET unread_count = unread_count + 1 WHERE id = $1`.

**[5.10] WARNING: No concurrency lock on scheduled message processing**
- File: `functions/api/process-scheduled.js:58-70`
- Detail: If two cron triggers fire simultaneously, both could SELECT the same pending messages. The 'processing' status update at line 70 prevents actual double-send, but there's a brief race window.
- Impact: Low — worst case is a processing conflict error, not a double-send.
- Fix: Use `SELECT ... FOR UPDATE SKIP LOCKED` pattern via RPC, or add a unique constraint on the processing window.

---

## PHASE 4: Time Tracking & Field Tech Core

### Files Reviewed
- `src/pages/TimeTracking.jsx` (737 lines)
- `src/components/tech/TimeTracker.jsx` (431 lines)
- `src/pages/tech/TechDash.jsx` (781 lines)
- `src/pages/tech/TechAppointment.jsx` (686 lines)
- `src/pages/tech/TechSchedule.jsx` (649 lines)
- `src/pages/tech/TechTasks.jsx` (298 lines)
- `src/components/TechLayout.jsx` (271 lines)
- `src/components/PullToRefresh.jsx` (162 lines)

### Phase 4 Findings

**[4.1] BUG: `DIVISION_COLORS` undefined — crashes By Job view in TimeTracking**
- File: `src/pages/TimeTracking.jsx:407`
- Detail: References `DIVISION_COLORS[job.division]` but only `_DIVISION_COLORS_UNUSED` is defined (line 51). Opening the By Job view will throw a ReferenceError.
- Fix: Rename `_DIVISION_COLORS_UNUSED` to `DIVISION_COLORS`.

**[4.2] BUG: Time entry delete has no two-click confirmation**
- File: `src/pages/TimeTracking.jsx:207-209`
- Detail: `handleDelete(entry.id)` deletes on single click with no confirmation. CLAUDE.md requires inline two-click confirm for destructive actions. A misclick permanently deletes a billable time entry.
- Fix: Add `confirmDel` state pattern per CLAUDE.md.

**[4.3] BUG: Swipe-to-complete threshold is 60px, spec says 40px**
- File: `src/pages/tech/TechTasks.jsx:62`
- Detail: Swipe triggers at `swipeX > 60` but haptic fires at 40px. User feels feedback but must keep swiping 50% further. CLAUDE.md spec says "40px threshold".
- Fix: Change to `if (swipeX > 40)`.

**[4.4] BUG: Swipe + click can double-toggle task completion**
- File: `src/pages/tech/TechTasks.jsx:62-74`
- Detail: `onPointerUp` calls `onToggle(task)` directly on swipe complete, but the subsequent `onClick` event also fires `handleToggle(task)`, undoing the completion. Also bypasses the pop animation.
- Fix: Set a flag in `handlePointerUp` to suppress the subsequent onClick.

**[4.5] WARNING: Back button in TechAppointment is ~36x28px (below 48px min)**
- File: `src/pages/tech/TechAppointment.jsx:224-230`
- Fix: Set `minWidth: 48, minHeight: 48`.

**[4.6] WARNING: Lightbox close button below 48px minimum**
- File: `src/pages/tech/TechAppointment.jsx:472-480`
- Fix: Add `minWidth: 48, minHeight: 48`.

**[4.7] WARNING: TechDash quick-action buttons (Photo/Notes/Clock In) are 40px tall**
- File: `src/pages/tech/TechDash.jsx:287`
- Fix: Change `height: 40` to `height: 48`.

**[4.8] WARNING: TechTasks tab pills are 40px tall**
- File: `src/pages/tech/TechTasks.jsx:186`
- Fix: Change to `height: 48`.

**[4.9] WARNING: CSV export doesn't escape commas in employee names**
- File: `src/pages/TimeTracking.jsx:495`
- Fix: Wrap CSV values in quotes.

**[4.P1] OK: Timer state machine** — OMW/Start/Pause/Resume/Finish all call correct `p_action` strings.
**[4.P2] OK: Timer persistence** — Loads from DB on mount, survives page refresh.
**[4.P3] OK: Timer display** — Continuous from `travel_start`, paused time subtracted.
**[4.P4] OK: Finish uses inline two-click confirm** — No alert/confirm.
**[4.P5] OK: 0-appointment empty state** — Shows 7-day preview.
**[4.P6] OK: Snap-first photo** — Auto-upload, optional caption toast.
**[4.P7] OK: Pull-to-refresh** — Wraps content below sticky header.
**[4.P8] OK: Safe area** — `padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))`.
**[4.P9] OK: Payroll math** — Delegated to `get_payroll_summary` RPC (server-side).
**[4.P10] OK: PWA install banner, task badge, frosted glass nav** — All working.

---

## PHASE 3: Schedule & Appointments

### Files Reviewed
- `src/pages/Schedule.jsx` (963 lines)
- `src/components/CalendarView.jsx` (699 lines)
- `src/components/CreateAppointmentModal.jsx` (495 lines)
- `src/components/EditAppointmentModal.jsx` (772 lines)
- `src/components/ScheduleWizard.jsx` (706 lines)
- `src/pages/ScheduleTemplates.jsx` (1041 lines)
- `src/lib/scheduleUtils.js`
- `src/components/DatePicker.jsx` (260 lines)

### Phase 3 Findings

**[3.1] BUG: Race condition on rapid date navigation — stale data overwrites current view**
- File: `src/pages/Schedule.jsx:477-478`
- Detail: Each anchor change triggers `loadBoard` via useEffect. Rapid Next clicks fire concurrent RPCs — whichever resolves last wins, which may not be the current anchor date. Dispatchers navigate dates frequently.
- Fix: Use a request counter ref: `const reqId = ++reqIdRef.current; ... if (reqIdRef.current !== reqId) return;`

**[3.2] BUG: CreateAppointmentModal inserts appointment + crew non-atomically**
- File: `src/components/CreateAppointmentModal.jsx:140-159`
- Detail: Uses `db.insert('appointments', ...)` then loops `db.insert('appointment_crew', ...)` one at a time. If a crew insert fails midway, appointment exists with partial crew, no rollback.
- Fix: Create `create_appointment_with_crew` RPC for atomic transaction.

**[3.3] BUG: EditAppointmentModal delete-all-then-reinsert crew is not atomic**
- File: `src/components/EditAppointmentModal.jsx:213-220`
- Detail: Deletes all `appointment_crew` rows then re-inserts one by one. Network error mid-loop leaves appointment with no crew and no recovery path.
- Fix: Use diff-based update or wrap in RPC.

**[3.4] BUG: ScheduleWizard applyPlan has 4 non-atomic steps with orphaned data risk**
- File: `src/components/ScheduleWizard.jsx:192-299`
- Detail: Sequential steps: (1) apply_schedule_plan RPC, (2) delete excluded tasks, (3) add custom tasks, (4) create custom phases. If step 3 fails after step 2, deleted tasks are gone but custom tasks incomplete.
- Fix: Move exclude/custom logic into the RPC, or show toast with partial success details.

**[3.5] WARNING: `update_appointment` RPC relies on implicit COALESCE convention**
- File: `src/pages/Schedule.jsx:528,533`
- Detail: Drop/resize pass `null` for unchanged fields (p_title, p_type, etc.), relying on the RPC to treat null as "keep existing" via COALESCE. If RPC doesn't do this, fields get nulled out.
- Fix: Verify RPC uses COALESCE for each nullable param.

**[3.6] WARNING: ScheduleWizard duration changes trigger unthrottled RPC calls**
- File: `src/components/ScheduleWizard.jsx:86-98`
- Detail: Every keystroke in duration input fires `preview_schedule` RPC. No debounce.
- Fix: Add 300ms debounce to `rePreview`.

**[3.7] WARNING: Template duplicate uses N+1 sequential inserts**
- File: `src/pages/ScheduleTemplates.jsx:743-793`
- Detail: One insert per phase, one per task, one per dependency — 60+ sequential REST calls for a complex template. Failure mid-way leaves partial copy.
- Fix: Create `duplicate_template` RPC.

**[3.8] WARNING: CreateAppointmentModal overlay click doesn't close modal**
- File: `src/components/CreateAppointmentModal.jsx:180`
- Detail: Overlay div has no onClick handler. `stopPropagation()` on inner modal suggests it was intended.
- Fix: Add `onClick={onClose}` to overlay div.

**[3.9] WARNING: ScheduleWizard date calc uses toISOString() — potential UTC date shift**
- File: `src/components/ScheduleWizard.jsx:250-264`
- Detail: `toISOString().split('T')[0]` returns UTC date. Near midnight in US Mountain Time, the date could shift by a day.
- Fix: Use `fmtDate()` (getFullYear/getMonth/getDate) instead.

**[3.P1] OK: Drag-and-drop** — Optimistic UI with rollback, snap-to-30-min, visual ghost preview.
**[3.P2] OK: Timezone handling** — All dates use YYYY-MM-DD with `T00:00:00` suffix to avoid UTC shift.
**[3.P3] OK: Calendar views** — Day/3Day/Week/Month all produce correct day arrays.
**[3.P4] OK: Escape key** — All modals handle Escape to close.
**[3.P5] OK: Loading/error/empty states** — All present across components.

---

## PHASE 2: Core Job & Claim Flows

### Files Reviewed
- `src/pages/Jobs.jsx` (312 lines)
- `src/pages/JobPage.jsx` (852 lines)
- `src/pages/ClaimsList.jsx` (274 lines)
- `src/pages/ClaimPage.jsx` (917 lines)
- `src/pages/Production.jsx` (606 lines)
- `src/components/CreateJobModal.jsx` (325 lines)
- `src/components/MergeModal.jsx` (415 lines)
- `src/components/AddRelatedJobModal.jsx` (224 lines)
- `src/lib/claimUtils.js`

### Phase 2 Findings

**[2.1] BUG: Production.jsx phase change omits `changed_by` in history insert**
- File: `src/pages/Production.jsx:177-178`
- Detail: `job_phase_history` insert has no `changed_by` field. Compare with `JobPage.jsx:83` which correctly includes it. Loses audit trail of who moved the kanban card.
- Fix: Destructure `employee` from `useAuth()` and pass `changed_by: employee?.id || null`.

**[2.2] BUG: ClaimPage InfoSection relies on side-effect chaining**
- File: `src/pages/ClaimPage.jsx:734`
- Detail: `const start = () => setF({...}) || setEd(true)` — works because setState returns undefined (falsy). If React ever changes setState return value, editing mode breaks.
- Fix: Use proper function body: `const start = () => { setF({...}); setEd(true); };`

**[2.3] BUG: MergeModal search input not URL-encoded in PostgREST filter**
- File: `src/components/MergeModal.jsx:108-112`
- Detail: Raw user input `q` interpolated into `name.ilike.*${q}*`. Special characters (`(`, `)`, `&`, `.`) can malform queries. Not SQL injection (PostgREST sanitizes) but causes errors.
- Fix: `encodeURIComponent(q)`.

**[2.4] WARNING: JobPage main loadJob swallows errors silently**
- File: `src/pages/JobPage.jsx:74`
- Detail: catch only does console.error — no toast, no error state, no retry. User sees blank page on failure.
- Fix: Add errToast and/or setLoadError state.

**[2.5] WARNING: JobPage race condition when rapidly switching between jobs**
- File: `src/pages/JobPage.jsx:53`
- Detail: useEffect depends on [jobId] but loadJob is async. Quick navigation between jobs lets old response overwrite new job's state.
- Fix: Use aborted/cancelled flag in effect cleanup.

**[2.6] WARNING: ClaimPage passes empty `employees={[]}` to AddRelatedJobModal**
- File: `src/pages/ClaimPage.jsx:395-396`
- Detail: PM/Lead Tech dropdowns in AddRelatedJobModal will always be empty when launched from ClaimPage.
- Fix: Fetch employees in ClaimPage or lazy-load in AddRelatedJobModal.

**[2.7] WARNING: Production list view has no empty state for filtered results**
- File: `src/pages/Production.jsx:377-426`
- Detail: When filters result in 0 jobs, table renders with just headers and empty tbody.
- Fix: Add empty state row.

**[2.8] WARNING: Dead code `_DIVISION_COLORS_UNUSED` in Jobs.jsx**
- File: `src/pages/Jobs.jsx:19-25`
- Fix: Delete.

**[2.9] SUGGESTION: File upload doesn't sanitize filenames**
- File: `src/pages/JobPage.jsx:718-719`
- Detail: User-provided filename used directly in storage path. Special characters could cause issues.
- Fix: Strip non-alphanumeric except dots/hyphens.

**[2.10] SUGGESTION: ClaimsList job pills use window.location.href instead of navigate()**
- File: `src/pages/ClaimsList.jsx:259`
- Fix: Use `navigate()` for SPA navigation.

**[2.P1] OK: Two-click confirm** — Used correctly for supplements, files, and signed docs in JobPage.
**[2.P2] OK: Phase history** — JobPage correctly inserts from_phase/to_phase/changed_by/changed_at.
**[2.P3] OK: Optimistic phase change** — Production.jsx updates UI immediately, rolls back on failure.
**[2.P4] OK: Merge impact preview** — MergeModal shows affected record counts before executing.
**[2.P5] OK: ClaimsList** — Best-implemented list page: useCallback, toast, retry, context-aware empty state.
**[2.P6] OK: Soft delete** — ClaimPage uses type-to-confirm "DELETE" for claim deletion.

---

## PHASE 6: E-Sign System

### Files Reviewed
- `src/pages/SignPage.jsx` (536 lines)
- `src/pages/WorkAuthSigning.jsx` (538 lines)
- `src/components/SendEsignModal.jsx` (397 lines)
- `functions/api/send-esign.js` (197 lines)
- `functions/api/submit-esign.js` (515 lines)
- `functions/api/resend-esign.js` (169 lines)
- `functions/api/track-open.js` (50 lines)

### Phase 6 Findings

**[6.1] BUG: Tracking pixel URL hardcoded to dev domain in send-esign.js**
- File: `functions/api/send-esign.js:187`
- Detail: Pixel src is `https://dev.utahpros.app/api/track-open?t=${token}` instead of using `APP_URL`. Production emails point tracking at the wrong environment.
- Fix: Replace with `${getAppUrl(env)}/api/track-open?t=${token}`.

**[6.2] BUG: Same hardcoded dev URL in resend-esign.js tracking pixel**
- File: `functions/api/resend-esign.js:159`
- Fix: Same as 6.1.

**[6.3] BUG: WorkAuthSigning.jsx is a non-functional prototype with hardcoded sample data**
- File: `src/pages/WorkAuthSigning.jsx`
- Detail: Uses `useState(SAMPLE_CLAIM)` with fake data. Submit is a `setTimeout(1500)` with no backend call. Supabase insert is commented out. Uses Tailwind classes but project has no Tailwind — renders completely unstyled. Route `/work-auth` is live and public.
- Fix: Remove file and route, or integrate with actual e-sign flow.

**[6.4] WARNING: HTML injection — signer_name injected unescaped into email HTML**
- File: `functions/api/send-esign.js:151`, `resend-esign.js:137`, `submit-esign.js:153`
- Detail: `signer_name.split(' ')[0]` interpolated into `<p>Hi ${first},</p>`. If name contains HTML like `<img onerror=...>`, it's injected into email. Most clients strip scripts but not all vectors.
- Fix: HTML-escape all user strings before interpolation: `s.replace(/&/g,'&amp;').replace(/</g,'&lt;')...`

**[6.5] WARNING: Race condition on double-submit — status check not atomic with completion**
- File: `functions/api/submit-esign.js:54-58 vs 105`
- Detail: Check status='pending' at step 1, generate PDF at step 2-3, call complete_sign_request at step 4. Second concurrent submit could pass step 1 before first reaches step 4.
- Fix: Ensure `complete_sign_request` RPC does `UPDATE ... WHERE status='pending'` atomically and returns 0 rows if already signed.

**[6.6] WARNING: resend-esign does not check expires_at**
- File: `functions/api/resend-esign.js:58-59`
- Detail: Only checks 'signed' and 'cancelled' status. Expired sign requests can be resent, delivering links that show "expired" when clicked.
- Fix: Add expiration check before resending.

**[6.7] WARNING: No authentication on send-esign/resend-esign endpoints**
- File: `functions/api/send-esign.js`, `functions/api/resend-esign.js`
- Detail: Neither endpoint verifies caller is authenticated. Anyone who POSTs with a valid job_id UUID can create sign requests and trigger SendGrid emails.
- Fix: Validate Authorization header (Bearer token) via Supabase Auth.

**[6.8] WARNING: Fake email stored for "collect" mode sign requests**
- File: `src/components/SendEsignModal.jsx:112`
- Detail: Collect mode sends `collect-${Date.now()}@noemail.local`. Stored in DB. If someone resends, email goes to non-existent domain.
- Fix: Store null for collect mode; check in resend endpoint.

**[6.9] SUGGESTION: substituteVars diverges between frontend and backend**
- File: `src/pages/SignPage.jsx:85-111` vs `functions/api/submit-esign.js:182-206`
- Detail: Frontend handles `{{date}}` and `{{adjuster_name}}` with fallback to `job.adjuster`. Backend doesn't handle `{{date}}` and falls back to `job.adjuster_name`. Preview may differ from signed PDF.
- Fix: Synchronize both implementations.

**[6.10] SUGGESTION: Unsubstituted `{{variables}}` leak into PDF**
- File: `functions/api/submit-esign.js:182-206`
- Detail: Template typos like `{{clent_name}}` appear literally in signed PDF.
- Fix: Strip remaining `{{...}}` patterns after substitution.

**[6.P1] OK: Token security** — UUIDs from `gen_random_uuid()` (~122 bits entropy).
**[6.P2] OK: Canvas DPR** — Retina handling correct with devicePixelRatio scaling.
**[6.P3] OK: Type/Draw detection** — Uses `(hover: hover) and (pointer: fine)` media query.
**[6.P4] OK: Multi-page PDF** — `needY()` creates new pages, footer on every page.
**[6.P5] OK: Tracking pixel** — Valid 1x1 GIF, no-cache headers, atomic RPC increment.

---

## PHASE 7: Customers, Contacts & Collections

### Files Reviewed
- `src/pages/Customers.jsx` (110 lines)
- `src/pages/CustomerPage.jsx` (478 lines)
- `src/pages/Collections.jsx` (9 lines)
- `src/pages/ClaimCollectionPage.jsx` (780 lines)
- `src/components/collections/ARPage.jsx` (192 lines)

### Phase 7 Findings

**[7.1] BUG: Floating-point money accumulation in AR KPI calculations**
- File: `src/components/collections/ARPage.jsx:40-49`
- Detail: `.reduce((s, r) => s + Number(r[key] || 0), 0)` accumulates IEEE 754 errors. With many claims, visible rounding errors appear (e.g., $30.299999 instead of $30.30). Same issue in `ClaimCollectionPage.jsx:60-77`.
- Fix: Round after each reduction: `Math.round((s + Number(r[key] || 0)) * 100) / 100`.

**[7.2] WARNING: CustomerPage loadData not wrapped in useCallback**
- File: `src/pages/CustomerPage.jsx:68-78`
- Detail: `loadData` closes over `db` and `contactId` but not in useEffect dependency array. Child components receiving it as `onReload` may trigger stale closures.
- Fix: Wrap in `useCallback([db, contactId])`.

**[7.3] WARNING: ClaimCollectionPage floating-point balance comparison**
- File: `src/pages/ClaimCollectionPage.jsx:105-109`
- Detail: `(balance - deductible) <= 0` compares floats. Non-round values could yield tiny epsilon differences.
- Fix: Use tolerance: `<= 0.005`.

---

## PHASE 8: Admin, Settings & Encircle

### Files Reviewed
- `src/pages/Admin.jsx` (1248 lines)
- `src/pages/Settings.jsx` (707 lines)
- `src/pages/EncircleImport.jsx` (592 lines)
- `functions/api/encircle-import.js` (326 lines)
- `functions/api/sync-encircle.js` (223 lines)

### Phase 8 Findings

**[8.1] BUG: Admin.jsx loadEmployees has stale `db` closure**
- File: `src/pages/Admin.jsx:129`
- Detail: `useCallback(async () => { ... }, [])` uses `db` but doesn't list it as dependency. After token refresh, stale `db` client causes 401s. Same issue in PermissionsTab ~line 760.
- Fix: Add `db` to dependency arrays.

**[8.2] WARNING: Encircle import/search workers have no authentication**
- File: `functions/api/encircle-import.js:298-310`
- Detail: GET handler for search/get has no auth check. Any unauthenticated request can search Encircle claims and retrieve PII (name, phone, email, address). POST import handler also unauthenticated.
- Fix: Add Bearer token validation via Supabase Auth.

**[8.3] WARNING: sync-encircle GET endpoint is publicly accessible**
- File: `functions/api/sync-encircle.js:216-223`
- Detail: GET /api/sync-encircle triggers bulk import with no auth. Anyone can hit this endpoint.
- Fix: Add auth validation or remove GET handler (keep POST for cron only).

**[8.4] WARNING: sync-encircle creates all jobs as 'reconstruction' division**
- File: `functions/api/sync-encircle.js:104`
- Detail: Hardcoded `division: 'reconstruction'` regardless of actual loss type.
- Fix: Map Encircle `type_of_loss` to appropriate division.

**[8.5] WARNING: Contact dedup only checks phone, not email**
- File: `functions/api/sync-encircle.js:139-146`, `encircle-import.js:150-158`
- Detail: If contact exists with same name/email but different phone, duplicate created.
- Fix: Add email fallback check before creating new contact.

---

## PHASE 9: Tech Mobile Creation Flows

### Files Reviewed
- `src/pages/tech/TechNewCustomer.jsx` (278 lines)
- `src/pages/tech/TechNewJob.jsx` (595 lines)
- `src/pages/tech/TechNewAppointment.jsx` (659 lines)
- `src/pages/tech/TechClaims.jsx` (187 lines)
- `src/lib/phone.js`

### Phase 9 Findings

**[9.1] BUG: normalizePhone returns invalid E.164 for short/empty input**
- File: `src/lib/phone.js:6-9`
- Detail: Single character "5" produces "+5". Spaces produce "+". No length validation. Garbage phone numbers can be stored in DB.
- Fix: Return null for inputs producing fewer than 10 digits.

**[9.2] WARNING: Tech form inputs at 15px trigger iOS Safari auto-zoom**
- File: `src/pages/tech/TechNewCustomer.jsx:18`, `TechNewJob.jsx:37`
- Detail: `--tech-text-body` is 15px — below iOS 16px threshold. Focus on any input causes page zoom on iPhone.
- Fix: Set `fontSize: 16` on all tech form inputs, or change `--tech-text-body` to 16px.

**[9.3] WARNING: TechNewAppointment job search uses raw input in PostgREST filter**
- File: `src/pages/tech/TechNewAppointment.jsx:91-92`
- Detail: Raw user input interpolated into `ilike` filter. Special PostgREST characters can malform query.
- Fix: `encodeURIComponent(q.trim())`.

**[9.4] WARNING: TechNewCustomer sets tags as string '[]' instead of JSON array**
- File: `src/pages/tech/TechNewCustomer.jsx:53`, `TechNewJob.jsx:142`
- Detail: `tags: '[]'` stores string literal. Code doing `Array.isArray(c.tags)` will fail.
- Fix: Use `tags: []` (actual array).

**[9.5] WARNING: 6+ duplicate phone formatting implementations**
- File: `src/lib/phone.js`, `format.js`, `claimUtils.js`, `CustomerPage.jsx`, `Customers.jsx`, `TechNewJob.jsx`
- Detail: At least 6 separate implementations of phone formatting/normalization scattered across codebase.
- Fix: Consolidate to `src/lib/phone.js` for normalization and `src/lib/format.js` for display.

---

## PHASE 10: Layout, Shared Components & CSS Cleanup

### Files Reviewed
- `src/components/Layout.jsx` (242 lines)
- `src/components/Sidebar.jsx` (174 lines)
- `src/components/ErrorBoundary.jsx` (98 lines)
- `src/lib/format.js`, `src/lib/phone.js`, `src/lib/toast.js`

### Phase 10 Findings

**[10.1] WARNING: Sidebar badge rendering is a no-op**
- File: `src/components/Sidebar.jsx:102`
- Detail: `{item.badge && null}` always evaluates to null. Conversations unread badge never shows in sidebar.
- Fix: Remove dead `badge` property or implement badge display.

**[10.2] WARNING: format.js `normalisePhone` has same validation gap as phone.js**
- File: `src/lib/format.js:83-89`
- Detail: Returns `'+' + digits` for any non-empty input. "+5" is invalid E.164.
- Fix: Add minimum 10-digit validation.

**[10.3] ORPHAN FILES (5 dead files to clean up):**
- `src/pages/ContactProfile.jsx` — replaced by CustomerPage.jsx, no imports anywhere
- `src/components/CreateCustomerModal.jsx` — replaced by AddContactModal, no imports
- `src/components/_RelatedJobsSection_patch.jsx` — temp patch file, no imports
- `src/pages/CreateJob.jsx` — not in App.jsx routes, replaced by CreateJobModal
- `src/components/EmptyState.jsx` — exists but never imported

**[10.P1] OK: Toast system** — `upr:toast` listener works, auto-dismiss, stacking.
**[10.P2] OK: ErrorBoundary** — Proper catch, recovery UI, dev mode error details.
**[10.P3] OK: Layout offline detection** — Online/offline events, banner shown.

---

## FINAL SUMMARY

### Stats by Phase

| Phase | BUGs | WARNINGs | SUGGESTIONs |
|-------|------|----------|-------------|
| 0: Database | 0 | 2 | 0 |
| 1: Auth | 0 | 2 | 1 |
| 2: Jobs & Claims | 3 | 4 | 2 |
| 3: Schedule | 4 | 5 | 0 |
| 4: Time & Tech | 4 | 5 | 0 |
| 5: Messaging | 1 | 3 | 0 |
| 6: E-Sign | 3 | 4 | 2 |
| 7: Collections | 1 | 2 | 0 |
| 8: Admin/Encircle | 1 | 4 | 0 |
| 9: Tech Create | 1 | 4 | 0 |
| 10: Layout/CSS | 0 | 2 | 1 (5 orphans) |
| **TOTAL** | **18** | **37** | **6** |

### Critical Blockers (fix before team onboarding)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 4.1 | `DIVISION_COLORS` undefined — crashes TimeTracking By Job view | Page crash | 1 min |
| 4.2 | Time entry delete has no two-click confirm | Accidental data loss | 15 min |
| 4.3-4.4 | Swipe-to-complete threshold wrong + double-toggle | Task completion broken | 20 min |
| 6.1-6.2 | Tracking pixel hardcoded to dev domain | Email tracking broken in prod | 2 min |
| 6.3 | WorkAuthSigning.jsx is dead prototype on live route | Confusing public page | 5 min |
| 9.1 | normalizePhone returns invalid E.164 | Garbage phone data in DB | 10 min |
| 5.7 | Group message sends comma-separated To (Twilio API misuse) | Group SMS broken | 15 min |
| 8.1 | Admin.jsx stale db closure after token refresh | Admin tabs break after 1hr | 5 min |

### High-Priority Warnings (likely to cause problems in daily use)

| # | Finding | Impact |
|---|---------|--------|
| 6.4 | HTML injection in email templates (signer_name unescaped) | Security risk |
| 6.7 | No auth on send-esign/resend-esign workers | Unauthorized esign creation |
| 8.2-8.3 | No auth on Encircle workers | PII exposure, unauthorized imports |
| 5.8 | Twilio signature validation silently skipped if token missing | Webhook spoofing |
| 3.1 | Race condition on rapid schedule navigation | Stale calendar data |
| 2.5 | Race condition on rapid job navigation | Wrong job data displayed |
| 9.2 | Tech inputs at 15px trigger iOS auto-zoom | Field tech frustration |
| 7.1 | Floating-point AR calculations | Visible money rounding errors |
| 3.2-3.3 | Non-atomic appointment crew inserts | Partial crew on failure |
| 2.1 | Production phase change omits changed_by | Missing audit trail |

### Recommended Fix Order

**Batch 1 — Quick wins (< 1 hour total, blocks removed):**
1. Fix `DIVISION_COLORS` rename in TimeTracking.jsx (1 min)
2. Fix tracking pixel URLs in send-esign.js + resend-esign.js (2 min)
3. Fix Admin.jsx stale db closures — add `db` to deps (5 min)
4. Fix normalizePhone validation (10 min)
5. Add two-click confirm to time entry delete (15 min)
6. Remove WorkAuthSigning.jsx route + file (5 min)
7. Fix Production.jsx missing changed_by (5 min)
8. Fix swipe threshold + double-toggle in TechTasks (15 min)

**Batch 2 — Security hardening (1-2 hours):**
1. Add auth to Encircle workers (encircle-import.js, sync-encircle.js)
2. Add auth to esign workers (send-esign.js, resend-esign.js)
3. HTML-escape user inputs in email builders
4. Log warning when TWILIO_AUTH_TOKEN is missing
5. Fix MergeModal + TechNewAppointment query encoding

**Batch 3 — Race conditions & atomicity (2-3 hours):**
1. Add request counter to Schedule.jsx loadBoard
2. Add abort pattern to JobPage.jsx loadJob
3. Fix group message Twilio API (loop per participant)
4. Add atomic complete_sign_request guard
5. Create appointment CRUD RPCs for atomic crew management

**Batch 4 — UX polish (1-2 hours):**
1. Fix touch targets below 48px (TechAppointment, TechDash, TechTasks)
2. Fix iOS auto-zoom (change --tech-text-body to 16px)
3. Fix floating-point money math in AR pages
4. Add empty states where missing
5. Fix ClaimPage employees={[]} for AddRelatedJobModal

**Batch 5 — Cleanup:**
1. Delete 5 orphan files
2. Delete dead code (_DIVISION_COLORS_UNUSED, etc.)
3. Consolidate phone formatting implementations
4. Fix tags string vs array issue
5. Update CLAUDE.md contacts schema documentation
