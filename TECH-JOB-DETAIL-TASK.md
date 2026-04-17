# TECH-JOB-DETAIL-TASK

**Status:** In progress
**Owner:** Moroni Salvador
**Created:** 2026-04-16
**Branch:** `dev` only

---

## Goal

Build a purpose-built mobile job detail page (`TechJobDetail.jsx`) to replace the desktop `JobPage` currently served at `/tech/jobs/:jobId`. Mirrors the `TechClaimDetail` playbook, adapted for a single-job context. Also build `TechJobAlbum.jsx` for the photo album entry.

**Simultaneously extract shared components to `src/components/tech/`** — Lightbox, ActionBar, Hero, NowNextTile, DetailRow, PhotosGroup, plus `src/lib/techDateUtils.js` for the small formatting helpers. The claim pages already use local copies; this task is the right moment to promote (3rd caller rule).

## Success criteria

- `/tech/jobs/:jobId` renders `TechJobDetail` with hero + action bar + NowNext + **full appointments list (Upcoming / Past groups)** + Photos & Notes + Collapsed Job details + admin kebab (Merge / Delete).
- `/tech/jobs/:jobId/photos` renders `TechJobAlbum` (single-group album, actual date+time captions, pinned Add Photo).
- Desktop `/jobs/:jobId` still renders old desktop `JobPage` untouched.
- `TechClaimDetail` and `TechClaimAlbum` work exactly the same as today, now sourced from shared components.
- No duplicated Lightbox / ActionBar / Hero / NowNextTile / DetailRow / PhotosGroup code between pages.

## Non-negotiables

Same rules as prior tech tasks. `dev` branch only. No `alert()` / `confirm()`. `useAuth()` for `db`. Commit every 2–3 files. Update `UPR-Web-Context.md` on completion.

## Data shape (audited)

- **No `get_job_detail` RPC** — fetch job row directly: `db.select('jobs', 'id=eq.' + jobId + '&select=*')`. Shape has all fields we need (`division`, `phase`, `status`, `job_number`, `insured_name`, `address/city/state/zip`, `client_phone`, `client_email`, `claim_id`, `adjuster_name/phone/email`, `deductible`, `date_of_loss`, `insurance_company`, `policy_number`, etc.).
- **`get_job_contacts(p_job_id)`** — returns linked contacts; use for primary homeowner display if present, else fall back to `jobs.insured_name` + `client_phone` / `client_email`.
- **Appointments:** reuse `get_claim_appointments(p_claim_id)` and filter `a.job_id === jobId` client-side. Avoids a new RPC; shape already has crew, task counts, status, times.
- **Task summary:** existing `get_job_task_summary(p_job_id)` — same as claim page job tile.
- **Documents:** `db.select('job_documents', 'job_id=eq.' + jobId + '&order=created_at.desc')` — single-job, no `in.()` needed.
- **Merge / Delete:** `MergeModal` supports `type="job"` (confirmed at MergeModal.jsx:271). Soft delete via `db.update('jobs', 'id=eq.' + jobId, { status: 'deleted', ... })` — mirrors the claim pattern.

## Files

### New
- `src/components/tech/Lightbox.jsx`
- `src/components/tech/ActionBar.jsx` — Call / Navigate / Message (3 buttons), props: `{ phone, address }`
- `src/components/tech/Hero.jsx` — prop-configurable: `{ division, emoji, title, subtitle, address, status, statusColors, topLabel, meta, onBack, showMenu, onMenu }`
- `src/components/tech/NowNextTile.jsx`
- `src/components/tech/DetailRow.jsx`
- `src/components/tech/PhotosGroup.jsx` — used by claim page, optional `isSingleJob` still applies for the single-group job page too
- `src/lib/techDateUtils.js` — `formatTime`, `relativeDate`, `photoDateTime`, `fileUrl`
- `src/pages/tech/TechJobDetail.jsx`
- `src/pages/tech/TechJobAlbum.jsx`

### Modified
- `src/App.jsx` — swap `/tech/jobs/:jobId` route, add `/tech/jobs/:jobId/photos`
- `src/pages/tech/TechClaimDetail.jsx` — import extracted components, remove local copies
- `src/pages/tech/TechClaimAlbum.jsx` — import extracted Lightbox and helpers, remove local copies
- `UPR-Web-Context.md` — on completion

### Not modified
- Desktop `JobPage.jsx`. `TechAppointment.jsx` (separate refactor; its ActionBar has 5 buttons not 3 — leaving alone).

## Page composition — TechJobDetail

```
┌──────────────────────────────────────────┐
│ ← Back                         ⋯         │  slim back bar inside gradient
├──────────────────────────────────────────┤
│ ╔═══ DIVISION GRADIENT HERO ═══╗         │
│ ║ 💧  W-2604-258       ● Lead  ║         │  top label = job number
│ ║ Page Vorwlaer                ║         │  insured name 24/700
│ ║ 1050 W 100 N, Provo, USA     ║         │  tappable
│ ║ Apr 15, 2026 · Water · Lead  ║         │  meta
│ ║ [ Call ] [ Nav ] [ Msg ]     ║         │
│ ╚══════════════════════════════╝         │
├──────────────────────────────────────────┤
│  Part of CLM-2604-060 →                  │  thin row, tap → /tech/claims/:id
├──────────────────────────────────────────┤
│  NOW / NEXT (contextual, filtered)       │
├──────────────────────────────────────────┤
│  APPOINTMENTS (5)                        │  full list, grouped
│    UPCOMING                              │
│    [ appt tile ]                         │
│    [ appt tile ]                         │
│    PAST                                  │
│    [ appt tile ]                         │
├──────────────────────────────────────────┤
│  PHOTOS & NOTES (12)        See all →    │
│  [3-up thumbs]  [notes list]             │
│  [ + Add Photo ] [ + Add Note ]          │
├──────────────────────────────────────────┤
│  ▼ Job details (collapsed)               │
└──────────────────────────────────────────┘
```

### Appointments section — grouping rules

- Filter claim's appointments to `a.job_id === jobId`.
- Group:
  - **UPCOMING** = `date >= today && status not in ('completed','cancelled')` sorted asc.
  - **PAST** = everything else, sorted desc.
- Empty state: if no appointments at all, show muted `No appointments yet` + optional "Schedule one" link to `/tech/new-appointment?jobId=...` (if that route accepts it — check; otherwise just hint).

### Status / Phase pill

Two pills in the hero meta row:
- **Phase** (Lead / Production / Estimate / Closed / …) — division-tinted pill
- **Status** (active / paused / deleted) — neutral pill

The hero's small top-right "status dot" pill shows the **Phase** (more meaningful than "active").

## Page composition — TechJobAlbum

Mirror `TechClaimAlbum` — same slim top bar (title "Photos", subtitle "W-2604-258 · Page Vorwlaer"), division-tinted strip, 2-col grid with date+time captions, pinned Add Photo. But:
- Always single-group (no mini-header — same as single-job claim case)
- No multi-job picker needed; photo uploads go straight to this job
- Back button returns to `/tech/jobs/:jobId`

## Phases

### Phase 0 — Prep: build shared components (no behavior change yet)

1. Create `src/lib/techDateUtils.js` with `formatTime`, `relativeDate`, `photoDateTime`, `fileUrl`.
2. Create components in `src/components/tech/`:
   - `Lightbox.jsx` — lift-and-shift from `TechClaimDetail.jsx`.
   - `ActionBar.jsx` — lift from `TechClaimDetail.jsx`.
   - `Hero.jsx` — generalize with props so both claim and job can configure.
     - Props: `{ division, emoji, topLabel, title, subtitle, address, status, statusColors, meta, onBack, showMenu, onMenu, backLabel }`.
     - Render structure matches current claim hero exactly; claim page instantiates with `topLabel={claim_number}`, job page with `topLabel={job_number}`.
   - `NowNextTile.jsx` — lift from `TechClaimDetail.jsx`.
   - `DetailRow.jsx` — lift from `TechClaimDetail.jsx`.
   - `PhotosGroup.jsx` — lift from `TechClaimDetail.jsx`. Props unchanged.
3. Update `TechClaimDetail.jsx` to import from new locations, delete local copies.
4. Update `TechClaimAlbum.jsx` to import `Lightbox` + `photoDateTime` + `fileUrl`, delete local copies.
5. Verify claim page + album still work (snapshot test in preview).

**Checkpoint:** Commit as `refactor(tech): extract shared components to components/tech/`.

### Phase 1 — TechJobDetail scaffold + hero + route swap

1. Create `src/pages/tech/TechJobDetail.jsx`:
   - `useParams()` for `jobId`.
   - Load: `jobs` row (direct select), `get_job_contacts`, `get_claim_appointments` (using `job.claim_id`), `get_job_task_summary` in `Promise.all`.
   - Derive `division`, `insuredName` (contact > job.insured_name), `phone` (contact > job.client_phone), `address`.
   - Render `<Hero>` with job-appropriate props.
   - Render `<ActionBar>` below hero.
   - "Part of CLM-XXXX →" row linking to the claim.
2. Swap route in `src/App.jsx`: `/tech/jobs/:jobId` → `TechJobDetail` (was `JobPage`).
3. Verify at `/tech/jobs/<jobId>` — known good id: `8acdcf87-4716-480a-920d-a6df6e0f625b` (W-2604-258).

**Checkpoint:** Hero + action bar + claim-link row work. Commit.

### Phase 2 — NowNext + Appointments list

1. Compute `jobAppointments = allClaimAppointments.filter(a => a.job_id === jobId)`.
2. `<NowNextTile>` with `jobAppointments`.
3. New `AppointmentsSection` component (can live in page for now):
   - Group UPCOMING / PAST per rules above.
   - Each appointment → a card with: title, job_number (compact since same for all), date, time, status pill, crew initials, task_completed/task_total.
   - Tap → `/tech/appointment/:id`.
4. Empty state.

**Checkpoint:** Commit.

### Phase 3 — Photos & Notes + Album page + route

1. Render `<PhotosGroup>` in single-group mode (no division header) under a "PHOTOS & NOTES" label with "See all →" to `/tech/jobs/:id/photos`.
2. Add Photo / Add Note flows: simpler than claim (no picker — single job). Same upload logic + inline note composer.
3. Lightbox integration.
4. Create `src/pages/tech/TechJobAlbum.jsx`:
   - Mirror `TechClaimAlbum` structure but skip the job-grouping logic (single group).
   - Back navigates to `/tech/jobs/:jobId`.
   - Slim top bar title = job number + insured name.
   - Pinned Add Photo (no picker sheet).
5. Add route `/tech/jobs/:jobId/photos` in `App.jsx`.

**Checkpoint:** Commit.

### Phase 4 — Collapsed Job details + admin kebab

1. Collapsed "Job details" panel at bottom: contact (homeowner), adjuster (name/phone/email if present), deductible (admin/manager only), date of loss, insurance company, policy number, notes.
2. Admin kebab bottom sheet with:
   - **Merge job** → `<MergeModal type="job" keepRecord={job} ...>`.
   - **Delete job** → same DELETE-to-confirm dialog pattern as claim. Soft-delete via `db.update('jobs', 'id=eq.' + jobId, { status: 'deleted' })`, then navigate back to `/tech/claims/:claimId` (return to the parent claim).

**Checkpoint:** Commit.

### Phase 5 — Polish + verification

- Entry animation (`.tech-page-enter`).
- `PullToRefresh` wrapping content below ActionBar.
- `statusBarLight()` on mount, `statusBarDark()` on unmount.
- Verify in preview with a real job (8acdcf87-4716-480a-920d-a6df6e0f625b).
- Verify desktop `/jobs/:id` still renders old page.
- Verify admin kebab visible for admin, hidden for field_tech.

### Phase 6 — Context doc + cleanup

Update `UPR-Web-Context.md`:
- File structure: add `TechJobDetail.jsx`, `TechJobAlbum.jsx`, `src/components/tech/*`, `src/lib/techDateUtils.js`.
- Design system: mark the reusable components as promoted. Note that TechClaimDetail / TechClaimAlbum / TechJobDetail / TechJobAlbum all share them.
- Known Pending Items: mark entry 10 (TechJobDetail follow-up) as complete; strike through the extraction note.

`git rm TECH-JOB-DETAIL-TASK.md` and commit.

---

## Open questions

None — user confirmed full appointments list, admin Merge/Delete for jobs, and extraction done alongside this task.
