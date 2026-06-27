# Time Tracking — PR-7 Hand-off (admin UI) + PR-8 note

**Written:** 2026-06-27 · **Branch:** `claude/safari-pwa-time-tracking-n23e5s` · **Supabase:** `glsmljpabrwonfiltiqm` (one shared DB for dev + prod)

This is the pick-up doc for **PR-7 (the `TimeTracking.jsx` admin UI)** — the last big build in the
time-tracking plan. PR-1→PR-6 + a hotfix are **already shipped and live** (dev + main + prod). PR-7 is
**client-only** (it just wires the office page to RPCs that already exist). PR-8 (RLS hardening) is the
only thing after it.

---

## 1. What's already done & live (do NOT rebuild)

All on dev + main + the shared prod DB:

| PR | What | Key objects |
|----|------|-------------|
| PR-1 | Orphan fix + single-open invariant | `clock_appointment_action` omw fix; cols `auto_continued/continued_from/auto_split_seq/source`; partial unique idx `uq_jte_one_open_clock_per_employee` |
| PR-2 | Confirmed supersede (tech) | `clock_omw_precheck`; flag `clock_enforce_explicit_clockout` (OFF); `src/lib/clockPrecheck.js`; `src/components/tech/ClockSupersedeSheet.jsx`; wired in `TimeTracker.jsx` + `TechDash.jsx` |
| PR-3 | Midnight split + 5 PM banner | `apply_midnight_clock_split()` + 2 pg_cron jobs; TechDash red "still clocked in" banner (`denverHour()`) |
| hotfix | Deleted-appt no longer strands a clock | `clock_finish_entry(entry_id,employee_id)`; `BEFORE DELETE` trigger `trg_close_open_clocks_before_appt_delete` on `appointments` |
| PR-4 | Travel-inclusive labor cost | `total_cost` is a **GENERATED column** now `round((travel_minutes/60+hours)*rate,2)`; trigger reduced to rate-fill + updated_at |
| PR-5 | Admin read RPC | `get_timesheet_entries_admin(...)` |
| PR-6 | Admin write RPCs + tech change-requests | tables `time_entry_change_requests`, `time_entry_deletions`; `is_time_admin`, `admin_upsert_time_entry`, `admin_clock_out_entry`, `delete_time_entry`, `submit_time_entry_change_request`, `review_time_entry_change_request`; `get_timesheet_entries_admin` gained `has_pending_change` |

**First thing the new session should do:** `git checkout claude/safari-pwa-time-tracking-n23e5s && git pull`, then `npm install`, then read this doc + `UPR-Web-Context.md` (Employees & Time RPC section). The migration files are in `supabase/migrations/2026062[67]_*`.

---

## 2. The DB surface PR-7 consumes (all live — verified)

**Read:** `get_timesheet_entries_admin(p_start_date, p_end_date, p_employee_id default null, p_job_id default null, p_status default null, p_division default null)`
returns rows with: `id, job_id, employee_id, employee_name, job_number, insured_name, division, work_date, hours, hourly_rate, total_cost, work_type, description, approved, approved_by, travel_start, clock_in, on_site_end, clock_out, travel_minutes, total_paused_minutes, auto_continued, appointment_id, notes, created_at, duration_minutes, is_open, is_overlong, has_pending_change`.
`p_status` ∈ `open|approved|unapproved|overlong|null`. `p_employee_id` null = all.

**Writes (all `SECURITY DEFINER`, role-checked):**
- `admin_upsert_time_entry(p_actor_id, p_id, p_employee_id, p_job_id, p_work_date, p_hours, p_clock_in, p_clock_out, p_travel_start, p_on_site_end, p_travel_minutes, p_total_paused_minutes, p_work_type, p_description, p_notes, p_override_approved)` — `p_id` null = insert. Use **named params** via `db.rpc`.
- `admin_clock_out_entry(p_id, p_actor_id, p_clock_out default now())`
- `delete_time_entry(p_id, p_reason, p_actor_id)`
- `submit_time_entry_change_request(p_entry_id, p_proposed jsonb, p_tech_note, p_actor_id)` — owner-only (the tech view)
- `review_time_entry_change_request(p_request_id, p_approve, p_actor_id, p_review_note)` — admin
- Existing (keep using): `approve_time_entries(p_entry_ids[], p_approved_by, p_approved)`; legacy `upsert_time_entry(...)` and `get_timesheet_entries(...)` still exist — **the current page uses these; PR-7 should migrate the Timesheet tab to the `_admin` read + `admin_*` writes.**

**Role tiers:** admin-tier = `{admin, office, project_manager, supervisor}` (use `is_time_admin` server-side; client can gate UI on `employee.role`). Techs only see their own rows + may submit change requests.

**Error codes** (RPCs `RAISE ... ERRCODE='P0001'` with these messages; `db.rpc` throws `Error("RPC <fn>: <status> <body>")`, so **substring-match** `e.message`):
`NOT_AUTHORIZED`, `ENTRY_NOT_FOUND`, `ENTRY_APPROVED_LOCKED`, `OPEN_ENTRY_EXISTS`, `BAD_ORDER_*` (4 variants), `MISSING_REQUIRED_FIELDS`, `ALREADY_CLOSED`, `ENTRY_APPROVED_CANNOT_DELETE`, `NOT_OWNER`, `REQUEST_NOT_FOUND`, `REQUEST_ALREADY_REVIEWED`. Also raw Postgres `23505` (unique index) can surface if the invariant pre-check is bypassed — treat like `OPEN_ENTRY_EXISTS`.

`proposed` jsonb keys the tech change-request supports: `work_date, hours, clock_in, clock_out, travel_minutes, description, notes`.

---

## 3. What PR-7 builds (scope, from the build plan §PR-7)

File: **`src/pages/TimeTracking.jsx`** (currently: tabs Status Board / Timesheet / By Job / Payroll; `TimesheetView`, `JobView`, `PayrollView`, `EntryModal`, `SummaryCard`). Enhance the **Timesheet** tab; add an **approval queue** and a **tech view**.

**a. Filters** (default to **current semi-monthly period**: 1st–15th or 16th–EOM) + employee multi-select, job, division, and status (open/unapproved/overlong). Wire to `get_timesheet_entries_admin`.

**b. Inline cell edit** on Timesheet rows (`clock_in`/`clock_out`/`hours`/`work_date`/`job`) → optimistic update → `admin_upsert_time_entry` → on `OPEN_ENTRY_EXISTS`/`23505`/`BAD_ORDER_*` revert + toast. Pass `p_actor_id = employee.id`.

**c. Row actions:** Edit · Clock out (`admin_clock_out_entry`) · Backfill (insert via `admin_upsert_time_entry` with null `p_id`) · Duplicate · Delete (`delete_time_entry`, needs a reason — use the two-click confirm or a small reason prompt, **no native dialogs**).

**d. Bulk:** approve/unapprove (existing `approve_time_entries`), bulk clock-out, bulk delete, with running totals.

**e. Approval queue** (new sub-view/tab): list pending `time_entry_change_requests` (read the table via `db.select`/realtime), show a **diff** of `proposed` vs the current entry + the tech note, with Approve/Reject → `review_time_entry_change_request`.

**f. Tech view:** when `employee.role === 'field_tech'`, show only their own rows; "edit" opens a **request form** → `submit_time_entry_change_request` (no direct add/delete). (This may live in the tech app or the shared page — decide with the user; the RPC is owner-checked either way.)

**g. Approved-edit:** one-click "Unapprove & edit" (call `approve_time_entries([id], actor, false)` then open editor; or `admin_upsert_time_entry(..., p_override_approved=>true)`).

**h. Realtime:** subscribe to `job_time_entries` + `time_entry_change_requests` to live-refresh. See `src/lib/realtime.js` (`subscribeToNotifications` is the existing pattern; add a generic table subscription or reload-on-change).

**i. Badges:** `OPEN` (`is_open`), **red `is_overlong`**, `auto_continued`, pending-edit (`has_pending_change`), approved-lock.

---

## 4. Patterns to follow (this codebase)

- `const { db, employee } = useAuth()` — never import `db` directly. `db.rpc(fn, {named params})`, `db.select(table, query)`, `db.update`, `db.delete`.
- Toasts only: `import { toast } from '@/lib/toast'` → `toast(msg, 'success'|'error')` (or the `upr:toast` CustomEvent). **No `alert()`/`confirm()`** — destructive actions use **inline two-click confirm** (red → "Confirm" → execute, `onBlur` cancels). See `TimeTracking.jsx` `handleDelete` + `TimeTracker.jsx` `confirmFinish`.
- Existing CSS classes on the page: `tt-page, tt-topbar, tt-view-tabs, tt-filters, tt-table, tt-summary-card, tt-status, tt-icon-btn, tt-modal*` (in `index.css`). Reuse them; add new ones there if needed.
- Mobile-only CSS changes go under `@media (max-width:768px)`; don't disturb desktop.
- The page is feature-flagged `page:time_tracking`; Status Board is `BOARD_ROLES` only.

---

## 5. Gotchas / lessons learned (these bit us — heed them)

1. **`total_cost` is a GENERATED column** — never write it; set `hours`/`travel_minutes`/rate and it recomputes. The cost trigger only fills `hourly_rate` + `updated_at`.
2. **`jobs.division` is the `job_division` ENUM** and **`employees.role` is `employee_role` ENUM** — cast `::text` when comparing to text params. Introspect column types before assuming.
3. **Faithful preview branches:** Supabase branches come up nearly empty (the schema isn't in migration history). When validating DB on a branch you must hand-build a harness that **mirrors prod types exactly** (generated `total_cost`, the enums, the rate-fill trigger, the unique index) — otherwise tests pass on the branch and fail on prod. Two PRs got bitten by non-faithful harnesses.
4. **MCP admin SQL vs the app:** the Supabase MCP connection didn't fire the cost trigger's effect because `total_cost` is generated (assignment ignored) — that's expected; the app (PostgREST) behaves normally.
5. **`CREATE OR REPLACE FUNCTION` can't change return type** — if you add a column to a `RETURNS TABLE`, `DROP FUNCTION` first (hit this on `get_timesheet_entries_admin`).
6. **Branch cost:** preview branches bill ~$0.013/hr — **delete them when done** (`delete_branch`).

---

## 6. Validation + rollout (the rhythm we've used)

PR-7 is **client-only**, so:
1. Build in `TimeTracking.jsx` (+ any new components, `index.css`).
2. `npm run build` must be clean.
3. Manual UI check on the **dev** deploy (it's the office desktop page — you can actually see it; the DB RPCs are already live so it's fully exercisable). The `admin_*` RPCs will mutate **prod** data (shared DB) when tested on dev — use a throwaway/known entry or the admin account.
4. Ship: commit to the feature branch → merge to `dev` (push) → **PR feature→main** and merge.

**IMPORTANT deploy nuance:** `dev` currently carries an **unrelated google-drive feature** (another session) that is *not* on `main`. We've been opening **feature→main** PRs (not dev→main) so that work doesn't ride to production. Keep doing feature→main for PR-7 unless the user says the google-drive work is ready.

**Guardrails:** never push directly to `main` (PR only); don't modify `get_payroll_summary` (intentional internal estimate; it recomputes from hours×rate and is insulated from the cost change); don't reintroduce caching in `public/sw.js` (intentional kill-switch); never apply DB to prod without branch validation first; never fabricate a function body — introspect.

**Commit footer used this project:**
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: <session url>
```
Update `UPR-Web-Context.md` after PR-7 (new components / page behavior). Then delete this hand-off file when PR-7 lands (like the task-file protocol).

---

## 7. After PR-7 → PR-8 (RLS hardening, flagged "do last")

Tighten `job_time_entries` RLS so `field_tech` can't directly INSERT/UPDATE/DELETE via REST (force them through the RPCs); admin-tier scoped; keep reads as needed. **Prerequisite:** first confirm the admin page (post-PR-7) writes **only** via the `admin_*` RPCs, not direct PostgREST — or it'll break. The new tables `time_entry_change_requests`/`time_entry_deletions` already have RLS (reads open, writes via RPC). Re-run `get_advisors(type:'security')` after. Current `job_time_entries` policies are wide open (`USING true`).
