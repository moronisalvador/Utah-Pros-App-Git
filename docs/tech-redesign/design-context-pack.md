# Design Context Pack — UPR /tech/* Greenfield Redesign

**Session:** design-standards only (no app implementation). Current deliverable: 2 direction mockups
of the tech dashboard as phone-openable artifacts. Later deliverables: refinement on appointment
detail, then the complete tokenized design system + style guide.

**Greenfield mandate:** the owner rejects the current aesthetic wholesale. Carry over NOTHING visual —
no existing color, type, spacing, radius, elevation, or component look. Keep only the *architecture*
(CSS custom properties + shared primitives). Everything you draw must read as a NEW app.

---

## 1. Owner decisions (locked 2026-07-14)

- **Two directions:** A = "Instrument Panel", B = "Apple Field Pro".
- **Persona dial:** *refined, field-proofed* — premium finish on non-negotiable field bones
  (oversized type/targets, max contrast). "Looks like a $50k tool that happens to be effortless in gloves."
- **Brand:** there is NO brand for this software yet. Owner's lean: **replace blue with black** as the
  identity. Owner is open to revising color options together — so each direction must present a
  coherent, committed color POV, and accent alternates should be easy to discuss after.
- **Type voice:** *humanist workwear* — warm, sturdy, glanceable (NOT industrial grotesk, NOT system SF).
  - Direction A face: **Fira Sans** (humanist-technical, superb at small sizes).
  - Direction B face: **Source Sans 3** (humanist, friendly, Adobe UI classic).
- **Proposed defaults (owner did not veto):** both light AND dark themes designed with equal care,
  system-auto default; the 5 field status semantics KEPT (amber=OMW · green=working · red=paused ·
  blue=scheduled · gray=done) with fully retuned hues, colorblind-safe and always shape-redundant.

## 2. The shared design thesis: “Ink is the brand; color is state”

- Identity is carried by **black/near-black ink**, typography, and spacing craft — never by a brand hue.
- Chromatic color appears **only** as status/semantic signal (and focus rings). Primary actions are
  ink-colored: black on light ground, white on dark ground.
- This directly implements the owner's "replace the blue with black."
- Status hues must be distinguishable for deuteranopia/protanopia (tune amber vs green carefully) and
  are ALWAYS paired with a shape cue (dot / ring / pause-bars / check / clock glyph) so state survives
  grayscale. "Status readable from 3 feet" is law.

## 3. Direction A — “INSTRUMENT PANEL”

Dark-first cockpit. Garmin-meets-Linear, executed warm-blooded (humanist type keeps it human).

- **Default theme: dark.** Ground = deep neutral near-black (OLED-friendly; NEUTRAL or barely-warm
  graphite — explicitly avoid the blue-tinted "midnight SaaS" default). Light theme = "daylight mode":
  paper-white, same structure, crisp hairlines — designed with equal care, not an invert.
- **Ink:** near-white on dark at AAA-leaning contrast for primary text.
- **Status = lamps:** glowing dots/blocks (a subtle outer glow is allowed on dark; keep it cheap — no
  heavy blur). The working state may carry a slow, subtle pulse (reduced-motion collapses it).
- **Numerals are the heroes:** oversized tabular figures for the live timer and hour readouts
  (`font-variant-numeric: tabular-nums`).
- **Depth: flat + precise.** 1px hairline borders and surface-level steps; no soft shadows on dark.
  Light theme may use one crisp minimal shadow level.
- **Icons:** 2px stroke, squared terminals, technical geometry, 24px grid.
- **Density:** high glance-value — a big hero, compact rows that still hit ≥48px targets.
- **Radius:** small, consistent family (~8–10px).
- **Motion:** instant/fast tier; press = scale(.97); no springs.

## 4. Direction B — “APPLE FIELD PRO”

iOS-native calm: as if Apple designed a jobsite tool. Soft, layered, effortless.

- **Default theme: light.** True white / soft neutral-gray layered surfaces — **cream/beige is banned**.
  Dark theme = graphite elevated-surface dark (not pure black), equally designed.
- **Surfaces:** soft cards with gentle *committed* shadows, large continuous radii (~16–20px+),
  and AT MOST ONE frosted surface (top bar OR tab bar; blur ≤14px) — glass is a moment, not a material.
- **Primary action:** black pill button (Apple-Store-like), white text — the black identity, softly worn.
- **Icons:** duotone rounded — filled body + stroke accents, friendly corners, 24px grid.
- **Type:** Source Sans 3; optical hierarchy; big friendly tabular numerals.
- **Density:** airier, premium; the dashboard still reads in one glance.
- **Motion:** springy one-shot enters on sheet/FAB (subtle), cross-fade selections; fast everywhere else.

## 5. Dashboard mockup IA (render ALL of these zones — the brief's "mission control")

1. **Greeting header** — tech's first name, date, offline-pill slot. Calm anchor, sticky feel.
2. **Attention strip** — present-only-when-needed alerts (e.g. 1 stalled material, 1 unread message).
3. **NOW / NEXT hero with clock controls** — THE one primary action on the screen. Show the
   *working* state live (green, running timer, current job name) with the next visit previewed.
   Button labels/states must match the real state machine from the survey (§10).
4. **Color-coded day timeline** — the day's appointments as status-colored blocks on an hours axis.
5. **Rest-of-today list** — 2–3 rows: time, customer, job kind, address, status chip, task count.
6. **Numbers row** — hours today (travel/on-site split), tasks x/y, photos count. Quiet instrument
   readouts integrated into the design — NOT the SaaS gradient stat-card template.
7. **Completed visits** — 1–2 gray rows showing the time breakdown (travel · on-site · total).
8. **Next 7 days** — compact upcoming rows.
9. **Create FAB** — visually subordinate to the clock hero (one-primary-action rule).
10. **Bottom tab bar** — real tab set from the shell survey (§10), safe-area padded.

Use the survey's realistic sample-day dataset verbatim (names, addresses, times, formats).

## 6. Hard persona constraints (law — the mockup must demonstrate them)

| Constraint | Line |
|---|---|
| Tap targets | ≥48px primary field actions; 44px only for documented-secondary; hit areas <24px banned |
| Type floor | 11px absolute minimum; 12px minimum for anything actionable |
| Contrast | body ≥4.5:1 always; primary text aims ≥7:1 (sunlight!); muted text still ≥4.5:1 |
| Status | color + SHAPE redundancy, reads from 3 feet, survives grayscale |
| One primary action | the clock hero owns the screen; FAB and rows are subordinate |
| Thumb reach | primary controls in the bottom half; one-handed use assumed |
| Safe area | render iOS status bar (9:41) + home-indicator bar; tab bar gets safe-area padding |
| No field-action modals | inline/expandable affordances, bottom sheets — never popups for field work |
| Sticky header | greeting header does not move on scroll/pull-to-refresh |

## 7. Artifact technical rules (binding on every mockup file)

- File is **body content only** — NO doctype/html/head/body wrappers. Include one `<title>`.
  All CSS in one `<style>` block. One tiny inline `<script>` allowed (theme toggle only).
- **ZERO external requests.** Fonts: paste the EXACT provided @font-face CSS (paths in §9) into your
  `<style>`. No links, no imports, no remote images. Decorative graphics = inline SVG/CSS only.
- **ZERO emoji characters anywhere in the file.** Every icon is an inline SVG you draw, in the
  direction's icon style, coherent as a family.
- **Phone-first:** design at 390×844. ≤500px viewport = full-bleed edge-to-edge app. >500px viewport =
  centered device frame (rounded bezel, subtle shadow, page ground that complements the direction)
  with the SAME app inside, plus a short caption line under the frame naming the direction.
- Render the iOS status-bar row (9:41 + signal/wifi/battery drawn as SVG) inside the app chrome, and
  the home-indicator bar at the bottom. Tab bar clears it.
- **Theme toggle:** a small floating pill (fixed, bottom-left, clearly a preview control — not part of
  the app design) toggles `data-theme="light|dark"` on the app root. BOTH themes fully designed —
  all colors via CSS custom properties, redefined per theme; components never hardcode theme colors.
- `prefers-reduced-motion: reduce` collapses ALL motion to instant. Any `:hover` transform is gated
  behind `@media (hover:hover) and (pointer:fine)`.
- `font-variant-numeric: tabular-nums` on every timer/number readout. `text-wrap: balance` on headings.
- Real content only — no lorem, no gray placeholder boxes, no "TODO".

## 8. Anti-slop bans (any of these = rework)

- Side-stripe status borders (`border-left` accent on rows/cards) — use lamps/chips/dots instead.
- Gradient text. Decorative glassmorphism (B gets at most ONE frosted surface). Gradient stat cards /
  the hero-metric template. Identical icon+heading+text card grids. ALLCAPS tracked eyebrow labels
  repeated over every section. Numbered section markers (01/02/03) as decoration.
- Cream/beige/parchment grounds. Blue-tinted default "midnight" dark. Emoji. Lorem.
- A second theme that is a lazy invert of the first.

## 9. Assets (embed verbatim)

- Direction A font CSS (Fira Sans 400/600/700, ~71KB):
  `/tmp/claude-0/-home-user-Utah-Pros-App-Git/fce49e67-8241-5960-b387-dac09722b056/scratchpad/fonts/fira.css`
- Direction B font CSS (Source Sans 3 variable 400–700, ~39KB):
  `/tmp/claude-0/-home-user-Utah-Pros-App-Git/fce49e67-8241-5960-b387-dac09722b056/scratchpad/fonts/source.css`
- Font stacks: `"Fira Sans", system-ui, -apple-system, sans-serif` /
  `"Source Sans 3", system-ui, -apple-system, sans-serif`.

## 10. Survey findings (real screens, shell, architecture, brand, constraints)

_(appended when the grounding workflow completes)_

## survey:dash

# SURVEY 1 — Tech Dashboard (`/tech`, TechDashV2) — Content & State Inventory

**Surface:** `/tech` route behind flag `page:tech_dash_v2`, rendered persistently inside the TechLayout pane host (kept alive across tab switches; `active` prop gates GPS polling + countdown ticker). One data round-trip: `db.rpc('get_tech_dashboard', { p_employee_id })` via TanStack Query key `techKeys.dash(employeeId)`, cache persisted to storage (resume shows last data, never a re-skeleton). Clock/photo mutations invalidate the dash cache via `invalidateTech` — no full-page reloads.

**Files read:** `src/pages/tech/v2/TechDashV2.jsx`; `src/pages/tech/v2/dash/{DashHeader,NowNextHero,AttentionStrip,MiniTimeline,MyNumbers,CompletedRows,ComingUp,CreateFAB,PhotoCaptureButton}.jsx`, `dashHelpers.js`; `src/components/tech/{NowNextTile,StalledWidget,TimeTracker,ClockSupersedeSheet,PhotoNoteSheet,OfflineStatusPill,MaterialIcon}.jsx`; `src/components/tech/v2/{ApptListRow,StatusChip,TechV2Page,skeletons,nav}.jsx/js`; `src/components/{PullToRefresh,NotificationBell,TechLayout}.jsx`; `src/lib/{techDateUtils,clockPrecheck}.js`; `src/pages/tech/techConstants.js`; `src/i18n/locales/en/{dash,tracker,tech}.json`; `supabase/migrations/20260703_tech_v2_phaseF_get_tech_dashboard.sql`.

---

## 1. Every piece of information the dashboard can show (fields + exact display formats)

### 1a. Greeting header (DashHeader — fixed, does not move on pull-to-refresh)
| Item | Content | Format / example |
|---|---|---|
| Date line | today's date | `toLocaleDateString(locale, { weekday:'long', month:'long', day:'numeric' })` → **"Tuesday, July 14"** (locale-aware en/pt/es) |
| Greeting | first word of `employee.display_name \|\| full_name` | **"Hey Marcus 👋"** (i18n: `"Hey {{name}} 👋"`) |
| Day summary | count of ALL today's appointments (cancelled excluded, completed included) | **"4 appointments today"** / singular **"1 appointment today"** |
| Notification bell | unread count badge (red number); dropdown lists last 30 notifications (e-sign completions etc.) each with title + relative time ("5m ago", "2h ago", "3d ago", then "Jul 2"); tap item → navigate to related job + mark read; mark-all-read; realtime push + 60s poll fallback | shared `NotificationBell` component |
| Help icon button | `?` circle icon → `/tech/help` | aria "Help and guides" |
| ⋮ overflow menu | **Admin View** (admins only, → `/`), **Send Feedback** (→ `/tech/feedback`), **Sign Out** (two-tap: label flips to **"Tap again to Sign Out"**, 3s auto-reset, danger styling on confirm) | closes on outside blur |

### 1b. Offline/sync indicator (OfflineStatusPill — shell-level fixed overlay, top-right, above the dashboard on every tech screen)
- Amber pill: spinner + **"Syncing N"** while offline-queue uploads pending.
- Red pill (tappable): retry icon + **"N failed"** → tap retries all, toast "Retrying queued uploads".
- Green pill: check + **"Synced"**, flashes 2s on a pending→0 transition with no errors.
- Nothing rendered when idle. (Queue is IndexedDB-backed, behind flag `offline:queue`.)

### 1c. Attention strip (AttentionStrip — additive banners; renders nothing when nothing to flag)
1. **Stalled materials widget** (StalledWidget; only when flag `page:tech_moisture` on AND ≥1 stalled row; re-polls every 2 min; 30-day work window; silent on failure):
   - Header: warning triangle + **"3 materials stalled across 2 jobs"** (job clause only if >1 job).
   - Collapsed to first 3 rows; **"Show all (N)" / "Show less"** toggle.
   - Each row (tappable → that job's latest appointment): material icon; **"{Material} · {Room}"** (e.g. "Drywall · Master Bathroom"); second line **job_number (mono) · latest moisture "19%" · "/ goal 12%" · "4d stalled"**; chevron. Material vocabulary: Drywall, Wood Subfloor, Wood Framing, Hardwood, Engineered Wood, Concrete, Carpet, Carpet Pad, Tile, Laminate, Vinyl, Insulation, Other.
2. **Away-from-jobsite banner** (warn tone; GPS check `get_active_appointment_geo` vs current coords, threshold **200 m**, debounced 20s, foreground+active-pane only, fails silently):
   - Title: **"You're ~350m from the jobsite"**; body: **"{Title · Address} is still running|paused. Pause it or mark it finished."**
   - Buttons: **"Pause"** (hidden if already paused) and **"Finish"** (two-tap → **"Tap again to Finish"**, 3s reset). Both call `clock_appointment_action` with fresh coords; success haptic + cache invalidate.
3. **After-5-PM still-clocked-in banner** (alert tone; shows when payload's `open_entry` has `clock_out == null` AND America/Denver hour ≥ 17):
   - Title: **"You're still clocked in"**; body: **"It's past 5 PM and a job is still running. Finish it before you head home — otherwise it auto-closes at midnight."**
   - One full-width button: **"Finish my day"** (entry linked to an appointment → navigates to that appointment) or **"Clock out now"** (bare entry → `clock_finish_entry` RPC, toast "Clocked out").

### 1d. Now/Next hero (NowNextHero — the single dominant tile)
- **Eyebrow badge** (uppercase, tone-colored): `ON MY WAY` / `WORKING` / `PAUSED` / `UP NEXT TODAY` / `NEXT VISIT`.
- **Context line beside badge:**
  - `today` (not started yet): live countdown — **"Starts in 2h 30m"** (>1 min out), **"Starting now"** (±1 min), **"Was due 45m ago"** (overdue); re-renders every 60s while pane visible.
  - `next` (future day): **"Sat, Jul 18 · 9:00 AM"** (`weekday:'short', month:'short', day:'numeric'` + start time).
  - `now_active`: the scheduled start time, e.g. **"9:30 AM"**.
- **Identity block** (tappable → appointment detail): client name = `jobs.insured_name || appt.title || "Appointment"` (large); sub-line = **"{appointment title} · #{job_number}"** (e.g. "Equipment pull + final readings · #24-1173").
- **Address row** (tappable → Apple Maps on iPhone/iPad, Google Maps otherwise): pin icon + **"{address}, {city}"**.
- **Clock controls**: the full composed `TimeTracker` panel (see §2) — rendered for `now_active` and `today` contexts only (not for `next`).
- **Action buttons row:** **"📸 Photo"** (→ "⏳ Uploading…" while busy; only when a job exists + tracker shown), **"📝 Notes"** (→ appointment detail), and for `next` context **"Open job"** (→ job detail).
- **Empty variant** (no hero at all): calendar-with-check icon, title **"Nothing on right now"**, link **"Check your schedule →"** (→ `/tech/schedule`).

### 1e. Mini day timeline (MiniTimeline — horizontally scrollable chip strip)
- Renders only when **≥2** of today's visits. One chip per visit, in time order, tappable → appointment detail.
- Chip content: **start time** ("8:00 AM", "—" if none) + **label** (`jobs.insured_name || title || "Visit"`).
- Chip tint = status token: blue scheduled/confirmed, amber en_route, green in_progress, red paused, gray completed.

### 1f. "Rest of today" list
- Section title **"Rest of today"**; renders only when non-empty. Everything today that isn't the hero and isn't completed, as shared `ApptListRow`s:
  - Left accent bar = the appointment's own `color` (else neutral accent token).
  - Title = `appt.title || "Appointment"`.
  - Meta line = **"{time} · {insured_name} · {city} · {done}/{total} tasks"** (each piece only when present; task clause only when total > 0; when no job, falls back to `appt.notes`).
  - Right: **StatusChip** pill — labels **Scheduled / On My Way / Working / Paused / Done / Cancelled**.

### 1g. "My numbers" scoreboard (MyNumbers)
- Section title **"My numbers"**.
- **Two hours cards** — "Today" and "This week" (Monday-start, America/Denver, matching payroll). Each is a 3-cell grid, never a bare number:
  - **Travel** / **On-site** / **Total** (Total cell visually emphasized), values via `fmtHours`: `0h`, `45m`, `1h`, `2h 30m` (minutes rounded).
  - Server math: stored sums + a live term for the one open entry (live on-site minus paused time when clocked in; live travel while en route). Payload values are decimal hours rounded to 2dp; UI formats them.
- **Two stat pills:** **"5/14" + "Tasks done"** (sums of today's appointments' `task_completed`/`task_total`) and **"12" + "Photos today"** (photos this tech uploaded today, Denver day).

### 1h. "Completed today" list (CompletedRows)
- Section title **"Completed today"**; hidden when none. One tappable row per finished visit:
  - Green check icon + start time + client/title label.
  - Per-visit breakdown line (fetched per row from `job_time_entries` for this tech, summing STORED `hours` + `travel_minutes`): **"Travel 20m · On-site 45m · Total 1h 5m"** (Total bolded). Fetch failure falls back to all-`0h` values. Never a bare "3.5h".

### 1i. "Coming Up" (ComingUp — my next 7 days)
- Section title **"Coming Up"**; hidden when empty. Feed is already scoped to me, tomorrow → +7 days, cancelled excluded.
- Grouped by day; day heading: **"Friday, Jul 18"** (`weekday:'long', month:'short', day:'numeric'`); visits as the same `ApptListRow`s as §1f.

### 1j. Create FAB
- Floating **"+"** button, bottom-right (above the bottom nav). Tap → dimmed backdrop + two labeled pills: **"New Job"** (→ `/tech/new-job`, document icon) and **"New Customer"** (→ `/tech/new-customer`, person icon). Backdrop tap closes; backdrop blocks scroll.

### 1k. Data available in the payload but NOT currently displayed on the dashboard
Each appointment row also carries: `time_end`, `type` (vocabulary: monitoring, mitigation, inspection, reconstruction, estimate, mold_remediation, other — display labels "Monitoring / Mitigation / Inspection / Recon / Estimate / Mold Remed. / Other"), `notes`, `kind`, `duration_days`, `is_milestone`, `jobs.division` (water / mold / reconstruction / remodeling / fire / contents), `jobs.phase`, `jobs.client_phone`, and full `appointment_crew` (per member: role, display_name, full_name, color, avatar_url). Payload root also has `server_now`, `today`, `week_start`. A redesign can surface any of these without backend work.

### 1l. Shell context (not dashboard-owned but on screen)
Bottom tab bar: **Dash · Claims · Schedule · Messages · More** (More shows a dot badge when assigned tasks exist; Messages shows unread badge). Toasts stack bottom-center above the nav (success green / warning amber / error red).

---

## 2. Clock/visit state machine (TimeTracker, embedded in the hero)

Backing: `job_time_entries` rows per (appointment, employee); actions via RPC `clock_appointment_action(p_appointment_id, p_employee_id, p_action, p_lat, p_lng, p_accuracy)`. GPS captured only on `omw` and `start` (never stalls pause/resume/finish). An appointment can have multiple entries = multiple "visits".

**State derivation** (from the current entry): no entry → `scheduled`; `travel_start` set, `clock_in` null → `omw`; `clock_in` set, not paused → `on_site`; `paused_at` set → `paused`; all entries closed (`clock_out`) → `completed`.

| State | Status line (top of panel) | Status color semantic | Panel tint | Active/tappable button(s) | Time info shown |
|---|---|---|---|---|---|
| **scheduled** (idle) | "Scheduled" | neutral/blue family (hero badge "UP NEXT TODAY" = blue) | neutral | **"ON MY WAY"** station (truck icon, filled circle = the one active station) | none; hero shows countdown "Starts in X" |
| **omw** | "On my way" | **amber** (`--status-enroute`) | amber wash | **"START"** station (play icon) | OMW station stamp: "9:12 AM" (other-day form "Apr 15 · 8:44 AM"); travel accrues live into hours totals server-side |
| **on_site** (working) | "Started" | **green** (`--status-working`) | green wash | **"FINISH"** station (stop icon) + full-width **"Pause"** button | OMW stamp + "Travel: 18m" below it; Start stamp |
| **paused** | "Paused · 2:14 PM" (paused_at stamp) | **red** (`--status-paused`) | red wash | full-width **"Resume"** button (green-tinted) — Finish station remains the active station | stamps as above; paused time excluded from hours |
| **completed** | "Completed" | **gray** (`--status-completed`) | neutral | **"Return to Job"** button | all 3 stamps + "Travel: 18m" + "On job: 2h 5m"; CompletedRows shows "Travel · On-site · Total" |

Station row = 3 fixed columns **ON MY WAY / START / FINISH** (48px circles, uppercase labels); exactly one is active at a time; done stations show their timestamp beneath; inactive-future stations are gray.

**Honest note on the "timer":** there is **no continuously-ticking elapsed readout** on the v2 dashboard. Live elapsed exists as (a) the 60s-refresh hero countdown for un-started today visits, (b) server-computed live terms inside the Today/Week hours totals (updates on any refetch/mutation), (c) per-step durations after the step completes ("Travel: 18m" / "On job: 2h 5m", formats `45m` / `1h 5m`), and (d) elapsed in the supersede sheet ("· 1h 5m").

**Transitions & guards:**
- **Finish is two-tap:** first tap turns the station label to **"CONFIRM"** with red circle; second tap fires; blur cancels.
- **OMW precheck (supersede):** before `omw`, `clock_omw_precheck` runs (fail-open). If another clock is open → bottom sheet **ClockSupersedeSheet**: red header **"Still clocked in"** + "You're working|paused|en route on {`#job — Name`} · {1h 5m}". Normal mode: "Continuing will **clock you out** of {job} as of now." → buttons **"Clock out & continue"** ("Working…" while busy) / **"Cancel"**. Hard-block mode (office-enforced flag): "You must clock out of {job} before starting another job." → **"Go to {job}"** / **"Cancel"**. Success toast: **"Clocked out of {job} (1h 5m)"**. Race backstop: server error `OPEN_ENTRY_EXISTS` re-opens the sheet in hard-block, else toast "You're still clocked in on another job — clock out there first."
- **Return to Job** (completed): two-tap (**"Confirm Return?"**, 3s reset) → inline **"Reason for return"** text input (placeholder "e.g. Additional work requested, Follow-up monitoring...") + **"Clock In"**/"Clocking In…" + **"Cancel"**. Reason saved as a job note document ("Return reason: …"); then re-fires `omw` → a new visit begins.
- **Multi-visit:** status line gains **"· Visit 2"** badge; prior visits listed above as **"Visit 1: Travel 15m · On-site 2h"** summary lines.
- **Haptics:** omw = medium impact; start/finish = success notify; pause/resume = light impact; two-tap arms = light impact.
- Cold state of the panel: brief "Loading…" text while its entries fetch.

**Status→color semantics (single source, `--status-*` tokens / StatusChip):** blue = scheduled/confirmed · **amber = en_route/OMW** · **green = in_progress/working** · **red = paused** · **gray = completed/done (and cancelled)**.

---

## 3. Every action a tech can take from this screen

1. **Pull-to-refresh** (whole body below fixed header): drag ≥70px w/ resistance; rotating-arrow indicator, **"Release to refresh"** text past threshold; silent revalidate (content never blanks); failure toast "Failed to refresh".
2. **Header:** bell (open/close notification dropdown; tap notification → navigate + mark read; mark all read) · Help → `/tech/help` · ⋮ menu → Admin View / Send Feedback / Sign Out (two-tap).
3. **Attention strip:** tap stalled-material row → appointment; Show all/Show less; away banner **Pause** / **Finish** (two-tap); overtime **Finish my day** (→ appointment) or **Clock out now** (immediate RPC).
4. **Hero:** tap identity → appointment detail (`apptHref`; job-hub-aware); tap address → external maps app; clock actions: **On my way → Start → Finish (confirm)**, **Pause/Resume**, **Return to Job** (confirm + reason), supersede-sheet choices; **📸 Photo** (native camera on device, else file-input `capture="environment"`) — snap-first, uploads immediately, then a 4s inline "Photo saved ✓" toast with **"Add note"** link → **PhotoNoteSheet** (Note tab: caption textarea "What's in this photo?", Save note/Cancel; Room tab when `page:tech_rooms` on: tag to existing room chips, "+ New room" via 16 room templates — Living Room, Kitchen, … Closet — or custom name, auto-assigns); **📝 Notes** → appointment detail; **Open job** (next-context only) → job detail.
5. **Timeline chip tap** → appointment detail.
6. **Rest-of-today / Coming-Up row tap** → appointment detail.
7. **Completed row tap** → appointment detail.
8. **FAB:** open/close; **New Job**; **New Customer**; backdrop tap closes.
9. Passive/system: away GPS check on pane-activation + visibility-restore; offline-pill retry tap.

**No long-press gestures and no swipe actions exist anywhere on this screen.** All destructive/final actions use inline two-tap confirm (never a modal dialog).

---

## 4. Current top-to-bottom layout order vs the brief's mockup zones

**Actual order today:**
1. `DashHeader` — fixed greeting header (date / "Hey X 👋" / count; bell + help + ⋮ top-right)
2. *(overlay: OfflineStatusPill fixed top-right of shell; FAB fixed bottom-right; bottom tab bar fixed)*
3. — pull-to-refresh region starts —
4. `AttentionStrip` (stalled materials → away banner → overtime banner)
5. `NowNextHero` (badge/countdown, identity, address, TimeTracker, Photo/Notes/Open-job)
6. `MiniTimeline` (horizontal status-colored chip strip; only when ≥2 today)
7. **Rest of today** list
8. **My numbers** (Today hours card → This week hours card → Tasks-done + Photos pills)
9. **Completed today** list
10. **Coming Up** (next 7 days grouped by day)

**Brief-specified zones — exists vs NEW:**
| Zone | Status today |
|---|---|
| Greeting header | **EXISTS** (fixed, with bell/help/menu) |
| Attention strip | **EXISTS** (3 banner types; renders nothing when clear) |
| Now/next hero with clock controls | **EXISTS** (single hero + composed TimeTracker) |
| Color-coded day timeline | **EXISTS, different form** — a slim horizontal scrollable chip strip (time + name per chip, status-colored), not a vertical/proportional timeline; hidden under 2 visits. A true time-axis timeline would be NEW. |
| Rest-of-today list | **EXISTS** |
| Hours/tasks/photos numbers | **EXISTS** (travel/on-site/total ×2 + 2 stat pills) |
| Completed visits | **EXISTS** (with per-visit travel/on-site/total) |
| Next 7 days | **EXISTS** ("Coming Up", day-grouped) |
| Create FAB | **EXISTS** (2-option speed-dial) |

All nine zones exist; only the timeline's *form* differs from a canonical "day timeline".

---

## 5. Empty / edge states

- **Cold-start loading:** the entire screen (header included) is replaced by `SkeletonList rows={6}` — six shimmering appointment-row placeholders (thin accent-bar block, 60%-width line, 40%-width line, pill-shaped chip block). Shown **only** when there's no cached data; all later refreshes (PTR, focus, mutations) revalidate in place.
- **0 appointments today, upcoming exists:** hero becomes **NEXT VISIT** preview of the soonest upcoming (date "Sat, Jul 18 · 9:00 AM", identity, address, "Open job" — no clock controls), and **Coming Up** lists the next 7 days — the "empty state shows upcoming work" rule. Timeline, Rest-of-today, Completed all self-hide. Header still says "0 appointments today"; My numbers still renders (zeros → "0h").
- **Truly nothing (no today, no upcoming):** hero empty state — calendar icon, "Nothing on right now", "Check your schedule →". Body below is just My Numbers (zeros); other sections hidden.
- **Hero-pick priority** (`pickNowNext`, frozen): a live visit I'm on (en_route/in_progress/paused) → today's first non-completed mine → soonest upcoming; else null. (Known quirk: its "today" comparison uses the UTC day while the feed is Denver-day.)
- **Section self-hiding:** MiniTimeline (<2 visits), Rest of today (empty), Completed today (empty), Coming Up (empty), the entire attention strip (nothing to flag) all render nothing — the page collapses gracefully.
- **Offline:** no dashboard-specific offline banner. Cached payload keeps rendering (persisted query cache). Photo capture with `offline:queue` on: blob saved to IndexedDB + queued, toast **"Photo queued — will upload when online"** (only when actually offline), light haptic; the shell pill then shows "Syncing N" → "Synced"; failures → red "N failed" tap-to-retry; when a queued photo for this appointment lands, the dash cache invalidates itself.
- **Failure handling:** refresh failure → toast "Failed to refresh" (stale content stays). Away-check/stalled-widget failures are silent (features simply hide). Completed-row breakdown failure → zeros. Clock action failure → toast "Action failed: {message}". Photo: >10 MB → "Photo is too large (max 10 MB)"; non-image → "Only image files are allowed"; upload failure → "Photo upload failed: {message}"; camera error → "Camera error: {message}" (user-cancel is silent).
- **Overdue today visit:** hero countdown flips to "Was due 45m ago" — the only overdue signal.
- **Cancelled visits:** excluded server-side AND client-side (belt-and-suspenders) — never render in any bucket.

---

## 6. Realistic sample day (renders verbatim in the real formats)

**Context:** tech **Marcus Whitaker**, Tuesday, July 14, 2026, 11:20 AM. Header: date "Tuesday, July 14" · "Hey Marcus 👋" · "4 appointments today".

**Today's appointments** (payload-shaped):

| # | time_start | title | status | job_number | insured_name | address, city | type | tasks |
|---|---|---|---|---|---|---|---|---|
| 1 | 8:00 AM | Day 3 drying check | completed | 26-1187 | Karen Holt | 1284 W 900 N, Orem | monitoring | 3/3 |
| 2 | 9:30 AM | Equipment pull + final readings | in_progress | 26-1173 | Gary Sorensen | 452 E Mill Pond Rd, Draper | mitigation | 2/5 |
| 3 | 1:00 PM | Drywall hang & tape | scheduled | 26-1102 | Emily Checketts | 3941 S Bluff Ridge Ct, Sandy | reconstruction | 0/4 |
| 4 | 3:30 PM | Mold walkthrough & estimate | scheduled | 26-1210 | Blake Rasmussen | 88 N 300 W, American Fork | estimate | 0/2 |

**Attention strip:** stalled widget — "⚠ 2 materials stalled across 2 jobs": "Drywall · Master Bathroom / 26-1187 · **19%** / goal 12% · 3d stalled"; "Wood Subfloor · Kitchen / 26-1173 · **22%** / goal 15% · 2d stalled". (No away banner — on site; no overtime banner — before 5 PM.)

**Hero (now_active / working):** badge **WORKING** (green) · "9:30 AM" · **Gary Sorensen** · "Equipment pull + final readings · #26-1173" · 📍 452 E Mill Pond Rd, Draper. TimeTracker: status "Started"; stations — ON MY WAY ✓ 9:12 AM with "Travel: 18m" · START ✓ 9:30 AM · FINISH (active); full-width "Pause". Buttons: 📸 Photo · 📝 Notes.

**Mini timeline (4 chips):** `8:00 AM Karen Holt` gray · `9:30 AM Gary Sorensen` green · `1:00 PM Emily Checketts` blue · `3:30 PM Blake Rasmussen` blue.

**Rest of today:** "Drywall hang & tape — 1:00 PM · Emily Checketts · Sandy · 0/4 tasks — [Scheduled]"; "Mold walkthrough & estimate — 3:30 PM · Blake Rasmussen · American Fork · 0/2 tasks — [Scheduled]".

**My numbers:** Today — Travel **38m** · On-site **2h 35m** · Total **3h 13m** (payload: travel 0.63, on_site 2.58, total 3.21). This week — Travel **1h 25m** · On-site **11h 10m** · Total **12h 35m**. Pills: **5/14** Tasks done · **9** Photos today.

**Completed today:** "✓ 8:00 AM Karen Holt — Travel 20m · On-site 45m · **Total 1h 5m**".

**Coming Up:** "Wednesday, Jul 15" → "Day 4 drying check — 8:30 AM · Karen Holt · Orem — [Scheduled]"; "9:00 AM Contents pack-back — Tricia Beckstead · Lehi — [Scheduled]". "Friday, Jul 17" → "Rebuild scope review — 10:00 AM · Emily Checketts · Sandy · 0/4 tasks — [Scheduled]".

**Alternate-moment variants for mockups:** 7:40 AM same data → hero badge **UP NEXT TODAY** (blue) + "Starts in 20m" over appointment 1, all chips blue/gray, Completed hidden. 5:30 PM with appointment 2 never finished → red alert banner "You're still clocked in" + "Finish my day".

---

## survey:appointment

# SURVEY 2 — Appointment Detail (TechAppointment) & its successor (Job Hub v2)

**Files read (all fully unless noted):**
- `/home/user/Utah-Pros-App-Git/src/pages/tech/TechAppointment.jsx` (1,381 lines — the live legacy detail, route `/tech/appointment/:id`)
- `/home/user/Utah-Pros-App-Git/src/components/tech/TimeTracker.jsx` (the clock panel, shared with dashboard)
- `/home/user/Utah-Pros-App-Git/src/pages/tech/v2/TechJobHub.jsx` + all of `/home/user/Utah-Pros-App-Git/src/pages/tech/v2/hub/` (HubHeader, HubStage, StageClock, useVisitClock, hubStageState, HubChecklist, HubTools, HubDock, HubBelowFold, JobClaimSection, PhotosNotes, AdminJobMenu, hubHelpers)
- Supporting: `ClockSupersedeSheet.jsx`, `PhotoNoteSheet.jsx`, `ReadingEntrySheet.jsx`, `EquipmentPlacementSheet.jsx`, `GenerateReportButton.jsx`, `Lightbox.jsx`, `clockPrecheck.js`, `techConstants.js`, i18n (`en/appointment.json`, `en/tracker.json`, `en/hub.json`, `en/tech.json`), RPC definitions in `supabase/migrations/` (`get_appointment_detail`, `get_job_hub`), `docs/tech-v2-roadmap.md` (Job Hub v2 section)

---

## 1. TechAppointment content inventory (the live legacy screen)

Data sources: `get_appointment_detail(p_appointment_id)` + `get_appointment_tasks` on mount (parallel); `job_documents` fetched by `appointment_id OR job_id` (OR-fallback so pre-tagging docs still appear); `sign_requests` (work-auth check); `get_job_rooms` / `get_job_readings` / `get_job_equipment` (feature-gated); `job_time_entries` (inside TimeTracker). Appointment payload: `id, job_id, kind, title, date, time_start, time_end, type, status, notes, is_private, created_by, jobs{id, job_number, insured_name, address, city, division, phase, client_phone, claim_id}, appointment_crew[{id, employee_id, role, employees{display_name, full_name, role}}]`.

Blocks, top to bottom:

**A. Division hero header** (background = division identity; screen forces light status-bar while mounted)
- Top row: **Back** chevron (48px) · **Help** button (topic "timer") · **"Private"** pill with lock icon (only when `is_private`) · **status pill** — the appointment's status word: `scheduled / confirmed / en route / in progress / paused / completed / cancelled`.
- **Title**: `appt.title`, fallback "Appointment".
- **Sub-line 1**: `job_number · insured_name` (e.g. "2417 · Karen Whitfield").
- **Sub-line 2**: address = `job.address, job.city`.
- **Entity link chips**: "View job" → `/tech/jobs/:jobId` (always when job exists); "View claim" → `/tech/claims/:claimId` (only when `job.claim_id`). Both carry doc/pin icon + trailing chevron.
- Divisions (semantic color families, each with gradient + pill + border variants): **water** (blue), **mold** (magenta/pink), **reconstruction** (amber/brown), **remodeling** (coral), **fire** (red), **contents** (green). Default fallback = water.
- **Notable gap:** the legacy screen never renders the appointment's own `date` / `time_start–time_end` window anywhere. The Hub fixes this.

**B. Action bar** — 5 equal icon+label columns (≥56px tall, 10px labels):
1. **Navigate** (only if address) — opens `maps://?q=` on iPhone/iPad, else Google Maps.
2. **Call** (only if `job.client_phone`) — `tel:` link.
3. **Message** — `sms:` link; when no phone, renders a **disabled** dimmed button instead of hiding (code TODO: "switch to in-app SMS when available").
4. **Photo** — label becomes "Uploading…" and disables while an upload is in flight.
5. **Edit** — navigates `/tech/appointment/:id/edit`.

**C. Compliance banner** (conditional: job exists AND no signed Work Auth) — full-width red alert strip: warning triangle, title **"No signed Work Authorization"**, sub **"Tap to collect the customer's signature"**, chevron. Tap → `/tech/jobs/:jobId/documents` with router state `{ startEsign: 'work_auth' }` (pre-opens the e-sign request sheet). Predicate: any `sign_requests` row with `doc_type=work_auth`, `status=signed` on the parent job; defaults to "signed" until checked so it never flashes.

**D. Scrollable body** (wrapped in `PullToRefresh` — refresh silently re-runs `load()`):

1. **TimeTracker** clock panel — see §3.
2. **Crew** (only if crew present): rows of initials-avatar (2 letters) + display/full name + amber **"Lead"** pill when `role ∈ {lead, crew_lead}`.
3. **Tools**: one launcher row — 📋 icon, **"Scope Sheet"**, sub "Capture scope of work room-by-room and email it", chevron → `/tech/tools/demo-sheet?jobId&jobNumber&address&insuredName&claimId` (claimId = `encircle_claim_id`).
4. **Tasks**: header "Tasks" + counter `done/total` + **"Add Tasks"** button (+ icon) → edit page `?section=tasks`. Thin **progress bar** (fill = done/total %). Empty: "No tasks assigned". Rows: full-row tap target (≥ row-height token), round **checkbox** (white checkmark when done), task `title` (done styling). Whole-row tap toggles: optimistic flip → `toggle_appointment_task(p_task_id, p_employee_id)` → revert + error toast on failure; per-task in-flight guard blocks double-taps.
5. **Moisture** (flag `page:tech_moisture`): header "Moisture" + "N readings" + red **"N stalled"** pill (stalled = latest reading per room+material with `is_stalled`). **"Add Reading"** opens ReadingEntrySheet. Empty: "No readings yet. Log MC, RH, and temp to start a drying log." Rows (first 12, then "+N older readings"): material icon · material label (13 materials: Drywall, Wood Subfloor, Wood Framing, Hardwood, Engineered Wood, Concrete, Carpet, Carpet Pad, Tile, Laminate, Vinyl, Insulation, Other) · "(unaffected)" tag when not affected · sub-line `room_name|"Untagged" · location_description · relative time` · right-aligned big mono **MC %** color-coded against `drying_goal_pct` (≤ goal = green, within 2 = amber, above = red) with "goal N%" caption · **"STALLED"** pill.
6. **Equipment** (flag `page:tech_equipment`): header "Equipment" + "N on-site"; **"Place"** opens EquipmentPlacementSheet. Empty: "No equipment on-site. Place dehus, air movers, or AFDs to start tracking days on-site." Rows: 3-letter type block (from labels: LGR Dehumidifier, Conventional Dehu, Desiccant Dehu, Air Mover (Centrifugal), Air Mover (Axial), AFD/Scrubber, HEPA, Heater, Other) · nickname-or-type-label · sub `room|"Untagged" · Day N` (`days_onsite + 1` — the number drying rental bills off) · **Remove** button with inline two-tap confirm (turns red "Confirm", auto-resets after 3s or on blur).
7. **Photos**: header "Photos" + **"Add Photo"** (same capture flow as the action bar). Empty: "No photos yet". **Date-grouped album**: group labels "Today" / "Yesterday" / weekday name (<7 days) / "Mon D, YYYY"; 2-column square-thumbnail grid; a photo's `description` renders as caption text below its thumbnail. Tap → **fullscreen lightbox** (dark backdrop, pinch-zoom enabled, ✕ close, backdrop-tap closes).
8. **Notes**: header "Notes" + **"Add Note"** → inline composer (3-row textarea, placeholder "Type a note…", Save disabled until text / "Saving…", Cancel). Empty: "No notes yet". Note rows: text + relative timestamp. Saved as `job_documents` rows (`category=note`, name "Field note", tagged to the appointment).
9. **Appointment Notes** (only when `appt.notes`): read-only office-entered text block.
10. **Reports** (`GenerateReportButton`, flag `page:water_loss_report`): list of existing water-loss-report PDFs (tap opens PDF in new tab) + "Generate" button (disabled "Generating…" while the worker runs `POST /api/generate-water-loss-report`).

**E. Overlays:** photo-saved toast (fixed above the bottom nav, 4s): **"Photo saved ✓"** + **"Add note"** link → opens **PhotoNoteSheet** (bottom sheet, grabber + ✕, 56px photo thumbnail, up to two tabs — **Note** (caption textarea, save) and **Room** (room chip grid from `get_job_rooms`, "+ new room" with quick-pick templates: Living Room, Kitchen, Dining Room, Master Bedroom, Bedroom 2/3, Master/2nd Bathroom, Hallway, Stairs, Basement, Garage, Laundry, Mud Room, Office…; creating a room auto-assigns the photo). Room tab only exists when flag `page:tech_rooms` on.

**Screen states:** route-level spinner on cold load only; "Appointment not found" empty state; load failure → error toast (`Failed to load appointment`). Photo constraints: max 10 MB, `image/*` only.

**Photo capture mechanism (snap-first law):** native Capacitor camera on iOS, hidden `<input type=file capture=environment>` on web. Two save paths: (a) **offline-queue** (flag `offline:queue`): blob → IndexedDB + enqueue `photo.upload`; haptic tick; "Photo queued — will upload when online" toast only when actually offline; a `sync:item-done` listener reloads the gallery when the queued item lands; (b) **inline** (default): POST to storage `job-files/{jobId}/{ts}-{filename}` → `insert_job_document` (category photo, appointment-tagged) → reload + haptic + the 4s "Photo saved ✓ / Add note" toast. Never blocks the camera flow with required input. Readings and equipment place/remove use the same queue fork (`reading.insert`, `equipment.place`, `equipment.remove`).

---

## 2. Action inventory & the primary action

| Action | Trigger | Mechanism |
|---|---|---|
| Back | header chevron | `navigate(-1)` |
| Help | header ? button | help sheet, topic "timer" |
| View job / View claim | hero chips | route nav |
| Navigate | action bar | `maps://` / Google Maps URL |
| Call / Message | action bar | `tel:` / `sms:` (message disabled w/o phone) |
| **Photo capture** | action bar + Photos header + (hub) dock | snap-first, offline-forked, then optional note/room |
| Edit visit | action bar (hub: dock ⋯ menu) | → `/tech/appointment/:id/edit` |
| Collect Work-Auth signature | red banner (hub: red header pill) | → documents hub, e-sign sheet pre-opened |
| **Clock: On my way / Start / Finish** | TimeTracker stations | `clock_appointment_action` (GPS on omw+start; Finish = two-tap confirm) |
| Clock: Pause / Resume | full-width secondary button (on-site/paused only) | same RPC |
| Return to Job (re-open completed) | two-tap confirm → reason input → "Clock In" | reason saved as note + `omw` action |
| Supersede other clock | ClockSupersedeSheet "Clock out & continue" / "Go to {job}" | precheck-gated |
| Task toggle | whole task row | optimistic + revert |
| Add tasks | header button (hub: inline add-task input + "Edit list") | edit page / `add_adhoc_job_task` (hub) |
| Add reading | button → 4-step wizard sheet (room → material → MC/RH/Temp with live GPP + dew point → details: affected toggle, location, linked equipment, notes; MC% is the only required field) | `insert_reading` or queue |
| Place equipment | button → 2-step wizard sheet (type icon-grid → room + optional nickname/serial) | `place_equipment` or queue |
| Remove equipment | two-tap inline confirm (3s) | `remove_equipment` or queue |
| Open photo | thumbnail → lightbox (hub lightbox adds prev/next arrows + "3/12" counter + "Add note / room" overlay) | — |
| Annotate photo | toast link or lightbox → PhotoNoteSheet (note save, room assign, room create) | `job_documents` update / `move_photo_to_room` / `create_room` |
| Add note | inline composer | `insert_job_document` category note |
| Open Scope Sheet | tool row | route nav with prefilled query params |
| Generate report / open report | reports section | worker POST / new tab |
| (hub, admin only) Merge job / Delete job | kebab → action sheet; delete requires typing "DELETE" | MergeModal / soft-delete `status='deleted'` |
| (hub) Switch visit | visit rows + "next visit" card | `?appt=` URL param (replace) |
| (hub) Schedule appointment | below-fold button | → `/tech/new-appointment?jobId=` |
| (hub) See all photos | header link | → `/tech/jobs/:id/photos` album |
| (hub) Documents | dock ⋯ menu | → `/tech/jobs/:id/documents` |

**Primary action (one-primary-action rule):** the **current clock step** — TimeTracker renders exactly ONE active accent-colored 48px station at any moment (OMW → Start → Finish in sequence; everything else on the panel is inert/history). That progression is the screen's spine. **Photo capture is the ever-present №2**: on legacy it's one of five equal action-bar buttons, but Job Hub v2 formalizes the hierarchy — the dock gives Photo a visually dominant, oversized thumb-zone button while Call/Navigate/Message/More stay small siblings, and the clock stays the single control in the Stage. A redesign should keep exactly these two poles: one state-advancing clock control + one giant capture control.

---

## 3. How the clock state machine surfaces here

**State derivation** (from the viewing tech's own `job_time_entries` for this appointment, ordered `created_at asc`):
`scheduled` (no entry) → `omw` (open entry, `travel_start` set) → `on_site` (`clock_in` set) → `paused` (`paused_at` set) ⇄ resume → `completed` (all entries have `clock_out`). One appointment can have **multiple visits** (entries): prior closed entries render as history lines "Visit N: Travel 12m · On-site 1h 30m"; the current one gets a "· Visit N" badge.

**Legacy/shared TimeTracker panel** (also used inside the Hub, frozen):
- **Status header**: uppercase colored label — "Scheduled" / "On my way" / "Started" / "Paused · 8:44 AM" / "Completed" — and the whole panel background tints by status (semantic status tokens: en-route = amber, working = green, paused = red, completed/scheduled = neutral; matches the "status = color from 3 feet away" law).
- **Three-station row** (grid of 3): Truck icon "ON MY WAY", Play icon "START", Stop icon "FINISH". Each station = 48px circle + uppercase label + its timestamp once reached ("8:44 AM", or "Apr 15 · 8:44 AM" for other days). Only the *next* legal step is tappable and accent-filled; done steps go quiet with their stamps. Interval results appear under stations once known: "Travel: 45m" (under OMW after Start), "On job: 2h 5m" (under Start after Finish).
- **Finish is a two-tap confirm** (station label flips to "CONFIRM", circle turns red; blur cancels).
- **Pause/Resume**: a full-width secondary button that exists only while on_site/paused ("Pause" ↔ green-tinted "Resume").
- **Completed** state adds **"Return to Job"** — two-tap ("Confirm Return?", amber) → inline "Reason for return" input (placeholder "e.g. Additional work requested, Follow-up monitoring...") → "Clock In" (saves reason as a job note, fires a fresh `omw`, starting Visit N+1) / Cancel.
- **Mechanics**: all actions call `clock_appointment_action(p_appointment_id, p_employee_id, p_action ∈ omw|start|pause|resume|finish, p_lat, p_lng, p_accuracy)`; GPS captured **only** on omw + start (never stall the UI for location elsewhere). Haptics: omw = medium impact; start/finish = success notify; pause/resume = light impact. `onUpdate` refreshes the host page.
- **Cross-job guard**: before OMW, `clock_omw_precheck` (fail-open) checks for an open entry on *another* appointment → **ClockSupersedeSheet** (red bottom sheet, "Still clocked in", "You're working on 2417 — Whitfield · 1h 5m"): soft mode = "Clock out & continue" (supersede, then success toast "Clocked out of {job} ({elapsed})") + Cancel; hard-block mode (office-enforced flag) = "Go to {job}" + Cancel. A server `OPEN_ENTRY_EXISTS` error re-raises the sheet as hard-block.

**Job Hub v2 additions on top of the same machine** (`useVisitClock` is a disclosed copy-in of the same derivation, so Stage and tracker can never disagree):
- **Stage buckets** reshape the screen: `arriving` (scheduled) → purpose card (visit title/type chip + time window); `working` (omw/on_site/paused) → **StageClock**, a big live `m:ss` / `h:mm:ss` timer counting from `travel_start` (freezes at `paused_at` / `clock_out`), tinted by status, labeled "Your clock · Working · Visit 2" to disambiguate from the appointment's status chip in the header; ≥10h open ⇒ amber stale hint "Still on the clock — did you forget to clock out?"; `wrapped` (completed/cancelled) → **"Time on this visit"** breakdown grid: Travel / On-site / Total (never a bare single number — tech-mobile-ux law).
- **Guards surfaced as content**: non-crew viewer → tracker replaced by "View only — you're not on this visit's crew"; cancelled visit → "This visit was cancelled", wrapped-gray, no clock; clocked into a different job → persistent banner "You're clocked into {job}" + "Go there" button (captures on this screen still tag THIS visit — explicit attribution).
- Wrapped state also offers a **"Next visit on this job"** card that switches the selected visit in place.

---

## 4. Job Hub v2 content model, differences, and cutover status

**Concept:** "the visit is the screen." One **job-scoped** surface at `/tech/job/:jobId?appt=<visitId>` (flag `page:tech_job_hub`) replacing BOTH legacy detail pages (`TechAppointment` = appointment-scoped, `TechJobDetail` = job-scoped). Four fixed zones:

- **Z1 — HubHeader** (pinned, never scrolls): Back (→ parent claim if any, else history) · `job_number` + **StatusChip of the selected visit** + "Private" lock badge · **customer name** (primary contact → `insured_name` → "Unknown") · tappable address (opens Maps) · Help · admin-only ⋯ kebab. Plus a **persistent work-auth pill**: quiet "✓ Signed" (disabled) or red "⚠ Get signature" that deep-links into signing — the one always-visible job-level compliance signal (legacy showed a banner only when missing).
- **Z2 — Stage** (reshapes around the viewer's own clock — §3): purpose card / big timer / time breakdown, then always-reachable: TimeTracker, **Office notes** (`visit.notes` — "gate codes live here", visible in ALL states), **Crew**, **HubChecklist** (tasks: `done/total` counter, progress bar, 56px optimistic toggle rows, **inline "Add task"** input saving via `add_adhoc_job_task` pre-tagged to the visit, "Edit list" link to the full editor), **HubTools** (Scope Sheet launcher + Moisture log + Equipment list — job-scoped, identical content model to legacy §1.D.5–6).
- **Z3 — HubDock** (pinned bottom, thumb zone; **hides itself whenever any text input has focus** so the iOS keyboard never covers it): **giant Photo button** (snap-first, offline-forked, "Photo saved / Add note" toast above the dock; photos always tag the SELECTED visit) · Call · Navigate · Message (each rendered disabled when phone/address missing) · **More ⋯** → overlay menu: "Documents", "Edit visit".
- **Z4 — Below the fold** (order is binding by spec):
  1. **Visits switcher** — total count; grouped **Upcoming** / **Past**; each row: title (or type) + StatusChip + `date · HH:MM` + "Crew: {first names}" + "{done}/{total} tasks" + "Viewing" badge on the selected one; tap swaps `?appt=` (URL-replace, no history spam). "Schedule appointment" button → new-appointment form. Empty: "No appointments scheduled for this job yet." Default visit selection: live visit I'm on → my non-done visit today → soonest upcoming → most recent past.
  2. **Job & Claim** collapsible card (starts collapsed; contact-count badge): claim breadcrumb "Part of claim {claim_number}" → claim page; **Contacts** (from `get_job_contacts`: name, role, company, one-tap `tel:` + `mailto:`, 48px targets); **Details** label/value rows — Address, Division (colored pill), Status, Date of loss ("Apr 2, 2026"), Type of loss, Carrier (or "Out of pocket"), Policy # (mono), Claim # (mono), **Deductible (admin/manager only)**, Notes (`ar_notes`, multiline); **Adjuster** as a contact card (denormalized name/phone/email). Sits ABOVE photos so the adjuster-call flow never scrolls past a gallery.
  3. **Photos & Notes** — combined count + "See all" → full album route; job-wide gallery, selected-visit photos first then rest (newest-first), **capped at 12 thumbnails** + "+N more photos" link; day-grouped grid with caption overlays; tap → shared **Lightbox** (prev/next arrows, "3 / 12" counter, caption, ✕) plus an overlaid "Add note / room" button → PhotoNoteSheet; notes list (text + "2h ago"); inline "Add note" composer. Capture deliberately does NOT live here (dock owns it) — this zone is look-back + annotate.
  4. **Generate report** (flag-gated, unchanged).
- **AdminJobMenu** (kebab, admin/manager only): bottom action sheet — "Merge job" (→ MergeModal) and "Delete job" → centered modal requiring the word **DELETE** typed before a **soft delete** (`status='deleted'`, "Job {n} archived" toast, navigate back to claim).
- **Data/behavior model**: one `get_job_hub` frame RPC (`job` row, `claim {id, claim_number}`, `contacts[]`, `work_auth_signed`, `appointments[]` each with crew + `task_total`/`task_completed`), `get_appointment_detail` for the selected visit (TimeTracker must receive THIS object, never the hub row), `clock_omw_precheck` for the elsewhere banner. All reads via React Query with idb persistence → **cache-first paint offline**; every mutation invalidates the hub prefix. States: cold-start skeleton (never a spinner over content); error/not-found screen "Job not found / This job may have been removed or is unavailable" with **Back + Retry** (no dead end); "This visit is unavailable."; per-zone empty states.

**Key differences vs TechAppointment (for the redesign):** job-scoped with a visit switcher (solves 1-job-many-visits sprawl); shows the visit's date/time window and purpose (legacy showed neither); adds the full reference layer (contacts incl. adjuster with tap-to-call/email, carrier/policy/claim numbers, deductible, loss date/type); adds the big live timer + travel/on-site/total breakdown; adds inline add-task; adds read-only (non-crew), cancelled, and clocked-elsewhere handling; work-auth becomes an always-present pill; adds admin merge/typed-delete; caps the gallery with an album escape hatch; moves capture to a keyboard-aware bottom dock and demotes Documents/Edit into its overflow; header back is claim-aware. Everything field-critical is kept verbatim: TimeTracker, snap-first photo flow, moisture/equipment models, scope-sheet entry, PhotoNoteSheet, two-tap confirms.

**Cutover status (verified in git + roadmap):** H1 (Stage & Dock) and H2 (Below-fold & polish) are **merged to `dev`** (commits `716dafa`, `bf01a41`; H2 = PR #322); the flag `page:tech_job_hub` is seeded **owner-only, OFF for staff**. The roadmap's **owner on-device bake gate is open** — H3 must not dispatch until written owner sign-off. **H3 (pending)** performs the cutover: `/tech/appointment/:id` becomes a resolver (job-backed visits → redirect to `/tech/job/:jobId?appt=`; job-less/private appointments → a slim "JoblessVisit" surface of TimeTracker + checklist + office notes), then deletes `TechAppointment.jsx` + `TechJobDetail.jsx` and their routes/i18n/dead CSS. A per-user runtime switch already ships in `src/components/tech/v2/nav.js` (`setHubNav` from the flag retargets every `apptHref`/`jobHref`). **After cutover the Job Hub is the live detail surface** — a greenfield redesign should target the Hub's content model, with the legacy screen as the completeness checklist.

---

## 5. Sample data for one detail-screen mockup

- **Visit**: "Drying check — Day 3" · type **Monitoring** · today (Mon Jul 14) · 9:00–9:45 AM · status **in progress** · office note: *"Gate code 4482. Dog in backyard — use front door. Homeowner leaves at 10."*
- **Customer / job**: **Karen Whitfield** · Job **#2417** · **Water** division · 4128 S Quail Hollow Dr, Millcreek, UT · phone (801) 555-0142 · part of claim **#55-8842-K19** (State Farm, policy 84-BJ-9921-3, date of loss Jul 2 2026, type: water — supply line failure, deductible $1,000) · adjuster **Dan Petersen**, (801) 555-0177, dpetersen@statefarm.com · Work Auth: **Signed ✓**
- **Crew**: Miguel Torres (**Lead**) · Ray Okafor
- **Clock**: tech's own entry — OMW 8:22 AM → Start 8:47 AM (Travel: 25m) → running timer **1:12:36**, status **Working · Visit 2** (Visit 1 yesterday: Travel 18m · On-site 2h 10m)
- **Tasks (4/6)**: ✅ Take daily moisture readings · ✅ Photograph all affected rooms · ✅ Check dehu reservoirs · ✅ Reposition air movers in basement · ⬜ Pull carpet pad in Bedroom 2 · ⬜ Get homeowner initials on drying log
- **Moisture (8 readings, 1 stalled)**: Drywall · Basement · north wall · 12m ago → **14%** (goal 12%, amber) · Carpet Pad · Bedroom 2 · **32% STALLED** (goal 10%, red) · Wood Subfloor · Bedroom 2 → **11%** (goal 12%, green) · Drywall (unaffected reference) · Hallway → 9%
- **Equipment (4 on-site)**: LGR Dehumidifier "Big Blue" · Basement · **Day 3** · Air Mover (Centrifugal) ×2 · Bedroom 2 · Day 3 · AFD/Scrubber · Basement · Day 2
- **Photos**: **15 total** — Today (6): "Basement NE corner — drywall cut 2ft", "Moisture meter — bedroom 2 subfloor"…; Yesterday (4); Friday (5). Hub shows 12 + "+3 more photos".
- **Docs (2)**: Work Authorization — signed.pdf (Jul 12) · Water Loss Report — Job 2417.pdf (generated Jul 13)
- **Note**: *"Homeowner asked about carpet replacement — told her estimator will call. Pad in Bed 2 is saturated, flagged for pull tomorrow."* — Miguel Torres, 2h ago

---

## 6. Components this surface uses that the dashboard doesn't

The dashboard (TechDashV2) shares: TimeTracker + ClockSupersedeSheet (inside its Now/Next hero), the snap-first photo button + PhotoNoteSheet + "Photo saved / Add note" toast, PullToRefresh, StatusChip, skeletons. **Detail-surface-only:**

1. **Identity header with entity links** — legacy division-gradient hero (status pill, Private pill, View job / View claim chips) → hub's pinned HubHeader (job # + visit StatusChip, customer, tappable address, claim-aware back, work-auth pill, admin kebab).
2. **Sticky bottom action dock** (hub) — oversized Photo + Call/Navigate/Message + ⋯ overflow menu; keyboard-aware self-hide; disabled-state buttons. (Legacy equivalent: the 5-up icon action bar under the hero.)
3. **Work-auth compliance banner / pill** with e-sign deep link.
4. **Task checklist**: progress bar, full-row optimistic toggle rows with round checkmarks, `done/total` counter, inline add-task row (hub), "Edit list" escape hatch.
5. **Date-grouped photo album grid** with captions, 12-photo cap + "See all"/"+N more" links (hub), and the **Lightbox** fullscreen pager (arrows, counter, caption, pinch-zoom on legacy) + hub's "Add note / room" overlay action.
6. **Notes list + inline note composer** (textarea, Save/Cancel).
7. **Crew rows** (initials avatar + Lead badge).
8. **Tool launcher row** (Scope Sheet with prefilled params).
9. **Moisture reading rows** (material icon, MC% vs goal color coding, STALLED badge, unaffected tag) + **ReadingEntrySheet** — a 4-step wizard bottom sheet (room → material grid → numbers with live-computed GPP/dew point → details) with room-creation templates.
10. **Equipment rows** (type block, Day-N counter) + **EquipmentPlacementSheet** (2-step wizard: type icon grid → room/nickname/serial) + inline **two-tap Remove**.
11. **Reports section** (list + generate).
12. **StageClock** big live timer, **purpose card**, **time-breakdown grid**, **next-visit card**, **clocked-elsewhere banner**, read-only / cancelled stage states (hub).
13. **Visit switcher rows** (Upcoming/Past groups, "Viewing" badge, per-visit crew + task counts) + "Schedule appointment" (hub).
14. **JobClaimSection** collapsible reference card: **ContactCard** (name/role/company + tel/mailto actions) and labeled **detail Row** (label-left / value-right, mono for numbers, multiline for notes), claim breadcrumb card, division pill (hub).
15. **AdminJobMenu** action sheet + **typed-DELETE confirmation modal** + MergeModal (hub, admin-only — the only typed-confirm on the tech surface).
16. **Office/appointment-notes block** (read-only).
17. Mechanism-level: the offline-queue fork for photos/readings/equipment with `sync:item-done` reload listeners; the OR-fallback docs query; feature-gate set (`page:tech_rooms`, `page:tech_moisture`, `page:tech_equipment`, `page:water_loss_report`, `offline:queue`, `page:tech_job_hub`); legacy-only: forced light status bar over the hero.

---

## survey:shell

# SURVEY 3 — Tech PWA App Shell, Navigation & Remaining Screens

Ground truth from code on `dev` @ 2026-07-14. Files cited are the implementation of record. Visual styling is intentionally omitted except where a mechanism depends on it (safe-area, display:none, etc.). All labels shown are the English defaults — **every tech string is i18n'd** (react-i18next, namespaces: `nav, dash, schedule, tasks, claims, more, msgs, hub, tech, apptForm, newEvent, settings, common`; `en/es/pt`), so the redesign must budget for longer translated strings.

---

## 1. Bottom tab bar, panes, and how the shell hosts everything

Source: `src/components/TechLayout.jsx` (wraps ALL `/tech/*` routes; rendered by `src/App.jsx` → `TechRoutes()`).

### 1.1 The tab set (exact order, labels, routes, matching)

| # | Key | Label (i18n `nav:<key>`) | Route | Icon (inline SVG, outline + filled variant) | Active match | Badge |
|---|-----|--------------------------|-------|---------------------------------------------|--------------|-------|
| 1 | `dash` | "Dash" | `/tech` | Home (house) | **exact** `pathname === '/tech'` | — |
| 2 | `claims` | "Claims" | `/tech/claims` | Folder | `startsWith` | — |
| 3 | `schedule` | "Schedule" | `/tech/schedule` | Calendar | `startsWith` | — |
| 4 | `messages` | "Messages" | `/tech/conversations` | Chat bubble | `startsWith` | **Unread count pill** (`MessagesUnreadBadge`) — mounted ONLY when `page:tech_msgs_v2` is on; reads `unreadTotal` from the shared `useTechConversations` hook (global unread, never filter-narrowed); renders nothing at 0; caps display at `99+`. Deliberately NOT gated on the tab being active (a new-message badge matters most when the tech is elsewhere). |
| 5 | `more` | "More" | `/tech/more` | Horizontal 3 dots (same glyph in both states; active conveyed by the pill) | `startsWith` | **8px red dot** when `taskCount > 0` — count of today's assigned tasks, fetched via `get_assigned_tasks` RPC in TechLayout itself and **re-polled every 60s** (failure silently ignored). |

- Each tab is a react-router `<Link viewTransition>`. Structure per tab: icon (26px) above an 11px label; active tab = **filled** icon variant + accent color + a 44×30 rounded pill drawn behind the icon (`.tech-nav-tab.active::before`); tap feedback = opacity 0.6 on `:active`; min tap target 48px (`--tech-min-tap`); `touch-action: manipulation`, no tap highlight.
- **Tasks is not a tab.** `/tech/tasks` is reached through More (with the red-dot signal on the More tab + a numeric badge on the More→Tasks row).

### 1.2 Flag-gated persistent panes (the keep-alive mechanism)

TechLayout renders up to three **persistent panes OUTSIDE the pathname-keyed `<Outlet/>` wrapper**, each lazy-loaded and flag-gated:

| Pane | Flag | Active when pathname is | Host |
|---|---|---|---|
| `TechDashV2` | `page:tech_dash_v2` | `/tech` | wrapped in shared `TechPane` |
| `TechScheduleV2` | `page:tech_sched_v2` | `/tech/schedule` | wrapped in shared `TechPane` |
| `TechMessagesV2` | `page:tech_msgs_v2` | `/tech/conversations` | owns its own **two-layer** `TechMsgsPane` (disclosed copy-in of TechPane) |

Mechanics (binding contracts, all verified in code):

- **Mounted whenever the flag is on; kept alive across navigation.** A pane is `active` only on its own path; inactive panes are hidden with the `hidden` attribute → `display:none !important` + `aria-hidden` (**CSS transforms are banned for hiding on WKWebView** — the code comments call this out explicitly). Flags off → pane not mounted at all.
- `paneCovering = dashActive || schedActive || msgsActive` → while a pane covers the screen the keyed `<Outlet/>` wrapper is **not rendered at all** underneath it.
- **Cutover state (critical for the redesign):** per `src/App.jsx` lines 251–261, the legacy `TechDash`/`TechSchedule` pages are **deleted** (tech-v2 Phase C complete). Routes `tech` and `tech/schedule` render `element={null}` — **the dash and schedule panes ARE the only implementation** (the two flags "stay on for everyone"). Messages differs: `/tech/conversations` still renders the shared legacy `Conversations.jsx` in the Outlet whenever `page:tech_msgs_v2` is off for the viewer.
- Lazy chunks: each pane loads via `React.lazy` inside `Suspense`; dash/sched fall back to `SkeletonList`; the messages fallback mirrors the hidden `.tv2-msgs-pane` shell (`hidden={!msgsActive}`) so a first chunk fetch while on another tab never flashes a skeleton over the visible screen.
- **`TechPane` (src/components/tech/v2/TechPane.jsx):** optional `header` slot rendered OUTSIDE its scroll container (`.tv2-pane-scroll`) so headers don't move on pull-to-refresh; scroll position is tracked **continuously into a ref via a passive scroll listener** (NOT saved on hide — WebKit reports `scrollTop 0` for a `display:none` element) and restored in `useLayoutEffect` (pre-paint, no visible jump); passes `active` down so screens can pause work while hidden.
- **`TechMsgsPane`:** two stacked layers (conversation list / open thread), only one visible, the other hidden-but-mounted. Only the **list** layer has a host-owned scroller with tracked/restored position; the **thread** layer's scroller belongs to ThreadView (pinned to newest), with the composer docked as a flex sibling *below* the scroller (keyboard-safe). The `tv2-msgs-thread-open` class is applied only while the pane is `active` — the CSS nav-hide rule is scoped so a background pane can never strand the whole app's tab bar.
- **`active`-prop contract consumers:** DayTimeline clears its now-line 1-minute interval when not active; the dash hero countdown and the geolocation "away" check run only while active; the thread realtime + keyboard var are active-gated; WeekStrip defers its first-paint positioning until active AND measurable width (a hidden pane reports `clientWidth 0`).

### 1.3 Other shell furniture

- **Keyed Outlet region:** `<div key={location.pathname} className="tech-content tech-content--fwd|--back">` — every navigation remounts the route and replays a 0.2s **opacity-only** fade (`tech-page-fade`). Direction class comes from `useNavigationType()` (`POP` → `--back`). Comment on why it's opacity-only: a CSS transform on `.tech-content` re-anchors its `position:fixed` children (the sticky Create/submit bars on the creation forms) into the container — a directional slide requires converting those to in-flow footers first.
- **View Transitions:** a global `@view-transition { navigation: auto }` + a directional iOS-style push (old slides out 24% + dims, new slides in) exists behind the `feature:page_transitions` flag (`html.ui-vt`, direction via `html[data-nav]` set by `useNavDirection`); flag off = a kill-switch zeroing all VT animation. Shell chrome is excluded from the push via unique `view-transition-name`s — `.tech-nav { view-transition-name: vt-technav }`. A `feature:liquid_glass` flag similarly gates a translucent-nav treatment.
- **InstallBanner:** shows for role `field_tech` only, when not already standalone and not dismissed (dismissal = sessionStorage `pwa-dismissed`). iOS: instructional text ("Share → Add to Home Screen", bolded via `<Trans>`); Android/Chrome: an "Install" button wired to the captured `beforeinstallprompt`; ✕ dismiss.
- **OfflineStatusPill:** fixed top-right (`top: env(safe-area-inset-top) + 10px`), z-500, pointer-events pass-through wrapper. Three states from the IndexedDB offline queue: amber "Syncing N" → red "N failed" (tappable, retries all) → green "Synced" flash for 2s on the >0→0 transition; renders nothing when idle.
- **Toast host (shell-owned):** listens for the `upr:toast` CustomEvent (raised only through `src/lib/toast`). Fixed, centered, **bottom = tab-bar height + safe-area + 12px**, column-reverse stack, max-width 420. Each toast: type icon (✅/⚠️/❌), optional bold title, message clamped to 3 lines, per-toast ✕, auto-dismiss 5s, slide-up entrance. Types: success / warning / error (green/amber/red left-border treatments).
- **Nav-hide rules (both must survive):** `.tech-layout:has(.tv2-msgs-pane:not([hidden]) .tv2-msgs-thread-open) > .tech-nav { display:none }` (v2 thread open) and the legacy `.tech-layout:has(.conversations-layout.mobile-thread) > .tech-nav { display:none }` (+ its `.tech-content { padding-bottom: 0 }` companion).

### 1.4 Full `/tech/*` route map (App.jsx `TechRoutes()`)

`/tech` (pane) · `/tech/schedule` (pane) · `/tech/tasks` · `/tech/claims` · `/tech/claims/:claimId` · `/tech/claims/:claimId/photos` · `/tech/claims/:claimId/rooms/:roomId` · `/tech/jobs/:jobId` · `/tech/job/:jobId` (Job Hub, `FeatureRoute page:tech_job_hub`) · `/tech/jobs/:jobId/photos` · `/tech/jobs/:jobId/documents` · `/tech/appointment/:id` · `/tech/appointment/:id/edit` · `/tech/new-customer` · `/tech/new-job` · `/tech/new-appointment` · `/tech/new-event` · `/tech/conversations` (pane or legacy Conversations) · `/tech/feedback` · `/tech/more` · `/tech/settings` · `/tech/help` · `/tech/tools/oop-pricing` (`FeatureRoute tool:oop_pricing`) · `/tech/tools/demo-sheet` · `/tech/admin/*` (Admin Mobile subrouter: index/dash, collections, invoice/:id, estimate/new, estimate/:id, leads — admin role + `page:admin_mobile`). Every route is wrapped in a per-section `ErrorBoundary`. Native (Capacitor) builds render ONLY `/login` + `/tech/*`; everything else redirects to `/tech`. Field techs hitting `/` on web are redirected to `/tech`.

**Feature flags that reshape the tech surface** (a redesign must treat these as visibility switches): `page:tech_dash_v2`, `page:tech_sched_v2`, `page:tech_msgs_v2`, `page:tech_job_hub` (also flips ALL appointment/job links via nav.js), `page:admin_mobile`, `tool:oop_pricing`, `page:tech_rooms`, `page:tech_moisture`, `page:tech_equipment`, `page:water_loss_report`, `offline:queue`, `feature:page_transitions`, `feature:liquid_glass`.

---

## 2. Header patterns, pull-to-refresh placement, safe-area

### 2.1 Header pattern taxonomy (one per screen type)

1. **Sticky greeting header (Dash):** `DashHeader` — `position: sticky; top: 0; z-20` inside the pane scroller, rendered **outside** PullToRefresh. Content: uppercase date eyebrow, "Hey {firstName} 👋", "N visits today" summary; right cluster: NotificationBell (with red count + dropdown list), Help "?" button, "⋮" menu (Admin View — admins only, Send Feedback, Sign Out with **two-tap confirm**).
2. **Sticky control-stack header (Schedule):** `ScheduleHeader` — sticky, never moves on PTR. Row 1: month+year label (h1) | search icon-toggle (active dot when a query exists) | filter icon-toggle (active dot when non-default) | **Agenda/Day segmented control** (`role=tablist`) | accent "+" create button. Row 2 (transient, only while toggled): search field with autoFocus + clear-✕. Row 3 (transient): filter panel — "Type" chip row (All/Mitigation/Reconstruction) + "Crew" scrollable chip row (Me / All / per-member multi-select). Row 4: `WeekStrip` (swipeable infinite week pager: narrow weekday letter, day number, appointment dot; today = ring, selected = filled; haptic tick on week snap).
3. **Sticky inbox header (Messages list):** title + conditional "Mark all read" (icon+text, only when unread > 0), search input (`type=search`, `enterKeyHint`), 5 status-filter pills with server counts (All / Unread / Needs Response / Waiting / Resolved). Sticky within the list layer's scroller; PTR body below.
4. **Fixed thread bar (Messages thread):** Back arrow (48px), contact name (tappable → expands an info disclosure: phone, DND state, job chip that navigates via `jobHref()`), right spacer. Tab bar hidden while the thread is open; composer docked at bottom.
5. **Compact sticky job bar (Job Hub Z1):** `HubHeader` — sticky top: Back (to parent claim), job number + `StatusChip` (selected visit's status), customer name, tappable address (opens Maps), always-present **work-auth pill** (quiet "Signed" vs red "Get signature" deep-linking into documents with the request sheet pre-opened), lock badge on private visits, Help "?", admin "⋯". Paired with the **fixed bottom `HubDock`** (Z3): giant Photo + Call + Navigate + Message + "⋯" (Documents / Edit visit), positioned above the tab bar, **slides away on `focusin` of any text input** (keyboard hazard).
6. **Full-bleed division Hero banner (legacy claim/job/appointment details):** `Hero` — division-colored gradient + watermark division icon, back button, tiny uppercase eyebrow ("CLAIM"/"JOB"), mono claim/job number, insured name (title), tappable address → Maps, status pill, ` · `-joined meta row, optional admin "•••". These screens force a light status bar on mount and restore on unmount (`nativeAppearance`).
7. **Plain in-flow page header (tab-root lists & menus):** `.tech-page-header` = `.tech-page-title` (22px) + optional `.tech-page-subtitle` — Tasks, Claims (plus count subtitle + `TechHelpButton`), More, Settings. NOT sticky; the pill toggles + search sit under it, and only the list below is PTR-wrapped.
8. **Pushed utility headers:** Help = inline "‹ Back" text button (navigate(-1)) + page header; Feedback = 48px square back button + title/subtitle block. Create/edit forms = full-screen forms with their own back affordances and **`position:fixed` bottom submit bars** (the constraint that keeps the route transition opacity-only).

### 2.2 Pull-to-refresh placement rule (uniform, binding)

`PullToRefresh` (src/components/PullToRefresh.jsx) **always wraps only the content BELOW the fixed/sticky header — never the header** (tech-mobile-ux law: sticky headers don't move on pull). Verified instances: dash body, schedule agenda/day body, messages list body, Tasks list, Claims list, ClaimDetail, JobDetail, TechAppointment, TechJobHub, TechOOPPricing. Behavior contract: touch-only; walks up to the **nearest scrollable parent** and arms only when its `scrollTop ≤ 5`; resistance-curved pull (÷2.5, max 120px), threshold 70px, `preventDefault` past 20px to suppress the browser's native PTR; indicator = rotating arrow spinner + "Release to refresh" past threshold; holds at 50px while `await onRefresh()` runs. `onRefresh` is always the **silent** reload — after first load, content is never replaced by a spinner (v2 react-query surfaces revalidate in place; the cold `SkeletonList` shows only with an empty cache).

### 2.3 Where safe-area is handled (all shell-level — pages don't hand-roll it)

- Prerequisite: `viewport-fit=cover` in `index.html` (CLAUDE.md Rule 10 — without it every `env()` is 0).
- **Tab bar:** `.tech-nav { padding-bottom: max(12px, env(safe-area-inset-bottom, 12px)); height: calc(64px + that) }` (Rule 11; `--tech-nav-height: 64px`).
- **Scrollers clear the bar:** `.tech-content` and `.tv2-pane-scroll` and the msgs list layer all use `padding-bottom: calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom, 12px)))`.
- **Floating elements budget nav + safe-area:** toast stack, `CreateFAB` stack (+16), schedule "Today" pill (+14), `HubDock` (bottom = nav + safe-area), StalledWidget-adjacent offsets, legacy conversations thread heights (`100dvh − nav − safe-area`).
- **Top inset:** OfflineStatusPill (`env(safe-area-inset-top) + 10px`).
- **Bottom sheets** add their own home-indicator bottom padding (PhotoNoteSheet/ClockSupersedeSheet/TechHelpSheet pattern).

---

## 3. Screen-by-screen content summaries

**Dash — `/tech` (`TechDashV2` + `dash/*`).** One `get_tech_dashboard` round trip feeds the whole page. Top-to-bottom: sticky greeting header (see 2.1); `AttentionStrip` — additive warning banners: "you've walked away from a running job" (foreground-only GPS, 20s debounce, with inline Pause/Finish actions) and an after-5PM "still clocked in" nudge (with Finish), plus the red `StalledWidget` (materials not drying across a 30-day window: material icon, room, job #, reading vs goal, days stuck; collapsed to 3 + "Show all (N)"; hidden without `page:tech_moisture`); `NowNextHero` — the single most relevant thing now: a live visit with the full `TimeTracker` clock + Photo button, or a countdown to today's next visit, or a preview of the next upcoming, or a friendly empty state pointing at the schedule; `MiniTimeline` — horizontal swipeable strip of today's stops as status-colored chips (status owns the color channel); "Rest of today" as `ApptListRow`s; `MyNumbers` — hours today & this week always as labeled Travel + On-site + Total (never a bare number; payroll excludes travel — the breakdown is deliberate honesty), tasks done, photos today; `CompletedRows` — finished visits each with per-visit travel/on-site/total (fetched per row from `job_time_entries`); `ComingUp` — my next 7 days grouped under day headings; `CreateFAB` — floating "+" opening New Job / New Customer. Mutations invalidate only touched react-query caches; PTR/focus refreshes never re-skeleton.

**Schedule — `/tech/schedule` (`TechScheduleV2` + `schedule/*`).** Sticky header (see 2.1) over two switchable views, default **Day**. **Agenda view:** continuous infinite scroll of every day that has appointments; sticky per-day headers ("Today · Fri, Jul 4" / "Tomorrow · …") with a count badge; opens pre-anchored on today (no flash); scrolling up loads the past with scrollTop compensation (viewport visually stationary); scrolling silently drives the week-strip highlight (only after a REAL user gesture — programmatic anchoring never leaks). **Day view (`DayTimeline`):** Apple-Calendar-style hour grid (default 6:00–20:00, auto-widening; 80px/hour), appointments as status-tinted blocks at true time/height, greedy lane-packing for overlaps, an "all day" chip strip for untimed items, a red now-line ticking each minute (active-gated) with time label, opens anchored ~2.5h above now (once per selected day — a scroll you left is respected on return). Rows/blocks show insured name or title, time+duration, city, division pill, milestone ◆, private lock, "N-day" span pill, task done/total, `CrewAvatars`. Filters (Me/All/multi-crew + division) persist per-tech in localStorage (shared key with the legacy page); search is transient and in-memory. Floating "Today" pill appears when scrolled/selected away from today. "+" opens `CreatePicker` (bottom sheet: "Job appointment" / "Event" → routes to the create forms with `?date=`). Data: `get_appointments_range` per month via react-query, ±1-month prefetch, loaded-months set only grows; day selection never triggers a fetch.

**Messages — `/tech/conversations` (`TechMessagesV2` + `messages/*`, flag-gated; legacy shared `Conversations` otherwise).** List layer: header (see 2.1); rows show initials avatar (group icon for multi/broadcast), name, last-message time, one-line preview (+ "N recipients" pill on group threads), unread = bold + red count badge; a sibling "⋯" per row expands ONE inline 48px action (Mark read/unread — never hover idioms); server-side search (debounced 250ms) + server-side status filters with per-pill counts; cold-start skeleton rows; error state with Retry; empty vs no-match states. Thread layer (opened by pushing `?c=<id>` so browser Back / iOS swipe-back closes it; deep links to off-page conversations fetch a single row and fold it in; bad ids show a not-found panel with "Back to list"): fixed bar (back, name → info disclosure with phone / DND / job chip), messages grouped under day headers as `MessageBubble`s with delivery/status ticks and retry-on-failed, opens pinned to newest, infinite up-scroll history keeps your place, "jump to latest" pill with new-message count, scroll-up blurs the composer (native reading gesture). `Composer`: auto-growing textarea (≤5 lines, ≥16px anti-zoom font), per-conversation localStorage drafts, "+" tool sheet (attach ≤5 photos as uploading MMS tiles, saved templates inserted at caret, switch to internal note), pointer-aware Enter (touch = newline, desktop = send), DND banner blocks SMS but still allows internal notes; DND is one-tap ON only for techs. All sends go through `POST /api/send-message` (worker is the sole writer).

**Claims list — `/tech/claims` (`TechClaims`).** Header + count subtitle + help button; "My Claims"/"All Claims" pill toggle (persisted per device, default All; Mine = `get_tech_claims` with fallback to `get_claims_list`); 48px search (in-memory, 200ms debounce, matches claim #, insured, city, carrier). Rows (min 80px): mono claim # + date-of-loss; insured name; address line; pill row = division, "N jobs", status. Tap → claim detail. Full-page spinner on cold load; empty state with clear-search action.

**Claim detail — `/tech/claims/:claimId` (`TechClaimDetail`).** Hero banner; `ActionBar` (Call / Navigate / Message, disabled-when-missing); `NowNextTile` (ON MY WAY / WORKING / PAUSED / TODAY / NEXT with time, title, job #, crew first names → opens the appointment); one **JobTile per job** on the claim (division-tinted, task progress, next appointment); photos+notes per job via `PhotosGroup` (3 thumbnails + "+N more" tile, ≤3 notes, division mini-header when multi-job) with snap-first Add Photo (native camera or file input; offline-queue path under `offline:queue`) and Add Note; **Rooms grid** (`RoomCard` cover-photo tiles + `AddRoomSheet`; `page:tech_rooms`); demo-sheet list; full details panel (`DetailRow`s: carrier, policy, adjuster, homeowner…); admin "•••" → `MergeModal` or archive (soft delete, typed-DELETE confirm). `Lightbox` viewer; PTR.

**Job detail — `/tech/jobs/:jobId` (`TechJobDetail`, legacy; slated for H3 deletion).** Hero + 4-button ActionBar (adds Documents); red "No signed Work Authorization" banner deep-linking into documents with the Work-Auth sheet pre-opened; breadcrumb to parent claim; collapsible "Job details" panel (DetailRow set incl. deductible); NowNextTile; Upcoming/Past `AppointmentCard`s (from claim-wide fetch, filtered client-side); PhotosGroup + add photo/note; Lightbox; admin kebab (merge / typed-DELETE archive); PTR.

**Job Hub — `/tech/job/:jobId?appt=<id>` (`TechJobHub` + `hub/*`, flag `page:tech_job_hub`; when the flag is on, ALL appointment/job links in the app retarget here via nav.js).** Four zones. **Z1** HubHeader (see 2.1). **Z2 Stage** — reshapes around the tech's own clock on the selected visit: purpose card before departure → big `StageClock` elapsed timer while live (status-tinted, "Your clock" label, >10h forgot-to-clock-out hint) → travel/on-site/total once done; TimeTracker buttons beneath, unchanged; office notes + crew always visible; `HubChecklist` — 56px optimistic-toggle task rows, progress bar, inline add-task, "Edit list" shortcut; `HubTools` — Scope Sheet shortcut, moisture drying log (readings colored vs goal, stalled flags, `ReadingEntrySheet`), equipment list (days running, two-tap Remove, `EquipmentPlacementSheet`), offline-queue capable; non-crew viewers get read-only; a tech clocked into a different job gets a "go there" banner. **Z3** HubDock (see 2.1). **Z4** below-fold: visit switcher rows (+ schedule new visit; writes `?appt=`), collapsible `JobClaimSection` (all contacts with one-tap call/email, carrier/policy/claim, adjuster, admin-only deductible, jump-to-claim card — deliberately ABOVE photos so the adjuster-call flow never scrolls past a gallery), `PhotosNotes` (day-grouped thumbnails, ~12 cap + "See all" → album, notes list, quick add-note box, Lightbox with an "Add note / room" sibling overlay), `GenerateReportButton`. Admin "⋯" → `AdminJobMenu` sheet (merge / typed-DELETE archive). Fully react-query cached (`['tech','hub',jobId]` prefix), PTR.

**Appointment detail — `/tech/appointment/:id` (`TechAppointment`, legacy; slated for H3 deletion but still routed).** Division hero + 5-button action bar variant; `TimeTracker` (see census); crew; task checklist; moisture readings + equipment (flag-gated sections, sheets mounted unconditionally and self-gating); photo gallery + notes (`PhotoNoteSheet`); water-loss report section (flag); offline-queue captures; inline two-tap equipment remove; PTR.

**Edit appointment — `/tech/appointment/:id/edit` (`TechEditAppointment`).** Full-screen form: DatePicker; start/end time selects (30-min steps 6:00–22:00 = `TIME_OPTIONS`); type (`MOBILE_TYPES`: reconstruction/inspection/monitoring/mitigation/estimate/other); crew multi-select (initials chips); task checklist with toggle-complete + add from job's unassigned tasks + create ad-hoc; notes; private toggle (admin/PM only); shows the chosen day's other appointments to avoid double-booking; delete = two-tap confirm (3s arm, blur cancels). `?section=tasks` auto-opens the task section.

**New appointment / event / customer / job (`/tech/new-*`).** All full-screen forms sharing the `techFormConstants` kit (48px inputs, 16px anti-zoom font, uppercase micro-labels) with fixed bottom submit bars. **Appointment:** job search-select → date/time/type → crew → attach unassigned tasks (+ ad-hoc add) → notes; title auto-generated from selected task phases; `?date=` prefill; private toggle (admin/PM). **Event:** title, date, times, notes, assignees (empty = company-wide block); no job/division. **Customer:** type selector as 4 emoji cards (homeowner/tenant/adjuster/other), name, phone, email, billing address (`AddressAutocomplete`), carrier field for adjusters, notes; duplicate phone silently opens the existing contact. **Job:** contact search with inline quick-add, division, referral source, loss address, carrier (`CarrierSelect` incl. out-of-pocket which hides claim number), optional details; creates job+claim+links in one RPC then awaits an Encircle sync (8s timeout) before navigating; help button.

**Tasks — `/tech/tasks` (`TechTasks`).** Today/All pill tabs (48px, haptic selection); search bar; Today-only completion summary (SVG `CompletionRing` "done/total" + label); tasks grouped by job under collapsible headers (mono job # + insured + mini progress bar + done/total + rotating chevron); `SwipeTaskRow` — tap the check circle OR swipe right ≥40px (green "Done ✓" reveal, haptic at threshold and on commit) to toggle, optimistic with revert-on-failure and per-task double-fire guard, task name struck when done + phase sub-line; empty states per tab (Today's offers "View all"); PTR. Full-page spinner cold load.

**More — `/tech/more` (`TechMore`).** Grouped rows in bordered section cards with uppercase group titles: **Admin** (only for admins with `page:admin_mobile`): Dashboard, Collections, New Estimate, Lead Center; **Work**: Tasks (red numeric badge = today's count), OOP Pricing (flag), Collections (*Soon*), Time Tracking (*Soon*); **Resources**: Help & Guides, Checklists (*Soon*), Scope Sheet (*Soon*); **Preferences**: Settings. Row anatomy: 38px rounded icon tile, 15px label, then either chevron (+optional count badge) or an uppercase "SOON" tag; comingSoon rows are non-tappable divs at 0.55 opacity.

**Help — `/tech/help` (`TechHelp` + `techHelpContent`).** Static, big-type, glove-friendly: "‹ Back", header, accent intro card, then `TopicCard`s (shared TOPICS: the timer/OMW flow, photos, task checklist, moisture readings, schedule, claims, starting a job — each a short numbered list with tapped-button names bolded), and a "Stuck on something?" footer pointing at Send Feedback / call the office. Same content powers the contextual `TechHelpSheet` overlay so wording never drifts.

**Feedback — `/tech/feedback` (`TechFeedback`).** 48px back button + title; type selector = two 80px cards (Bug Report / Improvement) that recolor the labels/placeholders; title input (required ≥3 chars, max 120); optional details textarea (max 2000); `FeedbackAttachments` (photos + one short video; each uploads immediately after client-side compression; tiles with progress, Retry on failure, remove also deletes from storage); 56px full-width submit, disabled until valid and all uploads settle ("Uploading attachments…" state); success toasts + returns to `/tech`; admin notify is fire-and-forget.

**Settings — `/tech/settings` (`TechSettings`).** Slot-host stack of preference cards: Appearance (light/dark), Language, Notifications (push devices/prefs). Each section owns its own data.

**OOP Pricing — `/tech/tools/oop-pricing` (`TechOOPPricing`, flag).** Out-of-pocket quote calculator: labor hours, equipment steppers (first increment defaults 3 drying days), materials, fees; mold job type reveals extra fields (negative air, containment, PRV); live total strip + margin readout with thin-margin color warning; quotes save/reopen (`?quoteId=`), prefill from a job (`?jobId=`), link to claim/job via `ClaimPicker`; Reset and Delete are two-click inline confirms; PTR. All math in `lib/oopPricing`.

**Scope/Demo Sheet — `/tech/tools/demo-sheet` (`TechDemoSheet`).** Schema-driven demolition scope form (fields come from `demo_sheet_schemas`, not code): job info, optional Encircle claim link (worker-backed search + room import), one card per room with quantity fields, 2s-debounced silent autosave drafts (resume in place, never a reload), Review & Submit read-only summary → saves to `forms`, emails the office, posts an Encircle note; result screen reports each side channel separately.

**Albums & rooms.** **Claim album** `/tech/claims/:id/photos`: all photos across the claim's jobs, grid grouped by job (headers only when multi-job), Add Photo (job-picker sheet first when multi-job), Lightbox, `focusJobId` scroll-into-view. **Job album** `/tech/jobs/:id/photos`: single-job grid newest-first with date/time captions, Add Photo, Lightbox. **Room detail** `/tech/claims/:claimId/rooms/:roomId`: claim-scoped room; Photos (grouped by day) / Notes tab pair, Add Photo pre-tagged to the room (job picker when multi-job), offline-queue path, Lightbox.

**Job documents — `/tech/jobs/:jobId/documents` (`TechJobDocuments`).** E-sign hub: requests grouped Awaiting / Signed / Cancelled; actions per row: open signed PDF, resend link, copy link, cancel; big "Request signature" → `EsignRequestSheet` (Work Authorization or Certificate of Completion; signer prefilled; **collect on-site** navigates in-app to the public `/sign/:token` screen so the customer signs on the tech's phone, or **email a link**); reloads on tab refocus so a just-collected signature appears.

**Admin Mobile — `/tech/admin/*`.** Admin capabilities inside the tech shell (own initiative, listed for completeness): AdminDash, AdminCollections, AdminInvoiceDetail, AdminEstimateDetail, AdminEstimateEditor, AdminLeadCenter; whole subtree gated by `AdminMobileRoute` (admin role + flag), lazy per screen with `TabLoading`.

---

## 4. Component-type census across `/tech/*` (the design-system checklist)

**List rows**
- `ApptListRow` (v2 shared): color accent bar · title · meta line (time · who/where · task n/m) · StatusChip — dash "rest of today", ComingUp.
- `ScheduleRow` (agenda): time column (start + duration) · accent bar · title (+ milestone ◆, private lock) · secondary line · meta row (StatusChip, division pill, "N-day" pill, task count, CrewAvatars) · chevron; distinct event variant (purple accent).
- `ConvoRow`: avatar · name+time · preview (+ recipients pill) · unread count badge · sibling "⋯" expanding one inline 48px action.
- `SwipeTaskRow`: check circle · name (strikes when done) · phase sub-line · swipe-right green "Done" reveal.
- Claims-list row (inline): mono #+date / name / address / pill row.
- `MoreRow`: icon tile · label · chevron | count badge | "Soon" tag.
- `DetailRow`: label:value line (tel:/mailto: link, mono, capitalize, multiline variants; renders null when empty) — claim/job details panels.
- Others: hub `VisitRow` (switcher), dash `CompletedRow` (time breakdown), moisture-reading rows, equipment rows, sign-request rows, stalled-material rows, notes lists.

**Cards / tiles / banners**
- `Hero` division-gradient banner (claim/job/appointment detail). `NowNextTile` (claim/job). `NowNextHero` + countdown (dash). `JobTile` (claim detail). `AppointmentCard` (job detail upcoming/past). `RoomCard` (cover-photo tile). `TopicCard` (help). `StageClock` + purpose/breakdown cards (hub). `MyNumbers` hours cards. Type-selector cards (Feedback Bug/Improvement; NewCustomer roles). Settings cards. Section cards (More). Warning banners: StalledWidget, away-from-site, 5PM clocked-in, "No signed Work Auth", DND banner, "clocked elsewhere".

**Bottom sheets** (fixed backdrop + slide-up panel, safe-area bottom padding, tap-outside/✕ close — the house idiom; NO modal dialogs for field actions): `CreatePicker` · `PhotoNoteSheet` (Note/Room tabs, room create inline) · `ReadingEntrySheet` (4-step wizard: room → material → numbers with live GPP/dew-point → details) · `EquipmentPlacementSheet` (2-step: type icon-grid → room + nickname/serial) · `AddRoomSheet` (template grid + custom name) · `ClockSupersedeSheet` (red warning; confirm-and-continue vs hard-block "go to job") · `TechHelpSheet` (contextual help overlay, never navigates) · `EsignRequestSheet` (portal-rendered) · `AdminJobMenu` · Composer "+" tools sheet · album/room **job-picker** sheets · DashHeader "⋮" and hub "⋯" menus.

**Modals / overlays:** `MergeModal` (shared with desktop — claim/job merge); `Lightbox` full-screen photo viewer (dark backdrop, prev/next, "3 / 12" counter, caption, ✕; hub adds a sibling "Add note / room" overlay button). Typed-word confirms ("DELETE") live inline inside sheets, not native dialogs.

**Segmented controls / pill tab sets:** Agenda/Day segmented (`role=tablist`); Tasks Today/All pills; Claims Mine/All pills; msgs status-filter pills (with counts); RoomDetail Photos/Notes tabs; OOP `PillToggle`. All 44–48px, haptic `selection()` on change.

**Chips:** filter `Chip` (active state), `RoomChip` (checkmark when selected, photo count), MiniTimeline stop chips, day-timeline all-day chips, thread job chip, "Soon" tag, work-auth pill, division pills, "N-day" span pill.

**Badges & status:** `StatusChip` (Scheduled/On My Way/Working/Paused/Done/Cancelled — color IS the message; tokens `--status-*` with dark-theme retints); tab red dot (More) and unread-count pill (Messages, 99+ cap); row unread badges; agenda day-count; icon-button active dots (search/filter); NotificationBell count; OfflineStatusPill (syncing/failed/synced); milestone ◆; private lock.

**Avatars:** `CrewAvatars` (colored initials circles + "+N" overflow) — agenda rows, timeline blocks; ConvoRow initials/group avatar; crew-picker initials chips in forms.

**FAB & floating controls:** `CreateFAB` (56px, dim backdrop, two labeled child actions) — dash only; `tv2-today-pill` (schedule, centered above nav); `HubDock` fixed action bar; "jump to latest" pill (thread); `ActionBar` (in-flow Call/Navigate/Message[/Documents] row; TechAppointment has an unshared 5-button variant).

**Toasts:** shell-owned stack via the single `upr:toast` channel (success/warning/error, optional title, ✕, 5s auto-dismiss, above the tab bar); the **action toast** pattern "Photo saved · Add note" (4s) opening PhotoNoteSheet.

**Loading:** `SkeletonBlock/SkeletonRow/SkeletonList` (v2 cold starts + pane Suspense fallbacks — cached content is never replaced by them); `.loading-page` full-page spinner (legacy Tasks/Claims/detail cold loads); PTR spinner; `TabLoading` (admin subtree); inline busy button labels ("Sending…", "Generating…", "Uploading attachments…").

**Empty / error states:** schedule EmptyState (icon, title, sub, "+ New appointment" CTA; filter-aware copy); `.empty-state` (icon/text/action) on Tasks (cross-tab link) and Claims (clear search); msgs empty, no-match, error-with-Retry, thread not-found panel; tech rule: empty states surface *upcoming work*, never dead ends.

**Search inputs:** transient icon-toggled search (schedule, autoFocus + clear ✕); persistent search bars (Tasks 44px, Claims 48px; leading icon, clear button, **16px font to prevent iOS zoom**); msgs `type=search` with `enterKeyHint`. Debounce 200–250ms; claims/tasks in-memory, msgs server-side.

**Date & time:** shared `DatePicker` (new/edit forms); `WeekStrip` as the schedule's date selector; native `<select>` time pickers from `TIME_OPTIONS` (30-min steps, 6:00 AM–10:00 PM); `?date=` prefill contract from schedule → create forms.

**Photo system:** grids (albums; `PhotosGroup` 3-up + "+N more"; `PhotosNotes` day groups with ~12 cap + See all); `Lightbox`; capture buttons (`PhotoCaptureButton`, HubDock camera, album Add Photo) — native camera on device / hidden file input on web, 10MB image cap, **snap-first: upload starts immediately, note optional afterwards**; `FeedbackAttachments` compress-then-upload tile tray with progress/retry/remove; two upload paths everywhere (inline vs `offline:queue` IndexedDB queue + `sync:item-done` listeners that refresh the exact section).

**Form kit:** `inputStyle`/`labelStyle` (48px fields, uppercase micro-labels), textareas, `AddressAutocomplete`, `CarrierSelect` (+OOP), `ClaimPicker`, steppers (`StepperRow`, `NumField`), toggles (private checkbox, affected toggle, settings toggles), completion ring SVG, progress bars (task groups, hub checklist), initials-chip multi-selects (crew).

**Confirm idioms (never native dialogs):** two-tap inline confirm with ~3s auto-cancel (Sign Out, Finish/Return-to-job, equipment Remove, appointment delete, OOP reset/delete); typed-"DELETE" confirmation for claim/job archive.

**Clock/timer system:** `TimeTracker` — three big round station buttons On my way → Start → Finish (+ Pause/Resume on site), timer runs from OMW, GPS captured on omw/start only, visit history ("Visit N") summaries, return-to-job with reason note, `ClockSupersedeSheet` integration; `StageClock` display-only big timer; dash countdown; day-timeline now-line.

**Haptics vocabulary** (`nativeHaptics`, no-op on web): `selection()` — pill/tab switches, week-strip snap; `impact('light'/'medium')` — photo save, swipe threshold/commit, menu presses; `notify()` — clock action outcomes.

---

## 5. Shell mechanics a redesign MUST NOT break

1. **Pane keep-alive + `active` contract.** Dash/Schedule/Messages are persistent panes mounted outside the keyed route wrapper; hide = `hidden`/`display:none` only (**never** transforms/offscreen positioning — WKWebView; never unmount, that's the whole point). The `active` prop must keep gating timers, GPS, realtime, and first-paint anchors. Scroll must keep being tracked **continuously into a ref** (a `display:none` element reads `scrollTop 0`, so save-on-hide restores to top) and restored in `useLayoutEffect` pre-paint. Messages needs **two independent scrollers** (list restores; thread pins to newest — one shared scroller "clamp-poisons" restore). Remember: `/tech` and `/tech/schedule` have **no Outlet fallback anymore** — the panes are the screens; `/tech/conversations` still needs the legacy fallback while `page:tech_msgs_v2` gates it.
2. **`.tech-nav` safe-area rule (CLAUDE.md Rule 11) + bottom clearance economy.** Tab bar `padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))`, total height = `--tech-nav-height` + that; `viewport-fit=cover` must stay in `index.html` (Rule 10). Every scroller (`.tech-content`, `.tv2-pane-scroll`, msgs list) and every floating element (toasts, FAB, Today pill, HubDock) budgets `nav + safe-area` bottom clearance off the same tokens. The nav-hide `:has()` rules (thread open — v2 AND legacy variants) must stay scoped to a **visible** pane so a background pane can't strand the tab bar. The nav carries `view-transition-name: vt-technav` so shell chrome never animates during page transitions.
3. **One scroller per surface + hand-rolled restoration semantics.** Route pushes remount a fresh `.tech-content` (new scroll = top); pane scroll survives tab switches; agenda/day/thread find their scroller via `ref.closest('.tv2-pane-scroll')` (never a global querySelector — breaks under the pane host) and re-assert anchors via a queued microtask so they win over the pane host's restore; infinite lists compensate prepends exactly (WeekStrip `scrollLeft`, AgendaView `scrollTop`) so content never shifts under the thumb. Day-selection and week-paging must remain pure client state (no fetch); month-window data only grows.
4. **PullToRefresh wrapping rule.** PTR wraps content BELOW the fixed/sticky header, never the header; it arms only at `scrollTop ≤ 5` of the nearest scrollable ancestor, so it must live *inside* the surface's own scroller; `onRefresh` is always silent (no loading-flag flip, no skeleton after first load, content never blanked — the minimize-test law in `page-lifecycle.md` applies to every page: resume does *nothing*).
5. **Navigation contracts.** (a) Every appointment/job link goes through `apptHref(apptId, jobId)` / `jobHref(jobId)` from `src/components/tech/v2/nav.js` — a runtime per-user switch (`setHubNav` from `page:tech_job_hub`) retargets the whole app between legacy pages and the Job Hub; hardcoding `/tech/appointment/` or `/tech/jobs/` is forbidden. (b) The messages thread lives in the URL as `?c=<id>` pushed onto history (Back/iOS swipe-back closes it; close = `navigate(-1)` to keep the stack honest). (c) The keyed-outlet route transition must stay transform-free while creation pages keep `position:fixed` submit bars (or those bars must be converted first); direction classes come from `useNavigationType`. (d) `upr:toast` stays the single toast channel; the More-tab badge poll (60s `get_assigned_tasks`) and the Messages badge (shared `useTechConversations` cache + single ref-counted realtime channel) are shell-owned and must survive any re-skin.

---

## survey:architecture

# SURVEY 4 — Token & Primitive ARCHITECTURE (tech PWA greenfield reskin)

Scope surveyed: `src/index.css` token/`:root`/marker sections only, all of `src/components/ui/`, `src/components/TabLoading.jsx`, all of `src/hooks/`, `src/components/tech/v2/` primitives, `src/components/Icons.jsx` + `DivisionIcons.jsx` + `TechLayout.jsx` nav icons, `src/contexts/ThemeContext.jsx`, `src/pages/tech/techConstants.js`, `UPR-Design-System.md` headings.

---

## 1. Token NAMESPACE (names + structure only)

One CSS file (`src/index.css`, ~11.9k lines). Custom properties are defined in exactly **six kinds of places**: the global `:root` (line 10), a **shell-scope block** per sub-app (`.tech-layout` line 4468, `.crm-shell` line 8327), **theme-override blocks** that re-declare the same names (`[data-theme="dark"] .tech-layout` line 4527, `.crm-roadmap-page.dark` line 8294), two page-scoped `:root` mini-namespaces added by settings waves (lines 10566, 10622), and one media-query re-set (`:root { --topnav-h }` at ≥1024px, line 7962). Components read `var(--…)` only; no other definition sites exist.

### Global `:root` (lines 10–122)

| Group | Token names |
|---|---|
| **App-shell / sidebar** | `--sidebar-bg`, `--sidebar-text`, `--sidebar-text-active`, `--sidebar-hover`, `--sidebar-active`, `--sidebar-accent`, `--sidebar-width` |
| **Surfaces** | `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-elevated` |
| **Borders** | `--border-color`, `--border-light` |
| **Text** | `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-inverse` |
| **Accent** | `--accent`, `--accent-hover`, `--accent-light`, `--accent-text` |
| **Conversation-status (desktop legacy)** | `--status-needs-response(-bg)`, `--status-waiting(-bg)`, `--status-resolved(-bg)`, `--status-active(-bg)` |
| **Semantic status tones** (F-S2; the 5 tone families, each a fg/bg/border **triplet**) | `--success`/`--success-bg`/`--success-border`, `--danger/…`, `--warning/…`, `--info/…`, `--neutral/…` — consumed by `StatusPill` via `data-tone`, never inline hex |
| **Shadows** | `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| **Radii** | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-full` |
| **Spacing** (4px-base scale) | `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-5`, `--space-6`, `--space-8` |
| **Type** | `--font-sans`, `--font-mono`; sizes `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--text-2xl` |
| **Motion (legacy pair)** | `--transition-fast`, `--transition-base` (duration+ease combined) |
| **Motion catalog** (F-S2; law = `motion-standard.md`; durations and easings **separate**) | `--motion-duration-fast`, `--motion-duration-base`, `--motion-duration-slow`; `--motion-ease-standard`, `--motion-ease-decelerate` (enters), `--motion-ease-accelerate` (exits); `--motion-spring-in` (a `linear()` spring, **enters only**, banned on exits/sheets/money surfaces — the `-in` suffix is intentional signalling) |
| **Layout / safe-area** | `--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right` (each wraps `env(safe-area-inset-*)`), `--bottom-bar-h`, `--topnav-h` (0 by default, re-set inside the desktop media query) |

### Tech shell scope — defined ON `.tech-layout` (lines 4468–4498)

| Group | Token names |
|---|---|
| **Tech type scale** | `--tech-text-body`, `--tech-text-label`, `--tech-text-heading`, `--tech-text-hero`, `--tech-text-timer` |
| **Tech shape/elevation** | `--tech-radius-card`, `--tech-radius-button`, `--tech-shadow-card`, `--tech-shadow-card-active` |
| **Tech ergonomics** | `--tech-min-tap` (48px floor concept), `--tech-row-height`, `--tech-nav-height` (feeds `.tech-content` bottom-padding math) |
| **Tech misc** | `--tech-accent` (neutral accent-bar fallback when an appointment has no color), `--tech-nav-bg` (translucent nav; the one shell color dark overrides directly) |
| **★ The 5 field-status semantic families** (each a `-bg` / `-color` / `-border` **trio**; the "color from 3 feet away" system) | `--status-scheduled-*` (blue), `--status-enroute-*` (amber, key `enroute`), `--status-working-*` (green), `--status-paused-*` (red), `--status-completed-*` (gray — also used for `cancelled`) |

### Theme-override blocks (re-declare the SAME names, new values)
- `[data-theme="dark"] .tech-layout` (4527–4559): re-points `--bg-*`, `--border-*`, `--text-*`, `--accent-light`, `--tech-nav-bg`, the five `--status-<field>-bg` tints, and the semantic `--*-bg`/`--*-border` pairs. Deliberate rule: **only backgrounds/borders re-tone; fg hues keep their hue** for contrast. Comment notes "detail-screen inline hexes are a later polish pass" (i.e., inline-hex debt is invisible to this mechanism).
- `.crm-roadmap-page.dark` (8294): page-local copy of the same trick (and the same dark hex set duplicated — a wart, see §6).

### Other namespaces (not tech, but part of the architecture)
- **CRM**: `--crm-*` scoped on `.crm-shell` — `bg-sidebar, sidebar-text, sidebar-text-active, accent, bg-content, bg-card, text-primary/secondary/tertiary, border, radius, success, success-bg, danger-bg/border/text, integration-{callrail,google,meta,github}, channel-insurance, text-on-accent, speaker, speaker-bg`.
- **Settings-wave page namespaces** (in `:root`): `--fb-badge-{bug,feature,new,reviewed,resolved,dismissed}-{bg,color,border}` (Feedback Inbox, 10566) and `--ss-{danger, success(-bg/-border), warning(-bg/-border), info(-bg/-border)}` (Scope Sheets, 10622) — several alias core tokens via `var()`, showing the sanctioned "namespace aliases core" pattern.

---

## 2. Shared-primitives inventory

### `src/components/ui/` (owned by UX-Quality F-S2; wave sessions import-only; barrel `index.js` exports all)

| Component | Props | Purpose / variants / behavior contract |
|---|---|---|
| **`Modal`** | `open=true`, `onClose`, `title`, `children`, `footer`, `size` (`'sm'`\|`'lg'`\|default), `closeOnOverlay=true`, `className` | THE app dialog. `role="dialog"` + `aria-modal` + `aria-labelledby` (`useId`), focus moved in on open, full Tab focus-trap, ESC close, drag-safe overlay close (mousedown **and** click must both land on overlay), body scroll-lock, focus restored on close. **Exit lifecycle**: on `open→false` stays mounted with a `--closing` class, unmounts on `animationend` of named exit keyframes (`uiModalOut` desktop scale-down / `uiSheetDown` mobile slide-down) with a 240ms safety timeout; reduced-motion closes instantly. Desktop = centered fade+scale; mobile ≤768px = bottom sheet. CSS: `.ui-modal-overlay`, `.ui-modal(--sm/--lg/--closing)`, `.ui-modal-header/-title/-body/-footer/-close`. |
| **`IconButton`** | `label` (**REQUIRED** — becomes `aria-label` + `title`; dev-mode `console.error` if missing), `children` (the glyph), `onClick`, `size` (`'sm'` 30px dense \| `'lg'` ≥44px tech floor \| default), `disabled`, `type='button'`, forwardRef | Icon-only button a11y contract. Fires `impact('light')` haptic (from `@/lib/nativeHaptics`) on every click; press-scale is CSS + reduced-motion-safe. CSS: `.ui-icon-btn(--sm/--lg)`. |
| **`StatusPill`** (+ `toneForStatus` from `statusTone.js`) | `status`, `tone` (`success\|danger\|warning\|info\|neutral` — explicit override), `label` (overrides humanized status text), `dot=false` (leading status dot), `className`, `...rest` | Renders `span.ui-status-pill[data-tone=…]`; **CSS keys off the `data-tone` attribute** and reads the semantic token triplets — the theming seam. `toneForStatus()` classifies via keyword tables (exact-word first, substring fallback, e.g. `estimate_approved`→success); unknown → `neutral`, never an uncolored pill. Replaces 158 inline pills. |
| **`EmptyState`** | `icon`, `title`, `sub`, `action` (any node), `className` | The **success-only** zero-rows panel (`loading-error-states.md` §2). Tech surfaces must show upcoming work, not a dead end. CSS: `.ui-empty-state(-icon/-title/-sub/-action)`. |
| **`ErrorState`** | `message` (default copy), `onRetry`, `retryLabel='Try again'`, `icon='⚠️'`, `secondary` (extra node, e.g. Back), `className` | The failed-load panel, `role="alert"`, fixed "Couldn't load" title; rendered from a `loadError` catch branch, never in place of EmptyState. CSS: `.ui-error-state*`. |
| **`PageHeader`** | `title` (renders `<h1>`), `subtitle` (usually a count), `actions` (right slot), `children`, `className` | Standard page title row. CSS: `.ui-page-header(-titles/-title/-sub/-actions)`. |
| **`SearchInput`** | `value=''`, `onChange(nextString)` (**string, not event**), `placeholder='Search…'`, `onClear`, `className`, `inputClassName`, `...rest` | Controlled search box: `IconSearch` (15px) + `input[type=search]` + clear ✕ when non-empty (`onClear` or `onChange('')`). `aria-label` defaults to placeholder. Reuses the shared `.input` class → inherits the iOS 16px-font zoom guard. CSS: `.ui-search(-icon/-input/-clear)`. |

Plus `uiPrimitives.render.test.jsx` (render contract test).

### `src/components/TabLoading.jsx`
`{ label='Loading…' }` — a tiny centered text placeholder (inline-styled: 64px vertical padding, `var(--text-tertiary)`, 13px) for tab/panel bodies. Part of the 3-word loading vocabulary (TabLoading = panels; skeletons = tech/v2; `.loading-page` spinner = route-level). DevTools keeps a byte-identical local copy.

### `src/components/tech/v2/` (Foundation-owned, frozen; barrel `index.js`)

| Primitive | Props | Contract |
|---|---|---|
| **`StatusChip`** | `status`, `className` | Maps appointment status → field-status token key (`scheduled/confirmed→scheduled`, `en_route→enroute`, `in_progress→working`, `paused→paused`, `completed/cancelled→completed`) and applies **inline style** `background: var(--status-<key>-bg)` / `color: var(--status-<key>-color)`. Labels: Scheduled / On My Way / Working / Paused / Done / Cancelled. Class `.tv2-status-chip`. Color is picked by token name, never hex — the chip only chooses *which* token set. |
| **`ApptListRow`** | `appt`, `onNavigate?(href)` | One tappable `<button class="tv2-appt-row">`: left accent bar (`appt.color` else `var(--tech-accent)`), title, meta line (`h:mm AM · insured · city · done/total tasks`), trailing `StatusChip`. Navigates via `apptHref()` — never a hardcoded path. Elements use BEM-ish `__` suffixes (`.tv2-appt-row__bar/__body/__title/__meta`). |
| **`TechV2Page`** | `title`, `subtitle`, `actions`, `children` | Body scaffold (`.tv2-page`): h1 at `var(--tech-text-heading)`, subtitle at `var(--tech-text-label)`, right actions slot. Header spacing is inline-styled (a value to replace; slot structure to keep). |
| **`TechPane`** | `active`, `header`, `children` | Keep-alive pane host mounted by `TechLayout`: inactive panes are `hidden` (NOT unmounted); scroll position tracked **continuously** into a ref via passive listener (WebKit reports `scrollTop 0` on `display:none` — save-on-hide would break) and restored in `useLayoutEffect` before paint; `header` renders **outside** the scroll container so pull-to-refresh never moves it. Classes `.tv2-pane`, `.tv2-pane-header`, `.tv2-pane-scroll`. |
| **`skeletons`** | `SkeletonBlock {height=16,width='100%',radius,style}`, `SkeletonRow` (mimics ApptListRow shape), `SkeletonList {rows=5}` | `.tv2-skel` shimmer blocks — **cold-start only**; cached content is never replaced by a skeleton. |
| **`nav.js`** | `apptHref(apptId, jobId)`, `jobHref(jobId)`, `setHubNav(enabled)`, `isHubNav()` | The single URL-decision point for every appointment/job link in v2. Runtime per-user switch (`page:tech_job_hub` flag mirrored in by AuthContext) flips all links between legacy detail pages and the Job Hub. Hardcoding `/tech/appointment/` or `/tech/jobs/` is forbidden. |

### Shared hooks (`src/hooks/`)

| Hook | Signature | Purpose |
|---|---|---|
| **`useResumeRefetch`** | `({ onResume, onFocus, pollMs, hiddenEdgeOnly=true, enabled=true })`; also exports pure `subscribeResume({doc,win,getOnResume,getOnFocus,pollMs,hiddenEdgeOnly})` for DOM-free tests | THE one sanctioned resume/focus/poll refetch. Callbacks must be **silent** (no loading-flag flip). Fires `onResume` only on a real hidden→visible edge by default; poll no-ops while `document.hidden`; callbacks held in refs so inline functions don't re-subscribe. Replaces 8 hand-rolled visibility handlers. |
| **`useTwoClickConfirm`** | `(timeoutMs=3500) → { armedKey, isArmed(key), arm(key), cancel }` | The arm-then-confirm destructive-action mechanism (replaces banned `alert()`/`confirm()`; CLAUDE.md Rule 2). Auto-disarms on timeout; arming a different key replaces; cancel on blur is the caller's job. |
| **`useLookup`** | `(kind, options) →` react-query result; registry `LOOKUPS = { employees, job_phases, carriers }` | Cached shared reference lists; stable `['lookup', kind]` keys dedupe across all consumers; staleTime 5min / gcTime 30min; column-named selects (never `select=*`). New roster kinds are added to the registry, never fetched per-page. |
| **`usePhotoUpload`** | hook → `{ uploadPhoto(file, {jobId*, appointmentId, roomId, description, category='photo', name}), thumbUrl, publicUrl }`; module-level pure `thumbUrl(filePath, {width=400, quality=60, resize='cover'})` and `publicUrl(filePath)` | The **single media-URL construction point** (db-foundation P8 signed-URL swap seam) + the one upload path: validate → `mediaCompress` → Storage POST → `insert_job_document` RPC. Grids use `thumbUrl` + `loading="lazy"` + `decoding="async"`; full-res `publicUrl` for lightbox/download only. |
| **`usePageTransition`** | `() → '' \| 'page-slide-fwd' \| 'page-slide-back'` | Directional list↔detail slide class from router navigation type (PUSH/POP/REPLACE); module flag suppresses the first (cold-load) navigation. Currently used by 4 desktop billing pages; the app-wide mechanism is View Transitions (§3/§6). |
| **`useOfflineQueue`** | `useSyncExternalStore`-based; exposes enqueue + live `{ pendingCount, syncingCount, errorCount, isOnline }` | Offline mutation queue (photos, notes, task toggles) over `offlineDb`/`syncRunner` singletons; module-level shared state so many components stay in sync without prop drilling. |

Adjacent lib singletons the primitives depend on (mechanisms, listed for completeness): `src/lib/toast.js` (`toast/ok/err` — the ONLY toast entry), `src/lib/nativeHaptics.js` (`impact/selection/notify`, no-op on web, reduced-motion-aware), `src/lib/techQuery.js` (frozen react-query key registry + `invalidateTech` mutation→keys map), `src/lib/useNavDirection.js` (stamps `html[data-nav]` for the directional push).

---

## 3. Theming mechanism for `/tech/*` (how dark mode works today; how a new theme swaps in)

**Three cooperating layers — this is the whole mechanism:**

1. **`ThemeContext`** (`src/contexts/ThemeContext.jsx`, mounted in `App.jsx` outside AuthProvider). Holds `mode ∈ ['system','light','dark']` (exported `THEME_MODES`), persisted in localStorage key `upr_theme_pref` (device-local, never server-synced; default is **`light`**, not system). Pure `resolveEffectiveTheme(mode, systemPrefersDark)` → `'dark'|'light'`; a persistent `matchMedia('(prefers-color-scheme: dark)')` listener makes `system` follow the OS live. The effect **sets `data-theme="dark|light"` on `<html>`** (`document.documentElement`) and coordinates the Capacitor status bar (`statusBarLight/statusBarDark` — no-op on web/PWA). Exposes `{ mode, effective, setMode }` via `useTheme()`; the tech toggle UI lives in `src/components/tech/settings/AppearanceSection.jsx`.

2. **Scoped-token-override CSS.** Every tech rule reads core tokens via `var()`. The dark palette is a single block — `[data-theme="dark"] .tech-layout { …re-declared tokens… }` — that re-points the **same custom-property names** inside the tech shell subtree only. Because the selector requires `.tech-layout`, only `/tech/*` goes dark; the desktop/office UI is untouched by the same `<html>` attribute. The identical trick is used by `.crm-roadmap-page.dark` (class-scoped instead of attribute-scoped) and `.crm-shell` (a permanently different identity via its own `--crm-*` namespace). A handful of component-level dark exceptions exist (`[data-theme="dark"] .tv2-msgs-…` rules ~11535) where a token doesn't cover a case.

3. **The component layer never knows.** `StatusPill` (via `data-tone` → semantic triplets) and `StatusChip` (via `--status-<key>-*` names) select token *names*; the theme block swaps token *values*. Dark = a token swap, not a per-component fix.

**Swapping in a whole new theme through the same mechanism:** (a) re-declare values in the existing `:root` + `.tech-layout` blocks for the new default look — zero component changes; (b) for a second selectable theme, add a mode to `THEME_MODES`/`resolveEffectiveTheme` and ship a matching `[data-theme="X"] .tech-layout { … }` block re-declaring the same token names; (c) status-bar/`theme-color` coordination hangs off the same effect. **The known limit (must be fixed in the reskin):** anything painted from **inline hexes** — `techConstants.js` color maps, `DivisionIcons.jsx` configs, per-page inline styles — bypasses `var()` entirely and is invisible to the theme swap (the dark block's own comment defers these). A greenfield reskin should fold every such map into tokens (or `data-*`-keyed classes) so the swap covers 100% of paint.

---

## 4. `index.css` reserved-marker system & the `tv2-*` convention

**The governance mechanism:** one stylesheet, append-only sections. Each initiative/phase may write CSS **only inside its own reserved comment marker** (usually near the end of the file); everything outside your marker is frozen; mobile rules inside a marker use `@media (max-width: 768px)`; the `design-consistency-checker` fails raw hex/px where a token exists. Markers on disk today:

- `─── OMNI-INBOX RESERVED — Phase U (unified inbox UI) ───` (line 692; occupied by sms-experience Phase C)
- **TECH-V2 section markers** (same system, different label style): `TECH-V2: SHARED` (5016, Foundation-owned primitive styles), `TECH-V2: SCHED` (5097), `TECH-V2: DASH` (5678), `TECH-V2: HUB` (5943), `TECH-V2: MSGS` (10788, with a `B1 (core experience)` sub-marker at 10858)
- **ADMIN-MOBILE**: `SHARED` (6511), `DASH` (6614), `COLLECTIONS` (6821), `INVOICE` (6913), `ESTIMATE` (7018), `LEADS` (7259)
- **CRM WAVE RESERVED**: Phase 4d (8841), 6a (8876), 6b (8955), 7 (9032), 8 (9130), 9 (9222), 10 (9280), 4b (9389), 5 (9392)
- **FEEDBACK MEDIA RESERVED**: Session B (9590), Session C (9597)
- **NOTIFY CENTER RESERVED**: Session C (9665), Session D (9763)
- **SETTINGS OVERHAUL RESERVED**: P1 (10020), P2 (10098), P3 (10284), P4 (10536), P5 (10563), P6 (10617), P7-lite (10677), P10 (10679), P8 (10695), P9 (10764)
- **MOTION ROLLOUT RESERVED — W1 (toast enter/exit)** (11900)
- Plus the F-S2-owned base block `UX-QUALITY F-S2 — SHARED PRIMITIVES + MOTION FOUNDATION` (11558) containing the `@view-transition` mechanism and per-primitive `───` section comments (Modal 11643, StatusPill 11714, Empty/ErrorState 11728, PageHeader 11739, SearchInput 11749, IconButton 11762).

**Class-prefix convention (collision isolation):** every surface gets a prefix — `.ui-*` (shared primitives), `.tech-*` (legacy tech shell — may **never** be restyled by v2 work), `.tv2-*` (tech v2: **all v2 styles are NEW `tv2-` classes**, 542 occurrences; BEM-ish elements via double underscore, e.g. `.tv2-appt-row__bar`; modifiers via suffixed words/`--` as in `.ui-modal--closing`), `.crm-*`, `.conv-*`/`.message-*` (conversations), etc. Pane-scoped descendant overrides of imported classes are permitted *inside* a marker (they can't leak). State variants ride attributes (`[data-tone]`, `[data-theme]`, `[data-nav]`, `hidden`) or `--closing`/`--leaving` classes.

**Also part of the motion mechanism in this file (keep):** `@view-transition { navigation: auto; }` (11573); persistent shell chrome pinned static via unique `view-transition-name`s (`vt-sidebar`, `vt-bottombar`, `vt-technav`, `vt-topnav`, `vt-techheader`, `vt-tv2topbar`); directional iOS-style push keyed off `html[data-nav="back"]` (set by `useNavDirection`); the whole thing gated behind the `feature:page_transitions` flag via `html.ui-vt` (flag OFF = a kill-switch zeroing all view-transition animation); reduced-motion collapses to 1ms. Toast enter uses `--motion-spring-in`, exit = 75% duration on `--motion-ease-accelerate` with a `--leaving` flag + `animationend` (mirrors Modal). Every motion rule ships a `prefers-reduced-motion: reduce` fallback (32 blocks in the file) and hover transforms are gated off coarse pointers.

---

## 5. Icon architecture & the consumption CONTRACT

**Four parallel icon sources exist; there is NO single icon system for tech screens:**

1. **`src/components/Icons.jsx`** — 16 named function exports, 156 lines total (`IconDashboard, IconConversations, IconJobs, IconProduction, IconOpenPage, IconLeads, IconCustomers, IconSchedule, IconTimeTracking, IconMarketing, IconAdmin, IconSettings, IconLogout, IconSend, IconSearch, IconNote`). Pattern — this IS the contract:
   ```jsx
   export function IconX(props) {
     return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>…</svg>;
   }
   ```
   - **No `size`/`strokeWidth` prop API.** All props spread onto the root `<svg>`, so callers size via `width`/`height` attributes (`<IconSearch width={16} height={16}/>`), a `style` object (`style={{width:15,height:15}}` in SearchInput), or a CSS rule (`.tech-nav-tab svg { width: 26px; height: 26px; }`).
   - **No intrinsic width/height attributes** — an unsized icon relies on its container's CSS rule.
   - **Color inherits** via `stroke="currentColor"` (outline style, 24-unit grid, stroke-2, round caps/joins). A replacement set must honor: named per-icon exports, `viewBox="0 0 24 24"`, `currentColor`, props-spread onto root svg, decorative usage marked `aria-hidden` by the caller.
2. **`TechLayout.jsx` local nav icons** — 6 module-local components (`IconHome, IconCalendar, IconChecklist, IconChat, IconFolder, IconMoreDots`) with a **`{ filled, ...props }` duality**: `filled` (active tab) renders a solid variant (`fill="currentColor" stroke="none"`), otherwise the outline variant (two delegate to shared `IconSchedule`/`IconConversations`). Nav tabs consume via a `{ key, label, path, Icon, exact }` registry and render `<tab.Icon filled={active}/>`. A replacement bottom-nav icon set must support the filled/outline pair per icon.
3. **`DivisionIcons.jsx`** — the keyed domain-icon API: `DivisionIcon({ type, size=20, color?, style, ...rest })` and `LossIcon(…)` switch on a `type` key; colors default from exported `DIVISION_CONFIG` / `LOSS_CONFIG` (`{ color, bg, label }` per key — **inline hexes**, not tokens) with `DIVISION_COLORS` convenience map. Single source of truth for division/loss iconography.
4. **Ad-hoc inline SVGs** — the dominant reality on tech screens: **176 raw `<svg>` occurrences across 43 files** under `src/pages/tech/` (TechAppointment alone has 21). Emoji also serve as icons in `techConstants.TYPE_CONFIG` (📡💧🔍🔨📋…) and as primitive defaults (`ErrorState` '⚠️', ✕ glyphs). Sibling per-surface sets exist at `src/lib/crmIcons.jsx` and `src/components/admin-mobile/icons.jsx` (same inline-SVG pattern).

**Contract summary for a replacement set:** named React components, 24-viewBox, `currentColor`, props-spread sizing (plus CSS-rule sizing for nav), a filled/outline variant channel for the tab bar, a keyed `type/size/color` API for division/loss icons — and a consolidation pass over the 176 inline one-offs, which today have no contract at all.

---

## 6. KEEP (mechanism) vs REPLACE (values/looks)

### KEEP — the machinery the reskin plugs into
- **Token indirection**: components paint only via `var(--…)`; all definitions in the six known blocks. The grouped **namespace structure** (surfaces / borders / text / accent / semantic tone triplets / field-status trios / shadows / radii / spacing / type / motion / safe-area) and the triplet shapes (`-bg/-color|-border` trios; `fg/bg/border` tone triplets).
- **Scoped-token-override theming**: `data-theme` attr on `<html>` from `ThemeContext` (localStorage pref, system-follow listener, Capacitor status-bar hook) + shell-scoped re-declaration blocks (`[data-theme="dark"] .tech-layout`). A new theme = a new value block + optionally a new mode; zero component edits.
- **The semantic selection seams**: `StatusPill`'s `data-tone` + `toneForStatus()` classifier; `StatusChip`'s status→token-key map; the "status owns the color channel, division owns the accent bar" split.
- **All `src/components/ui/` prop/behavior contracts** (Modal's focus-trap + `--closing` exit lifecycle; IconButton's required-label + haptic; ErrorState/EmptyState semantics under `loading-error-states.md`; SearchInput's controlled-string API; PageHeader slots) and **TabLoading**'s role in the 3-primitive loading vocabulary.
- **All tech-v2 primitives' mechanics**: TechPane keep-alive + continuous-scroll-ref + header-outside-scroll; skeleton cold-start-only rule; ApptListRow/TechV2Page slot structures; `nav.js` href indirection + runtime hub switch.
- **All hooks**: `useResumeRefetch` (silent resume law), `useTwoClickConfirm`, `useLookup` registry, `usePhotoUpload`/`thumbUrl` as the single media-URL seam (P8 depends on it), `useOfflineQueue`, `usePageTransition`.
- **Motion architecture**: the token catalog (duration/ease separation, spring-in enters-only rule), View Transitions wiring (`@view-transition`, `vt-*` named static chrome, `html[data-nav]` direction, `html.ui-vt` flag gate + kill-switch), universal reduced-motion + coarse-pointer hover gates, exit-≈75%-of-enter convention, `--closing`/`--leaving` unmount-on-animationend pattern.
- **CSS governance**: one file, reserved markers, per-surface class prefixes (`tv2-*`, `ui-*`), append-only sections, tokens-only inside markers.
- **Icon consumption contract** (§5): named exports, 24-viewBox, `currentColor`, props-spread, filled/outline nav duality, keyed DivisionIcon API.
- **Layout math**: `--safe-*` env() wrappers, `--tech-nav-height`-driven content padding, `viewport-fit=cover` dependency, `100dvh` shell.
- Adjacent singletons: `toast.js`, `nativeHaptics.js`, `techQuery.js` key registry, `ThemeContext` API.

### REPLACE — the values and looks being scrapped
- **Every token VALUE** in `:root`, `.tech-layout`, and both dark blocks: all colors, shadow recipes, radius/spacing/type-scale numbers, font families, motion durations/curve values. (Names and grouping stay; numbers/colors are the designer's.)
- **The drawn icon artwork** (all SVG paths) and the emoji-as-icon usages.
- **All inline-hex debt that bypasses the mechanism — fold into tokens during the reskin**: `techConstants.js` maps (`APPT_STATUS_COLORS`, `CLAIM_STATUS_COLORS`, `DIV_GRADIENTS`, `DIV_PILL_COLORS`, `DIV_BORDER_COLORS`, `TYPE_CONFIG`), `DivisionIcons.jsx` `DIVISION_CONFIG`/`LOSS_CONFIG` hexes, per-page inline styles (the 176 inline SVGs' hosts, `TechV2Page`/skeleton inline spacing), and the duplicated dark hex sets (the same dark palette is copy-pasted at `[data-theme="dark"] .tech-layout` 4528 and `.crm-roadmap-page.dark` 8295 — a greenfield theme should have ONE dark value source). These maps duplicate the field-status token values in JS — the redesign should make the CSS tokens the single source and delete the JS hex mirrors.
- **The 176 ad-hoc inline SVGs** across 43 tech files → a centralized set honoring the §5 contract.
- The legacy `--transition-*` combined tokens (superseded by the `--motion-*` split — keep only as aliases if needed), and the legacy desktop conversation-status tokens (`--status-needs-response` etc.) if the new palette re-bases them.
- Cosmetic defaults baked into primitives (ErrorState's '⚠️'/copy, ✕ glyphs, TabLoading's inline style) — swappable without touching the prop contracts.

---

## survey:brand

# Survey 5 — Brand Identity Findings (UPR field-tech PWA greenfield redesign)

Surveyed: `index.html`, `public/` (manifest + all icon SVGs), `src/index.css` tokens, `Login.jsx` / `SetPassword.jsx` / `Status.jsx` / `PublicRoadmap.jsx`, `Sidebar.jsx` / `TopNav.jsx` / `TechLayout.jsx` / `CrmLayout.jsx`, `functions/lib/email-template.js` + `functions/api/send-esign.js` + `src/lib/emailTemplate.js`, `SignPage.jsx`, `functions/api/demo-sheet-pdf.js`, `capacitor.config.json`, `ios/App/App/Assets.xcassets/**`, plus repo-wide greps for `logo`/`brand`/`Utah Pros`/`--brand-primary`.

---

## 1. What the UPR brand visually IS today

### 1.1 The marks — four unrelated ones coexist; no logo file exists

**There is no logo image asset anywhere in the repo.** A repo-wide search for `*logo*` files returns nothing; the only images in `src/assets/` are Vite-template leftovers (`react.svg`, `vite.svg`, and an unused `hero.png` — an abstract dark 3D-platform graphic with purple `#7c3aed`-family edge glow, imported by no file). Every "logo" in the product is either a text glyph built in CSS/SVG or a stock template asset:

1. **The in-app "U" tile (the de-facto mark).** A single white bold letter "U" (Inter, weight 700–800) centered on a solid `var(--accent)` = **#2563eb** rounded square. Built entirely in CSS — no asset. Renders at:
   - `Sidebar.jsx:26–27` — 32px tile (`.sidebar-logo`, `index.css:180`) + text "UPR Platform" (desktop app shell)
   - `TopNav.jsx:65–66` — 30px tile (`.topnav-logo`, `index.css:7746`) (desktop wide top-nav, links Home)
   - `Login.jsx:85–88` — 40px tile (`.login-logo-icon`, `index.css:827`) + "UPR Platform" wordmark (this is the login every employee, including techs, sees)
   - `SetPassword.jsx:90–139` — 48px tile (`.set-pw-logo`, `index.css:2568`)
   - `Status.jsx:70–72` and `PublicRoadmap.jsx:39–41` — same login-logo block on the two public no-login pages
2. **The PWA / home-screen icon** (`public/icon-192.svg`, `public/icon-512.svg`). Same concept as a standalone SVG: rounded rect (rx 32 / rx 80) filled **#2563eb**, white **Arial** (not Inter) bold "U" centered. Placeholder-grade. This is what a tech sees on their iPhone home screen (manifest icons + `apple-touch-icon`).
3. **The browser favicon** (`public/favicon.svg`, referenced `index.html:5`) — a **completely different mark**: a 48×46 angular lightning-bolt / double-zigzag flash glyph (two stacked chevron cuts, a pointed tail at bottom — reads as a stylized "bolt" or abstract double-arrow). Base fill **purple #863bff** (display-p3 0.5252 0.23 1), overlaid through an alpha mask with ~16 heavily gaussian-blurred ellipses creating an "aurora gradient" interior: deep violet **#7e14ff**, pale lavender **#ede6ff**, and sky blue **#47bfff**. Figma-export artifacts in the filter IDs. These purples/cyan appear nowhere else in the product. Browser tab only.
4. **The iOS native app icon + splash** (`ios/App/App/Assets.xcassets/`) — the **unmodified stock Capacitor template**: icon = blue-gradient diagonal cross/X strokes on white with a faint lattice grid (`AppIcon-512@2x.png`); splash = a tiny version of the same mark centered on a 2732×2732 white canvas. Never replaced with anything UPR.

Additionally, agreements carry a deliberate sub-accent: `SendEsignModal.jsx:261` — `accent = isRecon ? '#f59e0b' : var(--brand-primary)` ("Amber branding (reconstruction) vs blue (mitigation)", `ReconAgreementContent.jsx:13`).

### 1.2 Wordmarks / naming (text is the real brand carrier)

| String | Where |
|---|---|
| **"UPR Platform"** | `<title>` (`index.html:13`), login card, sidebar, set-password ("Welcome to UPR Platform"), /status, /roadmap |
| **"UPR"** | manifest `short_name`, `apple-mobile-web-app-title` (`index.html:19`), Capacitor `appName`, install banner ("Install UPR for the best experience", `TechLayout.jsx:212`), biometric prompt ("Unlock UPR", `nativeBiometric.js:36`) |
| **"UPR — Utah Pros Restoration"** | manifest `name` |
| **"Utah Pros Restoration"** (full company name) | email header band, SignPage header, Invoice/Estimate preview headers (`InvoiceEditor.jsx:827`, `EstimateEditor.jsx:504`), Dashboard subtitle (`Dashboard.jsx:129`), Collections subtitle, Scope Sheet micro-header (`TechDemoSheet.jsx:1324`), demo-sheet PDF |
| **"Utah Pros"** | legal copy in the recon agreement |
| **"CRM"** | the CRM shell's own sidebar brand text (`CrmLayout.jsx:106`) — not "UPR" |

Recurring identity content on customer-facing surfaces: phone **(801) 427-0582**, email **restoration@utah-pros.com**, tagline **"Licensed & Insured · Utah"**, address **1055 N State St, Orem, UT 84057**, domains **utahpros.app** (app) / **utah-pros.com** (email).

### 1.3 Brand hex inventory (the sanctioned styling exception)

| Hex | Token / name | Role & where it appears |
|---|---|---|
| **#2563eb** | `--accent` (`index.css:31`); "Accent (primary blue)" in `UPR-Design-System.md:53` | The de-facto brand hue. Logo tiles (all), buttons, links, focus rings, e-sign email CTA button (`send-esign.js:168`), SignPage title rule + submit (`SignPage.jsx:561,576`), scope-sheet accent (`DemoSheetRenderer.jsx:19`), demo-sheet PDF `blue` (`rgb(0.145,0.388,0.922)` = #2563eb, `demo-sheet-pdf.js:179`). **Also** doubles as the semantic `--info` token (`index.css:81`) and the scheduled/active/water status blue (`techConstants.js:32,42,67`) — brand hue = status hue. It is Tailwind's stock blue-600. |
| #1d4ed8 | `--accent-hover` | Hover state (Tailwind blue-700) |
| #eff6ff | `--accent-light` | Accent tint bg (Tailwind blue-50); tech dark theme re-points it to #1c2438 |
| #3b82f6 | `--sidebar-accent` (`index.css:16`) | Sidebar active-item color (blue-500); also the "water" division color |
| **#111318** | `--sidebar-bg` = `--text-primary` ink | `meta theme-color` (`index.html:15`), manifest `theme_color`, sidebar background, dark surround of login/status pages |
| **#1e293b** | (inline, slate-800 "navy") | The customer-facing header band: email shell (`email-template.js:49` + byte-synced twin `src/lib/emailTemplate.js:73` + `send-esign.js:154`), SignPage header (`SignPage.jsx:554`), demo-sheet PDF `navy` (`rgb(0.118,0.161,0.231)` = #1e293b) |
| #863bff / #7e14ff / #ede6ff / #47bfff | (favicon only) | The purple aurora-bolt favicon fills — used nowhere else |
| #6366f1 | `--crm-accent` (`index.css:8330`) | CRM sub-brand indigo, deliberately separate identity (Public Sans + #111827 sidebar; `index.html:10–12` comment: "the CRM keeps its own visual identity, not fused to UPR's Inter-based look") |
| #f59e0b / #b45309 | (inline amber) | Reconstruction-agreement sub-branding vs blue mitigation |
| #7c3aed | (inline purple) | Explicitly documented as "a one-off accent, not a status tone" (`UPR-Design-System.md:99`) |

### 1.4 The `--brand-primary` ghost token (notable finding)

`var(--brand-primary)` (plus `-light`, `-hover`) is **consumed in ~40 places but defined nowhere in the repo** — not in any CSS file (`index.css`, `claim-page.css`, `claim-ops-page.css`), not via any JS `setProperty`. Consumers: `index.css:2839–3370` (Create-Job flow, `.btn-link`, form focus rings), `JobPage.jsx`, `CustomerPage.jsx`, `CreateJobModal.jsx`, `NewInvoiceModal.jsx`, `NewEstimateModal.jsx`, `SendEsignModal.jsx`, `AddRelatedJobModal.jsx`, `SharedClaimUI.jsx`, `TemplateEditor.jsx:154`. Being undefined, these declarations resolve to inherited/initial values at runtime (links inherit text color; badge backgrounds go transparent). A token literally named "brand" was intended and never minted — the strongest single signal that the brand is unclaimed.

### 1.5 Surface-by-surface presence

- **Desktop app:** U-tile + "UPR Platform" in sidebar; U-tile in TopNav; that's all chrome-level branding.
- **Tech app (/tech/*):** see §3 — effectively none.
- **Emails (all outbound, Resend):** text-only brand — #1e293b header band, white 20px bold "Utah Pros Restoration", "Licensed & Insured · Utah" in #94a3b8, white card on #f4f4f5, footer with phone. No logo image in any email. Two byte-synced template twins (`functions/lib/email-template.js` ↔ `src/lib/emailTemplate.js`) plus the mirrored `send-esign.js` shell — a hue change must sweep all three.
- **Customer e-sign page (SignPage, public):** #1e293b header + company name, #2563eb accent rule/button, system font stack (not Inter).
- **PDF outputs (scope sheet):** text header "Utah Pros Restoration", navy #1e293b + blue #2563eb palette.
- **iOS native:** stock Capacitor icon + splash; white splash background (`capacitor.config`: `SplashScreen.backgroundColor #ffffff`); appId `com.utahprosrestoration.upr`, appName "UPR".
- **CRM (/crm/*):** its own sanctioned sub-identity (indigo #6366f1, Public Sans, brand text "CRM").

### 1.6 Typography

Inter 400–800 via two render-blocking Google Fonts links (`index.html:9,12`; W5 self-hosts per `perf-budget.md`) is the app face; Public Sans is CRM-scoped; emails/SignPage use the `-apple-system` system stack; the PWA icon "U" is Arial. No custom/brand typeface commitment beyond Inter-as-default.

---

## 2. PWA manifest identity (what the redesign must eventually update)

`public/manifest.json` (linked `index.html:14`):
- `name`: "UPR — Utah Pros Restoration" · `short_name`: "UPR" · `description`: "Utah Pros Restoration field operations"
- `start_url`: **"/tech"** — the installed PWA IS the tech app; the manifest identity is the tech app's identity
- `display`: standalone · `orientation`: portrait
- `background_color`: **#ffffff** · `theme_color`: **#111318**
- `icons`: `icon-192.svg` + `icon-512.svg`, `type: image/svg+xml`, `purpose: "any maskable"` — **SVG-only, no PNG fallback**, both the Arial-"U"-on-blue placeholder

Paired identity surfaces the redesign must update in the same pass:
- `index.html`: `<title>UPR Platform</title>`, `meta theme-color #111318`, `apple-mobile-web-app-title "UPR"`, `apple-mobile-web-app-status-bar-style "default"`, `apple-touch-icon → /icon-192.svg` (note: iOS does not render SVG apple-touch-icons — real devices likely fall back to a screenshot/blank tile today; ship a PNG), `favicon.svg` (the off-brand purple bolt)
- iOS: `AppIcon.appiconset` + `Splash.imageset` (both stock Capacitor), Capacitor `SplashScreen.backgroundColor`
- `sw.js` precache list if icon filenames change

---

## 3. Does the tech app show any brand mark?

**Essentially no.** `TechLayout.jsx` (the tech shell: header area + bottom `.tech-nav`) renders zero logo or wordmark — its only "upr" strings are toast event names. No tech page (Dash v1/v2, Schedule, Tasks, Claims, Job Hub, More) renders a logo. A tech encounters the brand only incidentally:
1. The home-screen icon (blue Arial "U" SVG) and the app name "UPR" under it
2. The splash: white screen (PWA) or the stock Capacitor X-mark (native build)
3. The shared login card (`/login`): U-tile + "UPR Platform" — before entering the app
4. The pre-install banner: "Install UPR for the best experience" (`TechLayout.jsx:212`, disappears once installed)
5. Inside one tool: "UTAH PROS RESTORATION" as a 9px uppercase micro-caption on the Scope Sheet document header (`TechDemoSheet.jsx:1324`) — document branding, not app branding
6. The Face ID prompt text "Unlock UPR"

Day-to-day working screens are brand-silent. The redesign starts from a blank slate in the tech shell — there is nothing to preserve, only the home-screen icon/name that techs have already learned to tap.

---

## 4. Read: is there a brand-hue commitment?

**The brand is effectively unclaimed for design purposes.** The evidence:

- **No logo exists.** Not one logo asset file in the repo; four mutually unrelated marks are live simultaneously (CSS "U" tile, Arial "U" SVG icon, purple aurora-bolt favicon, stock Capacitor iOS icon/splash), two of which are template defaults nobody replaced.
- **The named brand token is undefined.** `--brand-primary` is referenced ~40× and minted 0× — the codebase reached for a brand color and found none.
- **The "brand blue" is a framework default, not a choice.** #2563eb/#1d4ed8/#eff6ff/#3b82f6 are verbatim Tailwind blue-600/700/50/500. The same #2563eb simultaneously serves as the semantic `--info` status color, the "scheduled" appointment status, and the "water" division color — it carries no exclusive brand meaning anywhere it appears.
- **Fragmentation is sanctioned, not accidental:** CRM deliberately runs its own indigo + Public Sans identity; recon agreements run amber; the favicon runs purple; the design-system doc itself shrugs purple off as "a one-off accent."

**What IS consistent** (the only equity worth weighing): the names ("UPR", "UPR Platform", "Utah Pros Restoration"), the dark-ink header surface pairing (#111318 in-app chrome / #1e293b on every customer-facing email, e-sign page, and PDF), and a general "some blue" convention. That's identity by habit, not by commitment.

**Implications for the redesign:**
1. A new brand hue can be claimed freely — nothing protected would be lost. Keeping blue is equally cheap, but if kept it should be re-minted as a distinct value and **disambiguated from the status/info blue** (today "brand", "info", "scheduled", and "water division" are the same pixel value, which neuters all four).
2. Whatever hue is chosen must sweep the customer-facing trio in the same motion: the two byte-synced email templates + `send-esign.js`, SignPage, and the demo-sheet PDF palette — those are the only places customers currently see "the brand."
3. All four icon surfaces (favicon, PWA icon pair, apple-touch-icon, iOS AppIcon + splash) need replacement regardless of direction — none is salvageable, and a real PNG icon set is needed (the SVG-only manifest icons and the SVG apple-touch-icon are technically deficient today).
4. The undefined `--brand-primary` token is the natural mint point: define it once in `:root` and the ~40 existing consumers light up with the new brand color for free.

---

## survey:constraints

# SURVEY 6 — Owner Taste Signals + Binding Designer Constraint Sheet

**Scope:** greenfield redesign of the field-tech PWA (`/tech/*`). Sources read in full: `docs/tech-redesign-design-brief.md`, `.claude/rules/tech-mobile-ux.md`, `.claude/rules/motion-standard.md` (v2), `.claude/rules/perf-budget.md`; plus targeted reads of `docs/tech-v2-roadmap.md`, `docs/tech-messages-v2-roadmap.md`, `docs/ux-quality-roadmap.md`, `docs/ux-plan-review-vs-skills.md`, `docs/ux-motion-rollout-plan.md`, the wave-ownership manifests, `src/lib/featureFlags.js`, and `git log origin/dev` (verified live merge state 2026-07-14).

---

## 1. Owner taste signals on record (verbatim, with evidence)

### 1a. The wholesale rejection — the reason this redesign exists

| Quote / decision (verbatim) | Source | What it means for the designer |
|---|---|---|
| "**GREENFIELD — scrap the current design entirely.** The owner rejects the existing aesthetic wholesale (**'I hate it'**). Do **NOT** carry over any current color, typography, spacing, radius, elevation, or component look. Design a brand-new system **from a blank canvas** … **Keep ONLY the token/primitive *architecture*** F-S2 shipped (the swappable mechanism — CSS custom properties + shared primitives); pour entirely new *values* and *component styles* into it. Treat the current `UPR-Design-System.md` as the thing being replaced, not extended." | `docs/tech-redesign-design-brief.md:19-25` | Nothing visual survives. Only the CSS-custom-property token mechanism + shared-primitive architecture is kept; every value is new. |
| Design brief commit landed on dev as "docs: design brief — greenfield (scrap current aesthetic) + completeness bar (#415)" | git `623ee27` (dev tip) | The greenfield decision is committed plan-of-record, not a conversation aside. |

### 1b. The target bar — what "good" is, in the owner's words

| Quote / decision (verbatim) | Source | Signal |
|---|---|---|
| TechDash + TechSchedule were "the field techs' daily surfaces and **the owner's #1 complaint: glitchy, slow, unpolished, low information value.** Target bar (owner's words): **indistinguishable in feel from Apple/Google Calendar.**" | `docs/tech-v2-roadmap.md:13-15` | The reference class is first-party Apple/Google quality — feel, speed, information density. |
| "…and Apple/Google Calendar — **instant, anchored, nothing jumps.**" | `docs/tech-v2-dispatch.md:117` | "Feel" decomposes to: instant paint, anchored scroll, zero layout jump. |
| "Owner verdict on the tech mount [legacy `/tech/conversations`]: **'sucks, not polished, doesn't feel/look like Native iOS.'**" | `docs/tech-messages-v2-roadmap.md:17` | "Native iOS" is the owner's recurring quality vocabulary. |
| "**The native-iOS acceptance bar (owner's):** instant cache-first paint (no spinner-replaces-content) · zero remount on tab switch · smooth keyboard (composer rides visualViewport, thread pinned to newest, safe-area respected, no layout jump) · momentum scroll with ref-based restore (no setTimeout hacks) · 48px+ targets · status color from 3 feet · i18n (PT/ES techs) · optimistic send with inline retry · pull-to-refresh with a fixed header." | `docs/tech-messages-v2-roadmap.md:27-32` | The owner's own definition of native feel — this is the acceptance rubric the new design will be baked against. |
| Motion law "Born from **the owner's directive that navigating between screens should feel like *the system taking you there and bringing you back*, never a flashing refresh** — and that the motion 'standards catalog' must be **changeable from one place later**." | `.claude/rules/motion-standard.md:11-13` | Directional, continuous navigation; and one-place tunability (tokens) is an owner requirement, not an engineering nicety. |
| "…the app you asked for: **one that feels like the system taking you there and bringing you back.**" | `docs/ux-plan-review-vs-skills.md:104` | Same directive restated in the owner-facing plan review. |
| "'Native/premium feel' must not cost legibility or tap-target size. **Reconcile the tension deliberately.**" | `docs/tech-redesign-design-brief.md:31-32` | Premium is subordinate to the gloved-64-year-old persona when they conflict. |

### 1c. The M1 Job Hub rejection — the key negative datapoint

| Quote / decision (verbatim) | Source | Signal |
|---|---|---|
| "**OUTCOME (2026-07-04): shipped + merged (#307), functionally complete — owner REJECTED the UX** (**'it simply added one page to the other'**). Root cause: **coequal stacked sections, no field-first hierarchy** — … the surface is superseded by the 'Job Hub v2 (redesign)' section… Flag `page:tech_job_hub` reverted to `enabled=false`…" | `docs/tech-v2-roadmap.md:278-283` | Functional completeness is NOT acceptance. A screen with no hierarchy — everything equal weight — is a rejection even when every feature works. |
| "M1 (#307) was a faithful merge of the two legacy pages — **and that was exactly the problem: a filing cabinet with every drawer open.** v2 is a **designed-from-scratch, field-first command surface.**" | `docs/tech-v2-roadmap.md:398-400` | The owner rejects exhaustive flat listings of content. Wants a stage: one thing big, the rest reachable. |
| "**Design coherence demands one author per surface — splitting the page across parallel sessions is precisely what produced the M1 stack.**" | `docs/tech-v2-roadmap.md:568-569` | Process-level taste signal: one design author per surface (the redesign brief mirrors this: one screen per focused agent). |
| The corrective principles written after the rejection (binding on Job Hub v2, and de-facto the owner-approved hierarchy philosophy): "1. **The visit is the screen.** The selected visit's state drives what is BIG. 2. **State modulates EMPHASIS, never ACCESS.** … the stage reorders, it never hides. … 4. **Thumb zone:** capture/comms actions live in a docked bottom bar, not the header. … 6. **One confirm idiom:** two-tap red with 3s auto-cancel everywhere; typed-DELETE only for the admin job-archive. 7. **Status owns color** (`--status-*` trios); division = 4px left accent edge + small pill in details. No division-gradient banner." | `docs/tech-v2-roadmap.md:405-421` | The owner's accepted answer to "what should have happened instead": state-driven emphasis, thumb-zone action bar, single confirm idiom, color reserved for status. |

### 1d. Owner taste in action — the tech-messages bake fix round (what he actually asked to change on device)

All on `origin/dev`, post-B2, pre-production-release (#386 "Tech Messages v2 → production"):

| Commit | Owner-driven change | Taste signal |
|---|---|---|
| `52dbd8a` | "message bubbles hug their content (text/media), not full-width" | Content-sized, not stretched, elements. |
| `821b968` | "remove SMS/character counter + strip TEMP keyboard debug readout" | Less chrome; kill engineer-facing meters on field surfaces. |
| `1662c4f` | "fix photo attach (live FileList) + **remove list status bars**" | Again: remove decoration/noise from lists. |
| `1a2576a` | "animate the + actions menu open/close" | Motion IS wanted on occasional-tier controls (menu open). |
| `139e69a` | "keep the keyboard up when opening the + attach/note menu" | Keyboard continuity = native feel; no focus loss. |
| `bf7de1d` | "fix keyboard lift for iOS 26 (baseline height + kb-open inset drop)" | On-device keyboard behavior is a bake-blocking concern. |
| `ee3e5bc` | "allow sending a photo with no caption (media-only MMS)" | Never require text around a photo (snap-first extended to messaging). |
| Roadmap note: scheduled sends "**SHED** … kept out to **keep the native-feel send path pristine for the owner bake**." | `docs/tech-messages-v2-roadmap.md:249` | Cutting an office feature to protect field-flow purity is the sanctioned trade. |

### 1e. Motion & materials taste decisions (owner-adjudicated, 2026-07-13)

| Quote / decision (verbatim) | Source | Signal |
|---|---|---|
| "(B) Add a general spring/gesture library (Framer Motion ~40KB+ gz…). **Rejected.** … a global animation lib on an internal field-tool for a 64-yo-in-gloves is over-engineering, and impeccable/Emil's 'product register' explicitly values **crisp reliability over consumer-grade spring bounce**." | `docs/ux-plan-review-vs-skills.md:26` | No animation libraries; crisp > bouncy. |
| "**The sanctioned path (owner decision 2026-07-13 — option C, the middle path; the library ban stays)**" — scoped dep-free pointer+rAF spring for ≤3 surfaces only (bottom-sheet drag-dismiss, PullToRefresh, swipe-to-dismiss toast). | `.claude/rules/motion-standard.md:275-289`; recommendation at `ux-plan-review-vs-skills.md:31` | Real physical drag feel matters on exactly the surfaces the gloved tech touches physically — but nowhere else. |
| "**Don't chase consumer bounce/spring on core surfaces.** … an operations tool reads crisp and fast. Keep overshoot subtle (0.1–0.3), and keep *any* springiness **off money/claims/billing** — **a bouncing invoice erodes trust.**" | `docs/ux-plan-review-vs-skills.md:84` | Register: professional tool, subtle overshoot only, zero bounce near money. |
| "**Don't over-motion the high-frequency loop.** A tech clocking in 40×/shift or flipping the day view constantly should wait on *nothing*. **Delete-the-animation is a legitimate top fix**; delight belongs at first-run/completion moments, not on every tab tap." | `docs/ux-plan-review-vs-skills.md:85` | Frequency-tier philosophy is owner-approved: instant beats animated on daily-loop controls. |
| "**Don't chase 120Hz.** … Design for a well-tuned 60fps." / "**Don't lean on haptics for the feel.** `navigator.vibrate` is a genuine no-op on Safari *and* the installed PWA… Visual motion carries the entire experience on web." | `docs/ux-plan-review-vs-skills.md:86-87` | Design assumptions: 60fps ceiling, haptics are a native-build bonus only. |
| "**Don't ship `blur(20px)` on the tech nav without measuring it** … a 20px backdrop-filter over a scrolling list is a known WKWebView jank source on the exact LTE persona surface — measure on a real iPhone, drop to ~14px if it stutters." | `docs/ux-plan-review-vs-skills.md:88`; owner-measurement item at `motion-standard.md:148` | Frosted glass allowed, but capped and device-verified. |
| Brief materials note: "the verified iOS-Safari limits: **frosted blur works, true liquid-glass refraction does not; blur is GPU-costly over scrolling lists**." | `docs/tech-redesign-design-brief.md:58-60` | Depth/materials vocabulary available to the designer, with its hard ceiling. |
| View-Transitions page push "**stays dark until the owner graduates a flag**" (`feature:page_transitions`); gesture wave + page-transition/blur feel are **owner on-device feel-checked**. | `docs/ux-motion-rollout-plan.md:16,187,252-255`; `motion-standard.md:305` | Every feel-level call ends at the owner's iPhone; design for that gate. |

### 1f. Platform-drift complaint + standing pre-decisions

| Quote / decision (verbatim) | Source | Signal |
|---|---|---|
| "**The consequence is the drift the owner reported: every page a slightly different behavior, refresh, and look.**" Owner decisions (2026-07-13): "design target = **prep-for-redesign** (consolidate every page onto shared primitives + tokens keeping today's look, so a future redesign is a **one-place swap**, never a second pass over 63 pages)." | `docs/ux-quality-roadmap.md:19-22,32-33` | Uniformity is a felt owner pain; the redesign must be ONE system with zero per-screen dialects — and it lands as a token/value swap. |
| Owner pre-decisions (2026-07-03, locked): "① flag-gated parallel build (new files; legacy untouched until cutover); ② small best-in-class deps OK (TanStack Query…); … ④ offline bar = instant-cache reads + existing photo queue (offline clock actions out of scope)." | `docs/tech-v2-roadmap.md:27-31` | Build mechanics precedent the redesign brief re-adopts (flag-gated, owner-only until flipped). |
| Redesign standing decisions: two sessions (design → build behind flag); motion already standardized (confirm/tune, don't re-author); **no emojis — a proper SVG icon system**; completeness bar = "a **full, fine-tuned design system**, not a mood board — every foundation and every component spec'd with all states." | `docs/tech-redesign-design-brief.md:9-37,77-99` | The deliverable contract for the design session. |
| Open owner questions the design session must get answered: direction/feeling reference products + one-word feeling; premium-vs-rugged dial; brand color/mark or open palette; keep or rethink status-color semantics; light+dark or one; keep Inter or new face; density; icon style (outline/filled/duotone, stroke, corners); flat vs layered depth; mockup-react vs token-level approval. | `docs/tech-redesign-design-brief.md:41-62` | Ten explicit owner-input forks — unanswered as of this survey. |
| Peripheral (desktop, disposition signal only): owner on retiring old Schedule views — "Deactivate (hide, retain code)… Hard delete — rejected: discards the … groundwork the owner wants Month to grow into, and **'we'll develop those again.'**" | `docs/schedule-roadmap.md:375` | Owner preserves groundwork; prefers reversible retirement. |

---

## 2. THE CONSTRAINT SHEET — hard lines the new design cannot cross

Everything below is standing law (CLAUDE.md, `.claude/rules/*`, perf budget) or an inherited owner decision. The greenfield mandate scraps visual *values*, **not** these.

| # | Domain | The hard line | Source |
|---|---|---|---|
| 1 | Persona | Every decision judged as: a 64-year-old, non-tech-savvy field tech, work gloves, one hand, flooded basement or direct sunlight. "If he can't figure it out in one tap without reading instructions, it's too complicated." | `tech-mobile-ux.md:5`; brief:30-32 |
| 2 | Tap targets | Primary field actions (Clock In, checkbox, save, capture) ≥ **48px**. Dense secondary controls may be **44px** only with a code comment saying so. **Hit areas < 24px are banned regardless of visual size.** | `tech-mobile-ux.md:11-13` |
| 3 | Type floors | **11px absolute minimum; 12px for any actionable text.** | `tech-mobile-ux.md:14` |
| 4 | Status semantics | Status must read as **color from 3 feet away**. Current semantics: **Amber = OMW/en_route · Green = working · Red = paused · Blue = scheduled · Gray = completed.** (Brief Q4 lets the owner rethink hues, but "status = color at distance" itself is law; Job Hub law: **status owns color** — division/category gets only a 4px left accent edge + small pill, never a gradient banner.) | `tech-mobile-ux.md:15`; `tech-v2-roadmap.md:420-421`; brief:48-49 |
| 5 | Screen focus | **One primary action per screen** (Clock In on Dash, checkbox on Tasks, search on Claims). M1 precedent: coequal stacked sections = owner rejection. | `tech-mobile-ux.md:10`; roadmap:278-283 |
| 6 | Photo flow | **Snap-first, describe-later**: photo uploads immediately on capture, no blocking step; note/room-tag optional via dismissable toast ("Photo saved · Add note" → sheet). Never a required input between camera and save. Media-only sends allowed (no forced caption). | `tech-mobile-ux.md:8`; roadmap:416-417; commit `ee3e5bc` |
| 7 | Field actions | **No modals for field actions** — inline expandable inputs on cards; the tech never loses context. (Bottom sheets are the sanctioned overlay on mobile; desktop-style centered dialogs are not a field idiom.) | `tech-mobile-ux.md:9` |
| 8 | Destructive confirm | Never `alert()`/`confirm()` (eslint-enforced). **One confirm idiom: inline two-tap red with 3s auto-cancel**; typed-DELETE reserved solely for the admin job-archive. All feedback via the single toast entry point (`src/lib/toast.js`). | CLAUDE.md Rule 2; `tech-v2-roadmap.md:418-419`; `loading-error-states.md §4` |
| 9 | Pull-to-refresh | **Sticky headers don't move on PTR** — greeting/date header stays fixed; `PullToRefresh` wraps content BELOW the header. PTR is always the silent load (no loading-flag flip, never unmounts the page). | `tech-mobile-ux.md:16`; `loading-error-states.md §6` |
| 10 | Thumb reach | One-handed use: **capture/comms actions live in a docked bottom bar, not the header** (Job Hub Z3). Docked bar formula precedent: `bottom: calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom)))` above the 64px `.tech-nav`; **the bar must HIDE while any inline input has focus** (iOS keyboard hazard). | `tech-v2-roadmap.md:415,472-475` |
| 11 | Safe area | `viewport-fit=cover` required in `index.html` (never remove — without it `env(safe-area-inset-bottom)` = 0 everywhere). `.tech-nav` bottom padding: `max(12px, env(safe-area-inset-bottom, 12px))`. `dvh` + `env(safe-area-inset-bottom)` safe globally. | CLAUDE.md Rules 10, 11, 5 |
| 12 | Mobile CSS scope | Mobile-only rules use **`@media (max-width: 768px)` only** — desktop layout/colors/spacing must never change unintentionally. New CSS lives inside a reserved section marker; existing `.tech-*` selectors are not restyled in-wave (new-prefix classes, e.g. `tv2-*`, are the precedent). | CLAUDE.md Rule 5; tech-v2 manifest §5 |
| 13 | Fonts | **Self-hosted subsetted `woff2` only** (today Inter 500/600/700), `font-display: swap`; secondary families scoped to the chunk that needs them; **no render-blocking third-party font/style requests**. A new brand face must meet the same bar. | `perf-budget.md §1, §4`; brief:52-53 |
| 14 | CSS budget | **`index.css` ≤ 400 KB raw** (currently ~384 KB) with ratchet-DOWN intent. | `perf-budget.md §1` |
| 15 | JS budget | Entry-graph JS ≤ **232 KB gzip** (CI fails at 255 KB); any single route chunk ≤ **175 KB raw**; heavy deps route-lazy, never in the entry graph. Non-default locales (pt, es) lazy-loaded. | `perf-budget.md §1, §4` |
| 16 | Animation libraries | **No framer-motion / GSAP / react-spring, ever, in the entry graph.** Motion = CSS tokens + native View Transitions + WAAPI `element.animate()` one-shots. Only sanctioned escalation if gesture scope genuinely widens: Motion One (~5 KB), route-lazy, with an explicit perf-budget justification first. | `motion-standard.md §2, §9`; `ux-plan-review:26,83` |
| 17 | Blur / materials | Frosted blur OK; **blur ≤ ~14–20px**; "materialize" = co-animate `backdrop-filter` + scale (never blur alone); heavy blur over a scrolling list is a WKWebView jank risk — the `.tech-nav` blur(20px) is an **owner on-device measurement item** (default ~14px if jank). True liquid-glass refraction is not achievable in iOS Safari. | `motion-standard.md §3 (materialize), :148`; `ux-plan-review:88`; brief:58-60 |
| 18 | Reduced motion | **Mandatory `prefers-reduced-motion: reduce` fallback on every transition/keyframe** — collapses to instant or opacity-only, end-state still lands, haptics suppressed. A motion with no fallback is a **hard review failure (blocker/major)**. | `motion-standard.md §6, §7` |
| 19 | Hover gating | Every shared-component `:hover` transform gated behind **`@media (hover: hover) and (pointer: fine)`** — ungated hover fires a false hover on tap (control jumps under the finger). Hard failure. | `motion-standard.md §6, §7` |
| 20 | Motion frequency tiers | **High-frequency controls (tens of times/shift: clock in/out, task-check, tab/segment/day switch, filter pill) = instant or ≤120ms, opted OUT of `@view-transition`, NOT required to animate** — delete-the-animation is the correct call. Occasional (modal/sheet/toast/dropdown) = standard tokenized motion. Rare/first-run = may carry delight. | `motion-standard.md §3 tier table`; `ux-plan-review:85` |
| 21 | Exits | **Every enter has an exit ≈ 75% of the enter duration on `--motion-ease-accelerate`.** `if (!open) return null` (instant vanish on close) is a **defect**: play the exit, unmount on `animationend`. Modals fade+scale down; sheets slide back to the bottom edge; dropdowns/toasts reverse their enter. | `motion-standard.md §3 exit rule` |
| 22 | Spring token | `--motion-spring-in` (`linear()` curve): **enters only, non-interruptible one-shots** (modal pop, toast in, menu pop-in). **OFF money/claims/billing surfaces** (a bouncing invoice erodes trust) and **OFF any drag-interruptible surface** (a real gesture needs a velocity-aware spring). Overshoot subtle (0.1–0.3). | `motion-standard.md §1`; `ux-plan-review:39,84` |
| 23 | Motion mechanics | Tokens only (no bespoke `120ms`/`ease-in-out`/`@keyframes` where a token exists); durations: fast ~120ms / base ~200–240ms / slow ~320ms; page transitions ≤ base; **no `ease-in` on UI interactions; no UI duration > 300ms without a stated reason**; **transform/opacity only** (never width/height/top/left); time-based, GPU-composited, **designed for 60fps — nothing may assume >60fps** (WKWebView caps web content at 60). Transitions never block input, never gate a spinner, never re-run a page's `load()`. | `motion-standard.md §1, §2, §5, §7` |
| 24 | Page transitions | Native **View Transitions API** with **directional semantics** (forward enters from leading edge; Back reverses); the app shell (nav bar, headers) is persistent and does NOT animate — only the content region. Degrades to instant navigation below iOS 18. No per-page `entering`/rAF transition hacks. | `motion-standard.md §2, §8` |
| 25 | Gestures | Native overflow scroll first (free momentum + rubber-band). Custom drag limited to **≤3 surfaces** — mobile bottom-sheet drag-to-dismiss, PullToRefresh, swipe-to-dismiss toast — via the scoped dep-free pointer+rAF util (velocity dismiss `|dist|/elapsed > ~0.11`, release hands settle to CSS). **Never fake momentum with a long CSS transition** (reads dead). Per-frame values: write `node.style.transform` on the moving node — never a parent CSS var, never `useState`. Each gesture surface has an **owner on-device iPhone gate**. | `motion-standard.md §9, §7` |
| 26 | Haptics | Vocabulary via `src/lib/nativeHaptics.js` only: `impact('light')` = press/send/threshold; `selection()` = selection change; `notify()` = completion/failure. **Strictly additive** (no-op on web AND the installed PWA — visual motion carries the entire feel there); respect reduced-motion; never on scroll or keystroke. | `motion-standard.md §4, §8`; `ux-plan-review:87` |
| 27 | React motion footgun | No animated component defined inline inside another component; stable list keys (unstable key = remount = animation restarts + focus/scroll drop). Optimistic rows reconcile by **match-and-swap-in-place** so enter keyframes never re-fire (chat pending→sent). | `motion-standard.md §7`; `ux-plan-review:64` |
| 28 | Icons / emoji | **No emojis anywhere.** A proper **SVG icon system** (grid, stroke weight, outline/filled character, corner treatment all spec'd; the core tech icon set drawn). | brief:28, 88-89 |
| 29 | Loading states | Cold-start **skeleton** only on tech surfaces; `loading` starts true and is only ever set false — a refetch/mutation/PTR/resume **never** re-gates the page. Bare "Loading…" text and bespoke spinners banned. | `loading-error-states.md §3`; `page-lifecycle.md §1` |
| 30 | Error / empty states | **A failed load NEVER renders the success empty-state or a blank page** — `<ErrorState message onRetry>` (keep stale rows + banner where possible). `<EmptyState>` only after a successful zero-row load; **tech empty states show upcoming work** (next 7 days), never a dead end. Any hard row cap pairs with search/load-more. | `loading-error-states.md §1, §2, §5`; `tech-mobile-ux.md:17` |
| 31 | Resume behavior | **Resume does nothing** (the minimize test: background 30s+, resume — no blank, no spinner flash, no route/scroll/input loss). Refetch on resume is silent, request-guarded, through `useResumeRefetch` only. Timers (clock, OMW) keep continuity. Polls: cleanup + hidden-guard + never toast. | `page-lifecycle.md §1-§4`; `tech-mobile-ux.md` resume block; `close-out-standard.md #3` |
| 32 | Offline | Field mutations go through `useOfflineQueue` where wired (photos, notes, task toggles); a failed sync retries, never silently drops; instant-cache cold-open reads (idb persister). Offline clock actions are out of scope (owner decision ④). | `tech-mobile-ux.md` offline block; `tech-v2-roadmap.md:31` |
| 33 | Time display | **Completed state shows the breakdown — travel / on-site / total — never a bare "3.5h."** Timer reads as one continuous timer from OMW. | `tech-mobile-ux.md:18`, time-tracking model |
| 34 | Images | Grid/list images use **thumbnail** URLs (`thumbUrl()`) + `loading="lazy"` + `decoding="async"`; full-res only in a lightbox/download. All uploads through `mediaCompress.js`. **Media-URL construction in ONE helper** (it is the db-foundation P8 signed-URL swap seam). | `perf-budget.md §2` |
| 35 | Query hygiene | No `select=*` on lists; no unbounded lists (limit + server search or paginated RPC); shared lookups via `useLookup`; no waterfalls / N+1 (push joins into RPCs). Perceived performance: primary RPC behind a transitioned route should paint inside the ~200ms transition. | `perf-budget.md §3`; `ux-plan-review:76` |
| 36 | Viewport | **390px-wide viewport check on every touched page** — no horizontal scroll, no clipped content, tap targets ≥48px on tech surfaces. | `close-out-standard.md #4` |
| 37 | i18n | **EN/PT/ES from day one** (Portuguese-speaking techs; an English-only surface is a regression). Every string through `t()`. | `tech-v2-roadmap.md:422-424` |
| 38 | Theming | Current tech app supports dark; the deliverable designs **both light and dark with equal care** (unless the owner answers brief Q5 with "one"). | brief:50-51, 85-86 |
| 39 | Architecture kept | All values expressed as **CSS custom properties** (the swappable layer — the only thing kept from today); shared primitives consumed, not forked; motion retuned via tokens from one place. | brief:22-25, 96-97; `motion-standard.md §1` |
| 40 | Build mechanics | Redesign builds **behind a feature flag, owner-only until flipped** (precedent `page:tech_dash_v2`); one screen per focused agent; each screen gated by the reviewer gauntlet + `review-animations` (the feel gate — "approval is earned, not assumed") + the new design standard as acceptance spec; final feel gates are the **owner's on-device iPhone**. | brief:12-15; `close-out-standard.md #2, #7`; `motion-standard.md :305` |

---

## 3. In-flight initiatives touching `/tech/*` — inventory for fold-in / supersede / build-around decisions

The brief's own mandate: "the tech app has open redesign initiatives (Job Hub v2, tech-messages-v2). Decide per surface: fold-in / supersede / build-around — so nothing gets clobbered" (brief:36-37). Live state verified against `origin/dev` 2026-07-14.

| Initiative | Live state (verified) | What it owns / occupies | Bearing on the redesign |
|---|---|---|---|
| **Tech v2 Dash + Schedule (S/D/C phases)** | **COMPLETE + cut over.** Legacy `TechDash.jsx`/`TechSchedule.jsx` are deleted from disk; `TechDashV2.jsx` + `TechScheduleV2.jsx` are the live surfaces for all techs (flags `page:tech_dash_v2`/`page:tech_sched_v2` remain in the registry but the swap is history). | `src/pages/tech/v2/{TechDashV2,TechScheduleV2}.jsx` + `dash/**`, `schedule/**`; react-query cache + idb persister; `tv2-*` CSS. | Not in-flight — these ARE the screens to redesign. Their data layer (frozen `techQuery.js` registry: dash/schedMonth/activeClock/tasks/rooms/docs + hub + convos/thread kinds; `invalidateTech`; frozen RPC contracts `get_tech_dashboard`, `get_appointments_range`, `get_my_appointments_today`) is a keep — reskin on top. Adding a query kind = an F-owner manifest amendment (precedent exists twice). |
| **Job Hub v2 (H1→H2→bake→H3)** — the post-M1-rejection redesign, "the visit is the screen" | **H1 merged** (+ released to `main` dark via #329). **H2 merged** (#322, commit `8836304`) — note the db-foundation manifest's "H2 open PR #322" line is stale. **OWNER BAKE GATE OPEN — H3 not dispatched** (needs written owner sign-off). Flag `page:tech_job_hub` OFF/owner-only. Legacy `TechAppointment.jsx` + `TechJobDetail.jsx` still on disk and still what ALL techs use (nav retarget happens at H3 via the `nav.js` `HUB_ENABLED`/per-user flag switch). | `TechJobHub.jsx` + `hub/**` + css §HUB. H3 will: flip the flag to all techs, add the `/tech/appointment/:id` resolver + slim `JoblessVisit` surface (payroll clocks must never lose their surface), delete both legacy pages + the `appointment`(62 keys)/`job`(60 keys) i18n namespaces ×3 locales, one disclosed `TimeTracker.jsx` line. | The most delicate reconcile. The hub's **UX architecture is the owner's corrective feedback made concrete** (Z1 compact ~80px header · Z2 Stage with ARRIVING/WORKING/WRAPPED emphasis states, 40px StageClock, 56px checklist rows · Z3 docked capture bar · Z4 below-fold order visits→job&claim→photos→report; binding principles 1–8). The redesign should treat the hub's *structure* as validated-by-rejection-history and its *visuals* as scrap like everything else. Timing fork: the hub is pre-bake — redesign can either supersede its skin before the bake, or let the bake finish and fold in. Do not redesign legacy TechAppointment/TechJobDetail (H3 deletes them). |
| **tech-messages-v2 (F-M→B1→B2)** | **All three phases shipped; owner bake DONE with a post-bake fix round on dev; released to production** (#386 "Tech Messages v2 → production"). Flag `page:tech_msgs_v2` flip is the owner's (registry default false; live row owner-controlled). Shed stretch items still open in the roadmap: new-conversation flow (needs a server contact-search RPC), scheduled sends. | `TechMessagesV2.jsx` + `messages/**` (keep-alive pane, disclosed TechPane copy-in), the third TechLayout pane + Messages unread badge, `techQuery` `convos()`/`thread()` kinds, css §MSGS marker. Send path law: `POST /api/send-message` only; worker is sole writer of sms rows; DND one-tap ON only for techs; `consent-path-auditor` on any send-path change. | The freshest owner-baked surface — its bake fixes (§1d) are the most current taste data. Redesign = reskin (fold-in), keeping the pane mechanism, the consent/send seams untouched, and the shipped keyboard/scroll behaviors (they are the acceptance bar). `src/components/conversations/{MessageBubble,SegmentCounter,messageUtils}` are sms-initiative-owned imports (additive-only contract). MMS `publicMediaUrl` is a named db-foundation P8 swap target. |
| **UX-Quality / ux-alignment wave** | F-S1 (standards) + Phase 0 shipped; **F-S2 (primitives + `:root` color/motion tokens + global `@view-transition`) dispatched/landed** — this is the token/primitive architecture the brief says to KEEP (values swapped). **W1 "Tech legacy behavior + dark mode" dispatched** — behavior/dark/tap-target fixes on the 9 legacy tech pages + TechLayout toast + `techConstants` color maps; W1 explicitly may NOT restyle TechAppointment (H3-frozen). W5 (self-host fonts, lazy locales, `useLookup` rollout) dispatched; SW item owner-gated RED. | `src/components/ui/**`, `src/hooks/{useResumeRefetch,useTwoClickConfirm,useLookup,usePhotoUpload}`, `:root` tokens, `functions/lib` auth/http (F-B). | The redesign pours new values into F-S2's token layer — coordinate so the swap is one-place (the owner's stated reason for prep-for-redesign). **W6 fold-in ledger rule: "no surface is restyled twice"** (`ux-quality-roadmap.md:249`) — restyle-class fixes on tech surfaces route to THIS redesign, not to W-sessions. |
| **Motion rollout (`docs/ux-motion-rollout-plan.md`)** | motion-standard **v2** + `review-animations` close-out feel-gate merged (`72a26a5`); motion polish PR merged (`d1f6053` — modal/sheet exits, `linear()` spring token, reduced-motion sweep); rollout **W0+W1 merged** (`689d40f` — keyframe dedup, base `.btn` press, toast exit, list→detail nav push). Waves 2–6 pending; **Wave 7 (gesture util: sheet drag-dismiss, PTR, swipe toast) owner-feel-gated**; the View-Transitions directional push sits behind `feature:page_transitions` until the owner graduates it. | The motion mechanism + catalog (tokens, VT wiring, exits, spring token, gesture-util plan). | The brief says motion is already standardized — the redesign session **confirms/tunes feel against the new look, does not re-author** (brief:16-18). The gesture util does not exist yet in `src/hooks/` — if the new design leans on sheet-drag feel, sequence against Wave 7. |
| **db-foundation P8** (job-files signed URLs + bucket privacy flip) | Planned; **hard-gated on Job Hub H3.** | The `job-files` signed-URL helper + ~15 call-site swaps. | Any redesigned photo/MMS surface must keep media-URL construction in ONE helper so P8's swap stays one-place (`perf-budget.md §2`; tech-messages manifest §4). |
| **sms-experience** | All phases (H0/F-core/A/B/C/D/G) merged. F-red (anon-RLS closure) staged, owner-gated. | Desktop `Conversations.jsx` + `components/conversations/**` (frozen to that initiative); send workers. | Build-around: the tech shell no longer uses the shared screen (superseded by the messages pane). Do not touch the shared component or send workers. |
| **Shared seams to respect** | — | `src/i18n/index.js` (H3 deletes namespaces × any new namespace adds — known 3-line-conflict seam); `src/components/tech/v2/nav.js` `apptHref()`/`jobHref()` (**hardcoding `/tech/appointment/` or `/tech/jobs/` is forbidden** — cutover is a flag/constant flip); `TechLayout.jsx` pane host (flag-gated persistent panes, `active` prop contract, pathname-keyed outlet for everything else); `index.css` reserved markers + `.tech-*` restyle ban; one shared prod Supabase (fixture-ID test discipline; flag rows seeded `enabled:false` + owner `dev_only_user_id` BEFORE code merges — the DevTools auto-seed otherwise creates missing keys ENABLED). | These are the mechanisms the redesign builds within, whatever it looks like. |

**Net disposition picture for the design session:** Dash v2, Schedule v2, and Messages v2 are live, owner-shaped surfaces → **fold-in** (reskin via the token swap). Job Hub v2 is merged-but-unbaked → the one genuine **supersede-or-fold** decision, with its Z1–Z4/stage architecture carrying rejection-derived owner intent. Legacy TechAppointment/TechJobDetail and the desktop Conversations screen → **build-around** (scheduled for deletion / other-initiative-owned). The remaining legacy tech pages (Tasks, Claims, More, tools, create/edit sheets) have no competing in-flight designer — they are open canvas under W1's behavior-only caretaking.
