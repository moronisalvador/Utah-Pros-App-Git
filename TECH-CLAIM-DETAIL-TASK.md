# TECH-CLAIM-DETAIL-TASK

**Status:** In progress
**Owner:** Moroni Salvador
**Created:** 2026-04-16
**Branch:** `dev` only

---

## Goal

Replace the shared desktop `ClaimPage` currently served at `/tech/claims/:claimId` with a purpose-built mobile page, `TechClaimDetail.jsx`, designed for the **64-year-old field tech in gloves, standing in a flooded basement** persona.

The desktop `ClaimPage` at `/claims/:claimId` is **NOT** changing. This task creates a new component and swaps only the tech route.

### Feedback driving this work

Three techs + Ben reported the current mobile claim page is not field/employee-friendly. Five collapsed accordions (Jobs, Schedule, Documents, Info, Activity) bury the actions a tech cares about and look like a desktop page crammed into a phone.

### Success criteria

- Primary tech actions (**Call · Navigate · Message**) are visible without scrolling.
- The next appointment for this claim (if any) is visible without tapping.
- The job(s) under the claim are shown as large tiles, auto-expanded when there's only one.
- No accordion is required to see basic claim identity (insured, address, status, loss type).
- Office-only concepts (Activity log, Financials, Merge) are not visible by default on the tech view.
- Page survives a cold load on a 4G connection in under 2 seconds to first paint, ≤ 4s to full data.

---

## 🔁 Reusable patterns — this is also the blueprint for `TechJobDetail`

The desktop `JobPage` has the same "mobile-packed-desktop" problem as `ClaimPage`. A follow-up task (`TECH-JOB-DETAIL-TASK.md`) will rebuild it with the same playbook. **Build this task with that reuse in mind** — but follow CLAUDE.md: don't create premature abstractions. Three similar lines is better than a shared component that only has one caller.

### What to build as local components inside `TechClaimDetail.jsx` (for now)

Keep these as function components inside the file. After `TechJobDetail` is built and actually uses them, we promote the ones with ≥2 call sites to `src/components/tech/`.

| Local component | Candidate for reuse on Job page? | What makes it reusable |
|---|---|---|
| `HeroCard` (division gradient + name + address + 3-button action bar) | **Yes, high** | Job page needs same hero. Props: `{ gradient, icon, title, subtitle, address, phone, status, badge }`. |
| `ActionBar` (Call · Navigate · Message) | **Yes, high** | Identical on job page. Already a near-duplicate in `TechAppointment` — do not refactor those yet, just make this one self-contained so both future refactors converge cleanly. |
| `NowNextTile` | **Yes** | Job page shows next appt for that job specifically. Same 4-case logic, scoped to one job. |
| `JobTile` | **No** (job page IS the job) | Claim-specific. |
| `PhotosNotesModule` (grouped by job) | **Partially** | Job page is a single group. Factor the "photo group" sub-unit so it can render standalone. |
| `PhotoAlbumLightbox` | **Yes, high** | Job page opens the same album. Make this easy to extract — keep it self-contained with no claim-specific props. |
| `ClaimDetailsCollapsed` (bottom reference info) | **No** | Job page has a different info shape. |

### Conventions the job page will inherit

Establish these clearly in this task so the job page is a copy-and-adapt, not a rewrite:

- **Page structure:** `TopBar → Hero → NowNext → [entity-specific body] → Photos & Notes → Collapsed details`. Job page swaps the body.
- **CSS class naming:** `.tech-hero`, `.tech-action-bar`, `.tech-now-next`, `.tech-photos-group`, `.tech-lightbox`, `.tech-collapsed-section`. Use these — do **not** name classes `.tech-claim-hero`. The job page will reuse the same class names.
- **Data loading:** single `load()` that does the primary fetch with `Promise.all` for parallel secondary fetches. Error + loading states match `TechAppointment`.
- **Status bar:** `statusBarLight()` on mount, `statusBarDark()` on unmount (dark gradient hero requirement).
- **Pull-to-refresh:** `<PullToRefresh>` wraps content **below** the fixed top bar, not around it.
- **Photo upload:** `insert_job_document` RPC, `p_appointment_id: null` for entity-level (not appt-level) uploads.

### What gets extracted to shared files after **both** pages exist

Nothing in this task — we wait until `TechJobDetail` is drafted to see which abstractions hold up. But commit messages for reusable components should note "future: extract to components/tech" so they're easy to find.

---

## NON-NEGOTIABLES (from CLAUDE.md — re-listed for this task)

1. Read files from disk before editing. No assuming contents.
2. Never use `alert()` or `confirm()`. Toasts via `window.dispatchEvent('upr:toast', …)` or inline two-click confirm.
3. Always `const { db } = useAuth()`. Never import `db` directly.
4. `dev` branch only.
5. Mobile CSS via `@media (max-width: 768px)` when adding to `index.css`. Never change desktop layout.
6. Commit every 2–3 files with clear messages.
7. Use `db.rpc()` for data — prefer existing RPCs, only create new ones if necessary.
8. Verify column names before querying.
9. Do not break the desktop `ClaimPage` — it is still used at `/claims/:claimId`.
10. Update `UPR-Web-Context.md` on completion; then `git rm` this file.
11. `viewport-fit=cover` stays. Bottom safe area stays on `.tech-nav`.

---

## Files affected

### New
- `src/pages/tech/TechClaimDetail.jsx` — the new mobile page.

### Modified
- `src/App.jsx` — swap the `/tech/claims/:claimId` route to `TechClaimDetail`.
- `src/index.css` — new `.tech-claim-*` scoped styles inside `@media (max-width: 768px)` where appropriate, or under a `.tech-layout` ancestor selector.
- `src/pages/tech/TechAppointment.jsx` — fix the Message button (currently navigates to `/tech/conversations`, should open native `sms:{phone}` like we're doing on the new claim page). Small, targeted change in Phase 1.
- `UPR-Web-Context.md` — documented on completion.

### Do not modify
- `src/pages/ClaimPage.jsx` — desktop stays as-is.
- `src/pages/tech/TechClaims.jsx` — list page is out of scope for this task.
- `src/lib/supabase.js`, `src/contexts/AuthContext.jsx`, `src/components/Layout.jsx`, `src/components/TechLayout.jsx`.

---

## Data model — what we can reuse vs what we need

### Existing RPCs we'll call

| RPC | Returns | Notes |
|---|---|---|
| `get_claim_detail(p_claim_id)` | `{ claim, jobs[], contact, adjuster }` | Primary load. Same as desktop. |
| `get_claim_appointments(p_claim_id)` | `appointments[]` with `status, date, time_start, crew[], task_total, task_completed, division, job_number` | Used for Now/Next module. Filter client-side. |
| `get_job_task_summary(p_job_id)` | `{ total, completed, by_phase[] }` | For inline progress bar on each job tile. |

### Existing query patterns we'll reuse

- **Photos & Notes fetch** — query `job_documents` for all `job_id` in `(jobs[].id)` like the desktop page already does:
  ```
  db.select('job_documents', `job_id=in.(${ids})&order=created_at.desc`)
  ```
- **Photo upload** — same `POST /storage/v1/object/job-files/{jobId}/{ts}-{name}` + `insert_job_document` RPC pattern from [TechAppointment.jsx:95-120](src/pages/tech/TechAppointment.jsx).

### Do we need a new RPC?

**Not for Phase 1–4.** The existing RPCs give us everything. We deliberately skip `get_claim_activity` (office-only) and financials.

**Potential future optimization (not in this task):** a single `get_tech_claim_detail(p_claim_id, p_employee_id)` that returns claim + jobs + next appointment + task summaries + recent photos in one round-trip. Flag this as a follow-up if the page feels slow in testing.

---

## Design spec — page composition (top to bottom)

```
┌─────────────────────────────────────────┐
│ ← Claims                        ⋯       │  slim top bar (44px)
├─────────────────────────────────────────┤
│                                         │
│  ╔═══ DIVISION GRADIENT HERO ═══╗      │
│  ║  💧  W-2604-258   ● Open      ║      │  loss-type icon 40px,
│  ║  Page Vorwlaer                ║      │  name 24px bold,
│  ║  123 Elm St · Provo, UT       ║      │  address tappable → Maps
│  ║                               ║      │
│  ║  [ Call ] [ Navigate ] [ Msg ]║      │  3-button action bar, 56px
│  ╚═══════════════════════════════╝      │
│                                         │
├─────────────────────────────────────────┤
│  ▶ NOW / NEXT MODULE (contextual)       │  only shown if relevant
│  ┌───────────────────────────────────┐  │
│  │ Today · 2:30 PM — Moisture check  │  │
│  │ W-2604-258 · Crew: You, Jake      │  │
│  │                      [ Open → ]   │  │
│  └───────────────────────────────────┘  │
│                                         │
├─────────────────────────────────────────┤
│  JOBS (1)                               │  section label 12px
│  ┌───────────────────────────────────┐  │
│  │ ║ 💧 W-2604-258   Water   Active  │  │  big tile, division
│  │ ║ Lead · Moroni Salvador (PM)     │  │  left border 4px,
│  │ ║ ████████░░░░  5/8 tasks         │  │  progress bar visible
│  │ ║            Next: Thu 9 AM   →   │  │
│  └───────────────────────────────────┘  │  auto-expanded when 1 job
│                                         │
├─────────────────────────────────────────┤
│  PHOTOS & NOTES (13)                    │
│                                         │
│  💧 W-258 · Water (8) ─────────         │  job group header
│  ┌─────┬─────┬─────┬─────┐              │
│  │ 📷  │ 📷  │ 📷  │ +5  │              │  3-up + overflow
│  └─────┴─────┴─────┴─────┘              │
│                                         │
│  📦 W-259 · Contents (5) ──────         │
│  ┌─────┬─────┬─────┬─────┐              │
│  │ 📷  │ 📷  │ 📷  │ +2  │              │
│  └─────┴─────┴─────┴─────┘              │
│                                         │
│  [ + Add Photo ]  [ + Add Note ]        │  tapping any thumbnail or
│                                         │  +N opens album (newest first)
│                                         │
├─────────────────────────────────────────┤
│  ▼ Claim details                        │  collapsed by default,
│                                         │  only reference info
└─────────────────────────────────────────┘
```

### Visual tokens

- Hero gradient: `DIV_GRADIENTS[division]` from `techConstants.js`.
- Hero text color: white with subtle opacity hierarchy (body 0.9, meta 0.72).
- Section labels: 11px uppercase, `letter-spacing: 0.06em`, `color: var(--text-tertiary)`.
- Card radius: `var(--tech-radius-card)` (16px).
- Job tile min-height: 104px.
- Action buttons: 56px tall, `var(--tech-radius-button)` (14px), icon 22px + label 13px stacked.
- Status color (hero left border or glow): from `CLAIM_STATUS_COLORS[status]`.

### The "Now / Next" module — precise logic

Given `appointments[]` sorted by `(date, time_start)` for this claim, filtered to `status !== 'cancelled' && status !== 'completed'`:

1. **Clocked in or en route right now** (any appt with `status in ('en_route', 'in_progress', 'paused')` for this employee) → show as **"Now"** tile with amber/green accent matching status, tap → `/tech/appointment/:id`.
2. **Else appt today with this employee in crew** → show as **"Today · HH:MM"** tile.
3. **Else next upcoming appt (any crew)** → show as **"Next · {relative date} · HH:MM"** tile, crew names.
4. **Else** (no upcoming) → hide the module entirely. Do not show a "no appointments" empty state here — empty is quieter than a placeholder.

---

## Phases

### Phase 0 — Prep & data audit (no code yet)

Run these checks before writing code so we don't hit surprises:

- [ ] Confirm `get_claim_detail` still returns `{ claim, jobs, contact, adjuster }` in production. Call it once from DevTools > RPC tester with a real claim id.
- [ ] Confirm `get_claim_appointments` returns crew names and task counts. If crew is `[{ full_name, employee_id }]` that matches the shape we need; log what it returns.
- [ ] Confirm `job_documents` query by `job_id=in.(…)` still works (should — used by desktop).
- [ ] Read [techConstants.js](src/pages/tech/techConstants.js) to confirm `DIV_GRADIENTS`, `DIV_PILL_COLORS`, `CLAIM_STATUS_COLORS` keys match our data.
- [ ] Read [TechAppointment.jsx](src/pages/tech/TechAppointment.jsx) hero pattern — we're mirroring its gradient hero + 3-button action bar.

### Phase 1 — Scaffold + hero + route swap (single commit unit)

1. Create `src/pages/tech/TechClaimDetail.jsx` with:
   - Same data-load logic as `ClaimPage` (call `get_claim_detail`), but **only** load `{ claim, jobs, contact, adjuster }`. No activity, no task summaries yet.
   - Loading / error / not-found states matching `TechAppointment` conventions.
   - Slim top bar: back button → `/tech/claims`, kebab `⋯` on the right (admin-only menu — Merge, Delete — wired later in Phase 5).
   - **Division-gradient hero** with:
     - Loss-type icon (💧 fire 🔥 mold 🍄 etc.) — reuse `DIV_EMOJI` or `DivisionIcon` if the mapping works.
     - Claim number as mono label above.
     - Insured name — 24px/700.
     - Address as a single tappable line → `maps://` / `https://maps.google.com/?q=`.
     - Status pill + `{N} job(s)` count on the right.
     - 3-button action bar: **Call** (`tel:{phone}`), **Navigate** (maps URL), **Message** (`sms:{phone}` — add `// TODO: switch to in-app SMS when available`). If the contact has no phone, disable Call + Message with muted style (don't hide).
2. In `src/App.jsx`, import `TechClaimDetail` and swap the route:
   ```jsx
   <Route path="tech/claims/:claimId" element={<ErrorBoundary section="TechClaimDetail"><TechClaimDetail /></ErrorBoundary>} />
   ```
3. **Fix TechAppointment Message button** — same commit or adjacent: [TechAppointment.jsx:327-340](src/pages/tech/TechAppointment.jsx) currently does `navigate('/tech/conversations')`. Change to an `<a href={'sms:' + contact.phone}>` anchor, disabled when no phone, same `// TODO` comment. Grab the phone from `appt.contact?.phone` (confirm field name when reading the file).
4. Test: tap a claim from `/tech/claims`, hero renders, Call/Navigate/Message work. Open a TechAppointment, Message button now opens SMS composer.

**Checkpoint:** Hero-only page works. Desktop `/claims/:claimId` unchanged. Commit.

### Phase 2 — Now / Next appointment module

1. Add `get_claim_appointments` call to the load function (parallel with `get_claim_detail`).
2. Build the `NowNextTile` component with the 4-case logic above.
3. Status → accent mapping:
   - `en_route` → amber (`--status-enroute-*`)
   - `in_progress` → green (`--status-working-*`)
   - `paused` → red (`--status-paused-*`)
   - `scheduled` → blue (`--status-scheduled-*`)
4. Tap → `/tech/appointment/:id`.
5. No module rendered at all when there's nothing upcoming.

**Checkpoint:** Test with (a) claim that has a today appointment, (b) future only, (c) none. Commit.

### Phase 3 — Jobs as large tiles

1. For each job, call `get_job_task_summary` in parallel (use `Promise.all` over `jobs.map`).
2. `JobTile` component:
   - 4px division-color left border.
   - Loss-type icon 24px, job number mono, division label.
   - Phase pill (Lead / Production / Closed) + status pill.
   - PM name line (if present).
   - Inline progress bar — `completed / total` tasks. Green fill when complete.
   - Right side: "Next: {relative}" if the job has an upcoming appt in the claim's appt list, else blank.
   - Full tile is tappable → `/tech/jobs/:jobId`. Route exists at [App.jsx:117](src/App.jsx:117) but currently serves the desktop `JobPage` (same mobile-packed-desktop problem we're fixing on claims). Out of scope here — flag a future `TECH-JOB-DETAIL-TASK.md` follow-up.
3. **1-job claims:** render the tile directly under a `JOBS` label. No expand/collapse.
4. **Multi-job claims:** render all tiles stacked, same size. No accordion.

**Checkpoint:** Commit.

### Phase 4 — Photos & Notes module

1. Fetch `job_documents` using the `job_id=in.(...)` pattern from `ClaimPage`.
2. Render — **grouped by job**:
   - Section label: `PHOTOS & NOTES ({total})`.
   - One group per job with a mini-header: division icon + `W-2604-258 · Water (8)`. Thin division-colored underline.
   - Each group shows a 3-up thumbnail strip of that job's photos, sorted `created_at desc`. Inside each group, 4th cell is `+N more` overflow.
   - **Album behavior:** tapping any thumbnail OR the `+N more` cell opens a full-screen lightbox pager over that job's photos, newest-first. Swipe between photos in the album. Close returns to the claim page.
   - **On 1-job claims:** skip the group header (no need to show which job when there's only one) — render the strip directly under the section label.
3. **Action row (bottom of the module, not inside a group):** `+ Add Photo` (primary) and `+ Add Note` (secondary), both 48px tall.
4. **Add Photo flow:** mirror [TechAppointment.jsx uploadPhotoFile](src/pages/tech/TechAppointment.jsx). Attach to the **first job** under this claim by default. When multi-job, show a one-tap sheet "Which job?" before uploading. Pass `p_appointment_id: null` (claim-level attachment, not an appointment).
5. **Add Note flow:** inline expandable textarea on the module, save as `insert_job_document` with `p_category: 'note'`. Same multi-job logic as photos.
6. **Empty states:**
   - Claim has 0 photos/notes → single action row + muted "No photos yet" line. No group headers.
   - Claim has photos in some jobs but not others → only render groups that have content. Do not show empty group shells.

**Checkpoint:** Test upload flow on real device or simulator. Commit.

### Phase 5 — Collapsed "Claim details" + admin kebab

1. Bottom of page: `▼ Claim details` collapsed by default. Tap to expand. Inside:
   - Carrier, policy #, insurance claim #, date of loss, loss type, notes.
   - Homeowner contact (name, phone, email). Phone/email tappable.
   - Adjuster block (if present) — same tappable pattern.
2. Kebab menu (admin/manager only, using same `isAdmin` check):
   - "Merge claim" → opens existing `MergeModal`.
   - "Delete claim" → opens existing delete confirm flow from `ClaimPage`.
   - "View activity" → navigates to a simple `/tech/claims/:id/activity` route OR shows a full-screen overlay. Decision: **defer**, leave this menu item out for v1. Office users have activity on desktop.
3. Non-admin users see no kebab at all.

**Checkpoint:** Commit.

### Phase 6 — Polish

- Safe-area padding on top (notch) + bottom (nav) — use existing `env(safe-area-inset-*)` patterns.
- Smooth entry animation on the hero (mirror `TechAppointment`'s `entering` state if it looks right).
- `statusBarLight()` on mount, `statusBarDark()` on unmount — because the hero is dark gradient.
- Pull-to-refresh with `PullToRefresh` wrapping the scroll area below the top bar (not the bar itself — sticky headers rule).
- Ensure all tap targets ≥ 48px.
- Verify contrast on gradient (white text must be WCAG AA against the darkest gradient stop for each division).

**Checkpoint:** Commit.

### Phase 7 — Verification

Use the Claude Code preview tools workflow (start dev server, `preview_click`, `preview_snapshot`, `preview_resize` mobile breakpoint):

- [ ] Claim with 1 job + today appointment → hero, Now tile, 1 job tile, photos, collapsed details.
- [ ] Claim with 2 jobs + no appointments → hero, no Now tile, 2 job tiles stacked.
- [ ] Claim with no contact phone → Call/Message buttons disabled with muted style.
- [ ] Claim with no address → Navigate button disabled.
- [ ] Admin user → kebab visible, Merge + Delete work.
- [ ] Non-admin tech user → no kebab.
- [ ] Pull-to-refresh works, sticky back bar doesn't move.
- [ ] Desktop `/claims/:claimId` still renders the old page untouched.
- [ ] Screenshot at 390×844 (iPhone 14 portrait) shared with user for sign-off.

### Phase 8 — Context doc update + cleanup

Update `UPR-Web-Context.md` with:
- **New page:** `src/pages/tech/TechClaimDetail.jsx` — description of sections, what data it loads.
- **Route change:** `/tech/claims/:claimId` now points to `TechClaimDetail` (not shared `ClaimPage`).
- **CSS additions:** any new `.tech-claim-*` classes added to `index.css`.
- **Known gaps:** activity log not shown to techs (intentional), photo upload defaults to first job on multi-job claims.

Then:
```bash
git rm TECH-CLAIM-DETAIL-TASK.md
git commit -m "docs: update UPR-Web-Context.md, remove completed TECH-CLAIM-DETAIL-TASK.md"
```

---

## Decisions (resolved 2026-04-16)

1. **Message button → native `sms:{phone}`** for v1, with `// TODO: switch to in-app SMS when available`. Fix also applied to `TechAppointment` in Phase 1.
2. **Primary contact = `contact` from `get_claim_detail`** (the insured/homeowner). Future refinement if techs ask for it: a chevron next to Call that opens a sheet listing all claim contacts (insured, adjuster, co-insured). Not in this task.
3. **Jobs link → `/tech/jobs/:jobId`** — route exists, currently serves desktop `JobPage`. Same mobile-packed-desktop problem; tracked as future `TECH-JOB-DETAIL-TASK.md`.
4. **Photos display = grouped by job** with a division-colored mini-header per group. Within each group: newest-first. Tapping any thumbnail (or `+N more`) opens a full-screen lightbox album for that job, also newest-first. Single-job claims skip the group header.

---

*Once all phases are complete and verified, update `UPR-Web-Context.md` and delete this file per the Task File Protocol in `CLAUDE.md`.*
